(function () {
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function T(k, fb) {
    return window.SiteI18n ? window.SiteI18n.t(k, fb) : fb || k;
  }

  function attr(s) {
    return escapeHtml(String(s ?? ""));
  }

  function mediaOrPlaceholder(url, label, style) {
    if (url) {
      return `<img src="${attr(url)}" alt="" loading="lazy" style="${style || ""}" />`;
    }
    return `<div class="hero-card-placeholder" style="${style || ""}">${escapeHtml(label)}</div>`;
  }

  function avatarOrPlaceholder(url) {
    if (url) return `<img src="${attr(url)}" alt="" loading="lazy" />`;
    return `<div style="display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:2rem">◆</div>`;
  }

  async function load() {
    const rootHero = document.getElementById("home-hero");
    const rootBanners = document.getElementById("home-banners");
    const rootServices = document.getElementById("home-services");
    const rootAbout = document.getElementById("home-about");
    const rootTeam = document.getElementById("home-team");
    if (!rootHero) return;

    const r = await fetch("/api/public/site" + SiteShell.siteQuery());
    const j = await r.json();
    if (!j.ok) return;

    const { site, services, teamPreview } = j;

    const h1 =
      site.hero.title.indexOf(" ") === -1
        ? `<span>${escapeHtml(site.hero.title)}</span>`
        : (() => {
            const parts = site.hero.title.split(" ");
            const last = parts.pop();
            return `${escapeHtml(parts.join(" "))} <span>${escapeHtml(last)}</span>`;
          })();

    rootHero.innerHTML = `
      <div class="container hero-grid">
        <div>
          <div class="hero-kicker"><i></i> ${escapeHtml(T("hero.kicker", "Digital studio · Product & web"))}</div>
          <h1>${h1}</h1>
          <p class="hero-lead">${escapeHtml(site.hero.subtitle)}</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="${attr(site.hero.ctaPrimary.link)}">${escapeHtml(site.hero.ctaPrimary.text)}</a>
            <a class="btn btn-ghost" href="${attr(site.hero.ctaSecondary.link)}">${escapeHtml(site.hero.ctaSecondary.text)}</a>
          </div>
          <div class="hero-meta">
            <div><strong>${escapeHtml(T("hero.stat_48h", "48h"))}</strong> ${escapeHtml(T("hero.meta_response", "avg. response"))}</div>
            <div><strong>${escapeHtml(T("hero.stat_global", "Global"))}</strong> ${escapeHtml(T("hero.meta_remote", "remote-first"))}</div>
            <div>${escapeHtml(T("hero.meta_a11y", "Accessible by default"))}</div>
          </div>
        </div>
        <div class="hero-visual">
          <div class="hero-glow" aria-hidden="true"></div>
          <div class="hero-card">
            <div class="media">
              ${mediaOrPlaceholder(site.hero.image, "")}
            </div>
          </div>
        </div>
      </div>`;

    if (rootBanners && site.banners.length) {
      rootBanners.innerHTML = `
        <div class="container">
          <div class="section-head">
            <h2>${escapeHtml(T("home.banners_title", "Highlights"))}</h2>
            <p>${escapeHtml(T("home.banners_subtitle", "Curated snapshots of what we ship for partners."))}</p>
          </div>
          <div class="banner-strip">
            ${site.banners
              .map(
                (b) => `
              <article class="banner-card">
                <div class="visual">${mediaOrPlaceholder(b.image, "", "min-height:140px")}</div>
                <div class="banner-body">
                  <h3>${escapeHtml(b.title)}</h3>
                  <p>${escapeHtml(b.subtitle)}</p>
                  ${
                    b.link
                      ? `<a class="btn btn-ghost" style="margin-top:0.5rem;align-self:flex-start" href="${attr(b.link)}">${escapeHtml(b.linkText || T("common.learn_more", "Learn more"))}</a>`
                      : ""
                  }
                </div>
              </article>`
              )
              .join("")}
          </div>
        </div>`;
    }

    if (rootServices) {
      const featured = (services || []).filter((s) => s.featured).slice(0, 6);
      const list = featured.length > 0 ? featured : (services || []).slice(0, 6);
      rootServices.innerHTML = `
        <div class="container">
          <div class="section-head">
            <h2>${escapeHtml(T("home.services_title", "Services"))}</h2>
            <p>${escapeHtml(T("home.services_subtitle", "Focused capabilities that cover the full product lifecycle."))}</p>
            <a class="btn btn-ghost" href="/services.html">${escapeHtml(T("home.services_all", "All services"))}</a>
          </div>
          <div class="card-grid cols-3">
            ${list
              .map(
                (s) => `
              <article class="service-card">
                <div class="service-icon" aria-hidden="true">${window.SiteShell.iconFor(s.icon)}</div>
                <h3>${escapeHtml(s.title)}</h3>
                <p>${escapeHtml(s.shortDesc)}</p>
                <a class="link-arrow" href="/service.html?slug=${encodeURIComponent(s.slug)}">${escapeHtml(T("common.details", "Details →"))}</a>
              </article>`
              )
              .join("")}
          </div>
        </div>`;
    }

    const rootProj = document.getElementById("home-projects");
    const flags = site.featureFlags || {};
    if (rootProj && flags.showProjects !== false) {
      let plist = (j.projectPreview || []).filter((p) => Number(p.featured));
      if (!plist.length) plist = j.projectPreview || [];
      plist = plist.slice(0, 6);
      if (plist.length) {
        rootProj.innerHTML = `
        <div class="container">
          <div class="section-head">
            <h2>${escapeHtml(site.homeProjectsTitle || T("home.projects_title_fallback", "Projects"))}</h2>
            <p>${escapeHtml(site.homeProjectsIntro || "")}</p>
            <a class="btn btn-ghost" href="/projects.html">${escapeHtml(T("home.projects_all", "All work"))}</a>
          </div>
          <div class="card-grid cols-3">
            ${plist
              .map(
                (p) => `
              <article class="service-card">
                <div class="projects-card-top">
                  <span class="project-badge">${p.kind === "microsaas" ? T("project.kind.microsaas", "Micro-SaaS") : T("project.kind.project", "Project")}</span>
                </div>
                <div class="service-icon" aria-hidden="true">${window.SiteShell.iconFor("layers")}</div>
                <h3>${escapeHtml(p.title)}</h3>
                <p>${escapeHtml(p.shortDesc)}</p>
                ${
                  p.linkUrl
                    ? `<a class="link-arrow" href="${attr(p.linkUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(T("common.visit_link", "Visit link →"))}</a>`
                    : ""
                }
                <a class="link-arrow" href="/project.html?slug=${encodeURIComponent(p.slug)}" style="margin-top:0.25rem;display:inline-block">${escapeHtml(T("common.details", "Details →"))}</a>
              </article>`
              )
              .join("")}
          </div>
        </div>`;
      } else rootProj.innerHTML = "";
    } else if (rootProj) {
      rootProj.innerHTML = "";
    }

    if (rootAbout) {
      rootAbout.innerHTML = `
        <div class="container split-about">
          <div class="visual">
            ${mediaOrPlaceholder(site.homeAbout.image, "")}
          </div>
          <div>
            <h2>${escapeHtml(site.homeAbout.title)}</h2>
            <p>${escapeHtml(site.homeAbout.text)}</p>
            <a class="btn btn-primary" href="/about.html">${escapeHtml(T("home.about_read", "Read our story"))}</a>
          </div>
        </div>`;
    }

    if (rootTeam) {
      const team = teamPreview || [];
      if (!team.length) {
        rootTeam.innerHTML = "";
      } else {
        rootTeam.innerHTML = `
        <div class="container">
          <div class="section-head">
            <h2>${escapeHtml(T("home.team_title", "Team preview"))}</h2>
            <p>${escapeHtml(T("home.team_subtitle", "Senior practitioners embedded with your workflows."))}</p>
            <a class="btn btn-ghost" href="/team.html">${escapeHtml(T("home.team_all", "Full team"))}</a>
          </div>
          <div class="team-grid">
            ${team
              .map(
                (m) => `
              <article class="team-card">
                <div class="team-avatar">${avatarOrPlaceholder(m.image)}</div>
                <div class="body">
                  <h3>${escapeHtml(m.name)}</h3>
                  <p class="role">${escapeHtml(m.role)}</p>
                  <p>${escapeHtml(m.bio)}</p>
                </div>
              </article>`
              )
              .join("")}
          </div>
        </div>`;
      }
    }

    if (window.SiteI18n) window.SiteI18n.applyDom(document);
  }

  async function boot() {
    await SiteShell.initShell();
    await load();
  }

  if (window.SiteI18n) {
    window.addEventListener(window.SiteI18n.LOCALE_EVENT, () => {
      load();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
