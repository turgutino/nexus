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

  async function applySeo() {
    let path = window.location.pathname || "/";
    if (!path.startsWith("/")) path = "/" + path;
    if (path.endsWith("/") && path.length > 1) path = path.slice(0, -1);
    if (path === "" || path === "/") path = "/index.html";

    const sp = new URLSearchParams(window.location.search);
    const postSlug = sp.get("slug");

    if (path.toLowerCase().includes("post.html") && postSlug) {
      try {
        const r = await fetch("/api/public/blog/posts/" + encodeURIComponent(postSlug));
        const j = await r.json();
        if (j.ok && j.post) {
          const p = j.post;
          if (p.metaTitle) document.title = p.metaTitle;
          else if (p.title) document.title = p.title + " — Blog";
          setMeta("description", p.metaDescription || p.excerpt || "");
          setMeta("keywords", p.metaKeywords || "");
        }
      } catch {
        /* keep static title */
      }
      return;
    }

    if (path.toLowerCase().includes("project.html") && postSlug) {
      try {
        const r = await fetch("/api/public/projects/" + encodeURIComponent(postSlug));
        const j = await r.json();
        if (j.ok && j.project) {
          const p = j.project;
          document.title = p.title + " — Projects";
          setMeta("description", p.shortDesc || "");
        }
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      const r = await fetch("/api/public/seo?path=" + encodeURIComponent(path));
      const j = await r.json();
      if (j.ok && j.seo) {
        if (j.seo.title) document.title = j.seo.title;
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
})();
