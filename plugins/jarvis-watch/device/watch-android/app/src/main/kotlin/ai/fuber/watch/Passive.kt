package ai.fuber.watch

import ai.fuber.watch.net.DeviceInfo
import ai.fuber.watch.net.KeystorePairingStorage
import ai.fuber.watch.net.Link
import ai.fuber.watch.net.Sample
import ai.fuber.watch.net.SampleQueue
import ai.fuber.watch.net.Uplink
import ai.fuber.watch.net.WifiNet
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.health.services.client.HealthServices
import androidx.health.services.client.PassiveListenerService
import androidx.health.services.client.data.DataPointContainer
import androidx.health.services.client.data.DataType
import androidx.health.services.client.data.HeartRateAccuracy
import androidx.health.services.client.data.PassiveListenerConfig
import kotlinx.coroutines.guava.await
import java.io.File
import java.time.Instant

private const val TAG = "FuberWatch"

/** Süreç içi tek örnek: kuyruk + gönderici. Servis, etkinlik ve alıcı aynısını kullanır. */
object Hub {
    private var started = false
    lateinit var queue: SampleQueue
    lateinit var uplink: Uplink
    private lateinit var app: Context

    @Synchronized fun get(ctx: Context): Hub {
        if (started) return this
        app = ctx.applicationContext
        queue = SampleQueue(File(app.filesDir, "samples.jsonl"))
        val net = WifiNet(app)
        uplink = Uplink(
            storage = KeystorePairingStorage(app),
            net = net,
            info = DeviceInfo("Fuber Saat", "Galaxy Watch " + Build.MODEL, BuildConfig.VERSION_NAME),
            queue = queue,
            battery = { battery() },
            onState = { s ->
                WatchRuntime.update {
                    it.copy(
                        link = s.link, paired = s.paired, pcName = s.pcName ?: it.pcName, linkMessage = s.message, pending = s.pending,
                        lastSendAt = s.lastSendAt, lastSendOk = s.lastSendOk, lastSendCount = s.lastSendCount,
                    )
                }
                if (s.lastSendAt > 0) Prefs.saveSend(app, s.lastSendAt, s.lastSendOk, s.lastSendCount)
            },
        )
        Prefs.restore(app)
        started = true
        return this
    }

    fun battery(): Int {
        val i = app.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return 0
        val level = i.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
        val scale = i.getIntExtra(BatteryManager.EXTRA_SCALE, 100)
        return if (level < 0) 0 else level * 100 / scale
    }
}

/** Son nabız ve son gönderim durumu uygulama kapanınca da ekranda kalsın. */
object Prefs {
    private fun p(c: Context) = c.getSharedPreferences("fuber_watch_ui", Context.MODE_PRIVATE)

    fun saveHr(c: Context, hr: Int, ts: Long, acc: String?) =
        p(c).edit().putInt("hr", hr).putLong("hrTs", ts).putString("acc", acc).apply()

    fun saveSend(c: Context, at: Long, ok: Boolean, n: Int) =
        p(c).edit().putLong("sendAt", at).putBoolean("sendOk", ok).putInt("sendN", n).apply()

    fun restore(c: Context) {
        val s = p(c)
        WatchRuntime.update {
            it.copy(
                hr = if (s.contains("hr")) s.getInt("hr", 0) else null, hrTs = s.getLong("hrTs", 0), hrAcc = s.getString("acc", null),
                lastSendAt = s.getLong("sendAt", 0), lastSendOk = s.getBoolean("sendOk", false), lastSendCount = s.getInt("sendN", 0),
            )
        }
    }
}

fun mapAccuracy(status: HeartRateAccuracy.SensorStatus?): String? = when (status) {
    HeartRateAccuracy.SensorStatus.ACCURACY_HIGH -> "high"
    HeartRateAccuracy.SensorStatus.ACCURACY_MEDIUM -> "medium"
    HeartRateAccuracy.SensorStatus.ACCURACY_LOW, HeartRateAccuracy.SensorStatus.UNRELIABLE -> "low"
    else -> null
}

