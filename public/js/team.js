(function () {
  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function load() {
    await SiteShell.initShell();
    if (window.SiteI18n) window.SiteI18n.applyDom(document);
    const root = document.getElementById("team-grid");
    if (!root) return;
    const r = await fetch("/api/public/team");
    const j = await r.json();
    if (!j.ok) return;
    root.innerHTML = j.team
      .map(
        (m) => `
      <article class="team-card">
        <div class="team-avatar">${avatar(m.image)}</div>
        <div class="body">
          <h3>${escapeHtml(m.name)}</h3>
          <p class="role">${escapeHtml(m.role)}</p>
          <p>${escapeHtml(m.bio)}</p>
        </div>
      </article>`
      )
      .join("");
  }

  function avatar(url) {
    if (url) return `<img src="${escapeHtml(url)}" alt="" loading="lazy" />`;
    return `<div style="display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:2rem;height:100%">◆</div>`;
  }

  if (window.SiteI18n) {
    window.addEventListener(window.SiteI18n.LOCALE_EVENT, load);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
