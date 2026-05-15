(function () {
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function load() {
    await SiteShell.initShell();
    const root = document.getElementById("services-list");
    if (!root) return;
    const r = await fetch("/api/public/services");
    const j = await r.json();
    if (!j.ok) return;
    root.innerHTML = `
      <div class="card-grid cols-3">
        ${j.services
          .map(
            (s) => `
          <article class="service-card">
            <div class="service-icon">${SiteShell.iconFor(s.icon)}</div>
            <h3>${escapeHtml(s.title)}</h3>
            <p>${escapeHtml(s.shortDesc)}</p>
            <a class="link-arrow" href="/service.html?slug=${encodeURIComponent(s.slug)}">Open detail →</a>
          </article>`
          )
          .join("")}
      </div>`;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
