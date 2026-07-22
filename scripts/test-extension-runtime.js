const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CONTENT_SCRIPT = path.resolve(__dirname, "../extension/content.js");
const POPUP_PAGE = `file://${path.resolve(__dirname, "../extension/popup.html")}`;
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
const IMPORT_CORE_SCRIPT = path.resolve(__dirname, "../extension/import-core.js");
const POPUP_STYLES = path.resolve(__dirname, "../extension/popup.css");
const LUCIDE_ICON_DIR = path.resolve(__dirname, "../extension/icons/lucide");

function createState(entries) {
  return {
    version: 3,
    enabled: true,
    showHighlights: true,
    // The real version-3 defaults turn these on and exclude www.duolingo.com;
    // the harness baseline keeps them off so each test opts in explicitly.
    structureMode: false,
    duolingoAutoContinue: false,
    duolingoTypeAnswers: false,
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
    "power.svg",
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

function testImportCoreAppliesDuolingoImport() {
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(IMPORT_CORE_SCRIPT, "utf8"), context);
  const core = context.LWRImportCore;

  const state = {
    version: 2,
    currentProfileId: "es-test",
    profiles: [
      { id: "es-test", name: "Spanish", languageCode: "es", entries: [] },
      {
        id: "uk-test",
        name: "Ukrainian",
        languageCode: "uk",
        entries: [
          {
            id: "existing",
            source: "cafe",
            target: "кафе",
            languageCode: "uk",
            definition: "Duolingo meanings: a cafe",
            origin: "duolingo",
            learned: true,
            enabled: true
          }
        ]
      }
    ]
  };

  const result = core.applyDuolingoImport(state, {
    text: "кафе - a cafe, a café, the cafe\nсестри - sisters, a sister, 's",
    languageName: "Ukrainian"
  });
  assert(result.ok, `import-core rejected a valid import: ${result.reason}`);
  assert(result.profileName === "Ukrainian", "import-core matched the wrong profile");
  assert(
    result.state.currentProfileId === "uk-test",
    "import-core did not switch to the imported profile"
  );
  assert(state.profiles[1].entries.length === 1, "import-core mutated the input state");

  const entries = result.state.profiles[1].entries;
  const sources = entries.map((entry) => entry.source).sort();
  // "'s" is an invalid standalone source and must be dropped; "cafe" merges
  // into the existing entry instead of duplicating it.
  assert(
    sources.join(",") === "cafe,café,sister,sisters",
    `wrong imported sources: ${sources.join(",")}`
  );
  const cafeEntry = entries.find((entry) => entry.id === "existing");
  assert(cafeEntry, "existing entry lost its identity during merge");
  assert(cafeEntry.target === "кафе", "existing target was not preserved");

  const unsupported = core.applyDuolingoImport(state, {
    text: "кафе - a cafe",
    languageName: "Klingon"
  });
  assert(
    !unsupported.ok && /not supported/.test(unsupported.reason),
    "import-core accepted an unsupported language"
  );

  const empty = core.applyDuolingoImport(state, { text: "", languageName: "Ukrainian" });
  assert(!empty.ok, "import-core accepted empty text");

  const manualImport = core.applyTextImport(
    { ...state, currentProfileId: "uk-test" },
    { text: "radio,радіо,radio receiver", originOverride: "manual" }
  );
  assert(manualImport.ok, `text import failed: ${manualImport.reason}`);
  const manualEntry = manualImport.state.profiles[1].entries.find(
    (entry) => entry.source === "radio"
  );
  assert(
    manualEntry && manualEntry.origin === "manual" && manualEntry.target === "радіо",
    "text import did not add the manual row to the current profile"
  );

  const csv = core.buildVocabularyCsv(manualImport.state, { origin: "manual" });
  assert(csv.ok && csv.count === 1, `manual CSV export failed: ${JSON.stringify(csv)}`);
  assert(
    csv.csv === "radio,радіо,radio receiver\n",
    `wrong manual CSV content: ${JSON.stringify(csv.csv)}`
  );
  assert(
    csv.filename === "ukrainian-manual.csv",
    `wrong manual CSV filename: ${csv.filename}`
  );
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
  // Export now lives in the Duolingo settings panel (content.js) on top of
  // the shared import-core; the origin filter must still never receive a
  // click event or arbitrary values.
  const contentScript = fs.readFileSync(CONTENT_SCRIPT, "utf8");
  const coreScript = fs.readFileSync(IMPORT_CORE_SCRIPT, "utf8");
  assert(
    contentScript.includes(`exportAll.addEventListener("click", () => runDuolingoPanelExport(""));`),
    "all-vocabulary export passes its click event to the export filter"
  );
  assert(
    coreScript.includes('const exportOrigin = origin === "manual" ? "manual" : "";'),
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
          getURL: (path) => `chrome-extension://test-extension/${path}`,
          onMessage: {
            addListener(listener) {
              window.__runtimeMessageListener = listener;
            }
          },
          sendMessage(message, callback) {
            window.__runtimeMessages = window.__runtimeMessages || [];
            window.__runtimeMessages.push(message);
            if (typeof callback === "function") {
              const responder = window.__runtimeSendMessageResponder;
              Promise.resolve(responder ? responder(message) : { ok: true }).then(callback);
            }
          }
        },
        storage: {
          local: {
            get(defaults, callback) {
              callback({ learnedWordReplacerState: savedState });
            },
            set(items, callback) {
              window.__storageWrites = window.__storageWrites || [];
              window.__storageWrites.push(items);
              if (typeof callback === "function") {
                callback();
              }
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
    result.text === "Радіо — is technology communicating.",
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

async function testStructureModeSurvivesWhitespaceOnlyTextNodes(browser) {
  const page = await browser.newPage();
  // Wikipedia-style markup keeps inter-word spaces in their own text nodes
  // ("<b>Radio</b> <a>is</a>"). Dropping them fed the translator "Radiois"
  // and made the structure gate's rendered-text comparison fail, silently
  // falling back to per-word replacement.
  const source = "Radio is the technology of communicating.";
  const translatorInputs = [];
  await page.setContent(
    '<p><b>Radio</b> <a href="#">is</a> the technology of communicating.</p>'
  );
  await installHarness(page, {
    state: {
      ...createState([{ id: "e1", source: "radio", target: "радіо", enabled: true, createdAt: 1 }]),
      structureMode: true
    },
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        translatorInputs.push(text);
        return text === source ? "Радіо - це технологія зв'язку." : "";
      }
    },
    config: {
      ukrainianLemmas: { "радіо": ["радіо"] }
    },
    wordAligner: createStructureModeAligner()
  });

  await page.waitForFunction(
    () => document.querySelector(".learned-word-replacer-structured") !== null
  );
  const result = await page.evaluate(() => ({
    text: document.body.innerText
  }));

  assert(
    result.text === "Радіо — is technology communicating.",
    `a whitespace-only text node kept structure mode from rebuilding the block: ${JSON.stringify(
      { ...result, translatorInputs }
    )}`
  );
  assert(
    translatorInputs.some((text) => text.includes("Radio is the technology")),
    `the translator saw text with the inter-node spaces dropped: ${JSON.stringify(translatorInputs)}`
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
      // The fidelity check vets every displayed unlearned Ukrainian word
      // against the dictionary, so the stub must know the scaffold word too.
      ukrainianLemmas: { "радіо": ["радіо"], "радіоприймачі": ["радіоприймач"] }
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

async function testStructureModeFallsBackWhenTranslationIsMangled(browser) {
  const page = await browser.newPage();
  // Two ways the small on-device model mangles proper-noun runs: dropping a
  // name outright, and inventing a non-word. Both sentences must abandon
  // structure mode instead of painting the mangled frame into the page.
  const droppedSource = "The Republic of Yucatan no longer exists.";
  const droppedTranslation = "Республіка більше не існує.";
  const inventedSource = "The Bolivian Confederation was real.";
  const inventedTranslation = "Боліва конфедерація була справжньою.";
  await page.setContent(`<p>${droppedSource}</p><p>${inventedSource}</p>`);
  await installHarness(page, {
    state: {
      ...createState([{ id: "e1", source: "not", target: "не", enabled: true, createdAt: 1 }]),
      structureMode: true
    },
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        if (text === droppedSource) {
          return droppedTranslation;
        }
        return text === inventedSource ? inventedTranslation : "";
      }
    },
    config: {
      // Every real word resolves; only the invented "Боліва" is unknown.
      ukrainianLemmas: {
        "республіка": ["республіка"],
        "більше": ["більше"],
        "існує": ["існувати"],
        "конфедерація": ["конфедерація"],
        "була": ["бути"],
        "справжньою": ["справжній"]
      }
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
      if (sourceText === droppedSource) {
        // "Yucatan" is aligned to nothing anywhere: the translation lost it.
        return [
          link("Republic", "Республіка"),
          link("longer", "більше"),
          link("exists", "існує")
        ];
      }
      return [
        // The invented word is only a weak best guess, like a real aligner
        // would produce for a token the model made up.
        link("Bolivian", "Боліва", { weak: true, score: 0.0005 }),
        link("Confederation", "конфедерація"),
        link("was", "була"),
        link("real", "справжньою")
      ];
    }
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-checked").length === 2
  );
  const result = await page.evaluate(() => ({
    structured: document.querySelectorAll(".learned-word-replacer-structured").length,
    text: document.body.innerText
  }));

  assert(
    result.structured === 0,
    `a mangled translation was still used as a structure-mode frame: ${JSON.stringify(result)}`
  );
  assert(
    result.text.includes("Yucatan") && result.text.includes("Bolivian Confederation"),
    `fallback did not preserve the original sentences: ${JSON.stringify(result.text)}`
  );
  assert(
    !result.text.includes("Боліва"),
    `the invented translator word leaked into the page: ${JSON.stringify(result.text)}`
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

async function testStructureModeLeavesUiBlocksToNormalReplacement(browser) {
  const page = await browser.newPage();
  const source = "It is in the house. ";
  await page.setContent("<p>It is in the house. <button>menu</button></p>");
  await installHarness(page, {
    state: {
      ...createState([{ id: "e1", source: "it", target: "це", enabled: true, createdAt: 1 }]),
      structureMode: true
    },
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? "Це у будинку." : "")
    },
    config: {
      ukrainianLemmas: { "це": ["це"] }
    },
    wordAligner: async (sourceText, translatedText) => [
      {
        srcStart: sourceText.indexOf("It"),
        srcEnd: sourceText.indexOf("It") + 2,
        tgtStart: translatedText.indexOf("Це"),
        tgtEnd: translatedText.indexOf("Це") + 2,
        score: 0.9
      }
    ]
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-token").length >= 1
  );
  const result = await page.evaluate(() => ({
    structured: document.querySelectorAll(".learned-word-replacer-structured").length,
    buttonIntact: document.querySelector("p button")?.textContent === "menu",
    text: document.body.innerText.replace(/\s+/g, " ").trim()
  }));

  assert(
    result.structured === 0,
    "a block containing UI markup was flattened by structure mode"
  );
  assert(result.buttonIntact, "the button inside the block was destroyed");
  assert(
    result.text === "Це is in the house. menu",
    `normal replacement did not run on the UI block: ${JSON.stringify(result)}`
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
    rows: Array.from(
      document.querySelectorAll(".learned-word-replacer-hover-tooltip-row"),
      (row) => row.textContent
    ),
    color: getComputedStyle(document.querySelector(".learned-word-replacer-hover-tooltip")).color
  }));

  assert(
    firstHover.rows.join(",") === "будинок",
    `English hover did not show the Ukrainian translation as a hint row: ${JSON.stringify(firstHover.rows)}`
  );
  assert(firstHover.color === "rgb(60, 60, 60)", "English hover tooltip lost Duolingo's hint text color");
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

async function testReplacementHoverShowsThreeDuolingoMeanings(browser) {
  const page = await browser.newPage();
  const source = "The sweater is warm.";
  await page.setContent(`<p>${source}</p>`);
  await installHarness(page, {
    state: createState([
      {
        id: "e1",
        source: "sweater",
        target: "светр",
        definition: "Duolingo meanings: sweater, jumper, pullover",
        enabled: true,
        createdAt: 1
      }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === source ? "Светр теплий." : "")
    },
    config: {
      ukrainianLemmas: { светр: ["светр"] }
    }
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-token").length === 1
  );
  await page.evaluate(() => {
    document.querySelector(".learned-word-replacer-token").dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, pointerType: "mouse" })
    );
  });
  await page.waitForSelector('.learned-word-replacer-hover-tooltip[data-visible="true"]');
  const result = await page.evaluate(() => {
    const box = document.querySelector(".learned-word-replacer-hover-tooltip-box");
    const boxStyle = getComputedStyle(box);
    return {
      rows: Array.from(
        document.querySelectorAll(".learned-word-replacer-hover-tooltip-row"),
        (row) => row.textContent
      ),
      background: boxStyle.backgroundColor,
      borderRadius: boxStyle.borderRadius,
      border: boxStyle.border,
      rowPadding: getComputedStyle(
        document.querySelector(".learned-word-replacer-hover-tooltip-row")
      ).padding
    };
  });

  assert(
    result.rows.join(",") === "sweater,jumper,pullover",
    `hovering a replaced word did not show Duolingo's three best meanings: ${JSON.stringify(result.rows)}`
  );
  assert(
    result.background === "rgb(247, 247, 247)" &&
      result.borderRadius === "15px" &&
      result.border === "2px solid rgb(229, 229, 229)" &&
      result.rowPadding === "15px 10px",
    `the hint popover lost Duolingo's styling: ${JSON.stringify(result)}`
  );
  await page.close();
}

async function testEnglishHoverShowsVocabularyAlternates(browser) {
  const page = await browser.newPage();
  let catTranslationCalls = 0;
  await page.setContent('<p id="hover-copy">cat food</p>');
  await page.evaluate(() => {
    const textNode = document.getElementById("hover-copy").firstChild;
    Object.defineProperty(document, "caretPositionFromPoint", {
      configurable: true,
      value: undefined
    });
    document.caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(textNode, 1);
      range.collapse(true);
      return range;
    };
  });

  await installHarness(page, {
    state: createState([
      { id: "e1", source: "cat", target: "кіт / кішка / киця", enabled: true, createdAt: 1 }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => {
        if (text === "cat") {
          catTranslationCalls += 1;
        }
        return "щось інше.";
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
  const result = await page.evaluate(() => ({
    rows: Array.from(
      document.querySelectorAll(".learned-word-replacer-hover-tooltip-row"),
      (row) => row.textContent
    )
  }));

  assert(
    result.rows.join(",") === "кіт,кішка,киця",
    `hovering a learned English word did not list its vocabulary alternates: ${JSON.stringify(result.rows)}`
  );
  assert(
    catTranslationCalls === 0,
    "the hover translator ran even though the vocabulary already had translations"
  );
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
      version: 3,
      enabled: true,
      showHighlights: true,
      structureMode: false,
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

async function testDuolingoSyncLoadsMoreThanTwentyPages(browser) {
  const page = await browser.newPage();
  await page.route("https://www.duolingo.com/practice-hub/words", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
        <h2>Practice your Ukrainian words</h2>
        <h2>52 words</h2>
        <ul id="words">
          <li><div><h3>слово0</h3><p>meaning 0</p></div></li>
          <li><div><h3>слово1</h3><p>meaning 1</p></div></li>
          <li id="load-more" role="button">Load more</li>
        </ul>
        <script>
          let batch = 0;
          const loadMore = document.getElementById("load-more");
          loadMore.addEventListener("click", () => {
            setTimeout(() => {
              batch += 1;
              for (let i = 0; i < 2; i += 1) {
                const n = batch * 2 + i;
                const row = document.createElement("li");
                row.innerHTML = "<div><h3>слово" + n + "</h3><p>meaning " + n + "</p></div>";
                loadMore.parentElement.insertBefore(row, loadMore);
              }
              if (batch === 25) {
                loadMore.remove();
              }
            }, 5);
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

  assert(response.ok, `large Duolingo sync failed: ${response.reason || "unknown error"}`);
  assert(
    response.count === 52 && response.expectedCount === 52,
    `large vocabulary was cut off by a load-more click cap: ${JSON.stringify({
      count: response.count,
      expectedCount: response.expectedCount
    })}`
  );
  await page.close();
}

async function testDuolingoTypeHintShowsNextLettersAndDeadEnds(browser) {
  const page = await browser.newPage();
  await page.route("https://www.duolingo.com/lesson", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
        <div data-test="word-bank">
          <button data-test="challenge-tap-token">кіт</button>
          <button data-test="challenge-tap-token">мене</button>
          <button data-test="challenge-tap-token">мене звуть</button>
        </div>
      `
    })
  );
  await page.goto("https://www.duolingo.com/lesson");
  await installHarness(page, {
    state: { ...createState([]), duolingoTypeAnswers: true },
    translator: {
      availability: async () => "available",
      translate: async (text) => text
    }
  });

  await page.waitForSelector("#learned-word-replacer-duolingo-type-input");

  const probe = (typed) =>
    page.evaluate((value) => {
      const input = document.getElementById("learned-word-replacer-duolingo-type-input");
      input.value = value;
      input.dispatchEvent(new InputEvent("input", { bubbles: true }));
      const borderAfterInput = input.style.borderColor;
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
      const badge = document.getElementById("learned-word-replacer-duolingo-hint-badge");
      return {
        borderAfterInput,
        badgeText: badge.textContent,
        badgeShown: badge.style.display === "block",
        badgeBackground: badge.style.background
      };
    }, typed);

  const single = await probe("к");
  assert(single.badgeShown, "hint badge did not appear for a viable prefix");
  assert(single.badgeText === "next: і", `wrong single-letter hint: ${single.badgeText}`);
  assert(
    single.borderAfterInput !== "rgb(234, 43, 43)",
    "viable prefix was marked as a dead end"
  );

  const complete = await probe("мене");
  assert(
    complete.badgeText === "space places it · or continue: ␣",
    `wrong completed-word hint: ${complete.badgeText}`
  );

  const midToken = await probe("мене ");
  assert(
    midToken.badgeText === "next: з",
    `trailing space was not kept in the hint prefix: ${midToken.badgeText}`
  );

  const empty = await probe("");
  assert(
    empty.badgeText === "next: к / м",
    `empty buffer should hint the remaining first letters: ${empty.badgeText}`
  );

  const deadEnd = await probe("яб");
  assert(
    deadEnd.borderAfterInput === "rgb(234, 43, 43)",
    "dead-end prefix did not turn the input border red"
  );
  assert(
    deadEnd.badgeText === "✗ no bank word matches — backspace",
    `wrong dead-end hint: ${deadEnd.badgeText}`
  );
  assert(
    deadEnd.badgeBackground === "rgb(234, 43, 43)",
    "dead-end hint badge is not red"
  );

  const recovered = await probe("кіт");
  assert(
    recovered.borderAfterInput !== "rgb(234, 43, 43)",
    "border did not recover once the prefix became viable again"
  );

  await page.close();
}

async function testDuolingoListenMatchHidesWordsAndTypesPairs(browser) {
  const page = await browser.newPage();
  // Mirrors the live listen-match DOM (2026-07-17): audio cards hold a number
  // badge and a waveform, word cards add a challenge-tap-token-text span, and
  // matched pairs flip aria-disabled to "true".
  await page.route("https://www.duolingo.com/lesson", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
        <div data-test="challenge challenge-listenMatch">
          <div><div><div id="grid">
            <span><button data-test="but-challenge-tap-token" aria-disabled="false"><span>1</span><svg></svg></button></span>
            <span><button data-test="bread-challenge-tap-token" aria-disabled="false"><span>2</span><svg></svg></button></span>
            <span><button data-test="but-challenge-tap-token" aria-disabled="false"><span>3</span><span data-test="challenge-tap-token-text">but</span></button></span>
            <span><button data-test="bread-challenge-tap-token" aria-disabled="false"><span>4</span><span data-test="challenge-tap-token-text">bread</span></button></span>
          </div></div></div>
        </div>
        <script>
          window.__cardClicks = [];
          let selected = null;
          document.querySelectorAll("button").forEach((card) => {
            card.addEventListener("click", () => {
              window.__cardClicks.push(card.textContent.trim());
              if (selected && selected !== card &&
                  selected.getAttribute("data-test") === card.getAttribute("data-test")) {
                selected.setAttribute("aria-disabled", "true");
                card.setAttribute("aria-disabled", "true");
                selected = null;
              } else {
                selected = card;
              }
            });
          });
        </script>
      `
    })
  );
  await page.goto("https://www.duolingo.com/lesson");
  await installHarness(page, {
    state: { ...createState([]), duolingoTypeAnswers: true },
    translator: {
      availability: async () => "available",
      translate: async (text) => text
    }
  });

  await page.waitForSelector("#learned-word-replacer-duolingo-type-input");

  const setup = await page.evaluate(() => {
    const input = document.getElementById("learned-word-replacer-duolingo-type-input");
    const wrap = document.getElementById("learned-word-replacer-duolingo-type-wrap");
    return {
      placeholder: input.placeholder,
      insertedBeforeGrid: wrap.nextElementSibling === document.getElementById("grid"),
      wordVisibility: [...document.querySelectorAll("[data-test='challenge-tap-token-text']")]
        .map((span) => span.style.visibility)
    };
  });
  assert(
    setup.placeholder === "Press a number to listen, type the word, then space",
    `wrong match-mode placeholder: ${setup.placeholder}`
  );
  assert(setup.insertedBeforeGrid, "input row was not inserted before the match grid");
  assert(
    setup.wordVisibility.length === 2 && setup.wordVisibility.every((v) => v === "hidden"),
    `match words are not hidden by default: ${JSON.stringify(setup.wordVisibility)}`
  );

  const paired = await page.evaluate(() => {
    const input = document.getElementById("learned-word-replacer-duolingo-type-input");
    // Digit on an empty buffer taps the numbered audio card.
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    const clicksAfterDigit = [...window.__cardClicks];
    // Typing the recalled word and space clicks the matching word card.
    input.value = "but";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    return {
      clicksAfterDigit,
      clicks: [...window.__cardClicks],
      inputValue: input.value,
      pairDisabled: [...document.querySelectorAll("[data-test='but-challenge-tap-token']")]
        .map((card) => card.getAttribute("aria-disabled"))
    };
  });
  assert(
    paired.clicksAfterDigit.length === 1 && paired.clicksAfterDigit[0] === "1",
    `digit key did not tap the numbered audio card: ${JSON.stringify(paired.clicksAfterDigit)}`
  );
  assert(
    paired.clicks.length === 2 && paired.clicks[1] === "3but",
    `typed word did not tap the matching word card: ${JSON.stringify(paired.clicks)}`
  );
  assert(paired.inputValue === "", "buffer was not cleared after pairing");
  assert(
    paired.pairDisabled.every((value) => value === "true"),
    "fixture did not mark the pair matched"
  );

  const afterPair = await page.evaluate(() => {
    const input = document.getElementById("learned-word-replacer-duolingo-type-input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    const badge = document.getElementById("learned-word-replacer-duolingo-hint-badge");
    return { badgeText: badge.textContent };
  });
  assert(
    afterPair.badgeText === "next: b",
    `matched pair still hinted; expected only bread to remain: ${afterPair.badgeText}`
  );

  const revealed = await page.evaluate(() => {
    document.getElementById("learned-word-replacer-duolingo-bank-toggle").click();
    return [...document.querySelectorAll("[data-test='challenge-tap-token-text']")]
      .map((span) => span.style.visibility);
  });
  assert(
    revealed.every((value) => value === ""),
    `eye toggle did not reveal the match words: ${JSON.stringify(revealed)}`
  );

  await page.close();
}

async function testDuolingoAssistHidesChoicesAndTypesAnswer(browser) {
  const page = await browser.newPage();
  // Mirrors the live challenge-assist DOM (2026-07-17): an English prompt with
  // numbered choice divs, each word inside a challenge-judge-text span.
  await page.route("https://www.duolingo.com/lesson", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
        <div data-test="challenge challenge-assist">
          <h1>Select the correct meaning</h1>
          <div>eight</div>
          <div><div id="choices">
            <div data-test="challenge-choice" aria-checked="false"><span>1</span><span data-test="challenge-judge-text">пити</span></div>
            <div data-test="challenge-choice" aria-checked="false"><span>2</span><span data-test="challenge-judge-text">вісім</span></div>
            <div data-test="challenge-choice" aria-checked="false"><span>3</span><span data-test="challenge-judge-text">чиє</span></div>
          </div></div>
        </div>
        <script>
          window.__choiceClicks = [];
          document.querySelectorAll("[data-test='challenge-choice']").forEach((choice) => {
            choice.addEventListener("click", () => {
              window.__choiceClicks.push(choice.textContent.trim());
              choice.setAttribute("aria-checked", "true");
            });
          });
        </script>
      `
    })
  );
  await page.goto("https://www.duolingo.com/lesson");
  await installHarness(page, {
    state: { ...createState([]), duolingoTypeAnswers: true },
    translator: {
      availability: async () => "available",
      translate: async (text) => text
    }
  });

  await page.waitForSelector("#learned-word-replacer-duolingo-type-input");

  const result = await page.evaluate(() => {
    const input = document.getElementById("learned-word-replacer-duolingo-type-input");
    const wrap = document.getElementById("learned-word-replacer-duolingo-type-wrap");
    const setup = {
      placeholder: input.placeholder,
      insertedBeforeChoices: wrap.nextElementSibling === document.getElementById("choices"),
      wordVisibility: [...document.querySelectorAll("[data-test='challenge-judge-text']")]
        .map((span) => span.style.visibility)
    };
    input.value = "вісім";
    input.dispatchEvent(new InputEvent("input", { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    return {
      ...setup,
      clicks: [...window.__choiceClicks],
      inputValue: input.value,
      checked: [...document.querySelectorAll("[data-test='challenge-choice']")]
        .map((choice) => choice.getAttribute("aria-checked"))
    };
  });
  assert(
    result.placeholder === "Type the meaning, then space — Enter checks",
    `wrong choice-mode placeholder: ${result.placeholder}`
  );
  assert(result.insertedBeforeChoices, "input row was not inserted before the choice grid");
  assert(
    result.wordVisibility.length === 3 && result.wordVisibility.every((v) => v === "hidden"),
    `choice words are not hidden by default: ${JSON.stringify(result.wordVisibility)}`
  );
  assert(
    result.clicks.length === 1 && result.clicks[0] === "2вісім",
    `typed answer did not click the matching choice: ${JSON.stringify(result.clicks)}`
  );
  assert(result.inputValue === "", "buffer was not cleared after selecting the choice");
  assert(
    result.checked.join(",") === "false,true,false",
    `wrong choice ended up selected: ${result.checked}`
  );

  await page.close();
}

async function testDuolingoWordsPageImportButton(browser) {
  const page = await browser.newPage();
  await page.route("https://www.duolingo.com/practice-hub/words", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
        <h1>Practice your Ukrainian words</h1>
        <div><h2>3 words</h2></div>
        <ul id="words">
          <li><div><h3>кафе</h3><p>a cafe, a café, the cafe</p></div></li>
          <li><div><h3>сестри</h3><p>sisters, a sister, 's</p></div></li>
          <li id="load-more" role="button">Load more</li>
        </ul>
        <script>
          document.getElementById("load-more").addEventListener("click", () => {
            setTimeout(() => {
              const row = document.createElement("li");
              row.innerHTML = '<div><h3>та</h3><p>and, that</p></div>';
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

  await page.waitForSelector("#learned-word-replacer-duolingo-import-button");
  const placement = await page.evaluate(() => {
    const wrap = document.getElementById("learned-word-replacer-duolingo-import-wrap");
    window.__runtimeSendMessageResponder = (message) =>
      message.type === "LWR_IMPORT_DUOLINGO_WORDS"
        ? { ok: true, profileName: "Ukrainian", addedCount: 3, totalCount: 3 }
        : { ok: true };
    return {
      afterHeading: wrap.previousElementSibling?.textContent === "3 words"
    };
  });
  assert(placement.afterHeading, "import button was not placed after the words-count heading");

  await page.click("#learned-word-replacer-duolingo-import-button");
  await page.waitForFunction(() =>
    document
      .getElementById("learned-word-replacer-duolingo-import-status")
      ?.textContent.includes("Synced 3 words to Ukrainian")
  );

  const outcome = await page.evaluate(() => ({
    importMessages: (window.__runtimeMessages || []).filter(
      (message) => message.type === "LWR_IMPORT_DUOLINGO_WORDS"
    ),
    status: document.getElementById("learned-word-replacer-duolingo-import-status").textContent,
    buttonLabel: document.getElementById("learned-word-replacer-duolingo-import-button").textContent
  }));
  assert(outcome.importMessages.length === 1, "import did not send exactly one message");
  assert(
    outcome.importMessages[0].languageName === "Ukrainian",
    "import message lost the course language"
  );
  assert(
    outcome.importMessages[0].text ===
      "кафе - a cafe, a café, the cafe\nсестри - sisters, a sister, 's\nта - and, that",
    "import message did not carry every scraped word in export format"
  );
  assert(
    outcome.status.includes("3 new"),
    `status did not report the background stats: ${outcome.status}`
  );
  assert(outcome.buttonLabel === "Import to Sly Fox", "button label was not restored");

  await page.close();
}

async function testDuolingoWordsPageShowsPerWordEntryChips(browser) {
  const page = await browser.newPage();
  await page.route("https://www.duolingo.com/practice-hub/words", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
        <h1>Practice your Ukrainian words</h1>
        <div><h2>2 words</h2></div>
        <ul id="words">
          <li><div><div><h3>кафе</h3><p>a cafe, the cafe</p></div></div></li>
          <li><div><div><h3>невідоме</h3><p>unknown</p></div></div></li>
        </ul>
      `
    })
  );
  await page.goto("https://www.duolingo.com/practice-hub/words");
  await installHarness(page, {
    state: createState([
      {
        id: "e1",
        source: "cafe",
        target: "кафе",
        definition: "Duolingo meanings: a cafe",
        origin: "duolingo",
        enabled: true,
        createdAt: 1
      },
      {
        id: "e2",
        source: "coffee house",
        target: "кафе / кафетерій",
        definition: "Duolingo meanings: coffee house",
        origin: "duolingo",
        enabled: false,
        createdAt: 2
      },
      {
        id: "e3",
        source: "manual word",
        target: "кафе",
        origin: "manual",
        enabled: true,
        createdAt: 3
      }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => text
    }
  });

  await page.waitForSelector("[data-lwr-word-info]");
  const rows = await page.evaluate(() => {
    const strips = [...document.querySelectorAll("[data-lwr-word-info]")];
    return strips.map((strip) => ({
      chips: [...strip.querySelectorAll("button[data-lwr-entry-id]")].map((chip) => ({
        id: chip.getAttribute("data-lwr-entry-id"),
        label: chip.textContent
      })),
      note: strip.textContent
    }));
  });
  assert(rows.length === 2, `expected 2 info strips, got ${rows.length}`);
  assert(
    rows[0].chips.map((chip) => chip.id).join(",") === "e1,e2",
    `кафе row shows the wrong entries (manual must be excluded): ${JSON.stringify(rows[0].chips)}`
  );
  assert(
    rows[0].chips[1].label === "coffee house",
    "chips do not show the English source words"
  );
  assert(
    rows[1].note.includes("Not synced"),
    `unsynced word is missing its marker: ${rows[1].note}`
  );

  await page.click("button[data-lwr-entry-id='e2']");
  const written = await page.evaluate(() => (window.__storageWrites || []).at(-1));
  const toggled = written.learnedWordReplacerState.profiles[0].entries.find(
    (entry) => entry.id === "e2"
  );
  assert(toggled.enabled === true, "clicking a chip did not toggle the entry's enabled flag");
  await page.waitForFunction(() => {
    const chip = document.querySelector("button[data-lwr-entry-id='e2']");
    return chip && chip.parentElement.style.borderColor.includes("28, 176, 246");
  });

  await page.click("button[data-lwr-entry-remove='e1']");
  const afterRemove = await page.evaluate(() => (window.__storageWrites || []).at(-1));
  const remaining = afterRemove.learnedWordReplacerState.profiles[0].entries.map(
    (entry) => entry.id
  );
  assert(
    !remaining.includes("e1") && remaining.includes("e2") && remaining.includes("e3"),
    `chip ✕ did not remove exactly the one entry: ${remaining.join(",")}`
  );
  await page.waitForFunction(
    () => !document.querySelector("button[data-lwr-entry-id='e1']")
  );

  const deleteAll = await page.evaluate(() => {
    window.__confirmMessages = [];
    window.confirm = (message) => {
      window.__confirmMessages.push(message);
      return true;
    };
    document.getElementById("learned-word-replacer-duolingo-words-delete").click();
    return {
      confirmMessage: window.__confirmMessages[0] || "",
      remaining: (window.__storageWrites || [])
        .at(-1)
        .learnedWordReplacerState.profiles[0].entries.map((entry) => entry.id),
      status: document.getElementById("learned-word-replacer-duolingo-import-status")
        .textContent
    };
  });
  assert(
    deleteAll.confirmMessage.includes("1 synced Duolingo word"),
    `delete-all confirmation is wrong: ${deleteAll.confirmMessage}`
  );
  assert(
    deleteAll.remaining.join(",") === "e3",
    `delete-all should keep manual entries only: ${deleteAll.remaining.join(",")}`
  );
  assert(
    deleteAll.status.includes("Deleted 1 Duolingo word"),
    `delete-all status is wrong: ${deleteAll.status}`
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("[data-lwr-word-info]")].every((strip) =>
      strip.textContent.includes("Not synced")
    )
  );

  await page.close();
}

async function testDuolingoWordsPageManualTabManagesManualWords(browser) {
  const page = await browser.newPage();
  await page.route("https://www.duolingo.com/practice-hub/words", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
        <h1>Practice your Ukrainian words</h1>
        <section id="native-section">
          <div id="region"><div><h2>1 words</h2></div><div>Recently learned</div></div>
          <ul id="words">
            <li><div><div><h3>кафе</h3><p>a cafe</p></div></div></li>
          </ul>
        </section>
      `
    })
  );
  await page.goto("https://www.duolingo.com/practice-hub/words");
  await installHarness(page, {
    state: createState([
      {
        id: "d1",
        source: "cafe",
        target: "кафе",
        definition: "Duolingo meanings: a cafe",
        origin: "duolingo",
        enabled: true,
        createdAt: 1
      },
      {
        id: "m1",
        source: "tea",
        target: "чай",
        origin: "manual",
        enabled: true,
        createdAt: 2
      }
    ]),
    translator: {
      availability: async () => "available",
      translate: async (text) => text
    }
  });

  await page.waitForSelector("#learned-word-replacer-duolingo-words-tabs");
  const initial = await page.evaluate(() => ({
    tabsBeforeRegion:
      document.getElementById("learned-word-replacer-duolingo-words-tabs")
        .nextElementSibling === document.getElementById("region"),
    tabLabels: [...document.querySelectorAll("[data-lwr-words-tab]")].map((tab) =>
      tab.textContent
    ),
    listVisible: document.getElementById("words").style.display !== "none",
    panelHidden:
      document.getElementById("learned-word-replacer-duolingo-manual-panel").style.display ===
      "none"
  }));
  assert(initial.tabsBeforeRegion, "tab bar was not inserted before the words header row");
  assert(
    initial.tabLabels.join(",") === "Duolingo words,Sly Fox manual words",
    `wrong tab labels: ${initial.tabLabels.join(",")}`
  );
  assert(initial.listVisible && initial.panelHidden, "Duolingo list should show by default");

  await page.click("button[data-lwr-words-tab='manual']");
  const manualView = await page.evaluate(() => {
    const panel = document.getElementById("learned-word-replacer-duolingo-manual-panel");
    return {
      regionHidden: document.getElementById("region").style.display === "none",
      listHidden: document.getElementById("words").style.display === "none",
      panelVisible: panel.style.display !== "none",
      count: panel.querySelector("[data-lwr-manual-count]").textContent,
      rowTexts: [...panel.querySelectorAll("[data-lwr-manual-list] > div")].map((row) =>
        row.textContent.slice(0, 30)
      )
    };
  });
  assert(
    manualView.regionHidden && manualView.listHidden && manualView.panelVisible,
    "manual tab did not swap the native list for the panel"
  );
  assert(manualView.count === "1 manual word", `wrong manual count: ${manualView.count}`);
  const deleteAllAtTop = await page.evaluate(() => {
    const heading = document.querySelector("[data-lwr-manual-count]");
    const actionsRow = heading.nextElementSibling;
    return (
      Boolean(actionsRow.querySelector("button[data-lwr-manual-delete-all]")) &&
      actionsRow.querySelector("button[data-lwr-manual-delete-all]").textContent === "Delete all"
    );
  });
  assert(deleteAllAtTop, "manual delete-all is not in a row right under the count heading");
  assert(
    manualView.rowTexts.length === 1 && manualView.rowTexts[0].includes("чай"),
    `manual list should show only manual entries: ${JSON.stringify(manualView.rowTexts)}`
  );

  // Add a word through the form.
  await page.fill("[data-lwr-manual-source]", "bread");
  await page.fill("[data-lwr-manual-target]", "хліб");
  await page.click("[data-lwr-manual-submit]");
  const added = await page.evaluate(() => {
    const entries = (window.__storageWrites || []).at(-1).learnedWordReplacerState.profiles[0]
      .entries;
    return {
      entry: entries.find((candidate) => candidate.source === "bread"),
      sourceCleared: document.querySelector("[data-lwr-manual-source]").value === "",
      count: document.querySelector("[data-lwr-manual-count]").textContent
    };
  });
  assert(
    added.entry &&
      added.entry.origin === "manual" &&
      added.entry.target === "хліб" &&
      added.entry.languageCode === "uk" &&
      added.entry.enabled === true,
    `add form did not store a manual entry: ${JSON.stringify(added.entry)}`
  );
  assert(added.sourceCleared, "form did not clear after adding");
  assert(added.count === "2 manual words", `count did not update: ${added.count}`);

  // Edit the entry we just added.
  const newId = added.entry.id;
  await page.click(`button[data-lwr-manual-edit='${newId}']`);
  const editState = await page.evaluate(() => ({
    source: document.querySelector("[data-lwr-manual-source]").value,
    target: document.querySelector("[data-lwr-manual-target]").value,
    submitLabel: document.querySelector("[data-lwr-manual-submit]").textContent,
    cancelVisible:
      document.querySelector("[data-lwr-manual-cancel]").style.display !== "none"
  }));
  assert(
    editState.source === "bread" && editState.target === "хліб",
    "edit did not prefill the form"
  );
  assert(editState.submitLabel === "Save" && editState.cancelVisible, "edit mode UI missing");
  await page.fill("[data-lwr-manual-target]", "хлібчик");
  await page.click("[data-lwr-manual-submit]");
  const edited = await page.evaluate(
    (id) =>
      (window.__storageWrites || [])
        .at(-1)
        .learnedWordReplacerState.profiles[0].entries.find((entry) => entry.id === id),
    newId
  );
  assert(edited.target === "хлібчик", "edit did not save the new target");

  // Toggle and delete from the list.
  await page.click(`input[data-lwr-entry-id='${newId}']`);
  const toggledOff = await page.evaluate(
    (id) =>
      (window.__storageWrites || [])
        .at(-1)
        .learnedWordReplacerState.profiles[0].entries.find((entry) => entry.id === id).enabled,
    newId
  );
  assert(toggledOff === false, "checkbox did not pause the manual entry");
  await page.click(`button[data-lwr-entry-remove='${newId}']`);
  await page.waitForFunction(
    () => document.querySelector("[data-lwr-manual-count]").textContent === "1 manual word"
  );

  // Filter narrows the list.
  await page.fill("[data-lwr-manual-filter]", "zzz");
  await page.waitForFunction(() =>
    document
      .querySelector("[data-lwr-manual-list]")
      .textContent.includes("No manual words match")
  );
  await page.fill("[data-lwr-manual-filter]", "");

  // Delete all manual words spares Duolingo entries.
  await page.evaluate(() => {
    window.confirm = () => true;
  });
  await page.click("button[data-lwr-manual-delete-all]");
  const afterDeleteAll = await page.evaluate(() =>
    (window.__storageWrites || [])
      .at(-1)
      .learnedWordReplacerState.profiles[0].entries.map((entry) => entry.id)
  );
  assert(
    afterDeleteAll.join(",") === "d1",
    `delete-all-manual should keep Duolingo entries: ${afterDeleteAll.join(",")}`
  );

  await page.click("button[data-lwr-words-tab='duolingo']");
  const restored = await page.evaluate(() => ({
    listVisible: document.getElementById("words").style.display !== "none",
    regionVisible: document.getElementById("region").style.display !== "none",
    panelHidden:
      document.getElementById("learned-word-replacer-duolingo-manual-panel").style.display ===
      "none"
  }));
  assert(
    restored.listVisible && restored.regionVisible && restored.panelHidden,
    "switching back did not restore Duolingo's list"
  );

  await page.close();
}

async function testDuolingoLogoBadgeShowsExtensionIsActive(browser) {
  const page = await browser.newPage();
  await page.route("https://www.duolingo.com/learn", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
        <div id="sidebar">
          <div id="logo-wrap">
            <a href="/learn" style="display: block; width: 128px; height: 30px;"><img alt="duolingo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" style="width: 128px; height: 30px;"></a>
          </div>
          <nav><a data-test="home-nav" href="/learn">Home</a></nav>
        </div>
        <main><p>go with me.</p></main>
      `
    })
  );
  await page.goto("https://www.duolingo.com/learn");
  const initialState = createState([
    { id: "e1", source: "with", target: "з", enabled: true, createdAt: 1 }
  ]);
  await installHarness(page, {
    state: initialState,
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === "go with me." ? "йди з мною." : "")
    },
    config: { ukrainianLemmas: { з: ["з"] } }
  });

  await page.waitForFunction(
    () => document.querySelectorAll(".learned-word-replacer-token").length === 1
  );
  await page.waitForSelector("#learned-word-replacer-duolingo-logo-badge");
  const result = await page.evaluate(() => {
    const badge = document.getElementById("learned-word-replacer-duolingo-logo-badge");
    return {
      afterWordmark: badge.previousElementSibling === document.querySelector("#logo-wrap a"),
      text: badge.textContent,
      icon: badge.querySelector("img")?.src || "",
      mainText: document.querySelector("main").innerText
    };
  });

  assert(result.afterWordmark, "the badge was not placed directly after the Duolingo wordmark");
  assert(
    result.text === "withSly Fox",
    `the badge text was altered — likely replaced by the extension's own pass: ${JSON.stringify(result.text)}`
  );
  assert(result.icon.includes("icons/icon-48.png"), "the badge is missing the Sly Fox logo image");
  assert(result.mainText.includes("з me"), "page replacement stopped working around the badge");

  await page.evaluate((nextState) => {
    window.__storageChangeListener(
      { learnedWordReplacerState: { newValue: nextState } },
      "local"
    );
  }, { ...initialState, enabled: false });
  await page.waitForFunction(
    () => document.getElementById("learned-word-replacer-duolingo-logo-badge") === null
  );
  await page.close();
}

async function testVersionTwoStateMigratesToVersionThreeDefaults(browser) {
  const page = await browser.newPage();
  await page.route("https://www.duolingo.com/learn", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
        <div id="logo-wrap">
          <a href="/learn" style="display: block; width: 128px; height: 30px;"><img alt="duolingo" src="data:image/gif;base64,R0lGODlhAQABAAAAACw=" style="width: 128px; height: 30px;"></a>
        </div>
        <main><p>go with me.</p></main>
      `
    })
  );
  await page.goto("https://www.duolingo.com/learn");
  await installHarness(page, {
    state: {
      ...createState([{ id: "e1", source: "with", target: "з", enabled: true, createdAt: 1 }]),
      version: 2
    },
    translator: {
      availability: async () => "available",
      translate: async (text) => (text === "go with me." ? "йди з мною." : "")
    },
    config: { ukrainianLemmas: { з: ["з"] } }
  });

  await page.waitForFunction(
    () => window.__learnedWordReplacerDebug.getSnapshot().status === "excluded"
  );
  await page.waitForSelector("#learned-word-replacer-duolingo-logo-badge");
  const result = await page.evaluate(() => ({
    replacements: document.querySelectorAll(".learned-word-replacer-token").length,
    mainText: document.querySelector("main").innerText
  }));

  assert(
    result.replacements === 0 && result.mainText === "go with me.",
    `a migrated version-2 state still translated Duolingo's own page: ${JSON.stringify(result)}`
  );
  await page.close();
}

async function testDuolingoSettingsPageShowsExtensionPanel(browser) {
  const page = await browser.newPage();
  await page.route("https://www.duolingo.com/settings/account", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
        <div id="shared">
          <div id="navside"><ul>
            <li class="navitem"><a class="navlink" aria-current="page" href="/settings/account">Preferences</a></li>
            <li class="navitem"><a class="navlink" href="/settings/profile">Profile</a></li>
          </ul></div>
          <div id="pane" class="content-pane"><h1 class="pane-title">Preferences</h1><p>Duolingo preferences</p></div>
        </div>
      `
    })
  );
  await page.goto("https://www.duolingo.com/settings/account");
  await installHarness(page, {
    state: { ...createState([]), duolingoAutoContinue: true },
    translator: {
      availability: async () => "available",
      translate: async (text) => text
    }
  });

  await page.waitForSelector("#learned-word-replacer-duolingo-settings-link");
  const navState = await page.evaluate(() => {
    const link = document.getElementById("learned-word-replacer-duolingo-settings-link");
    return {
      label: link.textContent,
      copiedLinkClass: link.className,
      copiedItemClass: link.parentElement.className.replace(/\s*$/, ""),
      inNav: link.closest("ul") === document.querySelector("#navside ul")
    };
  });
  assert(navState.label === "Sly Fox Translator", "settings nav item has the wrong label");
  assert(
    navState.copiedLinkClass === "navlink" && navState.copiedItemClass.includes("navitem"),
    "settings nav item did not copy Duolingo's class names"
  );
  assert(navState.inNav, "settings nav item was not appended to Duolingo's settings nav");

  await page.click("#learned-word-replacer-duolingo-settings-link");
  await page.waitForSelector("#learned-word-replacer-duolingo-settings-panel");
  const panelState = await page.evaluate(() => {
    const panel = document.getElementById("learned-word-replacer-duolingo-settings-panel");
    const checkboxes = {};
    panel.querySelectorAll("input[data-lwr-setting]").forEach((checkbox) => {
      checkboxes[checkbox.getAttribute("data-lwr-setting")] = checkbox.checked;
    });
    return {
      copiedPaneClass: panel.className,
      paneHidden: document.getElementById("pane").style.display === "none",
      heading: panel.querySelector("h1").textContent,
      headingClass: panel.querySelector("h1").className,
      ariaCurrent: document
        .getElementById("learned-word-replacer-duolingo-settings-link")
        .getAttribute("aria-current"),
      duolingoAriaCurrent: document
        .querySelector("a[href='/settings/account']")
        .getAttribute("aria-current"),
      rowCount: panel.querySelectorAll("input[data-lwr-setting]").length,
      checkboxes
    };
  });
  assert(panelState.copiedPaneClass === "content-pane", "panel did not copy the pane class");
  assert(panelState.paneHidden, "Duolingo's own settings pane was not hidden");
  assert(panelState.heading === "Sly Fox Translator", "panel heading is wrong");
  assert(panelState.headingClass === "pane-title", "panel heading did not copy Duolingo's class");
  assert(panelState.ariaCurrent === "page", "our nav item was not marked current");
  assert(!panelState.duolingoAriaCurrent, "Duolingo's nav item kept aria-current");
  assert(panelState.rowCount === 8, `expected 8 setting rows, got ${panelState.rowCount}`);
  assert(
    panelState.checkboxes.enabled === true &&
      panelState.checkboxes.duolingoAutoContinue === true &&
      panelState.checkboxes.structureMode === false,
    `checkboxes do not reflect stored state: ${JSON.stringify(panelState.checkboxes)}`
  );

  await page.click(
    "#learned-word-replacer-duolingo-settings-panel input[data-lwr-setting='structureMode']"
  );
  const written = await page.evaluate(() => (window.__storageWrites || []).at(-1));
  assert(
    written && written.learnedWordReplacerState.structureMode === true,
    "toggling a setting did not write the new state to storage"
  );
  assert(
    written.learnedWordReplacerState.duolingoAutoContinue === true &&
      written.learnedWordReplacerState.profiles.length === 1,
    "settings write dropped other stored state"
  );

  const extraSections = await page.evaluate(() => {
    const panel = document.getElementById("learned-word-replacer-duolingo-settings-panel");
    const link = document.getElementById("learned-word-replacer-duolingo-settings-link");
    const buttonLabels = [...panel.querySelectorAll("button")].map((button) =>
      button.textContent.trim()
    );
    return {
      logoSrc: link.querySelector("img")?.getAttribute("src"),
      headings: [...panel.querySelectorAll("h2")].map((heading) => heading.textContent),
      buttonLabels,
      exclusionRows: panel.querySelector("[data-lwr-exclusion-list]").textContent
    };
  });
  assert(
    extraSections.logoSrc === "chrome-extension://test-extension/icons/icon-48.png",
    `nav item is missing the extension logo: ${extraSections.logoSrc}`
  );
  assert(
    extraSections.headings.join(",") === "Do not translate,Vocabulary files",
    `panel is missing its sections: ${extraSections.headings.join(",")}`
  );
  for (const label of [
    "Import file",
    "Import manual file",
    "Download all CSV",
    "Download manual CSV",
    "Delete all"
  ]) {
    assert(
      extraSections.buttonLabels.includes(label),
      `vocabulary files section is missing "${label}"`
    );
  }
  assert(
    extraSections.exclusionRows.includes("No excluded sites or pages"),
    "empty exclusion list is missing its empty state"
  );

  // Exclusions render from state and are removable from the panel.
  await page.evaluate(() => {
    window.__storageChangeListener(
      {
        learnedWordReplacerState: {
          newValue: {
            version: 3,
            enabled: true,
            currentProfileId: "uk-test",
            profiles: [
              { id: "uk-test", name: "Ukrainian Test", languageCode: "uk", entries: [] }
            ],
            doNotTranslate: { sites: ["www.example.com"], pages: [] }
          }
        }
      },
      "local"
    );
  });
  await page.waitForFunction(() =>
    document
      .querySelector("[data-lwr-exclusion-list]")
      ?.textContent.includes("www.example.com")
  );
  await page.click("[data-lwr-exclusion-list] button");
  const exclusionWrite = await page.evaluate(() => (window.__storageWrites || []).at(-1));
  assert(
    exclusionWrite.learnedWordReplacerState.doNotTranslate.sites.length === 0,
    "removing an exclusion did not write the pruned list"
  );

  const restored = await page.evaluate(() => {
    const profile = document.querySelector("a[href='/settings/profile']");
    profile.addEventListener("click", (event) => event.preventDefault());
    profile.click();
    return {
      panelGone: !document.getElementById("learned-word-replacer-duolingo-settings-panel"),
      paneVisible: document.getElementById("pane").style.display !== "none"
    };
  });
  assert(restored.panelGone, "panel was not removed when leaving our settings section");
  assert(restored.paneVisible, "Duolingo's settings pane was not restored");

  await page.close();
}

async function testDuolingoSettingsHashOpensPanelDirectly(browser) {
  const page = await browser.newPage();
  await page.route("https://www.duolingo.com/settings/account", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
        <div id="shared">
          <div id="navside"><ul>
            <li class="navitem"><a class="navlink" href="/settings/account">Preferences</a></li>
          </ul></div>
          <div id="pane" class="content-pane"><h1>Preferences</h1></div>
        </div>
      `
    })
  );
  await page.goto("https://www.duolingo.com/settings/account#sly-fox");
  await installHarness(page, {
    state: createState([]),
    translator: {
      availability: async () => "available",
      translate: async (text) => text
    }
  });

  await page.waitForSelector("#learned-word-replacer-duolingo-settings-panel");
  const opened = await page.evaluate(() => ({
    paneHidden: document.getElementById("pane").style.display === "none",
    hashCleared: !location.hash
  }));
  assert(opened.paneHidden, "#sly-fox hash did not open the panel directly");
  assert(opened.hashCleared, "the #sly-fox hash was not consumed after activation");

  await page.close();
}

async function testDuolingoMobileSettingsMenuGetsCardItemAndFullPagePanel(browser) {
  const page = await browser.newPage();
  // Mirrors the narrow-viewport /settings menu (2026-07-20): no h1, items are
  // card rows whose <a> nests the label in a div plus a chevron image.
  await page.route("https://www.duolingo.com/settings", (route) =>
    route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `
        <div id="content"><h2>Settings</h2>
        <nav id="menu"><section><h2>Account</h2><ul>
          <li class="navitem"><a class="navlink" href="/settings/account"><div>Preferences</div><img class="chevron" src="data:image/svg+xml,"></a></li>
        </ul></section></nav></div>
      `
    })
  );
  await page.goto("https://www.duolingo.com/settings");
  await installHarness(page, {
    state: createState([]),
    translator: {
      availability: async () => "available",
      translate: async (text) => text
    }
  });

  await page.waitForSelector("#learned-word-replacer-duolingo-settings-link");
  const item = await page.evaluate(() => {
    const link = document.getElementById("learned-word-replacer-duolingo-settings-link");
    return {
      labelDiv: link.querySelector("div")?.textContent,
      keptChevron: Boolean(link.querySelector("img.chevron")),
      linkClass: link.className
    };
  });
  assert(
    item.labelDiv === "Sly Fox Translator",
    `cloned item did not carry the label div: ${JSON.stringify(item)}`
  );
  assert(item.keptChevron, "cloned item lost the chevron image");
  assert(item.linkClass === "navlink", "cloned item lost Duolingo's link class");

  await page.click("#learned-word-replacer-duolingo-settings-link");
  await page.waitForSelector("#learned-word-replacer-duolingo-settings-panel");
  const swapped = await page.evaluate(() => ({
    menuHidden: document.getElementById("menu").style.display === "none",
    panelInContent:
      document.getElementById("learned-word-replacer-duolingo-settings-panel").parentElement ===
      document.getElementById("content"),
    backButton: [...document.querySelectorAll("#learned-word-replacer-duolingo-settings-panel button")]
      .some((button) => button.textContent.includes("Settings"))
  }));
  assert(swapped.menuHidden, "mobile menu nav was not hidden for the panel");
  assert(swapped.panelInContent, "panel was not inserted beside the hidden menu");
  assert(swapped.backButton, "mobile panel is missing its back control");

  const restored = await page.evaluate(() => {
    [...document.querySelectorAll("#learned-word-replacer-duolingo-settings-panel button")]
      .find((button) => button.textContent.includes("Settings"))
      .click();
    return {
      panelGone: !document.getElementById("learned-word-replacer-duolingo-settings-panel"),
      menuVisible: document.getElementById("menu").style.display !== "none"
    };
  });
  assert(restored.panelGone, "back control did not remove the panel");
  assert(restored.menuVisible, "back control did not restore the menu");

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

