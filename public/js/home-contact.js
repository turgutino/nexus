(function () {
  function msg(k, fb) {
    return window.SiteI18n ? window.SiteI18n.t(k, fb) : fb;
  }
  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("contact-form-mini");
    var status = document.getElementById("mini-status");
    if (!form) return;
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      status.textContent = "";
      status.className = "form-status";
      var fd = new FormData(form);
      try {
        var r = await fetch("/api/public/contact", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: fd.get("name"),
            email: fd.get("email"),
            phone: "",
            message: fd.get("message"),
          }),
        });
        var j = await r.json();
        if (!j.ok) {
          status.textContent = j.error || msg("contact.error_generic", "Something went wrong.");
          status.classList.add("err");
          return;
        }
        status.textContent = msg("contact.sent_ok_mini", "Sent! We will reply soon.");
        status.classList.add("ok");
        form.reset();
      } catch {
        status.textContent = msg("contact.error_network", "Network error.");
        status.classList.add("err");
      }
    });
  });
})();
