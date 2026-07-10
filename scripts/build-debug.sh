#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SDK_DIR="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Library/Android/sdk}}"
PLATFORM_DIR="$SDK_DIR/platforms/android-36"
BUILD_TOOLS="$SDK_DIR/build-tools/35.0.0"
ANDROID_JAR="$PLATFORM_DIR/android.jar"
OUT_DIR="$ROOT_DIR/build"
RES_ZIP="$OUT_DIR/compiled-resources.zip"
GENERATED_DIR="$OUT_DIR/generated"
CLASSES_DIR="$OUT_DIR/classes"
CLASSES_JAR="$OUT_DIR/classes.jar"
DEX_DIR="$OUT_DIR/dex"
UNSIGNED_APK="$OUT_DIR/language-overlay-unsigned.apk"
ALIGNED_APK="$OUT_DIR/language-overlay-aligned.apk"
SIGNED_APK="$OUT_DIR/language-overlay-debug.apk"

rm -rf "$OUT_DIR"
mkdir -p "$GENERATED_DIR" "$CLASSES_DIR" "$DEX_DIR"

"$BUILD_TOOLS/aapt2" compile --dir "$ROOT_DIR/app/src/main/res" -o "$RES_ZIP"
"$BUILD_TOOLS/aapt2" link \
  -I "$ANDROID_JAR" \
  --manifest "$ROOT_DIR/app/src/main/AndroidManifest.xml" \
  --java "$GENERATED_DIR" \
  --min-sdk-version 26 \
  --target-sdk-version 36 \
  -o "$UNSIGNED_APK" \
  "$RES_ZIP"

JAVA_SOURCES=()
while IFS= read -r -d '' source_file; do
  JAVA_SOURCES+=("$source_file")
done < <(find "$ROOT_DIR/app/src/main/java" "$GENERATED_DIR" -name '*.java' -print0)

javac \
  -source 8 \
  -target 8 \
  -encoding UTF-8 \
  -classpath "$ANDROID_JAR" \
  -d "$CLASSES_DIR" \
  "${JAVA_SOURCES[@]}"

(cd "$CLASSES_DIR" && jar cf "$CLASSES_JAR" .)

"$BUILD_TOOLS/d8" \
  --lib "$ANDROID_JAR" \
  --min-api 26 \
  --output "$DEX_DIR" \
  "$CLASSES_JAR"

(cd "$DEX_DIR" && zip -q -j "$UNSIGNED_APK" classes.dex)
"$BUILD_TOOLS/zipalign" -f 4 "$UNSIGNED_APK" "$ALIGNED_APK"
"$BUILD_TOOLS/apksigner" sign \
  --ks "$HOME/.android/debug.keystore" \
  --ks-pass pass:android \
  --key-pass pass:android \
  --out "$SIGNED_APK" \
  "$ALIGNED_APK"

"$BUILD_TOOLS/apksigner" verify "$SIGNED_APK"
echo "$SIGNED_APK"
