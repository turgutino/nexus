(function () {
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function T(k, fb) {
    return window.SiteI18n ? window.SiteI18n.t(k, fb) : fb || k;
  }

  async function load() {
    await SiteShell.initShell();
    if (window.SiteI18n) window.SiteI18n.applyDom(document);
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
            <a class="link-arrow" href="/service.html?slug=${encodeURIComponent(s.slug)}">${escapeHtml(T("common.open_detail", "Open detail →"))}</a>
          </article>`
          )
          .join("")}
      </div>`;
  }

  if (window.SiteI18n) {
    window.addEventListener(window.SiteI18n.LOCALE_EVENT, load);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
