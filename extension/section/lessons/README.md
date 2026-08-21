# Lesson files

A lesson is a YAML file in this folder. Drop `greetings.yaml` here and it is
playable at `lesson.html?lesson=greetings`; point a puck at it by giving that
puck a `lesson` in `section.js` and it becomes part of the path.

Nothing else is needed. The player has one internal challenge shape, and these
files *are* that shape — the deck-dealt lessons the extension generates from the
user's own vocabulary are built by emitting the very same objects. A hand-written
or machine-written lesson is not a second path through the code.

These were JSON until the files got long enough to hurt: a unit is a couple of
thousand lines of it, every Ukrainian word doubly quoted, and nowhere to leave a
note saying why a challenge sits where it does. YAML is the same data — the
player reads it with [js-yaml](https://github.com/nodeca/js-yaml), vendored at
`../vendor/js-yaml.min.js` and loaded by `lesson.html` and `section.html` — with
a third of the lines, no quotes around ordinary words, and `#` comments.

## The file

```yaml
title: Around the house
xp: 10
challenges:
  - ...
```

| Field | Required | Meaning |
| --- | --- | --- |
| `title` | no | Shown on the section path, not in the lesson itself. |
| `xp` | no | Awarded on the summary screen. Defaults to 10. |
| `challenges` | yes | Played in order. Anything with an unknown `type` is dropped. |

`answer` (singular) still works and still wins where a file sets it, but there is
no reason to write it: it said the same thing as the head of `answers`.

Quoting is optional but not free: `xp: 10` is a number, not the string `"10"`,
so an answer or word that reads as a number, as `true`/`false`, or as
`null`/`~` has to be quoted — `answer: "10"`. (`yes` and `no` are plain strings
here: js-yaml 4 follows YAML 1.2, where they are not booleans.) Everything else
can be written bare, Cyrillic included. Text holding a colon-space, or starting
with an indicator character (`- ? : , [ ] { } # & * ! | > % @ \``), needs
quoting too.

## Challenges

Five types. Every one of them takes a `direction`, an optional `word` (see
below) and an optional `badge`.

### `direction`

```yaml
direction: [uk, en]
```

The language the challenge **shows** you, then the language you **answer** in.
Everything else about which way a challenge runs follows from those two, so this
is the only place it is written down:

| Derived | From |
| --- | --- |
| `promptLang`, `audioLang` | the first entry |
| `choiceLang`, `answerLang` | the second |
| the header — "Write this in English" / "…in Ukrainian" | the second |
| a `word`'s record direction — `tg2en` answering in English, `en2tg` otherwise | the second |

`[uk, en]` is recognising a word; `[en, uk]` is producing one; `[uk, uk]` is a
listening challenge, where you hear the target language and write it back.

The old spelling — `promptLang`, `choiceLang`, `answerLang`, `audioLang`,
`targetLang`, `sourceLang`, an explicit `header`, a full `record` — still works
and still wins where a file sets it. It was four fields that could disagree with
each other, and one of them (the record's direction) that no one could check by
eye, which is why it is one field now.

### `assist` — "Select the correct meaning"

```yaml
- type: assist
  direction: [uk, en]
  prompt: вікно
  choices: [window, door, floor]
  answers: [window]
  hints: {вікно: [window, a window]}
  word: вікно
  badge: new
```

`choices` are shuffled unless you set `shuffle: false`. The first of `answers`
must appear in `choices` exactly.

### `translate` — "Write this in …"

```yaml
- type: translate
  direction: [uk, en]
  prompt: Це моє вікно.
  bank: [This, is, my, window, door, large]
  answers:
    - This is my window
    - That is my window
  hints: {вікно: [window]}
  word: вікно
```

The learner taps words out of `bank` onto the line. `answers` is every accepted
wording and **the first one is definitive** — it is what the banner shows as the
solution, what the tiles have to be able to spell, and what the "new word" audit
reads. One accepted wording is written `answers: [This is my window]`.

Marking ignores case, punctuation anywhere in the sentence, and a leading
article; forgives a single-character typo on answers of four characters or more;
expands English contractions (`isn't` reads as `is not`); and treats Ukrainian's
`у`/`в` and `і`/`й` as the same word, because they are — the language picks
between them for how they sound next to their neighbours, never for meaning.
None of that needs listing in `answers`. What does: word orders the target
language allows, and places where a hint offers two English words for one
Ukrainian one (`диван` is a sofa or a couch, so both are right, in any
combination).

A near miss is not marked wrong the first time. CHECK becomes TRY AGAIN, the
answer stays put, and the words at fault are coloured — on the tile, or echoed
under the banner if the answer was typed. **Red** is the wrong word; **amber**
is the right word spelt wrong. One retry per showing: missing twice is an
answer, not a slip.

How near is near enough scales with the sentence, `max(1, round(words / 5))`
words out — a three-word answer two words out is a different answer, but a
nine-word one is a sentence with two slips in it, and holding both to "exactly
one word" punishes the long sentences a unit exists to teach. A **misspelt word
costs nothing at all** against that: spelling is not what these challenges ask
about, and charging for it meant one typo plus one real mistake read the same as
two real mistakes and lost the second chance. Words shorter than four letters
are never read as misspellings — `чай` and `чаї` are a letter apart and are
different words, and so are `the` and `they`.

A word already on the line can be **dragged** to a different place in it, so
one wrong word early does not mean dismantling everything after it; tapping it
still sends it back to the bank. Nothing to author -- it applies to every
word-bank challenge.

Put every word of the first answer in `bank`, counted: a sentence needing two `is` needs
two `is` tiles, because a tapped tile is spent. The other `answers` do not have
to be buildable from the tiles — they are there for someone typing. `bank` is
shuffled unless you set `shuffle: false`.

### `match` — "Select the matching pairs"

```yaml
- type: match
  direction: [uk, en]
  pairs:
    - {target: вікно, source: window}
    - {target: двері, source: door}
```

**Always five pairs.** That is what Duolingo shows, every time, and
`check-lessons.js` fails on any other count. A short match is not a gentler
match — it is a different, easier exercise wearing the same clothes.

Both columns are shuffled. There is no wrong answer to record — a mismatch just
flashes and lets the learner try again. Completing one records every pair as
correct.

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

```yaml
- type: listenTap
  direction: [uk, uk]
  audio: Це моя кімната
  answers: [Це моя кімната]
  meaning: This is my room.
  bank: [Це, моя, кімната, вікно, твоя, велика]
  word: кімната
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

```yaml
- type: listenMatch
  direction: [uk, en]
  pairs:
    - {target: вікно, source: window}
    - {target: двері, source: door}
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

```yaml
hints: {вікно: [window, a window]}
```

Keyed by a word **as it appears in the prompt**, lowercased. That word gets the
dotted underline, and hovering it shows the list. This is the part learners
actually use, so it is worth filling in for any word that is new.

Longer sets read better as a block:

```yaml
hints:
  вікно: [window, a window]
  велике: [large, big]
```

Words in the prompt with no entry here get no underline and no hint.

The listening types take no `hints`: nothing is on screen to underline.

Hovering a hinted word also **says** it, as long as the prompt is in the language
being learned. That is half of why the underline is worth having, so fill hints
in for target-language prompts.

## `word`

```yaml
word: вікно
```

Optional. When present, the answer is written into the same practice records the
flashcard trainer keeps, so a word met here counts towards its strength and
comes up again when it is due. The direction it is recorded in comes from
`direction`: answering in English is recognising the word, answering in the
target language is producing it, and those are the two things the trainer tracks
separately.

A sentence names the word it is really drilling — `Кіт спить на дивані.` is a
sentence about `диван` — so `word` is not always a word in the answer. Leave it
out and the challenge is played but scored against nothing.

On `match` and `listenMatch` each pair records its own `target`, so nothing has
to be written per pair; give a pair its own `word` only when the form shown is
not the form to score (a match tile reading `велика` drilling `великий`).

The long form still works:

```yaml
record: {direction: tg2en, wordKey: вікно}
```

## `badge` and `newWords`

`new` puts the purple **NEW WORD** flag above the header, and renders the
prompt word itself in Duolingo's beetle purple, bold, over a purple dotted
underline, with their sparkle burst. Omit it otherwise.

`hard` is the red **HARD EXERCISE** flag. `mistake` is the orange
**PREVIOUS MISTAKE** flag — you will not normally author that one, because the
player sets it itself on a re-queued challenge (see below).

To colour some words but not the whole prompt, name them:

```yaml
newWords: [вікно]
```

Without `newWords`, `badge: new` treats the whole `prompt` as the new word.

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

Reads every file in this folder and in `../units/` and reports anything the
player would silently drop or choke on — an `answer` missing from its `choices`,
an answer word that is not in the `bank`, a hint keyed to a word the prompt does
not contain. It parses with the same js-yaml the player uses, so a YAML mistake
is reported here with its line number rather than turning into a lesson that
will not load.
