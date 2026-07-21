// Shared vocabulary-import logic: parsing export/CSV text and merging the
// parsed entries into stored state. Loaded as a classic script by popup.html
// and as a side-effect import by the background service worker, so the same
// code handles imports whether they start from the popup or from the button
// injected on Duolingo's Words page.
(() => {
  "use strict";

  function createId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
      return globalThis.crypto.randomUUID();
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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

  function getEntryOrigin(entry) {
    return entry?.origin === "duolingo" || String(entry?.definition || "").startsWith("Duolingo meanings:")
      ? "duolingo"
      : "manual";
  }

  function mergeUniqueText(existingText, incomingText, separator) {
    // dedupeJoinedText also repairs an existing value that already carries
    // duplicate parts, so merges never preserve corrupted text.
    return dedupeJoinedText(
      [String(existingText || "").trim(), String(incomingText || "").trim()]
        .filter(Boolean)
        .join(separator),
      separator
    );
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
      "‘": "’",
      "“": "”"
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
      normalizedSource === "’s" ||
      (normalizedSource === "s" && /(^|[,\s])['’]s($|[,\s])/.test(normalizedMeaning))
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

  function mergeImportedEntries(existingEntries, imported, languageCode) {
    const initialCount = existingEntries.length;
    const entriesBySource = new Map(
      existingEntries.map((entry) => [
        `${getEntryOrigin(entry)}\u0000${entry.source.toLocaleLowerCase()}`,
        entry
      ])
    );

    for (const importedEntry of imported) {
      const origin = importedEntry.origin === "duolingo" ? "duolingo" : "manual";
      const key = `${origin}\u0000${importedEntry.source.toLocaleLowerCase()}`;
      const existing = entriesBySource.get(key);
      // Import files can carry already-duplicated cells ("A / B / A / B");
      // never store those verbatim.
      const importedTarget = dedupeJoinedText(importedEntry.target, " / ");
      const importedDefinition = dedupeJoinedText(importedEntry.definition, "; ");

      if (existing) {
        const target = importedEntry.mergeTarget
          ? mergeUniqueText(existing.target, importedTarget, " / ")
          : importedTarget;
        const definition = importedEntry.mergeTarget
          ? mergeUniqueText(existing.definition, importedDefinition, "; ")
          : importedDefinition ||
            (existing.target === importedTarget ? existing.definition : "");

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
          target: importedTarget,
          languageCode,
          definition: importedDefinition,
          origin,
          learned: true,
          enabled: true,
          createdAt: Date.now()
        });
      }
    }

    const entries = Array.from(entriesBySource.values());
    return {
      entries,
      addedCount: Math.max(0, entries.length - initialCount),
      totalCount: entries.length
    };
  }

  function findProfileForLanguage(profiles, languageName) {
    const normalizedName = String(languageName || "").trim().toLocaleLowerCase();
    return (Array.isArray(profiles) ? profiles : []).find(
      (profile) => String(profile?.name || "").trim().toLocaleLowerCase() === normalizedName
    );
  }

  function getCurrentProfileFromState(state) {
    const profiles = Array.isArray(state?.profiles) ? state.profiles : [];
    return profiles.find((profile) => profile.id === state.currentProfileId) || profiles[0] || null;
  }

  // General file import (CSV / TXT / Duolingo export) into the current
  // profile. Mutates nothing: returns { ok, state, ... } with a new state.
  function applyTextImport(state, { text, originOverride }) {
    const override = originOverride === "manual" ? "manual" : "";
    const imported = parseBulkText(String(text || "")).map((entry) =>
      override ? { ...entry, origin: override, mergeTarget: false } : entry
    );
    if (!imported.length) {
      return { ok: false, reason: "No importable entries were found in the file." };
    }

    const profile = getCurrentProfileFromState(state);
    if (!profile) {
      return { ok: false, reason: "No language profile is configured yet." };
    }

    const existingEntries = Array.isArray(profile.entries) ? profile.entries : [];
    const result = mergeImportedEntries(existingEntries, imported, profile.languageCode);
    const profiles = state.profiles.map((candidate) =>
      candidate === profile ? { ...candidate, entries: result.entries } : candidate
    );

    return {
      ok: true,
      state: { ...state, profiles },
      profileName: profile.name,
      parsedCount: imported.length,
      addedCount: result.addedCount,
      totalCount: result.totalCount
    };
  }

  function sortEntriesForExport(entries) {
    return [...entries].sort((a, b) => {
      const sourceCompare = a.source.localeCompare(b.source, undefined, { sensitivity: "base" });
      return sourceCompare || a.target.localeCompare(b.target, undefined, { sensitivity: "base" });
    });
  }

  function toCsvLine(values) {
    return values
      .map((value) => {
        const text = String(value);
        return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
      })
      .join(",");
  }

  function slugifyFilename(text) {
    return String(text || "profile")
      .trim()
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "profile";
  }

  // Current-profile CSV export in the popup's format: [source, target] rows,
  // plus a definition column when any entry has one.
  function buildVocabularyCsv(state, { origin } = {}) {
    const exportOrigin = origin === "manual" ? "manual" : "";
    const profile = getCurrentProfileFromState(state);
    if (!profile) {
      return { ok: false, reason: "No language profile is configured yet." };
    }

    const allEntries = Array.isArray(profile.entries) ? profile.entries : [];
    const entries = sortEntriesForExport(
      exportOrigin
        ? allEntries.filter((entry) => getEntryOrigin(entry) === exportOrigin)
        : allEntries
    );
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

    return {
      ok: true,
      csv: `${csv}\n`,
      count: entries.length,
      filename: `${slugifyFilename(profile.name)}-${exportOrigin || "vocabulary"}.csv`
    };
  }

  // Full Duolingo import against a stored state object. Mutates nothing:
  // returns { ok, state, ... } with a new state on success, or
  // { ok: false, reason } when the text or language cannot be applied.
  function applyDuolingoImport(state, { text, languageName }) {
    const imported = parseBulkText(String(text || ""));
    if (!imported.length) {
      return { ok: false, reason: "Duolingo returned no importable words." };
    }

    const profile = findProfileForLanguage(state?.profiles, languageName);
    if (!profile) {
      return {
        ok: false,
        reason: `${languageName || "This Duolingo language"} is not supported yet.`
      };
    }

    const existingEntries = Array.isArray(profile.entries) ? profile.entries : [];
    const result = mergeImportedEntries(existingEntries, imported, profile.languageCode);
    const profiles = state.profiles.map((candidate) =>
      candidate === profile ? { ...candidate, entries: result.entries } : candidate
    );

    return {
      ok: true,
      // Match the popup flow: a successful sync also makes the imported
      // language the active profile.
      state: { ...state, profiles, currentProfileId: profile.id },
      profileName: profile.name,
      addedCount: result.addedCount,
      totalCount: result.totalCount
    };
  }

  globalThis.LWRImportCore = {
    createId,
    dedupeJoinedText,
    getEntryOrigin,
    mergeUniqueText,
    parseBulkText,
    isInvalidDuolingoSource,
    splitDelimitedLine,
    mergeImportedEntries,
    findProfileForLanguage,
    applyDuolingoImport,
    applyTextImport,
    buildVocabularyCsv
  };
})();
