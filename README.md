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

Check it with:

```sh
node scripts/test-section.js
```

It loads the unpacked extension into Chrome, stands in for the sections page,
and follows the card through to the unit. `--headed` to watch it happen.

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

### Runtime tests

The translation runtime has a Playwright harness with a fake Translator API, so behavior can be tested without waiting for Chrome to download a real language pack:

```sh
NODE_PATH=/Users/gfelter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules /Users/gfelter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node scripts/test-extension-runtime.js
```

## Android prototype

This repository also contains an earlier Android accessibility-overlay prototype. It is separate from the browser extension.

Build it with:

```sh
./scripts/build-debug.sh
```
