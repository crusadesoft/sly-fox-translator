const STORAGE_KEY = "learnedWordReplacerState";
const LEGACY_DEFAULT_PROFILE_ID = "default";
const LEGACY_DEFAULT_PROFILE_NAME = "Default";
const BUILT_IN_PROFILES_VERSION = 5;
const DICTIONARIES = globalThis.LEARNED_WORD_DICTIONARIES || {};
// Current Duolingo target courses that Chrome's Translator API supports from English.
// English itself is omitted because this extension replaces English page text.
const BUILT_IN_LANGUAGES = [
  { code: "es", name: "Spanish", flag: "es" },
  { code: "el", name: "Greek", flag: "gr" },
  { code: "fr", name: "French", flag: "fr" },
  { code: "de", name: "German", flag: "de" },
  { code: "it", name: "Italian", flag: "it" },
  { code: "uk", name: "Ukrainian", flag: "ua" },
  { code: "ar", name: "Arabic", flag: "sa" },
  { code: "cs", name: "Czech", flag: "cz" },
  { code: "hi", name: "Hindi", flag: "in" },
  { code: "hu", name: "Hungarian", flag: "hu" },
  { code: "id", name: "Indonesian", flag: "id" },
  { code: "ja", name: "Japanese", flag: "jp" },
  { code: "ko", name: "Korean", flag: "kr" },
  { code: "nl", name: "Dutch", flag: "nl" },
  { code: "pl", name: "Polish", flag: "pl" },
  { code: "pt", name: "Portuguese", flag: "pt" },
  { code: "ro", name: "Romanian", flag: "ro" },
  { code: "ru", name: "Russian", flag: "ru" },
  { code: "tr", name: "Turkish", flag: "tr" },
  { code: "vi", name: "Vietnamese", flag: "vn" },
  { code: "zh", name: "Chinese", flag: "cn" }
];
const LANGUAGE_BY_CODE = new Map(BUILT_IN_LANGUAGES.map((language) => [language.code, language]));
const LANGUAGE_OPTIONS = [
  { code: "", name: "None" },
  ...BUILT_IN_LANGUAGES.map(({ code, name }) => ({ code, name }))
];
const LANGUAGE_ICON_PATHS = Object.fromEntries(
  BUILT_IN_LANGUAGES.map(({ code, flag }) => [code, `icons/languages/flags/${flag}.svg`])
);
Object.assign(LANGUAGE_ICON_PATHS, {
  la: "icons/languages/flags/va.svg",
  unknown: "icons/languages/flags/va.svg"
});
const RETIRED_BUILT_IN_PROFILE_IDS = new Set(["builtin-la"]);
const BUILT_IN_PROFILES = BUILT_IN_LANGUAGES.map(({ code, name }) => ({
  id: `builtin-${code}`,
  name,
  languageCode: code,
  entries: []
}));
const BUILT_IN_PROFILE_BY_ID = new Map(BUILT_IN_PROFILES.map((profile) => [profile.id, profile]));
const WIKIDATA_API_URL = "https://www.wikidata.org/w/api.php";
const DUOLINGO_WORDS_URL = "https://www.duolingo.com/practice-hub/words";
const wikidataSuggestionCache = new Map();
let suggestionRequestId = 0;

const DEFAULT_STATE = {
  version: 2,
  enabled: true,
  showHighlights: true,
  wholeWords: true,
  caseSensitive: false,
  preserveCase: true,
  currentProfileId: "",
  builtInProfilesVersion: 0,
  deletedBuiltInProfileIds: [],
  doNotTranslate: {
    sites: [],
    pages: []
  },
  profiles: []
};

const pageParams = new URLSearchParams(window.location.search);
const isTabView = pageParams.get("view") === "tab";
const isSidePanelView = pageParams.get("view") === "sidepanel";
const shouldAutoImport = pageParams.get("import") === "1";
document.body.classList.toggle("tab-view", isTabView);
document.body.classList.toggle("side-panel-view", isSidePanelView);

const elements = {
  enabled: document.getElementById("enabled"),
  openTab: document.getElementById("open-tab"),
  settingsViewTab: document.getElementById("settings-view-tab"),
  vocabularyView: document.getElementById("vocabulary-view"),
  settingsView: document.getElementById("settings-view"),
  entryCount: document.getElementById("entry-count"),
  profileSelect: document.getElementById("profile-select"),
  languagePicker: document.getElementById("language-picker"),
  languageTrigger: document.getElementById("language-trigger"),
  languageTriggerIcon: document.getElementById("language-trigger-icon"),
  languageTriggerLabel: document.getElementById("language-trigger-label"),
  languageOptions: document.getElementById("language-options"),
  manualSection: document.getElementById("manual-section"),
  duolingoSection: document.getElementById("duolingo-section"),
  duolingoSectionLabel: document.getElementById("duolingo-section-label"),
  vocabularyLanguageHint: document.getElementById("vocabulary-language-hint"),
  manualEntryPanel: document.getElementById("manual-entry-panel"),
  duolingoPanel: document.getElementById("duolingo-panel"),
  duolingoSync: document.getElementById("duolingo-sync"),
  duolingoSyncLabel: document.getElementById("duolingo-sync-label"),
  duolingoSyncStatus: document.getElementById("duolingo-sync-status"),
  form: document.getElementById("entry-form"),
  source: document.getElementById("source"),
  target: document.getElementById("target"),
  suggestReplacement: document.getElementById("suggest-replacement"),
  suggestions: document.getElementById("suggestions"),
  suggestionTitle: document.getElementById("suggestion-title"),
  suggestionList: document.getElementById("suggestion-list"),
  submitEntry: document.getElementById("submit-entry"),
  cancelEdit: document.getElementById("cancel-edit"),
  showHighlights: document.getElementById("show-highlights"),
  runtimePanel: document.getElementById("page-status-panel"),
  runtimeTitle: document.getElementById("runtime-title"),
  runtimeStatus: document.getElementById("runtime-status"),
  runtimeRetry: document.getElementById("runtime-retry"),
  doNotTranslateActions: document.getElementById("do-not-translate-actions"),
  excludePage: document.getElementById("exclude-page"),
  excludePageLabel: document.getElementById("exclude-page-label"),
  excludeSite: document.getElementById("exclude-site"),
  excludeSiteLabel: document.getElementById("exclude-site-label"),
  search: document.getElementById("search"),
  sortAlpha: document.getElementById("sort-alpha"),
  deleteAll: document.getElementById("delete-all"),
  pageSize: document.getElementById("page-size"),
  emptyState: document.getElementById("empty-state"),
  compactVocabularyList: document.getElementById("compact-vocabulary-list"),
  tableWrap: document.getElementById("table-wrap"),
  entryTable: document.getElementById("entry-table"),
  pager: document.getElementById("pager"),
  prevPage: document.getElementById("prev-page"),
  nextPage: document.getElementById("next-page"),
  pageStatus: document.getElementById("page-status"),
  bulkPanel: document.getElementById("bulk-panel"),
  bulkFile: document.getElementById("bulk-file"),
  importStatus: document.getElementById("import-status"),
  importButton: document.getElementById("import"),
  exportButton: document.getElementById("export"),
  clearAllButton: document.getElementById("clear-all"),
  doNotTranslatePanel: document.getElementById("do-not-translate-panel"),
  doNotTranslateList: document.getElementById("do-not-translate-list"),
  clearDoNotTranslate: document.getElementById("clear-do-not-translate")
};

elements.openTab.appendChild(makeIcon("square-arrow-out-up-right"));
elements.sortAlpha.appendChild(makeIcon("arrow-up-a-z"));

let state = { ...DEFAULT_STATE };
let editingId = null;
let currentPage = 1;
let searchQuery = "";
let pendingDefinition = "";
let autoImportHandled = false;
let deleteAllPending = false;
let deleteAllTimer = null;
let runtimePollTimer = null;
let duolingoSyncInProgress = false;
let duolingoSyncNeedsAction = false;
let vocabularySection = "duolingo";
let appSection = "vocabulary";
let activeTabStatusRequestId = 0;
let duolingoAvailabilityRequestId = 0;

function createId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function normalizeEntries(entries) {
  return Array.isArray(entries)
    ? entries
        .map((entry) => ({
          id: String(entry.id || createId()),
          source: String(entry.source || "").trim(),
          target: String(entry.target || "").trim(),
          learned: true,
          enabled: entry.enabled !== false,
          languageCode: String(entry.languageCode || ""),
          definition: String(entry.definition || "").trim(),
          origin: getEntryOrigin(entry),
          createdAt: Number(entry.createdAt || Date.now())
        }))
        .filter((entry) => entry.source && entry.target && !isInvalidDuolingoImportEntry(entry))
    : [];
}

function getEntryOrigin(entry) {
  return entry?.origin === "duolingo" || String(entry?.definition || "").startsWith("Duolingo meanings:")
    ? "duolingo"
    : "manual";
}

function isInvalidDuolingoImportEntry(entry) {
  return (
    String(entry.definition || "").startsWith("Duolingo meanings:") &&
    isInvalidDuolingoSource(entry.source, entry.definition)
  );
}

function inferLanguageCode(name) {
  const normalizedName = String(name || "").trim().toLocaleLowerCase();
  const nameTokens = normalizedName.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const match =
    LANGUAGE_OPTIONS.find(
      (option) => option.code && option.name.toLocaleLowerCase() === normalizedName
    ) ||
    LANGUAGE_OPTIONS.find(
      (option) =>
        option.code &&
        (normalizedName.includes(option.name.toLocaleLowerCase()) ||
          nameTokens.includes(option.code.toLocaleLowerCase()))
    );

  return match ? match.code : "";
}

