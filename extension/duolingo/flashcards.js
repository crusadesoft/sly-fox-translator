// Flashcard training.
//
// A "Flashcards" tab on the Words page tracks how well each vocabulary word is
// known — typed answers, recall time, streaks — and a Duolingo-lesson-style
// overlay runs the practice sessions.
//
// Progress lives under its own storage key, keyed by word TEXT rather than
// entry ids, so it survives re-imports and can be carried between browsers as
// a JSON file.
//
// Two decisions worth knowing about. Session decks are a weighted lottery over
// the whole eligible deck rather than a weakest-first sort: a strict sort kept
// re-dealing the same dozen words every session. And grading forgives typos the
// way Duolingo does — a near miss earns one more attempt, an unrecognizable
// answer does not.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const FLASHCARDS_STORAGE_KEY = "learnedWordReplacerFlashcards";
  const DEFAULT_FLASHCARDS_STATE = { version: 1, languages: {} };
  const DUOLINGO_FLASHCARDS_PANEL_ID = "learned-word-replacer-duolingo-flashcards-panel";
  const DUOLINGO_FLASHCARDS_OVERLAY_ID = "learned-word-replacer-flashcards-overlay";
  const DUOLINGO_FLASHCARDS_QUICKSTART_ID = "learned-word-replacer-duolingo-flashcards-start";
  const FLASHCARD_DIRECTIONS = ["en2tg", "tg2en"];
  const FLASHCARD_SESSION_SIZE = 10;
  const FLASHCARD_GREEN = "rgb(88, 204, 2)";
  const FLASHCARD_GREEN_SHADOW = "rgb(88, 167, 0)";
  const FLASHCARD_RED = "rgb(255, 75, 75)";
  const FLASHCARD_RED_SHADOW = "rgb(234, 43, 43)";
  const FLASHCARD_BUCKET_LABELS = ["Strong", "Good", "Weak", "New"];
  // Reloaded by boot.js when another tab writes practice stats, so it lives on
  // the namespace rather than in this module.
  LWR.flashcardsState = DEFAULT_FLASHCARDS_STATE;
  let flashcardsSession = null;
  let flashcardsTimerInterval = null;
  let duolingoFlashcardsDirection = "mixed";
  let duolingoFlashcardsBuckets = new Set(FLASHCARD_BUCKET_LABELS);
  let duolingoFlashcardsFilter = "";

  function normalizeFlashcardRecord(record) {
    if (!record || typeof record !== "object") {
      return null;
    }

    const attempts = Math.max(0, Math.floor(Number(record.attempts) || 0));
    if (!attempts) {
      return null;
    }

    return {
      attempts,
      correct: Math.min(attempts, Math.max(0, Math.floor(Number(record.correct) || 0))),
      streak: Math.max(0, Math.floor(Number(record.streak) || 0)),
      avgMs: Math.max(0, Math.round(Number(record.avgMs) || 0)),
      lastAt: Math.max(0, Math.round(Number(record.lastAt) || 0)),
      lastCorrect: Boolean(record.lastCorrect)
    };
  }

  function normalizeFlashcardsState(value) {
    const languages = {};
    const sourceLanguages =
      value && typeof value === "object" && value.languages && typeof value.languages === "object"
        ? value.languages
        : {};

    for (const [code, language] of Object.entries(sourceLanguages)) {
      const cards = {};
      const sourceCards =
        language && typeof language === "object" && language.cards && typeof language.cards === "object"
          ? language.cards
          : {};
      for (const [key, record] of Object.entries(sourceCards)) {
        const normalized = normalizeFlashcardRecord(record);
        if (normalized) {
          cards[key] = normalized;
        }
      }
      if (Object.keys(cards).length) {
        languages[code] = { cards };
      }
    }

    return { version: 1, languages };
  }

  function getFlashcardLanguageCards() {
    const code = LWR.getCurrentLanguageCode() || "unknown";
    const language = LWR.flashcardsState.languages[code];
    return language && language.cards ? language.cards : {};
  }

  function getFlashcardRecord(direction, wordKey) {
    return getFlashcardLanguageCards()[`${direction}:${wordKey}`] || null;
  }

  // One card per learned word (unique entry.target): the word plus every
  // English meaning the vocabulary knows for it, mirroring how the Duolingo
  // Words page lists "кафе — a cafe, a café". Alternate forms
  // ("мільйони / мільйонів") all count as correct answers.
  function buildFlashcardDeck() {
    const groups = new Map();
    for (const entry of LWR.getCurrentEntries()) {
      const target = String(entry.target || "").trim();
      const source = String(entry.source || "").trim();
      if (!target || !source) {
        continue;
      }

      const groupKey = LWR.normalizeDuolingoWordKey(target);
      if (!groups.has(groupKey)) {
        const alternates = target
          .split(" / ")
          .map((part) => part.trim())
          .filter(Boolean);
        groups.set(groupKey, {
          word: alternates[0],
          alternates,
          wordKey: LWR.normalizeDuolingoWordKey(alternates[0]),
          meanings: [],
          meaningKeys: new Set()
        });
      }

      const group = groups.get(groupKey);
      const meaningKey = LWR.normalizeDuolingoWordKey(source);
      if (meaningKey && !group.meaningKeys.has(meaningKey)) {
        group.meaningKeys.add(meaningKey);
        group.meanings.push(source);
      }
    }

    return [...groups.values()].filter((card) => card.word && card.meanings.length);
  }

  // Strength 0..1 per (word, direction): mostly accuracy, plus the current
  // streak and how quickly correct answers come. Recall speed is an EMA of
  // the time from card shown to submit, ≤2.5s scoring full marks.
  function flashcardRecordStrength(record) {
    if (!record || !record.attempts) {
      return null;
    }

    const accuracy = record.correct / record.attempts;
    const streakFactor = Math.min(record.streak, 4) / 4;
    const speed =
      record.avgMs > 0
        ? Math.min(1, Math.max(0.15, (12000 - record.avgMs) / 9500))
        : 0.5;
    return Math.min(1, Math.max(0, accuracy * 0.5 + streakFactor * 0.3 + speed * 0.2));
  }

  function flashcardWordStrength(wordKey) {
    const scores = FLASHCARD_DIRECTIONS.map((direction) =>
      flashcardRecordStrength(getFlashcardRecord(direction, wordKey))
    ).filter((score) => score !== null);
    return scores.length
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : null;
  }

  function flashcardWordLastAt(wordKey) {
    let last = 0;
    for (const direction of FLASHCARD_DIRECTIONS) {
      const record = getFlashcardRecord(direction, wordKey);
      if (record && record.lastAt > last) {
        last = record.lastAt;
      }
    }
    return last;
  }

  function flashcardStrengthBucket(strength) {
    if (strength === null) {
      return { label: "New", color: "rgb(175, 175, 175)" };
    }
    if (strength >= 0.8) {
      return { label: "Strong", color: FLASHCARD_GREEN };
    }
    if (strength >= 0.55) {
      return { label: "Good", color: "rgb(255, 200, 0)" };
    }
    return { label: "Weak", color: FLASHCARD_RED };
  }

  // Every Start deals a fresh weighted lottery over the WHOLE eligible deck
  // (Efraimidis–Spirakis sampling without replacement): weaker words carry
  // more tickets, words practiced in the last hour carry fewer, but nothing
  // outranks anything outright. A strict weakest-first sort — even a jittered
  // one — kept re-dealing the same dozen weak words every session; anyone who
  // wants a pure weak-word grind can use the category filter chips instead.
  function pickFlashcardSessionCards(deck, size) {
    const direction = duolingoFlashcardsDirection;
    const now = Date.now();
    const drawn = deck.map((card) => {
      const strength = FLASHCARD_DIRECTIONS.includes(direction)
        ? flashcardRecordStrength(getFlashcardRecord(direction, card.wordKey))
        : flashcardWordStrength(card.wordKey);
      const lastAt = flashcardWordLastAt(card.wordKey);
      const ageMinutes = lastAt ? (now - lastAt) / 60000 : Infinity;
      const cooldown = ageMinutes < 60 ? 0.2 * (1 - ageMinutes / 60) : 0;
      const effective = Math.min(1, (strength === null ? 0.3 : strength) + cooldown);
      // Weak ≈ 0.9 tickets, New ≈ 0.56, Good ≈ 0.16, Strong ≈ 0.02: weak
      // words show up noticeably more often, strong ones only rarely.
      const weight = Math.max(0.02, (1.05 - effective) ** 2);
      return { card, sortKey: Math.random() ** (1 / weight) };
    });
    drawn.sort((a, b) => b.sortKey - a.sortKey);
    return drawn.slice(0, size).map((item) => item.card);
  }

  function updateFlashcardRecord(direction, wordKey, correct, recallMs) {
    const code = LWR.getCurrentLanguageCode() || "unknown";
    const languages = { ...LWR.flashcardsState.languages };
    const cards = { ...(languages[code]?.cards || {}) };
    const key = `${direction}:${wordKey}`;
    const previous = cards[key] || { attempts: 0, correct: 0, streak: 0, avgMs: 0, lastAt: 0 };
    const roundedRecall = Math.max(0, Math.round(recallMs));

    cards[key] = {
      attempts: previous.attempts + 1,
      correct: previous.correct + (correct ? 1 : 0),
      streak: correct ? previous.streak + 1 : 0,
      avgMs: correct
        ? previous.avgMs > 0
          ? Math.round(previous.avgMs * 0.7 + roundedRecall * 0.3)
          : roundedRecall
        : previous.avgMs,
      lastAt: Date.now(),
      lastCorrect: Boolean(correct)
    };
    languages[code] = { cards };
    LWR.flashcardsState = { ...LWR.flashcardsState, languages };
    chrome.storage.local.set({ [FLASHCARDS_STORAGE_KEY]: LWR.flashcardsState });
  }

  // Typed-answer grading: case/whitespace/trailing-punctuation insensitive.
  // English answers additionally accept a leading article/"to" and Latin
  // accent differences (cafe ≡ café). The accent fold never runs on target-
  // language answers — NFD stripping would corrupt Cyrillic й/ї.
  function flashcardAnswerKeys(text, english) {
    const keys = new Set();
    const folded = LWR.normalizeDuolingoWordKey(String(text || "").replace(/’/g, "'"))
      .replace(/[.,!?;:…]+$/g, "")
      .trim();
    if (!folded) {
      return keys;
    }

    keys.add(folded);
    if (english) {
      keys.add(folded.replace(/^(?:a|an|the|to)\s+/, ""));
      for (const key of [...keys]) {
        keys.add(key.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC"));
      }
    }
    return keys;
  }

  function flashcardEditDistance(a, b, limit) {
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

  // Duolingo-style typo forgiveness: hyphen/space differences always pass
  // ("twenty three" ≡ "twenty-three"), and a single-character slip passes on
  // words long enough that one edit can't reach a different real word (never
  // on short words like чай, where чаї is a distinct form).
  function softenFlashcardKey(text) {
    return text.replace(/[-–—]/g, " ").replace(/\s+/g, " ").trim();
  }

  function flashcardTypoMatch(inputKey, answerKey) {
    if (!inputKey || !answerKey) {
      return false;
    }

    const softInput = softenFlashcardKey(inputKey);
    const softAnswer = softenFlashcardKey(answerKey);
    if (softInput === softAnswer) {
      return true;
    }
    return answerKey.length >= 4 && flashcardEditDistance(softInput, softAnswer, 1) <= 1;
  }

  // "Close" = recognizably the right word with a few characters wrong — the
  // only tier that earns a second chance. The threshold scales with the
  // answer: 2 edits on short words, roughly a third of the characters on
  // longer ones. Anything past that is a different answer, not a near miss.
  function flashcardCloseMatch(inputKey, answerKey) {
    if (!inputKey || !answerKey) {
      return false;
    }

    const limit = Math.max(2, Math.floor(answerKey.length / 3));
    return (
      flashcardEditDistance(
        softenFlashcardKey(inputKey),
        softenFlashcardKey(answerKey),
        limit
      ) <= limit
    );
  }

  // "correct" = exact (normalized) match, "typo" = accepted with a shown
  // correction, "close" = near miss worth a second chance, "wrong" = not
  // recognizably the answer.
  function gradeFlashcardAnswer(item, value) {
    const english = item.direction === "tg2en";
    const answers = english ? item.card.meanings : item.card.alternates;
    const accepted = new Set();
    for (const answer of answers) {
      for (const key of flashcardAnswerKeys(answer, english)) {
        accepted.add(key);
      }
    }

    const inputKeys = [...flashcardAnswerKeys(value, english)];
    if (inputKeys.some((key) => accepted.has(key))) {
      return "correct";
    }
    let close = false;
    for (const inputKey of inputKeys) {
      for (const answerKey of accepted) {
        if (flashcardTypoMatch(inputKey, answerKey)) {
          return "typo";
        }
        close = close || flashcardCloseMatch(inputKey, answerKey);
      }
    }
    return close ? "close" : "wrong";
  }

  function flashcardCorrectAnswerText(item) {
    return item.direction === "tg2en"
      ? item.card.meanings.join(", ")
      : item.card.alternates.join(" / ");
  }

  function formatFlashcardRecallMs(ms) {
    return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
  }

  // --- Flashcards tab panel on the Words page ---

  function duolingoFlashcardsPrimaryButton(label, { danger } = {}) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    const background = danger ? FLASHCARD_RED : FLASHCARD_GREEN;
    const shadow = danger ? FLASHCARD_RED_SHADOW : FLASHCARD_GREEN_SHADOW;
    button.style.cssText = [
      "padding: 12px 24px",
      "border: none",
      "border-radius: 16px",
      `background: ${background}`,
      "color: #ffffff",
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "font-size: 15px",
      "font-weight: 700",
      "letter-spacing: 0.8px",
      "text-transform: uppercase",
      `box-shadow: 0 4px 0 ${shadow}`,
      "cursor: pointer"
    ].join(";");
    return button;
  }

  function buildDuolingoFlashcardsPanel(headingClassName) {
    const panel = document.createElement("div");
    panel.id = DUOLINGO_FLASHCARDS_PANEL_ID;
    panel.dataset.lwrUi = "true";
    panel.style.display = "none";

    const heading = document.createElement("h2");
    heading.className = headingClassName;
    heading.setAttribute("data-lwr-flashcards-count", "");
    panel.append(heading);

    const controls = document.createElement("div");
    controls.style.cssText =
      "display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 14px 0";
    const start = duolingoFlashcardsPrimaryButton("Start flashcards");
    start.setAttribute("data-lwr-flashcards-session-start", "");
    start.addEventListener("click", () => startDuolingoFlashcardsSession());
    controls.append(start);

    const directions = document.createElement("div");
    directions.style.cssText = "display: inline-flex; gap: 8px";
    for (const option of [
      { value: "mixed", label: "Mixed" },
      { value: "en2tg", label: "English → word" },
      { value: "tg2en", label: "Word → English" }
    ]) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.textContent = option.label;
      chip.setAttribute("data-lwr-flashcards-direction", option.value);
      chip.addEventListener("click", () => {
        duolingoFlashcardsDirection = option.value;
        renderDuolingoFlashcardsPanel();
      });
      directions.append(chip);
    }
    controls.append(directions);
    panel.append(controls);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.style.display = "none";
    fileInput.setAttribute("data-lwr-flashcards-file", "");
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = "";
      if (file) {
        runDuolingoFlashcardsImportFile(file);
      }
    });

    const transfer = document.createElement("div");
    transfer.style.cssText = "display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 0 0 8px";
    const exportButton = LWR.duolingoPanelButton("Download progress");
    exportButton.setAttribute("data-lwr-flashcards-export", "");
    exportButton.addEventListener("click", () => runDuolingoFlashcardsExport());
    const importButton = LWR.duolingoPanelButton("Import progress");
    importButton.setAttribute("data-lwr-flashcards-import", "");
    importButton.addEventListener("click", () => fileInput.click());
    transfer.append(exportButton, importButton, fileInput);
    panel.append(transfer);

    const status = document.createElement("div");
    status.setAttribute("data-lwr-flashcards-status", "");
    status.textContent =
      "Progress is saved in this browser — download it as a file to move it to another browser.";
    status.style.cssText =
      "margin: 0 0 14px; font-family: 'duolingo-sans', -apple-system, sans-serif; font-size: 14px; color: rgb(150, 150, 150)";
    panel.append(status);

    const summary = document.createElement("div");
    summary.setAttribute("data-lwr-flashcards-summary", "");
    summary.style.cssText =
      "display: flex; flex-wrap: wrap; gap: 14px; margin: 0 0 14px; font-family: 'duolingo-sans', -apple-system, sans-serif; font-size: 14px; font-weight: 700";
    panel.append(summary);

    const filter = LWR.duolingoManualInput("Search words");
    filter.setAttribute("data-lwr-flashcards-filter", "");
    filter.style.margin = "0 0 12px";
    filter.addEventListener("input", () => {
      duolingoFlashcardsFilter = filter.value;
      renderDuolingoFlashcardsList();
    });
    panel.append(filter);

    const list = document.createElement("div");
    list.setAttribute("data-lwr-flashcards-list", "");
    panel.append(list);

    return panel;
  }

  function toggleDuolingoFlashcardsBucket(label) {
    if (duolingoFlashcardsBuckets.has(label)) {
      duolingoFlashcardsBuckets.delete(label);
    } else {
      duolingoFlashcardsBuckets.add(label);
    }
    renderDuolingoFlashcardsPanel();
  }

  function setDuolingoFlashcardsStatus(text, isError) {
    document.querySelectorAll("[data-lwr-flashcards-status]").forEach((status) => {
      status.textContent = text;
      status.style.color = isError ? FLASHCARD_RED_SHADOW : "rgb(88, 167, 0)";
    });
  }

  function renderDuolingoFlashcardsPanel() {
    const panel = document.getElementById(DUOLINGO_FLASHCARDS_PANEL_ID);
    if (!panel) {
      return;
    }

    const deck = buildFlashcardDeck();
    const label = `${deck.length} flashcard word${deck.length === 1 ? "" : "s"}`;
    const heading = panel.querySelector("[data-lwr-flashcards-count]");
    if (heading.textContent !== label) {
      heading.textContent = label;
    }

    for (const chip of panel.querySelectorAll("[data-lwr-flashcards-direction]")) {
      const active =
        chip.getAttribute("data-lwr-flashcards-direction") === duolingoFlashcardsDirection;
      const wanted = [
        "padding: 8px 14px",
        "border-radius: 12px",
        "font-family: 'duolingo-sans', -apple-system, sans-serif",
        "font-size: 13px",
        "font-weight: 700",
        "letter-spacing: 0.6px",
        "text-transform: uppercase",
        "cursor: pointer",
        active
          ? "border: 2px solid rgb(28, 176, 246); background: rgb(221, 244, 255); color: rgb(24, 153, 214)"
          : "border: 2px solid rgb(229, 229, 229); background: #ffffff; color: rgb(175, 175, 175)"
      ].join(";");
      if (chip.style.cssText !== wanted) {
        chip.style.cssText = wanted;
      }
      const pressed = String(active);
      if (chip.getAttribute("aria-pressed") !== pressed) {
        chip.setAttribute("aria-pressed", pressed);
      }
    }

    // The category chips double as filters: each one toggles whether the
    // session deck draws from that strength bucket.
    const counts = { Strong: 0, Good: 0, Weak: 0, New: 0 };
    for (const card of deck) {
      counts[flashcardStrengthBucket(flashcardWordStrength(card.wordKey)).label] += 1;
    }
    const summary = panel.querySelector("[data-lwr-flashcards-summary]");
    const summarySignature = JSON.stringify([counts, [...duolingoFlashcardsBuckets].sort()]);
    if (summary.getAttribute("data-lwr-signature") !== summarySignature) {
      summary.setAttribute("data-lwr-signature", summarySignature);
      summary.textContent = "";
      const summaryLabel = document.createElement("span");
      summaryLabel.textContent = "Practice from:";
      summaryLabel.style.cssText =
        "align-self: center; font-weight: 500; color: rgb(150, 150, 150)";
      summary.append(summaryLabel);
      for (const bucketLabel of FLASHCARD_BUCKET_LABELS) {
        const bucket = flashcardStrengthBucket(
          bucketLabel === "Strong" ? 1 : bucketLabel === "Good" ? 0.6 : bucketLabel === "Weak" ? 0 : null
        );
        const active = duolingoFlashcardsBuckets.has(bucketLabel);
        const chip = document.createElement("button");
        chip.type = "button";
        chip.setAttribute("data-lwr-flashcards-bucket", bucketLabel);
        chip.setAttribute("aria-pressed", String(active));
        chip.title = active
          ? `Stop drawing ${bucketLabel} words into sessions`
          : `Draw ${bucketLabel} words into sessions`;
        chip.style.cssText = [
          "display: inline-flex",
          "align-items: center",
          "gap: 6px",
          "padding: 6px 12px",
          `border: 2px solid ${active ? bucket.color : "rgb(229, 229, 229)"}`,
          "border-radius: 999px",
          "background: #ffffff",
          "font-family: 'duolingo-sans', -apple-system, sans-serif",
          "font-size: 13px",
          "font-weight: 700",
          "cursor: pointer",
          `color: ${active ? "rgb(90, 90, 90)" : "rgb(175, 175, 175)"}`
        ].join(";");
        const dot = document.createElement("span");
        dot.style.cssText = `width: 10px; height: 10px; border-radius: 999px; background: ${
          active ? bucket.color : "rgb(229, 229, 229)"
        }`;
        const text = document.createElement("span");
        text.textContent = `${bucketLabel} ${counts[bucketLabel]}`;
        chip.append(dot, text);
        summary.append(chip);
      }
    }

    renderDuolingoFlashcardsList();
  }

  function buildFlashcardStrengthBar(strength, bucket) {
    const bar = document.createElement("span");
    bar.style.cssText = "display: inline-flex; gap: 3px";
    const filled = strength === null ? 0 : Math.max(1, Math.round(strength * 4));
    for (let segment = 0; segment < 4; segment += 1) {
      const piece = document.createElement("span");
      piece.style.cssText = `width: 14px; height: 8px; border-radius: 4px; background: ${
        segment < filled ? bucket.color : "rgb(229, 229, 229)"
      }`;
      bar.append(piece);
    }
    return bar;
  }

  function renderDuolingoFlashcardsList() {
    const panel = document.getElementById(DUOLINGO_FLASHCARDS_PANEL_ID);
    if (!panel) {
      return;
    }

    const query = LWR.normalizeDuolingoWordKey(duolingoFlashcardsFilter);
    const rows = buildFlashcardDeck()
      .map((card) => {
        const strength = flashcardWordStrength(card.wordKey);
        const records = FLASHCARD_DIRECTIONS.map((direction) =>
          getFlashcardRecord(direction, card.wordKey)
        ).filter(Boolean);
        const attempts = records.reduce((sum, record) => sum + record.attempts, 0);
        const correct = records.reduce((sum, record) => sum + record.correct, 0);
        const timed = records.filter((record) => record.avgMs > 0);
        const avgMs = timed.length
          ? timed.reduce((sum, record) => sum + record.avgMs, 0) / timed.length
          : 0;
        return { card, strength, attempts, correct, avgMs, lastAt: flashcardWordLastAt(card.wordKey) };
      })
      .filter(
        (row) =>
          !query ||
          LWR.normalizeDuolingoWordKey(row.card.alternates.join(" / ")).includes(query) ||
          LWR.normalizeDuolingoWordKey(row.card.meanings.join(", ")).includes(query)
      );
    // Weakest words first so the top of the list is the study queue; words
    // never practiced sort to the end (their strength is unknown).
    rows.sort((a, b) => {
      if ((a.strength === null) !== (b.strength === null)) {
        return a.strength === null ? 1 : -1;
      }
      return (
        (a.strength ?? 0) - (b.strength ?? 0) ||
        a.lastAt - b.lastAt ||
        a.card.wordKey.localeCompare(b.card.wordKey)
      );
    });

    const signature = rows
      .map(
        (row) =>
          `${row.card.wordKey}:${row.strength === null ? "new" : row.strength.toFixed(3)}:${row.attempts}:${row.correct}:${Math.round(row.avgMs)}`
      )
      .join("|");
    const list = panel.querySelector("[data-lwr-flashcards-list]");
    if (list.getAttribute("data-lwr-signature") === signature) {
      return;
    }
    list.setAttribute("data-lwr-signature", signature);
    list.textContent = "";

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.textContent = query
        ? "No words match this search."
        : "No words yet — use Import to Sly Fox on the Duolingo words tab first.";
      empty.style.cssText =
        "padding: 12px 0; font-family: 'duolingo-sans', -apple-system, sans-serif; font-size: 14px; color: rgb(150, 150, 150)";
      list.append(empty);
      return;
    }

    for (const row of rows) {
      const bucket = flashcardStrengthBucket(row.strength);
      const line = document.createElement("div");
      line.setAttribute("data-lwr-flashcards-row", row.card.wordKey);
      line.style.cssText = [
        "display: flex",
        "align-items: center",
        "justify-content: space-between",
        "gap: 16px",
        "padding: 10px 0",
        "border-bottom: 1px solid rgb(229, 229, 229)",
        "font-family: 'duolingo-sans', -apple-system, sans-serif"
      ].join(";");

      const text = document.createElement("span");
      const word = document.createElement("span");
      word.textContent = row.card.alternates.join(" / ");
      word.style.cssText = "display: block; font-size: 16px; font-weight: 600; color: rgb(60, 60, 60)";
      const meanings = document.createElement("span");
      meanings.textContent = row.card.meanings.join(", ");
      meanings.style.cssText = "display: block; font-size: 13px; color: rgb(150, 150, 150)";
      text.append(word, meanings);

      const stats = document.createElement("span");
      stats.style.cssText =
        "display: flex; flex-direction: column; align-items: flex-end; gap: 4px; flex: none";
      stats.append(buildFlashcardStrengthBar(row.strength, bucket));
      const detail = document.createElement("span");
      detail.textContent =
        row.strength === null
          ? "New"
          : `${bucket.label} · ${Math.round((row.correct / Math.max(1, row.attempts)) * 100)}% · ${
              row.avgMs > 0 ? `${formatFlashcardRecallMs(row.avgMs)} · ` : ""
            }${row.attempts} ${row.attempts === 1 ? "try" : "tries"}`;
      detail.style.cssText = `font-size: 12px; font-weight: 600; color: ${bucket.color}`;
      stats.append(detail);

      line.append(text, stats);
      list.append(line);
    }
  }

  // --- Progress files (move between browsers) ---

  function countFlashcardRecords(candidate) {
    let count = 0;
    for (const language of Object.values(candidate.languages)) {
      count += Object.keys(language.cards).length;
    }
    return count;
  }

  function runDuolingoFlashcardsExport() {
    const count = countFlashcardRecords(LWR.flashcardsState);
    if (!count) {
      setDuolingoFlashcardsStatus("No flashcard progress to download yet — practice first.", true);
      return;
    }

    const payload = {
      type: "sly-fox-flashcards",
      version: 1,
      exportedAt: new Date().toISOString(),
      languages: LWR.flashcardsState.languages
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json"
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sly-fox-flashcards-progress.json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setDuolingoFlashcardsStatus(
      `Downloaded progress for ${count} card${count === 1 ? "" : "s"}.`,
      false
    );
  }

  async function runDuolingoFlashcardsImportFile(file) {
    try {
      const parsed = JSON.parse(await file.text());
      const incoming = normalizeFlashcardsState(parsed);
      const totalIncoming = countFlashcardRecords(incoming);
      if (!totalIncoming) {
        throw new Error("No flashcard progress was found in the file.");
      }

      // Newer-wins per card so re-importing the same file is harmless and
      // browsers that were both practiced keep whichever run was later.
      let updated = 0;
      const languages = { ...LWR.flashcardsState.languages };
      for (const [code, language] of Object.entries(incoming.languages)) {
        const cards = { ...(languages[code]?.cards || {}) };
        for (const [key, record] of Object.entries(language.cards)) {
          const existing = cards[key];
          if (!existing || record.lastAt > existing.lastAt) {
            cards[key] = record;
            updated += 1;
          }
        }
        languages[code] = { cards };
      }
      LWR.flashcardsState = { ...LWR.flashcardsState, languages };
      chrome.storage.local.set({ [FLASHCARDS_STORAGE_KEY]: LWR.flashcardsState });
      setDuolingoFlashcardsStatus(
        `Imported ${totalIncoming} card record${totalIncoming === 1 ? "" : "s"} from ${file.name} — ${updated} newer than this browser's.`,
        false
      );
      renderDuolingoFlashcardsPanel();
    } catch (error) {
      setDuolingoFlashcardsStatus(
        error && error.message ? error.message : `Could not read ${file.name}.`,
        true
      );
    }
  }

  // --- Training session overlay (Duolingo lesson look) ---

  function runDuolingoFlashcardsQuickstart() {
    LWR.duolingoWordsSection = "flashcards";
    LWR.ensureDuolingoWordsTabs();
    startDuolingoFlashcardsSession();
  }

  function startDuolingoFlashcardsSession() {
    if (flashcardsSession || document.getElementById(DUOLINGO_FLASHCARDS_OVERLAY_ID)) {
      return;
    }

    const deck = buildFlashcardDeck();
    if (!deck.length) {
      setDuolingoFlashcardsStatus(
        "No words to practice yet — use Import to Sly Fox on the Duolingo words tab first.",
        true
      );
      return;
    }

    const eligible = deck.filter((card) =>
      duolingoFlashcardsBuckets.has(
        flashcardStrengthBucket(flashcardWordStrength(card.wordKey)).label
      )
    );
    if (!eligible.length) {
      setDuolingoFlashcardsStatus(
        "No words in the selected categories — turn a category back on above.",
        true
      );
      return;
    }

    const cards = pickFlashcardSessionCards(eligible, FLASHCARD_SESSION_SIZE);
    const queue = cards.map((card, index) => ({
      card,
      direction:
        duolingoFlashcardsDirection === "mixed"
          ? FLASHCARD_DIRECTIONS[index % FLASHCARD_DIRECTIONS.length]
          : duolingoFlashcardsDirection,
      retry: false
    }));
    flashcardsSession = {
      queue,
      position: 0,
      total: queue.length,
      completed: 0,
      results: new Map(),
      awaitingContinue: false,
      finished: false,
      retryUsed: false,
      cardShownAt: 0
    };
    buildFlashcardOverlay();
    renderFlashcardSessionCard();
  }

  // The on-card recall timer: ticks while an answer is open, freezes at the
  // graded recall time, and colors up as the pressure builds — green inside
  // 5s, gold to 10s, red after that.
  function setFlashcardTimerDisplay(timer, elapsedMs) {
    const text = formatFlashcardRecallMs(elapsedMs);
    if (timer.textContent !== text) {
      timer.textContent = text;
    }
    const color =
      elapsedMs < 5000 ? FLASHCARD_GREEN : elapsedMs < 10000 ? "rgb(255, 200, 0)" : FLASHCARD_RED;
    if (timer.style.color !== color) {
      timer.style.color = color;
      timer.style.borderColor = color;
    }
  }

  function updateFlashcardTimer() {
    const session = flashcardsSession;
    const timer = document.querySelector("[data-lwr-flashcard-timer]");
    if (!session || !timer || session.finished || session.awaitingContinue) {
      return;
    }
    setFlashcardTimerDisplay(timer, performance.now() - session.cardShownAt);
  }

  function flashcardOverlayElements() {
    const overlay = document.getElementById(DUOLINGO_FLASHCARDS_OVERLAY_ID);
    if (!overlay) {
      return null;
    }
    return {
      overlay,
      progress: overlay.querySelector("[data-lwr-flashcard-progress]"),
      main: overlay.querySelector("[data-lwr-flashcard-main]"),
      footer: overlay.querySelector("[data-lwr-flashcard-footer]"),
      feedback: overlay.querySelector("[data-lwr-flashcard-feedback]"),
      action: overlay.querySelector("[data-lwr-flashcard-action]")
    };
  }

  function buildFlashcardOverlay() {
    // The overlay covers the page whole, so it has to bring its own copy of
    // the page's theme — otherwise a dark-mode session opens as a white flash
    // and the answer box has nothing dark to sit on.
    LWR.refreshDuolingoTheme();
    const theme = LWR.duolingoTheme();
    LWR.ensureDuolingoThemeStyle();

    const overlay = document.createElement("div");
    overlay.id = DUOLINGO_FLASHCARDS_OVERLAY_ID;
    overlay.dataset.lwrUi = "true";
    overlay.setAttribute("data-lwr-theme", LWR.duolingoThemeName);
    overlay.style.cssText = [
      "position: fixed",
      "inset: 0",
      "z-index: 2147483000",
      "display: flex",
      "flex-direction: column",
      `background: ${theme.surface}`,
      "font-family: 'duolingo-sans', -apple-system, sans-serif"
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText =
      "display: flex; align-items: center; gap: 16px; width: 100%; max-width: 720px; margin: 24px auto 0; padding: 0 24px; box-sizing: border-box";
    const quit = document.createElement("button");
    quit.type = "button";
    quit.textContent = "✕";
    quit.title = "End this flashcard session";
    quit.setAttribute("data-lwr-flashcard-quit", "");
    quit.style.cssText = `border: none; background: none; padding: 4px; color: ${theme.icon}; font-size: 22px; font-weight: 700; cursor: pointer`;
    quit.addEventListener("click", () => closeFlashcardOverlay());
    const track = document.createElement("div");
    track.setAttribute("data-lwr-flashcard-track", "");
    track.style.cssText = `flex: 1; height: 16px; border-radius: 8px; background: ${theme.inputBorder}; overflow: hidden`;
    const fill = document.createElement("div");
    fill.setAttribute("data-lwr-flashcard-progress", "");
    fill.style.cssText = `height: 100%; width: 0%; border-radius: 8px; background: ${FLASHCARD_GREEN}; transition: width 0.2s`;
    track.append(fill);
    header.append(quit, track);

    const main = document.createElement("div");
    main.setAttribute("data-lwr-flashcard-main", "");
    main.style.cssText =
      "flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 18px; width: 100%; max-width: 720px; margin: 0 auto; padding: 0 24px 24px; box-sizing: border-box";

    const footer = document.createElement("div");
    footer.setAttribute("data-lwr-flashcard-footer", "");
    footer.style.cssText = `border-top: 2px solid ${theme.surfaceBorder}`;
    const footerInner = document.createElement("div");
    footerInner.style.cssText =
      "display: flex; align-items: center; gap: 16px; width: 100%; max-width: 720px; margin: 0 auto; padding: 24px; box-sizing: border-box";
    const feedback = document.createElement("div");
    feedback.setAttribute("data-lwr-flashcard-feedback", "");
    feedback.style.cssText = "flex: 1; min-height: 44px";
    const action = duolingoFlashcardsPrimaryButton("Check");
    action.setAttribute("data-lwr-flashcard-action", "");
    action.addEventListener("click", () => handleFlashcardAction());
    footerInner.append(feedback, action);
    footer.append(footerInner);

    overlay.append(header, main, footer);
    document.body.append(overlay);
    // Window-capture so the extension sees keys before any Duolingo
    // document-level capture handlers; stopPropagation keeps Duolingo's own
    // shortcuts away from the session without cancelling text insertion.
    globalThis.addEventListener("keydown", handleFlashcardOverlayKeydown, true);
    flashcardsTimerInterval = setInterval(updateFlashcardTimer, 100);
  }

  // Only the overlay's shell needs repainting on a live theme flip: the card
  // body is rebuilt from scratch on every question, so it picks the palette up
  // on its own.
  function applyFlashcardOverlayTheme() {
    const overlay = document.getElementById(DUOLINGO_FLASHCARDS_OVERLAY_ID);
    if (!overlay || overlay.getAttribute("data-lwr-theme") === LWR.duolingoThemeName) {
      return;
    }
    const theme = LWR.duolingoTheme();
    overlay.setAttribute("data-lwr-theme", LWR.duolingoThemeName);
    overlay.style.background = theme.surface;
    const track = overlay.querySelector("[data-lwr-flashcard-track]");
    if (track) {
      track.style.background = theme.inputBorder;
    }
    const footer = overlay.querySelector("[data-lwr-flashcard-footer]");
    if (footer) {
      footer.style.borderTopColor = theme.surfaceBorder;
    }
    const input = overlay.querySelector("[data-lwr-flashcard-input]");
    if (input) {
      input.style.borderColor = theme.inputBorder;
      input.style.background = theme.inputSunkenBackground;
      input.style.color = theme.inputText;
    }
  }

  function closeFlashcardOverlay() {
    document.getElementById(DUOLINGO_FLASHCARDS_OVERLAY_ID)?.remove();
    globalThis.removeEventListener("keydown", handleFlashcardOverlayKeydown, true);
    if (flashcardsTimerInterval !== null) {
      clearInterval(flashcardsTimerInterval);
      flashcardsTimerInterval = null;
    }
    flashcardsSession = null;
    renderDuolingoFlashcardsPanel();
  }

  function handleFlashcardOverlayKeydown(event) {
    const overlay = document.getElementById(DUOLINGO_FLASHCARDS_OVERLAY_ID);
    if (!overlay || !flashcardsSession) {
      return;
    }

    if (event.key === "Escape") {
      event.stopPropagation();
      closeFlashcardOverlay();
      return;
    }

    if (event.key === "Enter") {
      event.stopPropagation();
      event.preventDefault();
      handleFlashcardAction();
      return;
    }

    if (event.target instanceof Element && overlay.contains(event.target)) {
      event.stopPropagation();
    }
  }

  function handleFlashcardAction() {
    const session = flashcardsSession;
    if (!session) {
      return;
    }
    if (session.finished) {
      closeFlashcardOverlay();
      return;
    }
    if (session.awaitingContinue) {
      session.awaitingContinue = false;
      session.position += 1;
      renderFlashcardSessionCard();
      return;
    }
    submitFlashcardAnswer();
  }

  function setFlashcardActionButton(action, label, { danger } = {}) {
    action.textContent = label;
    const background = danger ? FLASHCARD_RED : FLASHCARD_GREEN;
    const shadow = danger ? FLASHCARD_RED_SHADOW : FLASHCARD_GREEN_SHADOW;
    action.style.background = background;
    action.style.boxShadow = `0 4px 0 ${shadow}`;
  }

  function renderFlashcardSessionCard() {
    const session = flashcardsSession;
    const elements = flashcardOverlayElements();
    if (!session || !elements) {
      return;
    }

    if (session.position >= session.queue.length) {
      renderFlashcardSummary();
      return;
    }

    const item = session.queue[session.position];
    const profile = LWR.getCurrentProfile();
    const languageName = profile ? profile.name : "target language";
    const theme = LWR.duolingoTheme();

    elements.progress.style.width = `${Math.round((session.completed / session.total) * 100)}%`;
    elements.footer.style.background = "";
    elements.feedback.textContent = "";
    setFlashcardActionButton(elements.action, "Check");
    elements.main.textContent = "";

    const instructionRow = document.createElement("div");
    instructionRow.style.cssText =
      "display: flex; align-items: center; justify-content: space-between; gap: 16px";
    const instruction = document.createElement("h2");
    instruction.textContent =
      item.direction === "tg2en"
        ? "Type the English meaning"
        : `Type the ${languageName} word`;
    instruction.style.cssText = `margin: 0; font-size: 24px; font-weight: 700; color: ${theme.surfaceText}`;
    const timer = document.createElement("span");
    timer.setAttribute("data-lwr-flashcard-timer", "");
    timer.style.cssText = [
      "flex: none",
      "padding: 4px 14px",
      "border: 2px solid",
      "border-radius: 999px",
      "font-size: 15px",
      "font-weight: 700",
      "font-variant-numeric: tabular-nums"
    ].join(";");
    setFlashcardTimerDisplay(timer, 0);
    instructionRow.append(instruction, timer);

    const prompt = document.createElement("div");
    prompt.setAttribute("data-lwr-flashcard-prompt", "");
    prompt.textContent =
      item.direction === "tg2en"
        ? item.card.alternates.join(" / ")
        : item.card.meanings.join(", ");
    prompt.style.cssText = "font-size: 30px; font-weight: 700; color: rgb(28, 176, 246)";

    const form = document.createElement("form");
    form.style.cssText = "display: flex";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      submitFlashcardAnswer();
    });
    const input = document.createElement("input");
    input.type = "text";
    input.autocomplete = "off";
    input.autocapitalize = "off";
    input.spellcheck = false;
    input.placeholder =
      item.direction === "tg2en" ? "Type the meaning in English" : `Type it in ${languageName}`;
    input.setAttribute("data-lwr-flashcard-input", "");
    input.setAttribute("data-lwr-input", "");
    input.style.cssText = [
      "flex: 1",
      "box-sizing: border-box",
      "padding: 14px 16px",
      `border: 2px solid ${theme.inputBorder}`,
      "border-radius: 12px",
      `background: ${theme.inputSunkenBackground}`,
      `color: ${theme.inputText}`,
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "font-size: 19px",
      "outline: none"
    ].join(";");
    form.append(input);

    elements.main.append(instructionRow, prompt, form);
    session.retryUsed = false;
    session.cardShownAt = performance.now();
    input.focus();
  }

  function submitFlashcardAnswer() {
    const session = flashcardsSession;
    const elements = flashcardOverlayElements();
    if (!session || !elements || session.awaitingContinue || session.finished) {
      return;
    }

    const input = elements.overlay.querySelector("[data-lwr-flashcard-input]");
    if (!input || !input.value.trim()) {
      return;
    }

    const item = session.queue[session.position];
    const recallMs = Math.max(0, performance.now() - session.cardShownAt);
    const grade = gradeFlashcardAnswer(item, input.value);

    // Only a NEAR miss earns one more attempt before the card is graded: no
    // answer reveal, no stats yet, timer keeps running, the input stays live
    // for another try. An answer that isn't recognizably the word grades
    // wrong immediately.
    if (grade === "close" && !session.retryUsed) {
      session.retryUsed = true;
      elements.footer.style.background = "rgb(255, 244, 209)";
      elements.feedback.textContent = "";
      const retryTitle = document.createElement("div");
      retryTitle.textContent = "Not quite — one more try!";
      retryTitle.style.cssText = "font-size: 19px; font-weight: 700; color: rgb(205, 138, 0)";
      const retryHint = document.createElement("div");
      retryHint.textContent = "Check your spelling and check again.";
      retryHint.style.cssText = "margin-top: 4px; font-size: 15px; color: rgb(205, 138, 0)";
      elements.feedback.append(retryTitle, retryHint);
      input.focus();
      input.select();
      return;
    }

    const correct = grade === "correct" || grade === "typo";

    // Only the first look at a card counts toward stored stats; the requeued
    // retries at the end of the session are practice, not measurement.
    const resultKey = `${item.direction}:${item.card.wordKey}`;
    if (!session.results.has(resultKey)) {
      session.results.set(resultKey, {
        card: item.card,
        direction: item.direction,
        firstTryCorrect: correct,
        recallMs
      });
      updateFlashcardRecord(item.direction, item.card.wordKey, correct, recallMs);
    }

    if (correct) {
      session.completed += 1;
    } else {
      session.queue.push({ ...item, retry: true });
    }
    session.awaitingContinue = true;
    input.disabled = true;

    // Freeze the on-card timer at the graded recall time.
    const timer = elements.overlay.querySelector("[data-lwr-flashcard-timer]");
    if (timer) {
      setFlashcardTimerDisplay(timer, recallMs);
    }

    const theme = LWR.duolingoTheme();
    elements.progress.style.width = `${Math.round((session.completed / session.total) * 100)}%`;
    elements.footer.style.background = correct ? theme.correctBanner : theme.wrongBanner;
    elements.feedback.textContent = "";
    const verdictColor = correct ? theme.correctText : theme.wrongText;
    const title = document.createElement("div");
    title.textContent =
      grade === "typo" ? "You have a typo" : correct ? "Nice!" : "Correct answer:";
    title.style.cssText = `font-size: 19px; font-weight: 700; color: ${verdictColor}`;
    const answer = document.createElement("div");
    answer.textContent = correct
      ? `${flashcardCorrectAnswerText(item)} — ${formatFlashcardRecallMs(recallMs)}`
      : flashcardCorrectAnswerText(item);
    answer.style.cssText = `margin-top: 4px; font-size: 15px; color: ${verdictColor}`;
    elements.feedback.append(title, answer);
    setFlashcardActionButton(elements.action, "Continue", { danger: !correct });
  }

  function renderFlashcardSummary() {
    const session = flashcardsSession;
    const elements = flashcardOverlayElements();
    if (!session || !elements) {
      return;
    }

    session.finished = true;
    session.awaitingContinue = false;
    elements.progress.style.width = "100%";
    elements.footer.style.background = "";
    elements.feedback.textContent = "";
    setFlashcardActionButton(elements.action, "Finish");
    elements.main.textContent = "";

    const results = [...session.results.values()];
    const firstTryCorrect = results.filter((result) => result.firstTryCorrect);
    const missed = results.filter((result) => !result.firstTryCorrect);
    const averageRecallMs = firstTryCorrect.length
      ? firstTryCorrect.reduce((sum, result) => sum + result.recallMs, 0) / firstTryCorrect.length
      : 0;

    const theme = LWR.duolingoTheme();
    const title = document.createElement("h2");
    title.setAttribute("data-lwr-flashcard-summary", "");
    title.textContent = "Session complete!";
    title.style.cssText = `margin: 0; font-size: 28px; font-weight: 700; color: ${theme.surfaceText}`;

    const score = document.createElement("div");
    score.textContent = `${firstTryCorrect.length} / ${results.length} correct on the first try`;
    score.style.cssText = `font-size: 19px; font-weight: 700; color: ${
      missed.length ? "rgb(255, 200, 0)" : FLASHCARD_GREEN
    }`;
    elements.main.append(title, score);

    if (firstTryCorrect.length) {
      const speed = document.createElement("div");
      speed.textContent = `Average recall time: ${formatFlashcardRecallMs(averageRecallMs)}`;
      speed.style.cssText = `font-size: 15px; color: ${theme.surfaceMutedText}`;
      elements.main.append(speed);
    }

    if (missed.length) {
      const missedTitle = document.createElement("div");
      missedTitle.textContent = "Words to review:";
      missedTitle.style.cssText = `margin-top: 10px; font-size: 15px; font-weight: 700; color: ${theme.surfaceText}`;
      elements.main.append(missedTitle);
      for (const result of missed) {
        const row = document.createElement("div");
        row.textContent = `${result.card.alternates.join(" / ")} — ${result.card.meanings.join(", ")}`;
        row.style.cssText = `font-size: 15px; color: ${theme.surfaceMutedText}`;
        elements.main.append(row);
      }
    }
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    FLASHCARDS_STORAGE_KEY,
    DEFAULT_FLASHCARDS_STATE,
    DUOLINGO_FLASHCARDS_PANEL_ID,
    DUOLINGO_FLASHCARDS_QUICKSTART_ID,
    normalizeFlashcardsState,
    buildDuolingoFlashcardsPanel,
    renderDuolingoFlashcardsPanel,
    toggleDuolingoFlashcardsBucket,
    runDuolingoFlashcardsQuickstart,
    applyFlashcardOverlayTheme,
    // The practice engine itself, shared with the Sly Fox section's lesson
    // player. The player draws Duolingo's challenges instead of the flashcard
    // overlay, but the deck, the weighting, the grading and the per-word
    // records behind it are these — one set of stats, whichever way a word is
    // practised.
    FLASHCARD_DIRECTIONS,
    FLASHCARD_SESSION_SIZE,
    buildFlashcardDeck,
    pickFlashcardSessionCards,
    gradeFlashcardAnswer,
    // The answer normaliser on its own, so a lesson authored as JSON -- with no
    // vocabulary entry behind it -- is still marked the same way.
    flashcardAnswerKeys,
    flashcardTypoMatch,
    flashcardCloseMatch,
    flashcardCorrectAnswerText,
    flashcardWordStrength,
    flashcardStrengthBucket,
    updateFlashcardRecord
  });
})();
