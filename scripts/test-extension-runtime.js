const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CONTENT_SCRIPT = path.resolve(__dirname, "../extension/content.js");
const POPUP_PAGE = `file://${path.resolve(__dirname, "../extension/popup.html")}`;
const SIDE_PANEL_PAGE = `${POPUP_PAGE}?view=sidepanel`;
const BACKGROUND_SCRIPT = path.resolve(__dirname, "../extension/background.js");
const TRANSLATOR_BRIDGE_SCRIPT = path.resolve(__dirname, "../extension/page-translator-bridge.js");
const TRANSLATOR_BRIDGE_CONTENT = fs.readFileSync(TRANSLATOR_BRIDGE_SCRIPT, "utf8");
const UKRAINIAN_MORPHOLOGY_SCRIPT = path.resolve(
  __dirname,
  "../extension/vendor/ukrainian-morphology.js"
);
const UKRAINIAN_MORPHOLOGY_DICTIONARY = path.resolve(
  __dirname,
  "../extension/vendor/ukrainian-morphology/ukrainian.dict"
);
const POPUP_SCRIPT = path.resolve(__dirname, "../extension/popup.js");
const POPUP_STYLES = path.resolve(__dirname, "../extension/popup.css");
const LUCIDE_ICON_DIR = path.resolve(__dirname, "../extension/icons/lucide");

function createState(entries) {
  return {
    version: 2,
    enabled: true,
    showHighlights: true,
    currentProfileId: "uk-test",
    profiles: [
      {
        id: "uk-test",
        name: "Ukrainian Test",
        languageCode: "uk",
        entries
      }
    ]
  };
}

function testVendoredLucideIcons() {
  const popupScript = fs.readFileSync(POPUP_SCRIPT, "utf8");
  const popupStyles = fs.readFileSync(POPUP_STYLES, "utf8");
  const requiredAssets = [
    "arrow-up-a-z.svg",
    "check.svg",
    "import.svg",
    "pencil.svg",
    "rotate-ccw.svg",
    "settings.svg",
    "square-arrow-out-up-right.svg",
    "trash-2.svg"
  ];

  assert(!popupScript.includes("LUCIDE_ICONS"), "popup still contains locally defined Lucide paths");
  assert(fs.existsSync(path.join(LUCIDE_ICON_DIR, "LICENSE")), "Lucide ISC license is missing");

  for (const asset of requiredAssets) {
    const assetPath = path.join(LUCIDE_ICON_DIR, asset);
    assert(fs.existsSync(assetPath), `missing vendored Lucide asset: ${asset}`);
    assert(
      fs.readFileSync(assetPath, "utf8").startsWith("<!-- @license lucide-static v1.24.0 - ISC -->"),
      `${asset} is not an official lucide-static asset`
    );
    assert(
      popupStyles.includes(`icons/lucide/${asset}`),
      `${asset} is not referenced through the Lucide asset stylesheet`
    );
  }
}

function testUkrainianMorphologyDictionary() {
  const context = { TextDecoder, TextEncoder, Uint8Array };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(UKRAINIAN_MORPHOLOGY_SCRIPT, "utf8"), context);

  const dictionary = context.LWRUkrainianMorphology.create(
    new Uint8Array(fs.readFileSync(UKRAINIAN_MORPHOLOGY_DICTIONARY))
  );

  assert(fs.statSync(UKRAINIAN_MORPHOLOGY_DICTIONARY).size > 6_000_000, "Ukrainian dictionary is incomplete");
  assert(dictionary.lookup("їх").includes("вони"), "dictionary did not map їх to вони");
  assert(dictionary.lookup("батька").includes("батько"), "dictionary did not map батька to батько");
  assert(dictionary.lookup("радіонавігація").includes("радіонавігація"), "dictionary lost compound lemma");
}

function testFullExportDoesNotUseClickEventAsFilter() {
  const popupScript = fs.readFileSync(POPUP_SCRIPT, "utf8");
  assert(
    popupScript.includes('elements.exportButton.addEventListener("click", () => exportEntries());'),
    "all-vocabulary export passes its click event to the export filter"
  );
  assert(
    popupScript.includes('const exportOrigin = origin === "manual" ? "manual" : "";'),
    "export filter accepts arbitrary values instead of only the manual scope"
  );
}

function readBackgroundScriptForVm() {
  // The service worker is an ES module; the vm-based tests run it as a classic
  // script, so drop the import statements and stub the aligner dependencies.
  return fs
    .readFileSync(BACKGROUND_SCRIPT, "utf8")
    .replace(/^import[\s\S]*?from\s+"[^"]*";$/gm, "")
    .replace(/^import\s+"[^"]*";$/gm, "");
}

async function installHarness(page, { state, translator, config = {}, wordAligner = null }) {
  await page.evaluate(
    ({ savedState, testConfig }) => {
      window.chrome = {
        runtime: {
          lastError: null,
          onMessage: {
            addListener(listener) {
              window.__runtimeMessageListener = listener;
            }
          },
          sendMessage(message) {
            window.__runtimeMessages = window.__runtimeMessages || [];
            window.__runtimeMessages.push(message);
          }
        },
        storage: {
          local: {
            get(defaults, callback) {
              callback({ learnedWordReplacerState: savedState });
            }
          },
          onChanged: {
            addListener(listener) {
              window.__storageChangeListener = listener;
            }
          }
        }
      };
      window.__learnedWordReplacerTestConfig = testConfig;
    },
    {
      savedState: state,
      testConfig: {
        applyDebounceMs: 20,
        viewportMarginPx: 10000,
        ukrainianLemmas: {},
        wordAligner: null,
        ...config
      }
    }
  );

  await page.exposeFunction("__testTranslatorAvailability", translator.availability);
  await page.exposeFunction("__testTranslatorTranslate", createBatchAwareTranslate(translator));
  await page.evaluate(() => {
    window.__learnedWordReplacerTestConfig.Translator = {
      availability: (options) => window.__testTranslatorAvailability(options),
      create: async () => {
        const config = window.__learnedWordReplacerTestConfig;
        if (config.translatorCreateRejectMessage) {
          throw new Error(config.translatorCreateRejectMessage);
        }

        const instance = {
          translate: (text) => window.__testTranslatorTranslate(text)
        };
        const inputQuota = Number(config.translatorInputQuota);

        if (Number.isFinite(inputQuota) || config.translatorInputQuota === Infinity) {
          instance.inputQuota = inputQuota;
        }

        if (config.measureInputUsageAsLength) {
          instance.measureInputUsage = (text) => String(text || "").length;
        }

        return instance;
      }
    };
  });

  if (wordAligner) {
    await page.exposeFunction("__testWordAligner", wordAligner);
    await page.evaluate(() => {
      window.__learnedWordReplacerTestConfig.wordAligner = (source, translated) =>
        window.__testWordAligner(source, translated);
    });
  }

  await page.addScriptTag({ path: CONTENT_SCRIPT });
}

function createBatchAwareTranslate(translator) {
  return async (text) => {
    const items = parseBatchInput(text);
    if (!items.length) {
      return translator.translate(text);
    }

    if (translator.onBatch) {
      translator.onBatch(items.map((item) => item.text));
    }

    const translatedItems = [];
    for (const item of items) {
      const translated = translator.translateBatchItem
        ? await translator.translateBatchItem(item.text)
        : await translator.translate(item.text);
      translatedItems.push(`<${item.tagName}>${translated}</${item.tagName}>`);
    }
    return translatedItems.join(" ");
  };
}

function parseBatchInput(text) {
  const source = String(text || "");
  const matches = [];
  const pattern = /<lwr(\d+)>\s*([\s\S]*?)\s*<\/lwr\1>/gi;
  let match = pattern.exec(source);

  while (match) {
    matches.push({
      tagName: `lwr${match[1]}`,
      text: match[2].trim()
    });
    match = pattern.exec(source);
  }

  return matches;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function testReplacementUsesTranslatedTokens(browser) {
  const page = await browser.newPage();
  await page.setContent("<p>It is in the house and this is my car.</p>");
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "not used", target: "це", enabled: true, createdAt: 1 },
      { id: "e2", source: "not used", target: "у", enabled: true, createdAt: 2 },
      { id: "e3", source: "not used", target: "та", enabled: true, createdAt: 3 },
      { id: "e4", source: "not used", target: "моє", enabled: true, createdAt: 4 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        if (text === "is in the house and this is my car.") {
          return "у будинку та це моє авто.";
        }
        if (text === "It is the house and this is my car.") {
          return "Це будинок та це моє авто.";
        }
        if (text === "It is in the house this is my car.") {
          return "Це у будинку це моє авто.";
        }
        if (text === "It is in the house and is my car.") {
          return "Це у будинку та моє авто.";
        }
        if (text === "It is in the house and this is car.") {
          return "Це у будинку та це авто.";
        }
        return "Це у будинку та це моє авто.";
      }
    }
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-token").length >= 4
  );
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    replacements: Array.from(document.querySelectorAll(".learned-word-replacer-token")).map(
      (node) => ({
        text: node.textContent,
        original: node.dataset.learnedWordOriginal
      })
    ),
    stats: window.__learnedWordReplacerDebug.getSnapshot()
  }));

  assert(result.text.includes("Це is у the house та це is моє car."), "translated tokens not inserted");
  assert(result.replacements.some((item) => item.original === "It" && item.text === "Це"), "It was not aligned to translated token");
  assert(result.stats.replacementCount >= 4, "replacement count not tracked");
  await page.close();
}

async function testUkrainianWordFamiliesUseTranslatedInflections(browser) {
  const page = await browser.newPage();
  const source = "The machine is here.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "machine", target: "машина", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? "Машину тут." : "")
    },
    config: {
      ukrainianLemmas: {
        машина: ["машина"],
        машину: ["машина"]
      }
    }
  });

  await page.waitForFunction(() => document.querySelectorAll(".learned-word-replacer-token").length === 1);
  const result = await page.evaluate(() => {
    const token = document.querySelector(".learned-word-replacer-token");
    return {
      text: document.body.innerText,
      original: token?.dataset.learnedWordOriginal,
      target: token?.dataset.learnedWordTarget,
      kind: token?.dataset.learnedWordMatchKind
    };
  });

  assert(
    result.text === "The Машину is here.",
    `inflected Ukrainian word was not inserted: ${JSON.stringify(result)}`
  );
  assert(result.original === "machine", "word-family match aligned the wrong English word");
  assert(result.target === "Машину", "word-family match did not retain Chrome's surface form");
  assert(result.kind === "word-family", "word-family match was not identified in page status");
  await page.close();
}

async function testRepeatedWordReplacesEveryOccurrenceInSentence(browser) {
  const page = await browser.newPage();
  const source = "Radio is the technology of communicating using radio waves.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "radio", target: "радіо", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      // The second "radio" is absorbed by the compound "радіохвиль", so the
      // translation contains fewer standalone occurrences than the source.
      translate: async (text) =>
        text === source ? "Радіо - це технологія зв'язку за допомогою радіохвиль." : ""
    }
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-token").length === 2
  );
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    replacements: Array.from(document.querySelectorAll(".learned-word-replacer-token")).map(
      (node) => ({
        text: node.textContent,
        original: node.dataset.learnedWordOriginal
      })
    )
  }));

  assert(
    result.text === "Радіо is the technology of communicating using радіо waves.",
    `repeated learned word was not replaced at every occurrence: ${JSON.stringify(result)}`
  );
  assert(
    result.replacements.some((item) => item.original === "Radio" && item.text === "Радіо"),
    "sentence-initial occurrence lost Chrome's surface form"
  );
  assert(
    result.replacements.some((item) => item.original === "radio" && item.text === "радіо"),
    "extra occurrence did not adapt its case to the English original"
  );
  await page.close();
}

async function testBlocksWithInlineMarkupTranslateAllTextNodes(browser) {
  const page = await browser.newPage();
  const source = "Radio is the technology of communicating using radio waves.";
  const translationCalls = [];
  await page.setContent(
    "<p><b>Radio</b> is the technology of <a href=\"#\">communicating</a> using <a href=\"#\">radio waves</a>.</p>"
  );
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "radio", target: "радіо", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        translationCalls.push(text);
        return text === source ? "Радіо - це технологія зв'язку за допомогою радіохвиль." : "";
      }
    }
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-token").length === 2
  );
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    replacements: Array.from(document.querySelectorAll(".learned-word-replacer-token")).map(
      (node) => ({
        text: node.textContent,
        original: node.dataset.learnedWordOriginal
      })
    )
  }));

  assert(
    translationCalls.includes(source),
    `linked paragraph was not translated as one full unit: ${JSON.stringify(translationCalls)}`
  );
  assert(
    result.text === "Радіо is the technology of communicating using радіо waves.",
    `text nodes after inline markup were not replaced: ${JSON.stringify(result)}`
  );
  await page.close();
}

async function testPluralEnglishWordAlignsToSingularEntry(browser) {
  const page = await browser.newPage();
  const source = "These systems are reliable.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "system", target: "система", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? "Ці системи надійні." : "")
    },
    config: {
      ukrainianLemmas: {
        система: ["система"],
        системи: ["система"]
      }
    }
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-token").length === 1
  );
  const result = await page.evaluate(() => {
    const token = document.querySelector(".learned-word-replacer-token");
    return {
      text: document.body.innerText,
      original: token?.dataset.learnedWordOriginal,
      target: token?.dataset.learnedWordTarget
    };
  });

  assert(
    result.text === "These системи are reliable.",
    `plural English word did not align to the singular entry: ${JSON.stringify(result)}`
  );
  assert(result.original === "systems", "plural English occurrence was not the aligned span");
  assert(result.target === "системи", "inflected Ukrainian form was not inserted");
  await page.close();
}

async function testAmbiguousUkrainianFormPrefersEntryWithEnglishEvidence(browser) {
  const page = await browser.newPage();
  const source = "They can be received by other antennas.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      // "їх" is a form of both "їхати" (go) and "вони" (they); the entry whose
      // English word appears in the sentence must win the match.
      { id: "e1", source: "go", target: "їхати", enabled: true, createdAt: 1 },
      { id: "e2", source: "they", target: "вони", enabled: true, createdAt: 2 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? "Їх можуть приймати інші антени." : "")
    },
    config: {
      ukrainianLemmas: {
        "їхати": ["їхати"],
        "вони": ["вони"],
        "їх": ["їхати", "вони"]
      }
    }
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-token").length === 1
  );
  const result = await page.evaluate(() => {
    const token = document.querySelector(".learned-word-replacer-token");
    return {
      text: document.body.innerText,
      original: token?.dataset.learnedWordOriginal,
      target: token?.dataset.learnedWordTarget
    };
  });

  assert(
    result.text === "Їх can be received by other antennas.",
    `ambiguous Ukrainian form did not align through the evidenced entry: ${JSON.stringify(result)}`
  );
  assert(result.original === "They", "the evidenced English word was not the replaced span");
  await page.close();
}