function getLanguageName(languageCode) {
  return LANGUAGE_BY_CODE.get(languageCode)?.name || DICTIONARIES[languageCode]?.name || languageCode;
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

function normalizeProfile(profile, index) {
  const name = String(profile.name || `Profile ${index + 1}`).trim() || `Profile ${index + 1}`;
  const id = String(profile.id || createId());
  const entries = normalizeEntries(profile.entries);
  const inferredEntryLanguageCode = inferLanguageCodeFromEntries(entries);
  const languageCode = String(
    inferredEntryLanguageCode || profile.languageCode || inferLanguageCode(name)
  );
  const normalized = {
    id,
    name:
      languageCode && name === LEGACY_DEFAULT_PROFILE_NAME
        ? getLanguageName(languageCode)
        : name,
    languageCode,
    entries
  };
  const builtInProfile = BUILT_IN_PROFILE_BY_ID.get(id);

  const finalProfile = builtInProfile
    ? {
        ...normalized,
        name: builtInProfile.name,
        languageCode: builtInProfile.languageCode
      }
    : normalized;

  return {
    ...finalProfile,
    entries: finalProfile.entries.map((entry) => ({
      ...entry,
      languageCode: finalProfile.languageCode
    }))
  };
}

function removeEmptyDuplicateLanguageProfiles(profiles) {
  const languagesWithEntries = new Set(
    profiles
      .filter((profile) => profile.languageCode && profile.entries.length)
      .map((profile) => profile.languageCode)
  );

  return profiles.filter(
    (profile) =>
      profile.entries.length ||
      !profile.languageCode ||
      !languagesWithEntries.has(profile.languageCode)
  );
}

function removeEmptyLegacyDefaultProfile(profiles) {
  return profiles.filter(
    (profile) =>
      profile.entries.length ||
      (profile.id !== LEGACY_DEFAULT_PROFILE_ID &&
        (profile.name !== LEGACY_DEFAULT_PROFILE_NAME || profile.languageCode))
  );
}

function removeEmptyRetiredBuiltInProfiles(profiles) {
  return profiles.filter(
    (profile) => !RETIRED_BUILT_IN_PROFILE_IDS.has(profile.id) || profile.entries.length > 0
  );
}

function ensureBuiltInProfiles(profiles, deletedBuiltInProfileIds) {
  const deletedIds = new Set(deletedBuiltInProfileIds || []);
  const existingNames = new Set(profiles.map((profile) => profile.name.toLocaleLowerCase()));
  const existingLanguages = new Set(
    profiles.map((profile) => profile.languageCode).filter((languageCode) => languageCode)
  );
  const additions = BUILT_IN_PROFILES.filter((profile) => {
    return (
      !deletedIds.has(profile.id) &&
      !existingNames.has(profile.name.toLocaleLowerCase()) &&
      !existingLanguages.has(profile.languageCode)
    );
  });

  return [...profiles, ...additions.map((profile) => ({ ...profile, entries: [] }))];
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
    ).sort((left, right) => left.localeCompare(right)),
    pages: Array.from(
      new Set((Array.isArray(source.pages) ? source.pages : []).map(normalizeExcludedPage).filter(Boolean))
    ).sort((left, right) => left.localeCompare(right))
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
  next.doNotTranslate = normalizeDoNotTranslate(source.doNotTranslate);

  if (Array.isArray(source.profiles)) {
    next.profiles = source.profiles.map(normalizeProfile).filter((profile) => profile.name);
  } else {
    const legacyEntries = normalizeEntries(source.entries);
    next.profiles = legacyEntries.length
      ? [
          {
            id: LEGACY_DEFAULT_PROFILE_ID,
            name: LEGACY_DEFAULT_PROFILE_NAME,
            languageCode: "",
            entries: legacyEntries
          }
        ]
      : [];
  }

  next.deletedBuiltInProfileIds = Array.isArray(source.deletedBuiltInProfileIds)
    ? source.deletedBuiltInProfileIds.map(String)
    : [];

  next.profiles = removeEmptyLegacyDefaultProfile(next.profiles);
  next.profiles = removeEmptyRetiredBuiltInProfiles(next.profiles);

  if (Number(source.builtInProfilesVersion || 0) < BUILT_IN_PROFILES_VERSION) {
    next.profiles = ensureBuiltInProfiles(next.profiles, next.deletedBuiltInProfileIds);
    next.builtInProfilesVersion = BUILT_IN_PROFILES_VERSION;
  }

  const ids = new Set();
  next.profiles = next.profiles.map((profile) => {
    let id = profile.id;
    if (ids.has(id)) {
      id = createId();
    }
    ids.add(id);
    return { ...profile, id };
  });

  const savedCurrentProfileId = String(source.currentProfileId || "");
  const savedCurrentProfile = Array.isArray(source.profiles)
    ? source.profiles.find((profile) => String(profile.id || "") === savedCurrentProfileId)
    : null;
  const savedCurrentLanguageCode = String(savedCurrentProfile?.languageCode || "");
  const builtInCurrentProfile = BUILT_IN_PROFILE_BY_ID.get(savedCurrentProfileId);

  if (
    builtInCurrentProfile &&
    savedCurrentLanguageCode &&
    savedCurrentLanguageCode !== builtInCurrentProfile.languageCode
  ) {
    const matchingLanguageProfile = next.profiles.find(
      (profile) =>
        profile.id !== savedCurrentProfileId &&
        profile.languageCode === savedCurrentLanguageCode
    );

    if (matchingLanguageProfile) {
      next.currentProfileId = matchingLanguageProfile.id;
    }
  }

  next.profiles = removeEmptyDuplicateLanguageProfiles(next.profiles);
  next.profiles = removeEmptyLegacyDefaultProfile(next.profiles);
  next.profiles = removeEmptyRetiredBuiltInProfiles(next.profiles);

  if (!next.profiles.some((profile) => profile.id === next.currentProfileId)) {
    next.currentProfileId = next.profiles[0]?.id || "";
  }

  delete next.entries;
  return next;
}

function hasStateChanged(rawState, normalizedState) {
  try {
    return JSON.stringify(rawState || {}) !== JSON.stringify(normalizedState);
  } catch (error) {
    return true;
  }
}

function persistNormalizedState(rawState) {
  if (hasStateChanged(rawState, state)) {
    chrome.storage.local.set({ [STORAGE_KEY]: state });
  }
}

function loadState() {
  chrome.storage.local.get({ [STORAGE_KEY]: DEFAULT_STATE }, (stored) => {
    const rawState = stored[STORAGE_KEY];
    state = normalizeState(rawState);
    persistNormalizedState(rawState);
    render();
    initializeImportPanel();
  });
}

function saveState(afterSave) {
  chrome.storage.local.set({ [STORAGE_KEY]: state }, () => {
    render();
    if (typeof afterSave === "function") {
      afterSave();
    }
  });
}

function syncStoredState(rawState) {
  const previousProfileId = state.currentProfileId;

  state = normalizeState(rawState);
  persistNormalizedState(rawState);

  if (previousProfileId !== state.currentProfileId) {
    resetProfileScopedUi();
  }

  render();
  initializeImportPanel();
}

function getCurrentProfile() {
  const currentProfile =
    state.profiles.find((profile) => profile.id === state.currentProfileId) ||
    state.profiles[0];

  if (!currentProfile) {
    throw new Error("No supported languages are configured.");
  }

  return currentProfile;
}

function getCurrentEntries() {
  return getCurrentProfile().entries;
}

function updateCurrentProfile(patch) {
  const currentProfile = getCurrentProfile();
  state.profiles = state.profiles.map((profile) =>
    profile.id === currentProfile.id ? { ...profile, ...patch } : profile
  );
}

function updateCurrentEntries(entries) {
  updateCurrentProfile({ entries });
}

function sortEntries(entries) {
  return [...entries].sort((a, b) => {
    const sourceCompare = a.source.localeCompare(b.source, undefined, { sensitivity: "base" });
    return sourceCompare || a.target.localeCompare(b.target, undefined, { sensitivity: "base" });
  });
}

function getFilteredEntries() {
  const entries = getEntriesForSection();
  const query = searchQuery.trim().toLocaleLowerCase();

  if (!query) {
    return [...entries];
  }

  return entries.filter((entry) => {
    return (
      entry.source.toLocaleLowerCase().includes(query) ||
      entry.target.toLocaleLowerCase().includes(query)
    );
  });
}

function getEntriesForSection(section = vocabularySection) {
  return getCurrentEntries().filter((entry) => getEntryOrigin(entry) === section);
}

function renderVocabularySections(manualEntries, duolingoEntries) {
  const manualActive = vocabularySection === "manual";
  elements.manualSection.textContent = `Manual (${manualEntries.length})`;
  elements.duolingoSectionLabel.textContent = `Duolingo (${duolingoEntries.length})`;
  elements.manualSection.setAttribute("aria-pressed", String(manualActive));
  elements.duolingoSection.setAttribute("aria-pressed", String(!manualActive));
  elements.manualEntryPanel.classList.toggle("hidden", !manualActive);
  elements.duolingoPanel.classList.toggle("hidden", manualActive);
  elements.search.placeholder = manualActive ? "Search manual words" : "Search Duolingo words";
  elements.emptyState.textContent = manualActive ? "Add a manual word or phrase." : "No Duolingo words synced.";
}

function renderAppSection() {
  const vocabularyActive = appSection === "vocabulary";
  elements.settingsViewTab.setAttribute("aria-pressed", String(!vocabularyActive));
  elements.settingsViewTab.setAttribute("aria-label", vocabularyActive ? "Settings" : "Close settings");
  elements.settingsViewTab.title = vocabularyActive ? "Settings" : "Close settings";
  elements.vocabularyView.classList.toggle("hidden", !vocabularyActive);
  elements.settingsView.classList.toggle("hidden", vocabularyActive);
}

function switchAppSection(section) {
  if (section !== "vocabulary" && section !== "settings") {
    return;
  }

  appSection = section;
  closeLanguageMenu();
  renderAppSection();
}

function switchVocabularySection(section) {
  if (section !== "manual" && section !== "duolingo") {
    return;
  }

  vocabularySection = section;
  currentPage = 1;
  searchQuery = "";
  cancelDeleteAllConfirmation();
  stopEdit();
  clearSuggestions();
  render();
}

