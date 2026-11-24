package ai.fuber.watch

import ai.fuber.watch.net.DeviceInfo
import ai.fuber.watch.net.DiscoveryListener
import ai.fuber.watch.net.Handshake
import ai.fuber.watch.net.HandshakeMode
import ai.fuber.watch.net.Link
import ai.fuber.watch.net.NetAccess
import ai.fuber.watch.net.PairingRecord
import ai.fuber.watch.net.PairingStorage
import ai.fuber.watch.net.Sample
import ai.fuber.watch.net.SampleQueue
import ai.fuber.watch.net.Uplink
import ai.fuber.watch.net.UplinkState
import ai.fuber.watch.net.XrClient
import ai.fuber.watch.proto.Bio
import ai.fuber.watch.proto.Crypto
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.InetAddress
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit

/**
 * PC'deki GERÇEK masaüstü köprü sunucusuna (node, `tools/build-e2e-server.mjs` ile paketlenir) karşı uçtan uca sınama.
 * `build/e2e-server.mjs` yoksa (ya da FUBER_E2E_SERVER gösterilmemişse) atlanır.
 */
class E2ETest {
    private var proc: Process? = null
    private val lines = LinkedBlockingQueue<String>()
    private var port = 0
    private var fp = ""

    private fun serverFile(): File? {
        val env = System.getenv("FUBER_E2E_SERVER")?.let(::File)
        return listOfNotNull(env, File("../build/e2e-server.mjs"), File("build/e2e-server.mjs")).firstOrNull { it.isFile }
    }

    @Before fun start() {
        val f = serverFile()
        assumeTrue("e2e sunucusu paketlenmemiş (tools/build-e2e-server.mjs)", f != null)
        val p = ProcessBuilder("node", f!!.absolutePath).redirectErrorStream(true).start()
        proc = p
        Thread { p.inputStream.bufferedReader().forEachLine { lines.put(it) } }.apply { isDaemon = true; start() }
        val j = JSONObject(waitFor("READY ").removePrefix("READY "))
        port = j.getInt("port"); fp = j.getString("fp")
    }

    @After fun stop() {
        cmd("quit")
        proc?.waitFor(3, TimeUnit.SECONDS)
        proc?.destroyForcibly()
    }

    private fun cmd(c: String) { try { proc?.outputStream?.apply { write("$c\n".toByteArray()); flush() } } catch (_: Exception) {} }

