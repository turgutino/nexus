(function () {
  function formatDate(value) {
    var d = new Date(value);
    if (isNaN(d.getTime())) return String(value || "");
    var loc = window.SiteI18n ? window.SiteI18n.getLocale() : "en";
    var AZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avqust", "sentyabr", "oktyabr", "noyabr", "dekabr"];
    try {
      var out = new Intl.DateTimeFormat(loc, { dateStyle: "long" }).format(d);
      // Some browsers ship without Azerbaijani date data and print "2026 M09 28".
      if (loc === "az" && /M\d\d/.test(out)) return d.getDate() + " " + AZ_MONTHS[d.getMonth()] + " " + d.getFullYear();
      return out;
    } catch (e) {
      return d.toISOString().slice(0, 10);
    }
  }

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

  function pageLabel(page, total) {
    if (window.SiteI18n) {
      return window.SiteI18n.format(T("blog.page_of", "Page {page} / {total}"), { page, total });
    }
    return "Page " + page + " / " + total;
  }

  function qs() {
    return new URLSearchParams(window.location.search);
  }

  let formSubmitBound = false;

  async function load() {
    await SiteShell.initShell();
    if (window.SiteI18n) window.SiteI18n.applyDom(document);
    const root = document.getElementById("blog-list-root");
    const pag = document.getElementById("blog-pagination");
    const chips = document.getElementById("blog-chips");
    const form = document.getElementById("blog-filter-form");
    const searchInput = document.getElementById("blog-search");
    if (!root || !pag || !chips) return;

    const urlq = qs();
    const page = Math.max(1, Number(urlq.get("page")) || 1);
    const q = (urlq.get("q") || "").trim().slice(0, 80);
    const category = (urlq.get("category") || "").trim().slice(0, 80);

    if (searchInput) searchInput.value = q;

    const catRes = await fetch("/api/public/blog/categories");
    const catJ = await catRes.json();
    if (catJ.ok) {
      const allBtn = `<button type="button" class="chip ${!category ? "active" : ""}" data-cat="">${esc(T("blog.all", "All"))}</button>`;
      const rest = catJ.categories
        .map(
          (c) =>
            `<button type="button" class="chip ${category === c.slug ? "active" : ""}" data-cat="${esc(c.slug)}">${esc(c.name)}</button>`
        )
        .join("");
      chips.innerHTML = allBtn + rest;
      chips.querySelectorAll(".chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          const slug = btn.getAttribute("data-cat") || "";
          const p = new URLSearchParams();
          if (q) p.set("q", q);
          if (slug) p.set("category", slug);
          p.set("page", "1");
          window.location.href = "/blog.html?" + p.toString();
        });
      });
    }

    const listUrl = `/api/public/blog/posts?limit=6&page=${page}&q=${encodeURIComponent(q)}&category=${encodeURIComponent(category)}`;
    const r = await fetch(listUrl);
    const j = await r.json();
    if (!j.ok) {
      root.innerHTML = "<p class=\"lead\">" + esc(T("blog.load_error", "Could not load posts.")) + "</p>";
      return;
    }

    if (!j.posts.length) {
      root.innerHTML = "<p class=\"lead\">" + esc(T("blog.no_posts", "No posts match your filters.")) + "</p>";
      pag.innerHTML = "";
      return;
    }

    root.innerHTML = `
      <div class="card-grid cols-2">
        ${j.posts
          .map(
            (p) => `
          <article class="service-card">
            <p class="post-meta">${esc(p.categoryName)} · ${esc(formatDate(p.publishedAt))} · ${p.viewCount} ${esc(T("blog.views", "views"))}</p>
            <h3 style="margin:0 0 0.5rem">${esc(p.title)}</h3>
            <p style="color:var(--muted);flex:1">${esc(p.excerpt)}</p>
            <a class="link-arrow" href="/post.html?slug=${encodeURIComponent(p.slug)}">${esc(T("common.read", "Read →"))}</a>
          </article>`
          )
          .join("")}
      </div>`;

    const total = j.totalPages || 1;
    const parts = [];
    if (page > 1) {
      const prev = new URLSearchParams();
      if (q) prev.set("q", q);
      if (category) prev.set("category", category);
      prev.set("page", String(page - 1));
      parts.push(`<a class="btn btn-ghost sm" href="/blog.html?${prev.toString()}">${esc(T("blog.previous", "Previous"))}</a>`);
    } else {
      parts.push(`<button type="button" class="btn btn-ghost sm" disabled>${esc(T("blog.previous", "Previous"))}</button>`);
    }
    parts.push(`<span style="color:var(--muted);align-self:center">${esc(pageLabel(page, total))}</span>`);
    if (page < total) {
      const next = new URLSearchParams();
      if (q) next.set("q", q);
      if (category) next.set("category", category);
      next.set("page", String(page + 1));
      parts.push(`<a class="btn btn-ghost sm" href="/blog.html?${next.toString()}">${esc(T("blog.next", "Next"))}</a>`);
    } else {
      parts.push(`<button type="button" class="btn btn-ghost sm" disabled>${esc(T("blog.next", "Next"))}</button>`);
    }
    pag.innerHTML = parts.join("");

    if (form && searchInput && !formSubmitBound) {
      formSubmitBound = true;
      form.addEventListener("submit", (e) => {
        e.preventDefault();
        const p = new URLSearchParams();
        const v = searchInput.value.trim();
        if (v) p.set("q", v);
        if (category) p.set("category", category);
        p.set("page", "1");
        window.location.href = "/blog.html?" + p.toString();
      });
    }
  }

  if (window.SiteI18n) {
    window.addEventListener(window.SiteI18n.LOCALE_EVENT, load);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