function getPageSize() {
  return Number(elements.pageSize.value) || 25;
}

function renderProfileOptions() {
  elements.profileSelect.textContent = "";
  elements.languageOptions.textContent = "";
  const currentProfile = getCurrentProfile();

  for (const profile of state.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = profile.name;
    option.selected = profile.id === state.currentProfileId;
    elements.profileSelect.appendChild(option);

    const languageOption = document.createElement("button");
    const languageName = document.createElement("span");
    const check = makeIcon("check");
    const selected = profile.id === state.currentProfileId;

    languageOption.type = "button";
    languageOption.className = "language-option";
    languageOption.dataset.profileId = profile.id;
    languageOption.setAttribute("role", "option");
    languageOption.setAttribute("aria-selected", String(selected));
    languageOption.tabIndex = selected ? 0 : -1;
    languageName.textContent = profile.name;
    check.classList.add("language-option-check");
    languageOption.append(makeLanguageIcon(profile.languageCode), languageName, check);
    languageOption.addEventListener("click", () => selectLanguageProfile(profile.id));
    languageOption.addEventListener("keydown", handleLanguageOptionKeydown);
    elements.languageOptions.appendChild(languageOption);
  }

  elements.languageTriggerIcon.src = getLanguageIconPath(currentProfile.languageCode);
  elements.languageTriggerLabel.textContent = currentProfile.name;
  elements.vocabularyLanguageHint.textContent =
    `Before you add words, make sure ${currentProfile.name} is the language you want.`;
  closeLanguageMenu();
}

function getLanguageIconPath(languageCode) {
  return LANGUAGE_ICON_PATHS[languageCode] || LANGUAGE_ICON_PATHS.unknown;
}

function makeLanguageIcon(languageCode) {
  const icon = document.createElement("img");
  icon.className = "language-icon";
  icon.src = getLanguageIconPath(languageCode);
  icon.alt = "";
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function getLanguageOptionButtons() {
  return Array.from(elements.languageOptions.querySelectorAll(".language-option"));
}

function openLanguageMenu({ focusSelected = false } = {}) {
  elements.languageOptions.classList.remove("hidden");
  elements.languageTrigger.setAttribute("aria-expanded", "true");

  if (focusSelected) {
    const selectedOption = elements.languageOptions.querySelector('[aria-selected="true"]');
    selectedOption?.focus();
  }
}

function closeLanguageMenu({ restoreFocus = false } = {}) {
  elements.languageOptions.classList.add("hidden");
  elements.languageTrigger.setAttribute("aria-expanded", "false");

  if (restoreFocus) {
    elements.languageTrigger.focus();
  }
}

function toggleLanguageMenu() {
  if (elements.languageTrigger.getAttribute("aria-expanded") === "true") {
    closeLanguageMenu();
  } else {
    openLanguageMenu();
  }
}

function selectLanguageProfile(profileId) {
  closeLanguageMenu({ restoreFocus: true });
  switchProfile(profileId);
}

function moveLanguageOptionFocus(currentOption, offset) {
  const options = getLanguageOptionButtons();
  const currentIndex = options.indexOf(currentOption);
  const nextIndex = (currentIndex + offset + options.length) % options.length;
  options[nextIndex]?.focus();
}

function handleLanguageOptionKeydown(event) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    moveLanguageOptionFocus(event.currentTarget, event.key === "ArrowDown" ? 1 : -1);
    return;
  }

  if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    const options = getLanguageOptionButtons();
    const target = event.key === "Home" ? options[0] : options[options.length - 1];
    target?.focus();
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeLanguageMenu({ restoreFocus: true });
    return;
  }

  if (event.key === "Tab") {
    closeLanguageMenu();
  }
}

function handleLanguageTriggerKeydown(event) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    openLanguageMenu({ focusSelected: true });
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeLanguageMenu();
  }
}

function normalizeLookupText(text) {
  return String(text || "").trim().toLocaleLowerCase();
}

function getLocalSuggestionResults() {
  const currentProfile = getCurrentProfile();
  const dictionary = DICTIONARIES[currentProfile.languageCode];
  const lookup = normalizeLookupText(elements.source.value);

  if (!dictionary || !lookup) {
    return [];
  }

  const exact = dictionary.entries[lookup] || [];
  const prefixMatches = Object.entries(dictionary.entries)
    .filter(([source]) => source !== lookup && source.startsWith(lookup))
    .slice(0, 6)
    .flatMap(([source, targets]) =>
      targets.slice(0, 2).map((target) => ({
        source,
        target
      }))
    );

  return [
    ...exact.map((target) => ({
      source: lookup,
      target,
      origin: "local",
      definition: `Local ${dictionary.name || currentProfile.languageCode} suggestion`
    })),
    ...prefixMatches
  ].map((result) => ({
    ...result,
    origin: result.origin || "local",
    definition: result.definition || `Related local match for "${result.source}"`
  })).slice(0, 10);
}

function uniqueSuggestionResults(results) {
  const byKey = new Map();

  for (const result of results) {
    const key = `${result.source.toLocaleLowerCase()}|${result.target.toLocaleLowerCase()}`;
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, result);
      continue;
    }

    byKey.set(key, {
      ...existing,
      ...result,
      definition: result.definition || existing.definition,
      origin: existing.origin === "local" && result.origin === "wikidata" ? "wikidata" : existing.origin
    });
  }

  return Array.from(byKey.values());
}

