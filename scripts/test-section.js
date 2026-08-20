// End-to-end check for the Sly Fox section.
//
// Loads the unpacked extension into a real Chrome, serves a stand-in for
// duolingo.com/sections on that origin so the content scripts see the hostname
// they expect, and then follows the card through to the section page.
//
// The fixture is a reduced copy of the real sections list -- the same wrapper,
// heading and button structure the insertion logic keys on -- rather than a
// full page dump, so it stays readable when Duolingo's markup moves and the
// test needs re-pointing. Visual fidelity is not what this checks; it checks
// that the card lands in the right slot and goes to the right place.
//
//   node scripts/test-section.js [--headed]

const path = require("path");
const os = require("os");
const fs = require("fs");
const { chromium } = require("playwright");

const EXTENSION = path.resolve(__dirname, "../extension");
const SHOTS = path.resolve(__dirname, "../output/section-test");
const HEADED = process.argv.includes("--headed");

const SECTIONS_FIXTURE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Duolingo</title></head>
<body>
  <div class="JTQLF">
    <div class="_14Seh"><a class="T9pNN" href="/learn"><span class="wLajc">Back</span></a></div>
    <div class="_2UWvP _3AIkT">
      <div class="CQzMM"><h1 class="_39RQh">Section&nbsp;1</h1>
        <div class="_34eE3"><p class="_1tBwZ">Completed!</p></div></div>
      <div class="_1vvWf"><button class="_3xDVI"><span class="_9lHjd">Review</span></button></div>
    </div>
    <div class="_2UWvP _3AIkT">
      <div class="CQzMM"><h1 class="_39RQh">Section&nbsp;2</h1>
        <div class="_34eE3"><p class="_1tBwZ">Completed!</p></div></div>
      <div class="_1vvWf"><button class="_3xDVI"><span class="_9lHjd">Review</span></button></div>
    </div>
    <div class="_3ZqQ2 _2E1uv _3AIkT">
      <div class="CQzMM"><h1 class="_39RQh">Section&nbsp;3</h1>
        <div class="_1Hfnb"></div>
        <div class="m1PXJ"><button class="_3xDVI"><span class="_9lHjd">Continue</span></button></div></div>
    </div>
    <div class="_36wSS _2E1uv _3AIkT">
      <div class="CQzMM"><h1 class="_39RQh">Daily Refresh</h1>
        <div class="_34eE3"><p class="_1tBwZ">6 levels</p></div></div>
    </div>
  </div>
