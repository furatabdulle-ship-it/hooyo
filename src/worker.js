let cachedJwks;

const inquiryTopics = new Set(["beratung", "austausch", "veranstaltung", "film", "sonstiges"]);
const inquiryStatuses = new Set(["new", "in_progress", "answered", "closed"]);
const contentStatuses = new Set(["draft", "published"]);
const contentKinds = new Set(["article", "video"]);
const languages = new Set(["de", "en"]);
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    }
  });
}

function inputError(message, status = 400) {
  return json({ error: message }, status);
}

async function readJson(request, maxBytes = 30000) {
  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return null;
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }

    const body = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

function text(value, maxLength, required = false) {
  if (typeof value !== "string") return required ? null : "";
  const result = value.trim();
  if (result.length > maxLength || (required && result.length === 0)) return null;
  return result;
}

function inquiryRecipients(env) {
  if (typeof env.INQUIRY_RECIPIENTS !== "string") return null;
  const recipients = env.INQUIRY_RECIPIENTS.split(",").map(value => value.trim()).filter(Boolean);
  if (recipients.length !== 2 || new Set(recipients).size !== 2 ||
      recipients.some(address => !emailPattern.test(address))) {
    return null;
  }
  return recipients;
}

function inquiriesReady(env) {
  return env.INQUIRIES_ENABLED === "true" &&
    Boolean(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY) &&
    typeof env.INQUIRY_EMAIL?.send === "function" &&
    Boolean(env.INQUIRY_FROM_EMAIL && emailPattern.test(env.INQUIRY_FROM_EMAIL)) &&
    Boolean(inquiryRecipients(env));
}

function validVideoUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function getJwks(teamDomain) {
  const now = Date.now();
  if (cachedJwks && cachedJwks.teamDomain === teamDomain && cachedJwks.expiresAt > now) {
    return cachedJwks.keys;
  }

  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`Access signing keys returned ${response.status}`);
  const data = await response.json();
  if (!Array.isArray(data.keys)) throw new Error("Access signing keys response was invalid");

  cachedJwks = { teamDomain, keys: data.keys, expiresAt: now + 60 * 60 * 1000 };
  return data.keys;
}

async function isAuthorized(request, env) {
  if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
    throw new Error("Cloudflare Access is not configured");
  }

  const teamDomain = env.CF_ACCESS_TEAM_DOMAIN.replace(/^https:\/\//, "").replace(/\/+$/, "");
  if (!/^[a-z0-9.-]+\.cloudflareaccess\.com$/i.test(teamDomain)) {
    throw new Error("Cloudflare Access team domain is invalid");
  }

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return false;

  const parts = token.split(".");
  if (parts.length !== 3) return false;

  let header;
  let payload;
  try {
    header = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[1])));
  } catch {
    return false;
  }

  if (header.alg !== "RS256" || typeof header.kid !== "string") return false;
  if (payload.iss !== `https://${teamDomain}`) return false;
  if (typeof payload.exp !== "number" || payload.exp <= Date.now() / 1000) return false;
  if (typeof payload.nbf === "number" && payload.nbf > Date.now() / 1000) return false;
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  const expectedAudiences = env.CF_ACCESS_AUD.split(",").map(value => value.trim()).filter(Boolean);
  if (!expectedAudiences.length || !audiences.some(audience => expectedAudiences.includes(audience))) {
    return false;
  }

  const keys = await getJwks(teamDomain);
  const jwk = keys.find(key => key.kid === header.kid);
  if (!jwk) return false;

  const publicKey = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  const signedData = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    decodeBase64Url(parts[2]),
    signedData
  );
}

async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET_KEY || !env.TURNSTILE_SITE_KEY) {
    return { ok: false, error: "Das Anfrageformular ist noch nicht aktiviert." };
  }
  if (typeof token !== "string" || token.length === 0 || token.length > 2048) {
    return { ok: false, error: "Bitte die Sicherheitsprüfung abschließen." };
  }

  const body = new URLSearchParams({
    secret: env.TURNSTILE_SECRET_KEY,
    response: token
  });
  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body
  });
  if (!response.ok) throw new Error(`Turnstile verification returned ${response.status}`);
  const result = await response.json();
  return result.success
    ? { ok: true }
    : { ok: false, error: "Die Sicherheitsprüfung war nicht erfolgreich. Bitte erneut versuchen." };
}