function cleanDefinitionText(text) {
  return String(text || "")
    .replace(/\s*\(for [^)]+, use Q\d+\)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function getWikidataSuggestionResults(lookup, languageCode) {
  if (!lookup || !languageCode) {
    return [];
  }

  const cacheKey = `${languageCode}:${lookup}`;
  if (wikidataSuggestionCache.has(cacheKey)) {
    return wikidataSuggestionCache.get(cacheKey);
  }

  const searchParams = new URLSearchParams({
    action: "wbsearchentities",
    format: "json",
    language: "en",
    uselang: "en",
    type: "item",
    limit: "8",
    origin: "*",
    search: lookup
  });
  const searchResponse = await fetch(`${WIKIDATA_API_URL}?${searchParams.toString()}`);
  if (!searchResponse.ok) {
    throw new Error(`Wikidata search failed: ${searchResponse.status}`);
  }

  const searchData = await searchResponse.json();
  const ids = (searchData.search || []).map((item) => item.id).filter(Boolean);
  if (!ids.length) {
    wikidataSuggestionCache.set(cacheKey, []);
    return [];
  }

  const entityParams = new URLSearchParams({
    action: "wbgetentities",
    format: "json",
    props: "labels|aliases|descriptions",
    languages: `${languageCode}|en`,
    origin: "*",
    ids: ids.join("|")
  });
  const entityResponse = await fetch(`${WIKIDATA_API_URL}?${entityParams.toString()}`);
  if (!entityResponse.ok) {
    throw new Error(`Wikidata entity lookup failed: ${entityResponse.status}`);
  }

  const entityData = await entityResponse.json();
  const results = [];
  for (const id of ids) {
    const entity = entityData.entities?.[id];
    const label = entity?.labels?.[languageCode]?.value;
    const aliases = entity?.aliases?.[languageCode] || [];
    const englishLabel = entity?.labels?.en?.value;
    const englishDescription = cleanDefinitionText(entity?.descriptions?.en?.value);
    const targetDescription = cleanDefinitionText(entity?.descriptions?.[languageCode]?.value);
    const definition = [englishLabel, englishDescription || targetDescription]
      .filter(Boolean)
      .join(": ");
    const candidates = [
      label,
      ...aliases.slice(0, 4).map((alias) => alias.value)
    ].filter(Boolean);

    for (const target of candidates) {
      if (target.toLocaleLowerCase() !== lookup) {
        results.push({ source: lookup, target, origin: "wikidata", definition });
      }
    }
  }

  const uniqueResults = uniqueSuggestionResults(results).slice(0, 10);
  wikidataSuggestionCache.set(cacheKey, uniqueResults);
  return uniqueResults;
}

function renderSuggestionButtons(results, lookup, profileId, languageCode) {
  elements.suggestionList.textContent = "";

  if (!results.length) {
    return;
  }

  for (const result of results) {
    const button = document.createElement("button");
    const term = document.createElement("span");
    const definition = document.createElement("span");

    button.type = "button";
    button.className = "suggestion-option";
    term.className = "suggestion-term";
    definition.className = "suggestion-definition";
    term.textContent = result.source === lookup
      ? result.target
      : `${result.source}: ${result.target}`;
    definition.textContent = result.definition || "No definition available";
    button.append(term, definition);
    button.title = result.origin === "wikidata" ? `Use ${result.target} from Wikidata` : `Use ${result.target}`;
    button.addEventListener("click", () => {
      const activeProfile = getCurrentProfile();
      const activeLookup = normalizeLookupText(elements.source.value);

      if (
        activeProfile.id !== profileId ||
        activeProfile.languageCode !== languageCode ||
        activeLookup !== lookup
      ) {
        return;
      }

      pendingDefinition = result.definition || "";
      elements.target.value = result.target;
      updateEntrySubmitState();
      elements.target.focus();
    });
    elements.suggestionList.appendChild(button);
  }
}

function clearSuggestions() {
  suggestionRequestId += 1;
  elements.suggestions.classList.add("hidden");
  elements.suggestionTitle.textContent = "Suggestions";
  elements.suggestionList.textContent = "";
}

function resetProfileScopedUi() {
  currentPage = 1;
  searchQuery = "";
  cancelDeleteAllConfirmation();
  stopEdit();
  clearSuggestions();
}

async function renderSuggestions(forceOpen = false) {
  const requestId = ++suggestionRequestId;
  const lookup = normalizeLookupText(elements.source.value);
  const currentProfile = getCurrentProfile();
  const profileId = currentProfile.id;
  const languageCode = currentProfile.languageCode;
  const dictionary = DICTIONARIES[languageCode];
  const localResults = getLocalSuggestionResults();

  elements.suggestionList.textContent = "";

  if (!lookup || !languageCode) {
    elements.suggestions.classList.toggle("hidden", !forceOpen);
    elements.suggestionTitle.textContent = !lookup
      ? "Enter an English note first"
      : "Use a supported language profile first";
    return;
  }

  if (localResults.length) {
    elements.suggestions.classList.remove("hidden");
    elements.suggestionTitle.textContent = `Suggestions (${dictionary?.name || languageCode})`;
    renderSuggestionButtons(localResults, lookup, profileId, languageCode);
    if (!forceOpen) {
      return;
    }
  } else {
    elements.suggestions.classList.toggle("hidden", !forceOpen);
    if (!forceOpen) {
      return;
    }
  }

  elements.suggestions.classList.remove("hidden");
  elements.suggestionTitle.textContent = localResults.length
    ? `Suggestions (${dictionary?.name || languageCode}; checking Wikidata...)`
    : `Checking Wikidata for ${dictionary?.name || languageCode}...`;

  try {
    const wikidataResults = await getWikidataSuggestionResults(lookup, languageCode);
    if (requestId !== suggestionRequestId) {
      return;
    }

    const results = uniqueSuggestionResults([...localResults, ...wikidataResults]).slice(0, 10);
    if (!results.length) {
      elements.suggestionList.textContent = "";
      elements.suggestionTitle.textContent = `No suggestions found for "${lookup}"`;
      return;
    }

    const hasRemote = results.some((result) => result.origin === "wikidata");
    elements.suggestionTitle.textContent = hasRemote
      ? `Suggestions (${dictionary?.name || languageCode} + Wikidata)`
      : `Suggestions (${dictionary?.name || languageCode})`;
    renderSuggestionButtons(results, lookup, profileId, languageCode);
  } catch (error) {
    if (requestId !== suggestionRequestId) {
      return;
    }

    if (localResults.length) {
      elements.suggestionTitle.textContent = `Suggestions (${dictionary?.name || languageCode}; Wikidata unavailable)`;
      renderSuggestionButtons(localResults, lookup, profileId, languageCode);
    } else {
      elements.suggestionList.textContent = "";
      elements.suggestionTitle.textContent = "Wikidata lookup failed";
    }
  }
}

function makeIconButton({ icon, label, className, onClick }) {
  const button = document.createElement("button");
  button.className = `icon-button ${className || ""}`.trim();
  button.type = "button";
  button.title = label;
  button.setAttribute("aria-label", label);
  button.appendChild(makeIcon(icon));
  button.addEventListener("click", onClick);
  return button;
}

function makeIcon(name) {
  const icon = document.createElement("span");
  icon.className = `lucide-icon lucide-icon-${name}`;
  icon.dataset.lucideIcon = name;
  icon.setAttribute("aria-hidden", "true");
  return icon;
}

function getTabExclusionTarget(tab) {
  try {
    const parsed = new URL(String(tab?.url || ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    parsed.hash = "";
    return {
      page: parsed.href,
      site: parsed.hostname.toLocaleLowerCase()
    };
  } catch (error) {
    return null;
  }
}

function getExclusionState(target) {
  const exclusions = state.doNotTranslate || { sites: [], pages: [] };
  return {
    pageExcluded: Boolean(target?.page && exclusions.pages.includes(target.page)),
    siteExcluded: Boolean(target?.site && exclusions.sites.includes(target.site))
  };
}

function renderDoNotTranslateActions(tab) {
  const target = getTabExclusionTarget(tab);
  const isAvailable = Boolean(target);
  const { pageExcluded, siteExcluded } = getExclusionState(target);

  elements.doNotTranslateActions.classList.toggle("hidden", !isAvailable);
  if (!isAvailable) {
    return;
  }

  elements.excludePage.disabled = siteExcluded;
  elements.excludePageLabel.textContent = pageExcluded
    ? "Allow this page"
    : siteExcluded
      ? "This site is excluded"
      : "Don't translate this page";
  elements.excludePage.title = pageExcluded
    ? "Remove this page from Do not translate"
    : siteExcluded
      ? "Remove the site rule before allowing one page"
      : "Add this exact page to Do not translate";
  elements.excludeSiteLabel.textContent = siteExcluded
    ? "Allow this site"
    : "Don't translate this site";
  elements.excludeSite.title = siteExcluded
    ? "Remove this site from Do not translate"
    : "Add this whole site to Do not translate";
}

function renderDoNotTranslateList() {
  const exclusions = state.doNotTranslate || { sites: [], pages: [] };
  const items = [
    ...exclusions.sites.map((value) => ({ type: "site", value })),
    ...exclusions.pages.map((value) => ({ type: "page", value }))
  ];

  elements.doNotTranslateList.textContent = "";
  elements.clearDoNotTranslate.disabled = items.length === 0;

  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "do-not-translate-empty";
    empty.textContent = "No pages or sites are excluded.";
    elements.doNotTranslateList.appendChild(empty);
    return;
  }

  for (const item of items) {
    const row = document.createElement("div");
    row.className = "do-not-translate-row";
    const text = document.createElement("div");
    const kind = document.createElement("span");
    const value = document.createElement("span");

    kind.className = "do-not-translate-kind";
    value.className = "do-not-translate-label";
    kind.textContent = item.type === "site" ? "Whole site" : "Specific page";
    value.textContent = item.value;
    text.append(kind, value);
    row.append(
      text,
      makeIconButton({
        icon: "trash",
        label: `Remove ${item.type === "site" ? "site" : "page"} exclusion`,
        className: "danger",
        onClick: () => removeDoNotTranslate(item.type, item.value)
      })
    );
    elements.doNotTranslateList.appendChild(row);
  }
}

function shouldUseCompactVocabularyList() {
  return isSidePanelView;
}

function createCompactVocabularyRow(entry) {
  const row = document.createElement("div");
  row.className = "compact-vocabulary-row";
  row.dataset.id = entry.id;

  const replace = document.createElement("div");
  replace.className = "compact-vocabulary-replace";
  replace.appendChild(
    makeCheckbox(
      entry.enabled,
      (checked) => {
        updateEntry(entry.id, { enabled: checked });
      },
      { title: "Replace this entry on webpages" }
    )
  );

  const copy = document.createElement("div");
  copy.className = "compact-vocabulary-copy";
  const target = document.createElement("div");
  target.className = "compact-vocabulary-target";
  target.textContent = entry.target;
  const source = document.createElement("div");
  source.className = "compact-vocabulary-source";
  source.textContent = entry.source;
  copy.append(target, source);

  const definitionText = String(entry.definition || "")
    .replace(/^Duolingo meanings:\s*/i, "")
    .trim();
  if (definitionText) {
    const definition = document.createElement("div");
    definition.className = "compact-vocabulary-definition";
    definition.textContent = definitionText;
    copy.appendChild(definition);
  }

  const actions = document.createElement("div");
  actions.className = "compact-vocabulary-actions";
  actions.appendChild(
    makeIconButton({
      icon: "trash",
      label: `Delete ${getEntryOrigin(entry) === "duolingo" ? "Duolingo" : "manual"} entry`,
      className: "danger",
      onClick: () => deleteEntry(entry.id)
    })
  );

  row.append(replace, copy, actions);
  return row;
}

function render() {
  const allEntries = getCurrentEntries();
  const manualEntries = getEntriesForSection("manual");
  const duolingoEntries = getEntriesForSection("duolingo");
  const entries = getEntriesForSection();
  const replacingCount = allEntries.filter((entry) => entry.enabled).length;
  const filteredEntries = getFilteredEntries();
  const pageSize = getPageSize();
  const pageCount = Math.max(1, Math.ceil(filteredEntries.length / pageSize));
  currentPage = Math.min(Math.max(currentPage, 1), pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleEntries = filteredEntries.slice(pageStart, pageStart + pageSize);
  const visibleStart = filteredEntries.length ? pageStart + 1 : 0;
  const visibleEnd = pageStart + visibleEntries.length;
  const useCompactVocabularyList = shouldUseCompactVocabularyList();

  renderAppSection();
  renderProfileOptions();
  renderVocabularySections(manualEntries, duolingoEntries);
  elements.enabled.checked = state.enabled;
  elements.showHighlights.checked = state.showHighlights;
  elements.entryCount.textContent = `${replacingCount} replacing / ${manualEntries.length} manual / ${duolingoEntries.length} Duolingo`;
  elements.search.value = searchQuery;
  updateDeleteAllButtons();
  renderDoNotTranslateList();

  elements.emptyState.classList.toggle("hidden", entries.length > 0);
  elements.tableWrap.classList.toggle("hidden", entries.length === 0 || useCompactVocabularyList);
  elements.compactVocabularyList.classList.toggle(
    "hidden",
    entries.length === 0 || !useCompactVocabularyList
  );
  elements.pager.classList.toggle("hidden", entries.length === 0);
  elements.entryTable.textContent = "";
  elements.compactVocabularyList.textContent = "";
  elements.prevPage.disabled = currentPage <= 1;
  elements.nextPage.disabled = currentPage >= pageCount;
  elements.pageStatus.textContent = `${visibleStart}-${visibleEnd} of ${filteredEntries.length}`;

  if (useCompactVocabularyList) {
    for (const entry of visibleEntries) {
      elements.compactVocabularyList.appendChild(createCompactVocabularyRow(entry));
    }

    if (!visibleEntries.length && entries.length > 0) {
      const empty = document.createElement("div");
      empty.className = "no-results";
      empty.textContent = "No matching entries";
      elements.compactVocabularyList.appendChild(empty);
    }
  } else {
    for (const entry of visibleEntries) {
      const row = document.createElement("tr");
      row.dataset.id = entry.id;

      const replaceCell = document.createElement("td");
      replaceCell.className = "flag-cell";
      replaceCell.appendChild(
        makeCheckbox(
          entry.enabled,
          (checked) => {
            updateEntry(entry.id, { enabled: checked });
          },
          { title: "Replace this entry on webpages" }
        )
      );

      const sourceCell = document.createElement("td");
      sourceCell.textContent = entry.source;

      const targetCell = document.createElement("td");
      const targetValue = document.createElement("div");
      targetValue.className = "entry-target";
      targetValue.textContent = entry.target;
      targetCell.appendChild(targetValue);

      if (entry.definition) {
        const definition = document.createElement("div");
        definition.className = "entry-definition";
        definition.textContent = entry.definition;
        targetCell.appendChild(definition);
      }

      const actionsCell = document.createElement("td");
      const actions = document.createElement("div");
      actions.className = "row-actions";

      const deleteButton = makeIconButton({
        icon: "trash",
        label: vocabularySection === "manual" ? "Delete manual entry" : "Delete Duolingo entry",
        className: "danger",
        onClick: () => deleteEntry(entry.id)
      });

      if (vocabularySection === "manual") {
        actions.append(
          makeIconButton({
            icon: "pencil",
            label: "Edit manual entry",
            className: "secondary",
            onClick: () => startEdit(entry.id)
          })
        );
      }
      actions.append(deleteButton);
      actionsCell.appendChild(actions);
      row.append(replaceCell, sourceCell, targetCell, actionsCell);
      elements.entryTable.appendChild(row);
    }

    if (!visibleEntries.length && entries.length > 0) {
      const row = document.createElement("tr");
      const cell = document.createElement("td");
      cell.className = "no-results";
      cell.colSpan = 4;
      cell.textContent = "No matching entries";
      row.appendChild(cell);
      elements.entryTable.appendChild(row);
    }
  }

  if (vocabularySection === "manual") {
    renderSuggestions(false);
  } else {
    clearSuggestions();
  }
}

function makeCheckbox(checked, onChange, options = {}) {
  const input = document.createElement("input");

  input.type = "checkbox";
  input.checked = checked;
  input.disabled = Boolean(options.disabled);
  if (options.title) {
    input.title = options.title;
  }
  input.addEventListener("change", () => onChange(input.checked));

  return input;
}

function updateEntry(id, patch) {
  updateCurrentEntries(
    getCurrentEntries().map((entry) => (entry.id === id ? { ...entry, ...patch } : entry))
  );
  saveState();
}

function deleteEntry(id) {
  if (editingId === id) {
    stopEdit();
  }

  updateCurrentEntries(getCurrentEntries().filter((entry) => entry.id !== id));
  clampPageAfterDataChange();
  saveState();
}

function startEdit(id) {
  const entry = getCurrentEntries().find((candidate) => candidate.id === id);
  if (!entry) {
    return;
  }

  editingId = id;
  pendingDefinition = entry.definition || "";
  elements.source.value = entry.source;
  elements.target.value = entry.target;
  elements.submitEntry.textContent = "Save";
  elements.cancelEdit.classList.remove("hidden");
  updateEntrySubmitState();
  elements.source.focus();
}

function updateEntrySubmitState() {
  elements.submitEntry.disabled =
    !elements.source.value.trim() || !elements.target.value.trim();
}

function stopEdit() {
  editingId = null;
  pendingDefinition = "";
  elements.form.reset();
  elements.submitEntry.textContent = "Add";
  elements.cancelEdit.classList.add("hidden");
  updateEntrySubmitState();
}

function addOrUpdateEntry(event) {
  event.preventDefault();

  const source = elements.source.value.trim();
  const target = elements.target.value.trim();
  const currentProfile = getCurrentProfile();
  const languageCode = currentProfile.languageCode;
  const entries = getCurrentEntries();

  if (!source || !target) {
    return;
  }

  if (editingId) {
    updateEntry(editingId, {
      source,
      target,
      languageCode,
      definition: pendingDefinition,
      learned: true
    });
  } else {
    const existing = entries.find(
      (entry) =>
        getEntryOrigin(entry) === "manual" &&
        entry.source.toLocaleLowerCase() === source.toLocaleLowerCase()
    );

    if (existing) {
      updateEntry(existing.id, {
        target,
        languageCode,
        definition: pendingDefinition,
        learned: true,
        enabled: true
      });
    } else {
      updateCurrentEntries([
        ...entries,
        {
          id: createId(),
          source,
          target,
          languageCode,
          definition: pendingDefinition,
          origin: "manual",
          learned: true,
          enabled: true,
          createdAt: Date.now()
        }
      ]);
      currentPage = Math.ceil(getCurrentEntries().length / getPageSize());
      saveState();
    }
  }

  stopEdit();
}

function clampPageAfterDataChange() {
  const pageSize = getPageSize();
  const pageCount = Math.max(1, Math.ceil(getFilteredEntries().length / pageSize));
  currentPage = Math.min(currentPage, pageCount);
}

function updateSetting(key, value) {
  state = { ...state, [key]: value };
  saveState();
}

function switchProfile(profileId) {
  if (!state.profiles.some((profile) => profile.id === profileId)) {
    return;
  }

  state.currentProfileId = profileId;
  resetProfileScopedUi();
  saveState();
}

function parseBulkText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap(parseImportLine)
    .filter(Boolean);
}

function parseImportLine(line) {
  const duolingoEntries = parseDuolingoLine(line);
  if (duolingoEntries.length) {
    return duolingoEntries;
  }

  const columns = splitDelimitedLine(line);
  const source = columns[0]?.trim() || "";
  const target = columns[1]?.trim() || "";
  const definition = columns.slice(2).join(",").trim();

  return source && target ? [{ source, target, definition, origin: "manual" }] : [];
}

function parseDuolingoLine(line) {
  const match = String(line || "").match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (!match) {
    return [];
  }

  const learnedWord = match[1].trim();
  const meaningsText = match[2].trim();
  const seen = new Set();
  const sources = splitDelimitedLine(meaningsText)
    .flatMap(parseDuolingoMeaningSources)
    .filter((meaning) => {
      const key = meaning.toLocaleLowerCase();
      if (!meaning || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

  return sources.map((source) => ({
    source,
    target: learnedWord,
    definition: `Duolingo meanings: ${meaningsText}`,
    origin: "duolingo",
    mergeTarget: true
  }));
}

function parseDuolingoMeaningSources(meaning) {
  const cleanedMeaning = cleanDuolingoMeaning(meaning);

  return splitDuolingoMeaningAlternates(cleanedMeaning)
    .map(cleanDuolingoMeaning)
    .filter((source) => source && !isInvalidDuolingoSource(source, meaning));
}

function splitDuolingoMeaningAlternates(meaning) {
  return String(meaning || "")
    .split(/\s*\/\s*/)
    .map((part) => part.trim());
}

function cleanDuolingoMeaning(meaning) {
  const cleaned = String(meaning || "")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\s*\.\.\..*$/g, "")
    .replace(/^(a|an|the)\s+/i, "")
    .replace(/^to\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  return stripBalancedOuterQuotes(cleaned);
}

function stripBalancedOuterQuotes(text) {
  const quotePairs = {
    "'": "'",
    "\"": "\"",
    "\u2018": "\u2019",
    "\u201c": "\u201d"
  };
  const first = text[0];
  const last = text[text.length - 1];

  return text.length > 1 && quotePairs[first] === last ? text.slice(1, -1).trim() : text;
}

function isInvalidDuolingoSource(source, originalMeaning) {
  const normalizedSource = String(source || "").trim().toLocaleLowerCase();
  const normalizedMeaning = String(originalMeaning || "").trim().toLocaleLowerCase();

  // Duolingo can export a standalone possessive suffix as "'s"; it is not a usable note.
  return (
    normalizedSource === "'s" ||
    normalizedSource === "\u2019s" ||
    (normalizedSource === "s" && /(^|[,\s])['\u2019]s($|[,\s])/.test(normalizedMeaning))
  );
}

function splitDelimitedLine(line) {
  if (line.includes("\t")) {
    return line.split("\t");
  }

  if (line.includes("=") && !line.includes(",")) {
    const separatorIndex = line.indexOf("=");
    return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
  }

  const columns = [];
  let value = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      quoted = !quoted;
      continue;
    }

    if (char === "," && !quoted) {
      columns.push(value);
      value = "";
      continue;
    }

    value += char;
  }

  columns.push(value);

  return columns;
}

function toCsvLine(values) {
  return values
    .map((value) => {
      const text = String(value);
      return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
    })
    .join(",");
}

function mergeUniqueText(existingText, incomingText, separator) {
  const incoming = String(incomingText || "").trim();
  if (!incoming) {
    return String(existingText || "").trim();
  }

  const existingParts = String(existingText || "")
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set(existingParts.map((part) => part.toLocaleLowerCase()));
  const incomingKey = incoming.toLocaleLowerCase();

  if (!seen.has(incomingKey)) {
    existingParts.push(incoming);
  }

  return existingParts.join(separator);
}

function refreshOpenTabs() {
  if (!chrome.tabs || !chrome.scripting) {
    return;
  }

  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (!tab.id || !isInjectableTabUrl(tab.url)) {
        continue;
      }

      try {
        const injection = chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: ["content.js"]
        });

        if (injection && typeof injection.catch === "function") {
          injection.catch(() => {});
        }
      } catch (error) {
        // Restricted pages such as chrome:// URLs cannot receive content scripts.
      }
    }
  });
}