async function testNeuralAlignerResolvesMatchesWithoutEnglishHints(browser) {
  const page = await browser.newPage();
  const source = "The existence of radio waves was first proven.";
  const translated = "Існування радіохвиль вперше було доведено.";
  const alignerCalls = [];
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      // "було" is a form of "бути"; the entry's English hint "there is" does
      // not appear in the sentence, so only the neural aligner can place it.
      { id: "e1", source: "there is", target: "є", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? translated : "")
    },
    config: {
      ukrainianLemmas: {
        "є": ["бути"],
        "було": ["бути"]
      }
    },
    wordAligner: async (sourceText, translatedText) => {
      alignerCalls.push(sourceText);
      return [
        {
          srcStart: sourceText.indexOf("was"),
          srcEnd: sourceText.indexOf("was") + 3,
          tgtStart: translatedText.indexOf("було"),
          tgtEnd: translatedText.indexOf("було") + 4,
          score: 0.9
        }
      ];
    }
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-token").length === 1
  );
  const result = await page.evaluate(() => {
    const token = document.querySelector(".learned-word-replacer-token");
    return {
      text: document.body.innerText,
      original: token?.dataset.learnedWordOriginal,
      target: token?.dataset.learnedWordTarget,
      kind: token?.dataset.learnedWordMatchKind
    };
  });

  assert(alignerCalls.length > 0, "the neural aligner was never consulted");
  assert(
    result.text === "The existence of radio waves було first proven.",
    `neural alignment did not place the inflected word: ${JSON.stringify(result)}`
  );
  assert(result.original === "was", "neural alignment replaced the wrong English span");
  assert(result.kind === "word-family", "neural replacement lost its match kind");
  await page.close();
}

async function testNeuralAlignerNeverReplacesNumericSpans(browser) {
  const page = await browser.newPage();
  const source = "In the mid-1890s physicists studied waves.";
  const translated = "У середині 1890-х років фізики вивчали хвилі.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      // "років" is a form of "рік"; Ukrainian spells out the year word next to
      // the decade, so the aligner links "1890s" to "років" — but replacing a
      // number with a word would erase the year itself.
      { id: "e1", source: "year", target: "рік", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? translated : "")
    },
    config: {
      ukrainianLemmas: {
        "рік": ["рік"],
        "років": ["рік"]
      }
    },
    wordAligner: async (sourceText, translatedText) => [
      {
        srcStart: sourceText.indexOf("1890s"),
        srcEnd: sourceText.indexOf("1890s") + 5,
        tgtStart: translatedText.indexOf("років"),
        tgtEnd: translatedText.indexOf("років") + 5,
        score: 0.9
      }
    ]
  });

  await page.waitForFunction(() => window.__learnedWordReplacerDebug.getSnapshot().finishedAt > 0);
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    replacementCount: document.querySelectorAll(".learned-word-replacer-token").length
  }));

  assert(
    result.text === source && result.replacementCount === 0,
    `a numeric span was replaced by the aligner: ${JSON.stringify(result)}`
  );
  await page.close();
}

async function testNeuralAlignerIsSkippedWhenEnglishHintsResolve(browser) {
  const page = await browser.newPage();
  const source = "They are generated by an electronic device.";
  let alignerCalls = 0;
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "they", target: "вони", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) =>
        text === source ? "Вони генеруються електронним пристроєм." : ""
    },
    config: {
      ukrainianLemmas: {
        вони: ["вони"]
      }
    },
    wordAligner: async () => {
      alignerCalls += 1;
      return [];
    }
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-token").length === 1
  );
  const result = await page.evaluate(() => ({
    text: document.body.innerText
  }));

  assert(
    result.text === "Вони are generated by an electronic device.",
    `hint-based alignment stopped working: ${JSON.stringify(result)}`
  );
  assert(alignerCalls === 0, "the neural aligner ran even though English hints resolved everything");
  await page.close();
}

function createStructureModeAligner() {
  return async (sourceText, translatedText) => {
    const pairs = [];
    const link = (english, ukrainian) => {
      const srcStart = sourceText.indexOf(english);
      const tgtStart = translatedText.indexOf(ukrainian);
      if (srcStart >= 0 && tgtStart >= 0) {
        pairs.push({
          srcStart,
          srcEnd: srcStart + english.length,
          tgtStart,
          tgtEnd: tgtStart + ukrainian.length,
          score: 0.9
        });
      }
    };
    link("Radio", "\u0420\u0430\u0434\u0456\u043e");
    link("is", "\u0446\u0435");
    link("technology", "\u0442\u0435\u0445\u043d\u043e\u043b\u043e\u0433\u0456\u044f");
    link("communicating", "\u0437\u0432'\u044f\u0437\u043a\u0443");
    return pairs;
  };
}

async function testStructureModeRebuildsSentencesInTargetOrder(browser) {
  const page = await browser.newPage();
  const source = "Radio is the technology of communicating.";
  await page.setContent('<p>Radio is the technology of <a href="#">communicating</a>.</p>');
  await installHarness(page, {
    state: {
      ...createState([{ id: "e1", source: "radio", target: "радіо", enabled: true, createdAt: 1 }]),
      structureMode: true
    },
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? "Радіо - це технологія зв'язку." : "")
    },
    config: {
      ukrainianLemmas: { "радіо": ["радіо"] }
    },
    wordAligner: createStructureModeAligner()
  });

  await page.waitForFunction(
    () => document.querySelector(".learned-word-replacer-structured") !== null
  );
  const result = await page.evaluate(() => {
    const known = document.querySelector(
      '.learned-word-replacer-token:not([data-learned-word-match-kind="back-translation"])'
    );
    const scaffold = [...document.querySelectorAll(
      '.learned-word-replacer-token[data-learned-word-match-kind="back-translation"]'
    )];
    return {
      text: document.body.innerText,
      known: { text: known?.textContent, original: known?.dataset.learnedWordOriginal },
      scaffold: scaffold.map((s) => `${s.dataset.learnedWordOriginal}→${s.textContent}`)
    };
  });

  assert(
    result.text === "Радіо - is technology communicating.",
    `structure mode did not rebuild the sentence in target order: ${JSON.stringify(result)}`
  );
  assert(
    result.known.text === "Радіо" && result.known.original === "Radio",
    "the learned word did not stay in the target language with its English original"
  );
  assert(
    result.scaffold.join(",") === "це→is,технологія→technology,зв'язку→communicating",
    `unlearned words were not back-translated in place: ${JSON.stringify(result.scaffold)}`
  );
  await page.close();
}

async function testStructureModeRestoresOriginalMarkupWhenDisabled(browser) {
  const page = await browser.newPage();
  const source = "Radio is the technology of communicating.";
  const initialState = {
    ...createState([{ id: "e1", source: "radio", target: "радіо", enabled: true, createdAt: 1 }]),
    structureMode: true
  };
  await page.setContent('<p>Radio is the technology of <a href="#">communicating</a>.</p>');
  await installHarness(page, {
    state: initialState,
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? "Радіо - це технологія зв'язку." : "")
    },
    config: {
      ukrainianLemmas: { "радіо": ["радіо"] }
    },
    wordAligner: createStructureModeAligner()
  });

  await page.waitForFunction(
    () => document.querySelector(".learned-word-replacer-structured") !== null
  );
  await page.evaluate((nextState) => {
    window.__storageChangeListener(
      { learnedWordReplacerState: { newValue: nextState } },
      "local"
    );
  }, { ...initialState, structureMode: false });
  await page.waitForFunction(
    () =>
      document.querySelector(".learned-word-replacer-structured") === null &&
      document.body.innerText === "Радіо is the technology of communicating."
  );
  const result = await page.evaluate(() => ({
    html: document.querySelector("p").innerHTML,
    text: document.body.innerText
  }));

  assert(
    result.html.includes("<a href="),
    `disabling structure mode lost the original inline markup: ${result.html}`
  );
  assert(
    result.text === "Радіо is the technology of communicating.",
    "normal replacement mode did not resume after structure mode was disabled"
  );
  await page.close();
}

async function testStructureModeHighlightsUnalignedWordsWithHoverGuess(browser) {
  const page = await browser.newPage();
  const source = "Radio uses receivers.";
  const translated = "Радіо використовує радіоприймачі.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: {
      ...createState([{ id: "e1", source: "radio", target: "радіо", enabled: true, createdAt: 1 }]),
      structureMode: true
    },
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? translated : "")
    },
    config: {
      ukrainianLemmas: { "радіо": ["радіо"] }
    },
    wordAligner: async (sourceText, translatedText) => {
      const link = (english, ukrainian, extra) => {
        const srcStart = sourceText.indexOf(english);
        const tgtStart = translatedText.indexOf(ukrainian);
        return {
          srcStart,
          srcEnd: srcStart + english.length,
          tgtStart,
          tgtEnd: tgtStart + ukrainian.length,
          score: 0.9,
          ...extra
        };
      };
      return [
        link("Radio", "Радіо"),
        link("uses", "використовує"),
        // Compound: fails the bidirectional confidence check, so the aligner
        // only offers it as a weak best-guess candidate.
        link("receivers", "радіоприймачі", { weak: true, score: 0.0004 })
      ];
    }
  });

  await page.waitForFunction(
    () => document.querySelector(".learned-word-replacer-structured") !== null
  );
  const result = await page.evaluate(() => {
    const unlearned = document.querySelector(
      '.learned-word-replacer-token[data-learned-word-match-kind="unlearned"]'
    );
    return {
      text: document.body.innerText,
      unlearned: unlearned
        ? { text: unlearned.textContent, guess: unlearned.dataset.learnedWordOriginal }
        : null
    };
  });

  assert(
    result.text === "Радіо uses радіоприймачі.",
    `a weak guess was substituted into the sentence instead of staying a hover: ${JSON.stringify(result)}`
  );
  assert(
    result.unlearned?.text === "радіоприймачі" && result.unlearned?.guess === "receivers",
    `the unaligned word was not highlighted with its English guess: ${JSON.stringify(result.unlearned)}`
  );
  await page.close();
}

async function testNormalModeIgnoresWeakAlignmentPairs(browser) {
  const page = await browser.newPage();
  const source = "The existence of radio waves was first proven.";
  const translated = "Існування радіохвиль вперше було доведено.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "there is", target: "є", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? translated : "")
    },
    config: {
      ukrainianLemmas: {
        "є": ["бути"],
        "було": ["бути"]
      }
    },
    wordAligner: async (sourceText, translatedText) => [
      {
        srcStart: sourceText.indexOf("was"),
        srcEnd: sourceText.indexOf("was") + 3,
        tgtStart: translatedText.indexOf("було"),
        tgtEnd: translatedText.indexOf("було") + 4,
        score: 0.0004,
        weak: true
      }
    ]
  });

  await page.waitForFunction(() => window.__learnedWordReplacerDebug.getSnapshot().finishedAt > 0);
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    replacementCount: document.querySelectorAll(".learned-word-replacer-token").length
  }));

  assert(
    result.text === source && result.replacementCount === 0,
    `normal mode replaced through a weak alignment pair: ${JSON.stringify(result)}`
  );
  await page.close();
}

async function testStructureModeKeepsUnalignedSentencesInEnglish(browser) {
  const page = await browser.newPage();
  const source = "Radio is the technology of communicating.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: {
      ...createState([{ id: "e1", source: "radio", target: "радіо", enabled: true, createdAt: 1 }]),
      structureMode: true
    },
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? "Радіо - це технологія зв'язку." : "")
    },
    config: {
      ukrainianLemmas: { "радіо": ["радіо"] }
    },
    wordAligner: async () => []
  });

  await page.waitForFunction(() => window.__learnedWordReplacerDebug.getSnapshot().finishedAt > 0);
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    structured: document.querySelectorAll(".learned-word-replacer-structured").length
  }));

  assert(
    result.text === source && result.structured === 0,
    `unaligned sentence was rebuilt anyway: ${JSON.stringify(result)}`
  );
  await page.close();
}

async function testUkrainianWordFamiliesDoNotMatchCompounds(browser) {
  const page = await browser.newPage();
  const source = "Radio navigation is useful.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "radio", target: "радіо", enabled: true, createdAt: 1 },
      { id: "e2", source: "navigation", target: "навігація", enabled: true, createdAt: 2 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? "Радіонавігація корисна." : "")
    },
    config: {
      ukrainianLemmas: {
        радіо: ["радіо"],
        навігація: ["навігація"],
        радіонавігація: ["радіонавігація"]
      }
    }
  });

  await page.waitForFunction(() => window.__learnedWordReplacerDebug.getSnapshot().finishedAt > 0);
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    replacementCount: document.querySelectorAll(".learned-word-replacer-token").length
  }));

  assert(result.text === source, "compound was split into unsafe partial replacements");
  assert(result.replacementCount === 0, "compound produced an unsafe word-family replacement");
  await page.close();
}

async function testUkrainianPronounLemmaUsesChromeSurfaceForm(browser) {
  const page = await browser.newPage();
  const source = "They are generated by an electronic device.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "they", target: "вони", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? "Їх генерує електронний пристрій." : "")
    },
    config: {
      ukrainianLemmas: {
        вони: ["вони"],
        їх: ["вони"]
      }
    }
  });

  await page.waitForFunction(() => document.querySelectorAll(".learned-word-replacer-token").length === 1);
  const result = await page.evaluate(() => {
    const token = document.querySelector(".learned-word-replacer-token");
    return {
      text: document.body.innerText,
      original: token?.dataset.learnedWordOriginal,
      target: token?.dataset.learnedWordTarget,
      kind: token?.dataset.learnedWordMatchKind
    };
  });

  assert(result.text === "Їх are generated by an electronic device.", "pronoun lemma was not inserted");
  assert(result.original === "They", "pronoun lemma aligned the wrong English source");
  assert(result.target === "Їх", "pronoun lemma did not preserve Chrome's surface form");
  assert(result.kind === "word-family", "pronoun lemma was not reported as a word-family match");
  await page.close();
}

