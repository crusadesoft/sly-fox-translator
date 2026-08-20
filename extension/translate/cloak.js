// Hiding text that has not been translated yet, and the guarantees that it
// always comes back.
//
// Two layers. page-cloak.js hides the whole page at document_start, before
// first paint, and lifts itself on a timeout no matter what happens here. This
// module handles the finer-grained version: individual blocks stay blank while
// their translation is in flight, then appear finished.
//
// Nothing here rewrites text. A hidden block just carries an attribute that a
// stylesheet rule paints transparent, so no failure in this file can corrupt
// the page's words — the worst case is a block that stays blank, and the sweep
// below exists so that cannot happen either.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const MAX_PENDING_HIDE_MS = 8000;
  const PENDING_HIDE_ATTRIBUTE = "data-lwr-pending";
  const PENDING_HIDE_SWEEP_MS = 500;
  const hiddenPendingBlocks = new Map();
  // A block is hidden at most once per page session. Re-collection is
  // legitimate (a pass can run out of budget, a translation can come back
  // empty, the page can rewrite a block), but text the reader has already
  // watched appear must never blink out again. Reset by apply.js when the page
  // is restored, so it lives on the namespace.
  LWR.hiddenOnceBlocks = new WeakSet();
  let pendingHideTimer = null;

  // page-cloak.js hid the page's text at document_start. It lifts itself after
  // its own timeout no matter what, so these helpers are best-effort: the page
  // is never left unreadable because the content scripts failed to call them.
  const CLOAK_STYLE_ID = "learned-word-replacer-cloak-style";
  const UNCLOAK_KEY = "__learnedWordReplacerUncloak";
  const HOLD_CLOAK_KEY = "__learnedWordReplacerHoldCloak";

  // "I exist" — the cloak waits on the content scripts turning up at
  // document_idle, which on a heavy page is seconds after it hid the text.
  function holdCloak() {
    const hold = globalThis[HOLD_CLOAK_KEY];
    if (typeof hold === "function") {
      hold();
    }
  }

  // The cloak IS its stylesheet, so both of these work off the shared DOM
  // rather than trusting a global to have survived.
  function isPageCloaked() {
    return Boolean(document.getElementById(CLOAK_STYLE_ID));
  }

  function uncloakPage() {
    const uncloak = globalThis[UNCLOAK_KEY];
    if (typeof uncloak === "function") {
      uncloak();
      return;
    }

    document.getElementById(CLOAK_STYLE_ID)?.remove();
  }

  function shouldHideTextUntilTranslated() {
    return Boolean(LWR.state.hideTextUntilTranslated);
  }

  function beginPendingHide(units) {
    if (!shouldHideTextUntilTranslated()) {
      return;
    }

    const deadline = Date.now() + MAX_PENDING_HIDE_MS;
    for (const unit of units) {
      const block = unit.block;
      if (
        !block ||
        block.nodeType !== Node.ELEMENT_NODE ||
        !block.isConnected ||
        LWR.hiddenOnceBlocks.has(block) ||
        hiddenPendingBlocks.has(block)
      ) {
        continue;
      }

      LWR.hiddenOnceBlocks.add(block);
      hiddenPendingBlocks.set(block, deadline);
      block.setAttribute(PENDING_HIDE_ATTRIBUTE, "");
    }

    if (hiddenPendingBlocks.size && !pendingHideTimer) {
      pendingHideTimer = setInterval(sweepPendingHides, PENDING_HIDE_SWEEP_MS);
    }
  }

  // Called once a unit has been painted (or given up on): its block is done
  // waiting and can show whatever it now says.
  function endPendingHide(unit) {
    revealPendingBlock(unit?.block);

    if (!hiddenPendingBlocks.size) {
      stopPendingHideTimer();
    }
  }

  function endAllPendingHides() {
    for (const block of Array.from(hiddenPendingBlocks.keys())) {
      revealPendingBlock(block);
    }

    stopPendingHideTimer();
  }

  function revealPendingBlock(block) {
    if (!block || !hiddenPendingBlocks.has(block)) {
      return;
    }

    hiddenPendingBlocks.delete(block);
    block.removeAttribute(PENDING_HIDE_ATTRIBUTE);
  }

  // The safety net: a pass that dies without reaching its blocks must not
  // leave them invisible.
  function sweepPendingHides() {
    const now = Date.now();

    for (const [block, deadline] of Array.from(hiddenPendingBlocks.entries())) {
      if (!block.isConnected || now > deadline) {
        revealPendingBlock(block);
      }
    }

    if (!hiddenPendingBlocks.size) {
      stopPendingHideTimer();
    }
  }

  function stopPendingHideTimer() {
    if (pendingHideTimer) {
      clearInterval(pendingHideTimer);
      pendingHideTimer = null;
    }
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    PENDING_HIDE_ATTRIBUTE,
    holdCloak,
    isPageCloaked,
    uncloakPage,
    beginPendingHide,
    endPendingHide,
    endAllPendingHides
  });
})();
