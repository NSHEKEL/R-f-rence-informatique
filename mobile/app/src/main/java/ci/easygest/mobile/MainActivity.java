package ci.easygest.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.webkit.ConsoleMessage;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.ProgressBar;
import android.widget.Toast;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AlertDialog;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;

/** The EasyGest application itself, served by the shop computer. */
public class MainActivity extends AppCompatActivity {

    /** Oldest WebView known to run the EasyGest bundle. */
    private static final int MINIMUM_WEBVIEW = 64;

    private static final String KEY_BUILD = "webview_build";

    private WebView webView;
    private ProgressBar progress;
    private boolean pageFailed;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        String server = ServerStore.url(this);
        if (server == null) {
            startActivity(new Intent(this, ServerActivity.class));
            finish();
            return;
        }

        setContentView(R.layout.activity_main);
        webView = findViewById(R.id.webview);
        progress = findViewById(R.id.progress);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setBuiltInZoomControls(true);
        settings.setDisplayZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);

        forgetCacheOfPreviousVersion();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
                view.postDelayed(() -> warnIfBlank(view), 4000);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) {
                    pageFailed = true;
                    progress.setVisibility(View.GONE);
                    Toast.makeText(MainActivity.this, R.string.offline,
                            Toast.LENGTH_LONG).show();
                }
            }
        });

        // The barcode/QR scanner of the sales screen needs the camera.
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest request) {
                runOnUiThread(() -> request.grant(request.getResources()));
            }

            @Override
            public boolean onConsoleMessage(ConsoleMessage message) {
                if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
                    pageFailed = true;
                }
                return true;
            }
        });

        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                if (webView.canGoBack()) {
                    webView.goBack();
                } else {
                    finish();
                }
            }
        });

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA)
                != PackageManager.PERMISSION_GRANTED) {
            ActivityCompat.requestPermissions(this,
                    new String[]{Manifest.permission.CAMERA}, 1);
        }

        Button options = findViewById(R.id.options);
        options.setOnClickListener((View view) -> showOptions());

        webView.loadUrl(server);
    }

    /**
     * A new application version ships new pages: the copy kept by the WebView
     * would otherwise mix old scripts with new ones and show a blank screen.
     */
    private void forgetCacheOfPreviousVersion() {
        SharedPreferences prefs = ServerStore.prefs(this);
        String installed = BuildConfig.VERSION_NAME;
        if (installed.equals(prefs.getString(KEY_BUILD, ""))) {
            return;
        }
        webView.clearCache(true);
        prefs.edit().putString(KEY_BUILD, installed).apply();
    }

    /** A blank window means the page failed: say what to do instead. */
    private void warnIfBlank(WebView view) {
        view.evaluateJavascript(
                "document.body ? document.body.innerText.trim().length : 0",
                (String value) -> {
                    boolean empty = "0".equals(value) || "null".equals(value);
                    if (!empty) {
                        return;
                    }
                    Toast.makeText(this,
                            outdatedWebView() || pageFailed
                                    ? R.string.webview_old : R.string.page_error,
                            Toast.LENGTH_LONG).show();
                });
    }

    /** Very old system WebViews cannot run the EasyGest scripts. */
    private boolean outdatedWebView() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return true;
        }
        PackageInfo info = WebView.getCurrentWebViewPackage();
        if (info == null) {
            return true;
        }
        String major = info.versionName.split("\\.")[0];
        try {
            return Integer.parseInt(major) < MINIMUM_WEBVIEW;
        } catch (NumberFormatException error) {
            return false;
        }
    }

    /** Reload / change server, reachable without an action bar. */
    private void showOptions() {
        new AlertDialog.Builder(this)
                .setTitle(R.string.app_name)
                .setItems(
                        new CharSequence[]{
                                getString(R.string.reload),
                                getString(R.string.server_change),
                        },
                        (dialog, which) -> {
                            if (which == 0) {
                                pageFailed = false;
                                webView.clearCache(true);
                                webView.reload();
                                return;
                            }
                            ServerStore.clear(this);
                            startActivity(new Intent(this, ServerActivity.class));
                            finish();
                        })
                .show();
    }

}
