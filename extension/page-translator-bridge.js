(() => {
  const REQUEST_CHANNEL = "LWR_TRANSLATOR_BRIDGE_REQUEST";
  const RESPONSE_CHANNEL = "LWR_TRANSLATOR_BRIDGE_RESPONSE";
  const ACTIVATION_CHANNEL = "LWR_TRANSLATOR_BRIDGE_ACTIVATION";
  const SOURCE = "learned-word-replacer";
  const CACHE_KEY = "__learnedWordReplacerTranslatorCache";
  const INSTALLED_KEY = "__learnedWordReplacerTranslatorBridgeInstalled";

  if (globalThis[INSTALLED_KEY]) {
    return;
  }

  globalThis[INSTALLED_KEY] = true;
  globalThis[CACHE_KEY] = globalThis[CACHE_KEY] || new Map();
  const armedTranslatorOptions = new Map();

  function getCacheKey(options) {
    return `${options.sourceLanguage || ""}:${options.targetLanguage || ""}`;
  }

  function postResponse(requestId, patch) {
    globalThis.postMessage(
      {
        source: SOURCE,
        channel: RESPONSE_CHANNEL,
        requestId,
        ...patch
      },
      "*"
    );
  }

  function serializeError(error) {
    return {
      name: error && error.name ? String(error.name) : "Error",
      message: error && error.message ? String(error.message) : "Chrome Translator failed."
    };
  }

  function postActivation(options, patch) {
    globalThis.postMessage(
      {
        source: SOURCE,
        channel: ACTIVATION_CHANNEL,
        sourceLanguage: String(options.sourceLanguage || ""),
        targetLanguage: String(options.targetLanguage || ""),
        ...patch
      },
      "*"
    );
  }

  function getTranslatorMetadata(translator) {
    return {
      inputQuota: Number(translator?.inputQuota),
      hasMeasureInputUsage: typeof translator?.measureInputUsage === "function"
    };
  }

  function beginTranslatorCreation(options, requestId = null) {
    if (!globalThis.Translator) {
      throw new Error("Chrome Translator API is not available.");
    }

    const key = getCacheKey(options);
    const cached = globalThis[CACHE_KEY].get(key);
    if (cached) {
      return cached;
    }

    const createPromise = globalThis.Translator.create({
      ...options,
      monitor(monitor) {
        if (!monitor || typeof monitor.addEventListener !== "function") {
          return;
        }

        monitor.addEventListener("downloadprogress", (event) => {
          const progress = {
            progress: true,
            loaded: Number(event.loaded || 0),
            total: Number(event.total || 1)
          };
          if (requestId) {
            postResponse(requestId, progress);
          } else {
            postActivation(options, progress);
          }
        });
      }
    });
    globalThis[CACHE_KEY].set(key, createPromise);

    Promise.resolve(createPromise).then(
      (translator) => {
        if (globalThis[CACHE_KEY].get(key) === createPromise) {
          globalThis[CACHE_KEY].set(key, translator);
        }
      },
      () => {
        if (globalThis[CACHE_KEY].get(key) === createPromise) {
          globalThis[CACHE_KEY].delete(key);
        }
      }
    );

    return createPromise;
  }

  async function getTranslator(options, requestId) {
    return await beginTranslatorCreation(options, requestId);
  }

  function armTranslatorForPageActivation(options) {
    const key = getCacheKey(options);
    const cached = globalThis[CACHE_KEY].get(key);

    if (cached) {
      Promise.resolve(cached).then(
        (translator) => {
          postActivation(options, {
            ok: true,
            value: getTranslatorMetadata(translator)
          });
        },
        () => {
          armedTranslatorOptions.set(key, { ...options });
        }
      );
      return;
    }

    armedTranslatorOptions.set(key, { ...options });
  }

  function prepareArmedTranslators(event) {
    if (!event.isTrusted || !armedTranslatorOptions.size) {
      return;
    }

    const pending = Array.from(armedTranslatorOptions.entries());
    armedTranslatorOptions.clear();

    for (const [key, options] of pending) {
      try {
        const translatorPromise = beginTranslatorCreation(options);
        Promise.resolve(translatorPromise).then(
          (translator) => {
            postActivation(options, {
              ok: true,
              value: getTranslatorMetadata(translator)
            });
          },
          (error) => {
            globalThis[CACHE_KEY].delete(key);
            armedTranslatorOptions.set(key, options);
            postActivation(options, {
              ok: false,
              error: serializeError(error)
            });
          }
        );
      } catch (error) {
        globalThis[CACHE_KEY].delete(key);
        armedTranslatorOptions.set(key, options);
        postActivation(options, {
          ok: false,
          error: serializeError(error)
        });
      }
    }
  }

  globalThis.addEventListener("pointerdown", prepareArmedTranslators, true);

  globalThis.addEventListener("message", async (event) => {
    if (event.source !== globalThis) {
      return;
    }

    const message = event.data;
    if (
      !message ||
      message.source !== SOURCE ||
      message.channel !== REQUEST_CHANNEL ||
      !message.requestId
    ) {
      return;
    }

    const requestId = message.requestId;
    const options = message.options || {};

    try {
      if (message.action === "availability") {
        if (!globalThis.Translator) {
          throw new Error("Chrome Translator API is not available.");
        }

        const value = await globalThis.Translator.availability(options);
        postResponse(requestId, { ok: true, value });
        return;
      }

      if (message.action === "armActivation") {
        if (!globalThis.Translator) {
          throw new Error("Chrome Translator API is not available.");
        }

        armTranslatorForPageActivation(options);
        postResponse(requestId, { ok: true, value: { armed: true } });
        return;
      }

      if (message.action === "create") {
        const translator = await getTranslator(options, requestId);
        postResponse(requestId, { ok: true, value: getTranslatorMetadata(translator) });
        return;
      }

      if (message.action === "translate") {
        const translator = await getTranslator(options, requestId);
        const value = await translator.translate(String(message.text || ""));
        postResponse(requestId, { ok: true, value });
        return;
      }

      if (message.action === "measureInputUsage") {
        const translator = await getTranslator(options, requestId);
        if (typeof translator.measureInputUsage !== "function") {
          postResponse(requestId, { ok: true, value: 0 });
          return;
        }

        const value = await translator.measureInputUsage(String(message.text || ""));
        postResponse(requestId, { ok: true, value });
      }
    } catch (error) {
      postResponse(requestId, {
        ok: false,
        error: serializeError(error)
      });
    }
  });
})();
