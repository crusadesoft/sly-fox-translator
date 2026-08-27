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
| 1 | skill | **3–7** | **Teach.** Every lesson but the last introduces; **the last introduces nothing** and asks the same words harder |
| 2 | skill | **3–7** | **Teach.** Same shape: every lesson but the last introduces, the last consolidates |
| 3 | practice | 3 | **Refresh older vocabulary — using none of this unit's words.** A break from the new material, not more drilling of it |
| 4 | practice | 3 | **Pucks 1 and 2 again, harder.** Longer sentences, two clauses. Nothing new |
| 5 | unit_review | 2 | **Mix everything** — the new words and the vocabulary puck 3 refreshed, in the same sentences |

**How long the two teaching pucks are, is a judgement call.** Three lessons is
the floor for either — two that introduce and one that consolidates, the
smallest thing that is still a teaching puck rather than a handful of words.
Seven is the ceiling. Between those, let the material decide: a cluster of
sixteen words that belong together is better as one long puck than as one puck
and an awkward second, and a thin one should not be padded to four just because
the last unit was four. The two need not match each other — a unit whose theme
front-loads can run six and three.

Whatever the length, the shape does not change: the last lesson introduces
nothing and every lesson before it introduces two or three. The path takes the
lesson count from the array rather than from a constant, and already draws pucks
of two, three and four in the section as it stands.

**Running long costs something, and it is worth knowing what.** The lessons a
longer puck adds are *introducing* ones, and an introducing lesson may not hold
a `speak` — so a six-lesson puck teaches up to eighteen words against the same
seven speaking slots section 3 counts. Coverage gets harder, not easier, and the
speak sentences have to carry more words each. There is one more skeleton to
keep distinct from its neighbours, too. Neither is a reason not to do it; both
are reasons to decide the length on purpose rather than by drift.

Chests go between pucks. A word may only be introduced in an introducing lesson
— any lesson of puck 1 or puck 2 except the one that closes it; anywhere else, a
new word is a bug.
Inflections of a word the puck already taught are fine in its consolidation
lesson — that *is* the increase in difficulty.

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

**Interleave the introductions; never stack them.** A teaching lesson introduces
two or three words, and the obvious way to write it is every `assist` first and
then the sentences. All twelve teaching lessons in the section were written that
way, three of them opening `assist assist assist`, and it reads as a vocabulary
quiz stapled to the front of a lesson: the first ninety seconds of every one is
the same three-choice screen, so you learn the shape of the lesson before you
learn any of the words. Introduce a word, **use it**, then introduce the next.
Two `assist`s must never be adjacent, and the first one should not always be in
slot 1.

That leaves few enough shapes that they start colliding, so check: laying the
twelve skeletons out as `A T A T L T T T` and reading down the column is how
both the stacking and, afterwards, two lessons that had come out identical were
spotted.

**An `assist` is not the only way to meet a word.** A `[uk, en]` sentence with
the word in `newWords` and a hint on it introduces just as well — it comes up
purple, on a dotted underline, glossed on hover, which is more context than a
bare gloss and not less. Use it for at least one word per puck; it is the thing
that stops a teaching lesson having a recognisable skeleton at all. What a word
cannot do is turn up before *something* has introduced it, and
`check-lessons.js` only enforces that for `match`, so the rest is on you.

**One `speak` per lesson, never two.** A speaking challenge is dropped from the
lesson when the browser has no recogniser, exactly as a listening one is dropped
when there is no voice for the language. One of them costs a lesson a single
challenge; two can take it under the 7-challenge floor on somebody else's
machine. Count the lesson without them.

Put them where production is the point: the consolidation lesson that closes
puck 1 and puck 2, puck 3, and the reviews. Not in a lesson that introduces — a
word met sixty seconds ago is not ready to be said out loud unprompted.

The cheap way to write one is to **convert a `[uk, en]` translate**. Its prompt
is already the target-language sentence and its hints are already keyed on the
target-language words, which is exactly what a `speak` needs: change the type,
set `direction: [uk, uk]`, drop the `bank`, and make `answers[0]` the prompt
without its final punctuation. All sixteen in the repo were made this way, which
is also why no lesson got longer.

### Every word, every way

