// The scheduler, and the way back out.
//
// applyToPage is the entry point for a translation pass: it decides what to
// restore first, rebuilds the vocabulary, and hands the page to passes.js. The
// rest of the file is about noticing when the page needs another pass —
// mutations, scrolling, clicks that reveal collapsed content — and about
// putting every original word back when the extension is switched off.
//
// A pass is capped, so finishing one is not the same as finishing the page:
// the tail of applyToPage looks again, which is what keeps a long page from
// stopping halfway down.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const APPLY_DEBOUNCE_MS = 700;

  // The run counter is read by every async step of a pass to notice it has been
  // superseded, so it lives on the namespace with the rest of the pass state.
  LWR.applyRunId = 0;
  LWR.observer = null;
  let pendingTimer = null;
  let applying = false;
  let scrollListenerInstalled = false;
  const pendingContextBlocks = new Map();

  function getApplyDebounceMs() {
    return LWR.getConfigNumber("applyDebounceMs", APPLY_DEBOUNCE_MS);
  }

  function restoreOriginalText(root = document) {
    const structuredBlocks =
      root.nodeType === Node.ELEMENT_NODE && root.classList.contains(LWR.STRUCTURED_BLOCK_CLASS)
        ? [root]
        : Array.from(root.querySelectorAll?.(`.${LWR.STRUCTURED_BLOCK_CLASS}`) || []);

    for (const block of structuredBlocks) {
      const stored = LWR.structuredBlockOriginals.get(block);
      block.classList.remove(LWR.STRUCTURED_BLOCK_CLASS);
      if (stored) {
        LWR.structuredBlockOriginals.delete(block);
        block.replaceChildren(stored.fragment);
      } else if (block.dataset.lwrOriginalText) {
        // The original nodes are gone (e.g. the extension was reloaded), so
        // fall back to restoring the plain original text.
        block.textContent = block.dataset.lwrOriginalText;
      }
      delete block.dataset.lwrOriginalText;
    }

    // Words rewritten in place put back the text node they replaced, leaving
    // everything around them exactly as the page built it.
    const inlineRuns =
      root.nodeType === Node.ELEMENT_NODE && root.classList.contains(LWR.INLINE_STRUCTURED_CLASS)
        ? [root]
        : Array.from(root.querySelectorAll?.(`.${LWR.INLINE_STRUCTURED_CLASS}`) || []);

    for (const run of inlineRuns) {
      const parent = run.parentNode;
      run.replaceWith(document.createTextNode(run.dataset.lwrOriginalText || run.textContent));
      parent?.normalize();
    }

    const replacements =
      root.nodeType === Node.ELEMENT_NODE && root.classList.contains(LWR.REPLACEMENT_CLASS)
        ? [root]
        : Array.from(root.querySelectorAll(`.${LWR.REPLACEMENT_CLASS}`));
    const parents = new Set();

    for (const replacement of replacements) {
      const parent = replacement.parentNode;
      if (parent) {
        parents.add(parent);
      }

      replacement.replaceWith(
        document.createTextNode(replacement.dataset.learnedWordOriginal || replacement.textContent)
      );
    }

    for (const parent of parents) {
      parent.normalize();
    }
  }

  function clearProcessedBlockMarkers(root = document) {
    const blocks =
      root.nodeType === Node.ELEMENT_NODE && root.classList.contains(LWR.PROCESSED_BLOCK_CLASS)
        ? [root]
        : Array.from(root.querySelectorAll(`.${LWR.PROCESSED_BLOCK_CLASS}`));

    for (const block of blocks) {
      block.classList.remove(LWR.PROCESSED_BLOCK_CLASS);
    }
  }

  function restoreChangedProcessedBlocksForRoots(roots) {
    for (const root of roots || []) {
      if (root && root.isConnected) {
        restoreChangedProcessedBlocks(root);
      }
    }
  }

  function restoreChangedProcessedBlocks(root = document) {
    const replacements =
      root.nodeType === Node.ELEMENT_NODE && root.classList.contains(LWR.REPLACEMENT_CLASS)
        ? [root]
        : Array.from(root.querySelectorAll(`.${LWR.REPLACEMENT_CLASS}`));
    const blocks = new Set();

    for (const replacement of replacements) {
      // Resolve from the parent: a replacement span is itself in
      // IGNORED_SELECTOR (its text must never be re-collected), so asking for
      // the span's own block always answered null and this whole function
      // quietly restored nothing.
      const block = LWR.getElementTextBlock(replacement.parentElement);
      if (block) {
        blocks.add(block);
      }
    }

    for (const block of blocks) {
      const previousSourceText = LWR.processedBlockSourceTexts.get(block);
      if (!previousSourceText) {
        continue;
      }

      if (LWR.getBlockSourceText(block) !== previousSourceText) {
        LWR.processedBlockSourceTexts.delete(block);
        block.classList.remove(LWR.PROCESSED_BLOCK_CLASS);
        restoreOriginalText(block);
      }
    }
  }

  function countExistingReplacements(root = document) {
    const scaffoldKinds = new Set([LWR.BACK_TRANSLATION_MATCH_KIND, LWR.UNLEARNED_MATCH_KIND]);
    if (root.nodeType === Node.ELEMENT_NODE && root.classList.contains(LWR.REPLACEMENT_CLASS)) {
      return scaffoldKinds.has(root.dataset.learnedWordMatchKind) ? 0 : 1;
    }

    return root.querySelectorAll
      ? root.querySelectorAll(
          `.${LWR.REPLACEMENT_CLASS}:not([data-learned-word-match-kind="${LWR.BACK_TRANSLATION_MATCH_KIND}"]):not([data-learned-word-match-kind="${LWR.UNLEARNED_MATCH_KIND}"])`
        ).length
      : 0;
  }

  function countExistingWordFamilyReplacements(root = document) {
    if (
      root.nodeType === Node.ELEMENT_NODE &&
      root.classList.contains(LWR.REPLACEMENT_CLASS) &&
      root.dataset.learnedWordMatchKind === LWR.WORD_FAMILY_MATCH_KIND
    ) {
      return 1;
    }

    return root.querySelectorAll
      ? root.querySelectorAll(
          `.${LWR.REPLACEMENT_CLASS}[data-learned-word-match-kind="${LWR.WORD_FAMILY_MATCH_KIND}"]`
        ).length
      : 0;
  }

  function hasExistingReplacements(root) {
    return countExistingReplacements(root) > 0;
  }

  function startObserver() {
    stopObserver();

    if (!LWR.hasActivePageReplacementFeatures() || !document.body || LWR.getTranslationExclusion()) {
      return;
    }

    ensureScrollListener();

    LWR.observer = new MutationObserver((mutations) => {
      if (applying) {
        return;
      }

      queueContextBlocks(getMutationContextBlocks(mutations), { restoreChangedExisting: true });
      if (pendingContextBlocks.size) {
        scheduleApply();
      }
    });

    LWR.observer.observe(document.body, {
      childList: true,
      characterData: true,
      subtree: true
    });
  }

  function getMutationContextBlocks(mutations) {
    const blocks = new Set();

    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        const block = getProcessableTextBlock(mutation.target);
        if (block) {
          blocks.add(block);
        }
        continue;
      }

      if (mutation.type === "childList") {
        for (const node of mutation.addedNodes) {
          for (const block of getProcessableBlocksInNode(node)) {
            blocks.add(block);
          }
        }
      }
    }

    return Array.from(blocks);
  }

  function nodeContainsProcessableText(node) {
    return getProcessableBlocksInNode(node).length > 0;
  }

  function getProcessableBlocksInNode(node) {
    if (!node) {
      return [];
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const block = getProcessableTextBlock(node);
      return block ? [block] : [];
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return [];
    }

    if (node.matches(LWR.IGNORED_SELECTOR) || !node.textContent.trim()) {
      return [];
    }

    const blocks = new Set();
    for (const textNode of LWR.collectTextNodes(node)) {
      const block = getProcessableTextBlock(textNode);
      if (block) {
        blocks.add(block);
      }
    }

    return Array.from(blocks);
  }

  function isProcessableTextNode(node) {
    return Boolean(getProcessableTextBlock(node));
  }

  function getProcessableTextBlock(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE || LWR.shouldIgnoreTextNode(node)) {
      return null;
    }

    const block = LWR.getTextBlock(node);
    return block && LWR.isProcessableBlock(block) ? block : null;
  }

  function ensureScrollListener() {
    if (scrollListenerInstalled) {
      return;
    }

    scrollListenerInstalled = true;
    const recheck = () => {
      if (LWR.hasActivePageReplacementFeatures() && !LWR.getTranslationExclusion()) {
        scheduleApplyIfPendingContext();
      }
    };

    globalThis.addEventListener("scroll", recheck, { passive: true });
    // Scroll events do not bubble, so a listener on the window never hears a
    // pane scrolling inside the page — YouTube's sidebar, a chat column, any
    // app-style layout that scrolls its own container. The capture phase does
    // hear them, wherever they come from.
    document.addEventListener("scroll", recheck, { capture: true, passive: true });
    // Text can arrive without the page changing shape: a "Show more" expander
    // reveals items that were in the DOM all along, which is an attribute
    // change the observer does not watch — YouTube's whole subscription list
    // sat there in English for exactly that reason. Clicking is what reveals
    // collapsed content, and it happens rarely enough to look again each time.
    document.addEventListener("click", recheck, { capture: true, passive: true });
  }

  function stopObserver() {
    if (LWR.observer) {
      LWR.observer.disconnect();
      LWR.observer = null;
    }

    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }

  }

  function queueContextBlocks(blocks, options = {}) {
    for (const block of blocks || []) {
      if (block && block.isConnected && block.nodeType === Node.ELEMENT_NODE) {
        pendingContextBlocks.set(
          block,
          Boolean(pendingContextBlocks.get(block) || options.restoreChangedExisting)
        );
      }
    }
  }

  function scheduleApply() {
    if (pendingTimer) {
      clearTimeout(pendingTimer);
    }

    pendingTimer = setTimeout(() => {
      pendingTimer = null;
      const entries = Array.from(pendingContextBlocks.entries());
      pendingContextBlocks.clear();
      const roots = entries
        .map(([block]) => block)
        .filter((block) => block.isConnected && LWR.isProcessableBlock(block));
      if (!roots.length) {
        return;
      }
      const restoreRoots = entries
        .filter(([block, restoreChangedExisting]) => restoreChangedExisting && block.isConnected)
        .map(([block]) => block)
        .filter((block) => LWR.isProcessableBlock(block));

      applyToPage({ preserveExisting: true, roots, restoreRoots });
    }, getApplyDebounceMs());
  }

  function scheduleApplyIfPendingContext() {
    if (
      !document.body ||
      applying ||
      !LWR.hasActivePageReplacementFeatures() ||
      LWR.getTranslationExclusion()
    ) {
      return;
    }

    const pending = LWR.collectPendingContextBlocks(document.body);
    // Blocks nothing has touched yet.
    const fresh = pending.filter((block) => !hasExistingReplacements(block));
    // Blocks whose text moved on since they were processed. The observer is
    // disconnected while a pass runs, so a page that rewrites itself mid-pass
    // has no other way back in — catching them here is what keeps a mutation
    // during a pass from being lost.
    const changed = pending.filter(
      (block) => hasExistingReplacements(block) && !LWR.isProcessedBlockUnchanged(block)
    );
    if (!fresh.length && !changed.length) {
      return;
    }

    queueContextBlocks(fresh, { restoreChangedExisting: false });
    queueContextBlocks(changed, { restoreChangedExisting: true });
    scheduleApply();
  }

  async function applyToPage(options = {}) {
    if (!document.body) {
      return;
    }

    const runId = ++LWR.applyRunId;
    applying = true;
    stopObserver();
    // A superseded pass can leave blocks hidden; show those again before this
    // one starts, so nothing is left invisible between passes.
    LWR.endAllPendingHides();

    try {
      const exclusion = LWR.getTranslationExclusion();
      if (exclusion) {
        pendingContextBlocks.clear();
        LWR.processedBlockSourceTexts = new WeakMap();
        // A full restore puts the original text back, so those blocks are
        // allowed to churn again when they are re-read.
        LWR.hiddenOnceBlocks = new WeakSet();
        clearProcessedBlockMarkers();
        restoreOriginalText(document);
        LWR.removeStyle();
        LWR.runtimeStats = LWR.createRuntimeStats({
          runId,
          status: "excluded",
          startedAt: Date.now(),
          targetLanguage: LWR.getCurrentLanguageCode(),
          lastError:
            exclusion.type === "site"
              ? "Translation is off for this site."
              : "Translation is off for this page."
        });
        return;
      }

      if (options.preserveExisting) {
        const restoreRoots = Object.prototype.hasOwnProperty.call(options, "restoreRoots")
          ? options.restoreRoots
          : options.roots || [document];
        restoreChangedProcessedBlocksForRoots(restoreRoots);
      } else {
        pendingContextBlocks.clear();
        LWR.processedBlockSourceTexts = new WeakMap();
        // A full restore puts the original text back, so those blocks are
        // allowed to churn again when they are re-read.
        LWR.hiddenOnceBlocks = new WeakSet();
        clearProcessedBlockMarkers();
        restoreOriginalText(document);
      }

      LWR.runtimeStats = LWR.createRuntimeStats({
        runId,
        status: "starting",
        startedAt: Date.now(),
        targetLanguage: LWR.getCurrentLanguageCode(),
        replacementCount: options.preserveExisting ? countExistingReplacements(document) : 0,
        wordFamilyReplacementCount: options.preserveExisting
          ? countExistingWordFamilyReplacements(document)
          : 0
      });
      LWR.compileEntries();

      if (!LWR.hasActivePageReplacementFeatures()) {
        LWR.removeStyle();
        LWR.updateRuntimeStats({
          status: LWR.state.enabled ? "no-active-entries" : "disabled"
        });
        return;
      }

      LWR.installStyle();
      LWR.installReverseHoverTranslation();
      await LWR.processContextRoot(document.body, runId, options);
    } finally {
      LWR.endAllPendingHides();
      // Whatever happened — excluded page, no translator, a thrown error — the
      // page must not stay hidden.
      LWR.uncloakPage();
      if (runId === LWR.applyRunId) {
        const blockedStatuses = new Set([
          "excluded",
          "disabled",
          "no-active-entries",
          "no-translator",
          "translator-unavailable",
          "translator-not-ready",
          "translator-preparing",
          "translator-error"
        ]);
        const blocked = blockedStatuses.has(LWR.runtimeStats.status);
        LWR.updateRuntimeStats({
          status: blocked ? LWR.runtimeStats.status : "complete",
          finishedAt: Date.now()
        });
        applying = false;
        startObserver();

        // A pass is capped, by collected units and by translation calls, so a
        // page bigger than one pass used to stop translating partway down and
        // wait for a scroll that might never come. Look again instead: the
        // check queues only blocks that are still unprocessed or have changed
        // since, and does nothing when there are none. Requiring that this pass
        // finished at least one block is what makes the chain terminate — every
        // finished block is recorded and dropped from the next collection.
        if (!blocked && LWR.runtimeStats.unitsProcessed > 0) {
          scheduleApplyIfPendingContext();
        }
      }
    }
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    restoreOriginalText,
    clearProcessedBlockMarkers,
    restoreChangedProcessedBlocks,
    countExistingReplacements,
    countExistingWordFamilyReplacements,
    applyToPage
  });
})();
