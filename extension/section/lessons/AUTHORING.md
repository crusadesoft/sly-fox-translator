# Writing a unit

Format reference: `README.md`. This is what to put *in* the format.
Run `node scripts/check-lessons.js` after every edit.

## 1. Find out what they already know — first

Navigate to https://www.duolingo.com/practice-hub/words in their browser to export their up-to-date Duolingo word list.

- It lists **dictionary forms only**. `читати` being present says nothing about
  whether `читаю` is missing from their head.
- Rule: Assume a word in the export is known in **every** form — cases, conjugations,
  plurals. Use them freely.
- **Never infer a grammar gap from what the export omits.** A whole unit on verb
  conjugation was built and binned on that mistake. Ask instead.
- Measure the gap before choosing a theme. One unit taught 18 words, 11 of which
  were already known.
- Review the other lessons that are in the repo and include that in what they know since if you are making a lesson it will come after those.

## 2. The five pucks each have a job

| puck | kind | lessons | job |
| --- | --- | --- | --- |
| 1 | skill | 4 | **Teach.** L1–L3 introduce; **L4 introduces nothing** and asks the same words harder |
| 2 | skill | 4 | **Teach.** Same shape: new words in L1–L3, L4 is consolidation |
| 3 | practice | 3 | **Refresh older vocabulary — using none of this unit's words.** A break from the new material, not more drilling of it |
| 4 | practice | 3 | **Pucks 1 and 2 again, harder.** Longer sentences, two clauses. Nothing new |
| 5 | unit_review | 2 | **Mix everything** — the new words and the vocabulary puck 3 refreshed, in the same sentences |

Chests go between pucks. A word may only be introduced in P1/P2 lessons 1–3;
anywhere else, a new word is a bug. Inflections of a word the puck already
taught are fine in L4 — that *is* the increase in difficulty.

## 3. Proportions

| | |
| --- | --- |
| challenges | 7–9 per lesson — count it **without** the `speak`, which drops out on a machine with no microphone |
| new words | 2–3 per teaching lesson, **used in sentences in that same lesson** |
| direction | at least half `[en, uk]` — building the target language, not English |
| `assist` | ~10%. More than that is a vocabulary quiz, not a lesson |
| `gapFill` | ~1 per consolidation and review lesson. Drill the word the sentence turns on — a preposition, `немає`, a case ending |
| matching | ~1 per lesson from puck 1 L2 onward, a third of them `listenMatch` |
| `speak` | **At most 1 per lesson**, in consolidation, puck 3 and the reviews. Never two — see below |
| sentences | 5+ words average. Recombine known words to get there |

Vary the challenge order. Six lessons once shared a byte-identical skeleton with
the listening challenge 5th every time; you can feel that coming.

**One `speak` per lesson, never two.** A speaking challenge is dropped from the
lesson when the browser has no recogniser, exactly as a listening one is dropped
when there is no voice for the language. One of them costs a lesson a single
challenge; two can take it under the 7-challenge floor on somebody else's
machine. Count the lesson without them.

Put them where production is the point: the L4 consolidations, puck 3, and the
reviews. Not in P1/P2 lessons 1–3 — a word met sixty seconds ago is not ready to
be said out loud unprompted.

The cheap way to write one is to **convert a `[uk, en]` translate**. Its prompt
is already the target-language sentence and its hints are already keyed on the
target-language words, which is exactly what a `speak` needs: change the type,
set `direction: [uk, uk]`, drop the `bank`, and make `answers[0]` the prompt
without its final punctuation. All sixteen in the repo were made this way, which
is also why no lesson got longer.

**Prefer things people actually say.** `Мені треба рушник, будь ласка` teaches
the same noun as `Рушник у ванній` and also teaches how a request is shaped.
Puck 3 is where this matters most — it is all known words, so it can be almost
entirely real phrases: greetings, ordering, asking directions, small talk.

## 4. Accept every right answer

The grader already forgives punctuation, English contractions, and Ukrainian
`у`/`в` and `і`/`й`. Do not list those. Do list:

- **Word order.** Ukrainian fronts a prepositional phrase freely:
  `Підлога на кухні тепла` ≡ `На кухні підлога тепла`. Bound the phrase at the
  predicate — guessing it is "2 or 3 words" tears `на цій стіні` in half.
- **Synonyms the hint offers.** If `диван: [sofa, couch]`, accept both, in every
  combination with other such words in the sentence.
- **Simple vs continuous.** Ukrainian present covers `he reads` and
  `he is reading`. Both.

`answers[0]` is definitive: shown as the solution, checked against the bank.
The rest are typed-only and need not be buildable from the tiles.

## 5. Traps that have actually shipped

- **Bank multiplicity.** A sentence needing two `is` needs two `is` tiles — a
  tapped tile is spent. Eleven impossible challenges shipped this way.
- **Match drills are always 5 pairs**, and they may draw on words from outside
  the unit to get there — a taught word does not have to fill every slot. That
  is the point, not a workaround: it puts the new words next to old ones. So a
  matching drill can sit anywhere, including a puck's first lesson.
- **Use `listenMatch`, not just `match`.** Same drill with the target column
  spoken instead of printed, and it has the same 5-pair rule, so "not enough new
  words yet" is never a reason to skip it. Roughly one per two matches.
- **Hints** key on a word *as it appears in the prompt*. On `[en, uk]` that
  means the English word.
- **`newWords`** is what turns a word purple. An inflection of a word they
  already know is not new — don't badge it.
- **Don't reuse the previous unit's title.** Same name reads as "nothing
  changed", whatever is inside.
- **A `speak` is graded word by word, not as a sentence.** Every word has to be
  heard before it counts, and the per-word tolerance refuses to forgive
  anything under four letters — the same rule the typed grader uses, at a
  smaller grain. A sentence built mostly of tiny words (`Я не хочу іти`) is
  therefore far more fragile than its length suggests. Prefer sentences with
  some long words in them.
- **Don't put two sentences in a `speak` prompt.** `Де мій рушник? У ванній.` is
  a dialogue, not something anybody says in one breath, and the learner has to
  say all of it before the challenge completes.

## 6. Testing

Play it in a **throwaway tab**, and answer **correctly** — the answers are in
the YAML. `player-skip` grades as wrong and writes to their real flashcard
records. This has gone wrong three times; see CLAUDE.md.

A `speak` cannot be tested by clicking, and it needs a real microphone, which
makes it the one type worth exercising headlessly instead:

```bash
node scripts/shoot.js "section/lesson.html?lesson=speaking" out.png --init "<fake recogniser>" --probe "<script>"
```

Stub **both** `SpeechRecognition` and `webkitSpeechRecognition` — headless
Chromium defines the unprefixed one natively and it wins, so stubbing only the
prefixed name silently tests the real engine. Feed the fake a partial transcript
and then the rest, and assert the words light up and stay lit between attempts.
`speaking.yaml` is a lesson of nothing but `speak`, kept for this.
