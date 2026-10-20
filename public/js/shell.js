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

  // Flag file per locale (English is shown with the American flag).
  const FLAG_FILES = { en: "us", tr: "tr", az: "az", ru: "ru", fr: "fr", es: "es", de: "de" };

  function flagImg(code) {
    const img = document.createElement("img");
    img.className = "lang-flag";
    img.src = "/img/flags/" + (FLAG_FILES[code] || "us") + ".svg";
    img.alt = "";
    img.width = 28;
    img.height = 28;
    img.draggable = false;
    return img;
  }

  function langName(code) {
    const hit = LANG_OPTIONS.find((o) => o.code === code);
    return hit ? hit.name : code;
  }

  function syncLangSelect() {
    const wrap = document.getElementById("lang-switch");
    if (!wrap || !window.SiteI18n) return;
    const loc = window.SiteI18n.getLocale();
    const btn = wrap.querySelector(".lang-btn");
    if (btn) {
      const label = window.SiteI18n.t("nav.lang", "Language") + ": " + langName(loc);
      btn.setAttribute("aria-label", label);
      btn.setAttribute("title", langName(loc));
      const img = btn.querySelector("img");
      if (img) img.src = "/img/flags/" + (FLAG_FILES[loc] || "us") + ".svg";
    }
    wrap.querySelectorAll(".lang-option").forEach((o) => {
      const on = o.getAttribute("data-code") === loc;
      o.setAttribute("aria-selected", on ? "true" : "false");
      o.classList.toggle("active", on);
    });
  }

  let headerChromeBound = false;

  // Language picker: a round flag button that opens a small menu of round flags (no text).
  function injectLangSwitch(container) {
    if (!container || document.getElementById("lang-switch") || !window.SiteI18n) return;
    const wrap = document.createElement("span");
    wrap.id = "lang-switch";
    wrap.className = "lang-switch";

    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lang-btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.appendChild(flagImg(getLocale() || "en"));

    const menu = document.createElement("div");
    menu.className = "lang-menu";
    menu.setAttribute("role", "listbox");
    menu.hidden = true;

    LANG_OPTIONS.forEach(({ code, name }) => {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "lang-option";
      opt.setAttribute("role", "option");
      opt.setAttribute("data-code", code);
      opt.setAttribute("aria-label", name);
      opt.setAttribute("title", name);
      opt.appendChild(flagImg(code));
      menu.appendChild(opt);
    });

    function setOpen(open) {
      menu.hidden = !open;
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }

    btn.addEventListener("click", () => {
      const open = menu.hidden;
      setOpen(open);
      if (open) {
        const cur = menu.querySelector(".lang-option.active") || menu.querySelector(".lang-option");
        if (cur) cur.focus();
      }
    });

    menu.addEventListener("click", async (e) => {
      const opt = e.target.closest(".lang-option");
      if (!opt) return;
      const code = opt.getAttribute("data-code");
      setOpen(false);
      btn.focus();
      await window.SiteI18n.setLocaleAndReloadStrings(code);
      syncLangSelect();
      const site = await fetchSiteMini();
      applyBindFromSite(site);
      if (window.SiteI18n) window.SiteI18n.applyDom(document);
    });

    wrap.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !menu.hidden) {
        setOpen(false);
        btn.focus();
        return;
      }
      if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !menu.hidden) {
        const items = [...menu.querySelectorAll(".lang-option")];
        const i = items.indexOf(document.activeElement);
        const next = e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
        items[next].focus();
        e.preventDefault();
      }
    });

    document.addEventListener("click", (e) => {
      if (!wrap.contains(e.target)) setOpen(false);
    });

    wrap.appendChild(btn);
    wrap.appendChild(menu);
    container.insertBefore(wrap, container.firstChild);
    syncLangSelect();
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
