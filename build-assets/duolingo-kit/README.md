# The Duolingo kit

Everything the Sly Fox section needs to look like a Duolingo section, captured
once from a live page and kept here as source. `scripts/build-duolingo-css.py`
turns it into `extension/section/duolingo.css`.

Nothing in the extension clones Duolingo's live DOM. Their path is virtualised —
only a few units are mounted at a time and React unmounts them from under you —
so a clone taken at render time is a clone of whatever the user last scrolled
past. Locked units carry four pucks where the current one carries five, and the
grey "locked" classes only exist in the document while a grey unit happens to be
mounted. Harvest deliberately, store the result, render from the store.

## What is here

| Path | What it is |
| --- | --- |
| `css/*.css` | The twenty stylesheets duolingo.com loads, fetched verbatim. |
| `tokens.css` | Their ~250 colour tokens. |
| `README.md` | This file. |

The two things that are *not* in their stylesheets:

- **Colour tokens.** Duolingo writes them as inline custom properties on
  `<html>` at runtime, so `css/` contains no `--color-*` definitions at all.
  `tokens.css` is a snapshot of `document.documentElement.getAttribute("style")`
  reformatted into a `:root` block.
- **The typeface.** Their four `duolingo-sans` faces are registered through the
  FontFace API, so there is no `@font-face` rule to copy. The two weights the
  section uses are vendored as `extension/section/assets/duolingo-sans-*.woff2`
  and declared by the build script.

## Re-harvesting

Do this when the section stops looking like Duolingo's — which will happen, the
class names are per-build hashes.

1. Open duolingo.com and collect the stylesheet URLs:

   ```js
   [...document.querySelectorAll("link[rel=stylesheet]")].map((l) => l.href)
   ```

   Do it on **both** `/learn` and `/sections`; the two pages do not load the same
   set, and a sheet that only `/sections` pulls in is easy to miss. Fetch each
   with `curl --compressed` (they are brotli; without the flag you get bytes that
   look like a corrupt file).

2. Re-take the tokens:

   ```js
   document.documentElement.getAttribute("style")
   ```

3. Re-take the class names the markup uses. The useful ones, and how to find
   them again:

   | Thing | Where it comes from |
   | --- | --- |
   | Unit colour | the class on `<section>` that sets `--path-unit-background-color` |
   | Unit banner colour | the class next to `.PsNCe` that sets `background-color` |
   | Section card colour | in `pathSections-*.css`, the class setting `background-color:rgb(var(--color-<persona>))` |
   | Card button / trophy | the classes setting `--web-ui_button-color` / `color` to that same persona |

   Duolingo names both by persona — rookie, explorer, traveler, trailblazer,
   adventurer, discoverer, daredevil, navigator, champion — so all four move
   together when you change which persona the section wears.

4. Re-take the path geometry if the wave has changed. Per unit:

   ```js
   [...document.querySelector("._2QaYj").children]
     .filter((n) => n.style.left)
     .map((n) => [n.style.left, n.style.marginTop])
   ```

5. `python3 scripts/build-duolingo-css.py`, then `node scripts/test-section.js`.

## The character animation

`extension/section/assets/path-character.json` is a real Lottie animation, not a
still. It is not served as a file — the data is bundled into Duolingo's
JavaScript and handed straight to the player — so it was lifted off the mounted
component:

```js
const span = document.querySelector("._3jOjF span");
let node = span[Object.keys(span).find((k) => k.startsWith("__reactFiber$"))];
// walk the fiber's hooks for the object carrying .layers/.w/.h, then
JSON.stringify(found);
```

Player: `extension/section/vendor/lottie.min.js` (lottie-web 5.12.2, SVG build).
