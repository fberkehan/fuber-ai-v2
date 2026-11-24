package ai.fuber.watch.net

import ai.fuber.watch.proto.Xr
import ai.fuber.watch.proto.hex
import ai.fuber.watch.proto.unhex
import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import org.json.JSONObject
import java.net.DatagramSocket
import java.net.InetSocketAddress
import java.net.Socket
import java.security.KeyStore
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Wi-Fi'yi açık tutar ve soketleri o ağa bağlar. Telefon üzerinden Bluetooth proxy'si varken bile saat kendi
 * Wi-Fi'siyle LAN'a çıkar: `requestNetwork(TRANSPORT_WIFI)` Wi-Fi radyosunu uyanık tutar.
 */
class WifiNet(context: Context) : NetAccess {
    private val cm = context.getSystemService(ConnectivityManager::class.java)
    private val wifi = context.applicationContext.getSystemService(WifiManager::class.java)
    @Volatile private var network: Network? = null
    private var callback: ConnectivityManager.NetworkCallback? = null
    private var multicast: WifiManager.MulticastLock? = null

    @Synchronized override fun acquire(timeoutMs: Long): Boolean {
        if (callback != null && network != null) return true
        release()
        val latch = CountDownLatch(1)
        val req = NetworkRequest.Builder()
            .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
            .addCapability(NetworkCapabilities.NET_CAPABILITY_NOT_VPN)
            .build()
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(n: Network) { network = n; latch.countDown() }
            override fun onLost(n: Network) { if (network == n) network = null }
        }
        callback = cb
        try { cm.requestNetwork(req, cb, timeoutMs.toInt().coerceAtLeast(1000)) } catch (e: Exception) { callback = null; return false }
        multicast = wifi?.createMulticastLock("fuber-watch-discovery")?.also { it.setReferenceCounted(false); try { it.acquire() } catch (_: Exception) {} }
        val ok = latch.await(timeoutMs, TimeUnit.MILLISECONDS) && network != null
        if (!ok) release()
        return ok
    }

    @Synchronized override fun release() {
        callback?.let { try { cm.unregisterNetworkCallback(it) } catch (_: Exception) {} }
        callback = null
        network = null
        try { multicast?.release() } catch (_: Exception) {}
        multicast = null
    }

    override fun newSocket(): Socket {
        val n = network ?: throw IllegalStateException("Wi-Fi yok")
        return n.socketFactory.createSocket()
    }

    override fun newUdp(): DatagramSocket {
        val n = network ?: throw IllegalStateException("Wi-Fi yok")
        val s = DatagramSocket(null)
        s.reuseAddress = true
        s.broadcast = true
        s.bind(InetSocketAddress(Xr.DISCOVERY_PORT))
        n.bindSocket(s)
        return s
    }
}

/** Eşleşme kaydı: AndroidKeyStore'daki AES-256-GCM anahtarıyla şifrelenmiş JSON, SharedPreferences'ta. */
class KeystorePairingStorage(context: Context) : PairingStorage {
    private val prefs = context.getSharedPreferences("fuber_watch_pairing", Context.MODE_PRIVATE)

    private fun key(): SecretKey {
        val ks = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (ks.getKey(ALIAS, null) as? SecretKey)?.let { return it }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
        gen.init(
            KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build(),
        )
        return gen.generateKey()
    }

    @Synchronized override fun load(): PairingRecord? {
        val blob = prefs.getString("blob", null) ?: return null
        return try {
            val raw = Base64.decode(blob, Base64.NO_WRAP)
            val c = Cipher.getInstance("AES/GCM/NoPadding")
            c.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, raw.copyOfRange(0, 12)))
            val j = JSONObject(String(c.doFinal(raw, 12, raw.size - 12), Charsets.UTF_8))
            PairingRecord(
                j.getString("priv").unhex(), j.optString("id").ifEmpty { null }, j.optString("fp").ifEmpty { null },
                j.optString("pc").ifEmpty { null }, j.optString("host").ifEmpty { null }, j.optInt("port", Xr.PORT),
            )
        } catch (e: Exception) {
            null // anahtar kaybolduysa/bozuksa eşleşme baştan
        }
    }

    @Synchronized override fun save(r: PairingRecord) {
        val j = JSONObject()
            .put("priv", r.devicePriv.hex()).put("id", r.deviceId ?: "").put("fp", r.pcFp ?: "")
            .put("pc", r.pcName ?: "").put("host", r.lastHost ?: "").put("port", r.port)
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, key())
        val ct = c.doFinal(j.toString().toByteArray(Charsets.UTF_8))
        prefs.edit().putString("blob", Base64.encodeToString(c.iv + ct, Base64.NO_WRAP)).apply()
    }

    @Synchronized override fun clear() { prefs.edit().clear().apply() }

    private companion object { const val ALIAS = "fuber_watch_pairing_v1" }
}
