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

  function qs(name) {
    return new URLSearchParams(window.location.search).get(name);
  }

  async function load() {
    await SiteShell.initShell();
    if (window.SiteI18n) window.SiteI18n.applyDom(document);
    const root = document.getElementById("service-detail");
    const slug = qs("slug");
    if (!root || !slug) {
      if (root) {
        root.innerHTML =
          `<p class="lead">${escapeHtml(T("service.missing", "Missing service."))} <a href="/services.html">${escapeHtml(T("service.back", "Back to services"))}</a></p>`;
      }
      return;
    }
    const r = await fetch("/api/public/services/" + encodeURIComponent(slug));
    const j = await r.json();
    if (!j.ok) {
      root.innerHTML =
        `<p class="lead">${escapeHtml(T("service.not_found", "Not found."))} <a href="/services.html">${escapeHtml(T("service.back", "Back to services"))}</a></p>`;
      return;
    }
    const s = j.service;
    document.title = s.title + " — " + (window.SiteI18n ? window.SiteI18n.t("services.page_title", "Services") : "Services");
    const heroH1 = document.querySelector("main .page-hero h1");
    if (heroH1) heroH1.textContent = s.title;
    root.innerHTML = `
      <div class="contact-card" style="margin-top:1rem">
        <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-start">
          <div class="service-icon" style="flex-shrink:0">${SiteShell.iconFor(s.icon)}</div>
          <div style="flex:1;min-width:220px">
            <h2 style="margin:0 0 0.5rem">${escapeHtml(s.title)}</h2>
            <p style="color:var(--muted);margin:0 0 1rem">${escapeHtml(s.shortDesc)}</p>
            ${
              s.image
                ? `<img src="${escapeHtml(s.image)}" alt="" style="border-radius:var(--radius-sm);max-height:260px;width:auto;margin-bottom:1rem" />`
                : ""
            }
            <div class="prose">
              ${String(s.longDesc || "")
                .split("\n\n")
                .filter(Boolean)
                .map((p) => `<p>${escapeHtml(p)}</p>`)
                .join("")}
            </div>
            <a class="btn btn-primary" style="margin-top:1rem" href="/contact.html">${escapeHtml(T("service.discuss", "Discuss this engagement"))}</a>
          </div>
        </div>
      </div>`;
  }

  if (window.SiteI18n) {
    window.addEventListener(window.SiteI18n.LOCALE_EVENT, load);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
