package ci.easygest.mobile;

import android.content.Intent;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.widget.Button;
import android.widget.EditText;
import android.widget.TextView;

import androidx.appcompat.app.AppCompatActivity;

import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/** First screen: which computer hosts EasyGest. */
public class ServerActivity extends AppCompatActivity {

    private final ExecutorService workers = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    /** Last connectivity failure, shown to the user instead of a generic hint. */
    private String lastReachError = "";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_server);
        // Note: the TLS/security-provider update for older Androids runs in
        // EasyGestApp.onCreate — it covers every launch, including the ones
        // that skip this screen with a saved URL.

        EditText address = findViewById(R.id.address);
        Button connect = findViewById(R.id.connect);
        TextView status = findViewById(R.id.status);

        String saved = ServerStore.url(this);
        if (saved != null) {
            address.setText(saved);
        }

        Button remote = findViewById(R.id.remote);
        remote.setOnClickListener((View view) -> {
            remote.setEnabled(false);
            status.setText(R.string.testing);
            workers.execute(() -> {
                boolean reachable = reachable(
                        ServerStore.CENTRAL_URL + "/api/central/health");
                ui.post(() -> {
                    remote.setEnabled(true);
                    if (!reachable) {
                        status.setText(
                                getString(R.string.central_ko) + detailSuffix());
                        return;
                    }
                    ServerStore.save(this, ServerStore.CENTRAL_MOBILE_URL);
                    startActivity(new Intent(this, MainActivity.class));
                    finish();
                });
            });
        });

        connect.setOnClickListener((View view) -> {
            String url = ServerStore.normalise(address.getText().toString());
            if (url == null) {
                status.setText(R.string.server_ko);
                return;
            }
            connect.setEnabled(false);
            status.setText(R.string.testing);
            workers.execute(() -> {
                boolean reachable = reachable(url + "/api/health");
                ui.post(() -> {
                    connect.setEnabled(true);
                    if (!reachable) {
                        status.setText(
                                getString(R.string.server_ko) + detailSuffix());
                        return;
                    }
                    status.setText(R.string.server_ok);
                    ServerStore.save(this, url);
                    startActivity(new Intent(this, MainActivity.class));
                    finish();
                });
            });
        });
    }

    /** Technical cause of the last failed probe, appended to the hint. */
    private String detailSuffix() {
        return lastReachError.isEmpty() ? "" : "\n" + lastReachError;
    }

    /** A health address answers 200 as soon as the server runs. */
    private boolean reachable(String url) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            int code = connection.getResponseCode();
            lastReachError = code == 200 ? "" : "HTTP " + code;
            return code == 200;
        } catch (IOException error) {
            lastReachError = error.toString();
            return false;
        } finally {
            if (connection != null) {
                connection.disconnect();
            }
        }
    }

    @Override
    protected void onDestroy() {
        workers.shutdownNow();
        super.onDestroy();
    }
}