function contentInput(body) {
  const language = languages.has(body.language) ? body.language : null;
  const kind = contentKinds.has(body.kind) ? body.kind : null;
  const status = contentStatuses.has(body.status) ? body.status : null;
  const title = text(body.title, 180, true);
  const summary = text(body.summary, 500, true);
  const articleBody = text(body.body ?? "", 20000);
  const url = text(body.url ?? "", 2048);
  const safeUrl = kind === "video"
    ? url && validVideoUrl(url)
    : url === "" ? "" : null;

  if (!language || !kind || !status || !title || !summary || articleBody === null ||
      safeUrl === null || (kind === "video" && safeUrl === "")) {
    return null;
  }

  return { language, kind, status, title, summary, body: articleBody, url: safeUrl };
}

async function handleInquiry(request, env) {
  if (!inquiriesReady(env)) {
    return inputError("Das Anfrageformular ist noch nicht aktiviert.", 503);
  }
  const data = await readJson(request);
  if (!data || typeof data !== "object") return inputError("Ungültige Anfrage.");
  if (text(data.website, 200)) return json({ ok: true });

  const name = text(data.name, 100, true);
  const email = text(data.email, 254, true);
  const topic = inquiryTopics.has(data.topic) ? data.topic : null;
  const message = text(data.message, 5000, true);
  if (!name || !email || !emailPattern.test(email) || !topic || !message) {
    return inputError("Bitte prüfe deine Angaben.");
  }
  if (data.privacy !== true) return inputError("Bitte bestätige den Datenschutzhinweis.");

  const verification = await verifyTurnstile(data.turnstileToken, request, env);
  if (!verification.ok) return inputError(verification.error, 400);

  const topicLabels = {
    beratung: "Beratung",
    austausch: "Austausch",
    veranstaltung: "Veranstaltung",
    film: "Filmprojekt",
    datenschutz: "Datenschutz",
    sonstiges: "Sonstiges"
  };
  try {
    await env.INQUIRY_EMAIL.send({
      from: env.INQUIRY_FROM_EMAIL,
      to: inquiryRecipients(env),
      replyTo: email,
      subject: "Neue Anfrage über hawo-abdulle.com",
      text: [
        "Neue Anfrage über hawo-abdulle.com",
        "",
        `Name: ${name}`,
        `E-Mail: ${email}`,
        `Thema: ${topicLabels[topic]}`,
        "",
        "Nachricht:",
        message
      ].join("\n")
    });
  } catch (error) {
    console.error("Inquiry notification failed:", error?.code || error?.message || "unknown error");
    return inputError("Die Anfrage konnte nicht zugestellt werden. Bitte versuche es später erneut.", 502);
  }

  await env.DB.prepare(
    "INSERT INTO inquiries (name, email, topic, message) VALUES (?, ?, ?, ?)"
  ).bind(name, email, topic, message).run();
  return json({ ok: true }, 201);
}

