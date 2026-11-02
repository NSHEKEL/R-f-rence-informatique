package ci.easygest.mobile;

import android.app.Application;
import android.util.Log;

import com.google.android.gms.common.GooglePlayServicesNotAvailableException;
import com.google.android.gms.common.GooglePlayServicesRepairableException;
import com.google.android.gms.security.ProviderInstaller;

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

    @Override
    public void onCreate() {
        super.onCreate();
        ProviderInstaller.installIfNeededAsync(this, new ProviderInstaller.ProviderInstallListener() {
            @Override
            public void onProviderInstalled() {
                Log.i(TAG, "Security provider updated by Play services");
            }

            @Override
            public void onProviderInstallFailed(int errorCode, android.content.Intent intent) {
                Log.w(TAG, "Security provider not updated: " + errorCode);
            }
        });
    }
}
