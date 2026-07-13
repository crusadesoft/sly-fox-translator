#!/usr/bin/env bash
# Reassembles the word-alignment model from the chunks committed in
# build-assets/alignment-model/ (the whole file exceeds GitHub's 100 MB limit).
# Run this once after cloning; the release workflow runs it before packaging.
set -euo pipefail

cd "$(dirname "$0")/.."

TARGET="extension/vendor/alignment-model/onnx/model_quantized.onnx"
EXPECTED_SHA256="e520bb74944b6afad186d5a4a2d3ce6d6bafde8c071c07baa82d3df66509f25a"

checksum() {
  shasum -a 256 "$1" 2>/dev/null || sha256sum "$1"
}

if [ -f "$TARGET" ] && checksum "$TARGET" | grep -q "$EXPECTED_SHA256"; then
  echo "Alignment model already assembled."
  exit 0
fi

mkdir -p "$(dirname "$TARGET")"
cat build-assets/alignment-model/model_quantized.onnx.part-* > "$TARGET"

if ! checksum "$TARGET" | grep -q "$EXPECTED_SHA256"; then
  echo "Assembled model checksum mismatch." >&2
  exit 1
fi

echo "Alignment model assembled at $TARGET."
