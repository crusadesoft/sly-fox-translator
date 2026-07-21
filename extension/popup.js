const STORAGE_KEY = "learnedWordReplacerState";
// Parsing and entry-merge logic shared with the background service worker
// (which runs imports triggered from the button on Duolingo's Words page).
const { createId, dedupeJoinedText, getEntryOrigin, isInvalidDuolingoSource } =
  globalThis.LWRImportCore;
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
  builtInProfilesVersion: 0,
  deletedBuiltInProfileIds: [],
  doNotTranslate: {
    sites: [],
    pages: []
  },
  profiles: []
};


const elements = {
  openDuolingoWords: document.getElementById("open-duolingo-words"),
  settingsViewTab: document.getElementById("settings-view-tab"),
  entryCount: document.getElementById("entry-count"),
  profileSelect: document.getElementById("profile-select"),
  languagePicker: document.getElementById("language-picker"),
  languageTrigger: document.getElementById("language-trigger"),
  languageTriggerIcon: document.getElementById("language-trigger-icon"),
  languageTriggerLabel: document.getElementById("language-trigger-label"),
  languageOptions: document.getElementById("language-options"),
  panicToggle: document.getElementById("panic-toggle"),
  runtimePanel: document.getElementById("page-status-panel"),
  runtimeTitle: document.getElementById("runtime-title"),
  runtimeStatus: document.getElementById("runtime-status"),
  runtimeRetry: document.getElementById("runtime-retry"),
  doNotTranslateActions: document.getElementById("do-not-translate-actions"),
  excludePage: document.getElementById("exclude-page"),
  excludePageLabel: document.getElementById("exclude-page-label"),
  excludeSite: document.getElementById("exclude-site"),
  excludeSiteLabel: document.getElementById("exclude-site-label")
};


let state = { ...DEFAULT_STATE };
let activeTabStatusRequestId = 0;
let runtimeStatusTabId = null;
const contentScriptInjectionPromises = new Map();

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
          languageCode: String(entry.languageCode || ""),
          definition: dedupeJoinedText(entry.definition, "; "),
          origin: getEntryOrigin(entry),
          createdAt: Number(entry.createdAt || Date.now())
        }))
        .filter((entry) => entry.source && entry.target && !isInvalidDuolingoImportEntry(entry))
    : [];
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
  delete next.showObviousCognates;
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
  }

  render();
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

