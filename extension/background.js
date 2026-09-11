import "./vendor/ukrainian-morphology.js";
import "./shared/import-core.js";

const STORAGE_KEY = "learnedWordReplacerState";
const UKRAINIAN_MORPHOLOGY_PATH = "vendor/ukrainian-morphology/ukrainian.dict";
// The content-script modules, in load order. Must match manifest.json: an
// extension reload replays exactly this list into every open tab.
const CONTENT_SCRIPT_FILES = [
  "shared/namespace.js",
  "shared/constants.js",
  "shared/state.js",
  "translate/constants.js",
  "translate/runtime.js",
  "translate/text-utils.js",
  "translate/styles.js",
  "translate/vocabulary.js",
  "translate/translator-bridge.js",
  "translate/translator.js",
  "translate/cloak.js",
  "translate/collect.js",
  "translate/replacement-dom.js",
  "translate/alignment.js",
  "translate/structured.js",
  "translate/passes.js",
  "translate/hover.js",
  "translate/apply.js",
  "duolingo/page.js",
  "duolingo/theme.js",
  "duolingo/lesson-flow.js",
  "duolingo/word-bank.js",
  "duolingo/typing.js",
  "duolingo/copy-phrase.js",
  "duolingo/words-scrape.js",
  "duolingo/words-entries.js",
  "duolingo/manual-panel.js",
  "duolingo/flashcards.js",
  "duolingo/settings-panel.js",
  "duolingo/section-card.js",
  "duolingo/words-page-ui.js",
  "youtube/sentence-lesson.js",
  "youtube/language-reactor.js",
  "boot.js"
];
const UKRAINIAN_LEMMA_REQUEST = "LWR_LOOKUP_UK_LEMMAS";
const DUOLINGO_PAGE_IMPORT_REQUEST = "LWR_IMPORT_DUOLINGO_WORDS";
const TEXT_IMPORT_REQUEST = "LWR_IMPORT_TEXT";
const CSV_EXPORT_REQUEST = "LWR_EXPORT_CSV";
const OPEN_LESSON_REQUEST = "LWR_OPEN_IMPROMPTU_LESSON";
const LINGQ_EXPORT_REQUEST = "LWR_EXPORT_LINGQ_CSV";
const WORD_ALIGNMENT_REQUEST = "LWR_ALIGN_WORDS";
const WORD_ALIGNMENT_RUN_REQUEST = "LWR_ALIGN_WORDS_RUN";
const MAX_ALIGNMENT_CACHE_ENTRIES = 300;
const BLOCKED_STATUSES = new Set([
  "no-translator",
  "translator-unavailable",
  "translator-not-ready",
  "translator-error"
]);
const WORKING_STATUSES = new Set([
  "checking-translator",
  "translator-preparing",
  "translating"
]);
let ukrainianMorphologyPromise = null;
const ukrainianLemmaCache = new Map();

