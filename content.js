const contentSection = document.querySelector("[data-posts]");

if (contentSection) {
  const section = contentSection.closest("[data-language]");
  const language = section.dataset.language;
  const emptyMessage = section.querySelector("[data-empty]");

  fetch(`/api/content?language=${encodeURIComponent(language)}`)
    .then(response => {
      if (!response.ok) throw new Error("Content could not be loaded");
      return response.json();
    })
    .then(({ items }) => {
      if (!Array.isArray(items) || items.length === 0) {
        emptyMessage.hidden = false;
        return;
      }

      for (const item of items) {
        const card = document.createElement("article");
        card.className = "content-card";

        const type = document.createElement("p");
        type.className = "eyebrow";
        type.textContent = item.kind === "video"
          ? (language === "de" ? "Video" : "Video")
          : (language === "de" ? "Artikel" : "Article");

        const title = document.createElement("h3");
        title.textContent = item.title;

        const summary = document.createElement("p");
        summary.textContent = item.summary;

        card.append(type, title, summary);

        if (item.body) {
          const body = document.createElement("p");
          body.textContent = item.body;
          card.append(body);
        }

        if (item.kind === "video" && item.url) {
          const link = document.createElement("a");
          link.className = "text-link";
          link.href = item.url;
          link.target = "_blank";
          link.rel = "noopener noreferrer";
          link.textContent = language === "de" ? "Video ansehen ↗" : "Watch video ↗";
          card.append(link);
        }

        contentSection.append(card);
      }
    })
    .catch(() => {
      emptyMessage.hidden = false;
      emptyMessage.textContent = language === "de"
        ? "Beiträge können gerade nicht geladen werden."
        : "Posts are currently unavailable.";
    });
}