async function testRuntimeStatusCountsLiveReplacementSpans(browser) {
  const page = await browser.newPage();
  await page.setContent("<p>It is in the house.</p>");
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "house", target: "будинку", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async () => "Це у будинку."
    }
  });

  await page.waitForSelector(".learned-word-replacer-token");
  const result = await page.evaluate(() => {
    const extra = document.createElement("span");
    extra.className = "learned-word-replacer-token";
    extra.textContent = "додатково";
    document.body.appendChild(extra);
    return {
      liveCount: document.querySelectorAll(".learned-word-replacer-token").length,
      reportedCount: window.__learnedWordReplacerDebug.getSnapshot().replacementCount
    };
  });

  assert(
    result.reportedCount === result.liveCount,
    "runtime status did not reflect replacement spans currently on the page"
  );
  await page.close();
}

async function testProcessedBlocksAreMarkedOnPage(browser) {
  const page = await browser.newPage();
  await page.setContent("<p>It is in the house.</p><p>Nothing matches here.</p>");
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "house", target: "будинку", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) =>
        text === "It is in the house." ? "Це у будинку." : "Нічого тут не збігається."
    }
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-checked").length === 2
  );
  const result = await page.evaluate(() => ({
    markedCount: document.querySelectorAll(".learned-word-replacer-checked").length,
    styleIncludesMarker: document
      .getElementById("learned-word-replacer-style")
      ?.textContent.includes(".learned-word-replacer-checked")
  }));

  assert(result.markedCount === 2, "processed page sections were not marked");
  assert(result.styleIncludesMarker, "processed section marker style was not installed");
  await page.close();

  const hiddenPage = await browser.newPage();
  await hiddenPage.setContent("<p>It is in the house.</p>");
  await installHarness(hiddenPage, {
    state: {
      ...createState([{ id: "e1", source: "house", target: "будинку", enabled: true, createdAt: 1 }]),
      showProcessedSections: false
    },
    translator: {
      availability: async () => "available",
      translate: async () => "Це у будинку."
    }
  });
  await hiddenPage.waitForSelector(".learned-word-replacer-token");
  const hiddenResult = await hiddenPage.evaluate(() =>
    document.getElementById("learned-word-replacer-style")?.textContent.includes(
      ".learned-word-replacer-checked"
    )
  );
  assert(!hiddenResult, "processed section rail rendered while its setting was disabled");
  await hiddenPage.close();
}

async function testHoverTranslatesEnglishWord(browser) {
  const page = await browser.newPage();
  let houseTranslationCalls = 0;
  await page.setContent('<p id="hover-copy">house</p>');
  await page.evaluate(() => {
    const textNode = document.getElementById("hover-copy").firstChild;
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: undefined
    });
    document.caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.collapse(true);
      return range;
    };
  });

  await installHarness(page, {
    state: createState([{ id: "e1", source: "cat", target: "кіт", enabled: true, createdAt: 1 }]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        if (text === "house") {
          houseTranslationCalls += 1;
          return "будинок";
        }
        return text;
      }
    },
    config: { reverseHoverDelayMs: 10 }
  });

  await page.waitForFunction(
    () => window.__learnedWordReplacerDebug.getSnapshot().status === "complete"
  );
  await page.evaluate(() => {
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 80, clientY: 40, pointerType: "mouse" })
    );
  });
  await page.waitForSelector('.learned-word-replacer-hover-tooltip[data-visible="true"]');
  const firstHover = await page.evaluate(() => ({
    text: document.querySelector(".learned-word-replacer-hover-tooltip")?.textContent,
    color: getComputedStyle(document.querySelector(".learned-word-replacer-hover-tooltip")).color
  }));

  assert(
    firstHover.text === "Ukrainian Test: будинок",
    "English hover did not show the active profile's Ukrainian translation"
  );
  assert(firstHover.color === "rgb(255, 255, 255)", "English hover tooltip lost its readable text color");
  assert(houseTranslationCalls === 2, "English word was not translated for the hover tooltip");

  await page.evaluate(() => {
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 85, clientY: 40, pointerType: "mouse" })
    );
  });
  await page.waitForTimeout(30);
  assert(houseTranslationCalls === 2, "hovering the same word did not use the translation cache");
  await page.close();
}

async function testHoverSettingsCanBeDisabled(browser) {
  const page = await browser.newPage();
  let houseTranslationCalls = 0;
  await page.setContent('<p>cat</p><p id="hover-copy">house</p>');
  await installHarness(page, {
    state: {
      ...createState([{ id: "e1", source: "cat", target: "кіт", enabled: true, createdAt: 1 }]),
      showOriginalOnHover: false,
      translateEnglishOnHover: false
    },
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        if (text === "cat") {
          return "кіт";
        }
        if (text === "house") {
          houseTranslationCalls += 1;
        }
        return text;
      }
    },
    config: { reverseHoverDelayMs: 10 }
  });

  await page.waitForSelector(".learned-word-replacer-token");
  const translationCallsBeforeHover = houseTranslationCalls;
  await page.evaluate(() => {
    const textNode = document.getElementById("hover-copy").firstChild;
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: undefined
    });
    document.caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(textNode, 2);
      range.collapse(true);
      return range;
    };
    document.dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: 80, clientY: 40, pointerType: "mouse" })
    );
  });
  await page.waitForTimeout(30);
  const result = await page.evaluate(() => ({
    replacementTitle: document.querySelector(".learned-word-replacer-token")?.getAttribute("title"),
    hasReplacementHoverStyle: document
      .getElementById("learned-word-replacer-style")
      ?.textContent.includes(".learned-word-replacer-token:hover::after"),
    hoverTooltipCount: document.querySelectorAll(".learned-word-replacer-hover-tooltip").length
  }));

  assert(result.replacementTitle === null, "original-English hover title was still enabled");
  assert(!result.hasReplacementHoverStyle, "original-English hover tooltip style was still enabled");
  assert(result.hoverTooltipCount === 0, "English hover tooltip was still created when disabled");
  assert(
    houseTranslationCalls === translationCallsBeforeHover,
    "English hover translation still ran when disabled"
  );
  await page.close();
}

async function testProfileLanguageIsInferredFromImportedTargets(browser) {
  const page = await browser.newPage();
  const availabilityOptions = [];
  await page.setContent("<p>It is in the house.</p>");
  await installHarness(page, {
    state: {
      version: 2,
      enabled: true,
      showHighlights: true,
      currentProfileId: "default",
      profiles: [
        {
          id: "default",
          name: "Default",
          languageCode: "de",
          entries: [
            {
              id: "e1",
              source: "house",
              target: "будинку",
              enabled: true,
              createdAt: 1
            }
          ]
        }
      ]
    },
    translator: {
      availability: async (options) => {
        availabilityOptions.push(options);
        return "available";
      },
      translate: async (text) => {
        if (text === "It is in the house.") {
          return "Це у будинку.";
        }

        return "";
      }
    }
  });

  await page.waitForFunction(() => document.body.innerText.includes("будинку"));
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    status: window.__learnedWordReplacerDebug.getSnapshot()
  }));

  assert(result.status.targetLanguage === "uk", "profile language was not inferred from Ukrainian targets");
  assert(
    availabilityOptions.some((options) => options.targetLanguage === "uk"),
    "Chrome Translator was not requested for Ukrainian"
  );
  assert(result.text.includes("будинку"), "inferred Ukrainian profile did not replace text");
  await page.close();
}

async function testEnglishHintAlignmentAvoidsDeletionProbe(browser) {
  const page = await browser.newPage();
  const source = "Steam is the ultimate destination for playing, discussing, and creating games.";
  const translated = "Steam є найкращим місцем для гри, обговорення та створення ігор.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "discussing", target: "обговорення", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        if (text === source) {
          return translated;
        }

        throw new Error(`deletion probe should not run for confidence match: ${text}`);
      }
    }
  });

  await page.waitForFunction(() => document.querySelectorAll(".learned-word-replacer-token").length === 1);
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    replacement: {
      text: document.querySelector(".learned-word-replacer-token")?.textContent || "",
      original:
        document.querySelector(".learned-word-replacer-token")?.dataset.learnedWordOriginal || ""
    },
    stats: window.__learnedWordReplacerDebug.getSnapshot()
  }));

  assert(
    result.text.includes("playing, обговорення, and creating"),
    "English hint confidence alignment did not replace the expected source word"
  );
  assert(result.replacement.original === "discussing", "wrong original word was replaced");
  assert(result.replacement.text === "обговорення", "wrong translated target was inserted");
  assert(result.stats.translationCalls === 1, "confidence alignment should avoid deletion probes");
  await page.close();
}

async function testEnglishHintBlocksDeletionFallbackMismatch(browser) {
  const page = await browser.newPage();
  const source = "Steam is the ultimate destination for playing, discussing, and creating games.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "there is", target: "є", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        const translations = {
          [source]: "Steam є найкращим місцем для гри, обговорення та створення ігор.",
          "Steam is the destination for playing, discussing, and creating games.":
            "Steam найкраще місце для гри, обговорення та створення ігор."
        };
        return translations[text] || "Steam є найкращим місцем.";
      }
    }
  });

  await page.waitForFunction(() => window.__learnedWordReplacerDebug.getSnapshot().finishedAt > 0);
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    replacements: Array.from(document.querySelectorAll(".learned-word-replacer-token")).map(
      (node) => ({
        text: node.textContent,
        original: node.dataset.learnedWordOriginal
      })
    )
  }));

  assert(
    result.text === source,
    "entry with unmatched English hint should not replace via deletion fallback"
  );
  assert(
    !result.replacements.some((item) => item.original === "ultimate" && item.text === "є"),
    "there is -> є should not align to ultimate"
  );
  await page.close();
}

async function testEnglishHintAlignsShortGrammarWord(browser) {
  const page = await browser.newPage();
  const source = "Steam is the ultimate destination.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([{ id: "e1", source: "is", target: "є", enabled: true, createdAt: 1 }]),
    translator: {
      availability: async () => "available",
      translate: async (text) =>
        text === source ? "Steam є найкращим місцем." : "Steam є місцем."
    }
  });

  await page.waitForFunction(() => document.querySelectorAll(".learned-word-replacer-token").length === 1);
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    replacement: {
      text: document.querySelector(".learned-word-replacer-token")?.textContent || "",
      original:
        document.querySelector(".learned-word-replacer-token")?.dataset.learnedWordOriginal || ""
    }
  }));

  assert(result.text === "Steam є the ultimate destination.", "is -> є hint did not align to is");
  assert(result.replacement.original === "is", "short grammar hint replaced the wrong token");
  await page.close();
}

async function testMismatchedSentenceBoundariesDoNotDuplicateWords(browser) {
  const page = await browser.newPage();
  const source = "Do not enter. Do not leave.";
  const translated = "Не входьте й виходьте.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([{ id: "e1", source: "not", target: "не", enabled: true, createdAt: 1 }]),
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? translated : text)
    }
  });

  await page.waitForFunction(() => window.__learnedWordReplacerDebug.getSnapshot().finishedAt > 0);
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    replacementCount: document.querySelectorAll(".learned-word-replacer-token").length
  }));

  assert(
    result.text === source,
    "a translated word was duplicated across source sentences with different boundaries"
  );
  assert(result.replacementCount === 0, "ambiguous boundary alignment inserted a replacement");
  await page.close();
}

async function testTranslatingStatusPublishesBeforeTranslateResolves(browser) {
  const page = await browser.newPage();
  const source = "Steam is the ultimate destination for playing, discussing, and creating games.";
  const translated = "Steam є найкращим місцем для гри, обговорення та створення ігор.";
  let resolveTranslation;
  const translationPromise = new Promise((resolve) => {
    resolveTranslation = resolve;
  });

  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "discussing", target: "обговорення", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        if (text === source) {
          return await translationPromise;
        }

        return "";
      }
    }
  });

  await page.waitForFunction(
    () =>
      (window.__runtimeMessages || []).some(
        (message) => message.type === "LWR_STATUS" && message.status?.status === "translating"
      ),
    null,
    { timeout: 2000 }
  );

  resolveTranslation(translated);
  await page.waitForFunction(() => window.__learnedWordReplacerDebug.getSnapshot().finishedAt > 0);
  await page.close();
}

async function testAmbiguousDeletionAlignmentIsSkipped(browser) {
  const page = await browser.newPage();
  await page.setContent("<p>Steam, The Ultimate Online Game Platform</p>");
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "not used", target: "ігор", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        const translations = {
          "Steam, The Ultimate Online Game Platform": "Steam, найвища онлайн-платформа для ігор",
          ", The Ultimate Online Game Platform": ", найвища онлайн-платформа для ігор",
          "Steam, Ultimate Online Game Platform": "Steam, платформа для онлайн-ігри",
          "Steam, The Online Game Platform": "Steam, платформа онлайн-ігри",
          "Steam, The Ultimate Game Platform": "Steam, ігрова платформа",
          "Steam, The Ultimate Online Platform": "Steam, остаточна онлайн-платформа",
          "Steam, The Ultimate Online Game": "Steam, остаточна онлайн-гра"
        };
        return translations[text] || "";
      }
    }
  });

  await page.waitForFunction(() => window.__learnedWordReplacerDebug.getSnapshot().finishedAt > 0);
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    replacementCount: document.querySelectorAll(".learned-word-replacer-token").length,
    stats: window.__learnedWordReplacerDebug.getSnapshot()
  }));

  assert(
    result.text === "Steam, The Ultimate Online Game Platform",
    "ambiguous alignment should not mutate the page"
  );
  assert(result.replacementCount === 0, "ambiguous alignment inserted a replacement");
  assert(result.stats.replacementCount === 0, "ambiguous alignment changed replacement stats");
  await page.close();
}

