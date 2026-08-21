// Check the hand-written lesson files.
//
// The player drops anything it cannot use rather than crashing, which is the
// right behaviour at runtime and the wrong one while you are writing lessons --
// a typo turns into a challenge that silently never appears. This says so
// instead.
//
//   node scripts/check-lessons.js
//
// Written to be run over a folder that will eventually hold a lot of generated
// files, so it reports every problem in every file rather than stopping at the
// first.

const fs = require("fs");
const path = require("path");

const DIR = path.resolve(__dirname, "../extension/section/lessons");
const UNITS = path.resolve(__dirname, "../extension/section/units");
const TYPES = ["assist", "translate", "match", "listenTap", "listenMatch"];
// The two that are spoken rather than printed. They carry no prompt: what is
// said IS the answer, so there is nothing to show before it has been given.
// Typing is not a type -- it is the other way to answer a word-bank question.
const LISTEN_TYPES = ["listenTap", "listenMatch"];
const PUCK_KINDS = ["skill", "practice", "unit_review", "chest"];
const PUCK_SLOTS = 5;

let problems = 0;

function fail(file, where, message) {
  problems += 1;
  console.log(`  ${file} ${where}: ${message}`);
}

// A prompt word matches a hint key on a loose comparison -- lowercased, with
// surrounding punctuation off -- because that is what the player does when it
// lays the underline over the word.
function promptWords(prompt) {
  return String(prompt || "")
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "").toLocaleLowerCase())
    .filter(Boolean);
}

function checkChallenge(file, prefix, index, challenge) {
  const where = `${prefix || ""}challenge ${index + 1} (${challenge.type || "no type"})`;

  if (!TYPES.includes(challenge.type)) {
    fail(file, where, `type must be one of ${TYPES.join(", ")} -- this one is dropped`);
    return;
  }

  if (challenge.type === "match" || challenge.type === "listenMatch") {
    const pairs = challenge.pairs || [];
    // Always five, the way theirs is. A short match is not a gentler match --
    // it is a different, easier exercise wearing the same clothes. If five
    // taught words are not available yet, the match belongs later in the puck,
    // not shrunk to fit where it is.
    if (pairs.length !== MATCH_PAIRS) {
      fail(file, where, `needs exactly ${MATCH_PAIRS} pairs, has ${pairs.length}`);
    }
    pairs.forEach((pair, at) => {
      if (!pair.target || !pair.source) {
        fail(file, where, `pair ${at + 1} needs both target and source`);
      }
    });
    return;
  }

  const listening = LISTEN_TYPES.includes(challenge.type);

  if (!challenge.prompt && !listening) {
    fail(file, where, "needs a prompt");
  }
  if (!challenge.answer && !(challenge.answers || []).length) {
    fail(file, where, "needs an answer");
  }
  if (listening) {
    if (!challenge.audio && !challenge.answer) {
      fail(file, where, "needs audio (or an answer to speak)");
    }
    if (!challenge.meaning) {
      fail(file, where, "needs a meaning -- it is shown once the answer is in");
    }
  }

  const answers = (challenge.answers && challenge.answers.length
    ? challenge.answers
    : [challenge.answer]
  ).filter(Boolean);

  if (challenge.type === "assist") {
    const choices = challenge.choices || [];
    if (choices.length < 2) {
      fail(file, where, `needs at least 2 choices, has ${choices.length}`);
    }
    if (challenge.answer && !choices.includes(challenge.answer)) {
      fail(file, where, `answer "${challenge.answer}" is not one of the choices`);
    }
    if (new Set(choices).size !== choices.length) {
      fail(file, where, "has a repeated choice");
    }
  }

  if (challenge.type === "translate" || challenge.type === "listenTap") {
    const bank = challenge.bank || [];
    if (!bank.length) {
      fail(file, where, "needs a bank");
    }
    // Every word of every accepted answer has to be tappable, or that answer
    // cannot be given.
    for (const answer of answers) {
      const missing = answer
        .split(/\s+/)
        .filter(Boolean)
        .filter((word) => !bank.includes(word));
      if (missing.length) {
        fail(file, where, `bank is missing ${missing.map((w) => `"${w}"`).join(", ")} for "${answer}"`);
      }
    }
    if (bank.length < 4) {
      fail(file, where, `bank has only ${bank.length} words -- add some wrong ones`);
    }
  }

  const words = new Set(promptWords(challenge.prompt));
  for (const key of Object.keys(challenge.hints || {})) {
    if (!words.has(key.toLocaleLowerCase())) {
      fail(file, where, `hint "${key}" is not a word in the prompt, so nothing will underline`);
    }
  }

  if (challenge.record && !challenge.record.wordKey) {
    fail(file, where, "record needs a wordKey");
  }
}

