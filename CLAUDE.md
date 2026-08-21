# Working on this repo

## Lessons are hand-edited YAML

`extension/section/units/*.yaml` and `extension/section/lessons/*.yaml` are the
source. Edit them **directly**. Do not write a generator script that emits them.

A generator puts the real source outside the repo, which means the YAML has an
upstream nobody else has: the next hand edit gets silently overwritten the next
time the generator runs, and it cannot be reviewed in a diff. One unreadable
Python file in a scratch directory is not worth the typing it saves.

The safety net a generator would provide already lives in the repo and applies
to hand edits too:

```bash
node scripts/check-lessons.js
```

`extension/section/lessons/AUTHORING.md` is the short guide to what goes in a
unit; `README.md` beside it is the format reference.

It also checks lesson vocabulary against the learner's own Duolingo export at
`scripts/fixtures/known-words-uk.txt`, which is **gitignored** -- it is personal
and this remote is public. Without it the checker still runs, but every form of
every known word is reported as untaught (67 of them on the current unit), so
re-export it from Duolingo's Words page with the extension's **Export word
list** button before relying on that part of the output.

It catches the things that are easy to get wrong by hand — a word bank missing a
word (counted, so two "is" need two tiles), an answer that is not among the
choices, a hint keyed to a word the prompt does not contain, a match drilling
words nothing has taught. Run it after editing a lesson.

## Don't play lessons in the user's Chrome with Skip

Driving `section/lesson.html` writes to their real flashcard records, and
`player-skip` grades as **wrong**. Answer challenges correctly instead — the
answers are in the YAML. See the memory note `lesson-tests-hit-real-practice-data`.
