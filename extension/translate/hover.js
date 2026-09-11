// The hover tooltip, styled after Duolingo's hint popover.
//
// It answers three different questions with one piece of UI: the English
// behind a word this extension replaced, the meaning of a target-language word
// the page already had, and a plain translation of an English word that is not
// in the vocabulary yet. Learned vocabulary answers without a translator call.
//
// The target→English translator lives here because hover is its first caller,
// but the target-language page pass shares it, so it sits on the namespace.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const REVERSE_HOVER_DELAY_MS = 260;
  const MAX_REVERSE_HOVER_CACHE_ENTRIES = 200;
  const MAX_HOVER_HINT_ROWS = 3;

  let reverseHoverTooltip = null;
  let reverseHoverListenerInstalled = false;
  let reverseHoverTimer = null;
  let reverseHoverRequestId = 0;
  let reverseHoverKey = "";
  let reverseHoverAnchorRect = null;
  const reverseHoverTranslationCache = new Map();

  // Shared with translator.js and passes.js, which reuse the same
  // target→English translator and report why it could not be created.
  LWR.reverseHoverTranslatorKey = "";
  LWR.reverseTranslatorAvailability = "";
  LWR.reverseHoverTranslatorPromise = null;

  function getReverseHoverDelayMs() {
    return LWR.getConfigNumber("reverseHoverDelayMs", REVERSE_HOVER_DELAY_MS);
  }

  function installReverseHoverTranslation() {
    if (reverseHoverListenerInstalled) {
      return;
    }

    reverseHoverListenerInstalled = true;
    document.addEventListener("pointermove", handleReverseHoverPointerMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", clearReverseHover, { passive: true });
    globalThis.addEventListener("blur", clearReverseHover);
    globalThis.addEventListener("scroll", clearReverseHover, { capture: true, passive: true });
  }

  function handleReverseHoverPointerMove(event) {
    const target = event.target;
    const replacementSpan =
      LWR.state.enabled && target && typeof target.closest === "function"
        ? target.closest(`.${LWR.REPLACEMENT_CLASS}`)
        : null;

    if (replacementSpan) {
      if (LWR.state.showOriginalOnHover && replacementSpan.dataset.learnedWordOriginal) {
        showReplacementOriginalTooltip(replacementSpan);
      } else {
        clearReverseHover();
      }
      return;
    }

    if (
      !LWR.state.enabled ||
      !LWR.state.translateEnglishOnHover ||
      !LWR.compiledEntries.length ||
      !LWR.getCurrentLanguageCode() ||
      LWR.getTranslationExclusion()
    ) {
      clearReverseHover();
      return;
    }

    const hoverTarget = getHoverWordAtPoint(event.clientX, event.clientY);
    if (!hoverTarget) {
      clearReverseHover();
      return;
    }

    const word = hoverTarget.word;
    const targetLanguage = LWR.getCurrentLanguageCode();
    // The tooltip anchors to the word's own box, like Duolingo's hint popover
    // — refreshed on every move so a second occurrence of the same word gets
    // its own anchor.
    reverseHoverAnchorRect = hoverTarget.rect;

    // Words already in the target language answer with their ENGLISH side
    // instead of being pushed through the English→target direction.
    if (!/[A-Za-z]/.test(word)) {
      if (LWR.isTextAlreadyInTargetLanguage(word, targetLanguage)) {
        handleTargetWordHover(word, targetLanguage);
      } else {
        clearReverseHover();
      }
      return;
    }

    const key = `${targetLanguage}\u0000${word.toLocaleLowerCase()}`;
    if (key === reverseHoverKey) {
      positionReverseHoverTooltip();
      return;
    }

    clearReverseHover();
    reverseHoverKey = key;

    // Learned vocabulary answers the hover directly — and with up to three
    // alternates, like Duolingo's own hints — without a translator call.
    const vocabularyRows = dedupeHintRows(getHintTargetsForSourceWord(word));
    if (vocabularyRows.length) {
      showReverseHoverTooltip(vocabularyRows);
      return;
    }

    const requestId = ++reverseHoverRequestId;
    const cached = reverseHoverTranslationCache.get(key);

    if (cached) {
      showReverseHoverTooltip(dedupeHintRows([cached]));
      return;
    }

    reverseHoverTimer = setTimeout(() => {
      reverseHoverTimer = null;
      translateReverseHoverWord(word, targetLanguage, key, requestId);
    }, getReverseHoverDelayMs());
  }

  async function translateReverseHoverWord(word, targetLanguage, key, requestId) {
    const translatorKey = `${LWR.SOURCE_LANGUAGE}:${targetLanguage}`;
    if (!LWR.translatorCache || LWR.translatorCacheKey !== translatorKey) {
      return;
    }

    try {
      const translated = String(await LWR.translatorCache.translate(word)).trim();
      if (!translated || requestId !== reverseHoverRequestId || key !== reverseHoverKey) {
        return;
      }

      cacheReverseHoverTranslation(key, translated);
      showReverseHoverTooltip(dedupeHintRows([translated]));
    } catch (error) {
      // Hover translation should never interrupt page replacement.
    }
  }

  function cacheReverseHoverTranslation(key, value) {
    reverseHoverTranslationCache.set(key, value);
    if (reverseHoverTranslationCache.size <= MAX_REVERSE_HOVER_CACHE_ENTRIES) {
      return;
    }

    const oldestKey = reverseHoverTranslationCache.keys().next().value;
    reverseHoverTranslationCache.delete(oldestKey);
  }

  function handleTargetWordHover(word, targetLanguage) {
    const key = `${targetLanguage}:${LWR.SOURCE_LANGUAGE} ${word.toLocaleLowerCase()}`;
    if (key === reverseHoverKey) {
      positionReverseHoverTooltip();
      return;
    }

    clearReverseHover();
    reverseHoverKey = key;

    // Learned vocabulary answers directly with the English word plus its
    // Duolingo meanings, exactly like hovering a replaced word.
    const vocabularyRows = dedupeHintRows(getHintMeaningsForTargetWord(word));
    if (vocabularyRows.length) {
      showReverseHoverTooltip(vocabularyRows);
      return;
    }

    const requestId = ++reverseHoverRequestId;
    const cached = reverseHoverTranslationCache.get(key);

    if (cached) {
      showReverseHoverTooltip(dedupeHintRows(Array.isArray(cached) ? cached : [cached]));
      return;
    }

    reverseHoverTimer = setTimeout(() => {
      reverseHoverTimer = null;
      resolveTargetWordHoverRows(word, targetLanguage, key, requestId);
    }, getReverseHoverDelayMs());
  }

  async function resolveTargetWordHoverRows(word, targetLanguage, key, requestId) {
    try {
      const rows = [];

      // Inflected page words still reach vocabulary through their lemmas.
      if (targetLanguage === "uk") {
        const lemmasByWord = await LWR.getUkrainianLemmas([word]);
        for (const lemma of lemmasByWord.get(LWR.normalizeUkrainianMorphologyWord(word)) || []) {
          rows.push(...getHintMeaningsForTargetWord(lemma));
        }
      }

      if (!rows.length) {
        const translator = await getReverseTranslator(targetLanguage);
        if (translator) {
          const translated = String(await translator.translate(word)).trim();
          if (translated && translated.toLocaleLowerCase() !== word.toLocaleLowerCase()) {
            rows.push(translated);
          }
        }
      }

      const deduped = dedupeHintRows(rows);
      if (!deduped.length || requestId !== reverseHoverRequestId || key !== reverseHoverKey) {
        return;
      }

      cacheReverseHoverTranslation(key, deduped);
      showReverseHoverTooltip(deduped);
    } catch (error) {
      // Hover translation should never interrupt page replacement.
    }
  }

  // The target→English translator, shared by hover, the target-language page
  // pass and the lessons built from a subtitle line. It is created lazily and
  // only when the language pack is already installed — neither a hover nor a
  // page pass may start a model download; a failed create arms the next trusted
  // click instead.
  //
  // It is on the namespace because a word must not mean one thing when hovered
  // and another in a lesson: one translator, one answer.
  function getReverseTranslator(targetLanguage) {
    const key = `${targetLanguage}:${LWR.SOURCE_LANGUAGE}`;
    if (LWR.reverseHoverTranslatorPromise && LWR.reverseHoverTranslatorKey === key) {
      return LWR.reverseHoverTranslatorPromise;
    }

    const translatorApi = LWR.getTranslatorApi();
    if (!translatorApi || !targetLanguage || targetLanguage === LWR.SOURCE_LANGUAGE) {
      return Promise.resolve(null);
    }

    const options = { sourceLanguage: targetLanguage, targetLanguage: LWR.SOURCE_LANGUAGE };
    const request = (async () => {
      const availability = await LWR.withTimeout(
        translatorApi.availability(options),
        LWR.TRANSLATOR_AVAILABILITY_TIMEOUT_MS
      );
      // Remembered so the page pass can say WHY it did nothing: "unavailable"
      // means Chrome is not serving this pair at all (no click will help),
      // which is a different problem from a pack that needs one gesture.
      LWR.reverseTranslatorAvailability = String(availability || "");
      if (availability === "unavailable") {
        return null;
      }

      try {
        return await LWR.withTimeout(
          translatorApi.create(options),
          availability === "available"
            ? LWR.TRANSLATOR_CREATE_TIMEOUT_MS
            : LWR.TRANSLATOR_OPPORTUNISTIC_CREATE_TIMEOUT_MS
        );
      } catch (error) {
        // Chrome refuses the create without a user gesture while the pack is
        // "downloadable" — arm it so the next trusted click on the page
        // finishes the preparation, exactly like the forward pipeline.
        if (typeof translatorApi.armActivation === "function") {
          Promise.resolve(translatorApi.armActivation(options)).catch(() => {});
        }
        return null;
      }
    })().catch(() => null);

    LWR.reverseHoverTranslatorKey = key;
    const wrapped = request.then((translator) => {
      // A missing translator can appear later (the pack finishes installing),
      // so failures are not cached.
      if (!translator && LWR.reverseHoverTranslatorPromise === wrapped) {
        LWR.reverseHoverTranslatorPromise = null;
        LWR.reverseHoverTranslatorKey = "";
      }
      return translator;
    });
    LWR.reverseHoverTranslatorPromise = wrapped;
    return wrapped;
  }

  function getHoverWordAtPoint(x, y) {
    const position = getCaretPositionAtPoint(x, y);
    if (!position || position.node?.nodeType !== Node.TEXT_NODE || LWR.shouldIgnoreTextNode(position.node)) {
      return null;
    }

    const text = position.node.nodeValue;
    if (!text) {
      return null;
    }

    let index = Math.min(Math.max(Number(position.offset) || 0, 0), text.length - 1);
    if (!isHoverWordCharacter(text[index]) && index > 0 && isHoverWordCharacter(text[index - 1])) {
      index -= 1;
    }
    if (!isHoverWordCharacter(text[index])) {
      return null;
    }

    let start = index;
    let end = index + 1;
    while (start > 0 && isHoverWordCharacter(text[start - 1])) {
      start -= 1;
    }
    while (end < text.length && isHoverWordCharacter(text[end])) {
      end += 1;
    }

    const word = text.slice(start, end);
    if (!/\p{L}/u.test(word)) {
      return null;
    }

    // Caret-from-point snaps to the NEAREST text position, so a pointer in
    // empty space (margins, line ends, blank areas) still yields a word.
    // Only accept the hit when the pointer really is on the word's own box
    // and no unrelated element is layered on top of it.
    const range = document.createRange();
    range.setStart(position.node, start);
    range.setEnd(position.node, end);
    const rect = Array.from(range.getClientRects()).find(
      (candidate) =>
        x >= candidate.left - 2 &&
        x <= candidate.right + 2 &&
        y >= candidate.top - 2 &&
        y <= candidate.bottom + 2
    );
    if (!rect) {
      return null;
    }

    const hit = document.elementFromPoint(x, y);
    const parent = position.node.parentElement;
    if (!hit || !parent || !(hit === parent || hit.contains(parent) || parent.contains(hit))) {
      return null;
    }

    return { word, rect };
  }

  function getCaretPositionAtPoint(x, y) {
    if (typeof document.caretPositionFromPoint === "function") {
      const position = document.caretPositionFromPoint(x, y);
      if (position) {
        return { node: position.offsetNode, offset: position.offset };
      }
    }

    if (typeof document.caretRangeFromPoint === "function") {
      const range = document.caretRangeFromPoint(x, y);
      if (range) {
        return { node: range.startContainer, offset: range.startOffset };
      }
    }

    return null;
  }

  function isHoverWordCharacter(char) {
    return LWR.isWordCharacter(char) || LWR.isApostrophe(char);
  }

  function ensureReverseHoverTooltip() {
    if (reverseHoverTooltip?.isConnected) {
      return reverseHoverTooltip;
    }

    reverseHoverTooltip = document.createElement("div");
    reverseHoverTooltip.className = LWR.REVERSE_HOVER_TOOLTIP_CLASS;
    reverseHoverTooltip.setAttribute("role", "tooltip");
    reverseHoverTooltip.dataset.visible = "false";

    const box = document.createElement("div");
    box.className = `${LWR.REVERSE_HOVER_TOOLTIP_CLASS}-box`;
    const caret = document.createElement("div");
    caret.className = `${LWR.REVERSE_HOVER_TOOLTIP_CLASS}-caret`;
    reverseHoverTooltip.append(box, caret);
    document.documentElement.appendChild(reverseHoverTooltip);
    return reverseHoverTooltip;
  }

  // Duolingo's hint popover shows at most the three best translations, one
  // per row.
  function dedupeHintRows(values) {
    const rows = [];
    const seen = new Set();

    for (const value of values) {
      const cleaned = String(value || "").replace(/\s+/gu, " ").trim();
      const key = cleaned.toLocaleLowerCase();
      if (!cleaned || seen.has(key)) {
        continue;
      }

      seen.add(key);
      rows.push(cleaned);
      if (rows.length === MAX_HOVER_HINT_ROWS) {
        break;
      }
    }

    return rows;
  }

  function splitHintMeanings(definition) {
    return LWR.cleanEnglishAlignmentText(definition)
      .replace(/^suggested meanings:\s*/iu, "")
      .split(/\s*(?:,|;|\n|\s\/\s)\s*/u)
      .map((part) => part.trim())
      .filter((part) => part && part.length <= 40);
  }

  function getHintMeaningsForTargetWord(targetWord) {
    const key = String(targetWord || "").toLocaleLowerCase();
    if (!key) {
      return [];
    }

    const meanings = [];
    for (const entry of LWR.compiledEntries) {
      if (!entry.targetCandidates.some((candidate) => candidate.toLocaleLowerCase() === key)) {
        continue;
      }

      meanings.push(String(entry.source || ""), ...splitHintMeanings(entry.definition));
    }

    return meanings;
  }

  function getHintTargetsForSourceWord(word) {
    const key = String(word || "").toLocaleLowerCase();
    if (!key) {
      return [];
    }

    const targets = [];
    for (const entry of LWR.compiledEntries) {
      if (String(entry.source || "").toLocaleLowerCase() === key) {
        targets.push(...entry.targetCandidates);
      }
    }

    return targets;
  }

  function setReverseHoverTooltipRows(rows) {
    const tooltip = ensureReverseHoverTooltip();
    tooltip.firstElementChild.replaceChildren(
      ...rows.map((value) => {
        const row = document.createElement("div");
        row.className = `${LWR.REVERSE_HOVER_TOOLTIP_CLASS}-row`;
        row.textContent = value;
        return row;
      })
    );
    return tooltip;
  }

  function showReverseHoverTooltip(rows) {
    const tooltip = setReverseHoverTooltipRows(rows);
    positionReverseHoverTooltip();
    tooltip.dataset.visible = "true";
  }

  function positionReverseHoverTooltip() {
    if (!reverseHoverTooltip?.isConnected || !reverseHoverAnchorRect) {
      return;
    }

    positionTooltipOverRect(reverseHoverAnchorRect);
  }

  function showReplacementOriginalTooltip(span) {
    const original = span.dataset.learnedWordOriginal;
    const visibleText = String(span.textContent || "").trim();

    // On target-language pages a learned word is shown exactly as the page
    // wrote it, so there is no original to reveal — answer with its English
    // side instead, like hovering an untouched target-language word.
    if (
      LWR.getCurrentLanguageCode() &&
      String(original || "").trim() === visibleText &&
      LWR.isTextAlreadyInTargetLanguage(visibleText)
    ) {
      reverseHoverAnchorRect = span.getBoundingClientRect();
      handleTargetWordHover(visibleText, LWR.getCurrentLanguageCode());
      return;
    }

    const key = `original\u0000${original}\u0000${span.dataset.learnedWordTarget || ""}`;

    if (key === reverseHoverKey) {
      positionTooltipOverSpan(span);
      return;
    }

    clearReverseHover();
    reverseHoverKey = key;
    const rows = dedupeHintRows([
      original,
      ...getHintMeaningsForTargetWord(span.dataset.learnedWordTarget)
    ]);
    const tooltip = setReverseHoverTooltipRows(rows);
    positionTooltipOverSpan(span);
    tooltip.dataset.visible = "true";
  }

  function positionTooltipOverSpan(span) {
    if (!span.isConnected) {
      return;
    }

    positionTooltipOverRect(span.getBoundingClientRect());
  }

  function positionTooltipOverRect(rect) {
    const tooltip = ensureReverseHoverTooltip();
    const centerX = Math.max(8, Math.min(globalThis.innerWidth - 8, rect.left + rect.width / 2));
    const fitsAbove = rect.top - tooltip.offsetHeight - 16 >= 4;
    tooltip.dataset.placement = fitsAbove ? "above" : "below";
    tooltip.style.left = `${centerX}px`;
    tooltip.style.top = `${fitsAbove ? rect.top : rect.bottom}px`;
  }

  function clearReverseHover() {
    reverseHoverRequestId += 1;
    reverseHoverKey = "";
    if (reverseHoverTimer) {
      clearTimeout(reverseHoverTimer);
      reverseHoverTimer = null;
    }
    if (reverseHoverTooltip?.isConnected) {
      reverseHoverTooltip.dataset.visible = "false";
    }
  }

  function removeReverseHoverTooltip() {
    clearReverseHover();
    reverseHoverTooltip?.remove();
    reverseHoverTooltip = null;
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    installReverseHoverTranslation,
    getReverseTranslator,
    clearReverseHover,
    removeReverseHoverTooltip
  });
})();
