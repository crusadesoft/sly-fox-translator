/*
 * Compact Morfologik CFSA2 reader for the Ukrainian morphology dictionary.
 * Derived from Morfologik FSA under the BSD 3-Clause License.
 * https://github.com/morfologik/morfologik-stemming
 */
(() => {
  const HEADER = "\\fsa";
  const VERSION = 0xc6;
  const TARGET_NEXT = 1 << 7;
  const LAST_ARC = 1 << 6;
  const FINAL_ARC = 1 << 5;
  const LABEL_INDEX_MASK = (1 << 5) - 1;
  const SEPARATOR = "+".charCodeAt(0);
  const REMOVE_EVERYTHING = 255;

  class UkrainianMorphology {
    constructor(bytes) {
      if (
        String.fromCharCode(...bytes.slice(0, 4)) !== HEADER ||
        bytes[4] !== VERSION
      ) {
        throw new Error("Unsupported Ukrainian morphology dictionary.");
      }

      const labelMappingSize = bytes[7];
      this.labelMapping = bytes.slice(8, 8 + labelMappingSize);
      this.arcs = bytes.slice(8 + labelMappingSize);
      this.encoder = new TextEncoder();
      this.decoder = new TextDecoder("utf-8");
      this.root = this.getDestinationNodeOffset(0);
    }

    lookup(word) {
      const normalized = String(word || "").trim().toLocaleLowerCase("uk");
      if (!normalized || normalized.includes("+")) {
        return [];
      }

      const source = this.encoder.encode(normalized);
      let node = this.root;
      for (const label of source) {
        const arc = this.getArc(node, label);
        if (!arc) {
          return [];
        }

        node = this.getDestinationNodeOffset(arc);
        if (!node) {
          return [];
        }
      }

      const separatorArc = this.getArc(node, SEPARATOR);
      if (!separatorArc || this.isArcFinal(separatorArc)) {
        return [];
      }

      const lemmas = new Set();
      for (const encodedForm of this.getFinalSequences(this.getDestinationNodeOffset(separatorArc))) {
        const separatorOffset = encodedForm.indexOf(SEPARATOR);
        if (separatorOffset < 1) {
          continue;
        }

        const lemma = this.decodeLemma(source, encodedForm.slice(0, separatorOffset));
        if (lemma) {
          lemmas.add(lemma);
        }
      }

      return Array.from(lemmas);
    }

    decodeLemma(source, encoded) {
      const trimCount = (encoded[0] - "A".charCodeAt(0)) & 0xff;
      const prefix =
        trimCount === REMOVE_EVERYTHING
          ? new Uint8Array()
          : source.slice(0, Math.max(0, source.length - trimCount));
      const result = new Uint8Array(prefix.length + encoded.length - 1);
      result.set(prefix);
      result.set(encoded.slice(1), prefix.length);
      return this.decoder.decode(result).toLocaleLowerCase("uk");
    }

    getFinalSequences(node) {
      const sequences = [];
      const walk = (currentNode, prefix) => {
        for (let arc = currentNode; arc; arc = this.getNextArc(arc)) {
          const nextPrefix = [...prefix, this.getArcLabel(arc)];
          if (this.isArcFinal(arc)) {
            sequences.push(Uint8Array.from(nextPrefix));
          }

          const target = this.getDestinationNodeOffset(arc);
          if (target) {
            walk(target, nextPrefix);
          }
        }
      };

      walk(node, []);
      return sequences;
    }

    getArc(node, label) {
      for (let arc = node; arc; arc = this.getNextArc(arc)) {
        if (this.getArcLabel(arc) === label) {
          return arc;
        }
      }

      return 0;
    }

    getArcLabel(arc) {
      const index = this.arcs[arc] & LABEL_INDEX_MASK;
      return index ? this.labelMapping[index] : this.arcs[arc + 1];
    }

    getNextArc(arc) {
      return this.isArcLast(arc) ? 0 : this.skipArc(arc);
    }

    getDestinationNodeOffset(arc) {
      if (this.isNextSet(arc)) {
        while (!this.isArcLast(arc)) {
          arc = this.getNextArc(arc);
        }

        return this.skipArc(arc);
      }

      return this.readVInt(arc + ((this.arcs[arc] & LABEL_INDEX_MASK) === 0 ? 2 : 1));
    }

    skipArc(offset) {
      const flag = this.arcs[offset++];
      if ((flag & LABEL_INDEX_MASK) === 0) {
        offset += 1;
      }

      return flag & TARGET_NEXT ? offset : this.skipVInt(offset);
    }

    readVInt(offset) {
      let byte = this.arcs[offset];
      let value = byte & 0x7f;
      for (let shift = 7; byte & 0x80; shift += 7) {
        byte = this.arcs[++offset];
        value |= (byte & 0x7f) << shift;
      }

      return value >>> 0;
    }

    skipVInt(offset) {
      while (this.arcs[offset++] & 0x80) {
        // Continue until the final variable-length byte.
      }

      return offset;
    }

    isArcFinal(arc) {
      return (this.arcs[arc] & FINAL_ARC) !== 0;
    }

    isArcLast(arc) {
      return (this.arcs[arc] & LAST_ARC) !== 0;
    }

    isNextSet(arc) {
      return (this.arcs[arc] & TARGET_NEXT) !== 0;
    }
  }

  globalThis.LWRUkrainianMorphology = {
    create(bytes) {
      return new UkrainianMorphology(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
    }
  };
})();
