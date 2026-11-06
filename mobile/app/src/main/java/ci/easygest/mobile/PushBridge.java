package ci.easygest.mobile;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.webkit.JavascriptInterface;

import androidx.core.app.NotificationCompat;

/**
 * Bridge exposed to the shop page as {@code window.EasyGestAndroid}: the bell
 * poller calls {@link #notify(String, String)} so new EasyGest notifications
 * also surface as a real Android notification, even when the WebView is not
 * in the foreground while the process lives.
 */
public class PushBridge {

    private static final String CHANNEL_ID = "easygest";

    private final Context context;

    PushBridge(Context context) {
        this.context = context.getApplicationContext();
        createChannel();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL_ID, "EasyGest", NotificationManager.IMPORTANCE_HIGH);
            NotificationManager manager =
                    context.getSystemService(NotificationManager.class);
            if (manager != null) manager.createNotificationChannel(channel);
        }
    }

    @JavascriptInterface
    public void notify(String title, String body) {
        Intent open = context.getPackageManager()
                .getLaunchIntentForPackage(context.getPackageName());
        PendingIntent tap = null;
        if (open != null) {
            open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP
                    | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            tap = PendingIntent.getActivity(context, 0, open,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH);
        if (tap != null) builder.setContentIntent(tap);
        NotificationManager manager =
                context.getSystemService(NotificationManager.class);
        if (manager != null) {
            manager.notify((int) (System.currentTimeMillis() % Integer.MAX_VALUE),
                    builder.build());
        }
    }
}
