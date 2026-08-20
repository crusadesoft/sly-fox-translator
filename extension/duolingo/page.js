// Which Duolingo page this is.
//
// Every module in this folder starts by asking one of these two questions, so
// they live on their own rather than being buried in whichever module happened
// to need them first.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  function isDuolingoHost() {
    return /(^|\.)duolingo\.com$/i.test(globalThis.location.hostname);
  }

  function isDuolingoWordsPage() {
    return (
      /(^|\.)duolingo\.com$/i.test(globalThis.location.hostname) &&
      globalThis.location.pathname === "/practice-hub/words"
    );
  }

  // Reached for by other modules.
  Object.assign(LWR, { isDuolingoHost, isDuolingoWordsPage });
})();
