package ai.fuber.watch

import ai.fuber.watch.proto.Bio
import ai.fuber.watch.proto.CipherState
import ai.fuber.watch.proto.Crypto
import ai.fuber.watch.proto.FrameDecoder
import ai.fuber.watch.proto.Frames
import ai.fuber.watch.proto.Plain
import ai.fuber.watch.proto.XrProtocolException
import ai.fuber.watch.proto.b64u
import ai.fuber.watch.proto.clientKeys
import ai.fuber.watch.proto.decodePlain
import ai.fuber.watch.proto.fromB64u
import ai.fuber.watch.proto.hex
import ai.fuber.watch.proto.nonceFor
import ai.fuber.watch.proto.unhex
import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test

/** Masaüstü `protokol-test-vektoru.json` ile bayt bayt karşılaştırma (aynı dosya TS ve Unity tarafında da kullanılır). */
class ProtocolTest {
    private val v = JSONObject(javaClass.getResource("/protokol-test-vektoru.json")!!.readText())

    @Test fun x25519_keypairs() {
        val arr = v.getJSONArray("x25519_keypairs")
        for (i in 0 until arr.length()) {
            val k = arr.getJSONObject(i)
            assertEquals(k.getString("pub"), Crypto.publicFromPrivate(k.getString("priv").unhex()).hex())
        }
    }

    @Test fun x25519_dh() {
        val d = v.getJSONObject("x25519_dh")
        val shared = Crypto.x25519(d.getString("aPriv").unhex(), d.getString("bPub").unhex())
        assertEquals(d.getString("shared"), shared.hex())
        val shared2 = Crypto.x25519(d.getString("bPriv").unhex(), d.getString("aPub").unhex())
        assertEquals(d.getString("shared"), shared2.hex())
    }

    @Test fun x25519_sifir_sonuc_reddedilir() {
        try {
            Crypto.x25519(ByteArray(32) { 1 }, ByteArray(32)) // küçük dereceli nokta
            fail("fırlatmalıydı")
        } catch (e: XrProtocolException) {
            assertEquals("bad_key", e.code)
        }
    }

    @Test fun parmak_izi() {
        val f = v.getJSONObject("fingerprint")
        val fp = Crypto.fingerprint(f.getString("pub").unhex())
        assertEquals(f.getString("fp"), fp)
        assertEquals(43, fp.length)
    }

    private fun session(name: String, withDevice: Boolean) {
        val s = v.getJSONObject(name)
        val ce = Crypto.keyPair(s.getString("clientEphPriv").unhex())
        val se = Crypto.keyPair(s.getString("serverEphPriv").unhex())
        val ss = Crypto.keyPair(s.getString("serverStaticPriv").unhex())
        val dev = if (withDevice) Crypto.keyPair(s.getString("devicePriv").unhex()) else null
        val keys = clientKeys(ce, se.pub, ss.pub, dev, s.getString("hello1_utf8").toByteArray(), s.getString("hello2_utf8").toByteArray())
        assertEquals(s.getString("th"), keys.th.hex())
        assertEquals(s.getString("okm"), keys.okm.hex())
        assertEquals(s.getString("c2s"), keys.c2s.hex())
        assertEquals(s.getString("s2c"), keys.s2c.hex())
    }

    @Test fun hkdf_pair() = session("hkdf_session_pair", false)
    @Test fun hkdf_resume() = session("hkdf_session_resume", true)

    @Test fun aes_gcm_vektor() {
        val g = v.getJSONObject("aes_gcm")
        val key = g.getString("key").unhex()
        val sealer = CipherState(key)
        val opener = CipherState(key)
        val seals = g.getJSONArray("seals")
        for (i in 0 until seals.length()) {
            val s = seals.getJSONObject(i)
            assertEquals(s.getString("nonce"), nonceFor(s.getLong("counter")).hex())
            val sealed = sealer.seal(s.getString("plain_utf8").toByteArray(Charsets.UTF_8))
            assertEquals(s.getString("sealed"), sealed.hex())
            assertEquals(s.getString("plain_utf8"), String(opener.open(s.getString("sealed").unhex()), Charsets.UTF_8))
        }
    }