function isInjectableTabUrl(url) {
  return /^(https?:|file:)/.test(String(url || ""));
}

async function toggleDoNotTranslate(scope) {
  const tab = await getActiveTab();
  const target = getTabExclusionTarget(tab);
  if (!target || (scope !== "page" && scope !== "site")) {
    return;
  }

  const exclusions = normalizeDoNotTranslate(state.doNotTranslate);
  const key = scope === "site" ? "sites" : "pages";
  const value = scope === "site" ? target.site : target.page;

  if (exclusions[key].includes(value)) {
    exclusions[key] = exclusions[key].filter((item) => item !== value);
  } else {
    exclusions[key] = [...exclusions[key], value];
    if (scope === "site") {
      exclusions.pages = exclusions.pages.filter((page) => {
        try {
          return new URL(page).hostname.toLocaleLowerCase() !== target.site;
        } catch (error) {
          return false;
        }
      });
    }
  }

  state.doNotTranslate = normalizeDoNotTranslate(exclusions);
  saveState(() => {
    refreshActiveTabStatus();
  });
}

function removeDoNotTranslate(scope, value) {
  const exclusions = normalizeDoNotTranslate(state.doNotTranslate);
  const key = scope === "site" ? "sites" : "pages";
  exclusions[key] = exclusions[key].filter((item) => item !== value);
  state.doNotTranslate = normalizeDoNotTranslate(exclusions);
  saveState(() => {
    refreshActiveTabStatus();
  });
}

