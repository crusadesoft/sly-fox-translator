// The saved state: settings, language profiles, vocabulary entries, and the
// do-not-translate lists.
//
// This is the overlap between the two halves. The translation modules read the
// current profile to know what to look for; the Duolingo modules read and write
// the same profile when you import or edit words. Everything here is about
// getting a trustworthy answer out of whatever storage handed back, including
// states written by older versions.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

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

  // Replaced wholesale by boot.js on load and on every storage change, so it
  // lives on the namespace where every module sees the current object.
  LWR.state = DEFAULT_STATE;

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
      profile.name === "Default" && LWR.LANGUAGE_NAMES[languageCode]
        ? LWR.LANGUAGE_NAMES[languageCode]
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
      LWR.state.profiles.find((candidate) => candidate.id === LWR.state.currentProfileId) ||
      LWR.state.profiles[0] ||
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
    return Boolean(LWR.state.enabled && LWR.compiledEntries.length);
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

    const exclusions = LWR.state.doNotTranslate || { sites: [], pages: [] };
    if (exclusions.sites.includes(site)) {
      return { type: "site", value: site };
    }
    if (exclusions.pages.includes(page)) {
      return { type: "page", value: page };
    }
    return null;
  }

  function createId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    DEFAULT_STATE,
    normalizeState,
    getCurrentProfile,
    getCurrentEntries,
    getCurrentLanguageCode,
    hasActivePageReplacementFeatures,
    isTextAlreadyInTargetLanguage,
    getTranslationExclusion,
    createId
  });
})();
