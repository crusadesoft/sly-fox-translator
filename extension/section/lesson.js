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
// Three challenge types, all of which the user walked through on the real site:
//
//   assist     "Select the correct meaning" -- prompt plus three choices.
//   translate  "Write this in English/Ukrainian" -- prompt plus a word bank.
//   match      "Select the matching pairs" -- five pairs, no Check button.
//
// listenTap is deliberately absent: it needs recorded audio for each prompt and
// we have none, so it would be a guess dressed up as a clone.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;

  const SECTION_STORAGE_KEY = "learnedWordReplacerSection";
  const SESSION_SIZE = 10;
  const MATCH_PAIRS = 5;
  const MATCH_AT = 3;
  const XP_PER_LESSON = 10;

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
    matchChoice: null,
    matched: 0,
    graded: false,
    deck: [],
    lesson: null
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

  function buildPrompt(text, lang, characterIndex, hints) {
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
    for (const glyphText of text) {
      const glyph = el("span", "_2IGwo XxgPa", { "aria-hidden": "true" });
      glyph.style.background = "none";
      glyph.textContent = glyphText;
      sentence.append(glyph);
    }
    const wrapper = el("span");
    wrapper.append(sentence);
    line.append(wrapper);
    bubbleInner.append(line, buildBubbleTail());
    bubble.append(bubbleInner);

    row.append(characterHolder, bubble);
    row.dataset.slyFoxHints = JSON.stringify(hints || {});
    return row;
  }

  // Lay a hint overlay over every word that has something to say. Runs after
  // the prompt is in the document, because it needs real geometry.
  function placeHintOverlays(row) {
    const hints = JSON.parse(row.dataset.slyFoxHints || "{}");
    const sentence = row.querySelector("._5HFLU");
    if (!sentence || !Object.keys(hints).length) {
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
      const meanings = hints[word.slice(lead, word.length - trail).toLocaleLowerCase()];
      if (!meanings || !letters.length) {
        continue;
      }

      const first = letters[0].getBoundingClientRect();
      const last = letters[letters.length - 1].getBoundingClientRect();
      const overlay = el("div", "tFegI _2IGwo XxgPa _33wyM", {
        tabindex: "0",
        "data-test": "hint-token",
        "aria-label": word
      });
      overlay.dataset.slyFoxHint = JSON.stringify(meanings);
      overlay.style.cssText =
        `height: ${first.height}px; left: ${first.left - anchor.left}px; ` +
        `top: ${first.top - anchor.top}px; width: ${last.right - first.left}px;`;
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
    text.textContent = word;
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
    const root = el("div", "_1fxa4 _1Mopf", { "data-test": "challenge challenge-assist" });
    const body = el("div", "_2n5fx _1JTA4 _3B8G- K3vbJ");

    const content = el("div", "_2hpO2 UjFh4 _3rat3");
    const promptRow = el("div", "_1RjNT _3v0hd");
    promptRow.append(buildPrompt(spec.prompt, spec.promptLang, spec.index, spec.hints));

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
    promptRow.append(buildPrompt(spec.prompt, spec.promptLang, spec.index, spec.hints));

    const answerArea = el("div", "u5Wzl _32LPr _3hg-V");
    const answerInner = el("div", "Sa7Uw");
    const answerBox = el("div", "MvChQ v1KUv fUvcy");

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
    answerArea.append(answerInner);

    content.append(promptRow, answerArea);
    body.append(buildHeader(spec.header, spec.badge), content);
    root.append(body);
    return root;
  }

  // Their match is a single grid, not two columns of markup: one container with
  // --match-challenge-rows on it, filled column-first, so the tiles land in two
  // columns on their own.
  function buildMatch(spec) {
    const root = el("div", "_1fxa4 _1Mopf", { "data-test": "challenge challenge-match" });
    const body = el("div", "_2n5fx _1JTA4 _3B8G- K3vbJ");

    const content = el("div", "_3X7QY");
    const grid = el("div", "_1bmNz _3rat3");
    grid.style.setProperty("--match-challenge-rows", String(spec.tiles.length / 2));

    spec.tiles.forEach((tile, index) => {
      const token = buildTapToken(tile.text, tile.lang, {
        match: true,
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
      globalThis.location.href = "section.html";
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
    const total = state.queue.length || 1;
    const percent = Math.round((state.position / total) * 10000) / 100;
    bar.style.setProperty("--__internal__progress-bar-value", `${percent}%`);
    bar.setAttribute("aria-valuenow", String(state.position / total));
    bar.style.setProperty(
      "--web-ui_progress-bar-color",
      STREAK_COLORS.find((entry) => state.streak >= entry.from).color
    );
  }

  function buildFooter({ mode, title, detail, onAction, actionLabel, disabled, hideSkip }) {
    const shell = el(
      "div",
      mode === "correct"
        ? "_3FB5S _1VTif _3yMvO _2HXQ9"
        : mode === "incorrect"
          ? "_3FB5S _1VTif _2cfV0 _2HXQ9"
          : "_3rB4d _1VTif _2HXQ9"
    );
    const row = el("div", "U8jH3 jHbiF");

    if (mode === "correct" || mode === "incorrect") {
      const blameWrap = el("div", "AXBVw _2Ycbe _8wIx-");
      const blame = el("div", "_1k6eg", { "data-test": `blame blame-${mode}` });
      const iconHolder = el("div", "_31ixh HJdJI fwpkb");
      iconHolder.append(
        el("img", mode === "correct" ? "_3oCTd" : "_1gpzD", {
          src: mode === "correct" ? ASSET.correct : ASSET.incorrect,
          alt: ""
        })
      );
      const text = el("div", "d6Xhl");
      const textInner = el("div", "_3LKiy");
      const block = el("div", "_1D3fo");
      // WXwlk is tree-frog green, o-3Ru is fire-ant red. Both headings came out
      // of the *wrong* banner the first time, so a right answer was announced
      // in red.
      const heading = el("h2", `_2U7Gm ${mode === "correct" ? "WXwlk" : "o-3Ru"}`);
      heading.textContent = title;
      block.append(heading);
      if (detail) {
        const value = el("div", "_2jz5U o-3Ru", { dir: "ltr" });
        value.textContent = detail;
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
      const skipLabel = el("span", "_9lHjd");
      skipLabel.textContent = "Skip";
      skip.append(skipLabel);
      skip.addEventListener("click", () => grade(null));
      skipWrap.append(skip);
      row.append(skipWrap);
    }

    const actionWrap = el("div", "MYehf");
    const action = el(
      "button",
      [
        disabled ? "_2wryV" : "",
        "_1rcV8 _1VYyp _1ursp _7jW2t _3DbUj",
        mode === "incorrect" ? "_2VWgj _3S8jJ" : "_38g3s _2oGJR"
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

  function normalizeChallenge(raw, index) {
    const challenge = { ...raw, index };
    challenge.type = String(raw.type || "").trim();
    if (challenge.type === "match") {
      const pairs = (raw.pairs || []).map((pair, at) => ({
        target: String(pair.target || ""),
        source: String(pair.source || ""),
        pair: at
      }));
      challenge.pairs = pairs;
      challenge.header = raw.header || "Select the matching pairs";
      const left = shuffle(pairs).map((entry) => ({
        text: entry.target,
        lang: raw.targetLang || targetLang(),
        pair: entry.pair,
        side: 0
      }));
      const right = shuffle(pairs).map((entry) => ({
        text: entry.source,
        lang: raw.sourceLang || "en",
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
    challenge.promptLang = raw.promptLang || targetLang();

    if (challenge.type === "assist") {
      challenge.header = raw.header || "Select the correct meaning";
      challenge.choiceLang = raw.choiceLang || "en";
      challenge.choices = raw.shuffle === false ? raw.choices.slice() : shuffle(raw.choices);
      challenge.answerIndex = challenge.choices.indexOf(challenge.answer);
    } else {
      challenge.header = raw.header || "Write this in English";
      challenge.answerLang = raw.answerLang || "en";
      challenge.bank = raw.shuffle === false ? raw.bank.slice() : shuffle(raw.bank);
    }
    return challenge;
  }

  function normalizeLesson(raw) {
    const challenges = (raw.challenges || [])
      .map((challenge, index) => normalizeChallenge(challenge, index))
      .filter((challenge) => ["assist", "translate", "match"].includes(challenge.type));
    return {
      title: raw.title || "",
      xp: Number(raw.xp) || XP_PER_LESSON,
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

  function languageName() {
    return (LWR.LANGUAGE_NAMES || {})[targetLang()] || "your language";
  }

  // The vocabulary producer: deal a session from the practice deck and emit it
  // in exactly the JSON shape above. `record` is what ties an answer back to a
  // practice record; a hand-authored lesson can carry one too, or leave it out.
  function buildLessonFromDeck(deck) {
    const cards = LWR.pickFlashcardSessionCards(deck, SESSION_SIZE);
    const challenges = cards.map((card, index) => {
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

    if (cards.length >= MATCH_PAIRS) {
      challenges.splice(Math.min(MATCH_AT, challenges.length), 0, {
        type: "match",
        pairs: shuffle(cards)
          .slice(0, MATCH_PAIRS)
          .map((card) => ({
            target: card.word,
            source: card.meanings[0],
            record: { direction: "tg2en", wordKey: card.wordKey }
          }))
      });
    }

    return normalizeLesson({ challenges, xp: XP_PER_LESSON });
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
      for (const key of LWR.flashcardAnswerKeys(answer, english)) {
        accepted.add(key);
      }
    }
    const inputKeys = [...LWR.flashcardAnswerKeys(value, english)];
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
    state.shownAt = Date.now();

    const challenge = state.queue[state.position];
    if (!challenge) {
      renderComplete();
      return;
    }

    if (challenge.type === "assist") {
      slot.append(buildAssist(challenge));
    } else if (challenge.type === "translate") {
      slot.append(buildTranslate(challenge));
    } else {
      slot.append(buildMatch(challenge));
    }

    slot.querySelectorAll("[data-sly-fox-hints]").forEach(placeHintOverlays);
    setProgress();
    renderFooter({ mode: "idle", actionLabel: "Check", disabled: true });
  }

  function refreshCheckButton() {
    const challenge = state.queue[state.position];
    const ready =
      challenge.type === "assist" ? state.selection !== null : state.picked.length > 0;
    renderFooter({
      mode: "idle",
      actionLabel: "Check",
      disabled: !ready,
      onAction: () => grade(currentAnswer())
    });
  }

  function currentAnswer() {
    const challenge = state.queue[state.position];
    if (challenge.type === "assist") {
      return state.selection === null ? null : challenge.choices[state.selection];
    }
    return state.picked.join(" ");
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
    if (challenge.type === "match") {
      state.graded = true;
      state.answered += 1;
      state.streak = 0;
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

    if (challenge.type === "assist") {
      correct = answer !== null && state.selection === challenge.answerIndex;
      resolveChoices(challenge.answerIndex, state.selection);
    } else {
      const verdict = gradeAnswer(challenge, answer);
      correct = verdict === "correct" || verdict === "typo";
      solution = challenge.answers.join(" / ");
    }

    recordResult(challenge.record, correct, recallMs);

    state.answered += 1;
    if (correct) {
      state.correctCount += 1;
      state.streak += 1;
    } else {
      state.streak = 0;
    }
    setProgress();

    renderFooter({
      mode: correct ? "correct" : "incorrect",
      title: correct ? PRAISE[state.answered % PRAISE.length] : "Correct solution:",
      detail: correct ? "" : solution,
      actionLabel: "Continue",
      onAction: advance
    });
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
    if (state.position >= state.queue.length) {
      renderComplete();
      return;
    }
    renderChallenge();
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
    title.textContent = perfect ? "Perfect lesson!" : "Lesson complete!";
    const subtitle = el("div", "_2EXpj");
    subtitle.textContent = perfect
      ? "You made no mistakes in this lesson"
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
        globalThis.location.href = "section.html";
      }
    });
  }

  // ---------------------------------------------------------------- events --

  function wireEvents() {
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
        refreshCheckButton();
        return;
      }

      const match = event.target.closest("[data-sly-fox-match]");
      if (match) {
        handleMatchTap(match);
        return;
      }

      const token = event.target.closest("[data-test$='-challenge-tap-token']");
      if (token && challenge.type === "translate") {
        handleTokenTap(token);
      }
    });

    // Hints are hover-first, with focus as the keyboard equivalent.
    document.addEventListener("mouseover", (event) => {
      const token = event.target.closest("[data-test='hint-token']");
      if (token) {
        openHint(token);
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
      }
    });
    globalThis.addEventListener("scroll", closeHint, { passive: true });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        closeHint();
        return;
      }
      if (event.key === "Enter") {
        const action = document.querySelector("[data-test='player-next']:not([disabled])");
        if (action) {
          event.preventDefault();
          action.click();
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
      const at = state.picked.indexOf(word);
      if (at !== -1) {
        state.picked.splice(at, 1);
      }
      refreshCheckButton();
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
    placed.append(copy);
    flyToken(copy, from);
    state.picked.push(word);
    refreshCheckButton();
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

  function backToSection() {
    globalThis.location.href = "section.html";
  }

  function refuse(message) {
    showNotice(message);
    renderFooter({ mode: "idle", actionLabel: "Back", hideSkip: true, onAction: backToSection });
  }

  // Where a lesson comes from. `?lesson=<name>` loads lessons/<name>.json;
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
      const response = await fetch(`units/${unitSlug}.json`).catch(() => null);
      if (!response || !response.ok) {
        throw new Error(`No unit file called ${unitSlug}.json.`);
      }
      const unit = await response.json();
      const pucks = (unit.pucks || []).filter((puck) => puck.kind !== "chest");
      const puck = pucks[Number(params.get("puck")) || 0];
      if (!puck || !Array.isArray(puck.lessons) || !puck.lessons.length) {
        throw new Error(`That puck has no lessons in ${unitSlug}.json.`);
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
      // On chrome-extension:// a missing file rejects the fetch outright rather
      // than answering 404, so both have to mean the same thing here.
      const response = await fetch(`lessons/${name}.json`).catch(() => null);
      if (!response || !response.ok) {
        throw new Error(`No lesson file called ${name}.json.`);
      }
      const lesson = normalizeLesson(await response.json());
      if (!lesson.challenges.length) {
        throw new Error(`${name}.json has no usable challenges in it.`);
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

    loadLesson().then(
      (lesson) => {
        state.lesson = lesson;
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
        start();
      }
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();
