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

## Word alignment

Replacements are placed in the English text in two stages. First, each vocabulary
entry's own English words (the note and the Duolingo meanings, plus simple
inflections such as plurals) are searched for directly in the sentence. Matches
that cannot be placed that way go to an on-device neural word aligner: a
multilingual BERT model (int8 ONNX, awesome-align style) that runs in an
offscreen extension document via the vendored `transformers.js`/onnxruntime
runtime in `vendor/transformers/`. This is what places pairs such as
`was -> було` or `physicist -> фізиком`, where the entry's English gloss never
appears verbatim in the sentence.

The model weights (`vendor/alignment-model/onnx/model_quantized.onnx`, ~150 MB)
exceed GitHub's file-size limit, so the repository stores them as chunks in
`build-assets/alignment-model/`. Run `scripts/assemble-alignment-model.sh` once
after cloning to reassemble the file; the release workflow does this
automatically, so release ZIPs are complete. Without the file the extension
still works and simply falls back to hint-based alignment only. Set
`localStorage.__lwrDebug = "1"` on a page to log per-sentence pipeline decisions
to the console and to a `data-lwr-debug` attribute on the document element.

## Target-language sentence structure

The `Target-language sentence structure` setting inverts the display: checked
sections are rebuilt in the target language's word order. Words you have
learned stay in the target language, and every other word is translated back
into English in its target-language position, so the sentence teaches the
language's structure and mindset rather than only vocabulary. Hovering a kept
target-language word shows its English original; hovering an English scaffold
word shows the target-language word it stands for. The mode depends on the
word aligner; sentences it cannot align are left in their original English,
and turning the setting off restores the original page markup.

## Translating the whole page

`Translate the whole page` is structure mode with the English scaffold switched
off: every sentence is painted in the target language, not just the words you
have learned. Nothing English is written back into the page — the aligner's
English only rides along inside the span, where `Show original English on
hover` can reach it — so a page reads the way it would to someone who already
knows the language, with the words you have studied carrying the hint underline
and everything else carrying the blue one.

It overrides the two settings that would put English back:
`Target-language sentence structure` (whose scaffold words are English) and
`Read target-language pages` (which swaps unlearned words into English on pages
that are already in the target language). Both are greyed out in the settings
panel while it is on, and a page that arrived in the target language is left
exactly as its author wrote it.

Most blocks worth translating keep all their words in a single text node — a
heading, a nav item, a video title, a channel name — and those are rewritten
where they stand. The node is already inside whatever wraps it, so the link, the
avatar, the framework's own elements and any state they hold are never touched.
Nothing is copied, so nothing can be lost by copying it.

Only a block whose words are spread across several text nodes has to be rebuilt,
because translation moves words: one that came from inside a link can land
elsewhere in the sentence, which no amount of editing text nodes in place can
express. There the aligner says which English each translated word came from, so
the chain of elements wrapping that English is rebuilt around the word that
replaced it, nesting and attributes intact — otherwise a nav item's `<a>` came
out as bare text, the link stopped working and the site's own `li a` styling
stopped applying. Each element is rebuilt once and held open from its first word
to its last, so the punctuation between them stays inside it; a block-level link
cut into pieces put every comma on a line of its own.

Rebuilding is limited to plain HTML text wrappers for a reason worth keeping in
mind: copying a framework's own element makes a second instance that re-renders
itself from properties the copy never had. Cloning YouTube's
`<yt-formatted-string>` emptied every sidebar entry of both its label and its
avatar. Blocks holding such an element are still translated — through the
single-node path above, which copies nothing — and are otherwise left to
per-word replacement. A block is refused outright only for content that cannot
survive being moved at all: controls, media, and nested blocks that are units in
their own right.

Unlike structure mode, it does not need the word aligner: a sentence the
aligner cannot resolve is still translated, it just has no English to show on
hover. The fidelity check is kept, with one difference — a name that is
legitimately transliterated ("Augustine" → "Августин") no longer counts as a
lost word, so only numbers must survive, while every Ukrainian word on screen
is vetted against the morphology dictionary rather than only the unlearned
ones. Blocks the check rejects fall back to plain per-word replacement, and
turning the setting off restores the original page markup.

