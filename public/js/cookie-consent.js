(function () {
  var STORAGE_KEY = "cookie_consent";

  function getStatus() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch {
      return null;
    }
  }

  window.SiteCookieConsent = {
    status: getStatus,
    allowsAnalytics: function () {
      try {
        return localStorage.getItem(STORAGE_KEY) === "accepted";
      } catch {
        return false;
      }
    },
  };

  function hideBanner(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function renderBanner() {
    var existing = document.getElementById("cookie-consent-banner");
    if (existing) return;

    var status = getStatus();
    if (status === "accepted" || status === "declined") return;

    var banner = document.createElement("div");
    banner.id = "cookie-consent-banner";
    banner.className = "cookie-consent-banner";
    banner.setAttribute("role", "dialog");
    banner.setAttribute("aria-live", "polite");
    banner.setAttribute("aria-label", "Cookie consent");

    var inner = document.createElement("div");
    inner.className = "cookie-consent-inner container";

    var text = document.createElement("p");
    text.className = "cookie-consent-text";
    text.textContent =
      "This site uses cookies for session and analytics purposes.";

    var actions = document.createElement("div");
    actions.className = "cookie-consent-actions";

    var acceptBtn = document.createElement("button");
    acceptBtn.type = "button";
    acceptBtn.className = "btn btn-primary cookie-consent-accept";
    acceptBtn.textContent = "Accept";

    var declineBtn = document.createElement("button");
    declineBtn.type = "button";
    declineBtn.className = "btn btn-ghost cookie-consent-decline";
    declineBtn.textContent = "Decline";

    acceptBtn.addEventListener("click", function () {
      try {
        localStorage.setItem(STORAGE_KEY, "accepted");
      } catch {
        /* private mode */
      }
      hideBanner(banner);
      fetch("/api/public/analytics-consent", { method: "POST", credentials: "include" })
        .then(function () {
          try {
            sessionStorage.setItem("analytics_cookie_synced", "1");
          } catch (_) {
            /* private mode */
          }
          var path = window.location.pathname + (window.location.search || "");
          var ref = document.referrer || "";
          fetch("/api/public/track-page", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              path: path.slice(0, 500),
              referrer: ref.slice(0, 1000),
            }),
          }).catch(function () {});
          try {
            if (!sessionStorage.getItem("visit_tracked")) {
              sessionStorage.setItem("visit_tracked", "1");
              fetch("/api/public/track-visit", { method: "POST" }).catch(function () {});
            }
          } catch (_) {
            /* private mode */
          }
        })
        .catch(function () {});
    });

    declineBtn.addEventListener("click", function () {
      try {
        localStorage.setItem(STORAGE_KEY, "declined");
      } catch {
        /* private mode */
      }
      hideBanner(banner);
    });

    actions.appendChild(acceptBtn);
    actions.appendChild(declineBtn);
    inner.appendChild(text);
    inner.appendChild(actions);
    banner.appendChild(inner);
    document.body.appendChild(banner);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderBanner);
  } else {
    renderBanner();
  }
})();
