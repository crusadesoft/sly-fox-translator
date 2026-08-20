#!/usr/bin/env python3
"""Build extension/section/duolingo.css from the harvested Duolingo stylesheets.

The Sly Fox section page wears Duolingo's own classes, so it needs Duolingo's
own rules. Their site loads twenty stylesheets totalling ~450 KB; this pulls out
the part that our markup actually reaches and writes a single file.

What comes through:

  * every :root block, which is where their typography and sizing tokens live;
  * the whole of path-*.css, because that sheet is entirely about the unit we
    are cloning and matching it class-by-class would only risk missing a rule;
  * from the other sheets, any rule whose selector mentions a class our page
    uses, plus bare-element rules (their reset);
  * every @keyframes those rules animate, followed transitively.

Their colour tokens are not in any stylesheet -- Duolingo writes them as inline
custom properties on <html> at runtime -- so tokens.css is a separate harvest
and gets prepended here. Same for @font-face: their four faces are registered
through the FontFace API, so the two we need are declared here against the
vendored .woff2 files.

Run from the repository root:

    python3 scripts/build-duolingo-css.py
"""

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
KIT = ROOT / "build-assets" / "duolingo-kit"
CSS_DIR = KIT / "css"
OUT = ROOT / "extension" / "section" / "duolingo.css"

# The order Duolingo's own <link> tags appear in, which is the order the cascade
# expects. Anything in the kit but not listed here is a sheet the page pulls in
# for features we do not clone.
SHEET_ORDER = [
    "9951-b9cb3188.css",
    "app-fb80adb2.css",
    "1118-605e4df6.css",
    "2231-ee667168.css",
    "8186-605e4df6.css",
    "4800-10f90769.css",
    "9071-d035f2e5.css",
    "4769-628e48ee.css",
    "3596-131d5fdd.css",
    "2634-6b22725c.css",
    "5747-341b0c2d.css",
    "1131-3c748db3.css",
    "5275-8898b509.css",
    "7668-84c050df.css",
    "homePage-64ed3757.css",
    "path-1a98cc92.css",
    "4008-f6f5a263.css",
    "1327-4028784b.css",
    "7122-b4d34396.css",
    "4358-2c8b3ce2.css",
    "1469-063da6a2.css",
    "7459-1decc858.css",
    "9487-c883bbb9.css",
    "4051-ee2d9724.css",
]

# Taken wholesale rather than filtered: this sheet is the path, end to end. The
# lesson sheets are deliberately NOT in here -- they also carry leagues, gems and
# the streak calendar, none of which we draw.
VERBATIM_SHEETS = {"path-1a98cc92.css"}

# Files whose class names decide what we keep.
MARKUP_SOURCES = [
    ROOT / "extension" / "section" / "section.html",
    ROOT / "extension" / "section" / "section.js",
    ROOT / "extension" / "section" / "lesson.html",
    ROOT / "extension" / "section" / "lesson.js",
]

FONT_FACES = """@font-face {
  font-family: duolingo-sans;
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url(assets/duolingo-sans-400.woff2) format("woff2");
}
@font-face {
  font-family: duolingo-sans;
  font-style: normal;
  font-weight: 700;
  font-display: swap;
  src: url(assets/duolingo-sans-700.woff2) format("woff2");
}
"""


def split_blocks(css):
    """Split a stylesheet into top-level blocks, respecting nesting and strings."""
    blocks = []
    depth = 0
    start = 0
    i = 0
    quote = None
    while i < len(css):
        ch = css[i]
        if quote:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
        elif ch in "\"'":
            quote = ch
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                blocks.append(css[start : i + 1].strip())
                start = i + 1
        elif ch == ";" and depth == 0:
            # A statement at-rule such as @charset or @import.
            chunk = css[start : i + 1].strip()
            if chunk:
                blocks.append(chunk)
            start = i + 1
        i += 1
    tail = css[start:].strip()
    if tail:
        blocks.append(tail)
    return blocks


