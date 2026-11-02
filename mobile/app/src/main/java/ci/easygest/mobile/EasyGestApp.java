package ci.easygest.mobile;

import android.app.Application;
import android.util.Log;

import com.google.android.gms.security.ProviderInstaller;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Refreshes the TLS stack once per process, for every launch path.
 *
 * Older Androids (7/8) don't know the Google Trust Services root that serves
 * easygest-central.vercel.app: remote sales then look "injoignable" while the
 * server answers fine. Google Play services can install an updated security
 * provider (fresh root store and TLS stack). Doing it here — and not only on
 * the server-choice screen — also covers launches that skip that screen with
 * a saved URL. Phones without Play services just keep the system TLS.
 */
public class EasyGestApp extends Application {

    private static final String TAG = "EasyGestApp";
    private static final CountDownLatch PROVIDER_READY = new CountDownLatch(1);

    /**
     * HTTPS callers wait for the provider installation outcome (bounded), so a
     * probe launched right after startup does not race the TLS update. On
     * phones without Play services the callback or the timeout releases it.
     */
    public static void awaitProvider(long millis) {
        try {
            PROVIDER_READY.await(millis, TimeUnit.MILLISECONDS);
        } catch (InterruptedException ignored) {
            Thread.currentThread().interrupt();
        }
    }

    @Override
    public void onCreate() {
        super.onCreate();
        try {
            ProviderInstaller.installIfNeededAsync(this, new ProviderInstaller.ProviderInstallListener() {
                @Override
                public void onProviderInstalled() {
                    Log.i(TAG, "Security provider updated by Play services");
                    PROVIDER_READY.countDown();
                }

                @Override
                public void onProviderInstallFailed(int errorCode, android.content.Intent intent) {
                    Log.w(TAG, "Security provider not updated: " + errorCode);
                    PROVIDER_READY.countDown();
                }
            });
        } catch (Throwable t) {
            Log.w(TAG, "ProviderInstaller unavailable: " + t);
            PROVIDER_READY.countDown();
        }
    }
}