async function testCorruptedEntryPartsAreHealedOnLoad(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    // A corrupted import once stored every target/definition alternate five
    // times over; loading the popup must dedupe and persist the repair.
    const state = {
      version: 3,
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
              id: "dup",
              source: "million",
              target: "мільйони / мільйонів / мільйони / мільйонів / мільйони",
              definition:
                "Duolingo meanings: million, millions; Duolingo meanings: million; Duolingo meanings: million, millions",
              origin: "duolingo",
              enabled: true,
              createdAt: 1
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
            window.__healedState = JSON.parse(JSON.stringify(values.learnedWordReplacerState));
            if (callback) {
              callback();
            }
          }
        },
        onChanged: { addListener() {} }
      },
      tabs: {
        query(query, callback) {
          callback([]);
        }
      }
    };
  });

  await page.goto(POPUP_PAGE);
  await page.waitForFunction(() => window.__healedState);
  const entry = await page.evaluate(
    () => window.__healedState.profiles.find((profile) => profile.id === "uk").entries[0]
  );

  assert(
    entry.target === "мільйони / мільйонів",
    `duplicate target alternates were not healed on load: ${JSON.stringify(entry.target)}`
  );
  assert(
    entry.definition === "Duolingo meanings: million, millions; Duolingo meanings: million",
    `duplicate definition parts were not healed on load: ${JSON.stringify(entry.definition)}`
  );
  await page.close();
}

