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
  const INLINE_STRUCTURED_CLASS = "learned-word-replacer-inline";
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
  const MAX_HOVER_HINT_ROWS = 3;
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
    `[class~='${REPLACEMENT_CLASS}']`,
    // Words already rewritten in place are not source text: an ancestor block
    // that read them back would translate the translation, and rebuild itself
    // around a copy of the link they sit in.
    `[class~='${INLINE_STRUCTURED_CLASS}']`,
    `[class~='${REVERSE_HOVER_TOOLTIP_CLASS}']`
  ].join(",");

  const DEFAULT_STATE = {
    version: 3,
    enabled: true,
    showHighlights: true,
    fullTranslation: false,
    structureMode: true,
    targetLanguagePages: true,
    hideTextUntilTranslated: true,
    showProcessedSections: true,
    showOriginalOnHover: true,
    translateEnglishOnHover: true,
    duolingoAutoContinue: true,
    duolingoTypeAnswers: true,
    duolingoCopyPhrase: true,
    duolingoLowercaseBank: true,
    duolingoDecoyWords: true,
    wholeWords: true,
    caseSensitive: false,
    preserveCase: true,
    currentProfileId: "",
    doNotTranslate: {
      sites: ["www.duolingo.com"],
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
  // Vocabulary is stable between recompiles, so each entry's target is split
  // into words once instead of on every sentence.
  const candidateTokenValueCache = new Map();
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
  let reverseHoverAnchorRect = null;
  let reverseHoverTranslatorKey = "";
  let reverseTranslatorAvailability = "";
  let reverseHoverTranslatorPromise = null;
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
      version: 3
    };

    delete next.replacementMode;
    delete next.showObviousCognates;
    next.doNotTranslate = normalizeDoNotTranslate(source.doNotTranslate);

    // Version 3 turned every settings toggle on by default and stopped
    // translating Duolingo's own pages; older stored states migrate once.
    if (Number(source.version || 0) < 3) {
      next.structureMode = true;
      next.duolingoAutoContinue = true;
      next.duolingoTypeAnswers = true;
      if (!next.doNotTranslate.sites.includes("www.duolingo.com")) {
        next.doNotTranslate.sites.push("www.duolingo.com");
      }
    }

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

  // Text that is already written in the target language must never enter the
  // English→target pipeline: the translator mangles it and alignment then
  // "replaces" words that were never English. Those blocks go through the
  // mirrored target→English pass instead (see processReverseUnits).
  // Detectable whenever the target language uses a non-Latin script.
  const TARGET_LANGUAGE_SCRIPT_PATTERNS = {
    el: /[Ͱ-Ͽἀ-῿]/gu,
    uk: /[Ѐ-ӿ]/gu
  };

  function isTextAlreadyInTargetLanguage(text, targetLanguage = getCurrentLanguageCode()) {
    const pattern = TARGET_LANGUAGE_SCRIPT_PATTERNS[targetLanguage];
    if (!pattern) {
      return false;
    }

    const value = String(text || "");
    const targetLetterCount = (value.match(pattern) || []).length;
    if (!targetLetterCount) {
      return false;
    }

    const latinLetterCount = (value.match(/[A-Za-z]/g) || []).length;
    return targetLetterCount > latinLetterCount;
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
    candidateTokenValueCache.clear();
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

    // Styled after Duolingo's own hint popover (captured live 2026-07-21):
    // #f7f7f7 box, 2px #e5e5e5 border, 15px radius, centered 17px/22px rows
    // padded 15px 10px with 2px separators, and a rotated-square caret
    // clipped inside a 20x10 window that overlaps the box border by 2px.
    const reverseHoverTooltipStyle = `
      .${REVERSE_HOVER_TOOLTIP_CLASS} {
        color: #3c3c3c;
        font: 500 17px/22px duolingo-sans, "din-round", system-ui, -apple-system, sans-serif;
        left: 0;
        opacity: 0;
        pointer-events: none;
        position: fixed;
        text-align: center;
        top: 0;
        transform: translate(-50%, calc(-100% - 13px));
        visibility: hidden;
        z-index: 2147483647;
      }

      .${REVERSE_HOVER_TOOLTIP_CLASS}[data-visible="true"] {
        opacity: 1;
        visibility: visible;
      }

      .${REVERSE_HOVER_TOOLTIP_CLASS}[data-placement="below"] {
        transform: translate(-50%, 13px);
      }

      .${REVERSE_HOVER_TOOLTIP_CLASS}-box {
        background: #f7f7f7;
        border: 2px solid #e5e5e5;
        border-radius: 15px;
        overflow: hidden;
      }

      .${REVERSE_HOVER_TOOLTIP_CLASS}-row {
        max-width: min(320px, calc(100vw - 16px));
        overflow: hidden;
        padding: 15px 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .${REVERSE_HOVER_TOOLTIP_CLASS}-row + .${REVERSE_HOVER_TOOLTIP_CLASS}-row {
        border-top: 2px solid #e5e5e5;
      }

      .${REVERSE_HOVER_TOOLTIP_CLASS}-caret {
        bottom: -8px;
        height: 10px;
        left: 50%;
        margin-left: -10px;
        overflow: hidden;
        position: absolute;
        width: 20px;
      }

      .${REVERSE_HOVER_TOOLTIP_CLASS}[data-placement="below"] .${REVERSE_HOVER_TOOLTIP_CLASS}-caret {
        bottom: auto;
        top: -8px;
      }

      .${REVERSE_HOVER_TOOLTIP_CLASS}-caret::before {
        background: #f7f7f7;
        border: 2px solid #e5e5e5;
        border-radius: 2px;
        box-sizing: border-box;
        content: "";
        height: 14px;
        left: 3px;
        position: absolute;
        top: -7px;
        transform: rotate(45deg);
        width: 14px;
      }

      .${REVERSE_HOVER_TOOLTIP_CLASS}[data-placement="below"] .${REVERSE_HOVER_TOOLTIP_CLASS}-caret::before {
        top: 3px;
      }
    `;

    // The original-word tooltip is the fixed-position element attached to the
    // document root: page stacking contexts (e.g. Wikipedia's page container)
    // and overflow-clipping ancestors would trap or cut off a CSS ::after.
    const originalHoverStyle = "";
    // A small dot hanging in the left margin marks a block that was checked
    // and left unchanged. It floats out of the text flow by its own width, so
    // nothing on the page shifts, and it takes its colour from the block's own
    // text so it sits quietly on any page, light or dark.
    const processedBlockStyle = state.showProcessedSections
      ? `
      .${PROCESSED_BLOCK_CLASS}::before {
        background: currentColor;
        border-radius: 50%;
        content: "";
        float: left;
        height: 0.32em;
        margin-left: -0.95em;
        margin-top: 0.55em;
        opacity: 0.35;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        width: 0.32em;
      }
    `
      : "";
    // Blocks waiting on their translation keep their layout but show nothing,
    // so the untranslated wording is never readable and each block appears
    // once it is finished.
    const pendingBlockStyle = `
      [${PENDING_HIDE_ATTRIBUTE}],
      [${PENDING_HIDE_ATTRIBUTE}] * {
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        text-shadow: none !important;
      }
    `;

    if (!state.translateEnglishOnHover) {
      clearReverseHover();
    }

    // Duolingo underlines hint words with a repeating 6x2 SVG tile (a 3px
    // #afafaf dash then a 3px gap) painted along the bottom of a 4px bottom
    // padding (0.2em at their 20px font) — captured live 2026-07-22 from
    // [data-test='hint-token']. Inlined as data: URIs so pages need no
    // network access; unlearned matches use the same dash in Duolingo blue.
    style.textContent =
      (state.showHighlights
        ? `
        .${REPLACEMENT_CLASS} {
          background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='2' viewBox='0 0 6 2'%3E%3Crect fill='%23afafaf' width='3' height='2' x='0' y='0'/%3E%3C/svg%3E") repeat-x 0 100%;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
          cursor: inherit;
          padding-bottom: 0.2em;
          position: relative;
        }

        .${REPLACEMENT_CLASS}[data-learned-word-match-kind="${BACK_TRANSLATION_MATCH_KIND}"] {
          background: none;
          padding-bottom: 0;
        }

        .${REPLACEMENT_CLASS}[data-learned-word-match-kind="${UNLEARNED_MATCH_KIND}"] {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='2' viewBox='0 0 6 2'%3E%3Crect fill='%231cb0f6' width='3' height='2' x='0' y='0'/%3E%3C/svg%3E");
        }

      ` + processedBlockStyle + pendingBlockStyle + originalHoverStyle + reverseHoverTooltipStyle
        : `
        .${REPLACEMENT_CLASS} {
          cursor: inherit;
          position: relative;
        }
      ` + processedBlockStyle + pendingBlockStyle + originalHoverStyle + reverseHoverTooltipStyle);
  }

  function removeStyle() {
    removeReverseHoverTooltip();
    clearProcessedBlockMarkers();
    const style = document.getElementById(STYLE_ID);
    if (style) {
      style.remove();
    }
  }

  // Whitespace-only text nodes hold no replaceable words, but they still
  // separate words in the rendered text ("3<b> </b><a>hertz</a>"), so unit
  // text assembly must keep them or the translator sees "3hertz" and the
  // structure-mode rendered-text check can never match.
  function isTextNodeInIgnoredSubtree(node) {
    if (!node.nodeValue) {
      return true;
    }

    const parent = node.parentElement;
    if (!parent) {
      return true;
    }

    return Boolean(parent.closest(IGNORED_SELECTOR));
  }

  function shouldIgnoreTextNode(node) {
    if (!node.nodeValue || !node.nodeValue.trim()) {
      return true;
    }

    return isTextNodeInIgnoredSubtree(node);
  }

  function isWordCharacter(char) {
    return Boolean(char && /[\p{L}\p{N}\p{M}_]/u.test(char));
  }

  function isApostrophe(char) {
    return char === "'" || char === "\u2019" || char === "\u02bc";
  }

  function isCyrillic(char) {
    return Boolean(char && /\p{Script=Cyrillic}/u.test(char));
  }

  function isWordInternalApostrophe(text, index) {
    return (
      isApostrophe(text[index]) &&
      isWordCharacter(text[index - 1]) &&
      isWordCharacter(text[index + 1])
    );
  }

  // Ukrainian glues compounds together with a hyphen (\u0431\u0443\u0434\u044c-\u044f\u043a\u0438\u0439, \u043f\u043e-\u043f\u0435\u0440\u0448\u0435,
  // \u0432\u0441\u0435-\u0442\u0430\u043a\u0438), so neither half is a word on its own. Latin script uses the
  // hyphen as a genuine boundary ("mid-1890s", "well-known"), so keying off the
  // neighbouring script leaves English splitting as it always has, without
  // threading a language code through every matcher.
  function isCyrillicCompoundHyphen(text, index) {
    return (
      text[index] === "-" &&
      isWordCharacter(text[index - 1]) &&
      isWordCharacter(text[index + 1]) &&
      isCyrillic(text[index - 1]) &&
      isCyrillic(text[index + 1])
    );
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

    const hoverTarget = getHoverWordAtPoint(event.clientX, event.clientY);
    if (!hoverTarget) {
      clearReverseHover();
      return;
    }

    const word = hoverTarget.word;
    const targetLanguage = getCurrentLanguageCode();
    // The tooltip anchors to the word's own box, like Duolingo's hint popover
    // — refreshed on every move so a second occurrence of the same word gets
    // its own anchor.
    reverseHoverAnchorRect = hoverTarget.rect;

    // Words already in the target language answer with their ENGLISH side
    // instead of being pushed through the English→target direction.
    if (!/[A-Za-z]/.test(word)) {
      if (isTextAlreadyInTargetLanguage(word, targetLanguage)) {
        handleTargetWordHover(word, targetLanguage);
      } else {
        clearReverseHover();
      }
      return;
    }

    const key = `${targetLanguage}\u0000${word.toLocaleLowerCase()}`;
    if (key === reverseHoverKey) {
      positionReverseHoverTooltip();
      return;
    }

    clearReverseHover();
    reverseHoverKey = key;

    // Learned vocabulary answers the hover directly — and with up to three
    // alternates, like Duolingo's own hints — without a translator call.
    const vocabularyRows = dedupeHintRows(getHintTargetsForSourceWord(word));
    if (vocabularyRows.length) {
      showReverseHoverTooltip(vocabularyRows);
      return;
    }

    const requestId = ++reverseHoverRequestId;
    const cached = reverseHoverTranslationCache.get(key);

    if (cached) {
      showReverseHoverTooltip(dedupeHintRows([cached]));
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
      showReverseHoverTooltip(dedupeHintRows([translated]));
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

  function handleTargetWordHover(word, targetLanguage) {
    const key = `${targetLanguage}:${SOURCE_LANGUAGE} ${word.toLocaleLowerCase()}`;
    if (key === reverseHoverKey) {
      positionReverseHoverTooltip();
      return;
    }

    clearReverseHover();
    reverseHoverKey = key;

    // Learned vocabulary answers directly with the English word plus its
    // Duolingo meanings, exactly like hovering a replaced word.
    const vocabularyRows = dedupeHintRows(getHintMeaningsForTargetWord(word));
    if (vocabularyRows.length) {
      showReverseHoverTooltip(vocabularyRows);
      return;
    }

    const requestId = ++reverseHoverRequestId;
    const cached = reverseHoverTranslationCache.get(key);

    if (cached) {
      showReverseHoverTooltip(dedupeHintRows(Array.isArray(cached) ? cached : [cached]));
      return;
    }

    reverseHoverTimer = setTimeout(() => {
      reverseHoverTimer = null;
      resolveTargetWordHoverRows(word, targetLanguage, key, requestId);
    }, getReverseHoverDelayMs());
  }

  async function resolveTargetWordHoverRows(word, targetLanguage, key, requestId) {
    try {
      const rows = [];

      // Inflected page words still reach vocabulary through their lemmas.
      if (targetLanguage === "uk") {
        const lemmasByWord = await getUkrainianLemmas([word]);
        for (const lemma of lemmasByWord.get(normalizeUkrainianMorphologyWord(word)) || []) {
          rows.push(...getHintMeaningsForTargetWord(lemma));
        }
      }

      if (!rows.length) {
        const translator = await getReverseTranslator(targetLanguage);
        if (translator) {
          const translated = String(await translator.translate(word)).trim();
          if (translated && translated.toLocaleLowerCase() !== word.toLocaleLowerCase()) {
            rows.push(translated);
          }
        }
      }

      const deduped = dedupeHintRows(rows);
      if (!deduped.length || requestId !== reverseHoverRequestId || key !== reverseHoverKey) {
        return;
      }

      cacheReverseHoverTranslation(key, deduped);
      showReverseHoverTooltip(deduped);
    } catch (error) {
      // Hover translation should never interrupt page replacement.
    }
  }

  // The target→English translator, shared by hover and the target-language
  // page pass. It is created lazily and only when the language pack is already
  // installed — neither a hover nor a page pass may start a model download;
  // a failed create arms the next trusted click instead.
  function getReverseTranslator(targetLanguage) {
    const key = `${targetLanguage}:${SOURCE_LANGUAGE}`;
    if (reverseHoverTranslatorPromise && reverseHoverTranslatorKey === key) {
      return reverseHoverTranslatorPromise;
    }

    const translatorApi = getTranslatorApi();
    if (!translatorApi || !targetLanguage || targetLanguage === SOURCE_LANGUAGE) {
      return Promise.resolve(null);
    }

    const options = { sourceLanguage: targetLanguage, targetLanguage: SOURCE_LANGUAGE };
    const request = (async () => {
      const availability = await withTimeout(
        translatorApi.availability(options),
        TRANSLATOR_AVAILABILITY_TIMEOUT_MS
      );
      // Remembered so the page pass can say WHY it did nothing: "unavailable"
      // means Chrome is not serving this pair at all (no click will help),
      // which is a different problem from a pack that needs one gesture.
      reverseTranslatorAvailability = String(availability || "");
      if (availability === "unavailable") {
        return null;
      }

      try {
        return await withTimeout(
          translatorApi.create(options),
          availability === "available"
            ? TRANSLATOR_CREATE_TIMEOUT_MS
            : TRANSLATOR_OPPORTUNISTIC_CREATE_TIMEOUT_MS
        );
      } catch (error) {
        // Chrome refuses the create without a user gesture while the pack is
        // "downloadable" — arm it so the next trusted click on the page
        // finishes the preparation, exactly like the forward pipeline.
        if (typeof translatorApi.armActivation === "function") {
          Promise.resolve(translatorApi.armActivation(options)).catch(() => {});
        }
        return null;
      }
    })().catch(() => null);

    reverseHoverTranslatorKey = key;
    const wrapped = request.then((translator) => {
      // A missing translator can appear later (the pack finishes installing),
      // so failures are not cached.
      if (!translator && reverseHoverTranslatorPromise === wrapped) {
        reverseHoverTranslatorPromise = null;
        reverseHoverTranslatorKey = "";
      }
      return translator;
    });
    reverseHoverTranslatorPromise = wrapped;
    return wrapped;
  }

  function getHoverWordAtPoint(x, y) {
    const position = getCaretPositionAtPoint(x, y);
    if (!position || position.node?.nodeType !== Node.TEXT_NODE || shouldIgnoreTextNode(position.node)) {
      return null;
    }

    const text = position.node.nodeValue;
    if (!text) {
      return null;
    }

    let index = Math.min(Math.max(Number(position.offset) || 0, 0), text.length - 1);
    if (!isHoverWordCharacter(text[index]) && index > 0 && isHoverWordCharacter(text[index - 1])) {
      index -= 1;
    }
    if (!isHoverWordCharacter(text[index])) {
      return null;
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
    if (!/\p{L}/u.test(word)) {
      return null;
    }

    // Caret-from-point snaps to the NEAREST text position, so a pointer in
    // empty space (margins, line ends, blank areas) still yields a word.
    // Only accept the hit when the pointer really is on the word's own box
    // and no unrelated element is layered on top of it.
    const range = document.createRange();
    range.setStart(position.node, start);
    range.setEnd(position.node, end);
    const rect = Array.from(range.getClientRects()).find(
      (candidate) =>
        x >= candidate.left - 2 &&
        x <= candidate.right + 2 &&
        y >= candidate.top - 2 &&
        y <= candidate.bottom + 2
    );
    if (!rect) {
      return null;
    }

    const hit = document.elementFromPoint(x, y);
    const parent = position.node.parentElement;
    if (!hit || !parent || !(hit === parent || hit.contains(parent) || parent.contains(hit))) {
      return null;
    }

    return { word, rect };
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

    reverseHoverTooltip = document.createElement("div");
    reverseHoverTooltip.className = REVERSE_HOVER_TOOLTIP_CLASS;
    reverseHoverTooltip.setAttribute("role", "tooltip");
    reverseHoverTooltip.dataset.visible = "false";

    const box = document.createElement("div");
    box.className = `${REVERSE_HOVER_TOOLTIP_CLASS}-box`;
    const caret = document.createElement("div");
    caret.className = `${REVERSE_HOVER_TOOLTIP_CLASS}-caret`;
    reverseHoverTooltip.append(box, caret);
    document.documentElement.appendChild(reverseHoverTooltip);
    return reverseHoverTooltip;
  }

  // Duolingo's hint popover shows at most the three best translations, one
  // per row.
  function dedupeHintRows(values) {
    const rows = [];
    const seen = new Set();

    for (const value of values) {
      const cleaned = String(value || "").replace(/\s+/gu, " ").trim();
      const key = cleaned.toLocaleLowerCase();
      if (!cleaned || seen.has(key)) {
        continue;
      }

      seen.add(key);
      rows.push(cleaned);
      if (rows.length === MAX_HOVER_HINT_ROWS) {
        break;
      }
    }

    return rows;
  }

  function splitHintMeanings(definition) {
    return cleanEnglishAlignmentText(definition)
      .replace(/^suggested meanings:\s*/iu, "")
      .split(/\s*(?:,|;|\n|\s\/\s)\s*/u)
      .map((part) => part.trim())
      .filter((part) => part && part.length <= 40);
  }

  function getHintMeaningsForTargetWord(targetWord) {
    const key = String(targetWord || "").toLocaleLowerCase();
    if (!key) {
      return [];
    }

    const meanings = [];
    for (const entry of compiledEntries) {
      if (!entry.targetCandidates.some((candidate) => candidate.toLocaleLowerCase() === key)) {
        continue;
      }

      meanings.push(String(entry.source || ""), ...splitHintMeanings(entry.definition));
    }

    return meanings;
  }

  function getHintTargetsForSourceWord(word) {
    const key = String(word || "").toLocaleLowerCase();
    if (!key) {
      return [];
    }

    const targets = [];
    for (const entry of compiledEntries) {
      if (String(entry.source || "").toLocaleLowerCase() === key) {
        targets.push(...entry.targetCandidates);
      }
    }

    return targets;
  }

  function setReverseHoverTooltipRows(rows) {
    const tooltip = ensureReverseHoverTooltip();
    tooltip.firstElementChild.replaceChildren(
      ...rows.map((value) => {
        const row = document.createElement("div");
        row.className = `${REVERSE_HOVER_TOOLTIP_CLASS}-row`;
        row.textContent = value;
        return row;
      })
    );
    return tooltip;
  }

  function showReverseHoverTooltip(rows) {
    const tooltip = setReverseHoverTooltipRows(rows);
    positionReverseHoverTooltip();
    tooltip.dataset.visible = "true";
  }

  function positionReverseHoverTooltip() {
    if (!reverseHoverTooltip?.isConnected || !reverseHoverAnchorRect) {
      return;
    }

    positionTooltipOverRect(reverseHoverAnchorRect);
  }

  function showReplacementOriginalTooltip(span) {
    const original = span.dataset.learnedWordOriginal;
    const visibleText = String(span.textContent || "").trim();

    // On target-language pages a learned word is shown exactly as the page
    // wrote it, so there is no original to reveal — answer with its English
    // side instead, like hovering an untouched target-language word.
    if (
      getCurrentLanguageCode() &&
      String(original || "").trim() === visibleText &&
      isTextAlreadyInTargetLanguage(visibleText)
    ) {
      reverseHoverAnchorRect = span.getBoundingClientRect();
      handleTargetWordHover(visibleText, getCurrentLanguageCode());
      return;
    }

    const key = `original\u0000${original}\u0000${span.dataset.learnedWordTarget || ""}`;

    if (key === reverseHoverKey) {
      positionTooltipOverSpan(span);
      return;
    }

    clearReverseHover();
    reverseHoverKey = key;
    const rows = dedupeHintRows([
      original,
      ...getHintMeaningsForTargetWord(span.dataset.learnedWordTarget)
    ]);
    const tooltip = setReverseHoverTooltipRows(rows);
    positionTooltipOverSpan(span);
    tooltip.dataset.visible = "true";
  }

  function positionTooltipOverSpan(span) {
    if (!span.isConnected) {
      return;
    }

    positionTooltipOverRect(span.getBoundingClientRect());
  }

  function positionTooltipOverRect(rect) {
    const tooltip = ensureReverseHoverTooltip();
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

  const REPLACEMENT_RANGE_KINDS = new Set([
    WORD_FAMILY_MATCH_KIND,
    BACK_TRANSLATION_MATCH_KIND,
    UNLEARNED_MATCH_KIND
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
      if (merged.some((existing) => rangesOverlap(existing, range))) {
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
    span.className = REPLACEMENT_CLASS;
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

  // While a block waits for its translation its text is hidden, so the reader
  // never reads the pre-translation wording and each block simply appears once
  // it is done. Nothing is animated and no text is rewritten: the block carries
  // an attribute that a stylesheet rule paints transparent, so there is no way
  // for a failure to corrupt the page's words. A deadline still clears the
  // attribute, so a block can never stay invisible.
  const MAX_PENDING_HIDE_MS = 8000;
  const PENDING_HIDE_ATTRIBUTE = "data-lwr-pending";
  const PENDING_HIDE_SWEEP_MS = 500;
  const hiddenPendingBlocks = new Map();
  // A block is hidden at most once per page session. Re-collection is
  // legitimate (a pass can run out of budget, a translation can come back
  // empty, the page can rewrite a block), but text the reader has already
  // watched appear must never blink out again.
  let hiddenOnceBlocks = new WeakSet();
  let pendingHideTimer = null;

  // page-cloak.js hid the page's text at document_start. It lifts itself after
  // its own timeout no matter what, so these helpers are best-effort: the page
  // is never left unreadable because content.js failed to call them.
  const CLOAK_STYLE_ID = "learned-word-replacer-cloak-style";
  const UNCLOAK_KEY = "__learnedWordReplacerUncloak";
  const HOLD_CLOAK_KEY = "__learnedWordReplacerHoldCloak";

  // "I exist" — the cloak waits on content.js turning up at document_idle,
  // which on a heavy page is seconds after it hid the text.
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
    return Boolean(state.hideTextUntilTranslated);
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
        hiddenOnceBlocks.has(block) ||
        hiddenPendingBlocks.has(block)
      ) {
        continue;
      }

      hiddenOnceBlocks.add(block);
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

  async function processContextRoot(root, runId, options = {}) {
    const targetLanguage = getCurrentLanguageCode();
    const collectedUnits = options.roots
      ? collectContextUnitsFromRoots(options.roots)
      : collectContextUnits(root);
    updateRuntimeStats({
      targetLanguage,
      unitsCollected: collectedUnits.length
    });

    if (!collectedUnits.length) {
      return;
    }

    // Hiding text is strictly a first-paint concern. While the page is still
    // cloaked the reader has seen nothing yet, so this pass's blocks take over
    // the hide individually and the page is handed back — the untranslated
    // wording is never on screen. Once the reader has the page, later passes
    // (scrolling into new text) must never blank anything out: text vanishing
    // from under someone who is reading is worse than watching it swap.
    if (isPageCloaked()) {
      beginPendingHide(collectedUnits);
      uncloakPage();
    }

    const units = collectedUnits.filter((unit) => !unit.reverse);
    const reverseUnits = collectedUnits.filter((unit) => unit.reverse);

    if (units.length) {
      await processForwardUnits(units, targetLanguage, runId, options);
    }

    if (reverseUnits.length && runId === applyRunId) {
      await processReverseUnits(reverseUnits, targetLanguage, runId);
    }
  }

  async function processForwardUnits(units, targetLanguage, runId, options = {}) {
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
        // Everything below reads or rewrites this block's text, so it has to
        // stop churning first.
        endPendingHide(unit);
        updateRuntimeStats({ unitsProcessed: runtimeStats.unitsProcessed + 1 });

        const translatedText = translatedTexts[index];
        if (!translatedText) {
          // Nothing usable came back for this block. Remember it anyway: an
          // unrecorded block is collected again by every later pass, which on
          // a long page means the same untouched text churns on every scroll.
          recordProcessedUnit(unit);
          markCheckedBlock(unit.block);
          continue;
        }

        if (
          (state.fullTranslation || state.structureMode) &&
          isSafeToRestructureBlock(unit.block, unit.text)
        ) {
          const structured = await applyStructuredUnit(unit, translatedText, targetLanguage, runId);
          if (structured === STRUCTURED_UNIT_HALTED) {
            halted = true;
            return;
          }

          if (structured === STRUCTURED_UNIT_APPLIED) {
            recordProcessedUnit(unit);
            markCheckedBlock(unit.block);
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

        applyNodeReplacements(replacementsByNode);
        recordProcessedUnit(unit);
        markCheckedBlock(unit.block);

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

  // The mirror of the English→target pass, for pages that are already written
  // in the target language. The page's own sentence stays as the frame — no
  // machine-written target text is ever painted in — and every word the
  // learner has not studied is swapped to its aligned English, so the target
  // language's structure can be read directly with broken English as the
  // scaffold instead of the other way round.
  async function processReverseUnits(units, targetLanguage, runId) {
    const translator = await getReverseTranslator(targetLanguage);

    if (runId !== applyRunId) {
      return;
    }

    if (!translator) {
      // Say WHY nothing happened. "unavailable" is Chrome refusing the pair
      // outright — usually its on-device translator service needs a browser
      // restart — and no amount of clicking will change that. Anything else
      // armed the next trusted click, which refreshes the page.
      const unavailable = reverseTranslatorAvailability === "unavailable";
      updateRuntimeStats({
        unitsSkipped: runtimeStats.unitsSkipped + units.length,
        status: runtimeStats.replacementCount
          ? runtimeStats.status
          : unavailable
            ? "translator-unavailable"
            : "translator-not-ready",
        lastError: unavailable
          ? `Chrome Translator is not available for ${targetLanguage} to English. Restarting Chrome usually restores it.`
          : `Chrome needs one click on this page to prepare Translator for ${targetLanguage} to English.`
      });
      return;
    }

    const replacementsByNode = new Map();
    updateRuntimeStats({
      status: "translating",
      targetLanguage
    });

    let nextUnitIndex = 0;
    let halted = false;

    const processTranslatedUnits = async (englishTexts, limit) => {
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
        // Everything below reads or rewrites this block's text, so it has to
        // stop churning first.
        endPendingHide(unit);
        updateRuntimeStats({ unitsProcessed: runtimeStats.unitsProcessed + 1 });

        const englishText = englishTexts[index];
        if (!englishText) {
          recordProcessedUnit(unit);
          markCheckedBlock(unit.block);
          continue;
        }

        const completed = await addReverseRangesFromTranslation(
          unit,
          englishText,
          replacementsByNode,
          targetLanguage,
          runId
        );
        if (!completed) {
          halted = true;
          return;
        }

        applyNodeReplacements(replacementsByNode);
        recordProcessedUnit(unit);
        markCheckedBlock(unit.block);

        if (index % 4 === 3) {
          await yieldToBrowser();
        }
      }
    };

    // The cache is namespaced by the language the text is translated INTO, so
    // English keys can never collide with the forward direction's target-language
    // ones for the same string.
    const englishTexts = await translateContextTexts(
      translator,
      SOURCE_LANGUAGE,
      units.map((unit) => unit.text),
      { onBatchTranslated: processTranslatedUnits }
    );

    await processTranslatedUnits(englishTexts, units.length);
  }

  async function addReverseRangesFromTranslation(
    unit,
    englishText,
    replacementsByNode,
    targetLanguage,
    runId
  ) {
    const englishSentences = splitTranslatedSentences(englishText);
    // Punctuation can change during translation; without a 1:1 sentence match
    // the whole unit is aligned as a single pair rather than risking English
    // from one sentence landing in another.
    const pairs =
      englishSentences.length === unit.sentenceRanges.length
        ? unit.sentenceRanges.map((range, index) => ({
            range,
            english: englishSentences[index]
          }))
        : [{ range: { start: 0, end: unit.text.length }, english: englishText }];

    for (const pair of pairs) {
      const targetSentence = unit.text.slice(pair.range.start, pair.range.end);
      if (!targetSentence.trim() || !String(pair.english || "").trim()) {
        continue;
      }

      const whitelistMatches = await findWhitelistMatchesInText(
        targetSentence,
        targetLanguage,
        pair.english
      );
      const alignmentPairs = await requestWordAlignment(pair.english, targetSentence);
      if (runId !== applyRunId) {
        return false;
      }

      const ranges = buildReverseReplacementRanges(
        targetSentence,
        pair.english,
        whitelistMatches,
        alignmentPairs
      );
      if (ranges.length) {
        addConfirmedSentenceReplacements(unit, pair.range, ranges, replacementsByNode);
      }
    }

    return true;
  }

  // Ranges over the page's own target-language sentence: learned words keep
  // their text (wrapped so they stay highlighted and hoverable), and every
  // other aligned word is replaced by its English. Words the aligner could not
  // resolve are left untouched — hovering them still answers with English.
  function buildReverseReplacementRanges(
    targetSentence,
    englishSentence,
    whitelistMatches,
    alignmentPairs
  ) {
    const knownRanges = getMergedKnownRanges(whitelistMatches);
    const strongPairs = alignmentPairs.filter((pair) => !pair.weak);
    const usedEnglishSpans = createUsedEnglishSpans();
    const ranges = [];

    for (const token of getReplaceableSourceTokens(targetSentence)) {
      const known = knownRanges.find(
        (range) => range.start <= token.start && token.start < range.end
      );
      if (known) {
        // The learned word is left standing in the target language, and the
        // reader already reads its English off it. Claim that English so the
        // next word cannot say it a second time.
        claimEnglishForKnownRange(strongPairs, englishSentence, known, usedEnglishSpans);
        ranges.push({
          start: known.start,
          end: known.end,
          target: targetSentence.slice(known.start, known.end),
          kind: known.kind
        });
        continue;
      }

      const english = collectAlignedEnglish(
        strongPairs,
        englishSentence,
        token.start,
        token.end,
        usedEnglishSpans
      );
      if (!english) {
        continue;
      }

      ranges.push({
        start: token.start,
        end: token.end,
        target: adaptEnglishScaffoldCase(english, token.value, englishSentence),
        kind: BACK_TRANSLATION_MATCH_KIND
      });
    }

    return mergeReplacementRanges(ranges);
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
          // Scaffold words (the English painted into target-language pages) are
          // not learned-word replacements, and countExistingReplacements skips
          // them too, so the two counts stay in step across passes.
          replacementCount:
            runtimeStats.replacementCount +
            replacementParts.filter(
              (part) =>
                part.kind !== BACK_TRANSLATION_MATCH_KIND && part.kind !== UNLEARNED_MATCH_KIND
            ).length,
          wordFamilyReplacementCount:
            runtimeStats.wordFamilyReplacementCount +
            replacementParts.filter((part) => part.kind === WORD_FAMILY_MATCH_KIND).length
        });
        replaceTextNodeWithParts(node, parts);
      }
    }

    replacementsByNode.clear();
  }

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
      processedBlockSourceTexts.set(block, getBlockSourceText(block));
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
      block.classList.remove(PROCESSED_BLOCK_CLASS);
      return;
    }

    block.classList.add(PROCESSED_BLOCK_CLASS);
  }

  // What counts is whether the reader can SEE that the block was touched.
  // Back-translation scaffold — the English left standing in the target
  // language's word order — is deliberately drawn without an underline, so a
  // block holding nothing else (a rebuilt heading such as "Union Uzhhorod")
  // looks exactly like untouched page text and still needs the fox.
  function blockShowsReplacementMarks(block) {
    if (!state.showHighlights) {
      return false;
    }

    const scaffoldSelector = `[data-learned-word-match-kind="${BACK_TRANSLATION_MATCH_KIND}"]`;
    if (block.classList.contains(REPLACEMENT_CLASS)) {
      return block.dataset.learnedWordMatchKind !== BACK_TRANSLATION_MATCH_KIND;
    }

    return Boolean(block.querySelector(`.${REPLACEMENT_CLASS}:not(${scaffoldSelector})`));
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
      if (element.classList.contains(REPLACEMENT_CLASS)) {
        continue;
      }

      // Replaced and interactive content cannot survive a rebuild, and a nested
      // block is a unit in its own right.
      if (
        STRUCTURE_UNSAFE_TAGS.has(element.tagName.toUpperCase()) ||
        element.matches(NATURAL_BLOCK_SELECTOR)
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
    const keepTargetLanguage = Boolean(state.fullTranslation);
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
    const translatedSentences = splitTranslatedSentences(normalizedTranslation);
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

      const matches = await findWhitelistMatchesInText(pair.translated, targetLanguage, pair.source);
      const alignmentPairs = await requestWordAlignment(pair.source, pair.translated);
      if (runId !== applyRunId) {
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
      inline.className = INLINE_STRUCTURED_CLASS;
      inline.dataset.lwrOriginalText = soleTextNode.nodeValue;
      inline.appendChild(createReplacementFragment(parts));
      soleTextNode.replaceWith(inline);
      block.classList.add(STRUCTURED_BLOCK_CLASS);
    } else {
      // Build first: capturing the original moves the block's children out, and
      // the rebuild reads them — the icons it carries across, and the elements
      // it rebuilds the words under.
      const rebuilt = createReplacementFragment(parts, block);
      captureStructuredBlockOriginal(block, unit.text);
      block.replaceChildren(rebuilt);
      block.classList.add(STRUCTURED_BLOCK_CLASS);
    }
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
      if (part.type !== "text" && part.kind !== UNLEARNED_MATCH_KIND) {
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

    const lemmasByWord = await getUkrainianLemmas(scaffoldWords);
    const unknown = scaffoldWords.filter(
      (word) => (lemmasByWord.get(normalizeUkrainianMorphologyWord(word)) || []).length === 0
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
    for (const node of collectTextNodes(block)) {
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
    const tokens = getReplaceableSourceTokens(translatedSentence);
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
          !isReplaceableNeuralSourceSpan(value) ||
          value.length < 3 ||
          ALIGNMENT_COMMON_WORDS.has(value.toLocaleLowerCase())
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
        const value = `${item.genitivePrefix || ""}${adaptEnglishScaffoldCase(
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
          kind: BACK_TRANSLATION_MATCH_KIND,
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
          kind: UNLEARNED_MATCH_KIND,
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
      if (!merged.some((existing) => rangesOverlap(existing, range))) {
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
      if (!isReplaceableNeuralSourceSpan(value)) {
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
    const targetLanguage = getCurrentLanguageCode();
    const isForward =
      message?.sourceLanguage === SOURCE_LANGUAGE && message?.targetLanguage === targetLanguage;
    // Target-language pages arm the opposite direction, and its activation has
    // to refresh the page just the same.
    const isReverse =
      message?.sourceLanguage === targetLanguage && message?.targetLanguage === SOURCE_LANGUAGE;
    if (
      !message ||
      message.source !== MESSAGE_SOURCE ||
      message.channel !== TRANSLATOR_BRIDGE_ACTIVATION_CHANNEL ||
      !targetLanguage ||
      (!isForward && !isReverse)
    ) {
      return;
    }

    if (getTranslationExclusion()) {
      return;
    }

    const direction = isReverse
      ? `${message.sourceLanguage} to English`
      : `English to ${message.targetLanguage}`;

    if (message.progress) {
      updateRuntimeStats({
        status: "translator-preparing",
        translatorDownloadProgress: Number(message.loaded || 0),
        lastError: `Chrome is preparing Translator for ${direction}.`
      });
      return;
    }

    if (!message.ok) {
      updateRuntimeStats({
        status: "translator-not-ready",
        lastError:
          message.error?.message || `Chrome still needs page activation for ${direction}.`
      });
      return;
    }

    if (isReverse) {
      // A failed reverse create is never cached, so the refreshed pass picks
      // the now-ready translator up on its own.
      reverseHoverTranslatorPromise = null;
      reverseHoverTranslatorKey = "";
      applyToPage({ preserveExisting: true }).catch((error) => {
        updateRuntimeStats({
          status: "translator-error",
          lastError: error && error.message ? error.message : "Translator activation refresh failed."
        });
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
      return isTextNodeInIgnoredSubtree(root) ? [] : [root];
    }

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return isTextNodeInIgnoredSubtree(node)
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
        restoreChangedProcessedBlocks(root);
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
        createContextUnitsForNodes(nodes, block).map((unit) => ({
          ...unit,
          collectionOrder: collectionOrder++
        }))
      )
      // Blocks already written in the target language are kept, but marked for
      // the mirrored target→English pass instead of the English→target one.
      .map((unit) =>
        isTextAlreadyInTargetLanguage(unit.text) ? { ...unit, reverse: true } : unit
      )
      // Full translation is the opposite instruction to the reverse pass — the
      // whole page belongs in the target language — so it wins and no English
      // is swapped back in, on pages the extension translated or pages that
      // arrived in the target language already.
      .filter((unit) => !unit.reverse || (state.targetLanguagePages && !state.fullTranslation))
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
        if (!isTextNodeInIgnoredSubtree(node)) {
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
    const alignmentPairs = (await requestWordAlignment(sourceSentence, translatedText)).filter(
      (pair) => !pair.weak
    );

    if (runId !== applyRunId) {
      return [];
    }

    const credibleMatches = rejectMatchesContradictedByAlignment(
      sourceSentence,
      indexedMatches,
      alignmentPairs
    );
    const confidence = getConfidenceAlignedSentenceReplacements(
      sourceSentence,
      credibleMatches,
      alignmentOptions
    );
    let replacements = confidence.replacements;
    let unresolvedMatches = credibleMatches.filter(
      (match) => !confidence.resolvedMatchIds.has(match.alignmentId)
    );

    if (unresolvedMatches.length) {
      const neural = getNeuralAlignedSentenceReplacements(
        sourceSentence,
        alignmentPairs,
        unresolvedMatches,
        replacements
      );

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

  function getNeuralAlignedSentenceReplacements(
    sourceSentence,
    pairs,
    whitelistMatches,
    existingReplacements
  ) {
    const resolvedMatchIds = new Set();
    const replacements = [];

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

  // An entry's English hint appearing somewhere in the sentence is not proof
  // that the target word found in the translation is that hint's counterpart.
  // "Крім того" means "Additionally", but the lemma matcher sees "того" as a
  // form of "той" (that), and the sentence happened to contain "that" further
  // along — so "that" was overwritten with a word that, here, means nothing of
  // the sort. The aligner already knows "того" came from "Additionally", so when
  // it has a firm opinion and the hint disagrees with it, the hint is a
  // coincidence and the word is not being used in the sense the learner knows.
  //
  // Dropping the match is deliberate: placing it where the aligner points would
  // teach "того" = "Additionally", which is just as wrong. A missed highlight
  // costs the learner far less than a confidently wrong one.
  function rejectMatchesContradictedByAlignment(sourceSentence, matches, pairs) {
    if (!pairs.length) {
      return matches;
    }

    return matches.filter((match) => {
      // No hint in this sentence means there is nothing to contradict; those
      // matches are exactly what the neural pass exists to place.
      const hintCandidates = findSourceAlignmentCandidates(sourceSentence, match.entry);
      if (!hintCandidates.length) {
        return true;
      }

      const matchStart = match.index;
      const matchEnd = match.index + match.target.length;
      const alignedPairs = pairs.filter(
        (pair) =>
          pair.tgtStart < matchEnd &&
          matchStart < pair.tgtEnd &&
          isReplaceableNeuralSourceSpan(sourceSentence.slice(pair.srcStart, pair.srcEnd))
      );
      if (!alignedPairs.length) {
        return true;
      }

      const agrees = alignedPairs.some((pair) =>
        hintCandidates.some((candidate) =>
          rangesOverlap(
            { start: candidate.start, end: candidate.end },
            { start: pair.srcStart, end: pair.srcEnd }
          )
        )
      );

      if (!agrees) {
        debugLog("align-contradiction", {
          target: match.target,
          hints: hintCandidates.map((candidate) => candidate.value),
          aligned: alignedPairs.map((pair) => sourceSentence.slice(pair.srcStart, pair.srcEnd))
        });
      }

      return agrees;
    });
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
        if (passesEnglishBoundaryCheck(sourceSentence, index, variant.length)) {
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

  // Scaffold English takes its case from the Ukrainian word it stands in for,
  // which is right for a capital the sentence merely forced, and wrong for one
  // the word carries itself. English capitalises "I" wherever it stands, and
  // capitalises languages, months and weekdays where Ukrainian does not, so
  // matching a lowercase Ukrainian token produced "i'm", "monday", "ukrainian".
  // A word already seen mid-sentence in the source never got its capital from
  // position, so its capital is its own.
  const ALWAYS_CAPITAL_ENGLISH = /^I(['’ʼ](m|ve|ll|d))?$/u;

  function hasIntrinsicEnglishCapital(english, sourceSentence) {
    const firstWord = String(english || "").split(/\s+/u)[0] || "";

    if (ALWAYS_CAPITAL_ENGLISH.test(firstWord)) {
      return true;
    }

    if (!/^\p{Lu}/u.test(firstWord)) {
      return false;
    }

    return String(sourceSentence || "").indexOf(english) > 0;
  }

  function adaptEnglishScaffoldCase(english, targetToken, sourceSentence) {
    if (hasIntrinsicEnglishCapital(english, sourceSentence)) {
      return english;
    }

    return adaptTargetCaseToSource(english, targetToken);
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

        // An apostrophe between two letters is word-internal in every language
        // here: English contractions ("don't"), French elision ("l'homme") and
        // Ukrainian's hard separator ("православ'я") are all single words.
        if (isWordInternalApostrophe(text, index) || isCyrillicCompoundHyphen(text, index)) {
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
    // Both matchers read the same sentence, so it is tokenized once and they
    // share the result. Everything below works on whole tokens: an entry can
    // only ever claim complete words, never a slice of one.
    const tokenIndex = buildSentenceTokenIndex(translatedText);
    const exactMatches = compiledEntries.flatMap((entry) =>
      findTargetCandidateMatches(tokenIndex, entry).map((match) => ({
        ...match,
        entry
      }))
    );
    const wordFamilyMatches =
      targetLanguage === "uk" ? await findUkrainianWordFamilyMatchesInText(tokenIndex) : [];

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

  function findTargetCandidateMatches(tokenIndex, entry) {
    return entry.targetCandidates
      .flatMap((candidate) => findTargetCandidateTokenMatches(tokenIndex, candidate))
      .sort((a, b) => a.index - b.index || b.target.length - a.target.length);
  }

  async function findUkrainianWordFamilyMatchesInText(tokenIndex) {
    const translatedTokens = tokenIndex.tokens;
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

  // Splitting the sentence into words first, then matching whole words, is what
  // makes it structurally impossible for an entry to claim part of a word. The
  // old approach searched the raw string and asked afterwards whether the hit
  // happened to land on a boundary, so every punctuation mark the boundary rule
  // did not know about ("православ'я", "будь-яку") became a fresh bug.
  function buildSentenceTokenIndex(text) {
    const tokens = getReplaceableSourceTokens(text);
    const positionsByValue = new Map();

    tokens.forEach((token, position) => {
      const key = token.value.toLocaleLowerCase();
      const positions = positionsByValue.get(key);

      if (positions) {
        positions.push(position);
      } else {
        positionsByValue.set(key, [position]);
      }
    });

    return { text, tokens, positionsByValue };
  }

  function findTargetCandidateTokenMatches(tokenIndex, candidate) {
    const candidateTokens = getCandidateTokenValues(candidate);
    if (!candidateTokens.length) {
      return [];
    }

    const matches = [];

    for (const position of tokenIndex.positionsByValue.get(candidateTokens[0]) || []) {
      const last = position + candidateTokens.length - 1;
      if (last >= tokenIndex.tokens.length) {
        continue;
      }

      // Multi-word entries match a run of adjacent tokens. Only non-word
      // characters can sit between adjacent tokens, so nothing of substance is
      // being skipped over.
      const runMatches = candidateTokens.every(
        (value, offset) =>
          tokenIndex.tokens[position + offset].value.toLocaleLowerCase() === value
      );
      if (!runMatches) {
        continue;
      }

      const start = tokenIndex.tokens[position].start;
      const end = tokenIndex.tokens[last].end;
      matches.push({
        index: start,
        target: tokenIndex.text.slice(start, end),
        kind: "exact"
      });
    }

    return matches;
  }

  function getCandidateTokenValues(candidate) {
    const key = String(candidate || "");
    const cached = candidateTokenValueCache.get(key);
    if (cached) {
      return cached;
    }

    const values = getReplaceableSourceTokens(key).map((token) =>
      token.value.toLocaleLowerCase()
    );
    candidateTokenValueCache.set(key, values);

    return values;
  }

  // Only the English source sentence is matched this way, and only to decide
  // whether an entry's English hint is present at all — nothing here reaches the
  // page. Substring semantics are wanted: "Orthodoxy" inside "Orthodoxy's" is
  // good alignment evidence. Target-language matching goes through the tokenizer
  // instead (buildSentenceTokenIndex), where partial words cannot occur.
  function passesEnglishBoundaryCheck(text, start, length) {
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

    // Words rewritten in place put back the text node they replaced, leaving
    // everything around them exactly as the page built it.
    const inlineRuns =
      root.nodeType === Node.ELEMENT_NODE && root.classList.contains(INLINE_STRUCTURED_CLASS)
        ? [root]
        : Array.from(root.querySelectorAll?.(`.${INLINE_STRUCTURED_CLASS}`) || []);

    for (const run of inlineRuns) {
      const parent = run.parentNode;
      run.replaceWith(document.createTextNode(run.dataset.lwrOriginalText || run.textContent));
      parent?.normalize();
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
      // Resolve from the parent: a replacement span is itself in
      // IGNORED_SELECTOR (its text must never be re-collected), so asking for
      // the span's own block always answered null and this whole function
      // quietly restored nothing.
      const block = getElementTextBlock(replacement.parentElement);
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
    const recheck = () => {
      if (hasActivePageReplacementFeatures() && !getTranslationExclusion()) {
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

    const pending = collectPendingContextBlocks(document.body);
    // Blocks nothing has touched yet.
    const fresh = pending.filter((block) => !hasExistingReplacements(block));
    // Blocks whose text moved on since they were processed. The observer is
    // disconnected while a pass runs, so a page that rewrites itself mid-pass
    // has no other way back in — catching them here is what keeps a mutation
    // during a pass from being lost.
    const changed = pending.filter(
      (block) => hasExistingReplacements(block) && !isProcessedBlockUnchanged(block)
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

    const runId = ++applyRunId;
    applying = true;
    stopObserver();
    // A superseded pass can leave blocks hidden; show those again before this
    // one starts, so nothing is left invisible between passes.
    endAllPendingHides();

    try {
      const exclusion = getTranslationExclusion();
      if (exclusion) {
        pendingContextBlocks.clear();
        processedBlockSourceTexts = new WeakMap();
        // A full restore puts the original text back, so those blocks are
        // allowed to churn again when they are re-read.
        hiddenOnceBlocks = new WeakSet();
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
        // A full restore puts the original text back, so those blocks are
        // allowed to churn again when they are re-read.
        hiddenOnceBlocks = new WeakSet();
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
      endAllPendingHides();
      // Whatever happened — excluded page, no translator, a thrown error — the
      // page must not stay hidden.
      uncloakPage();
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
        const blocked = blockedStatuses.has(runtimeStats.status);
        updateRuntimeStats({
          status: blocked ? runtimeStats.status : "complete",
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
        if (!blocked && runtimeStats.unitsProcessed > 0) {
          scheduleApplyIfPendingContext();
        }
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

  // Duolingo ships a dark theme, and every input row the extension adds sits
  // straight on the page's own background, so a hard-coded white box glares.
  // There is no theme flag worth reading — Duolingo repaints through CSS
  // custom properties — so the page's rendered background colour is the
  // signal, which also keeps this working if their markup moves again.
  const DUOLINGO_THEME_STYLE_ID = "learned-word-replacer-duolingo-theme";
  // Colours are all rgb() strings: several guarded writes below compare a
  // value against style.background, and only rgb() round-trips through the
  // shorthand unchanged (#ffffff reads back as "rgb(255, 255, 255)").
  const DUOLINGO_THEMES = {
    light: {
      inputBackground: "rgb(255, 255, 255)",
      inputSunkenBackground: "rgb(247, 247, 247)",
      inputText: "rgb(60, 60, 60)",
      inputPlaceholder: "rgb(175, 175, 175)",
      inputBorder: "rgb(229, 229, 229)",
      inputBorderFocus: "rgb(28, 176, 246)",
      inputBorderError: "rgb(234, 43, 43)",
      icon: "rgb(175, 175, 175)",
      badgeBackground: "rgb(60, 60, 60)",
      badgeErrorBackground: "rgb(234, 43, 43)",
      badgeText: "rgb(255, 255, 255)",
      surface: "rgb(255, 255, 255)",
      surfaceBorder: "rgb(229, 229, 229)",
      surfaceText: "rgb(60, 60, 60)",
      surfaceMutedText: "rgb(120, 120, 120)",
      correctBanner: "rgb(215, 255, 184)",
      wrongBanner: "rgb(255, 223, 224)",
      correctText: "rgb(88, 167, 0)",
      wrongText: "rgb(234, 43, 43)"
    },
    dark: {
      // Duolingo's own dark tokens: page #131f24, raised card #202f36,
      // hairline #37464f, body text #f1f7fb, muted #8b9fa8. The blue focus
      // ring and the timer colours already read on both, so they carry over.
      inputBackground: "rgb(32, 47, 54)",
      inputSunkenBackground: "rgb(19, 31, 36)",
      inputText: "rgb(241, 247, 251)",
      inputPlaceholder: "rgb(139, 159, 168)",
      inputBorder: "rgb(55, 70, 79)",
      inputBorderFocus: "rgb(28, 176, 246)",
      inputBorderError: "rgb(255, 75, 75)",
      icon: "rgb(139, 159, 168)",
      badgeBackground: "rgb(55, 70, 79)",
      badgeErrorBackground: "rgb(255, 75, 75)",
      badgeText: "rgb(241, 247, 251)",
      surface: "rgb(19, 31, 36)",
      surfaceBorder: "rgb(55, 70, 79)",
      surfaceText: "rgb(241, 247, 251)",
      surfaceMutedText: "rgb(139, 159, 168)",
      correctBanner: "rgb(32, 52, 26)",
      wrongBanner: "rgb(60, 30, 34)",
      correctText: "rgb(88, 204, 2)",
      wrongText: "rgb(255, 75, 75)"
    }
  };

  let duolingoThemeName = null;
  let duolingoThemeWatching = false;

  function parseDuolingoThemeColor(value) {
    const match = /^rgba?\(([^)]+)\)$/i.exec(String(value || "").trim());
    if (!match) {
      return null;
    }
    const parts = match[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some((part) => !Number.isFinite(part))) {
      return null;
    }
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }

  function detectDuolingoThemeName() {
    // Whatever actually paints behind the UI decides which palette reads on
    // it: walk out from <body> and take the first ancestor that is not
    // see-through.
    let node = document.body;
    while (node) {
      const color = parseDuolingoThemeColor(getComputedStyle(node).backgroundColor);
      if (color && color.a > 0) {
        // Rec. 601 luma, which is plenty to split "light page" from "dark".
        return (color.r * 299 + color.g * 587 + color.b * 114) / 1000 < 128 ? "dark" : "light";
      }
      node = node.parentElement;
    }
    // A page that paints nothing shows the browser's default surface.
    return globalThis.matchMedia && globalThis.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }

  function duolingoTheme() {
    if (!duolingoThemeName) {
      duolingoThemeName = detectDuolingoThemeName();
    }
    return DUOLINGO_THEMES[duolingoThemeName];
  }

  function refreshDuolingoTheme() {
    const next = detectDuolingoThemeName();
    if (next === duolingoThemeName) {
      return false;
    }
    duolingoThemeName = next;
    applyDuolingoTheme();
    return true;
  }

  function watchDuolingoTheme() {
    if (duolingoThemeWatching || globalThis !== globalThis.top || !isDuolingoHost()) {
      return;
    }
    duolingoThemeWatching = true;
    duolingoThemeName = detectDuolingoThemeName();

    // Duolingo's own toggle swaps a class or attribute on <html>/<body>; the
    // media query covers the system theme changing underneath a page left on
    // "automatic". A theme flip that shows up neither way still lands on the
    // next challenge, because a rebuilt input row re-detects.
    const retheme = () => refreshDuolingoTheme();
    for (const node of [document.documentElement, document.body]) {
      if (node) {
        new MutationObserver(retheme).observe(node, {
          attributes: true,
          attributeFilter: ["class", "style", "data-theme"]
        });
      }
    }
    globalThis.matchMedia?.("(prefers-color-scheme: dark)")?.addEventListener?.("change", retheme);
  }

  function ensureDuolingoThemeStyle() {
    const theme = duolingoTheme();
    let style = document.getElementById(DUOLINGO_THEME_STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = DUOLINGO_THEME_STYLE_ID;
      (document.head || document.documentElement).append(style);
    }
    // ::placeholder is the one rule with no inline-style equivalent, so it is
    // the only reason the extension needs a stylesheet at all.
    const css = `[data-lwr-input]::placeholder{color:${theme.inputPlaceholder};opacity:1}`;
    // Guarded write: this can run from the MutationObserver.
    if (style.textContent !== css) {
      style.textContent = css;
    }
  }

  // Repaint every themed surface that is currently on screen. Each write is
  // guarded by a data-lwr-theme stamp so a repaint driven by the
  // MutationObserver cannot feed itself.
  function applyDuolingoTheme() {
    ensureDuolingoThemeStyle();
    applyDuolingoTypeInputTheme();
    applyDuolingoPanelInputTheme();
    applyFlashcardOverlayTheme();
  }

  function applyDuolingoPanelInputTheme() {
    const theme = duolingoTheme();
    document.querySelectorAll("[data-lwr-panel-input]").forEach((input) => {
      if (input.getAttribute("data-lwr-theme") === duolingoThemeName) {
        return;
      }
      input.setAttribute("data-lwr-theme", duolingoThemeName);
      input.style.borderColor = theme.inputBorder;
      input.style.background = theme.inputBackground;
      input.style.color = theme.inputText;
    });
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
  // The hint ladder, one rung per Tab press: the word's shape behind a
  // sharpening blur first, then a letter at a time. Shape rungs cue recall —
  // length, word count, letter runs — without spelling anything out, which is
  // the part a prefix reveal never reaches.
  const DUOLINGO_HINT_SHAPE_BLURS = [10, 6, 3.5];
  const DUOLINGO_HINT_SHAPE_MAX_WORDS = 3;
  let duolingoTypeHintTimer = null;
  // The rung is tied to the typed buffer, not to the badge's fade timer —
  // pausing to think should not silently change what the next Tab does.
  let duolingoTypeHintDepth = 0;
  let duolingoTypeHintPrefix = null;
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
          resetDuolingoTypeHintDepth();
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

  const DUOLINGO_COPY_BUTTON_ID = "learned-word-replacer-duolingo-copy-button";
  // Lucide "copy" and "check" (ISC license), inlined for the same reason as
  // the icons above.
  const DUOLINGO_COPY_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
  const DUOLINGO_COPY_DONE_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  // The answer side of a challenge. The prompt is never inside it, and a
  // container that holds any of it is too wide to be the prompt.
  const DUOLINGO_ANSWER_SELECTOR = [
    "[data-test='word-bank']",
    "[data-test$='challenge-tap-token']",
    "[data-test='challenge-choice']",
    "[data-test='challenge-judge-text']",
    "[data-test='player-footer']",
    "[data-test~='blame']",
    "input",
    "textarea"
  ].join(",");
  const DUOLINGO_COPY_BUTTON_STYLE = [
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "vertical-align: middle",
    "width: 28px",
    "height: 28px",
    "margin: 0 0 0 8px",
    "padding: 0",
    "border: none",
    "border-radius: 8px",
    "background: none",
    "color: rgb(175, 175, 175)",
    "cursor: pointer"
  ].join(";");
  let duolingoCopyObserver = null;
  let duolingoCopyClickListener = null;
  let duolingoCopyResetTimer = null;

  function syncDuolingoCopyPhrase() {
    const shouldRun =
      globalThis === globalThis.top && isDuolingoHost() && Boolean(state.duolingoCopyPhrase);

    if (shouldRun && !duolingoCopyObserver) {
      duolingoCopyObserver = new MutationObserver(() => {
        ensureDuolingoCopyButton();
      });
      duolingoCopyObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      // Document capture, not an element listener: Duolingo's slide
      // transitions swap in cloneNode copies of the challenge subtree, and
      // clones silently drop element listeners.
      duolingoCopyClickListener = (event) => {
        const button =
          event.target && event.target.closest
            ? event.target.closest(`[id='${DUOLINGO_COPY_BUTTON_ID}']`)
            : null;
        if (!button) {
          return;
        }
        // The button sits among the prompt's hint tokens, so without this the
        // same click also opens Duolingo's hint popover.
        event.preventDefault();
        event.stopPropagation();
        copyDuolingoPrompt();
      };
      document.addEventListener("click", duolingoCopyClickListener, true);
      ensureDuolingoCopyButton();
    } else if (!shouldRun && duolingoCopyObserver) {
      duolingoCopyObserver.disconnect();
      duolingoCopyObserver = null;
      document.removeEventListener("click", duolingoCopyClickListener, true);
      duolingoCopyClickListener = null;
      removeDuolingoCopyButton();
    }
  }

  function getDuolingoPromptElement() {
    const challenge = getVisibleDuolingoChallenge("challenge");
    if (!challenge) {
      return null;
    }

    // Class names here are hashed and change with every Duolingo build, so
    // navigate by shape instead: the prompt is what declares a language (or
    // carries Duolingo's own hint-sentence hook) and holds none of the
    // answer-side DOM.
    const candidates = [...challenge.querySelectorAll("[data-test='hint-sentence'],[lang]")].filter(
      (candidate) =>
        candidate.offsetParent !== null &&
        !candidate.closest(DUOLINGO_ANSWER_SELECTOR) &&
        !candidate.querySelector(DUOLINGO_ANSWER_SELECTOR) &&
        readDuolingoPromptText(candidate)
    );
    if (!candidates.length) {
      return null;
    }

    // Gap-fill challenges tag one span per word instead of the sentence, so
    // the first candidate is a single word. Climb to the smallest element
    // holding every candidate that still keeps clear of the answer side.
    let prompt = candidates[0];
    while (!candidates.every((candidate) => prompt.contains(candidate))) {
      const parent = prompt.parentElement;
      if (!parent || parent === challenge || parent.querySelector(DUOLINGO_ANSWER_SELECTOR)) {
        break;
      }
      prompt = parent;
    }

    return prompt;
  }

  const DUOLINGO_PROMPT_BLANK = "___";
  // Empty boxes inside a prompt that are decoration rather than a gap: the
  // hint underline Duolingo lays over each hinted word, and the audio button
  // that sits in the prompt bubble.
  const DUOLINGO_PROMPT_DECORATION_SELECTOR = "[data-test='hint-token'],button,svg,canvas,img";

  function readDuolingoPromptText(element) {
    if (!element) {
      return "";
    }

    return collectDuolingoPromptText(element)
      .replace(/\s+/gu, " ")
      .replace(/\s+([,.!?;:…])/gu, "$1")
      .trim();
  }

  function collectDuolingoPromptText(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue || "";
    }

    if (node.nodeType !== Node.ELEMENT_NODE || node.id === DUOLINGO_COPY_BUTTON_ID) {
      return "";
    }

    // Text nodes, not innerText: Duolingo splits every hinted word into
    // per-letter spans with positioned overlays between them, and innerText
    // reads spaces into those gaps ("старі , але"). No text at all, not
    // blank-after-trimming: the spans holding the single spaces between words
    // are boxes with a width too.
    if (!String(node.textContent || "").length) {
      // An empty box that still takes up space is the blank of a gap-fill
      // sentence, and the blank is the part the exercise is about, so it is
      // worth carrying into the clipboard.
      const isBlank =
        !node.matches(DUOLINGO_PROMPT_DECORATION_SELECTOR) &&
        !node.querySelector(DUOLINGO_PROMPT_DECORATION_SELECTOR) &&
        node.getBoundingClientRect().width > 0;
      return isBlank ? ` ${DUOLINGO_PROMPT_BLANK} ` : "";
    }

    let text = "";
    node.childNodes.forEach((child) => {
      text += collectDuolingoPromptText(child);
    });
    return text;
  }

  function removeDuolingoCopyButton() {
    if (duolingoCopyResetTimer) {
      clearTimeout(duolingoCopyResetTimer);
      duolingoCopyResetTimer = null;
    }

    document
      .querySelectorAll(`[id='${DUOLINGO_COPY_BUTTON_ID}']`)
      .forEach((button) => button.remove());
  }

  function ensureDuolingoCopyButton() {
    // Guard every write: this runs from the MutationObserver, so an
    // unconditional append would re-trigger it forever.
    const prompt = getDuolingoPromptElement();

    // Keep exactly one button: the one inside the visible prompt. Anything
    // else is a leftover or a transition-clone copy.
    let keep = null;
    document.querySelectorAll(`[id='${DUOLINGO_COPY_BUTTON_ID}']`).forEach((button) => {
      if (!keep && prompt && button.parentElement === prompt) {
        keep = button;
      } else {
        button.remove();
      }
    });

    if (!prompt || keep) {
      return;
    }

    const button = document.createElement("button");
    button.id = DUOLINGO_COPY_BUTTON_ID;
    button.type = "button";
    // Never in the tab order: Tab belongs to the typing hint ladder.
    button.tabIndex = -1;
    button.innerHTML = DUOLINGO_COPY_ICON;
    button.style.cssText = DUOLINGO_COPY_BUTTON_STYLE;
    resetDuolingoCopyButton(button);
    prompt.appendChild(button);
  }

  function resetDuolingoCopyButton(target) {
    const button = target || document.getElementById(DUOLINGO_COPY_BUTTON_ID);
    if (!button) {
      return;
    }

    button.setAttribute("data-copy-state", "idle");
    button.innerHTML = DUOLINGO_COPY_ICON;
    button.style.color = "rgb(175, 175, 175)";
    button.title = "Copy this phrase";
    button.setAttribute("aria-label", button.title);
  }

  function markDuolingoCopyResult(copied) {
    const button = document.getElementById(DUOLINGO_COPY_BUTTON_ID);
    if (!button) {
      return;
    }

    if (duolingoCopyResetTimer) {
      clearTimeout(duolingoCopyResetTimer);
    }

    button.setAttribute("data-copy-state", copied ? "copied" : "failed");
    button.innerHTML = copied ? DUOLINGO_COPY_DONE_ICON : DUOLINGO_COPY_ICON;
    button.style.color = copied ? "rgb(88, 167, 0)" : "rgb(234, 43, 43)";
    button.title = copied ? "Copied" : "Could not copy the phrase";
    button.setAttribute("aria-label", button.title);
    duolingoCopyResetTimer = setTimeout(() => {
      duolingoCopyResetTimer = null;
      resetDuolingoCopyButton();
    }, 1400);
  }

  function copyDuolingoPrompt() {
    const text = readDuolingoPromptText(getDuolingoPromptElement());
    if (!text) {
      return Promise.resolve(false);
    }

    return writeClipboardText(text).then((copied) => {
      markDuolingoCopyResult(copied);
      return copied;
    });
  }

  function writeClipboardText(text) {
    // navigator.clipboard wants a focused document and a live user gesture;
    // the textarea fallback covers the transitions where it has neither.
    const write =
      navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error("clipboard api unavailable"));

    return write.then(
      () => true,
      () => copyTextWithScratchTextarea(text)
    );
  }

  function copyTextWithScratchTextarea(text) {
    if (!document.body) {
      return false;
    }

    const active = document.activeElement;
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("aria-hidden", "true");
    scratch.style.cssText =
      "position: fixed; top: 0; left: 0; width: 1px; height: 1px; padding: 0; border: none; opacity: 0";
    document.body.appendChild(scratch);
    scratch.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (error) {
      copied = false;
    }

    scratch.remove();
    // The typing input owns focus for the whole challenge; hand it back.
    if (active && typeof active.focus === "function") {
      active.focus();
    }
    return copied;
  }

  // Two ways the word bank gives its answer away without meaning to: the one
  // capitalised word is the sentence's first word, and every word in it is
  // spelled correctly, so the right one can be picked without knowing how it
  // is spelled. Both are levelled here.
  const DUOLINGO_DECOY_ATTRIBUTE = "data-lwr-decoy";
  const DUOLINGO_CASE_ATTRIBUTE = "data-lwr-original-case";
  const DUOLINGO_BANK_SCROLL_ATTRIBUTE = "data-lwr-bank-scroll";
  const DUOLINGO_BANK_SCROLL_STYLE_ID = "learned-word-replacer-duolingo-bank-scroll-style";
  const DUOLINGO_DECOYS_PER_WORD = 2;
  const DUOLINGO_DECOY_MAX = 12;
  // Letters a learner actually confuses, so the decoy is a near miss rather
  // than obvious noise.
  const DUOLINGO_DECOY_CONFUSABLES = {
    uk: [
      ["и", "і"], ["і", "и"], ["і", "ї"], ["ї", "і"], ["е", "є"], ["є", "е"],
      ["о", "а"], ["а", "о"], ["г", "ґ"], ["ш", "щ"], ["щ", "ш"]
    ],
    el: [["ι", "η"], ["η", "ι"], ["ο", "ω"], ["ω", "ο"], ["ε", "α"]],
    default: [["a", "e"], ["e", "a"], ["i", "y"], ["y", "i"], ["o", "u"], ["s", "z"]]
  };
  let duolingoBankTrapObserver = null;
  let duolingoBankTrapClickListener = null;
  let duolingoDecoySignature = "";
  let duolingoDecoyPlan = [];
  let duolingoBankNaturalHeight = 0;

  function syncDuolingoBankTraps() {
    const shouldRun =
      globalThis === globalThis.top &&
      isDuolingoHost() &&
      Boolean(state.duolingoLowercaseBank || state.duolingoDecoyWords);

    if (shouldRun && !duolingoBankTrapObserver) {
      duolingoBankTrapObserver = new MutationObserver(() => {
        applyDuolingoBankTraps();
      });
      duolingoBankTrapObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      // Document capture, because the decoys are clones of Duolingo's own
      // slots and clones carry no listeners of their own.
      duolingoBankTrapClickListener = (event) => {
        const decoy =
          event.target && event.target.closest
            ? event.target.closest(`[${DUOLINGO_DECOY_ATTRIBUTE}]`)
            : null;
        if (!decoy) {
          return;
        }
        // A decoy is not Duolingo's to place: the click stops here.
        event.preventDefault();
        event.stopPropagation();
        flashDuolingoDecoy(decoy);
      };
      document.addEventListener("click", duolingoBankTrapClickListener, true);
      window.addEventListener("resize", remeasureDuolingoBankHeight);
      applyDuolingoBankTraps();
    } else if (!shouldRun && duolingoBankTrapObserver) {
      duolingoBankTrapObserver.disconnect();
      duolingoBankTrapObserver = null;
      document.removeEventListener("click", duolingoBankTrapClickListener, true);
      window.removeEventListener("resize", remeasureDuolingoBankHeight);
      duolingoBankTrapClickListener = null;
      duolingoBankNaturalHeight = 0;
      removeDuolingoDecoys();
      restoreDuolingoBankCase();
    }
  }

  function applyDuolingoBankTraps() {
    const bank = getDuolingoWordBank();
    if (!bank) {
      duolingoDecoySignature = "";
      duolingoDecoyPlan = [];
      duolingoBankNaturalHeight = 0;
      return;
    }

    if (state.duolingoLowercaseBank) {
      lowercaseDuolingoBank(bank);
    } else {
      restoreDuolingoBankCase();
    }

    if (state.duolingoDecoyWords) {
      ensureDuolingoDecoys(bank);
    } else {
      removeDuolingoDecoys();
    }
  }

  function getDuolingoTokenTextSpans(bank) {
    return [...bank.querySelectorAll("[data-test='challenge-tap-token-text']")];
  }

  function lowercaseDuolingoBank(bank) {
    // Guard every write: this runs from the MutationObserver.
    getDuolingoTokenTextSpans(bank).forEach((span) => {
      const shown = String(span.textContent || "");
      const locale = span.closest("[lang]")?.getAttribute("lang") || undefined;
      const lowered = shown.toLocaleLowerCase(locale);
      if (lowered === shown) {
        return;
      }

      // Keep the original so the page can be handed back untouched when the
      // setting goes off; only the first write records it.
      if (!span.hasAttribute(DUOLINGO_CASE_ATTRIBUTE)) {
        span.setAttribute(DUOLINGO_CASE_ATTRIBUTE, shown);
      }
      span.textContent = lowered;
    });
  }

  function restoreDuolingoBankCase() {
    document.querySelectorAll(`[${DUOLINGO_CASE_ATTRIBUTE}]`).forEach((span) => {
      const original = span.getAttribute(DUOLINGO_CASE_ATTRIBUTE);
      span.removeAttribute(DUOLINGO_CASE_ATTRIBUTE);
      if (original && span.textContent !== original) {
        span.textContent = original;
      }
    });
  }

  function removeDuolingoDecoys() {
    document.querySelectorAll(`[${DUOLINGO_DECOY_ATTRIBUTE}]`).forEach((decoy) => decoy.remove());
    document.querySelectorAll(`[${DUOLINGO_BANK_SCROLL_ATTRIBUTE}]`).forEach((bank) => {
      bank.removeAttribute(DUOLINGO_BANK_SCROLL_ATTRIBUTE);
      bank.style.maxHeight = "";
    });
  }

  function installDuolingoBankScrollStyle() {
    if (document.getElementById(DUOLINGO_BANK_SCROLL_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = DUOLINGO_BANK_SCROLL_STYLE_ID;
    // macOS hides overlay scrollbars until something is already scrolling, so
    // a bank with rows below the fold would look like it had none. A styled
    // webkit scrollbar is always drawn, which is the whole point of it here.
    style.textContent = `
      [${DUOLINGO_BANK_SCROLL_ATTRIBUTE}] {
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        scrollbar-gutter: stable;
      }

      [${DUOLINGO_BANK_SCROLL_ATTRIBUTE}]::-webkit-scrollbar {
        width: 8px;
      }

      [${DUOLINGO_BANK_SCROLL_ATTRIBUTE}]::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.18);
        border-radius: 4px;
      }

      [${DUOLINGO_BANK_SCROLL_ATTRIBUTE}]::-webkit-scrollbar-track {
        background: transparent;
      }
    `;
    document.documentElement.appendChild(style);
  }

  // The decoys must not cost the challenge any room: a bank that grows from
  // two rows to four pushes the sentence and the character off the top of the
  // screen. It keeps the height it had with Duolingo's own words in it, and
  // the rest is reached by scrolling.
  function applyDuolingoBankScroll(bank) {
    const wanted = duolingoBankNaturalHeight ? `${duolingoBankNaturalHeight}px` : "";
    if (!wanted) {
      return;
    }

    installDuolingoBankScrollStyle();
    // Guard every write: this runs from the MutationObserver.
    if (bank.getAttribute(DUOLINGO_BANK_SCROLL_ATTRIBUTE) !== "1") {
      bank.setAttribute(DUOLINGO_BANK_SCROLL_ATTRIBUTE, "1");
    }
    if (bank.style.maxHeight !== wanted) {
      bank.style.maxHeight = wanted;
    }
  }

  function remeasureDuolingoBankHeight() {
    const bank = getDuolingoWordBank();
    if (!bank || !duolingoDecoyPlan.length) {
      return;
    }

    // A resize rewraps Duolingo's own words into a different number of rows,
    // so the height to hold the bank at has to be taken again — with the
    // decoys out of the flow, exactly as it was measured the first time.
    const decoys = [...bank.children].filter((slot) =>
      slot.hasAttribute(DUOLINGO_DECOY_ATTRIBUTE)
    );
    bank.style.maxHeight = "";
    decoys.forEach((slot) => (slot.style.display = "none"));
    duolingoBankNaturalHeight = Math.round(bank.getBoundingClientRect().height);
    decoys.forEach((slot) => (slot.style.display = ""));
    applyDuolingoBankScroll(bank);
  }

  function readDuolingoTokenText(button) {
    const source = button.querySelector("[data-test='challenge-tap-token-text']") || button;
    return String(source.textContent || "").replace(/\s+/g, " ").trim();
  }

  function ensureDuolingoDecoys(bank) {
    const words = [...bank.querySelectorAll("button[data-test*='challenge-tap-token']")].map(
      readDuolingoTokenText
    );
    // A bank with two words in it hides nothing, and a decoy there is just in
    // the way.
    if (words.length < 3) {
      duolingoDecoySignature = "";
      duolingoDecoyPlan = [];
      duolingoBankNaturalHeight = 0;
      removeDuolingoDecoys();
      return;
    }

    // Placed words stay in the bank as disabled ghosts, so this signature holds
    // still for the whole challenge — the decoys must not reshuffle every time
    // a word is placed.
    const signature = words
      .map(normalizeDuolingoTypedText)
      .sort()
      .join("|");
    if (signature !== duolingoDecoySignature) {
      duolingoDecoySignature = signature;
      removeDuolingoDecoys();
      // Measured with Duolingo's own words alone, which is the height the bank
      // is then held to however many decoys go into it.
      duolingoBankNaturalHeight = Math.round(bank.getBoundingClientRect().height);
      duolingoDecoyPlan = planDuolingoDecoys(words, bank.children.length);
    }

    duolingoDecoyPlan.forEach((decoy, order) => {
      if (bank.querySelector(`[${DUOLINGO_DECOY_ATTRIBUTE}='${order}']`)) {
        return;
      }

      const slot = buildDuolingoDecoySlot(bank, decoy.text, order);
      if (!slot) {
        return;
      }
      const slots = [...bank.children];
      bank.insertBefore(slot, slots[Math.min(decoy.index, slots.length)] || null);
    });

    applyDuolingoBankScroll(bank);
  }

  function buildDuolingoDecoySlot(bank, text, order) {
    // Clone one of Duolingo's own slots rather than styling a button from
    // scratch: the class names are hashed per build and the wrapper carries
    // the token's margin variables. A slot holding an already-placed word is
    // a ghost, so clone a live one.
    const source = [...bank.children].find((slot) => {
      const button = slot.querySelector("button[data-test*='challenge-tap-token']");
      return button && button.getAttribute("aria-disabled") !== "true";
    });
    if (!source) {
      return null;
    }

    const slot = source.cloneNode(true);
    const button = slot.querySelector("button");
    const span = slot.querySelector("[data-test='challenge-tap-token-text']");
    if (!button || !span) {
      return null;
    }

    // Drop Duolingo's hooks: a decoy must not read as a real token to the
    // typing input, the hint ladder or anything else selecting on them.
    slot.setAttribute(DUOLINGO_DECOY_ATTRIBUTE, String(order));
    button.setAttribute(DUOLINGO_DECOY_ATTRIBUTE, String(order));
    button.removeAttribute("data-test");
    button.removeAttribute("aria-disabled");
    span.removeAttribute("data-test");
    span.textContent = text;
    return slot;
  }

  function flashDuolingoDecoy(element) {
    const button = element.matches("button") ? element : element.querySelector("button");
    if (!button || button.getAttribute(`${DUOLINGO_DECOY_ATTRIBUTE}-flash`) === "1") {
      return;
    }

    button.setAttribute(`${DUOLINGO_DECOY_ATTRIBUTE}-flash`, "1");
    button.style.color = "rgb(234, 43, 43)";
    setTimeout(() => {
      button.style.color = "";
      button.removeAttribute(`${DUOLINGO_DECOY_ATTRIBUTE}-flash`);
    }, 400);
  }

  function planDuolingoDecoys(words, slotCount) {
    // Nothing already on screen, and nothing the user has actually learned,
    // may end up as a decoy: a real word marked wrong teaches the wrong thing.
    const taken = new Set(words.map(normalizeDuolingoTypedText));
    for (const entry of getCurrentEntries()) {
      for (const alternate of String(entry.target || "").split(" / ")) {
        const key = normalizeDuolingoTypedText(alternate);
        if (key) {
          taken.add(key);
        }
      }
    }

    const bankKeys = words.map(normalizeDuolingoTypedText);
    const sources = shuffleDuolingoList([...new Set(words)]);
    const plan = [];
    // Breadth before depth: every word earns its first decoy before any word
    // earns a second, so the words worth being unsure about are never the ones
    // left standing alone.
    for (let round = 0; round < DUOLINGO_DECOYS_PER_WORD; round += 1) {
      for (const word of sources) {
        if (plan.length >= DUOLINGO_DECOY_MAX) {
          break;
        }

        const text = makeDuolingoMisspelling(word, taken, bankKeys);
        if (!text) {
          continue;
        }
        taken.add(normalizeDuolingoTypedText(text));
        // Scattered through the bank, not tacked on the end, or their position
        // alone would name them.
        plan.push({ text, index: Math.floor(Math.random() * (slotCount + plan.length + 1)) });
      }
    }
    return plan;
  }

  function makeDuolingoMisspelling(word, taken, bankKeys) {
    const letters = [...word];
    const spots = letters
      .map((letter, index) => (/\p{L}/u.test(letter) ? index : -1))
      .filter((index) => index >= 0);
    // Below four letters a single edit tends to land on another real word.
    if (spots.length < 4) {
      return "";
    }

    const confusables =
      DUOLINGO_DECOY_CONFUSABLES[getCurrentLanguageCode()] || DUOLINGO_DECOY_CONFUSABLES.default;
    const candidates = [];

    for (const [from, to] of confusables) {
      spots.forEach((index) => {
        if (letters[index].toLocaleLowerCase() !== from) {
          return;
        }
        const swapped = [...letters];
        swapped[index] = matchDuolingoLetterCase(letters[index], to);
        candidates.push(swapped.join(""));
      });
    }

    // Only swaps and substitutions, so a decoy is always its source word's
    // length. A doubled or dropped letter changes the shape of the word, and
    // a wrong shape is spotted without reading the word at all.
    spots.forEach((index, order) => {
      const next = spots[order + 1];
      if (next !== index + 1) {
        return;
      }
      const transposed = [...letters];
      transposed[index] = letters[next];
      transposed[next] = letters[index];
      candidates.push(transposed.join(""));
    });

    for (const candidate of shuffleDuolingoList(candidates)) {
      const key = normalizeDuolingoTypedText(candidate);
      if (!key || candidate === word || taken.has(key)) {
        continue;
      }
      // A decoy that is a bank word with its tail cut off (or one with
      // something stuck on the end) is half-invisible to the typing input,
      // which completes any unique prefix: typing the misspelling would place
      // the real word rather than fail.
      if (bankKeys.some((real) => real.startsWith(key) || key.startsWith(real))) {
        continue;
      }
      return candidate;
    }
    return "";
  }

  function matchDuolingoLetterCase(sample, letter) {
    return sample === sample.toLocaleUpperCase() && sample !== sample.toLocaleLowerCase()
      ? letter.toLocaleUpperCase()
      : letter;
  }

  function shuffleDuolingoList(items) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    return shuffled;
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
    },
    // Pairs ("Select the matching pairs"): two columns of word cards, one
    // column per language, each card numbered. Unlike listen-match the
    // pairing is nowhere in the DOM — every card's data-test is its own word
    // — so only the target-language column is hidden and typed, and the other
    // column is picked by its number badge.
    pairs: {
      challengeName: "challenge-match",
      cardSelector: "button[data-test*='challenge-tap-token']",
      textSelector: "[data-test='challenge-tap-token-text']"
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

  function getDuolingoTypeCards(context) {
    const spec = DUOLINGO_TYPE_KINDS[context.kind];
    const cardSelector = spec ? spec.cardSelector : "button[data-test*='challenge-tap-token']";
    const cards = [...context.container.querySelectorAll(cardSelector)];
    return context.kind === "pairs" ? getDuolingoRecallCards(cards, spec) : cards;
  }

  // On a pairs challenge both columns hold readable words, so hiding all of
  // them would leave nothing to work from. The half worth recalling is the one
  // in the language being learned.
  function getDuolingoRecallCards(cards, spec) {
    const readCard = (card) => {
      const source = card.querySelector(spec.textSelector);
      return source ? String(source.textContent || "") : "";
    };

    const targetScript = cards.filter((card) => isTextAlreadyInTargetLanguage(readCard(card)));
    if (targetScript.length && targetScript.length < cards.length) {
      return targetScript;
    }

    // A Latin-script target (Spanish, French) leaves the script test blind.
    // Fall back to geometry: the cards sit in two columns sharing a left edge,
    // and Duolingo puts the language being learned in the right-hand one.
    const columns = new Map();
    cards.forEach((card) => {
      const left = Math.round(card.getBoundingClientRect().left);
      const key = [...columns.keys()].find((edge) => Math.abs(edge - left) <= 8);
      const column = key === undefined ? left : key;
      columns.set(column, [...(columns.get(column) || []), card]);
    });
    if (columns.size === 2) {
      const rightEdge = Math.max(...columns.keys());
      return columns.get(rightEdge);
    }

    return cards;
  }

  function getDuolingoRecallTexts(context) {
    const spec = DUOLINGO_TYPE_KINDS[context.kind];
    if (context.kind !== "pairs") {
      return [...context.challenge.querySelectorAll(spec.textSelector)];
    }

    return getDuolingoTypeCards(context)
      .map((card) => card.querySelector(spec.textSelector))
      .filter(Boolean);
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
      getDuolingoRecallTexts(context).forEach((span) => {
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

    // A fresh row is the cheapest place to re-read the page's theme: it costs
    // one getComputedStyle per challenge, and it catches a theme flip that the
    // attribute watcher could not see.
    refreshDuolingoTheme();
    const theme = duolingoTheme();
    ensureDuolingoThemeStyle();

    const input = document.createElement("input");
    input.id = DUOLINGO_TYPE_INPUT_ID;
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("data-lwr-input", "");
    input.setAttribute("data-lwr-theme", duolingoThemeName);
    if (context.kind === "match") {
      input.placeholder = "Press a number to listen, type the word, then space";
      input.setAttribute("aria-label", "Type the word matching the audio you hear");
    } else if (context.kind === "pairs") {
      input.placeholder = "Press a number to pick a word, type its pair, then space";
      input.setAttribute("aria-label", "Type the word pairing with the one you picked");
    } else if (context.kind === "choice") {
      input.placeholder = "Type the meaning, then space — Enter checks";
      input.setAttribute("aria-label", "Type the answer matching the prompt");
    } else {
      input.placeholder = "Type a word, then space — Tab hints (again: more), Enter checks";
      input.setAttribute("aria-label", "Type a word from the word bank");
    }
    input.style.cssText = [
      "display: block",
      "width: 100%",
      "box-sizing: border-box",
      "margin: 0",
      "padding: 10px 84px 10px 14px",
      `border: 2px solid ${theme.inputBorder}`,
      "border-radius: 12px",
      `background: ${theme.inputBackground}`,
      `color: ${theme.inputText}`,
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
    toggle.setAttribute("data-lwr-theme", duolingoThemeName);
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
      `color: ${theme.icon}`,
      "cursor: pointer"
    ].join(";");

    const hintButton = document.createElement("button");
    hintButton.id = DUOLINGO_TYPE_HINT_BUTTON_ID;
    hintButton.type = "button";
    hintButton.tabIndex = -1;
    hintButton.title = "Hint (Tab) — the word's shape first, then letters";
    hintButton.setAttribute("aria-label", hintButton.title);
    hintButton.setAttribute("data-lwr-theme", duolingoThemeName);
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
      `color: ${theme.icon}`,
      "cursor: pointer"
    ].join(";");

    const badge = document.createElement("div");
    badge.id = DUOLINGO_TYPE_HINT_BADGE_ID;
    badge.setAttribute("role", "status");
    badge.setAttribute("data-lwr-theme", duolingoThemeName);
    badge.style.cssText = [
      "position: absolute",
      "right: 8px",
      "bottom: calc(100% + 6px)",
      "display: none",
      "padding: 6px 12px",
      "border-radius: 10px",
      `background: ${theme.badgeBackground}`,
      `color: ${theme.badgeText}`,
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "font-size: 15px",
      "font-weight: 600",
      "white-space: nowrap",
      "pointer-events: none",
      "z-index: 2000"
    ].join(";");

    wrap.append(input, hintButton, toggle, badge);
    container.parentElement.insertBefore(wrap, container);
    // A fresh input row means a new challenge: the previous word's reveal
    // depth must not carry over into it.
    resetDuolingoTypeHintDepth();
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
    return getDuolingoTypeCards(context)
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

  function getDuolingoNextLetterHint(typed, depth = 1) {
    const tokens = getDuolingoBankTokens();
    if (!tokens.length) {
      return null;
    }

    const query = normalizeDuolingoTypedPrefix(typed);
    // Every candidate contributes its own next `depth` letters, so a bank that
    // still has "мене" and "мій" in it reads "ме / мі" rather than picking a
    // branch for the user.
    const letters = new Set();
    let complete = false;
    let longestRemainder = 0;
    for (const text of new Set(tokens.map((token) => token.text))) {
      if (!text.startsWith(query)) {
        continue;
      }
      const remainder = text.slice(query.length);
      if (!remainder) {
        complete = true;
        continue;
      }
      longestRemainder = Math.max(longestRemainder, remainder.length);
      letters.add(remainder.slice(0, Math.max(1, depth)));
    }

    return {
      viable: complete || letters.size > 0,
      letters: [...letters].sort(),
      complete,
      longestRemainder
    };
  }

  // Candidate words rendered behind a blur: the first presses cue the word's
  // silhouette — its length, its word count, the run of its letters — which is
  // what makes a word click, without spelling any of it out. Radii picked by
  // eye at 19px text: a blob, then contours, then almost-legible.
  function getDuolingoShapeHintWords(typed) {
    const query = normalizeDuolingoTypedPrefix(typed);
    const words = [];
    const seen = new Set();
    for (const token of getDuolingoBankTokens()) {
      // Skip a candidate the buffer already spells out: its shape is on screen
      // in the input, so blurring it back at the user cues nothing.
      if (!token.text.startsWith(query) || token.text.length === query.length) {
        continue;
      }
      if (token.raw && !seen.has(token.raw)) {
        seen.add(token.raw);
        words.push(token.raw);
      }
    }
    return words.sort().slice(0, DUOLINGO_HINT_SHAPE_MAX_WORDS);
  }

  function resetDuolingoTypeHintDepth() {
    duolingoTypeHintDepth = 0;
    duolingoTypeHintPrefix = null;
  }

  // One rung per press while the buffer is unchanged: the shape stages first,
  // then a letter at a time. A fresh buffer (typing, backspacing, a placed
  // token) starts the ladder over.
  function nextDuolingoTypeHintDepth(input) {
    const prefix = normalizeDuolingoTypedPrefix(input.value);
    if (prefix !== duolingoTypeHintPrefix) {
      duolingoTypeHintPrefix = prefix;
      duolingoTypeHintDepth = 1;
      return duolingoTypeHintDepth;
    }

    // Cap at the last rung: shape stages plus the longest remaining candidate.
    // Past that there is nothing left to reveal, so extra presses hold.
    const remaining = getDuolingoNextLetterHint(input.value, 1);
    const letters = remaining && remaining.longestRemainder ? remaining.longestRemainder : 0;
    const limit = Math.max(1, countDuolingoShapeStages(input.value) + letters);
    duolingoTypeHintDepth = Math.min(duolingoTypeHintDepth + 1, limit);
    return duolingoTypeHintDepth;
  }

  function countDuolingoShapeStages(typed) {
    return getDuolingoShapeHintWords(typed).length ? DUOLINGO_HINT_SHAPE_BLURS.length : 0;
  }

  function setDuolingoTypeBorder(input) {
    const theme = duolingoTheme();
    if (input.getAttribute("data-lwr-dead-end") === "true") {
      input.style.borderColor = theme.inputBorderError;
    } else if (document.activeElement === input) {
      input.style.borderColor = theme.inputBorderFocus;
    } else {
      input.style.borderColor = theme.inputBorder;
    }
  }

  function applyDuolingoTypeInputTheme() {
    const theme = duolingoTheme();

    document.querySelectorAll(`[id='${DUOLINGO_TYPE_INPUT_ID}']`).forEach((input) => {
      if (input.getAttribute("data-lwr-theme") === duolingoThemeName) {
        return;
      }
      input.setAttribute("data-lwr-theme", duolingoThemeName);
      input.style.background = theme.inputBackground;
      input.style.color = theme.inputText;
      setDuolingoTypeBorder(input);
    });

    for (const id of [DUOLINGO_BANK_TOGGLE_ID, DUOLINGO_TYPE_HINT_BUTTON_ID]) {
      document.querySelectorAll(`[id='${id}']`).forEach((button) => {
        if (button.getAttribute("data-lwr-theme") === duolingoThemeName) {
          return;
        }
        button.setAttribute("data-lwr-theme", duolingoThemeName);
        button.style.color = theme.icon;
      });
    }

    document.querySelectorAll(`[id='${DUOLINGO_TYPE_HINT_BADGE_ID}']`).forEach((badge) => {
      if (badge.getAttribute("data-lwr-theme") === duolingoThemeName) {
        return;
      }
      badge.setAttribute("data-lwr-theme", duolingoThemeName);
      badge.style.color = theme.badgeText;
      // The background carries the hint's verdict, so leave it to the next
      // reveal rather than guessing which of the two it should be now.
      if (badge.style.display === "none") {
        badge.style.background = theme.badgeBackground;
      }
    });
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
    const press = nextDuolingoTypeHintDepth(input);
    const shapeStages = countDuolingoShapeStages(input.value);
    // On a shape rung the letter hint is still read, for its "space places it"
    // verdict; the reveal depth only starts counting once the ladder is past
    // the blurs.
    const hint = getDuolingoNextLetterHint(input.value, Math.max(1, press - shapeStages));
    if (!badge || !hint) {
      return;
    }

    const shaping = hint.viable && press <= shapeStages;
    const blur = shaping ? DUOLINGO_HINT_SHAPE_BLURS[press - 1] : 0;
    const shapeWords = shaping ? getDuolingoShapeHintWords(input.value) : [];

    let text;
    if (!hint.viable) {
      text = "✗ no bank word matches — backspace";
    } else if (shaping) {
      text = hint.complete ? "space places it · shape:" : "shape:";
    } else {
      const letters = hint.letters
        .map((letter) => letter.replace(/ /g, "␣"))
        .join(" / ");
      if (hint.complete) {
        text = letters ? `space places it · or continue: ${letters}` : "space places it";
      } else {
        text = `next: ${letters}`;
      }
    }

    // Guarded write: rewriting the badge's children feeds the MutationObserver.
    const signature = `${text}|${blur}|${shapeWords.join(" · ")}`;
    if (badge.getAttribute("data-lwr-hint") !== signature) {
      badge.setAttribute("data-lwr-hint", signature);
      badge.textContent = text;
      if (shapeWords.length) {
        const shape = document.createElement("span");
        // aria-hidden: a blurred word is a purely visual cue, and reading it
        // out would hand over the answer the blur exists to withhold.
        shape.setAttribute("aria-hidden", "true");
        shape.textContent = shapeWords.join(" · ");
        shape.style.cssText = [
          "display: inline-block",
          "margin-left: 2px",
          // Padding keeps the blur's bleed inside the badge's own background.
          "padding: 2px 8px",
          `filter: blur(${blur}px)`,
          "font-size: 19px",
          "vertical-align: -1px"
        ].join(";");
        badge.append(shape);
      }
    }
    const theme = duolingoTheme();
    const background = hint.viable ? theme.badgeBackground : theme.badgeErrorBackground;
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
    if (!context || (context.kind !== "match" && context.kind !== "pairs")) {
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
    input.style.borderColor = duolingoTheme().inputBorderError;
    setTimeout(() => {
      setDuolingoTypeBorder(input);
    }, 350);
  }

  function handleDuolingoTypeKeydown(event) {
    event.stopPropagation();

    const input = event.target;

    // The typing input holds focus for the whole challenge, so a plain copy
    // would come back empty. With nothing selected, ⌘/Ctrl+C copies the
    // phrase the challenge is asking about; with a selection it copies that.
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      String(event.key).toLowerCase() === "c"
    ) {
      if (state.duolingoCopyPhrase && input.selectionStart === input.selectionEnd) {
        copyDuolingoPrompt();
        event.preventDefault();
      }
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

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

    // Match and pairs challenges: a digit on an empty buffer taps that
    // numbered card, so the audio can be played (or a word picked) without
    // reaching for the mouse. Pairs number their tenth card "0". With text in
    // the buffer digits type normally (and dead-end like any other miss).
    if (/^[0-9]$/.test(event.key) && !input.value) {
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
      resetDuolingoTypeHintDepth();
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
  const DUOLINGO_LOGO_BADGE_ID = "learned-word-replacer-duolingo-logo-badge";
  let duolingoImportObserver = null;
  let duolingoImportInProgress = false;

  // The wordmark link at the top of the desktop sidebar: an /learn anchor
  // holding only the logo images. Duolingo's own Home nav item also links to
  // /learn but carries data-test="home-nav".
  function findDuolingoWordmarkLink() {
    for (const link of document.querySelectorAll("a[href='/learn']:not([data-test])")) {
      if (link.querySelector("img") && link.getClientRects().length) {
        return link;
      }
    }

    return null;
  }

  // "with [fox] Sly Fox" under the Duolingo wordmark, so it is visible at a
  // glance that the extension is active. data-lwr-ui keeps the replacer's own
  // pass off the badge text ("with" is learned vocabulary).
  function ensureDuolingoLogoBadge() {
    if (globalThis !== globalThis.top || !isDuolingoHost()) {
      return;
    }

    const existing = document.getElementById(DUOLINGO_LOGO_BADGE_ID);
    const link = state.enabled ? findDuolingoWordmarkLink() : null;

    if (!link) {
      existing?.remove();
      return;
    }

    let badge = existing;
    if (badge && badge.previousElementSibling !== link) {
      badge.remove();
      badge = null;
    }

    if (!badge) {
      badge = document.createElement("div");
      badge.id = DUOLINGO_LOGO_BADGE_ID;
      badge.dataset.lwrUi = "true";
      badge.style.cssText =
        "display: flex; align-items: center; gap: 5px; margin: 7px 0 0 2px; font-size: 14px; font-weight: 700; line-height: 1;";

      const withText = document.createElement("span");
      withText.textContent = "with";
      withText.style.cssText = "color: #afafaf; font-weight: 500;";
      const logo = document.createElement("img");
      logo.alt = "";
      logo.src = chrome.runtime.getURL("icons/icon-48.png");
      logo.style.cssText = "width: 18px; height: 18px; border-radius: 4px; flex: none;";
      const name = document.createElement("span");
      name.textContent = "Sly Fox";
      name.style.cssText = "color: #1cb0f6;";
      badge.append(withText, logo, name);
      link.insertAdjacentElement("afterend", badge);
    }

    // The collapsed narrow-viewport sidebar swaps the wordmark for a small
    // glyph; the badge would overflow it.
    badge.style.display = link.getBoundingClientRect().width >= 100 ? "flex" : "none";
  }

  // Extension UI embedded in Duolingo pages (the Words-page Import button and
  // the settings panel under duolingo.com/settings). Active on every
  // duolingo.com page load — these are SPA routes — independent of the other
  // settings, so the extension keeps working without the popup or side panel
  // (mobile browsers often support neither).
  function syncDuolingoPageUi() {
    if (globalThis !== globalThis.top || !isDuolingoHost() || duolingoImportObserver) {
      return;
    }

    // Every duolingo.com page load reaches here, so this is where the light /
    // dark palette gets read and kept in step with the page.
    watchDuolingoTheme();
    ensureDuolingoThemeStyle();

    duolingoImportObserver = new MutationObserver(() => {
      ensureDuolingoImportButton();
      ensureDuolingoSettingsUi();
      ensureDuolingoWordsInfo();
      ensureDuolingoWordsTabs();
      ensureDuolingoLogoBadge();
    });
    duolingoImportObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    // Sidebar collapse is viewport-driven and mutates nothing.
    globalThis.addEventListener("resize", () => ensureDuolingoLogoBadge(), { passive: true });
    // A page that never mutates again (e.g. translation excluded) would
    // otherwise never trigger the observer.
    ensureDuolingoImportButton();
    ensureDuolingoSettingsUi();
    ensureDuolingoWordsInfo();
    ensureDuolingoWordsTabs();
    ensureDuolingoLogoBadge();
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

        if (closest(`[id='${DUOLINGO_FLASHCARDS_QUICKSTART_ID}']`)) {
          runDuolingoFlashcardsQuickstart();
          return;
        }

        const bucketChip = closest("button[data-lwr-flashcards-bucket]");
        if (bucketChip) {
          toggleDuolingoFlashcardsBucket(
            bucketChip.getAttribute("data-lwr-flashcards-bucket")
          );
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

    const flashcardsButton = document.createElement("button");
    flashcardsButton.id = DUOLINGO_FLASHCARDS_QUICKSTART_ID;
    flashcardsButton.type = "button";
    flashcardsButton.textContent = "Practice flashcards";
    flashcardsButton.title =
      "Start a typed flashcard session over your Sly Fox vocabulary";
    flashcardsButton.style.cssText = button.style.cssText
      .replaceAll("rgb(28, 176, 246)", "rgb(88, 167, 0)");

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
    wrap.append(button, deleteButton, flashcardsButton, status);
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
        duolingoWordsTabButton("manual", "Sly Fox manual words"),
        duolingoWordsTabButton("flashcards", "Flashcards")
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
    const flashcardsActive = duolingoWordsSection === "flashcards";
    const nativeDisplay = manualActive || flashcardsActive ? "none" : "";
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

    let flashcardsPanel = document.getElementById(DUOLINGO_FLASHCARDS_PANEL_ID);
    if (flashcardsPanel && flashcardsPanel.parentElement !== layout.host) {
      flashcardsPanel.remove();
      flashcardsPanel = null;
    }
    if (!flashcardsPanel) {
      flashcardsPanel = buildDuolingoFlashcardsPanel(layout.heading.className);
      layout.host.append(flashcardsPanel);
    }
    const flashcardsDisplay = flashcardsActive ? "" : "none";
    if (flashcardsPanel.style.display !== flashcardsDisplay) {
      flashcardsPanel.style.display = flashcardsDisplay;
    }
    if (flashcardsActive) {
      renderDuolingoFlashcardsPanel();
    }
  }

  function duolingoManualInput(placeholder) {
    const theme = duolingoTheme();
    ensureDuolingoThemeStyle();
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = placeholder;
    input.setAttribute("data-lwr-input", "");
    input.setAttribute("data-lwr-panel-input", "");
    input.setAttribute("data-lwr-theme", duolingoThemeName);
    input.style.cssText = [
      "flex: 1 1 180px",
      "min-width: 140px",
      "box-sizing: border-box",
      "padding: 9px 12px",
      `border: 2px solid ${theme.inputBorder}`,
      "border-radius: 12px",
      `background: ${theme.inputBackground}`,
      `color: ${theme.inputText}`,
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

  // Flashcard training: a "Flashcards" tab on the Words page tracks how well
  // each vocabulary word is known (typed answers, recall time, streaks) and a
  // Duolingo-lesson-style overlay runs the practice sessions. Progress lives
  // under its own storage key, keyed by word TEXT rather than entry ids so it
  // survives re-imports and can be moved between browsers via JSON files.
  const FLASHCARDS_STORAGE_KEY = "learnedWordReplacerFlashcards";
  const DEFAULT_FLASHCARDS_STATE = { version: 1, languages: {} };
  const DUOLINGO_FLASHCARDS_PANEL_ID = "learned-word-replacer-duolingo-flashcards-panel";
  const DUOLINGO_FLASHCARDS_OVERLAY_ID = "learned-word-replacer-flashcards-overlay";
  const DUOLINGO_FLASHCARDS_QUICKSTART_ID = "learned-word-replacer-duolingo-flashcards-start";
  const FLASHCARD_DIRECTIONS = ["en2tg", "tg2en"];
  const FLASHCARD_SESSION_SIZE = 10;
  const FLASHCARD_GREEN = "rgb(88, 204, 2)";
  const FLASHCARD_GREEN_SHADOW = "rgb(88, 167, 0)";
  const FLASHCARD_RED = "rgb(255, 75, 75)";
  const FLASHCARD_RED_SHADOW = "rgb(234, 43, 43)";
  const FLASHCARD_BUCKET_LABELS = ["Strong", "Good", "Weak", "New"];
  let flashcardsState = DEFAULT_FLASHCARDS_STATE;
  let flashcardsSession = null;
  let flashcardsTimerInterval = null;
  let duolingoFlashcardsDirection = "mixed";
  let duolingoFlashcardsBuckets = new Set(FLASHCARD_BUCKET_LABELS);
  let duolingoFlashcardsFilter = "";

  function normalizeFlashcardRecord(record) {
    if (!record || typeof record !== "object") {
      return null;
    }

    const attempts = Math.max(0, Math.floor(Number(record.attempts) || 0));
    if (!attempts) {
      return null;
    }

    return {
      attempts,
      correct: Math.min(attempts, Math.max(0, Math.floor(Number(record.correct) || 0))),
      streak: Math.max(0, Math.floor(Number(record.streak) || 0)),
      avgMs: Math.max(0, Math.round(Number(record.avgMs) || 0)),
      lastAt: Math.max(0, Math.round(Number(record.lastAt) || 0)),
      lastCorrect: Boolean(record.lastCorrect)
    };
  }

  function normalizeFlashcardsState(value) {
    const languages = {};
    const sourceLanguages =
      value && typeof value === "object" && value.languages && typeof value.languages === "object"
        ? value.languages
        : {};

    for (const [code, language] of Object.entries(sourceLanguages)) {
      const cards = {};
      const sourceCards =
        language && typeof language === "object" && language.cards && typeof language.cards === "object"
          ? language.cards
          : {};
      for (const [key, record] of Object.entries(sourceCards)) {
        const normalized = normalizeFlashcardRecord(record);
        if (normalized) {
          cards[key] = normalized;
        }
      }
      if (Object.keys(cards).length) {
        languages[code] = { cards };
      }
    }

    return { version: 1, languages };
  }

  function getFlashcardLanguageCards() {
    const code = getCurrentLanguageCode() || "unknown";
    const language = flashcardsState.languages[code];
    return language && language.cards ? language.cards : {};
  }

  function getFlashcardRecord(direction, wordKey) {
    return getFlashcardLanguageCards()[`${direction}:${wordKey}`] || null;
  }

  // One card per learned word (unique entry.target): the word plus every
  // English meaning the vocabulary knows for it, mirroring how the Duolingo
  // Words page lists "кафе — a cafe, a café". Alternate forms
  // ("мільйони / мільйонів") all count as correct answers.
  function buildFlashcardDeck() {
    const groups = new Map();
    for (const entry of getCurrentEntries()) {
      const target = String(entry.target || "").trim();
      const source = String(entry.source || "").trim();
      if (!target || !source) {
        continue;
      }

      const groupKey = normalizeDuolingoWordKey(target);
      if (!groups.has(groupKey)) {
        const alternates = target
          .split(" / ")
          .map((part) => part.trim())
          .filter(Boolean);
        groups.set(groupKey, {
          word: alternates[0],
          alternates,
          wordKey: normalizeDuolingoWordKey(alternates[0]),
          meanings: [],
          meaningKeys: new Set()
        });
      }

      const group = groups.get(groupKey);
      const meaningKey = normalizeDuolingoWordKey(source);
      if (meaningKey && !group.meaningKeys.has(meaningKey)) {
        group.meaningKeys.add(meaningKey);
        group.meanings.push(source);
      }
    }

    return [...groups.values()].filter((card) => card.word && card.meanings.length);
  }

  // Strength 0..1 per (word, direction): mostly accuracy, plus the current
  // streak and how quickly correct answers come. Recall speed is an EMA of
  // the time from card shown to submit, ≤2.5s scoring full marks.
  function flashcardRecordStrength(record) {
    if (!record || !record.attempts) {
      return null;
    }

    const accuracy = record.correct / record.attempts;
    const streakFactor = Math.min(record.streak, 4) / 4;
    const speed =
      record.avgMs > 0
        ? Math.min(1, Math.max(0.15, (12000 - record.avgMs) / 9500))
        : 0.5;
    return Math.min(1, Math.max(0, accuracy * 0.5 + streakFactor * 0.3 + speed * 0.2));
  }

  function flashcardWordStrength(wordKey) {
    const scores = FLASHCARD_DIRECTIONS.map((direction) =>
      flashcardRecordStrength(getFlashcardRecord(direction, wordKey))
    ).filter((score) => score !== null);
    return scores.length
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : null;
  }

  function flashcardWordLastAt(wordKey) {
    let last = 0;
    for (const direction of FLASHCARD_DIRECTIONS) {
      const record = getFlashcardRecord(direction, wordKey);
      if (record && record.lastAt > last) {
        last = record.lastAt;
      }
    }
    return last;
  }

  function flashcardStrengthBucket(strength) {
    if (strength === null) {
      return { label: "New", color: "rgb(175, 175, 175)" };
    }
    if (strength >= 0.8) {
      return { label: "Strong", color: FLASHCARD_GREEN };
    }
    if (strength >= 0.55) {
      return { label: "Good", color: "rgb(255, 200, 0)" };
    }
    return { label: "Weak", color: FLASHCARD_RED };
  }

  // Every Start deals a fresh weighted lottery over the WHOLE eligible deck
  // (Efraimidis–Spirakis sampling without replacement): weaker words carry
  // more tickets, words practiced in the last hour carry fewer, but nothing
  // outranks anything outright. A strict weakest-first sort — even a jittered
  // one — kept re-dealing the same dozen weak words every session; anyone who
  // wants a pure weak-word grind can use the category filter chips instead.
  function pickFlashcardSessionCards(deck, size) {
    const direction = duolingoFlashcardsDirection;
    const now = Date.now();
    const drawn = deck.map((card) => {
      const strength = FLASHCARD_DIRECTIONS.includes(direction)
        ? flashcardRecordStrength(getFlashcardRecord(direction, card.wordKey))
        : flashcardWordStrength(card.wordKey);
      const lastAt = flashcardWordLastAt(card.wordKey);
      const ageMinutes = lastAt ? (now - lastAt) / 60000 : Infinity;
      const cooldown = ageMinutes < 60 ? 0.2 * (1 - ageMinutes / 60) : 0;
      const effective = Math.min(1, (strength === null ? 0.3 : strength) + cooldown);
      // Weak ≈ 0.9 tickets, New ≈ 0.56, Good ≈ 0.16, Strong ≈ 0.02: weak
      // words show up noticeably more often, strong ones only rarely.
      const weight = Math.max(0.02, (1.05 - effective) ** 2);
      return { card, sortKey: Math.random() ** (1 / weight) };
    });
    drawn.sort((a, b) => b.sortKey - a.sortKey);
    return drawn.slice(0, size).map((item) => item.card);
  }

  function updateFlashcardRecord(direction, wordKey, correct, recallMs) {
    const code = getCurrentLanguageCode() || "unknown";
    const languages = { ...flashcardsState.languages };
    const cards = { ...(languages[code]?.cards || {}) };
    const key = `${direction}:${wordKey}`;
    const previous = cards[key] || { attempts: 0, correct: 0, streak: 0, avgMs: 0, lastAt: 0 };
    const roundedRecall = Math.max(0, Math.round(recallMs));

    cards[key] = {
      attempts: previous.attempts + 1,
      correct: previous.correct + (correct ? 1 : 0),
      streak: correct ? previous.streak + 1 : 0,
      avgMs: correct
        ? previous.avgMs > 0
          ? Math.round(previous.avgMs * 0.7 + roundedRecall * 0.3)
          : roundedRecall
        : previous.avgMs,
      lastAt: Date.now(),
      lastCorrect: Boolean(correct)
    };
    languages[code] = { cards };
    flashcardsState = { ...flashcardsState, languages };
    chrome.storage.local.set({ [FLASHCARDS_STORAGE_KEY]: flashcardsState });
  }

  // Typed-answer grading: case/whitespace/trailing-punctuation insensitive.
  // English answers additionally accept a leading article/"to" and Latin
  // accent differences (cafe ≡ café). The accent fold never runs on target-
  // language answers — NFD stripping would corrupt Cyrillic й/ї.
  function flashcardAnswerKeys(text, english) {
    const keys = new Set();
    const folded = normalizeDuolingoWordKey(String(text || "").replace(/’/g, "'"))
      .replace(/[.,!?;:…]+$/g, "")
      .trim();
    if (!folded) {
      return keys;
    }

    keys.add(folded);
    if (english) {
      keys.add(folded.replace(/^(?:a|an|the|to)\s+/, ""));
      for (const key of [...keys]) {
        keys.add(key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC"));
      }
    }
    return keys;
  }

  function flashcardEditDistance(a, b, limit) {
    if (a === b) {
      return 0;
    }
    if (Math.abs(a.length - b.length) > limit) {
      return limit + 1;
    }

    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= b.length; j += 1) {
        current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      previous = current;
    }
    return previous[b.length];
  }

  // Duolingo-style typo forgiveness: hyphen/space differences always pass
  // ("twenty three" ≡ "twenty-three"), and a single-character slip passes on
  // words long enough that one edit can't reach a different real word (never
  // on short words like чай, where чаї is a distinct form).
  function softenFlashcardKey(text) {
    return text.replace(/[-–—]/g, " ").replace(/\s+/g, " ").trim();
  }

  function flashcardTypoMatch(inputKey, answerKey) {
    if (!inputKey || !answerKey) {
      return false;
    }

    const softInput = softenFlashcardKey(inputKey);
    const softAnswer = softenFlashcardKey(answerKey);
    if (softInput === softAnswer) {
      return true;
    }
    return answerKey.length >= 4 && flashcardEditDistance(softInput, softAnswer, 1) <= 1;
  }

  // "Close" = recognizably the right word with a few characters wrong — the
  // only tier that earns a second chance. The threshold scales with the
  // answer: 2 edits on short words, roughly a third of the characters on
  // longer ones. Anything past that is a different answer, not a near miss.
  function flashcardCloseMatch(inputKey, answerKey) {
    if (!inputKey || !answerKey) {
      return false;
    }

    const limit = Math.max(2, Math.floor(answerKey.length / 3));
    return (
      flashcardEditDistance(
        softenFlashcardKey(inputKey),
        softenFlashcardKey(answerKey),
        limit
      ) <= limit
    );
  }

  // "correct" = exact (normalized) match, "typo" = accepted with a shown
  // correction, "close" = near miss worth a second chance, "wrong" = not
  // recognizably the answer.
  function gradeFlashcardAnswer(item, value) {
    const english = item.direction === "tg2en";
    const answers = english ? item.card.meanings : item.card.alternates;
    const accepted = new Set();
    for (const answer of answers) {
      for (const key of flashcardAnswerKeys(answer, english)) {
        accepted.add(key);
      }
    }

    const inputKeys = [...flashcardAnswerKeys(value, english)];
    if (inputKeys.some((key) => accepted.has(key))) {
      return "correct";
    }
    let close = false;
    for (const inputKey of inputKeys) {
      for (const answerKey of accepted) {
        if (flashcardTypoMatch(inputKey, answerKey)) {
          return "typo";
        }
        close = close || flashcardCloseMatch(inputKey, answerKey);
      }
    }
    return close ? "close" : "wrong";
  }

  function flashcardCorrectAnswerText(item) {
    return item.direction === "tg2en"
      ? item.card.meanings.join(", ")
      : item.card.alternates.join(" / ");
  }

  function formatFlashcardRecallMs(ms) {
    return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  }

  // --- Flashcards tab panel on the Words page ---

  function duolingoFlashcardsPrimaryButton(label, { danger } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    const background = danger ? FLASHCARD_RED : FLASHCARD_GREEN;
    const shadow = danger ? FLASHCARD_RED_SHADOW : FLASHCARD_GREEN_SHADOW;
    button.style.cssText = [
      "padding: 12px 24px",
      "border: none",
      "border-radius: 16px",
      `background: ${background}`,
      "color: #ffffff",
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "font-size: 15px",
      "font-weight: 700",
      "letter-spacing: 0.8px",
      "text-transform: uppercase",
      `box-shadow: 0 4px 0 ${shadow}`,
      "cursor: pointer"
    ].join(";");
    return button;
  }

  function buildDuolingoFlashcardsPanel(headingClassName) {
    const panel = document.createElement("div");
    panel.id = DUOLINGO_FLASHCARDS_PANEL_ID;
    panel.dataset.lwrUi = "true";
    panel.style.display = "none";

    const heading = document.createElement("h2");
    heading.className = headingClassName;
    heading.setAttribute("data-lwr-flashcards-count", "");
    panel.append(heading);

    const controls = document.createElement("div");
    controls.style.cssText =
      "display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 14px 0";
    const start = duolingoFlashcardsPrimaryButton("Start flashcards");
    start.setAttribute("data-lwr-flashcards-session-start", "");
    start.addEventListener("click", () => startDuolingoFlashcardsSession());
    controls.append(start);

    const directions = document.createElement("div");
    directions.style.cssText = "display: inline-flex; gap: 8px";
    for (const option of [
      { value: "mixed", label: "Mixed" },
      { value: "en2tg", label: "English → word" },
      { value: "tg2en", label: "Word → English" }
    ]) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = option.label;
      chip.setAttribute("data-lwr-flashcards-direction", option.value);
      chip.addEventListener("click", () => {
        duolingoFlashcardsDirection = option.value;
        renderDuolingoFlashcardsPanel();
      });
      directions.append(chip);
    }
    controls.append(directions);
    panel.append(controls);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.style.display = "none";
    fileInput.setAttribute("data-lwr-flashcards-file", "");
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (file) {
        runDuolingoFlashcardsImportFile(file);
      }
    });

    const transfer = document.createElement("div");
    transfer.style.cssText = "display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 0 0 8px";
    const exportButton = duolingoPanelButton("Download progress");
    exportButton.setAttribute("data-lwr-flashcards-export", "");
    exportButton.addEventListener("click", () => runDuolingoFlashcardsExport());
    const importButton = duolingoPanelButton("Import progress");
    importButton.setAttribute("data-lwr-flashcards-import", "");
    importButton.addEventListener("click", () => fileInput.click());
    transfer.append(exportButton, importButton, fileInput);
    panel.append(transfer);

    const status = document.createElement("div");
    status.setAttribute("data-lwr-flashcards-status", "");
    status.textContent =
      "Progress is saved in this browser — download it as a file to move it to another browser.";
    status.style.cssText =
      "margin: 0 0 14px; font-family: 'duolingo-sans', -apple-system, sans-serif; font-size: 14px; color: rgb(150, 150, 150)";
    panel.append(status);

    const summary = document.createElement("div");
    summary.setAttribute("data-lwr-flashcards-summary", "");
    summary.style.cssText =
      "display: flex; flex-wrap: wrap; gap: 14px; margin: 0 0 14px; font-family: 'duolingo-sans', -apple-system, sans-serif; font-size: 14px; font-weight: 700";
    panel.append(summary);

    const filter = duolingoManualInput("Search words");
    filter.setAttribute("data-lwr-flashcards-filter", "");
    filter.style.margin = "0 0 12px";
    filter.addEventListener("input", () => {
      duolingoFlashcardsFilter = filter.value;
      renderDuolingoFlashcardsList();
    });
    panel.append(filter);

    const list = document.createElement("div");
    list.setAttribute("data-lwr-flashcards-list", "");
    panel.append(list);

    return panel;
  }

  function toggleDuolingoFlashcardsBucket(label) {
    if (duolingoFlashcardsBuckets.has(label)) {
      duolingoFlashcardsBuckets.delete(label);
    } else {
      duolingoFlashcardsBuckets.add(label);
    }
    renderDuolingoFlashcardsPanel();
  }

  function setDuolingoFlashcardsStatus(text, isError) {
    document.querySelectorAll("[data-lwr-flashcards-status]").forEach((status) => {
      status.textContent = text;
      status.style.color = isError ? FLASHCARD_RED_SHADOW : "rgb(88, 167, 0)";
    });
  }

  function renderDuolingoFlashcardsPanel() {
    const panel = document.getElementById(DUOLINGO_FLASHCARDS_PANEL_ID);
    if (!panel) {
      return;
    }

    const deck = buildFlashcardDeck();
    const label = `${deck.length} flashcard word${deck.length === 1 ? "" : "s"}`;
    const heading = panel.querySelector("[data-lwr-flashcards-count]");
    if (heading.textContent !== label) {
      heading.textContent = label;
    }

    for (const chip of panel.querySelectorAll("[data-lwr-flashcards-direction]")) {
      const active =
        chip.getAttribute("data-lwr-flashcards-direction") === duolingoFlashcardsDirection;
      const wanted = [
        "padding: 8px 14px",
        "border-radius: 12px",
        "font-family: 'duolingo-sans', -apple-system, sans-serif",
        "font-size: 13px",
        "font-weight: 700",
        "letter-spacing: 0.6px",
        "text-transform: uppercase",
        "cursor: pointer",
        active
          ? "border: 2px solid rgb(28, 176, 246); background: rgb(221, 244, 255); color: rgb(24, 153, 214)"
          : "border: 2px solid rgb(229, 229, 229); background: #ffffff; color: rgb(175, 175, 175)"
      ].join(";");
      if (chip.style.cssText !== wanted) {
        chip.style.cssText = wanted;
      }
      const pressed = String(active);
      if (chip.getAttribute("aria-pressed") !== pressed) {
        chip.setAttribute("aria-pressed", pressed);
      }
    }

    // The category chips double as filters: each one toggles whether the
    // session deck draws from that strength bucket.
    const counts = { Strong: 0, Good: 0, Weak: 0, New: 0 };
    for (const card of deck) {
      counts[flashcardStrengthBucket(flashcardWordStrength(card.wordKey)).label] += 1;
    }
    const summary = panel.querySelector("[data-lwr-flashcards-summary]");
    const summarySignature = JSON.stringify([counts, [...duolingoFlashcardsBuckets].sort()]);
    if (summary.getAttribute("data-lwr-signature") !== summarySignature) {
      summary.setAttribute("data-lwr-signature", summarySignature);
      summary.textContent = "";
      const summaryLabel = document.createElement("span");
      summaryLabel.textContent = "Practice from:";
      summaryLabel.style.cssText =
        "align-self: center; font-weight: 500; color: rgb(150, 150, 150)";
      summary.append(summaryLabel);
      for (const bucketLabel of FLASHCARD_BUCKET_LABELS) {
        const bucket = flashcardStrengthBucket(
          bucketLabel === "Strong" ? 1 : bucketLabel === "Good" ? 0.6 : bucketLabel === "Weak" ? 0 : null
        );
        const active = duolingoFlashcardsBuckets.has(bucketLabel);
        const chip = document.createElement("button");
        chip.type = "button";
        chip.setAttribute("data-lwr-flashcards-bucket", bucketLabel);
        chip.setAttribute("aria-pressed", String(active));
        chip.title = active
          ? `Stop drawing ${bucketLabel} words into sessions`
          : `Draw ${bucketLabel} words into sessions`;
        chip.style.cssText = [
          "display: inline-flex",
          "align-items: center",
          "gap: 6px",
          "padding: 6px 12px",
          `border: 2px solid ${active ? bucket.color : "rgb(229, 229, 229)"}`,
          "border-radius: 999px",
          "background: #ffffff",
          "font-family: 'duolingo-sans', -apple-system, sans-serif",
          "font-size: 13px",
          "font-weight: 700",
          "cursor: pointer",
          `color: ${active ? "rgb(90, 90, 90)" : "rgb(175, 175, 175)"}`
        ].join(";");
        const dot = document.createElement("span");
        dot.style.cssText = `width: 10px; height: 10px; border-radius: 999px; background: ${
          active ? bucket.color : "rgb(229, 229, 229)"
        }`;
        const text = document.createElement("span");
        text.textContent = `${bucketLabel} ${counts[bucketLabel]}`;
        chip.append(dot, text);
        summary.append(chip);
      }
    }

    renderDuolingoFlashcardsList();
  }

  function buildFlashcardStrengthBar(strength, bucket) {
    const bar = document.createElement("span");
    bar.style.cssText = "display: inline-flex; gap: 3px";
    const filled = strength === null ? 0 : Math.max(1, Math.round(strength * 4));
    for (let segment = 0; segment < 4; segment += 1) {
      const piece = document.createElement("span");
      piece.style.cssText = `width: 14px; height: 8px; border-radius: 4px; background: ${
        segment < filled ? bucket.color : "rgb(229, 229, 229)"
      }`;
      bar.append(piece);
    }
    return bar;
  }

  function renderDuolingoFlashcardsList() {
    const panel = document.getElementById(DUOLINGO_FLASHCARDS_PANEL_ID);
    if (!panel) {
      return;
    }

    const query = normalizeDuolingoWordKey(duolingoFlashcardsFilter);
    const rows = buildFlashcardDeck()
      .map((card) => {
        const strength = flashcardWordStrength(card.wordKey);
        const records = FLASHCARD_DIRECTIONS.map((direction) =>
          getFlashcardRecord(direction, card.wordKey)
        ).filter(Boolean);
        const attempts = records.reduce((sum, record) => sum + record.attempts, 0);
        const correct = records.reduce((sum, record) => sum + record.correct, 0);
        const timed = records.filter((record) => record.avgMs > 0);
        const avgMs = timed.length
          ? timed.reduce((sum, record) => sum + record.avgMs, 0) / timed.length
          : 0;
        return { card, strength, attempts, correct, avgMs, lastAt: flashcardWordLastAt(card.wordKey) };
      })
      .filter(
        (row) =>
          !query ||
          normalizeDuolingoWordKey(row.card.alternates.join(" / ")).includes(query) ||
          normalizeDuolingoWordKey(row.card.meanings.join(", ")).includes(query)
      );
    // Weakest words first so the top of the list is the study queue; words
    // never practiced sort to the end (their strength is unknown).
    rows.sort((a, b) => {
      if ((a.strength === null) !== (b.strength === null)) {
        return a.strength === null ? 1 : -1;
      }
      return (
        (a.strength ?? 0) - (b.strength ?? 0) ||
        a.lastAt - b.lastAt ||
        a.card.wordKey.localeCompare(b.card.wordKey)
      );
    });

    const signature = rows
      .map(
        (row) =>
          `${row.card.wordKey}:${row.strength === null ? "new" : row.strength.toFixed(3)}:${row.attempts}:${row.correct}:${Math.round(row.avgMs)}`
      )
      .join("|");
    const list = panel.querySelector("[data-lwr-flashcards-list]");
    if (list.getAttribute("data-lwr-signature") === signature) {
      return;
    }
    list.setAttribute("data-lwr-signature", signature);
    list.textContent = "";

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.textContent = query
        ? "No words match this search."
        : "No words yet — use Import to Sly Fox on the Duolingo words tab first.";
      empty.style.cssText =
        "padding: 12px 0; font-family: 'duolingo-sans', -apple-system, sans-serif; font-size: 14px; color: rgb(150, 150, 150)";
      list.append(empty);
      return;
    }

    for (const row of rows) {
      const bucket = flashcardStrengthBucket(row.strength);
      const line = document.createElement("div");
      line.setAttribute("data-lwr-flashcards-row", row.card.wordKey);
      line.style.cssText = [
        "display: flex",
        "align-items: center",
        "justify-content: space-between",
        "gap: 16px",
        "padding: 10px 0",
        "border-bottom: 1px solid rgb(229, 229, 229)",
        "font-family: 'duolingo-sans', -apple-system, sans-serif"
      ].join(";");

      const text = document.createElement("span");
      const word = document.createElement("span");
      word.textContent = row.card.alternates.join(" / ");
      word.style.cssText = "display: block; font-size: 16px; font-weight: 600; color: rgb(60, 60, 60)";
      const meanings = document.createElement("span");
      meanings.textContent = row.card.meanings.join(", ");
      meanings.style.cssText = "display: block; font-size: 13px; color: rgb(150, 150, 150)";
      text.append(word, meanings);

      const stats = document.createElement("span");
      stats.style.cssText =
        "display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none";
      stats.append(buildFlashcardStrengthBar(row.strength, bucket));
      const detail = document.createElement("span");
      detail.textContent =
        row.strength === null
          ? "New"
          : `${bucket.label} · ${Math.round((row.correct / Math.max(1, row.attempts)) * 100)}% · ${
              row.avgMs > 0 ? `${formatFlashcardRecallMs(row.avgMs)} · ` : ""
            }${row.attempts} ${row.attempts === 1 ? "try" : "tries"}`;
      detail.style.cssText = `font-size: 12px; font-weight: 600; color: ${bucket.color}`;
      stats.append(detail);

      line.append(text, stats);
      list.append(line);
    }
  }

  // --- Progress files (move between browsers) ---

  function countFlashcardRecords(candidate) {
    let count = 0;
    for (const language of Object.values(candidate.languages)) {
      count += Object.keys(language.cards).length;
    }
    return count;
  }

  function runDuolingoFlashcardsExport() {
    const count = countFlashcardRecords(flashcardsState);
    if (!count) {
      setDuolingoFlashcardsStatus("No flashcard progress to download yet — practice first.", true);
      return;
    }

    const payload = {
      type: "sly-fox-flashcards",
      version: 1,
      exportedAt: new Date().toISOString(),
      languages: flashcardsState.languages
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sly-fox-flashcards-progress.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setDuolingoFlashcardsStatus(
      `Downloaded progress for ${count} card${count === 1 ? "" : "s"}.`,
      false
    );
  }

  async function runDuolingoFlashcardsImportFile(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = normalizeFlashcardsState(parsed);
      const totalIncoming = countFlashcardRecords(incoming);
      if (!totalIncoming) {
        throw new Error("No flashcard progress was found in the file.");
      }

      // Newer-wins per card so re-importing the same file is harmless and
      // browsers that were both practiced keep whichever run was later.
      let updated = 0;
      const languages = { ...flashcardsState.languages };
      for (const [code, language] of Object.entries(incoming.languages)) {
        const cards = { ...(languages[code]?.cards || {}) };
        for (const [key, record] of Object.entries(language.cards)) {
          const existing = cards[key];
          if (!existing || record.lastAt > existing.lastAt) {
            cards[key] = record;
            updated += 1;
          }
        }
        languages[code] = { cards };
      }
      flashcardsState = { ...flashcardsState, languages };
      chrome.storage.local.set({ [FLASHCARDS_STORAGE_KEY]: flashcardsState });
      setDuolingoFlashcardsStatus(
        `Imported ${totalIncoming} card record${totalIncoming === 1 ? "" : "s"} from ${file.name} — ${updated} newer than this browser's.`,
        false
      );
      renderDuolingoFlashcardsPanel();
    } catch (error) {
      setDuolingoFlashcardsStatus(
        error && error.message ? error.message : `Could not read ${file.name}.`,
        true
      );
    }
  }

  // --- Training session overlay (Duolingo lesson look) ---

  function runDuolingoFlashcardsQuickstart() {
    duolingoWordsSection = "flashcards";
    ensureDuolingoWordsTabs();
    startDuolingoFlashcardsSession();
  }

  function startDuolingoFlashcardsSession() {
    if (flashcardsSession || document.getElementById(DUOLINGO_FLASHCARDS_OVERLAY_ID)) {
      return;
    }

    const deck = buildFlashcardDeck();
    if (!deck.length) {
      setDuolingoFlashcardsStatus(
        "No words to practice yet — use Import to Sly Fox on the Duolingo words tab first.",
        true
      );
      return;
    }

    const eligible = deck.filter((card) =>
      duolingoFlashcardsBuckets.has(
        flashcardStrengthBucket(flashcardWordStrength(card.wordKey)).label
      )
    );
    if (!eligible.length) {
      setDuolingoFlashcardsStatus(
        "No words in the selected categories — turn a category back on above.",
        true
      );
      return;
    }

    const cards = pickFlashcardSessionCards(eligible, FLASHCARD_SESSION_SIZE);
    const queue = cards.map((card, index) => ({
      card,
      direction:
        duolingoFlashcardsDirection === "mixed"
          ? FLASHCARD_DIRECTIONS[index % FLASHCARD_DIRECTIONS.length]
          : duolingoFlashcardsDirection,
      retry: false
    }));
    flashcardsSession = {
      queue,
      position: 0,
      total: queue.length,
      completed: 0,
      results: new Map(),
      awaitingContinue: false,
      finished: false,
      retryUsed: false,
      cardShownAt: 0
    };
    buildFlashcardOverlay();
    renderFlashcardSessionCard();
  }

  // The on-card recall timer: ticks while an answer is open, freezes at the
  // graded recall time, and colors up as the pressure builds — green inside
  // 5s, gold to 10s, red after that.
  function setFlashcardTimerDisplay(timer, elapsedMs) {
    const text = formatFlashcardRecallMs(elapsedMs);
    if (timer.textContent !== text) {
      timer.textContent = text;
    }
    const color =
      elapsedMs < 5000 ? FLASHCARD_GREEN : elapsedMs < 10000 ? "rgb(255, 200, 0)" : FLASHCARD_RED;
    if (timer.style.color !== color) {
      timer.style.color = color;
      timer.style.borderColor = color;
    }
  }

  function updateFlashcardTimer() {
    const session = flashcardsSession;
    const timer = document.querySelector("[data-lwr-flashcard-timer]");
    if (!session || !timer || session.finished || session.awaitingContinue) {
      return;
    }
    setFlashcardTimerDisplay(timer, performance.now() - session.cardShownAt);
  }

  function flashcardOverlayElements() {
    const overlay = document.getElementById(DUOLINGO_FLASHCARDS_OVERLAY_ID);
    if (!overlay) {
      return null;
    }
    return {
      overlay,
      progress: overlay.querySelector("[data-lwr-flashcard-progress]"),
      main: overlay.querySelector("[data-lwr-flashcard-main]"),
      footer: overlay.querySelector("[data-lwr-flashcard-footer]"),
      feedback: overlay.querySelector("[data-lwr-flashcard-feedback]"),
      action: overlay.querySelector("[data-lwr-flashcard-action]")
    };
  }

  function buildFlashcardOverlay() {
    // The overlay covers the page whole, so it has to bring its own copy of
    // the page's theme — otherwise a dark-mode session opens as a white flash
    // and the answer box has nothing dark to sit on.
    refreshDuolingoTheme();
    const theme = duolingoTheme();
    ensureDuolingoThemeStyle();

    const overlay = document.createElement("div");
    overlay.id = DUOLINGO_FLASHCARDS_OVERLAY_ID;
    overlay.dataset.lwrUi = "true";
    overlay.setAttribute("data-lwr-theme", duolingoThemeName);
    overlay.style.cssText = [
      "position: fixed",
      "inset: 0",
      "z-index: 2147483000",
      "display: flex",
      "flex-direction: column",
      `background: ${theme.surface}`,
      "font-family: 'duolingo-sans', -apple-system, sans-serif"
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText =
      "display: flex; align-items: center; gap: 16px; width: 100%; max-width: 720px; margin: 24px auto 0; padding: 0 24px; box-sizing: border-box";
    const quit = document.createElement("button");
    quit.type = "button";
    quit.textContent = "✕";
    quit.title = "End this flashcard session";
    quit.setAttribute("data-lwr-flashcard-quit", "");
    quit.style.cssText = `border: none; background: none; padding: 4px; color: ${theme.icon}; font-size: 22px; font-weight: 700; cursor: pointer`;
    quit.addEventListener("click", () => closeFlashcardOverlay());
    const track = document.createElement("div");
    track.setAttribute("data-lwr-flashcard-track", "");
    track.style.cssText = `flex: 1; height: 16px; border-radius: 8px; background: ${theme.inputBorder}; overflow: hidden`;
    const fill = document.createElement("div");
    fill.setAttribute("data-lwr-flashcard-progress", "");
    fill.style.cssText = `height: 100%; width: 0%; border-radius: 8px; background: ${FLASHCARD_GREEN}; transition: width 0.2s`;
    track.append(fill);
    header.append(quit, track);

    const main = document.createElement("div");
    main.setAttribute("data-lwr-flashcard-main", "");
    main.style.cssText =
      "flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 18px; width: 100%; max-width: 720px; margin: 0 auto; padding: 0 24px 24px; box-sizing: border-box";

    const footer = document.createElement("div");
    footer.setAttribute("data-lwr-flashcard-footer", "");
    footer.style.cssText = `border-top: 2px solid ${theme.surfaceBorder}`;
    const footerInner = document.createElement("div");
    footerInner.style.cssText =
      "display: flex; align-items: center; gap: 16px; width: 100%; max-width: 720px; margin: 0 auto; padding: 24px; box-sizing: border-box";
    const feedback = document.createElement("div");
    feedback.setAttribute("data-lwr-flashcard-feedback", "");
    feedback.style.cssText = "flex: 1; min-height: 44px";
    const action = duolingoFlashcardsPrimaryButton("Check");
    action.setAttribute("data-lwr-flashcard-action", "");
    action.addEventListener("click", () => handleFlashcardAction());
    footerInner.append(feedback, action);
    footer.append(footerInner);

    overlay.append(header, main, footer);
    document.body.append(overlay);
    // Window-capture so the extension sees keys before any Duolingo
    // document-level capture handlers; stopPropagation keeps Duolingo's own
    // shortcuts away from the session without cancelling text insertion.
    globalThis.addEventListener("keydown", handleFlashcardOverlayKeydown, true);
    flashcardsTimerInterval = setInterval(updateFlashcardTimer, 100);
  }

  // Only the overlay's shell needs repainting on a live theme flip: the card
  // body is rebuilt from scratch on every question, so it picks the palette up
  // on its own.
  function applyFlashcardOverlayTheme() {
    const overlay = document.getElementById(DUOLINGO_FLASHCARDS_OVERLAY_ID);
    if (!overlay || overlay.getAttribute("data-lwr-theme") === duolingoThemeName) {
      return;
    }
    const theme = duolingoTheme();
    overlay.setAttribute("data-lwr-theme", duolingoThemeName);
    overlay.style.background = theme.surface;
    const track = overlay.querySelector("[data-lwr-flashcard-track]");
    if (track) {
      track.style.background = theme.inputBorder;
    }
    const footer = overlay.querySelector("[data-lwr-flashcard-footer]");
    if (footer) {
      footer.style.borderTopColor = theme.surfaceBorder;
    }
    const input = overlay.querySelector("[data-lwr-flashcard-input]");
    if (input) {
      input.style.borderColor = theme.inputBorder;
      input.style.background = theme.inputSunkenBackground;
      input.style.color = theme.inputText;
    }
  }

  function closeFlashcardOverlay() {
    document.getElementById(DUOLINGO_FLASHCARDS_OVERLAY_ID)?.remove();
    globalThis.removeEventListener("keydown", handleFlashcardOverlayKeydown, true);
    if (flashcardsTimerInterval !== null) {
      clearInterval(flashcardsTimerInterval);
      flashcardsTimerInterval = null;
    }
    flashcardsSession = null;
    renderDuolingoFlashcardsPanel();
  }

  function handleFlashcardOverlayKeydown(event) {
    const overlay = document.getElementById(DUOLINGO_FLASHCARDS_OVERLAY_ID);
    if (!overlay || !flashcardsSession) {
      return;
    }

    if (event.key === "Escape") {
      event.stopPropagation();
      closeFlashcardOverlay();
      return;
    }

    if (event.key === "Enter") {
      event.stopPropagation();
      event.preventDefault();
      handleFlashcardAction();
      return;
    }

    if (event.target instanceof Element && overlay.contains(event.target)) {
      event.stopPropagation();
    }
  }

  function handleFlashcardAction() {
    const session = flashcardsSession;
    if (!session) {
      return;
    }
    if (session.finished) {
      closeFlashcardOverlay();
      return;
    }
    if (session.awaitingContinue) {
      session.awaitingContinue = false;
      session.position += 1;
      renderFlashcardSessionCard();
      return;
    }
    submitFlashcardAnswer();
  }

  function setFlashcardActionButton(action, label, { danger } = {}) {
    action.textContent = label;
    const background = danger ? FLASHCARD_RED : FLASHCARD_GREEN;
    const shadow = danger ? FLASHCARD_RED_SHADOW : FLASHCARD_GREEN_SHADOW;
    action.style.background = background;
    action.style.boxShadow = `0 4px 0 ${shadow}`;
  }

  function renderFlashcardSessionCard() {
    const session = flashcardsSession;
    const elements = flashcardOverlayElements();
    if (!session || !elements) {
      return;
    }

    if (session.position >= session.queue.length) {
      renderFlashcardSummary();
      return;
    }

    const item = session.queue[session.position];
    const profile = getCurrentProfile();
    const languageName = profile ? profile.name : "target language";
    const theme = duolingoTheme();

    elements.progress.style.width = `${Math.round((session.completed / session.total) * 100)}%`;
    elements.footer.style.background = "";
    elements.feedback.textContent = "";
    setFlashcardActionButton(elements.action, "Check");
    elements.main.textContent = "";

    const instructionRow = document.createElement("div");
    instructionRow.style.cssText =
      "display: flex; align-items: center; justify-content: space-between; gap: 16px";
    const instruction = document.createElement("h2");
    instruction.textContent =
      item.direction === "tg2en"
        ? "Type the English meaning"
        : `Type the ${languageName} word`;
    instruction.style.cssText = `margin: 0; font-size: 24px; font-weight: 700; color: ${theme.surfaceText}`;
    const timer = document.createElement("span");
    timer.setAttribute("data-lwr-flashcard-timer", "");
    timer.style.cssText = [
      "flex: none",
      "padding: 4px 14px",
      "border: 2px solid",
      "border-radius: 999px",
      "font-size: 15px",
      "font-weight: 700",
      "font-variant-numeric: tabular-nums"
    ].join(";");
    setFlashcardTimerDisplay(timer, 0);
    instructionRow.append(instruction, timer);

    const prompt = document.createElement("div");
    prompt.setAttribute("data-lwr-flashcard-prompt", "");
    prompt.textContent =
      item.direction === "tg2en"
        ? item.card.alternates.join(" / ")
        : item.card.meanings.join(", ");
    prompt.style.cssText = "font-size: 30px; font-weight: 700; color: rgb(28, 176, 246)";

    const form = document.createElement("form");
    form.style.cssText = "display: flex";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitFlashcardAnswer();
    });
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    input.placeholder =
      item.direction === "tg2en" ? "Type the meaning in English" : `Type it in ${languageName}`;
    input.setAttribute("data-lwr-flashcard-input", "");
    input.setAttribute("data-lwr-input", "");
    input.style.cssText = [
      "flex: 1",
      "box-sizing: border-box",
      "padding: 14px 16px",
      `border: 2px solid ${theme.inputBorder}`,
      "border-radius: 12px",
      `background: ${theme.inputSunkenBackground}`,
      `color: ${theme.inputText}`,
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "font-size: 19px",
      "outline: none"
    ].join(";");
    form.append(input);

    elements.main.append(instructionRow, prompt, form);
    session.retryUsed = false;
    session.cardShownAt = performance.now();
    input.focus();
  }

  function submitFlashcardAnswer() {
    const session = flashcardsSession;
    const elements = flashcardOverlayElements();
    if (!session || !elements || session.awaitingContinue || session.finished) {
      return;
    }

    const input = elements.overlay.querySelector("[data-lwr-flashcard-input]");
    if (!input || !input.value.trim()) {
      return;
    }

    const item = session.queue[session.position];
    const recallMs = Math.max(0, performance.now() - session.cardShownAt);
    const grade = gradeFlashcardAnswer(item, input.value);

    // Only a NEAR miss earns one more attempt before the card is graded: no
    // answer reveal, no stats yet, timer keeps running, the input stays live
    // for another try. An answer that isn't recognizably the word grades
    // wrong immediately.
    if (grade === "close" && !session.retryUsed) {
      session.retryUsed = true;
      elements.footer.style.background = "rgb(255, 244, 209)";
      elements.feedback.textContent = "";
      const retryTitle = document.createElement("div");
      retryTitle.textContent = "Not quite — one more try!";
      retryTitle.style.cssText = "font-size: 19px; font-weight: 700; color: rgb(205, 138, 0)";
      const retryHint = document.createElement("div");
      retryHint.textContent = "Check your spelling and check again.";
      retryHint.style.cssText = "margin-top: 4px; font-size: 15px; color: rgb(205, 138, 0)";
      elements.feedback.append(retryTitle, retryHint);
      input.focus();
      input.select();
      return;
    }

    const correct = grade === "correct" || grade === "typo";

    // Only the first look at a card counts toward stored stats; the requeued
    // retries at the end of the session are practice, not measurement.
    const resultKey = `${item.direction}:${item.card.wordKey}`;
    if (!session.results.has(resultKey)) {
      session.results.set(resultKey, {
        card: item.card,
        direction: item.direction,
        firstTryCorrect: correct,
        recallMs
      });
      updateFlashcardRecord(item.direction, item.card.wordKey, correct, recallMs);
    }

    if (correct) {
      session.completed += 1;
    } else {
      session.queue.push({ ...item, retry: true });
    }
    session.awaitingContinue = true;
    input.disabled = true;

    // Freeze the on-card timer at the graded recall time.
    const timer = elements.overlay.querySelector("[data-lwr-flashcard-timer]");
    if (timer) {
      setFlashcardTimerDisplay(timer, recallMs);
    }

    const theme = duolingoTheme();
    elements.progress.style.width = `${Math.round((session.completed / session.total) * 100)}%`;
    elements.footer.style.background = correct ? theme.correctBanner : theme.wrongBanner;
    elements.feedback.textContent = "";
    const verdictColor = correct ? theme.correctText : theme.wrongText;
    const title = document.createElement("div");
    title.textContent =
      grade === "typo" ? "You have a typo" : correct ? "Nice!" : "Correct answer:";
    title.style.cssText = `font-size: 19px; font-weight: 700; color: ${verdictColor}`;
    const answer = document.createElement("div");
    answer.textContent = correct
      ? `${flashcardCorrectAnswerText(item)} — ${formatFlashcardRecallMs(recallMs)}`
      : flashcardCorrectAnswerText(item);
    answer.style.cssText = `margin-top: 4px; font-size: 15px; color: ${verdictColor}`;
    elements.feedback.append(title, answer);
    setFlashcardActionButton(elements.action, "Continue", { danger: !correct });
  }

  function renderFlashcardSummary() {
    const session = flashcardsSession;
    const elements = flashcardOverlayElements();
    if (!session || !elements) {
      return;
    }

    session.finished = true;
    session.awaitingContinue = false;
    elements.progress.style.width = "100%";
    elements.footer.style.background = "";
    elements.feedback.textContent = "";
    setFlashcardActionButton(elements.action, "Finish");
    elements.main.textContent = "";

    const results = [...session.results.values()];
    const firstTryCorrect = results.filter((result) => result.firstTryCorrect);
    const missed = results.filter((result) => !result.firstTryCorrect);
    const averageRecallMs = firstTryCorrect.length
      ? firstTryCorrect.reduce((sum, result) => sum + result.recallMs, 0) / firstTryCorrect.length
      : 0;

    const theme = duolingoTheme();
    const title = document.createElement("h2");
    title.setAttribute("data-lwr-flashcard-summary", "");
    title.textContent = "Session complete!";
    title.style.cssText = `margin: 0; font-size: 28px; font-weight: 700; color: ${theme.surfaceText}`;

    const score = document.createElement("div");
    score.textContent = `${firstTryCorrect.length} / ${results.length} correct on the first try`;
    score.style.cssText = `font-size: 19px; font-weight: 700; color: ${
      missed.length ? "rgb(255, 200, 0)" : FLASHCARD_GREEN
    }`;
    elements.main.append(title, score);

    if (firstTryCorrect.length) {
      const speed = document.createElement("div");
      speed.textContent = `Average recall time: ${formatFlashcardRecallMs(averageRecallMs)}`;
      speed.style.cssText = `font-size: 15px; color: ${theme.surfaceMutedText}`;
      elements.main.append(speed);
    }

    if (missed.length) {
      const missedTitle = document.createElement("div");
      missedTitle.textContent = "Words to review:";
      missedTitle.style.cssText = `margin-top: 10px; font-size: 15px; font-weight: 700; color: ${theme.surfaceText}`;
      elements.main.append(missedTitle);
      for (const result of missed) {
        const row = document.createElement("div");
        row.textContent = `${result.card.alternates.join(" / ")} — ${result.card.meanings.join(", ")}`;
        row.style.cssText = `font-size: 15px; color: ${theme.surfaceMutedText}`;
        elements.main.append(row);
      }
    }
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
  // Grouped so the panel reads as sections instead of one long list. Every
  // group keeps its own heading; the rows inside are the stored setting keys.
  const DUOLINGO_SETTINGS_GROUPS = [
    {
      title: "Translation",
      rows: [
        { key: "enabled", label: "Enable replacements", description: "Replace the words you have learned on every website" },
        { key: "fullTranslation", label: "Translate the whole page", description: "Put every sentence into the target language instead of only the words you have learned, and never swap English back in — hover a word for its English" },
        { key: "structureMode", label: "Target-language sentence structure", description: "Rebuild sentences in the target language's word order", supersededBy: "fullTranslation" },
        { key: "targetLanguagePages", label: "Read target-language pages", description: "On pages already in the target language, swap the words you have not learned into English", supersededBy: "fullTranslation" }
      ]
    },
    {
      title: "On the page",
      rows: [
        { key: "showHighlights", label: "Highlight replacements", description: "Underline replaced words on pages" },
        { key: "hideTextUntilTranslated", label: "Hide text until translated", description: "While a page is loading, keep its sections blank until their translations are painted in" },
        { key: "showProcessedSections", label: "Mark checked sections", description: "Show a small fox beside sections that were checked but had nothing to replace" }
      ]
    },
    {
      title: "Hovering a word",
      rows: [
        { key: "showOriginalOnHover", label: "Show original English on hover", description: "Show the original English when hovering a replaced word" },
        { key: "translateEnglishOnHover", label: "Translate English on hover", description: "Translate English words when hovering them" }
      ]
    },
    {
      title: "Duolingo lessons",
      rows: [
        { key: "duolingoAutoContinue", label: "Skip continue screens", description: "Press Continue for you and show the result as a brief popup" },
        { key: "duolingoTypeAnswers", label: "Type answers", description: "Type answers with hints on word-bank, audio-match and meaning exercises" },
        { key: "duolingoCopyPhrase", label: "Copy phrases", description: "Add a copy button to the exercise phrase, and copy it with ⌘C or Ctrl+C while typing" },
        { key: "duolingoLowercaseBank", label: "Lowercase word-bank words", description: "Take the capital off the word bank, so the first word of the sentence is not given away" },
        { key: "duolingoDecoyWords", label: "Add misspelled decoys", description: "Slip near-miss spellings into the word bank so the right word has to be known, not spotted" }
      ]
    }
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
    heading.style.marginBottom = "8px";
    panel.append(heading);

    const sections = [
      ...DUOLINGO_SETTINGS_GROUPS.map(buildDuolingoSettingsGroup),
      buildDuolingoExclusionSection(),
      buildDuolingoFileSection()
    ];
    panel.append(...sections);
    return panel;
  }

  function buildDuolingoSettingsGroup(group) {
    const section = duolingoPanelSection(group.title);
    for (const row of group.rows) {
      section.append(buildDuolingoSettingsRow(row));
    }
    return section;
  }

  function buildDuolingoSettingsRow(row) {
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
    if (row.supersededBy) {
      // Sync greys the row out while the setting that overrides it is on, so a
      // toggle that currently does nothing never looks like it does.
      checkbox.setAttribute("data-lwr-superseded-by", row.supersededBy);
    }
    checkbox.style.cssText =
      "width: 22px; height: 22px; flex: none; accent-color: rgb(28, 176, 246); cursor: pointer";
    checkbox.addEventListener("change", () => {
      state = { ...state, [row.key]: checkbox.checked };
      chrome.storage.local.set({ [STORAGE_KEY]: state });
    });

    label.append(text, checkbox);
    return label;
  }

  function duolingoPanelSection(title) {
    // Every panel section — setting groups included — is a <section> with the
    // same heading and spacing, so the whole panel keeps one rhythm.
    const section = document.createElement("section");
    section.style.marginTop = "28px";
    section.append(duolingoPanelSectionHeading(title));
    return section;
  }

  function duolingoPanelSectionHeading(text) {
    const heading = document.createElement("h2");
    heading.textContent = text;
    heading.style.cssText =
      "margin: 0 0 4px; font-family: 'duolingo-sans', -apple-system, sans-serif; font-size: 13px; font-weight: 700; letter-spacing: 0.8px; text-transform: uppercase; color: rgb(150, 150, 150)";
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
    const section = duolingoPanelSection("Do not translate");

    const list = document.createElement("div");
    list.setAttribute("data-lwr-exclusion-list", "");
    section.append(list);
    return section;
  }

  function buildDuolingoFileSection() {
    const section = duolingoPanelSection("Vocabulary files");

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

      const supersededBy = checkbox.getAttribute("data-lwr-superseded-by");
      const superseded = Boolean(supersededBy && state[supersededBy]);
      checkbox.disabled = superseded;
      const row = checkbox.closest("label");
      if (row) {
        row.style.opacity = superseded ? "0.45" : "";
        row.style.cursor = superseded ? "default" : "pointer";
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
    holdCloak();
    chrome.storage.local.get(
      { [STORAGE_KEY]: DEFAULT_STATE, [FLASHCARDS_STORAGE_KEY]: DEFAULT_FLASHCARDS_STATE },
      (stored) => {
        state = normalizeState(stored[STORAGE_KEY]);
        flashcardsState = normalizeFlashcardsState(stored[FLASHCARDS_STORAGE_KEY]);
        // Start the translator spin-up now so it overlaps the DOM walk that
        // applyToPage does before it needs the translator.
        warmContextTranslator();
        syncDuolingoAutoContinue();
        syncDuolingoTypeAnswers();
        syncDuolingoCopyPhrase();
        syncDuolingoBankTraps();
        syncDuolingoPageUi();
        applyToPage();
      }
    );
  }

  globalThis[REFRESH_KEY] = loadState;

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") {
      return;
    }

    if (changes[FLASHCARDS_STORAGE_KEY]) {
      // Another tab (or an import) rewrote the practice stats; refresh the
      // strength dashboard if it is on screen.
      flashcardsState = normalizeFlashcardsState(changes[FLASHCARDS_STORAGE_KEY].newValue);
      renderDuolingoFlashcardsPanel();
    }

    if (!changes[STORAGE_KEY]) {
      return;
    }

    state = normalizeState(changes[STORAGE_KEY].newValue);
    syncDuolingoAutoContinue();
    syncDuolingoTypeAnswers();
    syncDuolingoCopyPhrase();
    syncDuolingoBankTraps();
    syncDuolingoSettingsPanelValues();
    ensureDuolingoWordsInfo();
    ensureDuolingoWordsTabs();
    ensureDuolingoLogoBadge();
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
