(function () {
  const STORAGE_KEY = 'siteLocale';
  const I18N_READY_EVENT = 'site:i18n-ready';
  const LOCALE_EVENT = 'site:localechange';

  let strings = {};
  let readyPromise = null;

  function normalizeLocale(code) {
    const s = String(code || '')
      .toLowerCase()
      .replace(/[^a-z]/g, '');
    return s.slice(0, 8) || 'en';
  }

  // Languages written right-to-left: the page direction flips so the whole layout mirrors.
  const RTL_LOCALES = ['he', 'ar', 'fa', 'ur'];

  function applyDirection(loc) {
    const root = document.documentElement;
    root.setAttribute('lang', loc);
    root.setAttribute('dir', RTL_LOCALES.includes(loc) ? 'rtl' : 'ltr');
  }

  function getLocale() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const loc = normalizeLocale(raw);
      return loc || 'en';
    } catch {
      return 'en';
    }
  }

  // Stores the locale and updates <html lang> without announcing the change.
  function persistLocale(code) {
    const loc = normalizeLocale(code) || 'en';
    try {
      if (loc === 'en') localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, loc);
    } catch {
      /* private mode */
    }
    applyDirection(loc);
    return loc;
  }

  function announceLocale(loc) {
    window.dispatchEvent(new CustomEvent(LOCALE_EVENT, { detail: { locale: loc } }));
  }

  function setLocale(code) {
    const loc = persistLocale(code);
    announceLocale(loc);
    return loc;
  }

  function t(key, fallback) {
    const v = strings[key];
    if (v != null && String(v).length) return v;
    if (fallback != null) return fallback;
    return key;
  }

  function format(template, vars) {
    let s = String(template || '');
    if (!vars) return s;
    Object.keys(vars).forEach((k) => {
      s = s.split(`{${k}}`).join(String(vars[k] ?? ''));
    });
    return s;
  }

  function applyDom(root) {
    const base = root || document;
    base.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const fb = el.getAttribute('data-i18n-fallback');
      el.textContent = t(key, fb != null ? fb : '');
    });
    base.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (!key) return;
      const phFb =
        el.getAttribute('data-i18n-placeholder-fallback') ||
        el.getAttribute('data-i18n-fallback') ||
        el.placeholder ||
        '';
      el.placeholder = t(key, phFb);
    });
    base.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      if (!key) return;
      el.setAttribute('aria-label', t(key, el.getAttribute('data-i18n-fallback') || ''));
    });
    base.querySelectorAll('[data-i18n-html]').forEach((el) => {
      const key = el.getAttribute('data-i18n-html');
      if (!key) return;
      const fb = el.getAttribute('data-i18n-fallback') || '';
      el.innerHTML = t(key, fb);
    });
  }

  async function loadStrings(locale) {
    const loc = normalizeLocale(locale);
    const r = await fetch('/api/translations/' + encodeURIComponent(loc));
    const j = await r.json();
    if (!j.ok || !j.strings) {
      strings = {};
      return;
    }
    strings = j.strings;
  }

  async function init() {
    const loc = getLocale();
    applyDirection(loc);
    await loadStrings(loc);
    applyDom(document);
    window.dispatchEvent(new Event(I18N_READY_EVENT));
  }

  function ensureReady() {
    if (!readyPromise) {
      readyPromise = init().catch(() => {
        strings = {};
        window.dispatchEvent(new Event(I18N_READY_EVENT));
      });
    }
    return readyPromise;
  }

  // The change is announced only AFTER the new strings are loaded. Listeners (home, blog, seo ...) re-render
  // on this event, so announcing earlier made them render with the previous language's strings.
  async function setLocaleAndReloadStrings(code) {
    const loc = persistLocale(code);
    await loadStrings(loc);
    applyDom(document);
    announceLocale(loc);
    return loc;
  }

  window.SiteI18n = {
    getLocale,
    setLocale,
    setLocaleAndReloadStrings,
    t,
    format,
    applyDom,
    loadStrings,
    ensureReady,
    I18N_READY_EVENT,
    LOCALE_EVENT,
    STORAGE_KEY,
  };
})();