async function testPanicButtonTogglesEnabledSetting(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const state = {
      version: 3,
      enabled: true,
      showHighlights: true,
      currentProfileId: "uk",
      profiles: [
        {
          id: "uk",
          name: "Ukrainian",
          languageCode: "uk",
          entries: [{ id: "1", source: "it", target: "це", enabled: true, createdAt: 1 }]
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
          callback([]);
        },
        sendMessage(tabId, message, options, callback) {
          if (typeof options === "function") {
            callback = options;
          }
          callback();
        },
        create() {}
      },
      scripting: {
        executeScript() {}
      }
    };
  });
  await page.goto(POPUP_PAGE);
  await page.waitForSelector("#panic-toggle");

  const before = await page.evaluate(() => ({
    pressed: document.getElementById("panic-toggle").getAttribute("aria-pressed")
  }));
  assert(
    before.pressed === "false",
    `panic button did not reflect the enabled state: ${JSON.stringify(before)}`
  );

  await page.click("#panic-toggle");
  const afterOff = await page.evaluate(() => ({
    pressed: document.getElementById("panic-toggle").getAttribute("aria-pressed"),
    saved: window.__lastSavedPopupState?.enabled
  }));
  assert(
    afterOff.pressed === "true" && afterOff.saved === false,
    `panic button did not turn replacements off everywhere: ${JSON.stringify(afterOff)}`
  );

  await page.click("#panic-toggle");
  const afterOn = await page.evaluate(() => ({
    pressed: document.getElementById("panic-toggle").getAttribute("aria-pressed"),
    saved: window.__lastSavedPopupState?.enabled
  }));
  assert(
    afterOn.pressed === "false" && afterOn.saved === true,
    `panic button did not turn replacements back on: ${JSON.stringify(afterOn)}`
  );
  await page.close();
}