async function handleAdmin(request, env, pathname) {
  if (!await isAuthorized(request, env)) return inputError("Anmeldung erforderlich.", 401);

  if (pathname === "/api/admin/inquiries" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, name, email, topic, message, status, created_at FROM inquiries ORDER BY created_at DESC, id DESC"
    ).all();
    return json({ items: results });
  }

  if (pathname === "/api/admin/content" && request.method === "GET") {
    const { results } = await env.DB.prepare(
      "SELECT id, language, kind, title, summary, body, url, status, created_at, updated_at, published_at FROM content ORDER BY updated_at DESC, id DESC"
    ).all();
    return json({ items: results });
  }

  const inquiryMatch = pathname.match(/^\/api\/admin\/inquiries\/(\d+)$/);
  if (inquiryMatch && request.method === "PATCH") {
    const data = await readJson(request);
    if (!data || !inquiryStatuses.has(data.status)) return inputError("Ungültiger Anfrage-Status.");
    const result = await env.DB.prepare(
      "UPDATE inquiries SET status = ?, closed_at = CASE WHEN ? = 'closed' THEN COALESCE(closed_at, CURRENT_TIMESTAMP) ELSE NULL END WHERE id = ?"
    ).bind(data.status, data.status, Number(inquiryMatch[1])).run();
    if (!result.meta.changes) return inputError("Anfrage nicht gefunden.", 404);
    return json({ ok: true });
  }
  if (inquiryMatch && request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM inquiries WHERE id = ?")
      .bind(Number(inquiryMatch[1])).run();
    if (!result.meta.changes) return inputError("Anfrage nicht gefunden.", 404);
    return json({ ok: true });
  }

  const contentMatch = pathname.match(/^\/api\/admin\/content\/(\d+)$/);
  if (pathname === "/api/admin/content" && request.method === "POST") {
    const data = await readJson(request);
    const item = data && contentInput(data);
    if (!item) return inputError("Bitte prüfe Sprache, Typ, Titel, Kurzbeschreibung und Video-Link.");
    const result = await env.DB.prepare(
      "INSERT INTO content (language, kind, title, summary, body, url, status, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'published' THEN CURRENT_TIMESTAMP ELSE NULL END)"
    ).bind(item.language, item.kind, item.title, item.summary, item.body, item.url, item.status, item.status).run();
    return json({ id: result.meta.last_row_id }, 201);
  }
  if (contentMatch && request.method === "PUT") {
    const data = await readJson(request);
    const item = data && contentInput(data);
    if (!item) return inputError("Bitte prüfe Sprache, Typ, Titel, Kurzbeschreibung und Video-Link.");
    const result = await env.DB.prepare(
      "UPDATE content SET language = ?, kind = ?, title = ?, summary = ?, body = ?, url = ?, status = ?, updated_at = CURRENT_TIMESTAMP, published_at = CASE WHEN ? = 'published' THEN COALESCE(published_at, CURRENT_TIMESTAMP) ELSE NULL END WHERE id = ?"
    ).bind(item.language, item.kind, item.title, item.summary, item.body, item.url, item.status, item.status, Number(contentMatch[1])).run();
    if (!result.meta.changes) return inputError("Inhalt nicht gefunden.", 404);
    return json({ ok: true });
  }
  if (contentMatch && request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM content WHERE id = ?")
      .bind(Number(contentMatch[1])).run();
    if (!result.meta.changes) return inputError("Inhalt nicht gefunden.", 404);
    return json({ ok: true });
  }

  return inputError("Endpunkt nicht gefunden.", 404);
}

export default {
  async scheduled(controller, env) {
    const result = await env.DB.prepare(
      "DELETE FROM inquiries WHERE status = 'closed' AND closed_at IS NOT NULL AND closed_at <= datetime('now', '-180 days')"
    ).run();
    console.info(`Deleted ${result.meta.changes} expired inquiries.`);
  },

  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    try {
      if (pathname === "/api/config" && request.method === "GET") {
        return json({
          inquiriesEnabled: inquiriesReady(env),
          turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? ""
        });
      }
      if (pathname === "/api/inquiries" && request.method === "POST") {
        return handleInquiry(request, env);
      }
      if (pathname === "/api/content" && request.method === "GET") {
        const language = new URL(request.url).searchParams.get("language");
        if (!languages.has(language)) return inputError("Ungültige Sprache.");
        const { results } = await env.DB.prepare(
          "SELECT id, language, kind, title, summary, body, url, published_at FROM content WHERE status = 'published' AND language = ? ORDER BY published_at DESC, id DESC"
        ).bind(language).all();
        return json({ items: results });
      }
      if (pathname.startsWith("/api/admin/")) {
        return await handleAdmin(request, env, pathname);
      }
      if (pathname.startsWith("/api/")) return inputError("Endpunkt nicht gefunden.", 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error("CMS request failed:", error);
      return inputError("Interner Fehler. Bitte später erneut versuchen.", 500);
    }
  }
};
