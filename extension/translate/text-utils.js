// Character and text-node tests used all over the walk: what counts as a word
// character, which nodes are off limits, and where a hyphen or apostrophe is
// part of a word rather than a boundary.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  // Whitespace-only text nodes hold no replaceable words, but they still
  // separate words in the rendered text ("3<b> </b><a>hertz</a>"), so unit
  // text assembly must keep them or the translator sees "3hertz" and the
  // structure-mode rendered-text check can never match.
  function isTextNodeInIgnoredSubtree(node) {
    if (!node.nodeValue) {
      return true;
    }

    const parent = node.parentElement;
    if (!parent) {
      return true;
    }

    return Boolean(parent.closest(LWR.IGNORED_SELECTOR));
  }

  function shouldIgnoreTextNode(node) {
    if (!node.nodeValue || !node.nodeValue.trim()) {
      return true;
    }

    return isTextNodeInIgnoredSubtree(node);
  }

  function isWordCharacter(char) {
    return Boolean(char && /[\p{L}\p{N}\p{M}_]/u.test(char));
  }

  function isApostrophe(char) {
    return char === "'" || char === "\u2019" || char === "\u02bc";
  }

  function isCyrillic(char) {
    return Boolean(char && /\p{Script=Cyrillic}/u.test(char));
  }

  function isWordInternalApostrophe(text, index) {
    return (
      isApostrophe(text[index]) &&
      isWordCharacter(text[index - 1]) &&
      isWordCharacter(text[index + 1])
    );
  }

  // Ukrainian glues compounds together with a hyphen (\u0431\u0443\u0434\u044c-\u044f\u043a\u0438\u0439, \u043f\u043e-\u043f\u0435\u0440\u0448\u0435,
  // \u0432\u0441\u0435-\u0442\u0430\u043a\u0438), so neither half is a word on its own. Latin script uses the
  // hyphen as a genuine boundary ("mid-1890s", "well-known"), so keying off the
  // neighbouring script leaves English splitting as it always has, without
  // threading a language code through every matcher.
  function isCyrillicCompoundHyphen(text, index) {
    return (
      text[index] === "-" &&
      isWordCharacter(text[index - 1]) &&
      isWordCharacter(text[index + 1]) &&
      isCyrillic(text[index - 1]) &&
      isCyrillic(text[index + 1])
    );
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    isTextNodeInIgnoredSubtree,
    shouldIgnoreTextNode,
    isWordCharacter,
    isApostrophe,
    isWordInternalApostrophe,
    isCyrillicCompoundHyphen
  });
})();
