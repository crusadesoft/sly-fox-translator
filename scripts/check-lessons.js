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
// The same reader the player uses, so nothing can pass here and then fail to
// load in a lesson.
const yaml = require("../extension/section/vendor/js-yaml.min.js");

const DIR = path.resolve(__dirname, "../extension/section/lessons");
const UNITS = path.resolve(__dirname, "../extension/section/units");
// The learner's own vocabulary, exported from Duolingo's Words page by the
// Words-page "Export word list" button. A word in here needs no introduction:
// the audit below is looking for words a unit USES without ever teaching, and
// a word they already knew before the unit existed is not one of those.
const KNOWN = path.resolve(__dirname, "fixtures/known-words-uk.txt");
// Forms belonging to those words that the stemmer cannot derive, listed by hand.
const KNOWN_FORMS = path.resolve(__dirname, "fixtures/known-forms-uk.txt");
const TYPES = ["assist", "gapFill", "translate", "match", "listenTap", "listenMatch"];
// Both are answered by picking one of a few choices.
const CHOICE_TYPES = ["assist", "gapFill"];
// What a lesson file writes where the missing word goes.
const GAP = "___";
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

  if (challenge.type === "gapFill" && !String(challenge.prompt || "").includes(GAP)) {
    fail(file, where, `prompt has no ${GAP} for the missing word`);
  }

  if (CHOICE_TYPES.includes(challenge.type)) {
    const choices = challenge.choices || [];
    if (choices.length < 2) {
      fail(file, where, `needs at least 2 choices, has ${choices.length}`);
    }
    // answers[0] is the one on show, which is the one that has to be pickable.
    if (answers[0] && !choices.includes(answers[0])) {
      fail(file, where, `answer "${answers[0]}" is not one of the choices`);
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
    // The answer on show has to be buildable from the tiles, COUNTED: a
    // sentence needing two "is" needs two tiles, because a tapped tile is
    // spent. Checking membership instead of multiplicity is how "My kitchen is
    // here and the room is there" shipped with one "is" in the bank -- the
    // answer was literally impossible to give, and this said it was fine.
    //
    // Only the first answer, though. The rest are the other ways of saying the
    // same thing, and they are there for someone typing: "There is a table and
    // a chair in my room" is a correct translation whether or not the tiles
    // happen to spell it.
    for (const answer of answers.slice(0, 1)) {
      const spare = new Map();
      for (const word of bank) {
        spare.set(word, (spare.get(word) || 0) + 1);
      }
      const missing = [];
      for (const word of answer.split(/\s+/).filter(Boolean)) {
        const left = spare.get(word) || 0;
        if (left) {
          spare.set(word, left - 1);
        } else {
          missing.push(word);
        }
      }
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
          // The prompt and the answer on show are what a unit puts in front of
          // you. The other accepted answers are ways of replying, never
          // content -- "свого" being allowed does not mean anything taught it.
          const texts = [challenge.prompt, challenge.answer || (challenge.answers || [])[0]];
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

  const orphans = [...firstSeen].filter(([word]) => !declared.has(word) && !isKnownWord(word));
  if (orphans.length) {
    console.log(`  ${file}: ${orphans.length} word(s) appear without ever being taught --`);
    for (const [word, where] of orphans) {
      console.log(`      ${word} (first in ${where})`);
    }
  }
}

// The exported word list. Duolingo's Words page lists DICTIONARY forms only --
// it will never show читаю or на столі -- so a word's absence from the export
// says nothing about whether the learner knows that form. Reading grammar
// knowledge out of what the export omits is a mistake; the rule here is the
// one the learner set: if a word is in the export, every form of it is known.
//
// Matching those forms means stemming, since Ukrainian inflects by suffix.
// It is approximate on purpose: it clears the endings and the і/о/е alternation
// of a closed syllable (стіл -> на столі), and anything it cannot resolve is
// reported rather than assumed, which is the safe direction to be wrong in.
const ENDINGS = [
  "ами", "ями", "ові", "еві", "ого", "ому", "ими",
  "ах", "ях", "ам", "ям", "ів", "ом", "ем", "ою", "ею", "ий", "ій", "им", "их",
  "ї", "а", "я", "и", "і", "у", "ю", "е", "є", "о", "ь"
];

// Possessives and pronouns inflect too irregularly to stem, and are a closed
// set, so their forms are listed rather than derived.
const CLOSED_CLASS = `
  мій моя моє мої мого моєї моєму моїй моїм моїми моєю
  твій твоя твоє твої твого твоєї твоєму твоїй твоїм твоїми твоєю
  наш наша наше наші нашого нашої нашому нашій нашим нашими нашою
  ваш ваша ваше ваші вашого вашої вашому вашій вашим вашими вашою
  свій своя своє свої свого своєї своєму своїй своїм своїми своєю
  я мене мені мною ти тебе тобі тобою він вона воно його її йому їй ним нею
  ми нас нам нами ви вас вам вами вони їх їм ними
  цей ця це ці цього цієї цьому цій цим цими
`.trim().split(/\s+/);

function stemWord(word) {
  const value = String(word).toLocaleLowerCase().replace(/[\u2019']/g, "'");
  for (const ending of ENDINGS) {
    if (value.length - ending.length >= 3 && value.endsWith(ending)) {
      return value.slice(0, value.length - ending.length);
    }
  }
  return value;
}

// стіл / стола, Київ / Києві: a closed syllable takes і where the open one
// takes о or е, so a stem is filed under every vowel it could surface with.
function stemVariants(word) {
  const base = stemWord(word);
  const out = new Set([base]);
  if (base.includes("і")) {
    out.add(base.replace(/і(?=[^аеиіоуяєюї]*$)/, "о"));
    out.add(base.replace(/і(?=[^аеиіоуяєюї]*$)/, "е"));
  }
  return out;
}

let knownWords = null;

function readKnownWords() {
  if (knownWords) {
    return knownWords;
  }

  knownWords = new Set();
  const add = (word) => {
    const value = String(word).trim().toLocaleLowerCase();
    if (!value) {
      return;
    }
    knownWords.add(value);
    for (const variant of stemVariants(value)) {
      knownWords.add(`=${variant}`);
    }
  };

  CLOSED_CLASS.forEach(add);
  for (const file of [KNOWN, KNOWN_FORMS]) {
    if (!fs.existsSync(file)) {
      continue;
    }
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const text = line.trim();
      if (!text || text.startsWith("#")) {
        continue;
      }
      // Each side of a multi-word entry counts: "домашнє завдання" means both
      // words are known, and a lesson using either is not introducing it.
      for (const word of text.split(/[\u2014\u2013-]/)[0].split(/\s+/)) {
        add(word);
      }
    }
  }
  return knownWords;
}

function isKnownWord(word) {
  const set = readKnownWords();
  if (set.has(String(word).toLocaleLowerCase())) {
    return true;
  }
  for (const variant of stemVariants(word)) {
    if (set.has(`=${variant}`)) {
      return true;
    }
  }
  return false;
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
const TARGET_LANG = "uk";

// `direction: [shown, answered]` is the one place a challenge says which way it
// runs; the player reads it the same way. The long-form fields still win where
// a file uses them.
function directionOf(challenge) {
  const pair = Array.isArray(challenge.direction)
    ? challenge.direction
    : String(challenge.direction || "").split(/[\s,>-]+/);
  const listening = LISTEN_TYPES.includes(challenge.type);
  const matching = MATCH_TYPES.includes(challenge.type);
  const answered =
    challenge.answerLang ||
    (CHOICE_TYPES.includes(challenge.type) ? challenge.choiceLang : null) ||
    (matching ? challenge.sourceLang : null) ||
    String(pair[1] || "").trim() ||
    (listening ? TARGET_LANG : "en");
  return {
    shown:
      challenge.promptLang ||
      challenge.audioLang ||
      (matching ? challenge.targetLang : null) ||
      String(pair[0] || "").trim() ||
      TARGET_LANG,
    answered
  };
}

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
  const { shown, answered } = directionOf(challenge);

  if (MATCH_TYPES.includes(challenge.type)) {
    return out;
  }

  if (shown !== "en" && challenge.prompt) {
    add(challenge.prompt);
  }
  // An assist run the other way -- English prompt, target-language choices --
  // teaches its answer. Assists carry no `answerLang`, so `choiceLang` is what
  // says which side the answer is on.
  if (answered !== "en") {
    add(challenge.answer);
    add((challenge.answers || [])[0]);
    // Only the answer on show teaches. The rest of `answers` are other ways of
    // replying, which the learner never sees.
    if (!challenge.answer) {
      add((challenge.answers || [])[0]);
    }
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
      // A word the learner already has needs no introduction here either: the
      // rule exists so a match never hands over five strangers, and a word off
      // their own Duolingo list is not a stranger.
      const untaught = [...matchedWordsOf(challenge)].filter(
        (word) => !known.has(word) && !isKnownWord(word)
      );
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

function readYaml(dir, file) {
  let data;
  try {
    data = yaml.load(fs.readFileSync(path.join(dir, file), "utf8"));
  } catch (error) {
    // js-yaml puts the line and column in the message, which is the whole
    // reason for reading these here rather than only in the player.
    fail(file, "", `is not valid YAML -- ${error.message}`);
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    fail(file, "", "is empty, or is not a mapping of fields");
    return null;
  }
  return data;
}

function main() {
  if (fs.existsSync(UNITS)) {
    for (const file of fs.readdirSync(UNITS).filter((n) => n.endsWith(".yaml"))) {
      if (!/^[a-z0-9-]+\.yaml$/.test(file)) {
        fail(file, "", "name must be lowercase letters, digits and dashes");
      }
      const unit = readYaml(UNITS, file);
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

  const files = fs.readdirSync(DIR).filter((name) => name.endsWith(".yaml"));

  for (const file of files) {
    const lesson = readYaml(DIR, file);
    if (!lesson) {
      continue;
    }

    if (!/^[a-z0-9-]+\.yaml$/.test(file)) {
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
