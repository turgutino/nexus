// Newsletter confirm / unsubscribe pages. The action only runs when the visitor clicks the button,
// so email link scanners that merely open the URL cannot trigger it.
(function () {
  var action = document.body.getAttribute("data-token-action");
  var el = document.getElementById("token-status");
  var btn = document.getElementById("token-confirm-btn");
  if (!el || !btn || (action !== "confirm" && action !== "unsubscribe")) return;

  document.addEventListener("DOMContentLoaded", function () {
    if (window.SiteShell && window.SiteShell.initShell) window.SiteShell.initShell();
  });

  var messages = {
    confirm: {
      ready: "Press the button to confirm your newsletter subscription.",
      done: "Thank you — your subscription is confirmed.",
      fail: "This confirmation link is invalid or has expired.",
    },
    unsubscribe: {
      ready: "Press the button to unsubscribe from the newsletter.",
      done: "You have been unsubscribed from the newsletter.",
      already: "You were already unsubscribed.",
      fail: "This link is invalid or no longer active.",
    },
  }[action];

  var raw = new URLSearchParams(location.search).get("token");
  var token = raw && raw.trim().slice(0, 128);
  if (!token) {
    el.textContent = "Missing token in the URL. Open the link from your email.";
    el.className = "form-status err";
    return;
  }

  el.textContent = messages.ready;
  btn.hidden = false;
  btn.addEventListener("click", function () {
    btn.disabled = true;
    fetch("/api/public/newsletter/" + action, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: token }),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          return { ok: r.ok, j: j };
        });
      })
      .then(function (x) {
        if (x.ok && x.j && x.j.ok) {
          el.textContent = x.j.alreadyUnsubscribed && messages.already ? messages.already : messages.done;
          el.className = "form-status ok";
          btn.hidden = true;
          return;
        }
        el.textContent = (x.j && x.j.error) || messages.fail;
        el.className = "form-status err";
        btn.hidden = true;
      })
      .catch(function () {
        el.textContent = "Could not complete the request. Try again later.";
        el.className = "form-status err";
        btn.disabled = false;
      });
  });
})();
