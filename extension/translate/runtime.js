// Per-run bookkeeping: the debug log, the counters a pass fills in, and the
// status object that the popup panel and the toolbar badge read back.
//
// `runtimeStats` lives on the namespace rather than in this module, because a
// pass rewrites it from translator.js, passes.js and apply.js as it goes.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const TEST_CONFIG_KEY = "__learnedWordReplacerTestConfig";
  const DEBUG_KEY = "__learnedWordReplacerDebug";
  // Statuses worth showing the moment they happen: they are the ones a person
  // is watching for, so they skip the batching timer.
  const IMMEDIATE_STATUS_PUBLISH_STATUSES = new Set([
    "checking-translator",
    "translator-preparing",
    "translating"
  ]);

  LWR.runtimeStats = createRuntimeStats();
  let statusPublishTimer = null;

  function getRuntimeConfig() {
    return globalThis[TEST_CONFIG_KEY] && typeof globalThis[TEST_CONFIG_KEY] === "object"
      ? globalThis[TEST_CONFIG_KEY]
      : {};
  }

  function getTranslatorApi() {
    return getRuntimeConfig().Translator || LWR.createBridgeTranslatorApi();
  }

  function isDebugLoggingEnabled() {
    try {
      return globalThis.localStorage?.getItem("__lwrDebug") === "1";
    } catch (error) {
      return false;
    }
  }

  function debugLog(label, data) {
    if (!isDebugLoggingEnabled()) {
      return;
    }

    const line = `${label} ${JSON.stringify(data)}`;
    console.log(`LWR-DEBUG ${line}`);

    // Content-script console output is not always visible to inspection
    // tooling, so mirror the newest entries onto the DOM as well.
    try {
      const root = document.documentElement;
      const previous = root.getAttribute("data-lwr-debug") || "";
      root.setAttribute("data-lwr-debug", `${previous}\n${line}`.slice(-8000));
    } catch (error) {
      // The document can be gone during unload.
    }
  }

  function getConfigNumber(key, fallback) {
    const value = Number(getRuntimeConfig()[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function createRuntimeStats(overrides = {}) {
    return {
      runId: 0,
      status: "idle",
      startedAt: 0,
      finishedAt: 0,
      targetLanguage: "",
      translatorAvailability: "",
      unitsCollected: 0,
      unitsProcessed: 0,
      unitsSkipped: 0,
      translationCalls: 0,
      replacementCount: 0,
      wordFamilyReplacementCount: 0,
      lastError: "",
      ...overrides
    };
  }

  function updateRuntimeStats(patch) {
    LWR.runtimeStats = {
      ...LWR.runtimeStats,
      ...patch
    };

    if (IMMEDIATE_STATUS_PUBLISH_STATUSES.has(patch.status)) {
      publishStatusNow();
      return;
    }

    scheduleStatusPublish();
  }

  function getPublicStatus() {
    const replacementCount = document.body
      ? LWR.countExistingReplacements(document)
      : LWR.runtimeStats.replacementCount;
    const wordFamilyReplacementCount = document.body
      ? LWR.countExistingWordFamilyReplacements(document)
      : LWR.runtimeStats.wordFamilyReplacementCount;

    return {
      ...LWR.runtimeStats,
      replacementCount,
      wordFamilyReplacementCount,
      cacheKey: LWR.translatorCacheKey,
      hasTranslator: Boolean(LWR.translatorCache),
      activeEntries: LWR.compiledEntries.length,
      translationCacheSize: LWR.translationCache.size,
      enabled: Boolean(LWR.state.enabled),
      profileName: LWR.getCurrentProfile()?.name || "",
      url: location.href
    };
  }

  function scheduleStatusPublish() {
    if (!globalThis.chrome || !chrome.runtime || statusPublishTimer) {
      return;
    }

    statusPublishTimer = setTimeout(() => {
      statusPublishTimer = null;
      publishStatus();
    }, 100);
  }

  function publishStatusNow() {
    if (statusPublishTimer) {
      clearTimeout(statusPublishTimer);
      statusPublishTimer = null;
    }

    publishStatus();
  }

  function publishStatus() {
    if (!globalThis.chrome || !chrome.runtime || !chrome.runtime.sendMessage) {
      return;
    }

    try {
      chrome.runtime.sendMessage({
        type: "LWR_STATUS",
        status: getPublicStatus()
      });
    } catch (error) {
      // The extension context can disappear while a page is unloading.
    }
  }

  function installDebugApi() {
    globalThis[DEBUG_KEY] = {
      applyNow() {
        LWR.applyToPage();
      },
      getSnapshot() {
        return getPublicStatus();
      }
    };
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    getRuntimeConfig,
    getTranslatorApi,
    debugLog,
    getConfigNumber,
    createRuntimeStats,
    updateRuntimeStats,
    getPublicStatus,
    installDebugApi
  });
})();
