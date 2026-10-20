(function () {
  function msg(k, fb) {
    return window.SiteI18n ? window.SiteI18n.t(k, fb) : fb;
  }

  function contactError(r, j) {
    if (r && r.status === 429) return msg("contact.err_limit", "Too many requests. Try again later.");
    if (j && j.code) {
      var base = msg("contact.err_" + j.code, "");
      if (base) {
        return j.code === "unavailable" && j.email
          ? base + " " + msg("contact.err_email_us", "Please email us at") + " " + j.email + "."
          : base;
      }
    }
    return (j && j.error) || msg("contact.error_generic", "Something went wrong.");
  }

  async function loadMap() {
    try {
      const r = await fetch("/api/public/contact-page");
      const j = await r.json();
      if (!j.ok) return;
      const box = document.getElementById("contact-map");
      if (!box || !j.mapEmbedUrl) return;
      box.innerHTML =
        `<iframe title="${escapeAttr(msg("contact.map", "Map"))}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${escapeAttr(
          j.mapEmbedUrl
        )}"></iframe>`;
    } catch {
      /* ignore */
    }
  }

  function escapeAttr(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  let formBound = false;

  async function load() {
    await SiteShell.initShell();
    await loadMap();
    if (window.SiteI18n) window.SiteI18n.applyDom(document);
    const form = document.getElementById("contact-form");
    const status = document.getElementById("contact-status");
    if (!form || formBound) return;
    formBound = true;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.textContent = "";
      status.className = "form-status";

      const fd = new FormData(form);
      const fileInput = document.getElementById("attachment");
      const hasFile = fileInput && fileInput.files && fileInput.files[0];

      try {
        let r;
        if (hasFile) {
          r = await fetch("/api/public/contact", {
            method: "POST",
            body: fd,
          });
        } else {
          r = await fetch("/api/public/contact", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: fd.get("name"),
              email: fd.get("email"),
              phone: fd.get("phone"),
              message: fd.get("message"),
            }),
          });
        }
        const j = await r.json();
        if (!j.ok) {
          status.textContent = contactError(r, j);
          status.classList.add("err");
          return;
        }
        status.textContent = msg("contact.sent_ok", "Thank you — we will get back to you shortly.");
        status.classList.add("ok");
        form.reset();
      } catch {
        status.textContent = msg("contact.error_network", "Network error. Please try again.");
        status.classList.add("err");
      }
    });
  }

  if (window.SiteI18n) {
    window.addEventListener(window.SiteI18n.LOCALE_EVENT, () => {
      loadMap();
      if (window.SiteI18n) window.SiteI18n.applyDom(document);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
