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
  // Where a lesson built from something on a web page waits while the player
  // tab opens. One slot, overwritten each time -- see youtube/language-reactor.js.
  const IMPROMPTU_STORAGE_KEY = "learnedWordReplacerImpromptuLesson";
  // A content script cannot open an extension page itself unless that page is
  // web-accessible from the site it is on, so it asks the service worker to.
  const OPEN_LESSON_REQUEST = "LWR_OPEN_IMPROMPTU_LESSON";
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
    IMPROMPTU_STORAGE_KEY,
    OPEN_LESSON_REQUEST,
    REPLACEMENT_CLASS,
    SOURCE_LANGUAGE,
    LANGUAGE_NAMES
  });
})();
