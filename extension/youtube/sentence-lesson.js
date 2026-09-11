// One subtitle line, turned into a lesson.
//
// The section player has one internal challenge shape and two producers of it
// already -- a hand-written YAML file and the deck dealer in lesson.js. This is
// the third, and it emits the same objects, so nothing downstream knows a
// lesson came off a cartoon rather than out of units/. See
// section/lessons/README.md for the format every field here is obeying.
//
// A single sentence is a much thinner brief than a deck of vocabulary. There is
// no card pool to draw a session from, no strength to consult and -- because
// these lessons deliberately write no practice records -- no `word` on anything.
// What there is: the sentence, a lemma per word (Language Reactor labels every
// token it renders), and Chrome's on-device target->English translator.
//
// Two rules from the format shape everything below.
//
// A `match` may only drill words something earlier has already taught, and it
// must be five pairs. One sentence almost never has five glossed content words,
// and three assists cannot teach five, so there is no `match` here at all --
// a short match is not a gentler match, it is five strangers with no gloss.
//
// And a word bank must hold every word of the answer, counted: a sentence with
// two "the" in it needs two "the" tiles, because a tapped tile is spent. The
// deck dealer nearby runs its bank through a Set, which quietly loses the
// second one; a subtitle line is far likelier to repeat a word than a
// vocabulary card is, so the banks here are built duplicate-safe.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  // How many words of the line get an "select the correct meaning" card of
  // their own before the sentence itself is asked for. Three is the most a
  // seven-word cartoon line can carry without the lesson becoming a vocabulary
  // list with a sentence stapled to the end.
  const MAX_TAUGHT_WORDS = 3;
  // Extra tiles beyond the answer's own words. Duolingo's banks run a few over.
  const BANK_NOISE = 4;
  // What a lesson file writes where the missing word goes.
  const GAP = "___";
  const XP_PER_LESSON = 10;
  // Below this a "word" is punctuation, an interjection or a particle -- the
  // things a gloss cannot say anything useful about.
  const MIN_TAUGHT_WORD_LENGTH = 3;

  // Function words. A card asking what "що" means teaches nothing a sentence
  // would not teach better, and they crowd out the words worth a card.
  const SKIP_WORDS = new Set([
    "і", "й", "та", "а", "але", "що", "як", "це", "цей", "ця", "то", "той",
    "у", "в", "з", "із", "зі", "на", "до", "за", "по", "про", "від", "для",
    "не", "ні", "так", "ще", "вже", "тут", "там", "он", "ось", "же", "би", "б",
    "я", "ти", "ви", "ми", "він", "вона", "воно", "вони", "мене", "тебе"
  ]);

  function targetLanguage() {
    return LWR.getCurrentLanguageCode() || "uk";
  }

  function languageName(code) {
    return code === "en" ? "English" : (LWR.LANGUAGE_NAMES || {})[code] || "your language";
  }

  // Tiles carry bare words. The answer keeps its punctuation -- the grader
  // ignores it either way -- but a tile reading "сталося." can never be tapped
  // into a sentence that needs "сталося" somewhere else too.
  function bankWords(text) {
    return String(text || "")
      .split(/\s+/u)
      .map((word) => word.replace(/^[^\p{L}\p{N}'’-]+|[^\p{L}\p{N}'’-]+$/gu, ""))
      .filter(Boolean);
  }

  function lower(text) {
    return String(text || "").toLocaleLowerCase();
  }

  function shuffle(list) {
    const copy = [...list];
    for (let index = copy.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
  }

  function dedupe(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
      const text = String(value || "").trim();
      const key = lower(text);
      if (!text || seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(text);
    }
    return out;
  }

  // ------------------------------------------------------------ vocabulary --

  // The user's own words, read straight off the profile rather than through
  // LWR.compiledEntries. compiledEntries is filtered by `state.enabled`, which
  // is the translation on/off switch -- and a lesson button has no business
  // going dead because someone stopped replacing words on web pages.
  function vocabularyEntries() {
    return LWR.getCurrentEntries().map((entry) => ({
      source: String(entry.source || "").trim(),
      targets: String(entry.target || "")
        .split(/\s+\/\s+|\s*;\s*/u)
        .map((part) => part.trim())
        .filter(Boolean)
    }));
  }

  function vocabularyMeanings(entries, word) {
    const key = lower(word);
    if (!key) {
      return [];
    }
    return entries
      .filter((entry) => entry.targets.some((target) => lower(target) === key))
      .map((entry) => entry.source)
      .filter(Boolean);
  }

  // Wrong answers have to be plausible and single words -- a multi-word phrase
  // next to two bare words tells the learner which one is right without
  // reading any of them. The learner's own vocabulary is the best pool there
  // is: real words, already paired both ways, and ones they might confuse.
  function distractorPools(entries) {
    const english = [];
    const target = [];
    for (const entry of entries) {
      if (entry.source && !/\s/u.test(entry.source)) {
        english.push(entry.source);
      }
      const first = entry.targets[0];
      if (first && !/\s/u.test(first)) {
        target.push(first);
      }
    }
    return { english: dedupe(english), target: dedupe(target) };
  }

  function pickDistractors(pool, count, avoid) {
    const taken = new Set(avoid.map(lower));
    return shuffle(pool)
      .filter((word) => !taken.has(lower(word)))
      .slice(0, count);
  }

  // --------------------------------------------------------------- glosses --

  // What one word of the line means, cheapest source first: the learner's own
  // vocabulary under the surface form, then under the lemma Language Reactor
  // labelled the token with, and only then the translator. This is the same
  // ladder the hover tooltip climbs, and it matters that it is -- a word should
  // not mean one thing on hover and another in a lesson built from that hover.
  async function glossWord(token, entries, translator) {
    const found = dedupe([
      ...vocabularyMeanings(entries, token.text),
      ...vocabularyMeanings(entries, token.lemma)
    ]);
    if (found.length) {
      return { meanings: found.slice(0, 3), known: true };
    }

    if (!translator) {
      return { meanings: [], known: false };
    }

    const translated = String(await translator.translate(token.lemma || token.text)).trim();
    if (!translated || lower(translated) === lower(token.text)) {
      return { meanings: [], known: false };
    }
    // The translator answers a bare word with a bare word most of the time, but
    // not always -- "сталося" comes back as "it happened". Keep it: a wrong
    // gloss is worse than a wordy one.
    return { meanings: [translated], known: false };
  }

  // Which words of the line are worth a card. Content words only, longest
  // first -- the long ones carry the meaning, and a line's one interesting word
  // is rarely its shortest.
  function taughtCandidates(tokens) {
    return tokens
      .filter((token) => token.isWord)
      .filter((token) => token.text.length >= MIN_TAUGHT_WORD_LENGTH)
      .filter((token) => !SKIP_WORDS.has(lower(token.text)) && !SKIP_WORDS.has(lower(token.lemma)))
      .filter((token, index, all) => all.findIndex((other) => lower(other.text) === lower(token.text)) === index)
      .sort((a, b) => b.text.length - a.text.length);
  }

  // ------------------------------------------------------------ challenges --

  // Every word of the answer, in order, plus a few wrong ones. Not a Set: the
  // answer's own duplicates are what make a repeated word tappable twice.
  function buildBank(answer, pool) {
    const words = bankWords(answer);
    const noise = pickDistractors(pool, Math.max(BANK_NOISE, 0), words);
    return [...words, ...noise];
  }

  function hintsFor(prompt, taught) {
    const hints = {};
    const text = lower(prompt);
    for (const word of taught) {
      const key = lower(word.token.text);
      if (word.meanings.length && text.includes(key)) {
        hints[key] = word.meanings;
      }
    }
    return hints;
  }

  // The sentence with one word lifted out of it. Rebuilt from the tokens rather
  // than string-replaced, because a short word ("вже") is a substring of longer
  // ones and replacing by text blanks the wrong one.
  function gapPrompt(tokens, target) {
    let replaced = false;
    return tokens
      .map((token) => {
        if (!replaced && token === target) {
          replaced = true;
          return GAP;
        }
        return token.text;
      })
      .join("");
  }

  function buildChallenges(line, english, taught, pools, lang) {
    const challenges = [];
    const targetName = languageName(lang);

    // First, the words. "Select the correct meaning" is the only card here that
    // asks about a word on its own, so it goes before anything asks for the
    // whole sentence -- the lesson teaches, then demands.
    for (const word of taught) {
      const answer = word.meanings[0];
      const choices = [answer, ...pickDistractors(pools.english, 2, [answer, ...word.meanings])];
      if (choices.length < 3) {
        continue;
      }
      challenges.push({
        type: "assist",
        direction: [lang, "en"],
        prompt: word.token.text,
        choices,
        answers: word.meanings,
        hints: { [lower(word.token.text)]: word.meanings },
        badge: word.known ? null : "new"
      });
    }

    // Then the same words back in their sentence, one slot open. The grammar is
    // given and the meaning is readable; only the word being drilled is not.
    //
    // That only works if there is a sentence left around the gap. Blank the one
    // word of a two-word line and the prompt is a blank with a full stop after
    // it -- a card with nothing to read, which is a listening exercise with the
    // sound turned off.
    const gapWord = line.tokens.filter((token) => token.isWord).length >= 3 ? taught[0] : null;
    if (gapWord) {
      const answer = gapWord.token.text;
      const choices = [answer, ...pickDistractors(pools.target, 2, [answer, ...bankWords(line.text)])];
      if (choices.length === 3) {
        const prompt = gapPrompt(line.tokens, gapWord.token);
        challenges.push({
          type: "gapFill",
          direction: [lang, lang],
          prompt,
          choices,
          answers: [answer],
          // The gapped word is not in the prompt to underline, so it gets no
          // hint. Its neighbours still do.
          hints: hintsFor(prompt, taught.slice(1))
        });
      }
    }

    // Now the sentence, three ways round. Reading it first.
    challenges.push({
      type: "translate",
      direction: [lang, "en"],
      prompt: line.text,
      bank: buildBank(english, pools.english),
      answers: [english],
      hints: hintsFor(line.text, taught),
      newWords: taught.filter((word) => !word.known).map((word) => word.token.text)
    });

    // Hearing it. `meaning` is required by the format and is the whole point:
    // a listening card that never says what you just heard teaches nothing.
    challenges.push({
      type: "listenTap",
      direction: [lang, lang],
      audio: line.text,
      answers: [line.text],
      meaning: english,
      bank: buildBank(line.text, pools.target)
    });

    // Producing it.
    challenges.push({
      type: "translate",
      direction: ["en", lang],
      header: `Write this in ${targetName}`,
      prompt: english,
      bank: buildBank(line.text, pools.target),
      answers: [line.text]
    });

    // And saying it. The player drops this one by itself when Chrome has no
    // recogniser, the same way it drops the listening card without a voice.
    challenges.push({
      type: "speak",
      direction: [lang, lang],
      prompt: line.text,
      answers: [line.text],
      hints: hintsFor(line.text, taught)
    });

    return challenges;
  }

  // ------------------------------------------------------------------ main --

  // `line` is what youtube/language-reactor.js read off one subtitle: its text,
  // its tokens (words and the punctuation between them, in order, each word
  // carrying the lemma Language Reactor labelled it with) and the video it came
  // from. Everything else is worked out here.
  //
  // Nothing gets a `word` or a `record`. These lessons write no practice
  // records at all: the point of the flashcard strengths is that they track the
  // vocabulary the learner is actually studying, and a cartoon's vocabulary
  // would flood them with words they never chose.
  async function buildSentenceLesson(line) {
    const text = String(line?.text || "").trim();
    if (!text) {
      throw new Error("That subtitle line has no words in it.");
    }

    const lang = targetLanguage();
    const translator = await LWR.getReverseTranslator(lang);
    if (!translator) {
      throw new Error(
        `Chrome has no ${languageName(lang)}→English translator ready yet. Click the page once and try again.`
      );
    }

    const english = String(await translator.translate(text)).trim();
    if (!english || lower(english) === lower(text)) {
      throw new Error("That line came back untranslated.");
    }

    const entries = vocabularyEntries();
    const pools = distractorPools(entries);

    const taught = [];
    for (const token of taughtCandidates(line.tokens)) {
      if (taught.length >= MAX_TAUGHT_WORDS) {
        break;
      }
      const gloss = await glossWord(token, entries, translator);
      if (gloss.meanings.length) {
        taught.push({ token, ...gloss });
      }
    }

    const challenges = buildChallenges(line, english, taught, pools, lang);
    return {
      title: line.videoTitle || "From the video",
      xp: XP_PER_LESSON,
      source: { kind: "youtube", videoId: line.videoId || "", at: Number(line.at) || 0, text },
      challenges
    };
  }

  LWR.buildSentenceLesson = buildSentenceLesson;
})();
