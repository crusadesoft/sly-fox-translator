// A button that copies the lesson prompt.
//
// Finding the prompt is the whole problem. Duolingo's class names are hashed
// and change with every build, so the prompt is located by shape instead: it
// is the element that declares a language and holds none of the answer-side
// DOM. Reading it is fiddly too — hinted words are split into per-letter spans
// with overlays between them, so innerText produces "старі , але" — which is
// why the text is walked node by node, and why a gap-fill blank comes out as
// "___" rather than vanishing.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const DUOLINGO_COPY_BUTTON_ID = "learned-word-replacer-duolingo-copy-button";
  // Lucide "copy" and "check" (ISC license), inlined for the same reason as
  // the icons above.
  const DUOLINGO_COPY_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
  const DUOLINGO_COPY_DONE_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  // The answer side of a challenge. The prompt is never inside it, and a
  // container that holds any of it is too wide to be the prompt.
  const DUOLINGO_ANSWER_SELECTOR = [
    "[data-test='word-bank']",
    "[data-test$='challenge-tap-token']",
    "[data-test='challenge-choice']",
    "[data-test='challenge-judge-text']",
    "[data-test='player-footer']",
    "[data-test~='blame']",
    "input",
    "textarea"
  ].join(",");
  const DUOLINGO_COPY_BUTTON_STYLE = [
    "display: inline-flex",
    "align-items: center",
    "justify-content: center",
    "vertical-align: middle",
    "width: 28px",
    "height: 28px",
    "margin: 0 0 0 8px",
    "padding: 0",
    "border: none",
    "border-radius: 8px",
    "background: none",
    "color: rgb(175, 175, 175)",
    "cursor: pointer"
  ].join(";");
  let duolingoCopyObserver = null;
  let duolingoCopyClickListener = null;
  let duolingoCopyResetTimer = null;

  function syncDuolingoCopyPhrase() {
    const shouldRun =
      globalThis === globalThis.top && LWR.isDuolingoHost() && Boolean(LWR.state.duolingoCopyPhrase);

    if (shouldRun && !duolingoCopyObserver) {
      duolingoCopyObserver = new MutationObserver(() => {
        ensureDuolingoCopyButton();
      });
      duolingoCopyObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      // Document capture, not an element listener: Duolingo's slide
      // transitions swap in cloneNode copies of the challenge subtree, and
      // clones silently drop element listeners.
      duolingoCopyClickListener = (event) => {
        const button =
          event.target && event.target.closest
            ? event.target.closest(`[id='${DUOLINGO_COPY_BUTTON_ID}']`)
            : null;
        if (!button) {
          return;
        }
        // The button sits among the prompt's hint tokens, so without this the
        // same click also opens Duolingo's hint popover.
        event.preventDefault();
        event.stopPropagation();
        copyDuolingoPrompt();
      };
      document.addEventListener("click", duolingoCopyClickListener, true);
      ensureDuolingoCopyButton();
    } else if (!shouldRun && duolingoCopyObserver) {
      duolingoCopyObserver.disconnect();
      duolingoCopyObserver = null;
      document.removeEventListener("click", duolingoCopyClickListener, true);
      duolingoCopyClickListener = null;
      removeDuolingoCopyButton();
    }
  }

  function getDuolingoPromptElement() {
    const challenge = LWR.getVisibleDuolingoChallenge("challenge");
    if (!challenge) {
      return null;
    }

    // Class names here are hashed and change with every Duolingo build, so
    // navigate by shape instead: the prompt is what declares a language (or
    // carries Duolingo's own hint-sentence hook) and holds none of the
    // answer-side DOM.
    const candidates = [...challenge.querySelectorAll("[data-test='hint-sentence'],[lang]")].filter(
      (candidate) =>
        candidate.offsetParent !== null &&
        !candidate.closest(DUOLINGO_ANSWER_SELECTOR) &&
        !candidate.querySelector(DUOLINGO_ANSWER_SELECTOR) &&
        readDuolingoPromptText(candidate)
    );
    if (!candidates.length) {
      return null;
    }

    // Gap-fill challenges tag one span per word instead of the sentence, so
    // the first candidate is a single word. Climb to the smallest element
    // holding every candidate that still keeps clear of the answer side.
    let prompt = candidates[0];
    while (!candidates.every((candidate) => prompt.contains(candidate))) {
      const parent = prompt.parentElement;
      if (!parent || parent === challenge || parent.querySelector(DUOLINGO_ANSWER_SELECTOR)) {
        break;
      }
      prompt = parent;
    }

    return prompt;
  }

  const DUOLINGO_PROMPT_BLANK = "___";
  // Empty boxes inside a prompt that are decoration rather than a gap: the
  // hint underline Duolingo lays over each hinted word, and the audio button
  // that sits in the prompt bubble.
  const DUOLINGO_PROMPT_DECORATION_SELECTOR = "[data-test='hint-token'],button,svg,canvas,img";

  function readDuolingoPromptText(element) {
    if (!element) {
      return "";
    }

    return collectDuolingoPromptText(element)
      .replace(/\s+/gu, " ")
      .replace(/\s+([,.!?;:…])/gu, "$1")
      .trim();
  }

  function collectDuolingoPromptText(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.nodeValue || "";
    }

    if (node.nodeType !== Node.ELEMENT_NODE || node.id === DUOLINGO_COPY_BUTTON_ID) {
      return "";
    }

    // Text nodes, not innerText: Duolingo splits every hinted word into
    // per-letter spans with positioned overlays between them, and innerText
    // reads spaces into those gaps ("старі , але"). No text at all, not
    // blank-after-trimming: the spans holding the single spaces between words
    // are boxes with a width too.
    if (!String(node.textContent || "").length) {
      // An empty box that still takes up space is the blank of a gap-fill
      // sentence, and the blank is the part the exercise is about, so it is
      // worth carrying into the clipboard.
      const isBlank =
        !node.matches(DUOLINGO_PROMPT_DECORATION_SELECTOR) &&
        !node.querySelector(DUOLINGO_PROMPT_DECORATION_SELECTOR) &&
        node.getBoundingClientRect().width > 0;
      return isBlank ? ` ${DUOLINGO_PROMPT_BLANK} ` : "";
    }

    let text = "";
    node.childNodes.forEach((child) => {
      text += collectDuolingoPromptText(child);
    });
    return text;
  }

  function removeDuolingoCopyButton() {
    if (duolingoCopyResetTimer) {
      clearTimeout(duolingoCopyResetTimer);
      duolingoCopyResetTimer = null;
    }

    document
      .querySelectorAll(`[id='${DUOLINGO_COPY_BUTTON_ID}']`)
      .forEach((button) => button.remove());
  }

  function ensureDuolingoCopyButton() {
    // Guard every write: this runs from the MutationObserver, so an
    // unconditional append would re-trigger it forever.
    const prompt = getDuolingoPromptElement();

    // Keep exactly one button: the one inside the visible prompt. Anything
    // else is a leftover or a transition-clone copy.
    let keep = null;
    document.querySelectorAll(`[id='${DUOLINGO_COPY_BUTTON_ID}']`).forEach((button) => {
      if (!keep && prompt && button.parentElement === prompt) {
        keep = button;
      } else {
        button.remove();
      }
    });

    if (!prompt || keep) {
      return;
    }

    const button = document.createElement("button");
    button.id = DUOLINGO_COPY_BUTTON_ID;
    button.type = "button";
    // Never in the tab order: Tab belongs to the typing hint ladder.
    button.tabIndex = -1;
    button.innerHTML = DUOLINGO_COPY_ICON;
    button.style.cssText = DUOLINGO_COPY_BUTTON_STYLE;
    resetDuolingoCopyButton(button);
    prompt.appendChild(button);
  }

  function resetDuolingoCopyButton(target) {
    const button = target || document.getElementById(DUOLINGO_COPY_BUTTON_ID);
    if (!button) {
      return;
    }

    button.setAttribute("data-copy-state", "idle");
    button.innerHTML = DUOLINGO_COPY_ICON;
    button.style.color = "rgb(175, 175, 175)";
    button.title = "Copy this phrase";
    button.setAttribute("aria-label", button.title);
  }

  function markDuolingoCopyResult(copied) {
    const button = document.getElementById(DUOLINGO_COPY_BUTTON_ID);
    if (!button) {
      return;
    }

    if (duolingoCopyResetTimer) {
      clearTimeout(duolingoCopyResetTimer);
    }

    button.setAttribute("data-copy-state", copied ? "copied" : "failed");
    button.innerHTML = copied ? DUOLINGO_COPY_DONE_ICON : DUOLINGO_COPY_ICON;
    button.style.color = copied ? "rgb(88, 167, 0)" : "rgb(234, 43, 43)";
    button.title = copied ? "Copied" : "Could not copy the phrase";
    button.setAttribute("aria-label", button.title);
    duolingoCopyResetTimer = setTimeout(() => {
      duolingoCopyResetTimer = null;
      resetDuolingoCopyButton();
    }, 1400);
  }

  function copyDuolingoPrompt() {
    const text = readDuolingoPromptText(getDuolingoPromptElement());
    if (!text) {
      return Promise.resolve(false);
    }

    return writeClipboardText(text).then((copied) => {
      markDuolingoCopyResult(copied);
      return copied;
    });
  }

  function writeClipboardText(text) {
    // navigator.clipboard wants a focused document and a live user gesture;
    // the textarea fallback covers the transitions where it has neither.
    const write =
      navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(text)
        : Promise.reject(new Error("clipboard api unavailable"));

    return write.then(
      () => true,
      () => copyTextWithScratchTextarea(text)
    );
  }

  function copyTextWithScratchTextarea(text) {
    if (!document.body) {
      return false;
    }

    const active = document.activeElement;
    const scratch = document.createElement("textarea");
    scratch.value = text;
    scratch.setAttribute("aria-hidden", "true");
    scratch.style.cssText =
      "position: fixed; top: 0; left: 0; width: 1px; height: 1px; padding: 0; border: none; opacity: 0";
    document.body.appendChild(scratch);
    scratch.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch (error) {
      copied = false;
    }

    scratch.remove();
    // The typing input owns focus for the whole challenge; hand it back.
    if (active && typeof active.focus === "function") {
      active.focus();
    }
    return copied;
  }

  // Reached for by other modules.
  Object.assign(LWR, { syncDuolingoCopyPhrase, copyDuolingoPrompt });
})();
