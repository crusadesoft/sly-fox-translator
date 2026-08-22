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

  // Duolingo themes a unit by class, not by a colour value: the unit class sets
  // --path-unit-{background,foreground,character}-color and everything from the
  // path to the progress ring reads those, while the banner carries a matching
  // background-color of its own. Their path cycles a palette as it runs down a
  // section -- unit 4 owl green, unit 5 fox orange -- so this cycles too. Every
  // class here is theirs, read off duolingo.css; the pairs have to be kept
  // together or the banner stops matching the path under it.
  // `shine` is the third of the set: the polish on a finished puck takes its
  // colour from a character class, and each one is a lighter tint of exactly
  // one unit colour -- beetle 206,130,255 against lily 214,150,255, owl 88,204,2
  // against duo 114,214,39, and so on down the table. Pairing them any other way
  // puts a blue gleam on a purple puck, which is what happens if the class is
  // simply hardcoded.
  const THEMES = [
    { unit: "_2wsIu", banner: "M7Jo3", shine: "l3IH9" },
    { unit: "Q_oEI", banner: "_2Iw0k", shine: "MpveL" },
    { unit: "_1cX5c", banner: "LJB6r", shine: "_2NI9y" },
    { unit: "_3gcXg", banner: "_3JOb1", shine: "_2kXhi" },
    { unit: "_1hrxW", banner: "_2bAvg", shine: "_17Msq" },
    { unit: "_2yUGi", banner: "_1g6lo", shine: "_2-9on" }
  ];

  // A unit may name its own theme by its unit class; otherwise it takes the
  // next colour along, which is what keeps two neighbours from matching.
  function themeFor(index, named) {
    return (named && THEMES.find((theme) => theme.unit === named)) || THEMES[index % THEMES.length];
  }

  const SECTION_STORAGE_KEY = "learnedWordReplacerSection";

  // The units on the path, in order. A unit is one file in units/ holding its
  // name, its pucks and every lesson in them. Duolingo stacks a whole section
  // into one scroll rather than showing a unit at a time, so this is the
  // section; ?unit=<slug> still narrows the page to a single one.
  const UNITS = ["at-home", "in-the-dark"];

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

  // Every unit on the page, in path order, each with its own theme and its own
  // pucks. The builders below work on one unit at a time -- `unit` for its name
  // and slug, `nodes` for its pucks -- so `use` says which one that is. Drawing
  // walks the stack; a click resolves back to the unit it landed in.
  let stack = [];
  let current = null;

  function use(record) {
    current = record;
    unit = record.unit;
    nodes = record.nodes;
  }

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
  function applyProgress(saved, source) {
    const counts = (saved && saved.nodes) || {};
    const list = [];
    for (const slot of CHEST_SLOTS) {
      list[slot] = { kind: "chest", index: slot };
    }

    let currentFound = false;
    source.pucks
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

  // Where one unit comes from. A unit that cannot be read is left out of the
  // path rather than replaced by the fallback, which would otherwise appear
  // once per broken file; render() falls back only if nothing loads at all.
  async function loadUnit(slug) {
    if (!/^[a-z0-9-]+$/i.test(slug)) {
      return null;
    }
    // YAML, read by the vendored js-yaml. A missing file rejects the fetch on
    // chrome-extension:// rather than answering 404, and a broken one throws
    // out of the parser; either way the built-in unit stands in.
    const response = await fetch(`units/${slug}.yaml`).catch(() => null);
    if (!response || !response.ok) {
      return null;
    }
    let raw;
    try {
      raw = jsyaml.load(await response.text());
    } catch (error) {
      console.warn(`[sly-fox] units/${slug}.yaml is not valid YAML:`, error.message);
      return null;
    }
    if (!raw || typeof raw !== "object") {
      return null;
    }
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

  // The START flag bobs, and it is not a CSS animation -- theirs runs through
  // the Web Animations API. That is why it shows up in no stylesheet and leaves
  // animationName reading "none", and why harvesting their markup captured the
  // two class-less divs it hangs off while missing the movement entirely. The
  // spec below is read straight off a live path: a second, ease-out, alternating
  // forever, from resting to 8px up. The two bare divs are theirs, not padding
  // -- the outer one positions and the inner one is what moves.
  const START_BOB = [{ transform: "none" }, { transform: "translateY(-8px)" }];
  const START_BOB_TIMING = {
    duration: 1000,
    iterations: Infinity,
    direction: "alternate",
    easing: "ease-out",
    fill: "backwards"
  };

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

    // Someone who has asked for less motion keeps the flag and loses the bob.
    const still =
      globalThis.matchMedia && globalThis.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!still && b.animate) {
      b.animate(START_BOB, START_BOB_TIMING);
    }
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

  // The shine on a finished puck: two slivers of lighter colour arcing across
  // its face, which is what makes it read as polished rather than flat. Unlike
  // the path art this one is an inline SVG in their own markup rather than a
  // file on their CDN, so the geometry is vendored here the way the Lucide
  // glyph above is. It fills with currentColor, so it takes the puck's colour
  // from --path-level-color without being told what that colour is.
  const PUCK_SHINE = [
    "M34.2346 3.25135C35.3157 2.1269 34.7053 0.276787 33.1512 0.143156C32.0512 0.0485729 30.9331 0 29.8002 0C13.342 0 0 10.2517 0 22.8979C0 26.3985 1.02236 29.7157 2.85016 32.6827C3.47761 33.7012 4.88715 33.7751 5.71626 32.9128L34.2346 3.25135Z",
    "M55.0954 12.5231C53.3548 9.61289 49.8186 6.8733 47.2219 5.21074C46.2417 4.58319 44.9772 4.77038 44.1616 5.60066C34.5035 15.4328 18.3374 31.8498 12.05 38.0427C10.9724 39.1041 10.996 40.8688 12.249 41.716C16.2271 44.4058 20.9121 45.5851 23.4852 45.9072C24.1853 45.9949 24.8657 45.7259 25.3691 45.2315C34.775 35.9934 50.2041 19.9015 54.7166 15.0879C55.3787 14.3818 55.5923 13.3539 55.0954 12.5231Z"
  ];

  function buildPuckShine() {
    // _1IwKR positions it and carries the gold used by a legendary puck; the
    // theme's own class overrides that colour for an ordinary finished one.
    const holder = el("span", `_1kZ3q ${current.theme.shine} _1IwKR`);
    const svg = svgEl("svg", {
      width: "56",
      height: "46",
      viewBox: "0 0 56 46",
      fill: "none",
      xmlns: svgNS
    });
    for (const d of PUCK_SHINE) {
      svg.append(svgEl("path", { d, fill: "currentColor" }));
    }
    holder.append(svg);
    return holder;
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
    // Only a finished puck is polished. Counted off a live path: every ticked
    // puck carries the shine and every locked one is bare, and so is the active
    // one -- it wears the progress ring instead.
    if (node.state === "done") {
      button.append(buildPuckShine());
    }
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

  // Their banner is sticky and names whichever unit the path has scrolled to,
  // taking that unit's colour with it -- scrolling from unit 4 into unit 5
  // turns it from owl green to fox orange mid-scroll. So there is one banner
  // that gets re-dressed, not one per unit, even though each unit has its own
  // title and its own hr-flanked header further down the path.
  let banner = null;

  function buildBanner() {
    const root = el("div", "PsNCe");

    const back = el("a", "_3HqVu", { href: "https://www.duolingo.com/sections" });
    back.append(el("img", null, { src: ASSET.back, alt: "" }));
    const label = el("h1", "_3WYpp");
    back.append(label);

    const name = el("span", "U_xpg");

    const guidebook = el("a", "_1ORKS _1yhVg _2V6ug _1ursp _7jW2t", {
      href: "https://www.duolingo.com/practice-hub/words",
      "aria-label": "Opens the words you have learned"
    });
    guidebook.append(el("img", "uGhFr", { alt: "Guidebook", src: ASSET.guidebook }));
    const guidebookLabel = el("span", "_30k3d");
    guidebookLabel.textContent = "Guidebook";
    guidebook.append(guidebookLabel);

    root.append(back, name, guidebook);
    banner = { root, label, name, showing: null };
    return root;
  }

  function syncBanner(record) {
    if (!banner || !record || banner.showing === record) {
      return;
    }
    banner.showing = record;
    banner.root.className = `PsNCe ${record.theme.banner}`;
    banner.label.textContent = record.unit.sectionLabel;
    banner.name.textContent = record.unit.title;
  }

  // The unit the banner names is the one the path is actually showing: the last
  // one whose section has reached the middle of the viewport. Measured off
  // their own path -- with three units sitting at -862, -95 and +598 in an
  // 843px window, theirs named the one at -95, which is the last to have
  // crossed the middle. Using the banner's own bottom edge instead reads a unit
  // late: you can be centred on a puck with its header plainly on screen while
  // the banner still names the unit above it. Scroll is listened for in the
  // capture phase because the page may scroll in an inner element rather than
  // the window.
  function trackBanner() {
    const update = () => {
      const line = (globalThis.innerHeight || 0) / 2;
      let showing = stack[0];
      for (const record of stack) {
        if (record.section && record.section.getBoundingClientRect().top <= line) {
          showing = record;
        }
      }
      syncBanner(showing);
    };
    document.addEventListener("scroll", update, { capture: true, passive: true });
    globalThis.addEventListener("resize", update, { passive: true });
    update();
  }

  let nodes = [];

  function buildUnit(withCharacter) {
    const section = el("section", `${current.theme.unit} _2eIKy`, {
      "data-test": "sly-fox-unit"
    });
    // Which unit a click landed in. The page holds several now, so a popover
    // and the lesson it starts resolve against the unit actually clicked rather
    // than whichever happened to be drawn last.
    section.dataset.slyFoxUnitSlug = unit.slug;

    const header = el("header", "_10Xfk");
    const title = el("h2", "_3qGKs");
    title.textContent = unit.title;
    header.append(el("hr", "_1JA0o"), title, el("hr", "_1JA0o"));

    const body = el("div", "_2QaYj");

    // Their walking character sits absolutely against the path, offset from the
    // centre line. The measurements are the reference unit's. There is one of
    // her on their whole section, standing on the unit you are on, so only that
    // unit builds her.
    let characterMount = null;
    if (withCharacter) {
      const character = el("div", "_3jOjF");
      character.style.cssText =
        "height: 260.765px; left: calc(50% - 19px); top: 314.736px; transform: translateY(-50%); width: calc(50% + 3px);";
      characterMount = el("span", "u_TP- fs-exclude _1bppN");
      character.append(characterMount);
      body.append(character);
    }

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
    const only = new URLSearchParams(globalThis.location.search).get("unit");
    Promise.all((only ? [only] : UNITS).map(loadUnit)).then((loaded) => {
      const found = loaded.filter(Boolean);
      const list = found.length ? found : [FALLBACK_UNIT];
      chrome.storage.local.get({ [SECTION_STORAGE_KEY]: null }, (stored) => {
        const saved = stored[SECTION_STORAGE_KEY];
        stack = list.map((loadedUnit, index) => ({
          unit: loadedUnit,
          theme: themeFor(index, loadedUnit.theme),
          // Progress has always been stored per slug, so stacking the units
          // changes nothing about where each one's is read from -- and no unit
          // is locked behind another, since each works out its own pucks.
          nodes: applyProgress(
            saved && saved.units ? saved.units[loadedUnit.slug] : saved,
            loadedUnit
          )
        }));
        draw();
      });
    });
  }

  // Coming back from a lesson. `at` names the unit to scroll to and `node` the
  // puck within it, so finishing a lesson puts the learner back where they were
  // rather than at the top of the first unit. Deliberately not `unit`, which
  // narrows the page to a single unit and would hide the rest of the path.
  function restoreScroll() {
    const params = new URLSearchParams(globalThis.location.search);
    const at = params.get("at");
    if (!at) {
      return;
    }
    const host = document.querySelector(`[data-sly-fox-unit-slug="${CSS.escape(at)}"]`);
    if (!host) {
      return;
    }
    const node = params.get("node");
    const puck = node === null ? null : host.querySelector(`[data-sly-fox-node="${CSS.escape(node)}"]`);
    (puck || host).scrollIntoView({ block: "center" });

    // Consume them. Otherwise a later refresh -- or the back button -- yanks
    // the learner back to this puck instead of leaving them where they scrolled.
    params.delete("at");
    params.delete("node");
    const query = params.toString();
    history.replaceState(null, "", query ? `?${query}` : globalThis.location.pathname);
  }

  function draw() {
    const bannerHost = document.getElementById("sly-fox-unit-banner");
    const pathHost = document.getElementById("sly-fox-path");
    if (!bannerHost || !pathHost) {
      return;
    }

    bannerHost.append(buildBanner());

    // The character stands on the unit you are actually on -- the first with a
    // puck still to play, or the last once the section is finished.
    const standingOn =
      stack.find((record) => record.nodes.some((node) => node.state === "active")) ||
      stack[stack.length - 1];

    for (const record of stack) {
      use(record);
      const built = buildUnit(record === standingOn);
      // Duolingo positions each unit absolutely because it virtualises the
      // path, mounting only the units either side of the scroll. Ours are all
      // present at once, so they stay in normal flow and simply stack.
      built.section.style.width = "100%";
      record.section = built.section;
      pathHost.append(built.section);
      if (built.characterMount) {
        mountCharacter(built.characterMount);
      }
    }

    restoreScroll();
    trackBanner();

    document.addEventListener("click", (event) => {
      // Resolve the unit this click landed in before anything reads its pucks
      // or starts a lesson from them.
      const host = event.target.closest("[data-sly-fox-unit-slug]");
      const clicked =
        host && stack.find((record) => record.unit.slug === host.dataset.slyFoxUnitSlug);
      if (clicked) {
        use(clicked);
      }
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
