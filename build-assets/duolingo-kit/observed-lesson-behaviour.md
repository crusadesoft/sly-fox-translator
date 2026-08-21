# Duolingo practice session — observed behavior & CSS (Ukrainian, GLOBAL_PRACTICE)

## Session JSON
`POST https://www.duolingo.com/2023-05-23/sessions` returns `{id, learningLanguage, fromLanguage,
type: "GLOBAL_PRACTICE", challenges: [...]}`.

Challenge types seen so far: `listenMatch`, `assist`, `translate` (word bank).

### listenMatch
```
{ type:"listenMatch", id, pairs:[{tts:<mp3 url>, translation:"game", learningWord:"гра"}, ...] }
```
### assist  (English prompt -> pick the target-language word)
```
{ type:"assist", prompt:"too", choices:["щоночі","надто","часто"], correctIndex:1,
  options:[{text, tts}], character:{...lottie idle/correct/incorrect animations...} }
```
### translate (word bank)
```
{ type:"translate", prompt:"Бути чи не бути?", correctSolutions:["To be, or not to be?"],
  correctTokens:[...], wrongTokens:[...], choices:[{text}] }
```

## Global CSS facts
- Font: `duolingo-sans, sans-serif`. Body text weight 500, headings 700.
- Exercise `<h1>`: 700 32px, color #3c3c3c-ish; challenge column width 600px, centered.
- Footer bar height 140px.

## listenMatch tile states  (58px tall, 255px wide, radius 12px, padding 12px 30px 12px 58px)
| state | inner bg | text |
|---|---|---|
| default | transparent | #4b4b4b |
| selected | #ddf4ff | #1899d6 |
| wrong match (≈600ms flash, then reverts) | #ffdfe0 | #4b4b4b |
| matched | dimmed/greyed out, stays in place (not removed) |

Wrong matches inside listenMatch flash pink but do NOT fail the challenge — final blame was
"Awesome!" despite 3 mismatches.

Tiles carry `data-test="<translation>-challenge-tap-token"` and are numbered 1-8 (keyboard 1-8).
Bottom-left has a `data-test="player-skip"` "CAN'T LISTEN NOW" button on audio exercises.

## Correct-answer footer ("blame blame-correct")
- footer bg: **#d7ffb8**
- headline h2 "Awesome!": color **#58a700**, font 700 24px/30px duolingo-sans
- white circle + green check svg on the left
- "REPORT" button with flag icon under the headline
- CONTINUE button: 50px tall, 150px wide, radius 16px, uppercase, 700 17px, letter-spacing .8px, white text

## Incorrect-answer footer ("blame blame-incorrect")
- footer bg: **#ffdfe0**
- h2 "Correct solution:" color **#ea2b2b**, 700 24px/30px; solution text below in same red,
  wrapped in `<div dir="ltr" lang="uk">`
- white circle + red X svg, REPORT button, CONTINUE button red
- The learner's wrong choice/tokens are NOT recoloured red — they stay in their selected state.

## assist / gapFill choice rows (60px tall, radius 12px)
| state | border | text |
|---|---|---|
| idle | 2px solid #e5e5e5 | #4b4b4b (badge #afafaf) |
| selected | 2px solid #84d8ff | #1899d6 |
| correct | 2px solid #a5ed6e | #58a700, bg #d7ffb8 |

All Duolingo buttons use a 4px `border-bottom-width` for the 3D lip (not box-shadow).

## Combo indicator
"N IN A ROW" above the progress bar: #58cc02, 700 16px/16px, uppercase, letter-spacing .64px.