def block_head(block):
    brace = block.find("{")
    return block[:brace].strip() if brace != -1 else block.strip()


def block_body(block):
    brace = block.find("{")
    return block[brace + 1 : block.rfind("}")] if brace != -1 else ""


def defined_classes(css_text):
    return set(re.findall(r"\.(-?[_A-Za-z][\w-]*)", css_text))


def collect_used_classes(defined):
    """Every token in our markup that Duolingo also defines as a class.

    Deliberately not quote-aware. An earlier version paired up string literals
    and matched inside them, which quietly lost a whole class list the one time
    the quote pairing drifted -- and a missing rule here shows up as a button
    with no fill, not as an error. Scanning for bare tokens and keeping only
    those Duolingo actually styles cannot drift: the worst case is a few extra
    rules, which is the harmless direction to be wrong in.
    """
    used = set()
    for path in MARKUP_SOURCES:
        text = path.read_text(encoding="utf-8")
        for token in re.findall(r"[-\w]+", text):
            if token in defined:
                used.add(token)
    return used


def selector_matches(selector, used):
    classes = set(re.findall(r"\.(-?[_A-Za-z][\w-]*)", selector))
    if classes:
        return bool(classes & used)
    # No class in the selector at all: an element or :root rule, i.e. their
    # reset. Keep it, but not the sweeping attribute selectors that only exist
    # for widgets we do not render.
    return not selector.lstrip().startswith("[")


def filter_block(block, used, keyframes_wanted):
    head = block_head(block)

    if head.startswith("@keyframes") or head.startswith("@-webkit-keyframes"):
        return None  # Added later, once we know which are referenced.

    if head.startswith("@font-face"):
        return None  # Ours are declared explicitly.

    if head.startswith("@import") or head.startswith("@charset"):
        return None

    if head.startswith("@media") or head.startswith("@supports") or head.startswith("@layer"):
        inner = [filter_block(b, used, keyframes_wanted) for b in split_blocks(block_body(block))]
        inner = [b for b in inner if b]
        if not inner:
            return None
        return head + "{" + "".join(inner) + "}"

    if head.startswith("@"):
        return None

    selectors = [s for s in head.split(",") if s.strip()]
    kept = [s.strip() for s in selectors if selector_matches(s, used)]
    if not kept:
        return None

    body = block_body(block)
    note_keyframes(body, keyframes_wanted)
    return ",".join(kept) + "{" + body + "}"


# Their image paths come both ways: images/<folder>/<hash>.svg and a bare
# images/<hash>.svg. An earlier version required the folder and so skipped the
# bare ones in silence -- which is where the hint underlines live, the one CDN
# image the lesson actually renders.
CDN_URL_RE = re.compile(
    r"url\((['\"]?)https://d35aaqx5ub95lt\.cloudfront\.net/images/"
    r"(?:([\w/-]+)/)?([0-9a-f]{32})\.svg\1\)"
)


def localise_asset_urls(css):
    """Point any CDN image left in the bundle at its vendored copy.

    The page is served from the extension, so a stylesheet that still names
    cloudfront would reach out to Duolingo at render time. Most of these sit in
    rules our markup never matches -- they arrive with the verbatim path sheet
    -- but an unmatched rule today is a network call the first time someone adds
    the class it keys on.
    """
    assets = ROOT / "extension" / "section" / "assets"
    missing = []

    def swap(match):
        folder, digest = match.group(2), match.group(3)
        bucket = folder.split("/")[-1] if folder else "images"
        local = f"assets/{bucket}/{digest}.svg"
        if not (assets / bucket / f"{digest}.svg").is_file():
            missing.append(f"{folder + '/' if folder else ''}{digest}.svg")
            return match.group(0)
        return f"url({local})"

    css = CDN_URL_RE.sub(swap, css)
    for name in sorted(set(missing)):
        print(f"  WARNING: not vendored, still points at the CDN: {name}")
    return css


