package ai.fuber.watch

import ai.fuber.watch.ui.FuberTheme
import ai.fuber.watch.ui.MainScreen
import ai.fuber.watch.ui.PairScreen
import ai.fuber.watch.ui.PermissionScreen
import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.core.content.ContextCompat
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    private fun has(p: String) = ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED
    private fun sensorsGranted() = has(Manifest.permission.BODY_SENSORS)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val hub = Hub.get(this)
        setContent {
            FuberTheme {
                var granted by remember { mutableStateOf(sensorsGranted()) }
                var denied by remember { mutableStateOf(false) }
                val first = arrayOf(Manifest.permission.BODY_SENSORS, Manifest.permission.ACTIVITY_RECOGNITION)
                // Arka planda nabız için ayrı izin (API 33+); BODY_SENSORS verildikten SONRA istenir.
                val bgLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) {}
                val launcher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {
                    granted = sensorsGranted()
                    denied = !granted
                    if (granted && Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.BODY_SENSORS_BACKGROUND)) {
                        bgLauncher.launch(Manifest.permission.BODY_SENSORS_BACKGROUND)
                    }
                }
                val s by WatchRuntime.state.collectAsState()
                var now by remember { mutableStateOf(System.currentTimeMillis()) }

                LaunchedEffect(Unit) { while (true) { now = System.currentTimeMillis(); delay(10_000) } }
                LaunchedEffect(granted) {
                    if (!granted) launcher.launch(first)
                    else {
                        if (Build.VERSION.SDK_INT >= 33 && !has(Manifest.permission.BODY_SENSORS_BACKGROUND)) bgLauncher.launch(Manifest.permission.BODY_SENSORS_BACKGROUND)
                        Registrar.register(this@MainActivity)
                        hub.uplink.kick()
                    }
                }

                when {
                    !granted -> PermissionScreen(onRequest = { launcher.launch(first) }, denied = denied)
                    !s.paired -> PairScreen(s, onPin = { hub.uplink.submitPin(it) })
                    else -> MainScreen(s, now, onSend = { hub.uplink.kick() })
                }
            }
        }
    }

    override fun onStart() { super.onStart(); Hub.get(this).uplink.attach() }
    override fun onStop() { Hub.get(this).uplink.detach(); super.onStop() }
}
