// Chrome's Translator API is only reachable from the page's own world, not
// from a content script's isolated one. Requests go out over postMessage to
// page-translator-bridge.js, which lives in the page world, and the answers
// come back the same way.
//
// The object this hands back looks like the real Translator API, so translator.js
// cannot tell the difference between the bridge and the genuine article the
// test harness injects.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const TRANSLATOR_BRIDGE_REQUEST_CHANNEL = "LWR_TRANSLATOR_BRIDGE_REQUEST";
  const TRANSLATOR_BRIDGE_RESPONSE_CHANNEL = "LWR_TRANSLATOR_BRIDGE_RESPONSE";

  function createBridgeTranslatorApi() {
    return {
      availability(options) {
        return requestTranslatorBridge("availability", { options });
      },
      armActivation(options) {
        return requestTranslatorBridge("armActivation", { options });
      },
      async create(options = {}) {
        const { monitor, ...translatorOptions } = options;
        let progressListener = null;

        if (typeof monitor === "function") {
          monitor({
            addEventListener(type, listener) {
              if (type === "downloadprogress" && typeof listener === "function") {
                progressListener = listener;
              }
            }
          });
        }

        const metadata = await requestTranslatorBridge(
          "create",
          { options: translatorOptions },
          (progress) => {
            if (progressListener) {
              progressListener(progress);
            }
          }
        );

        const translator = {
          inputQuota: Number(metadata?.inputQuota),
          translate(text) {
            return requestTranslatorBridge("translate", {
              options: translatorOptions,
              text
            });
          }
        };

        if (metadata?.hasMeasureInputUsage) {
          translator.measureInputUsage = (text) =>
            requestTranslatorBridge("measureInputUsage", {
              options: translatorOptions,
              text
            });
        }

        return translator;
      }
    };
  }

  function requestTranslatorBridge(action, payload, progressCallback = null) {
    const requestId = LWR.createId();

    return new Promise((resolve, reject) => {
      function cleanup() {
        globalThis.removeEventListener("message", handleMessage);
      }

      function handleMessage(event) {
        if (event.source !== globalThis) {
          return;
        }

        const message = event.data;
        if (
          !message ||
          message.source !== LWR.MESSAGE_SOURCE ||
          message.channel !== TRANSLATOR_BRIDGE_RESPONSE_CHANNEL ||
          message.requestId !== requestId
        ) {
          return;
        }

        if (message.progress) {
          if (typeof progressCallback === "function") {
            progressCallback({
              loaded: Number(message.loaded || 0),
              total: Number(message.total || 1)
            });
          }
          return;
        }

        cleanup();
        if (message.ok) {
          resolve(message.value);
          return;
        }

        reject(new Error(message.error?.message || "Chrome Translator failed."));
      }

      globalThis.addEventListener("message", handleMessage);
      globalThis.postMessage(
        {
          source: LWR.MESSAGE_SOURCE,
          channel: TRANSLATOR_BRIDGE_REQUEST_CHANNEL,
          requestId,
          action,
          ...payload
        },
        "*"
      );
    });
  }

  // Reached for by other modules.
  Object.assign(LWR, { createBridgeTranslatorApi });
})();