/**
 * Health Services pasif dinleyici: saat kendi nabzını/adımını/kalorisini ölçtükçe sistem bu servisi uyandırır (uygulama
 * kapalıyken de). Her nabız örneği GERÇEK ölçüm zamanıyla kuyruğa girer ve PC'ye gönderilir. Ön plan servisi yok.
 */
class PassiveHrService : PassiveListenerService() {
    override fun onNewDataPointsReceived(dataPoints: DataPointContainer) {
        val hub = Hub.get(this)
        val bootInstant = Instant.ofEpochMilli(System.currentTimeMillis() - SystemClock.elapsedRealtime())
        var newest: Sample? = null
        var n = 0
        for (dp in dataPoints.getData(DataType.HEART_RATE_BPM)) {
            val bpm = dp.value.toInt()
            if (bpm <= 0) continue
            val ts = dp.getTimeInstant(bootInstant).toEpochMilli()
            val s = Sample(ts, hr = bpm, acc = mapAccuracy((dp.accuracy as? HeartRateAccuracy)?.sensorStatus))
            hub.queue.add(s); n++
            if (newest == null || ts > newest.ts) newest = s
        }
        val now = System.currentTimeMillis()
        val steps = dataPoints.getData(DataType.STEPS_DAILY).lastOrNull()?.value?.toInt()
        val kcal = dataPoints.getData(DataType.CALORIES_DAILY).lastOrNull()?.value?.toInt()
        if (steps != null || kcal != null) hub.queue.add(Sample(now, steps = steps, kcal = kcal))
        Log.i(TAG, "pasif veri: nabız=$n adım=$steps kcal=$kcal son=${newest?.hr}@${newest?.ts}")

        WatchRuntime.update {
            it.copy(
                hr = newest?.hr ?: it.hr, hrTs = newest?.ts ?: it.hrTs, hrAcc = if (newest != null) newest.acc else it.hrAcc,
                steps = steps ?: it.steps, kcal = kcal ?: it.kcal,
            )
        }
        newest?.let { Prefs.saveHr(this, it.hr!!, it.ts, it.acc) }

        val wl = getSystemService(PowerManager::class.java).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "fuberwatch:flush")
        wl.acquire(30_000)
        hub.uplink.kick()
    }

    override fun onPermissionLost() {
        Log.w(TAG, "pasif izin kayboldu")
        WatchRuntime.update { it.copy(sensorNote = "Nabız izni kayboldu") }
    }
}

object Registrar {
    /** Pasif dinleyiciyi (nabız + günlük adım/kalori) kaydeder; desteklenmeyenleri UI notuna yazar. */
    suspend fun register(ctx: Context) {
        val client = HealthServices.getClient(ctx).passiveMonitoringClient
        val wanted = setOf(DataType.HEART_RATE_BPM, DataType.STEPS_DAILY, DataType.CALORIES_DAILY)
        val sup = try { client.getCapabilitiesAsync().await().supportedDataTypesPassiveMonitoring } catch (e: Exception) { emptySet() }
        val use = wanted.filter { sup.contains(it) }.toSet()
        val missing = wanted.filter { !sup.contains(it) }.map {
            when (it) { DataType.HEART_RATE_BPM -> "nabız"; DataType.STEPS_DAILY -> "adım"; else -> "kalori" }
        }
        Log.i(TAG, "pasif destek: ${sup.map { it.name }} eksik=$missing")
        WatchRuntime.update { it.copy(sensorNote = if (missing.isEmpty()) null else missing.joinToString("/") + " pasif desteklenmiyor") }
        if (use.isEmpty()) return
        val config = PassiveListenerConfig.builder().setDataTypes(use).build()
        try {
            client.setPassiveListenerServiceAsync(PassiveHrService::class.java, config).await()
            Log.i(TAG, "pasif dinleyici kaydedildi: ${use.map { it.name }}")
        } catch (e: Exception) {
            Log.w(TAG, "pasif kayıt hatası", e)
            WatchRuntime.update { it.copy(sensorNote = "Kayıt hatası: ${e.message}") }
        }
    }
}

/** Yeniden başlatmada pasif kaydı tazeler. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val pending = goAsync()
        Thread {
            try { kotlinx.coroutines.runBlocking { Registrar.register(context.applicationContext) } } finally { pending.finish() }
        }.start()
    }
}
