package ai.fuber.watch.net

import ai.fuber.watch.proto.Bio
import ai.fuber.watch.proto.Crypto
import ai.fuber.watch.proto.Xr
import ai.fuber.watch.proto.XrProtocolException
import android.util.Log
import org.json.JSONObject
import java.io.IOException
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.Executors
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/** Eşleşme kaydı (şifreli saklanır). `deviceId == null` → henüz eşleşmedi (anahtar yine de kalıcıdır). */
class PairingRecord(
    val devicePriv: ByteArray,
    val deviceId: String?,
    val pcFp: String?,
    val pcName: String?,
    val lastHost: String?,
    val port: Int,
)

interface PairingStorage {
    fun load(): PairingRecord?
    fun save(r: PairingRecord)
    fun clear()
}

/** Ağ soyutlaması. Android'de Wi-Fi ağı yalnız gerektiğinde istenir (`acquire`), sonra bırakılır (`release`). */
interface NetAccess {
    /** Wi-Fi ağını ister ve hazır olana dek bekler; olmazsa false. */
    fun acquire(timeoutMs: Long): Boolean
    fun release()
    fun newSocket(): Socket
    fun newUdp(): DatagramSocket
}

enum class Link { SEARCHING, FOUND, PAIRING, IDLE, CONNECTED }

data class UplinkState(
    val link: Link,
    val paired: Boolean,
    val pcName: String? = null,
    val message: String? = null,
    val pending: Int = 0,
    val lastSendAt: Long = 0,
    val lastSendOk: Boolean = false,
    val lastSendCount: Int = 0,
)

class DeviceInfo(val name: String, val model: String, val app: String)

/**
 * Saat → PC gönderici. KALICI bağlantı döngüsü YOK: örnek gelince (`kick`) bağlı değilse resume ile bağlanır, biriken
 * örnekleri (≤30, eskiden yeniye) `bio.sample` olarak yollar, ardından `bio.status` yollar. Bağlantıyı açık bırakır;
 * koparsa sessizce bir sonraki örnekte yeniden bağlanır (üstel bekleme / sonsuz yeniden deneme yok). PC'nin
 * `ping`'lerine `pong` yankısı bir okuyucu iş parçacığında verilir; PC'den 12 sn hiçbir şey gelmediyse bağlantı bayat sayılır.
 * Tüm ağ işleri tek bir arka plan iş parçacığında yapılır (ana iş parçacığında soket yazmak NetworkOnMainThread atar).
 */
