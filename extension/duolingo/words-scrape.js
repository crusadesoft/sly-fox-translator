// Reading the whole vocabulary off Duolingo's Words page.
//
// Duolingo pages the list behind a "Load more" button and never says how many
// clicks are left, so this clicks until the count stops going up, and refuses
// to return a partial list — the heading states the real total, and a sync that
// silently imported half of it would look like it worked.
//
// The rows are read through readOriginalNodeText, because this page can itself
// be translated by the extension: the words have to come back as Duolingo
// wrote them, not as the page now shows them.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  function normalizeDuolingoText(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function readOriginalNodeText(node) {
    if (!node) {
      return "";
    }

    const clone = node.cloneNode(true);
    for (const token of clone.querySelectorAll(`.${LWR.REPLACEMENT_CLASS}`)) {
      token.replaceWith(
        document.createTextNode(token.dataset.learnedWordOriginal || token.textContent || "")
      );
    }
    return normalizeDuolingoText(clone.textContent);
  }

  function readDuolingoWordRow(item) {
    const heading = item.querySelector("h2,h3,h4");
    const meaning =
      Array.from(heading?.parentElement?.children || []).find(
        (child) => child.tagName === "P"
      ) || item.querySelector("p");
    const word = readOriginalNodeText(heading);
    const meanings = readOriginalNodeText(meaning);

    return word && meanings ? { word, meanings } : null;
  }

  function getDuolingoWordCollection() {
    const collections = Array.from(document.querySelectorAll("ul")).map((list) => ({
      list,
      records: Array.from(list.children).map(readDuolingoWordRow).filter(Boolean)
    }));

    collections.sort((a, b) => b.records.length - a.records.length);
    return collections[0] || { list: null, records: [] };
  }

  function getDuolingoLoadMoreControl(list) {
    return Array.from(list?.children || []).find(
      (item) =>
        (item.matches("button") || item.getAttribute("role") === "button") &&
        normalizeDuolingoText(item.textContent).toLocaleLowerCase() === "load more"
    );
  }

  function getDuolingoWordsCountHeading() {
    for (const heading of document.querySelectorAll("h1,h2,h3")) {
      if (/^\d[\d,]*\s+words?$/i.test(normalizeDuolingoText(heading.textContent))) {
        return heading;
      }
    }
    return null;
  }

  function getDuolingoExpectedWordCount() {
    const heading = getDuolingoWordsCountHeading();
    const match = heading
      ? normalizeDuolingoText(heading.textContent).match(/^(\d[\d,]*)\s+words?$/i)
      : null;
    return match ? Number(match[1].replaceAll(",", "")) : 0;
  }

  function getDuolingoLanguageName() {
    for (const heading of document.querySelectorAll("h1,h2,h3")) {
      const match = normalizeDuolingoText(heading.textContent).match(
        /^Practice your (.+?) words$/i
      );
      if (match) {
        return match[1].trim();
      }
    }
    return "";
  }

  function waitForDuolingoWordCountIncrease(previousCount, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const observer = new MutationObserver(checkCount);
      const timer = setTimeout(() => finish(false), timeoutMs);

      function finish(success) {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        observer.disconnect();
        if (success) {
          resolve();
        } else {
          reject(new Error("Duolingo did not load the next group of words."));
        }
      }

      function checkCount() {
        if (getDuolingoWordCollection().records.length > previousCount) {
          finish(true);
        }
      }

      observer.observe(document.body, { childList: true, subtree: true });
      checkCount();
    });
  }

  async function scrapeAllDuolingoWords() {
    if (!LWR.isDuolingoWordsPage()) {
      throw new Error("Open Duolingo's Words page before syncing.");
    }

    // Keep clicking "Load more" until the whole list is on the page. Progress
    // is enforced per click — waitForDuolingoWordCountIncrease rejects when a
    // click loads nothing new — so the cap is only a runaway guard, sized far
    // above any real vocabulary (1000 clicks ~ 100k words).
    for (let loadAttempt = 0; loadAttempt < 1000; loadAttempt += 1) {
      const collection = getDuolingoWordCollection();
      const loadMore = getDuolingoLoadMoreControl(collection.list);
      if (!loadMore) {
        break;
      }

      const previousCount = collection.records.length;
      loadMore.click();
      await waitForDuolingoWordCountIncrease(previousCount);
    }

    const collection = getDuolingoWordCollection();
    const expectedCount = getDuolingoExpectedWordCount();
    const seen = new Set();
    const records = collection.records.filter((record) => {
      const key = `${record.word}\n${record.meanings}`.toLocaleLowerCase();
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });

    if (!records.length) {
      throw new Error("No learned words were found on this Duolingo page.");
    }

    if (expectedCount && records.length < expectedCount) {
      throw new Error(`Duolingo showed ${expectedCount} words, but only ${records.length} loaded.`);
    }

    return {
      count: records.length,
      expectedCount,
      languageName: getDuolingoLanguageName(),
      text: records.map((record) => `${record.word} - ${record.meanings}`).join("\n")
    };
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    getDuolingoWordCollection,
    getDuolingoWordsCountHeading,
    readDuolingoWordRow,
    scrapeAllDuolingoWords
  });
})();