A word met only one way is half-learned. Each word a unit teaches has to be
**produced** (answered in Ukrainian), **recognised** (shown in Ukrainian,
answered in English or matched), **heard** and **said**, and `check-lessons.js`
now lists any word that misses one:

```
  at-home.yaml: 6 word(s) are never drilled every way --
      дзеркало (p5 r6 l2 s0) -- never speak
```

Twice over is the target, and produce/recognise/listen reach it on their own —
ordinary lesson writing hits every word from several sides without being asked.
`speak` does not, and that is arithmetic rather than carelessness:

| | |
| --- | --- |
| speaks per lesson | 1 |
| lessons that may hold one | the two consolidations, puck 4's three, puck 5's two — **7**, however long the teaching pucks run |
| minus puck 3's, which must use *older* vocabulary | 7 |
| words a unit teaches | 8 at the floor, up to 36 if both teaching pucks run to seven (12–14 in the two written so far) |

Seven sentences against fourteen words, and worse the longer the teaching pucks
run. So a `speak` cannot be about one word: write it to carry **three or four**
of them at once and choose which, deliberately, from what the report says is
still at zero.

```yaml
prompt: Лампа біля дивана, а дзеркало на стіні.   # лампа, диван, дзеркало, стіна
prompt: Подушка і ковдра на ліжку, а рушник у ванній.  # and five more
```

The same trick pays everywhere, because **a challenge drills every taught word
in it, not just the one `word:` names**. Coverage is bought by recombining the
words already in a sentence, not by adding challenges — which is the only way it
can be bought at all, since the challenge count per lesson is fixed at 7–9.
Counting only `word:` is how this looked far worse than it was the first time it
was measured.

**Prefer things people actually say.** `Мені треба рушник, будь ласка` teaches
the same noun as `Рушник у ванній` and also teaches how a request is shaped.
Puck 3 is where this matters most — it is all known words, so it can be almost
entirely real phrases: greetings, ordering, asking directions, small talk.

## 4. Give it a cast

Section 1 decides which words the unit teaches and section 3 decides how often.
Everything left over — **who** the sentence is about, what they want, whether it
is funny — is free, and it is the only lever left. Spend it. A unit is 140
challenges, and 140 anonymous ones do not add up to anything: *My sofa is old*
and *The wall is green* are correct, teach the right word, and are forgotten on
contact.

**Three names, introduced once each.** A name carries a sentence into the next
one, so the fortieth challenge is the fortieth line of the same story instead of
the fortieth stranger. `Мій брат спить на дивані` and `Луїджі спить на дивані`
drill exactly the same thing; only one of them is about anybody. Three is the
size: one is not a cast, six is a phone book.

A name **is** a new word, so declare it — `newWords: [Маріо]` on the sentence
that first uses it, in an introducing lesson like anything else. It is also the one
thing section 3's "2–3 new words" budget should not count, because a proper noun
with a gloss in its hint costs nothing to learn; one can ride along in a lesson
already introducing its two. The audit is per file, so a name used in two units
is declared in both.

**Prefer indeclinable names.** `Маріо`, `Луїджі`, `Йоші` are the same string in
every slot of every sentence, which means they can stand anywhere without
dragging in a case form that has to be taught. `Боузер` would need `Боузера`,
`Боузером`, and a `newWords` entry for each, because the audit tracks forms and
not lemmas. Ukrainian's own indeclinables — `таксі`, `кіно`, `меню` — are the
same trick and are already on the list.

**The unit usually has a plot already; find it rather than adding one.** The
theme was picked in section 1 out of a real cluster in their vocabulary, so the
cluster implies a situation before anyone writes a sentence. `гість`, `дух`,
`льох`, `ключ`, `скрип`, `хоробрий`, `страшний` is Luigi's Mansion with the
names taken out. Naming it cost that unit nothing: not one word changed.

**`а` is the punchline joint.** Ukrainian's contrastive `а` is setup-then-payoff,
and a two-clause sentence is exactly what pucks 4 and 5 are supposed to be
lengthening into. The pedagogy and the joke want the same shape, which is rare
enough to use every time it comes up:

```yaml
prompt: Дух шепоче, і Йоші розуміє, а я ні.
```

