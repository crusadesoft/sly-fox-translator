// The Sly Fox lesson player.
//
// Duolingo's challenges, drawn from the user's own vocabulary. Every class name
// here is theirs, transcribed from build-assets/duolingo-kit/lesson/*.tree.txt;
// duolingo.css carries the rules. Nothing is styled by hand and nothing is
// cloned from a live page.
//
// The `data-test` attributes are not decoration. The extension's own Duolingo
// features -- the typing input, the hint ladder, the word-bank eye toggle, the
// misspelled decoys -- all attach by looking for `[data-test='word-bank']`,
// `[data-test='<word>-challenge-tap-token']` and friends. Speaking Duolingo's
// DOM contract is what lets those work here for free.
//
// Seven challenge types, all of which the user walked through on the real site:
//
//   assist      "Select the correct meaning" -- prompt plus three choices.
//   gapFill     "Fill in the blank" -- a sentence with one word missing.
//   translate   "Write this in English/Ukrainian" -- prompt plus a word bank.
//   match       "Select the matching pairs" -- five pairs, no Check button.
//   listenTap   "Tap what you hear" -- two speakers plus a word bank.
//   listenMatch "Select the matching pairs" with audio down the left column.
//   speak       "Speak this sentence" -- said aloud, words lighting up as heard.
//
// Typing is not an eighth type. `translate` and `listenTap` are the sentence
// construction pair, and their footer toggle swaps the word bank for a text box
// -- the same question answered a different way, which is all theirs does.
//
// Duolingo ships a recorded mp3 per prompt and we have none, so the listening
// ones speak through the browser's own synthesiser instead. `speak` is the other
// place the substance differs: theirs scores how a sentence was pronounced,
// while Chrome's recogniser only returns the words in it -- so this checks that
// the right words were said and does not pretend to grade how they sounded. The
// markup is theirs either way.
//
// Two behaviours ride on top of the queue, both watched on the real site:
//
//   Mistakes are re-queued. A missed challenge comes back after the last new
//   one, behind Duo saying "Let's review the exercises you missed!", wearing
//   the orange PREVIOUS MISTAKE badge, and missing it again queues it again.
//   The lesson cannot end until every challenge has been answered correctly.
//
//   Legendary is a puck's lessons shuffled into one run with every hint
//   stripped -- no dotted underlines, nothing to hover, and no Skip.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;

  const SECTION_STORAGE_KEY = "learnedWordReplacerSection";
  const SESSION_SIZE = 10;
  const MATCH_PAIRS = 5;
  // Where the matching drill sits, counted in cards already played. It cannot
  // come earlier than the number of pairs it needs: every word in it has to
  // have been taught by a challenge before it, so five pairs means five cards
  // have to have gone by first.
  const MATCH_AT = MATCH_PAIRS;
  const XP_PER_LESSON = 10;
  const LEGENDARY_XP = 40;
  const LEGENDARY_SIZE = 14;

  // Types the renderer knows. Anything else in a lesson file is dropped.
  const CHALLENGE_TYPES = ["assist", "gapFill", "translate", "match", "listenTap", "listenMatch", "speak"];
  // gapFill answers the way assist does -- one of a few choices -- so
  // everything from selecting to grading treats the two together.
  const CHOICE_TYPES = ["assist", "gapFill"];
  // What a lesson file writes where the missing word goes.
  const GAP = "___";
  const LISTEN_TYPES = ["listenTap", "listenMatch"];
  // The sentence-construction pair. Typing is not a question type of its own --
  // it is the other way of answering these two, which is what their keyboard
  // toggle switches between.
  const BUILD_TYPES = ["translate", "listenTap"];

  const ASSET = {
    quit: "assets/lesson/quit.svg",
    correct: "assets/lesson/correct.svg",
    incorrect: "assets/lesson/incorrect.svg",
    xp: "assets/lesson/xp.svg",
    accuracy: "assets/lesson/accuracy.svg",
    // Duolingo's lesson character is painted to a canvas from art bundled in
    // their JavaScript -- there is no asset to fetch, so it cannot be lifted.
    // Their PATH characters are real Lottie files though, and animate the same
    // way; these are four of them, taken off the path.
    characters: [
      "assets/characters/bea_smores_012.json",
      "assets/characters/duo_u7_1_books_01.json",
      "assets/characters/vikram_u11_0_grill.json",
      "assets/characters/duo_potion.json"
    ]
  };

  const PRAISE = ["Nice!", "Correct!", "Great job!", "Awesome!", "Excellent!", "Nicely done!"];

  // Measured off their bar: owl green until five in a row, gold from there, and
  // orange once the streak passes ten.
  const STREAK_COLORS = [
    { from: 11, color: "rgb(var(--color-fox))" },
    { from: 5, color: "rgb(var(--color-bee))" },
    { from: 0, color: "rgb(var(--color-owl))" }
  ];

  // Their card states. _1pRZ7 is "checked" (blue), _1drLQ marks the right
  // answer once checked, _2PPjz is the wrong-answer flash, and _3neHb/_27oCn
  // put every card into its after-check, non-interactive form.
  const CHOICE_BASE = "_8dMUn _2cKzl _1G3d-";
  const CHOICE_CHECKED = "_1pRZ7";
  const CHOICE_CORRECT = "_1drLQ";
  const CHOICE_WRONG = "_2PPjz";
  const CHOICE_RESOLVED = ["_3neHb", "_27oCn"];

  const state = {
    queue: [],
    position: 0,
    streak: 0,
    correctCount: 0,
    answered: 0,
    shownAt: 0,
    picked: [],
    selection: null,
    typed: "",
    matchChoice: null,
    matched: 0,
    graded: false,
    // The word being dragged along the line, and a one-shot flag so the click
    // that ends a drag does not also count as a tap.
    drag: null,
    dragged: false,
    // One near miss per showing earns a second try. Reset with the challenge,
    // not with the lesson: being one word out twice on the same card is an
    // answer, not a slip.
    retryUsed: false,
    deck: [],
    lesson: null,
    // Challenges answered wrong and owed a second showing, plus the count of
    // those eventually put right -- which is what their completion slide
    // reports back ("You corrected 3 mistakes in this lesson").
    mistakes: [],
    corrected: 0,
    // Duo announces the review once, on the way into it. Missing something
    // again while already correcting does not get announced a second time.
    reviewAnnounced: false,
    legendary: false,
    // Their keyboard toggle is sticky across challenges within a session.
    // null means "nobody has touched it", in which case each challenge opens
    // in whichever face it was authored as.
    preferTyping: null
  };

  // ---------------------------------------------------------------- markup --

  function el(tag, className, attrs) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    for (const [key, value] of Object.entries(attrs || {})) {
      if (value !== null && value !== undefined) {
        node.setAttribute(key, String(value));
      }
    }
    return node;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      // Skip the ones that are not there, the way el() does. Without this an
      // omitted height lands as the literal string "null" and the icon sizes
      // to nothing.
      if (value === null || value === undefined) {
        continue;
      }
      node.setAttribute(key, String(value));
    }
    return node;
  }

  function shuffle(list) {
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  // ------------------------------------------------------------------ audio --
  //
  // Every listening challenge on the real site plays a recorded mp3 fetched
  // from their CDN; each `pairs[]` entry and each prompt carries its own `tts`
  // URL. We have no recordings and will not hotlink theirs, so these speak
  // through the browser's synthesiser. The turtle button is the same utterance
  // at a lower rate, which is what their slow track amounts to.

  const SPEECH_RATE = { normal: 0.95, slow: 0.5 };

  // Which synthesiser to talk to.
  //
  // `speechSynthesis` is the web API and it does not work here. On a
  // chrome-extension:// page it accepts an utterance, reports `speaking` and
  // `pending`, and then never starts it -- no `start`, no `end`, not even an
  // `error`. The identical call on an ordinary page speaks normally, so this is
  // the page's origin and not the engine. Extensions are meant to use
  // `chrome.tts`, which needs the "tts" permission in the manifest.
  //
  // The web API is kept as the fallback for anywhere `chrome.tts` is absent.
  const tts = typeof chrome !== "undefined" && chrome.tts ? chrome.tts : null;

  let webVoices = [];

  function refreshVoices() {
    if (tts) {
      tts.getVoices((voices) => {
        webVoices = (voices || []).map((voice) => ({
          name: voice.voiceName,
          lang: voice.lang || "",
          voiceName: voice.voiceName
        }));
      });
      return;
    }
    if (globalThis.speechSynthesis) {
      webVoices = globalThis.speechSynthesis.getVoices() || [];
    }
  }

  function voices() {
    if (!tts && globalThis.speechSynthesis) {
      webVoices = globalThis.speechSynthesis.getVoices() || [];
    }
    return webVoices;
  }

  function pickVoice(lang) {
    const wanted = String(lang || "").toLowerCase().replace("_", "-");
    const base = wanted.split("-")[0];
    const available = voices();
    return (
      available.find((voice) => (voice.lang || "").toLowerCase().replace("_", "-") === wanted) ||
      available.find((voice) => (voice.lang || "").toLowerCase().split(/[-_]/)[0] === base) ||
      null
    );
  }

  // Whether a listening challenge in this language can actually be answered.
  // The voice list loads asynchronously and is empty until it does, so an
  // empty list has to read as "do not know yet" rather than "no" -- treating
  // it as "no" would drop every listening challenge from a cold start.
  function canSpeak(lang) {
    if (!tts && !globalThis.speechSynthesis) {
      return false;
    }
    const available = voices();
    return available.length === 0 || Boolean(pickVoice(lang));
  }

  // ------------------------------------------------------------- listening --
  //
  // Chrome's Web Speech recognition. Unlike speechSynthesis -- which on a
  // chrome-extension:// page accepts an utterance, reports `speaking`, and then
  // never starts it -- this one genuinely works here: measured on this origin,
  // uk-UA came back correct at 0.94 confidence.
  //
  // Four things that measurement taught, every one of them load-bearing below:
  //
  //   * interim results carry a FIXED confidence of 0.01, correct ones
  //     included. Only `isFinal` carries a real number, so interims are fit for
  //     display and nothing else.
  //   * `speechstart` fires on room noise and is very often followed by no
  //     result at all. It cannot be read as "the learner answered" -- a UI that
  //     waits on it hangs on a cough.
  //   * `no-speech` arrives as an ordinary `error` on timeout, so silence is
  //     observable rather than a hang.
  //   * two utterances can arrive merged into one transcript, so what comes
  //     back may carry more words than were asked for.
  //
  // It is also network-backed: the audio goes to Google, and there is no
  // offline path. A speaking challenge is therefore dropped rather than shown
  // when recognition is missing, exactly as a listening challenge is dropped
  // when the browser has no voice for its language.
  const Recogniser = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;

  function canHear() {
    return Boolean(Recogniser);
  }

  let listener = null;

  function stopListening() {
    if (!listener) {
      return;
    }
    const active = listener;
    listener = null;
    try {
      active.abort();
    } catch (error) {
      // Already finished; nothing to stop.
    }
  }

  // `handlers` gets onInterim(text), onFinal(text), onFail(reason) and onEnd().
  // Exactly one of onFinal/onFail/onEnd ends a run.
  function startListening(lang, handlers) {
    stopListening();
    if (!Recogniser) {
      handlers.onFail("unsupported");
      return;
    }

    const rec = new Recogniser();
    listener = rec;
    // Everything settled so far this run. Chrome emits a FINAL result for an
    // early part of a sentence while the speaker is still going -- "Мій друг
    // працює" landed as final, and grading it there marked a correct reading of
    // "Мій друг працює в офісі" wrong. `event.results` is cumulative, so this
    // holds the whole utterance and is only graded once the run ends.
    let settledSoFar = "";
    rec.lang = lang || targetLang();
    rec.interimResults = true;
    // Continuous, because a speaking exercise is not one utterance. Chrome ends
    // a non-continuous run at the first pause, which gives about five seconds
    // and cuts people off mid-sentence; the caller decides when the attempt is
    // over instead.
    rec.continuous = true;
    rec.maxAlternatives = 3;

    rec.addEventListener("result", (event) => {
      if (listener !== rec) {
        return;
      }
      let settled = "";
      let interim = "";
      for (let i = 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = result[0] ? result[0].transcript : "";
        if (result.isFinal) {
          settled += (settled ? " " : "") + text;
        } else {
          interim += (interim ? " " : "") + text;
        }
      }
      if (settled.trim()) {
        settledSoFar = settled.trim();
      }
      // Shown, not graded. What is final at this instant may still be half a
      // sentence; only `end` says the speaker has stopped.
      const showing = [settledSoFar, interim.trim()].filter(Boolean).join(" ");
      handlers.onInterim(showing);
    });

    rec.addEventListener("error", (event) => {
      if (listener !== rec) {
        return;
      }
      listener = null;
      handlers.onFail(event.error || "error");
    });

    rec.addEventListener("end", () => {
      if (listener !== rec) {
        return;
      }
      listener = null;
      if (settledSoFar) {
        handlers.onFinal(settledSoFar);
        return;
      }
      handlers.onEnd();
    });

    try {
      rec.start();
    } catch (error) {
      listener = null;
      handlers.onFail("start-failed");
    }
  }

  // Chrome's web synthesiser also wedges if `cancel()` is followed by `speak()`
  // in the same tick, so cancelling and speaking are always separated by a turn
  // of the event loop. chrome.tts does not need that, but it costs nothing and
  // keeps one code path.
  let speakTimer = null;
  let cancelledAt = 0;
  const CANCEL_SETTLE_MS = 150;

  function speak(text, lang, rate) {
    if (!text || (!tts && !globalThis.speechSynthesis)) {
      return;
    }
    clearTimeout(speakTimer);

    const speed = rate === "slow" ? SPEECH_RATE.slow : SPEECH_RATE.normal;
    const language = lang || targetLang();
    const voice = pickVoice(language);

    const say = () => {
      if (tts) {
        tts.speak(text, {
          lang: language,
          rate: speed,
          enqueue: false,
          voiceName: voice ? voice.voiceName : undefined
        });
        return;
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = language;
      utterance.rate = speed;
      if (voice) {
        utterance.voice = voice;
      }
      globalThis.speechSynthesis.speak(utterance);
    };

    stopSpeaking();
    const since = Date.now() - cancelledAt;
    speakTimer = setTimeout(say, Math.max(0, CANCEL_SETTLE_MS - since));
  }

  function stopSpeaking() {
    clearTimeout(speakTimer);
    if (tts) {
      tts.stop();
      cancelledAt = Date.now();
      return;
    }
    if (globalThis.speechSynthesis) {
      globalThis.speechSynthesis.cancel();
      cancelledAt = Date.now();
    }
  }

  // Their speaker, turtle and keyboard glyphs are Lottie animations built into
  // their JavaScript, so unlike the path art there is no file on their CDN to
  // vendor. These are Lucide's instead (ISC), copied verbatim from
  // lucide-icons/lucide and inlined rather than linked so `currentColor` can
  // paint them -- white on the audio buttons, macaw on the match tiles, wolf in
  // the footer.
  const LUCIDE = {
    "volume-2": [
      ["path", { d: "M11 4.702a.705.705 0 0 0-1.203-.498L6.413 7.587A1.4 1.4 0 0 1 5.416 8H3a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2.416a1.4 1.4 0 0 1 .997.413l3.383 3.384A.705.705 0 0 0 11 19.298z" }],
      ["path", { d: "M16 9a5 5 0 0 1 0 6" }],
      ["path", { d: "M19.364 18.364a9 9 0 0 0 0-12.728" }]
    ],
    turtle: [
      ["path", { d: "m12 10 2 4v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3a8 8 0 1 0-16 0v3a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1v-3l2-4h4Z" }],
      ["path", { d: "M4.82 7.9 8 10" }],
      ["path", { d: "M15.18 7.9 12 10" }],
      ["path", { d: "M16.93 10H20a2 2 0 0 1 0 4H2" }]
    ],
    keyboard: [
      ["path", { d: "M10 8h.01" }],
      ["path", { d: "M12 12h.01" }],
      ["path", { d: "M14 8h.01" }],
      ["path", { d: "M16 12h.01" }],
      ["path", { d: "M18 8h.01" }],
      ["path", { d: "M6 8h.01" }],
      ["path", { d: "M7 16h10" }],
      ["path", { d: "M8 12h.01" }],
      ["rect", { width: "20", height: "16", x: "2", y: "4", rx: "2" }]
    ],
    "layout-grid": [
      ["rect", { width: "7", height: "7", x: "3", y: "3", rx: "1" }],
      ["rect", { width: "7", height: "7", x: "14", y: "3", rx: "1" }],
      ["rect", { width: "7", height: "7", x: "14", y: "14", rx: "1" }],
      ["rect", { width: "7", height: "7", x: "3", y: "14", rx: "1" }]
    ],
    mic: [
      ["path", { d: "M12 19v3" }],
      ["path", { d: "M19 10v2a7 7 0 0 1-14 0v-2" }],
      ["rect", { width: "6", height: "13", x: "9", y: "2", rx: "3" }]
    ]
  };

  function buildLucideIcon(name, size) {
    const svg = svgEl("svg", {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      // Width only on the audio buttons: the glyph span has no height of its
      // own, so the square viewBox is what gives the icon its height. In the
      // footer the size is fixed instead, beside a line of text.
      width: size || "100%",
      height: size || null,
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true"
    });
    for (const [tag, attrs] of LUCIDE[name]) {
      svg.append(svgEl(tag, attrs));
    }
    return svg;
  }

  function buildSpeakerIcon(slow) {
    return buildLucideIcon(slow ? "turtle" : "volume-2");
  }

  // Their two speakers: 100x100 for full speed, 70x70 for the turtle, both on
  // .yJbco/.rnwSx with ._25RRr rounding the corners to 25% and ._37SfF drawing
  // the white ring around the small one.
  function buildSpeakerButton(spec, slow) {
    const shared = "_23274 _3TlAm _29LnD _2sNVM _2LoNU VzbUl _1AgKJ _1w2Ut _3wPHf _2Rt1l _1saKQ _1Lt8- _25RRr";
    const button = el(
      "button",
      `${slow ? "rnwSx" : "yJbco"} ${shared}${slow ? " _37SfF" : ""}`,
      {
        type: "button",
        "data-test": slow ? "challenge-speaker-slow" : "challenge-speaker",
        "aria-label": slow ? "Play slowly" : "Play"
      }
    );
    button.dataset.slyFoxSpeak = spec.audio;
    button.dataset.slyFoxLang = spec.audioLang || targetLang();
    button.dataset.slyFoxRate = slow ? "slow" : "normal";
    const glyph = el("span", "u_TP- fs-exclude _1OCYa");
    glyph.style.color = "rgb(var(--color-snow))";
    glyph.append(buildSpeakerIcon(slow));
    button.append(glyph);
    return button;
  }

  function buildSpeakerRow(spec) {
    const row = el("div", "_3C4MQ");
    const holder = el("div", "_3qAs-");

    const loud = el("span", "_1fdKO");
    loud.append(buildSpeakerButton(spec, false));

    const slowHolder = el("div", "g8o0T");
    const quiet = el("span", "_1fdKO");
    quiet.append(buildSpeakerButton(spec, true));
    slowHolder.append(quiet);

    holder.append(loud, slowHolder);
    row.append(holder);
    return row;
  }

  function buildBubbleTail() {
    const svg = svgEl("svg", {
      class: "_2PgN7 _3tTXW _3PLLp",
      height: 20,
      width: 18,
      viewBox: "0 0 18 20"
    });
    svg.style.setProperty("--__internal__-alignment", "38.5px");
    svg.append(
      svgEl("path", {
        class: "_3q-cX",
        d: "M2.00358 19.0909H18V0.909058L0.624575 15.9561C-0.682507 17.088 0.198558 19.0909 2.00358 19.0909Z"
      }),
      svgEl("path", {
        class: "_1Ps8f",
        "clip-rule": "evenodd",
        "fill-rule": "evenodd",
        d:
          "M18 2.48935V0L0.83037 15.6255C-0.943477 17.2398 0.312833 20 2.82143 20H18V18.2916H16.1228H2.82143C1.98523 18.2916 1.56646 17.3716 2.15774 16.8335L16.1228 4.12436L18 2.48935Z"
      })
    );
    return svg;
  }

  // ------------------------------------------------------------------ hints --
  //
  // Duolingo does not underline the text itself. The sentence is one span per
  // character with its own underline switched off, and a separate EMPTY div per
  // word is laid over the top, absolutely positioned to cover it. That overlay
  // carries the dotted underline and is what you hover. Reproducing it means
  // measuring each word after layout and placing an overlay on it.

  // Their prompt is one span per character, which is what the hint underline
  // is laid over. Repainting it is how a gapFill puts the chosen word into the
  // blank.
  function paintSentence(sentence, text) {
    sentence.textContent = "";
    for (const glyphText of text) {
      const glyph = el("span", "_2IGwo XxgPa", { "aria-hidden": "true" });
      glyph.style.background = "none";
      glyph.textContent = glyphText;
      sentence.append(glyph);
    }
  }

  function fillGap(word) {
    const challenge = state.queue[state.position];
    const sentence = document.querySelector("[data-sly-fox-hints] ._5HFLU");
    if (!challenge || challenge.type !== "gapFill" || !sentence) {
      return;
    }
    paintSentence(sentence, challenge.prompt.replace(GAP, word === null ? GAP : word));
  }

  function buildPrompt(text, lang, characterIndex, options = {}) {
    const row = el("div", "_31yjb");

    const characterHolder = el("div", "_2qg6J");
    const characterInner = el("div");
    // Their canvas is 236x350 of pixels shown at 118x175, sized by an inline
    // style on the element rather than by a rule. These animations are square,
    // so the box is square too and sits on the same baseline.
    characterInner.style.cssText = "vertical-align: top; width: 175px; height: 175px;";
    mountCharacter(characterInner, characterIndex);
    characterHolder.append(characterInner);

    const bubble = el("div", "_1tbN5 _44BHt");
    const bubbleInner = el("div", "_1lWtm");
    const line = el("div", "_20npu", { dir: "ltr", lang });
    const sentence = el("span", "_5HFLU", { lang });
    paintSentence(sentence, text);
    const wrapper = el("span");
    wrapper.append(sentence);
    // A speak challenge carries its play button inside the bubble, before the
    // sentence. Nothing else does, so it is opt-in rather than the default.
    if (options.speaker) {
      line.append(options.speaker);
    }
    line.append(wrapper);
    bubbleInner.append(line, buildBubbleTail());
    bubble.append(bubbleInner);

    row.append(characterHolder, bubble);
    row.dataset.slyFoxHints = JSON.stringify(options.hints || {});
    row.dataset.slyFoxNew = JSON.stringify(options.newWords || []);
    row.dataset.slyFoxLang = lang || "";
    return row;
  }

  // A word the learner has not met before is purple, not grey. Duolingo has a
  // whole family of hint tokens that differ only in the underline SVG and the
  // text colour -- ._2IGwo is the ordinary grey one, ._1ELE3 is the new-word
  // one (beetle, bold, purple dots). Both the overlay and the glyphs under it
  // have to change: the overlay carries the dots, the glyphs carry the colour.
  const HINT_TOKEN = { normal: "_2IGwo", new: "_1ELE3" };

  // Three sparkles drift off a new word as it appears. Theirs are ._P77qm with
  // a beetle ::before and one of three trajectory variants; the animation is
  // their `_2SiAC` keyframes, which the CSS build pulls in with the rule.
  const SPARKLE_VARIANTS = ["_1kMJb", "_2u6Cq", "_3Jwe8"];

  function addSparkles(overlay) {
    for (const variant of SPARKLE_VARIANTS) {
      const sparkle = el("div", `P77qm ${variant}`, { "aria-hidden": "true" });
      // The overlay is the hover target for the hint popover, so the sparkles
      // laid over it must not eat the pointer.
      sparkle.style.pointerEvents = "none";
      overlay.append(sparkle);
    }
  }

  // Lay a hint overlay over every word that has something to say. Runs after
  // the prompt is in the document, because it needs real geometry.
  function placeHintOverlays(row) {
    const hints = JSON.parse(row.dataset.slyFoxHints || "{}");
    const fresh = new Set(JSON.parse(row.dataset.slyFoxNew || "[]"));
    const sentence = row.querySelector("._5HFLU");
    if (!sentence || (!Object.keys(hints).length && !fresh.size)) {
      return;
    }

    const glyphs = [...sentence.children];
    const anchor = sentence.getBoundingClientRect();
    const words = sentence.textContent.split(/(\s+)/);
    let index = 0;

    for (const word of words) {
      const span = glyphs.slice(index, index + word.length);
      index += word.length;
      if (!word.trim() || !span.length) {
        continue;
      }

      // Look the word up without its punctuation, and underline only the
      // letters. Matching the raw token meant a hint keyed "кімната" never
      // fired on a sentence ending "кімната." -- silently, since a missing
      // hint just means no underline.
      const lead = word.length - word.replace(/^[^\p{L}\p{N}]+/u, "").length;
      const trail = word.length - word.replace(/[^\p{L}\p{N}]+$/u, "").length;
      const letters = span.slice(lead, span.length - trail);
      const key = word.slice(lead, word.length - trail).toLocaleLowerCase();
      const meanings = hints[key];
      const isNew = fresh.has(key);
      if ((!meanings && !isNew) || !letters.length) {
        continue;
      }

      // The glyphs carry the colour and weight; the overlay carries the dots.
      // Colouring only the overlay would tint nothing, since it is empty.
      //
      // Named as well as classed, because sly-fox.css has to take the weight
      // that class brings straight back off again -- see the note there -- and
      // the class it wears is a per-build hash.
      if (isNew) {
        letters.forEach((glyph) => {
          glyph.classList.add(HINT_TOKEN.new);
          glyph.dataset.slyFoxNewWord = "";
        });
      }

      const first = letters[0].getBoundingClientRect();
      const last = letters[letters.length - 1].getBoundingClientRect();
      const overlay = el(
        "div",
        `tFegI ${isNew ? HINT_TOKEN.new : HINT_TOKEN.normal} XxgPa _33wyM`,
        {
          tabindex: meanings ? "0" : null,
          "data-test": "hint-token",
          "aria-label": word
        }
      );
      overlay.dataset.slyFoxHint = JSON.stringify(meanings || []);
      // Hovering a word on their site says it as well as glossing it, so the
      // token carries what to speak and in which language.
      overlay.dataset.slyFoxWord = word.slice(lead, word.length - trail);
      overlay.dataset.slyFoxLang = row.dataset.slyFoxLang || "";
      overlay.style.cssText =
        `height: ${first.height}px; left: ${first.left - anchor.left}px; ` +
        `top: ${first.top - anchor.top}px; width: ${last.right - first.left}px;`;
      if (isNew) {
        addSparkles(overlay);
      }
      sentence.append(overlay);
    }
  }

  function overlayHost() {
    let host = document.getElementById("overlays");
    if (!host) {
      host = el("div", "fs-unmask");
      host.id = "overlays";
      document.body.append(host);
    }
    return host;
  }

  function closeHint() {
    document.querySelectorAll("[data-test='hint-popover']").forEach((node) => node.remove());
    speakingToken = null;
  }

  // Say the hovered word, but only when it is in the language being learned --
  // there is nothing to hear in an English prompt, and a re-hover of the word
  // already speaking should not stutter it.
  let speakingToken = null;

  function speakToken(token) {
    const word = token.dataset.slyFoxWord;
    const lang = token.dataset.slyFoxLang;
    if (!word || !lang || lang === "en" || lang !== targetLang()) {
      return;
    }
    if (speakingToken === token) {
      return;
    }
    speakingToken = token;
    speak(word, lang, "normal");
  }

  function openHint(token) {
    closeHint();
    const meanings = JSON.parse(token.dataset.slyFoxHint || "[]");
    if (!meanings.length) {
      return;
    }

    const popover = el("div", "_3zpnU _3OfAS _1oRtF", { "data-test": "hint-popover" });
    const body = el("div", "_36bu_ _1ARzg");
    const table = el("table", "_23CeD");
    const head = document.createElement("thead");
    head.append(el("tr", "_1hhBb"));
    const tbody = document.createElement("tbody");
    for (const meaning of meanings) {
      const tr = el("tr", "_1hhBb");
      const td = el("td", "CZWl- _1iIwb", { colspan: "1" });
      td.textContent = meaning;
      tr.append(td);
      tbody.append(tr);
    }
    table.append(head, tbody);
    body.append(table);

    const tailWrap = el("div", "_3T97b");
    tailWrap.append(el("div", "_1TMn5 _2NlnF"));
    popover.append(body, tailWrap);

    // Theirs is portalled to the page root and placed by Popper; same idea,
    // arithmetic instead of the library. Take it out of flow BEFORE measuring:
    // a popover still laid out as a block is as wide as the page, and centring
    // on that width puts it off the left edge.
    popover.style.cssText =
      "margin: 0px; position: absolute; inset: 0px auto auto 0px; z-index: 150;";
    overlayHost().append(popover);

    const box = token.getBoundingClientRect();
    const width = popover.offsetWidth;
    const left = Math.max(8, box.left + box.width / 2 - width / 2 + globalThis.scrollX);
    const top = box.bottom + globalThis.scrollY;
    popover.style.transform =
      `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0px)`;
    tailWrap.style.cssText =
      "margin: 0px; position: absolute; left: 0px; " +
      `transform: translate3d(${Math.round(width / 2 - 7)}px, 0px, 0px) rotate(0deg);`;
  }

  // ----------------------------------------------------------------- tokens --

  // One player per prompt. Lottie keeps a raf loop alive per animation, so the
  // old one is destroyed whenever a challenge is replaced.
  let characterPlayer = null;

  function mountCharacter(mount, index) {
    if (typeof lottie === "undefined") {
      return;
    }
    if (characterPlayer) {
      characterPlayer.destroy();
      characterPlayer = null;
    }
    characterPlayer = lottie.loadAnimation({
      container: mount,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path: ASSET.characters[index % ASSET.characters.length]
    });
  }

  // A lesson file names a badge as a plain string; these are the ones Duolingo
  // shows above a challenge header, with the colour token each uses.
  const BADGES = {
    new: { label: "New word", token: "beetle" },
    hard: { label: "Hard exercise", token: "cardinal" },
    mistake: { label: "Previous mistake", token: "fox" }
  };

  function buildHeader(headerText, badge) {
    const block = el("div", "U41Ye");
    const flagSpec = typeof badge === "string" ? BADGES[badge] : badge;
    if (flagSpec) {
      const flag = el("div", "w2K8w");
      flag.style.color = `rgb(var(--color-${flagSpec.token}))`;
      flag.append(el("span", "_1dTNB"), document.createTextNode(flagSpec.label));
      block.append(flag);
    }
    const heading = el("h1", "_3EOK0", { "data-test": "challenge-header" });
    const span = el("span");
    span.textContent = headerText;
    heading.append(span);
    block.append(heading);
    return block;
  }

  function buildTapToken(word, lang, options = {}) {
    const holder = el("div", "_1uV0Q _DVHp");
    holder.style.cssText =
      "--tap-tokens-token-margin-before: 4px; --tap-tokens-token-margin-after: 4px;";
    const outer = el("span", "_3VyQa");

    // Match tiles are the same token wearing _1YHBP (room for the number) and
    // _3Ymqr (a faster press), and they carry a badge the bank tokens do not.
    const classes = [
      "_3fmUm _2V6ug _1ursp _7jW2t notranslate _3ZtW_ _2O7Ua _3U5_i",
      options.match ? "_1YHBP _3Ymqr" : "_1HvEX"
    ].join(" ");
    const button = el("button", classes, {
      dir: "ltr",
      lang,
      translate: "no",
      "data-test": `${word}-challenge-tap-token`,
      "aria-disabled": "false"
    });
    button.append(el("span", "_12ozk"));
    if (options.badge) {
      const badge = el("span", "_3zbIX _20AkF _2MhQB");
      badge.textContent = options.badge;
      button.append(badge);
    }
    const label = el("span", "_231NG");
    const text = el("span", null, { "data-test": "challenge-tap-token-text" });
    // An audio tile shows a speaker where a word tile shows the word: the text
    // is what you are being asked to work out, so it stays out of the markup
    // rather than being hidden with CSS.
    if (options.audio) {
      button.dataset.slyFoxSpeak = word;
      button.dataset.slyFoxLang = lang;
      button.dataset.slyFoxRate = "normal";
      const glyph = el("span", "u_TP- fs-exclude _1OCYa _15600");
      // Named, because a matched tile has to grey this out and the class it
      // wears is a per-build hash.
      glyph.dataset.slyFoxGlyph = "audio";
      glyph.style.color = "rgb(var(--color-macaw))";
      glyph.append(buildSpeakerIcon(false));
      text.append(glyph);
      text.setAttribute("aria-label", "Play");
    } else {
      text.textContent = word;
    }
    label.append(text);
    if (options.match) {
      label.append(el("span", "_2woU8 _1pS_d"));
    }
    button.append(label);
    outer.append(button);
    holder.append(outer);
    return holder;
  }

  // ------------------------------------------------------------ challenges --

  function buildAssist(spec) {
    const root = el("div", "_1fxa4 _1Mopf", { "data-test": `challenge challenge-${spec.type}` });
    const body = el("div", "_2n5fx _1JTA4 _3B8G- K3vbJ");

    const content = el("div", "_2hpO2 UjFh4 _3rat3");
    const promptRow = el("div", "_1RjNT _3v0hd");
    promptRow.append(buildPrompt(spec.prompt, spec.promptLang, spec.index, {
        hints: spec.hints,
        newWords: spec.newWords
      }));

    const choices = el("div", "PaKCO _1vQbM _3laLR _32LPr");
    spec.choices.forEach((choice, index) => {
      const option = el("div", CHOICE_BASE, {
        role: "radio",
        tabindex: "0",
        "aria-checked": "false",
        "data-test": "challenge-choice"
      });
      option.dataset.slyFoxChoice = String(index);
      const badge = el("span", "_3zbIX _20AkF _3KL75");
      badge.textContent = String(index + 1);
      const text = el("span", "CwCwj _1FXPg", {
        dir: "ltr",
        lang: spec.choiceLang,
        "data-test": "challenge-judge-text"
      });
      text.textContent = choice;
      option.append(badge, text);
      choices.append(option);
    });

    content.append(promptRow, choices);
    body.append(buildHeader(spec.header, spec.badge), content);
    root.append(body);
    return root;
  }

  function buildTranslate(spec) {
    const root = el("div", "_1fxa4 _1Mopf", { "data-test": "challenge challenge-translate" });
    const body = el("div", "_2n5fx _1JTA4 _3B8G- K3vbJ");

    const content = el("div", "iPZZY UjFh4 _3rat3");
    const promptRow = el("div", "_2w0y3 _1dtTU _35mGI");
    promptRow.append(buildPrompt(spec.prompt, spec.promptLang, spec.index, {
        hints: spec.hints,
        newWords: spec.newWords
      }));

    const answerArea = el("div", "u5Wzl _32LPr _3hg-V");
    answerArea.append(spec.typed ? buildTypedAnswer(spec) : buildWordBankArea(spec, true));

    content.append(promptRow, answerArea);
    body.append(buildHeader(spec.header, spec.badge), content);
    root.append(body);
    return root;
  }

  // The text box that replaces the word bank when the toggle is thrown. Theirs
  // is ._ySB6: polar fill, swan border, 19px eel text.
  function buildTypedAnswer(spec) {
    const box = el("textarea", "_ySB6", {
      "data-test": "challenge-translate-input",
      dir: "ltr",
      lang: spec.answerLang,
      placeholder: `Type in ${languageName(spec.answerLang)}`,
      autocorrect: "off",
      autocapitalize: "off",
      spellcheck: "false",
      rows: "4"
    });
    box.value = state.typed;
    return box;
  }

  // The ruled lines and the bank under them. translate wears .fUvcy on the box
  // and listenTap does not -- otherwise the two are the same markup, which is
  // why the word-bank handling downstream needs no idea which it is looking at.
  function buildWordBankArea(spec, framed) {
    const answerInner = el("div", "Sa7Uw");
    const answerBox = el("div", `MvChQ v1KUv${framed ? " fUvcy" : ""}`);

    const lines = el("div", "eWdJ5");
    const linesInner = el("div", "_32DLo");
    const linesRow = el("div", "_1VxfZ", { dir: "ltr" });
    const rules = el("div", "_1arte");
    for (let i = 0; i < 5; i += 1) {
      rules.append(el("div", "_3gJ3o D0fy9"));
    }
    const placed = el("div", "_2-F7v");
    placed.dataset.slyFoxPlaced = "true";
    linesRow.append(rules, placed);
    linesInner.append(linesRow);
    lines.append(linesInner);

    const bankHolder = el("div", "_1v1Bd");
    const bank = el("div", "eSgkc", { "data-test": "word-bank" });
    spec.bank.forEach((word) => bank.append(buildTapToken(word, spec.answerLang)));
    bankHolder.append(bank);

    answerBox.append(lines, bankHolder);
    answerInner.append(answerBox);
    return answerInner;
  }

  // One challenge, two faces. Throwing the toggle only changes how the answer
  // is given, so nothing is regraded and the heading is the only other tell.
  function buildListen(spec) {
    const root = el("div", "_1fxa4 _1Mopf", {
      "data-test": "challenge challenge-listenTap"
    });
    const body = el("div", "_2n5fx _1JTA4 _3B8G- K3vbJ");
    const content = el("div", "_1wDRL _1IiFg f7WE2 _3rat3");

    content.append(buildSpeakerRow(spec));
    content.append(spec.typed ? buildTypedAnswer(spec) : buildWordBankArea(spec, false));

    body.append(
      buildHeader(spec.typed ? "Type what you hear" : "Tap what you hear", spec.badge),
      content
    );
    root.append(body);
    return root;
  }

  // Speak. The structure is the harvested one -- build-assets/duolingo-kit/
  // lesson/speak.tree.txt -- and it needs almost no new markup: the wrapper is
  // the same _1fxa4._1Mopf every challenge uses, and the character-and-bubble
  // row is the same _31yjb / _1tbN5 that buildPrompt already draws. Only the
  // microphone row underneath is new.
  function buildSpeak(spec) {
    const root = el("div", "_1fxa4 _1Mopf", {
      "data-test": "challenge challenge-speak"
    });
    const body = el("div", "_2n5fx _1JTA4 _3B8G- K3vbJ");
    const content = el("div", "XsYNy _3rat3");

    const speaker = el("span", "_3Lwjs");
    const speakerInner = el("span", "_3KG7r _1fdKO");
    speakerInner.append(buildBubbleSpeaker(spec));
    speaker.append(speakerInner);

    const holder = el("div", "QSAmL _3v0hd _35mGI");
    holder.append(
      buildPrompt(spec.prompt, spec.promptLang, spec.index, {
        hints: spec.hints,
        newWords: spec.newWords,
        speaker
      })
    );

    const micRow = el("div", "_3-hYj");
    micRow.append(buildMicButton());

    content.append(holder, micRow);
    body.append(buildHeader(spec.header, spec.badge), content);
    root.append(body);
    return root;
  }

  // Their microphone is a full-width outlined button -- 70px tall, 16px radius,
  // 2px border, transparent fill, macaw text at 15px/700. Those are measured
  // numbers rather than copied rules: the classes their markup carries here are
  // among the four that have no rule in any stylesheet the page loads.
  //
  // The label doubles as the status line. Duolingo lights up the words of the
  // sentence as it hears them, which needs an alignment; we have a transcript,
  // so the honest equivalent is to show what was actually heard.
  // The speaker inside a speak bubble is NOT the big blue one the listening
  // challenges use. Theirs is small and borderless -- .bafGS is transparent
  // with no border and no padding -- sitting on the sentence's own line. Wiring
  // buildSpeakerButton in here instead puts a 100x100 tile inside a 56px
  // bubble, which is exactly as wrong as it sounds.
  function buildBubbleSpeaker(spec) {
    const button = el("button", "_1GJVt _3DAip bafGS _2LoNU VzbUl _1saKQ _1AgKJ", {
      type: "button",
      "data-test": "challenge-speaker",
      "aria-label": "Play"
    });
    button.dataset.slyFoxSpeak = spec.audio;
    button.dataset.slyFoxLang = spec.audioLang || targetLang();
    button.dataset.slyFoxRate = "normal";
    const glyph = el("span", "u_TP- fs-exclude _1OCYa");
    // bafGS paints nothing, so the glyph has to carry its own colour.
    glyph.style.color = "rgb(var(--color-macaw))";
    glyph.append(buildLucideIcon("volume-2", 24));
    button.append(glyph);
    return button;
  }

  function buildMicButton(label) {
    const button = el("button", "_3xDVI _2V6ug _1ursp _7jW2t YvvwP _3U5_i", {
      type: "button",
      "data-test": "challenge-speak-mic"
    });
    button.dataset.slyFoxMic = "idle";
    const glyph = el("span", "_2ZIf_ _9lHjd");
    const icon = el("span", "u_TP- fs-exclude FMPra");
    icon.append(buildLucideIcon("mic", 24));
    glyph.append(icon);
    const text = el("span", "_2Rt1l");
    text.textContent = label || "Tap to speak";
    button.append(glyph, text);
    button.addEventListener("click", onMicClick);
    return button;
  }

  function micLabel(text) {
    const label = document.querySelector("[data-test='challenge-speak-mic'] ._2Rt1l");
    if (label) {
      label.textContent = text;
    }
  }

  function micState(value) {
    const button = document.querySelector("[data-test='challenge-speak-mic']");
    if (button) {
      button.dataset.slyFoxMic = value;
    }
  }

  // One tap starts listening, a second stops it early. A final transcript
  // grades itself the way theirs does, rather than asking for a Check the
  // learner cannot press while they are talking.
  //
  // Note what is NOT here: nothing keys off speechstart. It fires on room noise
  // and is regularly followed by no result at all, so treating it as "they
  // answered" would hang the challenge on a cough.
  // How many goes a speaking exercise gets. Recognition is finnicky enough that
  // all-or-nothing on a whole sentence is unfair -- Duolingo gives three, and
  // words that were heard stay heard between them, so each go only has to fill
  // in what is still dark.
  const SPEAK_ATTEMPTS = 3;
  // A continuous run has no natural end, so an attempt is capped rather than
  // left open on a live microphone.
  const SPEAK_WINDOW_MS = 20000;

  let speakDeadline = null;

  // Every word of the sentence with the character range it occupies.
  // paintSentence draws one glyph span per character, so a range is what it
  // takes to colour a word.
  function speakWordSpans(text) {
    const words = [];
    const pattern = /[\p{L}\p{N}'\u2019]+/gu;
    let found = pattern.exec(String(text || ""));
    while (found) {
      words.push({ text: found[0], from: found.index, to: found.index + found[0].length });
      found = pattern.exec(String(text || ""));
    }
    return words;
  }

  // One spoken word against one written one. Deliberately the same tolerance a
  // typed answer gets -- the flashcard keys and the same typo rule, which
  // refuses to forgive anything under four letters -- only applied per word
  // rather than per sentence. There is still no second notion of "close
  // enough"; there is one, used at a different grain.
  function speakWordMatches(said, written) {
    const a = normalizeAnswerText(said, false);
    const b = normalizeAnswerText(written, false);
    if (!a || !b) {
      return false;
    }
    if (a === b) {
      return true;
    }
    for (const left of LWR.flashcardAnswerKeys(a, false)) {
      for (const right of LWR.flashcardAnswerKeys(b, false)) {
        if (left === right || LWR.flashcardTypoMatch(left, right)) {
          return true;
        }
      }
    }
    return false;
  }

  function paintHeardWords(challenge) {
    const sentence = document.querySelector("[data-sly-fox-hints] ._5HFLU");
    if (!sentence) {
      return;
    }
    const glyphs = sentence.children;
    for (const word of challenge.speakWords || []) {
      if (!state.heardWords.has(word.from)) {
        continue;
      }
      for (let at = word.from; at < word.to && at < glyphs.length; at += 1) {
        glyphs[at].style.color = "rgb(var(--color-macaw))";
      }
    }
  }

  // Take whatever was heard and light up any word it accounts for. Words are
  // matched in sentence order and each one only once, so a repeated word in the
  // transcript cannot light the same slot twice.
  function absorbSpeech(challenge, transcript) {
    const spoken = String(transcript || "").split(/\s+/).filter(Boolean);
    let gained = false;
    for (const said of spoken) {
      for (const word of challenge.speakWords || []) {
        if (state.heardWords.has(word.from)) {
          continue;
        }
        if (speakWordMatches(said, word.text)) {
          state.heardWords.add(word.from);
          gained = true;
          break;
        }
      }
    }
    if (gained) {
      paintHeardWords(challenge);
    }
    return state.heardWords.size >= (challenge.speakWords || []).length;
  }

  function speakWordsLeft(challenge) {
    return (challenge.speakWords || []).length - state.heardWords.size;
  }

  function clearSpeakDeadline() {
    clearTimeout(speakDeadline);
    speakDeadline = null;
  }

  function finishSpeak(challenge, complete) {
    clearSpeakDeadline();
    stopListening();
    micState("idle");
    state.heard = (challenge.speakWords || [])
      .filter((word) => state.heardWords.has(word.from))
      .map((word) => word.text)
      .join(" ");
    micLabel(complete ? "Got it" : state.heard || "Did not catch that");
    // Every word of it was heard, so the sentence was said -- grade it as the
    // sentence rather than as the transcript, which across three goes is a
    // jumble of repeats and has no business being string-matched.
    grade(complete ? challenge.answers[0] : state.heard);
  }

  function endSpeakAttempt(challenge) {
    clearSpeakDeadline();
    micState("idle");
    if (state.heardWords.size >= (challenge.speakWords || []).length) {
      finishSpeak(challenge, true);
      return;
    }
    if (state.speakAttempts >= SPEAK_ATTEMPTS) {
      finishSpeak(challenge, false);
      return;
    }
    const goes = SPEAK_ATTEMPTS - state.speakAttempts;
    const said = String(state.spokenText || "").trim();
    micLabel(`${said || "Did not catch that"} -- ${goes} ${goes === 1 ? "try" : "tries"} left`);
  }

  // One tap starts an attempt, a second ends it early. Words light up as they
  // are heard and stay lit across attempts, so a second go only has to say what
  // is still dark.
  //
  // Note what is NOT here: nothing keys off speechstart, which fires on room
  // noise and is regularly followed by no result at all; and nothing grades on
  // the first `isFinal`, because Chrome emits one for the front of a sentence
  // while the speaker is still going -- that marked a correct reading of
  // "Мій друг працює в офісі" wrong on the strength of "Мій друг працює".
  function onMicClick() {
    const challenge = state.queue[state.position];
    if (!challenge || challenge.type !== "speak" || state.graded) {
      return;
    }
    if (listener) {
      stopListening();
      endSpeakAttempt(challenge);
      return;
    }
    if (state.speakAttempts >= SPEAK_ATTEMPTS) {
      return;
    }

    state.speakAttempts += 1;
    state.spokenText = "";
    micState("listening");
    micLabel("Listening...");
    stopSpeaking();

    clearSpeakDeadline();
    speakDeadline = setTimeout(() => {
      stopListening();
      endSpeakAttempt(challenge);
    }, SPEAK_WINDOW_MS);

    startListening(challenge.answerLang, {
      onInterim: (text) => {
        state.spokenText = text;
        if (absorbSpeech(challenge, text)) {
          finishSpeak(challenge, true);
          return;
        }
        // What was actually heard, not a count of what is missing: the words
        // lighting up already say what is missing, and seeing the transcript is
        // the only way to tell a misheard word from an unheard one.
        micLabel(text || "Listening...");
      },
      onFinal: (text) => {
        state.spokenText = text;
        if (absorbSpeech(challenge, text)) {
          finishSpeak(challenge, true);
          return;
        }
        endSpeakAttempt(challenge);
      },
      onFail: (reason) => {
        clearSpeakDeadline();
        micState("idle");
        if (reason === "not-allowed" || reason === "service-not-allowed") {
          // Without a microphone this challenge cannot be answered at all. Say
          // so and let the footer's skip carry them past it, rather than
          // leaving a button that looks live and does nothing.
          micState("blocked");
          micLabel("No microphone -- use Can't speak now");
          return;
        }
        // Everything else -- no-speech, aborted, a network blip -- is just an
        // attempt that got nowhere, and costs one of the three.
        endSpeakAttempt(challenge);
      },
      onEnd: () => endSpeakAttempt(challenge)
    });
  }


  // Their match is a single grid, not two columns of markup: one container with
  // --match-challenge-rows on it, filled column-first, so the tiles land in two
  // columns on their own.
  function buildMatch(spec) {
    const root = el("div", "_1fxa4 _1Mopf", {
      "data-test": `challenge challenge-${spec.type}`
    });
    const body = el("div", "_2n5fx _1JTA4 _3B8G- K3vbJ");

    const content = el("div", "_3X7QY");
    const grid = el("div", "_1bmNz _3rat3");
    grid.style.setProperty("--match-challenge-rows", String(spec.tiles.length / 2));

    spec.tiles.forEach((tile, index) => {
      const token = buildTapToken(tile.text, tile.lang, {
        match: true,
        audio: Boolean(tile.audio),
        badge: String((index + 1) % 10)
      });
      const button = token.querySelector("button");
      button.dataset.slyFoxMatch = String(tile.pair);
      button.dataset.slyFoxSide = String(tile.side);
      // The grid lays out the _3VyQa wrappers directly; the _1uV0Q spacer the
      // word bank uses would break the row sizing.
      grid.append(token.firstElementChild);
    });

    content.append(grid);
    body.append(buildHeader(spec.header), content);
    root.append(body);
    return root;
  }

  // ----------------------------------------------------------------- shell --

  function buildShell() {
    const page = el("div", "kPqwA _2kkzG");
    const inner = el("div", "_3yE3H");
    const column = el("div", "_2G9ED _29gfw");

    const headerWrap = el("div", "wqSzE");
    const headerInner = el("div", "_3v4ux");
    const headerRow = el("div", "I-Avc _1zcW8");

    const quit = el("button", "_1gEmM _7jW2t _3X5b9", { "data-test": "quit-button" });
    quit.append(el("img", "_3X5b9 _9lHjd", { src: ASSET.quit, alt: "Quit" }));
    quit.addEventListener("click", () => {
      stopSpeaking();
      globalThis.location.href = sectionUrl();
    });

    const bar = el("div", "oCRfA", {
      role: "progressbar",
      "aria-valuemin": "0",
      "aria-valuemax": "1",
      "aria-valuenow": "0"
    });
    bar.id = "sly-fox-progress";
    bar.style.cssText = [
      "--web-ui_progress-bar-color: rgb(var(--color-owl))",
      "--web-ui_progress-bar-shine-height: 3px",
      "--__internal__progress-bar-height: 16px",
      "--__internal__progress-bar-inner-value: 0%",
      "--__internal__progress-bar-value: 0%"
    ].join("; ");
    const track = el("div", "_3yKMC");
    const fill = el("div", "_27NV6");
    fill.style.opacity = "1";
    fill.append(el("div", "_1qzJe _27NV6"), el("div", "_1EFTr"));
    const cap = el("div", "_345XU");
    cap.style.opacity = "1";
    cap.append(el("div", "BR3lm"));
    track.append(fill, cap);
    bar.append(track);

    headerRow.append(quit, bar);
    headerInner.append(headerRow);
    headerWrap.append(headerInner);

    const bodyWrap = el("div", "RMEuZ _1GVfY");
    const bodyInner = el("div", "_3GuWo _1cTBC");
    bodyInner.id = "sly-fox-body";
    const bodySlot = el("div", "_1XNQX");
    bodySlot.id = "sly-fox-challenge";
    bodyInner.append(bodySlot);
    bodyWrap.append(bodyInner);

    const footWrap = el("div", "_3GuWo _1cTBC _1QQhE");
    const footSlot = el("div", "_1XNQX");
    footSlot.id = "sly-fox-footer";
    footWrap.append(footSlot);

    column.append(headerWrap, bodyWrap, footWrap);
    inner.append(column);
    page.append(inner);
    return page;
  }

  function setProgress() {
    const bar = document.getElementById("sly-fox-progress");
    if (!bar) {
      return;
    }
    // Anything still owed counts towards the total, which is why the bar stops
    // short of the end when you have missed something rather than filling and
    // then jumping backwards.
    const total = state.queue.length + state.mistakes.length || 1;
    const percent = Math.round((state.position / total) * 10000) / 100;
    bar.style.setProperty("--__internal__progress-bar-value", `${percent}%`);
    bar.setAttribute("aria-valuenow", String(state.position / total));
    bar.style.setProperty(
      "--web-ui_progress-bar-color",
      STREAK_COLORS.find((entry) => state.streak >= entry.from).color
    );
  }

  function buildFooter({
    mode,
    title,
    detail,
    meaning,
    onAction,
    actionLabel,
    disabled,
    hideSkip,
    skipText,
    toggle,
    wrote,
    wroteWrong,
    wroteMisspelled
  }) {
    // "retry" is ours rather than theirs -- Duolingo has no second chance to
    // copy -- so it borrows the wrong banner's shell and repaints it bee
    // yellow, which is the colour their own "almost" states use.
    const blaming = mode === "correct" || mode === "incorrect" || mode === "retry";
    const shell = el(
      "div",
      mode === "correct"
        ? "_3FB5S _1VTif _3yMvO _2HXQ9"
        : mode === "incorrect" || mode === "retry"
          ? "_3FB5S _1VTif _2cfV0 _2HXQ9"
          : "_3rB4d _1VTif _2HXQ9"
    );
    if (mode === "retry") {
      shell.style.background = "rgb(var(--color-bee-always-dark), 0.12)";
    }
    const row = el("div", "U8jH3 jHbiF");

    if (blaming) {
      const blameWrap = el("div", "AXBVw _2Ycbe _8wIx-");
      const blame = el("div", "_1k6eg", { "data-test": `blame blame-${mode}` });
      const iconHolder = el("div", "_31ixh HJdJI fwpkb");
      // A near miss is not a verdict, so it shows no tick and no cross.
      if (mode !== "retry") {
        iconHolder.append(
          el("img", mode === "correct" ? "_3oCTd" : "_1gpzD", {
            src: mode === "correct" ? ASSET.correct : ASSET.incorrect,
            alt: ""
          })
        );
      }
      const text = el("div", "d6Xhl");
      const textInner = el("div", "_3LKiy");
      const block = el("div", "_1D3fo");
      // WXwlk is tree-frog green, o-3Ru is fire-ant red. Both headings came out
      // of the *wrong* banner the first time, so a right answer was announced
      // in red.
      const tone = mode === "correct" ? "WXwlk" : "o-3Ru";
      const heading = el("h2", `_2U7Gm ${tone}`);
      heading.textContent = title;
      if (mode === "retry") {
        heading.style.color = "rgb(var(--color-bee-always-dark))";
      }
      block.append(heading);
      if (detail) {
        const value = el("div", `_2jz5U ${tone}`, { dir: "ltr" });
        value.textContent = detail;
        if (mode === "retry") {
          value.style.color = "rgb(var(--color-bee-always-dark))";
        }
        block.append(value);
      }
      // A typed answer has no tiles to paint, so it is echoed back here with
      // the offending word in red -- the same information the word bank shows
      // in place.
      if (wrote && wrote.length) {
        const line = el("div", `_2jz5U ${tone}`, { dir: "ltr" });
        const wrong = new Set(wroteWrong || []);
        const misspelled = new Set(wroteMisspelled || []);
        wrote.forEach((word, index) => {
          const part = el("span");
          part.textContent = index ? ` ${word}` : word;
          if (wrong.has(index) || misspelled.has(index)) {
            part.style.color = wrong.has(index)
              ? "rgb(var(--color-cardinal))"
              : "rgb(var(--color-bee-always-dark))";
            part.style.fontWeight = "700";
          } else if (mode === "retry") {
            // Plain eel, not the banner's amber: amber is the spelling mark
            // now, and colouring the words that are RIGHT with it said the
            // whole sentence was misspelt.
            part.style.color = "rgb(var(--color-eel))";
          }
          line.append(part);
        });
        block.append(line);
      }
      // A listening challenge withholds the meaning until it has been answered,
      // then shows it under the solution: as a second heading when you got it
      // wrong, and as one plain line under the praise when you got it right.
      if (meaning) {
        if (mode === "incorrect") {
          const label = el("h2", `_2U7Gm ${tone}`);
          label.textContent = "Meaning:";
          block.append(label);
        }
        const value = el("div", `_2jz5U ${tone}`, { dir: "ltr" });
        value.textContent = mode === "incorrect" ? meaning : `Meaning: ${meaning}`;
        block.append(value);
      }
      textInner.append(block);
      text.append(textInner);
      blame.append(iconHolder, text);
      blameWrap.append(blame);
      row.append(blameWrap);
    } else if (!hideSkip) {
      const skipWrap = el("div", "_3h0lA");
      const skip = el("button", "_2V6ug _1ursp _7jW2t _2x7Co _3fo6Q", { "data-test": "player-skip" });
      const label = el("span", "_9lHjd");
      // On a listening challenge theirs reads "Can't listen now" and skipping
      // is the same give-up it is everywhere else.
      label.textContent = skipText || "Skip";
      skip.append(label);
      skip.addEventListener("click", () => grade(null));
      skipWrap.append(skip);
      row.append(skipWrap);
    }

    // Their keyboard toggle sits between Skip and Check. The footer row is a
    // grid, not a flex line: ._3h0lA takes column 1 and .MYehf column 5, so
    // giving the toggle Skip's class made two things claim column 1 and dropped
    // the toggle onto row 2 -- off the bottom of the viewport. .O5OXx is the
    // centre cell (grid-column 3/4, justify-self center), which is theirs.
    if (toggle) {
      const toggleWrap = el("div", "O5OXx");
      // Skip is an outlined pill (._2V6ug draws that border in its ::before);
      // the toggle is not. Theirs is the same borderless icon-and-label button
      // as REPORT on the blame banner: .bafGS is transparent with no border,
      // ._3qh60 lays the two out in a column-flow grid with a 5px gap, ._2caIK
      // is the 20px icon slot, and ._2Rt1l is the uppercase label.
      const button = el("button", "bafGS _2LoNU VzbUl _1saKQ _1AgKJ _5qxJi", {
        "data-test": "player-toggle-keyboard"
      });
      // Not `row`: that is the footer's own grid row, declared above, and
      // shadowing it here appended the row into itself.
      const inner = el("span", "_3qh60");
      const slot = el("span", "_2caIK");
      slot.append(buildLucideIcon(toggle.icon, "20"));
      const label = el("span", "_2Rt1l");
      label.textContent = toggle.label;
      inner.append(slot, label);
      button.append(inner);
      button.addEventListener("click", toggle.onToggle);
      toggleWrap.append(button);
      row.append(toggleWrap);
    }

    const actionWrap = el("div", "MYehf");
    const action = el(
      "button",
      [
        disabled ? "_2wryV" : "",
        "_1rcV8 _1VYyp _1ursp _7jW2t _3DbUj",
        mode === "incorrect" || mode === "retry" ? "_2VWgj _3S8jJ" : "_38g3s _2oGJR"
      ]
        .filter(Boolean)
        .join(" "),
      { "data-test": "player-next" }
    );
    const actionLabelSpan = el("span", "_9lHjd");
    actionLabelSpan.textContent = actionLabel;
    action.append(actionLabelSpan);
    if (disabled) {
      action.disabled = true;
    } else {
      action.addEventListener("click", onAction);
    }
    actionWrap.append(action);
    row.append(actionWrap);

    shell.append(row);
    return shell;
  }

  function renderFooter(options) {
    const slot = document.getElementById("sly-fox-footer");
    slot.textContent = "";
    slot.append(buildFooter(options));
  }

  // --------------------------------------------------------------- session --

  // A lesson is a list of challenges in one shape, whatever produced it. Two
  // producers exist: a hand- or machine-authored JSON file, and the generator
  // below that deals from the user's own vocabulary. The renderer and the
  // grader only ever see this shape, so a JSON lesson is not a second-class
  // path through the code -- it is the same path.
  //
  // See lessons/README.md for the format.

  // `direction: [uk, en]` is the whole of it: the language the challenge shows
  // you, then the language you answer in. Everything else about which way round
  // a challenge runs follows from those two -- which side the choices are on,
  // which way the header reads, whether the voice speaks target or source, and
  // which direction the practice record is written in. Spelling those out
  // separately meant four fields that could disagree with each other, and one
  // of them (the record) that nobody could check by eye.
  //
  // The long forms still win where a file sets them, so nothing that used them
  // has to be rewritten to keep working.
  function directionOf(raw) {
    const pair = Array.isArray(raw.direction)
      ? raw.direction
      : String(raw.direction || "").split(/[\s,>-]+/);
    return {
      shown: String(pair[0] || "").trim(),
      answered: String(pair[1] || "").trim()
    };
  }

  // Which way a practice record goes is not a separate decision from which way
  // the challenge goes: answering in English is recognising the word, answering
  // in the target language is producing it. So `word: вікно` is the whole
  // record, and the direction comes from the challenge it sits in.
  function recordFor(raw, answeredLang, fallbackWord) {
    if (raw.record) {
      return raw.record;
    }
    const wordKey = String(raw.word || fallbackWord || "").trim();
    if (!wordKey) {
      return null;
    }
    return { wordKey, direction: answeredLang === "en" ? "tg2en" : "en2tg" };
  }

  function normalizeChallenge(raw, index) {
    const challenge = { ...raw, index };
    challenge.type = String(raw.type || "").trim();
    const direction = directionOf(raw);
    // Keep the authored form. Re-queueing a mistake normalises it again rather
    // than re-showing the object, so the bank and the choices come back in a
    // different order the second time -- which is what theirs does.
    challenge.source = raw;

    if (challenge.type === "match" || challenge.type === "listenMatch") {
      const answeredLang = raw.sourceLang || direction.answered || "en";
      const pairs = (raw.pairs || []).map((pair, at) => ({
        target: String(pair.target || ""),
        source: String(pair.source || ""),
        // Carried through, which it was not before: completeMatch reads
        // pair.record, and building the pairs without it meant every match in
        // every lesson scored nothing. A `direction` on the challenge lets each
        // pair default to recording its own target.
        record: recordFor(pair, answeredLang, direction.shown ? pair.target : ""),
        pair: at
      }));
      challenge.pairs = pairs;
      challenge.header = raw.header || "Select the matching pairs";
      // listenMatch is match with the left column played rather than printed.
      const audio = challenge.type === "listenMatch";
      // Which language the tiles speak in. Without this the voice check below
      // has nothing to look up and drops every listenMatch on any machine that
      // does have voices installed -- which is most of them.
      challenge.audioLang = raw.targetLang || direction.shown || targetLang();
      const left = shuffle(pairs).map((entry) => ({
        text: entry.target,
        lang: raw.targetLang || direction.shown || targetLang(),
        pair: entry.pair,
        side: 0,
        audio
      }));
      const right = shuffle(pairs).map((entry) => ({
        text: entry.source,
        lang: raw.sourceLang || direction.answered || "en",
        pair: entry.pair,
        side: 1
      }));
      challenge.tiles = [...left, ...right];
      return challenge;
    }

    // Everything else is prompt-and-answer. `answers` is the accepted set;
    // `answer` is the one shown as the solution.
    challenge.answers = (raw.answers && raw.answers.length ? raw.answers : [raw.answer])
      .filter(Boolean)
      .map(String);
    challenge.answer = String(raw.answer || challenge.answers[0] || "");
    challenge.hints = raw.hints || {};
    challenge.promptLang = raw.promptLang || direction.shown || targetLang();
    // Words the learner is meeting for the first time, which render purple.
    // A lesson may name them outright; otherwise a "new" badge means the whole
    // prompt is the new word, which is what the generated lessons produce.
    challenge.newWords = (
      raw.newWords || (raw.badge === "new" && raw.prompt ? [raw.prompt] : [])
    ).map((word) => String(word).toLocaleLowerCase());
    // Naming a new word is enough; the header flag follows from it. Authoring
    // both was how a whole unit ended up with underlined new words and no
    // purple anywhere -- the words were hinted but never declared new.
    if (challenge.newWords.length && !challenge.badge) {
      challenge.badge = "new";
    }

    // Both sentence-construction types can be answered either way; the toggle
    // is sticky for the session, and a lesson opens on the word bank.
    challenge.canType = BUILD_TYPES.includes(challenge.type);
    // When the shared typing feature is on it injects its own input and hides
    // the bank behind its eye toggle, so the player must not draw a box of its
    // own as well: two inputs would disagree about what the answer is.
    challenge.typed =
      challenge.canType && state.preferTyping === true && !LWR.state.duolingoTypeAnswers;

    if (LISTEN_TYPES.includes(challenge.type)) {
      // What is spoken is the answer itself -- you are being asked to write
      // down what you heard -- so the prompt is never shown before grading.
      challenge.answerLang = raw.answerLang || direction.answered || targetLang();
      challenge.audio = String(raw.audio || challenge.answer);
      challenge.audioLang = raw.audioLang || direction.shown || challenge.answerLang;
      challenge.meaning = String(raw.meaning || raw.prompt || "");
      challenge.header = raw.header || "Tap what you hear";
      challenge.record = recordFor(raw, challenge.answerLang);
      const words = challenge.audio.split(/\s+/).filter(Boolean);
      challenge.bank = raw.bank
        ? raw.shuffle === false
          ? raw.bank.slice()
          : shuffle(raw.bank)
        : shuffle(words);
      return challenge;
    }

    if (challenge.type === "speak") {
      // You are shown a sentence and asked to say it, so the language answered
      // in is the one it is written in -- not the "answer in English" default
      // the sentence types take. That also makes gradeAnswer normalise the
      // transcript as target-language text, which is what folds Ukrainian's
      // y/B and i/й together.
      challenge.answerLang =
        raw.answerLang || direction.answered || direction.shown || targetLang();
      challenge.audio = String(raw.audio || raw.prompt || challenge.answer);
      challenge.audioLang = raw.audioLang || direction.shown || challenge.answerLang;
      challenge.header = raw.header || "Speak this sentence";
      challenge.record = recordFor(raw, challenge.answerLang);
      // The words that have to light up, with where they sit in the sentence.
      challenge.speakWords = speakWordSpans(challenge.prompt);
      return challenge;
    }

    if (CHOICE_TYPES.includes(challenge.type)) {
      challenge.header =
        raw.header ||
        (challenge.type === "gapFill" ? "Fill in the blank" : "Select the correct meaning");
      challenge.choiceLang = raw.choiceLang || direction.answered || "en";
      challenge.choices = raw.shuffle === false ? raw.choices.slice() : shuffle(raw.choices);
      challenge.answerIndex = challenge.choices.indexOf(challenge.answer);
      challenge.record = recordFor(raw, challenge.choiceLang);
    } else {
      challenge.answerLang = raw.answerLang || direction.answered || "en";
      challenge.header = raw.header || `Write this in ${languageName(challenge.answerLang)}`;
      challenge.bank = raw.shuffle === false ? raw.bank.slice() : shuffle(raw.bank);
      challenge.record = recordFor(raw, challenge.answerLang);
    }
    return challenge;
  }

  function normalizeLesson(raw, options = {}) {
    const legendary = Boolean(options.legendary);
    const challenges = (raw.challenges || [])
      .map((challenge, index) => normalizeChallenge(challenge, index))
      .filter((challenge) => CHALLENGE_TYPES.includes(challenge.type))
      // A listening challenge with no voice for the language is unanswerable,
      // so it is dropped rather than shown as a button that does nothing.
      .filter(
        (challenge) => !LISTEN_TYPES.includes(challenge.type) || canSpeak(challenge.audioLang)
      )
      // The same rule for speaking: no recogniser, no way to answer it.
      .filter((challenge) => challenge.type !== "speak" || canHear())
      .map((challenge) => {
        if (!legendary) {
          return challenge;
        }
        // Legendary takes the hints away. That is the whole difference: no
        // dotted underlines, so nothing to hover for the meaning.
        return { ...challenge, hints: {}, newWords: [], badge: null };
      });
    return {
      title: raw.title || "",
      xp: Number(raw.xp) || (legendary ? LEGENDARY_XP : XP_PER_LESSON),
      legendary,
      challenges
    };
  }

  function distractors(deck, card, direction, count) {
    const pool = shuffle(deck.filter((other) => other.wordKey !== card.wordKey));
    const seen = new Set();
    const out = [];
    for (const other of pool) {
      const text = direction === "tg2en" ? other.meanings[0] : other.word;
      if (!text || seen.has(text)) {
        continue;
      }
      seen.add(text);
      out.push(text);
      if (out.length >= count) {
        break;
      }
    }
    return out;
  }

  function targetLang() {
    return LWR.getCurrentLanguageCode() || "uk";
  }

  function languageName(code) {
    const wanted = code || targetLang();
    if (wanted === "en") {
      return "English";
    }
    return (LWR.LANGUAGE_NAMES || {})[wanted] || "your language";
  }

  // The vocabulary producer: deal a session from the practice deck and emit it
  // in exactly the JSON shape above. `record` is what ties an answer back to a
  // practice record; a hand-authored lesson can carry one too, or leave it out.
  function buildLessonFromDeck(deck) {
    const cards = LWR.pickFlashcardSessionCards(deck, SESSION_SIZE);
    const listening = canSpeak(targetLang());
    const challenges = cards.map((card, index) => {
      // Every third card is dealt as a listening challenge when the browser
      // has a voice for the language: the word is spoken, not shown.
      if (listening && index % 3 === 2) {
        const noise = distractors(deck, card, "en2tg", 5)
          .flatMap((text) => text.split(/\s+/))
          .filter(Boolean);
        const words = card.word.split(/\s+/).filter(Boolean);
        return {
          type: "listenTap",
          audio: card.word,
          audioLang: targetLang(),
          answerLang: targetLang(),
          answer: card.word,
          answers: card.alternates,
          meaning: card.meanings[0],
          bank: [...new Set([...words, ...noise])].slice(0, Math.max(6, words.length + 4)),
          badge: LWR.flashcardWordStrength(card.wordKey) === null ? "new" : null,
          record: { direction: "en2tg", wordKey: card.wordKey }
        };
      }

      const direction = index % 2 === 0 ? "tg2en" : "en2tg";
      const english = direction === "tg2en";
      const prompt = english ? card.word : card.meanings[0];
      const answer = english ? card.meanings[0] : card.word;
      const answers = english ? card.meanings : card.alternates;
      const hints = { [prompt.toLocaleLowerCase()]: english ? card.meanings : card.alternates };
      const badge = LWR.flashcardWordStrength(card.wordKey) === null ? "new" : null;
      const record = { direction, wordKey: card.wordKey };

      if (index % 2 === 0) {
        return {
          type: "assist",
          prompt,
          promptLang: targetLang(),
          choiceLang: "en",
          choices: [answer, ...distractors(deck, card, direction, 2)],
          answer,
          answers,
          hints,
          badge,
          record
        };
      }

      const noise = distractors(deck, card, direction, 5)
        .flatMap((text) => text.split(/\s+/))
        .filter(Boolean);
      const words = answer.split(/\s+/).filter(Boolean);
      return {
        type: "translate",
        header: `Write this in ${languageName()}`,
        prompt,
        promptLang: "en",
        answerLang: targetLang(),
        bank: [...new Set([...words, ...noise])].slice(0, Math.max(6, words.length + 4)),
        answer,
        answers,
        hints,
        badge,
        record
      };
    });

    // A matching drill recognises; it does not teach. Its pairs may only be
    // words the learner has already met earlier in this same session, so it is
    // dealt from the cards whose own challenge sits before it -- otherwise the
    // drill is the first sight of a word, five at a time, with no gloss.
    const pairsFrom = (upto) =>
      shuffle(cards.slice(0, upto))
        .slice(0, MATCH_PAIRS)
        .map((card) => ({
          target: card.word,
          source: card.meanings[0],
          record: { direction: "tg2en", wordKey: card.wordKey }
        }));

    // Where the drills go, counted in cards already played. Placing them by
    // index into `challenges` would be wrong once a splice has shifted things.
    const matchAt = Math.min(MATCH_AT, challenges.length);
    if (matchAt >= MATCH_PAIRS) {
      challenges.splice(matchAt, 0, { type: "match", pairs: pairsFrom(matchAt) });
      // The audio version of the same drill, dealt later so the two are not
      // back to back. Everything before the end has been seen by then.
      // `cards.length - 1` words are available to it, so it needs one more card
      // than the match does or it would come out a pair short.
      if (listening && cards.length > MATCH_PAIRS) {
        challenges.splice(challenges.length - 1, 0, {
          type: "listenMatch",
          targetLang: targetLang(),
          pairs: pairsFrom(cards.length - 1)
        });
      }
    }

    return normalizeLesson({ challenges, xp: XP_PER_LESSON });
  }

  // Differences a learner cannot see on the page, normalised away before
  // anything is compared.
  //
  // These are not alternative answers -- they are the same answer written the
  // way people actually write it: with or without the comma Ukrainian wants
  // before "а", "isn't" for "is not", "в" for "у" (Ukrainian picks between
  // those two for how they sound next to their neighbours, never for meaning,
  // and the same goes for і/й). Listing every combination of them in every
  // lesson file would be hundreds of lines restating four rules, so they live
  // here once and every lesson gets them.
  const CONTRACTIONS = [
    [/\bisn't\b/g, "is not"],
    [/\baren't\b/g, "are not"],
    [/\bdon't\b/g, "do not"],
    [/\bdoesn't\b/g, "does not"],
    [/\bdidn't\b/g, "did not"],
    [/\bit's\b/g, "it is"],
    [/\bthat's\b/g, "that is"],
    [/\bthere's\b/g, "there is"],
    [/\bwhere's\b/g, "where is"],
    [/\bwho's\b/g, "who is"],
    [/\bwhat's\b/g, "what is"],
    [/\bi'm\b/g, "i am"],
    [/\byou're\b/g, "you are"],
    [/\bwe're\b/g, "we are"],
    [/\bthey're\b/g, "they are"]
  ];

  function normalizeAnswerText(text, english) {
    let value = String(text || "")
      .replace(/[\u2019\u02bc]/g, "'")
      .normalize("NFC")
      .toLocaleLowerCase()
      .replace(/[.,!?;:\u2026"\u00ab\u00bb\u201e\u201c\u201d]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (english) {
      for (const [pattern, replacement] of CONTRACTIONS) {
        value = value.replace(pattern, replacement);
      }
    } else {
      value = value.replace(/(^|\s)\u0432(?=\s|$)/g, "$1\u0443");
      value = value.replace(/(^|\s)\u0439(?=\s|$)/g, "$1\u0456");
    }

    return value.replace(/\s+/g, " ").trim();
  }

  function answerWords(text, english) {
    return normalizeAnswerText(text, english).split(" ").filter(Boolean);
  }

  function characterDistance(a, b, limit) {
    if (a === b) {
      return 0;
    }
    if (Math.abs(a.length - b.length) > limit) {
      return limit + 1;
    }

    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      for (let j = 1; j <= b.length; j += 1) {
        current[j] = Math.min(
          previous[j] + 1,
          current[j - 1] + 1,
          previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
      previous = current;
    }
    return previous[b.length];
  }

  // Two words near enough that the learner clearly reached for the right one
  // and mistyped it. Short words are excluded: чай and чаї are a letter apart
  // and are different words, and so are the and they.
  function wordsAreClose(a, b) {
    if (a === b) {
      return true;
    }
    const longest = Math.max(a.length, b.length);
    if (longest < 4) {
      return false;
    }
    return characterDistance(a, b, 2) <= Math.max(1, Math.floor(longest / 3));
  }

  // Word-level edit distance with a backtrace, so a near miss can say WHICH
  // word is wrong rather than only that something is. A substituted or extra
  // word has a position in what was given, which is what gets marked on the
  // page; a missing word has no position there, so it is counted instead.
  //
  // A mistyped word costs nothing. Spelling is not the thing these challenges
  // are asking about, and charging for it meant one slip plus one real mistake
  // read the same as two real mistakes and lost the second chance entirely.
  // It is still reported, so it can be pointed at in a different colour.
  function diffWords(given, target) {
    const cost = [];
    for (let i = 0; i <= given.length; i += 1) {
      cost.push(new Array(target.length + 1).fill(0));
      cost[i][0] = i;
    }
    for (let j = 0; j <= target.length; j += 1) {
      cost[0][j] = j;
    }
    const swapCost = (i, j) => (wordsAreClose(given[i - 1], target[j - 1]) ? 0 : 1);

    for (let i = 1; i <= given.length; i += 1) {
      for (let j = 1; j <= target.length; j += 1) {
        cost[i][j] = Math.min(
          cost[i - 1][j] + 1,
          cost[i][j - 1] + 1,
          cost[i - 1][j - 1] + swapCost(i, j)
        );
      }
    }

    const wrong = [];
    const misspelled = [];
    let missing = 0;
    let i = given.length;
    let j = target.length;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && cost[i][j] === cost[i - 1][j - 1] + swapCost(i, j)) {
        if (given[i - 1] !== target[j - 1]) {
          (swapCost(i, j) ? wrong : misspelled).push(i - 1);
        }
        i -= 1;
        j -= 1;
      } else if (i > 0 && cost[i][j] === cost[i - 1][j] + 1) {
        wrong.push(i - 1);
        i -= 1;
      } else {
        missing += 1;
        j -= 1;
      }
    }

    return {
      distance: cost[given.length][target.length],
      wrong: wrong.reverse(),
      misspelled: misspelled.reverse(),
      missing,
      // How much slack this answer gets. A three-word answer that is two words
      // out is a different answer; a twelve-word one is a sentence with two
      // slips in it, and holding both to "exactly one word" punishes the long
      // sentences this unit exists to teach.
      allowance: Math.max(1, Math.round(target.length / 5))
    };
  }

  // Measured against whichever accepted answer they came closest to, so being
  // one word off an alternate counts as being one word off.
  function nearestAnswer(challenge, value) {
    const english = (challenge.answerLang || "en") === "en";
    const given = answerWords(value, english);
    let best = null;
    for (const answer of challenge.answers) {
      const diff = diffWords(given, answerWords(answer, english));
      if (!best || diff.distance < best.distance) {
        best = diff;
      }
    }
    return best || { distance: Infinity, wrong: [], misspelled: [], missing: 0, allowance: 1 };
  }

  // Grading works off the challenge's own accepted answers, so a JSON lesson
  // with no vocabulary behind it is marked exactly like a generated one.
  function gradeAnswer(challenge, value) {
    if (value === null || value === undefined) {
      return "wrong";
    }
    const english = (challenge.answerLang || "en") === "en";
    const accepted = new Set();
    for (const answer of challenge.answers) {
      for (const key of LWR.flashcardAnswerKeys(normalizeAnswerText(answer, english), english)) {
        accepted.add(key);
      }
    }
    const inputKeys = [...LWR.flashcardAnswerKeys(normalizeAnswerText(value, english), english)];
    if (inputKeys.some((key) => accepted.has(key))) {
      return "correct";
    }
    for (const inputKey of inputKeys) {
      for (const answerKey of accepted) {
        if (LWR.flashcardTypoMatch(inputKey, answerKey)) {
          return "typo";
        }
      }
    }
    return "wrong";
  }

  // ---------------------------------------------------------------- render --

  function renderChallenge() {
    const slot = document.getElementById("sly-fox-challenge");
    slot.textContent = "";
    slot.classList.remove("_3V6my");
    document.getElementById("sly-fox-body").classList.remove("_29ngr");
    closeHint();

    state.selection = null;
    state.picked = [];
    state.matchChoice = null;
    state.matched = 0;
    state.graded = false;
    state.retryUsed = false;
    state.heard = "";
    state.heardWords = new Set();
    state.speakAttempts = 0;
    state.spokenText = "";
    clearSpeakDeadline();
    state.shownAt = Date.now();
    stopSpeaking();
    stopListening();

    const challenge = state.queue[state.position];
    if (!challenge) {
      renderComplete();
      return;
    }

    // The keyboard toggle re-renders the same challenge, so the typed answer
    // has to survive that but not survive moving on to the next one.
    if (!challenge.keepTyped) {
      state.typed = "";
    }
    challenge.keepTyped = false;

    if (CHOICE_TYPES.includes(challenge.type)) {
      slot.append(buildAssist(challenge));
    } else if (challenge.type === "translate") {
      slot.append(buildTranslate(challenge));
    } else if (challenge.type === "listenTap") {
      slot.append(buildListen(challenge));
    } else if (challenge.type === "speak") {
      slot.append(buildSpeak(challenge));
    } else {
      slot.append(buildMatch(challenge));
    }

    slot.querySelectorAll("[data-sly-fox-hints]").forEach(placeHintOverlays);
    setProgress();
    refreshFooter();

    // Theirs plays the prompt the moment the challenge lands.
    if (LISTEN_TYPES.includes(challenge.type) && challenge.type !== "listenMatch") {
      speak(challenge.audio, challenge.audioLang, "normal");
      if (challenge.typed) {
        const box = slot.querySelector("[data-test='challenge-translate-input']");
        if (box) {
          box.focus();
        }
      }
    }
  }

  // What the footer looks like before an answer is checked. Listening
  // challenges swap Skip's wording and add the keyboard toggle beside it.
  function nearMissDetail(diff) {
    const parts = [];
    if (diff.wrong.length) {
      parts.push(diff.wrong.length === 1 ? "one word in red is wrong" : "the words in red are wrong");
    }
    if (diff.misspelled.length) {
      parts.push(
        diff.misspelled.length === 1 ? "one in amber is spelt wrong" : "the ones in amber are spelt wrong"
      );
    }
    if (diff.missing) {
      parts.push(diff.missing === 1 ? "a word is missing" : `${diff.missing} words are missing`);
    }
    if (!parts.length) {
      return "Something is not quite right.";
    }

    const sentence =
      parts.length === 1
        ? parts[0]
        : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
    return `${sentence.charAt(0).toLocaleUpperCase()}${sentence.slice(1)}.`;
  }

  // Back to answering after a near miss. The answer stays exactly as it was --
  // the point is to change the one marked word, not to build the sentence
  // again -- so only the footer goes back to Check.
  function resumeAfterNearMiss() {
    const challenge = state.queue[state.position];
    if (challenge && challenge.typed) {
      const input = document.querySelector("[data-test='challenge-translate-input']");
      if (input) {
        input.focus();
      }
    }
    refreshFooter();
  }

  function refreshFooter() {
    const challenge = state.queue[state.position];
    if (!challenge) {
      return;
    }
    const listening = LISTEN_TYPES.includes(challenge.type);

    renderFooter({
      mode: "idle",
      actionLabel: "Check",
      disabled: !hasAnswer(challenge),
      // Legendary is meant to be earned, so there is no way to skip past one.
      // Everything else keeps Skip, listening especially: "Can't listen now" is
      // the whole point of it.
      hideSkip: state.legendary,
      skipText: listening
        ? "Can't listen now"
        : challenge.type === "speak"
          ? "Can't speak now"
          : "Skip",
      toggle: challenge.canType && !LWR.state.duolingoTypeAnswers
        ? {
            label: challenge.typed ? "Use word bank" : "Use keyboard",
            icon: challenge.typed ? "layout-grid" : "keyboard",
            onToggle: () => {
              state.preferTyping = !challenge.typed;
              challenge.typed = state.preferTyping;
              challenge.keepTyped = true;
              renderChallenge();
            }
          }
        : null,
      onAction: () => grade(currentAnswer())
    });
  }

  function hasAnswer(challenge) {
    if (CHOICE_TYPES.includes(challenge.type)) {
      return state.selection !== null;
    }
    if (challenge.type === "speak") {
      return String(state.heard || "").trim().length > 0;
    }
    if (challenge.typed) {
      return state.typed.trim().length > 0;
    }
    return state.picked.length > 0;
  }

  function refreshCheckButton() {
    refreshFooter();
  }

  function currentAnswer() {
    const challenge = state.queue[state.position];
    if (CHOICE_TYPES.includes(challenge.type)) {
      return state.selection === null ? null : challenge.choices[state.selection];
    }
    if (challenge.type === "speak") {
      return state.heard || null;
    }
    if (challenge.typed) {
      return state.typed;
    }
    return state.picked.join(" ");
  }

  // Red on the words that are actually wrong, so a miss says where it went
  // wrong rather than only that it did. Word-bank answers carry their own
  // tiles and get marked in place; a typed answer has no tiles, so the words
  // are echoed under the banner instead (see buildFooter's `wrote`).
  function markWrongWords(indices, misspelledIndices) {
    const placed = document.querySelector("[data-sly-fox-placed]");
    if (!placed) {
      return;
    }

    const wrong = new Set(indices);
    const misspelled = new Set(misspelledIndices || []);
    [...placed.children].forEach((holder, index) => {
      const button = holder.querySelector("button");
      if (!button) {
        return;
      }
      if (wrong.has(index) || misspelled.has(index)) {
        const colour = wrong.has(index)
          ? "rgb(var(--color-cardinal))"
          : "rgb(var(--color-bee-always-dark))";
        button.style.setProperty("--web-ui_button-color", colour);
        button.style.setProperty("--web-ui_button-border-color", colour);
        button.style.setProperty("--__internal__switchable__border-color", colour);
        button.dataset.slyFoxWrongWord = wrong.has(index) ? "true" : "spelling";
      } else {
        button.style.removeProperty("--web-ui_button-color");
        button.style.removeProperty("--web-ui_button-border-color");
        button.style.removeProperty("--__internal__switchable__border-color");
        delete button.dataset.slyFoxWrongWord;
      }
    });
  }

  function resolveChoices(correctIndex, pickedIndex) {
    document.querySelectorAll("[data-sly-fox-choice]").forEach((node) => {
      const index = Number(node.dataset.slyFoxChoice);
      node.classList.add(...CHOICE_RESOLVED);
      if (index === correctIndex) {
        node.classList.add(CHOICE_CORRECT);
      } else if (index === pickedIndex) {
        node.classList.add(CHOICE_WRONG);
      }
    });
  }

  function grade(answer) {
    if (state.graded) {
      return;
    }
    const challenge = state.queue[state.position];

    // Match is a set of pairs rather than one answer, so skipping it just moves
    // on. Without this, Skip reached for a single card that does not exist and
    // the button looked dead.
    if (challenge.type === "match" || challenge.type === "listenMatch") {
      state.graded = true;
      state.answered += 1;
      state.streak = 0;
      noteMistake(challenge);
      setProgress();
      renderFooter({
        mode: "incorrect",
        title: "Skipped",
        detail: challenge.pairs.map((pair) => `${pair.target} — ${pair.source}`).join(", "),
        actionLabel: "Continue",
        onAction: advance
      });
      return;
    }

    state.graded = true;
    closeHint();
    const recallMs = Date.now() - state.shownAt;
    let correct = false;
    let solution = challenge.answer;

    if (CHOICE_TYPES.includes(challenge.type)) {
      correct = answer !== null && state.selection === challenge.answerIndex;
      resolveChoices(challenge.answerIndex, state.selection);
      if (challenge.type === "gapFill") {
        // Show the sentence as it should have read, whichever way it went.
        fillGap(challenge.answers[0]);
      }
    } else {
      const verdict = gradeAnswer(challenge, answer);
      correct = verdict === "correct" || verdict === "typo";
      solution = challenge.answers.join(" / ");

      // One word out is a slip, not a wrong answer -- so it buys a second look
      // at your own sentence with the offending word marked, once per showing.
      // Nothing is recorded and no mistake is noted: as far as the lesson is
      // concerned this attempt did not happen.
      if (!correct && !state.retryUsed && answer !== null) {
        const diff = nearestAnswer(challenge, answer);
        if (diff.distance <= diff.allowance) {
          state.retryUsed = true;
          state.graded = false;
          markWrongWords(diff.wrong, diff.misspelled);
          const onlySpelling = !diff.wrong.length && !diff.missing;
          renderFooter({
            mode: "retry",
            title: onlySpelling ? "Almost -- check the spelling" : "Almost -- nearly there",
            // Say every kind of problem there is, not just the first. A missing
            // word cannot be pointed at -- there is nothing on the line to
            // colour -- so if it is not named here it is never mentioned at
            // all, and the answer comes back marked wrong for something the
            // learner was never shown.
            detail: nearMissDetail(diff),
            wrote: challenge.typed ? answerWords(answer, (challenge.answerLang || "en") === "en") : null,
            wroteWrong: diff.wrong,
            wroteMisspelled: diff.misspelled,
            actionLabel: "Try again",
            onAction: resumeAfterNearMiss
          });
          return;
        }
      }
    }

    recordResult(challenge.record, correct, recallMs);

    state.answered += 1;
    if (correct) {
      state.correctCount += 1;
      state.streak += 1;
      // Putting right something you got wrong earlier is what their completion
      // slide counts, so it is counted here rather than derived later.
      if (challenge.retry) {
        state.corrected += 1;
      }
    } else {
      state.streak = 0;
      noteMistake(challenge);
    }
    setProgress();

    if (!correct && answer !== null && !CHOICE_TYPES.includes(challenge.type)) {
      const diff = nearestAnswer(challenge, answer);
      markWrongWords(diff.wrong, diff.misspelled);
    }

    renderFooter({
      mode: correct ? "correct" : "incorrect",
      title: correct ? PRAISE[state.answered % PRAISE.length] : "Correct solution:",
      detail: correct ? "" : solution,
      // The meaning of a spoken sentence is the reward for having heard it, so
      // it appears either way once the answer is in.
      meaning: LISTEN_TYPES.includes(challenge.type) ? challenge.meaning : "",
      actionLabel: "Continue",
      onAction: advance
    });
  }

  // A missed challenge is owed another showing. Duplicates are kept out by
  // source object rather than by index: the same challenge can be missed twice,
  // and it should still only be waiting once at any moment.
  function noteMistake(challenge) {
    if (!state.mistakes.includes(challenge.source)) {
      state.mistakes.push(challenge.source);
    }
  }

  // A challenge only touches the practice records if it names one. Generated
  // lessons always do; a hand-authored one may, and does not have to.
  function recordResult(record, correct, recallMs) {
    if (!record || !record.wordKey) {
      return;
    }
    LWR.updateFlashcardRecord(record.direction || "tg2en", record.wordKey, correct, recallMs);
  }

  function completeMatch() {
    const challenge = state.queue[state.position];
    const recallMs = Date.now() - state.shownAt;
    for (const pair of challenge.pairs) {
      recordResult(pair.record, true, recallMs / Math.max(1, challenge.pairs.length));
    }
    state.answered += 1;
    state.correctCount += 1;
    state.streak += 1;
    state.graded = true;
    if (challenge.retry) {
      state.corrected += 1;
    }
    setProgress();
    renderFooter({
      mode: "correct",
      title: PRAISE[state.answered % PRAISE.length],
      detail: "",
      actionLabel: "Continue",
      onAction: advance
    });
  }

  function advance() {
    state.position += 1;
    if (state.position < state.queue.length) {
      renderChallenge();
      return;
    }
    // The run is not over while anything is still owed. Duo comes up to say so
    // the first time, then the missed challenges are appended and played again.
    // Missing one during the review just brings it round again -- being told
    // twice that you are reviewing your mistakes is not news.
    if (state.mistakes.length) {
      if (state.reviewAnnounced) {
        enqueueMistakes();
        renderChallenge();
        return;
      }
      state.reviewAnnounced = true;
      renderMistakeReview();
      return;
    }
    renderComplete();
  }

  function renderMistakeReview() {
    stopSpeaking();
    setProgress();
    showNotice("Let's review the exercises you missed!");
    renderFooter({
      mode: "idle",
      actionLabel: "Continue",
      hideSkip: true,
      onAction: () => {
        enqueueMistakes();
        renderChallenge();
      }
    });
  }

  // Re-normalising rather than re-showing is deliberate: the word bank and the
  // choices come back shuffled differently, so a second attempt cannot be
  // answered from muscle memory of where the tokens sat.
  function enqueueMistakes() {
    const owed = state.mistakes.slice();
    state.mistakes = [];
    for (const source of owed) {
      const retry = normalizeChallenge(source, state.queue.length);
      // Re-normalising works off the authored challenge, which still has its
      // hints on it -- so a legendary run has to strip them again here or the
      // second showing would quietly hand back what the first withheld.
      if (state.legendary) {
        retry.hints = {};
      }
      // A word you have already been shown is not new any more, whatever the
      // authored badge said -- the purple treatment would otherwise sit under
      // an orange PREVIOUS MISTAKE flag, claiming both at once.
      retry.newWords = [];
      retry.badge = "mistake";
      retry.retry = true;
      state.queue.push(retry);
    }
    // advance() already stepped position past the old end, which is exactly
    // where the first of these has landed.
  }

  // Their end-of-lesson slide: an illustration, a headline, and two stat cards
  // with a coloured band across the top of each.
  function buildStatCard(bandClass, bodyClass, label, iconClass, iconSrc, value) {
    const card = el("div", "_23WOw");
    card.append(el("div", bandClass));
    const heading = el("div", "d8ITn");
    heading.textContent = label;
    const body = el("div", bodyClass);
    body.append(el("img", iconClass, { src: iconSrc, alt: "" }));
    const number = el("div", "_1gnTn");
    number.style.flexDirection = "row";
    number.textContent = value;
    body.append(number);
    card.append(heading, body);
    return card;
  }

  // Bank the lesson against the puck it was started from, so the path shows it.
  function recordLessonComplete() {
    const params = new URLSearchParams(globalThis.location.search);
    const node = params.get("node");
    if (node === null) {
      return;
    }
    const slug = params.get("unit") || "";
    chrome.storage.local.get({ [SECTION_STORAGE_KEY]: null }, (stored) => {
      const saved = stored[SECTION_STORAGE_KEY] || { version: 2, units: {} };
      const units = { ...(saved.units || {}) };
      // A pre-unit save kept its counts at the top level; carry them over to
      // whichever unit the learner is in rather than dropping them.
      const existing = units[slug] || (saved.nodes ? { nodes: saved.nodes } : { nodes: {} });
      const nodes = { ...(existing.nodes || {}) };
      nodes[node] = (Number(nodes[node]) || 0) + 1;
      units[slug] = { nodes };
      chrome.storage.local.set({ [SECTION_STORAGE_KEY]: { version: 2, units } });
    });
  }

  function renderComplete() {
    recordLessonComplete();
    const slot = document.getElementById("sly-fox-challenge");
    slot.textContent = "";
    slot.classList.remove("_3V6my");
    document.getElementById("sly-fox-body").classList.remove("_29ngr");
    closeHint();

    const accuracy = state.answered
      ? Math.round((state.correctCount / state.answered) * 100)
      : 0;
    const perfect = accuracy === 100;

    const slide = el("div", "_3SXFk");

    const art = el("div", null, { "data-test": "session-complete-slide" });
    const character = el("div");
    character.style.cssText = "width: 220px; height: 220px; margin: 0 auto;";
    art.append(character);
    mountCharacter(character, perfect ? 1 : 0);

    const text = el("div", "_3dwfW");
    const title = el("div", "_3z6AH");
    // "Hide the evidence!" is what theirs says when you got there but left a
    // trail of corrections behind you.
    title.textContent = perfect
      ? "Perfect lesson!"
      : state.corrected
        ? "Hide the evidence!"
        : "Lesson complete!";
    const subtitle = el("div", "_2EXpj");
    subtitle.textContent = perfect
      ? "You made no mistakes in this lesson"
      : state.corrected
        ? `You corrected ${state.corrected} mistake${state.corrected === 1 ? "" : "s"} in this lesson`
        : `You answered ${state.correctCount} of ${state.answered} correctly`;
    text.append(title, subtitle);

    const stats = el("div", "_21KAg");
    const xp = (state.lesson && state.lesson.xp) || XP_PER_LESSON;
    stats.append(
      buildStatCard("_3IRrf", "_5KPRI", "Total XP", "_35hcT _3DJ9E", ASSET.xp, String(xp)),
      buildStatCard(
        "_52uc9",
        "uiOhM",
        accuracy >= 90 ? "Amazing" : accuracy >= 70 ? "Good!" : "Keep going",
        "_1F1Qc",
        ASSET.accuracy,
        `${accuracy}%`
      )
    );

    slide.append(art, text, stats);
    slot.append(slide);

    setProgress();
    renderFooter({
      mode: "idle",
      actionLabel: "Continue",
      hideSkip: true,
      onAction: () => {
        globalThis.location.href = sectionUrl();
      }
    });
  }

  // ---------------------------------------------------------------- events --

  function wireEvents() {
    installDragging();

    // The number on a tile is not decoration: pressing it picks that tile.
    // Duolingo has always worked this way, and the badges were being drawn
    // without the handler behind them -- a number on screen that does nothing
    // is a promise the player does not keep.
    //
    // The badge is READ off the element rather than recomputed from its
    // position, so the key that works is always the number actually printed.
    // Match badges run 1-9 and then 0 for the tenth tile, which is exactly the
    // sort of off-by-one that arithmetic here would get wrong.
    document.addEventListener("keydown", (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey || !/^[0-9]$/.test(event.key)) {
        return;
      }
      // Typing mode owns the keyboard. A digit typed into the answer box
      // belongs in the sentence, not to a tile sitting behind it.
      const target = event.target;
      if (
        target &&
        (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)
      ) {
        return;
      }
      const challenge = state.queue[state.position];
      if (!challenge || state.graded) {
        return;
      }

      const numbered =
        challenge.type === "match" || challenge.type === "listenMatch"
          ? "[data-sly-fox-match]"
          : CHOICE_TYPES.includes(challenge.type)
            ? "[data-sly-fox-choice]"
            : null;
      if (!numbered) {
        return;
      }

      const pick = [...document.querySelectorAll(numbered)].find((node) => {
        if (node.getAttribute("aria-disabled") === "true" || node.offsetParent === null) {
          return false;
        }
        const badge = node.querySelector("._3zbIX");
        return Boolean(badge) && badge.textContent.trim() === event.key;
      });
      if (!pick) {
        return;
      }
      event.preventDefault();
      // Through the click path, so a keyed tile behaves exactly as a tapped
      // one: the audio, the paint and the pairing all hang off that handler.
      pick.click();
    });

    // A speaker is live whether or not the challenge has been graded -- hearing
    // it again after getting it wrong is the point.
    document.addEventListener("click", (event) => {
      const speaker = event.target.closest("[data-sly-fox-speak]");
      if (speaker) {
        speak(
          speaker.dataset.slyFoxSpeak,
          speaker.dataset.slyFoxLang,
          speaker.dataset.slyFoxRate
        );
      }
    });

    document.addEventListener("input", (event) => {
      if (event.target.matches("[data-test='challenge-translate-input']")) {
        state.typed = event.target.value;
        refreshCheckButton();
      }
    });

    document.addEventListener("click", (event) => {
      const challenge = state.queue[state.position];
      if (!challenge || state.graded) {
        return;
      }

      const choice = event.target.closest("[data-sly-fox-choice]");
      if (choice) {
        document.querySelectorAll("[data-sly-fox-choice]").forEach((node) => {
          node.setAttribute("aria-checked", "false");
          node.classList.remove(CHOICE_CHECKED);
        });
        choice.setAttribute("aria-checked", "true");
        choice.classList.add(CHOICE_CHECKED);
        state.selection = Number(choice.dataset.slyFoxChoice);
        // On a gapFill the point is to read the finished sentence, so the word
        // goes into the blank as soon as it is picked.
        fillGap(challenge.choices[state.selection]);
        refreshCheckButton();
        return;
      }

      const match = event.target.closest("[data-sly-fox-match]");
      if (match) {
        handleMatchTap(match);
        return;
      }

      const token = event.target.closest("[data-test$='-challenge-tap-token']");
      if (token && (challenge.type === "translate" || challenge.type === "listenTap")) {
        handleTokenTap(token);
      }
    });

    // Hints are hover-first, with focus as the keyboard equivalent. Hovering
    // also says the word: on their site a hinted word is spoken as well as
    // glossed, which is half of what makes the hint worth hovering.
    document.addEventListener("mouseover", (event) => {
      const token = event.target.closest("[data-test='hint-token']");
      if (token) {
        openHint(token);
        speakToken(token);
      }
    });
    document.addEventListener("mouseout", (event) => {
      const token = event.target.closest("[data-test='hint-token']");
      if (token && !token.contains(event.relatedTarget)) {
        closeHint();
      }
    });
    document.addEventListener("focusin", (event) => {
      const token = event.target.closest("[data-test='hint-token']");
      if (token) {
        openHint(token);
        speakToken(token);
      }
    });
    globalThis.addEventListener("scroll", closeHint, { passive: true });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeHint();
        return;
      }
      if (event.key === "Enter") {
        // Enter checks the answer, including from inside the text box -- theirs
        // submits rather than taking a newline.
        const action = document.querySelector("[data-test='player-next']:not([disabled])");
        if (action) {
          event.preventDefault();
          action.click();
        } else if (event.target.matches("[data-test='challenge-translate-input']")) {
          event.preventDefault();
        }
      }
    });
  }

  // Slide the token from where it was to where it lands. Duolingo animates the
  // move rather than teleporting it; this is the same effect via the Web
  // Animations API, so no CSS of ours is involved.
  function flyToken(node, from) {
    const to = node.getBoundingClientRect();
    const dx = from.left - to.left;
    const dy = from.top - to.top;
    if (!dx && !dy) {
      return;
    }
    node.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "translate(0, 0)" }],
      { duration: 180, easing: "cubic-bezier(0.2, 0.6, 0.3, 1)" }
    );
  }

  // The line itself is the answer. Keeping a parallel array of the words and
  // editing it alongside the DOM meant the two could disagree, and they did:
  // removing a word searched the array by its TEXT, so taking the second "the"
  // off the line deleted the first one from the answer. Nothing looked wrong --
  // the line read correctly and graded as something else. Read the words off
  // the line after every change instead, and they cannot drift.
  function syncPickedFromLine() {
    const placed = document.querySelector("[data-sly-fox-placed]");
    state.picked = placed
      ? [...placed.children].map((holder) => {
          const text = holder.querySelector("[data-test='challenge-tap-token-text']");
          return text ? text.textContent : "";
        })
      : [];
    refreshCheckButton();
  }

  function handleTokenTap(token) {
    const holder = token.closest("._1uV0Q");
    const placed = document.querySelector("[data-sly-fox-placed]");
    const bank = document.querySelector("[data-test='word-bank']");
    const word = token.querySelector("[data-test='challenge-tap-token-text']").textContent;
    const from = holder.getBoundingClientRect();

    // A tap on a token already on the line sends it home; a tap in the bank
    // sends it up. One handler for both -- the previous version put a listener
    // on the placed copy as well, so a returned token got handled twice and
    // stayed on the line.
    if (holder.dataset.slyFoxFrom) {
      const origin = bank.children[Number(holder.dataset.slyFoxFrom)];
      holder.remove();
      origin.style.visibility = "";
      origin.querySelector("button").setAttribute("aria-disabled", "false");
      flyToken(origin, from);
      syncPickedFromLine();
      return;
    }

    if (token.getAttribute("aria-disabled") === "true") {
      return;
    }
    const index = [...bank.children].indexOf(holder);
    token.setAttribute("aria-disabled", "true");
    // The bank keeps the gap so the remaining tokens never reflow under the
    // cursor.
    holder.style.visibility = "hidden";

    const copy = buildTapToken(word, token.getAttribute("lang"));
    copy.dataset.slyFoxFrom = String(index);
    // Dragging a placed word needs the pointer, not the page's scroll gesture.
    copy.style.touchAction = "none";
    placed.append(copy);
    flyToken(copy, from);
    syncPickedFromLine();
  }

  // --- Dragging a word to a different place on the line ---
  //
  // Tapping a word off the line and tapping it back on only ever appends, so
  // one wrong word early meant taking apart everything after it. A word can be
  // picked up and dropped where it belongs instead.
  //
  // The tile follows the pointer by measuring where it actually sits on each
  // move rather than accumulating a delta: it is being re-inserted into the
  // line as the pointer passes its neighbours, so its layout position keeps
  // changing underneath, and an accumulated offset would drift away from the
  // cursor with every reorder.
  const DRAG_THRESHOLD = 6;

  function placedHolderFrom(target) {
    const holder = target && target.closest ? target.closest("._1uV0Q") : null;
    return holder && holder.dataset.slyFoxFrom !== undefined && holder.parentElement
      && holder.parentElement.hasAttribute("data-sly-fox-placed")
      ? holder
      : null;
  }

  function dropTargetFor(line, dragged, x, y) {
    let best = null;
    let bestDistance = Infinity;
    for (const item of line.children) {
      if (item === dragged) {
        continue;
      }
      const rect = item.getBoundingClientRect();
      const centreX = rect.left + rect.width / 2;
      const centreY = rect.top + rect.height / 2;
      // Rows matter more than columns: the line wraps, and the nearest tile by
      // straight-line distance can be the one above.
      const distance = Math.abs(y - centreY) * 4 + Math.abs(x - centreX);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { item, after: x > centreX };
      }
    }
    return best;
  }

  function moveDraggedTo(event) {
    const drag = state.drag;
    drag.holder.style.transform = "";
    const rect = drag.holder.getBoundingClientRect();
    drag.holder.style.transform =
      `translate(${event.clientX - (rect.left + rect.width / 2)}px, ` +
      `${event.clientY - (rect.top + rect.height / 2)}px)`;

    const target = dropTargetFor(drag.line, drag.holder, event.clientX, event.clientY);
    if (target) {
      drag.line.insertBefore(
        drag.holder,
        target.after ? target.item.nextSibling : target.item
      );
    }
  }

  function endDrag() {
    const drag = state.drag;
    if (!drag) {
      return;
    }
    state.drag = null;
    drag.holder.style.transform = "";
    drag.holder.style.zIndex = "";
    drag.holder.style.opacity = "";
    if (drag.moved) {
      state.dragged = true;
      syncPickedFromLine();
    }
  }

  function installDragging() {
    document.addEventListener("pointerdown", (event) => {
      // Any new press starts a new interaction, so a drag's leftover
      // "swallow the click" flag dies here. Without this the flag outlives its
      // drag whenever the drag ends without a click -- a pointerup off the
      // tile, or any touch -- and eats the next thing pressed, which in
      // practice was the CHECK button.
      state.dragged = false;
      if (state.graded || event.button > 0) {
        return;
      }
      const holder = placedHolderFrom(event.target);
      if (!holder) {
        return;
      }
      state.drag = {
        holder,
        line: holder.parentElement,
        startX: event.clientX,
        startY: event.clientY,
        moved: false
      };
    });

    document.addEventListener("pointermove", (event) => {
      const drag = state.drag;
      if (!drag) {
        return;
      }
      if (!drag.moved) {
        const far =
          Math.abs(event.clientX - drag.startX) > DRAG_THRESHOLD ||
          Math.abs(event.clientY - drag.startY) > DRAG_THRESHOLD;
        if (!far) {
          return;
        }
        drag.moved = true;
        drag.holder.style.zIndex = "20";
        drag.holder.style.opacity = "0.9";
        drag.holder.setPointerCapture?.(event.pointerId);
      }
      event.preventDefault();
      moveDraggedTo(event);
    });

    document.addEventListener("pointerup", endDrag);
    document.addEventListener("pointercancel", endDrag);

    // A drag ends with a click on the tile it started from. Without this the
    // word is dropped where it belongs and then immediately sent back to the
    // bank by the tap handler.
    document.addEventListener(
      "click",
      (event) => {
        if (state.dragged) {
          state.dragged = false;
          event.preventDefault();
          event.stopPropagation();
        }
      },
      true
    );
  }

  function handleMatchTap(button) {
    if (button.getAttribute("aria-disabled") === "true") {
      return;
    }
    const pair = button.dataset.slyFoxMatch;
    const side = button.dataset.slyFoxSide;

    // A tap token's picked and finished looks are not classes we can borrow:
    // _3fmUm (which every token carries) is named only inside :not() in their
    // stylesheet, so the disabled rules deliberately skip these buttons and
    // React drives the colour some other way. What the colours *are* is not in
    // doubt -- measured off a live tile: picked is whale text on a blue-jay
    // border, finished is swan on swan. Set them through their own button
    // variables, including the one their ::before border actually reads.
    const paint = (node, colour, border) => {
      node.style.setProperty("--web-ui_button-color", colour);
      node.style.setProperty("--web-ui_button-border-color", border);
      node.style.setProperty("--__internal__switchable__border-color", border);
    };
    const light = (node, on) => {
      if (on) {
        paint(node, "rgb(var(--color-whale))", "rgb(var(--color-blue-jay))");
        node.setAttribute("aria-checked", "true");
      } else {
        paint(node, "", "");
        node.removeAttribute("aria-checked");
      }
    };
    const settle = (node) => {
      // Drop the wrong-answer flash first: a tile can be settled while an
      // earlier miss is still animating, and the two colours blend.
      node.classList.remove(CHOICE_WRONG);
      paint(node, "rgb(var(--color-swan))", "rgb(var(--color-swan))");
      // A word tile greys out because its text inherits the button colour. An
      // audio tile has no text -- it has a speaker glyph carrying its own
      // inline colour, which beats the variable -- so on a listenMatch the
      // spoken half stayed bright blue while its partner faded.
      const glyph = node.querySelector("[data-sly-fox-glyph='audio']");
      if (glyph) {
        glyph.style.color = "rgb(var(--color-swan))";
      }
      node.setAttribute("aria-disabled", "true");
      node.removeAttribute("aria-checked");
    };

    if (!state.matchChoice) {
      light(button, true);
      state.matchChoice = { pair, side, button };
      return;
    }

    const previous = state.matchChoice;
    state.matchChoice = null;
    light(previous.button, false);

    // Tapping the lit tile puts it back down rather than re-lighting it.
    if (previous.button === button) {
      return;
    }

    // Two from the same column is changing your mind, not a guess.
    if (previous.side === side) {
      light(button, true);
      state.matchChoice = { pair, side, button };
      return;
    }

    if (previous.pair === pair) {
      [previous.button, button].forEach(settle);
      state.matched += 1;
      if (state.matched >= state.queue[state.position].pairs.length) {
        completeMatch();
      }
      return;
    }

    [previous.button, button].forEach((node) => {
      node.classList.add(CHOICE_WRONG);
      setTimeout(() => node.classList.remove(CHOICE_WRONG), 1500);
    });
  }

  // ------------------------------------------------------------------ boot --

  function showNotice(message) {
    const slot = document.getElementById("sly-fox-challenge");
    slot.textContent = "";
    slot.classList.add("_3V6my");
    document.getElementById("sly-fox-body").classList.add("_29ngr");

    const wrap = el("div", "_2GMvD En_6d _2OFAQ");
    const characterWrap = el("div", "_1UGd5 _1JaQ9", { "data-test": "session-duo" });
    const character = el("div");
    character.style.cssText = "width: 175px; height: 175px;";
    characterWrap.append(character);
    mountCharacter(character, 0);

    const holder = el("div");
    const bubble = el("div", "_3zpnU D0iFS _3SQBJ _1-QWt");
    const body = el("div", "_36bu_ _2GMvD _2ka0w _1K3po");
    body.textContent = message;
    const tail = el("div", "_3T97b");
    tail.append(el("div", "_1TMn5"));
    bubble.append(body, tail);
    holder.append(bubble);

    wrap.append(characterWrap, holder);
    slot.append(wrap);
  }

  // Back to the path, at the puck this lesson was started from. The section
  // stacks every unit into one scroll, so a bare section.html lands at the top
  // of the first unit -- a long way from where the learner just was, and
  // further with every unit added.
  //
  // `at` and not `unit`: section.html already reads `unit` as "show only this
  // one", which would hide the rest of the path on the way back. This one only
  // says where to scroll to.
  function sectionUrl() {
    const params = new URLSearchParams(globalThis.location.search);
    const slug = params.get("unit");
    const node = params.get("node");
    const back = new URLSearchParams();
    if (slug) {
      back.set("at", slug);
    }
    if (node !== null) {
      back.set("node", node);
    }
    const query = back.toString();
    return query ? `section.html?${query}` : "section.html";
  }

  function backToSection() {
    globalThis.location.href = sectionUrl();
  }

  function refuse(message) {
    showNotice(message);
    renderFooter({ mode: "idle", actionLabel: "Back", hideSkip: true, onAction: backToSection });
  }

  // Reading a lesson or unit file off disk. They are YAML, parsed by the
  // vendored js-yaml. On chrome-extension:// a missing file rejects the fetch
  // outright rather than answering 404, so both have to mean the same thing.
  async function loadYaml(url) {
    const response = await fetch(url).catch(() => null);
    if (!response || !response.ok) {
      return null;
    }
    return jsyaml.load(await response.text());
  }

  // Where a lesson comes from. `?lesson=<name>` loads lessons/<name>.yaml;
  // without it the words the user has learned are dealt into one. Both arrive
  // as the same object, so nothing downstream knows or cares which it was.
  async function loadLesson() {
    const params = new URLSearchParams(globalThis.location.search);

    // A unit file holds every lesson in it, so ?unit=x&puck=n&lesson=m picks
    // one out. This is the path the section page uses.
    const unitSlug = params.get("unit");
    if (unitSlug) {
      if (!/^[a-z0-9-]+$/i.test(unitSlug)) {
        throw new Error(`"${unitSlug}" is not a valid unit name.`);
      }
      const unit = await loadYaml(`units/${unitSlug}.yaml`);
      if (!unit) {
        throw new Error(`No unit file called ${unitSlug}.yaml.`);
      }
      const pucks = (unit.pucks || []).filter((puck) => puck.kind !== "chest");
      const puck = pucks[Number(params.get("puck")) || 0];
      if (!puck || !Array.isArray(puck.lessons) || !puck.lessons.length) {
        throw new Error(`That puck has no lessons in ${unitSlug}.yaml.`);
      }
      // Legendary is the whole puck at once: every lesson in it shuffled
      // together and stripped of hints. It is not a lesson in the file, so it
      // is assembled here rather than looked up.
      if (params.get("legendary") === "1") {
        const pool = puck.lessons.flatMap((entry) => entry.challenges || []);
        const legendary = normalizeLesson(
          { challenges: shuffle(pool).slice(0, LEGENDARY_SIZE), xp: LEGENDARY_XP },
          { legendary: true }
        );
        if (!legendary.challenges.length) {
          throw new Error(`That puck has nothing to make a legendary run from.`);
        }
        legendary.title = puck.label || unit.title || "";
        return legendary;
      }

      const at = Math.min(Math.max(0, Number(params.get("lesson")) || 0), puck.lessons.length - 1);
      const lesson = normalizeLesson(puck.lessons[at]);
      if (!lesson.challenges.length) {
        throw new Error(`Lesson ${at + 1} of that puck has no usable challenges.`);
      }
      lesson.title = lesson.title || puck.label || unit.title || "";
      return lesson;
    }

    const name = params.get("lesson");
    if (name) {
      if (!/^[a-z0-9-]+$/i.test(name)) {
        throw new Error(`"${name}" is not a valid lesson name.`);
      }
      const file = await loadYaml(`lessons/${name}.yaml`);
      if (!file) {
        throw new Error(`No lesson file called ${name}.yaml.`);
      }
      const lesson = normalizeLesson(file);
      if (!lesson.challenges.length) {
        throw new Error(`${name}.yaml has no usable challenges in it.`);
      }
      return lesson;
    }

    state.deck = LWR.buildFlashcardDeck();
    if (state.deck.length < 4) {
      throw new Error(
        "There are not enough words yet. Import your Duolingo words from the Words page first."
      );
    }
    return buildLessonFromDeck(state.deck);
  }

  function start() {
    document.getElementById("sly-fox-lesson").append(buildShell());
    wireEvents();

    // The voice list is populated asynchronously and is empty on a cold start,
    // so ask for it now and again when it arrives. Nothing waits on this: a
    // lesson dealt before the list lands simply keeps its listening challenges.
    refreshVoices();
    if (globalThis.speechSynthesis) {
      globalThis.speechSynthesis.addEventListener("voiceschanged", refreshVoices, { once: true });
    }
    globalThis.addEventListener("pagehide", stopSpeaking);

    loadLesson().then(
      (lesson) => {
        state.lesson = lesson;
        state.legendary = Boolean(lesson.legendary);
        state.queue = lesson.challenges;
        renderChallenge();
      },
      (error) => refuse(error.message)
    );
  }

  function boot() {
    chrome.storage.local.get(
      {
        [LWR.STORAGE_KEY]: LWR.DEFAULT_STATE,
        [LWR.FLASHCARDS_STORAGE_KEY]: LWR.DEFAULT_FLASHCARDS_STATE
      },
      (stored) => {
        LWR.state = LWR.normalizeState(stored[LWR.STORAGE_KEY]);
        LWR.flashcardsState = LWR.normalizeFlashcardsState(stored[LWR.FLASHCARDS_STORAGE_KEY]);
        syncSharedLessonFeatures();
        start();
      }
    );
  }

  // The in-lesson features -- the typing input and its hint ladder, the bank
  // eye-toggle, the misspelled decoys, the copy-phrase button -- are the
  // duolingo/ modules, shared verbatim. They find their own hooks in the markup
  // this player emits, so there is no second implementation of any of them.
  //
  // boot.js does this wiring on duolingo.com, but boot.js also starts the
  // translator, the cloak and the page-UI injections, none of which has any
  // business running on our own page. So this calls the same syncs and nothing
  // else.
  function syncSharedLessonFeatures() {
    LWR.syncDuolingoTypeAnswers();
    LWR.syncDuolingoCopyPhrase();
    LWR.syncDuolingoBankTraps();
  }

  // Toggling one of those settings elsewhere -- the settings panel lives on
  // duolingo.com -- has to reach a lesson that is already open.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes[LWR.STORAGE_KEY]) {
      return;
    }
    LWR.state = LWR.normalizeState(changes[LWR.STORAGE_KEY].newValue);
    syncSharedLessonFeatures();
    // The keyboard toggle comes and goes with the typing setting.
    refreshFooter();
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