async function testBatchTranslationUsesDividers(browser) {
  const page = await browser.newPage();
  await page.setContent("<p>The client opens the store.</p><p>The client visits the store.</p>");
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "not used", target: "клієнт", enabled: true, createdAt: 1 },
      { id: "e2", source: "not used", target: "магазин", enabled: true, createdAt: 2 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        const translations = {
          "The client opens the store.": "Клієнт відкриває магазин.",
          "client opens the store.": "Клієнт відкриває магазин.",
          "The opens the store.": "Відкриває магазин.",
          "The client the store.": "Клієнт магазин.",
          "The client opens store.": "Клієнт відкриває магазин.",
          "The client opens the.": "Клієнт відкриває.",
          "The client visits the store.": "Клієнт відвідує магазин.",
          "client visits the store.": "Клієнт відвідує магазин.",
          "The visits the store.": "Відвідує магазин.",
          "The client the store.": "Клієнт магазин.",
          "The client visits store.": "Клієнт відвідує магазин.",
          "The client visits the.": "Клієнт відвідує."
        };
        return translations[text] || "";
      }
    }
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-token").length >= 4
  );
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    stats: window.__learnedWordReplacerDebug.getSnapshot()
  }));

  assert(result.text.includes("Клієнт opens the магазин."), "first paragraph was not replaced");
  assert(result.text.includes("Клієнт visits the магазин."), "second paragraph was not replaced");
  assert(
    result.stats.translationCalls <= 3,
    `batched translation used too many calls: ${result.stats.translationCalls}`
  );
  await page.close();
}

async function testAmbiguousBatchDeletionFallsBackToSingleProbe(browser) {
  const page = await browser.newPage();
  const source = "Steam is the ultimate destination for playing, discussing, and creating games.";
  const deleteFor = "Steam is the ultimate destination playing, discussing, and creating games.";
  const deleteDiscussing = "Steam is the ultimate destination for playing,, and creating games.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "not used", target: "обговорення", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        const translations = {
          [source]: "Steam є найкращим місцем для гри, обговорення та створення ігор.",
          [deleteFor]: "Steam є найкращим місцем для гри, обговорення та створення ігор.",
          [deleteDiscussing]: "Steam є найкращим місцем для гри та створення ігор."
        };
        return translations[text] || "Steam є найкращим місцем для гри, обговорення та створення ігор.";
      },
      translateBatchItem: async (text) => {
        if (text === deleteFor) {
          return "Steam є кінцевим пунктом призначення, який грає, обговорює та створює ігри.";
        }

        if (text === deleteDiscussing) {
          return "Steam є найкращим місцем для гри та створення ігор.";
        }

        return "Steam є найкращим місцем для гри, обговорення та створення ігор.";
      }
    }
  });

  await page.waitForFunction(() => document.querySelectorAll(".learned-word-replacer-token").length);
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    replacements: Array.from(document.querySelectorAll(".learned-word-replacer-token")).map(
      (node) => ({
        text: node.textContent,
        original: node.dataset.learnedWordOriginal
      })
    )
  }));

  assert(
    result.text.includes("playing, обговорення, and creating"),
    "single-probe fallback did not recover the discussing replacement"
  );
  assert(
    result.replacements.some((item) => item.original === "discussing"),
    "replacement was not aligned to discussing"
  );
  await page.close();
}

async function testDownloadableTranslatorCreatesWhenCached(browser) {
  const page = await browser.newPage();
  await page.setContent("<p>It is here.</p>");
  await installHarness(page, {
    state: createState([{ id: "e1", source: "It", target: "Це", enabled: true, createdAt: 1 }]),
    translator: {
      availability: async () => "downloadable",
      translate: async (text) => {
        if (text === "It is here.") {
          return "Це тут.";
        }

        return "";
      }
    }
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-token").length === 1
  );

  const result = await page.evaluate(() => ({
    bodyText: document.body.innerText,
    stats: window.__learnedWordReplacerDebug.getSnapshot()
  }));

  assert(result.bodyText.includes("Це is here."), "downloadable cached translator should run");
  assert(result.stats.status === "complete", "downloadable cached translator did not complete");
  assert(result.stats.translatorAvailability === "downloadable", "availability was not tracked");
  await page.close();
}

async function testDownloadableTranslatorFallsBackToActivationWhenCreateFails(browser) {
  const page = await browser.newPage();
  await page.setContent("<p>It is here.</p>");
  await installHarness(page, {
    state: createState([{ id: "e1", source: "It", target: "Це", enabled: true, createdAt: 1 }]),
    config: {
      translatorCreateRejectMessage: "User activation required"
    },
    translator: {
      availability: async () => "downloadable",
      translate: async () => ""
    }
  });

  await page.waitForFunction(
    () => window.__learnedWordReplacerDebug.getSnapshot().status === "translator-not-ready"
  );

  const result = await page.evaluate(() => ({
    bodyText: document.body.innerText,
    stats: window.__learnedWordReplacerDebug.getSnapshot()
  }));

  assert(result.bodyText === "It is here.", "failed downloadable create should not mutate page");
  assert(result.stats.status === "translator-not-ready", "debug status did not report translator-not-ready");
  assert(result.stats.translatorAvailability === "downloadable", "availability was not tracked");
  await page.close();
}

async function testRetryPreparesDownloadableTranslator(browser) {
  const page = await browser.newPage();
  await page.setContent("<p>It is in the house.</p>");
  let availabilityCalls = 0;
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "not used", target: "це", enabled: true, createdAt: 1 },
      { id: "e2", source: "not used", target: "у", enabled: true, createdAt: 2 }
    ]),
    config: {
      translatorCreateRejectMessage: "User activation required"
    },
    translator: {
      availability: async () => {
        availabilityCalls += 1;
        return "downloadable";
      },
      translate: async () => ""
    }
  });

  await page.evaluate(() => {
    window.__createCalled = 0;
    window.__learnedWordReplacerTestConfig.Translator.create = async ({ monitor } = {}) => {
      window.__createCalled += 1;
      if (monitor) {
        monitor({
          addEventListener(type, callback) {
            if (type === "downloadprogress") {
              callback({ loaded: 1 });
            }
          }
        });
      }
      return {
        translate: async (text) => {
          if (text === "is in the house.") {
            return "знаходиться у будинку.";
          }
          if (text === "It is the house.") {
            return "Це знаходиться будинку.";
          }
          return "Це знаходиться у будинку.";
        }
      };
    };
  });

  await page.waitForFunction(
    () => window.__learnedWordReplacerDebug.getSnapshot().status === "translator-not-ready"
  );
  const before = await page.evaluate(() => ({
    text: document.body.innerText,
    createCalled: window.__createCalled,
    stats: window.__learnedWordReplacerDebug.getSnapshot()
  }));
  assert(before.text === "It is in the house.", "initial downloadable state should not mutate page");
  assert(before.createCalled === 0, "create should not run before retry");
  const availabilityCallsBeforeRetry = availabilityCalls;

  await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.__learnedWordReplacerTestConfig.Translator.availability = () =>
          new Promise(() => {});
        window.__runtimeMessageListener({ type: "LWR_RETRY" }, {}, resolve);
      })
  );
  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-token").length >= 2,
    null,
    { timeout: 5000 }
  );

  const after = await page.evaluate(() => ({
    text: document.body.innerText,
    createCalled: window.__createCalled,
    stats: window.__learnedWordReplacerDebug.getSnapshot()
  }));

  assert(after.createCalled === 1, "retry did not call Translator.create for downloadable state");
  assert(availabilityCalls === availabilityCallsBeforeRetry, "retry should call create before availability");
  assert(after.text.includes("Це is у the house."), "retry did not apply translated replacements");
  assert(after.stats.status === "complete", "retry did not complete");
  await page.close();
}

async function testWorkBudget(browser) {
  const page = await browser.newPage();
  const paragraphs = Array.from({ length: 40 }, (_, index) => `<p>It is sentence ${index}.</p>`).join("");
  await page.setContent(paragraphs);
  await installHarness(page, {
    state: createState([{ id: "e1", source: "not used", target: "це", enabled: true, createdAt: 1 }]),
    config: {
      maxContextUnitsPerPass: 5,
      maxTranslationCallsPerPass: 8
    },
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        if (!/^It is sentence \d+\.$/.test(text)) {
          return "речення.";
        }
        return "Це речення.";
      }
    }
  });

  await page.waitForFunction(() => window.__learnedWordReplacerDebug.getSnapshot().finishedAt > 0);
  const stats = await page.evaluate(() => window.__learnedWordReplacerDebug.getSnapshot());

  assert(stats.unitsCollected <= 5, `unit budget exceeded: ${stats.unitsCollected}`);
  assert(stats.translationCalls <= 8, `translation call budget exceeded: ${stats.translationCalls}`);
  await page.close();
}

async function testContentUnitsArePrioritizedOverPageChrome(browser) {
  const page = await browser.newPage();
  const pageChrome = Array.from({ length: 30 }, (_, index) => `<div>Menu ${index}</div>`).join("");
  const batchTexts = [];
  await page.setContent(
    `${pageChrome}<p>First selected sentence.</p><p>It is in the house.</p>`
  );
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "not used", target: "це", enabled: true, createdAt: 1 },
      { id: "e2", source: "not used", target: "у", enabled: true, createdAt: 2 }
    ]),
    config: {
      maxContextUnitsPerPass: 2,
      maxTranslationCallsPerPass: 8
    },
    translator: {
      availability: async () => "available",
      onBatch: (texts) => batchTexts.push(texts),
      translate: async (text) => {
        if (text === "First selected sentence.") {
          return "Перше вибране речення.";
        }
        if (text === "is in the house.") {
          return "у будинку.";
        }
        if (text === "It is the house.") {
          return "Це будинку.";
        }
        if (text === "It is in the house.") {
          return "Це у будинку.";
        }
        if (text.startsWith("It")) {
          return "Це у будинку.";
        }
        return "Меню.";
      }
    }
  });

  await page.waitForFunction(() => window.__learnedWordReplacerDebug.getSnapshot().finishedAt > 0);
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    stats: window.__learnedWordReplacerDebug.getSnapshot()
  }));

  assert(result.text.includes("Це is у the house."), "content unit was not prioritized over page chrome");
  assert(result.stats.unitsCollected <= 2, `unit budget exceeded: ${result.stats.unitsCollected}`);
  assert(
    batchTexts[0]?.[0] === "First selected sentence.",
    "selected units should be batched in page order"
  );
  await page.close();
}

async function testLongBlocksAreNotSplitByArbitraryCharacterLimit(browser) {
  const page = await browser.newPage();
  const longText = `${"a".repeat(1900)}.`;
  const batchTexts = [];
  await page.setContent(`<p>${longText}</p>`);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "not used", target: "абзац", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      onBatch: (texts) => batchTexts.push(texts),
      translate: async () => "абзац."
    }
  });

  await page.waitForFunction(() => window.__learnedWordReplacerDebug.getSnapshot().finishedAt > 0);
  const stats = await page.evaluate(() => window.__learnedWordReplacerDebug.getSnapshot());

  assert(longText.length > 1800, "test fixture should exceed the old arbitrary limit");
  assert(stats.unitsCollected === 1, `long block was split into ${stats.unitsCollected} units`);
  assert(batchTexts[0]?.length === 1, "long block should be sent as one batch item");
  await page.close();
}

async function testExcludedPageRestoresAndSkipsTranslation(browser) {
  const page = await browser.newPage();
  const excludedPageUrl = "https://example.test/words?course=uk";
  let translatorCalls = 0;

  await page.route(excludedPageUrl, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: '<p>It <span class="learned-word-replacer-token" data-learned-word-original="is">є</span> in the house.</p>'
    })
  );
  await page.goto(excludedPageUrl);
  await installHarness(page, {
    state: {
      ...createState([{ id: "e1", source: "is", target: "є", enabled: true, createdAt: 1 }]),
      doNotTranslate: {
        sites: [],
        pages: [`${excludedPageUrl}#section`]
      }
    },
    translator: {
      availability: async () => {
        translatorCalls += 1;
        return "available";
      },
      translate: async () => {
        translatorCalls += 1;
        return "є";
      }
    }
  });

  await page.waitForFunction(
    () => window.__learnedWordReplacerDebug.getSnapshot().status === "excluded"
  );
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    replacementCount: document.querySelectorAll(".learned-word-replacer-token").length,
    status: window.__learnedWordReplacerDebug.getSnapshot()
  }));

  assert(result.text === "It is in the house.", "excluded page did not restore original text");
  assert(result.replacementCount === 0, "excluded page left replacement tokens in the DOM");
  assert(result.status.lastError.includes("this page"), "excluded page status was not specific");
  assert(translatorCalls === 0, "excluded page called Chrome Translator");
  await page.close();
}

async function testExclusionChangeRestoresExistingReplacements(browser) {
  const page = await browser.newPage();
  const pageUrl = "https://example.test/restore";
  let translationCalls = 0;
  const initialState = createState([
    { id: "e1", source: "It", target: "Це", enabled: true, createdAt: 1 }
  ]);

  await page.route(pageUrl, (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>It is in the house.</p>" })
  );
  await page.goto(pageUrl);
  await installHarness(page, {
    state: initialState,
    translator: {
      availability: async () => "available",
      translate: async () => {
        translationCalls += 1;
        return "Це у будинку.";
      }
    }
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-token").length === 1
  );
  await page.evaluate((nextState) => {
    window.__storageChangeListener(
      { learnedWordReplacerState: { newValue: nextState } },
      "local"
    );
  }, {
    ...initialState,
    doNotTranslate: { sites: [], pages: [pageUrl] }
  });
  await page.waitForFunction(
    () => window.__learnedWordReplacerDebug.getSnapshot().status === "excluded"
  );
  const result = await page.evaluate(() => ({
    text: document.body.innerText,
    tokens: document.querySelectorAll(".learned-word-replacer-token").length
  }));

  assert(result.text === "It is in the house.", "exclusion update did not restore replacement text");
  assert(result.tokens === 0, "exclusion update left replacement tokens in the DOM");
  assert(translationCalls === 1, "exclusion update triggered another translation");
  await page.close();
}

async function testHiddenMutationDoesNotRetriggerTranslation(browser) {
  const page = await browser.newPage();
  await page.setContent("<p>It is in the house.</p>");
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "It", target: "Це", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        if (text === "It is in the house.") {
          return "Це у будинку.";
        }

        return "";
      }
    }
  });

  await page.waitForFunction(() => window.__learnedWordReplacerDebug.getSnapshot().finishedAt > 0);
  const before = await page.evaluate(() => window.__learnedWordReplacerDebug.getSnapshot());

  await page.evaluate(() => {
    const hidden = document.createElement("div");
    hidden.style.display = "none";
    hidden.textContent = "This hidden mutation should not retrigger replacement.";
    document.body.appendChild(hidden);
  });
  await page.waitForTimeout(900);

  const after = await page.evaluate(() => window.__learnedWordReplacerDebug.getSnapshot());
  assert(after.runId === before.runId, "hidden DOM mutation should not schedule a new run");
  await page.close();
}

