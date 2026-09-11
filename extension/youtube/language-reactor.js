// A lesson button on every line of Language Reactor's subtitle panel.
//
// Language Reactor is somebody else's extension, so this is a guest in its
// markup and behaves like one: it adds a button and reads text, and it touches
// nothing of theirs. Two things about their panel decide the shape of this file.
//
// Their list is VIRTUALISED. All 704 lines of an episode exist as absolutely
// positioned placeholders, but only the couple of dozen on screen ever hold any
// markup -- scroll, and the same handful of divs are refilled with different
// lines. So a button appended once is gone the next time the panel scrolls, and
// a listener attached to that button dies with it. A MutationObserver puts the
// buttons back, and the click is handled at document level so it survives every
// refill.
//
// And their tokens are already LABELLED. Each word is a span carrying
// `data-word-key="WORD|<lemma>|uk"`, so the surface form `почала` arrives with
// `почати` attached. That lemma is what lets a word met in a cartoon be looked
// up in a vocabulary that only ever stored its dictionary form -- it would have
// cost a round trip to the morphology dictionary otherwise, per word, per line.
//
// What their panel does NOT give us is the English. This one shows the target
// language only, so the meaning comes from Chrome's on-device target->English
// translator, which is the same one the hover tooltip uses.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const BUTTON_CLASS = "sly-fox-line-lesson";
  const STYLE_ID = "sly-fox-youtube-lesson-style";
  const BUSY_ATTRIBUTE = "data-sly-fox-busy";
  // Their subtitle line, and the absolutely positioned corner their own star
  // and menu buttons sit in. Ours goes beside that corner, not inside it: the
  // holder is a fixed 38px wide for exactly two buttons.
  const LINE_SELECTOR = ".lln-sentence-wrap";
  const TEXT_SELECTOR = ".lln-sub-text";
  const PANEL_SELECTOR = ".lln-vertical-view-content";
  // A line of one or two words is a gasp or a name. There is no lesson in it.
  const MIN_WORDS = 3;
  // Subtitles are not only speech. A line carrying music notes or a bracketed
  // caption -- `♪♪ [НАПИС: "Офіс Кейна"]` -- is an annotation about the film,
  // and the words in it are a sign being described rather than anything said.
  // Its tokens are labelled exactly like real speech, so nothing downstream can
  // tell the difference; it has to be refused here.
  const ANNOTATION = /[♪♫[\]]/u;
  // The dash a subtitle puts in front of a new speaker's line. It is
  // punctuation about the transcript, not part of the sentence, and left in it
  // becomes the first thing the prompt says.
  const SPEAKER_DASH = /^\s*[-–—]\s*/u;

  // Lucide's dumbbell, the practice icon -- icons/lucide/dumbbell.svg. Inlined
  // rather than fetched: the extension's files are only web-accessible on
  // duolingo.com, and widening that for one icon is not worth it.
  const ICON_PATHS = [
    "M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z",
    "m2.5 21.5 1.4-1.4",
    "m20.1 3.9 1.4-1.4",
    "M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z",
    "m9.6 14.4 4.8-4.8"
  ];

  // YouTube mutates its own page constantly, and so does a playing subtitle
  // panel, so the observer never syncs inline -- it sets this and the sync
  // happens once on the trailing edge.
  const SYNC_DELAY_MS = 150;

  let observer = null;
  let syncTimer = null;
  let clickListenerInstalled = false;
  let toast = null;
  let toastTimer = null;

  function isYoutube() {
    return /(^|\.)youtube\.com$/u.test(globalThis.location.hostname);
  }

  // ------------------------------------------------------------- the lines --

  // Rebuild one subtitle line from the spans it is made of. Their markup is a
  // flat run of `lln-word` and `lln-not-word` spans -- the punctuation and the
  // spaces between words are spans too -- plus the button corner, which is not
  // part of the sentence and is skipped.
  //
  // Read `textContent`, never `innerText`: their hover styling can leave parts
  // of a line non-rendered, and innerText reads those as empty.
  function readLine(node) {
    const text = node.querySelector(TEXT_SELECTOR);
    if (!text) {
      return null;
    }

    const tokens = [];
    for (const span of text.children) {
      if (span.classList.contains("lln-star-and-menu-buttons")) {
        continue;
      }

      const isWord = span.classList.contains("lln-word");
      // "WORD|почати|uk" -- the dictionary form of whatever is on screen.
      const key = String(span.dataset.wordKey || "").split("|");
      const value = isWord ? span.textContent : span.textContent.replace(/\s+/gu, " ");
      if (!value) {
        continue;
      }

      tokens.push({
        text: value,
        isWord,
        lemma: (isWord && key[1]) || (isWord ? span.textContent : "")
      });
    }

    // The speaker dash comes off the tokens, not off the finished string: the
    // tokens are what a gapFill rebuilds its prompt from, so a sentence that
    // disagreed with them would grow the dash back with a blank in it.
    while (tokens.length && !tokens[0].isWord) {
      const trimmed = tokens[0].text.replace(SPEAKER_DASH, "");
      if (trimmed === tokens[0].text) {
        break;
      }
      if (trimmed) {
        tokens[0] = { ...tokens[0], text: trimmed };
        break;
      }
      tokens.shift();
    }

    const sentence = tokens.map((token) => token.text).join("").trim();
    if (!sentence || ANNOTATION.test(sentence)) {
      return null;
    }

    return {
      text: sentence,
      tokens,
      index: Number(node.dataset.index) || 0,
      videoId: new URLSearchParams(globalThis.location.search).get("v") || "",
      videoTitle: document.title.replace(/\s*-\s*YouTube\s*$/u, "").trim()
    };
  }

  function wordCount(line) {
    return line.tokens.filter((token) => token.isWord).length;
  }

  // ------------------------------------------------------------ the button --

  function buildIcon() {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "2");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    for (const data of ICON_PATHS) {
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", data);
      svg.append(path);
    }
    return svg;
  }

  function buildButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.className = BUTTON_CLASS;
    button.title = "Practise this line with Sly Fox";
    button.setAttribute("aria-label", "Practise this line with Sly Fox");
    button.append(buildIcon());
    return button;
  }

  // Their line is the positioning context for their own button corner, so an
  // absolutely positioned button of ours lands in the same coordinate space --
  // just left of theirs, clear of the fixed-width holder they share.
  //
  // Faint until the line is hovered rather than invisible like theirs: seven
  // hundred lines of hidden buttons is a feature nobody finds.
  function installStyle() {
    if (document.getElementById(STYLE_ID)) {
      return;
    }

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${BUTTON_CLASS} {
        position: absolute;
        top: 14px;
        right: 52px;
        width: 22px;
        height: 22px;
        padding: 2px;
        margin: 0;
        border: 0;
        border-radius: 6px;
        background: transparent;
        color: #ff9600;
        opacity: 0.35;
        cursor: pointer;
        line-height: 0;
        transition: opacity 120ms ease, background-color 120ms ease;
      }
      .lln-sentence-wrap:hover > .${BUTTON_CLASS} {
        opacity: 1;
      }
      .${BUTTON_CLASS}:hover {
        opacity: 1;
        background: rgba(255, 150, 0, 0.16);
      }
      .${BUTTON_CLASS} svg {
        width: 100%;
        height: 100%;
        display: block;
      }
      .${BUTTON_CLASS}[${BUSY_ATTRIBUTE}] {
        opacity: 1;
        cursor: progress;
        animation: sly-fox-line-lesson-pulse 900ms ease-in-out infinite;
      }
      @keyframes sly-fox-line-lesson-pulse {
        50% { opacity: 0.3; }
      }
      .sly-fox-line-lesson-toast {
        position: fixed;
        right: 24px;
        bottom: 24px;
        z-index: 2147483647;
        max-width: 360px;
        padding: 12px 16px;
        border-radius: 12px;
        background: #1f1f23;
        color: #fff;
        border: 2px solid #ff9600;
        font: 500 14px/1.4 system-ui, sans-serif;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
      }
    `;
    document.head.append(style);
  }

  function ensureButton(node) {
    if (node.querySelector(`:scope > .${BUTTON_CLASS}`)) {
      return;
    }

    const line = readLine(node);
    if (!line || wordCount(line) < MIN_WORDS) {
      return;
    }

    node.append(buildButton());
  }

  // Their panel refills the same divs with different lines as it scrolls, which
  // throws our buttons away several times a second while the video plays. This
  // is the whole reason the buttons are re-added by observation rather than
  // added once.
  //
  // The line divs are NOT what this walks. All 704 of them are in the panel at
  // once and only a couple of dozen hold anything -- an empty one is a bare
  // positioned div with no `.lln-sub-text` inside it. Selecting the text nodes
  // and stepping up to their line is the difference between touching 25 nodes
  // and 704, several times a second, forever.
  function syncButtons() {
    const panel = document.querySelector(PANEL_SELECTOR);
    if (!panel) {
      return;
    }

    installStyle();
    for (const text of panel.querySelectorAll(TEXT_SELECTOR)) {
      const node = text.closest(LINE_SELECTOR);
      if (node) {
        ensureButton(node);
      }
    }
  }

  function scheduleSync() {
    if (syncTimer) {
      return;
    }
    syncTimer = setTimeout(() => {
      syncTimer = null;
      syncButtons();
    }, SYNC_DELAY_MS);
  }

  // ------------------------------------------------------------- the toast --

  function say(message) {
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "sly-fox-line-lesson-toast";
      document.body.append(toast);
    }

    toast.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast?.remove();
      toast = null;
    }, 6000);
  }

  // ------------------------------------------------------------- the click --

  async function startLesson(button) {
    const node = button.closest(LINE_SELECTOR);
    const line = node && readLine(node);
    if (!line) {
      say("Could not read that line.");
      return;
    }

    button.setAttribute(BUSY_ATTRIBUTE, "1");
    try {
      const lesson = await LWR.buildSentenceLesson(line);
      if (!lesson.challenges.length) {
        throw new Error("Nothing in that line could be made into a challenge.");
      }

      // The player reads this back on the other side of a tab open. One slot,
      // overwritten every time: an impromptu lesson is the one you just asked
      // for, and keeping a history of them would only be a thing to clear out.
      await chrome.storage.local.set({
        [LWR.IMPROMPTU_STORAGE_KEY]: { version: 1, lesson }
      });

      const opened = await chrome.runtime.sendMessage({ type: LWR.OPEN_LESSON_REQUEST });
      if (!opened?.ok) {
        throw new Error(opened?.reason || "Could not open the lesson.");
      }
    } catch (error) {
      say(error?.message || "Could not build a lesson from that line.");
    } finally {
      button.removeAttribute(BUSY_ATTRIBUTE);
    }
  }

  // Delegated, because the button this fires for is very unlikely to be the one
  // that was on screen a moment ago -- see the note about their virtualised
  // list at the top of this file.
  function installClickListener() {
    if (clickListenerInstalled) {
      return;
    }

    document.addEventListener(
      "click",
      (event) => {
        const button = event.target?.closest?.(`.${BUTTON_CLASS}`);
        if (!button || button.hasAttribute(BUSY_ATTRIBUTE)) {
          return;
        }

        // Their line seeks the video when clicked. Ours must not.
        event.preventDefault();
        event.stopPropagation();
        startLesson(button);
      },
      true
    );
    clickListenerInstalled = true;
  }

  function syncYoutubeLineLessons() {
    if (!isYoutube() || globalThis !== globalThis.top) {
      return;
    }

    installClickListener();
    syncButtons();

    if (observer) {
      return;
    }

    // Their panel is mounted and unmounted with the watch page, so the observer
    // watches the document rather than the panel: there is nothing to attach to
    // until the first video is opened, and it goes away again on the next.
    // Appending a button is itself a mutation, so the sync is always deferred --
    // observing the document and syncing inline would feed itself.
    observer = new MutationObserver(scheduleSync);
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  LWR.syncYoutubeLineLessons = syncYoutubeLineLessons;
})();
