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
your Duolingo words, export them as a readable word list, import/export CSV, and
delete everything; and a typed flashcard session over the whole vocabulary.

**Settings live on Duolingo's settings page**, in a Sly Fox section added to the
settings nav.

Import files accept comma-separated, tab-separated, `note=word` lines, or Duolingo
export lines (`кафе - a cafe, a café, the cafe`); `#` opens a comment line. English
meanings are stored as notes; the Duolingo word is stored as the term that may
appear on pages.

**Export word list** writes the other direction of that same format —
`sly-fox-<language>-words.txt`, a commented header plus one `word — meanings` line
per learned word. It reads the Words page itself rather than the stored
vocabulary, so it is the whole list whether or not it has ever been imported. The
file is meant to be read: it is what tells a person, or an AI writing lessons,
which words are already known. It imports straight back too.

**Export for LingQ** sits beside it and writes `<profile>-lingq.csv` in the format
LingQ's vocabulary importer asks for: a header row of
`term, phrase, tag1, tag2, meaninglanguage1, meaning1`, tagged `sly-fox` and by
origin. Three things about that format are not guessable from the column names —
the header row is what LingQ matches columns by, `meaninglanguage` is a two-letter
code, and `phrase` is required, so the term stands in as its own phrase.

Unlike the word list, it does NOT re-scrape Duolingo's page: it reads the stored
Sly Fox vocabulary, so manual words come too, and it cannot collide with an import
already walking Duolingo's "Load more". One row per word rather than per entry —
the vocabulary keeps one entry per English meaning, so `диван` is two entries and
one LingQ carrying "sofa, couch".

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

## A lesson from a subtitle line

On YouTube, every line in [Language Reactor](https://www.languagereactor.com/)'s
subtitle panel grows a small dumbbell button. Clicking it builds a lesson out of
that one line and opens it in the section player.

The line is the whole brief. Language Reactor labels each word it renders with a
lemma, so `почала` arrives carrying `почати`, and that is what looks a word up in
a vocabulary that only ever stored dictionary forms. The English comes from
Chrome's on-device target→English translator — the same one behind the hover
tooltip, so a word cannot mean one thing hovered and another in a lesson.

Out of that come up to eight challenges: a *select the meaning* card for each of
the line's content words, a *fill in the blank* with one of them lifted out, then
the sentence itself read, heard, produced and spoken. There is no matching drill —
a match must be five pairs of already-taught words, and one line cannot teach five.

Two things it will not do. It writes **no practice records**: a cartoon's
vocabulary would flood the flashcard strengths with words you never chose to
study. And it refuses lines that are not speech — a caption annotation like
`♪♪ [НАПИС: "Офіс Кейна"]` is tokenised exactly like dialogue and has to be
turned away by hand.

It needs Language Reactor for the subtitles and its own panel; without it, no
buttons appear.

## Development

The ~150 MB aligner model exceeds GitHub's file-size limit, so it is stored as chunks
in `build-assets/alignment-model/`. Run it once after cloning:

```bash
scripts/assemble-alignment-model.sh
```

Release ZIPs are assembled automatically. Without the model the extension still runs,
falling back to hint-based alignment only.

Set `localStorage.__lwrDebug = "1"` on a page to log per-sentence pipeline decisions.