function clearDoNotTranslate() {
  if (!state.doNotTranslate.sites.length && !state.doNotTranslate.pages.length) {
    return;
  }

  state.doNotTranslate = { sites: [], pages: [] };
  saveState(() => {
    refreshActiveTabStatus();
  });
}

function setImportStatus(message, type = "") {
  elements.importStatus.textContent = message;
  elements.importStatus.classList.toggle("error", type === "error");
  elements.importStatus.classList.toggle("success", type === "success");
}

function importEntriesFromText(text, afterSave) {
  const imported = parseBulkText(text);
  if (!imported.length) {
    return null;
  }

  const importedOrigins = new Set(
    imported.map((entry) => (entry.origin === "duolingo" ? "duolingo" : "manual"))
  );
  const languageCode = getCurrentProfile().languageCode;
  const initialCount = getCurrentEntries().length;
  const entriesBySource = new Map(
    getCurrentEntries().map((entry) => [
      `${getEntryOrigin(entry)}\u0000${entry.source.toLocaleLowerCase()}`,
      entry
    ])
  );

  for (const importedEntry of imported) {
    const origin = importedEntry.origin === "duolingo" ? "duolingo" : "manual";
    const key = `${origin}\u0000${importedEntry.source.toLocaleLowerCase()}`;
    const existing = entriesBySource.get(key);

    if (existing) {
      const target = importedEntry.mergeTarget
        ? mergeUniqueText(existing.target, importedEntry.target, " / ")
        : importedEntry.target;
      const definition = importedEntry.mergeTarget
        ? mergeUniqueText(existing.definition, importedEntry.definition, "; ")
        : importedEntry.definition ||
          (existing.target === importedEntry.target ? existing.definition : "");

      entriesBySource.set(key, {
        ...existing,
        target,
        languageCode,
        definition,
        origin,
        learned: true,
        enabled: true
      });
    } else {
      entriesBySource.set(key, {
        id: createId(),
        source: importedEntry.source,
        target: importedEntry.target,
        languageCode,
        definition: importedEntry.definition,
        origin,
        learned: true,
        enabled: true,
        createdAt: Date.now()
      });
    }
  }

  updateCurrentEntries(Array.from(entriesBySource.values()));
  if (importedOrigins.size === 1) {
    vocabularySection = Array.from(importedOrigins)[0];
  }
  currentPage = Math.max(1, Math.ceil(getEntriesForSection().length / getPageSize()));
  saveState(afterSave);
  return {
    parsedCount: imported.length,
    addedCount: Math.max(0, entriesBySource.size - initialCount),
    totalCount: entriesBySource.size
  };
}

async function importEntries() {
  if (!isTabView) {
    openManagerTab({ autoImport: true });
    window.close();
    return;
  }

  const file = elements.bulkFile.files && elements.bulkFile.files[0];

  if (!file) {
    setImportStatus("Choose a CSV, TXT, or Duolingo export file first.", "error");
    return;
  }

  try {
    const text = await file.text();
    const result = importEntriesFromText(text, refreshOpenTabs);

    if (!result) {
      setImportStatus(`No importable entries found in ${file.name}.`, "error");
      return;
    }

    setImportStatus(
      `Imported ${result.addedCount} new row${result.addedCount === 1 ? "" : "s"} from ${file.name}. ${result.totalCount} total in this profile.`,
      "success"
    );
    elements.bulkFile.value = "";
  } catch (error) {
    setImportStatus(`Could not read ${file.name}.`, "error");
  }
}

function exportEntries() {
  const entries = sortEntries(getCurrentEntries());
  const hasDefinitions = entries.some((entry) => entry.definition);

  const csv = entries
    .map((entry) =>
      toCsvLine(
        hasDefinitions
          ? [entry.source, entry.target, entry.definition || ""]
          : [entry.source, entry.target]
      )
    )
    .join("\n");
  const blob = new Blob([`${csv}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const profileName = getCurrentProfile().name || "profile";

  link.href = url;
  link.download = `${slugifyFilename(profileName)}-vocabulary.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setImportStatus(`Downloaded ${entries.length} entr${entries.length === 1 ? "y" : "ies"}.`, "success");
}

function slugifyFilename(text) {
  return String(text || "profile")
    .trim()
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "profile";
}

function sortAlphabetically() {
  const sortedSectionEntries = sortEntries(getEntriesForSection());
  let sortedIndex = 0;
  updateCurrentEntries(
    getCurrentEntries().map((entry) =>
      getEntryOrigin(entry) === vocabularySection ? sortedSectionEntries[sortedIndex++] : entry
    )
  );
  currentPage = 1;
  cancelDeleteAllConfirmation();
  saveState();
}

function clearAllEntries() {
  const entries = getEntriesForSection();
  if (!entries.length) {
    cancelDeleteAllConfirmation();
    return;
  }

  if (!deleteAllPending) {
    armDeleteAllConfirmation();
    return;
  }

  cancelDeleteAllConfirmation();
  stopEdit();
  updateCurrentEntries(
    getCurrentEntries().filter((entry) => getEntryOrigin(entry) !== vocabularySection)
  );
  currentPage = 1;
  saveState();
}

function armDeleteAllConfirmation() {
  deleteAllPending = true;
  updateDeleteAllButtons();

  if (deleteAllTimer) {
    clearTimeout(deleteAllTimer);
  }

  deleteAllTimer = setTimeout(() => {
    deleteAllTimer = null;
    deleteAllPending = false;
    updateDeleteAllButtons();
  }, 5000);
}

function cancelDeleteAllConfirmation() {
  deleteAllPending = false;

  if (deleteAllTimer) {
    clearTimeout(deleteAllTimer);
    deleteAllTimer = null;
  }

  updateDeleteAllButtons();
}

function updateDeleteAllButtons() {
  if (!elements.deleteAll || !elements.clearAllButton) {
    return;
  }

  const disabled = getEntriesForSection().length === 0;
  const label = deleteAllPending ? "Confirm delete" : "Delete all";

  elements.deleteAll.disabled = disabled;
  elements.clearAllButton.disabled = disabled;
  elements.deleteAll.textContent = label;
  elements.clearAllButton.textContent = label;
  elements.deleteAll.title = deleteAllPending
    ? `Click again to delete all ${vocabularySection} entries in "${getCurrentProfile().name}".`
    : `Delete all ${vocabularySection} entries in this profile`;
  elements.clearAllButton.title = elements.deleteAll.title;
}

function getActiveTab() {
  return new Promise((resolve) => {
    if (!chrome.tabs) {
      resolve(null);
      return;
    }

    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      resolve(tabs && tabs[0] ? tabs[0] : null);
    });
  });
}

function getAllTabs() {
  return new Promise((resolve) => {
    if (!chrome.tabs) {
      resolve([]);
      return;
    }

    chrome.tabs.query({}, (tabs) => resolve(tabs || []));
  });
}

function getDuolingoWordsUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    return /(^|\.)duolingo\.com$/i.test(parsed.hostname) &&
      parsed.pathname === "/practice-hub/words"
      ? parsed
      : null;
  } catch (error) {
    return null;
  }
}

function isDuolingoLoginRedirectUrl(url) {
  return getDuolingoWordsUrl(url)?.searchParams.get("isLoggingIn") === "true";
}

function isDuolingoWordsUrl(url) {
  return Boolean(getDuolingoWordsUrl(url)) && !isDuolingoLoginRedirectUrl(url);
}

async function getDuolingoWordsTab() {
  const activeTab = await getActiveTab();
  return isDuolingoWordsUrl(activeTab?.url) ? activeTab : null;
}

async function getOpenDuolingoWordsTab() {
  const tabs = await getAllTabs();
  return tabs.find((tab) => isDuolingoWordsUrl(tab.url)) || null;
}

function setDuolingoSyncStatus(message = "", type = "") {
  elements.duolingoSyncStatus.textContent = message;
  elements.duolingoSyncStatus.classList.toggle("hidden", !message);
  elements.duolingoSyncStatus.classList.toggle("error", type === "error");
  elements.duolingoSyncStatus.classList.toggle("success", type === "success");
  elements.duolingoSyncStatus.classList.toggle("warning", type === "warning");
}

async function refreshDuolingoSyncAvailability() {
  if (duolingoSyncInProgress) {
    return;
  }

  const requestId = ++duolingoAvailabilityRequestId;
  const currentTab = await getActiveTab();
  if (requestId !== duolingoAvailabilityRequestId) {
    return;
  }

  if (isDuolingoLoginRedirectUrl(currentTab?.url)) {
    duolingoSyncNeedsAction = false;
    elements.duolingoSync.disabled = true;
    elements.duolingoSync.classList.remove("needs-sync");
    elements.duolingoSyncLabel.textContent = "Sign in to Duolingo first";
    elements.duolingoSync.title = "Sign in to Duolingo on this page, then import your learned words";
    setDuolingoSyncStatus(
      "Duolingo needs you to sign in first. Sign in on this page, then press Import words from Duolingo.",
      "warning"
    );
    return;
  }

  const [activeTab, openTab] = await Promise.all([
    getDuolingoWordsTab(),
    getOpenDuolingoWordsTab()
  ]);
  if (requestId !== duolingoAvailabilityRequestId) {
    return;
  }

  elements.duolingoSync.disabled = false;
  if (elements.duolingoSyncStatus.classList.contains("warning")) {
    setDuolingoSyncStatus();
  }
  elements.duolingoSyncLabel.textContent = activeTab
    ? "Import words from Duolingo"
    : openTab
      ? "View Duolingo to sync"
      : "Open Duolingo Words";
  elements.duolingoSync.title = activeTab
    ? "Sync every learned word from the Duolingo Words page you are viewing"
    : openTab
      ? "Show the open Duolingo Words page before syncing"
      : "Open Duolingo's Words page, then press again to sync learned vocabulary";
  elements.duolingoSync.classList.toggle(
    "needs-sync",
    Boolean(activeTab) && duolingoSyncNeedsAction
  );
}

