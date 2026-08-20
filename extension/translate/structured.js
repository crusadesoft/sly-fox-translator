// Structure mode: rebuilding a whole block from its translation instead of
// swapping words inside it.
//
// This is the riskiest thing the extension does, so most of the file is about
// refusing to do it. A block is only rebuilt when it is pure prose, when every
// element in it can survive being cloned, and when the translation that came
// back still contains every distinctive word the original had. Anything else
// falls back to plain per-word replacement.
//
// It also owns the two marks a finished block carries: the record of what the
// block looked like (so later passes skip it) and the dot that says it was
// checked and left alone.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  // Content that cannot survive a block being rebuilt from its own text: it
  // carries something other than words (an image, a control, a media element),
  // so a block holding any of it is left to per-word replacement instead.
  // Still-image content (an avatar, an icon) is carried across untouched, so it
  // does not make a block unsafe. What does is content that cannot be moved
  // without losing something: a control loses its listeners, a video restarts,
  // a canvas or iframe comes back blank.
  // Plain HTML text wrappers, safe to copy: they have no state of their own
  // beyond their attributes. Anything else in a block — a framework element —
  // is left where it stands instead.
  const STRUCTURE_SAFE_INLINE_TAGS = new Set([
    "A",
    "ABBR",
    "B",
    "BDI",
    "BDO",
    "BR",
    "CITE",
    "DEL",
    "DFN",
    "EM",
    "I",
    "IMG",
    "INS",
    "MARK",
    "Q",
    "S",
    "SMALL",
    "SPAN",
    "STRONG",
    "SUB",
    "SUP",
    "TIME",
    "U",
    "WBR"
  ]);

  const STRUCTURE_UNSAFE_TAGS = new Set([
    "AUDIO",
    "BUTTON",
    "CANVAS",
    "EMBED",
    "FORM",
    "IFRAME",
    "INPUT",
    "MATH",
    "OBJECT",
    "SELECT",
    "TABLE",
    "TEXTAREA",
    "VIDEO"
  ]);

  // Records what the block looked like so later passes can skip it. The stored
  // value has to come from getBlockSourceText, because that is what the next
  // pass will compare against: a unit's own text covers only the text nodes
  // that belong to THIS block, while getBlockSourceText walks the whole
  // subtree, so a block wrapping nested blocks never matched its stored unit
  // text and was re-collected — and re-hidden — on every single pass.
  //
  // Call after the block's replacements have been painted: getBlockSourceText
  // reads originals back through the replacement spans.
  function recordProcessedUnit(unit) {
    const block = unit?.block;
    if (block && block.nodeType === Node.ELEMENT_NODE && block.isConnected && unit.text) {
      LWR.processedBlockSourceTexts.set(block, LWR.getBlockSourceText(block));
    }
  }

  // The checked mark only means "looked at this block and changed nothing" —
  // blocks that did get replacements already announce themselves with the
  // underline under each replaced word, so a second marker there is noise.
  // Call this after the block's replacements have been painted.
  function markCheckedBlock(block) {
    if (!block || block.nodeType !== Node.ELEMENT_NODE || !block.isConnected) {
      return;
    }

    if (blockShowsReplacementMarks(block) || !canMarkCheckedBlock(block)) {
      block.classList.remove(LWR.PROCESSED_BLOCK_CLASS);
      return;
    }

    block.classList.add(LWR.PROCESSED_BLOCK_CLASS);
  }

  // What counts is whether the reader can SEE that the block was touched.
  // Back-translation scaffold — the English left standing in the target
  // language's word order — is deliberately drawn without an underline, so a
  // block holding nothing else (a rebuilt heading such as "Union Uzhhorod")
  // looks exactly like untouched page text and still needs the fox.
  function blockShowsReplacementMarks(block) {
    if (!LWR.state.showHighlights) {
      return false;
    }

    const scaffoldSelector = `[data-learned-word-match-kind="${LWR.BACK_TRANSLATION_MATCH_KIND}"]`;
    if (block.classList.contains(LWR.REPLACEMENT_CLASS)) {
      return block.dataset.learnedWordMatchKind !== LWR.BACK_TRANSLATION_MATCH_KIND;
    }

    return Boolean(block.querySelector(`.${LWR.REPLACEMENT_CLASS}:not(${scaffoldSelector})`));
  }

  // The mark hangs in the left margin as a floated ::before, so it only works
  // on block-level boxes: an inline element has no margin for it to sit in,
  // and a flex or grid container would turn it into a layout item of its own.
  const CHECKED_BLOCK_DISPLAYS = new Set(["block", "list-item", "flow-root", "table-cell"]);

  function canMarkCheckedBlock(block) {
    return CHECKED_BLOCK_DISPLAYS.has(getComputedStyle(block).display);
  }

  // Structure mode may only rebuild pure prose. Blocks that carry UI markup
  // (images, buttons, custom components) or text that is not actually
  // rendered (hidden menus, screen-reader labels) would be destroyed by
  // flattening — Reddit comment headers, for example — so those blocks fall
  // back to normal per-word replacement.
  function isSafeToRestructureBlock(block, unitText) {
    if (!block || block.nodeType !== Node.ELEMENT_NODE || !block.getClientRects().length) {
      return false;
    }

    let hasForeignElement = false;
    for (const element of block.querySelectorAll("*")) {
      if (element.classList.contains(LWR.REPLACEMENT_CLASS)) {
        continue;
      }

      // Replaced and interactive content cannot survive a rebuild, and a nested
      // block is a unit in its own right.
      if (
        STRUCTURE_UNSAFE_TAGS.has(element.tagName.toUpperCase()) ||
        element.matches(LWR.NATURAL_BLOCK_SELECTOR)
      ) {
        return false;
      }

      // Anything that is not a plain HTML text wrapper — a framework's own
      // element — must not be copied. Cloning one makes a second instance that
      // re-renders itself from properties the copy never had, which on YouTube
      // emptied every sidebar entry of both its label and its avatar. Blocks
      // holding one are still translated, but only through the path below that
      // rewrites their text where it stands.
      if (!STRUCTURE_SAFE_INLINE_TAGS.has(element.tagName)) {
        hasForeignElement = true;
      }
    }

    if (hasForeignElement && !getSoleTextNode(block, unitText)) {
      return false;
    }

    const rendered = String(block.innerText || "")
      .replace(/\s+/gu, " ")
      .trim()
      .toLocaleLowerCase();
    const raw = String(unitText || "")
      .replace(/\s+/gu, " ")
      .trim()
      .toLocaleLowerCase();
    return Boolean(rendered) && rendered === raw;
  }

  const STRUCTURED_UNIT_HALTED = null;
  const STRUCTURED_UNIT_APPLIED = "applied";
  const STRUCTURED_UNIT_REJECTED = "rejected";

  // Structure mode: rebuild the block in the target language's word order.
  // Learned words stay in the target language; every other word is translated
  // back into English through the word aligner, so the sentence teaches the
  // target language's structure instead of only its vocabulary.
  //
  // Full-translation mode uses the same painter with the English scaffold
  // turned off: every word stays in the target language and the aligner's
  // English only rides along in the span, where hovering can reach it.
  async function applyStructuredUnit(unit, translatedText, targetLanguage, runId) {
    const keepTargetLanguage = Boolean(LWR.state.fullTranslation);
    const block = unit.block;
    if (!block || block.nodeType !== Node.ELEMENT_NODE || !block.isConnected) {
      return STRUCTURED_UNIT_APPLIED;
    }

    // One text node means the words can be rewritten where they stand, already
    // inside whatever wraps them — so nothing is rebuilt and no element needs
    // to be carried over.
    const soleTextNode = getSoleTextNode(block, unit.text);

    const normalizedTranslation = normalizeStructuredTranslationPunctuation(
      translatedText,
      targetLanguage
    );
    const translatedSentences = LWR.splitTranslatedSentences(normalizedTranslation);
    const sentencePairs =
      translatedSentences.length === unit.sentenceRanges.length
        ? unit.sentenceRanges.map((range, index) => ({
            source: unit.text.slice(range.start, range.end),
            translated: translatedSentences[index],
            sourceOffset: range.start
          }))
        : [{ source: unit.text, translated: normalizedTranslation, sourceOffset: 0 }];

    const parts = [];
    for (const pair of sentencePairs) {
      if (parts.length) {
        parts.push({ type: "text", value: " " });
      }

      const matches = await LWR.findWhitelistMatchesInText(pair.translated, targetLanguage, pair.source);
      const alignmentPairs = await LWR.requestWordAlignment(pair.source, pair.translated);
      if (runId !== LWR.applyRunId) {
        return STRUCTURED_UNIT_HALTED;
      }

      if (!alignmentPairs.length && !keepTargetLanguage) {
        // Without alignment the rebuilt sentence would be unreadable, so keep
        // the original English for this sentence. Full translation does not
        // need the aligner at all — it only borrows its English for hovering —
        // so an unaligned sentence is still painted, just without hints.
        parts.push({ type: "text", value: pair.source });
        continue;
      }

      const sentenceParts = buildStructuredSentenceParts(
        pair.source,
        pair.translated,
        matches,
        alignmentPairs,
        keepTargetLanguage
      );
      const faithful = await structuredSentencePartsAreFaithful(
        pair.source,
        sentenceParts,
        targetLanguage,
        keepTargetLanguage
      );
      if (runId !== LWR.applyRunId) {
        return STRUCTURED_UNIT_HALTED;
      }

      if (!faithful) {
        LWR.debugLog("structure-reject", {
          source: pair.source.slice(0, 90),
          translated: pair.translated.slice(0, 90)
        });
        return STRUCTURED_UNIT_REJECTED;
      }

      if (!soleTextNode) {
        assignElementChains(sentenceParts, unit, pair.sourceOffset, pair.source.length);
      }
      parts.push(...sentenceParts);
    }

    const replacementParts = parts.filter((part) => part.type === "replacement");
    // Structure mode has nothing to show without replacements. Full
    // translation still does — an unaligned block is all plain target text —
    // but flattening a block whose translation came back unchanged (a name, a
    // number, "OK") would destroy its markup for nothing.
    if (!replacementParts.length && !(keepTargetLanguage && paintedTextDiffers(parts, unit.text))) {
      return STRUCTURED_UNIT_APPLIED;
    }

    if (soleTextNode) {
      // The words are rewritten where they stand. Everything around them — the
      // link, the avatar, the framework's own elements and whatever state they
      // hold — is never touched, so nothing can be lost by copying it.
      const inline = document.createElement("span");
      inline.className = LWR.INLINE_STRUCTURED_CLASS;
      inline.dataset.lwrOriginalText = soleTextNode.nodeValue;
      inline.appendChild(LWR.createReplacementFragment(parts));
      soleTextNode.replaceWith(inline);
      block.classList.add(LWR.STRUCTURED_BLOCK_CLASS);
    } else {
      // Build first: capturing the original moves the block's children out, and
      // the rebuild reads them — the icons it carries across, and the elements
      // it rebuilds the words under.
      const rebuilt = LWR.createReplacementFragment(parts, block);
      captureStructuredBlockOriginal(block, unit.text);
      block.replaceChildren(rebuilt);
      block.classList.add(LWR.STRUCTURED_BLOCK_CLASS);
    }
    LWR.updateRuntimeStats({
      replacementCount:
        LWR.runtimeStats.replacementCount +
        replacementParts.filter(
          (part) => part.kind !== LWR.BACK_TRANSLATION_MATCH_KIND && part.kind !== LWR.UNLEARNED_MATCH_KIND
        ).length,
      wordFamilyReplacementCount:
        LWR.runtimeStats.wordFamilyReplacementCount +
        replacementParts.filter((part) => part.kind === LWR.WORD_FAMILY_MATCH_KIND).length
    });
    return STRUCTURED_UNIT_APPLIED;
  }

  // Ukrainian sets the clause dash as a spaced em dash ("Радіо — це ..."),
  // but the on-device model emits an ASCII hyphen or en dash instead. Only
  // structure mode paints the translated frame into the page, so the fix
  // belongs here rather than in the shared translation path.
  function normalizeStructuredTranslationPunctuation(text, targetLanguage) {
    if (targetLanguage !== "uk") {
      return String(text);
    }

    return String(text).replace(/(?<=^|\s)[-\u2013](?=\s|$)/gu, "\u2014");
  }

  // Structure mode trusts the machine translation as the sentence frame, but
  // the small on-device model sometimes mangles dense proper-noun runs --
  // dropping, duplicating, or inventing words ("Peru-Bolivian Confederation"
  // once came back containing the non-word "Боліва"). Only use the rebuilt
  // sentence when it keeps every distinctive source token and every
  // target-language word it shows is a real dictionary word.
  async function structuredSentencePartsAreFaithful(
    sourceSentence,
    parts,
    targetLanguage,
    keepTargetLanguage = false
  ) {
    const visibleText = parts.map((part) => part.value).join(" ");
    const retainedText = `${visibleText} ${parts
      .filter((part) => part.type === "replacement")
      .map((part) => part.original || "")
      .join(" ")}`.toLocaleLowerCase();

    // A name legitimately leaves the sentence when everything is translated
    // ("Augustine" becomes "Августин"), so full translation only insists on
    // numbers surviving. The dictionary check below is what still catches a
    // mangled proper-noun run, and it gets stricter here, not looser: every
    // word on screen is target-language text now, so every word is vetted.
    for (const token of getDistinctiveSourceTokens(sourceSentence, keepTargetLanguage)) {
      if (!retainedText.includes(token.toLocaleLowerCase())) {
        return false;
      }
    }

    if (targetLanguage !== "uk") {
      return true;
    }

    // Ukrainian words the learner has not studied are shown verbatim from the
    // translation, so vet those against the morphology dictionary. Learned
    // words (whitelist matches) are trusted as-is.
    //
    // A transliterated name is never in the dictionary — "Живіть з рабином
    // Йосефом Мізрачі" is a perfectly good rendering of "Live with Rabbi Yosef
    // Mizrachi" — so a word standing in for a capitalised English word is taken
    // on trust. Words carrying ordinary lowercase English stay vetted, which is
    // where invented words actually show up.
    const scaffoldWords = [];
    for (const part of parts) {
      if (part.type !== "text" && part.kind !== LWR.UNLEARNED_MATCH_KIND) {
        continue;
      }

      // Only full translation takes names on trust. Structure mode paints an
      // English scaffold around the target words it keeps, so a mangled
      // proper-noun run there is exactly what the dictionary check is for and
      // it stays strict.
      if (keepTargetLanguage && part.type === "replacement" && standsInForAName(part.original)) {
        continue;
      }

      scaffoldWords.push(...getCyrillicValidationWords(part.value));
    }

    if (!scaffoldWords.length) {
      return true;
    }

    const lemmasByWord = await LWR.getUkrainianLemmas(scaffoldWords);
    const unknown = scaffoldWords.filter(
      (word) => (lemmasByWord.get(LWR.normalizeUkrainianMorphologyWord(word)) || []).length === 0
    );

    if (!keepTargetLanguage) {
      return unknown.length === 0;
    }

    // Structure mode shows target words inside an English sentence, where one
    // invented word is glaring, so nothing unknown is allowed there. A fully
    // translated sentence is a different bargain: the dictionary does not list
    // every compound the language forms — "відеокаталог" for "video catalogue"
    // is ordinary Ukrainian — and throwing the sentence away over one word left
    // whole paragraphs in English. What is still worth catching is a sentence
    // the model made up wholesale, so this asks whether most of it is unknown.
    return unknown.length < 3 || unknown.length / scaffoldWords.length < 0.4;
  }

  function standsInForAName(english) {
    const words = String(english || "").match(/[\p{L}][\p{L}'’-]*/gu) || [];
    return words.length > 0 && words.every((word) => /^\p{Lu}/u.test(word));
  }

  // Capitalized words (except the sentence opener) and numbers are the tokens
  // a translation must not lose; lowercase filler may legitimately disappear
  // into the target language's grammar.
  function getDistinctiveSourceTokens(sourceSentence, numbersOnly = false) {
    const tokens = [];
    let isFirstWord = true;

    for (const match of String(sourceSentence).matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)) {
      const wasFirstWord = isFirstWord;
      isFirstWord = false;

      // Hyphenated compounds ("Rio-Grande") may be legitimately reordered or
      // split by translation, so require each half on its own.
      for (const piece of match[0].split("-")) {
        if (!piece) {
          continue;
        }

        // A possessive is re-expressed rather than carried over ("Augustine's"
        // becomes the glossed "of-St Augustine"), so require the name itself
        // and not the English case marker.
        const bare = stripPossessiveMarker(piece) || piece;

        if (/\p{N}/u.test(bare)) {
          tokens.push(bare);
        } else if (!numbersOnly && !wasFirstWord && /^\p{Lu}/u.test(bare)) {
          tokens.push(bare);
        }
      }
    }

    return tokens;
  }

  function getCyrillicValidationWords(value) {
    const words =
      String(value || "").match(/[\p{Script=Cyrillic}][\p{Script=Cyrillic}'’ʼ]*/gu) || [];
    // One- and two-letter words are particles the dictionary may not list;
    // translator-invented garbage is longer.
    return words.filter((word) => word.length >= 3);
  }

  // "it's" is "it is", not a possessive, and the aligner does link contractions.
  const POSSESSIVE_LOOKALIKES = new Set([
    "it's",
    "that's",
    "he's",
    "she's",
    "what's",
    "there's",
    "here's",
    "who's",
    "let's"
  ]);

  function stripPossessiveMarker(value) {
    const text = String(value || "");
    if (POSSESSIVE_LOOKALIKES.has(text.toLocaleLowerCase())) {
      return null;
    }

    const match = /^(.+?)(?:['’ʼ]s|['’ʼ])$/u.exec(text);
    return match && /\p{L}$/u.test(match[1]) ? match[1] : null;
  }

  // English marks possession with "'s" ahead of the noun; Ukrainian marks it
  // with the genitive case behind it. Reusing the English span verbatim strands
  // the possessive in Ukrainian order — "texts St Augustine's" — which reads as
  // a mistake rather than as Ukrainian structure. Glossing it as a prefixed
  // "of-" says what the case ending is doing: "texts of-St Augustine". The
  // hyphen marks that no separate Ukrainian word answers to "of"; the case
  // ending carries it alone, so it is not given a slot of its own.
  function applyGenitiveGlossToPlan(plan, sourceSentence) {
    plan.forEach((item, index) => {
      const possessor = item.english ? stripPossessiveMarker(item.english) : null;
      if (!possessor) {
        return;
      }

      item.english = possessor;

      // A possessor can run to several words ("St Augustine's"), and "of-"
      // belongs on the first of them — where English would have opened the
      // phrase. Neighbours only join it if the English source really does have
      // them side by side, so unrelated adjacent words are never swept in.
      let start = index;
      let phrase = possessor;

      while (start > 0) {
        const previous = plan[start - 1];
        if (!previous.english) {
          break;
        }

        const extended = `${previous.english} ${phrase}`;
        if (!sourceSentence.includes(extended)) {
          break;
        }

        phrase = extended;
        start -= 1;
      }

      plan[start].genitivePrefix = "of-";
    });
  }

  function mergeSourceRanges(ranges) {
    if (!ranges || !ranges.length) {
      return null;
    }

    return {
      start: Math.min(...ranges.map((range) => range.start)),
      end: Math.max(...ranges.map((range) => range.end))
    };
  }

  // Repainting a block rebuilds its children, which used to drop the elements
  // inside it: a nav item's <a> became bare text, so the link stopped working
  // and any CSS written for `li a` stopped applying. Every element between the
  // block and its text is carried over, whatever its tag — pages keep their
  // text in custom elements as often as in <em> these days — so each word is
  // rebuilt under the same chain of elements it came from.
  function getSourceElementChain(unit, sourceStart) {
    const nodeRange = (unit.nodeRanges || []).find(
      (range) => range.start <= sourceStart && sourceStart < range.end
    );
    if (!nodeRange) {
      return [];
    }

    const chain = [];
    let element = nodeRange.node.parentElement;
    while (element && element !== unit.block && unit.block.contains(element)) {
      chain.unshift(element);
      element = element.parentElement;
    }

    return chain;
  }

  function getElementSourceRanges(unit) {
    const byElement = new Map();

    for (const range of unit.nodeRanges || []) {
      let element = range.node.parentElement;
      while (element && element !== unit.block && unit.block.contains(element)) {
        const existing = byElement.get(element);
        if (existing) {
          existing.start = Math.min(existing.start, range.start);
          existing.end = Math.max(existing.end, range.end);
        } else {
          byElement.set(element, { start: range.start, end: range.end });
        }
        element = element.parentElement;
      }
    }

    return byElement;
  }

  function assignElementChains(parts, unit, sourceOffset, sourceLength) {
    for (const part of parts) {
      if (part.type !== "replacement" || !part.sourceRange) {
        continue;
      }

      part.chain = getSourceElementChain(unit, part.sourceRange.start + sourceOffset);
    }

    // Punctuation at either end of the sentence has no English of its own for
    // the aligner to place, so it is decided by how far the element reaches: an
    // element wrapping the whole sentence keeps that sentence's own full stop
    // inside it. Left outside a block-level link, a full stop becomes its own
    // line.
    const first = parts.findIndex((part) => part.chain?.length);
    if (first < 0) {
      return;
    }

    const last = parts.findLastIndex((part) => part.chain?.length);
    const ranges = getElementSourceRanges(unit);
    // An element's ancestors always reach at least as far as it does, so
    // filtering a chain this way still leaves a chain.
    const leading = parts[first].chain.filter(
      (element) => (ranges.get(element)?.start ?? Infinity) <= sourceOffset
    );
    const trailing = parts[last].chain.filter(
      (element) => (ranges.get(element)?.end ?? -1) >= sourceOffset + sourceLength
    );

    for (const part of parts.slice(0, first)) {
      if (part.type === "text") {
        part.chain = leading;
      }
    }

    for (const part of parts.slice(last + 1)) {
      if (part.type === "text") {
        part.chain = trailing;
      }
    }
  }

  // Most blocks worth translating hold all their words in one text node: a
  // heading, a nav item, a video title, a channel name. Those can be rewritten
  // where they stand — the node is already inside whatever elements wrap it, so
  // nothing has to be copied and nothing around the words is disturbed.
  function getSoleTextNode(block, unitText) {
    const nodes = [];
    for (const node of LWR.collectTextNodes(block)) {
      if (node.nodeValue && node.nodeValue.trim()) {
        nodes.push(node);
        if (nodes.length > 1) {
          return null;
        }
      }
    }

    if (nodes.length !== 1) {
      return null;
    }

    // The one node has to be the whole unit, or the words painted into it would
    // not be the words the translation was made from.
    const normalize = (value) =>
      String(value || "")
        .replace(/\s+/gu, " ")
        .trim();
    return normalize(nodes[0].nodeValue) === normalize(unitText) ? nodes[0] : null;
  }

  function paintedTextDiffers(parts, sourceText) {
    const painted = parts
      .map((part) => part.value)
      .join("")
      .replace(/\s+/gu, " ")
      .trim();
    const source = String(sourceText || "")
      .replace(/\s+/gu, " ")
      .trim();
    return Boolean(painted) && painted !== source;
  }

  function buildStructuredSentenceParts(
    sourceSentence,
    translatedSentence,
    whitelistMatches,
    alignmentPairs,
    keepTargetLanguage = false
  ) {
    const knownRanges = getMergedKnownRanges(whitelistMatches);
    const tokens = LWR.getReplaceableSourceTokens(translatedSentence);
    const strongPairs = alignmentPairs.filter((pair) => !pair.weak);
    const weakPairs = alignmentPairs.filter((pair) => pair.weak);
    const usedEnglishSpans = createUsedEnglishSpans();

    // Assign confident English first, in sentence order.
    const plan = tokens.map((token) => {
      const known = knownRanges.find(
        (range) => range.start <= token.start && token.start < range.end
      );
      if (known) {
        // The learned word stays in Ukrainian and the reader takes its English
        // straight off it, so claim that English here. Otherwise the next word
        // repeats it: "Я радий" ("I glad") came out as "Я I'm glad".
        claimEnglishForKnownRange(strongPairs, sourceSentence, known, usedEnglishSpans);
        return { token, known };
      }

      // Where in the English this word came from, so a link or an <em> around
      // that English can be rebuilt around the word that replaced it.
      const sourceRanges = [];
      return {
        token,
        sourceRanges,
        english: collectAlignedEnglish(
          strongPairs,
          sourceSentence,
          token.start,
          token.end,
          usedEnglishSpans,
          sourceRanges
        )
      };
    });

    // Tokens the confident pairs could not cover stay in the target language,
    // but carry the aligner's best-guess English so hovering still teaches
    // the word. Guesses are never substituted into the sentence.
    for (const item of plan) {
      if (item.known || item.english) {
        continue;
      }

      const candidates = weakPairs
        .filter((pair) => pair.tgtStart < item.token.end && item.token.start < pair.tgtEnd)
        .sort((a, b) => b.score - a.score);

      for (const candidate of candidates) {
        const value = sourceSentence.slice(candidate.srcStart, candidate.srcEnd);
        // Only content words make useful hover guesses; articles and other
        // filler would just mislead.
        if (
          !LWR.isReplaceableNeuralSourceSpan(value) ||
          value.length < 3 ||
          LWR.ALIGNMENT_COMMON_WORDS.has(value.toLocaleLowerCase())
        ) {
          continue;
        }

        item.guess = value;
        item.sourceRanges = [{ start: candidate.srcStart, end: candidate.srcEnd }];
        break;
      }
    }

    applyGenitiveGlossToPlan(plan, sourceSentence);

    const parts = [];
    let cursor = 0;

    const pushText = (value) => {
      if (value) {
        parts.push({ type: "text", value });
      }
    };

    for (const item of plan) {
      const token = item.token;
      if (token.start < cursor) {
        continue;
      }

      pushText(translatedSentence.slice(cursor, token.start));

      if (item.known) {
        const known = item.known;
        const value = translatedSentence.slice(known.start, known.end);
        const knownRanges = [];
        const english =
          collectAlignedEnglish(
            strongPairs,
            sourceSentence,
            known.start,
            known.end,
            null,
            knownRanges
          ) || String(known.source || "");
        parts.push({
          type: "replacement",
          value,
          original: english,
          source: english,
          target: value,
          kind: known.kind,
          sourceRange: mergeSourceRanges(knownRanges)
        });
        cursor = known.end;
        continue;
      }

      if (item.english && !keepTargetLanguage) {
        // The prefix goes on after case adaptation so the gloss marker stays
        // lowercase even when the Ukrainian word it fronts is capitalised.
        const value = `${item.genitivePrefix || ""}${LWR.adaptEnglishScaffoldCase(
          item.english,
          token.value,
          sourceSentence
        )}`;
        parts.push({
          type: "replacement",
          value,
          original: token.value,
          source: token.value,
          target: value,
          kind: LWR.BACK_TRANSLATION_MATCH_KIND,
          sourceRange: mergeSourceRanges(item.sourceRanges)
        });
      } else if (item.english || item.guess) {
        // Full translation lands here for every unlearned word: confident
        // English and best-guess English are both demoted to hover text, so
        // nothing English is painted into the sentence.
        const english = item.english || item.guess;
        parts.push({
          type: "replacement",
          value: token.value,
          original: english,
          source: english,
          target: token.value,
          kind: LWR.UNLEARNED_MATCH_KIND,
          sourceRange: mergeSourceRanges(item.sourceRanges)
        });
      } else {
        pushText(token.value);
      }
      cursor = token.end;
    }

    pushText(translatedSentence.slice(cursor));
    return parts;
  }

  function getMergedKnownRanges(whitelistMatches) {
    const ranges = whitelistMatches
      .map((match) => ({
        start: match.index,
        end: match.index + match.target.length,
        kind: match.kind,
        source: match.entry?.source || ""
      }))
      .filter((range) => range.start < range.end)
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const merged = [];

    for (const range of ranges) {
      if (!merged.some((existing) => LWR.rangesOverlap(existing, range))) {
        merged.push(range);
      }
    }

    return merged;
  }

  // Once a word has taken a piece of the English sentence, no other word may
  // take it again — and overlap is what counts, not an identical span, because
  // the aligner will happily link "I", "I'm" and "I'm glad" as three different
  // spans over the same pronoun.
  function createUsedEnglishSpans() {
    const spans = [];

    return {
      claims(pair) {
        return spans.some((span) => pair.srcStart < span.end && span.start < pair.srcEnd);
      },
      claim(pair) {
        spans.push({ start: pair.srcStart, end: pair.srcEnd });
      }
    };
  }

  function claimEnglishForKnownRange(alignmentPairs, sourceSentence, known, usedSpans) {
    collectAlignedEnglish(alignmentPairs, sourceSentence, known.start, known.end, usedSpans);
  }

  function collectAlignedEnglish(
    alignmentPairs,
    sourceSentence,
    tgtStart,
    tgtEnd,
    usedSpans,
    claimedRanges = null
  ) {
    const words = [];
    const takenHere = createUsedEnglishSpans();
    const linked = alignmentPairs
      .filter((pair) => pair.tgtStart < tgtEnd && tgtStart < pair.tgtEnd)
      .sort((a, b) => a.srcStart - b.srcStart);

    for (const pair of linked) {
      if (takenHere.claims(pair) || usedSpans?.claims(pair)) {
        continue;
      }

      const value = sourceSentence.slice(pair.srcStart, pair.srcEnd);
      if (!LWR.isReplaceableNeuralSourceSpan(value)) {
        continue;
      }

      takenHere.claim(pair);
      usedSpans?.claim(pair);
      claimedRanges?.push({ start: pair.srcStart, end: pair.srcEnd });
      words.push(value);
    }

    return words.join(" ");
  }

  function captureStructuredBlockOriginal(block, sourceText) {
    if (LWR.structuredBlockOriginals.has(block)) {
      return;
    }

    const fragment = document.createDocumentFragment();
    while (block.firstChild) {
      fragment.appendChild(block.firstChild);
    }
    LWR.structuredBlockOriginals.set(block, { fragment, sourceText });
    block.dataset.lwrOriginalText = sourceText;
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    STRUCTURED_UNIT_HALTED,
    STRUCTURED_UNIT_APPLIED,
    STRUCTURED_UNIT_REJECTED,
    recordProcessedUnit,
    markCheckedBlock,
    isSafeToRestructureBlock,
    applyStructuredUnit,
    getMergedKnownRanges,
    createUsedEnglishSpans,
    claimEnglishForKnownRange,
    collectAlignedEnglish
  });
})();
