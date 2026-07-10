package com.example.languageoverlay;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.inputmethod.EditorInfo;
import android.widget.EditText;
import android.widget.ImageButton;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.PopupMenu;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

public class MainActivity extends Activity {
    private static final int PAGE_SIZE = 8;
    private static final int GREEN = 0xFF207666;
    private static final int TEXT_DARK = 0xFF151C19;
    private static final int TEXT_MUTED = 0xFF5B6661;
    private static final int DELETE_RED = 0xFF912F2F;

    private EditText newSourceInput;
    private EditText newTargetInput;
    private LinearLayout vocabularyList;
    private TextView pageStatus;
    private ImageButton previousButton;
    private ImageButton nextButton;
    private LinearLayout profileDropdownButton;
    private TextView activeProfileLabel;
    private int currentPage;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(buildContent());
    }

    @Override
    protected void onResume() {
        super.onResume();
        renderVocabularyList();
    }

    private View buildContent() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(248, 250, 249));
        root.setPadding(dp(12), dp(14), dp(12), dp(6));

        addToolbar(root);
        addProfileRow(root);
        addAddRow(root);
        addColumnHeader(root);

        ScrollView listScroll = new ScrollView(this);
        listScroll.setFillViewport(false);
        vocabularyList = new LinearLayout(this);
        vocabularyList.setOrientation(LinearLayout.VERTICAL);
        vocabularyList.setPadding(0, 0, 0, dp(4));
        listScroll.addView(vocabularyList, matchWrap());
        root.addView(listScroll, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                0,
                1f));

        addPager(root);
        renderVocabularyList();
        return root;
    }

    private void addToolbar(LinearLayout parent) {
        LinearLayout toolbar = new LinearLayout(this);
        toolbar.setOrientation(LinearLayout.HORIZONTAL);
        toolbar.setGravity(Gravity.CENTER_VERTICAL);
        toolbar.setPadding(0, 0, 0, dp(6));

        TextView title = text("Vocabulary", 26, TEXT_DARK);
        title.setTypeface(Typeface.DEFAULT_BOLD);
        toolbar.addView(title, new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f));

        toolbar.addView(iconButton(
                R.drawable.ic_accessibility_24,
                "Accessibility settings",
                GREEN,
                Color.TRANSPARENT,
                Color.TRANSPARENT,
                v -> startActivity(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))),
                iconParams(0));

        toolbar.addView(iconButton(
                R.drawable.ic_settings_24,
                "App settings",
                TEXT_DARK,
                Color.TRANSPARENT,
                Color.TRANSPARENT,
                v -> {
                    Intent intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                }),
                iconParams(dp(8)));

        toolbar.addView(iconButton(
                R.drawable.ic_refresh_24,
                "Reset default vocabulary",
                TEXT_DARK,
                Color.TRANSPARENT,
                Color.TRANSPARENT,
                v -> resetDefaults()),
                iconParams(dp(8)));

        parent.addView(toolbar, matchWrap());
    }

    private void addProfileRow(LinearLayout parent) {
        LinearLayout profileRow = rowShell();

        profileDropdownButton = new LinearLayout(this);
        profileDropdownButton.setOrientation(LinearLayout.HORIZONTAL);
        profileDropdownButton.setGravity(Gravity.CENTER_VERTICAL);
        profileDropdownButton.setPadding(0, 0, dp(6), 0);
        profileDropdownButton.setBackgroundColor(Color.TRANSPARENT);
        profileDropdownButton.setContentDescription("Select profile");
        profileDropdownButton.setTooltipText("Select profile");
        profileDropdownButton.setClickable(true);
        profileDropdownButton.setFocusable(true);
        profileDropdownButton.setOnClickListener(v -> showProfileDropdown());

        activeProfileLabel = text("", 18, TEXT_DARK);
        activeProfileLabel.setTypeface(Typeface.DEFAULT_BOLD);
        activeProfileLabel.setGravity(Gravity.CENTER_VERTICAL);
        profileDropdownButton.addView(activeProfileLabel, new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.MATCH_PARENT,
                1f));

        ImageView arrow = new ImageView(this);
        arrow.setImageResource(R.drawable.ic_expand_more_24);
        arrow.setColorFilter(TEXT_DARK);
        profileDropdownButton.addView(arrow, new LinearLayout.LayoutParams(dp(24), dp(24)));

        LinearLayout.LayoutParams dropdownParams = new LinearLayout.LayoutParams(
                0,
                dp(44),
                1f);
        profileRow.addView(profileDropdownButton, dropdownParams);

        profileRow.addView(iconButton(
                R.drawable.ic_add_24,
                "Add profile",
                GREEN,
                Color.TRANSPARENT,
                Color.TRANSPARENT,
                v -> showCreateProfileDialog()),
                iconParams(dp(6)));

        profileRow.addView(iconButton(
                R.drawable.ic_edit_24,
                "Rename profile",
                TEXT_DARK,
                Color.TRANSPARENT,
                Color.TRANSPARENT,
                v -> showRenameProfileDialog()),
                iconParams(dp(6)));

        profileRow.addView(iconButton(
                R.drawable.ic_delete_24,
                "Delete profile",
                DELETE_RED,
                Color.TRANSPARENT,
                Color.TRANSPARENT,
                v -> showDeleteProfileDialog()),
                iconParams(dp(6)));

        parent.addView(profileRow, matchWrapWithBottomMargin(dp(2)));
        parent.addView(divider(), dividerParams(dp(6)));
        refreshProfileControls();
    }

    private void addAddRow(LinearLayout parent) {
        LinearLayout addRow = rowShell();

        newSourceInput = field("Known word");
        newSourceInput.setImeOptions(EditorInfo.IME_ACTION_NEXT);
        addRow.addView(newSourceInput, new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f));

        newTargetInput = field("Replacement");
        newTargetInput.setImeOptions(EditorInfo.IME_ACTION_DONE);
        newTargetInput.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                saveNewWord();
                return true;
            }
            return false;
        });
        LinearLayout.LayoutParams targetParams = new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f);
        targetParams.setMargins(dp(6), 0, 0, 0);
        addRow.addView(newTargetInput, targetParams);

        addRow.addView(iconButton(
                R.drawable.ic_add_24,
                "Add word",
                GREEN,
                Color.TRANSPARENT,
                Color.TRANSPARENT,
                v -> saveNewWord()),
                iconParams(dp(6)));

        parent.addView(addRow, matchWrapWithBottomMargin(dp(2)));
        parent.addView(divider(), dividerParams(dp(8)));
    }

    private void addColumnHeader(LinearLayout parent) {
        LinearLayout header = new LinearLayout(this);
        header.setOrientation(LinearLayout.HORIZONTAL);
        header.setGravity(Gravity.CENTER_VERTICAL);
        header.setPadding(0, 0, 0, dp(4));

        TextView source = text("Known", 13, TEXT_MUTED);
        source.setTypeface(Typeface.DEFAULT_BOLD);
        header.addView(source, new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f));

        TextView target = text("Replacement", 13, TEXT_MUTED);
        target.setTypeface(Typeface.DEFAULT_BOLD);
        LinearLayout.LayoutParams targetParams = new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f);
        targetParams.setMargins(dp(6), 0, dp(84), 0);
        header.addView(target, targetParams);

        parent.addView(header, matchWrap());
    }

    private void addPager(LinearLayout parent) {
        LinearLayout pager = new LinearLayout(this);
        pager.setOrientation(LinearLayout.HORIZONTAL);
        pager.setGravity(Gravity.CENTER_VERTICAL);
        pager.setPadding(0, dp(8), 0, 0);

        previousButton = iconButton(
                R.drawable.ic_chevron_left_24,
                "Previous page",
                TEXT_DARK,
                Color.TRANSPARENT,
                Color.TRANSPARENT,
                v -> {
                    if (currentPage > 0) {
                        currentPage--;
                        renderVocabularyList();
                    }
                });
        pager.addView(previousButton, iconParams(0));

        pageStatus = text("", 15, TEXT_MUTED);
        pageStatus.setGravity(Gravity.CENTER);
        pageStatus.setTypeface(Typeface.DEFAULT_BOLD);
        pager.addView(pageStatus, new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f));

        nextButton = iconButton(
                R.drawable.ic_chevron_right_24,
                "Next page",
                TEXT_DARK,
                Color.TRANSPARENT,
                Color.TRANSPARENT,
                v -> {
                    currentPage++;
                    renderVocabularyList();
                });
        pager.addView(nextButton, iconParams(0));

        parent.addView(pager, matchWrap());
    }

    private void showProfileDropdown() {
        ArrayList<VocabularyStore.Profile> profiles = VocabularyStore.loadProfiles(this);
        if (profiles.isEmpty()) {
            return;
        }

        VocabularyStore.Profile active = VocabularyStore.getActiveProfile(this);
        PopupMenu popup = new PopupMenu(this, profileDropdownButton);
        for (int i = 0; i < profiles.size(); i++) {
            VocabularyStore.Profile profile = profiles.get(i);
            popup.getMenu().add(0, i, i, profile.name)
                    .setCheckable(true)
                    .setChecked(profile.id.equals(active.id));
        }
        popup.getMenu().setGroupCheckable(0, true, true);
        popup.setOnMenuItemClickListener(item -> {
            VocabularyStore.Profile selected = profiles.get(item.getItemId());
            if (!selected.id.equals(VocabularyStore.getActiveProfile(this).id)) {
                VocabularyStore.setActiveProfile(this, selected.id);
                currentPage = 0;
                newSourceInput.setText("");
                newTargetInput.setText("");
                renderVocabularyList();
            }
            return true;
        });
        popup.show();
    }

    private void showCreateProfileDialog() {
        EditText input = dialogField("Profile name");
        new AlertDialog.Builder(this)
                .setTitle("New profile")
                .setView(input)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Create", (dialog, which) -> {
                    VocabularyStore.Profile profile = VocabularyStore.createProfile(this, input.getText().toString());
                    currentPage = 0;
                    newSourceInput.setText("");
                    newTargetInput.setText("");
                    refreshProfileControls();
                    renderVocabularyList();
                    Toast.makeText(this, profile.name + " profile created", Toast.LENGTH_SHORT).show();
                })
                .show();
    }

    private void showRenameProfileDialog() {
        VocabularyStore.Profile active = VocabularyStore.getActiveProfile(this);
        EditText input = dialogField("Profile name");
        input.setText(active.name);
        input.setSelectAllOnFocus(true);
        new AlertDialog.Builder(this)
                .setTitle("Rename profile")
                .setView(input)
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Save", (dialog, which) -> {
                    VocabularyStore.renameProfile(this, active.id, input.getText().toString());
                    refreshProfileControls();
                    renderVocabularyList();
                    Toast.makeText(this, "Profile renamed", Toast.LENGTH_SHORT).show();
                })
                .show();
    }

    private void showDeleteProfileDialog() {
        ArrayList<VocabularyStore.Profile> profiles = VocabularyStore.loadProfiles(this);
        if (profiles.size() <= 1) {
            Toast.makeText(this, "Keep at least one profile", Toast.LENGTH_SHORT).show();
            return;
        }

        VocabularyStore.Profile active = VocabularyStore.getActiveProfile(this);
        new AlertDialog.Builder(this)
                .setTitle("Delete " + active.name + "?")
                .setMessage("This removes only this profile's saved words.")
                .setNegativeButton("Cancel", null)
                .setPositiveButton("Delete", (dialog, which) -> {
                    VocabularyStore.deleteProfile(this, active.id);
                    currentPage = 0;
                    newSourceInput.setText("");
                    newTargetInput.setText("");
                    refreshProfileControls();
                    renderVocabularyList();
                    Toast.makeText(this, "Profile deleted", Toast.LENGTH_SHORT).show();
                })
                .show();
    }

    private void saveNewWord() {
        String source = newSourceInput.getText().toString();
        String target = newTargetInput.getText().toString();
        String normalizedSource = VocabularyStore.normalizeSource(source);
        if (normalizedSource.isEmpty() || target.trim().isEmpty()) {
            Toast.makeText(this, "Enter both words", Toast.LENGTH_SHORT).show();
            return;
        }

        VocabularyStore.saveEntry(this, source, target);
        newSourceInput.setText("");
        newTargetInput.setText("");
        currentPage = pageForSource(normalizedSource);
        renderVocabularyList();
        Toast.makeText(this, "Word saved", Toast.LENGTH_SHORT).show();
    }

    private void saveExistingWord(String originalSource, EditText sourceInput, EditText targetInput) {
        String source = sourceInput.getText().toString();
        String target = targetInput.getText().toString();
        String normalizedSource = VocabularyStore.normalizeSource(source);
        if (normalizedSource.isEmpty() || target.trim().isEmpty()) {
            Toast.makeText(this, "Enter both words", Toast.LENGTH_SHORT).show();
            return;
        }

        if (!normalizedSource.equals(originalSource)) {
            VocabularyStore.deleteEntry(this, originalSource);
        }
        VocabularyStore.saveEntry(this, source, target);
        currentPage = pageForSource(normalizedSource);
        renderVocabularyList();
        Toast.makeText(this, "Word updated", Toast.LENGTH_SHORT).show();
    }

    private void deleteWord(String source) {
        VocabularyStore.deleteEntry(this, source);
        renderVocabularyList();
        Toast.makeText(this, "Word deleted", Toast.LENGTH_SHORT).show();
    }

    private void resetDefaults() {
        VocabularyStore.resetDefaults(this);
        newSourceInput.setText("");
        newTargetInput.setText("");
        currentPage = 0;
        renderVocabularyList();
        Toast.makeText(this, "Profile defaults restored", Toast.LENGTH_SHORT).show();
    }

    private void renderVocabularyList() {
        if (vocabularyList == null || pageStatus == null) {
            return;
        }

        vocabularyList.removeAllViews();
        VocabularyStore.Profile active = VocabularyStore.getActiveProfile(this);
        refreshProfileControls();
        ArrayList<Map.Entry<String, String>> entries = new ArrayList<>(active.words.entrySet());
        int pageCount = Math.max(1, (int) Math.ceil(entries.size() / (double) PAGE_SIZE));
        currentPage = Math.max(0, Math.min(currentPage, pageCount - 1));
        int start = currentPage * PAGE_SIZE;
        int end = Math.min(entries.size(), start + PAGE_SIZE);

        for (int i = start; i < end; i++) {
            Map.Entry<String, String> entry = entries.get(i);
            vocabularyList.addView(wordRow(entry.getKey(), entry.getValue()), matchWrapWithBottomMargin(dp(4)));
        }

        if (entries.isEmpty()) {
            TextView empty = text("No words saved", 18, TEXT_MUTED);
            empty.setGravity(Gravity.CENTER);
            empty.setPadding(0, dp(28), 0, dp(28));
            vocabularyList.addView(empty, matchWrap());
        }

        pageStatus.setText(active.name + " · Page " + (currentPage + 1)
                + " of " + pageCount + " · " + entries.size() + " words");
        previousButton.setEnabled(currentPage > 0);
        previousButton.setAlpha(currentPage > 0 ? 1f : 0.35f);
        nextButton.setEnabled(currentPage < pageCount - 1);
        nextButton.setAlpha(currentPage < pageCount - 1 ? 1f : 0.35f);
    }

    private View wordRow(String source, String target) {
        LinearLayout wrapper = new LinearLayout(this);
        wrapper.setOrientation(LinearLayout.VERTICAL);

        LinearLayout row = rowShell();

        EditText sourceField = field("Known word");
        sourceField.setText(source);
        sourceField.setSelectAllOnFocus(true);
        sourceField.setImeOptions(EditorInfo.IME_ACTION_NEXT);
        row.addView(sourceField, new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f));

        EditText targetField = field("Replacement");
        targetField.setText(target);
        targetField.setSelectAllOnFocus(true);
        targetField.setImeOptions(EditorInfo.IME_ACTION_DONE);
        targetField.setOnEditorActionListener((v, actionId, event) -> {
            if (actionId == EditorInfo.IME_ACTION_DONE) {
                saveExistingWord(source, sourceField, targetField);
                return true;
            }
            return false;
        });
        LinearLayout.LayoutParams targetParams = new LinearLayout.LayoutParams(
                0,
                LinearLayout.LayoutParams.WRAP_CONTENT,
                1f);
        targetParams.setMargins(dp(6), 0, 0, 0);
        row.addView(targetField, targetParams);

        row.addView(iconButton(
                R.drawable.ic_save_24,
                "Save changes",
                GREEN,
                Color.TRANSPARENT,
                Color.TRANSPARENT,
                v -> saveExistingWord(source, sourceField, targetField)),
                iconParams(dp(6)));

        row.addView(iconButton(
                R.drawable.ic_delete_24,
                "Delete word",
                DELETE_RED,
                Color.TRANSPARENT,
                Color.TRANSPARENT,
                v -> deleteWord(source)),
                iconParams(dp(6)));

        wrapper.addView(row, matchWrap());
        wrapper.addView(divider(), dividerParams(0));
        return wrapper;
    }

    private int pageForSource(String source) {
        List<String> keys = new ArrayList<>(VocabularyStore.loadDictionary(this).keySet());
        int index = keys.indexOf(source);
        if (index < 0) {
            return currentPage;
        }
        return index / PAGE_SIZE;
    }

    private void refreshProfileControls() {
        if (activeProfileLabel == null || profileDropdownButton == null) {
            return;
        }

        ArrayList<VocabularyStore.Profile> profiles = VocabularyStore.loadProfiles(this);
        VocabularyStore.Profile active = VocabularyStore.getActiveProfile(this);
        activeProfileLabel.setText(active.name);
        boolean hasProfiles = !profiles.isEmpty();
        profileDropdownButton.setEnabled(hasProfiles);
        profileDropdownButton.setAlpha(hasProfiles ? 1f : 0.35f);
    }

    private EditText dialogField(String hint) {
        EditText editText = field(hint);
        editText.setSingleLine(true);
        editText.setPadding(dp(14), 0, dp(14), 0);
        return editText;
    }

    private LinearLayout rowShell() {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(0, dp(1), 0, dp(1));
        row.setMinimumHeight(dp(48));
        return row;
    }

    private EditText field(String hint) {
        EditText editText = new EditText(this);
        editText.setSingleLine(true);
        editText.setTextSize(15);
        editText.setHint(hint);
        editText.setInputType(InputType.TYPE_CLASS_TEXT
                | InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
                | InputType.TYPE_TEXT_VARIATION_NORMAL);
        editText.setPadding(0, 0, dp(6), 0);
        editText.setMinHeight(dp(40));
        return editText;
    }

    private ImageButton iconButton(int drawableRes, String contentDescription, int iconColor,
            int backgroundColor, int strokeColor, View.OnClickListener listener) {
        ImageButton button = new ImageButton(this);
        button.setImageResource(drawableRes);
        button.setColorFilter(iconColor);
        button.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
        button.setPadding(dp(9), dp(9), dp(9), dp(9));
        if (backgroundColor == Color.TRANSPARENT && strokeColor == Color.TRANSPARENT) {
            button.setBackgroundColor(Color.TRANSPARENT);
        } else {
            button.setBackground(roundedBackground(backgroundColor, strokeColor));
        }
        button.setContentDescription(contentDescription);
        button.setTooltipText(contentDescription);
        button.setOnClickListener(listener);
        button.setMinimumWidth(dp(36));
        button.setMinimumHeight(dp(36));
        return button;
    }

    private LinearLayout.LayoutParams iconParams(int leftMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(dp(36), dp(36));
        params.setMargins(leftMargin, 0, 0, 0);
        return params;
    }

    private View divider() {
        View divider = new View(this);
        divider.setBackgroundColor(Color.rgb(218, 226, 222));
        return divider;
    }

    private LinearLayout.LayoutParams dividerParams(int bottomMargin) {
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                Math.max(1, dp(1)));
        params.setMargins(0, 0, 0, bottomMargin);
        return params;
    }

    private GradientDrawable roundedBackground(int color, int strokeColor) {
        GradientDrawable drawable = new GradientDrawable();
        drawable.setColor(color);
        drawable.setCornerRadius(dp(8));
        drawable.setStroke(dp(1), strokeColor);
        return drawable;
    }

    private TextView text(String value, int sp, int color) {
        TextView textView = new TextView(this);
        textView.setText(value);
        textView.setTextSize(sp);
        textView.setTextColor(color);
        textView.setLineSpacing(0, 1.12f);
        return textView;
    }

    private LinearLayout.LayoutParams matchWrap() {
        return new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT);
    }

    private LinearLayout.LayoutParams matchWrapWithBottomMargin(int bottomMargin) {
        LinearLayout.LayoutParams params = matchWrap();
        params.setMargins(0, 0, 0, bottomMargin);
        return params;
    }

    private int dp(int value) {
        return (int) (value * getResources().getDisplayMetrics().density + 0.5f);
    }
}