    @Test fun aes_gcm_sira_disi_ve_bozuk_reddedilir() {
        val key = ByteArray(32) { it.toByte() }
        val a = CipherState(key)
        val b = CipherState(key)
        val c0 = a.seal("bir".toByteArray())
        val c1 = a.seal("iki".toByteArray())
        try { b.open(c1); fail() } catch (e: XrProtocolException) { assertEquals("decrypt", e.code) }
        assertEquals("bir", String(b.open(c0)))
        val bad = c1.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() }
        try { b.open(bad); fail() } catch (e: XrProtocolException) { assertEquals("decrypt", e.code) }
    }

    @Test fun cerceve_vektor() {
        val f = v.getJSONObject("frame")
        assertEquals(f.getString("encoded"), Frames.encode(f.getString("body").unhex()).hex())
        val frames = FrameDecoder().push(f.getString("encoded").unhex())
        assertEquals(1, frames.size)
        assertEquals(f.getString("body"), frames[0].hex())
    }

    @Test fun cerceve_parcali_akis_ve_sinirlar() {
        val d = FrameDecoder()
        val all = Frames.encode("abc".toByteArray()) + Frames.encode("defgh".toByteArray())
        val got = mutableListOf<String>()
        for (b in all) d.push(byteArrayOf(b)).forEach { got.add(String(it)) }
        assertEquals(listOf("abc", "defgh"), got)
        try { Frames.encode(ByteArray(0)); fail() } catch (e: XrProtocolException) { assertEquals("frame_size", e.code) }
        try { FrameDecoder().push(byteArrayOf(0, 0, 0, 0)); fail() } catch (e: XrProtocolException) { assertEquals("frame_size", e.code) }
        try { FrameDecoder().push(byteArrayOf(0x7f, 0, 0, 0)); fail() } catch (e: XrProtocolException) { assertEquals("frame_size", e.code) }
    }

    @Test fun duz_json_vektor() {
        val p = v.getJSONObject("plain_json")
        assertEquals(p.getString("encoded"), Frames.encodeJson(Bio.ping(1234567890)).hex())
        val d = decodePlain(p.getString("encoded").unhex()) as Plain.Json
        assertEquals("ping", JSONObject(d.json).getString("t"))
    }

    @Test fun duz_ikili_vektor() {
        val p = v.getJSONObject("plain_binary")
        assertEquals(p.getString("encoded"), Frames.encodeBinary(p.getInt("channel"), p.getLong("seq"), p.getString("data").unhex()).hex())
        val d = decodePlain(p.getString("encoded").unhex()) as Plain.Binary
        assertEquals(1, d.channel); assertEquals(7L, d.seq)
        assertArrayEquals(p.getString("data").unhex(), d.data)
    }

    @Test fun base64url_kanonik() {
        val raw = ByteArray(32) { it.toByte() }
        assertArrayEquals(raw, fromB64u(b64u(raw), 32))
        try { fromB64u("AA==", null); fail() } catch (e: XrProtocolException) { assertEquals("bad_b64", e.code) }
        try { fromB64u("AAAA", 32); fail() } catch (e: XrProtocolException) { assertEquals("bad_b64", e.code) }
    }

    // ───────── sözleşme iletileri ─────────

    @Test fun bio_sample_yalniz_olculenler() {
        assertEquals("{\"t\":\"bio.sample\",\"ts\":1700000000000}", Bio.sample(1700000000000))
        val full = Bio.sample(1, hr = 73, hrAcc = "high", spo2 = 98, steps = 5421, kcal = 312, skinTemp = 33.1, ibi = listOf(812, 790))
        assertEquals(
            "{\"t\":\"bio.sample\",\"ts\":1,\"hr\":73,\"hrAcc\":\"high\",\"spo2\":98,\"steps\":5421,\"kcal\":312,\"skinTemp\":33.1,\"ibi\":[812,790]}",
            full,
        )
        val j = JSONObject(Bio.sample(5, hr = 60, steps = 10))
        assertFalse(j.has("spo2")); assertFalse(j.has("skinTemp")); assertFalse(j.has("kcal")); assertFalse(j.has("hrAcc"))
        assertEquals(60, j.getInt("hr"))
    }

    @Test fun bio_status() {
        val j = JSONObject(Bio.status(worn = true, battery = 87, measuring = false))
        assertTrue(j.getBoolean("worn")); assertEquals(87, j.getInt("battery")); assertFalse(j.getBoolean("measuring"))
        assertEquals(100, JSONObject(Bio.status(true, 140, true)).getInt("battery"))
    }

    @Test fun pair_mesaji_watch_kimligi_tasir() {
        val j = JSONObject(Bio.pair("Fuber Saat", ByteArray(32) { 7 }, "Galaxy Watch SM-R890", "0.1.0", "042917"))
        assertEquals("pair", j.getString("t"))
        assertEquals("watch", j.getString("kind"))
        assertEquals("042917", j.getString("pin")) // baştaki sıfır korunur
        val d = j.getJSONObject("device")
        assertTrue(d.getString("model").startsWith("Galaxy Watch"))
        assertEquals(32, fromB64u(d.getString("pub"), 32).size)
        val a = JSONObject(Bio.auth("Galaxy Watch SM-R890", "0.1.0"))
        assertEquals("auth", a.getString("t")); assertEquals("watch", a.getString("kind"))
    }
}