chrome.runtime.onStartup?.addListener(restoreOpenTabContentScripts);
chrome.runtime.onInstalled?.addListener(restoreOpenTabContentScripts);

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === UKRAINIAN_LEMMA_REQUEST) {
    lookupUkrainianLemmas(message.words)
      .then((lemmas) => sendResponse({ ok: true, lemmas }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Lemma lookup failed." }));
    return true;
  }

  // A lesson built on a web page opens in the player, which is an extension
  // page. The content script cannot navigate to one itself -- section/* is only
  // web-accessible from duolingo.com, and widening that to every site the
  // extension runs on would be a much bigger door than this needs. So the tab
  // is opened here, where the URL is the extension's own either way.
  if (message?.type === OPEN_LESSON_REQUEST) {
    chrome.tabs
      .create({
        url: chrome.runtime.getURL("section/lesson.html?impromptu=1"),
        openerTabId: sender.tab?.id
      })
      .then(() => sendResponse({ ok: true }))
      .catch((error) =>
        sendResponse({ ok: false, reason: error?.message || "Could not open the lesson." })
      );
    return true;
  }

  if (message?.type === WORD_ALIGNMENT_REQUEST) {
    alignWordsCached(String(message.source || ""), String(message.translated || ""))
      .then((pairs) => sendResponse({ ok: true, pairs }))
      .catch((error) =>
        sendResponse({ ok: false, error: error?.message || "Word alignment failed." })
      );
    return true;
  }

  if (message?.type === DUOLINGO_PAGE_IMPORT_REQUEST) {
    importDuolingoWordsFromPage(message)
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, reason: error?.message || "Could not import Duolingo words." })
      );
    return true;
  }

  if (message?.type === TEXT_IMPORT_REQUEST) {
    applyStoredStateChange((state) =>
      globalThis.LWRImportCore.applyTextImport(state, {
        text: message.text,
        originOverride: message.originOverride
      })
    )
      .then(sendResponse)
      .catch((error) =>
        sendResponse({ ok: false, reason: error?.message || "Could not import the file." })
      );
    return true;
  }

  // The same vocabulary, shaped for LingQ's own importer rather than ours.
  // It reads the stored state here for the same reason the CSV export does:
  // import-core.js is a service-worker module, not a content script.
  if (message?.type === LINGQ_EXPORT_REQUEST) {
    chrome.storage.local
      .get(STORAGE_KEY)
      .then((stored) => {
        const state = stored?.[STORAGE_KEY];
        if (!state) {
          sendResponse({ ok: false, reason: "Open the extension once before exporting." });
          return;
        }
        sendResponse(globalThis.LWRImportCore.buildLingqCsv(state));
      })
      .catch((error) =>
        sendResponse({ ok: false, reason: error?.message || "Could not export for LingQ." })
      );
    return true;
  }

  if (message?.type === CSV_EXPORT_REQUEST) {
    chrome.storage.local
      .get(STORAGE_KEY)
      .then((stored) => {
        const state = stored?.[STORAGE_KEY];
        if (!state) {
          sendResponse({ ok: false, reason: "Open the extension once before exporting." });
          return;
        }
        sendResponse(
          globalThis.LWRImportCore.buildVocabularyCsv(state, { origin: message.origin })
        );
      })
      .catch((error) =>
        sendResponse({ ok: false, reason: error?.message || "Could not export the vocabulary." })
      );
    return true;
  }

  if (
    !message ||
    message.type !== "LWR_STATUS" ||
    !sender.tab ||
    typeof sender.tab.id !== "number"
  ) {
    return;
  }

  if (typeof sender.frameId === "number" && sender.frameId !== 0) {
    return;
  }

  updateBadge(sender.tab.id, message.status || {});
});

// Reads stored state, applies a pure transform from import-core, persists the
// result. The popup (if open) refreshes itself through storage.onChanged, and
// open tabs pick changes up the same way.
async function applyStoredStateChange(transform) {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const state = stored?.[STORAGE_KEY];
  if (!state || !Array.isArray(state.profiles)) {
    return { ok: false, reason: "Open the extension once before importing." };
  }

  const result = transform(state);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  await chrome.storage.local.set({ [STORAGE_KEY]: result.state });
  const { state: _persisted, ...summary } = result;
  return summary;
}

function importDuolingoWordsFromPage(message) {
  return applyStoredStateChange((state) =>
    globalThis.LWRImportCore.applyDuolingoImport(state, {
      text: message.text,
      languageName: message.languageName
    })
  );
}

async function lookupUkrainianLemmas(words) {
  const uniqueWords = Array.from(
    new Set(
      (Array.isArray(words) ? words : [])
        .map((word) => String(word || "").trim().toLocaleLowerCase("uk"))
        .filter((word) => word && word.length <= 96)
    )
  ).slice(0, 600);
  const missingWords = uniqueWords.filter((word) => !ukrainianLemmaCache.has(word));

  if (missingWords.length) {
    const morphology = await getUkrainianMorphology();
    for (const word of missingWords) {
      ukrainianLemmaCache.set(word, morphology.lookup(word));
    }
  }

  return Object.fromEntries(uniqueWords.map((word) => [word, ukrainianLemmaCache.get(word) || []]));
}

function getUkrainianMorphology() {
  if (!ukrainianMorphologyPromise) {
    ukrainianMorphologyPromise = loadUkrainianMorphology().catch((error) => {
      ukrainianMorphologyPromise = null;
      throw error;
    });
  }

  return ukrainianMorphologyPromise;
}

async function loadUkrainianMorphology() {
  if (!globalThis.LWRUkrainianMorphology) {
    throw new Error("Ukrainian morphology reader is unavailable.");
  }

  const response = await fetch(chrome.runtime.getURL(UKRAINIAN_MORPHOLOGY_PATH));
  if (!response.ok) {
    throw new Error("Ukrainian morphology dictionary could not be loaded.");
  }

  return globalThis.LWRUkrainianMorphology.create(await response.arrayBuffer());
}

const alignmentCache = new Map();
let offscreenDocumentPromise = null;

