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
  const DUOLINGO_EXPORT_BUTTON_ID = "learned-word-replacer-duolingo-export-button";
  const DUOLINGO_EXPORT_BUTTON_LABEL = "Export word list";
  const DUOLINGO_LINGQ_BUTTON_ID = "learned-word-replacer-duolingo-lingq-button";
  const DUOLINGO_LINGQ_BUTTON_LABEL = "Export for LingQ";
  const DUOLINGO_WORDS_DELETE_ID = "learned-word-replacer-duolingo-words-delete";
  const DUOLINGO_IMPORT_STATUS_ID = "learned-word-replacer-duolingo-import-status";
  const DUOLINGO_IMPORT_WRAP_ID = "learned-word-replacer-duolingo-import-wrap";
  const DUOLINGO_LOGO_BADGE_ID = "learned-word-replacer-duolingo-logo-badge";
  let duolingoImportObserver = null;
  let duolingoImportInProgress = false;
  let duolingoExportInProgress = false;
  let duolingoLingqInProgress = false;

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

        if (closest(`[id='${DUOLINGO_EXPORT_BUTTON_ID}']`)) {
          runDuolingoWordListExport();
          return;
        }

        if (closest(`[id='${DUOLINGO_LINGQ_BUTTON_ID}']`)) {
          runDuolingoLingqExport();
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

    const exportButton = document.createElement("button");
    exportButton.id = DUOLINGO_EXPORT_BUTTON_ID;
    exportButton.type = "button";
    exportButton.textContent = DUOLINGO_EXPORT_BUTTON_LABEL;
    exportButton.title =
      "Download every learned word on this page as a text file you can read or share";
    exportButton.style.cssText = button.style.cssText
      .replaceAll("rgb(28, 176, 246)", "rgb(165, 96, 232)");

    const lingqButton = document.createElement("button");
    lingqButton.id = DUOLINGO_LINGQ_BUTTON_ID;
    lingqButton.type = "button";
    lingqButton.textContent = DUOLINGO_LINGQ_BUTTON_LABEL;
    lingqButton.title =
      "Download your Sly Fox vocabulary as a CSV in LingQ's import format";
    lingqButton.style.cssText = button.style.cssText
      .replaceAll("rgb(28, 176, 246)", "rgb(255, 150, 0)");

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
    wrap.append(button, exportButton, lingqButton, deleteButton, flashcardsButton, status);
    heading.insertAdjacentElement("afterend", wrap);

    if (duolingoImportInProgress) {
      button.disabled = true;
      button.textContent = "Importing…";
    }
    syncDuolingoExportButton();
    syncDuolingoLingqButton();
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

  function syncDuolingoExportButton() {
    document.querySelectorAll(`[id='${DUOLINGO_EXPORT_BUTTON_ID}']`).forEach((button) => {
      button.disabled = duolingoExportInProgress;
      button.textContent = duolingoExportInProgress ? "Exporting…" : DUOLINGO_EXPORT_BUTTON_LABEL;
    });
  }

  function syncDuolingoLingqButton() {
    document.querySelectorAll(`[id='${DUOLINGO_LINGQ_BUTTON_ID}']`).forEach((button) => {
      button.disabled = duolingoLingqInProgress;
      button.textContent = duolingoLingqInProgress ? "Exporting…" : DUOLINGO_LINGQ_BUTTON_LABEL;
    });
  }

  // Hand the browser a file. Duolingo re-renders constantly, so the anchor is
  // created, clicked and removed inside one turn rather than left in the page.
  function downloadTextFile(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  // The vocabulary as something to read, rather than as something the
  // extension consumes: one "word — meanings" line per learned word, so the
  // whole list can be handed to a person or to an AI. Pitching a lesson at the
  // right difficulty is guesswork without knowing which words are already
  // known, and that knowledge only exists inside Duolingo's own Words page.
  //
  // The em dash is the separator the importer already reads and "#" now opens
  // a comment line there, so an exported list imports back unchanged.
  function buildDuolingoWordListFile(scraped) {
    const language = scraped.languageName || "Duolingo";
    const lines = [
      `# ${language} words learned on Duolingo — exported by Sly Fox Translator`,
      `# ${scraped.count} word${scraped.count === 1 ? "" : "s"}, ${new Date().toISOString().slice(0, 10)}`,
      "# One line per word: word — meanings",
      "",
      ...scraped.records.map((record) => `${record.word} — ${record.meanings}`)
    ];

    return `${lines.join("\n")}\n`;
  }

  function duolingoWordListFilename(languageName) {
    const slug =
      String(languageName || "")
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "") || "duolingo";
    return `sly-fox-${slug}-words.txt`;
  }

  async function runDuolingoWordListExport() {
    // Import and export both drive Duolingo's "Load more" button; running them
    // at once would have each waiting on the other's rows.
    if (duolingoImportInProgress || duolingoExportInProgress) {
      return;
    }

    duolingoExportInProgress = true;
    syncDuolingoExportButton();
    setDuolingoImportStatus("Loading every learned word from this page…");

    try {
      const scraped = await LWR.scrapeAllDuolingoWords();
      const filename = duolingoWordListFilename(scraped.languageName);
      downloadTextFile(filename, buildDuolingoWordListFile(scraped), "text/plain;charset=utf-8");
      setDuolingoImportStatus(
        `Downloaded ${scraped.count} word${scraped.count === 1 ? "" : "s"} as ${filename}`,
        "rgb(88, 167, 0)"
      );
    } catch (error) {
      setDuolingoImportStatus(
        error && error.message ? error.message : "Could not export the word list.",
        "rgb(234, 43, 43)"
      );
    } finally {
      duolingoExportInProgress = false;
      syncDuolingoExportButton();
    }
  }

  // The vocabulary in LingQ's import shape.
  //
  // Unlike "Export word list" beside it, this does NOT re-scrape Duolingo's
  // page: it reads the stored Sly Fox vocabulary, which is the Duolingo import
  // plus any words added by hand, and is what "my words" means everywhere else
  // in the extension. It also means this cannot collide with an import or an
  // export already walking Duolingo's "Load more" -- there is nothing to walk.
  //
  // The file is built in the service worker because import-core.js lives there,
  // and downloaded here because a service worker has no document to click a
  // link in.
  async function runDuolingoLingqExport() {
    if (duolingoLingqInProgress) {
      return;
    }

    duolingoLingqInProgress = true;
    syncDuolingoLingqButton();
    setDuolingoImportStatus("Building a LingQ file from your Sly Fox words…");

    try {
      const result = await chrome.runtime.sendMessage({ type: LWR.LINGQ_EXPORT_REQUEST });
      if (!result?.ok) {
        throw new Error(result?.reason || "Could not export for LingQ.");
      }

      downloadTextFile(result.filename, result.csv, "text/csv;charset=utf-8");
      setDuolingoImportStatus(
        `Downloaded ${result.count} row${result.count === 1 ? "" : "s"} as ${result.filename}`,
        "rgb(88, 167, 0)"
      );
    } catch (error) {
      setDuolingoImportStatus(
        error && error.message ? error.message : "Could not export for LingQ.",
        "rgb(234, 43, 43)"
      );
    } finally {
      duolingoLingqInProgress = false;
      syncDuolingoLingqButton();
    }
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    syncDuolingoPageUi,
    ensureDuolingoLogoBadge,
    setDuolingoImportStatus
  });
})();
