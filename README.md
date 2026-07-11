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
