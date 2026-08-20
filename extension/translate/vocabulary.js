// Compiling saved entries into the two lookup tables a pass needs: the target
// candidates to search a translation for, and the English terms to align them
// back against.
//
// The word lists live here too, because they exist to decide which English
// terms are distinctive enough to align on.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const ALIGNMENT_PREFIX_STOPWORDS = new Set(["a", "an", "the", "to"]);
  const ALIGNMENT_COMMON_WORDS = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "been",
    "being",
    "but",
    "by",
    "did",
    "do",
    "does",
    "for",
    "from",
    "had",
    "has",
    "have",
    "in",
    "is",
    "not",
    "of",
    "on",
    "or",
    "that",
    "the",
    "this",
    "to",
    "used",
    "was",
    "were",
    "with"
  ]);

  // Rebuilt by compileEntries whenever the profile or its entries change, and
  // read by every module that has to decide what a translation earned.
  LWR.compiledEntries = [];
  // Vocabulary is stable between recompiles, so each entry's target is split
  // into words once instead of on every sentence.
  const candidateTokenValueCache = new Map();

  function compileEntries() {
    candidateTokenValueCache.clear();
    LWR.compiledEntries = LWR.getCurrentEntries()
      .filter((entry) => LWR.state.enabled && entry.enabled)
      .map((entry) => {
        const targetCandidates = buildTargetCandidates(entry.target);
        const sourceCandidates = buildSourceAlignmentCandidates(entry);
        return {
          ...entry,
          targetCandidates,
          sourceCandidates
        };
      })
      .filter((entry) => entry.targetCandidates.length)
      .sort(
        (a, b) => getLongestTargetLength(b) - getLongestTargetLength(a) || a.createdAt - b.createdAt
      );

  }

  function getLongestTargetLength(entry) {
    return Math.max(...entry.targetCandidates.map((candidate) => candidate.length), 0);
  }

  function buildTargetCandidates(target) {
    const targetText = String(target || "").trim();
    const splitCandidates = targetText
      .split(/\s+(?:\/|;)\s+|\s*;\s*/)
      .map((candidate) => candidate.trim())
      .filter(Boolean);
    const candidates = hasTargetAlternativeSeparator(targetText) ? splitCandidates : [targetText];
    const seen = new Set();

    return candidates.filter((candidate) => {
      const key = candidate.toLocaleLowerCase();
      if (seen.has(key)) {
        return false;
      }

      seen.add(key);
      return true;
    });
  }

  function hasTargetAlternativeSeparator(target) {
    return /\s\/\s|;/.test(String(target || ""));
  }

  function buildSourceAlignmentCandidates(entry) {
    const byValue = new Map();

    for (const term of getEnglishAlignmentTerms(entry)) {
      const candidate = createSourceAlignmentCandidate(term);
      if (!candidate) {
        continue;
      }

      const key = candidate.value.toLocaleLowerCase();
      const existing = byValue.get(key);
      if (!existing || candidate.score > existing.score) {
        byValue.set(key, candidate);
      }
    }

    return Array.from(byValue.values()).sort(
      (a, b) => b.score - a.score || b.value.length - a.value.length
    );
  }

  function getEnglishAlignmentTerms(entry) {
    const terms = [];
    addEnglishAlignmentTerms(terms, entry.source, "source");
    addEnglishAlignmentTerms(terms, entry.definition, "definition");
    return terms;
  }

  function addEnglishAlignmentTerms(terms, text, origin) {
    const cleanedText = cleanEnglishAlignmentText(text);
    if (!cleanedText) {
      return;
    }

    for (const part of cleanedText.split(/\s*(?:,|;|\n|\s\/\s)\s*/u)) {
      const value = cleanEnglishAlignmentTerm(part);
      if (value) {
        terms.push({ value, origin });
      }
    }
  }

  function cleanEnglishAlignmentText(text) {
    return String(text || "")
      .replace(/^duolingo meanings:\s*/iu, "")
      .replace(/\s+/gu, " ")
      .trim();
  }

  function cleanEnglishAlignmentTerm(text) {
    return String(text || "")
      .replace(/\([^)]*\)/gu, " ")
      .replace(/^[\s"'“”‘’()[\]{}<>]+|[\s"'“”‘’()[\]{}<>]+$/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
  }

  function createSourceAlignmentCandidate(term) {
    const value = stripLeadingAlignmentStopwords(term.value);
    if (!value) {
      return null;
    }

    const tokens = LWR.getReplaceableSourceTokens(value);
    if (!tokens.length) {
      return null;
    }

    const exactSingleSourceTerm = term.origin === "source" && tokens.length === 1;
    const usefulTokens = tokens.filter((token) =>
      isUsefulAlignmentToken(token.value, exactSingleSourceTerm)
    );

    if (!usefulTokens.length) {
      return null;
    }

    return {
      value,
      origin: term.origin,
      tokenCount: tokens.length,
      score:
        (term.origin === "source" ? 120 : 90) +
        Math.min(value.length, 40) +
        (tokens.length > 1 ? 25 : 0)
    };
  }

  function stripLeadingAlignmentStopwords(text) {
    const tokens = LWR.getReplaceableSourceTokens(text);
    if (tokens.length <= 1) {
      return text;
    }

    let start = 0;
    while (
      start < tokens.length - 1 &&
      ALIGNMENT_PREFIX_STOPWORDS.has(tokens[start].value.toLocaleLowerCase())
    ) {
      start += 1;
    }

    return text.slice(tokens[start].start).trim();
  }

  function isUsefulAlignmentToken(value, allowCommonWord) {
    const normalized = String(value || "").trim().toLocaleLowerCase();
    if (!/\p{L}/u.test(normalized)) {
      return false;
    }

    if (allowCommonWord) {
      return true;
    }

    return normalized.length > 2 && !ALIGNMENT_COMMON_WORDS.has(normalized);
  }

  // Reached for by other modules.
  Object.assign(LWR, {
    ALIGNMENT_PREFIX_STOPWORDS,
    ALIGNMENT_COMMON_WORDS,
    candidateTokenValueCache,
    compileEntries,
    cleanEnglishAlignmentText
  });
})();