**A running gag is spaced repetition wearing a hat.** The same frame returning
three lessons later with one word changed is what the curriculum wants anyway.
The cat sleeping through each escalation — under the bed, on the new carpet, in
the cellar — is one joke told four times and four separate locative drills.

**Let puck 5 end the story.** "Mix everything" is a job description, not a
reason to play it. Give the last challenge of the last lesson somewhere to land
— `Уранці світло, і мені вже не страшно` after two pucks of being frightened —
and the review has a shape instead of a list.

**Theme is free; vocabulary is not.** A theme you can compose out of the export
costs nothing; one that needs a new noun has to be introduced in P1/P2 lessons
1–3 or dropped. Check before promising it. Wednesday-and-Friday abstinence, a
Sunday with no work in it, and somebody singing in a choir are built entirely
out of words the learner already had:

```yaml
prompt: У п'ятницю я не їм м'ясо, я їм рибу.
prompt: У неділю ми не працюємо.
prompt: Моя сестра співає в хорі, а я слухаю.
```

`ікона`, `свічка` and `церква` are not in the export, so the same theme's more
obvious images are simply unavailable until some unit teaches them.

**Puck 3 keeps the cast and drops the words.** Its rule is that it uses none of
*this unit's vocabulary*; a name is not vocabulary. Letting the same three
people order coffee and miss a train is what stops puck 3 reading as a different
app.

**Do not let the joke eat the drill.** `word:` still has to name the word the
sentence turns on, hints still key on words that are in the prompt, and the bank
still has to spell `answers[0]` counted. A funnier sentence that quietly drops
the word it was supposed to be teaching is a worse challenge, and
`check-lessons.js` will not catch that one.

## 5. Accept every right answer

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

## 6. Traps that have actually shipped

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
- **Gloss a word with the bare word.** An `assist` reading
  `[the door, the window, the wall]` puts an article in front of three choices
  that Ukrainian does not have, so it is not translating anything — and being
  on all three, it does not separate them either. It is three words of noise on
  every line of the only challenge whose entire content is one word. Eighteen
  of them shipped. `[door, window, wall]`. Nothing is lost by dropping it: the
  grader folds a leading `a`/`an`/`the`/`to` on English answers, so somebody
  typing "the door" is still right. Keep the `to` on a verb, though — `to shut`
  against `shut` is the difference between an infinitive and an imperative, and
  that one is doing work.
- **`newWords`** is what turns a word purple. An inflection of a word they
  already know is not new — don't badge it. Naming any word here also raises the
  NEW WORD flag on the challenge, whether or not a `badge` is written, so a
  proper noun declared in puck 4 is a purple surprise where the rule says
  nothing new can appear.
- **A conjugated form the stemmer cannot reach is reported as untaught.** It
  strips suffixes, and Ukrainian verbs move their stem (`співати` → `співає`,
  `слухати` → `слухаю`), so the audit calls those new even though the infinitive
  is in the export. If the form really does belong to a word on the list, add it
  to `scripts/fixtures/known-forms-uk.txt` — that file is tracked, unlike the
  export — rather than rewriting the sentence around it.
- **Don't reuse the previous unit's title.** Same name reads as "nothing
  changed", whatever is inside.
- **A `speak` is graded word by word, not as a sentence.** Every word has to be
  heard before it counts, and the per-word tolerance refuses to forgive
  anything under four letters — the same rule the typed grader uses, at a
  smaller grain. A sentence built mostly of tiny words (`Я не хочу іти`) is
  therefore far more fragile than its length suggests. Prefer sentences with
  some long words in them.
- **Nothing that can be dropped may be the only place a word is introduced.**
  A `speak` goes when there is no recogniser and a listening challenge goes when
  there is no voice, so a word whose single introduction is one of those is,
  on that machine, never taught at all — every later use of it is a stranger.
  `страшно` shipped introduced by the `speak` in puck 2 lesson 3. Introduce in
  an `assist` or a sentence; a `listenTap` also has no `hints`, so there is
  nowhere for the gloss to go even when it does play.
- **Don't put two sentences in a `speak` prompt.** `Де мій рушник? У ванній.` is
  a dialogue, not something anybody says in one breath, and the learner has to
  say all of it before the challenge completes.

## 7. Testing

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
