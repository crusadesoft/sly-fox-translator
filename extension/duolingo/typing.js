// Typing the answer instead of tapping it.
//
// Duolingo's word bank hands you the answer: the words are right there, spelled
// correctly, and picking is not recalling. This replaces the tapping with an
// input box — type a word, press space, and the matching token is placed for
// you. The bank itself is hidden behind the eye toggle, and the same treatment
// covers listen-match, assist and pairs challenges, where the answer words are
// hidden rather than the bank.
//
// The lightbulb is a ladder, one rung per Tab press: first the candidate words
// behind a sharpening blur — length, word count, letter runs, which is what
// actually makes a word click — and only then a letter at a time.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const DUOLINGO_TYPE_INPUT_ID = "learned-word-replacer-duolingo-type-input";
  const DUOLINGO_TYPE_WRAP_ID = "learned-word-replacer-duolingo-type-wrap";
  const DUOLINGO_BANK_TOGGLE_ID = "learned-word-replacer-duolingo-bank-toggle";
  const DUOLINGO_TYPE_HINT_BUTTON_ID = "learned-word-replacer-duolingo-hint-button";
  const DUOLINGO_TYPE_HINT_BADGE_ID = "learned-word-replacer-duolingo-hint-badge";
  // Lucide "eye", "eye-closed" and "lightbulb" (ISC license), inlined because
  // the page CSP has no say over content-script-created DOM but network
  // fetches of icon packs would be blocked and slow anyway.
  const DUOLINGO_EYE_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/></svg>';
  const DUOLINGO_EYE_CLOSED_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15 18-.722-3.25"/><path d="M2 8a10.645 10.645 0 0 0 20 0"/><path d="m20 15-1.726-2.05"/><path d="m4 15 1.726-2.05"/><path d="m9 18 .722-3.25"/></svg>';
  const DUOLINGO_LIGHTBULB_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>';
  let duolingoTypeObserver = null;
  let duolingoTypeClickListener = null;
  let duolingoTypeKeyListener = null;
  let duolingoTypeKeySwallower = null;
  let duolingoTypeFocusListener = null;
  let duolingoTypeBlurListener = null;
  let duolingoTypeInputListener = null;
  // The hint ladder, one rung per Tab press: the word's shape behind a
  // sharpening blur first, then a letter at a time. Shape rungs cue recall —
  // length, word count, letter runs — without spelling anything out, which is
  // the part a prefix reveal never reaches.
  const DUOLINGO_HINT_SHAPE_BLURS = [10, 6, 3.5];
  const DUOLINGO_HINT_SHAPE_MAX_WORDS = 3;
  let duolingoTypeHintTimer = null;
  // The rung is tied to the typed buffer, not to the badge's fade timer —
  // pausing to think should not silently change what the next Tab does.
  let duolingoTypeHintDepth = 0;
  let duolingoTypeHintPrefix = null;
  let duolingoBankHidden = false;
  // Answer words on match and choice challenges start hidden: the point of
  // typing those answers is recalling the word instead of picking it from
  // the visible cards.
  let duolingoAnswerWordsHidden = true;

  function isDuolingoTypeInputTarget(event) {
    return event.target && event.target.id === DUOLINGO_TYPE_INPUT_ID;
  }

  function syncDuolingoTypeAnswers() {
    const shouldRun =
      globalThis === globalThis.top && LWR.isLessonSurface() && Boolean(LWR.state.duolingoTypeAnswers);

    if (shouldRun && !duolingoTypeObserver) {
      duolingoTypeObserver = new MutationObserver(() => {
        ensureDuolingoTypeInput();
      });
      duolingoTypeObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      duolingoTypeClickListener = (event) => {
        const toggle =
          event.target && event.target.closest
            ? event.target.closest(`[id='${DUOLINGO_BANK_TOGGLE_ID}']`)
            : null;
        if (toggle) {
          const context = getDuolingoTypeContext();
          if (context && context.kind !== "bank") {
            duolingoAnswerWordsHidden = !duolingoAnswerWordsHidden;
          } else {
            duolingoBankHidden = !duolingoBankHidden;
          }
          applyDuolingoBankVisibility();
          // Refocus synchronously: keystrokes right after the toggle click
          // must land in the input, not on the button.
          const typeInput = document.getElementById(DUOLINGO_TYPE_INPUT_ID);
          if (typeInput) {
            typeInput.focus();
          }
          return;
        }
        const hintButton =
          event.target && event.target.closest
            ? event.target.closest(`[id='${DUOLINGO_TYPE_HINT_BUTTON_ID}']`)
            : null;
        if (hintButton) {
          const typeInput = document.getElementById(DUOLINGO_TYPE_INPUT_ID);
          if (typeInput) {
            showDuolingoTypeHint(typeInput);
            typeInput.focus();
          }
          return;
        }
        refocusDuolingoTypeInput(event);
      };
      document.addEventListener("click", duolingoTypeClickListener, true);
      // Window-capture (not element-level) handlers, for two reasons:
      // Duolingo's transition animations swap in cloneNode copies of the
      // challenge subtree (clones silently drop element listeners), and on
      // tap challenges Duolingo preventDefaults keydown in a document-level
      // capture listener, which kills text insertion into any input on the
      // page. Window capture runs first, so stopping propagation there keeps
      // our keystrokes out of Duolingo's blocker while the browser's default
      // text insertion still happens.
      duolingoTypeKeyListener = (event) => {
        if (isDuolingoTypeInputTarget(event)) {
          handleDuolingoTypeKeydown(event);
        }
      };
      window.addEventListener("keydown", duolingoTypeKeyListener, true);
      duolingoTypeKeySwallower = (event) => {
        if (isDuolingoTypeInputTarget(event)) {
          event.stopPropagation();
        }
      };
      window.addEventListener("keyup", duolingoTypeKeySwallower, true);
      window.addEventListener("keypress", duolingoTypeKeySwallower, true);
      window.addEventListener("beforeinput", duolingoTypeKeySwallower, true);
      duolingoTypeFocusListener = (event) => {
        if (isDuolingoTypeInputTarget(event)) {
          setDuolingoTypeBorder(event.target);
        }
      };
      duolingoTypeBlurListener = (event) => {
        if (isDuolingoTypeInputTarget(event)) {
          setDuolingoTypeBorder(event.target);
        }
      };
      document.addEventListener("focusin", duolingoTypeFocusListener, true);
      document.addEventListener("focusout", duolingoTypeBlurListener, true);
      duolingoTypeInputListener = (event) => {
        if (isDuolingoTypeInputTarget(event)) {
          hideDuolingoTypeHint();
          resetDuolingoTypeHintDepth();
          updateDuolingoTypeDeadEnd(event.target);
        }
      };
      document.addEventListener("input", duolingoTypeInputListener, true);
      ensureDuolingoTypeInput();
    } else if (!shouldRun && duolingoTypeObserver) {
      duolingoTypeObserver.disconnect();
      duolingoTypeObserver = null;
      document.removeEventListener("click", duolingoTypeClickListener, true);
      window.removeEventListener("keydown", duolingoTypeKeyListener, true);
      window.removeEventListener("keyup", duolingoTypeKeySwallower, true);
      window.removeEventListener("keypress", duolingoTypeKeySwallower, true);
      window.removeEventListener("beforeinput", duolingoTypeKeySwallower, true);
      document.removeEventListener("focusin", duolingoTypeFocusListener, true);
      document.removeEventListener("focusout", duolingoTypeBlurListener, true);
      document.removeEventListener("input", duolingoTypeInputListener, true);
      duolingoTypeClickListener = null;
      duolingoTypeKeyListener = null;
      duolingoTypeKeySwallower = null;
      duolingoTypeFocusListener = null;
      duolingoTypeBlurListener = null;
      duolingoTypeInputListener = null;
      removeDuolingoTypeInput();
    }
  }

  // Per-kind DOM facts. Match: audio cards carry a number badge + waveform,
  // word cards add a challenge-tap-token-text span; matched pairs flip
  // aria-disabled. Choice (assist): cards are divs, the word sits in a
  // challenge-judge-text span, clicking selects and player-next checks.
  const DUOLINGO_TYPE_KINDS = {
    match: {
      challengeName: "challenge-listenMatch",
      cardSelector: "button[data-test*='challenge-tap-token']",
      textSelector: "[data-test='challenge-tap-token-text']"
    },
    choice: {
      challengeName: "challenge-assist",
      cardSelector: "[data-test='challenge-choice']",
      textSelector: "[data-test='challenge-judge-text']"
    },
    // Pairs ("Select the matching pairs"): two columns of word cards, one
    // column per language, each card numbered. Unlike listen-match the
    // pairing is nowhere in the DOM — every card's data-test is its own word
    // — so only the target-language column is hidden and typed, and the other
    // column is picked by its number badge.
    pairs: {
      challengeName: "challenge-match",
      cardSelector: "button[data-test*='challenge-tap-token']",
      textSelector: "[data-test='challenge-tap-token-text']"
    }
  };

  function getDuolingoTypeContext() {
    const bank = LWR.getDuolingoWordBank();
    if (bank) {
      return { kind: "bank", container: bank, challenge: null };
    }

    for (const [kind, spec] of Object.entries(DUOLINGO_TYPE_KINDS)) {
      const challenge = LWR.getVisibleDuolingoChallenge(spec.challengeName);
      const grid = challenge ? LWR.getDuolingoCardGrid(challenge, spec.cardSelector) : null;
      if (grid) {
        return { kind, container: grid, challenge };
      }
    }

    return null;
  }

  function getDuolingoTypeCards(context) {
    const spec = DUOLINGO_TYPE_KINDS[context.kind];
    const cardSelector = spec ? spec.cardSelector : "button[data-test*='challenge-tap-token']";
    const cards = [...context.container.querySelectorAll(cardSelector)];
    return context.kind === "pairs" ? getDuolingoRecallCards(cards) : cards;
  }

  // On a pairs challenge both columns hold readable words, so hiding all of
  // them would leave nothing to work from: one column is blanked and typed,
  // the other stays readable and is picked by its number badge.
  //
  // The blanked half is the RIGHT-hand column, chosen by position and never by
  // language. Choosing it by script -- "blank whichever column is in the
  // language being learned" -- made the same challenge behave two ways, and
  // which one you got depended on something invisible: where the language code
  // resolves, it blanked the left column, and where it does not, this same
  // geometry ran as a fallback and blanked the right. Nothing on screen
  // explained the difference. Position is what the learner actually sees, it is
  // the same on every challenge, and it agrees with Duolingo's own grid, where
  // the language being learned is the right-hand column anyway.
  function getDuolingoRecallCards(cards) {
    // The cards sit in two columns, each sharing a left edge.
    const columns = new Map();
    cards.forEach((card) => {
      const left = Math.round(card.getBoundingClientRect().left);
      const key = [...columns.keys()].find((edge) => Math.abs(edge - left) <= 8);
      const column = key === undefined ? left : key;
      columns.set(column, [...(columns.get(column) || []), card]);
    });
    if (columns.size === 2) {
      const rightEdge = Math.max(...columns.keys());
      return columns.get(rightEdge);
    }

    return cards;
  }

  function getDuolingoRecallTexts(context) {
    const spec = DUOLINGO_TYPE_KINDS[context.kind];
    if (context.kind !== "pairs") {
      return [...context.challenge.querySelectorAll(spec.textSelector)];
    }

    return getDuolingoTypeCards(context)
      .map((card) => card.querySelector(spec.textSelector))
      .filter(Boolean);
  }

  function removeDuolingoTypeInput() {
    document
      .querySelectorAll(`[id='${DUOLINGO_TYPE_WRAP_ID}'], [id='${DUOLINGO_TYPE_INPUT_ID}']`)
      .forEach((host) => host.remove());
    document
      .querySelectorAll("[data-test='word-bank']")
      .forEach((bank) => (bank.style.visibility = ""));
    document
      .querySelectorAll(
        "[data-test='challenge-tap-token-text'], [data-test='challenge-judge-text']"
      )
      .forEach((span) => (span.style.visibility = ""));
  }

  function applyDuolingoBankVisibility() {
    // Guard every write: this runs from the MutationObserver, so an
    // unconditional innerHTML/style write would re-trigger it forever.
    const context = getDuolingoTypeContext();
    const hidden =
      context && context.kind !== "bank" ? duolingoAnswerWordsHidden : duolingoBankHidden;
    const wanted = hidden ? "hidden" : "";

    if (context && context.kind === "bank") {
      if (context.container.style.visibility !== wanted) {
        context.container.style.visibility = wanted;
      }
    } else if (context) {
      // Hide only the word text; the cards, number badges and audio buttons
      // stay visible and clickable.
      getDuolingoRecallTexts(context).forEach((span) => {
        if (span.style.visibility !== wanted) {
          span.style.visibility = wanted;
        }
      });
    }

    const subject = context && context.kind !== "bank" ? "the answer words" : "the word bank";
    const state = `${hidden ? "hidden" : "shown"}-${context ? context.kind : "none"}`;
    document.querySelectorAll(`[id='${DUOLINGO_BANK_TOGGLE_ID}']`).forEach((toggle) => {
      if (toggle.getAttribute("data-bank-state") === state) {
        return;
      }
      toggle.setAttribute("data-bank-state", state);
      toggle.innerHTML = hidden ? DUOLINGO_EYE_CLOSED_ICON : DUOLINGO_EYE_ICON;
      toggle.title = hidden ? `Show ${subject}` : `Hide ${subject}`;
      toggle.setAttribute("aria-label", toggle.title);
      toggle.setAttribute("aria-pressed", String(hidden));
    });
  }

  function ensureDuolingoTypeInput() {
    const context = getDuolingoTypeContext();
    const container = context ? context.container : null;

    // Keep exactly one input row: the one sitting before the visible bank or
    // match grid. Anything else is a leftover or a transition-clone copy.
    let keep = null;
    document.querySelectorAll(`[id='${DUOLINGO_TYPE_WRAP_ID}']`).forEach((host) => {
      if (!keep && container && host.nextElementSibling === container) {
        keep = host;
      } else {
        host.remove();
      }
    });

    if (!container || keep) {
      if (keep) {
        applyDuolingoBankVisibility();
      }
      return;
    }

    // A fresh row is the cheapest place to re-read the page's theme: it costs
    // one getComputedStyle per challenge, and it catches a theme flip that the
    // attribute watcher could not see.
    LWR.refreshDuolingoTheme();
    const theme = LWR.duolingoTheme();
    LWR.ensureDuolingoThemeStyle();

    const input = document.createElement("input");
    input.id = DUOLINGO_TYPE_INPUT_ID;
    input.type = "text";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.setAttribute("data-lwr-input", "");
    input.setAttribute("data-lwr-theme", LWR.duolingoThemeName);
    if (context.kind === "match") {
      input.placeholder = "Press a number to listen, type the word, then space";
      input.setAttribute("aria-label", "Type the word matching the audio you hear");
    } else if (context.kind === "pairs") {
      input.placeholder = "Press a number to pick a word, type its pair, then space";
      input.setAttribute("aria-label", "Type the word pairing with the one you picked");
    } else if (context.kind === "choice") {
      input.placeholder = "Type the meaning, then space — Enter checks";
      input.setAttribute("aria-label", "Type the answer matching the prompt");
    } else {
      input.placeholder = "Type a word, then space — Tab hints (again: more), Enter checks";
      input.setAttribute("aria-label", "Type a word from the word bank");
    }
    input.style.cssText = [
      "display: block",
      "width: 100%",
      "box-sizing: border-box",
      "margin: 0",
      "padding: 10px 84px 10px 14px",
      `border: 2px solid ${theme.inputBorder}`,
      "border-radius: 12px",
      `background: ${theme.inputBackground}`,
      `color: ${theme.inputText}`,
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "font-size: 17px",
      "font-weight: 500",
      "outline: none",
      "transition: border-color 0.15s ease"
    ].join(";");

    const wrap = document.createElement("div");
    wrap.id = DUOLINGO_TYPE_WRAP_ID;
    wrap.style.cssText =
      "position: relative; width: 100%; box-sizing: border-box; margin: 0 0 12px";

    const toggle = document.createElement("button");
    toggle.id = DUOLINGO_BANK_TOGGLE_ID;
    toggle.type = "button";
    toggle.tabIndex = -1;
    toggle.setAttribute("data-lwr-theme", LWR.duolingoThemeName);
    toggle.style.cssText = [
      "position: absolute",
      "right: 8px",
      "top: 50%",
      "transform: translateY(-50%)",
      "display: flex",
      "align-items: center",
      "justify-content: center",
      "width: 32px",
      "height: 32px",
      "padding: 0",
      "border: none",
      "border-radius: 8px",
      "background: none",
      `color: ${theme.icon}`,
      "cursor: pointer"
    ].join(";");

    const hintButton = document.createElement("button");
    hintButton.id = DUOLINGO_TYPE_HINT_BUTTON_ID;
    hintButton.type = "button";
    hintButton.tabIndex = -1;
    hintButton.title = "Hint (Tab) — the word's shape first, then letters";
    hintButton.setAttribute("aria-label", hintButton.title);
    hintButton.setAttribute("data-lwr-theme", LWR.duolingoThemeName);
    hintButton.innerHTML = DUOLINGO_LIGHTBULB_ICON;
    hintButton.style.cssText = [
      "position: absolute",
      "right: 44px",
      "top: 50%",
      "transform: translateY(-50%)",
      "display: flex",
      "align-items: center",
      "justify-content: center",
      "width: 32px",
      "height: 32px",
      "padding: 0",
      "border: none",
      "border-radius: 8px",
      "background: none",
      `color: ${theme.icon}`,
      "cursor: pointer"
    ].join(";");

    const badge = document.createElement("div");
    badge.id = DUOLINGO_TYPE_HINT_BADGE_ID;
    badge.setAttribute("role", "status");
    badge.setAttribute("data-lwr-theme", LWR.duolingoThemeName);
    badge.style.cssText = [
      "position: absolute",
      "right: 8px",
      "bottom: calc(100% + 6px)",
      "display: none",
      "padding: 6px 12px",
      "border-radius: 10px",
      `background: ${theme.badgeBackground}`,
      `color: ${theme.badgeText}`,
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "font-size: 15px",
      "font-weight: 600",
      "white-space: nowrap",
      "pointer-events: none",
      "z-index: 2000"
    ].join(";");

    wrap.append(input, hintButton, toggle, badge);
    container.parentElement.insertBefore(wrap, container);
    // A fresh input row means a new challenge: the previous word's reveal
    // depth must not carry over into it.
    resetDuolingoTypeHintDepth();
    applyDuolingoBankVisibility();
    input.focus();
  }

  function refocusDuolingoTypeInput(event) {
    const context = getDuolingoTypeContext();
    const input = context ? document.getElementById(DUOLINGO_TYPE_INPUT_ID) : null;
    if (!input || !input.isConnected) {
      return;
    }

    if (event.target === input) {
      return;
    }

    // Leave real text fields (report dialogs etc.) alone.
    setTimeout(() => {
      const active = document.activeElement;
      if (
        active &&
        (active === input ||
          active.tagName === "INPUT" ||
          active.tagName === "TEXTAREA" ||
          active.isContentEditable)
      ) {
        return;
      }
      input.focus();
    }, 0);
  }

  function normalizeDuolingoTypedText(value) {
    return String(value || "")
      .normalize("NFC")
      .toLocaleLowerCase()
      .replace(/[’ʼ`]/g, "'")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getDuolingoBankTokens() {
    const context = getDuolingoTypeContext();
    if (!context) {
      return [];
    }

    const spec = DUOLINGO_TYPE_KINDS[context.kind];
    return getDuolingoTypeCards(context)
      .filter(
        (card) => !card.disabled && card.getAttribute("aria-disabled") !== "true"
      )
      .map((card) => {
        // Outside the bank only answer cards carry a text span (match audio
        // cards hold just a number badge and a waveform); read the span so
        // the badge number stays out of the matchable text. aria-disabled
        // above already excludes matched pairs.
        const source = spec ? card.querySelector(spec.textSelector) : card;
        if (!source) {
          return null;
        }
        return {
          button: card,
          // textContent, not innerText: the bank or the answer words may be
          // visibility:hidden via the eye toggle, and innerText reads as ""
          // inside hidden subtrees.
          raw: String(source.textContent || "").replace(/\s+/g, " ").trim(),
          text: normalizeDuolingoTypedText(source.textContent)
        };
      })
      .filter((token) => token && token.text);
  }

  function findDuolingoBankToken(typed) {
    const query = normalizeDuolingoTypedText(typed);
    if (!query) {
      return { match: null, couldExtend: false };
    }

    const tokens = getDuolingoBankTokens();
    const exact = tokens.filter((token) => token.text === query);
    if (exact.length) {
      // "a" vs "A" can both be in the bank; prefer the typed casing.
      const rawTyped = String(typed).replace(/\s+/g, " ").trim();
      const caseMatch = exact.find((token) => token.raw === rawTyped);
      return { match: caseMatch || exact[0], couldExtend: false };
    }

    const prefixed = tokens.filter((token) => token.text.startsWith(query));
    const uniqueTexts = new Set(prefixed.map((token) => token.text));
    if (uniqueTexts.size === 1) {
      return { match: prefixed[0], couldExtend: false };
    }

    return {
      match: null,
      couldExtend: prefixed.some((token) => token.text.startsWith(`${query} `))
    };
  }

  function normalizeDuolingoTypedPrefix(value) {
    // Like normalizeDuolingoTypedText, but a single trailing space survives:
    // mid multi-word token ("мене ") the space is part of the typed prefix,
    // and trimming it would hint the space the user already typed.
    return String(value || "")
      .normalize("NFC")
      .toLocaleLowerCase()
      .replace(/[’ʼ`]/g, "'")
      .replace(/\s+/g, " ")
      .replace(/^ /, "");
  }

  function getDuolingoNextLetterHint(typed, depth = 1) {
    const tokens = getDuolingoBankTokens();
    if (!tokens.length) {
      return null;
    }

    const query = normalizeDuolingoTypedPrefix(typed);
    // Every candidate contributes its own next `depth` letters, so a bank that
    // still has "мене" and "мій" in it reads "ме / мі" rather than picking a
    // branch for the user.
    const letters = new Set();
    let complete = false;
    let longestRemainder = 0;
    for (const text of new Set(tokens.map((token) => token.text))) {
      if (!text.startsWith(query)) {
        continue;
      }
      const remainder = text.slice(query.length);
      if (!remainder) {
        complete = true;
        continue;
      }
      longestRemainder = Math.max(longestRemainder, remainder.length);
      letters.add(remainder.slice(0, Math.max(1, depth)));
    }

    return {
      viable: complete || letters.size > 0,
      letters: [...letters].sort(),
      complete,
      longestRemainder
    };
  }

  // Candidate words rendered behind a blur: the first presses cue the word's
  // silhouette — its length, its word count, the run of its letters — which is
  // what makes a word click, without spelling any of it out. Radii picked by
  // eye at 19px text: a blob, then contours, then almost-legible.
  function getDuolingoShapeHintWords(typed) {
    const query = normalizeDuolingoTypedPrefix(typed);
    const words = [];
    const seen = new Set();
    for (const token of getDuolingoBankTokens()) {
      // Skip a candidate the buffer already spells out: its shape is on screen
      // in the input, so blurring it back at the user cues nothing.
      if (!token.text.startsWith(query) || token.text.length === query.length) {
        continue;
      }
      if (token.raw && !seen.has(token.raw)) {
        seen.add(token.raw);
        words.push(token.raw);
      }
    }
    return words.sort().slice(0, DUOLINGO_HINT_SHAPE_MAX_WORDS);
  }

  function resetDuolingoTypeHintDepth() {
    duolingoTypeHintDepth = 0;
    duolingoTypeHintPrefix = null;
  }

  // One rung per press while the buffer is unchanged: the shape stages first,
  // then a letter at a time. A fresh buffer (typing, backspacing, a placed
  // token) starts the ladder over.
  function nextDuolingoTypeHintDepth(input) {
    const prefix = normalizeDuolingoTypedPrefix(input.value);
    if (prefix !== duolingoTypeHintPrefix) {
      duolingoTypeHintPrefix = prefix;
      duolingoTypeHintDepth = 1;
      return duolingoTypeHintDepth;
    }

    // Cap at the last rung: shape stages plus the longest remaining candidate.
    // Past that there is nothing left to reveal, so extra presses hold.
    const remaining = getDuolingoNextLetterHint(input.value, 1);
    const letters = remaining && remaining.longestRemainder ? remaining.longestRemainder : 0;
    const limit = Math.max(1, countDuolingoShapeStages(input.value) + letters);
    duolingoTypeHintDepth = Math.min(duolingoTypeHintDepth + 1, limit);
    return duolingoTypeHintDepth;
  }

  function countDuolingoShapeStages(typed) {
    return getDuolingoShapeHintWords(typed).length ? DUOLINGO_HINT_SHAPE_BLURS.length : 0;
  }

  function setDuolingoTypeBorder(input) {
    const theme = LWR.duolingoTheme();
    if (input.getAttribute("data-lwr-dead-end") === "true") {
      input.style.borderColor = theme.inputBorderError;
    } else if (document.activeElement === input) {
      input.style.borderColor = theme.inputBorderFocus;
    } else {
      input.style.borderColor = theme.inputBorder;
    }
  }

  function applyDuolingoTypeInputTheme() {
    const theme = LWR.duolingoTheme();

    document.querySelectorAll(`[id='${DUOLINGO_TYPE_INPUT_ID}']`).forEach((input) => {
      if (input.getAttribute("data-lwr-theme") === LWR.duolingoThemeName) {
        return;
      }
      input.setAttribute("data-lwr-theme", LWR.duolingoThemeName);
      input.style.background = theme.inputBackground;
      input.style.color = theme.inputText;
      setDuolingoTypeBorder(input);
    });

    for (const id of [DUOLINGO_BANK_TOGGLE_ID, DUOLINGO_TYPE_HINT_BUTTON_ID]) {
      document.querySelectorAll(`[id='${id}']`).forEach((button) => {
        if (button.getAttribute("data-lwr-theme") === LWR.duolingoThemeName) {
          return;
        }
        button.setAttribute("data-lwr-theme", LWR.duolingoThemeName);
        button.style.color = theme.icon;
      });
    }

    document.querySelectorAll(`[id='${DUOLINGO_TYPE_HINT_BADGE_ID}']`).forEach((badge) => {
      if (badge.getAttribute("data-lwr-theme") === LWR.duolingoThemeName) {
        return;
      }
      badge.setAttribute("data-lwr-theme", LWR.duolingoThemeName);
      badge.style.color = theme.badgeText;
      // The background carries the hint's verdict, so leave it to the next
      // reveal rather than guessing which of the two it should be now.
      if (badge.style.display === "none") {
        badge.style.background = theme.badgeBackground;
      }
    });
  }

  function updateDuolingoTypeDeadEnd(input) {
    const hint = input.value.trim() ? getDuolingoNextLetterHint(input.value) : null;
    const deadEnd = Boolean(hint && !hint.viable);
    if (input.getAttribute("data-lwr-dead-end") !== String(deadEnd)) {
      input.setAttribute("data-lwr-dead-end", String(deadEnd));
    }
    setDuolingoTypeBorder(input);
  }

  function hideDuolingoTypeHint() {
    if (duolingoTypeHintTimer) {
      clearTimeout(duolingoTypeHintTimer);
      duolingoTypeHintTimer = null;
    }
    // Guarded write: display changes feed the MutationObserver.
    document.querySelectorAll(`[id='${DUOLINGO_TYPE_HINT_BADGE_ID}']`).forEach((badge) => {
      if (badge.style.display !== "none") {
        badge.style.display = "none";
      }
    });
  }

  function showDuolingoTypeHint(input) {
    const badge = document.getElementById(DUOLINGO_TYPE_HINT_BADGE_ID);
    const press = nextDuolingoTypeHintDepth(input);
    const shapeStages = countDuolingoShapeStages(input.value);
    // On a shape rung the letter hint is still read, for its "space places it"
    // verdict; the reveal depth only starts counting once the ladder is past
    // the blurs.
    const hint = getDuolingoNextLetterHint(input.value, Math.max(1, press - shapeStages));
    if (!badge || !hint) {
      return;
    }

    const shaping = hint.viable && press <= shapeStages;
    const blur = shaping ? DUOLINGO_HINT_SHAPE_BLURS[press - 1] : 0;
    const shapeWords = shaping ? getDuolingoShapeHintWords(input.value) : [];

    let text;
    if (!hint.viable) {
      text = "✗ no bank word matches — backspace";
    } else if (shaping) {
      text = hint.complete ? "space places it · shape:" : "shape:";
    } else {
      const letters = hint.letters
        .map((letter) => letter.replace(/ /g, "␣"))
        .join(" / ");
      if (hint.complete) {
        text = letters ? `space places it · or continue: ${letters}` : "space places it";
      } else {
        text = `next: ${letters}`;
      }
    }

    // Guarded write: rewriting the badge's children feeds the MutationObserver.
    const signature = `${text}|${blur}|${shapeWords.join(" · ")}`;
    if (badge.getAttribute("data-lwr-hint") !== signature) {
      badge.setAttribute("data-lwr-hint", signature);
      badge.textContent = text;
      if (shapeWords.length) {
        const shape = document.createElement("span");
        // aria-hidden: a blurred word is a purely visual cue, and reading it
        // out would hand over the answer the blur exists to withhold.
        shape.setAttribute("aria-hidden", "true");
        shape.textContent = shapeWords.join(" · ");
        shape.style.cssText = [
          "display: inline-block",
          "margin-left: 2px",
          // Padding keeps the blur's bleed inside the badge's own background.
          "padding: 2px 8px",
          `filter: blur(${blur}px)`,
          "font-size: 19px",
          "vertical-align: -1px"
        ].join(";");
        badge.append(shape);
      }
    }
    const theme = LWR.duolingoTheme();
    const background = hint.viable ? theme.badgeBackground : theme.badgeErrorBackground;
    if (badge.style.background !== background) {
      badge.style.background = background;
    }
    if (badge.style.display !== "block") {
      badge.style.display = "block";
    }

    if (duolingoTypeHintTimer) {
      clearTimeout(duolingoTypeHintTimer);
    }
    duolingoTypeHintTimer = setTimeout(() => hideDuolingoTypeHint(), 2500);
  }

  function clickDuolingoMatchCardByNumber(digit) {
    const context = getDuolingoTypeContext();
    if (!context || (context.kind !== "match" && context.kind !== "pairs")) {
      return false;
    }

    // Every card shows a number badge, and it is the first text inside the
    // button (audio cards read "3", word cards "5word").
    const card = [
      ...context.container.querySelectorAll("button[data-test*='challenge-tap-token']")
    ].find(
      (button) =>
        !button.disabled &&
        button.getAttribute("aria-disabled") !== "true" &&
        String(button.textContent || "").trim().startsWith(digit)
    );
    if (!card) {
      return false;
    }

    card.click();
    return true;
  }

  function getLastPlacedDuolingoToken() {
    const bank = LWR.getDuolingoWordBank();
    if (!bank) {
      return null;
    }

    const placed = [...document.querySelectorAll("button[data-test*='challenge-tap-token']")]
      .filter(
        (button) =>
          !bank.contains(button) &&
          button.offsetParent !== null &&
          button.innerText.trim()
      );
    return placed[placed.length - 1] || null;
  }

  function flashDuolingoTypeInput(input) {
    input.style.borderColor = LWR.duolingoTheme().inputBorderError;
    setTimeout(() => {
      setDuolingoTypeBorder(input);
    }, 350);
  }

  function handleDuolingoTypeKeydown(event) {
    event.stopPropagation();

    const input = event.target;

    // The typing input holds focus for the whole challenge, so a plain copy
    // would come back empty. With nothing selected, ⌘/Ctrl+C copies the
    // phrase the challenge is asking about; with a selection it copies that.
    if (
      (event.metaKey || event.ctrlKey) &&
      !event.altKey &&
      String(event.key).toLowerCase() === "c"
    ) {
      if (LWR.state.duolingoCopyPhrase && input.selectionStart === input.selectionEnd) {
        LWR.copyDuolingoPrompt();
        event.preventDefault();
      }
      return;
    }

    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    const typed = input.value.trim();

    if (event.key === "Backspace" && !input.value) {
      const lastPlaced = getLastPlacedDuolingoToken();
      if (lastPlaced) {
        lastPlaced.click();
      }
      event.preventDefault();
      return;
    }

    if (event.key === "Tab") {
      showDuolingoTypeHint(input);
      event.preventDefault();
      return;
    }

    // Match and pairs challenges: a digit on an empty buffer taps that
    // numbered card, so the audio can be played (or a word picked) without
    // reaching for the mouse. Pairs number their tenth card "0". With text in
    // the buffer digits type normally (and dead-end like any other miss).
    if (/^[0-9]$/.test(event.key) && !input.value) {
      if (clickDuolingoMatchCardByNumber(event.key)) {
        event.preventDefault();
      }
      return;
    }

    if (event.key !== " " && event.key !== "Enter") {
      return;
    }

    if (!typed) {
      if (event.key === "Enter") {
        const check = document.querySelector("[data-test='player-next']");
        if (
          check &&
          !check.disabled &&
          check.getAttribute("aria-disabled") !== "true"
        ) {
          check.click();
        }
        event.preventDefault();
      } else {
        event.preventDefault();
      }
      return;
    }

    const { match, couldExtend } = findDuolingoBankToken(typed);

    if (match) {
      match.button.click();
      input.value = "";
      // Clearing the value programmatically fires no input event, so reset
      // the hint UI here.
      hideDuolingoTypeHint();
      resetDuolingoTypeHintDepth();
      updateDuolingoTypeDeadEnd(input);
      event.preventDefault();
      return;
    }

    // A space may be the middle of a multi-word token ("мене звуть"):
    // let it through while the buffer still prefixes several tokens.
    if (event.key === " " && couldExtend) {
      return;
    }

    // No match: flash, but let spaces land so a stuck buffer stays readable
    // ("brother is not" instead of "brotherisnot").
    if (event.key === "Enter") {
      event.preventDefault();
    }
    flashDuolingoTypeInput(input);
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    syncDuolingoTypeAnswers,
    applyDuolingoTypeInputTheme,
    normalizeDuolingoTypedText
  });
})();