async function ensureOffscreenDocument() {
  if (typeof chrome.offscreen?.hasDocument === "function" && (await chrome.offscreen.hasDocument())) {
    return;
  }

  if (!offscreenDocumentPromise) {
    offscreenDocumentPromise = chrome.offscreen
      .createDocument({
        url: "translate/offscreen.html",
        reasons: ["WORKERS"],
        justification:
          "Runs the on-device word-alignment model; service workers cannot host onnxruntime."
      })
      .catch((error) => {
        offscreenDocumentPromise = null;
        if (!String(error?.message || "").toLowerCase().includes("single offscreen")) {
          throw error;
        }
      });
  }

  await offscreenDocumentPromise;
}

async function alignWordsCached(sourceText, translatedText) {
  if (!sourceText.trim() || !translatedText.trim()) {
    return [];
  }

  const cacheKey = `${sourceText}\u0000${translatedText}`;
  if (alignmentCache.has(cacheKey)) {
    return alignmentCache.get(cacheKey);
  }

  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({
    type: WORD_ALIGNMENT_RUN_REQUEST,
    source: sourceText,
    translated: translatedText
  });

  if (!response?.ok || !Array.isArray(response.pairs)) {
    throw new Error(response?.error || "Offscreen word alignment failed.");
  }

  alignmentCache.set(cacheKey, response.pairs);
  if (alignmentCache.size > MAX_ALIGNMENT_CACHE_ENTRIES) {
    alignmentCache.delete(alignmentCache.keys().next().value);
  }

  return response.pairs;
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    clearBadge(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  clearBadge(tabId);
});

function restoreOpenTabContentScripts() {
  if (!chrome.tabs?.query || !chrome.scripting?.executeScript) {
    return;
  }

  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs || []) {
      if (!tab.id || !/^(https?:|file:)/.test(String(tab.url || ""))) {
        continue;
      }

      injectScripts(tab.id);
    }
  });
}

async function injectScripts(tabId) {
  const target = { tabId, allFrames: true };

  try {
    await chrome.scripting.executeScript({
      target,
      world: "MAIN",
      files: ["translate/page-translator-bridge.js"]
    });
    await chrome.scripting.executeScript({
      target,
      files: CONTENT_SCRIPT_FILES
    });
  } catch (error) {
    // Tabs can navigate or close while an extension reload is restoring scripts.
  }
}

function updateBadge(tabId, status) {
  if (!status.enabled || status.status === "disabled" || status.status === "no-active-entries") {
    clearBadge(tabId);
    return;
  }

  if (BLOCKED_STATUSES.has(status.status)) {
    setBadgeText({ tabId, text: "!" });
    setBadgeBackgroundColor({ tabId, color: "#c2410c" });
    setTitle({
      tabId,
      title: status.lastError || "Sly Fox Translator needs Chrome Translator"
    });
    return;
  }

  if (WORKING_STATUSES.has(status.status)) {
    setBadgeText({ tabId, text: "..." });
    setBadgeBackgroundColor({ tabId, color: "#2563eb" });
    setTitle({
      tabId,
      title: getWorkingTitle(status)
    });
    return;
  }

  if (Number(status.replacementCount || 0) > 0) {
    const count = Math.min(Number(status.replacementCount), 99);
    setBadgeText({ tabId, text: String(count) });
    setBadgeBackgroundColor({ tabId, color: "#157347" });
    setTitle({
      tabId,
      title: `${status.replacementCount} learned word replacement${status.replacementCount === 1 ? "" : "s"}`
    });
    return;
  }

  clearBadge(tabId);
}

function clearBadge(tabId) {
  setBadgeText({ tabId, text: "" });
  setTitle({ tabId, title: "Sly Fox Translator" });
}

function setBadgeText(args) {
  callAction("setBadgeText", args);
}

function setBadgeBackgroundColor(args) {
  callAction("setBadgeBackgroundColor", args);
}

function setTitle(args) {
  callAction("setTitle", args);
}

function callAction(method, args) {
  try {
    const result = chrome.action[method](args);
    if (result && typeof result.catch === "function") {
      result.catch(() => {
        // Tab-specific badge updates are best-effort; tabs can disappear mid-update.
      });
    }
  } catch (error) {
    // The tab can already be gone when Chrome fires a late status/removal event.
  }
}

function getWorkingTitle(status) {
  if (status.status === "checking-translator") {
    return "Checking Chrome Translator";
  }

  if (status.status === "translator-preparing") {
    return "Preparing Chrome Translator";
  }

  const calls = Number(status.translationCalls || 0);
  return calls > 0
    ? `Translating visible page text (${calls} call${calls === 1 ? "" : "s"})`
    : "Translating visible page text";
}
