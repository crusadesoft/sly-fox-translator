// The Words page as a vocabulary manager.
//
// Duolingo's Words page lists what Duolingo taught you; this adds a tab bar
// that swaps that list for the extension's own panels, so every vocabulary
// task — imported words, hand-added words, flashcards — happens on the one
// page rather than in a popup.
//
// This file owns the tab strip and the manual-words panel. The other two tabs
// are Duolingo's own list (just hidden and shown) and the flashcards panel,
// which builds itself in flashcards.js.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const DUOLINGO_WORDS_TABS_ID = "learned-word-replacer-duolingo-words-tabs";
  const DUOLINGO_MANUAL_PANEL_ID = "learned-word-replacer-duolingo-manual-panel";
  // Which tab is open. The click that changes it is handled in
  // words-page-ui.js, so it lives on the namespace.
  LWR.duolingoWordsSection = "duolingo";
  let duolingoManualEditId = null;
  let duolingoManualFilter = "";

  function getDuolingoWordsLayout() {
    const heading = LWR.getDuolingoWordsCountHeading();
    const list = LWR.getDuolingoWordCollection().list;
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
    if (!LWR.isDuolingoWordsPage()) {
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
      const active = button.getAttribute("data-lwr-words-tab") === LWR.duolingoWordsSection;
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

    const manualActive = LWR.duolingoWordsSection === "manual";
    const flashcardsActive = LWR.duolingoWordsSection === "flashcards";
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

    let flashcardsPanel = document.getElementById(LWR.DUOLINGO_FLASHCARDS_PANEL_ID);
    if (flashcardsPanel && flashcardsPanel.parentElement !== layout.host) {
      flashcardsPanel.remove();
      flashcardsPanel = null;
    }
    if (!flashcardsPanel) {
      flashcardsPanel = LWR.buildDuolingoFlashcardsPanel(layout.heading.className);
      layout.host.append(flashcardsPanel);
    }
    const flashcardsDisplay = flashcardsActive ? "" : "none";
    if (flashcardsPanel.style.display !== flashcardsDisplay) {
      flashcardsPanel.style.display = flashcardsDisplay;
    }
    if (flashcardsActive) {
      LWR.renderDuolingoFlashcardsPanel();
    }
  }

  function duolingoManualInput(placeholder) {
    const theme = LWR.duolingoTheme();
    LWR.ensureDuolingoThemeStyle();
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.placeholder = placeholder;
    input.setAttribute("data-lwr-input", "");
    input.setAttribute("data-lwr-panel-input", "");
    input.setAttribute("data-lwr-theme", LWR.duolingoThemeName);
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
    const deleteAll = LWR.duolingoPanelButton("Delete all", { danger: true });
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
    const submit = LWR.duolingoPanelButton("Add");
    submit.type = "submit";
    submit.setAttribute("data-lwr-manual-submit", "");
    const cancel = LWR.duolingoPanelButton("Cancel");
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
    return LWR.getCurrentEntries().filter((entry) => entry.origin === "manual");
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

    const query = LWR.normalizeDuolingoWordKey(duolingoManualFilter);
    const entries = getDuolingoManualEntries().filter(
      (entry) =>
        !query ||
        LWR.normalizeDuolingoWordKey(entry.source).includes(query) ||
        LWR.normalizeDuolingoWordKey(entry.target).includes(query)
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

    const profile = LWR.getCurrentProfile();
    if (!profile) {
      return;
    }

    const editId = duolingoManualEditId;
    LWR.updateDuolingoProfileEntries((entries) => {
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
          id: LWR.createId(),
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
    const profile = LWR.getCurrentProfile();
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

    LWR.updateDuolingoProfileEntries((entries) =>
      entries.filter((entry) => entry.origin !== "manual")
    );
    renderDuolingoManualPanel();
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    ensureDuolingoWordsTabs,
    duolingoManualInput,
    renderDuolingoManualPanel,
    startDuolingoManualEdit,
    runDuolingoManualDeleteAll
  });
})();