function getProfileForDuolingoLanguage(languageName) {
  const normalizedName = String(languageName || "").trim().toLocaleLowerCase();
  return state.profiles.find(
    (profile) => profile.name.trim().toLocaleLowerCase() === normalizedName
  );
}

async function syncFromDuolingo() {
  const currentTab = await getActiveTab();
  if (isDuolingoLoginRedirectUrl(currentTab?.url)) {
    setDuolingoSyncStatus(
      "Duolingo needs you to sign in first. Sign in on this page, then press Import words from Duolingo.",
      "warning"
    );
    refreshDuolingoSyncAvailability();
    return;
  }

  const existingTab = await getDuolingoWordsTab();
  if (!existingTab) {
    try {
      const openTab = await getOpenDuolingoWordsTab();
      if (openTab?.id && chrome.tabs?.update) {
        const sidePanelOpened = await openSidePanelForTab(openTab);
        await chrome.tabs.update(openTab.id, { active: true });
        duolingoSyncNeedsAction = true;
        setDuolingoSyncStatus(
          sidePanelOpened
            ? "Press Import words from Duolingo after the Words page is visible."
            : "Showing Duolingo's Words page. Press Import words from Duolingo after it is visible.",
          "success"
        );
      } else {
        await openDuolingoWordsPage();
        duolingoSyncNeedsAction = true;
        setDuolingoSyncStatus(
          "Opened Duolingo's Words page. Press Import words from Duolingo after it loads.",
          "success"
        );
      }
    } catch (error) {
      duolingoSyncNeedsAction = false;
      setDuolingoSyncStatus(
        error && error.message ? error.message : "Could not open Duolingo's Words page.",
        "error"
      );
    }
    refreshDuolingoSyncAvailability();
    return;
  }

  duolingoSyncNeedsAction = false;
  duolingoSyncInProgress = true;
  elements.duolingoSync.classList.remove("needs-sync");
  elements.duolingoSync.disabled = true;
  elements.duolingoSync.classList.add("syncing");
  elements.duolingoSyncLabel.textContent = "Importing words";
  setDuolingoSyncStatus("Loading all learned words from Duolingo...");

  try {
    const response = await sendTabMessage(existingTab, { type: "LWR_SYNC_DUOLINGO" });
    if (!response.ok) {
      throw new Error(response.reason || "Could not read Duolingo's learned words.");
    }

    const matchingProfile = getProfileForDuolingoLanguage(response.languageName);
    if (!matchingProfile) {
      throw new Error(
        `${response.languageName || "This Duolingo language"} is not supported yet.`
      );
    }

    if (state.currentProfileId !== matchingProfile.id) {
      state.currentProfileId = matchingProfile.id;
      resetProfileScopedUi();
    }
    vocabularySection = "duolingo";
    currentPage = 1;

    const result = importEntriesFromText(response.text, refreshOpenTabs);
    if (!result) {
      throw new Error("Duolingo returned no importable words.");
    }

    const duolingoTotal = getEntriesForSection("duolingo").length;
    setDuolingoSyncStatus(
      `Synced ${response.count} Duolingo word${response.count === 1 ? "" : "s"} to ${matchingProfile.name}. ${result.addedCount} new replacement row${result.addedCount === 1 ? "" : "s"}; ${duolingoTotal} synced.`,
      "success"
    );
  } catch (error) {
    const message = error && error.message ? error.message : "Could not sync Duolingo words.";
    setDuolingoSyncStatus(
      isMissingDuolingoPageReceiver(message)
        ? "Refresh the Duolingo Words page, then press Import words from Duolingo again."
        : message,
      "error"
    );
  } finally {
    duolingoSyncInProgress = false;
    elements.duolingoSync.classList.remove("syncing");
    elements.duolingoSyncLabel.textContent = "Import words from Duolingo";
    refreshDuolingoSyncAvailability();
  }
}

function isMissingDuolingoPageReceiver(message) {
  return /could not establish connection\. receiving end does not exist/i.test(
    String(message || "")
  );
}

async function openDuolingoWordsPage() {
  const activeTab = await getActiveTab();
  const canNavigateActiveTab = activeTab?.id && isInjectableTabUrl(activeTab.url);

  if (canNavigateActiveTab && chrome.tabs?.update) {
    await openSidePanelForTab(activeTab);
    return chrome.tabs.update(activeTab.id, { url: DUOLINGO_WORDS_URL });
  }

  if (!chrome.tabs?.create) {
    throw new Error("Chrome could not open Duolingo's Words page.");
  }

  const duolingoTab = await chrome.tabs.create({ url: DUOLINGO_WORDS_URL, active: false });
  if (!duolingoTab?.id || !chrome.tabs?.update) {
    return duolingoTab;
  }
  await openSidePanelForTab(duolingoTab);
  return chrome.tabs.update(duolingoTab.id, { active: true });
}

async function openSidePanelForTab(tab) {
  if (isSidePanelView || !tab?.id || !chrome.sidePanel?.open) {
    return isSidePanelView;
  }

  try {
    await chrome.sidePanel.open({ tabId: tab.id });
    return true;
  } catch (error) {
    return false;
  }
}

function sendActiveTabMessage(message) {
  return getActiveTab().then(
    (tab) => sendTabMessage(tab, message)
  );
}

function sendTabMessage(tab, message) {
  return new Promise((resolve) => {
    if (!tab || !tab.id || !isInjectableTabUrl(tab.url)) {
      resolve({ ok: false, reason: "not-injectable" });
      return;
    }

    chrome.tabs.sendMessage(tab.id, message, { frameId: 0 }, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, reason: chrome.runtime.lastError.message });
        return;
      }

      resolve(response || { ok: false, reason: "No response from content script." });
    });
  });
}

async function prepareActiveTabTranslator(tab) {
  const languageCode = getCurrentProfile().languageCode;
  if (
    !tab ||
    !tab.id ||
    !isInjectableTabUrl(tab.url) ||
    !languageCode ||
    languageCode === "en" ||
    !chrome.scripting
  ) {
    return null;
  }

  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: "MAIN",
      func: (sourceLanguage, targetLanguage) => {
        const cacheKey = "__learnedWordReplacerTranslatorCache";
        const key = `${sourceLanguage}:${targetLanguage}`;
        globalThis[cacheKey] = globalThis[cacheKey] || new Map();

        if (!globalThis.Translator) {
          return {
            ok: false,
            reason: "Chrome Translator API is not available.",
            active: navigator.userActivation.isActive
          };
        }

        if (!globalThis[cacheKey].has(key)) {
          const createPromise = globalThis.Translator.create({
            sourceLanguage,
            targetLanguage
          });
          globalThis[cacheKey].set(key, createPromise);
          createPromise.then(
            (translator) => {
              globalThis[cacheKey].set(key, translator);
            },
            () => {
              if (globalThis[cacheKey].get(key) === createPromise) {
                globalThis[cacheKey].delete(key);
              }
            }
          );
        }

        return {
          ok: true,
          active: navigator.userActivation.isActive
        };
      },
      args: ["en", languageCode]
    });

    return result?.result || null;
  } catch (error) {
    return {
      ok: false,
      reason: error && error.message ? error.message : "Could not prepare Chrome Translator."
    };
  }
}

async function refreshActiveTabStatus() {
  const requestId = ++activeTabStatusRequestId;
  clearRuntimePoll();
  renderRuntimeStatus(null, "checking");
  const tab = await getActiveTab();
  if (requestId !== activeTabStatusRequestId) {
    return;
  }

  renderDoNotTranslateActions(tab);
  const response = await sendTabMessage(tab, { type: "LWR_GET_STATUS" });
  if (requestId !== activeTabStatusRequestId) {
    return;
  }

  if (!response.ok) {
    renderRuntimeStatus({ reason: response.reason }, "unavailable");
    return;
  }

  renderRuntimeStatus(response.status, getRuntimeDisplayState(response.status));
  scheduleRuntimePollIfNeeded(response.status);
}

function refreshTabBoundUi() {
  refreshActiveTabStatus();
  refreshDuolingoSyncAvailability();
}

function refreshUiForActiveTabUpdate(tabId, changeInfo) {
  if (!changeInfo.url && changeInfo.status !== "complete") {
    return;
  }

  getActiveTab().then((activeTab) => {
    if (activeTab?.id === tabId) {
      refreshTabBoundUi();
    }
  });
}

async function retryActiveTab() {
  renderRuntimeStatus(null, "checking");

  const tab = await getActiveTab();
  await prepareActiveTabTranslator(tab);
  const response = await sendTabMessage(tab, { type: "LWR_RETRY" });

  if (!response.ok) {
    renderRuntimeStatus({ reason: response.reason }, "unavailable");
  } else {
    renderRuntimeStatus(response.status, getRuntimeDisplayState(response.status));
    scheduleRuntimePollIfNeeded(response.status);
  }

}

function clearRuntimePoll() {
  if (runtimePollTimer) {
    clearTimeout(runtimePollTimer);
    runtimePollTimer = null;
  }
}

