// Matching Duolingo's theme.
//
// Duolingo ships a dark theme, and every input row the extension adds sits
// straight on the page's own background, so a hard-coded white box glares.
// There is no theme flag worth reading — Duolingo repaints through CSS custom
// properties — so the page's rendered background colour is the signal, which
// also keeps this working if their markup moves again.
//
// Every other Duolingo module reads its colours from `duolingoTheme()`, and
// repaints itself when this file says the theme flipped.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const DUOLINGO_THEME_STYLE_ID = "learned-word-replacer-duolingo-theme";
  // Colours are all rgb() strings: several guarded writes below compare a
  // value against style.background, and only rgb() round-trips through the
  // shorthand unchanged (#ffffff reads back as "rgb(255, 255, 255)").
  const DUOLINGO_THEMES = {
    light: {
      inputBackground: "rgb(255, 255, 255)",
      inputSunkenBackground: "rgb(247, 247, 247)",
      inputText: "rgb(60, 60, 60)",
      inputPlaceholder: "rgb(175, 175, 175)",
      inputBorder: "rgb(229, 229, 229)",
      inputBorderFocus: "rgb(28, 176, 246)",
      inputBorderError: "rgb(234, 43, 43)",
      icon: "rgb(175, 175, 175)",
      badgeBackground: "rgb(60, 60, 60)",
      badgeErrorBackground: "rgb(234, 43, 43)",
      badgeText: "rgb(255, 255, 255)",
      surface: "rgb(255, 255, 255)",
      surfaceBorder: "rgb(229, 229, 229)",
      surfaceText: "rgb(60, 60, 60)",
      surfaceMutedText: "rgb(120, 120, 120)",
      correctBanner: "rgb(215, 255, 184)",
      wrongBanner: "rgb(255, 223, 224)",
      correctText: "rgb(88, 167, 0)",
      wrongText: "rgb(234, 43, 43)"
    },
    dark: {
      // Duolingo's own dark tokens: page #131f24, raised card #202f36,
      // hairline #37464f, body text #f1f7fb, muted #8b9fa8. The blue focus
      // ring and the timer colours already read on both, so they carry over.
      inputBackground: "rgb(32, 47, 54)",
      inputSunkenBackground: "rgb(19, 31, 36)",
      inputText: "rgb(241, 247, 251)",
      inputPlaceholder: "rgb(139, 159, 168)",
      inputBorder: "rgb(55, 70, 79)",
      inputBorderFocus: "rgb(28, 176, 246)",
      inputBorderError: "rgb(255, 75, 75)",
      icon: "rgb(139, 159, 168)",
      badgeBackground: "rgb(55, 70, 79)",
      badgeErrorBackground: "rgb(255, 75, 75)",
      badgeText: "rgb(241, 247, 251)",
      surface: "rgb(19, 31, 36)",
      surfaceBorder: "rgb(55, 70, 79)",
      surfaceText: "rgb(241, 247, 251)",
      surfaceMutedText: "rgb(139, 159, 168)",
      correctBanner: "rgb(32, 52, 26)",
      wrongBanner: "rgb(60, 30, 34)",
      correctText: "rgb(88, 204, 2)",
      wrongText: "rgb(255, 75, 75)"
    }
  };

  // Read by every module that paints something, so it lives on the namespace.
  LWR.duolingoThemeName = null;
  let duolingoThemeWatching = false;

  function parseDuolingoThemeColor(value) {
    const match = /^rgba?\(([^)]+)\)$/i.exec(String(value || "").trim());
    if (!match) {
      return null;
    }
    const parts = match[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) {
      return null;
    }
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }

  function detectDuolingoThemeName() {
    // Whatever actually paints behind the UI decides which palette reads on
    // it: walk out from <body> and take the first ancestor that is not
    // see-through.
    let node = document.body;
    while (node) {
      const color = parseDuolingoThemeColor(getComputedStyle(node).backgroundColor);
      if (color && color.a > 0) {
        // Rec. 601 luma, which is plenty to split "light page" from "dark".
        return (color.r * 299 + color.g * 587 + color.b * 114) / 1000 < 128 ? "dark" : "light";
      }
      node = node.parentElement;
    }
    // A page that paints nothing shows the browser's default surface.
    return globalThis.matchMedia && globalThis.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function duolingoTheme() {
    if (!LWR.duolingoThemeName) {
      LWR.duolingoThemeName = detectDuolingoThemeName();
    }
    return DUOLINGO_THEMES[LWR.duolingoThemeName];
  }

  function refreshDuolingoTheme() {
    const next = detectDuolingoThemeName();
    if (next === LWR.duolingoThemeName) {
      return false;
    }
    LWR.duolingoThemeName = next;
    applyDuolingoTheme();
    return true;
  }

  function watchDuolingoTheme() {
    if (duolingoThemeWatching || globalThis !== globalThis.top || !LWR.isDuolingoHost()) {
      return;
    }
    duolingoThemeWatching = true;
    LWR.duolingoThemeName = detectDuolingoThemeName();

    // Duolingo's own toggle swaps a class or attribute on <html>/<body>; the
    // media query covers the system theme changing underneath a page left on
    // "automatic". A theme flip that shows up neither way still lands on the
    // next challenge, because a rebuilt input row re-detects.
    const retheme = () => refreshDuolingoTheme();
    for (const node of [document.documentElement, document.body]) {
      if (node) {
        new MutationObserver(retheme).observe(node, {
          attributes: true,
          attributeFilter: ["class", "style", "data-theme"]
        });
      }
    }
    globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", retheme);
  }

  function ensureDuolingoThemeStyle() {
    const theme = duolingoTheme();
    let style = document.getElementById(DUOLINGO_THEME_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = DUOLINGO_THEME_STYLE_ID;
      (document.head || document.documentElement).append(style);
    }
    // ::placeholder is the one rule with no inline-style equivalent, so it is
    // the only reason the extension needs a stylesheet at all.
    const css = `[data-lwr-input]::placeholder{color:${theme.inputPlaceholder};opacity:1}`;
    // Guarded write: this can run from the MutationObserver.
    if (style.textContent !== css) {
      style.textContent = css;
    }
  }

  // Repaint every themed surface that is currently on screen. Each write is
  // guarded by a data-lwr-theme stamp so a repaint driven by the
  // MutationObserver cannot feed itself.
  function applyDuolingoTheme() {
    ensureDuolingoThemeStyle();
    LWR.applyDuolingoTypeInputTheme();
    applyDuolingoPanelInputTheme();
    LWR.applyFlashcardOverlayTheme();
  }

  function applyDuolingoPanelInputTheme() {
    const theme = duolingoTheme();
    document.querySelectorAll("[data-lwr-panel-input]").forEach((input) => {
      if (input.getAttribute("data-lwr-theme") === LWR.duolingoThemeName) {
        return;
      }
      input.setAttribute("data-lwr-theme", LWR.duolingoThemeName);
      input.style.borderColor = theme.inputBorder;
      input.style.background = theme.inputBackground;
      input.style.color = theme.inputText;
    });
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    duolingoTheme,
    refreshDuolingoTheme,
    watchDuolingoTheme,
    ensureDuolingoThemeStyle,
    applyDuolingoTheme,
    applyDuolingoPanelInputTheme
  });
})();
