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
const TYPES = ["assist", "translate", "match"];
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

  if (challenge.type === "match") {
    const pairs = challenge.pairs || [];
    if (pairs.length < 2) {
      fail(file, where, `needs at least 2 pairs, has ${pairs.length}`);
    }
    pairs.forEach((pair, at) => {
      if (!pair.target || !pair.source) {
        fail(file, where, `pair ${at + 1} needs both target and source`);
      }
    });
    return;
  }

  if (!challenge.prompt) {
    fail(file, where, "needs a prompt");
  }
  if (!challenge.answer && !(challenge.answers || []).length) {
    fail(file, where, "needs an answer");
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

  if (challenge.type === "translate") {
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
    console.log(`${file}: ${challenges.length} challenges`);
  }

  console.log(problems ? `\n${problems} problem(s)` : "\nall content looks playable");
  process.exit(problems ? 1 : 0);
}

main();
