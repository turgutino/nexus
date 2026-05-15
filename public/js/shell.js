(function () {
  const paths = {
    home: "/index.html",
    about: "/about.html",
    services: "/services.html",
    contact: "/contact.html",
    team: "/team.html",
    admin: "/admin/",
  };

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
      const r = await fetch("/api/public/site");
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

  async function initShell() {
    const page = document.body.getAttribute("data-page") || "";
    const site = await fetchSiteMini();
    if (site) {
      setText("[data-bind='company-name']", site.companyName);
      const foot = document.querySelector("[data-bind='footer-tagline']");
      if (foot) foot.textContent = site.footerTagline;
    }

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
      if (
        (key === "home" && (normalized === "/" || normalized.endsWith("index.html"))) ||
        (key !== "home" && normalized.endsWith(t))
      ) {
        a.classList.add("active");
      }
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

  window.SiteShell = { initShell, iconFor, fetchSiteMini };
})();
