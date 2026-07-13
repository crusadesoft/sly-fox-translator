(() => {
  const REFRESH_KEY = "__learnedWordReplacerRefresh";
  const STORAGE_KEY = "learnedWordReplacerState";
  const REPLACEMENT_CLASS = "learned-word-replacer-token";
  const REVERSE_HOVER_TOOLTIP_CLASS = "learned-word-replacer-hover-tooltip";
  const STYLE_ID = "learned-word-replacer-style";
  const SOURCE_LANGUAGE = "en";
  const MAX_TRANSLATION_CACHE_ENTRIES = 400;
  const MAX_CONTEXT_UNITS_PER_PASS = 35;
  const MAX_TRANSLATION_CALLS_PER_PASS = 70;
  const TRANSLATOR_AVAILABILITY_TIMEOUT_MS = 10000;
  const TRANSLATOR_CREATE_TIMEOUT_MS = 15000;
  const TRANSLATOR_OPPORTUNISTIC_CREATE_TIMEOUT_MS = 3000;
  const TRANSLATOR_PREPARE_TIMEOUT_MS = 120000;
  const TRANSLATOR_TRANSLATE_TIMEOUT_MS = 20000;
  const APPLY_DEBOUNCE_MS = 700;
  const FULL_PAGE_SCAN_DELAY_MS = 800;
  const REVERSE_HOVER_DELAY_MS = 260;
  const MAX_REVERSE_HOVER_CACHE_ENTRIES = 200;
  const VIEWPORT_MARGIN_PX = 900;
  const TEST_CONFIG_KEY = "__learnedWordReplacerTestConfig";
  const DEBUG_KEY = "__learnedWordReplacerDebug";
  const TRANSLATOR_BRIDGE_REQUEST_CHANNEL = "LWR_TRANSLATOR_BRIDGE_REQUEST";
  const TRANSLATOR_BRIDGE_RESPONSE_CHANNEL = "LWR_TRANSLATOR_BRIDGE_RESPONSE";
  const TRANSLATOR_BRIDGE_ACTIVATION_CHANNEL = "LWR_TRANSLATOR_BRIDGE_ACTIVATION";
  const MESSAGE_SOURCE = "learned-word-replacer";
  const LANGUAGE_NAMES = {
    de: "German",
    el: "Greek",
    es: "Spanish",
    fr: "French",
    it: "Italian",
    la: "Latin",
    uk: "Ukrainian"
  };
  const IMMEDIATE_STATUS_PUBLISH_STATUSES = new Set([
    "checking-translator",
    "translator-preparing",
    "translating"
  ]);
  const ALIGNMENT_PREFIX_STOPWORDS = new Set(["a", "an", "the", "to"]);
  const ALIGNMENT_COMMON_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "being",
    "but",
    "by",
    "did",
    "do",
    "does",
    "for",
    "from",
    "had",
    "has",
    "have",
    "in",
    "is",
    "not",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "used",
    "was",
    "were",
    "with"
  ]);
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
    "nav",
    "aside",
    "footer",
    "pre",
    "code",
    "kbd",
    "samp",
    "svg",
    "math",
    "[hidden]",
    "[aria-hidden='true']",
    "[role='navigation']",
    "[role='complementary']",
    "[role='contentinfo']",
    "[contenteditable]",
    `[class~='${REPLACEMENT_CLASS}']`,
    `[class~='${REVERSE_HOVER_TOOLTIP_CLASS}']`
  ].join(",");

  const DEFAULT_STATE = {
    version: 2,
    enabled: true,
    showHighlights: true,
    showOriginalOnHover: true,
    translateEnglishOnHover: true,
    wholeWords: true,
    caseSensitive: false,
    preserveCase: true,
    currentProfileId: "",
    doNotTranslate: {
      sites: [],
      pages: []
    },
    profiles: []
  };

  if (globalThis[REFRESH_KEY]) {
    globalThis[REFRESH_KEY]();
    return;
  }

  let state = DEFAULT_STATE;
  let compiledEntries = [];
  let observer = null;
  let pendingTimer = null;
  let fullPageScanTimer = null;
  let applying = false;
  let applyRunId = 0;
  let translatorCacheKey = "";
  let translatorCache = null;
  let scrollListenerInstalled = false;
  let pageActivationListenerInstalled = false;
  const translationCache = new Map();
  let processedBlockSourceTexts = new WeakMap();
  let pendingContextBlocks = new Map();
  let runtimeStats = createRuntimeStats();
  let statusPublishTimer = null;
  let translatorPreparationPromise = null;
  let reverseHoverTooltip = null;
  let reverseHoverListenerInstalled = false;
  let reverseHoverTimer = null;
  let reverseHoverRequestId = 0;
  let reverseHoverKey = "";
  let reverseHoverPointer = { x: 0, y: 0 };
  const reverseHoverTranslationCache = new Map();

  function getRuntimeConfig() {
    return globalThis[TEST_CONFIG_KEY] && typeof globalThis[TEST_CONFIG_KEY] === "object"
      ? globalThis[TEST_CONFIG_KEY]
      : {};
  }

  function getTranslatorApi() {
    return getRuntimeConfig().Translator || createBridgeTranslatorApi();
  }

  function getConfigNumber(key, fallback) {
    const value = Number(getRuntimeConfig()[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function getMaxContextUnitsPerPass() {
    return getConfigNumber("maxContextUnitsPerPass", MAX_CONTEXT_UNITS_PER_PASS);
  }

  function getMaxTranslationCallsPerPass() {
    return getConfigNumber("maxTranslationCallsPerPass", MAX_TRANSLATION_CALLS_PER_PASS);
  }

  function getApplyDebounceMs() {
    return getConfigNumber("applyDebounceMs", APPLY_DEBOUNCE_MS);
  }

  function getFullPageScanDelayMs() {
    return getConfigNumber("fullPageScanDelayMs", FULL_PAGE_SCAN_DELAY_MS);
  }

  function shouldScanWholePage() {
    return getRuntimeConfig().scanWholePage !== false;
  }

  function getViewportMarginPx() {
    return getConfigNumber("viewportMarginPx", VIEWPORT_MARGIN_PX);
  }

  function getReverseHoverDelayMs() {
    return getConfigNumber("reverseHoverDelayMs", REVERSE_HOVER_DELAY_MS);
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
      lastError: "",
      ...overrides
    };
  }

  function updateRuntimeStats(patch) {
    runtimeStats = {
      ...runtimeStats,
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
      ? countExistingReplacements(document)
      : runtimeStats.replacementCount;

    return {
      ...runtimeStats,
      replacementCount,
      cacheKey: translatorCacheKey,
      hasTranslator: Boolean(translatorCache),
      activeEntries: compiledEntries.length,
      translationCacheSize: translationCache.size,
      enabled: Boolean(state.enabled),
      profileName: getCurrentProfile()?.name || "",
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
        applyToPage();
      },
      getSnapshot() {
        return getPublicStatus();
      }
    };
  }

  installDebugApi();

  function normalizeEntries(entries) {
    return Array.isArray(entries)
      ? entries
          .map((entry) => ({
            id: String(entry.id || createId()),
            source: String(entry.source || "").trim(),
            target: String(entry.target || "").trim(),
            learned: true,
            enabled: entry.enabled !== false,
            origin:
              entry.origin === "duolingo" || String(entry.definition || "").startsWith("Duolingo meanings:")
                ? "duolingo"
                : "manual",
            definition: String(entry.definition || "").trim(),
            createdAt: Number(entry.createdAt || Date.now())
          }))
          .filter((entry) => entry.source && entry.target)
      : [];
  }

  function inferLanguageCodeFromEntries(entries) {
    const targetText = normalizeEntries(entries)
      .map((entry) => entry.target)
      .join("\n");

    if (!targetText.trim()) {
      return "";
    }

    if (/[\u0370-\u03ff]/u.test(targetText)) {
      return "el";
    }

    if (/[\u0400-\u04ff]/u.test(targetText)) {
      return "uk";
    }

    return "";
  }

  function repairProfileLanguage(profile) {
    if (!profile || String(profile.id || "").startsWith("builtin-")) {
      return profile;
    }

    const inferredLanguageCode = inferLanguageCodeFromEntries(profile.entries);
    const languageCode = String(inferredLanguageCode || profile.languageCode || "");
    const name =
      profile.name === "Default" && LANGUAGE_NAMES[languageCode]
        ? LANGUAGE_NAMES[languageCode]
        : profile.name;

    if (languageCode === profile.languageCode && name === profile.name) {
      return profile;
    }

    return {
      ...profile,
      name,
      languageCode
    };
  }

  function normalizeExcludedSite(value) {
    const hostname = String(value || "").trim().toLocaleLowerCase();
    return hostname && !/[/:?#]/.test(hostname) ? hostname : "";
  }

  function normalizeExcludedPage(value) {
    try {
      const parsed = new URL(String(value || ""));
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return "";
      }
      parsed.hash = "";
      return parsed.href;
    } catch (error) {
      return "";
    }
  }

  function normalizeDoNotTranslate(rawValue) {
    const source = rawValue && typeof rawValue === "object" ? rawValue : {};
    return {
      sites: Array.from(
        new Set((Array.isArray(source.sites) ? source.sites : []).map(normalizeExcludedSite).filter(Boolean))
      ),
      pages: Array.from(
        new Set((Array.isArray(source.pages) ? source.pages : []).map(normalizeExcludedPage).filter(Boolean))
      )
    };
  }

  function normalizeState(rawState) {
    const source = rawState && typeof rawState === "object" ? rawState : {};
    const next = {
      ...DEFAULT_STATE,
      ...source,
      version: 2
    };

    delete next.replacementMode;
    delete next.showObviousCognates;
    next.doNotTranslate = normalizeDoNotTranslate(source.doNotTranslate);

    if (Array.isArray(source.profiles)) {
      next.profiles = source.profiles
        .map((profile, index) => ({
          id: String(profile.id || createId()),
          name: String(profile.name || `Profile ${index + 1}`).trim() || `Profile ${index + 1}`,
          languageCode: String(profile.languageCode || ""),
          entries: normalizeEntries(profile.entries)
        }))
        .filter((profile) => profile.name);
    } else {
      const legacyEntries = normalizeEntries(source.entries);
      next.profiles = legacyEntries.length
        ? [
            {
              id: "default",
              name: "Default",
              languageCode: "",
              entries: legacyEntries
            }
          ]
        : [];
    }

    next.profiles = next.profiles
      .map(repairProfileLanguage)
      .filter(
        (profile) =>
          profile.entries.length ||
          (profile.id !== "default" && (profile.name !== "Default" || profile.languageCode))
      );

    if (!next.profiles.some((profile) => profile.id === next.currentProfileId)) {
      next.currentProfileId = next.profiles[0]?.id || "";
    }

    return next;
  }

  function getCurrentProfile() {
    return (
      state.profiles.find((candidate) => candidate.id === state.currentProfileId) ||
      state.profiles[0] ||
      null
    );
  }

  function getCurrentEntries() {
    const profile = getCurrentProfile();
    return profile ? profile.entries : [];
  }

  function getCurrentLanguageCode() {
    const profile = getCurrentProfile();
    return profile ? String(profile.languageCode || "") : "";
  }

  function hasActivePageReplacementFeatures() {
    return Boolean(state.enabled && compiledEntries.length);
  }

  function getTranslationExclusion() {
    let page = "";
    let site = "";

    try {
      const parsed = new URL(location.href);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        return null;
      }
      parsed.hash = "";
      page = parsed.href;
      site = parsed.hostname.toLocaleLowerCase();
    } catch (error) {
      return null;
    }

    const exclusions = state.doNotTranslate || { sites: [], pages: [] };
    if (exclusions.sites.includes(site)) {
      return { type: "site", value: site };
    }
    if (exclusions.pages.includes(page)) {
      return { type: "page", value: page };
    }
    return null;
  }

  function compileEntries() {
    compiledEntries = getCurrentEntries()
      .filter((entry) => state.enabled && entry.enabled)
      .map((entry) => {
        const targetCandidates = buildTargetCandidates(entry.target);
        const sourceCandidates = buildSourceAlignmentCandidates(entry);
        return {
          ...entry,
          targetCandidates,
          sourceCandidates
        };
      })
      .filter((entry) => entry.targetCandidates.length)
      .sort(
        (a, b) => getLongestTargetLength(b) - getLongestTargetLength(a) || a.createdAt - b.createdAt
      );
  }

  function getLongestTargetLength(entry) {
    return Math.max(...entry.targetCandidates.map((candidate) => candidate.length), 0);
  }

  function buildTargetCandidates(target) {
    const targetText = String(target || "").trim();
    const splitCandidates = targetText
      .split(/\s+(?:\/|;)\s+|\s*;\s*/)
      .map((candidate) => candidate.trim())
      .filter(Boolean);
    const candidates = hasTargetAlternativeSeparator(targetText) ? splitCandidates : [targetText];
    const seen = new Set();

    return candidates.filter((candidate) => {
      const key = candidate.toLocaleLowerCase();
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  function hasTargetAlternativeSeparator(target) {
    return /\s\/\s|;/.test(String(target || ""));
  }

  function buildSourceAlignmentCandidates(entry) {
    const byValue = new Map();

    for (const term of getEnglishAlignmentTerms(entry)) {
      const candidate = createSourceAlignmentCandidate(term);
      if (!candidate) {
        continue;
      }

      const key = candidate.value.toLocaleLowerCase();
      const existing = byValue.get(key);
      if (!existing || candidate.score > existing.score) {
        byValue.set(key, candidate);
      }
    }

    return Array.from(byValue.values()).sort(
      (a, b) => b.score - a.score || b.value.length - a.value.length
    );
  }

  function getEnglishAlignmentTerms(entry) {
    const terms = [];
    addEnglishAlignmentTerms(terms, entry.source, "source");
    addEnglishAlignmentTerms(terms, entry.definition, "definition");
    return terms;
  }

  function addEnglishAlignmentTerms(terms, text, origin) {
    const cleanedText = cleanEnglishAlignmentText(text);
    if (!cleanedText) {
      return;
    }

    for (const part of cleanedText.split(/\s*(?:,|;|\n|\s\/\s)\s*/u)) {
      const value = cleanEnglishAlignmentTerm(part);
      if (value) {
        terms.push({ value, origin });
      }
    }
  }

  function cleanEnglishAlignmentText(text) {
    return String(text || "")
      .replace(/^duolingo meanings:\s*/iu, "")
      .replace(/\s+/gu, " ")
      .trim();
  }

  function cleanEnglishAlignmentTerm(text) {
    return String(text || "")
      .replace(/\([^)]*\)/gu, " ")
      .replace(/^[\s"'“”‘’()[\]{}<>]+|[\s"'“”‘’()[\]{}<>]+$/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
  }

  function createSourceAlignmentCandidate(term) {
    const value = stripLeadingAlignmentStopwords(term.value);
    if (!value) {
      return null;
    }

    const tokens = getReplaceableSourceTokens(value);
    if (!tokens.length) {
      return null;
    }

    const exactSingleSourceTerm = term.origin === "source" && tokens.length === 1;
    const usefulTokens = tokens.filter((token) =>
      isUsefulAlignmentToken(token.value, exactSingleSourceTerm)
    );

    if (!usefulTokens.length) {
      return null;
    }

    return {
      value,
      origin: term.origin,
      tokenCount: tokens.length,
      score:
        (term.origin === "source" ? 120 : 90) +
        Math.min(value.length, 40) +
        (tokens.length > 1 ? 25 : 0)
    };
  }

  function stripLeadingAlignmentStopwords(text) {
    const tokens = getReplaceableSourceTokens(text);
    if (tokens.length <= 1) {
      return text;
    }

    let start = 0;
    while (
      start < tokens.length - 1 &&
      ALIGNMENT_PREFIX_STOPWORDS.has(tokens[start].value.toLocaleLowerCase())
    ) {
      start += 1;
    }

    return text.slice(tokens[start].start).trim();
  }

  function isUsefulAlignmentToken(value, allowCommonWord) {
    const normalized = String(value || "").trim().toLocaleLowerCase();
    if (!/\p{L}/u.test(normalized)) {
      return false;
    }

    if (allowCommonWord) {
      return true;
    }

    return normalized.length > 2 && !ALIGNMENT_COMMON_WORDS.has(normalized);
  }

  function createId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  function createBridgeTranslatorApi() {
    return {
      availability(options) {
        return requestTranslatorBridge("availability", { options });
      },
      armActivation(options) {
        return requestTranslatorBridge("armActivation", { options });
      },
      async create(options = {}) {
        const { monitor, ...translatorOptions } = options;
        let progressListener = null;

        if (typeof monitor === "function") {
          monitor({
            addEventListener(type, listener) {
              if (type === "downloadprogress" && typeof listener === "function") {
                progressListener = listener;
              }
            }
          });
        }

        const metadata = await requestTranslatorBridge(
          "create",
          { options: translatorOptions },
          (progress) => {
            if (progressListener) {
              progressListener(progress);
            }
          }
        );

        const translator = {
          inputQuota: Number(metadata?.inputQuota),
          translate(text) {
            return requestTranslatorBridge("translate", {
              options: translatorOptions,
              text
            });
          }
        };

        if (metadata?.hasMeasureInputUsage) {
          translator.measureInputUsage = (text) =>
            requestTranslatorBridge("measureInputUsage", {
              options: translatorOptions,
              text
            });
        }

        return translator;
      }
    };
  }

  function requestTranslatorBridge(action, payload, progressCallback = null) {
    const requestId = createId();

    return new Promise((resolve, reject) => {
      function cleanup() {
        globalThis.removeEventListener("message", handleMessage);
      }

      function handleMessage(event) {
        if (event.source !== globalThis) {
          return;
        }

        const message = event.data;
        if (
          !message ||
          message.source !== MESSAGE_SOURCE ||
          message.channel !== TRANSLATOR_BRIDGE_RESPONSE_CHANNEL ||
          message.requestId !== requestId
        ) {
          return;
        }

        if (message.progress) {
          if (typeof progressCallback === "function") {
            progressCallback({
              loaded: Number(message.loaded || 0),
              total: Number(message.total || 1)
            });
          }
          return;
        }

        cleanup();
        if (message.ok) {
          resolve(message.value);
          return;
        }

        reject(new Error(message.error?.message || "Chrome Translator failed."));
      }

      globalThis.addEventListener("message", handleMessage);
      globalThis.postMessage(
        {
          source: MESSAGE_SOURCE,
          channel: TRANSLATOR_BRIDGE_REQUEST_CHANNEL,
          requestId,
          action,
          ...payload
        },
        "*"
      );
    });
  }

  function installStyle() {
    let style = document.getElementById(STYLE_ID);

    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }

    const reverseHoverTooltipStyle = `
      .${REVERSE_HOVER_TOOLTIP_CLASS} {
        background: #101828;
        border-radius: 0.3em;
        box-shadow: 0 4px 12px rgba(16, 24, 40, 0.22);
        color: #ffffff;
        font: 600 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        left: 0;
        max-width: min(320px, calc(100vw - 16px));
        opacity: 0;
        overflow-wrap: anywhere;
        padding: 0.35em 0.5em;
        pointer-events: none;
        position: fixed;
        text-align: center;
        top: 0;
        transform: translate(-50%, calc(-100% - 12px));
        visibility: hidden;
        white-space: normal;
        z-index: 2147483647;
      }

      .${REVERSE_HOVER_TOOLTIP_CLASS}[data-visible="true"] {
        opacity: 1;
        visibility: visible;
      }
    `;

    const originalHoverStyle = state.showOriginalOnHover
      ? `
        .${REPLACEMENT_CLASS}:hover::after {
          background: #101828;
          border-radius: 0.3em;
          bottom: calc(100% + 0.35em);
          box-shadow: 0 4px 12px rgba(16, 24, 40, 0.22);
          color: #ffffff;
          content: attr(data-learned-word-original);
          font: 600 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          left: 50%;
          max-width: min(320px, 80vw);
          overflow-wrap: anywhere;
          padding: 0.35em 0.5em;
          pointer-events: none;
          position: absolute;
          text-align: center;
          transform: translateX(-50%);
          white-space: normal;
          width: max-content;
          z-index: 2147483647;
        }
      `
      : "";

    if (!state.translateEnglishOnHover) {
      clearReverseHover();
    }

    style.textContent =
      (state.showHighlights
        ? `
        .${REPLACEMENT_CLASS} {
          background: color-mix(in srgb, #f8d349 38%, transparent);
          border-radius: 0.2em;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
          cursor: inherit;
          padding: 0 0.08em;
          position: relative;
        }

      ` + originalHoverStyle + reverseHoverTooltipStyle
        : `
        .${REPLACEMENT_CLASS} {
          cursor: inherit;
          position: relative;
        }
      ` + originalHoverStyle + reverseHoverTooltipStyle);
  }

  function removeStyle() {
    removeReverseHoverTooltip();
    const style = document.getElementById(STYLE_ID);
    if (style) {
      style.remove();
    }
  }

  function shouldIgnoreTextNode(node) {
    if (!node.nodeValue || !node.nodeValue.trim()) {
      return true;
    }

    const parent = node.parentElement;
    if (!parent) {
      return true;
    }

    return Boolean(parent.closest(IGNORED_SELECTOR));
  }

  function isWordCharacter(char) {
    return Boolean(char && /[\p{L}\p{N}\p{M}_]/u.test(char));
  }

  function isApostrophe(char) {
    return char === "'" || char === "\u2019" || char === "\u02bc";
  }

  function installReverseHoverTranslation() {
    if (reverseHoverListenerInstalled) {
      return;
    }

    reverseHoverListenerInstalled = true;
    document.addEventListener("pointermove", handleReverseHoverPointerMove, { passive: true });
    document.documentElement.addEventListener("mouseleave", clearReverseHover, { passive: true });
    globalThis.addEventListener("blur", clearReverseHover);
    globalThis.addEventListener("scroll", clearReverseHover, { capture: true, passive: true });
  }

  function handleReverseHoverPointerMove(event) {
    const target = event.target;
    if (
      !state.enabled ||
      !state.translateEnglishOnHover ||
      !compiledEntries.length ||
      !getCurrentLanguageCode() ||
      getTranslationExclusion() ||
      (target && typeof target.closest === "function" && target.closest(`.${REPLACEMENT_CLASS}`))
    ) {
      clearReverseHover();
      return;
    }

    const word = getEnglishWordAtPoint(event.clientX, event.clientY);
    if (!word) {
      clearReverseHover();
      return;
    }

    const targetLanguage = getCurrentLanguageCode();
    const key = `${targetLanguage}\u0000${word.toLocaleLowerCase()}`;
    reverseHoverPointer = { x: event.clientX, y: event.clientY };

    if (key === reverseHoverKey) {
      positionReverseHoverTooltip();
      return;
    }

    clearReverseHover();
    reverseHoverKey = key;
    const requestId = ++reverseHoverRequestId;
    const cached = reverseHoverTranslationCache.get(key);

    if (cached) {
      showReverseHoverTooltip(targetLanguage, cached);
      return;
    }

    reverseHoverTimer = setTimeout(() => {
      reverseHoverTimer = null;
      translateReverseHoverWord(word, targetLanguage, key, requestId);
    }, getReverseHoverDelayMs());
  }

  async function translateReverseHoverWord(word, targetLanguage, key, requestId) {
    const translatorKey = `${SOURCE_LANGUAGE}:${targetLanguage}`;
    if (!translatorCache || translatorCacheKey !== translatorKey) {
      return;
    }

    try {
      const translated = String(await translatorCache.translate(word)).trim();
      if (!translated || requestId !== reverseHoverRequestId || key !== reverseHoverKey) {
        return;
      }

      cacheReverseHoverTranslation(key, translated);
      showReverseHoverTooltip(targetLanguage, translated);
    } catch (error) {
      // Hover translation should never interrupt page replacement.
    }
  }

  function cacheReverseHoverTranslation(key, value) {
    reverseHoverTranslationCache.set(key, value);
    if (reverseHoverTranslationCache.size <= MAX_REVERSE_HOVER_CACHE_ENTRIES) {
      return;
    }

    const oldestKey = reverseHoverTranslationCache.keys().next().value;
    reverseHoverTranslationCache.delete(oldestKey);
  }

  function getEnglishWordAtPoint(x, y) {
    const position = getCaretPositionAtPoint(x, y);
    if (!position || position.node?.nodeType !== Node.TEXT_NODE || shouldIgnoreTextNode(position.node)) {
      return "";
    }

    const text = position.node.nodeValue;
    if (!text) {
      return "";
    }

    let index = Math.min(Math.max(Number(position.offset) || 0, 0), text.length - 1);
    if (!isHoverWordCharacter(text[index]) && index > 0 && isHoverWordCharacter(text[index - 1])) {
      index -= 1;
    }
    if (!isHoverWordCharacter(text[index])) {
      return "";
    }

    let start = index;
    let end = index + 1;
    while (start > 0 && isHoverWordCharacter(text[start - 1])) {
      start -= 1;
    }
    while (end < text.length && isHoverWordCharacter(text[end])) {
      end += 1;
    }

    const word = text.slice(start, end);
    return /[A-Za-z]/.test(word) ? word : "";
  }

  function getCaretPositionAtPoint(x, y) {
    if (typeof document.caretPositionFromPoint === "function") {
      const position = document.caretPositionFromPoint(x, y);
      if (position) {
        return { node: position.offsetNode, offset: position.offset };
      }
    }

    if (typeof document.caretRangeFromPoint === "function") {
      const range = document.caretRangeFromPoint(x, y);
      if (range) {
        return { node: range.startContainer, offset: range.startOffset };
      }
    }

    return null;
  }

  function isHoverWordCharacter(char) {
    return isWordCharacter(char) || isApostrophe(char);
  }

  function ensureReverseHoverTooltip() {
    if (reverseHoverTooltip?.isConnected) {
      return reverseHoverTooltip;
    }

    reverseHoverTooltip = document.createElement("span");
    reverseHoverTooltip.className = REVERSE_HOVER_TOOLTIP_CLASS;
    reverseHoverTooltip.setAttribute("role", "tooltip");
    reverseHoverTooltip.dataset.visible = "false";
    document.documentElement.appendChild(reverseHoverTooltip);
    return reverseHoverTooltip;
  }

  function showReverseHoverTooltip(targetLanguage, translatedWord) {
    const tooltip = ensureReverseHoverTooltip();
    const languageName = getCurrentProfile()?.name || LANGUAGE_NAMES[targetLanguage] || targetLanguage;
    tooltip.textContent = `${languageName}: ${translatedWord}`;
    positionReverseHoverTooltip();
    tooltip.dataset.visible = "true";
  }

  function positionReverseHoverTooltip() {
    if (!reverseHoverTooltip?.isConnected) {
      return;
    }

    reverseHoverTooltip.style.left = `${Math.max(8, Math.min(globalThis.innerWidth - 8, reverseHoverPointer.x))}px`;
    reverseHoverTooltip.style.top = `${Math.max(28, reverseHoverPointer.y)}px`;
  }

  function clearReverseHover() {
    reverseHoverRequestId += 1;
    reverseHoverKey = "";
    if (reverseHoverTimer) {
      clearTimeout(reverseHoverTimer);
      reverseHoverTimer = null;
    }
    if (reverseHoverTooltip?.isConnected) {
      reverseHoverTooltip.dataset.visible = "false";
    }
  }

  function removeReverseHoverTooltip() {
    clearReverseHover();
    reverseHoverTooltip?.remove();
    reverseHoverTooltip = null;
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

  function mergeReplacementRanges(ranges) {
    const normalizedRanges = [...ranges]
      .map((range) => ({
        start: Math.max(0, Number(range.start) || 0),
        end: Math.max(0, Number(range.end) || 0),
        target: String(range.target || "").trim()
      }))
      .filter((range) => range.start < range.end && range.target)
      .sort((a, b) => a.start - b.start || b.end - a.end);
    const merged = [];

    for (const range of normalizedRanges) {
      if (merged.some((existing) => rangesOverlap(existing, range))) {
        continue;
      }

      merged.push(range);
    }

    return merged.sort((a, b) => a.start - b.start || b.end - a.end);
  }

  function replaceTextNodeWithParts(textNode, parts) {
    const fragment = document.createDocumentFragment();

    for (const part of parts) {
      if (part.type === "text") {
        fragment.appendChild(document.createTextNode(part.value));
        continue;
      }

      const span = document.createElement("span");
      span.className = REPLACEMENT_CLASS;
      span.dataset.learnedWordOriginal = part.original;
      span.dataset.learnedWordSource = part.source;
      span.dataset.learnedWordTarget = part.target;
      span.textContent = part.value;
      if (state.showOriginalOnHover) {
        span.title = `${part.original} -> ${part.target}`;
      }
      fragment.appendChild(span);
    }

    textNode.replaceWith(fragment);
  }

  async function processContextRoot(root, runId, options = {}) {
    const targetLanguage = getCurrentLanguageCode();
    const units = options.roots
      ? collectContextUnitsFromRoots(options.roots, options)
      : collectContextUnits(root, options);
    updateRuntimeStats({
      targetLanguage,
      unitsCollected: units.length
    });

    if (!units.length) {
      return;
    }

    const translator = await getContextTranslator(targetLanguage, options);

    if (!translator || runId !== applyRunId) {
      return;
    }

    const replacementsByNode = new Map();
    updateRuntimeStats({
      status: "translating",
      targetLanguage
    });

    const translatedTexts = await translateContextTexts(
      translator,
      targetLanguage,
      units.map((unit) => unit.text)
    );

    for (let index = 0; index < units.length; index += 1) {
      if (runId !== applyRunId) {
        return;
      }

      if (runtimeStats.translationCalls >= getMaxTranslationCallsPerPass()) {
        updateRuntimeStats({
          unitsSkipped: runtimeStats.unitsSkipped + units.length - index,
          lastError: "Translation budget reached for this pass."
        });
        break;
      }

      const unit = units[index];
      updateRuntimeStats({ unitsProcessed: runtimeStats.unitsProcessed + 1 });

      const translatedText = translatedTexts[index];
      if (!translatedText) {
        continue;
      }

      const completed = await addConfirmedRangesFromTranslation(
        unit,
        translatedText,
        replacementsByNode,
        translator,
        targetLanguage,
        runId
      );
      if (!completed) {
        return;
      }

      recordProcessedUnit(unit);

      if (index % 4 === 3) {
        await yieldToBrowser();
      }
    }

    if (runId !== applyRunId) {
      return;
    }

    for (const [node, ranges] of replacementsByNode.entries()) {
      if (!node.isConnected || shouldIgnoreTextNode(node)) {
        continue;
      }

      const parts = buildReplacementPartsForRanges(node.nodeValue, ranges);
      if (parts) {
        updateRuntimeStats({
          replacementCount:
            runtimeStats.replacementCount +
            parts.filter((part) => part.type === "replacement").length
        });
        replaceTextNodeWithParts(node, parts);
      }
    }
  }

  function recordProcessedUnit(unit) {
    if (unit?.block && unit.block.nodeType === Node.ELEMENT_NODE && unit.text) {
      processedBlockSourceTexts.set(unit.block, unit.text);
    }
  }

  async function getContextTranslator(targetLanguage, options = {}) {
    const translatorApi = getTranslatorApi();
    if (!targetLanguage || targetLanguage === SOURCE_LANGUAGE || !translatorApi) {
      updateRuntimeStats({
        status: "no-translator",
        lastError: "Chrome Translator API is not available."
      });
      return null;
    }

    const key = `${SOURCE_LANGUAGE}:${targetLanguage}`;
    if (translatorCache && translatorCacheKey === key) {
      return translatorCache;
    }

    if (translatorPreparationPromise) {
      updateRuntimeStats({
        status: "translator-preparing",
        lastError: "Chrome Translator is already preparing."
      });
      return null;
    }

    const translatorOptions = {
      sourceLanguage: SOURCE_LANGUAGE,
      targetLanguage
    };

    try {
      if (options.allowTranslatorDownload) {
        updateRuntimeStats({
          status: "translator-preparing",
          translatorAvailability: "downloadable",
          lastError: `Chrome is preparing Translator for English to ${targetLanguage}.`
        });
        translatorPreparationPromise = createAndCacheTranslator(
          translatorOptions,
          TRANSLATOR_PREPARE_TIMEOUT_MS,
          (loaded) => {
            updateRuntimeStats({
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
        return translatorCache;
      }

      updateRuntimeStats({ status: "checking-translator" });
      const availability = await withTimeout(
        translatorApi.availability(translatorOptions),
        TRANSLATOR_AVAILABILITY_TIMEOUT_MS
      );
      updateRuntimeStats({ translatorAvailability: availability });
      if (availability === "unavailable") {
        updateRuntimeStats({
          status: "translator-unavailable",
          lastError: `Chrome Translator is not available for English to ${targetLanguage}.`
        });
        return null;
      }

      if (availability !== "available") {
        updateRuntimeStats({
          status: "translator-preparing",
          lastError: `Chrome is preparing Translator for English to ${targetLanguage}.`
        });

        try {
          await createAndCacheTranslator(
            translatorOptions,
            TRANSLATOR_OPPORTUNISTIC_CREATE_TIMEOUT_MS
          );
          return translatorCache;
        } catch (error) {
          translatorCache = null;
          translatorCacheKey = "";
        }

        if (availability === "downloadable" || availability === "downloading") {
          installPageActivationPreparation(targetLanguage);
        }
        updateRuntimeStats({
          status: "translator-not-ready",
          lastError: `Chrome needs one click on this page to prepare Translator for English to ${targetLanguage}.`
        });
        return null;
      }

      await createAndCacheTranslator(translatorOptions, TRANSLATOR_CREATE_TIMEOUT_MS);
      updateRuntimeStats({ status: "translator-ready" });
      return translatorCache;
    } catch (error) {
      translatorCache = null;
      translatorCacheKey = "";
      installPageActivationPreparation(targetLanguage);
      updateRuntimeStats({
        status: "translator-error",
        lastError: error && error.message ? error.message : "Could not create Chrome Translator."
      });
      return null;
    }
  }

  async function createAndCacheTranslator(options, timeoutMs = 0, progressCallback = null) {
    const translatorApi = getTranslatorApi();
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

    translatorCache = timeoutMs ? await withTimeout(createPromise, timeoutMs) : await createPromise;
    translatorCacheKey = `${options.sourceLanguage}:${options.targetLanguage}`;
    translationCache.clear();
    updateRuntimeStats({ status: "translator-ready", lastError: "" });
    return translatorCache;
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
      getTranslationExclusion() ||
      !targetLanguage ||
      targetLanguage === SOURCE_LANGUAGE ||
      !document.body
    ) {
      return;
    }

    pageActivationListenerInstalled = true;
    const translatorApi = getTranslatorApi();

    if (typeof translatorApi?.armActivation === "function") {
      translatorApi
        .armActivation({
          sourceLanguage: SOURCE_LANGUAGE,
          targetLanguage
        })
        .catch((error) => {
          pageActivationListenerInstalled = false;
          updateRuntimeStats({
            status: "translator-error",
            lastError: error && error.message ? error.message : "Could not prepare page activation."
          });
        });
      return;
    }

    const prepareFromPageClick = () => {
      pageActivationListenerInstalled = false;
      translatorCache = null;
      translatorCacheKey = "";
      translationCache.clear();
      applyToPage({ allowTranslatorDownload: true }).catch((error) => {
        updateRuntimeStats({
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
    if (
      !message ||
      message.source !== MESSAGE_SOURCE ||
      message.channel !== TRANSLATOR_BRIDGE_ACTIVATION_CHANNEL ||
      message.sourceLanguage !== SOURCE_LANGUAGE ||
      message.targetLanguage !== getCurrentLanguageCode()
    ) {
      return;
    }

    if (getTranslationExclusion()) {
      return;
    }

    if (message.progress) {
      updateRuntimeStats({
        status: "translator-preparing",
        translatorDownloadProgress: Number(message.loaded || 0),
        lastError: `Chrome is preparing Translator for English to ${message.targetLanguage}.`
      });
      return;
    }

    if (!message.ok) {
      updateRuntimeStats({
        status: "translator-not-ready",
        lastError:
          message.error?.message ||
          `Chrome still needs page activation for English to ${message.targetLanguage}.`
      });
      return;
    }

    pageActivationListenerInstalled = false;
    translatorCache = null;
    translatorCacheKey = "";
    translationCache.clear();
    applyToPage({ preserveExisting: true }).catch((error) => {
      updateRuntimeStats({
        status: "translator-error",
        lastError: error && error.message ? error.message : "Translator activation refresh failed."
      });
    });
  }

  globalThis.addEventListener("message", handleTranslatorActivationMessage);

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

    if (readCache && translationCache.has(cacheKey)) {
      return translationCache.get(cacheKey);
    }

    if (runtimeStats.translationCalls >= getMaxTranslationCallsPerPass()) {
      return "";
    }

    try {
      updateRuntimeStats({ translationCalls: runtimeStats.translationCalls + 1 });
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

    for (let index = 0; index < texts.length; index += 1) {
      const text = String(texts[index] || "");
      if (!text.trim()) {
        continue;
      }

      const cacheKey = getTranslationCacheKey(targetLanguage, text);
      if (readCache && translationCache.has(cacheKey)) {
        translations[index] = translationCache.get(cacheKey);
        continue;
      }

      pending.push({
        index,
        text,
        tagName: `lwr${index}`
      });
    }

    for (const batch of await createTranslationTextBatches(translator, pending)) {
      if (runtimeStats.translationCalls >= getMaxTranslationCallsPerPass()) {
        updateRuntimeStats({ lastError: "Translation budget reached for this pass." });
        break;
      }

      const batchText = buildBatchedTranslationInput(batch);
      const translatedBatch = await translateContextText(translator, targetLanguage, batchText);
      const parsedBatch = parseBatchedTranslationOutput(translatedBatch, batch);

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
    const configured = Number(getRuntimeConfig().maxBatchTranslationUsage);
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
    translationCache.set(key, value);

    if (translationCache.size <= MAX_TRANSLATION_CACHE_ENTRIES) {
      return;
    }

    const oldestKey = translationCache.keys().next().value;
    translationCache.delete(oldestKey);
  }

  function collectTextNodes(root) {
    if (root.nodeType === Node.TEXT_NODE) {
      return shouldIgnoreTextNode(root) ? [] : [root];
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return shouldIgnoreTextNode(node) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];

    while (walker.nextNode()) {
      nodes.push(walker.currentNode);
    }

    return nodes;
  }

  function collectContextUnits(root, options = {}) {
    return collectContextUnitsFromRoots([root], options);
  }

  function collectContextUnitsFromRoots(roots, options = {}) {
    const groups = new Map();
    const seenBlocks = new Set();

    for (const root of roots) {
      if (!root || !root.isConnected) {
        continue;
      }

      for (const node of collectTextNodes(root)) {
        const block = getTextBlock(node);
        if (!block || seenBlocks.has(block) || !isProcessableBlock(block, options)) {
          continue;
        }

        seenBlocks.add(block);
        if (isProcessedBlockUnchanged(block)) {
          continue;
        }

        if (!groups.has(block)) {
          groups.set(block, []);
        }
        groups.get(block).push(node);
      }
    }

    let collectionOrder = 0;
    return Array.from(groups.entries())
      .flatMap(([block, nodes]) =>
        createContextUnitsForNodes(nodes, block).map((unit) => ({
          ...unit,
          collectionOrder: collectionOrder++
        }))
      )
      .sort((a, b) => {
        if (options.includeOffscreen) {
          return a.collectionOrder - b.collectionOrder;
        }

        return getContextUnitPriority(b) - getContextUnitPriority(a) || a.collectionOrder - b.collectionOrder;
      })
      .slice(0, options.maxUnits || getMaxContextUnitsPerPass())
      .sort((a, b) => a.collectionOrder - b.collectionOrder);
  }

  function hasPendingContextUnits(options = {}) {
    return collectContextUnits(document.body, { ...options, maxUnits: 1 }).length > 0;
  }

  function isProcessedBlockUnchanged(block) {
    if (!processedBlockSourceTexts.has(block)) {
      return false;
    }

    return getBlockSourceText(block) === processedBlockSourceTexts.get(block);
  }

  function getBlockSourceText(block) {
    let text = "";

    function visit(node) {
      if (node.nodeType === Node.TEXT_NODE) {
        if (!shouldIgnoreTextNode(node)) {
          text += node.nodeValue;
        }
        return;
      }

      if (node.nodeType !== Node.ELEMENT_NODE) {
        return;
      }

      if (node.classList.contains(REPLACEMENT_CLASS)) {
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

  function isProcessableBlock(block, options = {}) {
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

    if (options.includeOffscreen) {
      return true;
    }

    const viewportHeight = globalThis.innerHeight || document.documentElement.clientHeight || 0;
    const viewportWidth = globalThis.innerWidth || document.documentElement.clientWidth || 0;
    const margin = getViewportMarginPx();
    const rects = Array.from(block.getClientRects());

    if (!rects.length) {
      return true;
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

    if (!sentenceCountMatches) {
      // Punctuation can change during translation. Reusing the complete translation for
      // each source sentence can apply one translated word several times, so align once.
      return addConfirmedRangesForTextRange(
        unit,
        { start: 0, end: unit.text.length },
        translatedText,
        replacementsByNode,
        translator,
        targetLanguage,
        runId
      );
    }

    for (let index = 0; index < unit.sentenceRanges.length; index += 1) {
      if (runId !== applyRunId) {
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
        runId
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
    runId
  ) {
    const sourceText = unit.text.slice(sourceRange.start, sourceRange.end);
    const whitelistMatches = findWhitelistMatchesInText(translatedText);
    const learnedReplacements = whitelistMatches.length
      ? await getAlignedSentenceReplacements(
          translator,
          targetLanguage,
          sourceText,
          whitelistMatches,
          runId
        )
      : [];
    const replacements = mergeReplacementRanges(learnedReplacements);

    if (runId !== applyRunId) {
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
    whitelistMatches,
    runId
  ) {
    const indexedMatches = whitelistMatches.map((match, index) => ({
      ...match,
      alignmentId: index
    }));
    const confidence = getConfidenceAlignedSentenceReplacements(sourceSentence, indexedMatches);
    const unresolvedMatches = indexedMatches.filter(
      (match) =>
        !confidence.resolvedMatchIds.has(match.alignmentId) &&
        allowsDeletionFallbackAlignment(match)
    );

    if (!unresolvedMatches.length) {
      return confidence.replacements;
    }

    const deletionReplacements = await getDeletionAlignedSentenceReplacements(
      translator,
      targetLanguage,
      sourceSentence,
      unresolvedMatches,
      runId
    );

    return mergeReplacementRanges([...confidence.replacements, ...deletionReplacements]);
  }

  function allowsDeletionFallbackAlignment(match) {
    const sourceCandidates = match?.entry?.sourceCandidates;
    return !Array.isArray(sourceCandidates) || sourceCandidates.length === 0;
  }

  function getConfidenceAlignedSentenceReplacements(sourceSentence, whitelistMatches) {
    const replacements = [];
    const resolvedMatchIds = new Set();
    const usedRanges = [];
    const matchesByTarget = groupWhitelistMatchesByTarget(whitelistMatches);

    for (const matches of matchesByTarget.values()) {
      const candidates = getUniqueSourceAlignmentCandidates(
        matches.flatMap((match) => findSourceAlignmentCandidates(sourceSentence, match.entry))
      ).filter((candidate) => !usedRanges.some((range) => rangesOverlap(range, candidate)));

      if (candidates.length !== matches.length) {
        continue;
      }

      const orderedMatches = [...matches].sort(
        (a, b) => a.index - b.index || b.target.length - a.target.length
      );
      const orderedCandidates = candidates.sort((a, b) => a.start - b.start || b.end - a.end);

      for (let index = 0; index < orderedMatches.length; index += 1) {
        const match = orderedMatches[index];
        const candidate = orderedCandidates[index];
        replacements.push({
          start: candidate.start,
          end: candidate.end,
          target: match.target
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
    const needle = String(candidate.value || "").toLocaleLowerCase();
    const matches = [];

    if (!needle) {
      return matches;
    }

    let index = haystack.indexOf(needle);
    while (index >= 0) {
      if (passesTargetBoundaryCheck(sourceSentence, index, candidate.value.length)) {
        matches.push({
          start: index,
          end: index + candidate.value.length,
          score: candidate.score,
          value: sourceSentence.slice(index, index + candidate.value.length)
        });
      }

      index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
    }

    return matches;
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
      if (runId !== applyRunId) {
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

    const translatedDeletions = await translateContextTexts(
      translator,
      targetLanguage,
      deletionItems.map((item) => item.deletionText),
      {
        readCache: false,
        writeCache: false
      }
    );

    for (let index = 0; index < deletionItems.length; index += 1) {
      if (runId !== applyRunId) {
        return [];
      }

      const translatedDeletion = translatedDeletions[index];
      if (!translatedDeletion) {
        continue;
      }

      const { tokenIndex } = deletionItems[index];
      const deletionCounts = countMatchesByTargetKey(findWhitelistMatchesInText(translatedDeletion));
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
        if (runId !== applyRunId) {
          return;
        }

        const deletionText = deletionTextByTokenIndex.get(candidate.tokenIndex);
        if (!deletionText) {
          continue;
        }

        const translatedDeletion = await translateContextText(
          translator,
          targetLanguage,
          deletionText,
          {
            readCache: false,
            writeCache: false
          }
        );
        const deletionCounts = countMatchesByTargetKey(
          findWhitelistMatchesInText(translatedDeletion)
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
      if (!isWordCharacter(text[index])) {
        index += 1;
        continue;
      }

      const start = index;
      index += 1;

      while (index < text.length) {
        const char = text[index];
        if (isWordCharacter(char)) {
          index += 1;
          continue;
        }

        if (
          isApostrophe(char) &&
          isWordCharacter(text[index - 1]) &&
          isWordCharacter(text[index + 1])
        ) {
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
          target: matches[index].target
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

  function findWhitelistMatchesInText(translatedText) {
    const seen = new Set();

    return compiledEntries
      .flatMap((entry) =>
        findTargetCandidateMatches(translatedText, entry).map((match) => ({
          ...match,
          entry
        }))
      )
      .sort((a, b) => a.index - b.index || b.target.length - a.target.length)
      .filter((match) => {
        const key = `${match.index}:${match.target.toLocaleLowerCase()}`;
        if (seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });
  }

  function findTargetCandidateMatches(translatedText, entry) {
    return entry.targetCandidates
      .flatMap((candidate) => findTargetCandidateMatchesInText(translatedText, candidate))
      .sort((a, b) => a.index - b.index || b.target.length - a.target.length);
  }

  function findTargetCandidateMatchesInText(translatedText, candidate) {
    const haystack = translatedText.toLocaleLowerCase();
    const needle = String(candidate || "").toLocaleLowerCase();
    const matches = [];
    let index = haystack.indexOf(needle);

    while (index >= 0) {
      if (passesTargetBoundaryCheck(translatedText, index, candidate.length)) {
        matches.push({
          index,
          target: translatedText.slice(index, index + candidate.length)
        });
      }

      index = haystack.indexOf(needle, index + Math.max(needle.length, 1));
    }

    return matches;
  }

  function passesTargetBoundaryCheck(text, start, length) {
    const first = text[start];
    const last = text[start + length - 1];

    if (!isWordCharacter(first) && !isWordCharacter(last)) {
      return true;
    }

    if (isWordCharacter(first) && isWordCharacter(text[start - 1])) {
      return false;
    }

    if (isWordCharacter(last) && isWordCharacter(text[start + length])) {
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

  function restoreOriginalText(root = document) {
    const replacements =
      root.nodeType === Node.ELEMENT_NODE && root.classList.contains(REPLACEMENT_CLASS)
        ? [root]
        : Array.from(root.querySelectorAll(`.${REPLACEMENT_CLASS}`));
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

  function restoreChangedProcessedBlocksForRoots(roots) {
    for (const root of roots || []) {
      if (root && root.isConnected) {
        restoreChangedProcessedBlocks(root);
      }
    }
  }

  function restoreChangedProcessedBlocks(root = document) {
    const replacements =
      root.nodeType === Node.ELEMENT_NODE && root.classList.contains(REPLACEMENT_CLASS)
        ? [root]
        : Array.from(root.querySelectorAll(`.${REPLACEMENT_CLASS}`));
    const blocks = new Set();

    for (const replacement of replacements) {
      const block = getElementTextBlock(replacement);
      if (block) {
        blocks.add(block);
      }
    }

    for (const block of blocks) {
      const previousSourceText = processedBlockSourceTexts.get(block);
      if (!previousSourceText) {
        continue;
      }

      if (getBlockSourceText(block) !== previousSourceText) {
        processedBlockSourceTexts.delete(block);
        restoreOriginalText(block);
      }
    }
  }

  function countExistingReplacements(root = document) {
    if (root.nodeType === Node.ELEMENT_NODE && root.classList.contains(REPLACEMENT_CLASS)) {
      return 1;
    }

    return root.querySelectorAll ? root.querySelectorAll(`.${REPLACEMENT_CLASS}`).length : 0;
  }

  function hasExistingReplacements(root) {
    return countExistingReplacements(root) > 0;
  }

  function startObserver() {
    stopObserver();

    if (!hasActivePageReplacementFeatures() || !document.body || getTranslationExclusion()) {
      return;
    }

    ensureScrollListener();

    observer = new MutationObserver((mutations) => {
      if (applying) {
        return;
      }

      queueContextBlocks(getMutationContextBlocks(mutations), { restoreChangedExisting: true });
      if (pendingContextBlocks.size) {
        scheduleApply();
      }
    });

    observer.observe(document.body, {
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

    if (node.matches(IGNORED_SELECTOR) || !node.textContent.trim()) {
      return [];
    }

    const blocks = new Set();
    for (const textNode of collectTextNodes(node)) {
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
    if (!node || node.nodeType !== Node.TEXT_NODE || shouldIgnoreTextNode(node)) {
      return null;
    }

    const block = getTextBlock(node);
    return block && isProcessableBlock(block) ? block : null;
  }

  function ensureScrollListener() {
    if (scrollListenerInstalled) {
      return;
    }

    scrollListenerInstalled = true;
    globalThis.addEventListener(
      "scroll",
      () => {
        if (hasActivePageReplacementFeatures() && !getTranslationExclusion()) {
          scheduleApplyIfPendingContext();
        }
      },
      { passive: true }
    );
  }

  function stopObserver(options = {}) {
    if (observer) {
      observer.disconnect();
      observer = null;
    }

    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }

    if (options.cancelFullPageScan && fullPageScanTimer) {
      clearTimeout(fullPageScanTimer);
      fullPageScanTimer = null;
    }
  }

  function scheduleFullPageScan() {
    if (
      fullPageScanTimer ||
      !shouldScanWholePage() ||
      !document.body ||
      !hasActivePageReplacementFeatures() ||
      getTranslationExclusion() ||
      !hasPendingContextUnits({ includeOffscreen: true })
    ) {
      return false;
    }

    fullPageScanTimer = setTimeout(() => {
      fullPageScanTimer = null;
      applyToPage({ preserveExisting: true, includeOffscreen: true, backgroundScan: true }).catch(
        (error) => {
          updateRuntimeStats({
            status: "translator-error",
            lastError: error && error.message ? error.message : "Background page scan failed."
          });
        }
      );
    }, getFullPageScanDelayMs());
    return true;
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
        .filter((block) => block.isConnected && isProcessableBlock(block));
      if (!roots.length) {
        return;
      }
      const restoreRoots = entries
        .filter(([block, restoreChangedExisting]) => restoreChangedExisting && block.isConnected)
        .map(([block]) => block)
        .filter((block) => isProcessableBlock(block));

      applyToPage({ preserveExisting: true, roots, restoreRoots });
    }, getApplyDebounceMs());
  }

  function scheduleApplyIfPendingContext() {
    if (
      !document.body ||
      applying ||
      !hasActivePageReplacementFeatures() ||
      getTranslationExclusion()
    ) {
      return;
    }

    const roots = Array.from(new Set(collectContextUnits(document.body).map((unit) => unit.block))).filter(
      (block) => !hasExistingReplacements(block)
    );
    if (!roots.length) {
      return;
    }

    queueContextBlocks(roots, { restoreChangedExisting: false });
    scheduleApply();
  }

  async function applyToPage(options = {}) {
    if (!document.body) {
      return;
    }

    const runId = ++applyRunId;
    applying = true;
    stopObserver({ cancelFullPageScan: true });

    try {
      const exclusion = getTranslationExclusion();
      if (exclusion) {
        pendingContextBlocks.clear();
        processedBlockSourceTexts = new WeakMap();
        restoreOriginalText(document);
        removeStyle();
        runtimeStats = createRuntimeStats({
          runId,
          status: "excluded",
          startedAt: Date.now(),
          targetLanguage: getCurrentLanguageCode(),
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
        processedBlockSourceTexts = new WeakMap();
        restoreOriginalText(document);
      }

      runtimeStats = createRuntimeStats({
        runId,
        status: "starting",
        startedAt: Date.now(),
        targetLanguage: getCurrentLanguageCode(),
        replacementCount: options.preserveExisting ? countExistingReplacements(document) : 0
      });
      compileEntries();

      if (!hasActivePageReplacementFeatures()) {
        removeStyle();
        updateRuntimeStats({
          status: state.enabled ? "no-active-entries" : "disabled"
        });
        return;
      }

      installStyle();
      installReverseHoverTranslation();
      await processContextRoot(document.body, runId, options);
    } finally {
      if (runId === applyRunId) {
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
        const completedStatus = blockedStatuses.has(runtimeStats.status)
          ? runtimeStats.status
          : "complete";
        const scanScheduled =
          completedStatus === "complete" &&
          shouldScanWholePage() &&
          hasPendingContextUnits({ includeOffscreen: true }) &&
          scheduleFullPageScan();
        updateRuntimeStats({
          status: scanScheduled ? "scanning-page" : completedStatus,
          finishedAt: scanScheduled ? 0 : Date.now()
        });
        applying = false;
        startObserver();
      }
    }
  }

  function isDuolingoWordsPage() {
    return (
      /(^|\.)duolingo\.com$/i.test(globalThis.location.hostname) &&
      globalThis.location.pathname === "/practice-hub/words"
    );
  }

  function normalizeDuolingoText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function readOriginalNodeText(node) {
    if (!node) {
      return "";
    }

    const clone = node.cloneNode(true);
    for (const token of clone.querySelectorAll(`.${REPLACEMENT_CLASS}`)) {
      token.replaceWith(
        document.createTextNode(token.dataset.learnedWordOriginal || token.textContent || "")
      );
    }
    return normalizeDuolingoText(clone.textContent);
  }

  function readDuolingoWordRow(item) {
    const heading = item.querySelector("h2,h3,h4");
    const meaning =
      Array.from(heading?.parentElement?.children || []).find(
        (child) => child.tagName === "P"
      ) || item.querySelector("p");
    const word = readOriginalNodeText(heading);
    const meanings = readOriginalNodeText(meaning);

    return word && meanings ? { word, meanings } : null;
  }

  function getDuolingoWordCollection() {
    const collections = Array.from(document.querySelectorAll("ul")).map((list) => ({
      list,
      records: Array.from(list.children).map(readDuolingoWordRow).filter(Boolean)
    }));

    collections.sort((a, b) => b.records.length - a.records.length);
    return collections[0] || { list: null, records: [] };
  }

  function getDuolingoLoadMoreControl(list) {
    return Array.from(list?.children || []).find(
      (item) =>
        (item.matches("button") || item.getAttribute("role") === "button") &&
        normalizeDuolingoText(item.textContent).toLocaleLowerCase() === "load more"
    );
  }

  function getDuolingoExpectedWordCount() {
    for (const heading of document.querySelectorAll("h1,h2,h3")) {
      const match = normalizeDuolingoText(heading.textContent).match(/^(\d[\d,]*)\s+words?$/i);
      if (match) {
        return Number(match[1].replaceAll(",", ""));
      }
    }
    return 0;
  }

  function getDuolingoLanguageName() {
    for (const heading of document.querySelectorAll("h1,h2,h3")) {
      const match = normalizeDuolingoText(heading.textContent).match(
        /^Practice your (.+?) words$/i
      );
      if (match) {
        return match[1].trim();
      }
    }
    return "";
  }

  function waitForDuolingoWordCountIncrease(previousCount, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const observer = new MutationObserver(checkCount);
      const timer = setTimeout(() => finish(false), timeoutMs);

      function finish(success) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        observer.disconnect();
        if (success) {
          resolve();
        } else {
          reject(new Error("Duolingo did not load the next group of words."));
        }
      }

      function checkCount() {
        if (getDuolingoWordCollection().records.length > previousCount) {
          finish(true);
        }
      }

      observer.observe(document.body, { childList: true, subtree: true });
      checkCount();
    });
  }

  async function scrapeAllDuolingoWords() {
    if (!isDuolingoWordsPage()) {
      throw new Error("Open Duolingo's Words page before syncing.");
    }

    for (let loadAttempt = 0; loadAttempt < 20; loadAttempt += 1) {
      const collection = getDuolingoWordCollection();
      const loadMore = getDuolingoLoadMoreControl(collection.list);
      if (!loadMore) {
        break;
      }

      const previousCount = collection.records.length;
      loadMore.click();
      await waitForDuolingoWordCountIncrease(previousCount);
    }

    const collection = getDuolingoWordCollection();
    const expectedCount = getDuolingoExpectedWordCount();
    const seen = new Set();
    const records = collection.records.filter((record) => {
      const key = `${record.word}\n${record.meanings}`.toLocaleLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    if (!records.length) {
      throw new Error("No learned words were found on this Duolingo page.");
    }

    if (expectedCount && records.length < expectedCount) {
      throw new Error(`Duolingo showed ${expectedCount} words, but only ${records.length} loaded.`);
    }

    return {
      count: records.length,
      expectedCount,
      languageName: getDuolingoLanguageName(),
      text: records.map((record) => `${record.word} - ${record.meanings}`).join("\n")
    };
  }

  function loadState() {
    chrome.storage.local.get({ [STORAGE_KEY]: DEFAULT_STATE }, (stored) => {
      state = normalizeState(stored[STORAGE_KEY]);
      applyToPage();
    });
  }

  globalThis[REFRESH_KEY] = loadState;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) {
      return;
    }

    state = normalizeState(changes[STORAGE_KEY].newValue);
    applyToPage();
  });

  if (chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (!message || typeof message !== "object") {
        return false;
      }

      if (message.type === "LWR_GET_STATUS") {
        sendResponse({ ok: true, status: getPublicStatus() });
        return false;
      }

      if (message.type === "LWR_RETRY") {
        translatorCache = null;
        translatorCacheKey = "";
        translationCache.clear();
        const translatorApi = getTranslatorApi();
        applyToPage({
          allowTranslatorDownload: typeof translatorApi?.armActivation !== "function",
          preserveExisting: true
        }).catch((error) => {
          updateRuntimeStats({
            status: "translator-error",
            lastError: error && error.message ? error.message : "Retry failed."
          });
        });
        sendResponse({ ok: true, status: getPublicStatus() });
        return false;
      }

      if (message.type === "LWR_SYNC_DUOLINGO") {
        scrapeAllDuolingoWords().then(
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
})();
