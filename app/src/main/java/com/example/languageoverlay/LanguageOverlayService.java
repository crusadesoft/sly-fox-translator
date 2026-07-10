package com.example.languageoverlay;

import android.accessibilityservice.AccessibilityService;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.Rect;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.text.TextUtils;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityNodeInfo;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class LanguageOverlayService extends AccessibilityService {
    private static final int MAX_OVERLAYS = 14;
    private static final long SCAN_DELAY_MS = 140;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private final ArrayList<View> overlays = new ArrayList<>();
    private final Rect reusableBounds = new Rect();
    private WindowManager windowManager;
    private long lastOverlayRenderMs;

    private final Runnable scanRunnable = new Runnable() {
        @Override
        public void run() {
            scanAndRender();
        }
    };

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        scheduleScan();
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) {
            return;
        }
        int eventType = event.getEventType();
        if (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                || eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED
                || eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
                || eventType == AccessibilityEvent.TYPE_VIEW_SCROLLED) {
            if (isOwnPackage(event.getPackageName()) && isOwnAppActiveWindow()) {
                handler.removeCallbacks(scanRunnable);
                clearOverlays();
                return;
            }
            if (isLikelyOwnOverlayEvent(event)) {
                return;
            }
            if (eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
                    || eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
                clearOverlays();
            }
            scheduleScan();
        }
    }

    @Override
    public void onInterrupt() {
        clearOverlays();
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        clearOverlays();
        super.onDestroy();
    }

    private void scheduleScan() {
        handler.removeCallbacks(scanRunnable);
        handler.postDelayed(scanRunnable, SCAN_DELAY_MS);
    }

    private void scanAndRender() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null || windowManager == null) {
            clearOverlays();
            return;
        }
        if (isOwnPackage(root.getPackageName())) {
            root.recycle();
            clearOverlays();
            return;
        }

        LinkedHashMap<String, String> dictionary = VocabularyStore.loadDictionary(this);
        ArrayList<Candidate> candidates = new ArrayList<>();
        collectCandidates(root, candidates, dictionary);
        root.recycle();

        clearOverlays();
        int count = Math.min(candidates.size(), MAX_OVERLAYS);
        for (int i = 0; i < count; i++) {
            addOverlay(candidates.get(i));
        }
        lastOverlayRenderMs = SystemClock.uptimeMillis();
    }

    private boolean isLikelyOwnOverlayEvent(AccessibilityEvent event) {
        return isOwnPackage(event.getPackageName())
                && SystemClock.uptimeMillis() - lastOverlayRenderMs < 700;
    }

    private boolean isOwnAppActiveWindow() {
        AccessibilityNodeInfo root = getRootInActiveWindow();
        if (root == null) {
            return false;
        }
        boolean isOwnApp = isOwnPackage(root.getPackageName());
        root.recycle();
        return isOwnApp;
    }

    private boolean isOwnPackage(CharSequence packageName) {
        return packageName != null && packageName.toString().equals(getPackageName());
    }

    private void collectCandidates(AccessibilityNodeInfo node, List<Candidate> candidates,
            Map<String, String> dictionary) {
        if (node == null || candidates.size() >= MAX_OVERLAYS) {
            return;
        }

        CharSequence nodeText = node.getText();
        if (!node.isPassword()
                && !node.isEditable()
                && nodeText != null
                && nodeText.length() > 0
                && nodeText.length() <= 180) {
            String className = safeString(node.getClassName());
            if (contains(className, "Button")) {
                return;
            }
            String original = nodeText.toString();
            String packageName = safeString(node.getPackageName());
            if (packageName.equals(getPackageName())) {
                return;
            }
            node.getBoundsInScreen(reusableBounds);
            String translated = translateKnownWords(original, dictionary);
            if (!translated.equals(original)) {
                if (isUsefulBounds(reusableBounds)) {
                    candidates.add(new Candidate(
                            new Rect(reusableBounds),
                            original,
                            translated,
                            packageName,
                            className,
                            safeString(node.getViewIdResourceName())));
                }
            }
        }

        for (int i = 0; i < node.getChildCount() && candidates.size() < MAX_OVERLAYS; i++) {
            AccessibilityNodeInfo child = node.getChild(i);
            if (child != null) {
                collectCandidates(child, candidates, dictionary);
                child.recycle();
            }
        }
    }

    private boolean isUsefulBounds(Rect bounds) {
        int width = bounds.width();
        int height = bounds.height();
        return width >= dp(36)
                && height >= dp(18)
                && bounds.left >= 0
                && bounds.top >= 0
                && width <= getResources().getDisplayMetrics().widthPixels
                && height <= getResources().getDisplayMetrics().heightPixels / 2;
    }

    private String translateKnownWords(String original, Map<String, String> dictionary) {
        StringBuilder out = new StringBuilder(original.length() + 24);
        StringBuilder token = new StringBuilder();

        for (int i = 0; i < original.length(); i++) {
            char c = original.charAt(i);
            if (Character.isLetter(c)) {
                token.append(c);
            } else {
                appendTranslatedToken(out, token, dictionary);
                out.append(c);
            }
        }
        appendTranslatedToken(out, token, dictionary);
        return out.toString();
    }

    private void appendTranslatedToken(StringBuilder out, StringBuilder token,
            Map<String, String> dictionary) {
        if (token.length() == 0) {
            return;
        }
        String value = token.toString();
        String translation = dictionary.get(value.toLowerCase(Locale.US));
        if (translation == null) {
            out.append(value);
        } else if (Character.isUpperCase(value.charAt(0))) {
            out.append(Character.toUpperCase(translation.charAt(0)));
            if (translation.length() > 1) {
                out.append(translation.substring(1));
            }
        } else {
            out.append(translation);
        }
        token.setLength(0);
    }

    private void addOverlay(Candidate candidate) {
        Style style = resolveStyle(candidate);
        TextView view = new TextView(this);
        view.setText(candidate.translated);
        view.setTextSize(style.textSizeSp);
        view.setTextColor(style.textColor);
        view.setTypeface(style.typeface);
        view.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
        view.setPadding(style.horizontalPaddingPx, 0, style.horizontalPaddingPx, 0);
        view.setSingleLine(false);
        view.setMaxLines(style.maxLines);
        view.setEllipsize(TextUtils.TruncateAt.END);
        view.setBackgroundColor(style.backgroundColor);
        view.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);

        Rect bounds = candidate.bounds;
        int screenWidth = getResources().getDisplayMetrics().widthPixels;
        int overlayX = Math.max(0, bounds.left - style.maskOutsetXPx);
        int overlayY = Math.max(0, bounds.top - style.maskOutsetYPx);
        int availableWidth = Math.max(dp(64), screenWidth - overlayX - dp(4));
        int desiredWidth = (int) Math.ceil(Math.max(
                view.getPaint().measureText(candidate.original),
                view.getPaint().measureText(candidate.translated))
                + style.horizontalPaddingPx * 2f
                + style.maskOutsetXPx * 2f);
        int overlayWidth = Math.min(availableWidth, Math.max(bounds.width() + style.maskOutsetXPx * 2, desiredWidth));
        int overlayHeight = Math.max(bounds.height() + style.maskOutsetYPx * 2, style.minHeightPx);
        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                overlayWidth,
                overlayHeight,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;
        params.x = overlayX;
        params.y = overlayY;

        try {
            windowManager.addView(view, params);
            overlays.add(view);
        } catch (RuntimeException ignored) {
            // Overlay attachment can fail during rapid window transitions; the next event retries.
        }
    }

    private Style resolveStyle(Candidate candidate) {
        float textSizeSp = estimateBaseTextSizeSp(candidate);
        int textColor = Color.rgb(31, 31, 36);
        int backgroundColor = Color.WHITE;
        Typeface typeface = Typeface.DEFAULT;
        int paddingPx = dp(3);
        int maxLines = estimateMaxLines(candidate, textSizeSp);
        int minHeightPx = Math.max(candidate.bounds.height() + dp(2), dp(22));
        int maskOutsetXPx = dp(7);
        int maskOutsetYPx = dp(2);

        if (candidate.packageName.equals(getPackageName())) {
            backgroundColor = isOwnAppCard(candidate)
                    ? Color.WHITE
                    : Color.rgb(248, 250, 249);
            textColor = Color.rgb(31, 38, 35);
            if (isButton(candidate)) {
                backgroundColor = Color.rgb(224, 224, 224);
                textSizeSp = 14.5f;
            } else if (candidate.bounds.height() > dp(70)) {
                textSizeSp = 18f;
                maxLines = Math.max(maxLines, 2);
            } else if (candidate.original.contains("Language Overlay Prototype")) {
                textSizeSp = 28f;
                typeface = Typeface.DEFAULT_BOLD;
            }
        } else if (candidate.packageName.equals("com.android.settings")) {
            backgroundColor = Color.rgb(241, 240, 247);
            textColor = Color.rgb(31, 31, 36);
            if (contains(candidate.viewId, "homepage_title")) {
                textSizeSp = 34f;
                minHeightPx = dp(58);
                maskOutsetXPx = dp(10);
                maskOutsetYPx = dp(3);
            } else if (contains(candidate.viewId, "search_action_bar_title")) {
                backgroundColor = Color.rgb(250, 248, 255);
                textSizeSp = 22f;
                minHeightPx = dp(38);
                maskOutsetXPx = dp(8);
            } else if (contains(candidate.viewId, "android:id/title")) {
                textSizeSp = 22f;
                minHeightPx = dp(38);
            } else if (contains(candidate.viewId, "android:id/summary")) {
                textSizeSp = 16f;
                textColor = Color.rgb(73, 69, 79);
                minHeightPx = dp(28);
                maxLines = 1;
            }
        } else if (candidate.packageName.equals("com.android.chrome")) {
            backgroundColor = resolveChromeBackground(candidate);
            textColor = Color.rgb(32, 33, 36);
            if (candidate.bounds.top < dp(170) && candidate.bounds.height() > dp(120)) {
                textSizeSp = 18f;
                minHeightPx = dp(62);
            } else if (candidate.bounds.top > dp(420) && candidate.original.length() <= 28) {
                textSizeSp = 22f;
                minHeightPx = dp(38);
            } else if (candidate.original.length() > 70) {
                textSizeSp = 18f;
                maxLines = 4;
            } else {
                textSizeSp = 20f;
                maxLines = Math.min(maxLines, 2);
            }
            if (candidate.original.length() > 35 && candidate.bounds.height() < dp(80)) {
                maxLines = 1;
            }
        }

        return new Style(textSizeSp, textColor, backgroundColor, typeface, paddingPx, maxLines,
                minHeightPx, maskOutsetXPx, maskOutsetYPx);
    }

    private int resolveChromeBackground(Candidate candidate) {
        if (candidate.bounds.top > dp(500) || candidate.className.equals("android.view.View")) {
            return Color.WHITE;
        }
        return Color.rgb(247, 247, 251);
    }

    private int estimateMaxLines(Candidate candidate, float textSizeSp) {
        float lineHeightPx = textSizeSp * getResources().getDisplayMetrics().scaledDensity * 1.25f;
        int linesFromHeight = Math.max(1, (int) Math.floor(candidate.bounds.height() / lineHeightPx) + 1);
        if (!candidate.original.contains(" ") || candidate.bounds.width() < dp(180)) {
            return Math.min(linesFromHeight, 2);
        }
        return Math.min(Math.max(linesFromHeight, 1), 4);
    }

    private float estimateBaseTextSizeSp(Candidate candidate) {
        float heightSp = candidate.bounds.height() / getResources().getDisplayMetrics().scaledDensity;
        if (candidate.original.length() > 42 || candidate.bounds.height() > dp(84)) {
            return 18f;
        }
        if (heightSp >= 42f) {
            return 28f;
        }
        if (heightSp >= 26f) {
            return 22f;
        }
        if (heightSp >= 20f) {
            return 18f;
        }
        return clamp(heightSp * 0.82f, 14f, 18f);
    }

    private boolean isOwnAppCard(Candidate candidate) {
        return candidate.bounds.left >= dp(20)
                && candidate.bounds.top >= dp(520)
                && candidate.bounds.width() >= getResources().getDisplayMetrics().widthPixels - dp(140);
    }

    private boolean isButton(Candidate candidate) {
        return contains(candidate.className, "Button");
    }

    private boolean contains(String value, String needle) {
        return value != null && value.contains(needle);
    }

    private float clamp(float value, float min, float max) {
        return Math.max(min, Math.min(max, value));
    }

    private String safeString(CharSequence value) {
        return value == null ? "" : value.toString();
    }

    private void clearOverlays() {
        if (windowManager == null || overlays.isEmpty()) {
            overlays.clear();
            return;
        }
        for (View overlay : overlays) {
            try {
                windowManager.removeViewImmediate(overlay);
            } catch (RuntimeException ignored) {
                // The window may already be gone while the foreground app is changing.
            }
        }
        overlays.clear();
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }

    private static final class Candidate {
        final Rect bounds;
        final String original;
        final String translated;
        final String packageName;
        final String className;
        final String viewId;

        Candidate(Rect bounds, String original, String translated, String packageName, String className, String viewId) {
            this.bounds = bounds;
            this.original = original;
            this.translated = translated;
            this.packageName = packageName;
            this.className = className;
            this.viewId = viewId;
        }
    }

    private static final class Style {
        final float textSizeSp;
        final int textColor;
        final int backgroundColor;
        final Typeface typeface;
        final int horizontalPaddingPx;
        final int maxLines;
        final int minHeightPx;
        final int maskOutsetXPx;
        final int maskOutsetYPx;

        Style(float textSizeSp, int textColor, int backgroundColor, Typeface typeface,
                int horizontalPaddingPx, int maxLines, int minHeightPx, int maskOutsetXPx,
                int maskOutsetYPx) {
            this.textSizeSp = textSizeSp;
            this.textColor = textColor;
            this.backgroundColor = backgroundColor;
            this.typeface = typeface;
            this.horizontalPaddingPx = horizontalPaddingPx;
            this.maxLines = maxLines;
            this.minHeightPx = minHeightPx;
            this.maskOutsetXPx = maskOutsetXPx;
            this.maskOutsetYPx = maskOutsetYPx;
        }
    }
}