class Uplink(
    private val storage: PairingStorage,
    private val net: NetAccess,
    private val info: DeviceInfo,
    private val queue: SampleQueue,
    private val battery: () -> Int,
    private val onState: (UplinkState) -> Unit,
    private val discovery: DiscoveryListener = DiscoveryListener({ net.newUdp() }),
    private val clock: () -> Long = System::currentTimeMillis,
    private val connectTimeoutMs: Long = 2500,
    private val staleAfterMs: Long = 12_000,
    private val releaseDelayMs: Long = 20_000,
) {
    private val exec = Executors.newSingleThreadExecutor { r -> Thread(r, "FuberUplink").apply { isDaemon = true } }
    private val releaseExec = Executors.newSingleThreadScheduledExecutor { r -> Thread(r, "FuberUplinkRel").apply { isDaemon = true } }
    private val pins = LinkedBlockingQueue<String>()

    @Volatile private var session: XrSession? = null
    @Volatile private var lastRx = 0L
    @Volatile private var readerGen = 0
    @Volatile private var ui = false
    @Volatile private var releaseTask: java.util.concurrent.ScheduledFuture<*>? = null
    @Volatile private var held = false
    @Volatile private var pollTask: java.util.concurrent.ScheduledFuture<*>? = null

    @Volatile var state = UplinkState(Link.IDLE, false)
        private set

    private fun set(f: (UplinkState) -> UplinkState) {
        state = f(state).copy(pending = queue.size)
        try { onState(state) } catch (_: Exception) {}
    }

    private fun paired(): Boolean = storage.load()?.deviceId != null

    /** Ekran açıkken: Wi-Fi'yi tut + keşfi dinle (eşleşme için). */
    fun attach() {
        ui = true
        pollTask?.cancel(false)
        // Eşleşmemişken PC yayınını izle: SEARCHING <-> FOUND (PIN tuş takımı FOUND'da açılır)
        pollTask = releaseExec.scheduleWithFixedDelay({
            val st = state
            if (!st.paired && (st.link == Link.SEARCHING || st.link == Link.FOUND)) {
                val pc = discovery.current().firstOrNull { it.pairing }
                if (pc != null && st.link != Link.FOUND) set { it.copy(link = Link.FOUND, pcName = pc.name) }
                else if (pc == null && st.link == Link.FOUND) set { it.copy(link = Link.SEARCHING, pcName = null) }
            }
        }, 500, 700, TimeUnit.MILLISECONDS)
        exec.execute {
            if (!paired()) {
                if (acquire()) discovery.start()
                set { it.copy(link = if (it.paired) it.link else Link.SEARCHING, paired = false) }
            } else {
                set { it.copy(paired = true, link = if (session != null) Link.CONNECTED else Link.IDLE, pcName = storage.load()?.pcName) }
            }
        }
    }

    fun detach() {
        ui = false
        pollTask?.cancel(false)
        exec.execute {
            discovery.stop()
            scheduleRelease()
        }
    }

    /** Yeni örnek geldi / "şimdi gönder": arka planda boşalt. */
    fun kick() { exec.execute { try { flush() } catch (e: Exception) { Log.w(TAG, "flush", e) } } }

    /** Sınama için: eşzamanlı boşaltma. */
    fun flushBlocking() { exec.submit { flush() }.get(60, TimeUnit.SECONDS) }

    fun submitPin(pin: String) { exec.execute { try { pair(pin) } catch (e: Exception) { Log.w(TAG, "pair", e) } } }

    fun forget() {
        exec.execute {
            val r = storage.load() ?: return@execute
            storage.save(PairingRecord(r.devicePriv, null, null, null, null, Xr.PORT))
            closeSession()
            set { it.copy(paired = false, link = Link.SEARCHING, pcName = null, message = null) }
            if (ui && acquire()) discovery.start()
        }
    }

    fun shutdown() { discovery.stop(); closeSession(); exec.shutdownNow(); releaseExec.shutdownNow(); net.release() }

    // ───────── ağ tutma ─────────
    private fun acquire(): Boolean {
        releaseTask?.cancel(false)
        if (held) return true
        held = net.acquire(8000)
        return held
    }

    private fun scheduleRelease() {
        releaseTask?.cancel(false)
        releaseTask = releaseExec.schedule({
            exec.execute { if (!ui && held) { closeSession(); net.release(); held = false; Log.i(TAG, "Wi-Fi birakildi") } }
        }, releaseDelayMs, TimeUnit.MILLISECONDS)
    }

    // ───────── gönderim ─────────
    private fun loadOrCreateKey(): PairingRecord {
        storage.load()?.let { return it }
        val kp = Crypto.keyPair()
        val r = PairingRecord(kp.priv, null, null, null, null, Xr.PORT)
        storage.save(r)
        return r
    }

    private fun alive(): Boolean {
        val s = session ?: return false
        return clock() - lastRx < staleAfterMs && s.isOpen
    }

    private fun flush() {
        val rec = loadOrCreateKey()
        if (rec.deviceId == null) { set { it.copy(paired = false) }; return }
        if (queue.size == 0 && alive()) return
        if (!acquire()) { fail("Wi-Fi yok"); return }
        try {
            var reused = alive()
            if (!reused) { closeSession(); if (!connect(rec)) return }
            var sent = 0
            while (true) {
                try {
                    sent += sendBatch()
                    session!!.send(Bio.status(worn = true, battery = battery(), measuring = true))
                    break
                } catch (e: IOException) {
                    Log.w(TAG, "gönderim hatası: ${e.javaClass.simpleName} ${e.message}")
                    closeSession()
                    if (!reused) { fail("Gönderilemedi: ${e.message}"); return }
                    reused = false // bayat bağlantı: bir kez taze bağlanıp yeniden dene
                    if (!connect(storage.load() ?: rec)) return
                }
            }
            Log.i(TAG, "gonderildi: $sent ornek + durum")
            val now = clock()
            set { it.copy(link = Link.CONNECTED, message = null, lastSendAt = now, lastSendOk = true, lastSendCount = sent) }
        } finally {
            scheduleRelease()
        }
    }

    private fun sendBatch(): Int {
        var n = 0
        for (smp in queue.snapshot().takeLast(30)) {
            session!!.send(smp.toJson())
            queue.remove(smp)
            n++
        }
        return n
    }

    private fun fail(msg: String) {
        Log.i(TAG, "gönderilemedi: $msg")
        set { it.copy(link = if (it.paired) Link.IDLE else it.link, message = msg, lastSendOk = false, lastSendAt = clock()) }
    }

    private fun connectSocket(host: String, port: Int): Socket? {
        val s = try { net.newSocket() } catch (e: Exception) { return null }
        return try { s.connect(InetSocketAddress(host, port), connectTimeoutMs.toInt()); s } catch (e: Exception) {
            try { s.close() } catch (_: Exception) {}
            null
        }
    }

    /** Resume ile bağlanır: önce son bilinen IP, olmazsa UDP keşif (≤3 sn). */
    private fun connect(rec: PairingRecord): Boolean {
        val key = Crypto.keyPair(rec.devicePriv)
        val hosts = LinkedHashSet<Pair<String, Int>>()
        rec.lastHost?.let { hosts.add(it to rec.port) }
        var triedDiscovery = false
        while (true) {
            for ((host, port) in hosts.toList()) {
                val sock = connectSocket(host, port) ?: continue
                val res = try {
                    XrClient.handshake(sock, HandshakeMode.RESUME, key, rec.deviceId, rec.pcFp, null, info.name, info.model, info.app)
                } catch (e: Exception) {
                    sock.close()
                    if (e is XrProtocolException && e.code == "bad_fp") { fail("PC parmak izi değişti"); return false }
                    continue
                }
                when (res) {
                    is Handshake.Rejected -> {
                        sock.close()
                        if (res.code == "unknown_device") {
                            storage.save(PairingRecord(rec.devicePriv, null, null, null, null, Xr.PORT))
                            set { it.copy(paired = false, link = Link.SEARCHING, pcName = null, message = "PC bu saati tanımıyor. Yeniden eşleştirin.") }
                            return false
                        }
                        Log.i(TAG, "resume reddedildi: ${res.code}")
                    }
                    is Handshake.Ok -> {
                        storage.save(PairingRecord(rec.devicePriv, rec.deviceId, rec.pcFp, res.pcName.ifEmpty { rec.pcName }, host, port))
                        startReader(res.session)
                        set { it.copy(paired = true, link = Link.CONNECTED, pcName = res.pcName.ifEmpty { rec.pcName }, message = null) }
                        Log.i(TAG, "bağlandı $host:$port")
                        return true
                    }
                }
            }
            if (triedDiscovery) break
            triedDiscovery = true
            if (!discovery.running) discovery.start()
            val end = clock() + 3000
            while (clock() < end && hosts.isEmpty()) {
                discovery.current().filter { it.fp == rec.pcFp }.forEach { hosts.add(it.host to it.port) }
                if (hosts.isEmpty()) Thread.sleep(200)
            }
            if (!ui) discovery.stop()
            if (hosts.isEmpty()) break
        }
        fail("PC bulunamadı")
        return false
    }

    private fun closeSession() {
        readerGen++
        session?.close()
        session = null
    }

    /** Okuyucu: PC `ping`'ine `pong` yankısı; kapanmayı fark eder. */
    private fun startReader(s: XrSession) {
        closeSession()
        session = s
        lastRx = clock()
        val gen = ++readerGen
        s.setReadTimeout(1000)
        Thread({
            try {
                while (readerGen == gen) {
                    val msg = s.poll() ?: continue
                    lastRx = clock()
                    val j = try { JSONObject(msg) } catch (e: Exception) { continue }
                    when (j.optString("t")) {
                        "ping" -> try { s.send("{\"t\":\"pong\",\"ts\":${tsRaw(j)}}") } catch (e: IOException) { break }
                        "bye" -> { Log.i(TAG, "bye: ${j.optString("reason")}"); break }
                    }
                }
            } catch (e: Exception) {
                if (readerGen == gen) Log.i(TAG, "bağlantı koptu: ${e.javaClass.simpleName} ${e.message}")
            } finally {
                if (readerGen == gen) { session = null; s.close(); set { it.copy(link = if (it.paired) Link.IDLE else it.link) } }
            }
        }, "FuberUplinkRx").apply { isDaemon = true; start() }
    }

    private fun tsRaw(j: JSONObject): String {
        val v = j.opt("ts")
        return if (v is Number) { val d = v.toDouble(); if (d == Math.rint(d)) d.toLong().toString() else v.toString() } else clock().toString()
    }

    // ───────── eşleşme (ekran açıkken, PIN ile) ─────────
    private fun pair(pin: String) {
        val rec = loadOrCreateKey()
        val pcs = discovery.current().filter { it.pairing }
        if (pcs.isEmpty()) { set { it.copy(link = Link.SEARCHING, message = "PC bulunamadı. Masaüstünde eşleştirmeyi açın.") }; return }
        val pc = pcs.first()
        set { it.copy(link = Link.PAIRING, pcName = pc.name, message = null) }
        if (!acquire()) { set { it.copy(link = Link.FOUND, message = "Wi-Fi yok") }; return }
        val sock = connectSocket(pc.host, pc.port) ?: run {
            set { it.copy(link = Link.FOUND, message = "PC'ye bağlanılamadı") }; return
        }
        val key = Crypto.keyPair(rec.devicePriv)
        val res = try {
            XrClient.handshake(sock, HandshakeMode.PAIR, key, null, pc.fp, pin, info.name, info.model, info.app)
        } catch (e: Exception) {
            sock.close()
            set { it.copy(link = Link.FOUND, message = if (e is XrProtocolException) "Güvenlik hatası: ${e.code}" else "Bağlantı koptu") }
            return
        }
        when (res) {
            is Handshake.Rejected -> {
                sock.close()
                val msg = when (res.code) {
                    "bad_code", "closed" -> "PIN yanlış ya da süresi doldu"
                    "not_pairing" -> "PC'de eşleştirme kapalı"
                    "wrong_kind" -> "Yanlış eşleşme penceresi (PC'de Saat sayfasını açın)"
                    else -> "Reddedildi: ${res.code}"
                }
                set { it.copy(link = Link.FOUND, message = msg) }
            }
            is Handshake.Ok -> {
                val name = res.pcName.ifEmpty { pc.name }
                storage.save(PairingRecord(rec.devicePriv, res.deviceId, res.serverFp, name, pc.host, pc.port))
                startReader(res.session)
                discovery.stop()
                set { it.copy(paired = true, link = Link.CONNECTED, pcName = name, message = null) }
                flush()
            }
        }
    }

    companion object { const val TAG = "FuberWatch" }
}
