// The names both halves of the extension need.
//
// Everything here is read by the translation modules and the Duolingo modules
// alike, or by something outside the content scripts entirely: the popup and
// the service worker read the same storage key, and the Duolingo word list
// looks for the same replacement class the translator writes. Constants used
// by only one side live with that side instead.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const REFRESH_KEY = "__learnedWordReplacerRefresh";
  const STORAGE_KEY = "learnedWordReplacerState";
  const REPLACEMENT_CLASS = "learned-word-replacer-token";
  const SOURCE_LANGUAGE = "en";
  const LANGUAGE_NAMES = {
    de: "German",
    el: "Greek",
    es: "Spanish",
    fr: "French",
    it: "Italian",
    la: "Latin",
    uk: "Ukrainian"
  };

  Object.assign(LWR, {
    REFRESH_KEY,
    STORAGE_KEY,
    REPLACEMENT_CLASS,
    SOURCE_LANGUAGE,
    LANGUAGE_NAMES
  });
})();
