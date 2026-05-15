(function () {
  async function load() {
    const rootHero = document.getElementById("home-hero");
    const rootBanners = document.getElementById("home-banners");
    const rootServices = document.getElementById("home-services");
    const rootAbout = document.getElementById("home-about");
    const rootTeam = document.getElementById("home-team");
    if (!rootHero) return;

    const r = await fetch("/api/public/site");
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
          <div class="hero-kicker"><i></i> Digital studio · Product & web</div>
          <h1>${h1}</h1>
          <p class="hero-lead">${escapeHtml(site.hero.subtitle)}</p>
          <div class="hero-actions">
            <a class="btn btn-primary" href="${attr(site.hero.ctaPrimary.link)}">${escapeHtml(site.hero.ctaPrimary.text)}</a>
            <a class="btn btn-ghost" href="${attr(site.hero.ctaSecondary.link)}">${escapeHtml(site.hero.ctaSecondary.text)}</a>
          </div>
          <div class="hero-meta">
            <div><strong>48h</strong> avg. response</div>
            <div><strong>Global</strong> remote-first</div>
            <div><strong>Accessible</strong> by default</div>
          </div>
        </div>
        <div class="hero-visual">
          <div class="hero-glow" aria-hidden="true"></div>
          <div class="hero-card">
            <div class="media">
              ${mediaOrPlaceholder(site.hero.image, "Hero image — set in admin")}
            </div>
          </div>
        </div>
      </div>`;

    if (rootBanners && site.banners.length) {
      rootBanners.innerHTML = `
        <div class="container">
          <div class="section-head">
            <h2>Highlights</h2>
            <p>Curated snapshots of what we ship for partners.</p>
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
                      ? `<a class="btn btn-ghost" style="margin-top:0.5rem;align-self:flex-start" href="${attr(b.link)}">${escapeHtml(b.linkText || "Learn more")}</a>`
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
      const list =
        featured.length > 0
          ? featured
          : (services || []).slice(0, 6);
      rootServices.innerHTML = `
        <div class="container">
          <div class="section-head">
            <h2>Services</h2>
            <p>Focused capabilities that cover the full product lifecycle.</p>
            <a class="btn btn-ghost" href="/services.html">All services</a>
          </div>
          <div class="card-grid cols-3">
            ${list
              .map(
                (s) => `
              <article class="service-card">
                <div class="service-icon" aria-hidden="true">${window.SiteShell.iconFor(s.icon)}</div>
                <h3>${escapeHtml(s.title)}</h3>
                <p>${escapeHtml(s.shortDesc)}</p>
                <a class="link-arrow" href="/service.html?slug=${encodeURIComponent(s.slug)}">Details →</a>
              </article>`
              )
              .join("")}
          </div>
        </div>`;
    }

    if (rootAbout) {
      rootAbout.innerHTML = `
        <div class="container split-about">
          <div class="visual">
            ${mediaOrPlaceholder(site.homeAbout.image, "About image — optional")}
          </div>
          <div>
            <h2>${escapeHtml(site.homeAbout.title)}</h2>
            <p>${escapeHtml(site.homeAbout.text)}</p>
            <a class="btn btn-primary" href="/about.html">Read our story</a>
          </div>
        </div>`;
    }

    if (rootTeam) {
      const team = teamPreview || [];
      if (!team.length) {
        rootTeam.innerHTML = "";
        return;
      }
      rootTeam.innerHTML = `
        <div class="container">
          <div class="section-head">
            <h2>Team preview</h2>
            <p>Senior practitioners embedded with your workflows.</p>
            <a class="btn btn-ghost" href="/team.html">Full team</a>
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

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      SiteShell.initShell().then(load);
    });
  } else {
    SiteShell.initShell().then(load);
  }
})();
