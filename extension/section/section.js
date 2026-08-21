// Rendering the Sly Fox unit.
//
// The markup below is Duolingo's, harvested node for node from a real unit
// (Section 3, Unit 4) — see build-assets/duolingo-kit/. Nothing here is styled
// by hand: every class name is theirs, and duolingo.css carries their rules.
//
// The geometry is theirs too. Their path is a wave with a fixed set of stops,
// not a formula worth guessing at, so LAYOUT below is the measured table from
// that same unit: the same left offsets, the same margins, in the same order.
(() => {
  // What a legendary run of a finished puck is worth, matching the figure on
  // their own LEGENDARY button.
  const LEGENDARY_XP = 40;

  // Lucide's `rotate-ccw` (ISC), copied verbatim from lucide-icons/lucide.
  // Duolingo has no "wipe this puck" control to lift a glyph from, because
  // Duolingo has no such control.
  const ROTATE_CCW = [
    "M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8",
    "M3 3v5h5"
  ];

  function buildResetIcon() {
    const svg = svgEl("svg", {
      xmlns: "http://www.w3.org/2000/svg",
      viewBox: "0 0 24 24",
      width: "20",
      height: "20",
      fill: "none",
      stroke: "currentColor",
      "stroke-width": "2",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "aria-hidden": "true"
    });
    for (const d of ROTATE_CCW) {
      svg.append(svgEl("path", { d }));
    }
    return svg;
  }

  const ASSET = {
    starActive: "assets/path/ef9c771afdb674f0ff82fae25c6a7b0a.svg",
    starLocked: "assets/path/ddd21f172a2db0f5ef169c09b4d3badb.svg",
    dumbbell: "assets/path/09f58d40e31d28e089395af4c54d0c20.svg",
    trophy: "assets/path/7d84afaa096ff1f1d3f8c86d6c2c9542.svg",
    // The white tick a finished puck wears in place of its star. Theirs comes
    // in two fills; this is the white one, the gold `53727b0c…` being for the
    // legendary puck.
    check: "assets/path/bfa591f6854b4de08e1656b3e8ca084f.svg",
    chest: "assets/path/b841637c196f5be786d8b8578a42ffbf.svg",
    back: "assets/path/e013fd27fc6bd1d2fea85fe707b615cd.svg",
    guidebook: "assets/path/5b531828e59ae83aadb3d88e6b3a98a8.svg",
    character: "assets/characters/bea_smores_012.json"
  };

  // Duolingo themes a unit by class, not by a colour value: the class sets
  // --path-unit-{background,foreground,character}-color and everything from the
  // banner to the progress ring reads those. _2wsIu is their beetle purple and
  // M7Jo3 is the matching banner. Swapping these two swaps the whole unit.
  const UNIT_THEME_CLASS = "_2wsIu";
  const BANNER_THEME_CLASS = "M7Jo3";

  const SECTION_STORAGE_KEY = "learnedWordReplacerSection";

  // Which unit this page shows. A unit is one file in units/ holding its name,
  // its pucks and every lesson in them -- so a whole unit is one thing to write
  // and one thing to check, rather than a folder of loose lessons plus a list
  // saying how they go together.
  const DEFAULT_UNIT = "around-the-house";

  // Used when a unit file cannot be read, so the page still draws something
  // rather than sitting blank.
  const FALLBACK_UNIT = {
    slug: "",
    sectionLabel: "SLY FOX SECTION, UNIT 1",
    title: "Words you have learned",
    pucks: [
      { kind: "skill", label: "New words", art: "star", lessons: 4 },
      { kind: "chest" },
      { kind: "skill", label: "New words", art: "star", lessons: 4 },
      { kind: "practice", label: "Review", art: "dumbbell", lessons: 2 },
      { kind: "practice", label: "Review", art: "star", lessons: 4 },
      { kind: "chest" },
      { kind: "unit_review", label: "Unit review", art: "trophy", lessons: 2 }
    ]
  };

  let unit = FALLBACK_UNIT;

  // The path geometry is fixed at seven stops, so a unit's pucks are dropped
  // into the five non-chest slots in order. A unit with fewer pucks simply
  // leaves the later ones out.
  const PUCK_SLOTS = [0, 2, 3, 4, 6];
  const CHEST_SLOTS = [1, 5];

  // A locked star is drawn grey; the dumbbell and trophy carry their own
  // colour in the asset, so they do not change with state. A finished lesson or
  // practice puck drops its face for a tick, which is how their path shows a
  // puck is done. The trophy keeps its own -- a finished unit review is still a
  // trophy on their path, not a tick.
  const ICONS = {
    star: { locked: "starLocked", active: "starActive", done: "check" },
    dumbbell: { locked: "dumbbell", active: "dumbbell", done: "check" },
    trophy: { locked: "trophy", active: "trophy", done: "trophy" }
  };

  // Lay the unit's pucks along the seven path stops, then fold in saved
  // progress. Chests sit between pucks and are never "done"; they ride along.
  function applyProgress(saved) {
    const counts = (saved && saved.nodes) || {};
    const list = [];
    for (const slot of CHEST_SLOTS) {
      list[slot] = { kind: "chest", index: slot };
    }

    let currentFound = false;
    unit.pucks
      .filter((puck) => puck.kind !== "chest")
      .slice(0, PUCK_SLOTS.length)
      .forEach((puck, order) => {
        const slot = PUCK_SLOTS[order];
        const total = Math.max(1, Number(puck.lessons) || (puck.lessonList || []).length || 1);
        const done = Math.min(total, Number(counts[slot]) || 0);
        let state = "locked";
        if (done >= total) {
          state = "done";
        } else if (!currentFound) {
          state = "active";
          currentFound = true;
        }
        list[slot] = {
          ...puck,
          index: slot,
          order,
          lessons: total,
          done,
          state,
          art: puck.art || "star",
          icon: ICONS[puck.art || "star"][state]
        };
      });

    return list.filter(Boolean);
  }

  // Where the whole unit comes from.
  async function loadUnit() {
    const slug = new URLSearchParams(globalThis.location.search).get("unit") || DEFAULT_UNIT;
    if (!/^[a-z0-9-]+$/i.test(slug)) {
      return FALLBACK_UNIT;
    }
    const response = await fetch(`units/${slug}.json`).catch(() => null);
    if (!response || !response.ok) {
      return FALLBACK_UNIT;
    }
    const raw = await response.json();
    const pucks = (raw.pucks || []).map((puck) => ({
      ...puck,
      lessonList: puck.lessons && Array.isArray(puck.lessons) ? puck.lessons : null,
      lessons: Array.isArray(puck.lessons) ? puck.lessons.length : Number(puck.lessons) || 1
    }));
    return {
      slug,
      sectionLabel: raw.sectionLabel || FALLBACK_UNIT.sectionLabel,
      title: raw.title || FALLBACK_UNIT.title,
      theme: raw.theme || null,
      pucks: pucks.length ? pucks : FALLBACK_UNIT.pucks
    };
  }

  // Measured from the reference unit, in the same order as NODES.
  const LAYOUT = [
    { left: 0, marginTop: 67 },
    { left: -44.884, marginTop: 11.8533 },
    { left: -70, marginTop: 20.3826 },
    { left: -44.884, marginTop: 20.3826 },
    { left: 0, marginTop: 11.8533 },
    { left: 44.884, marginTop: 11.8533 },
    { left: 0, marginTop: 11.8533, marginBottom: 24 }
  ];

  // Their annulus, verbatim: outer r=50, inner r=42, so an 8px ring centred on
  // r=46 in a 100x100 box.
  const RING_TRACK =
    "M3.061616997868383e-15,-50A50,50,0,1,1,-3.061616997868383e-15,50A50,50,0,1,1," +
    "3.061616997868383e-15,-50M-7.715274834628325e-15,-42A42,42,0,1,0," +
    "7.715274834628325e-15,42A42,42,0,1,0,-7.715274834628325e-15,-42Z";
  const RING_RADIUS = 46;
  const RING_WIDTH = 8;

  const svgNS = "http://www.w3.org/2000/svg";

  function el(tag, className, attrs) {
    const node = document.createElement(tag);
    if (className) {
      node.className = className;
    }
    for (const [key, value] of Object.entries(attrs || {})) {
      node.setAttribute(key, value);
    }
    return node;
  }

  function svgEl(tag, attrs) {
    const node = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attrs || {})) {
      node.setAttribute(key, value);
    }
    return node;
  }

  // The ring around the active puck. At zero progress this is their track path
  // and nothing else, which is exactly what a freshly opened unit shows. Above
  // zero it also draws the swept arc and the white dot at its leading edge —
  // same centre radius, same width, same round cap as theirs, drawn as a dashed
  // stroke because their fill path is generated per-fraction and is not
  // something to guess at.
  function buildProgressRing(fraction) {
    const svg = svgEl("svg", { class: "_2FMGJ", viewBox: "0 0 100 100" });
    const group = svgEl("g", { transform: "translate(50, 50)" });
    group.append(svgEl("path", { d: RING_TRACK, fill: "rgb(var(--color-swan))" }));

    if (fraction > 0) {
      const circumference = 2 * Math.PI * RING_RADIUS;
      group.append(
        svgEl("circle", {
          cx: 0,
          cy: 0,
          r: RING_RADIUS,
          fill: "none",
          stroke: "var(--path-unit-character-color)",
          "stroke-width": RING_WIDTH,
          "stroke-linecap": "round",
          "stroke-dasharray": `${circumference * fraction} ${circumference}`,
          transform: "rotate(-90)"
        })
      );
      const angle = -Math.PI / 2 + 2 * Math.PI * fraction;
      group.append(
        svgEl("circle", {
          cx: Math.cos(angle) * RING_RADIUS,
          cy: Math.sin(angle) * RING_RADIUS,
          r: RING_WIDTH / 1.2,
          fill: "rgb(var(--color-snow))"
        })
      );
    }

    svg.append(group);
    return svg;
  }

  // Their speech bubble is one primitive used three ways — the START flag here,
  // the hint popover in a lesson, the lesson popover below. Root, body, tail;
  // only the modifier classes change.
  function buildBubble(rootClasses, bodyClasses, tailClasses, contents) {
    const root = el("div", rootClasses);
    const body = el("div", bodyClasses);
    body.append(...contents);
    const tailWrap = el("div", "_3T97b");
    tailWrap.append(el("div", tailClasses));
    root.append(body, tailWrap);
    root.style.zIndex = "1";
    return root;
  }

  function buildStartFlag() {
    const bubble = buildBubble("_3zpnU _37pE2 _1o3g5 _kJVz", "_36bu_ _27IMa", "_1TMn5 YxHCU", [
      document.createTextNode("START")
    ]);

    const positioner = el("div", "_2nwbo", { "aria-hidden": "true" });
    const a = el("div");
    const b = el("div");
    b.append(bubble);
    a.append(b);
    positioner.append(a);
    return positioner;
  }

  function buildChest(layout) {
    const wrap = el("div", "R7x3_ _8Iu6E");
    applyLayout(wrap, layout);
    const button = el("button", "_2wryV _1gEmM _7jW2t _2vzTv", {
      disabled: "",
      "aria-label": "Chest"
    });
    const span = el("span", "_9lHjd");
    span.append(el("img", "TI9Is", { src: ASSET.chest, alt: "" }));
    button.append(span);
    wrap.append(button);
    return wrap;
  }

  function buildPuck(node, index, layout) {
    const wrap = el("div", "R7x3_ _8Iu6E");
    applyLayout(wrap, layout);

    const hit = el("div", "HPdUG fF_qH", { role: "button", tabindex: "-1" });
    hit.dataset.slyFoxNode = String(index);

    const isActive = node.state === "active";
    const buttonClass =
      node.state === "locked"
        ? "_1gEmM _7jW2t G_Z0K _3Jm09"
        : "_1gEmM _7jW2t _1333i _22TV_ _3Jm09";
    const button = el("button", buttonClass, {
      "data-test": `skill-path-level-${index} skill-path-level-${node.kind}`,
      "aria-label": isActive ? `Lesson ${node.done + 1} of ${node.lessons}` : node.label
    });
    button.append(el("img", "_1B6UH", { alt: "", draggable: "false", src: ASSET[node.icon] }));

    // Only the current puck carries the ring, and only it gets the extra
    // _1xsb4 margin that keeps the ring clear of its neighbours. A finished
    // puck has nothing left to show progress towards, so on their path the ring
    // goes with the last lesson and the puck stands on its own wearing a tick.
    if (isActive) {
      hit.append(buildProgressRing(node.done / node.lessons));
    }
    const inner = el("div", isActive ? "_1xsb4 _2t1Sd Fw74a" : "_2t1Sd Fw74a");
    inner.append(button);
    if (isActive) {
      inner.append(buildStartFlag());
    }
    hit.append(inner);

    wrap.append(hit);
    return wrap;
  }

  function applyLayout(wrap, layout) {
    wrap.style.left = `${layout.left}px`;
    wrap.style.marginTop = `${layout.marginTop}px`;
    wrap.style.marginBottom = `${layout.marginBottom || 0}px`;
  }

  function buildBanner() {
    const banner = el("div", `PsNCe ${BANNER_THEME_CLASS}`);

    const back = el("a", "_3HqVu", { href: "https://www.duolingo.com/sections" });
    back.append(el("img", null, { src: ASSET.back, alt: "" }));
    const label = el("h1", "_3WYpp");
    label.textContent = unit.sectionLabel;
    back.append(label);

    const name = el("span", "U_xpg");
    name.textContent = unit.title;

    const guidebook = el("a", "_1ORKS _1yhVg _2V6ug _1ursp _7jW2t", {
      href: "https://www.duolingo.com/practice-hub/words",
      "aria-label": "Opens the words you have learned"
    });
    guidebook.append(el("img", "uGhFr", { alt: "Guidebook", src: ASSET.guidebook }));
    const guidebookLabel = el("span", "_30k3d");
    guidebookLabel.textContent = "Guidebook";
    guidebook.append(guidebookLabel);

    banner.append(back, name, guidebook);
    return banner;
  }

  let nodes = [];

  function buildUnit() {
    const section = el("section", `${UNIT_THEME_CLASS} _2eIKy`, {
      "data-test": "sly-fox-unit"
    });

    const header = el("header", "_10Xfk");
    const title = el("h2", "_3qGKs");
    title.textContent = unit.title;
    header.append(el("hr", "_1JA0o"), title, el("hr", "_1JA0o"));

    const body = el("div", "_2QaYj");

    // Their walking character sits absolutely against the path, offset from the
    // centre line. The measurements are the reference unit's.
    const character = el("div", "_3jOjF");
    character.style.cssText =
      "height: 260.765px; left: calc(50% - 19px); top: 314.736px; transform: translateY(-50%); width: calc(50% + 3px);";
    const characterMount = el("span", "u_TP- fs-exclude _1bppN");
    character.append(characterMount);
    body.append(character);

    nodes.forEach((node, index) => {
      const layout = LAYOUT[index];
      body.append(node.kind === "chest" ? buildChest(layout) : buildPuck(node, index, layout));
    });

    section.append(header, body);
    return { section, characterMount };
  }

  // The lesson popover, anchored under whichever puck was clicked. Same bubble
  // primitive as the START flag, wearing their popover skin. _3OfAS._1o3g5
  // already centres it under its anchor and puts the tail in the middle, so no
  // positioning of our own goes on it — Duolingo only writes inline transforms
  // here because their copy is portalled out to the page root and has to be
  // placed by Popper.
  function buildLessonPopover(node) {
    const heading = el("h1", "QPQgr");
    heading.textContent = node.label;
    const headingWrap = el("div", "_2TJrM");
    headingWrap.append(heading);

    const progress = el("p", "_21efi");
    progress.textContent =
      node.state === "locked"
        ? `${node.lessons} lessons`
        : node.state === "done"
          ? "Complete"
          : `Lesson ${node.done + 1} of ${node.lessons}`;

    const start = el("a", "_1rcV8 _1VYyp _1ursp _7jW2t PbV1v _2sYfM _19ped", { href: "#" });
    start.dataset.slyFoxStart = "true";
    start.dataset.slyFoxLocked = node.state === "locked" ? "true" : "false";
    start.dataset.slyFoxNodeIndex = String(node.index);
    if (unit.slug) {
      start.dataset.slyFoxUnit = unit.slug;
      start.dataset.slyFoxPuck = String(node.order);
      // Each puck holds several lessons; play the next one it has not finished.
      start.dataset.slyFoxLessonIndex = String(Math.min(node.done, node.lessons - 1));
    }
    start.textContent =
      node.state === "done" ? "Practice +5 XP" : node.state === "active" ? "Start +10 XP" : "Locked";

    const inner = el("div", "u_Jo7 _2yBgn");
    inner.append(headingWrap, progress, start);

    // A finished puck grows a second, gold button underneath — their
    // LEGENDARY. ._1nf5N is the bee/camel/cowbird button variant they paint it
    // with. It replays the whole puck with the hints taken away.
    if (node.state === "done" && unit.slug) {
      const legendary = el("a", "_1rcV8 _1VYyp _1ursp _7jW2t PbV1v _2sYfM _1nf5N", { href: "#" });
      legendary.dataset.slyFoxStart = "true";
      legendary.dataset.slyFoxLocked = "false";
      legendary.dataset.slyFoxNodeIndex = String(node.index);
      legendary.dataset.slyFoxUnit = unit.slug;
      legendary.dataset.slyFoxPuck = String(node.order);
      legendary.dataset.slyFoxLegendary = "true";
      legendary.textContent = `Legendary +${LEGENDARY_XP} XP`;
      inner.append(legendary);
    }

    // Ours, not theirs: a way to put a puck back to untouched. Duolingo has no
    // such thing, so it wears their borderless text-button classes rather than
    // anything invented -- .bafGS is transparent with no border, ._3qh60 lays
    // an icon and a label out in a column-flow grid, ._2caIK is the 20px icon
    // slot, ._2Rt1l the uppercase label, ._1yHHi the snow text of the path.
    //
    // Wiping progress is annoying to do by accident and trivial to redo on
    // purpose, so it asks once rather than opening a dialog: the first tap arms
    // it, the second does it, and it disarms itself after a few seconds.
    if (node.done > 0 && unit.slug) {
      // .bafGS alone: transparent, no border, no padding. The button variants
      // that go with it elsewhere (._2LoNU, .VzbUl) paint a fill from the
      // web-ui button variable, which on this popover came out macaw blue.
      // .__UZi and not ._1yHHi: the latter is snow text *and* a macaw fill, so
      // the button came out bright blue on the popover. This one is a single
      // colour-only rule.
      const reset = el("button", "bafGS _1AgKJ __UZi", { type: "button" });
      reset.style.marginTop = "12px";
      reset.dataset.slyFoxReset = "true";
      reset.dataset.slyFoxUnit = unit.slug;
      reset.dataset.slyFoxNodeIndex = String(node.index);
      const row = el("span", "_3qh60");
      const slot = el("span", "_2caIK");
      slot.append(buildResetIcon());
      const label = el("span", "_2Rt1l");
      label.textContent = node.state === "done" ? "Reset this puck" : "Reset progress";
      row.append(slot, label);
      reset.append(row);
      inner.append(reset);
    }

    const bubble = buildBubble(
      "_3zpnU _3OfAS _1o3g5 _2dBq4 _27rki",
      "_36bu_ _3RP1Q _1Fbw-",
      "_1TMn5 _1Fbw-",
      [inner]
    );
    bubble.dataset.slyFoxPopover = "true";
    return bubble;
  }

  function closePopover() {
    document.querySelectorAll("[data-sly-fox-popover]").forEach((node) => node.remove());
  }

  function openPopover(hit, index) {
    closePopover();
    const node = nodes[index];
    if (!node || node.kind === "chest") {
      return;
    }

    // _3zpnU._1o3g5 is absolutely positioned, so the puck it hangs off has to
    // be the containing block.
    hit.style.position = "relative";
    hit.append(buildLessonPopover(node));
  }

  function mountCharacter(mount) {
    if (typeof lottie === "undefined") {
      return;
    }
    lottie.loadAnimation({
      container: mount,
      renderer: "svg",
      loop: true,
      autoplay: true,
      path: ASSET.character
    });
  }

  // Put one puck back to untouched. Only that puck's count is removed, so the
  // rest of the unit keeps its progress -- and because the pucks after it are
  // locked behind it, wiping one naturally re-locks what came after.
  let disarm = null;

  function handleReset(button) {
    const label = button.querySelector("._2Rt1l");

    if (button.dataset.slyFoxArmed !== "true") {
      button.dataset.slyFoxArmed = "true";
      if (label) {
        button.dataset.slyFoxLabel = label.textContent;
        label.textContent = "Tap again to wipe it";
      }
      clearTimeout(disarm);
      disarm = setTimeout(() => {
        button.dataset.slyFoxArmed = "false";
        if (label && button.dataset.slyFoxLabel) {
          label.textContent = button.dataset.slyFoxLabel;
        }
      }, 4000);
      return;
    }

    clearTimeout(disarm);
    const slug = button.dataset.slyFoxUnit;
    const index = button.dataset.slyFoxNodeIndex;
    chrome.storage.local.get({ [SECTION_STORAGE_KEY]: null }, (stored) => {
      const saved = stored[SECTION_STORAGE_KEY] || { version: 2, units: {} };
      const units = { ...(saved.units || {}) };
      const nodes = { ...((units[slug] || {}).nodes || {}) };
      delete nodes[index];
      units[slug] = { nodes };
      chrome.storage.local.set({ [SECTION_STORAGE_KEY]: { version: 2, units } }, () => {
        globalThis.location.reload();
      });
    });
  }

  function render() {
    loadUnit().then((loaded) => {
      unit = loaded;
      chrome.storage.local.get({ [SECTION_STORAGE_KEY]: null }, (stored) => {
        const saved = stored[SECTION_STORAGE_KEY];
        const forUnit = saved && saved.units ? saved.units[unit.slug] : saved;
        nodes = applyProgress(forUnit);
        draw();
      });
    });
  }

  function draw() {
    const bannerHost = document.getElementById("sly-fox-unit-banner");
    const pathHost = document.getElementById("sly-fox-path");
    if (!bannerHost || !pathHost) {
      return;
    }

    bannerHost.append(buildBanner());

    const { section, characterMount } = buildUnit();
    // Duolingo positions each unit absolutely because it virtualises the path.
    // One unit needs none of that, so it stays in normal flow.
    section.style.width = "100%";
    pathHost.append(section);
    mountCharacter(characterMount);

    document.addEventListener("click", (event) => {
      const reset = event.target.closest("[data-sly-fox-reset]");
      if (reset) {
        event.preventDefault();
        handleReset(reset);
        return;
      }

      const start = event.target.closest("[data-sly-fox-start]");
      if (start) {
        event.preventDefault();
        if (start.dataset.slyFoxLocked !== "true") {
          const query = new URLSearchParams({ node: start.dataset.slyFoxNodeIndex });
          if (start.dataset.slyFoxUnit) {
            query.set("unit", start.dataset.slyFoxUnit);
            query.set("puck", start.dataset.slyFoxPuck);
            if (start.dataset.slyFoxLegendary === "true") {
              query.set("legendary", "1");
            } else {
              query.set("lesson", start.dataset.slyFoxLessonIndex);
            }
          }
          globalThis.location.href = `lesson.html?${query}`;
        }
        closePopover();
        return;
      }

      const hit = event.target.closest("[data-sly-fox-node]");
      if (!hit) {
        closePopover();
        return;
      }

      if (hit.querySelector("[data-sly-fox-popover]")) {
        closePopover();
        return;
      }

      openPopover(hit, Number(hit.dataset.slyFoxNode));
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", render, { once: true });
  } else {
    render();
  }
})();
