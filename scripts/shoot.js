// Take a picture of an extension page.
//
// This is not a test and has no assertions in it. It exists so that a change can
// be *looked at* rather than only queried. Querying is not seeing: the keyboard
// toggle was in the DOM, carried the right `data-test`, and clicked fine for a
// whole session while rendering at y=872 in an 862px viewport -- off the bottom
// of the screen. A picture would have shown that in a second.
//
//   node scripts/shoot.js "section/lesson.html?lesson=around-the-house"
//   node scripts/shoot.js "section/section.html?unit=around-the-house" path.png
//   node scripts/shoot.js "section/lesson.html?lesson=listening" a.png --steps 3
//
// `--steps N` clicks through N challenges, writing a-1.png, a-2.png … so a whole
// lesson can be reviewed in one go.
//
// The browser is closed in a finally, including on failure or Ctrl-C, so this
// cannot leave a headless Chromium running in the background.

const path = require("path");
const os = require("os");
const fs = require("fs");
const { chromium } = require("playwright");

const EXTENSION = path.resolve(__dirname, "../extension");
const SHOTS = path.resolve(__dirname, "../output/shots");

const args = process.argv.slice(2);
const target = args.find((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--")) || "section/section.html";
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const named = positional[1];
const stepsAt = args.indexOf("--steps");
const steps = stepsAt === -1 ? 0 : Number(args[stepsAt + 1]) || 0;
const headed = args.includes("--headed");
// Run a snippet on the page before shooting, for states that need seeding --
// a finished puck, say, which lives in chrome.storage rather than the URL.
const evalAt = args.indexOf("--eval");
const before = evalAt === -1 ? null : args[evalAt + 1];
// Click something before shooting, for states that only exist after an
// interaction -- a popover, say.
const clickAt = args.indexOf("--click");
const clickSelector = clickAt === -1 ? null : args[clickAt + 1];
// Run a snippet *before* the page's own scripts, for wiretapping things that
// happen on load -- audio autoplay, say.
const initAt = args.indexOf("--init");
const initScript = initAt === -1 ? null : args[initAt + 1];
// Run a snippet at the end and print what it returns.
const probeAt = args.indexOf("--probe");
const probeScript = probeAt === -1 ? null : args[probeAt + 1];

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

// One challenge on, however this particular challenge is answered. Wrong answers
// are fine -- the point is to see each screen, not to score.
const ADVANCE = async (page) => {
  const acted = await page.evaluate(async () => {
    const nap = (ms) => new Promise((r) => setTimeout(r, ms));
    const blame = document.querySelector("[data-test^='blame ']");
    if (blame) {
      document.querySelector("[data-test='player-next']").click();
      return "continue";
    }
    const tiles = [...document.querySelectorAll("[data-sly-fox-match]")].filter(
      (n) => n.getAttribute("aria-disabled") !== "true"
    );
    if (tiles.length) {
      const left = tiles.filter((n) => n.dataset.slyFoxSide === "0");
      const right = tiles.filter((n) => n.dataset.slyFoxSide === "1");
      for (const l of left) {
        for (const r of right) {
          l.click();
          await nap(40);
          r.click();
          await nap(90);
          if (l.getAttribute("aria-disabled") === "true") break;
        }
      }
      return "match";
    }
    const choice = document.querySelector("[data-test='challenge-choice']");
    if (choice) {
      choice.click();
      await nap(150);
      document.querySelector("[data-test='player-next']").click();
      return "choice";
    }
    const token = document.querySelector(
      "[data-test='word-bank'] [data-test$='-challenge-tap-token']"
    );
    if (token) {
      token.click();
      await nap(150);
      const act = document.querySelector("[data-test='player-next']");
      if (act && !act.disabled) act.click();
      return "token";
    }
    const act = document.querySelector("[data-test='player-next']");
    if (act && !act.disabled) {
      act.click();
      return "next";
    }
    const skip = document.querySelector("[data-test='player-skip']");
    if (skip) {
      skip.click();
      return "skip";
    }
    return "stuck";
  });
  await page.waitForTimeout(700);
  return acted;
};

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "sly-fox-shot-"));
  let context = null;

  try {
    context = await chromium.launchPersistentContext(profile, {
      headless: false,
      args: [
        `--disable-extensions-except=${EXTENSION}`,
        `--load-extension=${EXTENSION}`,
        "--no-first-run",
        ...(headed ? [] : ["--headless=new"])
      ],
      viewport: { width: 1280, height: 900 }
    });

    const id = await resolveExtensionId(context);
    if (!id) {
      throw new Error("the extension never registered a service worker");
    }

    const page = context.pages()[0] || (await context.newPage());
    if (initScript) {
      await page.addInitScript(initScript);
    }

    // A thrown render is invisible in a picture -- the slot just comes out
    // empty -- so say so out loud.
    const failures = [];
    page.on("pageerror", (error) => failures.push(String(error.message)));
    page.on("console", (msg) => {
      if (msg.type() === "error") failures.push(msg.text());
    });
    process.on("exit", () => {
      for (const failure of [...new Set(failures)]) console.error(`  page error: ${failure}`);
    });
    const url = `chrome-extension://${id}/${target.replace(/^\//, "")}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);

    if (before) {
      await page.evaluate(before);
      await page.waitForTimeout(400);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(1200);
    }

    if (clickSelector) {
      await page.click(clickSelector);
      await page.waitForTimeout(600);
    }

    const base = (named || target.split("/").pop().split("?")[0].replace(/\.html$/, "")) + "";
    const stem = base.replace(/\.png$/, "");

    if (!steps) {
      const out = path.join(SHOTS, `${stem}.png`);
      await page.screenshot({ path: out, fullPage: true });
      console.log(out);
    } else {
      for (let i = 1; i <= steps; i += 1) {
        const out = path.join(SHOTS, `${stem}-${i}.png`);
        await page.screenshot({ path: out, fullPage: true });
        const what = await page.evaluate(
          () =>
            (
              document.querySelector("[data-test^='challenge challenge-']") || {}
            ).getAttribute?.("data-test") || document.body.innerText.slice(0, 40).replace(/\s+/g, " ")
        );
        console.log(`${out}  ${what}`);
        if (i < steps) {
          await ADVANCE(page);
          // The graded screen is a different screen -- it is where Continue
          // lives -- so it needs its own picture. Shooting only the question
          // is how a missing Continue button went out the door.
          const graded = await page.evaluate(
            () => (document.querySelector("[data-test^='blame ']") || {}).getAttribute?.("data-test") || null
          );
          if (graded) {
            const answered = path.join(SHOTS, `${stem}-${i}-graded.png`);
            await page.screenshot({ path: answered, fullPage: true });
            console.log(`${answered}  ${graded}`);
          }
        }
      }
    }
    if (probeScript) {
      console.log(JSON.stringify(await page.evaluate(probeScript), null, 1));
    }
  } finally {
    if (context) await context.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
