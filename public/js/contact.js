(function () {
  async function load() {
    await SiteShell.initShell();
    const form = document.getElementById("contact-form");
    const status = document.getElementById("contact-status");
    if (!form) return;

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      status.textContent = "";
      status.className = "form-status";

      const fd = new FormData(form);
      const payload = {
        name: fd.get("name"),
        email: fd.get("email"),
        phone: fd.get("phone"),
        message: fd.get("message"),
      };

      try {
        const r = await fetch("/api/public/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const j = await r.json();
        if (!j.ok) {
          status.textContent = j.error || "Something went wrong.";
          status.classList.add("err");
          return;
        }
        status.textContent = "Thank you — we will get back to you shortly.";
        status.classList.add("ok");
        form.reset();
      } catch {
        status.textContent = "Network error. Please try again.";
        status.classList.add("err");
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