## Target-language pages

The `Read target-language pages` setting handles the other direction. On a page
that is already written in the target language, nothing is translated into it:
the page's own sentence stays exactly as it was written, it is translated to
English once, and every word you have not learned is swapped in place for its
aligned English. Learned words stay in the target language, keep the hint
underline, and hovering them shows their English meanings; hovering an English
scaffold word shows the target-language word it stands for. The result is the
target language's own structure with broken English filling the gaps, which is
easier to read past than broken target language.

Because each word is replaced inside its own text node, page markup (links,
formatting) survives, and turning the setting off restores the page. Words the
aligner cannot resolve are left in the target language and still answer on
hover. Target-language text is detected by script, so this applies to profiles
whose language does not use the Latin alphabet (Ukrainian, Greek).

## Cloak before first paint

`page-cloak.js` runs at `document_start`, before the page paints a word, and
hides page *text* — only `color`, so images, backgrounds and layout render
normally and nothing moves when the text returns. content.js lifts it once every
block it collected is carrying its own `data-lwr-pending` hide, so the
untranslated wording is never on screen at any instant; the reader's first
sight of a block is its finished translation.

The cloak *is* the presence of its stylesheet, deliberately not a marker class
on `<html>`: page frameworks assign `documentElement.className` wholesale during
startup (MediaWiki does, on every Wikipedia load), which silently wiped an
earlier class-gated rule and let the original text paint anyway.

It can never leave a page unreadable. content.js checks in as soon as it loads
(it runs at `document_idle`, seconds later on a heavy page) and the cloak then
allows 2.5 s for work to start; without that check-in it lifts after 4 s
regardless. It also reads the stored state itself and lifts within a few
milliseconds when the extension is switched off or the site or page is
excluded, so pages the extension will not touch are not held back. If the
global lift function is somehow missing, content.js removes the stylesheet
directly. `data-lwr-cloak` is left on `<html>` (`hiding` / `lifted`) so it is
possible to tell "the cloak ran and let go" from "the cloak never ran".

## Hide text until it is translated

`Hide text until translated` keeps a pending block blank — the extension sets
`data-lwr-pending` on it and a stylesheet rule paints its text transparent —
until that block's translation is painted in, so each block simply appears once
it is done and the original wording is never readable.

This is strictly a first-paint concern: only the pass that runs while the page
is still cloaked hides anything. Later passes — new text scrolled into view,
blocks a page adds later — translate in place with the text visible the whole
time. Text vanishing from under someone who is already reading it is worse than
watching it swap.

Nothing is animated and no text is rewritten: only colour changes, so the
block's words cannot be corrupted by a failure and nothing reflows when it
appears. A block can never stay invisible: the pass reveals each block as it
finishes, `applyToPage` reveals everything on entry and in a `finally`, and a
sweep clears any block still pending after 8 seconds. Hiding is skipped when
the translator could not be created at all.

## Not doing the same work twice

A block is recorded in `processedBlockSourceTexts` once a pass has dealt with
it, and later passes skip it. Two things used to defeat that, so on a long page
every scroll re-collected finished blocks and blanked out text the reader had
already read (measured on one live page: 210 repeat events across four scrolls,
now zero):

- A block whose translation came back empty — short labels, times, anything the
  translator returns nothing usable for — was never recorded, so every later
  pass picked it up again. It is now recorded as looked-at.
- The recorded value was the unit's own text, but the next pass compares
  `getBlockSourceText`, which walks the whole subtree. A block wrapping nested
  blocks therefore never matched itself. Both sides now use
  `getBlockSourceText`, which also means the record has to be written after the
  block's replacements are painted.

On top of that, `hiddenOnceBlocks` lets a block be hidden at most once per page
session. Re-collection is sometimes legitimate — a pass can run out of budget,
a page can rewrite a block — but text the reader has already watched appear
must never blink out again.

## Checked-section mark