    private fun waitFor(prefix: String, ms: Long = 8000): String {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) {
            val l = lines.poll(200, TimeUnit.MILLISECONDS) ?: continue
            if (l.startsWith(prefix)) return l
        }
        throw AssertionError("beklenen çıktı gelmedi: $prefix")
    }

    private fun connect(): Socket = Socket("127.0.0.1", port)

    @Test fun pair_resume_ve_veri_akisi() {
        val key = Crypto.keyPair()
        connect().use { s ->
            val r = XrClient.handshake(s, HandshakeMode.PAIR, key, null, fp, "000000", "Fuber Saat", "Galaxy Watch SM-R870", "0.2.0")
            assertTrue(r is Handshake.Rejected)
        }
        val s1 = connect()
        val ok = XrClient.handshake(s1, HandshakeMode.PAIR, key, null, fp, "123456", "Fuber Saat", "Galaxy Watch SM-R870", "0.2.0")
        assertTrue("eşleşme: $ok", ok is Handshake.Ok)
        ok as Handshake.Ok
        assertEquals(fp, ok.serverFp)
        assertNotNull(ok.deviceId)
        assertEquals("Fuber PC (e2e)", ok.pcName)

        val sample = Bio.sample(1700000000000, hr = 73, hrAcc = "high", steps = 5421, kcal = 312)
        val status = Bio.status(true, 88, true)
        ok.session.send(sample); ok.session.send(status)
        assertEquals(JSONObject(sample).toString(), JSONObject(waitFor("MSG {\"t\":\"bio.sample\"").removePrefix("MSG ")).toString())
        assertEquals(JSONObject(status).toString(), JSONObject(waitFor("MSG {\"t\":\"bio.status\"").removePrefix("MSG ")).toString())
        ok.session.send(Bio.ping(42))
        ok.session.setReadTimeout(3000)
        assertEquals("pong", JSONObject(ok.session.poll()!!).getString("t"))
        ok.session.close()

        val s2 = connect()
        val res = XrClient.handshake(s2, HandshakeMode.RESUME, key, ok.deviceId, fp, null, "Fuber Saat", "Galaxy Watch SM-R870", "0.2.0")
        assertTrue("resume: $res", res is Handshake.Ok)
        res as Handshake.Ok
        res.session.send(Bio.sample(1700000001000, hr = 80))
        assertTrue(waitFor("MSG {\"t\":\"bio.sample\"").contains("\"hr\":80"))
        res.session.close()

        connect().use { s ->
            val r = XrClient.handshake(s, HandshakeMode.RESUME, key, "yok-boyle-bir-cihaz", fp, null, "x", "Galaxy Watch", "0.2.0")
            assertEquals("unknown_device", (r as Handshake.Rejected).code)
        }
    }

    @Test fun yanlis_parmak_izi_reddedilir() {
        connect().use { s ->
            try {
                XrClient.handshake(s, HandshakeMode.PAIR, Crypto.keyPair(), null, "x".repeat(43), "123456", "x", "Galaxy Watch", "0.2.0")
                throw AssertionError("fırlatmalıydı")
            } catch (e: ai.fuber.watch.proto.XrProtocolException) {
                assertEquals("bad_fp", e.code)
            }
        }
    }

    // ───────── Uplink: PIN ile eşleş → örnekler sırayla, gerçek ts ile → kopma → SESSİZ yeniden bağlanma ─────────

    private class MemStore : PairingStorage {
        @Volatile var rec: PairingRecord? = null
        override fun load() = rec
        override fun save(r: PairingRecord) { rec = r }
        override fun clear() { rec = null }
    }

    private class Direct : NetAccess {
        var acquires = 0
        var releases = 0
        override fun acquire(timeoutMs: Long): Boolean { acquires++; return true }
        override fun release() { releases++ }
        override fun newSocket() = Socket()
        override fun newUdp() = DatagramSocket(0)
    }

    private fun msgs(prefix: String, n: Int): List<JSONObject> = (1..n).map { JSONObject(waitFor(prefix).removePrefix("MSG ")) }

    @Test fun uplink_tam_akis() {
        val store = MemStore()
        val net = Direct()
        val states = CopyOnWriteArrayList<UplinkState>()
        val udp = DatagramSocket(0, InetAddress.getByName("127.0.0.1"))
        val queue = SampleQueue(null)
        val up = Uplink(
            storage = store, net = net, info = DeviceInfo("Fuber Saat", "Galaxy Watch SM-R870", "0.2.0"),
            queue = queue, battery = { 77 }, onState = { states.add(it) },
            discovery = DiscoveryListener({ udp }), releaseDelayMs = 200, staleAfterMs = 4000,
        )
        try {
            up.attach()
            await("PC aranıyor") { states.any { it.link == Link.SEARCHING } }
            val payload = "{\"fuberxr\":1,\"name\":\"Fuber PC (e2e)\",\"p\":$port,\"f\":\"$fp\",\"pairing\":true}".toByteArray()
            fun beacon() = DatagramSocket().use { it.send(DatagramPacket(payload, payload.size, InetAddress.getByName("127.0.0.1"), udp.localPort)) }
            await("PC bulundu") { beacon(); Thread.sleep(100); up.state.link == Link.FOUND }

            // Eşleşmeden ÖNCE gelen örnekler kuyrukta bekler
            queue.add(Sample(1_700_000_000_000, hr = 61, acc = "high"))
            queue.add(Sample(1_700_000_060_000, hr = 64, acc = "medium"))
            up.submitPin("123456")
            await("eşleşti ve gönderdi", 12000) { up.state.paired && up.state.lastSendOk }
            assertNotNull(store.rec?.deviceId)

            // SIRAYLA ve GERÇEK ölçüm zamanıyla
            val got = msgs("MSG {\"t\":\"bio.sample\"", 2)
            assertEquals(listOf(1_700_000_000_000L, 1_700_000_060_000L), got.map { it.getLong("ts") })
            assertEquals(listOf(61, 64), got.map { it.getInt("hr") })
            assertEquals(0, queue.size)
            val st = JSONObject(waitFor("MSG {\"t\":\"bio.status\"").removePrefix("MSG "))
            assertEquals(77, st.getInt("battery")); assertTrue(st.getBoolean("worn"))

            // PC ping → saat pong yankılar (aynı ts)
            cmd("ping")
            val pong = JSONObject(waitFor("MSG {\"t\":\"pong\"").removePrefix("MSG "))
            assertEquals(1795018528569L, pong.getLong("ts"))

            // bağlantı düşer; yeni örnekte SESSİZCE yeniden bağlanır (resume), örnek PC'ye gider
            cmd("drop")
            waitFor("DISCONNECT")
            await("kopma fark edildi") { up.state.link != Link.CONNECTED }
            val before = states.size
            queue.add(Sample(1_700_000_120_000, hr = 70, acc = "high"))
            up.kick()
            val m = msgs("MSG {\"t\":\"bio.sample\"", 1)[0]
            assertEquals(1_700_000_120_000L, m.getLong("ts")); assertEquals(70, m.getInt("hr"))
            await("yeniden bağlı") { up.state.lastSendOk && up.state.link == Link.CONNECTED && states.size > before }

            // PC'ye ulaşılamıyorsa: sonsuz yeniden deneme yok, örnek kuyrukta kalır
            cmd("quit")
            Thread.sleep(500)
            queue.add(Sample(1_700_000_180_000, hr = 72))
            up.flushBlocking()
            assertEquals(1, queue.size)
            assertTrue(!up.state.lastSendOk)
        } finally {
            up.shutdown(); udp.close()
        }
    }

    private fun await(what: String, ms: Long = 8000, cond: () -> Boolean) {
        val end = System.currentTimeMillis() + ms
        while (System.currentTimeMillis() < end) { if (cond()) return; Thread.sleep(50) }
        throw AssertionError("zaman aşımı: $what")
    }
}
