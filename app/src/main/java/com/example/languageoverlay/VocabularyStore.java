package com.example.languageoverlay;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;

final class VocabularyStore {
    private static final String PREFS_NAME = "language_overlay_vocabulary";
    private static final String KEY_SEEDED = "seeded";
    private static final String KEY_WORDS = "words";
    private static final String KEY_PROFILES = "profiles";
    private static final String KEY_ACTIVE_PROFILE_ID = "active_profile_id";
    private static final String SPANISH_PROFILE_ID = "spanish";
    private static final String GREEK_PROFILE_ID = "greek";

    private VocabularyStore() {
    }

    static ArrayList<Profile> loadProfiles(Context context) {
        SharedPreferences prefs = prefs(context);
        ensureProfilesSeeded(prefs);
        return readProfiles(prefs);
    }

    static Profile getActiveProfile(Context context) {
        SharedPreferences prefs = prefs(context);
        ensureProfilesSeeded(prefs);
        ArrayList<Profile> profiles = readProfiles(prefs);
        String activeId = prefs.getString(KEY_ACTIVE_PROFILE_ID, SPANISH_PROFILE_ID);
        for (Profile profile : profiles) {
            if (profile.id.equals(activeId)) {
                return profile;
            }
        }
        Profile fallback = profiles.isEmpty()
                ? new Profile(SPANISH_PROFILE_ID, "Spanish", defaultSpanishDictionary())
                : profiles.get(0);
        prefs.edit().putString(KEY_ACTIVE_PROFILE_ID, fallback.id).apply();
        return fallback;
    }

    static void setActiveProfile(Context context, String profileId) {
        if (profileId == null || profileId.trim().isEmpty()) {
            return;
        }
        SharedPreferences prefs = prefs(context);
        ensureProfilesSeeded(prefs);
        for (Profile profile : readProfiles(prefs)) {
            if (profile.id.equals(profileId)) {
                prefs.edit().putString(KEY_ACTIVE_PROFILE_ID, profileId).apply();
                return;
            }
        }
    }

    static LinkedHashMap<String, String> loadDictionary(Context context) {
        return new LinkedHashMap<>(getActiveProfile(context).words);
    }

    static Profile createProfile(Context context, String name) {
        String cleanedName = cleanProfileName(name);
        if (cleanedName.isEmpty()) {
            cleanedName = "New Profile";
        }

        SharedPreferences prefs = prefs(context);
        ensureProfilesSeeded(prefs);
        ArrayList<Profile> profiles = readProfiles(prefs);
        String uniqueName = uniqueProfileName(profiles, cleanedName, null);
        Profile profile = new Profile(uniqueProfileId(profiles, uniqueName), uniqueName, new LinkedHashMap<>());
        profiles.add(profile);
        saveProfiles(prefs, profiles);
        prefs.edit().putString(KEY_ACTIVE_PROFILE_ID, profile.id).apply();
        return profile;
    }

    static void renameProfile(Context context, String profileId, String name) {
        String cleanedName = cleanProfileName(name);
        if (profileId == null || cleanedName.isEmpty()) {
            return;
        }

        SharedPreferences prefs = prefs(context);
        ensureProfilesSeeded(prefs);
        ArrayList<Profile> profiles = readProfiles(prefs);
        String uniqueName = uniqueProfileName(profiles, cleanedName, profileId);
        for (int i = 0; i < profiles.size(); i++) {
            Profile profile = profiles.get(i);
            if (profile.id.equals(profileId)) {
                profiles.set(i, new Profile(profile.id, uniqueName, profile.words));
                saveProfiles(prefs, profiles);
                return;
            }
        }
    }

    static void deleteProfile(Context context, String profileId) {
        if (profileId == null) {
            return;
        }

        SharedPreferences prefs = prefs(context);
        ensureProfilesSeeded(prefs);
        ArrayList<Profile> profiles = readProfiles(prefs);
        if (profiles.size() <= 1) {
            return;
        }

        for (int i = 0; i < profiles.size(); i++) {
            if (profiles.get(i).id.equals(profileId)) {
                profiles.remove(i);
                String activeId = prefs.getString(KEY_ACTIVE_PROFILE_ID, SPANISH_PROFILE_ID);
                if (profileId.equals(activeId)) {
                    prefs.edit().putString(KEY_ACTIVE_PROFILE_ID, profiles.get(Math.max(0, i - 1)).id).apply();
                }
                saveProfiles(prefs, profiles);
                return;
            }
        }
    }

    static void saveEntry(Context context, String source, String target) {
        String normalizedSource = normalizeSource(source);
        String normalizedTarget = target == null ? "" : target.trim();
        if (normalizedSource.isEmpty() || normalizedTarget.isEmpty()) {
            return;
        }

        SharedPreferences prefs = prefs(context);
        ensureProfilesSeeded(prefs);
        Profile active = getActiveProfile(context);
        LinkedHashMap<String, String> words = new LinkedHashMap<>(active.words);
        words.put(normalizedSource, normalizedTarget);
        updateProfileWords(prefs, active.id, words);
    }

