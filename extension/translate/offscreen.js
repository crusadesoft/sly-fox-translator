// Hosts the on-device word-alignment model. Service workers cannot run
// onnxruntime-web (its wasm loader needs dynamic import()), so the background
// worker proxies alignment requests to this offscreen document.
import {
  AutoModel,
  AutoTokenizer,
  Tensor,
  env as transformersEnv
} from "./vendor/transformers/transformers.min.js";

const WORD_ALIGNMENT_RUN_REQUEST = "LWR_ALIGN_WORDS_RUN";
const ALIGNMENT_MODEL_ID = "alignment-model";
const ALIGNMENT_SOFTMAX_THRESHOLD = 1e-3;
const MAX_ALIGNMENT_SUBWORDS = 512;
const WEAK_ALIGNMENT_CANDIDATES_PER_WORD = 3;

let alignmentModelPromise = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== WORD_ALIGNMENT_RUN_REQUEST) {
    return false;
  }

  alignWords(String(message.source || ""), String(message.translated || ""))
    .then((pairs) => sendResponse({ ok: true, pairs }))
    .catch((error) =>
      sendResponse({ ok: false, error: error?.message || "Word alignment failed." })
    );
  return true;
});

function getAlignmentModel() {
  if (!alignmentModelPromise) {
    alignmentModelPromise = loadAlignmentModel().catch((error) => {
      alignmentModelPromise = null;
      throw error;
    });
  }

  return alignmentModelPromise;
}

async function loadAlignmentModel() {
  transformersEnv.localModelPath = chrome.runtime.getURL("vendor");
  transformersEnv.allowLocalModels = true;
  transformersEnv.allowRemoteModels = false;
  transformersEnv.useBrowserCache = false;
  transformersEnv.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("vendor/transformers/");
  transformersEnv.backends.onnx.wasm.numThreads = 1;

  const tokenizer = await AutoTokenizer.from_pretrained(ALIGNMENT_MODEL_ID);
  const model = await AutoModel.from_pretrained(ALIGNMENT_MODEL_ID, { dtype: "q8" });
  const specialIds = tokenizer.encode("");

  return {
    tokenizer,
    model,
    clsId: specialIds[0],
    sepId: specialIds[specialIds.length - 1]
  };
}