// A unit is the whole thing: its pucks, and every lesson inside them. The path
// only has five puck stops, so a sixth would simply never be drawn.
function checkUnit(file, unit) {
  const pucks = unit.pucks || [];
  if (!pucks.length) {
    fail(file, "", "has no pucks");
    return 0;
  }

  const playable = pucks.filter((puck) => puck.kind !== "chest");
  if (playable.length > PUCK_SLOTS) {
    fail(file, "", `has ${playable.length} pucks but the path only shows ${PUCK_SLOTS}`);
  }

  let total = 0;
  pucks.forEach((puck, index) => {
    const where = `puck ${index + 1} (${puck.label || puck.kind || "unnamed"})`;
    if (!PUCK_KINDS.includes(puck.kind)) {
      fail(file, where, `kind must be one of ${PUCK_KINDS.join(", ")}`);
    }
    if (puck.kind === "chest") {
      return;
    }
    if (!puck.label) {
      fail(file, where, "needs a label -- it is the title on the lesson popover");
    }
    const lessons = puck.lessons;
    if (!Array.isArray(lessons) || !lessons.length) {
      fail(file, where, "needs a lessons array");
      return;
    }
    lessons.forEach((lesson, at) => {
      const challenges = lesson.challenges || [];
      if (!challenges.length) {
        fail(file, `${where} lesson ${at + 1}`, "has no challenges");
        return;
      }
      total += challenges.length;
      challenges.forEach((challenge, index2) =>
        checkChallenge(file, `${where} lesson ${at + 1} `, index2, challenge)
      );
    });
  });
  return total;
}

// Every target-language word a unit shows, against the ones it ever declares as
// new. A word that is used but never introduced simply never turns purple --
// which is silent, and is exactly how a whole unit ended up with new adjectives
// nobody was ever told were new. Word forms are not tracked (кухня and кухні are
// two entries here), so this reports rather than fails: it is a list to read,
// not a rule to satisfy.
function auditNewWords(file, unit) {
  const CYRILLIC = /[\u0400-\u04FF]/;
  const declared = new Set();
  const firstSeen = new Map();

  const wordsIn = (text) =>
    String(text || "")
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}'\u2019]+/u)
      .filter((word) => word && CYRILLIC.test(word));

  (unit.pucks || [])
    .filter((puck) => puck.kind !== "chest")
    .forEach((puck, pi) => {
      (puck.lessons || []).forEach((lesson, li) => {
        (lesson.challenges || []).forEach((challenge) => {
          for (const word of challenge.newWords || []) {
            declared.add(String(word).toLocaleLowerCase());
          }
          if (challenge.badge === "new" && challenge.prompt) {
            declared.add(String(challenge.prompt).toLocaleLowerCase());
          }
          const texts = [challenge.prompt, challenge.answer, ...(challenge.answers || [])];
          for (const pair of challenge.pairs || []) {
            texts.push(pair.target);
          }
          for (const text of texts) {
            for (const word of wordsIn(text)) {
              if (!firstSeen.has(word)) {
                firstSeen.set(word, `${puck.label || "puck " + (pi + 1)} lesson ${li + 1}`);
              }
            }
          }
        });
      });
    });

  const orphans = [...firstSeen].filter(([word]) => !declared.has(word));
  if (orphans.length) {
    console.log(`  ${file}: ${orphans.length} word(s) appear without ever being marked new --`);
    for (const [word, where] of orphans) {
      console.log(`      ${word} (first in ${where})`);
    }
  }
}

// Matching drills recognise; they do not teach. Five pairs put five words in
// front of someone at once with no gloss, no sentence and no context, so every
// word in a matching challenge has to have been introduced by an earlier
// challenge that actually teaches it -- a one-word `assist`, or a sentence.
// Otherwise the first lesson of a unit hands the learner five strangers and
// calls it practice.
//
// "Introduced" means the word appeared in a non-matching challenge earlier in
// the same file, in order. Matching challenges never introduce anything.
const MATCH_TYPES = ["match", "listenMatch"];
// Duolingo shows five pairs, every time.
const MATCH_PAIRS = 5;

