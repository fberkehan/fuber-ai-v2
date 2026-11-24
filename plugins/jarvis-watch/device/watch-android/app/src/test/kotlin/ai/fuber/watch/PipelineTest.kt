package ai.fuber.watch

import ai.fuber.watch.net.DiscoveryListener
import ai.fuber.watch.net.Sample
import ai.fuber.watch.net.SampleQueue
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.net.DatagramSocket

class PipelineTest {
    @Test fun ornek_json_gercek_ts_ve_yalniz_olculenler() {
        val j = JSONObject(Sample(1_700_000_000_123, hr = 65, acc = "medium").toJson())
        assertEquals("bio.sample", j.getString("t"))
        assertEquals(1_700_000_000_123, j.getLong("ts"))
        assertEquals(65, j.getInt("hr")); assertEquals("medium", j.getString("hrAcc"))
        for (k in listOf("spo2", "skinTemp", "ibi", "steps", "kcal")) assertFalse(k, j.has(k))
        val a = JSONObject(Sample(5, steps = 1200, kcal = 90).toJson())
        assertFalse(a.has("hr")); assertEquals(1200, a.getInt("steps")); assertEquals(90, a.getInt("kcal"))
    }

    @Test fun kuyruk_en_cok_30_en_eskiyi_atar_sirali() {
        val q = SampleQueue(null)
        for (i in 1..40) q.add(Sample(i * 1000L, hr = 50 + i))
        val s = q.snapshot()
        assertEquals(30, s.size)
        assertEquals(11_000L, s.first().ts); assertEquals(40_000L, s.last().ts)
        assertEquals((11..40).map { it * 1000L }, s.map { it.ts })
    }

    @Test fun kuyruk_ters_gelen_ornegi_siraya_koyar_ve_tekrari_atar() {
        val q = SampleQueue(null)
        q.add(Sample(3000, hr = 70)); q.add(Sample(1000, hr = 60)); q.add(Sample(2000, hr = 65)); q.add(Sample(2000, hr = 65))
        assertEquals(listOf(1000L, 2000L, 3000L), q.snapshot().map { it.ts })
    }

    @Test fun kuyruk_dosyada_kalir_ve_gonderilen_cikar() {
        val f = File.createTempFile("samples", ".jsonl"); f.deleteOnExit()
        val q = SampleQueue(f)
        q.add(Sample(1000, hr = 60, acc = "high")); q.add(Sample(2000, steps = 10, kcal = 5))
        val q2 = SampleQueue(f)
        assertEquals(q.snapshot(), q2.snapshot())
        q2.remove(q2.snapshot().first())
        assertEquals(1, SampleQueue(f).size)
    }

    @Test fun kesif_yuku_ayristirma() {
        val d = DiscoveryListener({ DatagramSocket(0) }, now = { 5L })
        val pc = d.parse("{\"fuberxr\":1,\"name\":\"Fuber PC\",\"p\":47852,\"f\":\"abc\",\"pairing\":true}", "192.168.1.50")
        assertNotNull(pc)
        assertEquals(47852, pc!!.port); assertTrue(pc.pairing); assertEquals("192.168.1.50", pc.host)
        assertNull(d.parse("{\"hello\":1}", "1.2.3.4"))
        assertNull(d.parse("bozuk", "1.2.3.4"))
    }
}
