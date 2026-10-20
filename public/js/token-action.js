// Newsletter confirm / unsubscribe pages. The action only runs when the visitor clicks the button,
// so email link scanners that merely open the URL cannot trigger it.
(function () {
  var action = document.body.getAttribute("data-token-action");
  var el = document.getElementById("token-status");
  var btn = document.getElementById("token-confirm-btn");
  if (!el || !btn || (action !== "confirm" && action !== "unsubscribe")) return;

  function T(key, fallback) {
    return window.SiteI18n ? window.SiteI18n.t(key, fallback) : fallback;
  }

  var prefix = action === "confirm" ? "confirm" : "unsub";
  var FALLBACK = {
    confirm: {
      ready: "Press the button to confirm your newsletter subscription.",
      done: "Thank you — your subscription is confirmed.",
      fail: "This confirmation link is invalid or has expired.",
    },
    unsub: {
      ready: "Press the button to unsubscribe from the newsletter.",
      done: "You have been unsubscribed from the newsletter.",
      already: "You were already unsubscribed.",
      fail: "This link is invalid or no longer active.",
    },
  }[prefix];

  // Which message is currently shown, so it can be re-translated when the language changes.
  var state = { key: null, cls: "form-status" };

  function show(key, cls) {
    state.key = key;
    state.cls = cls || "form-status";
    el.textContent = key === "token.missing" ? T("token.missing", "Missing token in the URL. Open the link from your email.") : T(key, FALLBACK[key.split(".")[1]] || "");
    el.className = state.cls;
  }

  function showNetworkError() {
    state.key = "contact.error_network";
    state.cls = "form-status err";
    el.textContent = T("contact.error_network", "Network error. Please try again.");
    el.className = state.cls;
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (window.SiteShell && window.SiteShell.initShell) window.SiteShell.initShell();
  });

  var raw = new URLSearchParams(location.search).get("token");
  var token = raw && raw.trim().slice(0, 128);

  function init() {
    if (!token) {
      show("token.missing", "form-status err");
      return;
    }
    show(prefix + ".ready");
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
          btn.hidden = true;
          if (x.ok && x.j && x.j.ok) {
            show(x.j.alreadyUnsubscribed && prefix === "unsub" ? "unsub.already" : prefix + ".done", "form-status ok");
            return;
          }
          show(prefix + ".fail", "form-status err");
        })
        .catch(function () {
          showNetworkError();
          btn.disabled = false;
        });
    });
  }

  if (window.SiteI18n) {
    window.SiteI18n.ensureReady().then(init);
    window.addEventListener(window.SiteI18n.LOCALE_EVENT, function () {
      if (state.key === "contact.error_network") showNetworkError();
      else if (state.key) show(state.key, state.cls);
    });
  } else {
    init();
  }
})();
