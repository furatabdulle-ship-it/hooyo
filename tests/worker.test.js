import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/worker.js";

function request(path, options = {}) {
  return new Request(`https://example.test${path}`, options);
}

test("CMS config keeps inquiry intake disabled by default", async () => {
  const response = await worker.fetch(request("/api/config"), {
    INQUIRIES_ENABLED: "false",
    TURNSTILE_SITE_KEY: "site",
    TURNSTILE_SECRET_KEY: "secret"
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    inquiriesEnabled: false,
    turnstileSiteKey: "site"
  });
});

test("public inquiry endpoint does not store data while disabled", async () => {
  let inserted = false;
  const response = await worker.fetch(request("/api/inquiries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Test", email: "test@example.com" })
  }), {
    INQUIRIES_ENABLED: "false",
    DB: { prepare() { inserted = true; } }
  });

  assert.equal(response.status, 503);
  assert.equal(inserted, false);
});

test("inquiry intake stays disabled until email delivery is configured", async () => {
  const response = await worker.fetch(request("/api/config"), {
    INQUIRIES_ENABLED: "true",
    TURNSTILE_SITE_KEY: "site",
    TURNSTILE_SECRET_KEY: "secret",
    INQUIRY_FROM_EMAIL: "sender@example.com",
    INQUIRY_RECIPIENTS: "one@example.com,two@example.com"
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    inquiriesEnabled: false,
    turnstileSiteKey: "site"
  });
});

test("admin endpoints reject requests without an Access JWT", async () => {
  const response = await worker.fetch(request("/api/admin/inquiries"), {
    CF_ACCESS_TEAM_DOMAIN: "team.cloudflareaccess.com",
    CF_ACCESS_AUD: "cms-audience",
    DB: {}
  });

  assert.equal(response.status, 401);
});

test("public content endpoint only accepts supported language codes", async () => {
  let queried = false;
  const response = await worker.fetch(request("/api/content?language=fr"), {
    DB: { prepare() { queried = true; } }
  });

  assert.equal(response.status, 400);
  assert.equal(queried, false);
});

test("public content endpoint filters published items by language", async () => {
  let query;
  let parameters;
  const expected = [{ id: 1, title: "Ein Beitrag", language: "de" }];
  const response = await worker.fetch(request("/api/content?language=de"), {
    DB: {
      prepare(sql) {
        query = sql;
        return {
          bind(...values) {
            parameters = values;
            return { all: async () => ({ results: expected }) };
          }
        };
      }
    }
  });

  assert.equal(response.status, 200);
  assert.match(query, /status = 'published'/);
  assert.deepEqual(parameters, ["de"]);
  assert.deepEqual((await response.json()).items, expected);
});

test("enabled inquiry endpoint validates input before external verification or storage", async () => {
  let queried = false;
  const response = await worker.fetch(request("/api/inquiries", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "Test", email: "not-an-email", topic: "other", message: "Hello" })
  }), {
    INQUIRIES_ENABLED: "true",
    TURNSTILE_SITE_KEY: "site",
    TURNSTILE_SECRET_KEY: "secret",
    INQUIRY_FROM_EMAIL: "sender@example.com",
    INQUIRY_RECIPIENTS: "one@example.com,two@example.com",
    INQUIRY_EMAIL: { send: async () => ({ messageId: "test-message" }) },
    DB: { prepare() { queried = true; } }
  });

  assert.equal(response.status, 400);
  assert.equal(queried, false);
});

test("valid inquiries notify both recipients and are stored", async () => {
  const originalFetch = globalThis.fetch;
  let notification;
  let inserted;
  globalThis.fetch = async url => {
    if (String(url).endsWith("/siteverify")) {
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(null, { status: 404 });
  };

  try {
    const response = await worker.fetch(request("/api/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test Sender",
        email: "sender@example.com",
        topic: "film",
        message: "Interested in the project",
        privacy: true,
        turnstileToken: "valid-token"
      })
    }), {
      INQUIRIES_ENABLED: "true",
      TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
      INQUIRY_FROM_EMAIL: "notifications@example.com",
      INQUIRY_RECIPIENTS: "one@example.com,two@example.com",
      INQUIRY_EMAIL: {
        send: async message => {
          notification = message;
          return { messageId: "test-message" };
        }
      },
      DB: {
        prepare(sql) {
          assert.match(sql, /INSERT INTO inquiries/);
          return {
            bind(...values) {
              inserted = values;
              return { run: async () => ({ meta: { last_row_id: 1 } }) };
            }
          };
        }
      }
    });

    assert.equal(response.status, 201);
    assert.deepEqual(notification.to, ["one@example.com", "two@example.com"]);
    assert.equal(notification.replyTo, "sender@example.com");
    assert.match(notification.text, /Interested in the project/);
    assert.deepEqual(inserted, ["Test Sender", "sender@example.com", "film", "Interested in the project"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed inquiry email delivery does not store the inquiry", async () => {
  const originalFetch = globalThis.fetch;
  let inserted = false;
  globalThis.fetch = async url => String(url).endsWith("/siteverify")
    ? new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
    : new Response(null, { status: 404 });

  try {
    const response = await worker.fetch(request("/api/inquiries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test Sender",
        email: "sender@example.com",
        topic: "film",
        message: "Interested in the project",
        privacy: true,
        turnstileToken: "valid-token"
      })
    }), {
      INQUIRIES_ENABLED: "true",
      TURNSTILE_SITE_KEY: "site",
      TURNSTILE_SECRET_KEY: "secret",
      INQUIRY_FROM_EMAIL: "notifications@example.com",
      INQUIRY_RECIPIENTS: "one@example.com,two@example.com",
      INQUIRY_EMAIL: { send: async () => { throw new Error("delivery failed"); } },
      DB: { prepare() { inserted = true; } }
    });

    assert.equal(response.status, 502);
    assert.equal(inserted, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scheduled retention deletes inquiries 180 days after closure", async () => {
  let query;
  await worker.scheduled({}, {
    DB: {
      prepare(sql) {
        query = sql;
        return { run: async () => ({ meta: { changes: 2 } }) };
      }
    }
  });

  assert.match(query, /status = 'closed'/);
  assert.match(query, /closed_at <= datetime\('now', '-180 days'\)/);
});
