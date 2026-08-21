# Lesson files

A lesson is a JSON file in this folder. Drop `greetings.json` here and it is
playable at `lesson.html?lesson=greetings`; point a puck at it by giving that
puck a `lesson` in `section.js` and it becomes part of the path.

Nothing else is needed. The player has one internal challenge shape, and these
files *are* that shape — the deck-dealt lessons the extension generates from the
user's own vocabulary are built by emitting the very same objects. A hand-written
or machine-written lesson is not a second path through the code.

## The file

```json
{
  "title": "Around the house",
  "xp": 10,
  "challenges": [ ... ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `title` | no | Shown on the section path, not in the lesson itself. |
| `xp` | no | Awarded on the summary screen. Defaults to 10. |
| `challenges` | yes | Played in order. Anything with an unknown `type` is dropped. |

## Challenges

Five types. Every one of them takes an optional `record` (see below) and an
optional `badge`.

### `assist` — "Select the correct meaning"

```json
{
  "type": "assist",
  "prompt": "вікно",
  "promptLang": "uk",
  "choices": ["window", "door", "floor"],
  "answer": "window",
  "choiceLang": "en",
  "hints": { "вікно": ["window", "a window"] },
  "badge": "new"
}
```

`choices` are shuffled unless you set `"shuffle": false`. `answer` must appear in
`choices` exactly.

### `translate` — "Write this in …"

```json
{
  "type": "translate",
  "header": "Write this in English",
  "prompt": "Це моє вікно.",
  "promptLang": "uk",
  "bank": ["This", "is", "my", "window", "door", "large"],
  "answer": "This is my window",
  "answers": ["This is my window", "That is my window"],
  "answerLang": "en",
  "hints": { "вікно": ["window"] }
}
```

The learner taps words out of `bank` onto the line. `answers` is every accepted
wording; `answer` alone is fine if there is only one. Marking ignores case,
surrounding punctuation and a leading article, and forgives a single-character
typo on answers of four characters or more — the same rules the flashcard
trainer uses, because it is the same code.

Put every word of the answer in `bank`, plus a few wrong ones. `bank` is
shuffled unless you set `"shuffle": false`.

### `match` — "Select the matching pairs"

```json
{
  "type": "match",
  "pairs": [
    { "target": "вікно", "source": "window" },
    { "target": "двері", "source": "door" }
  ]
}
```

**Always five pairs.** That is what Duolingo shows, every time, and
`check-lessons.js` fails on any other count. A short match is not a gentler
match — it is a different, easier exercise wearing the same clothes.

Both columns are shuffled. There is no wrong answer to record — a mismatch just
flashes and lets the learner try again.

**A match may only use words something earlier has already taught.** Matching
recognises; it does not teach. Five pairs put five words in front of someone at
once with no gloss, no sentence and no context, so a match in the first lesson
of a unit is five strangers dressed up as practice. `check-lessons.js` fails on
this, counting a word as taught once it has been the subject of an earlier
`assist` (either direction), the answer of an earlier sentence, or spoken by an
earlier listening challenge. Word-bank distractors and an assist's wrong choices
do *not* count — they put a word on screen without ever saying what it means.

The two rules together decide where a match can go: it needs five taught words
behind it, so it cannot sit in the first lesson of a puck, which has only taught
two. Put a listening drill or another sentence there and let the match come once
the puck has five words to draw on. The generated lessons follow the same rule —
their match is dealt only from cards already played, which is why it sits five
cards in, and why a session shorter than five cards gets no match at all.

### `listenTap` — "Tap what you hear"

```json
{
  "type": "listenTap",
  "audio": "Це моя кімната",
  "audioLang": "uk",
  "answer": "Це моя кімната",
  "answerLang": "uk",
  "meaning": "This is my room.",
  "bank": ["Це", "моя", "кімната", "вікно", "твоя", "велика"]
}
```

`audio` is spoken aloud and nothing is printed — working out what was said *is*
the exercise, so there is no `prompt` and no `hints`. Answering works exactly as
`translate` does, out of `bank`.

`meaning` is the English of it, held back until the answer is in and then shown
on the banner as "Meaning: …". It is required: a listening challenge that never
tells you what you just heard teaches nothing.

`bank` works exactly as `translate`'s does, and the keyboard toggle applies here
too.

### Typing is not a type

There is no "type what you hear" challenge to author. Typing is the *other way*
to answer a sentence-construction question: both `translate` and `listenTap`
carry their **USE KEYBOARD** / **USE WORD BANK** toggle in the footer, which
swaps the word bank for a text box and sticks for the rest of the session. The
question, its answers and its grading are identical either way — only the input
changes, and the heading with it.

### `listenMatch` — "Select the matching pairs", spoken

```json
{
  "type": "listenMatch",
  "targetLang": "uk",
  "pairs": [
    { "target": "вікно", "source": "window" },
    { "target": "двері", "source": "door" }
  ]
}
```

`match` with the target column played rather than printed: each left-hand tile
is a speaker, and the word is never written down.

### Audio, honestly

Duolingo ships a recorded mp3 for every listening prompt. We have none and will
not hotlink theirs, so these are spoken by **`chrome.tts`**; the turtle button is
the same utterance at a lower rate.

Not `speechSynthesis`. The web API does not work on a `chrome-extension://`
page: it accepts the utterance, reports `speaking` and `pending`, and then never
starts it — no `start`, no `end`, not even an `error`. The identical call on an
ordinary page speaks normally, so it is the page's origin, not the engine, and
nothing about it looks like a failure from the calling side. `chrome.tts` is the
API extensions are meant to use and it needs `"tts"` in the manifest
permissions; adding a permission means reloading the extension, not just the
page.

