// Finding the work: which parts of the page are worth translating.
//
// A "block" is the unit of translation — a paragraph, a heading, a list item,
// a nav link. The selectors below decide what counts as one, what is off
// limits, and what falls back to being its own block when a page nests
// everything in anonymous divs.
//
// Order matters as much as selection. A pass takes a fixed slice, so units are
// ranked first: real prose in view beats a two-word nav label, and page chrome
// ("Sign in", "More") sinks to the bottom.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const MAX_CONTEXT_UNITS_PER_PASS = 35;
  const VIEWPORT_MARGIN_PX = 900;

  const NATURAL_BLOCK_SELECTOR = [
    "p",
    "li",
    "blockquote",
    "figcaption",
    "caption",
    "td",
    "th",
    "dt",
    "dd",
    "summary",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6"
  ].join(",");
  const FALLBACK_BLOCK_SELECTOR = [
    "a",
    "span",
    "div"
  ].join(",");
  const STRUCTURAL_CONTAINER_SELECTOR = [
    "article",
    "section",
    "main",
    "aside",
    "header",
    "footer",
    "nav"
  ].join(",");
  const IGNORED_SELECTOR = [
    "script",
    "style",
    "noscript",
    "textarea",
    "input",
    "select",
    "option",
    "button",
    // Sidebars, navigation and footers are read like body text: a table of
    // contents or a sidebar is real reading material for a learner. Their
    // text is still deprioritized within a pass by isCommonPageChromeText.
    "pre",
    "code",
    "kbd",
    "samp",
    "svg",
    "math",
    "[hidden]",
    "[aria-hidden='true']",
    "[contenteditable]",
    "[data-lwr-ui]",
    `[class~='${LWR.REPLACEMENT_CLASS}']`,
    // Words already rewritten in place are not source text: an ancestor block
    // that read them back would translate the translation, and rebuild itself
    // around a copy of the link they sit in.
    `[class~='${LWR.INLINE_STRUCTURED_CLASS}']`,
    `[class~='${LWR.REVERSE_HOVER_TOOLTIP_CLASS}']`
  ].join(",");

  // What each block looked like when it was last finished, so a later pass can
  // tell "already done" from "the page rewrote this". Read and reset by
  // structured.js and apply.js as well.
  LWR.processedBlockSourceTexts = new WeakMap();
  LWR.structuredBlockOriginals = new WeakMap();

  function getMaxContextUnitsPerPass() {
    return LWR.getConfigNumber("maxContextUnitsPerPass", MAX_CONTEXT_UNITS_PER_PASS);
  }

  function getViewportMarginPx() {
    return LWR.getConfigNumber("viewportMarginPx", VIEWPORT_MARGIN_PX);
  }

  function collectTextNodes(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      return LWR.isTextNodeInIgnoredSubtree(root) ? [] : [root];
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return LWR.isTextNodeInIgnoredSubtree(node)
          ? NodeFilter.FILTER_REJECT
          : NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];

    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }

    return nodes;
  }

  function collectContextUnits(root) {
    return collectContextUnitsFromRoots([root]);
  }

  // Which blocks still have work in them, ignoring the per-pass cap. Queueing
  // is not the place to apply the budget — the pass applies its own when it
  // runs, and a capped queue made a continuing pass believe the page was done.
  function collectPendingContextBlocks(root) {
    return Array.from(
      new Set(collectContextUnitsFromRoots([root], { unlimited: true }).map((unit) => unit.block))
    );
  }

  function collectContextUnitsFromRoots(roots, { unlimited = false } = {}) {
    const groups = new Map();
    const seenBlocks = new Set();

    // A block that still holds replacement spans reads back without the words
    // they replaced — collecting it unrestored fed the translator gaps ("It is
    // in the  now.") and then recorded that gap-ridden text as the block's
    // source, which shut the block out of every later pass. Whichever queue a
    // block arrived through, put changed ones back to their own words first.
    for (const root of roots) {
      if (root && root.isConnected) {
        LWR.restoreChangedProcessedBlocks(root);
      }
    }

    for (const root of roots) {
      if (!root || !root.isConnected) {
        continue;
      }

      for (const node of collectTextNodes(root)) {
        const block = getTextBlock(node);
        if (!block) {
          continue;
        }

        // Run the block-level checks once per block, but keep collecting every
        // text node of an accepted block: paragraphs with links or formatting
        // hold their sentences in many sibling text nodes.
        if (!seenBlocks.has(block)) {
          seenBlocks.add(block);
          if (isProcessableBlock(block) && !isProcessedBlockUnchanged(block)) {
            groups.set(block, []);
          }
        }

        if (groups.has(block)) {
          groups.get(block).push(node);
        }
      }
    }

    let collectionOrder = 0;
    const eligible = Array.from(groups.entries())
      .flatMap(([block, nodes]) =>
        LWR.createContextUnitsForNodes(nodes, block).map((unit) => ({
          ...unit,
          collectionOrder: collectionOrder++
        }))
      )
      // Blocks already written in the target language are kept, but marked for
      // the mirrored target→English pass instead of the English→target one.
      .map((unit) =>
        LWR.isTextAlreadyInTargetLanguage(unit.text) ? { ...unit, reverse: true } : unit
      )
      // Full translation is the opposite instruction to the reverse pass — the
      // whole page belongs in the target language — so it wins and no English
      // is swapped back in, on pages the extension translated or pages that
      // arrived in the target language already.
      .filter((unit) => !unit.reverse || (LWR.state.targetLanguagePages && !LWR.state.fullTranslation))
      .sort(
        (a, b) =>
          getContextUnitPriority(b) - getContextUnitPriority(a) ||
          a.collectionOrder - b.collectionOrder
      );

    if (unlimited) {
      return eligible.sort((a, b) => a.collectionOrder - b.collectionOrder);
    }

    // A pass takes the highest-priority slice and drops the rest. The rest is
    // not stranded: a pass that finished work looks again when it ends, which
    // is what keeps a page longer than one pass from stopping partway down.
    return eligible
      .slice(0, getMaxContextUnitsPerPass())
      .sort((a, b) => a.collectionOrder - b.collectionOrder);
  }

  function isProcessedBlockUnchanged(block) {
    if (!LWR.processedBlockSourceTexts.has(block)) {
      return false;
    }

    return getBlockSourceText(block) === LWR.processedBlockSourceTexts.get(block);
  }

  function getBlockSourceText(block) {
    const structured = LWR.structuredBlockOriginals.get(block);
    if (structured) {
      return structured.sourceText;
    }

    if (block.nodeType === Node.ELEMENT_NODE && block.dataset.lwrOriginalText) {
      return block.dataset.lwrOriginalText;
    }

    let text = "";

    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!LWR.isTextNodeInIgnoredSubtree(node)) {
          text += node.nodeValue;
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      // Words rewritten in place keep the text they replaced, so the block
      // still reads back as its own source and is not collected again.
      if (node !== block && node.dataset && node.dataset.lwrOriginalText) {
        text += node.dataset.lwrOriginalText;
        return;
      }

      if (node.classList.contains(LWR.REPLACEMENT_CLASS)) {
        text += node.dataset.learnedWordOriginal || node.textContent || "";
        return;
      }

      if (node !== block && node.matches(IGNORED_SELECTOR)) {
        return;
      }

      for (const child of node.childNodes) {
        visit(child);
      }
    }

    visit(block);
    return text;
  }

  function getContextUnitPriority(unit) {
    const text = String(unit.text || "").trim();
    const wordCount = countWords(text);
    let score = Math.min(wordCount, 80);

    if (text.length >= 40) {
      score += 20;
    }

    if (/[.!?;:]/u.test(text)) {
      score += 15;
    }

    if (wordCount <= 2) {
      score -= 30;
    }

    if (isUrlLikeText(text)) {
      score -= 80;
    }

    if (isCommonPageChromeText(text)) {
      score -= 60;
    }

    return score;
  }

  function countWords(text) {
    return (String(text || "").match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}'\u2019\u02bc_-]*/gu) || [])
      .length;
  }

  function isUrlLikeText(text) {
    return /^(?:https?:\/\/|www\.|[a-z0-9-]+(?:\.[a-z0-9-]+)+\/?)/iu.test(
      String(text || "").trim()
    );
  }

  function isCommonPageChromeText(text) {
    return /^(?:skip to main content|accessibility help|sign in|all|shopping|images|news|videos|short videos|more|tools|search results)$/iu.test(
      String(text || "").trim()
    );
  }

  function getTextBlock(textNode) {
    const parent = textNode.parentElement;
    if (!parent || parent.closest(IGNORED_SELECTOR)) {
      return null;
    }

    return getElementTextBlock(parent);
  }

  function getElementTextBlock(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }

    if (element.closest(IGNORED_SELECTOR)) {
      return null;
    }

    const naturalBlock = element.closest(NATURAL_BLOCK_SELECTOR);
    if (naturalBlock) {
      return naturalBlock;
    }

    const fallbackBlock = getFallbackTextBlock(element);
    if (fallbackBlock) {
      return fallbackBlock;
    }

    return isReasonableLocalTextBlock(element) ? element : null;
  }

  function getFallbackTextBlock(element) {
    let current = element;

    while (
      current &&
      current.nodeType === Node.ELEMENT_NODE &&
      current !== document.body &&
      current !== document.documentElement
    ) {
      if (current.matches(IGNORED_SELECTOR)) {
        return null;
      }

      if (current.matches(STRUCTURAL_CONTAINER_SELECTOR)) {
        return null;
      }

      if (current.matches(FALLBACK_BLOCK_SELECTOR) && isReasonableLocalTextBlock(current)) {
        return current;
      }

      current = current.parentElement;
    }

    return null;
  }

  function isReasonableLocalTextBlock(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    if (element === document.body || element === document.documentElement) {
      return false;
    }

    if (element.matches(IGNORED_SELECTOR) || element.matches(STRUCTURAL_CONTAINER_SELECTOR)) {
      return false;
    }

    if (element.querySelector(NATURAL_BLOCK_SELECTOR)) {
      return false;
    }

    const text = element.textContent || "";
    if (!text.trim()) {
      return false;
    }

    return text.length <= 1200 && element.children.length <= 30;
  }

  function isProcessableBlock(block) {
    if (!block || block.nodeType !== Node.ELEMENT_NODE) {
      return false;
    }

    const style = getComputedStyle(block);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      Number(style.opacity || 1) === 0
    ) {
      return false;
    }

    const viewportHeight = globalThis.innerHeight || document.documentElement.clientHeight || 0;
    const viewportWidth = globalThis.innerWidth || document.documentElement.clientWidth || 0;
    const margin = getViewportMarginPx();
    const rects = Array.from(block.getClientRects());

    if (!rects.length) {
      // No box of its own is not the same as not being shown — `display:
      // contents` renders its text through its children — but genuinely hidden
      // text must be left alone. Collecting it burned the block: it was
      // translated while invisible, nothing could be painted into a box that
      // does not exist, and it was recorded as done, so revealing it later
      // showed English forever. YouTube's whole subscription list sits behind
      // a "Show more" expander like that.
      return typeof block.checkVisibility === "function" ? block.checkVisibility() : true;
    }

    return rects.some((rect) => {
      if (rect.width <= 0 || rect.height <= 0) {
        return false;
      }

      return (
        rect.bottom >= -margin &&
        rect.top <= viewportHeight + margin &&
        rect.right >= -margin &&
        rect.left <= viewportWidth + margin
      );
    });
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    NATURAL_BLOCK_SELECTOR,
    IGNORED_SELECTOR,
    getViewportMarginPx,
    collectTextNodes,
    collectContextUnits,
    collectPendingContextBlocks,
    collectContextUnitsFromRoots,
    isProcessedBlockUnchanged,
    getBlockSourceText,
    getTextBlock,
    getElementTextBlock,
    isProcessableBlock
  });
})();
