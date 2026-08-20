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

Three types. Every one of them takes an optional `record` (see below) and an
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

Five pairs is what Duolingo shows; any number works and the grid sizes itself.
Both columns are shuffled. There is no wrong answer to record — a mismatch just
flashes and lets the learner try again.

## `hints`

```json
"hints": { "вікно": ["window", "a window"] }
```

Keyed by a word **as it appears in the prompt**, lowercased. That word gets the
dotted underline, and hovering it shows the list. This is the part learners
actually use, so it is worth filling in for any word that is new.

Words in the prompt with no entry here get no underline and no hint.

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

On `match`, `record` goes on the individual pair rather than the challenge.

## `badge`

`"new"` puts the purple **NEW WORD** flag above the header. Omit it otherwise.

## Checking a file

```bash
node scripts/check-lessons.js
```

Reads every file in this folder and reports anything the player would silently
drop or choke on — an `answer` missing from its `choices`, an answer word that
is not in the `bank`, a hint keyed to a word the prompt does not contain.
