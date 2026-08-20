// Class names and match kinds shared by the translation modules.
//
// These get written into the page, so the stylesheet that colors them, the DOM
// builders that create them, and the restore pass that strips them all have to
// agree on the exact strings.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const PROCESSED_BLOCK_CLASS = "learned-word-replacer-checked";
  const REVERSE_HOVER_TOOLTIP_CLASS = "learned-word-replacer-hover-tooltip";
  const STRUCTURED_BLOCK_CLASS = "learned-word-replacer-structured";
  const INLINE_STRUCTURED_CLASS = "learned-word-replacer-inline";

  // Why a replacement is standing where it is. The three kinds are styled
  // differently and counted separately in the status the popup reads.
  const WORD_FAMILY_MATCH_KIND = "word-family";
  const BACK_TRANSLATION_MATCH_KIND = "back-translation";
  const UNLEARNED_MATCH_KIND = "unlearned";

  // Tags every message this extension posts, so the page-world bridge and the
  // content scripts ignore traffic that is not theirs.
  const MESSAGE_SOURCE = "learned-word-replacer";

  Object.assign(LWR, {
    PROCESSED_BLOCK_CLASS,
    REVERSE_HOVER_TOOLTIP_CLASS,
    STRUCTURED_BLOCK_CLASS,
    INLINE_STRUCTURED_CLASS,
    WORD_FAMILY_MATCH_KIND,
    BACK_TRANSLATION_MATCH_KIND,
    UNLEARNED_MATCH_KIND,
    MESSAGE_SOURCE
  });
})();
