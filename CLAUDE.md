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

It catches the things that are easy to get wrong by hand — a word bank missing a
word (counted, so two "is" need two tiles), an answer that is not among the
choices, a hint keyed to a word the prompt does not contain, a match drilling
words nothing has taught. Run it after editing a lesson.

## Don't play lessons in the user's Chrome with Skip

Driving `section/lesson.html` writes to their real flashcard records, and
`player-skip` grades as **wrong**. Answer challenges correctly instead — the
answers are in the YAML. See the memory note `lesson-tests-hit-real-practice-data`.