ANIMATION_RE = re.compile(r"animation(?:-name)?\s*:\s*([^;]+)", re.I)


def note_keyframes(body, wanted):
    for match in ANIMATION_RE.finditer(body):
        for token in re.split(r"[\s,]+", match.group(1).strip()):
            if re.fullmatch(r"-?[_A-Za-z][\w-]*", token) and token not in {
                "none",
                "infinite",
                "normal",
                "reverse",
                "alternate",
                "forwards",
                "backwards",
                "both",
                "running",
                "paused",
                "linear",
                "ease",
                "ease-in",
                "ease-out",
                "ease-in-out",
                "step-start",
                "step-end",
                "inherit",
                "initial",
                "unset",
            }:
                wanted.add(token)


def main():
    if not CSS_DIR.is_dir():
        sys.exit(f"missing harvest: {CSS_DIR}")

    kit_text = "\n".join(
        (CSS_DIR / name).read_text(encoding="utf-8", errors="replace")
        for name in SHEET_ORDER
        if (CSS_DIR / name).is_file()
    )
    used = collect_used_classes(defined_classes(kit_text))
    keyframes_wanted = set()
    keyframes_available = {}
    parts = []

    for name in SHEET_ORDER:
        path = CSS_DIR / name
        if not path.is_file():
            print(f"  skip (absent) {name}")
            continue
        css = path.read_text(encoding="utf-8", errors="replace")
        blocks = split_blocks(css)

        for block in blocks:
            head = block_head(block)
            if head.startswith("@keyframes") or head.startswith("@-webkit-keyframes"):
                key = head.split(None, 1)[1].strip() if " " in head else head
                keyframes_available.setdefault(key, block)

        if name in VERBATIM_SHEETS:
            kept = []
            for block in blocks:
                head = block_head(block)
                if head.startswith("@keyframes") or head.startswith("@-webkit-keyframes"):
                    continue
                if head.startswith("@font-face"):
                    continue
                note_keyframes(block, keyframes_wanted)
                kept.append(block)
            body = "\n".join(kept)
            print(f"  {name}: verbatim ({len(body)} bytes)")
        else:
            kept = [filter_block(b, used, keyframes_wanted) for b in blocks]
            kept = [b for b in kept if b]
            body = "\n".join(kept)
            print(f"  {name}: {len(kept)} rules ({len(body)} bytes)")

        if body:
            parts.append(f"/* --- {name} --- */\n{body}")

    # Keyframes, followed transitively in case one animation's rules start
    # another.
    emitted = set()
    pending = set(keyframes_wanted)
    keyframe_parts = []
    while pending:
        name = pending.pop()
        if name in emitted:
            continue
        emitted.add(name)
        block = keyframes_available.get(name)
        if not block:
            continue
        keyframe_parts.append(block)
        found = set()
        note_keyframes(block, found)
        pending |= found - emitted

    missing = sorted(n for n in emitted if n not in keyframes_available)
    print(f"  keyframes: {len(keyframe_parts)} emitted", f"({len(missing)} unresolved)" if missing else "")

    header = (
        "/* Generated by scripts/build-duolingo-css.py -- do not edit.\n"
        "   Duolingo's own rules, extracted from the stylesheets harvested into\n"
        "   build-assets/duolingo-kit/. Regenerate rather than patching. */\n"
    )
    tokens = (KIT / "tokens.css").read_text(encoding="utf-8")

    out = "\n".join([header, tokens, FONT_FACES] + parts + ["/* --- keyframes --- */"] + keyframe_parts)
    out = localise_asset_urls(out)
    OUT.write_text(out, encoding="utf-8")
    print(f"\nwrote {OUT.relative_to(ROOT)} ({len(out)} bytes, {len(used)} classes in markup)")


if __name__ == "__main__":
    main()
