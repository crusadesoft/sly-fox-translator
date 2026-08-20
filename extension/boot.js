// Wiring.
//
// Everything above this file is definitions. This is what actually runs: load
// the saved state, keep it in step with storage and the popup, and start the
// first translation pass.
//
// It is also the only module that reaches into both halves — the translation
// modules and the Duolingo modules — which is why it is the last one loaded and
// why nothing reaches back into it.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  LWR.installDebugApi();

  globalThis.addEventListener("message", LWR.handleTranslatorActivationMessage);

  function warmContextTranslator() {
    // Only the top frame warms up eagerly: ad iframes would otherwise each
    // spin up a translator that their (usually empty) page pass never needs.
    if (globalThis !== globalThis.top || LWR.getTranslationExclusion()) {
      return;
    }

    const targetLanguage = LWR.getCurrentLanguageCode();
    if (
      !LWR.state.enabled ||
      !targetLanguage ||
      targetLanguage === LWR.SOURCE_LANGUAGE ||
      !LWR.getCurrentEntries().some((entry) => entry.enabled)
    ) {
      return;
    }

    LWR.getContextTranslator(targetLanguage).catch(() => {});
  }

  function loadState() {
    LWR.holdCloak();
    chrome.storage.local.get(
      { [LWR.STORAGE_KEY]: LWR.DEFAULT_STATE, [LWR.FLASHCARDS_STORAGE_KEY]: LWR.DEFAULT_FLASHCARDS_STATE },
      (stored) => {
        LWR.state = LWR.normalizeState(stored[LWR.STORAGE_KEY]);
        LWR.flashcardsState = LWR.normalizeFlashcardsState(stored[LWR.FLASHCARDS_STORAGE_KEY]);
        // Start the translator spin-up now so it overlaps the DOM walk that
        // applyToPage does before it needs the translator.
        warmContextTranslator();
        LWR.syncDuolingoAutoContinue();
        LWR.syncDuolingoTypeAnswers();
        LWR.syncDuolingoCopyPhrase();
        LWR.syncDuolingoBankTraps();
        LWR.syncDuolingoPageUi();
        LWR.applyToPage();
      }
    );
  }

  globalThis[LWR.REFRESH_KEY] = loadState;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes[LWR.FLASHCARDS_STORAGE_KEY]) {
      // Another tab (or an import) rewrote the practice stats; refresh the
      // strength dashboard if it is on screen.
      LWR.flashcardsState = LWR.normalizeFlashcardsState(changes[LWR.FLASHCARDS_STORAGE_KEY].newValue);
      LWR.renderDuolingoFlashcardsPanel();
    }

    if (!changes[LWR.STORAGE_KEY]) {
      return;
    }

    LWR.state = LWR.normalizeState(changes[LWR.STORAGE_KEY].newValue);
    LWR.syncDuolingoAutoContinue();
    LWR.syncDuolingoTypeAnswers();
    LWR.syncDuolingoCopyPhrase();
    LWR.syncDuolingoBankTraps();
    LWR.syncDuolingoSettingsPanelValues();
    LWR.ensureDuolingoWordsInfo();
    LWR.ensureDuolingoWordsTabs();
    LWR.ensureDuolingoLogoBadge();
    LWR.applyToPage();
  });

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== "object") {
        return false;
      }

      if (message.type === "LWR_GET_STATUS") {
        sendResponse({ ok: true, status: LWR.getPublicStatus() });
        return false;
      }

      if (message.type === "LWR_RETRY") {
        LWR.translatorCache = null;
        LWR.translatorCacheKey = "";
        LWR.translationCache.clear();
        const translatorApi = LWR.getTranslatorApi();
        LWR.applyToPage({
          allowTranslatorDownload: typeof translatorApi?.armActivation !== "function",
          preserveExisting: true
        }).catch((error) => {
          LWR.updateRuntimeStats({
            status: "translator-error",
            lastError: error && error.message ? error.message : "Retry failed."
          });
        });
        sendResponse({ ok: true, status: LWR.getPublicStatus() });
        return false;
      }

      if (message.type === "LWR_SYNC_DUOLINGO") {
        LWR.scrapeAllDuolingoWords().then(
          (result) => sendResponse({ ok: true, ...result }),
          (error) =>
            sendResponse({
              ok: false,
              reason: error && error.message ? error.message : "Could not sync Duolingo words."
            })
        );
        return true;
      }

      return false;
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", loadState, { once: true });
  } else {
    loadState();
  }

  // Everything is wired. From here on, a re-injection into this frame refreshes
  // the copy that is already running instead of building a second one.
  LWR.ready = true;
})();
