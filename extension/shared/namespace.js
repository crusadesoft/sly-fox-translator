// The one object every content-script module shares.
//
// Each module below is wrapped in its own IIFE, so nothing leaks between them
// by accident. Anything one module needs from another is hung on this object
// instead, which keeps every cross-module reference visible at the call site
// as `LWR.something`.
//
// This file also owns the re-injection guard. Chrome replays the whole content
// script list whenever the extension is reloaded or the popup asks for a fresh
// injection, and it does that on frames that are already running. When that
// happens, refresh the copy that is live and leave `ready` set: every module
// below checks it and returns without redefining anything or throwing away
// live state.
(() => {
  const REFRESH_KEY = "__learnedWordReplacerRefresh";

  if (typeof globalThis[REFRESH_KEY] === "function") {
    globalThis[REFRESH_KEY]();
    return;
  }

  globalThis.__learnedWordReplacerShared = { ready: false };
})();
