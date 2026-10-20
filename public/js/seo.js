(function () {
  function setMeta(name, content) {
    if (!content) return;
    let el = document.querySelector(`meta[name="${name}"]`);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute("name", name);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  }

  function T(k, fb) {
    return window.SiteI18n ? window.SiteI18n.t(k, fb) : fb;
  }

  // Page titles come from the database in one language. For every other language the title is built
  // from the translated UI strings so the browser tab follows the selected language.
  function isTranslated() {
    return !!window.SiteI18n && window.SiteI18n.getLocale() !== "en";
  }

  const PAGE_TITLE_KEYS = {
    "/about.html": "about.page_title", // static:keep
    "/services.html": "services.page_title", // static:keep
    "/projects.html": "projects.page_title", // static:keep
    "/team.html": "team.page_title", // static:keep
    "/blog.html": "blog.page_title", // static:keep
    "/contact.html": "contact.page_title", // static:keep
    "/unsubscribe.html": "unsub.title", // static:keep
    "/confirm.html": "confirm.title", // static:keep
  };

  function translatedPageTitle(path) {
    const company = T("company_name", "");
    if (path === "/index.html") return company + " — " + T("hero.kicker", ""); // static:keep
    const key = PAGE_TITLE_KEYS[path.toLowerCase()];
    return key ? T(key, "") + " — " + company : "";
  }

  async function applySeo() {
    if (window.SiteI18n) await window.SiteI18n.ensureReady();

    let path = window.__pagePath ? window.__pagePath() : window.location.pathname || "/";
    if (!path.startsWith("/")) path = "/" + path;
    if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1);
    if (path === "" || path === "/") path = "/index.html"; // static:keep

    const sp = new URLSearchParams(window.location.search);
    const postSlug = sp.get("slug");
    const lower = path.toLowerCase();

    if (lower.includes("post.html") && postSlug) {
      try {
        const r = await fetch("/api/public/blog/posts/" + encodeURIComponent(postSlug));
        const j = await r.json();
        if (j.ok && j.post) {
          const p = j.post;
          if (isTranslated() && p.title) document.title = p.title + " — " + T("nav.blog", "Blog");
          else if (p.metaTitle) document.title = p.metaTitle;
          else if (p.title) document.title = p.title + " — Blog";
          setMeta("description", p.metaDescription || p.excerpt || "");
          setMeta("keywords", p.metaKeywords || "");
        }
      } catch {
        /* keep static title */
      }
      return;
    }

    if (lower.includes("project.html") && postSlug) {
      try {
        const r = await fetch("/api/public/projects/" + encodeURIComponent(postSlug));
        const j = await r.json();
        if (j.ok && j.project) {
          const p = j.project;
          document.title = p.title + " — " + (isTranslated() ? T("projects.page_title", "Projects") : "Projects");
          setMeta("description", p.shortDesc || "");
        }
      } catch {
        /* ignore */
      }
      return;
    }

    if (lower.includes("service.html") && postSlug && isTranslated()) {
      try {
        const r = await fetch("/api/public/services/" + encodeURIComponent(postSlug));
        const j = await r.json();
        if (j.ok && j.service) document.title = j.service.title + " — " + T("services.page_title", "Services");
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      const r = await fetch("/api/public/seo?path=" + encodeURIComponent(path));
      const j = await r.json();
      if (j.ok && j.seo) {
        const translated = isTranslated() ? translatedPageTitle(path) : "";
        if (translated) document.title = translated;
        else if (j.seo.title) document.title = j.seo.title;
        setMeta("description", j.seo.description || "");
        setMeta("keywords", j.seo.keywords || "");
      }
    } catch {
      /* ignore */
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applySeo);
  } else applySeo();

  if (window.SiteI18n) window.addEventListener(window.SiteI18n.LOCALE_EVENT, applySeo);
})();
