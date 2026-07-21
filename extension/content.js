(() => {
  const REFRESH_KEY = "__learnedWordReplacerRefresh";
  const STORAGE_KEY = "learnedWordReplacerState";
  const REPLACEMENT_CLASS = "learned-word-replacer-token";
  const PROCESSED_BLOCK_CLASS = "learned-word-replacer-checked";
  const REVERSE_HOVER_TOOLTIP_CLASS = "learned-word-replacer-hover-tooltip";
  const WORD_FAMILY_MATCH_KIND = "word-family";
  const BACK_TRANSLATION_MATCH_KIND = "back-translation";
  const UNLEARNED_MATCH_KIND = "unlearned";
  const STRUCTURED_BLOCK_CLASS = "learned-word-replacer-structured";
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
  const STYLE_ID = "learned-word-replacer-style";
  const SOURCE_LANGUAGE = "en";
  const MAX_TRANSLATION_CACHE_ENTRIES = 400;
  const WORD_ALIGNMENT_TIMEOUT_MS = 30000;
  const MAX_WORD_ALIGNMENT_CACHE_ENTRIES = 200;
  const MAX_CONTEXT_UNITS_PER_PASS = 35;
  const MAX_TRANSLATION_CALLS_PER_PASS = 70;
  const TRANSLATOR_AVAILABILITY_TIMEOUT_MS = 10000;
  const TRANSLATOR_CREATE_TIMEOUT_MS = 15000;
  const TRANSLATOR_OPPORTUNISTIC_CREATE_TIMEOUT_MS = 3000;
  const TRANSLATOR_PREPARE_TIMEOUT_MS = 120000;
  const TRANSLATOR_TRANSLATE_TIMEOUT_MS = 20000;
  const APPLY_DEBOUNCE_MS = 700;
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
    structureMode: false,
    showProcessedSections: true,
    showOriginalOnHover: true,
    translateEnglishOnHover: true,
    duolingoAutoContinue: false,
    duolingoTypeAnswers: false,
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
  let applying = false;
  let applyRunId = 0;
  let translatorCacheKey = "";
  let translatorCache = null;
  let scrollListenerInstalled = false;
  let pageActivationListenerInstalled = false;
  const translationCache = new Map();
  const ukrainianLemmaCache = new Map();
  const wordAlignmentCache = new Map();
  let processedBlockSourceTexts = new WeakMap();
  let structuredBlockOriginals = new WeakMap();
  let pendingContextBlocks = new Map();
  let runtimeStats = createRuntimeStats();
  let statusPublishTimer = null;
  let translatorPreparationPromise = null;
  let translatorRequestPromise = null;
  let translatorRequestKey = "";
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

  function getMaxContextUnitsPerPass() {
    return getConfigNumber("maxContextUnitsPerPass", MAX_CONTEXT_UNITS_PER_PASS);
  }

  function getMaxTranslationCallsPerPass() {
    return getConfigNumber("maxTranslationCallsPerPass", MAX_TRANSLATION_CALLS_PER_PASS);
  }

  function getApplyDebounceMs() {
    return getConfigNumber("applyDebounceMs", APPLY_DEBOUNCE_MS);
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
      wordFamilyReplacementCount: 0,
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
    const wordFamilyReplacementCount = document.body
      ? countExistingWordFamilyReplacements(document)
      : runtimeStats.wordFamilyReplacementCount;

    return {
      ...runtimeStats,
      replacementCount,
      wordFamilyReplacementCount,
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
            // Dedupe joined alternates: corrupted import files have stored
            // targets like "мільйони / мільйонів" repeated five times over.
            target: dedupeJoinedText(entry.target, " / "),
            learned: true,
            enabled: entry.enabled !== false,
            origin:
              entry.origin === "duolingo" || String(entry.definition || "").startsWith("Duolingo meanings:")
                ? "duolingo"
                : "manual",
            definition: dedupeJoinedText(entry.definition, "; "),
            createdAt: Number(entry.createdAt || Date.now())
          }))
          .filter((entry) => entry.source && entry.target)
      : [];
  }

  function dedupeJoinedText(text, separator) {
    const seen = new Set();
    const unique = [];

    for (const part of String(text || "").split(separator)) {
      const value = part.trim();
      const key = value.toLocaleLowerCase();
      if (value && !seen.has(key)) {
        seen.add(key);
        unique.push(value);
      }
    }

    return unique.join(separator);
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

      .${REVERSE_HOVER_TOOLTIP_CLASS}[data-placement="below"] {
        transform: translate(-50%, 12px);
      }
    `;

    // The original-word tooltip is the fixed-position element attached to the
    // document root: page stacking contexts (e.g. Wikipedia's page container)
    // and overflow-clipping ancestors would trap or cut off a CSS ::after.
    const originalHoverStyle = "";
    const processedBlockStyle = state.showProcessedSections
      ? `
      .${PROCESSED_BLOCK_CLASS} {
        box-shadow: inset 3px 0 0 rgba(37, 99, 235, 0.62) !important;
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

        .${REPLACEMENT_CLASS}[data-learned-word-match-kind="${BACK_TRANSLATION_MATCH_KIND}"] {
          background: none;
          padding: 0;
        }

        .${REPLACEMENT_CLASS}[data-learned-word-match-kind="${UNLEARNED_MATCH_KIND}"] {
          background: color-mix(in srgb, #93c5fd 35%, transparent);
        }

      ` + processedBlockStyle + originalHoverStyle + reverseHoverTooltipStyle
        : `
        .${REPLACEMENT_CLASS} {
          cursor: inherit;
          position: relative;
        }
      ` + processedBlockStyle + originalHoverStyle + reverseHoverTooltipStyle);
  }

  function removeStyle() {
    removeReverseHoverTooltip();
    clearProcessedBlockMarkers();
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
    const replacementSpan =
      state.enabled && target && typeof target.closest === "function"
        ? target.closest(`.${REPLACEMENT_CLASS}`)
        : null;

    if (replacementSpan) {
      if (state.showOriginalOnHover && replacementSpan.dataset.learnedWordOriginal) {
        showReplacementOriginalTooltip(replacementSpan);
      } else {
        clearReverseHover();
      }
      return;
    }

    if (
      !state.enabled ||
      !state.translateEnglishOnHover ||
      !compiledEntries.length ||
      !getCurrentLanguageCode() ||
      getTranslationExclusion()
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

    reverseHoverTooltip.dataset.placement = "above";
    reverseHoverTooltip.style.left = `${Math.max(8, Math.min(globalThis.innerWidth - 8, reverseHoverPointer.x))}px`;
    reverseHoverTooltip.style.top = `${Math.max(28, reverseHoverPointer.y)}px`;
  }

  function showReplacementOriginalTooltip(span) {
    const original = span.dataset.learnedWordOriginal;
    const key = `original\u0000${original}\u0000${span.dataset.learnedWordTarget || ""}`;

    if (key === reverseHoverKey) {
      positionTooltipOverSpan(span);
      return;
    }

    clearReverseHover();
    reverseHoverKey = key;
    const tooltip = ensureReverseHoverTooltip();
    tooltip.textContent = original;
    positionTooltipOverSpan(span);
    tooltip.dataset.visible = "true";
  }

  function positionTooltipOverSpan(span) {
    const tooltip = ensureReverseHoverTooltip();
    if (!span.isConnected) {
      return;
    }

    const rect = span.getBoundingClientRect();
    const centerX = Math.max(8, Math.min(globalThis.innerWidth - 8, rect.left + rect.width / 2));
    const fitsAbove = rect.top - tooltip.offsetHeight - 16 >= 4;
    tooltip.dataset.placement = fitsAbove ? "above" : "below";
    tooltip.style.left = `${centerX}px`;
    tooltip.style.top = `${fitsAbove ? rect.top : rect.bottom}px`;
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

  function mergeReplacementRanges(ranges) {
    const normalizedRanges = [...ranges]
      .map((range) => ({
        start: Math.max(0, Number(range.start) || 0),
        end: Math.max(0, Number(range.end) || 0),
        target: String(range.target || "").trim(),
        kind: range.kind === WORD_FAMILY_MATCH_KIND ? WORD_FAMILY_MATCH_KIND : "exact"
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

  function createReplacementFragment(parts) {
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
      span.dataset.learnedWordMatchKind = part.kind || "exact";
      span.textContent = part.value;
      fragment.appendChild(span);
    }

    return fragment;
  }

  function replaceTextNodeWithParts(textNode, parts) {
    textNode.replaceWith(createReplacementFragment(parts));
  }

  async function processContextRoot(root, runId, options = {}) {
    const targetLanguage = getCurrentLanguageCode();
    const units = options.roots
      ? collectContextUnitsFromRoots(options.roots)
      : collectContextUnits(root);
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

    // Each block is its own unit, so a finished unit's text nodes are never
    // touched again by later units and its replacements can be painted right
    // away instead of holding the whole pass invisible until the last block.
    let nextUnitIndex = 0;
    let halted = false;

    const processTranslatedUnits = async (translatedTexts, limit) => {
      while (nextUnitIndex < limit && !halted) {
        const index = nextUnitIndex;
        nextUnitIndex += 1;

        if (runId !== applyRunId) {
          halted = true;
          return;
        }

        if (runtimeStats.translationCalls >= getMaxTranslationCallsPerPass()) {
          updateRuntimeStats({
            unitsSkipped: runtimeStats.unitsSkipped + units.length - index,
            lastError: "Translation budget reached for this pass."
          });
          halted = true;
          return;
        }

        const unit = units[index];
        updateRuntimeStats({ unitsProcessed: runtimeStats.unitsProcessed + 1 });

        const translatedText = translatedTexts[index];
        if (!translatedText) {
          continue;
        }

        if (state.structureMode && isSafeToRestructureBlock(unit.block, unit.text)) {
          const structured = await applyStructuredUnit(unit, translatedText, targetLanguage, runId);
          if (structured === STRUCTURED_UNIT_HALTED) {
            halted = true;
            return;
          }

          if (structured === STRUCTURED_UNIT_APPLIED) {
            recordProcessedUnit(unit);
            if (index % 4 === 3) {
              await yieldToBrowser();
            }
            continue;
          }

          // STRUCTURED_UNIT_REJECTED: the translation failed the fidelity
          // checks, so this block gets plain per-word replacement instead.
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
          halted = true;
          return;
        }

        recordProcessedUnit(unit);
        applyNodeReplacements(replacementsByNode);

        if (index % 4 === 3) {
          await yieldToBrowser();
        }
      }
    };

    const translatedTexts = await translateContextTexts(
      translator,
      targetLanguage,
      units.map((unit) => unit.text),
      { onBatchTranslated: processTranslatedUnits }
    );

    // Units whose translations all came from cache never trigger a batch
    // callback, so finish whatever is left.
    await processTranslatedUnits(translatedTexts, units.length);
  }

  function applyNodeReplacements(replacementsByNode) {
    for (const [node, ranges] of replacementsByNode.entries()) {
      if (!node.isConnected || shouldIgnoreTextNode(node)) {
        continue;
      }

      const parts = buildReplacementPartsForRanges(node.nodeValue, ranges);
      if (parts) {
        const replacementParts = parts.filter((part) => part.type === "replacement");
        updateRuntimeStats({
          replacementCount: runtimeStats.replacementCount + replacementParts.length,
          wordFamilyReplacementCount:
            runtimeStats.wordFamilyReplacementCount +
            replacementParts.filter((part) => part.kind === WORD_FAMILY_MATCH_KIND).length
        });
        replaceTextNodeWithParts(node, parts);
      }
    }

    replacementsByNode.clear();
  }

  function recordProcessedUnit(unit) {
    if (unit?.block && unit.block.nodeType === Node.ELEMENT_NODE && unit.text) {
      processedBlockSourceTexts.set(unit.block, unit.text);
      unit.block.classList.add(PROCESSED_BLOCK_CLASS);
    }
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

    for (const element of block.querySelectorAll("*")) {
      if (
        !STRUCTURE_SAFE_INLINE_TAGS.has(element.tagName) &&
        !element.classList.contains(REPLACEMENT_CLASS)
      ) {
        return false;
      }
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
  async function applyStructuredUnit(unit, translatedText, targetLanguage, runId) {
    const block = unit.block;
    if (!block || block.nodeType !== Node.ELEMENT_NODE || !block.isConnected) {
      return STRUCTURED_UNIT_APPLIED;
    }

    const translatedSentences = splitTranslatedSentences(translatedText);
    const sentencePairs =
      translatedSentences.length === unit.sentenceRanges.length
        ? unit.sentenceRanges.map((range, index) => ({
            source: unit.text.slice(range.start, range.end),
            translated: translatedSentences[index]
          }))
        : [{ source: unit.text, translated: translatedText }];

    const parts = [];
    for (const pair of sentencePairs) {
      if (parts.length) {
        parts.push({ type: "text", value: " " });
      }

      const matches = await findWhitelistMatchesInText(pair.translated, targetLanguage, pair.source);
      const alignmentPairs = await requestWordAlignment(pair.source, pair.translated);
      if (runId !== applyRunId) {
        return STRUCTURED_UNIT_HALTED;
      }

      if (!alignmentPairs.length) {
        // Without alignment the rebuilt sentence would be unreadable, so keep
        // the original English for this sentence.
        parts.push({ type: "text", value: pair.source });
        continue;
      }

      const sentenceParts = buildStructuredSentenceParts(
        pair.source,
        pair.translated,
        matches,
        alignmentPairs
      );
      const faithful = await structuredSentencePartsAreFaithful(
        pair.source,
        sentenceParts,
        targetLanguage
      );
      if (runId !== applyRunId) {
        return STRUCTURED_UNIT_HALTED;
      }

      if (!faithful) {
        debugLog("structure-reject", {
          source: pair.source.slice(0, 90),
          translated: pair.translated.slice(0, 90)
        });
        return STRUCTURED_UNIT_REJECTED;
      }

      parts.push(...sentenceParts);
    }

    const replacementParts = parts.filter((part) => part.type === "replacement");
    if (!replacementParts.length) {
      return STRUCTURED_UNIT_APPLIED;
    }

    captureStructuredBlockOriginal(block, unit.text);
    block.replaceChildren(createReplacementFragment(parts));
    block.classList.add(STRUCTURED_BLOCK_CLASS);
    updateRuntimeStats({
      replacementCount:
        runtimeStats.replacementCount +
        replacementParts.filter(
          (part) => part.kind !== BACK_TRANSLATION_MATCH_KIND && part.kind !== UNLEARNED_MATCH_KIND
        ).length,
      wordFamilyReplacementCount:
        runtimeStats.wordFamilyReplacementCount +
        replacementParts.filter((part) => part.kind === WORD_FAMILY_MATCH_KIND).length
    });
    return STRUCTURED_UNIT_APPLIED;
  }

  // Structure mode trusts the machine translation as the sentence frame, but
  // the small on-device model sometimes mangles dense proper-noun runs --
  // dropping, duplicating, or inventing words ("Peru-Bolivian Confederation"
  // once came back containing the non-word "Боліва"). Only use the rebuilt
  // sentence when it keeps every distinctive source token and every
  // target-language word it shows is a real dictionary word.
  async function structuredSentencePartsAreFaithful(sourceSentence, parts, targetLanguage) {
    const visibleText = parts.map((part) => part.value).join(" ");
    const retainedText = `${visibleText} ${parts
      .filter((part) => part.type === "replacement")
      .map((part) => part.original || "")
      .join(" ")}`.toLocaleLowerCase();

    for (const token of getDistinctiveSourceTokens(sourceSentence)) {
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
    const scaffoldWords = [];
    for (const part of parts) {
      if (part.type === "text" || part.kind === UNLEARNED_MATCH_KIND) {
        scaffoldWords.push(...getCyrillicValidationWords(part.value));
      }
    }

    if (!scaffoldWords.length) {
      return true;
    }

    const lemmasByWord = await getUkrainianLemmas(scaffoldWords);
    return scaffoldWords.every(
      (word) => (lemmasByWord.get(normalizeUkrainianMorphologyWord(word)) || []).length > 0
    );
  }

  // Capitalized words (except the sentence opener) and numbers are the tokens
  // a translation must not lose; lowercase filler may legitimately disappear
  // into the target language's grammar.
  function getDistinctiveSourceTokens(sourceSentence) {
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

        if (/\p{N}/u.test(piece)) {
          tokens.push(piece);
        } else if (!wasFirstWord && /^\p{Lu}/u.test(piece)) {
          tokens.push(piece);
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

  function buildStructuredSentenceParts(sourceSentence, translatedSentence, whitelistMatches, alignmentPairs) {
    const knownRanges = getMergedKnownRanges(whitelistMatches);
    const tokens = getReplaceableSourceTokens(translatedSentence);
    const strongPairs = alignmentPairs.filter((pair) => !pair.weak);
    const weakPairs = alignmentPairs.filter((pair) => pair.weak);
    const usedEnglishKeys = new Set();

    // Assign confident English first, in sentence order.
    const plan = tokens.map((token) => {
      const known = knownRanges.find(
        (range) => range.start <= token.start && token.start < range.end
      );
      if (known) {
        return { token, known };
      }

      return {
        token,
        english: collectAlignedEnglish(
          strongPairs,
          sourceSentence,
          token.start,
          token.end,
          usedEnglishKeys
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
          !isReplaceableNeuralSourceSpan(value) ||
          value.length < 3 ||
          ALIGNMENT_COMMON_WORDS.has(value.toLocaleLowerCase())
        ) {
          continue;
        }

        item.guess = value;
        break;
      }
    }

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
        const english =
          collectAlignedEnglish(strongPairs, sourceSentence, known.start, known.end, null) ||
          String(known.source || "");
        parts.push({
          type: "replacement",
          value,
          original: english,
          source: english,
          target: value,
          kind: known.kind
        });
        cursor = known.end;
        continue;
      }

      if (item.english) {
        const value = adaptTargetCaseToSource(item.english, token.value);
        parts.push({
          type: "replacement",
          value,
          original: token.value,
          source: token.value,
          target: value,
          kind: BACK_TRANSLATION_MATCH_KIND
        });
      } else if (item.guess) {
        parts.push({
          type: "replacement",
          value: token.value,
          original: item.guess,
          source: item.guess,
          target: token.value,
          kind: UNLEARNED_MATCH_KIND
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
      if (!merged.some((existing) => rangesOverlap(existing, range))) {
        merged.push(range);
      }
    }

    return merged;
  }

  function collectAlignedEnglish(alignmentPairs, sourceSentence, tgtStart, tgtEnd, usedKeys) {
    const words = [];
    const seen = new Set();
    const linked = alignmentPairs
      .filter((pair) => pair.tgtStart < tgtEnd && tgtStart < pair.tgtEnd)
      .sort((a, b) => a.srcStart - b.srcStart);

    for (const pair of linked) {
      const key = `${pair.srcStart}:${pair.srcEnd}`;
      if (seen.has(key) || (usedKeys && usedKeys.has(key))) {
        continue;
      }

      const value = sourceSentence.slice(pair.srcStart, pair.srcEnd);
      if (!isReplaceableNeuralSourceSpan(value)) {
        continue;
      }

      seen.add(key);
      if (usedKeys) {
        usedKeys.add(key);
      }
      words.push(value);
    }

    return words.join(" ");
  }

  function captureStructuredBlockOriginal(block, sourceText) {
    if (structuredBlockOriginals.has(block)) {
      return;
    }

    const fragment = document.createDocumentFragment();
    while (block.firstChild) {
      fragment.appendChild(block.firstChild);
    }
    structuredBlockOriginals.set(block, { fragment, sourceText });
    block.dataset.lwrOriginalText = sourceText;
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
    const onBatchTranslated =
      typeof options.onBatchTranslated === "function" ? options.onBatchTranslated : null;

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
      debugLog("batch", {
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

  function collectContextUnits(root) {
    return collectContextUnitsFromRoots([root]);
  }

  function collectContextUnitsFromRoots(roots) {
    const groups = new Map();
    const seenBlocks = new Set();

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
    return Array.from(groups.entries())
      .flatMap(([block, nodes]) =>
        createContextUnitsForNodes(nodes, block).map((unit) => ({
          ...unit,
          collectionOrder: collectionOrder++
        }))
      )
      .sort(
        (a, b) =>
          getContextUnitPriority(b) - getContextUnitPriority(a) ||
          a.collectionOrder - b.collectionOrder
      )
      .slice(0, getMaxContextUnitsPerPass())
      .sort((a, b) => a.collectionOrder - b.collectionOrder);
  }

  function isProcessedBlockUnchanged(block) {
    if (!processedBlockSourceTexts.has(block)) {
      return false;
    }

    return getBlockSourceText(block) === processedBlockSourceTexts.get(block);
  }

  function getBlockSourceText(block) {
    const structured = structuredBlockOriginals.get(block);
    if (structured) {
      return structured.sourceText;
    }

    if (block.nodeType === Node.ELEMENT_NODE && block.dataset.lwrOriginalText) {
      return block.dataset.lwrOriginalText;
    }

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
    debugLog("unit", {
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
    translatedText,
    whitelistMatches,
    runId,
    alignmentOptions = {}
  ) {
    const indexedMatches = whitelistMatches.map((match, index) => ({
      ...match,
      alignmentId: index
    }));
    const confidence = getConfidenceAlignedSentenceReplacements(
      sourceSentence,
      indexedMatches,
      alignmentOptions
    );
    let replacements = confidence.replacements;
    let unresolvedMatches = indexedMatches.filter(
      (match) => !confidence.resolvedMatchIds.has(match.alignmentId)
    );

    if (unresolvedMatches.length) {
      const neural = await getNeuralAlignedSentenceReplacements(
        sourceSentence,
        translatedText,
        unresolvedMatches,
        replacements
      );

      if (runId !== applyRunId) {
        return [];
      }

      if (neural.replacements.length) {
        replacements = mergeReplacementRanges([...replacements, ...neural.replacements]);
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

    return mergeReplacementRanges([...replacements, ...deletionReplacements]);
  }

  async function getNeuralAlignedSentenceReplacements(
    sourceSentence,
    translatedText,
    whitelistMatches,
    existingReplacements
  ) {
    const resolvedMatchIds = new Set();
    const replacements = [];
    const pairs = (await requestWordAlignment(sourceSentence, translatedText)).filter(
      (pair) => !pair.weak
    );
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
        !ALIGNMENT_PREFIX_STOPWORDS.has(getSourceCandidateTerm(candidates[0])) &&
        candidates.every(
          (candidate) =>
            getSourceCandidateTerm(candidate) === getSourceCandidateTerm(candidates[0])
        );

      if (!sameWordFanOut && candidates.length !== matches.length) {
        debugLog("align-drop", {
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
        if (passesTargetBoundaryCheck(sourceSentence, index, variant.length)) {
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
    const exactMatches = compiledEntries.flatMap((entry) =>
      findTargetCandidateMatches(translatedText, entry).map((match) => ({
        ...match,
        entry
      }))
    );
    const wordFamilyMatches =
      targetLanguage === "uk"
        ? await findUkrainianWordFamilyMatchesInText(translatedText)
        : [];

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

  function findTargetCandidateMatches(translatedText, entry) {
    return entry.targetCandidates
      .flatMap((candidate) => findTargetCandidateMatchesInText(translatedText, candidate))
      .sort((a, b) => a.index - b.index || b.target.length - a.target.length);
  }

  async function findUkrainianWordFamilyMatchesInText(translatedText) {
    const translatedTokens = getReplaceableSourceTokens(translatedText);
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
            kind: WORD_FAMILY_MATCH_KIND,
            entry
          });
        }
      }
    }

    return matches;
  }

  function getSingleWordTargetTerms() {
    return compiledEntries.flatMap((entry) =>
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
    const configuredLemmas = getRuntimeConfig().ukrainianLemmas;
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
    const config = getRuntimeConfig();
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
          debugLog("align-error", {
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

  function findTargetCandidateMatchesInText(translatedText, candidate) {
    const haystack = translatedText.toLocaleLowerCase();
    const needle = String(candidate || "").toLocaleLowerCase();
    const matches = [];
    let index = haystack.indexOf(needle);

    while (index >= 0) {
      if (passesTargetBoundaryCheck(translatedText, index, candidate.length)) {
        matches.push({
          index,
          target: translatedText.slice(index, index + candidate.length),
          kind: "exact"
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
    const structuredBlocks =
      root.nodeType === Node.ELEMENT_NODE && root.classList.contains(STRUCTURED_BLOCK_CLASS)
        ? [root]
        : Array.from(root.querySelectorAll?.(`.${STRUCTURED_BLOCK_CLASS}`) || []);

    for (const block of structuredBlocks) {
      const stored = structuredBlockOriginals.get(block);
      block.classList.remove(STRUCTURED_BLOCK_CLASS);
      if (stored) {
        structuredBlockOriginals.delete(block);
        block.replaceChildren(stored.fragment);
      } else if (block.dataset.lwrOriginalText) {
        // The original nodes are gone (e.g. the extension was reloaded), so
        // fall back to restoring the plain original text.
        block.textContent = block.dataset.lwrOriginalText;
      }
      delete block.dataset.lwrOriginalText;
    }

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

  function clearProcessedBlockMarkers(root = document) {
    const blocks =
      root.nodeType === Node.ELEMENT_NODE && root.classList.contains(PROCESSED_BLOCK_CLASS)
        ? [root]
        : Array.from(root.querySelectorAll(`.${PROCESSED_BLOCK_CLASS}`));

    for (const block of blocks) {
      block.classList.remove(PROCESSED_BLOCK_CLASS);
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
        block.classList.remove(PROCESSED_BLOCK_CLASS);
        restoreOriginalText(block);
      }
    }
  }

  function countExistingReplacements(root = document) {
    const scaffoldKinds = new Set([BACK_TRANSLATION_MATCH_KIND, UNLEARNED_MATCH_KIND]);
    if (root.nodeType === Node.ELEMENT_NODE && root.classList.contains(REPLACEMENT_CLASS)) {
      return scaffoldKinds.has(root.dataset.learnedWordMatchKind) ? 0 : 1;
    }

    return root.querySelectorAll
      ? root.querySelectorAll(
          `.${REPLACEMENT_CLASS}:not([data-learned-word-match-kind="${BACK_TRANSLATION_MATCH_KIND}"]):not([data-learned-word-match-kind="${UNLEARNED_MATCH_KIND}"])`
        ).length
      : 0;
  }

  function countExistingWordFamilyReplacements(root = document) {
    if (
      root.nodeType === Node.ELEMENT_NODE &&
      root.classList.contains(REPLACEMENT_CLASS) &&
      root.dataset.learnedWordMatchKind === WORD_FAMILY_MATCH_KIND
    ) {
      return 1;
    }

    return root.querySelectorAll
      ? root.querySelectorAll(
          `.${REPLACEMENT_CLASS}[data-learned-word-match-kind="${WORD_FAMILY_MATCH_KIND}"]`
        ).length
      : 0;
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

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
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
    stopObserver();

    try {
      const exclusion = getTranslationExclusion();
      if (exclusion) {
        pendingContextBlocks.clear();
        processedBlockSourceTexts = new WeakMap();
        clearProcessedBlockMarkers();
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
        clearProcessedBlockMarkers();
        restoreOriginalText(document);
      }

      runtimeStats = createRuntimeStats({
        runId,
        status: "starting",
        startedAt: Date.now(),
        targetLanguage: getCurrentLanguageCode(),
        replacementCount: options.preserveExisting ? countExistingReplacements(document) : 0,
        wordFamilyReplacementCount: options.preserveExisting
          ? countExistingWordFamilyReplacements(document)
          : 0
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
        updateRuntimeStats({
          status: blockedStatuses.has(runtimeStats.status)
            ? runtimeStats.status
            : "complete",
          finishedAt: Date.now()
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

  const DUOLINGO_TOAST_ID = "learned-word-replacer-duolingo-toast";
  let duolingoAutoContinueObserver = null;
  let duolingoToastHideTimer = null;
  let duolingoHandledBlames = new WeakSet();

  function isDuolingoHost() {
    return /(^|\.)duolingo\.com$/i.test(globalThis.location.hostname);
  }

  function syncDuolingoAutoContinue() {
    const shouldRun =
      globalThis === globalThis.top && isDuolingoHost() && Boolean(state.duolingoAutoContinue);

    if (shouldRun && !duolingoAutoContinueObserver) {
      duolingoAutoContinueObserver = new MutationObserver(() => {
        skipDuolingoContinueScreen();
      });
      duolingoAutoContinueObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      skipDuolingoContinueScreen();
    } else if (!shouldRun && duolingoAutoContinueObserver) {
      duolingoAutoContinueObserver.disconnect();
      duolingoAutoContinueObserver = null;
      duolingoHandledBlames = new WeakSet();
      removeDuolingoToast();
    }
  }

  const DUOLINGO_TYPE_INPUT_ID = "learned-word-replacer-duolingo-type-input";
  const DUOLINGO_TYPE_WRAP_ID = "learned-word-replacer-duolingo-type-wrap";
  const DUOLINGO_BANK_TOGGLE_ID = "learned-word-replacer-duolingo-bank-toggle";
  const DUOLINGO_TYPE_HINT_BUTTON_ID = "learned-word-replacer-duolingo-hint-button";
  const DUOLINGO_TYPE_HINT_BADGE_ID = "learned-word-replacer-duolingo-hint-badge";
  // Lucide "eye", "eye-closed" and "lightbulb" (ISC license), inlined because
  // the page CSP has no say over content-script-created DOM but network
  // fetches of icon packs would be blocked and slow anyway.
  const DUOLINGO_EYE_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
  const DUOLINGO_EYE_CLOSED_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-.722-3.25"/><path d="M2 8a10.645 10.645 0 0 0 20 0"/><path d="m20 15-1.726-2.05"/><path d="m4 15 1.726-2.05"/><path d="m9 18 .722-3.25"/></svg>';
  const DUOLINGO_LIGHTBULB_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>';
  let duolingoTypeObserver = null;
  let duolingoTypeClickListener = null;
  let duolingoTypeKeyListener = null;
  let duolingoTypeKeySwallower = null;
  let duolingoTypeFocusListener = null;
  let duolingoTypeBlurListener = null;
  let duolingoTypeInputListener = null;
  let duolingoTypeHintTimer = null;
  let duolingoBankHidden = false;
  // Answer words on match and choice challenges start hidden: the point of
  // typing those answers is recalling the word instead of picking it from
  // the visible cards.
  let duolingoAnswerWordsHidden = true;

  function isDuolingoTypeInputTarget(event) {
    return event.target && event.target.id === DUOLINGO_TYPE_INPUT_ID;
  }

  function syncDuolingoTypeAnswers() {
    const shouldRun =
      globalThis === globalThis.top && isDuolingoHost() && Boolean(state.duolingoTypeAnswers);

    if (shouldRun && !duolingoTypeObserver) {
      duolingoTypeObserver = new MutationObserver(() => {
        ensureDuolingoTypeInput();
      });
      duolingoTypeObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      duolingoTypeClickListener = (event) => {
        const toggle =
          event.target && event.target.closest
            ? event.target.closest(`[id='${DUOLINGO_BANK_TOGGLE_ID}']`)
            : null;
        if (toggle) {
          const context = getDuolingoTypeContext();
          if (context && context.kind !== "bank") {
            duolingoAnswerWordsHidden = !duolingoAnswerWordsHidden;
          } else {
            duolingoBankHidden = !duolingoBankHidden;
          }
          applyDuolingoBankVisibility();
          // Refocus synchronously: keystrokes right after the toggle click
          // must land in the input, not on the button.
          const typeInput = document.getElementById(DUOLINGO_TYPE_INPUT_ID);
          if (typeInput) {
            typeInput.focus();
          }
          return;
        }
        const hintButton =
          event.target && event.target.closest
            ? event.target.closest(`[id='${DUOLINGO_TYPE_HINT_BUTTON_ID}']`)
            : null;
        if (hintButton) {
          const typeInput = document.getElementById(DUOLINGO_TYPE_INPUT_ID);
          if (typeInput) {
            showDuolingoTypeHint(typeInput);
            typeInput.focus();
          }
          return;
        }
        refocusDuolingoTypeInput(event);
      };
      document.addEventListener("click", duolingoTypeClickListener, true);
      // Window-capture (not element-level) handlers, for two reasons:
      // Duolingo's transition animations swap in cloneNode copies of the
      // challenge subtree (clones silently drop element listeners), and on
      // tap challenges Duolingo preventDefaults keydown in a document-level
      // capture listener, which kills text insertion into any input on the
      // page. Window capture runs first, so stopping propagation there keeps
      // our keystrokes out of Duolingo's blocker while the browser's default
      // text insertion still happens.
      duolingoTypeKeyListener = (event) => {
        if (isDuolingoTypeInputTarget(event)) {
          handleDuolingoTypeKeydown(event);
        }
      };
      window.addEventListener("keydown", duolingoTypeKeyListener, true);
      duolingoTypeKeySwallower = (event) => {
        if (isDuolingoTypeInputTarget(event)) {
          event.stopPropagation();
        }
      };
      window.addEventListener("keyup", duolingoTypeKeySwallower, true);
      window.addEventListener("keypress", duolingoTypeKeySwallower, true);
      window.addEventListener("beforeinput", duolingoTypeKeySwallower, true);
      duolingoTypeFocusListener = (event) => {
        if (isDuolingoTypeInputTarget(event)) {
          setDuolingoTypeBorder(event.target);
        }
      };
      duolingoTypeBlurListener = (event) => {
        if (isDuolingoTypeInputTarget(event)) {
          setDuolingoTypeBorder(event.target);
        }
      };
      document.addEventListener("focusin", duolingoTypeFocusListener, true);
      document.addEventListener("focusout", duolingoTypeBlurListener, true);
      duolingoTypeInputListener = (event) => {
        if (isDuolingoTypeInputTarget(event)) {
          hideDuolingoTypeHint();
          updateDuolingoTypeDeadEnd(event.target);
        }
      };
      document.addEventListener("input", duolingoTypeInputListener, true);
      ensureDuolingoTypeInput();
    } else if (!shouldRun && duolingoTypeObserver) {
      duolingoTypeObserver.disconnect();
      duolingoTypeObserver = null;
      document.removeEventListener("click", duolingoTypeClickListener, true);
      window.removeEventListener("keydown", duolingoTypeKeyListener, true);
      window.removeEventListener("keyup", duolingoTypeKeySwallower, true);
      window.removeEventListener("keypress", duolingoTypeKeySwallower, true);
      window.removeEventListener("beforeinput", duolingoTypeKeySwallower, true);
      document.removeEventListener("focusin", duolingoTypeFocusListener, true);
      document.removeEventListener("focusout", duolingoTypeBlurListener, true);
      document.removeEventListener("input", duolingoTypeInputListener, true);
      duolingoTypeClickListener = null;
      duolingoTypeKeyListener = null;
      duolingoTypeKeySwallower = null;
      duolingoTypeFocusListener = null;
      duolingoTypeBlurListener = null;
      duolingoTypeInputListener = null;
      removeDuolingoTypeInput();
    }
  }

  function getDuolingoWordBank() {
    // Duolingo keeps hidden clones of the challenge subtree around for its
    // slide transitions; only the visible bank is the real one.
    return [...document.querySelectorAll("[data-test='word-bank']")].find(
      (bank) => bank.offsetParent !== null
    );
  }

  function getVisibleDuolingoChallenge(dataTestName) {
    return [...document.querySelectorAll(`[data-test~='${dataTestName}']`)].find(
      (challenge) => challenge.offsetParent !== null
    );
  }

  function getDuolingoCardGrid(challenge, cardSelector) {
    // The card grid has no data-test of its own; it is the deepest element
    // containing every answer card, and the input row goes right before it.
    const cards = [...challenge.querySelectorAll(cardSelector)];
    if (cards.length < 2) {
      return null;
    }

    let grid = cards[0].parentElement;
    while (grid && grid !== challenge && !cards.every((card) => grid.contains(card))) {
      grid = grid.parentElement;
    }
    return grid && grid !== challenge ? grid : null;
  }

  // Per-kind DOM facts. Match: audio cards carry a number badge + waveform,
  // word cards add a challenge-tap-token-text span; matched pairs flip
  // aria-disabled. Choice (assist): cards are divs, the word sits in a
  // challenge-judge-text span, clicking selects and player-next checks.
  const DUOLINGO_TYPE_KINDS = {
    match: {
      challengeName: "challenge-listenMatch",
      cardSelector: "button[data-test*='challenge-tap-token']",
      textSelector: "[data-test='challenge-tap-token-text']"
    },
    choice: {
      challengeName: "challenge-assist",
      cardSelector: "[data-test='challenge-choice']",
      textSelector: "[data-test='challenge-judge-text']"
    }
  };

  function getDuolingoTypeContext() {
    const bank = getDuolingoWordBank();
    if (bank) {
      return { kind: "bank", container: bank, challenge: null };
    }

    for (const [kind, spec] of Object.entries(DUOLINGO_TYPE_KINDS)) {
      const challenge = getVisibleDuolingoChallenge(spec.challengeName);
      const grid = challenge ? getDuolingoCardGrid(challenge, spec.cardSelector) : null;
      if (grid) {
        return { kind, container: grid, challenge };
      }
    }

    return null;
  }

  function removeDuolingoTypeInput() {
    document
      .querySelectorAll(`[id='${DUOLINGO_TYPE_WRAP_ID}'], [id='${DUOLINGO_TYPE_INPUT_ID}']`)
      .forEach((host) => host.remove());
    document
      .querySelectorAll("[data-test='word-bank']")
      .forEach((bank) => (bank.style.visibility = ""));
    document
      .querySelectorAll(
        "[data-test='challenge-tap-token-text'], [data-test='challenge-judge-text']"
      )
      .forEach((span) => (span.style.visibility = ""));
  }

  function applyDuolingoBankVisibility() {
    // Guard every write: this runs from the MutationObserver, so an
    // unconditional innerHTML/style write would re-trigger it forever.
    const context = getDuolingoTypeContext();
    const hidden =
      context && context.kind !== "bank" ? duolingoAnswerWordsHidden : duolingoBankHidden;
    const wanted = hidden ? "hidden" : "";

    if (context && context.kind === "bank") {
      if (context.container.style.visibility !== wanted) {
        context.container.style.visibility = wanted;
      }
    } else if (context) {
      // Hide only the word text; the cards, number badges and audio buttons
      // stay visible and clickable.
      context.challenge
        .querySelectorAll(DUOLINGO_TYPE_KINDS[context.kind].textSelector)
        .forEach((span) => {
          if (span.style.visibility !== wanted) {
            span.style.visibility = wanted;
          }
        });
    }

    const subject = context && context.kind !== "bank" ? "the answer words" : "the word bank";
    const state = `${hidden ? "hidden" : "shown"}-${context ? context.kind : "none"}`;
    document.querySelectorAll(`[id='${DUOLINGO_BANK_TOGGLE_ID}']`).forEach((toggle) => {
      if (toggle.getAttribute("data-bank-state") === state) {
        return;
      }
      toggle.setAttribute("data-bank-state", state);
      toggle.innerHTML = hidden ? DUOLINGO_EYE_CLOSED_ICON : DUOLINGO_EYE_ICON;
      toggle.title = hidden ? `Show ${subject}` : `Hide ${subject}`;
      toggle.setAttribute("aria-label", toggle.title);
      toggle.setAttribute("aria-pressed", String(hidden));
    });
  }

  function ensureDuolingoTypeInput() {
    const context = getDuolingoTypeContext();
    const container = context ? context.container : null;

    // Keep exactly one input row: the one sitting before the visible bank or
    // match grid. Anything else is a leftover or a transition-clone copy.
    let keep = null;
    document.querySelectorAll(`[id='${DUOLINGO_TYPE_WRAP_ID}']`).forEach((host) => {
      if (!keep && container && host.nextElementSibling === container) {
        keep = host;
      } else {
        host.remove();
      }
    });

    if (!container || keep) {
      if (keep) {
        applyDuolingoBankVisibility();
      }
      return;
    }

    const input = document.createElement("input");
    input.id = DUOLINGO_TYPE_INPUT_ID;
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    if (context.kind === "match") {
      input.placeholder = "Press a number to listen, type the word, then space";
      input.setAttribute("aria-label", "Type the word matching the audio you hear");
    } else if (context.kind === "choice") {
      input.placeholder = "Type the meaning, then space — Enter checks";
      input.setAttribute("aria-label", "Type the answer matching the prompt");
    } else {
      input.placeholder = "Type a word, then space — Tab hints, Enter checks";
      input.setAttribute("aria-label", "Type a word from the word bank");
    }
    input.style.cssText = [
      "display: block",
      "width: 100%",
      "box-sizing: border-box",
      "margin: 0",
      "padding: 10px 84px 10px 14px",
      "border: 2px solid rgb(229, 229, 229)",
      "border-radius: 12px",
      "background: #ffffff",
      "color: rgb(60, 60, 60)",
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "font-size: 17px",
      "font-weight: 500",
      "outline: none",
      "transition: border-color 0.15s ease"
    ].join(";");

    const wrap = document.createElement("div");
    wrap.id = DUOLINGO_TYPE_WRAP_ID;
    wrap.style.cssText =
      "position: relative; width: 100%; box-sizing: border-box; margin: 0 0 12px";

    const toggle = document.createElement("button");
    toggle.id = DUOLINGO_BANK_TOGGLE_ID;
    toggle.type = "button";
    toggle.tabIndex = -1;
    toggle.style.cssText = [
      "position: absolute",
      "right: 8px",
      "top: 50%",
      "transform: translateY(-50%)",
      "display: flex",
      "align-items: center",
      "justify-content: center",
      "width: 32px",
      "height: 32px",
      "padding: 0",
      "border: none",
      "border-radius: 8px",
      "background: none",
      "color: rgb(175, 175, 175)",
      "cursor: pointer"
    ].join(";");

    const hintButton = document.createElement("button");
    hintButton.id = DUOLINGO_TYPE_HINT_BUTTON_ID;
    hintButton.type = "button";
    hintButton.tabIndex = -1;
    hintButton.title = "Hint the next letter (Tab)";
    hintButton.setAttribute("aria-label", hintButton.title);
    hintButton.innerHTML = DUOLINGO_LIGHTBULB_ICON;
    hintButton.style.cssText = [
      "position: absolute",
      "right: 44px",
      "top: 50%",
      "transform: translateY(-50%)",
      "display: flex",
      "align-items: center",
      "justify-content: center",
      "width: 32px",
      "height: 32px",
      "padding: 0",
      "border: none",
      "border-radius: 8px",
      "background: none",
      "color: rgb(175, 175, 175)",
      "cursor: pointer"
    ].join(";");

    const badge = document.createElement("div");
    badge.id = DUOLINGO_TYPE_HINT_BADGE_ID;
    badge.setAttribute("role", "status");
    badge.style.cssText = [
      "position: absolute",
      "right: 8px",
      "bottom: calc(100% + 6px)",
      "display: none",
      "padding: 6px 12px",
      "border-radius: 10px",
      "background: rgb(60, 60, 60)",
      "color: #ffffff",
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "font-size: 15px",
      "font-weight: 600",
      "white-space: nowrap",
      "pointer-events: none",
      "z-index: 2000"
    ].join(";");

    wrap.append(input, hintButton, toggle, badge);
    container.parentElement.insertBefore(wrap, container);
    applyDuolingoBankVisibility();
    input.focus();
  }

  function refocusDuolingoTypeInput(event) {
    const context = getDuolingoTypeContext();
    const input = context ? document.getElementById(DUOLINGO_TYPE_INPUT_ID) : null;
    if (!input || !input.isConnected) {
      return;
    }

    if (event.target === input) {
      return;
    }

    // Leave real text fields (report dialogs etc.) alone.
    setTimeout(() => {
      const active = document.activeElement;
      if (
        active &&
        (active === input ||
          active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        return;
      }
      input.focus();
    }, 0);
  }

  function normalizeDuolingoTypedText(value) {
    return String(value || "")
      .normalize("NFC")
      .toLocaleLowerCase()
      .replace(/[’ʼ`]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getDuolingoBankTokens() {
    const context = getDuolingoTypeContext();
    if (!context) {
      return [];
    }

    const spec = DUOLINGO_TYPE_KINDS[context.kind];
    const cardSelector = spec ? spec.cardSelector : "button[data-test*='challenge-tap-token']";
    return [...context.container.querySelectorAll(cardSelector)]
      .filter(
        (card) => !card.disabled && card.getAttribute("aria-disabled") !== "true"
      )
      .map((card) => {
        // Outside the bank only answer cards carry a text span (match audio
        // cards hold just a number badge and a waveform); read the span so
        // the badge number stays out of the matchable text. aria-disabled
        // above already excludes matched pairs.
        const source = spec ? card.querySelector(spec.textSelector) : card;
        if (!source) {
          return null;
        }
        return {
          button: card,
          // textContent, not innerText: the bank or the answer words may be
          // visibility:hidden via the eye toggle, and innerText reads as ""
          // inside hidden subtrees.
          raw: String(source.textContent || "").replace(/\s+/g, " ").trim(),
          text: normalizeDuolingoTypedText(source.textContent)
        };
      })
      .filter((token) => token && token.text);
  }

  function findDuolingoBankToken(typed) {
    const query = normalizeDuolingoTypedText(typed);
    if (!query) {
      return { match: null, couldExtend: false };
    }

    const tokens = getDuolingoBankTokens();
    const exact = tokens.filter((token) => token.text === query);
    if (exact.length) {
      // "a" vs "A" can both be in the bank; prefer the typed casing.
      const rawTyped = String(typed).replace(/\s+/g, " ").trim();
      const caseMatch = exact.find((token) => token.raw === rawTyped);
      return { match: caseMatch || exact[0], couldExtend: false };
    }

    const prefixed = tokens.filter((token) => token.text.startsWith(query));
    const uniqueTexts = new Set(prefixed.map((token) => token.text));
    if (uniqueTexts.size === 1) {
      return { match: prefixed[0], couldExtend: false };
    }

    return {
      match: null,
      couldExtend: prefixed.some((token) => token.text.startsWith(`${query} `))
    };
  }

  function normalizeDuolingoTypedPrefix(value) {
    // Like normalizeDuolingoTypedText, but a single trailing space survives:
    // mid multi-word token ("мене ") the space is part of the typed prefix,
    // and trimming it would hint the space the user already typed.
    return String(value || "")
      .normalize("NFC")
      .toLocaleLowerCase()
      .replace(/[’ʼ`]/g, "'")
      .replace(/\s+/g, " ")
      .replace(/^ /, "");
  }

  function getDuolingoNextLetterHint(typed) {
    const tokens = getDuolingoBankTokens();
    if (!tokens.length) {
      return null;
    }

    const query = normalizeDuolingoTypedPrefix(typed);
    const letters = new Set();
    let complete = false;
    for (const text of new Set(tokens.map((token) => token.text))) {
      if (!text.startsWith(query)) {
        continue;
      }
      if (text.length === query.length) {
        complete = true;
      } else {
        letters.add(text[query.length]);
      }
    }

    return { viable: complete || letters.size > 0, letters: [...letters].sort(), complete };
  }

  function setDuolingoTypeBorder(input) {
    if (input.getAttribute("data-lwr-dead-end") === "true") {
      input.style.borderColor = "rgb(234, 43, 43)";
    } else if (document.activeElement === input) {
      input.style.borderColor = "rgb(28, 176, 246)";
    } else {
      input.style.borderColor = "rgb(229, 229, 229)";
    }
  }

  function updateDuolingoTypeDeadEnd(input) {
    const hint = input.value.trim() ? getDuolingoNextLetterHint(input.value) : null;
    const deadEnd = Boolean(hint && !hint.viable);
    if (input.getAttribute("data-lwr-dead-end") !== String(deadEnd)) {
      input.setAttribute("data-lwr-dead-end", String(deadEnd));
    }
    setDuolingoTypeBorder(input);
  }

  function hideDuolingoTypeHint() {
    if (duolingoTypeHintTimer) {
      clearTimeout(duolingoTypeHintTimer);
      duolingoTypeHintTimer = null;
    }
    // Guarded write: display changes feed the MutationObserver.
    document.querySelectorAll(`[id='${DUOLINGO_TYPE_HINT_BADGE_ID}']`).forEach((badge) => {
      if (badge.style.display !== "none") {
        badge.style.display = "none";
      }
    });
  }

  function showDuolingoTypeHint(input) {
    const badge = document.getElementById(DUOLINGO_TYPE_HINT_BADGE_ID);
    const hint = getDuolingoNextLetterHint(input.value);
    if (!badge || !hint) {
      return;
    }

    let text;
    if (!hint.viable) {
      text = "✗ no bank word matches — backspace";
    } else {
      const letters = hint.letters
        .map((letter) => (letter === " " ? "␣" : letter))
        .join(" / ");
      if (hint.complete) {
        text = letters ? `space places it · or continue: ${letters}` : "space places it";
      } else {
        text = `next: ${letters}`;
      }
    }

    if (badge.textContent !== text) {
      badge.textContent = text;
    }
    const background = hint.viable ? "rgb(60, 60, 60)" : "rgb(234, 43, 43)";
    if (badge.style.background !== background) {
      badge.style.background = background;
    }
    if (badge.style.display !== "block") {
      badge.style.display = "block";
    }

    if (duolingoTypeHintTimer) {
      clearTimeout(duolingoTypeHintTimer);
    }
    duolingoTypeHintTimer = setTimeout(() => hideDuolingoTypeHint(), 2500);
  }

  function clickDuolingoMatchCardByNumber(digit) {
    const context = getDuolingoTypeContext();
    if (!context || context.kind !== "match") {
      return false;
    }

    // Every card shows a number badge, and it is the first text inside the
    // button (audio cards read "3", word cards "5word").
    const card = [
      ...context.container.querySelectorAll("button[data-test*='challenge-tap-token']")
    ].find(
      (button) =>
        !button.disabled &&
        button.getAttribute("aria-disabled") !== "true" &&
        String(button.textContent || "").trim().startsWith(digit)
    );
    if (!card) {
      return false;
    }

    card.click();
    return true;
  }

  function getLastPlacedDuolingoToken() {
    const bank = getDuolingoWordBank();
    if (!bank) {
      return null;
    }

    const placed = [...document.querySelectorAll("button[data-test*='challenge-tap-token']")]
      .filter(
        (button) =>
          !bank.contains(button) &&
          button.offsetParent !== null &&
          button.innerText.trim()
      );
    return placed[placed.length - 1] || null;
  }

  function flashDuolingoTypeInput(input) {
    input.style.borderColor = "rgb(234, 43, 43)";
    setTimeout(() => {
      setDuolingoTypeBorder(input);
    }, 350);
  }

  function handleDuolingoTypeKeydown(event) {
    event.stopPropagation();

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const input = event.target;
    const typed = input.value.trim();

    if (event.key === "Backspace" && !input.value) {
      const lastPlaced = getLastPlacedDuolingoToken();
      if (lastPlaced) {
        lastPlaced.click();
      }
      event.preventDefault();
      return;
    }

    if (event.key === "Tab") {
      showDuolingoTypeHint(input);
      event.preventDefault();
      return;
    }

    // Match challenges: a digit on an empty buffer taps that numbered card,
    // so the audio can be played without reaching for the mouse. With text
    // in the buffer digits type normally (and dead-end like any other miss).
    if (/^[1-9]$/.test(event.key) && !input.value) {
      if (clickDuolingoMatchCardByNumber(event.key)) {
        event.preventDefault();
      }
      return;
    }

    if (event.key !== " " && event.key !== "Enter") {
      return;
    }

    if (!typed) {
      if (event.key === "Enter") {
        const check = document.querySelector("[data-test='player-next']");
        if (
          check &&
          !check.disabled &&
          check.getAttribute("aria-disabled") !== "true"
        ) {
          check.click();
        }
        event.preventDefault();
      } else {
        event.preventDefault();
      }
      return;
    }

    const { match, couldExtend } = findDuolingoBankToken(typed);

    if (match) {
      match.button.click();
      input.value = "";
      // Clearing the value programmatically fires no input event, so reset
      // the hint UI here.
      hideDuolingoTypeHint();
      updateDuolingoTypeDeadEnd(input);
      event.preventDefault();
      return;
    }

    // A space may be the middle of a multi-word token ("мене звуть"):
    // let it through while the buffer still prefixes several tokens.
    if (event.key === " " && couldExtend) {
      return;
    }

    // No match: flash, but let spaces land so a stuck buffer stays readable
    // ("brother is not" instead of "brotherisnot").
    if (event.key === "Enter") {
      event.preventDefault();
    }
    flashDuolingoTypeInput(input);
  }

  function skipDuolingoContinueScreen() {
    const blame = document.querySelector("[data-test~='blame']");
    if (!blame || duolingoHandledBlames.has(blame)) {
      return;
    }

    const nextButton = document.querySelector("[data-test='player-next']");
    if (
      !nextButton ||
      nextButton.disabled ||
      nextButton.getAttribute("aria-disabled") === "true"
    ) {
      return;
    }

    duolingoHandledBlames.add(blame);
    const correct = !/\bblame-incorrect\b/.test(blame.getAttribute("data-test") || "");
    // Capture the verdict text before the click tears the footer down.
    const { heading, body } = readDuolingoBlameText(blame);
    showDuolingoToast({ correct, heading, body });
    nextButton.click();
  }

  function readDuolingoBlameText(blame) {
    const lines = String(blame.innerText || "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line && !/^(report|discuss)$/i.test(line));

    return {
      heading: lines[0] || "",
      body: lines.slice(1).join("\n")
    };
  }

  function removeDuolingoToast() {
    if (duolingoToastHideTimer) {
      clearTimeout(duolingoToastHideTimer);
      duolingoToastHideTimer = null;
    }

    const toast = document.getElementById(DUOLINGO_TOAST_ID);
    if (toast) {
      toast.remove();
    }
  }

  function dismissDuolingoToast(toast) {
    if (duolingoToastHideTimer) {
      clearTimeout(duolingoToastHideTimer);
      duolingoToastHideTimer = null;
    }

    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(12px)";
    setTimeout(() => toast.remove(), 250);
  }

  function showDuolingoToast({ correct, heading, body }) {
    removeDuolingoToast();

    const palette = correct
      ? { background: "rgb(215, 255, 184)", text: "rgb(88, 167, 0)", icon: "✓" }
      : { background: "rgb(255, 223, 224)", text: "rgb(234, 43, 43)", icon: "✕" };

    const toast = document.createElement("div");
    toast.id = DUOLINGO_TOAST_ID;
    toast.style.cssText = [
      "position: fixed",
      "left: 50%",
      "bottom: 24px",
      "transform: translateX(-50%) translateY(12px)",
      "z-index: 2147483647",
      "display: flex",
      "align-items: flex-start",
      "gap: 14px",
      "max-width: min(600px, calc(100vw - 32px))",
      `background: ${palette.background}`,
      "border-radius: 16px",
      "padding: 14px 20px",
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "opacity: 0",
      "transition: opacity 0.25s ease, transform 0.25s ease",
      "cursor: pointer",
      "box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14)"
    ].join(";");

    const icon = document.createElement("div");
    icon.textContent = palette.icon;
    icon.style.cssText = [
      "flex: 0 0 auto",
      "width: 36px",
      "height: 36px",
      "border-radius: 50%",
      "background: #ffffff",
      `color: ${palette.text}`,
      "font-size: 22px",
      "font-weight: 700",
      "line-height: 36px",
      "text-align: center"
    ].join(";");
    toast.appendChild(icon);

    const textWrap = document.createElement("div");
    textWrap.style.cssText = "min-width: 0";

    if (heading) {
      const headingEl = document.createElement("div");
      headingEl.textContent = heading;
      headingEl.style.cssText = `color: ${palette.text}; font-size: 17px; font-weight: 700; line-height: 1.3`;
      textWrap.appendChild(headingEl);
    }

    if (body) {
      const bodyEl = document.createElement("div");
      bodyEl.textContent = body;
      bodyEl.style.cssText = `color: ${palette.text}; font-size: 15px; font-weight: 500; line-height: 1.4; margin-top: 2px; white-space: pre-line; overflow-wrap: anywhere`;
      textWrap.appendChild(bodyEl);
    }

    toast.appendChild(textWrap);

    const scheduleHide = (delay) => {
      duolingoToastHideTimer = setTimeout(() => dismissDuolingoToast(toast), delay);
    };

    // Wrong answers carry the correct solution, so leave them up longer.
    const hideDelay = correct ? 2500 : 6000;
    toast.addEventListener("click", () => dismissDuolingoToast(toast));
    toast.addEventListener("mouseenter", () => {
      if (duolingoToastHideTimer) {
        clearTimeout(duolingoToastHideTimer);
        duolingoToastHideTimer = null;
      }
    });
    toast.addEventListener("mouseleave", () => scheduleHide(1500));

    document.documentElement.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateX(-50%) translateY(0)";
    });
    scheduleHide(hideDelay);
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

  function getDuolingoWordsCountHeading() {
    for (const heading of document.querySelectorAll("h1,h2,h3")) {
      if (/^\d[\d,]*\s+words?$/i.test(normalizeDuolingoText(heading.textContent))) {
        return heading;
      }
    }
    return null;
  }

  function getDuolingoExpectedWordCount() {
    const heading = getDuolingoWordsCountHeading();
    const match = heading
      ? normalizeDuolingoText(heading.textContent).match(/^(\d[\d,]*)\s+words?$/i)
      : null;
    return match ? Number(match[1].replaceAll(",", "")) : 0;
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

    // Keep clicking "Load more" until the whole list is on the page. Progress
    // is enforced per click — waitForDuolingoWordCountIncrease rejects when a
    // click loads nothing new — so the cap is only a runaway guard, sized far
    // above any real vocabulary (1000 clicks ~ 100k words).
    for (let loadAttempt = 0; loadAttempt < 1000; loadAttempt += 1) {
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

  const DUOLINGO_IMPORT_BUTTON_ID = "learned-word-replacer-duolingo-import-button";
  const DUOLINGO_WORDS_DELETE_ID = "learned-word-replacer-duolingo-words-delete";
  const DUOLINGO_IMPORT_STATUS_ID = "learned-word-replacer-duolingo-import-status";
  const DUOLINGO_IMPORT_WRAP_ID = "learned-word-replacer-duolingo-import-wrap";
  let duolingoImportObserver = null;
  let duolingoImportInProgress = false;

  // Extension UI embedded in Duolingo pages (the Words-page Import button and
  // the settings panel under duolingo.com/settings). Active on every
  // duolingo.com page load — these are SPA routes — independent of the other
  // settings, so the extension keeps working without the popup or side panel
  // (mobile browsers often support neither).
  function syncDuolingoPageUi() {
    if (globalThis !== globalThis.top || !isDuolingoHost() || duolingoImportObserver) {
      return;
    }

    duolingoImportObserver = new MutationObserver(() => {
      ensureDuolingoImportButton();
      ensureDuolingoSettingsUi();
      ensureDuolingoWordsInfo();
      ensureDuolingoWordsTabs();
    });
    duolingoImportObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    document.addEventListener(
      "click",
      (event) => {
        const closest = (selector) =>
          event.target && event.target.closest ? event.target.closest(selector) : null;

        if (closest(`[id='${DUOLINGO_IMPORT_BUTTON_ID}']`)) {
          runDuolingoPageImport();
          return;
        }

        if (closest(`[id='${DUOLINGO_WORDS_DELETE_ID}']`)) {
          runDuolingoWordsDeleteAll();
          return;
        }

        const wordsTab = closest("button[data-lwr-words-tab]");
        if (wordsTab) {
          duolingoWordsSection = wordsTab.getAttribute("data-lwr-words-tab");
          ensureDuolingoWordsTabs();
          return;
        }

        const manualEdit = closest("button[data-lwr-manual-edit]");
        if (manualEdit) {
          startDuolingoManualEdit(manualEdit.getAttribute("data-lwr-manual-edit"));
          return;
        }

        if (closest("button[data-lwr-manual-delete-all]")) {
          runDuolingoManualDeleteAll();
          return;
        }

        const entryToggle = closest("input[data-lwr-entry-id]");
        if (entryToggle) {
          // A checkbox in the manual list; let the checkbox update itself,
          // the storage write and re-render follow.
          toggleDuolingoEntryEnabled(entryToggle.getAttribute("data-lwr-entry-id"));
          return;
        }

        const wordChipRemove = closest("button[data-lwr-entry-remove]");
        if (wordChipRemove) {
          event.preventDefault();
          event.stopPropagation();
          removeDuolingoEntry(wordChipRemove.getAttribute("data-lwr-entry-remove"));
          return;
        }

        const wordChip = closest("button[data-lwr-entry-id]");
        if (wordChip) {
          event.preventDefault();
          event.stopPropagation();
          toggleDuolingoEntryEnabled(wordChip.getAttribute("data-lwr-entry-id"));
          return;
        }

        const settingsLink = closest(`[id='${DUOLINGO_SETTINGS_LINK_ID}']`);
        if (settingsLink) {
          // Keep Duolingo's router away from our synthetic settings route.
          event.preventDefault();
          event.stopPropagation();
          activateDuolingoSettingsPanel(settingsLink);
          return;
        }

        if (closest("a[href^='/settings']")) {
          deactivateDuolingoSettingsPanel();
        }
      },
      true
    );
    ensureDuolingoImportButton();
    ensureDuolingoSettingsUi();
    ensureDuolingoWordsInfo();
    ensureDuolingoWordsTabs();
  }

  function ensureDuolingoImportButton() {
    // Guard every write: this runs from a MutationObserver.
    if (!isDuolingoWordsPage()) {
      document
        .querySelectorAll(`[id='${DUOLINGO_IMPORT_WRAP_ID}']`)
        .forEach((wrap) => wrap.remove());
      return;
    }

    const heading = getDuolingoWordsCountHeading();
    let keep = null;
    document.querySelectorAll(`[id='${DUOLINGO_IMPORT_WRAP_ID}']`).forEach((wrap) => {
      if (!keep && heading && wrap.previousElementSibling === heading) {
        keep = wrap;
      } else {
        wrap.remove();
      }
    });
    if (!heading || keep) {
      return;
    }

    const button = document.createElement("button");
    button.id = DUOLINGO_IMPORT_BUTTON_ID;
    button.type = "button";
    button.textContent = "Import to Sly Fox";
    button.title = "Sync every learned word on this page into the Sly Fox Translator vocabulary";
    button.style.cssText = [
      "display: inline-flex",
      "align-items: center",
      "padding: 8px 16px",
      "border: 2px solid rgb(28, 176, 246)",
      "border-radius: 12px",
      "background: #ffffff",
      "color: rgb(28, 176, 246)",
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "font-size: 14px",
      "font-weight: 700",
      "letter-spacing: 0.8px",
      "text-transform: uppercase",
      "cursor: pointer"
    ].join(";");

    const deleteButton = document.createElement("button");
    deleteButton.id = DUOLINGO_WORDS_DELETE_ID;
    deleteButton.type = "button";
    deleteButton.textContent = "Delete all";
    deleteButton.title =
      "Remove every synced Duolingo word from the Sly Fox Translator vocabulary";
    deleteButton.style.cssText = button.style.cssText
      .replaceAll("rgb(28, 176, 246)", "rgb(234, 43, 43)");

    const status = document.createElement("span");
    status.id = DUOLINGO_IMPORT_STATUS_ID;
    status.style.cssText = [
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "font-size: 14px",
      "color: rgb(120, 120, 120)"
    ].join(";");

    const wrap = document.createElement("div");
    wrap.id = DUOLINGO_IMPORT_WRAP_ID;
    wrap.style.cssText =
      "display: flex; align-items: center; gap: 12px; margin: 10px 0 4px";
    wrap.append(button, deleteButton, status);
    heading.insertAdjacentElement("afterend", wrap);

    if (duolingoImportInProgress) {
      button.disabled = true;
      button.textContent = "Importing…";
    }
  }

  function setDuolingoImportStatus(text, color) {
    document.querySelectorAll(`[id='${DUOLINGO_IMPORT_STATUS_ID}']`).forEach((status) => {
      if (status.textContent !== text) {
        status.textContent = text;
      }
      const wanted = color || "rgb(120, 120, 120)";
      if (status.style.color !== wanted) {
        status.style.color = wanted;
      }
    });
  }

  async function runDuolingoPageImport() {
    if (duolingoImportInProgress) {
      return;
    }

    duolingoImportInProgress = true;
    document.querySelectorAll(`[id='${DUOLINGO_IMPORT_BUTTON_ID}']`).forEach((button) => {
      button.disabled = true;
      button.textContent = "Importing…";
    });
    setDuolingoImportStatus("Loading every learned word from this page…");

    try {
      const scraped = await scrapeAllDuolingoWords();
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "LWR_IMPORT_DUOLINGO_WORDS",
            text: scraped.text,
            languageName: scraped.languageName
          },
          (reply) => {
            if (chrome.runtime.lastError) {
              resolve({ ok: false, reason: chrome.runtime.lastError.message });
              return;
            }
            resolve(reply || { ok: false, reason: "The extension did not respond." });
          }
        );
      });

      if (!response.ok) {
        throw new Error(response.reason || "Could not import Duolingo words.");
      }

      setDuolingoImportStatus(
        `Synced ${scraped.count} word${scraped.count === 1 ? "" : "s"} to ${response.profileName} — ${response.addedCount} new`,
        "rgb(88, 167, 0)"
      );
    } catch (error) {
      setDuolingoImportStatus(
        error && error.message ? error.message : "Could not import Duolingo words.",
        "rgb(234, 43, 43)"
      );
    } finally {
      duolingoImportInProgress = false;
      document.querySelectorAll(`[id='${DUOLINGO_IMPORT_BUTTON_ID}']`).forEach((button) => {
        button.disabled = false;
        button.textContent = "Import to Sly Fox";
      });
    }
  }

  // The Words page also hosts the manual vocabulary manager: a small tab bar
  // swaps Duolingo's own list for a panel with an add/edit form and the
  // manual entries, so all vocabulary work happens on this one page.
  const DUOLINGO_WORDS_TABS_ID = "learned-word-replacer-duolingo-words-tabs";
  const DUOLINGO_MANUAL_PANEL_ID = "learned-word-replacer-duolingo-manual-panel";
  let duolingoWordsSection = "duolingo";
  let duolingoManualEditId = null;
  let duolingoManualFilter = "";

  function getDuolingoWordsLayout() {
    const heading = getDuolingoWordsCountHeading();
    const list = getDuolingoWordCollection().list;
    const region = heading && heading.parentElement ? heading.parentElement.parentElement : null;
    const host = region ? region.parentElement : null;
    return host && list && host.contains(list) && host !== region
      ? { host, region, list, heading }
      : null;
  }

  function duolingoWordsTabButton(section, label) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.setAttribute("data-lwr-words-tab", section);
    return button;
  }

  function ensureDuolingoWordsTabs() {
    // Guard every write: this runs from the MutationObserver.
    if (!isDuolingoWordsPage()) {
      return;
    }

    const layout = getDuolingoWordsLayout();
    if (!layout) {
      return;
    }

    let tabs = document.getElementById(DUOLINGO_WORDS_TABS_ID);
    if (tabs && tabs.nextElementSibling !== layout.region) {
      tabs.remove();
      tabs = null;
    }
    if (!tabs) {
      tabs = document.createElement("div");
      tabs.id = DUOLINGO_WORDS_TABS_ID;
      tabs.style.cssText = "display: flex; gap: 8px; margin: 0 0 16px";
      tabs.append(
        duolingoWordsTabButton("duolingo", "Duolingo words"),
        duolingoWordsTabButton("manual", "Sly Fox manual words")
      );
      layout.host.insertBefore(tabs, layout.region);
    }

    for (const button of tabs.querySelectorAll("[data-lwr-words-tab]")) {
      const active = button.getAttribute("data-lwr-words-tab") === duolingoWordsSection;
      const wanted = [
        "padding: 8px 16px",
        "border-radius: 12px",
        "font-family: 'duolingo-sans', -apple-system, sans-serif",
        "font-size: 14px",
        "font-weight: 700",
        "letter-spacing: 0.8px",
        "text-transform: uppercase",
        "cursor: pointer",
        active
          ? "border: 2px solid rgb(28, 176, 246); background: rgb(221, 244, 255); color: rgb(24, 153, 214)"
          : "border: 2px solid rgb(229, 229, 229); background: #ffffff; color: rgb(175, 175, 175)"
      ].join(";");
      if (button.style.cssText !== wanted) {
        button.style.cssText = wanted;
      }
      const pressed = String(active);
      if (button.getAttribute("aria-pressed") !== pressed) {
        button.setAttribute("aria-pressed", pressed);
      }
    }

    const manualActive = duolingoWordsSection === "manual";
    const nativeDisplay = manualActive ? "none" : "";
    if (layout.region.style.display !== nativeDisplay) {
      layout.region.style.display = nativeDisplay;
    }
    if (layout.list.style.display !== nativeDisplay) {
      layout.list.style.display = nativeDisplay;
    }

    let panel = document.getElementById(DUOLINGO_MANUAL_PANEL_ID);
    if (panel && panel.parentElement !== layout.host) {
      panel.remove();
      panel = null;
    }
    if (!panel) {
      panel = buildDuolingoManualPanel(layout.heading.className);
      layout.host.append(panel);
    }
    const panelDisplay = manualActive ? "" : "none";
    if (panel.style.display !== panelDisplay) {
      panel.style.display = panelDisplay;
    }
    if (manualActive) {
      renderDuolingoManualPanel();
    }
  }

  function duolingoManualInput(placeholder) {
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = placeholder;
    input.style.cssText = [
      "flex: 1 1 180px",
      "min-width: 140px",
      "box-sizing: border-box",
      "padding: 9px 12px",
      "border: 2px solid rgb(229, 229, 229)",
      "border-radius: 12px",
      "background: #ffffff",
      "color: rgb(60, 60, 60)",
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "font-size: 15px",
      "outline: none"
    ].join(";");
    return input;
  }

  function buildDuolingoManualPanel(headingClassName) {
    const panel = document.createElement("div");
    panel.id = DUOLINGO_MANUAL_PANEL_ID;
    panel.style.display = "none";

    const heading = document.createElement("h2");
    heading.className = headingClassName;
    heading.setAttribute("data-lwr-manual-count", "");
    panel.append(heading);

    // Mirror the Duolingo tab: the destructive action sits in a row right
    // under the count heading.
    const actions = document.createElement("div");
    actions.style.cssText = "display: flex; align-items: center; gap: 12px; margin: 10px 0 4px";
    const deleteAll = duolingoPanelButton("Delete all", { danger: true });
    deleteAll.setAttribute("data-lwr-manual-delete-all", "");
    deleteAll.title = "Remove every manual word from the Sly Fox Translator vocabulary";
    actions.append(deleteAll);
    panel.append(actions);

    const form = document.createElement("form");
    form.style.cssText = "display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0";
    const sourceInput = duolingoManualInput("English (e.g. a cup of coffee)");
    sourceInput.setAttribute("data-lwr-manual-source", "");
    const targetInput = duolingoManualInput("Learned word or phrase");
    targetInput.setAttribute("data-lwr-manual-target", "");
    const submit = duolingoPanelButton("Add");
    submit.type = "submit";
    submit.setAttribute("data-lwr-manual-submit", "");
    const cancel = duolingoPanelButton("Cancel");
    cancel.style.display = "none";
    cancel.setAttribute("data-lwr-manual-cancel", "");
    form.append(sourceInput, targetInput, submit, cancel);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitDuolingoManualForm(panel);
    });
    cancel.addEventListener("click", () => {
      stopDuolingoManualEdit(panel);
    });
    panel.append(form);

    const filter = duolingoManualInput("Search manual words");
    filter.setAttribute("data-lwr-manual-filter", "");
    filter.style.margin = "0 0 12px";
    filter.addEventListener("input", () => {
      duolingoManualFilter = filter.value;
      renderDuolingoManualList();
    });
    panel.append(filter);

    const list = document.createElement("div");
    list.setAttribute("data-lwr-manual-list", "");
    panel.append(list);

    return panel;
  }

  function getDuolingoManualEntries() {
    return getCurrentEntries().filter((entry) => entry.origin === "manual");
  }

  function renderDuolingoManualPanel() {
    const panel = document.getElementById(DUOLINGO_MANUAL_PANEL_ID);
    if (!panel) {
      return;
    }

    const count = getDuolingoManualEntries().length;
    const label = `${count} manual word${count === 1 ? "" : "s"}`;
    const heading = panel.querySelector("[data-lwr-manual-count]");
    if (heading.textContent !== label) {
      heading.textContent = label;
    }
    renderDuolingoManualList();
  }

  function renderDuolingoManualList() {
    const panel = document.getElementById(DUOLINGO_MANUAL_PANEL_ID);
    if (!panel) {
      return;
    }

    const query = normalizeDuolingoWordKey(duolingoManualFilter);
    const entries = getDuolingoManualEntries().filter(
      (entry) =>
        !query ||
        normalizeDuolingoWordKey(entry.source).includes(query) ||
        normalizeDuolingoWordKey(entry.target).includes(query)
    );
    const signature = entries
      .map((entry) => `${entry.id}:${entry.enabled ? 1 : 0}:${entry.source}:${entry.target}`)
      .join("|");

    const list = panel.querySelector("[data-lwr-manual-list]");
    if (list.getAttribute("data-lwr-signature") === signature) {
      return;
    }
    list.setAttribute("data-lwr-signature", signature);
    list.textContent = "";

    if (!entries.length) {
      const empty = document.createElement("div");
      empty.textContent = query
        ? "No manual words match this search."
        : "No manual words yet — add one above.";
      empty.style.cssText =
        "padding: 12px 0; font-family: 'duolingo-sans', -apple-system, sans-serif; font-size: 14px; color: rgb(150, 150, 150)";
      list.append(empty);
      return;
    }

    for (const entry of entries) {
      const row = document.createElement("div");
      row.style.cssText = [
        "display: flex",
        "align-items: center",
        "justify-content: space-between",
        "gap: 16px",
        "padding: 10px 0",
        "border-bottom: 1px solid rgb(229, 229, 229)",
        "font-family: 'duolingo-sans', -apple-system, sans-serif"
      ].join(";");

      const text = document.createElement("span");
      const target = document.createElement("span");
      target.textContent = entry.target;
      target.style.cssText = `display: block; font-size: 16px; font-weight: 600; color: ${entry.enabled ? "rgb(60, 60, 60)" : "rgb(175, 175, 175)"}`;
      const source = document.createElement("span");
      source.textContent = entry.source;
      source.style.cssText = "display: block; font-size: 13px; color: rgb(150, 150, 150)";
      text.append(target, source);
      if (entry.definition) {
        const definition = document.createElement("span");
        definition.textContent = entry.definition;
        definition.style.cssText = "display: block; font-size: 12px; color: rgb(175, 175, 175)";
        text.append(definition);
      }

      const controls = document.createElement("span");
      controls.style.cssText = "display: inline-flex; align-items: center; gap: 4px; flex: none";
      const toggle = document.createElement("input");
      toggle.type = "checkbox";
      toggle.checked = entry.enabled;
      toggle.setAttribute("data-lwr-entry-id", entry.id);
      toggle.title = entry.enabled ? "Pause this replacement" : "Resume this replacement";
      toggle.style.cssText =
        "width: 20px; height: 20px; margin-right: 6px; accent-color: rgb(28, 176, 246); cursor: pointer";

      const edit = document.createElement("button");
      edit.type = "button";
      edit.textContent = "✎";
      edit.setAttribute("data-lwr-manual-edit", entry.id);
      edit.title = `Edit “${entry.source}”`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "✕";
      remove.setAttribute("data-lwr-entry-remove", entry.id);
      remove.title = `Delete “${entry.source}”`;
      for (const control of [edit, remove]) {
        control.style.cssText =
          "width: 30px; height: 30px; border: none; border-radius: 8px; background: none; color: rgb(175, 175, 175); font-size: 15px; cursor: pointer";
      }

      controls.append(toggle, edit, remove);
      row.append(text, controls);
      list.append(row);
    }
  }

  function submitDuolingoManualForm(panel) {
    const sourceInput = panel.querySelector("[data-lwr-manual-source]");
    const targetInput = panel.querySelector("[data-lwr-manual-target]");
    const source = sourceInput.value.trim();
    const target = targetInput.value.trim();
    if (!source || !target) {
      return;
    }

    const profile = getCurrentProfile();
    if (!profile) {
      return;
    }

    const editId = duolingoManualEditId;
    updateDuolingoProfileEntries((entries) => {
      if (editId) {
        return entries.map((entry) =>
          entry.id === editId ? { ...entry, source, target } : entry
        );
      }

      // Adding an already-known manual source updates it instead of
      // creating a duplicate row, mirroring the popup's import merge.
      const existing = entries.find(
        (entry) =>
          entry.origin === "manual" &&
          entry.source.toLocaleLowerCase() === source.toLocaleLowerCase()
      );
      if (existing) {
        return entries.map((entry) =>
          entry === existing ? { ...entry, source, target, enabled: true } : entry
        );
      }

      return [
        ...entries,
        {
          id: createId(),
          source,
          target,
          languageCode: profile.languageCode,
          definition: "",
          origin: "manual",
          learned: true,
          enabled: true,
          createdAt: Date.now()
        }
      ];
    });
    stopDuolingoManualEdit(panel);
    renderDuolingoManualPanel();
  }

  function startDuolingoManualEdit(entryId) {
    const panel = document.getElementById(DUOLINGO_MANUAL_PANEL_ID);
    const entry = getDuolingoManualEntries().find((candidate) => candidate.id === entryId);
    if (!panel || !entry) {
      return;
    }

    duolingoManualEditId = entryId;
    panel.querySelector("[data-lwr-manual-source]").value = entry.source;
    panel.querySelector("[data-lwr-manual-target]").value = entry.target;
    panel.querySelector("[data-lwr-manual-submit]").textContent = "Save";
    panel.querySelector("[data-lwr-manual-cancel]").style.display = "";
    panel.querySelector("[data-lwr-manual-source]").focus();
  }

  function stopDuolingoManualEdit(panel) {
    duolingoManualEditId = null;
    panel.querySelector("[data-lwr-manual-source]").value = "";
    panel.querySelector("[data-lwr-manual-target]").value = "";
    panel.querySelector("[data-lwr-manual-submit]").textContent = "Add";
    panel.querySelector("[data-lwr-manual-cancel]").style.display = "none";
  }

  function runDuolingoManualDeleteAll() {
    const profile = getCurrentProfile();
    const count = getDuolingoManualEntries().length;
    if (!profile || !count) {
      return;
    }

    const confirmed = globalThis.confirm(
      `Delete all ${count} manual word${count === 1 ? "" : "s"} from ${profile.name}? Manual words cannot be restored by Import.`
    );
    if (!confirmed) {
      return;
    }

    updateDuolingoProfileEntries((entries) =>
      entries.filter((entry) => entry.origin !== "manual")
    );
    renderDuolingoManualPanel();
  }

  // Per-word vocabulary info embedded in the Words page list: each row grows
  // chips for the extension entries replacing that word (click = pause/resume
  // that replacement), replacing the popup's Duolingo vocabulary browser.
  function normalizeDuolingoWordKey(value) {
    return String(value || "")
      .normalize("NFC")
      .toLocaleLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildDuolingoEntriesByWord() {
    const map = new Map();
    for (const entry of getCurrentEntries()) {
      if (entry.origin !== "duolingo") {
        continue;
      }
      for (const alternate of String(entry.target || "").split(" / ")) {
        const key = normalizeDuolingoWordKey(alternate);
        if (!key) {
          continue;
        }
        if (!map.has(key)) {
          map.set(key, []);
        }
        map.get(key).push(entry);
      }
    }
    return map;
  }

  function updateDuolingoProfileEntries(mapEntries) {
    const profile = getCurrentProfile();
    if (!profile) {
      return;
    }

    const profiles = state.profiles.map((candidate) =>
      candidate === profile
        ? { ...candidate, entries: mapEntries(candidate.entries) }
        : candidate
    );
    state = { ...state, profiles };
    chrome.storage.local.set({ [STORAGE_KEY]: state });
    // Re-render immediately; the storage event follows for everything else.
    ensureDuolingoWordsInfo();
    renderDuolingoManualPanel();
  }

  function toggleDuolingoEntryEnabled(entryId) {
    updateDuolingoProfileEntries((entries) =>
      entries.map((entry) =>
        entry.id === entryId ? { ...entry, enabled: !entry.enabled } : entry
      )
    );
  }

  function runDuolingoWordsDeleteAll() {
    const profile = getCurrentProfile();
    const count = getCurrentEntries().filter((entry) => entry.origin === "duolingo").length;
    if (!profile || !count) {
      setDuolingoImportStatus("There are no synced Duolingo words to delete.", "rgb(234, 43, 43)");
      return;
    }

    const confirmed = globalThis.confirm(
      `Delete all ${count} synced Duolingo word${count === 1 ? "" : "s"} from ${profile.name}? Import restores them any time.`
    );
    if (!confirmed) {
      return;
    }

    updateDuolingoProfileEntries((entries) =>
      entries.filter((entry) => entry.origin !== "duolingo")
    );
    setDuolingoImportStatus(
      `Deleted ${count} Duolingo word${count === 1 ? "" : "s"} from ${profile.name}.`,
      "rgb(88, 167, 0)"
    );
  }

  function removeDuolingoEntry(entryId) {
    // No confirmation, matching the popup's per-row delete: a removed
    // Duolingo entry comes back with the next Import anyway.
    updateDuolingoProfileEntries((entries) =>
      entries.filter((entry) => entry.id !== entryId)
    );
  }

  function ensureDuolingoWordsInfo() {
    // Guard every write: this runs from the MutationObserver.
    if (!isDuolingoWordsPage()) {
      return;
    }

    const collection = getDuolingoWordCollection();
    if (!collection.list) {
      return;
    }

    const entriesByWord = buildDuolingoEntriesByWord();
    for (const item of collection.list.children) {
      const record = readDuolingoWordRow(item);
      if (!record) {
        continue;
      }

      const heading = item.querySelector("h2,h3,h4");
      const host = heading ? heading.parentElement : null;
      if (!host) {
        continue;
      }

      const entries = entriesByWord.get(normalizeDuolingoWordKey(record.word)) || [];
      const signature = entries.length
        ? entries.map((entry) => `${entry.id}:${entry.enabled ? 1 : 0}`).join(",")
        : "none";

      let strip = host.querySelector("[data-lwr-word-info]");
      if (strip && strip.getAttribute("data-lwr-signature") === signature) {
        continue;
      }
      if (!strip) {
        strip = document.createElement("div");
        strip.setAttribute("data-lwr-word-info", "");
        strip.style.cssText =
          "display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 6px";
        host.append(strip);
      }
      strip.setAttribute("data-lwr-signature", signature);
      strip.textContent = "";

      if (!entries.length) {
        const note = document.createElement("span");
        note.textContent = "Not synced to Sly Fox";
        note.style.cssText =
          "font-family: 'duolingo-sans', -apple-system, sans-serif; font-size: 12px; color: rgb(175, 175, 175)";
        strip.append(note);
        continue;
      }

      for (const entry of entries) {
        const pill = document.createElement("span");
        pill.style.cssText = [
          "display: inline-flex",
          "align-items: center",
          "border-radius: 999px",
          "font-family: 'duolingo-sans', -apple-system, sans-serif",
          "font-size: 13px",
          "font-weight: 600",
          entry.enabled
            ? "border: 2px solid rgb(28, 176, 246); background: rgb(221, 244, 255); color: rgb(24, 153, 214)"
            : "border: 2px solid rgb(229, 229, 229); background: #ffffff; color: rgb(175, 175, 175)"
        ].join(";");

        const chip = document.createElement("button");
        chip.type = "button";
        chip.textContent = entry.source;
        chip.setAttribute("data-lwr-entry-id", entry.id);
        chip.title = entry.enabled
          ? `Replacing “${entry.source}” on pages — click to pause`
          : `Not replacing “${entry.source}” — click to resume`;
        chip.style.cssText =
          "padding: 3px 2px 3px 10px; border: none; background: none; color: inherit; font: inherit; cursor: pointer";

        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "✕";
        remove.setAttribute("data-lwr-entry-remove", entry.id);
        remove.title = `Remove “${entry.source}” from Sly Fox`;
        remove.setAttribute("aria-label", remove.title);
        remove.style.cssText =
          "padding: 3px 8px 3px 4px; border: none; background: none; color: inherit; opacity: 0.55; font: inherit; font-size: 11px; cursor: pointer";

        pill.append(chip, remove);
        strip.append(pill);
      }
    }
  }

  const DUOLINGO_SETTINGS_LINK_ID = "learned-word-replacer-duolingo-settings-link";
  const DUOLINGO_SETTINGS_ITEM_ID = "learned-word-replacer-duolingo-settings-item";
  const DUOLINGO_SETTINGS_PANEL_ID = "learned-word-replacer-duolingo-settings-panel";
  const DUOLINGO_SETTINGS_ROWS = [
    { key: "enabled", label: "Enable replacements", description: "Replace the words you have learned on every website" },
    { key: "showHighlights", label: "Highlight replacements", description: "Underline replaced words on pages" },
    { key: "structureMode", label: "Target-language sentence structure", description: "Rebuild sentences in the target language's word order" },
    { key: "showProcessedSections", label: "Mark checked sections", description: "Mark page sections that were checked for learned words" },
    { key: "showOriginalOnHover", label: "Show original English on hover", description: "Show the original English when hovering a replaced word" },
    { key: "translateEnglishOnHover", label: "Translate English on hover", description: "Translate English words when hovering them" },
    { key: "duolingoAutoContinue", label: "Skip Duolingo continue screens", description: "Press Continue for you and show the result as a brief popup" },
    { key: "duolingoTypeAnswers", label: "Type Duolingo answers", description: "Type answers with hints on word-bank, audio-match and meaning exercises" }
  ];
  let duolingoSettingsActive = false;
  let duolingoHiddenSettingsPane = null;

  function isDuolingoSettingsPage() {
    return isDuolingoHost() && globalThis.location.pathname.startsWith("/settings");
  }

  function getDuolingoSettingsNav() {
    // The settings nav is the visible list of /settings links. No stable
    // data-test hooks exist here, so navigate by shape, and style our own
    // item by copying Duolingo's own class names at runtime.
    const link = [...document.querySelectorAll("a[href^='/settings']")].find(
      (candidate) =>
        candidate.offsetParent !== null &&
        candidate.parentElement?.tagName === "LI" &&
        candidate.id !== DUOLINGO_SETTINGS_LINK_ID
    );
    const item = link ? link.parentElement : null;
    return item ? { list: item.parentElement, item, link } : null;
  }

  function getDuolingoSettingsContentPane() {
    // The pane sits next to the nav in a shared container; find the nav's
    // ancestor whose parent also holds an h1 outside the nav subtree, then
    // take the sibling containing that h1.
    const nav = getDuolingoSettingsNav();
    if (!nav) {
      return null;
    }

    let navSide = nav.list;
    while (navSide.parentElement && navSide.parentElement !== document.body) {
      const heading = [...navSide.parentElement.querySelectorAll("h1")].find(
        (candidate) => !navSide.contains(candidate)
      );
      if (heading) {
        return [...navSide.parentElement.children].find(
          (child) =>
            child !== navSide &&
            child.id !== DUOLINGO_SETTINGS_PANEL_ID &&
            child.contains(heading)
        );
      }
      navSide = navSide.parentElement;
    }
    return null;
  }

  function ensureDuolingoSettingsUi() {
    // Guard every write: this runs from the MutationObserver.
    if (!isDuolingoSettingsPage()) {
      deactivateDuolingoSettingsPanel();
      document
        .querySelectorAll(`[id='${DUOLINGO_SETTINGS_ITEM_ID}']`)
        .forEach((item) => item.remove());
      return;
    }

    const nav = getDuolingoSettingsNav();
    if (!nav) {
      return;
    }

    let ourItem = document.getElementById(DUOLINGO_SETTINGS_ITEM_ID);
    if (ourItem && ourItem.parentElement !== nav.list) {
      ourItem.remove();
      ourItem = null;
    }
    if (!ourItem) {
      // Deep-clone one of Duolingo's own items so the inner structure comes
      // along too: the mobile menu nests the label in a div and appends a
      // chevron image, and a bare <a> loses that card styling.
      const item = nav.item.cloneNode(true);
      item.id = DUOLINGO_SETTINGS_ITEM_ID;
      const link = item.querySelector("a") || item;
      link.id = DUOLINGO_SETTINGS_LINK_ID;
      // The hash href keeps middle-click/new-tab working: any settings URL
      // with #sly-fox auto-opens the panel below, and Duolingo's router
      // ignores hashes (a real /settings/sly-fox path would 404).
      link.setAttribute("href", "#sly-fox");
      link.removeAttribute("aria-current");
      setDuolingoNavItemLabel(link, "Sly Fox Translator");
      const logo = document.createElement("img");
      logo.alt = "";
      logo.src = chrome.runtime.getURL("icons/icon-48.png");
      logo.style.cssText =
        "width: 20px; height: 20px; margin-right: 8px; border-radius: 4px; vertical-align: -4px; flex: none";
      (link.querySelector("div") || link).prepend(logo);
      nav.list.append(item);
    }

    const activationLink = document.getElementById(DUOLINGO_SETTINGS_LINK_ID);
    if (globalThis.location.hash === "#sly-fox" && !duolingoSettingsActive && activationLink) {
      history.replaceState(
        null,
        "",
        globalThis.location.pathname + globalThis.location.search
      );
      activateDuolingoSettingsPanel(activationLink);
    }

    if (duolingoSettingsActive) {
      ensureDuolingoSettingsPanel();
    }
  }

  function setDuolingoNavItemLabel(link, label) {
    // Swap the text while keeping the cloned structure (label divs, chevron
    // images) intact: the first non-empty text node becomes the label, any
    // other text is cleared.
    const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
    let replaced = false;
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.nodeValue.trim()) {
        continue;
      }
      node.nodeValue = replaced ? "" : label;
      replaced = true;
    }
    if (!replaced) {
      link.textContent = label;
    }
  }

  function activateDuolingoSettingsPanel(link) {
    duolingoSettingsActive = true;
    link.setAttribute("aria-current", "page");
    document.querySelectorAll("a[href^='/settings'][aria-current]").forEach((other) => {
      if (other !== link) {
        other.removeAttribute("aria-current");
      }
    });
    ensureDuolingoSettingsPanel();
  }

  function deactivateDuolingoSettingsPanel() {
    if (!duolingoSettingsActive && !duolingoHiddenSettingsPane) {
      return;
    }

    duolingoSettingsActive = false;
    if (duolingoHiddenSettingsPane) {
      duolingoHiddenSettingsPane.style.display = "";
      duolingoHiddenSettingsPane = null;
    }
    document
      .querySelectorAll(`[id='${DUOLINGO_SETTINGS_PANEL_ID}']`)
      .forEach((panel) => panel.remove());
    const link = document.getElementById(DUOLINGO_SETTINGS_LINK_ID);
    if (link) {
      link.removeAttribute("aria-current");
    }
  }

  function getDuolingoSettingsSwapTarget() {
    // Desktop: nav and content pane sit side by side — swap the pane. The
    // narrow-viewport /settings route is a full-page menu with no pane (and
    // no h1): swap the menu's nav element instead.
    const pane = getDuolingoSettingsContentPane();
    if (pane) {
      return { node: pane, mode: "pane" };
    }

    const nav = getDuolingoSettingsNav();
    const menu = nav ? nav.list.closest("nav") : null;
    return menu ? { node: menu, mode: "menu" } : null;
  }

  function ensureDuolingoSettingsPanel() {
    const target = getDuolingoSettingsSwapTarget();
    if (target && target.node !== duolingoHiddenSettingsPane) {
      // Duolingo re-rendered its pane (or we just activated); hide the fresh
      // copy and restore any stale pointer.
      if (duolingoHiddenSettingsPane) {
        duolingoHiddenSettingsPane.style.display = "";
      }
      duolingoHiddenSettingsPane = target.node;
    }
    if (duolingoHiddenSettingsPane && duolingoHiddenSettingsPane.style.display !== "none") {
      duolingoHiddenSettingsPane.style.display = "none";
    }

    const host = duolingoHiddenSettingsPane ? duolingoHiddenSettingsPane.parentElement : null;
    if (!host) {
      return;
    }

    let panel = document.getElementById(DUOLINGO_SETTINGS_PANEL_ID);
    if (panel && panel.parentElement !== host) {
      panel.remove();
      panel = null;
    }
    if (!panel) {
      panel = buildDuolingoSettingsPanel(target ? target.mode : "pane");
      if (target && target.mode === "pane") {
        // Copying the hidden pane's classes keeps Duolingo's own column layout.
        panel.className = duolingoHiddenSettingsPane.className;
      }
      host.append(panel);
    }
    syncDuolingoSettingsPanelValues();
  }

  function buildDuolingoSettingsPanel(mode) {
    const panel = document.createElement("div");
    panel.id = DUOLINGO_SETTINGS_PANEL_ID;

    if (mode === "menu") {
      panel.style.padding = "0 24px";
      // Full-page mobile mode has no visible way back to the menu once the
      // nav is hidden, so the panel carries its own.
      const back = document.createElement("button");
      back.type = "button";
      back.textContent = "‹ Settings";
      back.style.cssText = [
        "display: block",
        "margin: 4px 0 12px",
        "padding: 4px 0",
        "border: none",
        "background: none",
        "color: rgb(28, 176, 246)",
        "font-family: 'duolingo-sans', -apple-system, sans-serif",
        "font-size: 16px",
        "font-weight: 700",
        "cursor: pointer"
      ].join(";");
      back.addEventListener("click", () => {
        deactivateDuolingoSettingsPanel();
      });
      panel.append(back);
    }

    const heading = document.createElement("h1");
    const paneHeading = duolingoHiddenSettingsPane
      ? duolingoHiddenSettingsPane.querySelector("h1")
      : null;
    if (paneHeading) {
      heading.className = paneHeading.className;
    } else {
      heading.style.cssText =
        "font-family: 'duolingo-sans', -apple-system, sans-serif; font-size: 22px; font-weight: 700; color: rgb(60, 60, 60)";
    }
    heading.textContent = "Sly Fox Translator";
    heading.style.marginBottom = "24px";
    panel.append(heading);

    for (const row of DUOLINGO_SETTINGS_ROWS) {
      const label = document.createElement("label");
      label.style.cssText = [
        "display: flex",
        "align-items: center",
        "justify-content: space-between",
        "gap: 24px",
        "padding: 12px 0",
        "border-bottom: 1px solid rgb(229, 229, 229)",
        "cursor: pointer",
        "font-family: 'duolingo-sans', -apple-system, sans-serif"
      ].join(";");

      const text = document.createElement("span");
      const title = document.createElement("span");
      title.textContent = row.label;
      title.style.cssText =
        "display: block; font-size: 17px; font-weight: 600; color: rgb(60, 60, 60)";
      const description = document.createElement("span");
      description.textContent = row.description;
      description.style.cssText =
        "display: block; margin-top: 2px; font-size: 14px; color: rgb(150, 150, 150)";
      text.append(title, description);

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.setAttribute("data-lwr-setting", row.key);
      checkbox.style.cssText =
        "width: 22px; height: 22px; flex: none; accent-color: rgb(28, 176, 246); cursor: pointer";
      checkbox.addEventListener("change", () => {
        state = { ...state, [row.key]: checkbox.checked };
        chrome.storage.local.set({ [STORAGE_KEY]: state });
      });

      label.append(text, checkbox);
      panel.append(label);
    }

    panel.append(buildDuolingoExclusionSection(), buildDuolingoFileSection());
    return panel;
  }

  function duolingoPanelSectionHeading(text) {
    const heading = document.createElement("h2");
    heading.textContent = text;
    heading.style.cssText =
      "margin: 32px 0 4px; font-family: 'duolingo-sans', -apple-system, sans-serif; font-size: 19px; font-weight: 700; color: rgb(60, 60, 60)";
    return heading;
  }

  function duolingoPanelButton(label, { danger } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    const color = danger ? "rgb(234, 43, 43)" : "rgb(28, 176, 246)";
    button.style.cssText = [
      "padding: 8px 14px",
      `border: 2px solid ${color}`,
      "border-radius: 12px",
      "background: #ffffff",
      `color: ${color}`,
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "font-size: 13px",
      "font-weight: 700",
      "letter-spacing: 0.6px",
      "text-transform: uppercase",
      "cursor: pointer"
    ].join(";");
    return button;
  }

  function buildDuolingoExclusionSection() {
    const section = document.createElement("div");
    section.append(duolingoPanelSectionHeading("Do not translate"));

    const list = document.createElement("div");
    list.setAttribute("data-lwr-exclusion-list", "");
    section.append(list);
    return section;
  }

  function buildDuolingoFileSection() {
    const section = document.createElement("div");
    section.append(duolingoPanelSectionHeading("Vocabulary files"));

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".csv,.txt,text/csv,text/plain";
    fileInput.style.display = "none";
    let pendingImportOrigin = "";
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (!file) {
        return;
      }
      try {
        const text = await file.text();
        const response = await sendDuolingoRuntimeMessage({
          type: "LWR_IMPORT_TEXT",
          text,
          originOverride: pendingImportOrigin
        });
        if (!response.ok) {
          throw new Error(response.reason || "Could not import the file.");
        }
        setDuolingoFileStatus(
          `Imported ${response.addedCount} new row${response.addedCount === 1 ? "" : "s"} from ${file.name} — ${response.totalCount} total in ${response.profileName}.`,
          false
        );
      } catch (error) {
        setDuolingoFileStatus(
          error && error.message ? error.message : `Could not read ${file.name}.`,
          true
        );
      }
    });

    const buttons = document.createElement("div");
    buttons.style.cssText = "display: flex; flex-wrap: wrap; gap: 10px; margin: 12px 0";

    const importAll = duolingoPanelButton("Import file");
    importAll.addEventListener("click", () => {
      pendingImportOrigin = "";
      fileInput.click();
    });
    const importManual = duolingoPanelButton("Import manual file");
    importManual.addEventListener("click", () => {
      pendingImportOrigin = "manual";
      fileInput.click();
    });
    const exportAll = duolingoPanelButton("Download all CSV");
    exportAll.addEventListener("click", () => runDuolingoPanelExport(""));
    const exportManual = duolingoPanelButton("Download manual CSV");
    exportManual.addEventListener("click", () => runDuolingoPanelExport("manual"));
    const deleteAll = duolingoPanelButton("Delete all", { danger: true });
    deleteAll.setAttribute("data-lwr-delete-all", "");
    deleteAll.addEventListener("click", () => runDuolingoPanelDeleteAll());

    buttons.append(importAll, importManual, exportAll, exportManual, deleteAll);

    const status = document.createElement("div");
    status.setAttribute("data-lwr-file-status", "");
    status.textContent = "Import a CSV, TXT, or Duolingo export file, or download your vocabulary.";
    status.style.cssText =
      "font-family: 'duolingo-sans', -apple-system, sans-serif; font-size: 14px; color: rgb(150, 150, 150)";

    section.append(fileInput, buttons, status);
    return section;
  }

  function sendDuolingoRuntimeMessage(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (reply) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, reason: chrome.runtime.lastError.message });
          return;
        }
        resolve(reply || { ok: false, reason: "The extension did not respond." });
      });
    });
  }

  function setDuolingoFileStatus(text, isError) {
    document.querySelectorAll("[data-lwr-file-status]").forEach((status) => {
      status.textContent = text;
      status.style.color = isError ? "rgb(234, 43, 43)" : "rgb(88, 167, 0)";
    });
  }

  async function runDuolingoPanelExport(origin) {
    const response = await sendDuolingoRuntimeMessage({ type: "LWR_EXPORT_CSV", origin });
    if (!response.ok) {
      setDuolingoFileStatus(response.reason || "Could not export the vocabulary.", true);
      return;
    }

    const blob = new Blob([response.csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = response.filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setDuolingoFileStatus(
      `Downloaded ${response.count} ${origin === "manual" ? "manual" : "vocabulary"} entr${response.count === 1 ? "y" : "ies"}.`,
      false
    );
  }

  function runDuolingoPanelDeleteAll() {
    const profile = getCurrentProfile();
    const count = getCurrentEntries().length;
    if (!profile || !count) {
      setDuolingoFileStatus("There are no saved words to delete.", true);
      return;
    }

    const confirmed = globalThis.confirm(
      `Delete all ${count} saved word${count === 1 ? "" : "s"} from ${profile.name}? This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }

    const profiles = state.profiles.map((candidate) =>
      candidate === profile ? { ...candidate, entries: [] } : candidate
    );
    state = { ...state, profiles };
    chrome.storage.local.set({ [STORAGE_KEY]: state });
    setDuolingoFileStatus(`Deleted ${count} word${count === 1 ? "" : "s"} from ${profile.name}.`, false);
  }

  function removeDuolingoExclusion(kind, value) {
    const exclusions = state.doNotTranslate || { sites: [], pages: [] };
    state = {
      ...state,
      doNotTranslate: {
        sites: (exclusions.sites || []).filter(
          (site) => !(kind === "sites" && site === value)
        ),
        pages: (exclusions.pages || []).filter(
          (excludedPage) => !(kind === "pages" && excludedPage === value)
        )
      }
    };
    chrome.storage.local.set({ [STORAGE_KEY]: state });
  }

  function renderDuolingoExclusionList() {
    const exclusions = state.doNotTranslate || { sites: [], pages: [] };
    const rows = [
      ...(exclusions.sites || []).map((value) => ({ kind: "sites", value, label: "Whole site" })),
      ...(exclusions.pages || []).map((value) => ({ kind: "pages", value, label: "Specific page" }))
    ];

    document.querySelectorAll("[data-lwr-exclusion-list]").forEach((list) => {
      const signature = JSON.stringify(rows);
      if (list.getAttribute("data-lwr-signature") === signature) {
        return;
      }
      list.setAttribute("data-lwr-signature", signature);
      list.textContent = "";

      if (!rows.length) {
        const empty = document.createElement("div");
        empty.textContent =
          "No excluded sites or pages. Use the extension popup on a page to exclude it.";
        empty.style.cssText =
          "padding: 10px 0; font-family: 'duolingo-sans', -apple-system, sans-serif; font-size: 14px; color: rgb(150, 150, 150)";
        list.append(empty);
        return;
      }

      for (const row of rows) {
        const entry = document.createElement("div");
        entry.style.cssText = [
          "display: flex",
          "align-items: center",
          "justify-content: space-between",
          "gap: 16px",
          "padding: 10px 0",
          "border-bottom: 1px solid rgb(229, 229, 229)",
          "font-family: 'duolingo-sans', -apple-system, sans-serif"
        ].join(";");

        const text = document.createElement("span");
        const value = document.createElement("span");
        value.textContent = row.value;
        value.style.cssText =
          "display: block; font-size: 15px; color: rgb(60, 60, 60); word-break: break-all";
        const label = document.createElement("span");
        label.textContent = row.label;
        label.style.cssText = "display: block; font-size: 13px; color: rgb(150, 150, 150)";
        text.append(value, label);

        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "✕";
        remove.title = `Translate ${row.value} again`;
        remove.setAttribute("aria-label", remove.title);
        remove.style.cssText =
          "flex: none; width: 28px; height: 28px; border: none; border-radius: 8px; background: none; color: rgb(175, 175, 175); font-size: 15px; cursor: pointer";
        remove.addEventListener("click", () => removeDuolingoExclusion(row.kind, row.value));

        entry.append(text, remove);
        list.append(entry);
      }
    });
  }

  function syncDuolingoSettingsPanelValues() {
    const panel = document.getElementById(DUOLINGO_SETTINGS_PANEL_ID);
    if (!panel) {
      return;
    }

    panel.querySelectorAll("input[data-lwr-setting]").forEach((checkbox) => {
      const wanted = Boolean(state[checkbox.getAttribute("data-lwr-setting")]);
      if (checkbox.checked !== wanted) {
        checkbox.checked = wanted;
      }
    });
    renderDuolingoExclusionList();
  }

  function warmContextTranslator() {
    // Only the top frame warms up eagerly: ad iframes would otherwise each
    // spin up a translator that their (usually empty) page pass never needs.
    if (globalThis !== globalThis.top || getTranslationExclusion()) {
      return;
    }

    const targetLanguage = getCurrentLanguageCode();
    if (
      !state.enabled ||
      !targetLanguage ||
      targetLanguage === SOURCE_LANGUAGE ||
      !getCurrentEntries().some((entry) => entry.enabled)
    ) {
      return;
    }

    getContextTranslator(targetLanguage).catch(() => {});
  }

  function loadState() {
    chrome.storage.local.get({ [STORAGE_KEY]: DEFAULT_STATE }, (stored) => {
      state = normalizeState(stored[STORAGE_KEY]);
      // Start the translator spin-up now so it overlaps the DOM walk that
      // applyToPage does before it needs the translator.
      warmContextTranslator();
      syncDuolingoAutoContinue();
      syncDuolingoTypeAnswers();
      syncDuolingoPageUi();
      applyToPage();
    });
  }

  globalThis[REFRESH_KEY] = loadState;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[STORAGE_KEY]) {
      return;
    }

    state = normalizeState(changes[STORAGE_KEY].newValue);
    syncDuolingoAutoContinue();
    syncDuolingoTypeAnswers();
    syncDuolingoSettingsPanelValues();
    ensureDuolingoWordsInfo();
    ensureDuolingoWordsTabs();
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
