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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_server);

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
                        status.setText(R.string.central_ko);
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
                        status.setText(R.string.server_ko);
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

    /** A health address answers 200 as soon as the server runs. */
    private boolean reachable(String url) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            connection.setConnectTimeout(4000);
            connection.setReadTimeout(4000);
            return connection.getResponseCode() == 200;
        } catch (IOException error) {
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