That has one consequence worth knowing: **a listening challenge is dropped from
the lesson if the browser has no voice for its language.** Better to lose the
challenge than to show a button that does nothing. If listening challenges are
vanishing, that is why.

## `hints`

```json
"hints": { "вікно": ["window", "a window"] }
```

Keyed by a word **as it appears in the prompt**, lowercased. That word gets the
dotted underline, and hovering it shows the list. This is the part learners
actually use, so it is worth filling in for any word that is new.

Words in the prompt with no entry here get no underline and no hint.

The listening types take no `hints`: nothing is on screen to underline.

Hovering a hinted word also **says** it, as long as the prompt is in the language
being learned. That is half of why the underline is worth having, so fill hints
in for target-language prompts.

## `record`

```json
"record": { "direction": "tg2en", "wordKey": "вікно" }
```

Optional. When present, the answer is written into the same practice records the
flashcard trainer keeps, so a word met here counts towards its strength and
comes up again when it is due. `direction` is `tg2en` (shown the target
language, answering in English) or `en2tg`. `wordKey` is the word text,
lowercased and trimmed.

Leave it out for anything that is not a single vocabulary word — a sentence
drill, say — and the challenge is played but not scored against any word.

On `match` and `listenMatch`, `record` goes on the individual pair rather than
the challenge.

## `badge` and `newWords`

`"new"` puts the purple **NEW WORD** flag above the header, and renders the
prompt word itself in Duolingo's beetle purple, bold, over a purple dotted
underline, with their sparkle burst. Omit it otherwise.

`"hard"` is the red **HARD EXERCISE** flag. `"mistake"` is the orange
**PREVIOUS MISTAKE** flag — you will not normally author that one, because the
player sets it itself on a re-queued challenge (see below).

To colour some words but not the whole prompt, name them:

```json
"newWords": ["вікно"]
```

Without `newWords`, `"badge": "new"` treats the whole `prompt` as the new word.

## Mistakes come back

Nothing to author, but worth knowing when you write a lesson: a challenge
answered wrong is re-queued. After the last new challenge the learner is shown
Duo saying *"Let's review the exercises you missed!"*, and every missed
challenge is played again — re-shuffled, and wearing the orange **PREVIOUS
MISTAKE** badge. Missing it again queues it again. A lesson cannot be finished
until every challenge in it has been answered correctly, so the summary counts
corrections rather than pretending they did not happen.

## Legendary

Also nothing to author. Any finished puck grows a gold **LEGENDARY +40 XP**
button on the path, which shuffles every lesson in that puck into one run with
the hints stripped out — no dotted underlines, nothing to hover, and no Skip.
It is reached at `lesson.html?unit=<slug>&puck=<n>&legendary=1`.

## Checking a file

```bash
node scripts/check-lessons.js
```

Reads every file in this folder and reports anything the player would silently
drop or choke on — an `answer` missing from its `choices`, an answer word that
is not in the `bank`, a hint keyed to a word the prompt does not contain.
