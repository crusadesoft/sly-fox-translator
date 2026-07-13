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

if (chrome.sidePanel?.setPanelBehavior) {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onStartup?.addListener(restoreOpenTabContentScripts);
chrome.runtime.onInstalled?.addListener(restoreOpenTabContentScripts);

chrome.runtime.onMessage.addListener((message, sender) => {
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
      files: ["page-translator-bridge.js"]
    });
    await chrome.scripting.executeScript({
      target,
      files: ["content.js"]
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