</body></html>`;

// Written straight to the file descriptor: node block-buffers stdout when it is
// redirected to a file, which hides every line up to the moment the process
// exits -- exactly the lines you want when it does not.
function say(line) {
  fs.writeSync(1, line + "\n");
}

// The extension warms a translator on load and can hold the page's main thread
// for a while; without a ceiling on each call a slow page reads as a hung test.
function within(label, ms, work) {
  return Promise.race([
    Promise.resolve()
      .then(work)
      .catch((error) => ({ __failed: String((error && error.message) || error) })),
    new Promise((resolve) => setTimeout(() => resolve({ __timedOut: label }), ms))
  ]);
}

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  say(`${ok ? "  ok  " : " FAIL "} ${name}${detail ? ` -- ${detail}` : ""}`);
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "slyfox-section-"));

  // MV3 service workers do not start under Chrome's old headless mode, so the
  // run is either windowed or on --headless=new; plain headless would load the
  // extension and then never run any of it.
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION}`,
      `--load-extension=${EXTENSION}`,
      "--no-first-run",
      ...(HEADED ? [] : ["--headless=new"])
    ],
    viewport: { width: 1280, height: 900 }
  });

  // Everything duolingo.com is stubbed: a blank 200 for whatever the page would
  // otherwise reach for, and the sections list itself. Playwright tries the
  // most recently registered route first, so the catch-all has to go on before
  // the specific one or it swallows it.
  await context.route("https://www.duolingo.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: "<!DOCTYPE html><title>stub</title>" })
  );
  await context.route("https://www.duolingo.com/sections", (route) =>
    route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: SECTIONS_FIXTURE })
  );

  const extensionId = await resolveExtensionId(context);
  check("extension loaded", Boolean(extensionId), extensionId || "no service worker seen");
  if (!extensionId) {
    await context.close();
    return report();
  }

  const page = await context.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));
  page.on("console", (msg) => {
    // One check deliberately asks for a lesson that is not there; the browser
    // logs the failed request and that is the expected result, not a fault.
    if (msg.type() === "error" && !/does-not-exist|ERR_FILE_NOT_FOUND/.test(msg.text())) {
      pageErrors.push(msg.text());
    }
  });

  say("  navigating to the sections page");
  await page.goto("https://www.duolingo.com/sections", {
    waitUntil: "domcontentloaded",
    timeout: 20000
  });
  say(`  loaded ${page.url()}`);

  const card = page.locator("#learned-word-replacer-duolingo-section-card");
  await card.waitFor({ state: "attached", timeout: 15000 }).catch(() => {});
  const cardCount = await within("count", 15000, () => card.count());
  say(`  card count = ${JSON.stringify(cardCount)}`);
  if (cardCount === 0) {
    say("  diagnostics: " + JSON.stringify(await page.evaluate(() => {
      // Content scripts live in an isolated world, so only their effect on the
      // DOM is visible from here.
      return {
        url: location.href,
        headings: [...document.querySelectorAll("h1")].map((h) => h.textContent.trim()),
        listChildren: document.querySelector(".JTQLF")
          ? document.querySelector(".JTQLF").children.length
          : null,
        lwrNodes: document.querySelectorAll("[data-lwr-ui]").length
      };
    })));
  }
  check("card is injected", (await card.count()) === 1, `count=${await card.count()}`);

  if ((await card.count()) === 1) {
    const placement = await page.evaluate(() => {
      const node = document.getElementById("learned-word-replacer-duolingo-section-card");
      const text = (el) => (el ? el.textContent.replace(/ /g, " ").trim().slice(0, 24) : null);
      return { before: text(node.previousElementSibling), after: text(node.nextElementSibling) };
    });
    check(
      "card sits after the last section",
      /^Section 3/.test(placement.before || ""),
      `previous sibling = ${placement.before}`
    );
    check(
      "card sits before Daily Refresh",
      /^Daily Refresh/.test(placement.after || ""),
      `next sibling = ${placement.after}`
    );

    const assets = await page.evaluate(() => {
      const node = document.getElementById("learned-word-replacer-duolingo-section-card");
      return [...node.querySelectorAll("img")].map((img) => img.src);
    });
    check(
      "card art is served from the extension",
      assets.length === 2 && assets.every((src) => src.startsWith("chrome-extension://")),
      assets.join(", ")
    );

    const title = await card.locator("h1").innerText();
    check("card is titled Sly Fox", title.trim() === "Sly Fox", title);
  }

  // Re-running the observer must not stack up copies.
  await page.evaluate(() => document.body.appendChild(document.createElement("span")));
  await page.waitForTimeout(300);
  check("card is not duplicated", (await card.count()) === 1, `count=${await card.count()}`);

  await page.screenshot({ path: path.join(SHOTS, "sections.png"), fullPage: true });

  // Follow it through to the section page.
  await card.locator("button").click();
  await page.waitForURL(/^chrome-extension:\/\/.*section\/section\.html$/, { timeout: 10000 }).catch(() => {});
  check("card opens the section page", /section\/section\.html$/.test(page.url()), page.url());

  if (/section\.html$/.test(page.url())) {
    await page.waitForTimeout(1200);
    const unit = await page.evaluate(() => {
      const pucks = [...document.querySelectorAll("[data-test^='skill-path-level-']")];
      const chests = [...document.querySelectorAll("button[aria-label='Chest']")];
      const lottie = document.querySelector("._3jOjF svg");
      const banner = document.querySelector(".PsNCe");
      const start = document.querySelector("._2nwbo");
      return {
        pucks: pucks.length,
        puckKinds: pucks.map((p) =>
          p.getAttribute("data-test").split(" ").pop().replace("skill-path-level-", "")
        ),
        chests: chests.length,
        lottieMounted: Boolean(lottie),
        bannerColor: banner ? getComputedStyle(banner).backgroundColor : null,
        startFlag: start ? start.textContent.trim() : null,
        ringTrack: Boolean(document.querySelector("svg._2FMGJ path"))
      };
    });

    check("unit has five pucks", unit.pucks === 5, unit.puckKinds.join(", "));
    check("unit has two chests", unit.chests === 2, `count=${unit.chests}`);
    check("puck order matches a Duolingo unit",
      unit.puckKinds.join(",") === "skill,skill,practice,practice,unit_review",
      unit.puckKinds.join(","));
    check("character animation mounted", unit.lottieMounted);
    check("progress ring drawn", unit.ringTrack);
    check("START flag shown", unit.startFlag === "START", String(unit.startFlag));
    check("banner uses the unit colour", unit.bannerColor === "rgb(206, 130, 255)", String(unit.bannerColor));

    // Duolingo's own stylesheet is not on this page, so a missing rule shows up
    // as a puck with no size.
    const styled = await page.evaluate(() => {
      const puck = document.querySelector("[data-test^='skill-path-level-']");
      const startButton = (() => {
        document.querySelector("[data-sly-fox-node] button").click();
        return document.querySelector("[data-sly-fox-popover] a");
      })();
      const puckBox = puck.getBoundingClientRect();
      const buttonStyle = startButton ? getComputedStyle(startButton) : null;
      return {
        puckWidth: Math.round(puckBox.width),
        puckHeight: Math.round(puckBox.height),
        popover: Boolean(startButton),
        buttonHeight: buttonStyle ? buttonStyle.height : null,
        buttonFont: buttonStyle ? buttonStyle.fontFamily : null
      };
    });
    check("puck has Duolingo's dimensions", styled.puckWidth === 70 && styled.puckHeight === 65,
      `${styled.puckWidth}x${styled.puckHeight}`);
    check("lesson popover opens", styled.popover);
    check("popover button is styled", styled.buttonHeight === "50px", String(styled.buttonHeight));
    check("Duolingo font is applied", /duolingo-sans/.test(styled.buttonFont || ""), String(styled.buttonFont));

    await page.screenshot({ path: path.join(SHOTS, "section-page.png"), fullPage: true });
  }

  // ---- the lesson -------------------------------------------------------
  // A fresh profile has no vocabulary, so the deck would be empty and the
  // lesson would (correctly) refuse to start. Seed a small one first.
  const seeded = await page.evaluate(async () => {
    const words = [
      ["semester", "семестр"], ["exam", "екзамен"], ["group", "група"],
      ["department", "факультет"], ["class", "пара"], ["grade", "клас"],
      ["month", "місяць"], ["sea", "море"], ["bad", "поганий"], ["critic", "критик"],
      ["woman", "жінка"], ["sister", "сестра"]
    ];
    const state = {
      version: 3,
      enabled: true,
      currentProfileId: "test-uk",
      doNotTranslate: { sites: [], pages: [] },
      profiles: [
        {
          id: "test-uk",
          name: "Ukrainian",
          languageCode: "uk",
          entries: words.map(([source, target], index) => ({
            id: `e${index}`, source, target, enabled: true, origin: "duolingo"
          }))
        }
      ]
    };
    await chrome.storage.local.set({ learnedWordReplacerState: state });
    return words.length;
  });
  check("vocabulary seeded", seeded === 12, `${seeded} words`);

  await page.goto(`chrome-extension://${extensionId}/section/lesson.html`, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForTimeout(1200);

  const lesson = await page.evaluate(() => {
    const challenge = document.querySelector("[data-test^='challenge challenge-']");
    return {
      type: challenge && challenge.getAttribute("data-test"),
      header: (document.querySelector("[data-test='challenge-header']") || {}).textContent,
      hasProgress: Boolean(document.querySelector("[data-test='quit-button']")),
      checkDisabled: Boolean(document.querySelector("[data-test='player-next']").disabled),
      choices: document.querySelectorAll("[data-test='challenge-choice']").length,
      bankTokens: document.querySelectorAll("[data-test$='-challenge-tap-token']").length,
      characterLoaded: Boolean(document.querySelector("._2qg6J svg"))
    };
  });
  check("lesson opens a challenge", /challenge-(assist|translate|match)/.test(lesson.type || ""), lesson.type);
  check("challenge has a header", Boolean((lesson.header || "").trim()), lesson.header);
  check("lesson chrome is present", lesson.hasProgress);
  check("Check starts disabled", lesson.checkDisabled);
  check("prompt character rendered", lesson.characterLoaded);
  check(
    "challenge offers something to answer with",
    lesson.choices > 0 || lesson.bankTokens > 0,
    `choices=${lesson.choices} bank=${lesson.bankTokens}`
  );

  await page.screenshot({ path: path.join(SHOTS, "lesson.png"), fullPage: true });

  // Answer it, whatever type it is, and check the verdict banner appears.
  const answered = await page.evaluate(() => {
    const choice = document.querySelector("[data-test='challenge-choice']");
    if (choice) {
      choice.click();
      return "assist";
    }
    const token = document.querySelector("[data-test$='-challenge-tap-token']");
    if (token) {
      token.click();
      return "translate";
    }
    return "none";
  });
  await page.waitForTimeout(300);
  const canCheck = await page.evaluate(
    () => !document.querySelector("[data-test='player-next']").disabled
  );
  check("Check enables after answering", canCheck, `answered via ${answered}`);

  await page.evaluate(() => document.querySelector("[data-test='player-next']").click());
  await page.waitForTimeout(400);
  const verdict = await page.evaluate(() => {
    const blame = document.querySelector("[data-test^='blame ']");
    return {
      blame: blame && blame.getAttribute("data-test"),
      footerBg: blame
        ? getComputedStyle(blame.closest("._3FB5S")).backgroundColor
        : null,
      action: (document.querySelector("[data-test='player-next']") || {}).textContent
    };
  });
  check("verdict banner shown", /blame-(correct|incorrect)/.test(verdict.blame || ""), verdict.blame);
  check("verdict banner is coloured", /rgb\(/.test(verdict.footerBg || ""), verdict.footerBg);
  check("banner offers Continue", (verdict.action || "").trim() === "Continue", verdict.action);

  await page.screenshot({ path: path.join(SHOTS, "lesson-verdict.png"), fullPage: true });

  // ---- the specific things that were reported broken --------------------
  await page.goto(`chrome-extension://${extensionId}/section/lesson.html`, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForTimeout(1000);

  // Walk to each challenge kind in turn and check it there, rather than
  // relying on whichever one the shuffle happens to open with.
  const reachKind = async (kind) => {
    for (let step = 0; step < 24; step += 1) {
      const here = await page.evaluate(() => {
        const c = document.querySelector("[data-test^='challenge challenge-']");
        return c ? c.getAttribute("data-test") : null;
      });
      if (here && here.includes(kind)) { return true; }
      const moved = await page.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const skip = document.querySelector("[data-test='player-skip']");
        if (skip) { skip.click(); await sleep(250); }
        const next = document.querySelector("[data-test='player-next']");
        if (next && !next.disabled) { next.click(); await sleep(250); return true; }
        return false;
      });
      if (!moved) { return false; }
      await page.waitForTimeout(300);
    }
    return false;
  };

  // 1. Selecting an assist choice must show as selected, not just count.
  if (await reachKind("assist")) {
    const select = await page.evaluate(async () => {
      const choice = document.querySelectorAll("[data-test='challenge-choice']")[1];
      choice.click();
      await new Promise((r) => setTimeout(r, 150));
      return {
        cls: choice.className,
        checked: choice.getAttribute("aria-checked"),
        color: getComputedStyle(choice).color
      };
    });
    check("assist selection is visible", /_1pRZ7/.test(select.cls), select.cls);
    check("assist selection turns blue", select.color === "rgb(24, 153, 214)", select.color);

    // 2. A right answer must read as right.
    const verdictNow = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      document.querySelectorAll("[data-test='challenge-choice']").forEach((n) => {
        n.setAttribute("aria-checked", "false");
        n.classList.remove("_1pRZ7");
      });
      // Whichever is picked, Duolingo marks the right one -- that is the
      // behaviour under test.
      const nodes = document.querySelectorAll("[data-test='challenge-choice']");
      nodes[0].click();
      await sleep(150);
      document.querySelector("[data-test='player-next']").click();
      await sleep(400);
      const blame = document.querySelector("[data-test^='blame ']");
      const marked = [...nodes].map((n) => n.className);
      return { blame: blame && blame.getAttribute("data-test"), marked };
    });
    check(
      "correct choice is marked correct",
      verdictNow.marked.some((c) => /_1drLQ/.test(c)),
      verdictNow.marked.join(" | ").slice(0, 90)
    );
  } else {
    check("assist reachable", false, "never reached an assist challenge");
  }

  // 3. Word-bank tokens must go up and come back without duplicating.
  await page.goto(`chrome-extension://${extensionId}/section/lesson.html`, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForTimeout(1000);
  if (await reachKind("translate")) {
    const roundTrip = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const bank = document.querySelector("[data-test='word-bank']");
      const placed = document.querySelector("[data-sly-fox-placed]");
      const first = bank.querySelector("[data-test$='-challenge-tap-token']");
      const word = first.querySelector("[data-test='challenge-tap-token-text']").textContent;
      first.click();
      await sleep(250);
      const afterPlace = placed.children.length;
      placed.querySelector("[data-test$='-challenge-tap-token']").click();
      await sleep(250);
      const afterReturn = placed.children.length;
      const bankCopies = [...bank.querySelectorAll("[data-test='challenge-tap-token-text']")]
        .filter((n) => n.textContent === word).length;
      const visible = getComputedStyle(bank.children[0]).visibility;
      return { afterPlace, afterReturn, bankCopies, visible };
    });
    check("token moves to the line", roundTrip.afterPlace === 1, `placed=${roundTrip.afterPlace}`);
    check("token returns to the bank", roundTrip.afterReturn === 0, `left on line=${roundTrip.afterReturn}`);
    check("token is not duplicated", roundTrip.bankCopies === 1, `${roundTrip.bankCopies} copies in bank`);
    check("returned token is visible again", roundTrip.visible === "visible", roundTrip.visible);

    // 4. Hover hints.
    const hint = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const token = document.querySelector("[data-test='hint-token']");
      if (!token) { return { token: false }; }
      const box = token.getBoundingClientRect();
      token.dispatchEvent(new MouseEvent("mouseover", {
        bubbles: true, clientX: box.left + 2, clientY: box.top + 2
      }));
      await sleep(200);
      const pop = document.querySelector("[data-test='hint-popover']");
      const popBox = pop ? pop.getBoundingClientRect() : null;
      return {
        token: true,
        width: Math.round(box.width),
        popover: Boolean(pop),
        rows: pop ? pop.querySelectorAll("td").length : 0,
        text: pop ? pop.innerText.replace(/\s+/g, " ").trim().slice(0, 40) : null,
        centre: popBox ? Math.round(popBox.left + popBox.width / 2) : null,
        tokenCentre: Math.round(box.left + box.width / 2)
      };
    });
    check("prompt has a hint overlay", hint.token === true, `width=${hint.width}`);
    check(
      "hint popover sits under its word",
      hint.popover && Math.abs(hint.centre - hint.tokenCentre) < 60,
      `popover centre ${hint.centre} vs word centre ${hint.tokenCentre}`
    );
    check("hovering shows the hint popover", hint.popover === true, hint.text);
    check("hint lists the meaning", hint.rows > 0, `${hint.rows} rows`);

    await page.screenshot({ path: path.join(SHOTS, "lesson-hint.png"), fullPage: true });
  } else {
    check("translate reachable", false, "never reached a translate challenge");
  }

  // 5. Match must use their grid, not a hand-rolled one.
  await page.goto(`chrome-extension://${extensionId}/section/lesson.html`, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForTimeout(1000);
  if (await reachKind("match")) {
    const matchInfo = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const grid = document.querySelector("._1bmNz");
      const style = grid ? getComputedStyle(grid) : null;
      const tiles = [...document.querySelectorAll("[data-sly-fox-match]")];
      const before = getComputedStyle(tiles[0]).color;
      tiles[0].click();
      await sleep(200);
      const after = getComputedStyle(tiles[0]).color;
      tiles[0].click();
      await sleep(200);
      const off = getComputedStyle(tiles[0]).color;
      return {
        hasGrid: Boolean(grid),
        display: style && style.display,
        columns: style && style.gridTemplateColumns,
        rows: style && style.gridTemplateRows.split(" ").length,
        tiles: tiles.length,
        before, after, off
      };
    });
    check("match uses Duolingo's grid", matchInfo.display === "grid", String(matchInfo.display));
    check("match has two columns", (matchInfo.columns || "").split(" ").length === 2, matchInfo.columns);
    check("match has one row per pair", matchInfo.rows === 5, `${matchInfo.rows} rows`);
    check("match tile lights when picked", matchInfo.before !== matchInfo.after,
      `${matchInfo.before} -> ${matchInfo.after}`);
    check("match tile unlights when tapped again", matchInfo.off === matchInfo.before,
      `${matchInfo.after} -> ${matchInfo.off}`);

    await page.screenshot({ path: path.join(SHOTS, "lesson-match.png"), fullPage: true });
  } else {
    check("match reachable", false, "never reached a match challenge");
  }

  // 6. Skip must work on every challenge kind, including match (which has no
  //    single card behind it and used to throw).
  for (const kind of ["assist", "translate", "match"]) {
    await page.goto(`chrome-extension://${extensionId}/section/lesson.html`, {
      waitUntil: "domcontentloaded"
    });
    await page.waitForTimeout(900);
    if (!(await reachKind(kind))) {
      check(`skip works on ${kind}`, false, "never reached this kind");
      continue;
    }
    const skipped = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      const before = document.querySelector("[data-test^='challenge challenge-']").getAttribute("data-test");
      const skip = document.querySelector("[data-test='player-skip']");
      if (!skip) { return { hadSkip: false }; }
      skip.click();
      await sleep(400);
      const blame = document.querySelector("[data-test^='blame ']");
      return { hadSkip: true, before, blame: blame && blame.getAttribute("data-test") };
    });
    check(
      `skip works on ${kind}`,
      skipped.hadSkip && /blame-/.test(skipped.blame || ""),
      `blame=${skipped.blame}`
    );
  }

  // 7. Correct answers must be announced in green, not red.
  await page.goto(`chrome-extension://${extensionId}/section/lesson.html`, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForTimeout(900);
  if (await reachKind("match")) {
    const green = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
      // Solve the match: pair each tile with its partner by trial.
      for (let round = 0; round < 30; round += 1) {
        const live = [...document.querySelectorAll("[data-sly-fox-match]")]
          .filter((n) => n.getAttribute("aria-disabled") !== "true");
        if (!live.length) { break; }
        const left = live.find((n) => n.dataset.slyFoxSide === "0");
        const right = live.filter((n) => n.dataset.slyFoxSide === "1");
        if (!left || !right.length) { break; }
        for (const other of right) {
          left.click(); await sleep(40); other.click(); await sleep(60);
          if (left.getAttribute("aria-disabled") === "true") { break; }
        }
      }
      await sleep(500);
      const blame = document.querySelector("[data-test^='blame ']");
      const heading = blame && blame.querySelector("h2");
      const tile = document.querySelector("[data-sly-fox-match][aria-disabled='true']");
      return {
        blame: blame && blame.getAttribute("data-test"),
        headingColor: heading ? getComputedStyle(heading).color : null,
        headingClass: heading ? heading.className : null,
        matchedColor: tile ? getComputedStyle(tile).color : null
      };
    });
    check("solved match reads as correct", /blame-correct/.test(green.blame || ""), green.blame);
    check(
      "correct heading is green",
      green.headingColor === "rgb(88, 167, 0)",
      `${green.headingColor} (${green.headingClass})`
    );
    check(
      "finished match tiles grey out",
      green.matchedColor === "rgb(229, 229, 229)",
      String(green.matchedColor)
    );
  } else {
    check("match reachable for verdict check", false, "never reached match");
  }

  // 8. Finishing a lesson must show up on the path.
  await page.evaluate(() => chrome.storage.local.remove("learnedWordReplacerSection"));
  await page.goto(
    `chrome-extension://${extensionId}/section/lesson.html?unit=around-the-house&puck=0&lesson=0&node=0`,
    { waitUntil: "domcontentloaded" }
  );
  await page.waitForTimeout(900);
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let step = 0; step < 80; step += 1) {
      if (!document.querySelector("[data-test^='challenge challenge-']")
        && /XP/.test(document.body.innerText)) { break; }
      const action = document.querySelector("[data-test='player-next']");
      if (action && !action.disabled) { action.click(); await sleep(120); continue; }
      const skip = document.querySelector("[data-test='player-skip']");
      if (skip) { skip.click(); await sleep(120); continue; }
      const live = [...document.querySelectorAll("[data-sly-fox-match]")]
        .filter((n) => n.getAttribute("aria-disabled") !== "true");
      if (live.length) {
        const left = live.find((n) => n.dataset.slyFoxSide === "0");
        for (const other of live.filter((n) => n.dataset.slyFoxSide === "1")) {
          left.click(); await sleep(30); other.click(); await sleep(50);
          if (left.getAttribute("aria-disabled") === "true") { break; }
        }
        continue;
      }
      await sleep(100);
    }
  });
  const savedProgress = await page.evaluate(async () => {
    const got = await chrome.storage.local.get({ learnedWordReplacerSection: null });
    return got.learnedWordReplacerSection;
  });
  check(
    "finishing a lesson is saved",
    Boolean(savedProgress && savedProgress.units
      && savedProgress.units["around-the-house"]
      && savedProgress.units["around-the-house"].nodes["0"] >= 1),
    JSON.stringify(savedProgress)
  );

  await page.goto(`chrome-extension://${extensionId}/section/section.html?unit=around-the-house`, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForTimeout(1000);
  const pathAfter = await page.evaluate(() => {
    const active = document.querySelector("[data-test$='skill-path-level-skill']");
    const face = (src) =>
      /ef9c77|ddd21f/.test(src) ? "star" : /09f58d/.test(src) ? "dumbbell" : /7d84af/.test(src) ? "trophy" : "?";
    return {
      firstLabel: active ? active.getAttribute("aria-label") : null,
      ringArcs: document.querySelectorAll("svg._2FMGJ circle").length,
      faces: [...document.querySelectorAll("img._1B6UH")].map((i) => face(i.src)).join(",")
    };
  });
  check(
    "the path shows the lesson was done",
    /Lesson 2 of 4/.test(pathAfter.firstLabel || ""),
    String(pathAfter.firstLabel)
  );
  check("the ring draws progress", pathAfter.ringArcs >= 2, `${pathAfter.ringArcs} arc elements`);
  check(
    "puck faces match the reference unit",
    pathAfter.faces === "star,star,dumbbell,star,trophy",
    pathAfter.faces
  );

  await page.screenshot({ path: path.join(SHOTS, "section-progress.png"), fullPage: true });

  await page.goto(`chrome-extension://${extensionId}/section/lesson.html`, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForTimeout(1000);

  // Run the whole session out and land on the summary.
  const finished = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let step = 0; step < 60; step += 1) {
      // The summary is the end of the run: its Continue leaves for the section
      // page, which would tear this context down mid-loop.
      const onSummary = !document.querySelector("[data-test^='challenge challenge-']");
      if (onSummary && /XP/.test(document.body.innerText)) { break; }

      const action = document.querySelector("[data-test='player-next']");
      if (action && !action.disabled) {
        action.click();
        await sleep(180);
        continue;
      }
      const choice = document.querySelector("[data-test='challenge-choice']");
      if (choice) { choice.click(); await sleep(120); continue; }

      // Match has no Check button and needs one tile from each column, so it
      // cannot be driven by "click the first thing you find".
      const isMatch = document.querySelector("[data-test='challenge challenge-match']");
      if (isMatch) {
        const live = (side) =>
          [...document.querySelectorAll(`[data-sly-fox-side='${side}']`)].filter(
            (node) => node.getAttribute("aria-disabled") !== "true"
          );
        const left = live("0")[0];
        if (!left) { await sleep(120); continue; }
        left.click();
        for (const right of live("1")) {
          right.click();
          await sleep(60);
          if (left.getAttribute("aria-disabled") === "true") { break; }
          left.click();
        }
        await sleep(80);
        continue;
      }

      const token = document.querySelector("[data-test$='-challenge-tap-token']");
      if (token) { token.click(); await sleep(120); continue; }
      await sleep(150);
    }
    return document.body.innerText.replace(/\s+/g, " ").slice(0, 160);
  });
  check("session reaches a summary", /XP/.test(finished), finished.slice(0, 90));
  check("summary offers no Skip", !/SKIP/i.test(finished), finished.slice(0, 90));

  const recorded = await page.evaluate(async () => {
    const got = await chrome.storage.local.get({ learnedWordReplacerFlashcards: null });
    const cards = got.learnedWordReplacerFlashcards?.languages?.uk?.cards || {};
    return Object.keys(cards).length;
  });
  check("practice records were written", recorded > 0, `${recorded} card records`);

  await page.screenshot({ path: path.join(SHOTS, "lesson-complete.png"), fullPage: true });

  // ---- lessons authored as JSON -----------------------------------------
  await page.goto(`chrome-extension://${extensionId}/section/lesson.html?lesson=around-the-house`, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForTimeout(1200);

  const authored = await page.evaluate(() => {
    const challenge = document.querySelector("[data-test^='challenge challenge-']");
    const prompt = document.querySelector("._5HFLU");
    return {
      type: challenge && challenge.getAttribute("data-test"),
      prompt: prompt && prompt.textContent,
      choices: [...document.querySelectorAll("[data-test='challenge-judge-text']")].map((n) => n.textContent),
      badge: (document.querySelector(".w2K8w") || {}).textContent,
      hintTokens: document.querySelectorAll("[data-test='hint-token']").length
    };
  });
  check("a JSON lesson loads", /challenge-assist/.test(authored.type || ""), authored.type);
  check("it uses the file's prompt", authored.prompt === "вікно", String(authored.prompt));
  check(
    "it uses the file's choices",
    ["window", "door", "floor"].every((c) => authored.choices.includes(c)),
    authored.choices.join(", ")
  );
  check("it honours the file's badge", /NEW WORD/i.test(authored.badge || ""), String(authored.badge));
  check("it underlines the hinted word", authored.hintTokens === 1, `${authored.hintTokens} overlays`);

  // Its answer must grade against the file, not against any vocabulary.
  const authoredVerdict = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const choices = [...document.querySelectorAll("[data-test='challenge-choice']")];
    const right = choices.find((c) => c.textContent.includes("window"));
    right.click();
    await sleep(150);
    document.querySelector("[data-test='player-next']").click();
    await sleep(400);
    const blame = document.querySelector("[data-test^='blame ']");
    return blame && blame.getAttribute("data-test");
  });
  check("a JSON answer grades correctly", /blame-correct/.test(authoredVerdict || ""), String(authoredVerdict));

  // The word-bank challenge in that file must accept its written answer.
  const authoredTranslate = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector("[data-test='player-next']").click();
    await sleep(600);
    for (const word of ["This", "is", "my", "window"]) {
      const token = document.querySelector(`[data-test="${word}-challenge-tap-token"]`);
      if (token) { token.click(); await sleep(90); }
    }
    document.querySelector("[data-test='player-next']").click();
    await sleep(400);
    const blame = document.querySelector("[data-test^='blame ']");
    return blame && blame.getAttribute("data-test");
  });
  check(
    "a JSON word-bank answer grades correctly",
    /blame-correct/.test(authoredTranslate || ""),
    String(authoredTranslate)
  );

  await page.screenshot({ path: path.join(SHOTS, "lesson-json.png"), fullPage: true });

  // A bad name must say so rather than showing an empty lesson.
  await page.goto(`chrome-extension://${extensionId}/section/lesson.html?lesson=does-not-exist`, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForTimeout(900);
  const missing = await page.evaluate(() => document.body.innerText.replace(/\s+/g, " "));
  check("a missing lesson file is reported", /No lesson file/.test(missing), missing.slice(0, 70));

  // Characters must actually animate.
  await page.goto(`chrome-extension://${extensionId}/section/lesson.html?lesson=around-the-house`, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForTimeout(1600);
  const moving = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const host = document.querySelector("._2qg6J");
    const svg = host && host.querySelector("svg");
    if (!svg) { return { svg: false }; }
    const sample = () => svg.innerHTML.length + "|" +
      [...svg.querySelectorAll("g")].slice(0, 6).map((g) => g.getAttribute("transform")).join(",");
    const first = sample();
    await sleep(700);
    const second = sample();
    return { svg: true, changed: first !== second };
  });
  check("the lesson character is a rendered animation", moving.svg === true);
  check("the lesson character is moving", moving.changed === true);

  // ---- the authored unit -------------------------------------------------
  await page.evaluate(() => chrome.storage.local.remove("learnedWordReplacerSection"));
  await page.goto(`chrome-extension://${extensionId}/section/section.html?unit=around-the-house`, {
    waitUntil: "domcontentloaded"
  });
  await page.waitForTimeout(1200);

  const unitPath = await page.evaluate(() => ({
    banner: (document.querySelector(".U_xpg") || {}).textContent,
    label: (document.querySelector("._3WYpp") || {}).textContent,
    pucks: [...document.querySelectorAll("[data-test^='skill-path-level-']")].length,
    chests: document.querySelectorAll("button[aria-label='Chest']").length,
    firstLesson: (document.querySelector("[data-test$='skill-path-level-skill']") || {})
      .getAttribute("aria-label")
  }));
  check("the unit file names the path", unitPath.banner === "Around the house", String(unitPath.banner));
  check("the unit file sets the section label", /UNIT 1/.test(unitPath.label || ""), String(unitPath.label));
  check("the unit fills all five pucks", unitPath.pucks === 5, `${unitPath.pucks} pucks`);
  check("the unit keeps both chests", unitPath.chests === 2, `${unitPath.chests} chests`);
  check(
    "the first puck knows its lesson count",
    /Lesson 1 of 4/.test(unitPath.firstLesson || ""),
    String(unitPath.firstLesson)
  );

  // The popover must name the puck from the file, not a hard-coded label.
  const popoverLabel = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    document.querySelector("[data-sly-fox-node] button").click();
    await sleep(250);
    const pop = document.querySelector("[data-sly-fox-popover]");
    return pop ? pop.innerText.replace(/\s+/g, " ").trim() : null;
  });
  check("the popover uses the puck's label", /Rooms/.test(popoverLabel || ""), String(popoverLabel));

  await page.screenshot({ path: path.join(SHOTS, "unit-path.png"), fullPage: true });

  // Every lesson in every puck must actually load and produce challenges.
  const everyLesson = await page.evaluate(async () => {
    const response = await fetch("units/around-the-house.json");
    const unit = await response.json();
    const pucks = unit.pucks.filter((p) => p.kind !== "chest");
    const report = [];
    for (const [puckIndex, puck] of pucks.entries()) {
      for (const [at, lesson] of puck.lessons.entries()) {
        const kinds = (lesson.challenges || []).map((c) => c.type);
        report.push({
          puck: puck.label,
          lesson: at + 1,
          count: kinds.length,
          kinds: [...new Set(kinds)].sort().join("+"),
          bad: kinds.filter((k) => !["assist", "translate", "match"].includes(k)).length
        });
      }
    }
    return { pucks: pucks.length, lessons: report.length, report };
  });
  check("the unit has five playable pucks", everyLesson.pucks === 5, `${everyLesson.pucks}`);
  check("the unit has sixteen lessons", everyLesson.lessons === 16, `${everyLesson.lessons}`);
  check(
    "every lesson has challenges",
    everyLesson.report.every((r) => r.count >= 4),
    everyLesson.report.filter((r) => r.count < 4).map((r) => `${r.puck} ${r.lesson}`).join(", ") || "all >= 4"
  );
  check(
    "no lesson holds an unknown challenge type",
    everyLesson.report.every((r) => r.bad === 0),
    everyLesson.report.filter((r) => r.bad).map((r) => r.puck).join(", ") || "none"
  );
  check(
    "the unit uses all three challenge types",
    /assist/.test(everyLesson.report.map((r) => r.kinds).join()) &&
      /translate/.test(everyLesson.report.map((r) => r.kinds).join()) &&
      /match/.test(everyLesson.report.map((r) => r.kinds).join()),
    [...new Set(everyLesson.report.map((r) => r.kinds))].join(" | ")
  );

  // Open one lesson from deep in the unit and play it through.
  await page.goto(
    `chrome-extension://${extensionId}/section/lesson.html?unit=around-the-house&puck=4&lesson=1&node=6`,
    { waitUntil: "domcontentloaded" }
  );
  await page.waitForTimeout(1200);
  const deep = await page.evaluate(() => ({
    challenge: (document.querySelector("[data-test^='challenge challenge-']") || {}).getAttribute("data-test"),
    header: (document.querySelector("[data-test='challenge-header']") || {}).textContent
  }));
  check(
    "a lesson deep in the unit opens",
    /challenge-(assist|translate|match)/.test(deep.challenge || ""),
    `${deep.challenge} — ${deep.header}`
  );

  const played = await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    for (let step = 0; step < 90; step += 1) {
      if (!document.querySelector("[data-test^='challenge challenge-']")
        && /XP/.test(document.body.innerText)) { break; }
      const action = document.querySelector("[data-test='player-next']");
      if (action && !action.disabled) { action.click(); await sleep(110); continue; }
      const skip = document.querySelector("[data-test='player-skip']");
      if (skip) { skip.click(); await sleep(110); continue; }
      const live = [...document.querySelectorAll("[data-sly-fox-match]")]
        .filter((n) => n.getAttribute("aria-disabled") !== "true");
      if (live.length) {
        const left = live.find((n) => n.dataset.slyFoxSide === "0");
        for (const other of live.filter((n) => n.dataset.slyFoxSide === "1")) {
          left.click(); await sleep(30); other.click(); await sleep(50);
          if (left.getAttribute("aria-disabled") === "true") { break; }
        }
        continue;
      }
      await sleep(100);
    }
    return document.body.innerText.replace(/\s+/g, " ").slice(0, 90);
  });
  check("that lesson plays to its summary", /XP/.test(played), played.slice(0, 60));

  const unitProgress = await page.evaluate(async () => {
    const got = await chrome.storage.local.get({ learnedWordReplacerSection: null });
    return got.learnedWordReplacerSection;
  });
  check(
    "progress is banked against the unit",
    Boolean(unitProgress && unitProgress.units
      && unitProgress.units["around-the-house"]
      && unitProgress.units["around-the-house"].nodes["6"] >= 1),
    JSON.stringify(unitProgress)
  );

  check("no page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

  await context.close();
  fs.rmSync(profile, { recursive: true, force: true });
  report();
}

async function resolveExtensionId(context) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const worker = context.serviceWorkers()[0];
    if (worker) {
      return new URL(worker.url()).host;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

function report() {
  const failed = checks.filter((entry) => !entry.ok);
  say(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  say(`screenshots in ${path.relative(process.cwd(), SHOTS)}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

// A hung browser should fail the run, not sit there until someone notices.
const watchdog = setTimeout(() => {
  say("\n  timed out waiting for the browser");
  report();
}, 150000);
watchdog.unref();

main().catch((error) => {
  say(String((error && error.stack) || error));
  process.exit(1);
});
