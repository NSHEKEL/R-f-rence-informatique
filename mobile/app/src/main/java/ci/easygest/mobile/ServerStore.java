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

    /**
     * Accepts "192.168.1.20", "192.168.1.20:8000", "easygest.mondomaine.com"
     * or a full URL. A bare IP is the computer on the local network (http, port
     * 8000 by default); a bare domain name is the online server, reached over
     * https on the standard port.
     */
    static String normalise(String input) {
        String value = input == null ? "" : input.trim();
        if (value.isEmpty()) {
            return null;
        }
        boolean hadScheme = value.startsWith("http://") || value.startsWith("https://");
        if (!hadScheme) {
            value = (isLocalAddress(value) ? "http://" : "https://") + value;
        }
        while (value.endsWith("/")) {
            value = value.substring(0, value.length() - 1);
        }
        String host = value.substring(value.indexOf("://") + 3);
        if (value.startsWith("http://") && !host.contains(":")) {
            value = value + ":8000";
        }
        return value;
    }

    /** An IP address or "localhost": the EasyGest computer on this network. */
    private static boolean isLocalAddress(String value) {
        String host = value.split("/")[0].split(":")[0];
        return host.equalsIgnoreCase("localhost")
                || host.matches("\\d{1,3}(\\.\\d{1,3}){3}");
    }
}
