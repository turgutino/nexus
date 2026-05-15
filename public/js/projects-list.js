(function () {
  function esc(s) {
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
    const root = document.getElementById("projects-root");
    if (!root) return;
    const r = await fetch("/api/public/projects");
    const j = await r.json();
    if (!j.ok) return;
    root.innerHTML = j.projects
      .map(
        (p) => `
      <article class="service-card">
        <div class="project-badge">${p.kind === "microsaas" ? esc(T("project.kind.microsaas", "Micro-SaaS")) : esc(T("project.kind.project", "Project"))}</div>
        <div class="service-icon" aria-hidden="true">${SiteShell.iconFor("layers")}</div>
        <h3>${esc(p.title)}</h3>
        <p>${esc(p.shortDesc)}</p>
        ${
          p.image
            ? `<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" style="border-radius:var(--radius-sm);width:100%;max-height:160px;object-fit:cover;margin-bottom:0.75rem" />`
            : ""
        }
        ${
          p.linkUrl
            ? `<p><a class="btn btn-ghost sm" href="${esc(p.linkUrl)}" target="_blank" rel="noopener noreferrer">${esc(T("common.live_link", "Live link"))}</a></p>`
            : ""
        }
        <a class="link-arrow" href="/project.html?slug=${encodeURIComponent(p.slug)}">${esc(T("common.overview", "Overview →"))}</a>
      </article>`
      )
      .join("");
  }

  if (window.SiteI18n) {
    window.addEventListener(window.SiteI18n.LOCALE_EVENT, load);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
