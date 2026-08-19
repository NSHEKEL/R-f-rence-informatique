package ci.easygest.mobile;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.view.View;
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

    private WebView webView;
    private ProgressBar progress;

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

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                progress.setVisibility(View.GONE);
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request,
                                        WebResourceError error) {
                if (request.isForMainFrame()) {
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