function splitWords(text) {
  return String(text || "")
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .map((word) => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
}

// What a matching challenge puts in front of the learner.
function matchedWordsOf(challenge) {
  return new Set((challenge.pairs || []).flatMap((pair) => splitWords(pair.target)));
}

// What a challenge actually *teaches*, which is narrower than what it shows.
// A word bank is mostly distractors and an assist's wrong choices are noise:
// both put target-language words on screen without ever saying what they mean,
// so neither counts. Only the thing being asked about, and the answer, teach.
function taughtWordsOf(challenge) {
  const out = new Set();
  const add = (text) => splitWords(text).forEach((word) => out.add(word));

  if (MATCH_TYPES.includes(challenge.type)) {
    return out;
  }

  if (challenge.promptLang !== "en" && challenge.prompt) {
    add(challenge.prompt);
  }
  // An assist run the other way -- English prompt, target-language choices --
  // teaches its answer. Assists carry no `answerLang`, so `choiceLang` is what
  // says which side the answer is on.
  if (challenge.type === "assist" && (challenge.choiceLang || "en") !== "en") {
    add(challenge.answer);
  }
  if (challenge.answerLang && challenge.answerLang !== "en") {
    add(challenge.answer);
    for (const answer of challenge.answers || []) add(answer);
  }
  // A listening challenge teaches whatever it says out loud, since it hands
  // over the meaning once the answer is in.
  add(challenge.audio);
  return out;
}

function checkTeachingOrder(file, where, lessons) {
  const known = new Set();
  lessons.forEach(({ label, challenges }) => {
    (challenges || []).forEach((challenge, index) => {
      if (!MATCH_TYPES.includes(challenge.type)) {
        for (const word of taughtWordsOf(challenge)) known.add(word);
        return;
      }
      const untaught = [...matchedWordsOf(challenge)].filter((word) => !known.has(word));
      if (untaught.length) {
        fail(
          file,
          `${where}${label}challenge ${index + 1} (${challenge.type})`,
          `matches ${untaught.map((w) => `"${w}"`).join(", ")} before anything teaches ` +
            `${untaught.length === 1 ? "it" : "them"} -- introduce the word first, ` +
            "in an assist or a sentence"
        );
      }
    });
  });
}

function readJson(dir, file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  } catch (error) {
    fail(file, "", `is not valid JSON -- ${error.message}`);
    return null;
  }
}

function main() {
  if (fs.existsSync(UNITS)) {
    for (const file of fs.readdirSync(UNITS).filter((n) => n.endsWith(".json"))) {
      if (!/^[a-z0-9-]+\.json$/.test(file)) {
        fail(file, "", "name must be lowercase letters, digits and dashes");
      }
      const unit = readJson(UNITS, file);
      if (!unit) {
        continue;
      }
      const total = checkUnit(file, unit);
      const pucks = (unit.pucks || []).filter((p) => p.kind !== "chest");
      const lessons = pucks.reduce((sum, p) => sum + (p.lessons || []).length, 0);
      console.log(`${file}: ${pucks.length} pucks, ${lessons} lessons, ${total} challenges`);
      auditNewWords(file, unit);
      checkTeachingOrder(
        file,
        "",
        (unit.pucks || [])
          .filter((p) => p.kind !== "chest")
          .flatMap((p, pi) =>
            (p.lessons || []).map((l, li) => ({
              label: `${p.label || "puck " + (pi + 1)} lesson ${li + 1} `,
              challenges: l.challenges
            }))
          )
      );
    }
  }

  if (!fs.existsSync(DIR)) {
    console.log(problems ? `\n${problems} problem(s)` : "\nall content looks playable");
    process.exit(problems ? 1 : 0);
  }

  const files = fs.readdirSync(DIR).filter((name) => name.endsWith(".json"));

  for (const file of files) {
    let lesson;
    try {
      lesson = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8"));
    } catch (error) {
      fail(file, "", `is not valid JSON -- ${error.message}`);
      continue;
    }

    if (!/^[a-z0-9-]+\.json$/.test(file)) {
      fail(file, "", "name must be lowercase letters, digits and dashes -- the player will not load it");
    }
    const challenges = lesson.challenges || [];
    if (!challenges.length) {
      fail(file, "", "has no challenges");
      continue;
    }
    challenges.forEach((challenge, index) => checkChallenge(file, "", index, challenge));
    checkTeachingOrder(file, "", [{ label: "", challenges }]);
    console.log(`${file}: ${challenges.length} challenges`);
  }

  console.log(problems ? `\n${problems} problem(s)` : "\nall content looks playable");
  process.exit(problems ? 1 : 0);
}

main();
