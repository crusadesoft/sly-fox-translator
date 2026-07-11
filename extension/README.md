# Sly Fox Translator

A Chrome/Edge Manifest V3 extension for replacing only learned words and phrases on webpages.

## Install from a GitHub beta release

Download the latest `sly-fox-translator-...-unpacked.zip` from the [GitHub releases page](https://github.com/crusadesoft/sly-fox-translator/releases/latest), unzip it, then follow these steps:

1. Open `chrome://extensions` or `edge://extensions`.
2. Turn on developer mode.
3. Choose "Load unpacked".
4. Select the unzipped folder containing `manifest.json`.

## Install locally

For development, use the same steps above and select this `extension` folder.

The extension cannot run on browser-internal pages such as `chrome://settings`, but it will run on normal webpages.

## Usage

Open the extension popup, add an English note or meaning and the target-language word or phrase you have learned. Entries in the table are your learned vocabulary; use `Replace on pages` to temporarily pause a learned word without deleting it.

Use `Open in tab` from the popup when you want the vocabulary manager in a normal browser tab for automation or easier bulk editing.

Replacements are context-matched. The extension asks Chrome's built-in Translator to translate natural page chunks from English into the active profile language, then treats your learned target-language words as a whitelist. English notes and Duolingo meanings are metadata only; the inserted text comes from the translated sentence. Slash- or semicolon-separated learned words are treated as whitelist alternatives. If Chrome's Translator API or the profile language pack is unavailable or not ready, the page is left unchanged.

The popup shows the active tab's replacement status and has a Retry button. The extension icon badge shows `!` when Chrome Translator blocks replacement on the current tab and a count when replacements are made.

The content script only processes visible nearby page text on each pass so large dynamic pages do not lock up the browser. Natural page chunks are kept intact. If Chrome reports a finite Translator input quota, the extension uses it for batching; current Chrome reports no finite quota. Scrolling schedules another pass for newly visible text.

Use profiles for separate vocabulary sets such as Spanish, Greek, French, or Ukrainian. The selected profile is the only one used for replacements on webpages.

Built-in starter profiles are created for Spanish, Greek, French, German, Italian, Ukrainian, and Latin. Profile names also drive autocomplete suggestions: a custom profile named `Travel French` uses French suggestions, and `Greek` uses Greek suggestions. Type an English note or meaning and choose `Suggest`; suggestions appear one per line, and Wikidata-backed suggestions include a short definition to help distinguish meanings.

The bundled dictionary data is a small starter pack intended for autocomplete. Larger packs can be generated later from sources such as FreeDict, PanLex, or Wikidata. FreeDict dictionaries are generally free/open source and often GPL; PanLex and Wikidata are useful CC0 sources.

Examples:

```text
hello=hola
good morning=buenos dias
thank you=gracias
```

The manager supports file-based CSV import/export and a confirmed clear-all action. If you start an import from the small popup, it opens the full manager tab and opens the file picker there. Import files can contain comma-separated, tab-separated, or `note=learned word` lines. Existing rows with the same note text are updated during import. After import, the extension refreshes normal open tabs so pages opened before the import can start using the uploaded vocabulary.

Duolingo export lines are supported too:

```text
кафе - a cafe, a café, the cafe
фото - photo, photos
```

Upload that file while the target profile is selected. The importer stores English meanings as notes and stores the learned Duolingo word as the whitelist term, so `фото` can appear on pages only when Chrome's translated sentence uses `фото`.

## Behavior

- Learned phrases are matched before shorter learned words.
- Replacements update on dynamic pages.
- Context mode uses Chrome desktop's built-in Translator API when it is available for the active profile language.
- Profiles keep separate vocabulary lists and can be created, renamed, or deleted from the popup.
- Profile names drive replacement suggestions while adding words.
- Duolingo learned-word exports can be uploaded for the selected profile.
- Wikidata-backed suggestions show definitions, and saved definitions are included as an optional third CSV column.
- The vocabulary table has search, pagination, page-size controls, and a button to sort entries alphabetically.
- Text fields, editable areas, code blocks, scripts, and styles are skipped.
- Apostrophe-linked words such as `I'm`, `can't`, and `John's` are not split for replacement.
- Turning the extension off restores the original page text.
- The `Replace on pages` toggle controls whether an entry is currently used on webpages.

## Runtime tests

The translation runtime has a Playwright harness with a fake Translator API, so behavior can be tested without waiting for Chrome to download a real language pack:

```bash
NODE_PATH=/Users/gfelter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules /Users/gfelter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/test-extension-runtime.js
```
