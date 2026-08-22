// Levelling the word bank.
//
// Two ways the word bank gives its answer away without meaning to: the one
// capitalised word is the sentence's first word, and every word in it is
// spelled correctly, so the right one can be picked without knowing how it
// is spelled. Both are levelled here.
//
// The decoys are near misses, built by swapping letters a learner actually
// confuses, and they are never a word the learner has already saved — marking
// a real word wrong would teach the wrong thing. They also must not cost the
// challenge any vertical room, so the bank keeps the height it had with
// Duolingo's own words and the rest is reached by scrolling.
//
// This file also owns the small DOM lookups for the challenge itself, because
// finding the visible word bank is the same problem as finding the visible
// challenge: Duolingo keeps hidden clones around for its slide transitions.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const DUOLINGO_DECOY_ATTRIBUTE = "data-lwr-decoy";
  const DUOLINGO_CASE_ATTRIBUTE = "data-lwr-original-case";
  const DUOLINGO_BANK_SCROLL_ATTRIBUTE = "data-lwr-bank-scroll";
  const DUOLINGO_BANK_SCROLL_STYLE_ID = "learned-word-replacer-duolingo-bank-scroll-style";
  // One decoy per word. Two rounds of this doubled a six-word bank into
  // thirteen tiles, which stops being a near-miss test and starts being a
  // wall of noise to read past -- the point is to make one word worth a
  // second look, not to bury the sentence.
  const DUOLINGO_DECOYS_PER_WORD = 1;
  const DUOLINGO_DECOY_MAX = 12;
  // Letters a learner actually confuses, so the decoy is a near miss rather
  // than obvious noise.
  const DUOLINGO_DECOY_CONFUSABLES = {
    uk: [
      ["и", "і"], ["і", "и"], ["і", "ї"], ["ї", "і"], ["е", "є"], ["є", "е"],
      ["о", "а"], ["а", "о"], ["г", "ґ"], ["ш", "щ"], ["щ", "ш"]
    ],
    el: [["ι", "η"], ["η", "ι"], ["ο", "ω"], ["ω", "ο"], ["ε", "α"]],
    default: [["a", "e"], ["e", "a"], ["i", "y"], ["y", "i"], ["o", "u"], ["s", "z"]]
  };
  let duolingoBankTrapObserver = null;
  let duolingoBankTrapClickListener = null;
  let duolingoDecoySignature = "";
  let duolingoDecoyPlan = [];
  let duolingoBankNaturalHeight = 0;

  function syncDuolingoBankTraps() {
    const shouldRun =
      globalThis === globalThis.top &&
      LWR.isLessonSurface() &&
      Boolean(LWR.state.duolingoLowercaseBank || LWR.state.duolingoDecoyWords);

    if (shouldRun && !duolingoBankTrapObserver) {
      duolingoBankTrapObserver = new MutationObserver(() => {
        applyDuolingoBankTraps();
      });
      duolingoBankTrapObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      // Document capture, because the decoys are clones of Duolingo's own
      // slots and clones carry no listeners of their own.
      duolingoBankTrapClickListener = (event) => {
        const decoy =
          event.target && event.target.closest
            ? event.target.closest(`[${DUOLINGO_DECOY_ATTRIBUTE}]`)
            : null;
        if (!decoy) {
          return;
        }
        // A decoy is not Duolingo's to place: the click stops here.
        event.preventDefault();
        event.stopPropagation();
        flashDuolingoDecoy(decoy);
      };
      document.addEventListener("click", duolingoBankTrapClickListener, true);
      window.addEventListener("resize", remeasureDuolingoBankHeight);
      applyDuolingoBankTraps();
    } else if (!shouldRun && duolingoBankTrapObserver) {
      duolingoBankTrapObserver.disconnect();
      duolingoBankTrapObserver = null;
      document.removeEventListener("click", duolingoBankTrapClickListener, true);
      window.removeEventListener("resize", remeasureDuolingoBankHeight);
      duolingoBankTrapClickListener = null;
      duolingoBankNaturalHeight = 0;
      removeDuolingoDecoys();
      restoreDuolingoBankCase();
    }
  }

  function applyDuolingoBankTraps() {
    const bank = getDuolingoWordBank();
    if (!bank) {
      duolingoDecoySignature = "";
      duolingoDecoyPlan = [];
      duolingoBankNaturalHeight = 0;
      return;
    }

    if (LWR.state.duolingoLowercaseBank) {
      lowercaseDuolingoBank(bank);
    } else {
      restoreDuolingoBankCase();
    }

    if (LWR.state.duolingoDecoyWords) {
      ensureDuolingoDecoys(bank);
    } else {
      removeDuolingoDecoys();
    }
  }

  function getDuolingoTokenTextSpans(bank) {
    return [...bank.querySelectorAll("[data-test='challenge-tap-token-text']")];
  }

  function lowercaseDuolingoBank(bank) {
    // Guard every write: this runs from the MutationObserver.
    getDuolingoTokenTextSpans(bank).forEach((span) => {
      const shown = String(span.textContent || "");
      const locale = span.closest("[lang]")?.getAttribute("lang") || undefined;
      const lowered = shown.toLocaleLowerCase(locale);
      if (lowered === shown) {
        return;
      }

      // Keep the original so the page can be handed back untouched when the
      // setting goes off; only the first write records it.
      if (!span.hasAttribute(DUOLINGO_CASE_ATTRIBUTE)) {
        span.setAttribute(DUOLINGO_CASE_ATTRIBUTE, shown);
      }
      span.textContent = lowered;
    });
  }

  function restoreDuolingoBankCase() {
    document.querySelectorAll(`[${DUOLINGO_CASE_ATTRIBUTE}]`).forEach((span) => {
      const original = span.getAttribute(DUOLINGO_CASE_ATTRIBUTE);
      span.removeAttribute(DUOLINGO_CASE_ATTRIBUTE);
      if (original && span.textContent !== original) {
        span.textContent = original;
      }
    });
  }

  function removeDuolingoDecoys() {
    document.querySelectorAll(`[${DUOLINGO_DECOY_ATTRIBUTE}]`).forEach((decoy) => decoy.remove());
    document.querySelectorAll(`[${DUOLINGO_BANK_SCROLL_ATTRIBUTE}]`).forEach((bank) => {
      bank.removeAttribute(DUOLINGO_BANK_SCROLL_ATTRIBUTE);
      bank.style.maxHeight = "";
    });
  }

  function installDuolingoBankScrollStyle() {
    if (document.getElementById(DUOLINGO_BANK_SCROLL_STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = DUOLINGO_BANK_SCROLL_STYLE_ID;
    // macOS hides overlay scrollbars until something is already scrolling, so
    // a bank with rows below the fold would look like it had none. A styled
    // webkit scrollbar is always drawn, which is the whole point of it here.
    style.textContent = `
      [${DUOLINGO_BANK_SCROLL_ATTRIBUTE}] {
        overflow-y: auto;
        overflow-x: hidden;
        scrollbar-width: thin;
        scrollbar-gutter: stable;
      }

      [${DUOLINGO_BANK_SCROLL_ATTRIBUTE}]::-webkit-scrollbar {
        width: 8px;
      }

      [${DUOLINGO_BANK_SCROLL_ATTRIBUTE}]::-webkit-scrollbar-thumb {
        background: rgba(0, 0, 0, 0.18);
        border-radius: 4px;
      }

      [${DUOLINGO_BANK_SCROLL_ATTRIBUTE}]::-webkit-scrollbar-track {
        background: transparent;
      }
    `;
    document.documentElement.appendChild(style);
  }

  // The decoys must not cost the challenge any room: a bank that grows from
  // two rows to four pushes the sentence and the character off the top of the
  // screen. It keeps the height it had with Duolingo's own words in it, and
  // the rest is reached by scrolling.
  function applyDuolingoBankScroll(bank) {
    const wanted = duolingoBankNaturalHeight ? `${duolingoBankNaturalHeight}px` : "";
    if (!wanted) {
      return;
    }

    installDuolingoBankScrollStyle();
    // Guard every write: this runs from the MutationObserver.
    if (bank.getAttribute(DUOLINGO_BANK_SCROLL_ATTRIBUTE) !== "1") {
      bank.setAttribute(DUOLINGO_BANK_SCROLL_ATTRIBUTE, "1");
    }
    if (bank.style.maxHeight !== wanted) {
      bank.style.maxHeight = wanted;
    }
  }

  function remeasureDuolingoBankHeight() {
    const bank = getDuolingoWordBank();
    if (!bank || !duolingoDecoyPlan.length) {
      return;
    }

    // A resize rewraps Duolingo's own words into a different number of rows,
    // so the height to hold the bank at has to be taken again — with the
    // decoys out of the flow, exactly as it was measured the first time.
    const decoys = [...bank.children].filter((slot) =>
      slot.hasAttribute(DUOLINGO_DECOY_ATTRIBUTE)
    );
    bank.style.maxHeight = "";
    decoys.forEach((slot) => (slot.style.display = "none"));
    duolingoBankNaturalHeight = Math.round(bank.getBoundingClientRect().height);
    decoys.forEach((slot) => (slot.style.display = ""));
    applyDuolingoBankScroll(bank);
  }

  function readDuolingoTokenText(button) {
    const source = button.querySelector("[data-test='challenge-tap-token-text']") || button;
    return String(source.textContent || "").replace(/\s+/g, " ").trim();
  }

  function ensureDuolingoDecoys(bank) {
    const words = [...bank.querySelectorAll("button[data-test*='challenge-tap-token']")].map(
      readDuolingoTokenText
    );
    // A bank with two words in it hides nothing, and a decoy there is just in
    // the way.
    if (words.length < 3) {
      duolingoDecoySignature = "";
      duolingoDecoyPlan = [];
      duolingoBankNaturalHeight = 0;
      removeDuolingoDecoys();
      return;
    }

    // Placed words stay in the bank as disabled ghosts, so this signature holds
    // still for the whole challenge — the decoys must not reshuffle every time
    // a word is placed.
    const signature = words
      .map(LWR.normalizeDuolingoTypedText)
      .sort()
      .join("|");
    if (signature !== duolingoDecoySignature) {
      duolingoDecoySignature = signature;
      removeDuolingoDecoys();
      // Measured with Duolingo's own words alone, which is the height the bank
      // is then held to however many decoys go into it.
      duolingoBankNaturalHeight = Math.round(bank.getBoundingClientRect().height);
      duolingoDecoyPlan = planDuolingoDecoys(words, bank.children.length);
    }

    duolingoDecoyPlan.forEach((decoy, order) => {
      if (bank.querySelector(`[${DUOLINGO_DECOY_ATTRIBUTE}='${order}']`)) {
        return;
      }

      const slot = buildDuolingoDecoySlot(bank, decoy.text, order);
      if (!slot) {
        return;
      }
      const slots = [...bank.children];
      bank.insertBefore(slot, slots[Math.min(decoy.index, slots.length)] || null);
    });

    applyDuolingoBankScroll(bank);
  }

  function buildDuolingoDecoySlot(bank, text, order) {
    // Clone one of Duolingo's own slots rather than styling a button from
    // scratch: the class names are hashed per build and the wrapper carries
    // the token's margin variables. A slot holding an already-placed word is
    // a ghost, so clone a live one.
    const source = [...bank.children].find((slot) => {
      const button = slot.querySelector("button[data-test*='challenge-tap-token']");
      return button && button.getAttribute("aria-disabled") !== "true";
    });
    if (!source) {
      return null;
    }

    const slot = source.cloneNode(true);
    const button = slot.querySelector("button");
    const span = slot.querySelector("[data-test='challenge-tap-token-text']");
    if (!button || !span) {
      return null;
    }

    // Drop Duolingo's hooks: a decoy must not read as a real token to the
    // typing input, the hint ladder or anything else selecting on them.
    slot.setAttribute(DUOLINGO_DECOY_ATTRIBUTE, String(order));
    button.setAttribute(DUOLINGO_DECOY_ATTRIBUTE, String(order));
    button.removeAttribute("data-test");
    button.removeAttribute("aria-disabled");
    span.removeAttribute("data-test");
    span.textContent = text;
    return slot;
  }

  function flashDuolingoDecoy(element) {
    const button = element.matches("button") ? element : element.querySelector("button");
    if (!button || button.getAttribute(`${DUOLINGO_DECOY_ATTRIBUTE}-flash`) === "1") {
      return;
    }

    button.setAttribute(`${DUOLINGO_DECOY_ATTRIBUTE}-flash`, "1");
    button.style.color = "rgb(234, 43, 43)";
    setTimeout(() => {
      button.style.color = "";
      button.removeAttribute(`${DUOLINGO_DECOY_ATTRIBUTE}-flash`);
    }, 400);
  }

  function planDuolingoDecoys(words, slotCount) {
    // Nothing already on screen, and nothing the user has actually learned,
    // may end up as a decoy: a real word marked wrong teaches the wrong thing.
    const taken = new Set(words.map(LWR.normalizeDuolingoTypedText));
    for (const entry of LWR.getCurrentEntries()) {
      for (const alternate of String(entry.target || "").split(" / ")) {
        const key = LWR.normalizeDuolingoTypedText(alternate);
        if (key) {
          taken.add(key);
        }
      }
    }

    const bankKeys = words.map(LWR.normalizeDuolingoTypedText);
    const sources = shuffleDuolingoList([...new Set(words)]);
    const plan = [];
    // Breadth before depth: every word earns its first decoy before any word
    // earns a second, so the words worth being unsure about are never the ones
    // left standing alone. At one round that is the whole story -- the loop
    // stays because the count is the knob, and raising it must not go back to
    // giving one word three decoys while another has none.
    for (let round = 0; round < DUOLINGO_DECOYS_PER_WORD; round += 1) {
      for (const word of sources) {
        if (plan.length >= DUOLINGO_DECOY_MAX) {
          break;
        }

        const text = makeDuolingoMisspelling(word, taken, bankKeys);
        if (!text) {
          continue;
        }
        taken.add(LWR.normalizeDuolingoTypedText(text));
        // Scattered through the bank, not tacked on the end, or their position
        // alone would name them.
        plan.push({ text, index: Math.floor(Math.random() * (slotCount + plan.length + 1)) });
      }
    }
    return plan;
  }

  function makeDuolingoMisspelling(word, taken, bankKeys) {
    const letters = [...word];
    const spots = letters
      .map((letter, index) => (/\p{L}/u.test(letter) ? index : -1))
      .filter((index) => index >= 0);
    // Below four letters a single edit tends to land on another real word.
    if (spots.length < 4) {
      return "";
    }

    const confusables =
      DUOLINGO_DECOY_CONFUSABLES[LWR.getCurrentLanguageCode()] || DUOLINGO_DECOY_CONFUSABLES.default;
    const candidates = [];

    for (const [from, to] of confusables) {
      spots.forEach((index) => {
        if (letters[index].toLocaleLowerCase() !== from) {
          return;
        }
        const swapped = [...letters];
        swapped[index] = matchDuolingoLetterCase(letters[index], to);
        candidates.push(swapped.join(""));
      });
    }

    // Only swaps and substitutions, so a decoy is always its source word's
    // length. A doubled or dropped letter changes the shape of the word, and
    // a wrong shape is spotted without reading the word at all.
    spots.forEach((index, order) => {
      const next = spots[order + 1];
      if (next !== index + 1) {
        return;
      }
      const transposed = [...letters];
      transposed[index] = letters[next];
      transposed[next] = letters[index];
      candidates.push(transposed.join(""));
    });

    for (const candidate of shuffleDuolingoList(candidates)) {
      const key = LWR.normalizeDuolingoTypedText(candidate);
      if (!key || candidate === word || taken.has(key)) {
        continue;
      }
      // A decoy that is a bank word with its tail cut off (or one with
      // something stuck on the end) is half-invisible to the typing input,
      // which completes any unique prefix: typing the misspelling would place
      // the real word rather than fail.
      if (bankKeys.some((real) => real.startsWith(key) || key.startsWith(real))) {
        continue;
      }
      return candidate;
    }
    return "";
  }

  function matchDuolingoLetterCase(sample, letter) {
    return sample === sample.toLocaleUpperCase() && sample !== sample.toLocaleLowerCase()
      ? letter.toLocaleUpperCase()
      : letter;
  }

  function shuffleDuolingoList(items) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1));
      [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
    }
    return shuffled;
  }

  function getDuolingoWordBank() {
    // Duolingo keeps hidden clones of the challenge subtree around for its
    // slide transitions; only the visible bank is the real one.
    return [...document.querySelectorAll("[data-test='word-bank']")].find(
      (bank) => bank.offsetParent !== null
    );
  }

  function getVisibleDuolingoChallenge(dataTestName) {
    return [...document.querySelectorAll(`[data-test~='${dataTestName}']`)].find(
      (challenge) => challenge.offsetParent !== null
    );
  }

  function getDuolingoCardGrid(challenge, cardSelector) {
    // The card grid has no data-test of its own; it is the deepest element
    // containing every answer card, and the input row goes right before it.
    const cards = [...challenge.querySelectorAll(cardSelector)];
    if (cards.length < 2) {
      return null;
    }

    let grid = cards[0].parentElement;
    while (grid && grid !== challenge && !cards.every((card) => grid.contains(card))) {
      grid = grid.parentElement;
    }
    return grid && grid !== challenge ? grid : null;
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    syncDuolingoBankTraps,
    getDuolingoWordBank,
    getVisibleDuolingoChallenge,
    getDuolingoCardGrid
  });
})();