    static void deleteEntry(Context context, String source) {
        String normalizedSource = normalizeSource(source);
        if (normalizedSource.isEmpty()) {
            return;
        }

        SharedPreferences prefs = prefs(context);
        ensureProfilesSeeded(prefs);
        Profile active = getActiveProfile(context);
        LinkedHashMap<String, String> words = new LinkedHashMap<>(active.words);
        words.remove(normalizedSource);
        updateProfileWords(prefs, active.id, words);
    }

    static void resetDefaults(Context context) {
        SharedPreferences prefs = prefs(context);
        ensureProfilesSeeded(prefs);
        Profile active = getActiveProfile(context);
        LinkedHashMap<String, String> defaults = defaultDictionaryForProfile(active.id);
        updateProfileWords(prefs, active.id, defaults);
    }

    static String normalizeSource(String source) {
        return source == null ? "" : source.trim().toLowerCase(Locale.US);
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static void ensureProfilesSeeded(SharedPreferences prefs) {
        ArrayList<Profile> existing = readProfiles(prefs);
        if (!existing.isEmpty()) {
            ensureActiveProfile(prefs, existing);
            return;
        }

        LinkedHashMap<String, String> spanish = readLegacyDictionary(prefs);
        if (spanish.isEmpty()) {
            spanish = defaultSpanishDictionary();
        }

        ArrayList<Profile> profiles = new ArrayList<>();
        profiles.add(new Profile(SPANISH_PROFILE_ID, "Spanish", spanish));
        profiles.add(new Profile(GREEK_PROFILE_ID, "Greek", defaultGreekDictionary()));
        saveProfiles(prefs, profiles);
        prefs.edit()
                .putBoolean(KEY_SEEDED, true)
                .putString(KEY_ACTIVE_PROFILE_ID, SPANISH_PROFILE_ID)
                .apply();
    }

    private static void ensureActiveProfile(SharedPreferences prefs, ArrayList<Profile> profiles) {
        String activeId = prefs.getString(KEY_ACTIVE_PROFILE_ID, "");
        for (Profile profile : profiles) {
            if (profile.id.equals(activeId)) {
                return;
            }
        }
        prefs.edit().putString(KEY_ACTIVE_PROFILE_ID, profiles.get(0).id).apply();
    }

    private static LinkedHashMap<String, String> readLegacyDictionary(SharedPreferences prefs) {
        LinkedHashMap<String, String> dictionary = new LinkedHashMap<>();
        String raw = prefs.getString(KEY_WORDS, "[]");
        try {
            dictionary.putAll(wordsFromJson(new JSONArray(raw)));
        } catch (JSONException ignored) {
            dictionary.clear();
        }
        return dictionary;
    }

    private static ArrayList<Profile> readProfiles(SharedPreferences prefs) {
        ArrayList<Profile> profiles = new ArrayList<>();
        String raw = prefs.getString(KEY_PROFILES, "[]");
        try {
            JSONArray array = new JSONArray(raw);
            for (int i = 0; i < array.length(); i++) {
                JSONObject object = array.getJSONObject(i);
                String id = object.optString("id", "").trim();
                String name = cleanProfileName(object.optString("name", ""));
                LinkedHashMap<String, String> words = wordsFromJson(object.optJSONArray("words"));
                if (!id.isEmpty() && !name.isEmpty()) {
                    profiles.add(new Profile(id, name, words));
                }
            }
        } catch (JSONException ignored) {
            profiles.clear();
        }
        return profiles;
    }

    private static LinkedHashMap<String, String> wordsFromJson(JSONArray array) {
        LinkedHashMap<String, String> dictionary = new LinkedHashMap<>();
        if (array == null) {
            return dictionary;
        }
        for (int i = 0; i < array.length(); i++) {
            JSONObject word = array.optJSONObject(i);
            if (word == null) {
                continue;
            }
            String source = normalizeSource(word.optString("source"));
            String target = word.optString("target", "").trim();
            if (!source.isEmpty() && !target.isEmpty()) {
                dictionary.put(source, target);
            }
        }
        return dictionary;
    }

    private static void updateProfileWords(SharedPreferences prefs, String profileId,
            LinkedHashMap<String, String> words) {
        ArrayList<Profile> profiles = readProfiles(prefs);
        for (int i = 0; i < profiles.size(); i++) {
            Profile profile = profiles.get(i);
            if (profile.id.equals(profileId)) {
                profiles.set(i, new Profile(profile.id, profile.name, words));
                saveProfiles(prefs, profiles);
                return;
            }
        }
    }

    private static void saveProfiles(SharedPreferences prefs, ArrayList<Profile> profiles) {
        JSONArray array = new JSONArray();
        for (Profile profile : profiles) {
            JSONObject object = new JSONObject();
            try {
                object.put("id", profile.id);
                object.put("name", profile.name);
                object.put("words", wordsToJson(profile.words));
                array.put(object);
            } catch (JSONException ignored) {
                // In-memory string values should not fail JSON serialization.
            }
        }
        prefs.edit().putString(KEY_PROFILES, array.toString()).apply();
    }

    private static JSONArray wordsToJson(LinkedHashMap<String, String> dictionary) {
        JSONArray words = new JSONArray();
        for (Map.Entry<String, String> entry : dictionary.entrySet()) {
            JSONObject word = new JSONObject();
            try {
                word.put("source", entry.getKey());
                word.put("target", entry.getValue());
                words.put(word);
            } catch (JSONException ignored) {
                // In-memory string values should not fail JSON serialization.
            }
        }
        return words;
    }

    private static String cleanProfileName(String name) {
        return name == null ? "" : name.trim();
    }

    private static String uniqueProfileName(ArrayList<Profile> profiles, String requestedName, String currentId) {
        String base = requestedName.trim();
        String candidate = base;
        int suffix = 2;
        while (profileNameExists(profiles, candidate, currentId)) {
            candidate = base + " " + suffix;
            suffix++;
        }
        return candidate;
    }

    private static boolean profileNameExists(ArrayList<Profile> profiles, String name, String currentId) {
        for (Profile profile : profiles) {
            if ((currentId == null || !profile.id.equals(currentId))
                    && profile.name.equalsIgnoreCase(name)) {
                return true;
            }
        }
        return false;
    }

    private static String uniqueProfileId(ArrayList<Profile> profiles, String name) {
        String base = name.toLowerCase(Locale.US).replaceAll("[^a-z0-9]+", "_");
        base = base.replaceAll("^_+|_+$", "");
        if (base.isEmpty()) {
            base = "profile";
        }

        String candidate = base;
        int suffix = 2;
        while (profileIdExists(profiles, candidate)) {
            candidate = base + "_" + suffix;
            suffix++;
        }
        return candidate;
    }

    private static boolean profileIdExists(ArrayList<Profile> profiles, String id) {
        for (Profile profile : profiles) {
            if (profile.id.equals(id)) {
                return true;
            }
        }
        return false;
    }

    private static LinkedHashMap<String, String> defaultDictionaryForProfile(String profileId) {
        if (GREEK_PROFILE_ID.equals(profileId)) {
            return defaultGreekDictionary();
        }
        if (SPANISH_PROFILE_ID.equals(profileId)) {
            return defaultSpanishDictionary();
        }
        return new LinkedHashMap<>();
    }

    private static LinkedHashMap<String, String> defaultSpanishDictionary() {
        LinkedHashMap<String, String> dictionary = new LinkedHashMap<>();
        dictionary.put("hello", "hola");
        dictionary.put("friend", "amigo");
        dictionary.put("learn", "aprender");
        dictionary.put("learning", "aprendiendo");
        dictionary.put("language", "idioma");
        dictionary.put("every", "cada");
        dictionary.put("day", "dia");
        dictionary.put("open", "abrir");
        dictionary.put("settings", "ajustes");
        dictionary.put("app", "aplicacion");
        dictionary.put("apps", "aplicaciones");
        dictionary.put("words", "palabras");
        dictionary.put("visible", "visible");
        dictionary.put("text", "texto");
        dictionary.put("screen", "pantalla");
        dictionary.put("replacement", "reemplazo");
        return dictionary;
    }

    private static LinkedHashMap<String, String> defaultGreekDictionary() {
        LinkedHashMap<String, String> dictionary = new LinkedHashMap<>();
        dictionary.put("hello", "γεια");
        dictionary.put("friend", "φίλος");
        dictionary.put("learn", "μαθαίνω");
        dictionary.put("learning", "μάθηση");
        dictionary.put("language", "γλώσσα");
        dictionary.put("every", "κάθε");
        dictionary.put("day", "μέρα");
        dictionary.put("open", "άνοιγμα");
        dictionary.put("settings", "ρυθμίσεις");
        dictionary.put("app", "εφαρμογή");
        dictionary.put("apps", "εφαρμογές");
        dictionary.put("words", "λέξεις");
        dictionary.put("visible", "ορατό");
        dictionary.put("text", "κείμενο");
        dictionary.put("screen", "οθόνη");
        dictionary.put("replacement", "αντικατάσταση");
        return dictionary;
    }

    static final class Profile {
        final String id;
        final String name;
        final LinkedHashMap<String, String> words;

        Profile(String id, String name, LinkedHashMap<String, String> words) {
            this.id = id;
            this.name = name;
            this.words = new LinkedHashMap<>(words);
        }

        @Override
        public String toString() {
            return name;
        }
    }
}
