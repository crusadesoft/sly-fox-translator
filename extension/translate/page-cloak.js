// Runs at document_start, before the page has painted a single word: hides
// page TEXT (not images or layout) so the untranslated wording is never on
// screen. content.js claims the cloak as soon as it loads and lifts it once it
// has the page churning — or as soon as it knows it has nothing to do here.
//
// Nothing else in the extension may depend on this script having run — it can
// be absent on tabs whose scripts were re-injected after an extension reload —
// and it must always lift itself, so a page can never be stuck unreadable.
(() => {
  const STYLE_ID = "learned-word-replacer-cloak-style";
  const UNCLOAK_KEY = "__learnedWordReplacerUncloak";
  const HOLD_KEY = "__learnedWordReplacerHoldCloak";
  const STORAGE_KEY = "learnedWordReplacerState";
  // How long the cloak waits for content.js to turn up at all. content.js runs
  // at document_idle, which on a heavy page is well over a second after this
  // script, so this is generous on purpose.
  const MAX_WAIT_MS = 4000;
  // How long it then gets to actually start work once it has checked in.
  const MAX_HOLD_MS = 2500;

  const root = document.documentElement;
  if (globalThis[UNCLOAK_KEY] || !root) {
    return;
  }

  // The cloak is the stylesheet's mere presence — no marker class on <html>.
  // Page frameworks assign documentElement.className wholesale during startup
  // (MediaWiki does, on every Wikipedia load), which silently wiped a
  // class-gated rule and let the untranslated text paint anyway. Removing the
  // element is the lift, and it is on documentElement rather than <head> so a
  // framework replacing the head cannot take it with it.
  const style = document.createElement("style");
  style.id = STYLE_ID;
  // Only colour is touched, so images, backgrounds and the whole layout paint
  // normally and nothing moves when the text comes back.
  style.textContent = `
    body,
    body * {
      color: transparent !important;
      -webkit-text-fill-color: transparent !important;
      text-shadow: none !important;
    }
  `;
  root.appendChild(style);
  // Survives the lift: the only way to tell "the cloak ran and let go" from
  // "the cloak never ran" once the stylesheet is gone.
  root.dataset.lwrCloak = "hiding";

  let lifted = false;
  let timer = 0;

  const uncloak = () => {
    if (lifted) {
      return;
    }

    lifted = true;
    clearTimeout(timer);
    style.remove();
    root.dataset.lwrCloak = "lifted";
  };

  const hold = (ms = MAX_HOLD_MS) => {
    if (lifted) {
      return;
    }

    clearTimeout(timer);
    timer = setTimeout(uncloak, ms);
  };

  timer = setTimeout(uncloak, MAX_WAIT_MS);
  globalThis[UNCLOAK_KEY] = uncloak;
  globalThis[HOLD_KEY] = hold;

  // Hiding text costs the reader nothing only when the extension is actually
  // about to rewrite it. The stored state usually arrives within a few
  // milliseconds — long before document_idle — so pages the extension will
  // not touch get their text back almost immediately.
  try {
    chrome.storage.local.get({ [STORAGE_KEY]: null }, (stored) => {
      try {
        const state = stored?.[STORAGE_KEY];
        if (!state || state.enabled === false) {
          uncloak();
          return;
        }

        const url = new URL(location.href);
        const exclusions = state.doNotTranslate || {};
        const sites = Array.isArray(exclusions.sites) ? exclusions.sites : [];
        const pages = Array.isArray(exclusions.pages) ? exclusions.pages : [];
        url.hash = "";

        if (sites.includes(url.hostname.toLocaleLowerCase()) || pages.includes(url.href)) {
          uncloak();
        }
      } catch (error) {
        uncloak();
      }
    });
  } catch (error) {
    uncloak();
  }
})();
