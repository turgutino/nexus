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
    const body = document.getElementById("about-dynamic");
    if (!body) return;
    const r = await fetch("/api/public/site");
    const j = await r.json();
    if (!j.ok) return;
    const a = j.site.aboutPage;
    body.innerHTML = `
      <div class="split-about" style="margin-top:2rem">
        <div>
          <h2>${escapeHtml(a.title)}</h2>
          <p class="lead" style="color:var(--accent);font-weight:600">${escapeHtml(a.lead)}</p>
          ${String(a.body || "")
            .split("\n\n")
            .filter(Boolean)
            .map((p) => `<p>${escapeHtml(p)}</p>`)
            .join("")}
        </div>
        <div>
          <div class="contact-card">
            <h3 style="margin-top:0">Mission</h3>
            <p style="color:var(--muted);margin:0">${escapeHtml(a.mission)}</p>
            <h3 style="margin-top:1.25rem">Values</h3>
            <p style="color:var(--muted);margin:0">${escapeHtml(a.values)}</p>
            <a class="btn btn-primary" style="margin-top:1.25rem" href="/contact.html">Work with us</a>
          </div>
        </div>
      </div>`;
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
