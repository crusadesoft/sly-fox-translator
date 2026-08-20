// Getting hold of a translator, and putting text through it.
//
// Chrome's on-device translator is not simply "there": a language pack can be
// missing, downloading, or refuse to be created without a user gesture. Most
// of the top half of this file is about telling those apart, because each one
// needs a different thing said in the popup, and one of them (a pack that
// needs a gesture) can be fixed by arming the next click on the page.
//
// The bottom half is throughput: blocks are wrapped in tags and sent as one
// batch sized to the translator's own input quota, so a page costs a handful
// of calls rather than one per paragraph.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const MAX_TRANSLATION_CACHE_ENTRIES = 400;
  const MAX_TRANSLATION_CALLS_PER_PASS = 70;
  const TRANSLATOR_AVAILABILITY_TIMEOUT_MS = 10000;
  const TRANSLATOR_CREATE_TIMEOUT_MS = 15000;
  const TRANSLATOR_OPPORTUNISTIC_CREATE_TIMEOUT_MS = 3000;
  const TRANSLATOR_PREPARE_TIMEOUT_MS = 120000;
  const TRANSLATOR_TRANSLATE_TIMEOUT_MS = 20000;
  const TRANSLATOR_BRIDGE_ACTIVATION_CHANNEL = "LWR_TRANSLATOR_BRIDGE_ACTIVATION";

  // The live translator and its cache. Read by hover.js and reset by boot.js
  // when the popup asks for a retry, so they sit on the namespace.
  LWR.translatorCacheKey = "";
  LWR.translatorCache = null;
  LWR.translationCache = new Map();

  let pageActivationListenerInstalled = false;
  let translatorPreparationPromise = null;
  let translatorRequestPromise = null;
  let translatorRequestKey = "";

  function getMaxTranslationCallsPerPass() {
    return LWR.getConfigNumber("maxTranslationCallsPerPass", MAX_TRANSLATION_CALLS_PER_PASS);
  }

  async function getContextTranslator(targetLanguage, options = {}) {
    const translatorApi = LWR.getTranslatorApi();
    if (!targetLanguage || targetLanguage === LWR.SOURCE_LANGUAGE || !translatorApi) {
      LWR.updateRuntimeStats({
        status: "no-translator",
        lastError: "Chrome Translator API is not available."
      });
      return null;
    }

    const key = `${LWR.SOURCE_LANGUAGE}:${targetLanguage}`;
    if (LWR.translatorCache && LWR.translatorCacheKey === key) {
      return LWR.translatorCache;
    }

    if (translatorPreparationPromise) {
      LWR.updateRuntimeStats({
        status: "translator-preparing",
        lastError: "Chrome Translator is already preparing."
      });
      return null;
    }

    // The eager warm-up and the first page pass can request the same
    // translator concurrently; share the in-flight request so the model is
    // only spun up once.
    const requestKey = `${key}:${options.allowTranslatorDownload ? "download" : "ready"}`;
    if (translatorRequestPromise && translatorRequestKey === requestKey) {
      return translatorRequestPromise;
    }

    const request = resolveContextTranslator(translatorApi, targetLanguage, options);
    translatorRequestPromise = request;
    translatorRequestKey = requestKey;

    try {
      return await request;
    } finally {
      if (translatorRequestPromise === request) {
        translatorRequestPromise = null;
        translatorRequestKey = "";
      }
    }
  }

  async function resolveContextTranslator(translatorApi, targetLanguage, options) {
    const translatorOptions = {
      sourceLanguage: LWR.SOURCE_LANGUAGE,
      targetLanguage
    };

    try {
      if (options.allowTranslatorDownload) {
        LWR.updateRuntimeStats({
          status: "translator-preparing",
          translatorAvailability: "downloadable",
          lastError: `Chrome is preparing Translator for English to ${targetLanguage}.`
        });
        translatorPreparationPromise = createAndCacheTranslator(
          translatorOptions,
          TRANSLATOR_PREPARE_TIMEOUT_MS,
          (loaded) => {
            LWR.updateRuntimeStats({
              status: "translator-preparing",
              translatorDownloadProgress: Number(loaded || 0)
            });
          }
        );
        try {
          await translatorPreparationPromise;
        } finally {
          translatorPreparationPromise = null;
        }
        return LWR.translatorCache;
      }

      LWR.updateRuntimeStats({ status: "checking-translator" });
      const availability = await withTimeout(
        translatorApi.availability(translatorOptions),
        TRANSLATOR_AVAILABILITY_TIMEOUT_MS
      );
      LWR.updateRuntimeStats({ translatorAvailability: availability });
      if (availability === "unavailable") {
        LWR.updateRuntimeStats({
          status: "translator-unavailable",
          lastError: `Chrome Translator is not available for English to ${targetLanguage}.`
        });
        return null;
      }

      if (availability !== "available") {
        LWR.updateRuntimeStats({
          status: "translator-preparing",
          lastError: `Chrome is preparing Translator for English to ${targetLanguage}.`
        });

        try {
          await createAndCacheTranslator(
            translatorOptions,
            TRANSLATOR_OPPORTUNISTIC_CREATE_TIMEOUT_MS
          );
          return LWR.translatorCache;
        } catch (error) {
          LWR.translatorCache = null;
          LWR.translatorCacheKey = "";
        }

        if (availability === "downloadable" || availability === "downloading") {
          installPageActivationPreparation(targetLanguage);
        }
        LWR.updateRuntimeStats({
          status: "translator-not-ready",
          lastError: `Chrome needs one click on this page to prepare Translator for English to ${targetLanguage}.`
        });
        return null;
      }

      await createAndCacheTranslator(translatorOptions, TRANSLATOR_CREATE_TIMEOUT_MS);
      LWR.updateRuntimeStats({ status: "translator-ready" });
      return LWR.translatorCache;
    } catch (error) {
      LWR.translatorCache = null;
      LWR.translatorCacheKey = "";
      installPageActivationPreparation(targetLanguage);
      LWR.updateRuntimeStats({
        status: "translator-error",
        lastError: error && error.message ? error.message : "Could not create Chrome Translator."
      });
      return null;
    }
  }

  async function createAndCacheTranslator(options, timeoutMs = 0, progressCallback = null) {
    const translatorApi = LWR.getTranslatorApi();
    if (!translatorApi) {
      throw new Error("Chrome Translator API is not available.");
    }

    const createPromise = translatorApi.create({
      ...options,
      monitor(monitor) {
        if (!monitor || typeof monitor.addEventListener !== "function") {
          return;
        }

        monitor.addEventListener("downloadprogress", (event) => {
          if (typeof progressCallback === "function") {
            progressCallback(event.loaded);
          }
        });
      }
    });

    LWR.translatorCache = timeoutMs ? await withTimeout(createPromise, timeoutMs) : await createPromise;
    LWR.translatorCacheKey = `${options.sourceLanguage}:${options.targetLanguage}`;
    LWR.translationCache.clear();
    LWR.updateRuntimeStats({ status: "translator-ready", lastError: "" });
    return LWR.translatorCache;
  }

  function withTimeout(promise, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("Timed out waiting for Chrome Translator."));
      }, timeoutMs);

      Promise.resolve(promise).then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        }
      );
    });
  }

  function installPageActivationPreparation(targetLanguage) {
    if (
      pageActivationListenerInstalled ||
      LWR.getTranslationExclusion() ||
      !targetLanguage ||
      targetLanguage === LWR.SOURCE_LANGUAGE ||
      !document.body
    ) {
      return;
    }

    pageActivationListenerInstalled = true;
    const translatorApi = LWR.getTranslatorApi();

    if (typeof translatorApi?.armActivation === "function") {
      translatorApi
        .armActivation({
          sourceLanguage: LWR.SOURCE_LANGUAGE,
          targetLanguage
        })
        .catch((error) => {
          pageActivationListenerInstalled = false;
          LWR.updateRuntimeStats({
            status: "translator-error",
            lastError: error && error.message ? error.message : "Could not prepare page activation."
          });
        });
      return;
    }

    const prepareFromPageClick = () => {
      pageActivationListenerInstalled = false;
      LWR.translatorCache = null;
      LWR.translatorCacheKey = "";
      LWR.translationCache.clear();
      LWR.applyToPage({ allowTranslatorDownload: true }).catch((error) => {
        LWR.updateRuntimeStats({
          status: "translator-error",
          lastError: error && error.message ? error.message : "Page-click preparation failed."
        });
      });
    };

    globalThis.addEventListener("pointerdown", prepareFromPageClick, {
      capture: true,
      once: true
    });
  }

  function handleTranslatorActivationMessage(event) {
    if (event.source !== globalThis) {
      return;
    }

    const message = event.data;
    const targetLanguage = LWR.getCurrentLanguageCode();
    const isForward =
      message?.sourceLanguage === LWR.SOURCE_LANGUAGE && message?.targetLanguage === targetLanguage;
    // Target-language pages arm the opposite direction, and its activation has
    // to refresh the page just the same.
    const isReverse =
      message?.sourceLanguage === targetLanguage && message?.targetLanguage === LWR.SOURCE_LANGUAGE;
    if (
      !message ||
      message.source !== LWR.MESSAGE_SOURCE ||
      message.channel !== TRANSLATOR_BRIDGE_ACTIVATION_CHANNEL ||
      !targetLanguage ||
      (!isForward && !isReverse)
    ) {
      return;
    }

    if (LWR.getTranslationExclusion()) {
      return;
    }

    const direction = isReverse
      ? `${message.sourceLanguage} to English`
      : `English to ${message.targetLanguage}`;

    if (message.progress) {
      LWR.updateRuntimeStats({
        status: "translator-preparing",
        translatorDownloadProgress: Number(message.loaded || 0),
        lastError: `Chrome is preparing Translator for ${direction}.`
      });
      return;
    }

    if (!message.ok) {
      LWR.updateRuntimeStats({
        status: "translator-not-ready",
        lastError:
          message.error?.message || `Chrome still needs page activation for ${direction}.`
      });
      return;
    }

    if (isReverse) {
      // A failed reverse create is never cached, so the refreshed pass picks
      // the now-ready translator up on its own.
      LWR.reverseHoverTranslatorPromise = null;
      LWR.reverseHoverTranslatorKey = "";
      LWR.applyToPage({ preserveExisting: true }).catch((error) => {
        LWR.updateRuntimeStats({
          status: "translator-error",
          lastError: error && error.message ? error.message : "Translator activation refresh failed."
        });
      });
      return;
    }

    pageActivationListenerInstalled = false;
    LWR.translatorCache = null;
    LWR.translatorCacheKey = "";
    LWR.translationCache.clear();
    LWR.applyToPage({ preserveExisting: true }).catch((error) => {
      LWR.updateRuntimeStats({
        status: "translator-error",
        lastError: error && error.message ? error.message : "Translator activation refresh failed."
      });
    });
  }

  function yieldToBrowser() {
    return new Promise((resolve) => {
      if (typeof globalThis.requestIdleCallback === "function") {
        globalThis.requestIdleCallback(resolve, { timeout: 80 });
        return;
      }

      setTimeout(resolve, 0);
    });
  }

  async function translateContextText(translator, targetLanguage, text, options = {}) {
    const cacheKey = getTranslationCacheKey(targetLanguage, text);
    const readCache = options.readCache !== false;
    const writeCache = options.writeCache !== false;

    if (readCache && LWR.translationCache.has(cacheKey)) {
      return LWR.translationCache.get(cacheKey);
    }

    if (LWR.runtimeStats.translationCalls >= getMaxTranslationCallsPerPass()) {
      return "";
    }

    try {
      LWR.updateRuntimeStats({ translationCalls: LWR.runtimeStats.translationCalls + 1 });
      const translatedText = await withTimeout(
        translator.translate(text),
        TRANSLATOR_TRANSLATE_TIMEOUT_MS
      );
      if (writeCache) {
        setTranslationCache(cacheKey, translatedText);
      }
      return translatedText;
    } catch (error) {
      return "";
    }
  }

  async function translateContextTexts(translator, targetLanguage, texts, options = {}) {
    const translations = new Array(texts.length).fill("");
    const pending = [];
    const readCache = options.readCache !== false;
    const writeCache = options.writeCache !== false;
    const onBatchTranslated =
      typeof options.onBatchTranslated === "function" ? options.onBatchTranslated : null;

    for (let index = 0; index < texts.length; index += 1) {
      const text = String(texts[index] || "");
      if (!text.trim()) {
        continue;
      }

      const cacheKey = getTranslationCacheKey(targetLanguage, text);
      if (readCache && LWR.translationCache.has(cacheKey)) {
        translations[index] = LWR.translationCache.get(cacheKey);
        continue;
      }

      pending.push({
        index,
        text,
        tagName: `lwr${index}`
      });
    }

    for (const batch of await createTranslationTextBatches(translator, pending)) {
      if (LWR.runtimeStats.translationCalls >= getMaxTranslationCallsPerPass()) {
        LWR.updateRuntimeStats({ lastError: "Translation budget reached for this pass." });
        break;
      }

      const batchText = buildBatchedTranslationInput(batch);
      const translatedBatch = await translateContextText(translator, targetLanguage, batchText);
      const parsedBatch = parseBatchedTranslationOutput(translatedBatch, batch);
      LWR.debugLog("batch", {
        items: batch.length,
        inputChars: batchText.length,
        outputChars: String(translatedBatch || "").length,
        parsedItems: parsedBatch.size
      });

      for (const item of batch) {
        const parsedTranslation = parsedBatch.get(item.tagName);
        if (parsedTranslation) {
          translations[item.index] = parsedTranslation;
          if (writeCache) {
            setTranslationCache(
              getTranslationCacheKey(targetLanguage, item.text),
              parsedTranslation
            );
          }
          continue;
        }

        translations[item.index] = await translateContextText(
          translator,
          targetLanguage,
          item.text,
          options
        );
      }

      if (onBatchTranslated) {
        // Batches preserve ascending text order, so every index up to this
        // batch's last item now holds its final translation.
        await onBatchTranslated(translations, batch[batch.length - 1].index + 1);
      }
    }

    return translations;
  }

  async function createTranslationTextBatches(translator, items) {
    if (!items.length) {
      return [];
    }

    const maxUsage = getTranslatorInputQuota(translator);
    if (!Number.isFinite(maxUsage)) {
      return [items];
    }

    const batches = [];
    let batch = [];

    for (const item of items) {
      const candidate = [...batch, item];
      const candidateText = buildBatchedTranslationInput(candidate);
      const candidateUsage = await measureTranslatorInputUsage(translator, candidateText);

      if (batch.length && candidateUsage > maxUsage) {
        batches.push(batch);
        batch = [item];
        continue;
      }

      batch = candidate;
    }

    if (batch.length) {
      batches.push(batch);
    }

    return batches;
  }

  function getTranslatorInputQuota(translator) {
    const configured = Number(LWR.getRuntimeConfig().maxBatchTranslationUsage);
    if (Number.isFinite(configured) && configured > 0) {
      return configured;
    }

    const quota = Number(translator?.inputQuota);
    return Number.isFinite(quota) && quota > 0 ? Math.floor(quota * 0.9) : Infinity;
  }

  async function measureTranslatorInputUsage(translator, text) {
    if (typeof translator?.measureInputUsage !== "function") {
      return String(text || "").length;
    }

    try {
      const usage = await translator.measureInputUsage(String(text || ""));
      return Number.isFinite(Number(usage)) ? Number(usage) : 0;
    } catch (error) {
      return String(text || "").length;
    }
  }

  function buildBatchedTranslationInput(items) {
    return items.map(getBatchedTranslationItemText).join("\n");
  }

  function getBatchedTranslationItemText(item) {
    return `<${item.tagName}>\n${item.text}\n</${item.tagName}>`;
  }

  function parseBatchedTranslationOutput(translatedText, items) {
    const parsed = new Map();
    const output = String(translatedText || "");

    for (const item of items) {
      const tagName = escapeRegExp(item.tagName);
      const pattern = new RegExp(`<${tagName}>\\s*([\\s\\S]*?)\\s*<\\/${tagName}>`, "i");
      const match = output.match(pattern);
      if (match && match[1].trim()) {
        parsed.set(item.tagName, match[1].trim());
      }
    }

    return parsed;
  }

  function getTranslationCacheKey(targetLanguage, text) {
    return `${targetLanguage}\n${text}`;
  }

  function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function setTranslationCache(key, value) {
    LWR.translationCache.set(key, value);

    if (LWR.translationCache.size <= MAX_TRANSLATION_CACHE_ENTRIES) {
      return;
    }

    const oldestKey = LWR.translationCache.keys().next().value;
    LWR.translationCache.delete(oldestKey);
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    TRANSLATOR_AVAILABILITY_TIMEOUT_MS,
    TRANSLATOR_CREATE_TIMEOUT_MS,
    TRANSLATOR_OPPORTUNISTIC_CREATE_TIMEOUT_MS,
    getMaxTranslationCallsPerPass,
    getContextTranslator,
    withTimeout,
    handleTranslatorActivationMessage,
    yieldToBrowser,
    translateContextText,
    translateContextTexts
  });
})();
