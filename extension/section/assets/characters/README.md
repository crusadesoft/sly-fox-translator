# Characters

Lottie animations, played by the vendored `lottie-web`. A unit stands one on its
path by naming the file in its own YAML:

```yaml
title: Something in the dark
character: ghost_pumpkin.json
```

Only a bare filename is accepted, resolved against this folder, so a unit file
cannot point the page at an arbitrary path. A unit with no `character:` falls
back to `ASSET.character` in `section.js`. Every unit gets one -- checked
against Duolingo's own path, where consecutive units stand different characters.

`lesson.js` keeps its own list for the speech-bubble character inside a lesson;
that one is picked per challenge and is separate from this.

## What is here

`bea_smores_012`, `duo_potion`, `duo_u7_1_books_01` and `vikram_u11_0_grill` are
**Duolingo's own artwork**, vendored the way the icons and CSS were. Fine for a
personal tool; they are the one part of this project that re-implementing does
not make yours. `ghost_pumpkin.json` is from LottieFiles' free catalogue and is
the template for replacing the rest.

## Adding one, quickly

The whole loop is about five minutes once you know where the file actually is.

1. **Browse** `lottiefiles.com/free-animations/<theme>` in a browser. Decline the
   cookie banner. Free-catalogue animations are under the **Lottie Simple
   License** -- commercial use, no attribution required -- but check the licence
   line on the animation's own page if it matters to you.

2. **Harvest the asset URLs in one pass.** The site is client-rendered, so `curl`
   on a listing or animation page returns an empty shell -- the URLs only exist
   after JS runs. From the browser console on a listing page:

   ```js
   [...new Set(document.documentElement.innerHTML
     .match(/https:\/\/assets-v2\.lottiefiles\.com\/a\/[^"'\\ )]*?\.lottie/gi) || [])]
   ```

   That returns ~25 at once. Take them in a single go: the listing re-renders and
   drops them from the DOM, so a second probe can come back empty.

3. **Screen them.** The CDN itself is open -- no account, no auth -- so once you
   have URLs everything else is offline:

   ```bash
   scripts/screen-lottie.sh <url> [url ...]
   ```

   **Reject anything with a non-zero `images` count.** That is the one trap worth
   knowing: plenty of "free Lottie characters" are frame-by-frame raster sprite
   sequences in a Lottie wrapper. The first ghost tried here was 150 image layers
   over 150 WebPs at 731KB. It will not scale, will not take a theme colour, and
   looks nothing like the house style. Duolingo's own files are 100% shape layers
   with zero raster assets, which is the bar.

4. **Look at the survivors.** Sizes and layer counts do not tell you whether
   something is a character or a loading spinner. Drop a throwaway page in
   `extension/section/` that mounts each candidate with `lottie.loadAnimation`,
   then `node scripts/shoot.js "section/<page>.html" out.png` and open the shot.
   The script tag must be an external `.js` file -- the extension CSP blocks
   inline scripts, which fails as a console error rather than a broken render.

5. **Install it.** `.lottie` is a zip; the screening script already unpacked it:

   ```bash
   cp output/lottie-screen/<n>/u/animations/*.json \
      extension/section/assets/characters/<name>.json
   ```

   Then add `character: <name>.json` to the unit and screenshot the section page.

## Worth knowing

- **Unpacked JSON is much larger than the download.** `ghost_pumpkin` is 151KB as
  a `.lottie` and 590KB as JSON, against Bea's 140KB. Weigh that before adding
  several.
- **Provenance.** The listing renders slugs and file URLs in unrelated parts of
  the DOM, so a downloaded file cannot be mapped back to its author page
  afterwards. If you want the credit recorded, note the animation page URL while
  you are still on it.
