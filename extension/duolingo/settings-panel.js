// The extension's own pane inside Duolingo's settings page.
//
// Mobile browsers often have neither a popup nor a side panel, so the settings
// have to live somewhere reachable on the page itself — and Duolingo's own
// settings page is where a learner already goes to change how lessons behave.
//
// Duolingo's settings markup has no stable hooks, so the nav item is a deep
// clone of one of their own (which brings the card styling and the mobile
// chevron with it) and the panel copies the hidden pane's classes to keep the
// column layout. The link's href is "#sly-fox" rather than a path: Duolingo's
// router ignores hashes, and it keeps middle-click and new-tab working.
//
// The small panel widgets (section, heading, button) live here because this is
// the biggest panel; the manual and flashcards panels borrow them.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
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
    return LWR.isDuolingoHost() && globalThis.location.pathname.startsWith("/settings");
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
      LWR.state = { ...LWR.state, [row.key]: checkbox.checked };
      chrome.storage.local.set({ [LWR.STORAGE_KEY]: LWR.state });
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
    const profile = LWR.getCurrentProfile();
    const count = LWR.getCurrentEntries().length;
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

    const profiles = LWR.state.profiles.map((candidate) =>
      candidate === profile ? { ...candidate, entries: [] } : candidate
    );
    LWR.state = { ...LWR.state, profiles };
    chrome.storage.local.set({ [LWR.STORAGE_KEY]: LWR.state });
    setDuolingoFileStatus(`Deleted ${count} word${count === 1 ? "" : "s"} from ${profile.name}.`, false);
  }

  function removeDuolingoExclusion(kind, value) {
    const exclusions = LWR.state.doNotTranslate || { sites: [], pages: [] };
    LWR.state = {
      ...LWR.state,
      doNotTranslate: {
        sites: (exclusions.sites || []).filter(
          (site) => !(kind === "sites" && site === value)
        ),
        pages: (exclusions.pages || []).filter(
          (excludedPage) => !(kind === "pages" && excludedPage === value)
        )
      }
    };
    chrome.storage.local.set({ [LWR.STORAGE_KEY]: LWR.state });
  }

  function renderDuolingoExclusionList() {
    const exclusions = LWR.state.doNotTranslate || { sites: [], pages: [] };
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
      const wanted = Boolean(LWR.state[checkbox.getAttribute("data-lwr-setting")]);
      if (checkbox.checked !== wanted) {
        checkbox.checked = wanted;
      }

      const supersededBy = checkbox.getAttribute("data-lwr-superseded-by");
      const superseded = Boolean(supersededBy && LWR.state[supersededBy]);
      checkbox.disabled = superseded;
      const row = checkbox.closest("label");
      if (row) {
        row.style.opacity = superseded ? "0.45" : "";
        row.style.cursor = superseded ? "default" : "pointer";
      }
    });
    renderDuolingoExclusionList();
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    DUOLINGO_SETTINGS_LINK_ID,
    ensureDuolingoSettingsUi,
    activateDuolingoSettingsPanel,
    deactivateDuolingoSettingsPanel,
    syncDuolingoSettingsPanelValues,
    duolingoPanelButton
  });
})();