function render() {
  const allEntries = getCurrentEntries();
  const manualCount = allEntries.filter((entry) => entry.origin === "manual").length;
  const duolingoCount = allEntries.filter((entry) => entry.origin === "duolingo").length;
  const replacingCount = allEntries.filter((entry) => entry.enabled).length;

  renderProfileOptions();
  elements.panicToggle.setAttribute("aria-pressed", String(!state.enabled));
  elements.panicToggle.title = state.enabled ? "Turn replacements off" : "Turn replacements on";
  elements.panicToggle.setAttribute("aria-label", elements.panicToggle.title);
  elements.entryCount.textContent = `${replacingCount} replacing / ${manualCount} manual / ${duolingoCount} Duolingo`;
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
  saveState();
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

      injectContentScripts(tab, { allFrames: true });
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

function sendActiveTabMessage(message) {
  return getActiveTab().then(
    (tab) => sendTabMessageWithRecovery(tab, message)
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

function isMissingContentScriptReceiver(response) {
  return (
    !response?.ok &&
    /could not establish connection|receiving end does not exist|no response from content script/i.test(
      String(response?.reason || "")
    )
  );
}

async function injectContentScripts(tab, options = {}) {
  if (!tab?.id || !isInjectableTabUrl(tab.url) || !chrome.scripting) {
    return false;
  }

  const target = { tabId: tab.id };
  if (options.allFrames) {
    target.allFrames = true;
  }

  try {
    await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      files: ["page-translator-bridge.js"]
    });
    await chrome.scripting.executeScript({
      target,
      files: ["content.js"]
    });
    return true;
  } catch (error) {
    return false;
  }
}

function ensureContentScripts(tab) {
  if (!tab?.id) {
    return Promise.resolve(false);
  }

  const existing = contentScriptInjectionPromises.get(tab.id);
  if (existing) {
    return existing;
  }

  const injection = injectContentScripts(tab).finally(() => {
    contentScriptInjectionPromises.delete(tab.id);
  });
  contentScriptInjectionPromises.set(tab.id, injection);
  return injection;
}

async function sendTabMessageWithRecovery(tab, message) {
  const response = await sendTabMessage(tab, message);
  if (!isMissingContentScriptReceiver(response) || !(await ensureContentScripts(tab))) {
    return response;
  }

  return sendTabMessage(tab, message);
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
  renderRuntimeStatus(null, "checking");
  const tab = await getActiveTab();
  if (requestId !== activeTabStatusRequestId) {
    return;
  }

  renderDoNotTranslateActions(tab);
  runtimeStatusTabId = tab?.id || null;
  const response = await sendTabMessageWithRecovery(tab, { type: "LWR_GET_STATUS" });
  if (requestId !== activeTabStatusRequestId) {
    return;
  }

  if (!response.ok) {
    renderRuntimeStatus({ reason: response.reason }, "unavailable");
    return;
  }

  renderRuntimeStatus(response.status, getRuntimeDisplayState(response.status));
}

function refreshTabBoundUi() {
  refreshActiveTabStatus();
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
  runtimeStatusTabId = tab?.id || null;
  await prepareActiveTabTranslator(tab);
  const response = await sendTabMessageWithRecovery(tab, { type: "LWR_RETRY" });

  if (!response.ok) {
    renderRuntimeStatus({ reason: response.reason }, "unavailable");
  } else {
    renderRuntimeStatus(response.status, getRuntimeDisplayState(response.status));
  }

}

function handleRuntimeStatusMessage(message, sender) {
  if (
    !message ||
    message.type !== "LWR_STATUS" ||
    !sender?.tab?.id ||
    sender.tab.id !== runtimeStatusTabId
  ) {
    return;
  }

  renderRuntimeStatus(message.status || null, getRuntimeDisplayState(message.status));
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
  const wordFamilyReplacementCount = Number(status.wordFamilyReplacementCount || 0);
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
    elements.runtimeStatus.textContent = `Translating page text as you browse${elapsedText}. ${status.translationCalls || 0} translation call${status.translationCalls === 1 ? "" : "s"} so far.`;
    return;
  }

  if (replacementCount > 0) {
    elements.runtimeStatus.textContent = `${replacementCount} replacement${replacementCount === 1 ? "" : "s"} on page text processed so far, including ${wordFamilyReplacementCount} inflected word form${wordFamilyReplacementCount === 1 ? "" : "s"}.${getFinishedDurationText(status)}`;
    return;
  }

  const fallbackText = status.lastError || "No matching learned words found in page text processed so far.";
  elements.runtimeStatus.textContent = `${fallbackText}${getFinishedDurationText(status)}`;
}

function openDuolingoSettingsPage() {
  // All settings live on the Duolingo settings page now; #sly-fox makes the
  // content script open the Sly Fox panel there directly.
  chrome.tabs.create({ url: "https://www.duolingo.com/settings/account#sly-fox" });
  window.close();
}

function openDuolingoWordsPage() {
  // Duolingo vocabulary is managed on the Words page (import button and
  // per-word chips are injected there).
  chrome.tabs.create({ url: "https://www.duolingo.com/practice-hub/words" });
  window.close();
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

elements.settingsViewTab.addEventListener("click", openDuolingoSettingsPage);
elements.openDuolingoWords.addEventListener("click", openDuolingoWordsPage);
elements.profileSelect.addEventListener("change", () => switchProfile(elements.profileSelect.value));
elements.languageTrigger.addEventListener("click", toggleLanguageMenu);
elements.languageTrigger.addEventListener("keydown", handleLanguageTriggerKeydown);
document.addEventListener("click", (event) => {
  if (!elements.languagePicker.contains(event.target)) {
    closeLanguageMenu();
  }
});
elements.panicToggle.addEventListener("click", () => updateSetting("enabled", !state.enabled));
elements.runtimeRetry.addEventListener("click", retryActiveTab);
elements.excludePage.addEventListener("click", () => toggleDoNotTranslate("page"));
elements.excludeSite.addEventListener("click", () => toggleDoNotTranslate("site"));
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[STORAGE_KEY]) {
    return;
  }

  syncStoredState(changes[STORAGE_KEY].newValue);
});
chrome.runtime?.onMessage?.addListener(handleRuntimeStatusMessage);
chrome.tabs?.onActivated?.addListener(refreshTabBoundUi);
chrome.tabs?.onUpdated?.addListener(refreshUiForActiveTabUpdate);

loadState();
runAfterFirstPaint(refreshTabBoundUi);
