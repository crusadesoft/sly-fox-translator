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

  function isDuolingoSectionsPage() {
    return (
      /(^|\.)duolingo\.com$/i.test(globalThis.location.hostname) &&
      globalThis.location.pathname === "/sections"
    );
  }

  // Our own lesson player. It is not on duolingo.com, but it draws Duolingo's
  // markup node for node -- the same data-test contract -- so everything in
  // this folder that works by finding a word bank or a visible challenge works
  // there unchanged. Pointing those features at it is a matter of letting them
  // run, not of writing them twice.
  function isSlyFoxLessonPage() {
    return (
      globalThis.location.protocol === "chrome-extension:" &&
      /\/section\/lesson\.html$/.test(globalThis.location.pathname)
    );
  }

  // Where the in-lesson features belong: Duolingo's lessons, and ours.
  function isLessonSurface() {
    return isDuolingoHost() || isSlyFoxLessonPage();
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    isDuolingoHost,
    isDuolingoWordsPage,
    isDuolingoSectionsPage,
    isSlyFoxLessonPage,
    isLessonSurface
  });
})();
