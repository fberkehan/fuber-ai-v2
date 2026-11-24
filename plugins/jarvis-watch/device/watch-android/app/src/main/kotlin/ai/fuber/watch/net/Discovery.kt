package ai.fuber.watch.net

import ai.fuber.watch.proto.Xr
import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.SocketException
import java.util.concurrent.ConcurrentHashMap

data class DiscoveredPc(
    val name: String,
    val fp: String,
    val port: Int,
    val pairing: Boolean,
    val host: String,
    val seenAt: Long,
)

/** UDP 47853 yayınlarını dinler (PC `discovery.ts`). Son 10 sn içinde görülenler geçerlidir. */
class DiscoveryListener(private val open: () -> DatagramSocket, private val now: () -> Long = System::currentTimeMillis) {
    private val found = ConcurrentHashMap<String, DiscoveredPc>()
    @Volatile var running = false
        private set
    @Volatile private var socket: DatagramSocket? = null
    private var thread: Thread? = null

    fun start() {
        if (running) return
        running = true
        thread = Thread({ loop() }, "FuberWatchDiscovery").apply { isDaemon = true; start() }
    }

    private fun loop() {
        while (running) {
            val s = try { open() } catch (e: Exception) { sleep(2000); continue }
            socket = s
            val buf = ByteArray(2048)
            try {
                while (running) {
                    val p = DatagramPacket(buf, buf.size)
                    s.receive(p)
                    parse(String(p.data, 0, p.length, Charsets.UTF_8), p.address.hostAddress ?: continue)?.let {
                        found[it.fp + "@" + it.host] = it
                    }
                }
            } catch (e: SocketException) {
                // kapatıldı ya da ağ düştü: yeniden aç
            } catch (e: Exception) {
            } finally {
                try { s.close() } catch (_: Exception) {}
            }
            if (running) sleep(1000)
        }
    }

    private fun sleep(ms: Long) = try { Thread.sleep(ms) } catch (_: InterruptedException) {}

    fun parse(text: String, host: String): DiscoveredPc? = try {
        val o = JSONObject(text)
        if (!o.has("fuberxr")) null else DiscoveredPc(
            name = o.optString("name"), fp = o.optString("f"), port = o.optInt("p", Xr.PORT),
            pairing = o.optBoolean("pairing", false), host = host, seenAt = now(),
        )
    } catch (e: Exception) { null }

    fun current(): List<DiscoveredPc> = found.values.filter { now() - it.seenAt < 10_000 }.sortedByDescending { it.seenAt }

    fun stop() {
        running = false
        try { socket?.close() } catch (_: Exception) {}
        thread?.interrupt()
    }
}
