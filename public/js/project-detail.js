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

  function getSlug() {
    return new URLSearchParams(window.location.search).get("slug");
  }

  async function load() {
    await SiteShell.initShell();
    if (window.SiteI18n) window.SiteI18n.applyDom(document);
    const root = document.getElementById("project-detail");
    const slug = getSlug();
    if (!root || !slug) {
      if (root) {
        root.innerHTML =
          "<p class=\"lead\">" +
          esc(T("project.missing", "Missing project.")) +
          ' <a href="/projects.html">' +
          esc(T("project.back", "Work")) +
          "</a></p>";
      }
      return;
    }

    const r = await fetch("/api/public/projects/" + encodeURIComponent(slug));
    const j = await r.json();
    if (!j.ok) {
      root.innerHTML =
        "<p class=\"lead\">" +
        esc(T("project.not_found", "Not found.")) +
        ' <a href="/projects.html">' +
        esc(T("project.back", "Work")) +
        "</a></p>";
      return;
    }

    const p = j.project;
    const heroH1 = document.querySelector("main .page-hero h1");
    if (heroH1) heroH1.textContent = p.title;

    root.innerHTML = `
      <div class="contact-card">
        <p class="project-badge" style="margin-bottom:0.75rem">${p.kind === "microsaas" ? esc(T("project.kind.microsaas", "Micro-SaaS")) : esc(T("project.kind.project", "Project"))}</p>
        <p class="lead" style="color:var(--muted)">${esc(p.shortDesc)}</p>
        ${
          p.image
            ? `<img src="${esc(p.image)}" alt="" loading="lazy" decoding="async" style="border-radius:var(--radius-sm);max-width:100%;max-height:320px;margin:1rem 0" />`
            : ""
        }
        <div class="prose" style="margin-top:1rem">
          ${String(p.longDesc || "")
            .split("\n\n")
            .filter(Boolean)
            .map((para) => `<p>${esc(para)}</p>`)
            .join("")}
        </div>
        ${
          p.linkUrl
            ? `<p style="margin-top:1.25rem"><a class="btn btn-primary" href="${esc(p.linkUrl)}" target="_blank" rel="noopener noreferrer">${esc(T("common.visit_link", "Visit link →"))}</a></p>`
            : ""
        }
        <p style="margin-top:1rem;font-size:0.88rem;color:var(--muted)">${p.viewCount} ${esc(T("blog.views", "views"))}</p>
      </div>`;
  }

  if (window.SiteI18n) {
    window.addEventListener(window.SiteI18n.LOCALE_EVENT, load);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
