// The one stylesheet this extension injects: the underline under a replaced
// word, the dot marking a block that was checked, the cloak over text that is
// still being translated, and the hover tooltip.
//
// It is rebuilt rather than patched whenever settings change, so the toggles
// that switch parts of it off simply leave those rules out.
(() => {
  const LWR = globalThis.__learnedWordReplacerShared;
  if (!LWR || LWR.ready) {
    return;
  }

  const STYLE_ID = "learned-word-replacer-style";

  function installStyle() {
    let style = document.getElementById(STYLE_ID);

    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      document.documentElement.appendChild(style);
    }

    // Styled after Duolingo's own hint popover (captured live 2026-07-21):
    // #f7f7f7 box, 2px #e5e5e5 border, 15px radius, centered 17px/22px rows
    // padded 15px 10px with 2px separators, and a rotated-square caret
    // clipped inside a 20x10 window that overlaps the box border by 2px.
    const reverseHoverTooltipStyle = `
      .${LWR.REVERSE_HOVER_TOOLTIP_CLASS} {
        color: #3c3c3c;
        font: 500 17px/22px duolingo-sans, "din-round", system-ui, -apple-system, sans-serif;
        left: 0;
        opacity: 0;
        pointer-events: none;
        position: fixed;
        text-align: center;
        top: 0;
        transform: translate(-50%, calc(-100% - 13px));
        visibility: hidden;
        z-index: 2147483647;
      }

      .${LWR.REVERSE_HOVER_TOOLTIP_CLASS}[data-visible="true"] {
        opacity: 1;
        visibility: visible;
      }

      .${LWR.REVERSE_HOVER_TOOLTIP_CLASS}[data-placement="below"] {
        transform: translate(-50%, 13px);
      }

      .${LWR.REVERSE_HOVER_TOOLTIP_CLASS}-box {
        background: #f7f7f7;
        border: 2px solid #e5e5e5;
        border-radius: 15px;
        overflow: hidden;
      }

      .${LWR.REVERSE_HOVER_TOOLTIP_CLASS}-row {
        max-width: min(320px, calc(100vw - 16px));
        overflow: hidden;
        padding: 15px 10px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .${LWR.REVERSE_HOVER_TOOLTIP_CLASS}-row + .${LWR.REVERSE_HOVER_TOOLTIP_CLASS}-row {
        border-top: 2px solid #e5e5e5;
      }

      .${LWR.REVERSE_HOVER_TOOLTIP_CLASS}-caret {
        bottom: -8px;
        height: 10px;
        left: 50%;
        margin-left: -10px;
        overflow: hidden;
        position: absolute;
        width: 20px;
      }

      .${LWR.REVERSE_HOVER_TOOLTIP_CLASS}[data-placement="below"] .${LWR.REVERSE_HOVER_TOOLTIP_CLASS}-caret {
        bottom: auto;
        top: -8px;
      }

      .${LWR.REVERSE_HOVER_TOOLTIP_CLASS}-caret::before {
        background: #f7f7f7;
        border: 2px solid #e5e5e5;
        border-radius: 2px;
        box-sizing: border-box;
        content: "";
        height: 14px;
        left: 3px;
        position: absolute;
        top: -7px;
        transform: rotate(45deg);
        width: 14px;
      }

      .${LWR.REVERSE_HOVER_TOOLTIP_CLASS}[data-placement="below"] .${LWR.REVERSE_HOVER_TOOLTIP_CLASS}-caret::before {
        top: 3px;
      }
    `;

    // The original-word tooltip is the fixed-position element attached to the
    // document root: page stacking contexts (e.g. Wikipedia's page container)
    // and overflow-clipping ancestors would trap or cut off a CSS ::after.
    const originalHoverStyle = "";
    // A small dot hanging in the left margin marks a block that was checked
    // and left unchanged. It floats out of the text flow by its own width, so
    // nothing on the page shifts, and it takes its colour from the block's own
    // text so it sits quietly on any page, light or dark.
    const processedBlockStyle = LWR.state.showProcessedSections
      ? `
      .${LWR.PROCESSED_BLOCK_CLASS}::before {
        background: currentColor;
        border-radius: 50%;
        content: "";
        float: left;
        height: 0.32em;
        margin-left: -0.95em;
        margin-top: 0.55em;
        opacity: 0.35;
        pointer-events: none;
        user-select: none;
        -webkit-user-select: none;
        width: 0.32em;
      }
    `
      : "";
    // Blocks waiting on their translation keep their layout but show nothing,
    // so the untranslated wording is never readable and each block appears
    // once it is finished.
    const pendingBlockStyle = `
      [${LWR.PENDING_HIDE_ATTRIBUTE}],
      [${LWR.PENDING_HIDE_ATTRIBUTE}] * {
        color: transparent !important;
        -webkit-text-fill-color: transparent !important;
        text-shadow: none !important;
      }
    `;

    if (!LWR.state.translateEnglishOnHover) {
      LWR.clearReverseHover();
    }

    // Duolingo underlines hint words with a repeating 6x2 SVG tile (a 3px
    // #afafaf dash then a 3px gap) painted along the bottom of a 4px bottom
    // padding (0.2em at their 20px font) — captured live 2026-07-22 from
    // [data-test='hint-token']. Inlined as data: URIs so pages need no
    // network access; unlearned matches use the same dash in Duolingo blue.
    style.textContent =
      (LWR.state.showHighlights
        ? `
        .${LWR.REPLACEMENT_CLASS} {
          background: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='2' viewBox='0 0 6 2'%3E%3Crect fill='%23afafaf' width='3' height='2' x='0' y='0'/%3E%3C/svg%3E") repeat-x 0 100%;
          box-decoration-break: clone;
          -webkit-box-decoration-break: clone;
          cursor: inherit;
          padding-bottom: 0.2em;
          position: relative;
        }

        .${LWR.REPLACEMENT_CLASS}[data-learned-word-match-kind="${LWR.BACK_TRANSLATION_MATCH_KIND}"] {
          background: none;
          padding-bottom: 0;
        }

        .${LWR.REPLACEMENT_CLASS}[data-learned-word-match-kind="${LWR.UNLEARNED_MATCH_KIND}"] {
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='2' viewBox='0 0 6 2'%3E%3Crect fill='%231cb0f6' width='3' height='2' x='0' y='0'/%3E%3C/svg%3E");
        }

      ` + processedBlockStyle + pendingBlockStyle + originalHoverStyle + reverseHoverTooltipStyle
        : `
        .${LWR.REPLACEMENT_CLASS} {
          cursor: inherit;
          position: relative;
        }
      ` + processedBlockStyle + pendingBlockStyle + originalHoverStyle + reverseHoverTooltipStyle);
  }

  function removeStyle() {
    LWR.removeReverseHoverTooltip();
    LWR.clearProcessedBlockMarkers();
    const style = document.getElementById(STYLE_ID);
    if (style) {
      style.remove();
    }
  }

  // Reached for by other modules.
  Object.assign(LWR, { installStyle, removeStyle });
})();
