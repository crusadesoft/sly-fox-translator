// Deciding which piece of a translated sentence a learned word actually earned.
//
// This is the hardest part of the extension and the most conservative. Finding
// a learned word in the translation is easy; proving which English word it came
// from is not, and a confident wrong answer teaches the learner something false.
// So four strategies run in order of trust — English-hint matching, the neural
// aligner, contradiction rejection, and a deletion probe that re-translates the
// sentence without one word to see what disappears — and anything still
// unresolved is dropped rather than guessed.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const WORD_ALIGNMENT_TIMEOUT_MS = 30000;
  const MAX_WORD_ALIGNMENT_CACHE_ENTRIES = 200;

  const ukrainianLemmaCache = new Map();
  const wordAlignmentCache = new Map();

  function createContextUnitsForNodes(nodes, block) {
    let text = "";
    const nodeRanges = [];

    for (const node of nodes) {
      const start = text.length;
      text += node.nodeValue;
      nodeRanges.push({
        node,
        start,
        end: text.length
      });
    }

    if (!text.trim()) {
      return [];
    }

    const sentenceRanges = splitSentenceRanges(text);
    return [
      {
        text,
        block,
        nodeRanges,
        sentenceRanges
      }
    ];
  }

  function splitSentenceRanges(text) {
    const ranges = [];
    let start = 0;
    let index = 0;

    while (index < text.length) {
      const char = text[index];
      if (!/[.!?;:。！？؟]/u.test(char)) {
        index += 1;
        continue;
      }

      let end = index + 1;
      while (end < text.length && /["')\]\u2019\u201d]/u.test(text[end])) {
        end += 1;
      }

      if (end === text.length || /\s/.test(text[end])) {
        addTrimmedRange(ranges, text, start, end);
        start = end;
      }

      index = end;
    }

    addTrimmedRange(ranges, text, start, text.length);
    return ranges.length ? ranges : [{ start: 0, end: text.length }];
  }

  function addTrimmedRange(ranges, text, start, end) {
    let trimmedStart = start;
    let trimmedEnd = end;

    while (trimmedStart < trimmedEnd && /\s/.test(text[trimmedStart])) {
      trimmedStart += 1;
    }

    while (trimmedEnd > trimmedStart && /\s/.test(text[trimmedEnd - 1])) {
      trimmedEnd -= 1;
    }

    if (trimmedStart < trimmedEnd) {
      ranges.push({ start: trimmedStart, end: trimmedEnd });
    }
  }

  function splitTranslatedSentences(text) {
    return splitSentenceRanges(text).map((range) => text.slice(range.start, range.end));
  }

  async function addConfirmedRangesFromTranslation(
    unit,
    translatedText,
    replacementsByNode,
    translator,
    targetLanguage,
    runId
  ) {
    const translatedSentences = splitTranslatedSentences(translatedText);
    const sentenceCountMatches = translatedSentences.length === unit.sentenceRanges.length;
    LWR.debugLog("unit", {
      text: unit.text.slice(0, 90),
      translated: String(translatedText).slice(0, 110),
      enSentences: unit.sentenceRanges.length,
      ukSentences: translatedSentences.length
    });

    if (!sentenceCountMatches) {
      // Punctuation can change during translation. Reusing the complete translation for
      // each source sentence can apply one translated word several times, so align once
      // and keep strict occurrence counts so one word cannot fan out across sentences.
      return addConfirmedRangesForTextRange(
        unit,
        { start: 0, end: unit.text.length },
        translatedText,
        replacementsByNode,
        translator,
        targetLanguage,
        runId,
        { sameWordFanOut: false }
      );
    }

    for (let index = 0; index < unit.sentenceRanges.length; index += 1) {
      if (runId !== LWR.applyRunId) {
        return false;
      }

      const sentenceRange = unit.sentenceRanges[index];
      const completed = await addConfirmedRangesForTextRange(
        unit,
        sentenceRange,
        translatedSentences[index],
        replacementsByNode,
        translator,
        targetLanguage,
        runId,
        { sameWordFanOut: true }
      );
      if (!completed) {
        return false;
      }
    }

    return true;
  }

  async function addConfirmedRangesForTextRange(
    unit,
    sourceRange,
    translatedText,
    replacementsByNode,
    translator,
    targetLanguage,
    runId,
    alignmentOptions = {}
  ) {
    const sourceText = unit.text.slice(sourceRange.start, sourceRange.end);
    const whitelistMatches = await findWhitelistMatchesInText(
      translatedText,
      targetLanguage,
      sourceText
    );
    const learnedReplacements = whitelistMatches.length
      ? await getAlignedSentenceReplacements(
          translator,
          targetLanguage,
          sourceText,
          translatedText,
          whitelistMatches,
          runId,
          alignmentOptions
        )
      : [];
    const replacements = LWR.mergeReplacementRanges(learnedReplacements);

    if (runId !== LWR.applyRunId) {
      return false;
    }

    if (replacements.length) {
      addConfirmedSentenceReplacements(unit, sourceRange, replacements, replacementsByNode);
    }

    return true;
  }

  async function getAlignedSentenceReplacements(
    translator,
    targetLanguage,
    sourceSentence,
    translatedText,
    whitelistMatches,
    runId,
    alignmentOptions = {}
  ) {
    const indexedMatches = whitelistMatches.map((match, index) => ({
      ...match,
      alignmentId: index
    }));
    const alignmentPairs = (await requestWordAlignment(sourceSentence, translatedText)).filter(
      (pair) => !pair.weak
    );

    if (runId !== LWR.applyRunId) {
      return [];
    }

    const credibleMatches = rejectMatchesContradictedByAlignment(
      sourceSentence,
      indexedMatches,
      alignmentPairs
    );
    const confidence = getConfidenceAlignedSentenceReplacements(
      sourceSentence,
      credibleMatches,
      alignmentOptions
    );
    let replacements = confidence.replacements;
    let unresolvedMatches = credibleMatches.filter(
      (match) => !confidence.resolvedMatchIds.has(match.alignmentId)
    );

    if (unresolvedMatches.length) {
      const neural = getNeuralAlignedSentenceReplacements(
        sourceSentence,
        alignmentPairs,
        unresolvedMatches,
        replacements
      );

      if (neural.replacements.length) {
        replacements = LWR.mergeReplacementRanges([...replacements, ...neural.replacements]);
        unresolvedMatches = unresolvedMatches.filter(
          (match) => !neural.resolvedMatchIds.has(match.alignmentId)
        );
      }
    }

    const deletionCandidates = unresolvedMatches.filter(allowsDeletionFallbackAlignment);
    if (!deletionCandidates.length) {
      return replacements;
    }

    const deletionReplacements = await getDeletionAlignedSentenceReplacements(
      translator,
      targetLanguage,
      sourceSentence,
      deletionCandidates,
      runId
    );

    return LWR.mergeReplacementRanges([...replacements, ...deletionReplacements]);
  }

  function getNeuralAlignedSentenceReplacements(
    sourceSentence,
    pairs,
    whitelistMatches,
    existingReplacements
  ) {
    const resolvedMatchIds = new Set();
    const replacements = [];

    if (!pairs.length) {
      return { replacements, resolvedMatchIds };
    }

    const usedRanges = existingReplacements.map((range) => ({
      start: range.start,
      end: range.end
    }));

    for (const match of whitelistMatches) {
      const matchStart = match.index;
      const matchEnd = match.index + match.target.length;
      const linkedPairs = pairs.filter(
        (pair) =>
          pair.tgtStart < matchEnd &&
          matchStart < pair.tgtEnd &&
          isReplaceableNeuralSourceSpan(sourceSentence.slice(pair.srcStart, pair.srcEnd)) &&
          !usedRanges.some((range) =>
            rangesOverlap(range, { start: pair.srcStart, end: pair.srcEnd })
          )
      );

      if (!linkedPairs.length) {
        continue;
      }

      const best = linkedPairs.reduce((a, b) => (b.score > a.score ? b : a));
      let start = best.srcStart;
      let end = best.srcEnd;

      // The aligner links compounds word-by-word ("cell phones" -> "телефонах");
      // grow the span over adjacent source words aligned to the same target word.
      let grew = true;
      while (grew) {
        grew = false;
        for (const pair of linkedPairs) {
          if (pair.srcStart >= start && pair.srcEnd <= end) {
            continue;
          }

          if (pair.srcEnd <= start && /^\s*$/u.test(sourceSentence.slice(pair.srcEnd, start))) {
            start = pair.srcStart;
            grew = true;
          } else if (pair.srcStart >= end && /^\s*$/u.test(sourceSentence.slice(end, pair.srcStart))) {
            end = pair.srcEnd;
            grew = true;
          }
        }
      }

      replacements.push({
        start,
        end,
        target: match.target,
        kind: match.kind
      });
      usedRanges.push({ start, end });
      resolvedMatchIds.add(match.alignmentId);
    }

    return { replacements, resolvedMatchIds };
  }

  // An entry's English hint appearing somewhere in the sentence is not proof
  // that the target word found in the translation is that hint's counterpart.
  // "Крім того" means "Additionally", but the lemma matcher sees "того" as a
  // form of "той" (that), and the sentence happened to contain "that" further
  // along — so "that" was overwritten with a word that, here, means nothing of
  // the sort. The aligner already knows "того" came from "Additionally", so when
  // it has a firm opinion and the hint disagrees with it, the hint is a
  // coincidence and the word is not being used in the sense the learner knows.
  //
  // Dropping the match is deliberate: placing it where the aligner points would
  // teach "того" = "Additionally", which is just as wrong. A missed highlight
  // costs the learner far less than a confidently wrong one.
  function rejectMatchesContradictedByAlignment(sourceSentence, matches, pairs) {
    if (!pairs.length) {
      return matches;
    }

    return matches.filter((match) => {
      // No hint in this sentence means there is nothing to contradict; those
      // matches are exactly what the neural pass exists to place.
      const hintCandidates = findSourceAlignmentCandidates(sourceSentence, match.entry);
      if (!hintCandidates.length) {
        return true;
      }

      const matchStart = match.index;
      const matchEnd = match.index + match.target.length;
      const alignedPairs = pairs.filter(
        (pair) =>
          pair.tgtStart < matchEnd &&
          matchStart < pair.tgtEnd &&
          isReplaceableNeuralSourceSpan(sourceSentence.slice(pair.srcStart, pair.srcEnd))
      );
      if (!alignedPairs.length) {
        return true;
      }

      const agrees = alignedPairs.some((pair) =>
        hintCandidates.some((candidate) =>
          rangesOverlap(
            { start: candidate.start, end: candidate.end },
            { start: pair.srcStart, end: pair.srcEnd }
          )
        )
      );

      if (!agrees) {
        LWR.debugLog("align-contradiction", {
          target: match.target,
          hints: hintCandidates.map((candidate) => candidate.value),
          aligned: alignedPairs.map((pair) => sourceSentence.slice(pair.srcStart, pair.srcEnd))
        });
      }

      return agrees;
    });
  }

  function isReplaceableNeuralSourceSpan(text) {
    // Words that contain digits ("1890s", "3rd") stay untouched: Ukrainian
    // often spells out an accompanying word for them ("1890-х років"), and the
    // aligner links the two, but replacing the number would erase its value.
    return /\p{L}/u.test(text) && !/\p{N}/u.test(text);
  }

  function allowsDeletionFallbackAlignment(match) {
    const sourceCandidates = match?.entry?.sourceCandidates;
    return !Array.isArray(sourceCandidates) || sourceCandidates.length === 0;
  }

  function getConfidenceAlignedSentenceReplacements(
    sourceSentence,
    whitelistMatches,
    alignmentOptions = {}
  ) {
    const replacements = [];
    const resolvedMatchIds = new Set();
    const usedRanges = [];
    const matchesByTarget = groupWhitelistMatchesByTarget(whitelistMatches);

    for (const matches of matchesByTarget.values()) {
      const candidates = getUniqueSourceAlignmentCandidates(
        matches.flatMap((match) => findSourceAlignmentCandidates(sourceSentence, match.entry))
      ).filter((candidate) => !usedRanges.some((range) => rangesOverlap(range, candidate)));

      if (!candidates.length) {
        continue;
      }

      // Inside one aligned sentence, when every English candidate is the same
      // word, occurrence counts can legitimately differ from the translation
      // (compounds such as "radio waves" -> "радіохвилі" absorb the word), so
      // replace every occurrence of that word instead of requiring a 1:1 count.
      // Articles and "to" have no direct translation, so never multiply those.
      const sameWordFanOut =
        alignmentOptions.sameWordFanOut !== false &&
        !LWR.ALIGNMENT_PREFIX_STOPWORDS.has(getSourceCandidateTerm(candidates[0])) &&
        candidates.every(
          (candidate) =>
            getSourceCandidateTerm(candidate) === getSourceCandidateTerm(candidates[0])
        );

      if (!sameWordFanOut && candidates.length !== matches.length) {
        LWR.debugLog("align-drop", {
          target: matches[0].target,
          matches: matches.length,
          candidates: candidates.length,
          sameWordFanOut
        });
        continue;
      }

      const orderedMatches = [...matches].sort(
        (a, b) => a.index - b.index || b.target.length - a.target.length
      );
      const orderedCandidates = candidates.sort((a, b) => a.start - b.start || b.end - a.end);
      const replacementCount = sameWordFanOut
        ? orderedCandidates.length
        : orderedMatches.length;

      for (let index = 0; index < replacementCount; index += 1) {
        const candidate = orderedCandidates[index];
        const match = orderedMatches[Math.min(index, orderedMatches.length - 1)];
        const target =
          index >= orderedMatches.length
            ? adaptTargetCaseToSource(match.target, candidate.value)
            : match.target;
        replacements.push({
          start: candidate.start,
          end: candidate.end,
          target,
          kind: match.kind
        });
        resolvedMatchIds.add(match.alignmentId);
        usedRanges.push({ start: candidate.start, end: candidate.end });
      }
    }

    return {
      replacements: replacements.sort((a, b) => a.start - b.start || b.end - a.end),
      resolvedMatchIds
    };
  }

  function groupWhitelistMatchesByTarget(matches) {
    const grouped = new Map();
    for (const match of matches) {
      const key = getTargetKey(match.target);
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key).push(match);
    }
    return grouped;
  }

  function findSourceAlignmentCandidates(sourceSentence, entry) {
    const candidates = [];
    const sourceCandidates = Array.isArray(entry?.sourceCandidates) ? entry.sourceCandidates : [];

    for (const candidate of sourceCandidates) {
      candidates.push(...findSourceAlignmentCandidateInText(sourceSentence, candidate));
    }

    return candidates;
  }

  function findSourceAlignmentCandidateInText(sourceSentence, candidate) {
    const haystack = sourceSentence.toLocaleLowerCase();
    const matches = [];

    for (const variant of getEnglishCandidateVariants(candidate.value)) {
      const needle = variant.toLocaleLowerCase();
      if (!needle) {
        continue;
      }

      let index = haystack.indexOf(needle);
      while (index >= 0) {
        if (passesEnglishBoundaryCheck(sourceSentence, index, variant.length)) {
          matches.push({
            start: index,
            end: index + variant.length,
            score: candidate.score,
            term: candidate.value,
            value: sourceSentence.slice(index, index + variant.length)
          });
        }

        index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
      }
    }

    return matches;
  }

  function getSourceCandidateTerm(candidate) {
    return String(candidate.term || candidate.value || "").toLocaleLowerCase();
  }

  function getEnglishCandidateVariants(value) {
    const base = String(value || "").trim();
    const variants = new Set([base]);

    if (base.length < 3) {
      return variants;
    }

    if (/[b-df-hj-np-tv-z]y$/iu.test(base)) {
      variants.add(base.replace(/y$/iu, "ies"));
    } else if (/[a-z]$/iu.test(base)) {
      variants.add(`${base}s`);
      variants.add(`${base}es`);
      variants.add(`${base}'s`);
    }

    if (/[a-z]{3,}s$/iu.test(base) && !/ss$/iu.test(base)) {
      variants.add(base.replace(/s$/iu, ""));
    }

    return variants;
  }

  // Scaffold English takes its case from the Ukrainian word it stands in for,
  // which is right for a capital the sentence merely forced, and wrong for one
  // the word carries itself. English capitalises "I" wherever it stands, and
  // capitalises languages, months and weekdays where Ukrainian does not, so
  // matching a lowercase Ukrainian token produced "i'm", "monday", "ukrainian".
  // A word already seen mid-sentence in the source never got its capital from
  // position, so its capital is its own.
  const ALWAYS_CAPITAL_ENGLISH = /^I(['’ʼ](m|ve|ll|d))?$/u;

  function hasIntrinsicEnglishCapital(english, sourceSentence) {
    const firstWord = String(english || "").split(/\s+/u)[0] || "";

    if (ALWAYS_CAPITAL_ENGLISH.test(firstWord)) {
      return true;
    }

    if (!/^\p{Lu}/u.test(firstWord)) {
      return false;
    }

    return String(sourceSentence || "").indexOf(english) > 0;
  }

  function adaptEnglishScaffoldCase(english, targetToken, sourceSentence) {
    if (hasIntrinsicEnglishCapital(english, sourceSentence)) {
      return english;
    }

    return adaptTargetCaseToSource(english, targetToken);
  }

  function adaptTargetCaseToSource(target, sourceValue) {
    const targetFirst = String(target || "").charAt(0);
    const sourceFirst = String(sourceValue || "").charAt(0);
    if (!targetFirst || !sourceFirst || target.slice(1) !== target.slice(1).toLocaleLowerCase()) {
      return target;
    }

    if (sourceFirst === sourceFirst.toLocaleLowerCase() && targetFirst !== targetFirst.toLocaleLowerCase()) {
      return targetFirst.toLocaleLowerCase() + target.slice(1);
    }

    if (sourceFirst !== sourceFirst.toLocaleLowerCase() && targetFirst === targetFirst.toLocaleLowerCase()) {
      return targetFirst.toLocaleUpperCase() + target.slice(1);
    }

    return target;
  }

  function getUniqueSourceAlignmentCandidates(candidates) {
    const byRange = new Map();

    for (const candidate of candidates) {
      const key = `${candidate.start}:${candidate.end}`;
      const existing = byRange.get(key);
      if (!existing || candidate.score > existing.score) {
        byRange.set(key, candidate);
      }
    }

    return Array.from(byRange.values()).sort(
      (a, b) => b.score - a.score || a.start - b.start || b.end - a.end
    );
  }

  function rangesOverlap(a, b) {
    return a.start < b.end && b.start < a.end;
  }

  async function getDeletionAlignedSentenceReplacements(
    translator,
    targetLanguage,
    sourceSentence,
    whitelistMatches,
    runId
  ) {
    const tokens = getReplaceableSourceTokens(sourceSentence);
    const baselineCounts = countMatchesByTargetKey(whitelistMatches);
    if (!tokens.length || !baselineCounts.size) {
      return [];
    }

    const candidatesByTarget = new Map();
    const deletionItems = [];

    for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
      if (runId !== LWR.applyRunId) {
        return [];
      }

      const token = tokens[tokenIndex];
      const deletionText = removeSourceTokenForAlignment(sourceSentence, token);
      if (!deletionText || deletionText === sourceSentence) {
        continue;
      }

      deletionItems.push({
        tokenIndex,
        deletionText
      });
    }

    const translatedDeletions = await LWR.translateContextTexts(
      translator,
      targetLanguage,
      deletionItems.map((item) => item.deletionText),
      {
        readCache: false,
        writeCache: false
      }
    );

    for (let index = 0; index < deletionItems.length; index += 1) {
      if (runId !== LWR.applyRunId) {
        return [];
      }

      const translatedDeletion = translatedDeletions[index];
      if (!translatedDeletion) {
        continue;
      }

      const { tokenIndex } = deletionItems[index];
      const deletionCounts = countMatchesByTargetKey(
        await findWhitelistMatchesInText(translatedDeletion, targetLanguage)
      );
      for (const [targetKey, baselineCount] of baselineCounts.entries()) {
        const deletionCount = deletionCounts.get(targetKey) || 0;
        if (deletionCount >= baselineCount) {
          continue;
        }

        if (!candidatesByTarget.has(targetKey)) {
          candidatesByTarget.set(targetKey, []);
        }
        candidatesByTarget.get(targetKey).push({
          tokenIndex,
          drop: baselineCount - deletionCount
        });
      }
    }

    await refineAmbiguousDeletionCandidates(
      candidatesByTarget,
      baselineCounts,
      deletionItems,
      translator,
      targetLanguage,
      runId
    );

    return chooseDeletionAlignedReplacements(tokens, whitelistMatches, candidatesByTarget);
  }

  async function refineAmbiguousDeletionCandidates(
    candidatesByTarget,
    baselineCounts,
    deletionItems,
    translator,
    targetLanguage,
    runId
  ) {
    const deletionTextByTokenIndex = new Map(
      deletionItems.map((item) => [item.tokenIndex, item.deletionText])
    );

    for (const [targetKey, candidates] of candidatesByTarget.entries()) {
      const baselineCount = baselineCounts.get(targetKey) || 0;
      const uniqueCandidates = getUniqueAlignmentCandidates(candidates);
      if (uniqueCandidates.length <= baselineCount) {
        continue;
      }

      const refinedCandidates = [];
      for (const candidate of uniqueCandidates) {
        if (runId !== LWR.applyRunId) {
          return;
        }

        const deletionText = deletionTextByTokenIndex.get(candidate.tokenIndex);
        if (!deletionText) {
          continue;
        }

        const translatedDeletion = await LWR.translateContextText(
          translator,
          targetLanguage,
          deletionText,
          {
            readCache: false,
            writeCache: false
          }
        );
        const deletionCounts = countMatchesByTargetKey(
          await findWhitelistMatchesInText(translatedDeletion, targetLanguage)
        );
        if ((deletionCounts.get(targetKey) || 0) < baselineCount) {
          refinedCandidates.push(candidate);
        }
      }

      candidatesByTarget.set(targetKey, refinedCandidates);
    }
  }

  function getReplaceableSourceTokens(text) {
    const tokens = [];
    let index = 0;

    while (index < text.length) {
      if (!LWR.isWordCharacter(text[index])) {
        index += 1;
        continue;
      }

      const start = index;
      index += 1;

      while (index < text.length) {
        const char = text[index];
        if (LWR.isWordCharacter(char)) {
          index += 1;
          continue;
        }

        // An apostrophe between two letters is word-internal in every language
        // here: English contractions ("don't"), French elision ("l'homme") and
        // Ukrainian's hard separator ("православ'я") are all single words.
        if (LWR.isWordInternalApostrophe(text, index) || LWR.isCyrillicCompoundHyphen(text, index)) {
          index += 1;
          continue;
        }

        break;
      }

      const value = text.slice(start, index);
      if (/\p{L}/u.test(value)) {
        tokens.push({ start, end: index, value });
      }
    }

    return tokens;
  }

  function removeSourceTokenForAlignment(text, token) {
    const before = text.slice(0, token.start).replace(/\s+$/u, "");
    const after = text.slice(token.end).replace(/^\s+/u, "");
    const needsSpace = before && after && !/^[,.;:!?)]/u.test(after);
    return `${before}${needsSpace ? " " : ""}${after}`.trim();
  }

  function countMatchesByTargetKey(matches) {
    const counts = new Map();
    for (const match of matches) {
      const key = getTargetKey(match.target);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }

  function getTargetKey(target) {
    return String(target || "").trim().toLocaleLowerCase();
  }

  function chooseDeletionAlignedReplacements(tokens, whitelistMatches, candidatesByTarget) {
    const replacements = [];
    const usedTokenIndexes = new Set();
    const orderedMatches = [...whitelistMatches].sort(
      (a, b) => a.index - b.index || b.target.length - a.target.length
    );
    const matchesByTarget = new Map();

    for (const match of orderedMatches) {
      const key = getTargetKey(match.target);
      if (!matchesByTarget.has(key)) {
        matchesByTarget.set(key, []);
      }
      matchesByTarget.get(key).push(match);
    }

    for (const matches of matchesByTarget.values()) {
      const candidates = getUniqueAlignmentCandidates(
        candidatesByTarget.get(getTargetKey(matches[0].target))
      ).filter((item) => !usedTokenIndexes.has(item.tokenIndex));

      if (candidates.length !== matches.length) {
        continue;
      }

      for (let index = 0; index < matches.length; index += 1) {
        const candidate = candidates[index];
        const token = tokens[candidate.tokenIndex];
        usedTokenIndexes.add(candidate.tokenIndex);
        replacements.push({
          start: token.start,
          end: token.end,
          target: matches[index].target,
          kind: matches[index].kind
        });
      }
    }
    return replacements.sort((a, b) => a.start - b.start || b.end - a.end);
  }

  function getUniqueAlignmentCandidates(candidates = []) {
    const byTokenIndex = new Map();

    for (const candidate of candidates) {
      const existing = byTokenIndex.get(candidate.tokenIndex);
      if (!existing || candidate.drop > existing.drop) {
        byTokenIndex.set(candidate.tokenIndex, candidate);
      }
    }

    return Array.from(byTokenIndex.values()).sort(
      (a, b) => a.tokenIndex - b.tokenIndex || b.drop - a.drop
    );
  }

  async function findWhitelistMatchesInText(translatedText, targetLanguage, sourceText = "") {
    // Both matchers read the same sentence, so it is tokenized once and they
    // share the result. Everything below works on whole tokens: an entry can
    // only ever claim complete words, never a slice of one.
    const tokenIndex = buildSentenceTokenIndex(translatedText);
    const exactMatches = LWR.compiledEntries.flatMap((entry) =>
      findTargetCandidateMatches(tokenIndex, entry).map((match) => ({
        ...match,
        entry
      }))
    );
    const wordFamilyMatches =
      targetLanguage === "uk" ? await findUkrainianWordFamilyMatchesInText(tokenIndex) : [];

    // Several entries can claim the same translated word (ambiguous Ukrainian
    // forms share lemmas, e.g. "їх" is a form of both "вони" and "їхати").
    // Keep the entry whose English hints actually appear in the source text,
    // so alignment gets the entry that can succeed.
    const bestByKey = new Map();
    for (const match of [...exactMatches, ...wordFamilyMatches]) {
      const key = `${match.index}:${match.target.toLocaleLowerCase()}`;
      const existing = bestByKey.get(key);
      if (
        !existing ||
        (!entryHasSourceEvidence(existing.entry, sourceText) &&
          entryHasSourceEvidence(match.entry, sourceText))
      ) {
        bestByKey.set(key, match);
      }
    }

    return Array.from(bestByKey.values()).sort(
      (a, b) => a.index - b.index || b.target.length - a.target.length
    );
  }

  function entryHasSourceEvidence(entry, sourceText) {
    if (!sourceText) {
      return false;
    }

    return findSourceAlignmentCandidates(sourceText, entry).length > 0;
  }

  function findTargetCandidateMatches(tokenIndex, entry) {
    return entry.targetCandidates
      .flatMap((candidate) => findTargetCandidateTokenMatches(tokenIndex, candidate))
      .sort((a, b) => a.index - b.index || b.target.length - a.target.length);
  }

  async function findUkrainianWordFamilyMatchesInText(tokenIndex) {
    const translatedTokens = tokenIndex.tokens;
    const targetTerms = getSingleWordTargetTerms();
    if (!translatedTokens.length || !targetTerms.length) {
      return [];
    }

    const lemmasByWord = await getUkrainianLemmas([
      ...translatedTokens.map((token) => token.value),
      ...targetTerms.map((term) => term.value)
    ]);
    const entriesByLemma = new Map();

    for (const term of targetTerms) {
      for (const lemma of lemmasByWord.get(normalizeUkrainianMorphologyWord(term.value)) || []) {
        if (!entriesByLemma.has(lemma)) {
          entriesByLemma.set(lemma, []);
        }

        entriesByLemma.get(lemma).push(term.entry);
      }
    }

    const matches = [];
    for (const token of translatedTokens) {
      const tokenLemmas = lemmasByWord.get(normalizeUkrainianMorphologyWord(token.value)) || [];
      for (const lemma of tokenLemmas) {
        for (const entry of entriesByLemma.get(lemma) || []) {
          matches.push({
            index: token.start,
            target: token.value,
            kind: LWR.WORD_FAMILY_MATCH_KIND,
            entry
          });
        }
      }
    }

    return matches;
  }

  function getSingleWordTargetTerms() {
    return LWR.compiledEntries.flatMap((entry) =>
      entry.targetCandidates
        .map((candidate) => String(candidate || "").trim())
        .filter((candidate) => {
          const tokens = getReplaceableSourceTokens(candidate);
          return tokens.length === 1 && tokens[0].value === candidate;
        })
        .map((value) => ({ entry, value }))
    );
  }

  async function getUkrainianLemmas(words) {
    const normalizedWords = Array.from(
      new Set(words.map(normalizeUkrainianMorphologyWord).filter(Boolean))
    );
    const missingWords = normalizedWords.filter((word) => !ukrainianLemmaCache.has(word));

    if (missingWords.length) {
      const received = await requestUkrainianLemmas(missingWords);
      for (const word of missingWords) {
        ukrainianLemmaCache.set(word, received.get(word) || []);
      }
    }

    return new Map(normalizedWords.map((word) => [word, ukrainianLemmaCache.get(word) || []]));
  }

  async function requestUkrainianLemmas(words) {
    const configuredLemmas = LWR.getRuntimeConfig().ukrainianLemmas;
    if (configuredLemmas && typeof configuredLemmas === "object") {
      return new Map(
        words.map((word) => [
          word,
          Array.isArray(configuredLemmas[word]) ? configuredLemmas[word] : []
        ])
      );
    }

    if (!globalThis.chrome?.runtime?.sendMessage) {
      return new Map();
    }

    return new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => finish(), 3000);
      const finish = (response) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        const lemmas = response?.ok && response.lemmas && typeof response.lemmas === "object"
          ? response.lemmas
          : {};
        resolve(
          new Map(
            words.map((word) => [
              word,
              Array.isArray(lemmas[word]) ? lemmas[word] : []
            ])
          )
        );
      };

      try {
        chrome.runtime.sendMessage({ type: "LWR_LOOKUP_UK_LEMMAS", words }, finish);
      } catch (error) {
        finish();
      }
    });
  }

  function normalizeUkrainianMorphologyWord(word) {
    return String(word || "").trim().toLocaleLowerCase("uk");
  }

  async function requestWordAlignment(sourceText, translatedText) {
    const cacheKey = `${sourceText}\u0000${translatedText}`;
    if (wordAlignmentCache.has(cacheKey)) {
      return wordAlignmentCache.get(cacheKey);
    }

    const pairs = normalizeWordAlignmentPairs(
      await requestWordAlignmentPairs(sourceText, translatedText)
    );
    wordAlignmentCache.set(cacheKey, pairs);
    if (wordAlignmentCache.size > MAX_WORD_ALIGNMENT_CACHE_ENTRIES) {
      wordAlignmentCache.delete(wordAlignmentCache.keys().next().value);
    }

    return pairs;
  }

  async function requestWordAlignmentPairs(sourceText, translatedText) {
    const config = LWR.getRuntimeConfig();
    if (Object.prototype.hasOwnProperty.call(config, "wordAligner")) {
      if (typeof config.wordAligner !== "function") {
        return [];
      }

      try {
        return await config.wordAligner(sourceText, translatedText);
      } catch (error) {
        return [];
      }
    }

    if (!globalThis.chrome?.runtime?.sendMessage) {
      return [];
    }

    return new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => finish(), WORD_ALIGNMENT_TIMEOUT_MS);
      const finish = (response) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeout);
        if (!response?.ok) {
          LWR.debugLog("align-error", {
            error: response?.error || chrome.runtime?.lastError?.message || "no response"
          });
        }
        resolve(response?.ok && Array.isArray(response.pairs) ? response.pairs : []);
      };

      try {
        chrome.runtime.sendMessage(
          { type: "LWR_ALIGN_WORDS", source: sourceText, translated: translatedText },
          finish
        );
      } catch (error) {
        finish();
      }
    });
  }

  function normalizeWordAlignmentPairs(pairs) {
    return (Array.isArray(pairs) ? pairs : [])
      .map((pair) => ({
        srcStart: Math.max(0, Number(pair.srcStart) || 0),
        srcEnd: Math.max(0, Number(pair.srcEnd) || 0),
        tgtStart: Math.max(0, Number(pair.tgtStart) || 0),
        tgtEnd: Math.max(0, Number(pair.tgtEnd) || 0),
        score: Number(pair.score) || 0,
        weak: Boolean(pair.weak)
      }))
      .filter((pair) => pair.srcStart < pair.srcEnd && pair.tgtStart < pair.tgtEnd);
  }

  // Splitting the sentence into words first, then matching whole words, is what
  // makes it structurally impossible for an entry to claim part of a word. The
  // old approach searched the raw string and asked afterwards whether the hit
  // happened to land on a boundary, so every punctuation mark the boundary rule
  // did not know about ("православ'я", "будь-яку") became a fresh bug.
  function buildSentenceTokenIndex(text) {
    const tokens = getReplaceableSourceTokens(text);
    const positionsByValue = new Map();

    tokens.forEach((token, position) => {
      const key = token.value.toLocaleLowerCase();
      const positions = positionsByValue.get(key);

      if (positions) {
        positions.push(position);
      } else {
        positionsByValue.set(key, [position]);
      }
    });

    return { text, tokens, positionsByValue };
  }

  function findTargetCandidateTokenMatches(tokenIndex, candidate) {
    const candidateTokens = getCandidateTokenValues(candidate);
    if (!candidateTokens.length) {
      return [];
    }

    const matches = [];

    for (const position of tokenIndex.positionsByValue.get(candidateTokens[0]) || []) {
      const last = position + candidateTokens.length - 1;
      if (last >= tokenIndex.tokens.length) {
        continue;
      }

      // Multi-word entries match a run of adjacent tokens. Only non-word
      // characters can sit between adjacent tokens, so nothing of substance is
      // being skipped over.
      const runMatches = candidateTokens.every(
        (value, offset) =>
          tokenIndex.tokens[position + offset].value.toLocaleLowerCase() === value
      );
      if (!runMatches) {
        continue;
      }

      const start = tokenIndex.tokens[position].start;
      const end = tokenIndex.tokens[last].end;
      matches.push({
        index: start,
        target: tokenIndex.text.slice(start, end),
        kind: "exact"
      });
    }

    return matches;
  }

  function getCandidateTokenValues(candidate) {
    const key = String(candidate || "");
    const cached = LWR.candidateTokenValueCache.get(key);
    if (cached) {
      return cached;
    }

    const values = getReplaceableSourceTokens(key).map((token) =>
      token.value.toLocaleLowerCase()
    );
    LWR.candidateTokenValueCache.set(key, values);

    return values;
  }

  // Only the English source sentence is matched this way, and only to decide
  // whether an entry's English hint is present at all — nothing here reaches the
  // page. Substring semantics are wanted: "Orthodoxy" inside "Orthodoxy's" is
  // good alignment evidence. Target-language matching goes through the tokenizer
  // instead (buildSentenceTokenIndex), where partial words cannot occur.
  function passesEnglishBoundaryCheck(text, start, length) {
    const first = text[start];
    const last = text[start + length - 1];

    if (!LWR.isWordCharacter(first) && !LWR.isWordCharacter(last)) {
      return true;
    }

    if (LWR.isWordCharacter(first) && LWR.isWordCharacter(text[start - 1])) {
      return false;
    }

    if (LWR.isWordCharacter(last) && LWR.isWordCharacter(text[start + length])) {
      return false;
    }

    return true;
  }

  function addConfirmedSentenceReplacements(unit, sentenceRange, replacements, replacementsByNode) {
    for (const replacement of replacements) {
      const absoluteStart = sentenceRange.start + replacement.start;
      const absoluteEnd = sentenceRange.start + replacement.end;

      for (const nodeRange of unit.nodeRanges) {
        if (absoluteStart < nodeRange.start || absoluteEnd > nodeRange.end) {
          continue;
        }

        if (!replacementsByNode.has(nodeRange.node)) {
          replacementsByNode.set(nodeRange.node, []);
        }

        replacementsByNode.get(nodeRange.node).push({
          start: absoluteStart - nodeRange.start,
          end: absoluteEnd - nodeRange.start,
          target: replacement.target,
          kind: replacement.kind
        });
        break;
      }
    }
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    createContextUnitsForNodes,
    splitTranslatedSentences,
    addConfirmedRangesFromTranslation,
    addConfirmedSentenceReplacements,
    findWhitelistMatchesInText,
    requestWordAlignment,
    getUkrainianLemmas,
    normalizeUkrainianMorphologyWord,
    getReplaceableSourceTokens,
    isReplaceableNeuralSourceSpan,
    adaptEnglishScaffoldCase,
    rangesOverlap
  });
})();
