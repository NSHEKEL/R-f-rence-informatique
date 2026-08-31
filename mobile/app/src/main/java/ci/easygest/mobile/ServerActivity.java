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

        connect.setOnClickListener((View view) -> {
            String url = ServerStore.normalise(address.getText().toString());
            if (url == null) {
                status.setText(R.string.server_ko);
                return;
            }
            connect.setEnabled(false);
            status.setText(R.string.testing);
            workers.execute(() -> {
                boolean reachable = ping(url);
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

    /** The server answers on /api/health as soon as EasyGest runs. */
    private boolean ping(String base) {
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(base + "/api/health").openConnection();
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
