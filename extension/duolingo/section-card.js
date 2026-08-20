// The Sly Fox card on duolingo.com/sections.
//
// It sits between the last real section and Daily Refresh, and opens our own
// section page. Everything it wears is Duolingo's: the card, the progress bar
// and the button are all built from their class names, so the card inherits
// their stylesheet on their page and needs no CSS of its own.
//
// The class names are per-build hashes and will change when Duolingo redeploys.
// That is deliberate — a hand-written lookalike drifts out of step with the
// real cards every time they retouch them, and this way the card is either
// exactly right or obviously unstyled. When it goes unstyled, re-harvest:
// build-assets/duolingo-kit/README.md says how.
//
// Nothing here clones a live node. Duolingo's own cards are the reference, not
// the source: the template below was harvested once, deliberately, and the card
// is built from it every time. Cloning whatever happened to be mounted is how
// the earlier attempt at this ended up redrawing itself differently depending
// on where the user had scrolled.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const SECTION_CARD_ID = "learned-word-replacer-duolingo-section-card";

  // Duolingo colours a section card by persona, one class per persona, and
  // pairs each with a matching button and trophy class. Trailblazer is the one
  // after traveler and is unused on a three-section course, so the card reads
  // as the next thing along rather than as a copy of a section already there.
  const CARD_CLASS = "dn7Jh _2E1uv _3AIkT";
  const BUTTON_CLASS = "_3xDVI _2V6ug _1ursp _7jW2t _34tbO _3RMj4";
  const TROPHY_CLASS = "_1kZ3q _2vCwR _2fQ7v";
  const PROGRESS_COLOR = "rgb(var(--color-trailblazer-progress-bar))";

  const SECTION_TITLE = "Sly Fox";
  // Five pucks: 4 + 4 + 2 + 4 + 2.
  const TOTAL_LESSONS = 16;

  function completedLessons() {
    // Nothing tracks per-lesson progress yet, so the bar starts empty rather
    // than inventing a number.
    return 0;
  }

  function buildProgressBar(done, total) {
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;

    const bar = document.createElement("div");
    bar.className = "oCRfA _2Zy4j";
    bar.setAttribute("role", "progressbar");
    bar.setAttribute("aria-valuemin", "0");
    bar.setAttribute("aria-valuemax", String(total));
    bar.setAttribute("aria-valuenow", String(done));
    bar.style.cssText = [
      `--web-ui_progress-bar-color: ${PROGRESS_COLOR}`,
      "--web-ui_progress-bar-shine-height: 3px",
      "--__internal__progress-bar-height: 18px",
      "--__internal__progress-bar-inner-value: 0%",
      `--__internal__progress-bar-value: ${percent}%`
    ].join("; ");

    const track = document.createElement("div");
    track.className = "_3yKMC";

    const restLabel = document.createElement("span");
    restLabel.className = "_3a7rM _2spfn _2G_th";
    restLabel.textContent = `${percent}%`;

    // The filled half carries its own copy of the label, clipped to the fill,
    // so the digits flip from grey to white as the bar passes them.
    const fill = document.createElement("div");
    fill.className = "_27NV6";
    fill.style.opacity = "1";
    const inner = document.createElement("div");
    inner.className = "_1qzJe _27NV6";
    const shine = document.createElement("div");
    shine.className = "_1EFTr";
    const fillLabel = document.createElement("span");
    fillLabel.className = "_2spfn _2G_th";
    fillLabel.textContent = `${percent}%`;
    fill.append(inner, shine, fillLabel);

    const cap = document.createElement("div");
    cap.className = "_345XU";
    cap.style.opacity = "1";
    cap.append(Object.assign(document.createElement("div"), { className: "BR3lm" }));

    track.append(restLabel, fill, cap);
    bar.append(track);
    return bar;
  }

  function buildTrophy() {
    const holder = document.createElement("span");
    holder.className = TROPHY_CLASS;
    const img = document.createElement("img");
    img.alt = "";
    img.src = chrome.runtime.getURL("section/assets/pathSections/section-trophy.svg");
    img.width = 37;
    img.height = 31;
    holder.append(img);
    return holder;
  }

  function buildSectionCard() {
    const card = document.createElement("div");
    card.id = SECTION_CARD_ID;
    card.className = CARD_CLASS;
    card.dataset.lwrUi = "true";

    const body = document.createElement("div");
    body.className = "CQzMM";

    const title = document.createElement("h1");
    title.className = "_39RQh";
    title.textContent = SECTION_TITLE;

    const barHolder = document.createElement("div");
    barHolder.className = "_1Hfnb";
    barHolder.append(buildProgressBar(completedLessons(), TOTAL_LESSONS), buildTrophy());

    const buttonHolder = document.createElement("div");
    buttonHolder.className = "m1PXJ";
    const button = document.createElement("button");
    button.className = BUTTON_CLASS;
    const buttonLabel = document.createElement("span");
    buttonLabel.className = "_9lHjd";
    buttonLabel.textContent = "Continue";
    button.append(buttonLabel);
    buttonHolder.append(button);

    body.append(title, barHolder, buttonHolder);

    const art = document.createElement("img");
    art.className = "_3QVLi _2JmsE";
    art.alt = "";
    art.src = chrome.runtime.getURL("icons/logo-192.png");

    card.append(body, art);
    return card;
  }

  // The last card in the list is Daily Refresh, which is locked and so has no
  // button; every real section has one. Anchoring on that rather than on a
  // count keeps us in the right place on courses with more or fewer sections,
  // and on the sections page of a course that has no Daily Refresh at all.
  //
  // Our own card is skipped. It carries a heading and a button like a real
  // section does, so counting it would make it its own anchor: the card would
  // never match where it was supposed to sit, get removed and re-inserted, and
  // the MutationObserver that called us would see that and call us again.
  function findInsertionPoint() {
    const cards = new Map();
    for (const heading of document.querySelectorAll("h1")) {
      const card = heading.parentElement && heading.parentElement.parentElement;
      const list = card && card.parentElement;
      if (!list || (card.id === SECTION_CARD_ID)) {
        continue;
      }
      if (!cards.has(list)) {
        cards.set(list, []);
      }
      cards.get(list).push(card);
    }

    let best = null;
    for (const [list, members] of cards) {
      if (!best || members.length > best.members.length) {
        best = { list, members };
      }
    }
    if (!best || best.members.length < 2) {
      return null;
    }

    const unlocked = best.members.filter((card) => card.querySelector("button"));
    const anchor = unlocked[unlocked.length - 1] || best.members[best.members.length - 1];
    return { list: best.list, after: anchor };
  }

  function ensureDuolingoSectionCard() {
    if (globalThis !== globalThis.top || !LWR.isDuolingoSectionsPage()) {
      document.getElementById(SECTION_CARD_ID)?.remove();
      return;
    }

    // Deliberately not gated on state.enabled. That switch turns off replacing
    // words on pages; it does not turn off the extension's own surfaces inside
    // Duolingo, which is the same rule the Words-page button and the settings
    // panel follow.
    const existing = document.getElementById(SECTION_CARD_ID);
    const target = findInsertionPoint();
    if (!target) {
      return;
    }

    // Duolingo re-renders the list on navigation, which can leave the card
    // orphaned or in the wrong slot; put it back rather than adding a second.
    if (existing) {
      if (existing.previousElementSibling === target.after) {
        return;
      }
      existing.remove();
    }

    target.after.insertAdjacentElement("afterend", buildSectionCard());
  }

  function openDuolingoSectionPage() {
    globalThis.location.href = chrome.runtime.getURL("section/section.html");
  }

  Object.assign(LWR, {
    DUOLINGO_SECTION_CARD_ID: SECTION_CARD_ID,
    ensureDuolingoSectionCard,
    openDuolingoSectionPage
  });
})();
