// Static-hosting shim. Loaded before every other script on the static (GitHub Pages / Vercel) build.
// The site's pages call "/api/..." endpoints; with no server behind them, this shim answers those GET calls
// from /data/site-data.json (exported from the real database) and handles the few POST calls gracefully.
(function () {
  var BASE = window.__STATIC_BASE__ || "";
  var CONFIG = window.__STATIC_CONFIG__ || {};
  var origFetch = window.fetch.bind(window);
  var dataPromise = null;

  // Path of the current page relative to the hosting base path (e.g. "/Company-site/blog.html" -> "/blog.html").
  window.__pagePath = function () {
    var p = window.location.pathname || "/";
    if (BASE && p.indexOf(BASE) === 0) p = p.slice(BASE.length) || "/";
    return p;
  };

  function loadData() {
    if (!dataPromise) {
      dataPromise = origFetch(BASE + "/data/site-data.json" + (window.__STATIC_VERSION__ ? "?v=" + window.__STATIC_VERSION__ : "")).then(function (r) {
        if (!r.ok) throw new Error("site-data.json not found");
        return r.json();
      });
    }
    return dataPromise;
  }

  function json(body, status) {
    return new Response(JSON.stringify(body), {
      status: status || 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  function notFound() {
    return json({ ok: false, error: "Not found" }, 404);
  }

  function normalizeLang(q) {
    return String(q || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 8);
  }

  function findBySlug(list, slug) {
    for (var i = 0; i < list.length; i++) if (list[i].slug === slug) return list[i];
    return null;
  }

  function postListItem(p) {
    return {
      id: p.id,
      title: p.title,
      slug: p.slug,
      excerpt: p.excerpt,
      publishedAt: p.publishedAt,
      viewCount: p.viewCount,
      categoryName: p.categoryName,
      categorySlug: p.categorySlug,
    };
  }

  function blogPosts(data, q) {
    var limit = Math.min(20, Math.max(1, Number(q.get("limit")) || 6));
    var page = Math.max(1, Number(q.get("page")) || 1);
    var term = String(q.get("q") || "").trim().slice(0, 80).toLowerCase();
    var cat = String(q.get("category") || "").trim().slice(0, 80);
    var posts = data.blogPosts.filter(function (p) {
      if (cat && p.categorySlug !== cat) return false;
      if (!term) return true;
      return (
        String(p.title || "").toLowerCase().indexOf(term) !== -1 ||
        String(p.excerpt || "").toLowerCase().indexOf(term) !== -1 ||
        String(p.body || "").toLowerCase().indexOf(term) !== -1
      );
    });
    var total = posts.length;
    var slice = posts.slice((page - 1) * limit, (page - 1) * limit + limit).map(postListItem);
    return {
      ok: true,
      posts: slice,
      page: page,
      limit: limit,
      totalPages: Math.ceil(total / limit) || 1,
      total: total,
    };
  }

  function seoFor(data, path) {
    var hit = data.seo && data.seo[path];
    if (hit) return { ok: true, seo: hit };
    var any = data.sites[data.defaultLocale] || data.sites[Object.keys(data.sites)[0]];
    var site = (any && any.site) || {};
    return {
      ok: true,
      seo: { title: site.companyName || "", description: String((site.hero && site.hero.subtitle) || "").slice(0, 320), keywords: "" },
    };
  }

  function route(data, path, q) {
    var m;
    if (path === "/api/public/site") {
      var lang = normalizeLang(q.get("lang"));
      return data.sites[lang] || data.sites[data.defaultLocale] || data.sites[Object.keys(data.sites)[0]];
    }
    if ((m = path.match(/^\/api\/translations\/([a-z]+)$/))) {
      var s = data.translations[normalizeLang(m[1])];
      return s ? { ok: true, locale: normalizeLang(m[1]), strings: s } : { ok: false, error: "Unsupported locale", _status: 404 };
    }
    if (path === "/api/public/translations") {
      var loc = normalizeLang(q.get("locale"));
      return { ok: true, locale: loc, strings: data.translations[loc] || {} };
    }
    if (path === "/api/public/services") return { ok: true, services: data.services };
    if ((m = path.match(/^\/api\/public\/services\/(.+)$/))) {
      var svc = findBySlug(data.services, decodeURIComponent(m[1]));
      return svc ? { ok: true, service: svc } : { ok: false, error: "Not found", _status: 404 };
    }
    if (path === "/api/public/projects") {
      var kind = String(q.get("kind") || "").toLowerCase();
      var list = data.projects.filter(function (p) {
        return kind === "project" || kind === "microsaas" ? p.kind === kind : true;
      });
      return { ok: true, projects: list };
    }
    if ((m = path.match(/^\/api\/public\/projects\/(.+)$/))) {
      var prj = findBySlug(data.projects, decodeURIComponent(m[1]));
      return prj ? { ok: true, project: prj } : { ok: false, error: "Not found", _status: 404 };
    }
    if (path === "/api/public/team") return { ok: true, team: data.team };
    if (path === "/api/public/blog/categories") return { ok: true, categories: data.blogCategories };
    if (path === "/api/public/blog/posts") return blogPosts(data, q);
    if ((m = path.match(/^\/api\/public\/blog\/posts\/(.+)$/))) {
      var post = findBySlug(data.blogPosts, decodeURIComponent(m[1]));
      return post ? { ok: true, post: post } : { ok: false, error: "Not found", _status: 404 };
    }
    if (path === "/api/public/seo") {
      var p = String(q.get("path") || "/");
      if (p.charAt(0) !== "/") p = "/" + p;
      return seoFor(data, p);
    }
    if (path === "/api/public/contact-page") return data.contactPage || { ok: true, mapEmbedUrl: "" };
    return { ok: false, error: "Not found", _status: 404 };
  }

  function readFields(body) {
    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch (e) {
        return {};
      }
    }
    var out = {};
    if (body && typeof body.forEach === "function") {
      body.forEach(function (v, k) {
        if (typeof v === "string") out[k] = v;
      });
    }
    return out;
  }

  async function submitContact(init) {
    var fields = readFields(init && init.body);
    // "code" lets the page show the message in the visitor's language.
    if (!CONFIG.contactEndpoint) {
      return json(
        { ok: false, code: "unavailable", email: CONFIG.contactEmail || "", error: "The contact form is not available right now." },
        503
      );
    }
    var payload = Object.assign({}, CONFIG.contactExtraFields || {}, {
      name: fields.name,
      email: fields.email,
      phone: fields.phone || "",
      message: fields.message,
    });
    try {
      var r = await origFetch(CONFIG.contactEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      });
      if (r.ok) return json({ ok: true });
      return json({ ok: false, code: "send", error: "Could not send your message. Please try again later." }, 502);
    } catch (e) {
      return json({ ok: false, code: "send", error: "Could not send your message. Please try again later." }, 502);
    }
  }

  window.fetch = async function (input, init) {
    var url = typeof input === "string" ? input : input && input.url;
    if (!url || url.indexOf("/api/") !== 0) return origFetch(input, init);

    var method = String((init && init.method) || "GET").toUpperCase();
    var u = new URL(url, window.location.origin);

    if (method !== "GET") {
      if (u.pathname === "/api/public/contact") return submitContact(init);
      if (u.pathname.indexOf("/api/public/newsletter/") === 0) {
        return json({ ok: false, error: "Newsletter signup is not available on this site." }, 404);
      }
      // analytics / consent calls: nothing is tracked on the static site
      return json({ ok: true, skipped: true });
    }

    try {
      var data = await loadData();
      var result = route(data, u.pathname, u.searchParams);
      var status = result && result._status ? result._status : 200;
      if (result && result._status) {
        result = Object.assign({}, result);
        delete result._status;
      }
      return json(result, status);
    } catch (e) {
      return json({ ok: false, error: "Site data is not available." }, 503);
    }
  };
})();
