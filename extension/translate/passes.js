// One pass over a set of blocks.
//
// Two directions share the shape. The forward pass takes an English page and
// swaps in the target-language words you have learned. The reverse pass is its
// mirror, for pages already written in the target language: the page's own
// sentence stays as the frame and the words you have *not* learned are swapped
// to English, so the target language is what you read and English is only the
// scaffold.
//
// Blocks are painted one at a time rather than all at the end, so a long page
// fills in as it goes instead of sitting blank until the last block lands.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  async function processContextRoot(root, runId, options = {}) {
    const targetLanguage = LWR.getCurrentLanguageCode();
    const collectedUnits = options.roots
      ? LWR.collectContextUnitsFromRoots(options.roots)
      : LWR.collectContextUnits(root);
    LWR.updateRuntimeStats({
      targetLanguage,
      unitsCollected: collectedUnits.length
    });

    if (!collectedUnits.length) {
      return;
    }

    // Hiding text is strictly a first-paint concern. While the page is still
    // cloaked the reader has seen nothing yet, so this pass's blocks take over
    // the hide individually and the page is handed back — the untranslated
    // wording is never on screen. Once the reader has the page, later passes
    // (scrolling into new text) must never blank anything out: text vanishing
    // from under someone who is reading is worse than watching it swap.
    if (LWR.isPageCloaked()) {
      LWR.beginPendingHide(collectedUnits);
      LWR.uncloakPage();
    }

    const units = collectedUnits.filter((unit) => !unit.reverse);
    const reverseUnits = collectedUnits.filter((unit) => unit.reverse);

    if (units.length) {
      await processForwardUnits(units, targetLanguage, runId, options);
    }

    if (reverseUnits.length && runId === LWR.applyRunId) {
      await processReverseUnits(reverseUnits, targetLanguage, runId);
    }
  }

  async function processForwardUnits(units, targetLanguage, runId, options = {}) {
    const translator = await LWR.getContextTranslator(targetLanguage, options);

    if (!translator || runId !== LWR.applyRunId) {
      return;
    }

    const replacementsByNode = new Map();
    LWR.updateRuntimeStats({
      status: "translating",
      targetLanguage
    });
    // Each block is its own unit, so a finished unit's text nodes are never
    // touched again by later units and its replacements can be painted right
    // away instead of holding the whole pass invisible until the last block.
    let nextUnitIndex = 0;
    let halted = false;

    const processTranslatedUnits = async (translatedTexts, limit) => {
      while (nextUnitIndex < limit && !halted) {
        const index = nextUnitIndex;
        nextUnitIndex += 1;

        if (runId !== LWR.applyRunId) {
          halted = true;
          return;
        }

        if (LWR.runtimeStats.translationCalls >= LWR.getMaxTranslationCallsPerPass()) {
          LWR.updateRuntimeStats({
            unitsSkipped: LWR.runtimeStats.unitsSkipped + units.length - index,
            lastError: "Translation budget reached for this pass."
          });
          halted = true;
          return;
        }

        const unit = units[index];
        // Everything below reads or rewrites this block's text, so it has to
        // stop churning first.
        LWR.endPendingHide(unit);
        LWR.updateRuntimeStats({ unitsProcessed: LWR.runtimeStats.unitsProcessed + 1 });

        const translatedText = translatedTexts[index];
        if (!translatedText) {
          // Nothing usable came back for this block. Remember it anyway: an
          // unrecorded block is collected again by every later pass, which on
          // a long page means the same untouched text churns on every scroll.
          LWR.recordProcessedUnit(unit);
          LWR.markCheckedBlock(unit.block);
          continue;
        }

        if (
          (LWR.state.fullTranslation || LWR.state.structureMode) &&
          LWR.isSafeToRestructureBlock(unit.block, unit.text)
        ) {
          const structured = await LWR.applyStructuredUnit(unit, translatedText, targetLanguage, runId);
          if (structured === LWR.STRUCTURED_UNIT_HALTED) {
            halted = true;
            return;
          }

          if (structured === LWR.STRUCTURED_UNIT_APPLIED) {
            LWR.recordProcessedUnit(unit);
            LWR.markCheckedBlock(unit.block);
            if (index % 4 === 3) {
              await LWR.yieldToBrowser();
            }
            continue;
          }

          // STRUCTURED_UNIT_REJECTED: the translation failed the fidelity
          // checks, so this block gets plain per-word replacement instead.
        }

        const completed = await LWR.addConfirmedRangesFromTranslation(
          unit,
          translatedText,
          replacementsByNode,
          translator,
          targetLanguage,
          runId
        );
        if (!completed) {
          halted = true;
          return;
        }

        applyNodeReplacements(replacementsByNode);
        LWR.recordProcessedUnit(unit);
        LWR.markCheckedBlock(unit.block);

        if (index % 4 === 3) {
          await LWR.yieldToBrowser();
        }
      }
    };

    const translatedTexts = await LWR.translateContextTexts(
      translator,
      targetLanguage,
      units.map((unit) => unit.text),
      { onBatchTranslated: processTranslatedUnits }
    );

    // Units whose translations all came from cache never trigger a batch
    // callback, so finish whatever is left.
    await processTranslatedUnits(translatedTexts, units.length);
  }

  // The mirror of the English→target pass, for pages that are already written
  // in the target language. The page's own sentence stays as the frame — no
  // machine-written target text is ever painted in — and every word the
  // learner has not studied is swapped to its aligned English, so the target
  // language's structure can be read directly with broken English as the
  // scaffold instead of the other way round.
  async function processReverseUnits(units, targetLanguage, runId) {
    const translator = await LWR.getReverseTranslator(targetLanguage);

    if (runId !== LWR.applyRunId) {
      return;
    }

    if (!translator) {
      // Say WHY nothing happened. "unavailable" is Chrome refusing the pair
      // outright — usually its on-device translator service needs a browser
      // restart — and no amount of clicking will change that. Anything else
      // armed the next trusted click, which refreshes the page.
      const unavailable = LWR.reverseTranslatorAvailability === "unavailable";
      LWR.updateRuntimeStats({
        unitsSkipped: LWR.runtimeStats.unitsSkipped + units.length,
        status: LWR.runtimeStats.replacementCount
          ? LWR.runtimeStats.status
          : unavailable
            ? "translator-unavailable"
            : "translator-not-ready",
        lastError: unavailable
          ? `Chrome Translator is not available for ${targetLanguage} to English. Restarting Chrome usually restores it.`
          : `Chrome needs one click on this page to prepare Translator for ${targetLanguage} to English.`
      });
      return;
    }

    const replacementsByNode = new Map();
    LWR.updateRuntimeStats({
      status: "translating",
      targetLanguage
    });

    let nextUnitIndex = 0;
    let halted = false;

    const processTranslatedUnits = async (englishTexts, limit) => {
      while (nextUnitIndex < limit && !halted) {
        const index = nextUnitIndex;
        nextUnitIndex += 1;

        if (runId !== LWR.applyRunId) {
          halted = true;
          return;
        }

        if (LWR.runtimeStats.translationCalls >= LWR.getMaxTranslationCallsPerPass()) {
          LWR.updateRuntimeStats({
            unitsSkipped: LWR.runtimeStats.unitsSkipped + units.length - index,
            lastError: "Translation budget reached for this pass."
          });
          halted = true;
          return;
        }

        const unit = units[index];
        // Everything below reads or rewrites this block's text, so it has to
        // stop churning first.
        LWR.endPendingHide(unit);
        LWR.updateRuntimeStats({ unitsProcessed: LWR.runtimeStats.unitsProcessed + 1 });

        const englishText = englishTexts[index];
        if (!englishText) {
          LWR.recordProcessedUnit(unit);
          LWR.markCheckedBlock(unit.block);
          continue;
        }

        const completed = await addReverseRangesFromTranslation(
          unit,
          englishText,
          replacementsByNode,
          targetLanguage,
          runId
        );
        if (!completed) {
          halted = true;
          return;
        }

        applyNodeReplacements(replacementsByNode);
        LWR.recordProcessedUnit(unit);
        LWR.markCheckedBlock(unit.block);

        if (index % 4 === 3) {
          await LWR.yieldToBrowser();
        }
      }
    };

    // The cache is namespaced by the language the text is translated INTO, so
    // English keys can never collide with the forward direction's target-language
    // ones for the same string.
    const englishTexts = await LWR.translateContextTexts(
      translator,
      LWR.SOURCE_LANGUAGE,
      units.map((unit) => unit.text),
      { onBatchTranslated: processTranslatedUnits }
    );

    await processTranslatedUnits(englishTexts, units.length);
  }

  async function addReverseRangesFromTranslation(
    unit,
    englishText,
    replacementsByNode,
    targetLanguage,
    runId
  ) {
    const englishSentences = LWR.splitTranslatedSentences(englishText);
    // Punctuation can change during translation; without a 1:1 sentence match
    // the whole unit is aligned as a single pair rather than risking English
    // from one sentence landing in another.
    const pairs =
      englishSentences.length === unit.sentenceRanges.length
        ? unit.sentenceRanges.map((range, index) => ({
            range,
            english: englishSentences[index]
          }))
        : [{ range: { start: 0, end: unit.text.length }, english: englishText }];

    for (const pair of pairs) {
      const targetSentence = unit.text.slice(pair.range.start, pair.range.end);
      if (!targetSentence.trim() || !String(pair.english || "").trim()) {
        continue;
      }

      const whitelistMatches = await LWR.findWhitelistMatchesInText(
        targetSentence,
        targetLanguage,
        pair.english
      );
      const alignmentPairs = await LWR.requestWordAlignment(pair.english, targetSentence);
      if (runId !== LWR.applyRunId) {
        return false;
      }

      const ranges = buildReverseReplacementRanges(
        targetSentence,
        pair.english,
        whitelistMatches,
        alignmentPairs
      );
      if (ranges.length) {
        LWR.addConfirmedSentenceReplacements(unit, pair.range, ranges, replacementsByNode);
      }
    }

    return true;
  }

  // Ranges over the page's own target-language sentence: learned words keep
  // their text (wrapped so they stay highlighted and hoverable), and every
  // other aligned word is replaced by its English. Words the aligner could not
  // resolve are left untouched — hovering them still answers with English.
  function buildReverseReplacementRanges(
    targetSentence,
    englishSentence,
    whitelistMatches,
    alignmentPairs
  ) {
    const knownRanges = LWR.getMergedKnownRanges(whitelistMatches);
    const strongPairs = alignmentPairs.filter((pair) => !pair.weak);
    const usedEnglishSpans = LWR.createUsedEnglishSpans();
    const ranges = [];

    for (const token of LWR.getReplaceableSourceTokens(targetSentence)) {
      const known = knownRanges.find(
        (range) => range.start <= token.start && token.start < range.end
      );
      if (known) {
        // The learned word is left standing in the target language, and the
        // reader already reads its English off it. Claim that English so the
        // next word cannot say it a second time.
        LWR.claimEnglishForKnownRange(strongPairs, englishSentence, known, usedEnglishSpans);
        ranges.push({
          start: known.start,
          end: known.end,
          target: targetSentence.slice(known.start, known.end),
          kind: known.kind
        });
        continue;
      }

      const english = LWR.collectAlignedEnglish(
        strongPairs,
        englishSentence,
        token.start,
        token.end,
        usedEnglishSpans
      );
      if (!english) {
        continue;
      }

      ranges.push({
        start: token.start,
        end: token.end,
        target: LWR.adaptEnglishScaffoldCase(english, token.value, englishSentence),
        kind: LWR.BACK_TRANSLATION_MATCH_KIND
      });
    }

    return LWR.mergeReplacementRanges(ranges);
  }

  function applyNodeReplacements(replacementsByNode) {
    for (const [node, ranges] of replacementsByNode.entries()) {
      if (!node.isConnected || LWR.shouldIgnoreTextNode(node)) {
        continue;
      }

      const parts = LWR.buildReplacementPartsForRanges(node.nodeValue, ranges);
      if (parts) {
        const replacementParts = parts.filter((part) => part.type === "replacement");
        LWR.updateRuntimeStats({
          // Scaffold words (the English painted into target-language pages) are
          // not learned-word replacements, and countExistingReplacements skips
          // them too, so the two counts stay in step across passes.
          replacementCount:
            LWR.runtimeStats.replacementCount +
            replacementParts.filter(
              (part) =>
                part.kind !== LWR.BACK_TRANSLATION_MATCH_KIND && part.kind !== LWR.UNLEARNED_MATCH_KIND
            ).length,
          wordFamilyReplacementCount:
            LWR.runtimeStats.wordFamilyReplacementCount +
            replacementParts.filter((part) => part.kind === LWR.WORD_FAMILY_MATCH_KIND).length
        });
        LWR.replaceTextNodeWithParts(node, parts);
      }
    }

    replacementsByNode.clear();
  }

  // Reached for by other modules.
  Object.assign(LWR, { processContextRoot });
})();
