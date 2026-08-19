package ci.easygest.mobile;

import android.content.Context;
import android.content.SharedPreferences;

/** Address of the computer hosting EasyGest, remembered between launches. */
final class ServerStore {

    private static final String PREFS = "easygest";
    private static final String KEY_URL = "server_url";

    private ServerStore() {
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String url(Context context) {
        return prefs(context).getString(KEY_URL, null);
    }

    static void save(Context context, String url) {
        prefs(context).edit().putString(KEY_URL, url).apply();
    }

    static void clear(Context context) {
        prefs(context).edit().remove(KEY_URL).apply();
    }

    /** Accepts "192.168.1.20", "192.168.1.20:8000" or a full URL. */
    static String normalise(String input) {
        String value = input == null ? "" : input.trim();
        if (value.isEmpty()) {
            return null;
        }
        if (!value.startsWith("http://") && !value.startsWith("https://")) {
            value = "http://" + value;
        }
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        if (!value.substring("http://".length()).contains(":")) {
            value = value + ":8000";
        }
        return value;
    }
}