async function testScrollWithoutPendingTextDoesNotRetriggerTranslation(browser) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page.setContent(`
    <p>It is in the house.</p>
    <div style="height: 1800px"></div>
  `);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "house", target: "будинку", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        if (text === "It is in the house.") {
          return "Це у будинку.";
        }

        return "";
      }
    }
  });

  await page.waitForFunction(() => window.__learnedWordReplacerDebug.getSnapshot().finishedAt > 0);
  const before = await page.evaluate(() => window.__learnedWordReplacerDebug.getSnapshot());
  await page.evaluate(() => window.scrollBy(0, 500));
  await page.waitForTimeout(900);
  const after = await page.evaluate(() => window.__learnedWordReplacerDebug.getSnapshot());

  assert(after.runId === before.runId, "scroll without pending text should not schedule a new run");
  await page.close();
}

async function testMutationPreservesExistingReplacementsAndSkipsProcessedBlocks(browser) {
  const page = await browser.newPage();
  const calls = [];
  let resolveSecondTranslation;
  const secondTranslation = new Promise((resolve) => {
    resolveSecondTranslation = resolve;
  });

  await page.setContent('<p id="first">It is in the house.</p>');
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "house", target: "будинку", enabled: true, createdAt: 1 },
      { id: "e2", source: "car", target: "авто", enabled: true, createdAt: 2 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        calls.push(text);
        if (text === "It is in the house.") {
          return "Це у будинку.";
        }
        if (text === "This is my car.") {
          return await secondTranslation;
        }

        return "";
      }
    }
  });

  await page.waitForFunction(() => document.querySelectorAll(".learned-word-replacer-token").length === 1);
  const firstRun = await page.evaluate(() => window.__learnedWordReplacerDebug.getSnapshot().runId);

  await page.evaluate(() => {
    const second = document.createElement("p");
    second.id = "second";
    second.textContent = "This is my car.";
    document.body.appendChild(second);
  });

  await page.waitForFunction(
    (firstRun) => {
      const snapshot = window.__learnedWordReplacerDebug.getSnapshot();
      return snapshot.runId > firstRun && snapshot.status === "translating";
    },
    firstRun,
    { timeout: 3000 }
  );

  const during = await page.evaluate(() => ({
    firstText: document.getElementById("first").innerText,
    replacementCount: document.querySelectorAll(".learned-word-replacer-token").length
  }));
  assert(
    during.firstText.includes("будинку"),
    "existing replacement was cleared while a new mutation was translating"
  );
  assert(
    calls.filter((text) => text === "It is in the house.").length === 1,
    "already processed block was translated again"
  );

  resolveSecondTranslation("Це моє авто.");
  await page.waitForFunction(() => document.getElementById("second").innerText.includes("авто"));
  await page.close();
}

async function testMutationProcessesOnlyQueuedBlock(browser) {
  const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
  const calls = [];
  await page.setContent(`
    <p id="first">It is in the house.</p>
    <p id="second">Car.</p>
  `);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "house", target: "будинку", enabled: true, createdAt: 1 },
      { id: "e2", source: "Car", target: "Авто", enabled: true, createdAt: 2 }
    ]),
    config: {
      maxContextUnitsPerPass: 1
    },
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        calls.push(text);
        if (text === "It is in the house.") {
          return "Це у будинку.";
        }
        if (text === "It is in the house now.") {
          return "Це зараз у будинку.";
        }
        if (text === "Car.") {
          return "Авто.";
        }

        return "";
      }
    }
  });

  await page.waitForFunction(() => document.getElementById("first").innerText.includes("будинку"));
  assert(!calls.includes("Car."), "test setup should leave the second visible block unprocessed");

  await page.evaluate(() => {
    const first = document.getElementById("first");
    first.lastChild.textContent = " now.";
  });
  await page.waitForFunction(() => window.__learnedWordReplacerDebug.getSnapshot().finishedAt > 0);
  await page.waitForTimeout(900);

  assert(!calls.includes("Car."), "mutation in one block should not process another visible block");
  await page.close();
}

async function testScrollDoesNotRewriteStructuralContainerSiblings(browser) {
  const page = await browser.newPage({ viewport: { width: 900, height: 600 } });
  await page.setContent(`
    <main>
      <p id="first">It is in the house.</p>
      <span id="loose">Car.</span>
    </main>
    <div style="height: 1600px"></div>
  `);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "house", target: "будинку", enabled: true, createdAt: 1 },
      { id: "e2", source: "Car", target: "Авто", enabled: true, createdAt: 2 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        if (text === "It is in the house.") {
          return "Це у будинку.";
        }
        if (text === "Car.") {
          return "Авто.";
        }

        return "";
      }
    }
  });

  await page.waitForFunction(
    () => document.getElementById("first").innerText.includes("будинку") &&
      document.getElementById("loose").innerText.includes("Авто")
  );
  await page.evaluate(() => {
    window.__removedReplacementCount = 0;
    const countReplacementNodes = (node) => {
      if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains("learned-word-replacer-token")) {
        return 1;
      }

      return node.querySelectorAll
        ? node.querySelectorAll(".learned-word-replacer-token").length
        : 0;
    };
    new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.removedNodes) {
          window.__removedReplacementCount += countReplacementNodes(node);
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });

  await page.evaluate(() => window.scrollBy(0, 400));
  await page.waitForTimeout(900);
  const result = await page.evaluate(() => ({
    removed: window.__removedReplacementCount,
    firstText: document.getElementById("first").innerText,
    looseText: document.getElementById("loose").innerText
  }));

  assert(result.removed === 0, "scroll rewrote existing replacements inside a structural container");
  assert(result.firstText.includes("будинку"), "existing paragraph replacement was lost after scroll");
  assert(result.looseText.includes("Авто"), "existing loose text replacement was lost after scroll");
  await page.close();
}

