(function () {
  function init() {
    var form = document.getElementById("newsletter-form");
    var status = document.getElementById("newsletter-status");
    if (!form || !status) return;
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      status.textContent = "";
      status.className = "form-status footer-newsletter-status";
      var fd = new FormData(form);
      var email = (fd.get("email") || "").toString().trim();
      if (!email) return;
      fetch("/api/public/newsletter/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email }),
      })
        .then(function (r) {
          return r.json().then(function (j) {
            return { ok: r.ok, j: j };
          });
        })
        .then(function (_ref) {
          var ok = _ref.ok;
          var j = _ref.j;
          if (!ok) {
            status.textContent = (j && j.error) || "Something went wrong.";
            status.className = "form-status footer-newsletter-status err";
            return;
          }
          status.textContent = "Almost done — check your inbox and click the confirmation link.";
          status.className = "form-status footer-newsletter-status ok";
          form.reset();
        })
        .catch(function () {
          status.textContent = "Network error. Try again later.";
          status.className = "form-status footer-newsletter-status err";
        });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
