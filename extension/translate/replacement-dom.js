// Turning decided replacements into actual DOM.
//
// A range list becomes a list of parts, and a part list becomes a document
// fragment. The fiddly bit is rebuilding the inline elements a sentence ran
// through: each one is opened at its first word and held open to its last, so
// a link that spans half a sentence comes back as one link rather than three.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  function buildReplacementPartsForRanges(text, ranges) {
    const mergedRanges = mergeReplacementRanges(ranges);
    const parts = [];
    let lastTextStart = 0;

    for (const range of mergedRanges) {
      const start = range.start;
      const end = Math.min(range.end, text.length);

      if (start < lastTextStart || start >= end) {
        continue;
      }

      if (lastTextStart < start) {
        parts.push({ type: "text", value: text.slice(lastTextStart, start) });
      }

      const original = text.slice(start, end);
      parts.push({
        type: "replacement",
        original,
        source: original,
        target: range.target,
        kind: range.kind,
        value: range.target
      });

      lastTextStart = end;
    }

    if (!parts.some((part) => part.type === "replacement")) {
      return null;
    }

    if (lastTextStart < text.length) {
      parts.push({ type: "text", value: text.slice(lastTextStart) });
    }

    return parts;
  }

  const REPLACEMENT_RANGE_KINDS = new Set([
    LWR.WORD_FAMILY_MATCH_KIND,
    LWR.BACK_TRANSLATION_MATCH_KIND,
    LWR.UNLEARNED_MATCH_KIND
  ]);

  function mergeReplacementRanges(ranges) {
    const normalizedRanges = [...ranges]
      .map((range) => ({
        start: Math.max(0, Number(range.start) || 0),
        end: Math.max(0, Number(range.end) || 0),
        target: String(range.target || "").trim(),
        kind: REPLACEMENT_RANGE_KINDS.has(range.kind) ? range.kind : "exact"
      }))
      .filter((range) => range.start < range.end && range.target)
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const merged = [];

    for (const range of normalizedRanges) {
      if (merged.some((existing) => LWR.rangesOverlap(existing, range))) {
        continue;
      }

      merged.push(range);
    }

    return merged.sort((a, b) => a.start - b.start || b.end - a.end);
  }

  // Elements holding no words of their own — an avatar, an icon, a badge image
  // — are not part of any sentence, so rebuilding a block would simply drop
  // them. They are copied back instead, before or after the words depending on
  // which side of the text they sat on.
  function getTextlessChildren(element) {
    const before = [];
    const after = [];
    let seenText = false;

    for (const child of element.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        seenText = seenText || Boolean(child.nodeValue.trim());
        continue;
      }

      if (child.nodeType !== Node.ELEMENT_NODE) {
        continue;
      }

      if (child.textContent.trim()) {
        seenText = true;
        continue;
      }

      (seenText ? after : before).push(child);
    }

    return { before, after };
  }

  function appendTextlessChildren(container, elements) {
    for (const element of elements) {
      container.appendChild(element.cloneNode(true));
    }
  }

  function createReplacementFragment(parts, block = null) {
    const fragment = document.createDocumentFragment();
    const blockAtomics = block ? getTextlessChildren(block) : { before: [], after: [] };
    appendTextlessChildren(fragment, blockAtomics.before);
    // Each element is rebuilt once, held open from its first word to its last.
    // Anything falling between — the punctuation the translator put there —
    // lands inside it, which is what keeps a block-level link (a YouTube video
    // title) from breaking apart and leaving commas on lines of their own.
    const spans = getElementSpans(parts);
    const open = [];

    const closeTo = (depth) => {
      while (open.length > depth) {
        const entry = open.pop();
        appendTextlessChildren(entry.clone, entry.atomics.after);
      }
    };

    for (const [index, part] of parts.entries()) {
      while (open.length && open[open.length - 1].last < index) {
        closeTo(open.length - 1);
      }

      for (const element of part.chain || []) {
        if (open.some((entry) => entry.element === element)) {
          continue;
        }

        const span = spans.get(element);
        if (!span) {
          continue;
        }

        const clone = element.cloneNode(false);
        const atomics = getTextlessChildren(element);
        (open[open.length - 1]?.clone || fragment).appendChild(clone);
        appendTextlessChildren(clone, atomics.before);
        open.push({ element, clone, last: span.last, atomics });
      }

      appendReplacementPart(open[open.length - 1]?.clone || fragment, part);
    }

    closeTo(0);
    appendTextlessChildren(fragment, blockAtomics.after);
    return fragment;
  }

  function getElementSpans(parts) {
    const spans = new Map();

    parts.forEach((part, index) => {
      for (const element of part.chain || []) {
        const span = spans.get(element);
        if (span) {
          span.last = index;
        } else {
          spans.set(element, { first: index, last: index });
        }
      }
    });

    return spans;
  }

  function appendReplacementPart(container, part) {
    if (part.type === "text") {
      container.appendChild(document.createTextNode(part.value));
      return;
    }

    const span = document.createElement("span");
    span.className = LWR.REPLACEMENT_CLASS;
    span.dataset.learnedWordOriginal = part.original;
    span.dataset.learnedWordSource = part.source;
    span.dataset.learnedWordTarget = part.target;
    span.dataset.learnedWordMatchKind = part.kind || "exact";
    span.textContent = part.value;
    container.appendChild(span);
  }

  function replaceTextNodeWithParts(textNode, parts) {
    textNode.replaceWith(createReplacementFragment(parts));
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    buildReplacementPartsForRanges,
    mergeReplacementRanges,
    createReplacementFragment,
    replaceTextNodeWithParts
  });
})();