async function testNavigationAndAsideTextIsIgnored(browser) {
  const page = await browser.newPage();
  await page.setContent(`
    <nav><a>and in</a></nav>
    <aside><p>mother and father</p></aside>
    <main><p>It is in the house and car.</p></main>
  `);
  await installHarness(page, {
    state: createState([
      { id: "e1", source: "and", target: "і", enabled: true, createdAt: 1 },
      { id: "e2", source: "in", target: "у", enabled: true, createdAt: 2 },
      { id: "e3", source: "house", target: "будинку", enabled: true, createdAt: 3 },
      { id: "e4", source: "car", target: "авто", enabled: true, createdAt: 4 },
      { id: "e5", source: "mother", target: "мати", enabled: true, createdAt: 5 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        if (text === "It is in the house and car.") {
          return "Це у будинку і авто.";
        }

        return "";
      }
    }
  });

  await page.waitForFunction(() => document.querySelector("main").innerText.includes("будинку"));
  const result = await page.evaluate(() => ({
    navText: document.querySelector("nav").innerText,
    asideText: document.querySelector("aside").innerText,
    mainText: document.querySelector("main").innerText
  }));

  assert(result.navText === "and in", "navigation text should not be replaced");
  assert(result.asideText === "mother and father", "aside text should not be replaced");
  assert(result.mainText.includes("будинку"), "main content was not replaced");
  await page.close();
}

async function testDuolingoSyncScrapesEveryLoadedPageInExportFormat(browser) {
  const page = await browser.newPage();
  await page.route("https://www.duolingo.com/practice-hub/words", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
        <h2>Practice your Ukrainian words</h2>
        <h2>3 words</h2>
        <ul id="words">
          <li><div><h3>кафе</h3><p>a cafe, a café, the cafe</p></div></li>
          <li><div><h3>сестри</h3><p>sisters, a sister, 's</p></div></li>
          <li id="load-more" role="button">Load more</li>
        </ul>
        <script>
          document.getElementById("load-more").addEventListener("click", () => {
            setTimeout(() => {
              const row = document.createElement("li");
              row.innerHTML = '<div><h3>та</h3><p><span class="learned-word-replacer-token" data-learned-word-original="and">та</span>, that</p></div>';
              document.getElementById("load-more").replaceWith(row);
            }, 20);
          });
        </script>
      `
    })
  );
  await page.goto("https://www.duolingo.com/practice-hub/words");
  await installHarness(page, {
    state: createState([]),
    translator: {
      availability: async () => "available",
      translate: async (text) => text
    }
  });

  const response = await page.evaluate(
    () =>
      new Promise((resolve) => {
        window.__runtimeMessageListener(
          { type: "LWR_SYNC_DUOLINGO" },
          {},
          resolve
        );
      })
  );

  assert(response.ok, `Duolingo sync failed: ${response.reason || "unknown error"}`);
  assert(response.count === 3, "Duolingo sync did not load every word page");
  assert(response.expectedCount === 3, "Duolingo sync did not read the page word count");
  assert(response.languageName === "Ukrainian", "Duolingo sync did not detect the course language");
  assert(
    response.text ===
      "кафе - a cafe, a café, the cafe\nсестри - sisters, a sister, 's\nта - and, that",
    "Duolingo sync did not preserve the extension export format or original replacement text"
  );
  await page.close();
}

async function testTranslatorBridgeCreatesInsideTrustedPageActivation(browser) {
  const page = await browser.newPage();
  await page.setContent('<button id="activate">Activate</button>');
  await page.evaluate(() => {
    window.__translatorCreateActivations = [];
    window.__translatorActivationMessages = [];
    window.Translator = {
      create() {
        window.__translatorCreateActivations.push(navigator.userActivation.isActive);
        if (window.__translatorCreateActivations.length === 1) {
          return Promise.reject(new Error("first creation failed"));
        }
        return Promise.resolve({
          inputQuota: Infinity,
          translate: async (text) => text
        });
      }
    };
    window.addEventListener("message", (event) => {
      if (event.data?.channel === "LWR_TRANSLATOR_BRIDGE_ACTIVATION") {
        window.__translatorActivationMessages.push(event.data);
      }
    });
  });
  await page.addScriptTag({ content: TRANSLATOR_BRIDGE_CONTENT });
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        const requestId = "arm-test";
        const listener = (event) => {
          if (
            event.data?.channel === "LWR_TRANSLATOR_BRIDGE_RESPONSE" &&
            event.data?.requestId === requestId
          ) {
            window.removeEventListener("message", listener);
            resolve();
          }
        };
        window.addEventListener("message", listener);
        window.postMessage(
          {
            source: "learned-word-replacer",
            channel: "LWR_TRANSLATOR_BRIDGE_REQUEST",
            requestId,
            action: "armActivation",
            options: { sourceLanguage: "en", targetLanguage: "uk" }
          },
          "*"
        );
      })
  );

  await page.click("#activate");
  await page.waitForFunction(() =>
    window.__translatorActivationMessages.some((message) => message.ok === false)
  );
  await page.click("#activate");
  await page.waitForFunction(() =>
    window.__translatorActivationMessages.some((message) => message.ok === true)
  );
  const result = await page.evaluate(() => ({
    activationStates: window.__translatorCreateActivations,
    errors: window.__translatorActivationMessages.filter((message) => message.ok === false).length,
    successes: window.__translatorActivationMessages.filter((message) => message.ok === true).length
  }));

  assert(result.activationStates.length === 2, "failed translator creation stayed cached");
  assert(
    result.activationStates.every(Boolean),
    "translator creation did not run during trusted page activation"
  );
  assert(result.errors === 1 && result.successes === 1, "translator activation did not recover after failure");
  await page.close();
}

async function testDuolingoSyncKeepsManualEntriesSeparate(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const state = {
      version: 2,
      enabled: true,
      showHighlights: true,
      currentProfileId: "uk",
      builtInProfilesVersion: 4,
      deletedBuiltInProfileIds: [],
      profiles: [
        {
          id: "uk",
          name: "Ukrainian",
          languageCode: "uk",
          entries: [
            {
              id: "manual",
              source: "custom",
              target: "ручний",
              definition: "Personal note",
              origin: "manual",
              enabled: true,
              createdAt: 1
            },
            {
              id: "duolingo",
              source: "custom",
              target: "старий",
              definition: "Duolingo meanings: custom",
              enabled: true,
              createdAt: 2
            }
          ]
        }
      ]
    };
    window.chrome = {
      runtime: {
        lastError: null,
        getURL: (url) => url,
        onMessage: { addListener() {} }
      },
      storage: {
        local: {
          get(defaults, callback) {
            callback({ learnedWordReplacerState: state });
          },
          set(values, callback) {
            window.__savedSeparatedState = JSON.parse(JSON.stringify(values.learnedWordReplacerState));
            if (callback) {
              callback();
            }
          }
        },
        onChanged: { addListener() {} }
      },
      tabs: {
        query(query, callback) {
          callback([{ id: 99, url: "https://www.duolingo.com/practice-hub/words" }]);
        },
        sendMessage(tabId, message, options, callback) {
          if (typeof options === "function") {
            callback = options;
          }
          if (message.type === "LWR_SYNC_DUOLINGO") {
            callback({
              ok: true,
              count: 1,
              languageName: "Ukrainian",
              text: "нове - custom"
            });
            return;
          }
          callback({
            ok: true,
            status: {
              status: "complete",
              targetLanguage: "uk",
              translatorAvailability: "available",
              replacementCount: 0,
              enabled: true
            }
          });
        }
      }
    };
  });

  await page.goto(POPUP_PAGE);
  await page.waitForFunction(() => document.getElementById("duolingo-section")?.textContent.includes("Duolingo (1)"));
  assert(await page.isVisible("#duolingo-panel"), "Duolingo was not the default vocabulary section");
  assert(await page.isHidden("#manual-entry-panel"), "manual entry panel was visible before selecting Manual");
  assert(
    (await page.locator("#entry-table").innerText()).includes("старий"),
    "default Duolingo section did not show the synced entry"
  );
  await page.click("#manual-section");
  await page.waitForFunction(() => document.getElementById("manual-section")?.textContent.includes("Manual (1)"));
  const manualTableText = await page.locator("#entry-table").innerText();
  assert(
    manualTableText.includes("custom") &&
      manualTableText.includes("ручний") &&
      !manualTableText.includes("старий"),
    "manual section did not isolate the manual entry"
  );
  await page.click("#duolingo-section");
  await page.waitForFunction(() => document.getElementById("duolingo-section")?.textContent.includes("Duolingo (1)"));
  assert(
    await page.locator("#duolingo-sync [data-lucide-icon='import']").count() === 1,
    "Duolingo import action is not using the Lucide import icon"
  );
  assert(
    (await page.locator("#entry-table").innerText()).includes("старий"),
    "Duolingo section did not show the synced entry"
  );
  await page.click("#duolingo-sync");
  await page.waitForFunction(() =>
    document.getElementById("duolingo-sync-status")?.textContent.includes("Synced 1 Duolingo word")
  );
  const saved = await page.evaluate(() => window.__savedSeparatedState);
  const entries = saved.profiles.find((profile) => profile.id === "uk").entries;
  const manual = entries.find((entry) => entry.id === "manual");
  const duolingo = entries.find((entry) => entry.id === "duolingo");

  assert(manual.origin === "manual", "manual entry lost its source classification");
  assert(manual.target === "ручний", "Duolingo sync changed the manual entry");
  assert(duolingo.origin === "duolingo", "Duolingo entry lost its source classification");
  assert(duolingo.target === "старий / нове", "Duolingo sync did not update its own entry");
  await page.close();
}

async function testDuolingoSyncRequiresActivePageAndExplainsRefresh(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const state = {
      version: 2,
      enabled: true,
      showHighlights: true,
      currentProfileId: "builtin-uk",
      builtInProfilesVersion: 4,
      deletedBuiltInProfileIds: [],
      profiles: [
        {
          id: "builtin-uk",
          name: "Ukrainian",
          languageCode: "uk",
          entries: []
        }
      ]
    };
    const googleTab = { id: 1, url: "https://www.google.com/search?q=steam" };
    const duolingoTab = { id: 2, url: "https://www.duolingo.com/practice-hub/words" };
    let viewingDuolingo = false;

    window.__syncAttempts = 0;
    window.__sidePanelTabs = [];
    window.__setViewingDuolingo = (value) => {
      viewingDuolingo = value;
    };
    window.chrome = {
      runtime: {
        lastError: null,
        getURL: (url) => url,
        onMessage: { addListener() {} }
      },
      storage: {
        local: {
          get(defaults, callback) {
            callback({ learnedWordReplacerState: state });
          },
          set(values, callback) {
            if (callback) {
              callback();
            }
          }
        },
        onChanged: { addListener() {} }
      },
      tabs: {
        query(query, callback) {
          callback(query.active ? [viewingDuolingo ? duolingoTab : googleTab] : [googleTab, duolingoTab]);
        },
        update(tabId, options) {
          if (tabId === duolingoTab.id && options.active) {
            viewingDuolingo = true;
          }
          return Promise.resolve(duolingoTab);
        },
        sendMessage(tabId, message, options, callback) {
          if (typeof options === "function") {
            callback = options;
          }

          if (message.type === "LWR_SYNC_DUOLINGO") {
            window.__syncAttempts += 1;
            window.chrome.runtime.lastError = {
              message: "Could not establish connection. Receiving end does not exist."
            };
            callback();
            window.chrome.runtime.lastError = null;
            return;
          }

          callback({
            ok: true,
            status: {
              status: "complete",
              targetLanguage: "uk",
              replacementCount: 0,
              enabled: true
            }
          });
        },
        onActivated: {
          addListener(listener) {
            window.__tabActivatedListener = listener;
          }
        },
        onUpdated: {
          addListener(listener) {
            window.__tabUpdatedListener = listener;
          }
        }
      },
      sidePanel: {
        open(options) {
          window.__sidePanelTabs.push(options.tabId);
          return Promise.resolve();
        }
      }
    };
  });

  await page.goto(POPUP_PAGE);
  await page.click("#duolingo-section");
  await page.waitForFunction(
    () => document.getElementById("duolingo-sync-label")?.textContent === "View Duolingo to sync"
  );
  await page.evaluate(() => {
    window.__setViewingDuolingo(true);
    window.__tabActivatedListener({ tabId: 2 });
  });
  await page.waitForFunction(
    () => document.getElementById("duolingo-sync-label")?.textContent === "Import words from Duolingo"
  );
  await page.evaluate(() => {
    window.__setViewingDuolingo(false);
    window.__tabActivatedListener({ tabId: 1 });
  });
  await page.waitForFunction(
    () => document.getElementById("duolingo-sync-label")?.textContent === "View Duolingo to sync"
  );
  await page.click("#duolingo-sync");
  await page.waitForFunction(
    () => document.getElementById("duolingo-sync-label")?.textContent === "Import words from Duolingo"
  );
  assert(
    await page.locator("#duolingo-sync").evaluate((button) => button.classList.contains("needs-sync")),
    "sync button was not highlighted after the Duolingo handoff"
  );
  assert(
    await page.evaluate(() => window.__syncAttempts) === 0,
    "sync ran while the Duolingo Words tab was not active"
  );
  assert(
    (await page.evaluate(() => window.__sidePanelTabs)).includes(2),
    "View Duolingo did not open the persistent side panel"
  );
  await page.click("#duolingo-sync");
  await page.waitForFunction(() =>
    document.getElementById("duolingo-sync-status")?.textContent.includes("Refresh the Duolingo Words page")
  );
  assert(
    await page.evaluate(() => window.__syncAttempts) === 1,
    "sync did not run after the Duolingo Words tab became active"
  );
  await page.close();
}

async function testDuolingoLoginRedirectShowsInstructions(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const state = {
      version: 2,
      enabled: true,
      showHighlights: true,
      currentProfileId: "builtin-uk",
      builtInProfilesVersion: 4,
      deletedBuiltInProfileIds: [],
      profiles: [{ id: "builtin-uk", name: "Ukrainian", languageCode: "uk", entries: [] }]
    };
    const loginTab = {
      id: 3,
      url: "https://www.duolingo.com/practice-hub/words?isLoggingIn=true"
    };
    const wordsTab = { id: 3, url: "https://www.duolingo.com/practice-hub/words" };
    let activeTab = loginTab;

    window.__duolingoSyncAttempts = 0;
    window.__setDuolingoLoginTab = (isLoginRedirect) => {
      activeTab = isLoginRedirect ? loginTab : wordsTab;
    };
    window.chrome = {
      runtime: {
        lastError: null,
        getURL: (url) => url,
        onMessage: { addListener() {} }
      },
      storage: {
        local: {
          get(defaults, callback) {
            callback({ learnedWordReplacerState: state });
          },
          set(values, callback) {
            if (callback) {
              callback();
            }
          }
        },
        onChanged: { addListener() {} }
      },
      tabs: {
        query(query, callback) {
          callback(query.active ? [activeTab] : [activeTab]);
        },
        sendMessage(tabId, message, options, callback) {
          if (typeof options === "function") {
            callback = options;
          }
          if (message.type === "LWR_SYNC_DUOLINGO") {
            window.__duolingoSyncAttempts += 1;
          }
          callback({
            ok: true,
            status: {
              status: "complete",
              targetLanguage: "uk",
              replacementCount: 0,
              enabled: true
            }
          });
        },
        onActivated: {
          addListener(listener) {
            window.__duolingoTabActivated = listener;
          }
        },
        onUpdated: { addListener() {} }
      }
    };
  });

  await page.goto(POPUP_PAGE);
  await page.click("#duolingo-section");
  await page.waitForFunction(
    () => document.getElementById("duolingo-sync-label")?.textContent === "Sign in to Duolingo first"
  );
  const loginState = await page.evaluate(() => ({
    disabled: document.getElementById("duolingo-sync").disabled,
    warning: document.getElementById("duolingo-sync-status").textContent,
    warningVisible: !document.getElementById("duolingo-sync-status").classList.contains("hidden"),
    warningStyled: document.getElementById("duolingo-sync-status").classList.contains("warning")
  }));
  assert(loginState.disabled, "Duolingo import stayed enabled on the sign-in redirect");
  assert(loginState.warningVisible && loginState.warningStyled, "Duolingo sign-in instructions were not highlighted");
  assert(
    loginState.warning.includes("Sign in on this page"),
    "Duolingo sign-in instructions did not explain what to do"
  );
  assert(
    await page.evaluate(() => window.__duolingoSyncAttempts) === 0,
    "Duolingo sync ran while the page was asking the user to sign in"
  );

  await page.evaluate(() => {
    window.__setDuolingoLoginTab(false);
    window.__duolingoTabActivated({ tabId: 3 });
  });
  await page.waitForFunction(
    () => document.getElementById("duolingo-sync-label")?.textContent === "Import words from Duolingo"
  );
  assert(await page.isEnabled("#duolingo-sync"), "Duolingo import did not re-enable after sign-in");
  await page.waitForSelector("#duolingo-sync-status.language-hint:not(.hidden)");
  assert(
    (await page.textContent("#duolingo-sync-status")).includes("Ukrainian"),
    "Duolingo Words page did not replace the sign-in instruction with the language reminder"
  );
  await page.close();
}

async function testSidePanelUsesCompactVocabularyList(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const state = {
      version: 2,
      enabled: true,
      showHighlights: true,
      currentProfileId: "builtin-uk",
      builtInProfilesVersion: 4,
      deletedBuiltInProfileIds: [],
      profiles: [
        {
          id: "builtin-uk",
          name: "Ukrainian",
          languageCode: "uk",
          entries: [
            {
              id: "manual-tea",
              source: "tea",
              target: "чай",
              definition: "a hot drink",
              origin: "manual",
              enabled: true,
              createdAt: 1
            },
            {
              id: "duolingo-cafe",
              source: "cafe",
              target: "кафе",
              definition: "Duolingo meanings: a cafe, a café, the cafe",
              origin: "duolingo",
              enabled: true,
              createdAt: 2
            }
          ]
        }
      ]
    };
    window.chrome = {
      runtime: {
        lastError: null,
        getURL: (url) => url,
        onMessage: { addListener() {} }
      },
      storage: {
        local: {
          get(defaults, callback) {
            callback({ learnedWordReplacerState: state });
          },
          set(values, callback) {
            if (callback) {
              callback();
            }
          }
        },
        onChanged: { addListener() {} }
      },
      tabs: {
        query(query, callback) {
          callback([{ id: 12, url: "https://www.duolingo.com/practice-hub/words" }]);
        },
        sendMessage(tabId, message, options, callback) {
          if (typeof options === "function") {
            callback = options;
          }
          callback({
            ok: true,
            status: { status: "complete", targetLanguage: "uk", replacementCount: 0, enabled: true }
          });
        }
      }
    };
  });

  await page.goto(SIDE_PANEL_PAGE);
  await page.waitForSelector("#compact-vocabulary-list:not(.hidden)");
  await page.waitForSelector("#duolingo-sync-status.language-hint:not(.hidden)");
  const duolingoResult = await page.evaluate(() => ({
    tableHidden: document.getElementById("table-wrap").classList.contains("hidden"),
    compactText: document.getElementById("compact-vocabulary-list").textContent,
    rowCount: document.querySelectorAll(".compact-vocabulary-row").length,
    hasToggle: Boolean(document.querySelector(".compact-vocabulary-row input[type='checkbox']")),
    hasDelete: Boolean(document.querySelector(".compact-vocabulary-row button[aria-label='Delete Duolingo entry']")),
    sourceOrder: Array.from(document.querySelectorAll(".vocabulary-tabs > button")).map((button) => button.id),
    duolingoSelected: document.getElementById("duolingo-section").getAttribute("aria-pressed") === "true",
    languageHint: {
      text: document.getElementById("duolingo-sync-status").textContent,
      color: getComputedStyle(document.getElementById("duolingo-sync-status")).color
    },
    sortButton: {
      label: document.getElementById("sort-alpha").getAttribute("aria-label"),
      text: document.getElementById("sort-alpha").textContent.trim(),
      hasIcon: Boolean(document.querySelector("#sort-alpha [data-lucide-icon='arrow-up-a-z']"))
    }
  }));

  assert(duolingoResult.sourceOrder[0] === "duolingo-section", "Duolingo tab is not first");
  assert(duolingoResult.duolingoSelected, "Duolingo tab is not selected by default");
  assert(
    duolingoResult.languageHint.text.includes("Ukrainian"),
    "Duolingo Words page did not name the selected language"
  );
  assert(duolingoResult.languageHint.color === "rgb(180, 35, 24)", "Duolingo language hint is not red");
  assert(duolingoResult.tableHidden, "side panel still rendered the compressed table for Duolingo vocabulary");
  assert(duolingoResult.rowCount === 1, "side panel did not render the compact Duolingo row");
  assert(duolingoResult.compactText.includes("кафе") && duolingoResult.compactText.includes("cafe"), "compact Duolingo row lost vocabulary text");
  assert(!duolingoResult.compactText.includes("Duolingo meanings:"), "compact row kept the redundant definition prefix");
  assert(duolingoResult.hasToggle && duolingoResult.hasDelete, "compact Duolingo row lost replacement controls");
  assert(duolingoResult.sortButton.label === "Sort A to Z", "sort button is missing its accessible label");
  assert(!duolingoResult.sortButton.text && duolingoResult.sortButton.hasIcon, "sort button is not icon-only");

  await page.click("#manual-section");
  await page.waitForSelector("#compact-vocabulary-list:not(.hidden)");
  const manualResult = await page.evaluate(() => ({
    tableHidden: document.getElementById("table-wrap").classList.contains("hidden"),
    compactText: document.getElementById("compact-vocabulary-list").textContent,
    rowCount: document.querySelectorAll(".compact-vocabulary-row").length,
    hasToggle: Boolean(document.querySelector(".compact-vocabulary-row input[type='checkbox']")),
    hasDelete: Boolean(document.querySelector(".compact-vocabulary-row button[aria-label='Delete manual entry']"))
  }));

  assert(manualResult.tableHidden, "side panel still rendered the compressed table for manual vocabulary");
  assert(manualResult.rowCount === 1, "side panel did not render the compact manual row");
  assert(manualResult.compactText.includes("чай") && manualResult.compactText.includes("tea"), "compact manual row lost vocabulary text");
  assert(manualResult.hasToggle && manualResult.hasDelete, "compact manual row lost replacement controls");
  await page.close();
}

async function testPopupStatusPanel(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const state = {
      version: 2,
      enabled: true,
      showHighlights: true,
      currentProfileId: "default",
      builtInProfilesVersion: 3,
      deletedBuiltInProfileIds: [],
      profiles: [
        {
          id: "default",
          name: "German",
          languageCode: "de",
          entries: []
        },
        {
          id: "legacy-default-label",
          name: "Default",
          languageCode: "",
          entries: []
        },
        {
          id: "uk",
          name: "Ukrainian",
          languageCode: "uk",
          entries: [{ id: "1", source: "it", target: "це", enabled: true, createdAt: 1 }]
        },
        {
          id: "builtin-la",
          name: "Latin",
          languageCode: "la",
          entries: []
        }
      ]
    };
    let retryStarted = false;
    let statusMode = "not-ready";
    let openedDuolingoUrl = "";
    let hasContentScriptReceiver = false;
    let runtimeMessageListener = null;
    const injectedScripts = [];
    const notReady = {
      status: "translator-not-ready",
      targetLanguage: "uk",
      translatorAvailability: "downloadable",
      replacementCount: 0,
      enabled: true,
      lastError: "Chrome Translator reported downloadable for English to uk."
    };
    const preparing = {
      status: "translator-preparing",
      targetLanguage: "uk",
      translatorAvailability: "downloadable",
      translatorDownloadProgress: 0.5,
      replacementCount: 0,
      enabled: true,
      lastError: "Chrome is preparing Translator for English to uk."
    };
    const ok = {
      status: "complete",
      targetLanguage: "uk",
      translatorAvailability: "available",
      replacementCount: 3,
      wordFamilyReplacementCount: 2,
      enabled: true,
      lastError: "",
      startedAt: 1000,
      finishedAt: 2500
    };
    const excluded = {
      status: "excluded",
      targetLanguage: "uk",
      replacementCount: 0,
      enabled: true,
      lastError: "Translation is off for this site."
    };

    window.chrome = {
      runtime: {
        lastError: null,
        getURL: (url) => url,
        onMessage: {
          addListener(listener) {
            runtimeMessageListener = listener;
          }
        }
      },
      storage: {
        local: {
          get(defaults, callback) {
            callback({ learnedWordReplacerState: state });
          },
          set(values, callback) {
            window.__lastSavedPopupState = JSON.parse(
              JSON.stringify(values.learnedWordReplacerState)
            );
            if (callback) {
              callback();
            }
          }
        },
        onChanged: { addListener() {} }
      },
      tabs: {
        query(query, callback) {
          callback([{ id: 10, url: "https://www.google.com/search?q=steam" }]);
        },
        sendMessage(tabId, message, options, callback) {
          if (typeof options === "function") {
            callback = options;
            options = {};
          }

          window.__lastSendMessageOptions = options;
          if (!hasContentScriptReceiver) {
            window.chrome.runtime.lastError = {
              message: "Could not establish connection. Receiving end does not exist."
            };
            callback();
            window.chrome.runtime.lastError = null;
            return;
          }
          if (message.type === "LWR_RETRY") {
            retryStarted = true;
            callback({ ok: true, status: preparing });
            return;
          }
          callback({ ok: true, status: statusMode === "excluded" ? excluded : retryStarted ? ok : notReady });
        },
        create(options) {
          openedDuolingoUrl = options.url || "";
        }
      },
      scripting: {
        executeScript(options) {
          injectedScripts.push({
            files: [...(options.files || [])],
            world: options.world || "ISOLATED"
          });
          hasContentScriptReceiver = true;
          return Promise.resolve([]);
        }
      }
    };
    window.__openedDuolingoUrl = () => openedDuolingoUrl;
    window.__pushRuntimeStatus = (status) =>
      runtimeMessageListener({ type: "LWR_STATUS", status }, { tab: { id: 10 } });
    window.__injectedScripts = () => injectedScripts;
    window.__setPopupStatusMode = (mode) => {
      statusMode = mode;
    };
  });

  await page.goto(POPUP_PAGE);
  await page.waitForFunction(() =>
    document.getElementById("runtime-status")?.textContent.includes("page activation")
  );
  const before = await page.evaluate(() => ({
    text: document.getElementById("runtime-status").textContent,
    state: document.getElementById("page-status-panel").dataset.state,
    retryDisabled: document.getElementById("runtime-retry").disabled,
    retry: {
      label: document.getElementById("runtime-retry").getAttribute("aria-label"),
      tone: document.getElementById("runtime-retry").dataset.tone,
      hasIcon: Boolean(document.querySelector("#runtime-retry [data-lucide-icon='rotate-ccw']")),
      inHeader: Boolean(document.querySelector(".header-actions #runtime-retry")),
      nestedInStatus: Boolean(document.querySelector("#page-status-panel #runtime-retry"))
    },
    selectedLanguageId: document.getElementById("profile-select").value,
    languageNames: Array.from(document.getElementById("profile-select").options).map(
      (option) => option.textContent
    ),
    triggerLanguage: document.getElementById("language-trigger-label").textContent,
    triggerIcon: document.getElementById("language-trigger-icon").getAttribute("src"),
    manualPlaceholders: {
      source: document.getElementById("source").getAttribute("placeholder"),
      target: document.getElementById("target").getAttribute("placeholder")
    },
    openTab: {
      label: document.getElementById("open-tab").getAttribute("aria-label"),
      text: document.getElementById("open-tab").textContent.trim(),
      hasIcon: Boolean(document.querySelector("#open-tab [data-lucide-icon='square-arrow-out-up-right']"))
    },
    settingsIcon: Boolean(document.querySelector("#settings-view-tab [data-lucide-icon='settings']")),
    languageOptions: Array.from(document.querySelectorAll(".language-option")).map(
      (option) => ({
        name: option.textContent.trim(),
        icon: option.querySelector("img")?.getAttribute("src") || ""
      })
    )
  }));
  assert(!before.languageNames.includes("Default"), "legacy Default language was still displayed");
  assert(
    before.languageNames.filter((name) => name === "German").length === 1,
    "migrated legacy Default language left a duplicate German option"
  );
  assert(
    before.selectedLanguageId === "uk",
    `legacy Default language fell back to ${before.selectedLanguageId || "no language"} instead of vocabulary language`
  );
  for (const language of [
    "Arabic",
    "Chinese",
    "Czech",
    "Dutch",
    "Hindi",
    "Hungarian",
    "Indonesian",
    "Japanese",
    "Korean",
    "Polish",
    "Portuguese",
    "Romanian",
    "Russian",
    "Turkish",
    "Vietnamese"
  ]) {
    assert(before.languageNames.includes(language), `${language} course was not added as a built-in profile`);
  }
  assert(!before.languageNames.includes("Latin"), "empty retired Latin profile was not removed");
  assert(await page.isVisible("#duolingo-panel"), "Duolingo panel was not the default section");
  assert(await page.isHidden("#manual-entry-panel"), "manual entry panel was visible by default");
  assert(await page.isHidden("#settings-view"), "settings view should not be open initially");
  assert(
    before.manualPlaceholders.source === "English (e.g. a cup of coffee)",
    "manual English field did not show the phrase example"
  );
  assert(
    before.manualPlaceholders.target === "Ukrainian (e.g. чашка кави)",
    "manual target field did not use the selected language and example"
  );
  assert(before.retry.label === "Retry current page", "retry button is missing its accessible label");
  await page.evaluate(() =>
    window.__pushRuntimeStatus({
      status: "complete",
      targetLanguage: "uk",
      replacementCount: 7,
      enabled: true,
      startedAt: 1000,
      finishedAt: 1500
    })
  );
  await page.waitForFunction(() => document.getElementById("runtime-status")?.textContent.includes("7 replacements"));
  assert(
    await page.evaluate(() => document.getElementById("page-status-panel").dataset.state) === "ok",
    "popup did not apply the pushed status from the active tab"
  );
  const recoveredScripts = await page.evaluate(() => window.__injectedScripts());
  assert(
    JSON.stringify(recoveredScripts) ===
      JSON.stringify([
        { files: ["page-translator-bridge.js"], world: "MAIN" },
        { files: ["content.js"], world: "ISOLATED" }
      ]),
    "popup did not restore missing content scripts before reading page status"
  );
  assert(before.retry.hasIcon && before.retry.inHeader, "retry button was not moved to the header");
  assert(!before.retry.nestedInStatus, "retry button is still nested in the page status panel");
  assert(before.retry.tone === "attention", "retry did not highlight the page activation state");
  assert(before.openTab.label === "Open in tab", "open-in-tab button is missing its accessible label");
  assert(!before.openTab.text && before.openTab.hasIcon, "open-in-tab button is not icon-only");
  assert(before.settingsIcon, "settings button is not using the Lucide settings asset");
  assert(!await page.locator("#vocabulary-view-tab").count(), "vocabulary still has a dedicated view button");
  assert(
    await page.locator(".language-controls #settings-view-tab").count() === 1,
    "settings button was not moved next to language"
  );
  await page.click("#settings-view-tab");
  assert(await page.isVisible("#settings-view"), "settings view did not open");
  assert(await page.isVisible("#show-highlights"), "highlight setting was not moved into settings");
  assert(await page.locator("#import-manual").count() === 1, "manual import control is missing");
  assert(await page.locator("#export-manual").count() === 1, "manual export control is missing");
  assert(
    await page.textContent("#import-manual") === "Import manual file",
    "manual import control has the wrong label"
  );
  assert(
    await page.textContent("#export-manual") === "Download manual CSV",
    "manual export control has the wrong label"
  );
  const hoverSettings = await page.evaluate(() => ({
    processedSections: document.getElementById("show-processed-sections").checked,
    originalEnglish: document.getElementById("show-original-on-hover").checked,
    englishTranslation: document.getElementById("translate-english-on-hover").checked
  }));
  assert(hoverSettings.processedSections, "checked-section marker should start enabled");
  assert(hoverSettings.originalEnglish, "original-English hover should start enabled");
  assert(hoverSettings.englishTranslation, "English hover translation should start enabled");
  await page.click('label[title="Mark checked sections"]');
  await page.waitForFunction(() => window.__lastSavedPopupState?.showProcessedSections === false);
  await page.click('label[title="Show original English on hover"]');
  await page.waitForFunction(() => window.__lastSavedPopupState?.showOriginalOnHover === false);
  await page.click('label[title="Translate English on hover"]');
  await page.waitForFunction(() => window.__lastSavedPopupState?.translateEnglishOnHover === false);
  const settingsDisclosureOrder = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#settings-view details")).map((element) => element.id)
  );
  assert(await page.locator("#do-not-translate-panel").evaluate((element) => element.open), "Do not translate should start expanded");
  assert(await page.locator("#bulk-panel").evaluate((element) => element.open), "import/export should start expanded");
  assert(
    settingsDisclosureOrder.indexOf("do-not-translate-panel") < settingsDisclosureOrder.indexOf("bulk-panel"),
    "import/export should appear below Do not translate"
  );
  await page.waitForSelector("#do-not-translate-actions:not(.hidden)");
  await page.click("#exclude-page");
  await page.waitForFunction(
    () => document.getElementById("exclude-page-label")?.textContent === "Allow this page"
  );
  const pageExclusion = await page.evaluate(() => window.__lastSavedPopupState.doNotTranslate);
  assert(
    pageExclusion.pages.length === 1 &&
      pageExclusion.pages[0] === "https://www.google.com/search?q=steam",
    "page exclusion did not save the normalized current URL"
  );
  assert(
    (await page.locator("#do-not-translate-list").textContent()).includes("Specific page"),
    "page exclusion was not listed separately"
  );
  await page.click('button[aria-label="Remove page exclusion"]');
  await page.waitForFunction(
    () => document.getElementById("clear-do-not-translate")?.disabled === true
  );
  await page.evaluate(() => window.__setPopupStatusMode("excluded"));
  await page.click("#exclude-site");
  await page.waitForFunction(
    () => document.getElementById("exclude-site-label")?.textContent === "Allow this site"
  );
  const siteExclusion = await page.evaluate(() => window.__lastSavedPopupState.doNotTranslate);
  assert(
    siteExclusion.sites.length === 1 && siteExclusion.sites[0] === "www.google.com",
    "site exclusion did not save the hostname"
  );
  assert(await page.isDisabled("#exclude-page"), "page rule should be disabled while the whole site is excluded");
  assert(
    await page.evaluate(() => document.getElementById("page-status-panel").dataset.state) === "excluded",
    "excluded page did not receive its own runtime state"
  );
  assert(await page.isDisabled("#runtime-retry"), "Retry should be disabled for an excluded page");
  assert(
    (await page.textContent("#runtime-status")).includes("Translation is off for this site"),
    "excluded page did not explain why replacement is off"
  );
  await page.click("#clear-do-not-translate");
  await page.waitForFunction(
    () => document.getElementById("clear-do-not-translate")?.disabled === true
  );
  const clearedExclusions = await page.evaluate(() => window.__lastSavedPopupState.doNotTranslate);
  assert(
    clearedExclusions.sites.length === 0 && clearedExclusions.pages.length === 0,
    "clear list did not remove page and site exclusions"
  );
  await page.evaluate(() => window.__setPopupStatusMode("not-ready"));
  await page.click("#exclude-page");
  await page.waitForFunction(() => document.getElementById("runtime-retry")?.disabled === false);
  await page.click("#exclude-page");
  await page.waitForFunction(
    () => document.getElementById("clear-do-not-translate")?.disabled === true
  );
  await page.click("#settings-view-tab");
  assert(await page.isVisible("#vocabulary-view"), "vocabulary view did not restore");
  await page.click("#duolingo-section");
  assert(await page.isVisible("#duolingo-panel"), "Duolingo section did not open");
  assert(await page.isHidden("#manual-entry-panel"), "manual entry panel stayed visible in Duolingo section");
  assert(await page.isEnabled("#duolingo-sync"), "Duolingo sync should open a Words page when none is open");
  assert(
    await page.textContent("#duolingo-sync-label") === "Open Duolingo Words",
    "Duolingo sync did not switch to the open-page action"
  );
  await page.click("#duolingo-sync");
  await page.waitForFunction(() =>
    document.getElementById("duolingo-sync-status")?.textContent.includes("Opened Duolingo's Words page")
  );
  assert(
    await page.evaluate(() => window.__openedDuolingoUrl()) === "https://www.duolingo.com/practice-hub/words",
    "Duolingo sync did not open the correct Words route"
  );
  await page.click("#manual-section");
  assert(await page.isVisible("#manual-entry-panel"), "manual section did not restore the entry form");
  assert(before.triggerLanguage === "Ukrainian", "language trigger did not show the selected language");
  assert(before.triggerIcon.endsWith("/flags/ua.svg"), "selected Ukrainian language did not show its SVG flag");
  assert(
    before.languageOptions.length === before.languageNames.length,
    "custom language menu did not render every native language option"
  );
  assert(
    before.languageOptions.every((option) => option.icon.endsWith(".svg")),
    "custom language menu rendered an option without an SVG icon"
  );
  assert(
    before.languageOptions.find((option) => option.name === "Arabic")?.icon.endsWith("/flags/sa.svg"),
    "Arabic did not use the Saudi Arabia SVG flag"
  );
  await page.click("#language-trigger");
  assert(await page.isVisible("#language-options"), "language menu did not open on click");
  await page.keyboard.press("Escape");
  assert(await page.isHidden("#language-options"), "language menu did not close with Escape");
  await page.focus("#language-trigger");
  await page.keyboard.press("ArrowDown");
  assert(
    await page.evaluate(() => document.activeElement?.dataset.profileId === "uk"),
    "ArrowDown did not focus the selected language"
  );
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.getElementById("profile-select").value === "builtin-es");
  assert(
    await page.textContent("#language-trigger-label") === "Spanish",
    "keyboard selection did not update the selected language"
  );
  assert(
    (await page.locator("#target").getAttribute("placeholder")) === "Spanish (e.g. una taza de café)",
    "manual target field did not update after changing languages"
  );
  assert(await page.isDisabled("#submit-entry"), "Add should be disabled when both fields are blank");
  await page.fill("#source", "house");
  assert(await page.isDisabled("#submit-entry"), "Add should stay disabled when target is blank");
  await page.fill("#target", "будинок");
  assert(await page.isEnabled("#submit-entry"), "Add should be enabled when both fields have values");
  await page.fill("#source", "   ");
  assert(await page.isDisabled("#submit-entry"), "Add should be disabled for whitespace-only input");
  await page.fill("#source", "");
  await page.fill("#target", "");
  await page.fill(
    "#manual-lines",
    "radio,радіо,radio receiver\ninternet,інтернет,global computer network"
  );
  assert(await page.isEnabled("#add-manual-lines"), "manual line import should enable for non-empty input");
  await page.click("#add-manual-lines");
  await page.waitForFunction(() => {
    const profile = window.__lastSavedPopupState?.profiles?.find(
      (candidate) => candidate.id === "builtin-es"
    );
    return profile?.entries?.some(
      (entry) => entry.source === "radio" && entry.target === "радіо" && entry.origin === "manual"
    );
  });
  const manualLineEntries = await page.evaluate(() => {
    const profile = window.__lastSavedPopupState.profiles.find(
      (candidate) => candidate.id === "builtin-es"
    );
    return profile.entries.filter((entry) => entry.origin === "manual");
  });
  assert(
    manualLineEntries.some(
      (entry) => entry.source === "radio" && entry.definition === "radio receiver"
    ),
    "manual line import did not preserve the optional third-column definition"
  );
  assert(
    manualLineEntries.some(
      (entry) => entry.source === "internet" && entry.definition === "global computer network"
    ),
    "manual line import did not add every CSV line"
  );
  await page.click("#settings-view-tab");
  await page.click("#runtime-retry");
  await page.evaluate(() =>
    window.__pushRuntimeStatus({
      status: "complete",
      targetLanguage: "uk",
      replacementCount: 3,
      wordFamilyReplacementCount: 2,
      enabled: true,
      startedAt: 1000,
      finishedAt: 2500
    })
  );
  await page.waitForFunction(() =>
    document.getElementById("runtime-status")?.textContent.includes("3 replacements")
  );
  const after = await page.evaluate(() => ({
    text: document.getElementById("runtime-status").textContent,
    state: document.getElementById("page-status-panel").dataset.state,
    retryDisabled: document.getElementById("runtime-retry").disabled,
    sendMessageOptions: window.__lastSendMessageOptions
  }));

  assert(before.state === "blocked", "popup did not show blocked translator state");
  assert(!before.retryDisabled, "retry should be enabled for blocked translator state");
  assert(after.state === "ok", "popup did not show successful retry state");
  assert(after.text.includes("3 replacements"), "popup did not show replacement count");
  assert(after.text.includes("2 inflected word forms"), "popup did not show inflected word-form count");
  assert(after.text.includes("Finished in 1.5s"), "popup did not show translation duration");
  assert(after.sendMessageOptions?.frameId === 0, "popup should message the top frame");
  await page.close();
}

function testBackgroundBadge() {
  const code = readBackgroundScriptForVm();
  const calls = [];
  let messageListener = null;
  const context = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          }
        }
      },
      tabs: {
        onUpdated: { addListener() {} },
        onRemoved: { addListener() {} }
      },
      action: {
        setBadgeText(args) {
          calls.push(["text", args]);
        },
        setBadgeBackgroundColor(args) {
          calls.push(["color", args]);
        },
        setTitle(args) {
          calls.push(["title", args]);
        }
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(code, context);
  messageListener(
    {
      type: "LWR_STATUS",
      status: { enabled: true, status: "translator-error", lastError: "iframe failure" }
    },
    { tab: { id: 5 }, frameId: 2 }
  );
  messageListener(
    {
      type: "LWR_STATUS",
      status: { enabled: true, status: "translator-preparing" }
    },
    { tab: { id: 6 } }
  );
  messageListener(
    {
      type: "LWR_STATUS",
      status: { enabled: true, status: "translating", translationCalls: 2 }
    },
    { tab: { id: 9 } }
  );
  messageListener(
    {
      type: "LWR_STATUS",
      status: { enabled: true, status: "translator-not-ready", lastError: "downloadable" }
    },
    { tab: { id: 7 } }
  );
  messageListener(
    {
      type: "LWR_STATUS",
      status: { enabled: true, status: "complete", replacementCount: 4 }
    },
    { tab: { id: 8 } }
  );

  assert(
    !calls.some(([, args]) => args.tabId === 5),
    "iframe translator status should not update the badge"
  );
  assert(
    calls.some(([type, args]) => type === "text" && args.tabId === 6 && args.text === "..."),
    "preparing translator badge was not set"
  );
  assert(
    calls.some(([type, args]) => type === "text" && args.tabId === 9 && args.text === "..."),
    "translating badge was not set"
  );
  assert(
    calls.some(
      ([type, args]) =>
        type === "title" &&
        args.tabId === 9 &&
        args.title === "Translating visible page text (2 calls)"
    ),
    "translating badge title was not set"
  );
  assert(
    calls.some(([type, args]) => type === "text" && args.tabId === 7 && args.text === "!"),
    "blocked translator badge was not set"
  );
  assert(
    calls.some(([type, args]) => type === "text" && args.tabId === 8 && args.text === "4"),
    "replacement count badge was not set"
  );
}

async function testBackgroundRestoresOpenTabContentScripts() {
  const code = readBackgroundScriptForVm();
  const injections = [];
  let startupListener = null;
  let installedListener = null;
  const context = {
    chrome: {
      sidePanel: {
        setPanelBehavior() {
          return { catch() {} };
        }
      },
      runtime: {
        onMessage: { addListener() {} },
        onStartup: {
          addListener(listener) {
            startupListener = listener;
          }
        },
        onInstalled: {
          addListener(listener) {
            installedListener = listener;
          }
        }
      },
      tabs: {
        onUpdated: { addListener() {} },
        onRemoved: { addListener() {} },
        query(query, callback) {
          callback([
            { id: 3, url: "https://en.wikipedia.org/wiki/Radio" },
            { id: 4, url: "chrome://extensions" }
          ]);
        }
      },
      scripting: {
        executeScript(options) {
          injections.push(options);
          return Promise.resolve([]);
        }
      },
      action: {
        setBadgeText() {},
        setBadgeBackgroundColor() {},
        setTitle() {}
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(code, context);
  assert(typeof startupListener === "function", "background did not register startup restoration");
  assert(typeof installedListener === "function", "background did not register update restoration");

  startupListener();
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert(
    JSON.stringify(injections) ===
      JSON.stringify([
        {
          target: { tabId: 3, allFrames: true },
          world: "MAIN",
          files: ["page-translator-bridge.js"]
        },
        {
          target: { tabId: 3, allFrames: true },
          files: ["content.js"]
        }
      ]),
    "background did not restore the bridge and content script into existing web tabs"
  );
}

function testBackgroundBadgeIgnoresMissingTabs() {
  const code = readBackgroundScriptForVm();
  let messageListener = null;
  let removedListener = null;
  let actionCallCount = 0;
  let catchCount = 0;
  const missingTabResult = {
    catch(handler) {
      catchCount += 1;
      handler(new Error("No tab with id: 1396231763."));
    }
  };
  const actionMethod = () => {
    actionCallCount += 1;
    return missingTabResult;
  };
  const context = {
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) {
            messageListener = listener;
          }
        }
      },
      tabs: {
        onUpdated: { addListener() {} },
        onRemoved: {
          addListener(listener) {
            removedListener = listener;
          }
        }
      },
      action: {
        setBadgeText: actionMethod,
        setBadgeBackgroundColor: actionMethod,
        setTitle: actionMethod
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(code, context);
  messageListener(
    {
      type: "LWR_STATUS",
      status: { enabled: true, status: "complete", replacementCount: 2 }
    },
    { tab: { id: 1396231763 }, frameId: 0 }
  );
  removedListener(1396231763);

  assert(actionCallCount > 0, "missing-tab test did not exercise badge action calls");
  assert(catchCount === actionCallCount, "badge action promise rejections were not handled");
}

function testToolbarOpensSidePanel() {
  const code = readBackgroundScriptForVm();
  let behavior = null;
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, "../extension/manifest.json"), "utf8"));
  const context = {
    chrome: {
      sidePanel: {
        setPanelBehavior(options) {
          behavior = options;
          return { catch() {} };
        }
      },
      runtime: {
        onMessage: { addListener() {} }
      },
      tabs: {
        onUpdated: { addListener() {} },
        onRemoved: { addListener() {} }
      },
      action: {
        setBadgeText() {},
        setBadgeBackgroundColor() {},
        setTitle() {}
      }
    }
  };

  vm.createContext(context);
  vm.runInContext(code, context);

  assert(
    behavior?.openPanelOnActionClick === true,
    "toolbar action was not configured to open the side panel"
  );
  assert(!manifest.action.default_popup, "toolbar action still has a popup configured");
  assert(manifest.side_panel?.default_path === "sidepanel.html", "side panel path is not configured");
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    await testReplacementUsesTranslatedTokens(browser);
    await testUkrainianWordFamiliesUseTranslatedInflections(browser);
    await testRepeatedWordReplacesEveryOccurrenceInSentence(browser);
    await testBlocksWithInlineMarkupTranslateAllTextNodes(browser);
    await testAmbiguousUkrainianFormPrefersEntryWithEnglishEvidence(browser);
    await testNeuralAlignerResolvesMatchesWithoutEnglishHints(browser);
    await testNeuralAlignerNeverReplacesNumericSpans(browser);
    await testNeuralAlignerIsSkippedWhenEnglishHintsResolve(browser);
    await testStructureModeRebuildsSentencesInTargetOrder(browser);
    await testStructureModeRestoresOriginalMarkupWhenDisabled(browser);
    await testStructureModeKeepsUnalignedSentencesInEnglish(browser);
    await testStructureModeHighlightsUnalignedWordsWithHoverGuess(browser);
    await testNormalModeIgnoresWeakAlignmentPairs(browser);
    await testPluralEnglishWordAlignsToSingularEntry(browser);
    await testUkrainianWordFamiliesDoNotMatchCompounds(browser);
    await testUkrainianPronounLemmaUsesChromeSurfaceForm(browser);
    await testRuntimeStatusCountsLiveReplacementSpans(browser);
    await testProcessedBlocksAreMarkedOnPage(browser);
    await testHoverTranslatesEnglishWord(browser);
    await testHoverSettingsCanBeDisabled(browser);
    await testProfileLanguageIsInferredFromImportedTargets(browser);
    await testEnglishHintAlignmentAvoidsDeletionProbe(browser);
    await testEnglishHintBlocksDeletionFallbackMismatch(browser);
    await testEnglishHintAlignsShortGrammarWord(browser);
    await testMismatchedSentenceBoundariesDoNotDuplicateWords(browser);
    await testTranslatingStatusPublishesBeforeTranslateResolves(browser);
    await testAmbiguousDeletionAlignmentIsSkipped(browser);
    await testBatchTranslationUsesDividers(browser);
    await testAmbiguousBatchDeletionFallsBackToSingleProbe(browser);
    await testDownloadableTranslatorCreatesWhenCached(browser);
    await testDownloadableTranslatorFallsBackToActivationWhenCreateFails(browser);
    await testRetryPreparesDownloadableTranslator(browser);
    await testWorkBudget(browser);
    await testContentUnitsArePrioritizedOverPageChrome(browser);
    await testLongBlocksAreNotSplitByArbitraryCharacterLimit(browser);
    await testExcludedPageRestoresAndSkipsTranslation(browser);
    await testExclusionChangeRestoresExistingReplacements(browser);
    await testHiddenMutationDoesNotRetriggerTranslation(browser);
    await testScrollWithoutPendingTextDoesNotRetriggerTranslation(browser);
    await testMutationPreservesExistingReplacementsAndSkipsProcessedBlocks(browser);
    await testMutationProcessesOnlyQueuedBlock(browser);
    await testScrollDoesNotRewriteStructuralContainerSiblings(browser);
    await testNavigationAndAsideTextIsIgnored(browser);
    await testDuolingoSyncScrapesEveryLoadedPageInExportFormat(browser);
    await testTranslatorBridgeCreatesInsideTrustedPageActivation(browser);
    await testDuolingoSyncKeepsManualEntriesSeparate(browser);
    await testDuolingoSyncRequiresActivePageAndExplainsRefresh(browser);
    await testDuolingoLoginRedirectShowsInstructions(browser);
    await testSidePanelUsesCompactVocabularyList(browser);
    await testPopupStatusPanel(browser);
    testVendoredLucideIcons();
    testUkrainianMorphologyDictionary();
    testFullExportDoesNotUseClickEventAsFilter();
    testBackgroundBadge();
    await testBackgroundRestoresOpenTabContentScripts();
    testBackgroundBadgeIgnoresMissingTabs();
    testToolbarOpensSidePanel();
    console.log("extension runtime tests passed");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
