#!/bin/bash
# Screen LottieFiles animations for ones worth using.
#
#   scripts/screen-lottie.sh <url> [url ...]
#   scripts/screen-lottie.sh < urls.txt
#
# Takes .lottie asset URLs (see assets/characters/README.md for where those come
# from) and reports, for each: download size, how many RASTER images it carries,
# its layer breakdown and its length. The raster count is the column that
# matters -- anything above zero is a sprite sequence in a Lottie wrapper, not a
# vector rig, and will not scale or take a theme colour. Reject those.
#
# Survivors are left unpacked under output/lottie-screen/<n>/ so the animation
# JSON can be copied straight into extension/section/assets/characters/.
set -u
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36"
OUT="output/lottie-screen"
rm -rf "$OUT" && mkdir -p "$OUT"

urls=("$@")
if [ ${#urls[@]} -eq 0 ]; then
  while IFS= read -r line; do [ -n "$line" ] && urls+=("$line"); done
fi

printf "%-4s %-9s %-8s %-6s %-8s %s\n" "n" "bytes" "images" "secs" "layers" "kinds"
n=0
for u in "${urls[@]}"; do
  n=$((n + 1))
  d="$OUT/$n"
  mkdir -p "$d"
  curl -sS --compressed -A "$UA" -o "$d/a.lottie" "$u" 2>/dev/null || { echo "$n  download failed"; continue; }
  unzip -o -q "$d/a.lottie" -d "$d/u" 2>/dev/null
  python3 - "$d" "$n" "$u" <<'PY'
import collections, glob, io, json, os, sys
TYPES = {0: "precomp", 1: "solid", 2: "image", 3: "null", 4: "shape", 5: "text"}
d, n, url = sys.argv[1], sys.argv[2], sys.argv[3]
size = os.path.getsize(os.path.join(d, "a.lottie"))
imgs = len(glob.glob(os.path.join(d, "u", "images", "*")))
found = glob.glob(os.path.join(d, "u", "animations", "*.json"))
if not found:
    print("%-4s %-9d %-8s %-6s %-8s %s" % (n, size, "?", "?", "?", "(no animation json)"))
    raise SystemExit
a = json.load(io.open(found[0], encoding="utf-8"))
kinds = collections.Counter(TYPES.get(l.get("ty"), l.get("ty")) for l in a.get("layers", []))
flag = "  <-- RASTER, reject" if imgs else ""
print("%-4s %-9d %-8d %-6.1f %-8d %s%s"
      % (n, size, imgs, a["op"] / a["fr"], len(a.get("layers", [])), dict(kinds), flag))
io.open(os.path.join(d, "source.txt"), "w", encoding="utf-8").write(url + "\n")
PY
done
echo
echo "unpacked under $OUT/<n>/u/animations/*.json"
