const statusMessage = document.querySelector("[data-status]");
const inquiryList = document.querySelector("[data-inquiries]");
const contentList = document.querySelector("[data-content-list]");
const contentForm = document.querySelector("[data-content-form]");
const contentEndpoint = "/api/admin/content";
const inquiryEndpoint = "/api/admin/inquiries";
let contentItems = [];

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set("content-type", "application/json");
  const response = await fetch(path, { ...options, headers, credentials: "same-origin" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || `Request failed (${response.status})`);
  return result;
}

function node(tag, className, value) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = value;
  return element;
}

function button(label, className, action, id) {
  const element = node("button", `cms-button ${className || ""}`, label);
  element.type = "button";
  element.dataset.action = action;
  element.dataset.id = id;
  return element;
}

function addEmptyMessage(container, text) {
  if (!container.childElementCount) container.append(node("p", "cms-empty", text));
}

function formatDate(value) {
  const date = new Date(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString("de-DE");
}

async function loadInquiries() {
  const { items } = await api(inquiryEndpoint);
  inquiryList.replaceChildren();
  for (const item of items) {
    const card = node("article", "cms-card");
    const heading = node("h3", "", item.name);
    const metadata = node("p", "cms-card-meta", `${item.email} · ${item.topic} · ${formatDate(item.created_at)}`);
    const body = node("p", "", item.message);
    const actions = node("div", "cms-card-actions");
    const label = node("label", "", "Status");
    const select = document.createElement("select");
    select.setAttribute("aria-label", `Status für Anfrage von ${item.name}`);
    select.dataset.action = "inquiry-status";
    select.dataset.id = item.id;
    for (const [value, text] of [
      ["new", "Neu"],
      ["in_progress", "In Bearbeitung"],
      ["answered", "Beantwortet"],
      ["closed", "Abgeschlossen"]
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      option.selected = value === item.status;
      select.append(option);
    }
    label.append(select);
    actions.append(label, button("Löschen", "cms-button-danger", "delete-inquiry", item.id));
    card.append(heading, metadata, body, actions);
    inquiryList.append(card);
  }
  addEmptyMessage(inquiryList, "Noch keine Anfragen vorhanden.");
}

async function loadContent() {
  const { items } = await api(contentEndpoint);
  contentItems = items;
  contentList.replaceChildren();
  for (const item of items) {
    const card = node("article", "cms-card");
    const heading = node("h3", "", item.title);
    const metadata = node(
      "p",
      "cms-card-meta",
      `${item.language.toUpperCase()} · ${item.kind === "video" ? "Video" : "Artikel"} · ${item.status === "published" ? "Veröffentlicht" : "Entwurf"}`
    );
    const summary = node("p", "", item.summary);
    const actions = node("div", "cms-card-actions");
    actions.append(
      button("Bearbeiten", "", "edit-content", item.id),
      button("Löschen", "cms-button-danger", "delete-content", item.id)
    );
    card.append(heading, metadata, summary, actions);
    contentList.append(card);
  }
  addEmptyMessage(contentList, "Noch keine Inhalte angelegt.");
}

async function refreshAll() {
  statusMessage.textContent = "Lade Inhalte …";
  try {
    await Promise.all([loadInquiries(), loadContent()]);
    statusMessage.textContent = "";
  } catch (error) {
    statusMessage.textContent = error.message;
  }
}

function clearContentForm() {
  contentForm.reset();
  contentForm.elements.id.value = "";
  contentForm.elements.language.value = "de";
  contentForm.elements.kind.value = "article";
  contentForm.elements.status.value = "draft";
}

document.querySelectorAll("[data-tab]").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("[data-tab]").forEach(item => {
      const active = item === tab;
      item.classList.toggle("is-active", active);
      item.setAttribute("aria-pressed", String(active));
    });
    document.querySelectorAll("[data-panel]").forEach(panel => {
      panel.hidden = panel.dataset.panel !== tab.dataset.tab;
    });
  });
});

document.querySelector("[data-refresh-inquiries]").addEventListener("click", () => {
  loadInquiries().catch(error => { statusMessage.textContent = error.message; });
});
document.querySelector("[data-refresh-content]").addEventListener("click", () => {
  loadContent().catch(error => { statusMessage.textContent = error.message; });
});
document.querySelector("[data-clear-form]").addEventListener("click", clearContentForm);

inquiryList.addEventListener("change", async event => {
  const select = event.target.closest('[data-action="inquiry-status"]');
  if (!select) return;
  try {
    await api(`${inquiryEndpoint}/${select.dataset.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: select.value })
    });
    statusMessage.textContent = "Anfragestatus aktualisiert.";
  } catch (error) {
    statusMessage.textContent = error.message;
    loadInquiries().catch(loadError => { statusMessage.textContent = loadError.message; });
  }
});

document.querySelector(".cms-main").addEventListener("click", async event => {
  const control = event.target.closest("[data-action]");
  if (!control) return;
  const { action, id } = control.dataset;

  if (action === "edit-content") {
    const item = contentItems.find(entry => String(entry.id) === id);
    if (!item) return;
    for (const key of ["id", "language", "kind", "title", "summary", "body", "url", "status"]) {
      contentForm.elements[key].value = item[key] ?? "";
    }
    contentForm.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  if (action === "delete-inquiry" || action === "delete-content") {
    if (!window.confirm("Diesen Eintrag endgültig löschen?")) return;
    const endpoint = action === "delete-inquiry" ? inquiryEndpoint : contentEndpoint;
    try {
      await api(`${endpoint}/${id}`, { method: "DELETE" });
      statusMessage.textContent = "Eintrag gelöscht.";
      await (action === "delete-inquiry" ? loadInquiries() : loadContent());
    } catch (error) {
      statusMessage.textContent = error.message;
    }
  }
});

contentForm.addEventListener("submit", async event => {
  event.preventDefault();
  const formData = new FormData(contentForm);
  const id = formData.get("id");
  const payload = Object.fromEntries(formData.entries());
  delete payload.id;
  if (payload.kind !== "video") payload.url = "";
  try {
    await api(id ? `${contentEndpoint}/${id}` : contentEndpoint, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(payload)
    });
    statusMessage.textContent = "Inhalt gespeichert.";
    clearContentForm();
    await loadContent();
  } catch (error) {
    statusMessage.textContent = error.message;
  }
});

refreshAll();