function scheduleRuntimePollIfNeeded(status) {
  if (getRuntimeDisplayState(status) !== "working") {
    return;
  }

  clearRuntimePoll();
  runtimePollTimer = setTimeout(() => {
    runtimePollTimer = null;
    refreshActiveTabStatus();
  }, 1000);
}

function getRuntimeDisplayState(status) {
  if (!status) {
    return "checking";
  }

  if (status.status === "excluded") {
    return "excluded";
  }

  if (
    [
      "no-translator",
      "translator-unavailable",
      "translator-not-ready",
      "translator-error"
    ].includes(status.status)
  ) {
    return "blocked";
  }

  if (
    status.status === "checking-translator" ||
    status.status === "translator-preparing" ||
    status.status === "translating"
  ) {
    return "working";
  }

  if (Number(status.replacementCount || 0) > 0) {
    return "ok";
  }

  return "";
}

function getRuntimeDurationMs(status, options = {}) {
  const startedAt = Number(status?.startedAt || 0);
  if (!startedAt) {
    return 0;
  }

  const finishedAt = Number(status?.finishedAt || 0);
  const endAt = finishedAt > startedAt ? finishedAt : options.includeRunning ? Date.now() : 0;
  return endAt > startedAt ? Math.max(0, endAt - startedAt) : 0;
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return "";
  }

  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }

  if (value < 10000) {
    return `${(value / 1000).toFixed(1)}s`;
  }

  return `${Math.round(value / 1000)}s`;
}

function getFinishedDurationText(status) {
  const duration = formatDuration(getRuntimeDurationMs(status));
  return duration ? ` Finished in ${duration}.` : "";
}

function getLanguageDisplayName(languageCode) {
  const code = String(languageCode || "").trim();
  if (!code) {
    return "target language";
  }

  return DICTIONARIES[code]?.name || code.toUpperCase();
}

function getRuntimeRetryTone(status, displayState) {
  if (displayState === "checking" || displayState === "working") {
    return "working";
  }

  if (displayState === "blocked") {
    return status?.status === "translator-not-ready" ? "attention" : "danger";
  }

  return "default";
}

function renderRuntimeRetry(status, displayState) {
  const disabled =
    displayState === "checking" ||
    displayState === "unavailable" ||
    displayState === "working" ||
    displayState === "excluded";
  const tone = getRuntimeRetryTone(status, displayState);

  elements.runtimeRetry.disabled = disabled;
  elements.runtimeRetry.dataset.tone = tone;
  elements.runtimeRetry.setAttribute(
    "aria-label",
    disabled && tone === "working" ? "Retry in progress" : "Retry current page"
  );
  elements.runtimeRetry.title = disabled && tone === "working" ? "Retry in progress" : "Retry current page";
}

function renderRuntimeStatus(status, displayState = "") {
  elements.runtimePanel.dataset.state = displayState || "";
  elements.runtimeTitle.textContent = "Current page";
  renderRuntimeRetry(status, displayState);

  if (displayState === "checking") {
    elements.runtimeStatus.textContent = "Checking this tab...";
    return;
  }

  if (displayState === "unavailable") {
    elements.runtimeStatus.textContent = status?.reason
      ? `Cannot read this tab: ${status.reason}`
      : "Open a normal webpage to see replacement status.";
    return;
  }

  if (!status) {
    elements.runtimeStatus.textContent = "No page status yet.";
    return;
  }

  const replacementCount = Number(status.replacementCount || 0);
  const target = getLanguageDisplayName(status.targetLanguage);

  if (status.status === "excluded") {
    elements.runtimeStatus.textContent = status.lastError || "Translation is off for this page.";
    return;
  }

  if (status.status === "translator-not-ready") {
    elements.runtimeStatus.textContent = `Chrome Translator needs page activation for English -> ${target}. Click once on the page to prepare it, then replacements will run.`;
    return;
  }

  if (status.status === "no-translator") {
    elements.runtimeStatus.textContent = "Chrome Translator API is not available in this browser/page.";
    return;
  }

  if (status.status === "translator-unavailable") {
    elements.runtimeStatus.textContent = `Chrome Translator is unavailable for English -> ${target}.`;
    return;
  }

  if (status.status === "translator-error") {
    elements.runtimeStatus.textContent = status.lastError || "Chrome Translator failed on this page.";
    return;
  }

  if (status.status === "checking-translator") {
    elements.runtimeStatus.textContent = "Checking Chrome Translator for this tab...";
    return;
  }

  if (status.status === "translator-preparing") {
    const progress = Number(status.translatorDownloadProgress || 0);
    elements.runtimeStatus.textContent =
      progress > 0 && progress < 1
        ? `Preparing Chrome Translator for English -> ${target}: ${Math.round(progress * 100)}%.`
        : `Preparing Chrome Translator for English -> ${target}.`;
    return;
  }

  if (status.status === "translating") {
    const elapsed = formatDuration(getRuntimeDurationMs(status, { includeRunning: true }));
    const elapsedText = elapsed ? ` for ${elapsed}` : "";
    elements.runtimeStatus.textContent = `Translating visible page text${elapsedText}. ${status.translationCalls || 0} translation call${status.translationCalls === 1 ? "" : "s"} so far.`;
    return;
  }

  if (replacementCount > 0) {
    elements.runtimeStatus.textContent = `${replacementCount} replacement${replacementCount === 1 ? "" : "s"} on visible page text.${getFinishedDurationText(status)}`;
    return;
  }

  const fallbackText = status.lastError || "No matching learned words found in visible page text.";
  elements.runtimeStatus.textContent = `${fallbackText}${getFinishedDurationText(status)}`;
}

function openManagerTab(options = {}) {
  const params = new URLSearchParams({ view: "tab" });
  if (options.autoImport) {
    params.set("import", "1");
  }

  chrome.tabs.create({
    url: chrome.runtime.getURL(`popup.html?${params.toString()}`)
  });
}

function openImportFilePicker() {
  if (!isTabView) {
    return;
  }

  elements.bulkPanel.open = true;
  elements.bulkPanel.scrollIntoView({ block: "center" });
  elements.bulkFile.focus();
  setImportStatus("Choose a CSV, TXT, or Duolingo export file.");

  setTimeout(() => {
    elements.bulkFile.click();
  }, 150);
}

function initializeImportPanel() {
  if (!isTabView) {
    setImportStatus("Click Import file to open the full manager tab.");
    return;
  }

  if (shouldAutoImport && !autoImportHandled) {
    autoImportHandled = true;
    openImportFilePicker();
  }
}

function runAfterFirstPaint(callback) {
  if (typeof requestAnimationFrame !== "function") {
    setTimeout(callback, 0);
    return;
  }

  requestAnimationFrame(() => {
    setTimeout(callback, 0);
  });
}

elements.form.addEventListener("submit", addOrUpdateEntry);
elements.cancelEdit.addEventListener("click", stopEdit);
elements.openTab.classList.toggle("hidden", isTabView);
elements.openTab.addEventListener("click", openManagerTab);
elements.settingsViewTab.addEventListener("click", () =>
  switchAppSection(appSection === "settings" ? "vocabulary" : "settings")
);
elements.profileSelect.addEventListener("change", () => switchProfile(elements.profileSelect.value));
elements.manualSection.addEventListener("click", () => switchVocabularySection("manual"));
elements.duolingoSection.addEventListener("click", () => switchVocabularySection("duolingo"));
elements.duolingoSync.addEventListener("click", syncFromDuolingo);
elements.languageTrigger.addEventListener("click", toggleLanguageMenu);
elements.languageTrigger.addEventListener("keydown", handleLanguageTriggerKeydown);
document.addEventListener("click", (event) => {
  if (!elements.languagePicker.contains(event.target)) {
    closeLanguageMenu();
  }
});
elements.enabled.addEventListener("change", () => updateSetting("enabled", elements.enabled.checked));
elements.showHighlights.addEventListener("change", () =>
  updateSetting("showHighlights", elements.showHighlights.checked)
);
elements.runtimeRetry.addEventListener("click", retryActiveTab);
elements.excludePage.addEventListener("click", () => toggleDoNotTranslate("page"));
elements.excludeSite.addEventListener("click", () => toggleDoNotTranslate("site"));
elements.clearDoNotTranslate.addEventListener("click", clearDoNotTranslate);
elements.source.addEventListener("input", () => {
  pendingDefinition = "";
  updateEntrySubmitState();
  renderSuggestions(false);
});
elements.source.addEventListener("focus", () => renderSuggestions(false));
elements.target.addEventListener("input", () => {
  pendingDefinition = "";
  updateEntrySubmitState();
});
elements.suggestReplacement.addEventListener("click", () => renderSuggestions(true));
elements.search.addEventListener("input", () => {
  searchQuery = elements.search.value;
  currentPage = 1;
  render();
});
elements.sortAlpha.addEventListener("click", sortAlphabetically);
elements.deleteAll.addEventListener("click", clearAllEntries);
elements.pageSize.addEventListener("change", () => {
  currentPage = 1;
  render();
});
elements.prevPage.addEventListener("click", () => {
  currentPage -= 1;
  render();
});
elements.nextPage.addEventListener("click", () => {
  currentPage += 1;
  render();
});
elements.bulkFile.addEventListener("change", () => {
  const file = elements.bulkFile.files && elements.bulkFile.files[0];
  setImportStatus(
    file
      ? `Ready to import ${file.name}.`
      : "Choose a CSV, TXT, or Duolingo export file."
  );
});
elements.importButton.addEventListener("click", importEntries);
elements.exportButton.addEventListener("click", exportEntries);
elements.clearAllButton.addEventListener("click", clearAllEntries);
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEY]) {
    return;
  }

  syncStoredState(changes[STORAGE_KEY].newValue);
});
chrome.tabs?.onActivated?.addListener(refreshTabBoundUi);
chrome.tabs?.onUpdated?.addListener(refreshUiForActiveTabUpdate);

loadState();
runAfterFirstPaint(refreshTabBoundUi);
