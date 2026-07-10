# Language Overlay Prototype

Minimal Android prototype for testing whether an AccessibilityService can create language-learning overlays across apps.

The app includes a paginated vocabulary manager where users can add, edit in place, delete, and reset learned word replacements with icon controls. Users can keep multiple language profiles, such as Spanish and Greek, and swap the active profile from a dropdown in the manager. The service reads visible accessibility text, substitutes the saved local dictionary for the active profile, and draws replacement-looking `TYPE_ACCESSIBILITY_OVERLAY` views above matching text nodes.

Build:

```sh
./scripts/build-debug.sh
```

Install:

```sh
adb install -r build/language-overlay-debug.apk
```

Launch the installed app to manage vocabulary and language profiles. Saved profiles and entries are stored locally in the app's private `SharedPreferences`, then picked up by the overlay service on its next scan.

For emulator-only testing, the service can be enabled with:

```sh
adb shell settings put secure enabled_accessibility_services com.example.languageoverlay/.LanguageOverlayService
adb shell settings put secure accessibility_enabled 1
```

## Browser extension

This repo also includes a local browser extension in `extension/`.

Load it from `chrome://extensions` or `edge://extensions` with developer mode enabled, then choose "Load unpacked" and select the `extension` folder. The popup lets you add learned word or phrase replacements, toggle individual entries, import/export tab-separated pairs, and enable or disable replacement globally.