`Mark checked sections` hangs a small dot in the left margin of a block the
extension read and left unchanged. It takes its colour from the block's own
text, so it sits quietly on any page, light or dark. Blocks that did get replacements are not
marked — the underline under each replaced word already shows the extension was
there. The mark is a floated `::before`, so it takes no space in the text flow; it is
only applied to block-level boxes, since an inline element has no margin to
hang it in and a flex or grid container would turn it into a layout item.

## Typing Duolingo answers

`Type answers` (under **Duolingo lessons** in the settings panel) puts a text field above the answer area of a lesson and
hides the words the exercise would otherwise let you pick from, so the answer is
recalled rather than recognised. Space places a typed word, Enter checks, Tab
walks a hint ladder (the word's shape behind a sharpening blur first, then
letters), and the eye button reveals the hidden words again.

It covers four challenge shapes, and what gets hidden differs by shape:

- **Word bank** — the bank is hidden; typed words are placed in order.
- **Listen and match** — every word card's text is hidden; a number key plays
  a card's audio, then the word is typed.
- **Select the meaning** — the choices are hidden; typing one selects it.
- **Matching pairs** — both columns hold readable words, so hiding all of them
  would leave nothing to work from. Only the column in the language being
  learned is hidden: a number key picks a card from the visible side, and the
  word it pairs with is typed. Unlike listen-match, nothing in the DOM says
  which cards pair up (each card's `data-test` is its own word), so Duolingo
  still judges the pair. The tenth card is numbered `0`.

The learned-language column is found by script where the target language has
one of its own (Ukrainian, Greek); for a Latin-script language the columns are
told apart by geometry, taking the right-hand one.

There is no keyboard-layout indicator, and on macOS there cannot usefully be
one: `navigator.keyboard.getLayoutMap()` resolves against the current
*ASCII-capable* layout, which stays US while a Cyrillic input source is active.
Measured on a Ukrainian layout in Chrome 2026-08-08, physical `KeyA` produced
`а` while the same call still reported `q w a s z`, and the mapping never
changed. Only a real keystroke reveals the layout there — `event.code` with
`event.key` — which is too late to warn before typing starts.

## Levelling the word bank

A word bank answers two questions it was never asked. One word in it is
capitalised, which is the sentence's first word given away for free, and every
option is spelled correctly, so the right word can be picked without knowing how
it is spelled. Two settings take those back.

`Lowercase word-bank words` lowercases the words in the bank only. A word that
has been placed shows its real capitalisation again, since by then it has been
chosen. The original text is kept on the element, so turning the setting off
hands the page back as Duolingo wrote it.

`Add misspelled decoys` slips near-miss spellings of the bank's own words in
among them — `роблю` gains a `раблю` and an `орблю`, `шапка` a `щапка` and an
`ашпка`. Every word of four letters or more draws two, up to twelve in a bank,
scattered through it rather than tacked on the end. Breadth comes before depth:
each word earns its first decoy before any word earns a second, so the word
worth being unsure about is never the one left standing alone.

A decoy is built one of two ways — swapping a look-alike letter (`и`/`і`,
`е`/`є`, `о`/`а`, `ш`/`щ` for Ukrainian; per-language tables, with a Latin
fallback) or transposing a neighbouring pair. Both keep the word's length, which
is the point: a doubled or dropped letter changes the word's shape, and a wrong
shape is spotted without the word being read at all. A decoy is never a word
already in the bank, never a word in your vocabulary, and never a bank word with
its tail cut off — that last one would be completed by the typing input's
unique-prefix rule and place the real word instead of failing.

The decoys cost the challenge no room. A bank that grows from two rows to four
pushes the sentence and the character off the top of the screen — measured on a
1512x861 window, the exercise heading went to `y = -10`. So the bank keeps the
height it had with Duolingo's own words in it, measured just before the decoys
go in and re-measured on resize, and the rest is reached by scrolling. The
scrollbar is styled rather than left to the platform, because macOS hides
overlay scrollbars until something is already scrolling and the extra rows would
look like they were not there.

Decoys are clones of Duolingo's own token markup, with its `data-test` hooks
stripped, so nothing that selects on those hooks — the typing input, the hint
ladder, the answer itself — sees them as words. Clicking one refuses and flashes
red; typing one dead-ends. They are planned once per challenge and re-inserted
at the same place when Duolingo re-renders, so they never reshuffle under the
pointer.

## Copying a lesson phrase

`Copy phrases` (under **Duolingo lessons** in the settings panel) puts a small copy button at the end of the phrase an
exercise is asking about, so a sentence worth digging into later can be lifted
out of the lesson without retyping it. Pressing ⌘C (Ctrl+C) while the typing
input has focus copies the same phrase: that input holds focus for the whole
challenge, so a plain copy would otherwise come back empty. A real selection in
the input still copies itself.

The phrase is found by shape, not by class name — Duolingo hashes those per
build. The candidates are the visible elements inside the challenge that
declare a language (or carry Duolingo's `hint-sentence` hook) and contain none
of the answer side: no word bank, tap tokens, choices, footer or answer field.
Gap-fill challenges tag one span per word rather than the sentence, so the
button goes on the smallest element holding every candidate that still keeps
clear of the answer side — otherwise it lands mid-sentence and copies one word.

The text is read from the text nodes rather than `innerText`, because Duolingo
splits each hinted word into per-letter spans with positioned overlays between
them and `innerText` reads spaces into those gaps (`старі , але`). An empty box
that still takes up space is the blank of a gap-fill sentence and is copied as
`___`; empty boxes that are decoration — the hint underline, the audio button —
are skipped.

The click is stopped at document capture, otherwise the same click lands on the
prompt's hint tokens and opens Duolingo's hint popover. Copying goes through
`navigator.clipboard` and falls back to a scratch textarea when Chrome refuses
it (it wants a focused document, which a challenge transition can take away);
either way focus is handed back to the typing input, and the button flashes a
check.

## Following Duolingo's theme

Duolingo has a dark theme, and the text fields the extension adds sit straight
on the page's own background, so a hard-coded white box glares out of a dark
lesson. Every text field the extension adds — the lesson typing input, the
manual-word and search fields on the Words page, and the flashcard answer box —
picks its colours from a light or dark palette instead. The dark values are
Duolingo's own tokens: `#131f24` page, `#202f36` raised card, `#37464f`
hairline, `#f1f7fb` text, `#8b9fa8` muted. The blue focus ring and the flashcard
timer colours already read on both, so they carry over unchanged.

Which palette applies is read off the page rather than off a flag, because
Duolingo repaints through CSS custom properties and there is no attribute worth
trusting: the extension walks out from `<body>` to the first ancestor whose
background is not see-through and takes its luma. A page that paints nothing
falls back to `prefers-color-scheme`. The reading is refreshed when `<html>` or
`<body>` changes class or style, when the system theme changes, and whenever a
new challenge builds a fresh input row — so a theme flip lands at worst one
challenge later, never at the cost of a `getComputedStyle` per mutation.

`::placeholder` is the one rule with no inline-style equivalent, so it is the
only reason there is a stylesheet at all: a single `[data-lwr-input]` rule,
rewritten when the palette changes.

The flashcard session covers the whole page, so it carries its own copy of the
theme — otherwise a dark-mode session would open as a white flash and the answer
box would have nothing dark to sit on. Buttons, tabs and list rows still use
their light-theme colours.

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
- Sidebars, navigation and footers are read like body text (a table of contents is reading material too); page-chrome wording is simply given a lower priority inside a pass.
- Apostrophe-linked words such as `I'm`, `can't`, and `John's` are not split for replacement.
- Turning the extension off restores the original page text.
- The `Replace on pages` toggle controls whether an entry is currently used on webpages.

## Runtime tests

The translation runtime has a Playwright harness with a fake Translator API, so behavior can be tested without waiting for Chrome to download a real language pack:

```bash
NODE_PATH=/Users/gfelter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules /Users/gfelter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/test-extension-runtime.js
```