function getAlignmentWords(text) {
  const words = [];
  const pattern = /[\p{L}\p{N}\p{M}_]+(?:['’ʼ][\p{L}\p{N}\p{M}_]+)*/gu;
  let match;

  while ((match = pattern.exec(text))) {
    words.push({ value: match[0], start: match.index, end: match.index + match[0].length });
  }

  return words;
}

function encodeAlignmentWords(runtime, words) {
  const ids = [runtime.clsId];
  const wordIndexOfSubword = [-1];

  for (let wordIndex = 0; wordIndex < words.length; wordIndex += 1) {
    for (const id of runtime.tokenizer.encode(words[wordIndex].value, { add_special_tokens: false })) {
      ids.push(id);
      wordIndexOfSubword.push(wordIndex);
    }
  }

  ids.push(runtime.sepId);
  wordIndexOfSubword.push(-1);
  return { ids, wordIndexOfSubword };
}

async function embedAlignmentTokens(runtime, ids) {
  const shape = [1, ids.length];
  const output = await runtime.model({
    input_ids: new Tensor("int64", BigInt64Array.from(ids.map((id) => BigInt(id))), shape),
    attention_mask: new Tensor("int64", BigInt64Array.from(ids.map(() => 1n)), shape),
    token_type_ids: new Tensor("int64", BigInt64Array.from(ids.map(() => 0n)), shape)
  });
  const hidden = output.last_hidden_state;
  const [, sequenceLength, dimension] = hidden.dims;
  const rows = [];

  for (let index = 0; index < sequenceLength; index += 1) {
    rows.push(hidden.data.subarray(index * dimension, (index + 1) * dimension));
  }

  return rows;
}

function softmaxRows(matrix) {
  return matrix.map((row) => {
    const max = Math.max(...row);
    const exponents = row.map((value) => Math.exp(value - max));
    const sum = exponents.reduce((total, value) => total + value, 0);
    return exponents.map((value) => value / sum);
  });
}

function transposeMatrix(matrix) {
  return matrix[0].map((_, column) => matrix.map((row) => row[column]));
}

async function alignWords(sourceText, translatedText) {
  if (!sourceText.trim() || !translatedText.trim()) {
    return [];
  }

  const runtime = await getAlignmentModel();
  const sourceWords = getAlignmentWords(sourceText);
  const translatedWords = getAlignmentWords(translatedText);
  if (!sourceWords.length || !translatedWords.length) {
    return [];
  }

  const source = encodeAlignmentWords(runtime, sourceWords);
  const translated = encodeAlignmentWords(runtime, translatedWords);
  if (source.ids.length > MAX_ALIGNMENT_SUBWORDS || translated.ids.length > MAX_ALIGNMENT_SUBWORDS) {
    return [];
  }

  const sourceEmbeddings = await embedAlignmentTokens(runtime, source.ids);
  const translatedEmbeddings = await embedAlignmentTokens(runtime, translated.ids);

  const similarity = [];
  for (let i = 1; i < source.ids.length - 1; i += 1) {
    const row = [];
    for (let j = 1; j < translated.ids.length - 1; j += 1) {
      let dot = 0;
      const a = sourceEmbeddings[i];
      const b = translatedEmbeddings[j];
      for (let d = 0; d < a.length; d += 1) {
        dot += a[d] * b[d];
      }
      row.push(dot);
    }
    similarity.push(row);
  }

  const sourceToTranslated = softmaxRows(similarity);
  const translatedToSource = transposeMatrix(softmaxRows(transposeMatrix(similarity)));
  const bestByWordPair = new Map();

  for (let i = 0; i < similarity.length; i += 1) {
    for (let j = 0; j < similarity[0].length; j += 1) {
      const sourceWord = sourceWords[source.wordIndexOfSubword[i + 1]];
      const translatedWord = translatedWords[translated.wordIndexOfSubword[j + 1]];
      const key = `${sourceWord.start}:${translatedWord.start}`;
      const score = sourceToTranslated[i][j] * translatedToSource[i][j];
      const confident =
        sourceToTranslated[i][j] > ALIGNMENT_SOFTMAX_THRESHOLD &&
        translatedToSource[i][j] > ALIGNMENT_SOFTMAX_THRESHOLD;
      const existing = bestByWordPair.get(key);

      if (!existing || existing.score < score) {
        bestByWordPair.set(key, {
          srcStart: sourceWord.start,
          srcEnd: sourceWord.end,
          tgtStart: translatedWord.start,
          tgtEnd: translatedWord.end,
          score,
          confident: Boolean(existing?.confident) || confident
        });
      } else if (confident && !existing.confident) {
        existing.confident = true;
      }
    }
  }

  const pairs = [];
  const coveredTranslatedStarts = new Set();

  for (const record of bestByWordPair.values()) {
    if (record.confident) {
      pairs.push({
        srcStart: record.srcStart,
        srcEnd: record.srcEnd,
        tgtStart: record.tgtStart,
        tgtEnd: record.tgtEnd,
        score: record.score
      });
      coveredTranslatedStarts.add(record.tgtStart);
    }
  }

  // Translated words without a confident pair still get their best-guess
  // English candidates, flagged weak so callers can decide whether coverage
  // or precision matters for them.
  const weakByTranslatedStart = new Map();
  for (const record of bestByWordPair.values()) {
    if (record.confident || coveredTranslatedStarts.has(record.tgtStart)) {
      continue;
    }

    if (!weakByTranslatedStart.has(record.tgtStart)) {
      weakByTranslatedStart.set(record.tgtStart, []);
    }
    weakByTranslatedStart.get(record.tgtStart).push(record);
  }

  for (const records of weakByTranslatedStart.values()) {
    records.sort((a, b) => b.score - a.score);
    for (const record of records.slice(0, WEAK_ALIGNMENT_CANDIDATES_PER_WORD)) {
      pairs.push({
        srcStart: record.srcStart,
        srcEnd: record.srcEnd,
        tgtStart: record.tgtStart,
        tgtEnd: record.tgtEnd,
        score: record.score,
        weak: true
      });
    }
  }

  return pairs.sort((a, b) => a.srcStart - b.srcStart || a.tgtStart - b.tgtStart);
}