## Praise headlines are randomised
Seen: "Awesome!", "Great job!", "Good job!" (green #58a700).

## Hint underline (the thing Legendary removes)
Duolingo does NOT use border-bottom or text-decoration. It is a repeating **background image**:
```css
background-image: url(https://d35aaqx5ub95lt.cloudfront.net/images/06f94a15de0c0937cce25dc5dc083e6e.svg);
background-repeat: repeat-x;
background-position: 0 100%;
padding-bottom: 4px;
```
Each hintable word is its own `<div>` with that background; the sentence is additionally split into
one `<span>` per character (`aria-hidden`) for the per-character animation.
Hovering opens a table popup: header row = the source words, first row = whole-sentence gloss,
following rows = per-word glosses, plus a chevron to expand more senses.

## "Fill in the blank" (gapFill)
Sentence with a ruled blank; hintable words carry the dotted underline. On a correct answer the
chosen word is written into the sentence in green (#58cc02) and keeps a green dotted underline.

## translate / word bank
- Answer area = 3 ruled lines (a horizontal rule under each row).
- Bank tokens: 52px tall, radius 12px, padding 12px 16px, 500 19px, border-bottom 4px.
- Placing a token leaves a **grey placeholder slot of the same size** in the bank — the bank
  never reflows. Tokens are `data-test="<word>-challenge-tap-token"`.
- On a wrong answer the placed tokens are NOT turned red.

## LISTENING EXERCISES (the big gap in ours)

### `listenTap` — "Tap what you hear"
`data-test="challenge challenge-listenTap"`
- Two speaker buttons, centred, side by side, **not** the same size:
  - normal speed: **100x100**, `border-radius: 25%`, bg **#1899d6**, 4px darker bottom lip
  - slow speed (turtle glyph): **70x70**, same colours, bottom-aligned with the big one
- Below: the ruled answer lines + a word bank **in the target language**
- Footer: `player-skip` "CAN'T LISTEN NOW" | `player-toggle-keyboard` "USE KEYBOARD" | CHECK
- Audio autoplays on challenge load.

### `listen` — "Type what you hear"  (the USE KEYBOARD toggle flips between the two)
- Same speaker pair, then a `<textarea data-test="challenge-translate-input">`
  - 600x170, bg **#f7f7f7**, border **2px solid #e5e5e5**, radius 10px, padding 10px 12px
  - font 19px/24px duolingo-sans, colour #3c3c3c, placeholder **#afafaf** = "Type in <Language>"
- Footer toggle now reads "USE WORD BANK".
- On a correct answer the green footer adds a second line: **"Meaning: They rarely watch TV."**
  (i.e. listening challenges show the L1 gloss only after you answer)

### `listenMatch` — "Select the matching pairs" (audio tiles ↔ translations)
Covered above.

Each `pairs[]`/challenge carries a `tts` mp3 URL from cloudfront. For ours we'd use
speechSynthesis (or pre-generated audio) — slow playback = lower `rate`.

## MISTAKE CORRECTION (never finish until everything is right)

Flow observed with 3 deliberate mistakes:
1. Main challenge queue plays through. A wrong answer does **not** end the lesson and the
   progress bar does not reach 100% — the remaining slice is reserved for the repeats.
2. After the last new challenge, an interstitial: `data-test="session-duo"` — Duo peeking up from
   the bottom-left with a speech bubble **"Let's review the exercises you missed!"**
   (500 19px/26.6px duolingo-sans, #3c3c3c) + CONTINUE.
3. Each missed challenge is re-presented **in its original form**, with an orange badge above the
   `<h1>`:
   - text "PREVIOUS MISTAKE", colour `--color-fox` = **#ff9600**
   - 700 16px/16px duolingo-sans, uppercase, letter-spacing .64px
   - 32px circular-arrows SVG icon, `display:grid`, gap 8px, block height 32px
4. Word banks are **reshuffled** on the repeat (not the same token order).
5. **Missing it again re-queues it again** — I missed the same `assist` twice and it appeared a
   third time. The lesson only ends once every challenge has been answered correctly.

## Completion screen
- headline e.g. "Hide the evidence!" — **#ffc800**, 700 32px
- subtitle "You corrected 3 mistakes in this lesson" — #afafaf, 500 19px
- two stat cards, 163x94, white, radius 16px, coloured header strip:
  TOTAL XP header **#ffc800**, GOOD/accuracy header **#58cc02**; header text 500 17px #3c3c3c
  (numbers animate as a rolling 0-9 slot column)
- footer: REVIEW LESSON (grey outline) | PRACTICE AGAIN (blue) | CONTINUE (green)

## Palette summary (Duolingo CSS vars)
| token | hex | use |
|---|---|---|
| eel | #4b4b4b | body text |
| wolf | #afafaf | muted text / disabled |
| swan | #e5e5e5 | idle borders |
| polar | #f7f7f7 | input fill |
| macaw | #1899d6 | audio buttons, selected text |
| iguana/blue fill | #ddf4ff | selected fill |
| blue border | #84d8ff | selected border |
| feather green | #58cc02 | primary green / correct highlight |
| tree frog | #58a700 | correct text + button lip |
| sea sponge | #a5ed6e | correct border |
| light green fill | #d7ffb8 | correct fill / correct footer |
| cardinal | #ea2b2b | incorrect text |
| light red fill | #ffdfe0 | incorrect fill / incorrect footer |
| fox | #ff9600 | PREVIOUS MISTAKE badge |
| bee | #ffc800 | XP gold |

## NEW-WORD (purple) HIGHLIGHT — NOT SEEN
No purple new-word highlight appeared in this GLOBAL_PRACTICE session. The session JSON does carry
a `newWords: []` array per challenge (empty here because practice only revisits known words), which
is the hook Duolingo uses — a word listed in `newWords` is rendered in purple the first time it is
shown. Worth confirming inside a brand-new lesson rather than practice.

---

# RESOLVED: the purple new-word treatment is already in the kit

`build-assets/duolingo-kit/css/1327-4028784b.css` carries the whole family of hint-token
underline variants. They are all `background: url(<svg>) 0 100% repeat-x` on the token span,
differing only in the SVG (which encodes the dot colour) and the text colour:

| class | underline svg | colour | meaning |
|---|---|---|---|
| `._2IGwo` / `._8outT` | `06f94a15de0c0937cce25dc5dc083e6e.svg` | inherit (#4b4b4b) | ordinary hintable word — **what we already render** |
| **`._1ELE3`** | **`af821b2d9d7e2fd3cbfce2ed8a0264da.svg`** | **`--color-beetle` #ce82ff**, `font-weight:700` | **NEW WORD — the purple highlight** |
| `._3ox-r` | `10f48a314252060cac1fd0048220dd04.svg` | `--color-fox` #ff9600, bold | hard word / previous mistake |
| `._3ykJt` | `87ec72cd84f1153a0b80185ab48ce42c.svg` | `--color-owl` | — |
| `._2K1Pc` | `6cf7ea902c63b44d993195c22f222b05.svg` | `--color-macaw` | — |
| `._3InU3` | `06f94a15…svg` | inherit, bold | — |
| `._2P1-9` | `06f94a15…svg` | `--color-swan` | faded/disabled |
| `._3OOoT` | `026f59a038df78d30097d92b0d63ce44.svg` | **transparent** + `user-select:none` | the blank in fill-in-the-blank |

Every variant also has an `html[data-duo-theme=dark]` override with a different SVG.

## The new-word sparkle
New words additionally get a purple sparkle burst, also in the same file:
```css
.P77qm{--word-sparkle-height-width:6px;--word-sparkle-opacity:.3;
       animation:_2SiAC 1.8s ease-out;height:100%;left:0;opacity:0;position:absolute;top:0;
       transform:rotate(45deg) translate(0);width:100%}
.P77qm:before{background-color:rgb(var(--color-beetle));border-radius:2px;content:"";
       height:var(--word-sparkle-height-width);left:50%;opacity:var(--word-sparkle-opacity);
       position:absolute;top:50%;transform:translate(-50%,-50%);
       width:var(--word-sparkle-height-width)}
```
Three trajectory variants — `._1kMJb` (8px, opacity .6), `._2u6Cq`, `._3Jwe8` — are placed around
the word, and `@keyframes _2SiAC` drifts each one out and rotates 45deg -> 90deg while fading.

## Speaker buttons — also already in the kit
Same file, confirming the live measurements:
```css
.yJbco{height:100px;width:100px}   .yJbco ._1OCYa{width:50%}   /* normal speed */
.rnwSx{height:70px;width:70px}     .rnwSx ._1OCYa{width:60%}   /* slow / turtle  */
._25RRr,._25RRr:after{border-radius:25%!important}
._37SfF:before{border:4px solid rgb(var(--color-snow));border-radius:calc(25% + 4px);...}
._23274{align-items:center;display:flex!important;justify-content:center;line-height:0!important;padding:0!important}
```
`build-assets/duolingo-kit/lesson/listenTap.tree.txt` already has the matching DOM tree.

# Where OUR player stands (extension/section/lesson.js)
- Types implemented: `assist`, `translate`, `match` only. lesson.js:20 says listenTap was skipped
  for want of audio — the kit shows the styling is all present, only the audio source was missing.
- `BADGES` (lesson.js:315) already has `new` -> beetle and `mistake` -> fox, and the unit JSON
  authors `"badge": "new"` 12 times. Verified live: the **NEW WORD badge renders correctly**
  (#ce82ff, 700 16px, uppercase, ls .64px).
- The gap is the *token*: our prompt word renders with `._2IGwo` (grey) even on a new-word
  challenge. It needs `._1ELE3` + the purple SVG, plus optionally the `.P77qm` sparkles.
- `advance()` (lesson.js:988) is `state.position += 1` — no mistake re-queue, no review
  interstitial, no "Previous mistake" badge ever set at runtime.
- No Legendary mode; only two unused `--color-legendary-*` vars in duolingo.css.