async function testPopupStatusPanel(browser) {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const state = {
      version: 3,
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

  await page.addInitScript(() => {
    window.close = () => {
      window.__popupClosed = true;
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
  assert(
    await page.isVisible("#open-duolingo-words"),
    "the Manage-words-on-Duolingo button should be visible"
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
  assert(before.settingsIcon, "settings button is not using the Lucide settings asset");
  assert(!await page.locator("#vocabulary-view-tab").count(), "vocabulary still has a dedicated view button");
  assert(
    await page.locator(".language-controls #settings-view-tab").count() === 1,
    "settings button was not moved next to language"
  );
  assert(
    (await page.evaluate(() => ({
      isSection: document.getElementById("do-not-translate-panel").tagName === "SECTION",
      noSummary: !document.querySelector("#do-not-translate-panel summary")
    }))).isSection,
    "Do not translate should be a plain always-visible section, not a disclosure"
  );
  assert(
    !(await page.locator("#do-not-translate-list").count()),
    "exclusion list should live on the Duolingo settings page now"
  );
  assert(
    !(await page.locator("#bulk-panel").count()),
    "import/export should live on the Duolingo settings page now"
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
  await page.click("#exclude-page");
  await page.waitForFunction(
    () => window.__lastSavedPopupState.doNotTranslate.pages.length === 0
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
  await page.click("#exclude-site");
  await page.waitForFunction(
    () => window.__lastSavedPopupState.doNotTranslate.sites.length === 0
  );
  await page.evaluate(() => window.__setPopupStatusMode("not-ready"));
  await page.click("#exclude-page");
  await page.waitForFunction(() => document.getElementById("runtime-retry")?.disabled === false);
  await page.click("#exclude-page");
  await page.waitForFunction(
    () => window.__lastSavedPopupState.doNotTranslate.pages.length === 0
  );
  await page.click("#settings-view-tab");
  assert(
    (await page.evaluate(() => window.__openedDuolingoUrl())) ===
      "https://www.duolingo.com/settings/account#sly-fox",
    "settings button did not open the Duolingo settings page"
  );
  assert(
    await page.evaluate(() => window.__popupClosed === true),
    "settings button did not close the popup after opening the settings page"
  );
  assert(await page.isVisible("#vocabulary-view"), "vocabulary view should stay visible");
  assert(
    Boolean(await page.evaluate(() => document.querySelector("#open-duolingo-words img[src='icons/duolingo-bird.png']"))),
    "Duolingo words button is missing the bird icon"
  );
  await page.click("#open-duolingo-words");
  assert(
    (await page.evaluate(() => window.__openedDuolingoUrl())) ===
      "https://www.duolingo.com/practice-hub/words",
    "words button did not open Duolingo's Words page"
  );
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

function testToolbarOpensPopup() {
  const manifest = JSON.parse(
    fs.readFileSync(path.resolve(__dirname, "../extension/manifest.json"), "utf8")
  );
  assert(
    manifest.action?.default_popup === "popup.html",
    "toolbar action does not open the popup"
  );
  assert(!manifest.side_panel, "side panel is still configured");
  assert(
    !manifest.permissions.includes("sidePanel"),
    "sidePanel permission is no longer needed"
  );
  const backgroundScript = fs.readFileSync(BACKGROUND_SCRIPT, "utf8");
  assert(
    !backgroundScript.includes("sidePanel"),
    "background still references the side panel"
  );
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
    await testStructureModeSurvivesWhitespaceOnlyTextNodes(browser);
    await testStructureModeRestoresOriginalMarkupWhenDisabled(browser);
    await testStructureModeKeepsUnalignedSentencesInEnglish(browser);
    await testStructureModeLeavesUiBlocksToNormalReplacement(browser);
    await testStructureModeHighlightsUnalignedWordsWithHoverGuess(browser);
    await testStructureModeFallsBackWhenTranslationIsMangled(browser);
    await testNormalModeIgnoresWeakAlignmentPairs(browser);
    await testPluralEnglishWordAlignsToSingularEntry(browser);
    await testUkrainianWordFamiliesDoNotMatchCompounds(browser);
    await testUkrainianPronounLemmaUsesChromeSurfaceForm(browser);
    await testRuntimeStatusCountsLiveReplacementSpans(browser);
    await testProcessedBlocksAreMarkedOnPage(browser);
    await testHoverTranslatesEnglishWord(browser);
    await testReplacementHoverShowsThreeDuolingoMeanings(browser);
    await testEnglishHoverShowsVocabularyAlternates(browser);
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
    await testDuolingoSyncLoadsMoreThanTwentyPages(browser);
    await testDuolingoTypeHintShowsNextLettersAndDeadEnds(browser);
    await testDuolingoListenMatchHidesWordsAndTypesPairs(browser);
    await testDuolingoAssistHidesChoicesAndTypesAnswer(browser);
    await testDuolingoWordsPageImportButton(browser);
    await testDuolingoWordsPageShowsPerWordEntryChips(browser);
    await testDuolingoWordsPageManualTabManagesManualWords(browser);
    await testDuolingoSettingsPageShowsExtensionPanel(browser);
    await testDuolingoMobileSettingsMenuGetsCardItemAndFullPagePanel(browser);
    await testDuolingoLogoBadgeShowsExtensionIsActive(browser);
    await testVersionTwoStateMigratesToVersionThreeDefaults(browser);
    await testDuolingoSettingsHashOpensPanelDirectly(browser);
    await testTranslatorBridgeCreatesInsideTrustedPageActivation(browser);
    await testCorruptedEntryPartsAreHealedOnLoad(browser);
    await testPanicButtonTogglesEnabledSetting(browser);
    await testPopupStatusPanel(browser);
    testVendoredLucideIcons();
    testUkrainianMorphologyDictionary();
    testImportCoreAppliesDuolingoImport();
    testFullExportDoesNotUseClickEventAsFilter();
    testBackgroundBadge();
    await testBackgroundRestoresOpenTabContentScripts();
    testBackgroundBadgeIgnoresMissingTabs();
    testToolbarOpensPopup();
    console.log("extension runtime tests passed");
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
