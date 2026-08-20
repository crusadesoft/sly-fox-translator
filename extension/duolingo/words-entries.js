// Per-word vocabulary info embedded in the Words page list: each row grows
// chips for the extension entries replacing that word (click = pause/resume
// that replacement), replacing the popup's Duolingo vocabulary browser.
//
// This file also owns the one place the Duolingo side writes vocabulary back
// to storage. Everything that edits entries — the chips here, the manual panel,
// the delete-all buttons — goes through updateDuolingoProfileEntries, so there
// is a single path from a click to a saved profile.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  function normalizeDuolingoWordKey(value) {
    return String(value || "")
      .normalize("NFC")
      .toLocaleLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildDuolingoEntriesByWord() {
    const map = new Map();
    for (const entry of LWR.getCurrentEntries()) {
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
    const profile = LWR.getCurrentProfile();
    if (!profile) {
      return;
    }

    const profiles = LWR.state.profiles.map((candidate) =>
      candidate === profile
        ? { ...candidate, entries: mapEntries(candidate.entries) }
        : candidate
    );
    LWR.state = { ...LWR.state, profiles };
    chrome.storage.local.set({ [LWR.STORAGE_KEY]: LWR.state });
    // Re-render immediately; the storage event follows for everything else.
    ensureDuolingoWordsInfo();
    LWR.renderDuolingoManualPanel();
  }

  function toggleDuolingoEntryEnabled(entryId) {
    updateDuolingoProfileEntries((entries) =>
      entries.map((entry) =>
        entry.id === entryId ? { ...entry, enabled: !entry.enabled } : entry
      )
    );
  }

  function runDuolingoWordsDeleteAll() {
    const profile = LWR.getCurrentProfile();
    const count = LWR.getCurrentEntries().filter((entry) => entry.origin === "duolingo").length;
    if (!profile || !count) {
      LWR.setDuolingoImportStatus("There are no synced Duolingo words to delete.", "rgb(234, 43, 43)");
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
    LWR.setDuolingoImportStatus(
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
    if (!LWR.isDuolingoWordsPage()) {
      return;
    }

    const collection = LWR.getDuolingoWordCollection();
    if (!collection.list) {
      return;
    }

    const entriesByWord = buildDuolingoEntriesByWord();
    for (const item of collection.list.children) {
      const record = LWR.readDuolingoWordRow(item);
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

  // Reached for by other modules.
  Object.assign(LWR, {
    normalizeDuolingoWordKey,
    updateDuolingoProfileEntries,
    toggleDuolingoEntryEnabled,
    runDuolingoWordsDeleteAll,
    removeDuolingoEntry,
    ensureDuolingoWordsInfo
  });
})();
