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
    const root = document.getElementById("post-root");
    const slug = getSlug();
    if (!root || !slug) {
      if (root) {
        root.innerHTML =
          "<p class=\"lead\">" + esc(T("post.missing", "Missing post.")) + ' <a href="/blog.html">' + esc(T("post.back", "Blog")) + "</a></p>";
      }
      return;
    }

    const r = await fetch("/api/public/blog/posts/" + encodeURIComponent(slug));
    const j = await r.json();
    if (!j.ok) {
      root.innerHTML =
        "<p class=\"lead\">" + esc(T("post.not_found", "Not found.")) + ' <a href="/blog.html">' + esc(T("post.back", "Blog")) + "</a></p>";
      return;
    }

    const p = j.post;
    root.innerHTML = `
      <header>
        <p class="post-meta">${esc(p.categoryName)} · ${esc(p.publishedAt)} · ${p.viewCount} ${esc(T("blog.views", "views"))}</p>
        <h1 style="margin:0 0 1rem;font-size:clamp(1.75rem,3vw,2.25rem);letter-spacing:-0.02em">${esc(p.title)}</h1>
        <p class="lead" style="color:var(--muted)">${esc(p.excerpt)}</p>
      </header>
      <div class="prose" style="margin-top:1.5rem">
        ${String(p.body || "")
          .split("\n\n")
          .filter(Boolean)
          .map((para) => `<p>${esc(para)}</p>`)
          .join("")}
      </div>`;
  }

  if (window.SiteI18n) {
    window.addEventListener(window.SiteI18n.LOCALE_EVENT, load);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
