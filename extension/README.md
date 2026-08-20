# Sly Fox Translator

A Chrome/Edge Manifest V3 extension that replaces the words you have learned with
their target-language forms as you browse, so vocabulary is practiced in the wild
rather than in a list.

## Install

From a release: download the latest `sly-fox-translator-...-unpacked.zip` from the
[releases page](https://github.com/crusadesoft/sly-fox-translator/releases/latest)
and unzip it. For development, skip the download and use this `extension` folder.

Then open `chrome://extensions` (or `edge://extensions`), turn on developer mode,
choose **Load unpacked**, and select the folder containing `manifest.json`.

The extension runs on normal webpages, not on browser-internal pages such as
`chrome://settings`.

## Using it

**The toolbar popup** picks the language profile, shows the current tab's
replacement status with a retry, turns replacements off, and excludes the current
page or site. The icon badge shows a count of replacements, `...` while a pass is
running, or `!` when Chrome's Translator blocks the tab.

**Vocabulary lives on Duolingo's Words page**, where the extension adds its own UI:
tabs for Duolingo words, manual Sly Fox words, and flashcards; buttons to import
your Duolingo words, import/export CSV, and delete everything; and a typed
flashcard session over the whole vocabulary.

**Settings live on Duolingo's settings page**, in a Sly Fox section added to the
settings nav.

Import files accept comma-separated, tab-separated, `note=word` lines, or Duolingo
export lines (`кафе - a cafe, a café, the cafe`). English meanings are stored as
notes; the Duolingo word is stored as the term that may appear on pages.

## How replacement works

The extension asks Chrome's built-in Translator to translate natural page chunks
into the profile language, then treats your learned words as a whitelist: a word
appears only when the translated sentence actually uses it. English notes and
Duolingo meanings are metadata, not the inserted text. If the Translator API or the
language pack is unavailable, the page is left unchanged.

Each pass handles only visible nearby text, so long dynamic pages do not lock up;
scrolling schedules another pass. Blocks already handled are recorded and skipped.

Placement happens in two stages: an entry's own English words (and simple
inflections) are searched for directly in the sentence, and anything left over goes
to an on-device neural word aligner — a multilingual BERT model (int8 ONNX,
awesome-align style) running in an offscreen document via the vendored
`transformers.js`/onnxruntime in `vendor/transformers/`. The aligner is what places
pairs like `was -> було`, where the gloss never appears verbatim.

## Modes

- **Translate the whole page** — every sentence is painted in the target language,
  not just learned words, with no English written back into the page (hover for it).
  Overrides the two settings below.
- **Target-language sentence structure** — sections are rebuilt in the target
  language's word order; learned words stay in the target language and the rest is
  translated back to English in place, teaching structure as well as vocabulary.
  Requires the aligner.
- **Read target-language pages** — the reverse: on a page already in the target
  language, unlearned words are swapped for English in place, leaving the original
  structure intact. Detected by script, so it applies to non-Latin profiles.

Turning any of these off restores the original page markup. Hovering shows the
counterpart word in either direction.

## First paint

`translate/page-cloak.js` runs at `document_start` and hides page *text* (colour
only, so layout and images render normally). The pass lifts it once every collected block
carries its own pending hide, so untranslated wording is never on screen. The cloak
can never strand a page: it lifts after 4 s without a check-in, lifts immediately
when the extension is off or the page is excluded, and leaves `data-lwr-cloak` on
`<html>` to show what happened.

`Hide text until translated` extends this per block during that first pass only.
Later passes translate in place with the text visible — text vanishing from under
someone already reading is worse than watching it swap.

## Duolingo lessons

- **Type answers** — a text field replaces picking from the given words on word-bank,
  listen-and-match, select-the-meaning, and matching-pair exercises. Space places a
  word, Enter checks, Tab walks a hint ladder (blurred word shape, then letters), the
  eye button reveals what was hidden. Number keys pick cards in the match exercises.
- **Lowercase word-bank words** — takes back the free hint of the sentence's
  capitalised first word.
- **Add misspelled decoys** — slips length-preserving near-misses (look-alike letter
  swaps, transpositions) into the bank so spelling has to be known, not spotted. The
  bank keeps its original height and scrolls.
- **Copy phrases** — a copy button on the exercise phrase; ⌘C/Ctrl+C works while the
  typing input has focus.

Added UI follows Duolingo's light and dark themes, read from the page's own
background rather than a flag.

## Development

The ~150 MB aligner model exceeds GitHub's file-size limit, so it is stored as chunks
in `build-assets/alignment-model/`. Run it once after cloning:

```bash
scripts/assemble-alignment-model.sh
```

Release ZIPs are assembled automatically. Without the model the extension still runs,
falling back to hint-based alignment only.

Set `localStorage.__lwrDebug = "1"` on a page to log per-sentence pipeline decisions.

The translation runtime has a Playwright harness with a fake Translator API, so
behavior can be tested without a real language pack:

```bash
node scripts/test-extension-runtime.js
```
