// Skipping the continue screen, and saying what happened instead.
//
// Duolingo makes you press Continue after every answer. Auto-continue presses
// it, which would throw away the verdict — so the verdict is captured first and
// shown as a toast that does not block the next question. Wrong answers carry
// the correct solution, so those stay up longer.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const DUOLINGO_TOAST_ID = "learned-word-replacer-duolingo-toast";
  let duolingoAutoContinueObserver = null;
  let duolingoToastHideTimer = null;
  let duolingoHandledBlames = new WeakSet();

  function syncDuolingoAutoContinue() {
    const shouldRun =
      globalThis === globalThis.top && LWR.isDuolingoHost() && Boolean(LWR.state.duolingoAutoContinue);

    if (shouldRun && !duolingoAutoContinueObserver) {
      duolingoAutoContinueObserver = new MutationObserver(() => {
        skipDuolingoContinueScreen();
      });
      duolingoAutoContinueObserver.observe(document.documentElement, {
        childList: true,
        subtree: true
      });
      skipDuolingoContinueScreen();
    } else if (!shouldRun && duolingoAutoContinueObserver) {
      duolingoAutoContinueObserver.disconnect();
      duolingoAutoContinueObserver = null;
      duolingoHandledBlames = new WeakSet();
      removeDuolingoToast();
    }
  }

  function skipDuolingoContinueScreen() {
    const blame = document.querySelector("[data-test~='blame']");
    if (!blame || duolingoHandledBlames.has(blame)) {
      return;
    }

    const nextButton = document.querySelector("[data-test='player-next']");
    if (
      !nextButton ||
      nextButton.disabled ||
      nextButton.getAttribute("aria-disabled") === "true"
    ) {
      return;
    }

    duolingoHandledBlames.add(blame);
    const correct = !/\bblame-incorrect\b/.test(blame.getAttribute("data-test") || "");
    // Capture the verdict text before the click tears the footer down.
    const { heading, body } = readDuolingoBlameText(blame);
    showDuolingoToast({ correct, heading, body });
    nextButton.click();
  }

  function readDuolingoBlameText(blame) {
    const lines = String(blame.innerText || "")
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter((line) => line && !/^(report|discuss)$/i.test(line));

    return {
      heading: lines[0] || "",
      body: lines.slice(1).join("\n")
    };
  }

  function removeDuolingoToast() {
    if (duolingoToastHideTimer) {
      clearTimeout(duolingoToastHideTimer);
      duolingoToastHideTimer = null;
    }

    const toast = document.getElementById(DUOLINGO_TOAST_ID);
    if (toast) {
      toast.remove();
    }
  }

  function dismissDuolingoToast(toast) {
    if (duolingoToastHideTimer) {
      clearTimeout(duolingoToastHideTimer);
      duolingoToastHideTimer = null;
    }

    toast.style.opacity = "0";
    toast.style.transform = "translateX(-50%) translateY(12px)";
    setTimeout(() => toast.remove(), 250);
  }

  function showDuolingoToast({ correct, heading, body }) {
    removeDuolingoToast();

    const palette = correct
      ? { background: "rgb(215, 255, 184)", text: "rgb(88, 167, 0)", icon: "✓" }
      : { background: "rgb(255, 223, 224)", text: "rgb(234, 43, 43)", icon: "✕" };

    const toast = document.createElement("div");
    toast.id = DUOLINGO_TOAST_ID;
    toast.style.cssText = [
      "position: fixed",
      "left: 50%",
      "bottom: 24px",
      "transform: translateX(-50%) translateY(12px)",
      "z-index: 2147483647",
      "display: flex",
      "align-items: flex-start",
      "gap: 14px",
      "max-width: min(600px, calc(100vw - 32px))",
      `background: ${palette.background}`,
      "border-radius: 16px",
      "padding: 14px 20px",
      "font-family: 'duolingo-sans', -apple-system, sans-serif",
      "opacity: 0",
      "transition: opacity 0.25s ease, transform 0.25s ease",
      "cursor: pointer",
      "box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14)"
    ].join(";");

    const icon = document.createElement("div");
    icon.textContent = palette.icon;
    icon.style.cssText = [
      "flex: 0 0 auto",
      "width: 36px",
      "height: 36px",
      "border-radius: 50%",
      "background: #ffffff",
      `color: ${palette.text}`,
      "font-size: 22px",
      "font-weight: 700",
      "line-height: 36px",
      "text-align: center"
    ].join(";");
    toast.appendChild(icon);

    const textWrap = document.createElement("div");
    textWrap.style.cssText = "min-width: 0";

    if (heading) {
      const headingEl = document.createElement("div");
      headingEl.textContent = heading;
      headingEl.style.cssText = `color: ${palette.text}; font-size: 17px; font-weight: 700; line-height: 1.3`;
      textWrap.appendChild(headingEl);
    }

    if (body) {
      const bodyEl = document.createElement("div");
      bodyEl.textContent = body;
      bodyEl.style.cssText = `color: ${palette.text}; font-size: 15px; font-weight: 500; line-height: 1.4; margin-top: 2px; white-space: pre-line; overflow-wrap: anywhere`;
      textWrap.appendChild(bodyEl);
    }

    toast.appendChild(textWrap);

    const scheduleHide = (delay) => {
      duolingoToastHideTimer = setTimeout(() => dismissDuolingoToast(toast), delay);
    };

    // Wrong answers carry the correct solution, so leave them up longer.
    const hideDelay = correct ? 2500 : 6000;
    toast.addEventListener("click", () => dismissDuolingoToast(toast));
    toast.addEventListener("mouseenter", () => {
      if (duolingoToastHideTimer) {
        clearTimeout(duolingoToastHideTimer);
        duolingoToastHideTimer = null;
      }
    });
    toast.addEventListener("mouseleave", () => scheduleHide(1500));

    document.documentElement.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = "1";
      toast.style.transform = "translateX(-50%) translateY(0)";
    });
    scheduleHide(hideDelay);
  }

  // Reached for by other modules.
  Object.assign(LWR, { syncDuolingoAutoContinue });
})();
