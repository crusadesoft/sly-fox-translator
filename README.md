# Sly Fox Translator

Sly Fox Translator is a Chrome extension for language learning. It replaces only the words and phrases you have learned while you browse.

## Install the beta from GitHub

Until the Chrome Web Store review is complete, friends can install the beta from the latest [GitHub release](https://github.com/crusadesoft/sly-fox-translator/releases/latest).

1. Download the file named `sly-fox-translator-...-unpacked.zip` from the release page.
2. Double-click the ZIP file to unzip it.
3. In Chrome, open `chrome://extensions`.
4. Turn on **Developer mode** in the top-right corner.
5. Click **Load unpacked**.
6. Select the unzipped Sly Fox Translator folder. It is the folder containing `manifest.json`.

The Sly Fox icon will appear in Chrome's extensions menu. Pin it if you want it in the toolbar.

## The Sly Fox section

The extension adds its own section to duolingo.com/sections, between the last
real section and Daily Refresh, and it opens a unit of its own.

The unit does not live inside duolingo.com/learn. Their path is virtualised, so
anything grafted into it has to survive React unmounting its neighbours on every
scroll; ours is a page the extension serves instead (`extension/section/`).

None of it is styled by hand. Duolingo's stylesheets, colour tokens, path
artwork, typeface and character animation are harvested into
`build-assets/duolingo-kit/`, and `scripts/build-duolingo-css.py` extracts the
rules the page actually uses into `extension/section/duolingo.css`. The class
names are per-build hashes, so when Duolingo redeploys the section will stop
looking right — `build-assets/duolingo-kit/README.md` says how to re-harvest.

Its lessons play five of Duolingo's challenge types — select-the-meaning,
word-bank translation, matching pairs, tap-what-you-hear, and matching pairs
against audio. The two word-bank types can also be answered by typing, which is
their keyboard toggle rather than a challenge type of its own. Listening speaks
through `chrome.tts` rather than recorded audio, so a challenge is dropped when
there is no voice for the language, and hovering a hinted word says it as well
as glossing it. It has to be `chrome.tts`: `speechSynthesis` silently never
starts on an extension page.

Clicking a puck you have already started offers **Reset progress** (or **Reset
this puck** once it is finished), which puts just that puck back to untouched
and re-locks whatever was behind it. It asks once — the first tap arms it, the
second does it — and it is ours rather than Duolingo's, so it wears their
borderless text-button styling rather than pretending to be one of their
controls.

Two behaviours ride on top of the queue, both taken from the real thing. A
challenge answered wrong is re-queued: after the last new one, Duo asks to
review what was missed, and every miss comes back re-shuffled under an orange
PREVIOUS MISTAKE badge until it is answered right — a lesson cannot be finished
with anything still owed. And a finished puck grows a gold LEGENDARY button that
replays all of its lessons at once with the hints stripped out.

`build-assets/duolingo-kit/observed-lesson-behaviour.md` is the transcript of a
real practice session those were built from — every colour, class and state,
recorded rather than guessed.

## A lesson from a subtitle line

The player is also reachable from outside the section. On YouTube, each line in
Language Reactor's subtitle panel grows a dumbbell button that turns that one
line into a lesson and opens it — the words glossed, the sentence read, heard,
produced and spoken. It emits the same challenge objects a unit file holds, so it
is not a second path through the player: `?impromptu=1` reads a lesson out of
storage where `?unit=` reads one out of a file, and nothing after that differs.

`extension/youtube/` is the two halves of it — reading Language Reactor's panel,
and building a lesson from one line. Neither writes a practice record.

To look at a page rather than only query it:

```sh
node scripts/shoot.js "section/lesson.html?lesson=listening" listen --steps 4
```

It loads the unpacked extension, walks that many challenges, writes PNGs to
`output/shots/`, and prints any error the page threw. Querying is not seeing: a
control can be in the DOM, carry the right `data-test` and click fine while
rendering off the bottom of the screen. The browser is closed in a `finally`, so
it cannot leave a headless Chromium running.

## Create a beta release

Pushing a version tag automatically creates a GitHub release with an installable ZIP.

1. Update the version in `extension/manifest.json`.
2. Commit and push that change to `main`.
3. Create and push a matching tag, such as `v0.1.1` for manifest version `0.1.1`:

   ```sh
   git tag v0.1.1
   git push origin v0.1.1
   ```

The GitHub Action packages the contents of `extension/`, creates the release, and attaches the ZIP. The release notes contain the same installation steps above.

## Development

The extension source is in `extension/`. For local development, open `chrome://extensions`, turn on Developer mode, select **Load unpacked**, and choose the `extension` directory.

The extension cannot run on browser-internal pages such as `chrome://settings`, but it will run on normal webpages.

### Checking the content

The lesson and unit files are YAML, read by the same js-yaml the player uses:

```sh
node scripts/check-lessons.js
```

It reports anything a lesson page would silently drop — a bad answer, a hint
keyed to a word that is not in the prompt, a match placed before anything
teaches its words — and a YAML mistake with the line it is on. `scripts/shoot.js`
above is the other half: run it to look at the page the file produces.

## Android prototype

This repository also contains an earlier Android accessibility-overlay prototype. It is separate from the browser extension.

Build it with:

```sh
./scripts/build-debug.sh
```
