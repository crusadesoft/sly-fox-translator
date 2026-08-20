// The extension's own chrome inside Duolingo's pages.
//
// This is the wiring module for the Duolingo side: it starts the observer that
// keeps every injected surface alive across Duolingo's SPA routes, and it owns
// the one delegated click listener that every injected control routes through.
// Delegation rather than per-element listeners, because Duolingo re-renders
// constantly and clones subtrees for its transitions — a listener attached to
// a button does not survive that, an id check on the way up always does.
//
// The Import button and the "with Sly Fox" badge live here too; the panels
// those clicks reach into live in their own files.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
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
    if (globalThis !== globalThis.top || !LWR.isDuolingoHost()) {
      return;
    }

    const existing = document.getElementById(DUOLINGO_LOGO_BADGE_ID);
    const link = LWR.state.enabled ? findDuolingoWordmarkLink() : null;

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
    if (globalThis !== globalThis.top || !LWR.isDuolingoHost() || duolingoImportObserver) {
      return;
    }

    // Every duolingo.com page load reaches here, so this is where the light /
    // dark palette gets read and kept in step with the page.
    LWR.watchDuolingoTheme();
    LWR.ensureDuolingoThemeStyle();

    duolingoImportObserver = new MutationObserver(() => {
      ensureDuolingoImportButton();
      LWR.ensureDuolingoSettingsUi();
      LWR.ensureDuolingoWordsInfo();
      LWR.ensureDuolingoWordsTabs();
      LWR.ensureDuolingoSectionCard();
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
    LWR.ensureDuolingoSettingsUi();
    LWR.ensureDuolingoWordsInfo();
    LWR.ensureDuolingoWordsTabs();
    LWR.ensureDuolingoSectionCard();
    ensureDuolingoLogoBadge();
    document.addEventListener(
      "click",
      (event) => {
        const closest = (selector) =>
          event.target && event.target.closest ? event.target.closest(selector) : null;

        if (closest(`[id='${LWR.DUOLINGO_SECTION_CARD_ID}']`)) {
          // Duolingo's router owns clicks inside the sections list; keep it out
          // of a card that is not one of its routes.
          event.preventDefault();
          event.stopPropagation();
          LWR.openDuolingoSectionPage();
          return;
        }

        if (closest(`[id='${DUOLINGO_IMPORT_BUTTON_ID}']`)) {
          runDuolingoPageImport();
          return;
        }

        if (closest(`[id='${DUOLINGO_WORDS_DELETE_ID}']`)) {
          LWR.runDuolingoWordsDeleteAll();
          return;
        }

        if (closest(`[id='${LWR.DUOLINGO_FLASHCARDS_QUICKSTART_ID}']`)) {
          LWR.runDuolingoFlashcardsQuickstart();
          return;
        }

        const bucketChip = closest("button[data-lwr-flashcards-bucket]");
        if (bucketChip) {
          LWR.toggleDuolingoFlashcardsBucket(
            bucketChip.getAttribute("data-lwr-flashcards-bucket")
          );
          return;
        }

        const wordsTab = closest("button[data-lwr-words-tab]");
        if (wordsTab) {
          LWR.duolingoWordsSection = wordsTab.getAttribute("data-lwr-words-tab");
          LWR.ensureDuolingoWordsTabs();
          return;
        }

        const manualEdit = closest("button[data-lwr-manual-edit]");
        if (manualEdit) {
          LWR.startDuolingoManualEdit(manualEdit.getAttribute("data-lwr-manual-edit"));
          return;
        }

        if (closest("button[data-lwr-manual-delete-all]")) {
          LWR.runDuolingoManualDeleteAll();
          return;
        }

        const entryToggle = closest("input[data-lwr-entry-id]");
        if (entryToggle) {
          // A checkbox in the manual list; let the checkbox update itself,
          // the storage write and re-render follow.
          LWR.toggleDuolingoEntryEnabled(entryToggle.getAttribute("data-lwr-entry-id"));
          return;
        }

        const wordChipRemove = closest("button[data-lwr-entry-remove]");
        if (wordChipRemove) {
          event.preventDefault();
          event.stopPropagation();
          LWR.removeDuolingoEntry(wordChipRemove.getAttribute("data-lwr-entry-remove"));
          return;
        }

        const wordChip = closest("button[data-lwr-entry-id]");
        if (wordChip) {
          event.preventDefault();
          event.stopPropagation();
          LWR.toggleDuolingoEntryEnabled(wordChip.getAttribute("data-lwr-entry-id"));
          return;
        }

        const settingsLink = closest(`[id='${LWR.DUOLINGO_SETTINGS_LINK_ID}']`);
        if (settingsLink) {
          // Keep Duolingo's router away from our synthetic settings route.
          event.preventDefault();
          event.stopPropagation();
          LWR.activateDuolingoSettingsPanel(settingsLink);
          return;
        }

        if (closest("a[href^='/settings']")) {
          LWR.deactivateDuolingoSettingsPanel();
        }
      },
      true
    );
    ensureDuolingoImportButton();
    LWR.ensureDuolingoSettingsUi();
    LWR.ensureDuolingoWordsInfo();
    LWR.ensureDuolingoWordsTabs();
  }

  function ensureDuolingoImportButton() {
    // Guard every write: this runs from a MutationObserver.
    if (!LWR.isDuolingoWordsPage()) {
      document
        .querySelectorAll(`[id='${DUOLINGO_IMPORT_WRAP_ID}']`)
        .forEach((wrap) => wrap.remove());
      return;
    }

    const heading = LWR.getDuolingoWordsCountHeading();
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
    flashcardsButton.id = LWR.DUOLINGO_FLASHCARDS_QUICKSTART_ID;
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
      const scraped = await LWR.scrapeAllDuolingoWords();
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

  // Reached for by other modules.
  Object.assign(LWR, {
    syncDuolingoPageUi,
    ensureDuolingoLogoBadge,
    setDuolingoImportStatus
  });
})();
