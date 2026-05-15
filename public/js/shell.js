(function () {
  const paths = {
    home: "/index.html",
    about: "/about.html",
    services: "/services.html",
    contact: "/contact.html",
    team: "/team.html",
    projects: "/projects.html",
    blog: "/blog.html",
    admin: "/admin/",
  };

  /* Option text avoids flag emoji — many engines (e.g. Windows Chrome) omit emoji inside <option>. */
  const LANG_OPTIONS = [
    { code: "en", label: "EN", name: "English" },
    { code: "tr", label: "TR", name: "Turkish" },
    { code: "az", label: "AZ", name: "Azerbaijani" },
    { code: "ru", label: "RU", name: "Russian" },
    { code: "fr", label: "FR", name: "French" },
    { code: "es", label: "ES", name: "Spanish" },
    { code: "de", label: "DE", name: "German" },
  ];

  function getLocale() {
    return window.SiteI18n ? window.SiteI18n.getLocale() : "en";
  }

  function siteQuery() {
    const loc = getLocale() || "en";
    return "?lang=" + encodeURIComponent(loc);
  }

  function iconFor(name) {
    const n = (name || "").toLowerCase();
    const map = {
      compass: "◎",
      pen: "✎",
      code: "</>",
      layers: "▥",
      default: "◆",
    };
    for (const k of Object.keys(map)) {
      if (n.includes(k)) return map[k];
    }
    return map.default;
  }

  async function fetchSiteMini() {
    try {
      const r = await fetch("/api/public/site" + siteQuery());
      const j = await r.json();
      if (!j.ok) return null;
      return j.site;
    } catch {
      return null;
    }
  }

  function setText(sel, text) {
    document.querySelectorAll(sel).forEach((el) => {
      el.textContent = text;
    });
  }

  function trackLegacyVisitorOnce() {
    try {
      if (
        !window.SiteCookieConsent ||
        typeof window.SiteCookieConsent.allowsAnalytics !== "function" ||
        !window.SiteCookieConsent.allowsAnalytics()
      ) {
        return;
      }
      if (sessionStorage.getItem("visit_tracked")) return;
      sessionStorage.setItem("visit_tracked", "1");
      fetch("/api/public/track-visit", { method: "POST" }).catch(() => {});
    } catch {
      /* private mode */
    }
  }

  function trackPageView() {
    try {
      if (
        !window.SiteCookieConsent ||
        typeof window.SiteCookieConsent.allowsAnalytics !== "function" ||
        !window.SiteCookieConsent.allowsAnalytics()
      ) {
        return;
      }
      const path = (window.location.pathname || "/") + (window.location.search || "");
      const ref = document.referrer || "";
      const send = () => {
        fetch("/api/public/track-page", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: path.slice(0, 500),
            referrer: ref.slice(0, 1000),
          }),
        }).catch(() => {});
      };
      const syncKey = "analytics_cookie_synced";
      if (!sessionStorage.getItem(syncKey)) {
        fetch("/api/public/analytics-consent", { method: "POST", credentials: "include" })
          .then(() => {
            try {
              sessionStorage.setItem(syncKey, "1");
            } catch (_) {
              /* private mode */
            }
            send();
          })
          .catch(() => {});
      } else {
        send();
      }
    } catch {
      /* private mode */
    }
  }

  function applyBindFromSite(site) {
    if (!site) return;
    setText("[data-bind='company-name']", site.companyName);
    const foot = document.querySelector("[data-bind='footer-tagline']");
    if (foot) foot.textContent = site.footerTagline;
  }

  function syncLangSelect() {
    const wrap = document.getElementById("lang-switch");
    const sel = wrap && wrap.querySelector("select.lang-select");
    if (!sel || !window.SiteI18n) return;
    const loc = window.SiteI18n.getLocale();
    if ([...sel.options].some((o) => o.value === loc)) sel.value = loc;
  }

  let headerChromeBound = false;

  function injectLangSwitch(container) {
    if (!container || document.getElementById("lang-switch") || !window.SiteI18n) return;
    const wrap = document.createElement("span");
    wrap.id = "lang-switch";
    wrap.className = "lang-switch";
    const sel = document.createElement("select");
    sel.className = "lang-select";
    sel.setAttribute("aria-label", window.SiteI18n.t("nav.lang", "Language"));
    LANG_OPTIONS.forEach(({ code, label, name }) => {
      const opt = document.createElement("option");
      opt.value = code;
      opt.textContent = label + " — " + name;
      sel.appendChild(opt);
    });
    sel.value = getLocale() || "en";
    sel.addEventListener("change", async () => {
      await window.SiteI18n.setLocaleAndReloadStrings(sel.value);
      sel.setAttribute("aria-label", window.SiteI18n.t("nav.lang", "Language"));
      const site = await fetchSiteMini();
      applyBindFromSite(site);
      if (window.SiteI18n) window.SiteI18n.applyDom(document);
    });
    wrap.appendChild(sel);
    container.insertBefore(wrap, container.firstChild);
  }

  let localeHookInstalled = false;

  async function initShell() {
    if (window.SiteI18n) {
      await window.SiteI18n.ensureReady();
    }
    if (!localeHookInstalled && window.SiteI18n) {
      localeHookInstalled = true;
      window.addEventListener(window.SiteI18n.LOCALE_EVENT, async () => {
        syncLangSelect();
        const site = await fetchSiteMini();
        applyBindFromSite(site);
      });
    }

    trackLegacyVisitorOnce();
    trackPageView();
    const site = await fetchSiteMini();
    applyBindFromSite(site);

    const navCta = document.querySelector(".nav-cta");
    injectLangSwitch(navCta);
    syncLangSelect();

    if (!headerChromeBound) {
      headerChromeBound = true;

      const rawPath = window.location.pathname.replace(/\/+$/, "") || "/";
      const path = rawPath.toLowerCase();
      document.querySelectorAll("[data-nav]").forEach((a) => {
        const key = a.getAttribute("data-nav");
        const target = paths[key] || "/";
        a.setAttribute("href", target.startsWith("/") ? target : `/${target}`);
        const normalized =
          path === "/" || path === "" || path.endsWith("/index.html") || path.endsWith("index.html")
            ? "/"
            : path;
        const t = target.toLowerCase().replace(/^\//, "");

        let match = false;
        if (key === "home" && (normalized === "/" || normalized.endsWith("index.html"))) match = true;
        else if (key !== "home" && normalized.endsWith(t)) match = true;
        else if (
          key === "blog" &&
          (normalized.endsWith("blog.html") || normalized.endsWith("post.html"))
        ) {
          match = true;
        } else if (
          key === "projects" &&
          (normalized.endsWith("projects.html") || normalized.endsWith("project.html"))
        ) {
          match = true;
        } else if (
          key === "services" &&
          (normalized.endsWith("services.html") || normalized.endsWith("service.html"))
        ) {
          match = true;
        }

        a.classList.toggle("active", match);
      });

      const toggle = document.querySelector(".menu-toggle");
      const mobile = document.querySelector(".nav-mobile");
      if (toggle && mobile) {
        toggle.addEventListener("click", () => {
          toggle.classList.toggle("open");
          mobile.classList.toggle("open");
        });
        mobile.querySelectorAll("a").forEach((a) => {
          a.addEventListener("click", () => {
            toggle.classList.remove("open");
            mobile.classList.remove("open");
          });
        });
      }
    }
  }

  window.SiteShell = { initShell, iconFor, fetchSiteMini, siteQuery, getLocale, LANG_OPTIONS };
})();
