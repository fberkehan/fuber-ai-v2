package ai.fuber.watch.net

import ai.fuber.watch.proto.Bio
import org.json.JSONObject
import java.io.File

/** Bir ölçüm: `ts` GERÇEK ölçüm anı (ms epoch). Boş alan yazılmaz. */
data class Sample(val ts: Long, val hr: Int? = null, val acc: String? = null, val steps: Int? = null, val kcal: Int? = null) {
    fun toJson(): String = Bio.sample(ts, hr = hr, hrAcc = acc, steps = steps, kcal = kcal)
}

/**
 * Gönderilmemiş örnekler: en çok `max` (30) tane, eskiden yeniye sıralı; dolunca en eskiler atılır. Dosyaya yazılır
 * (süreç ölse de kalır). PC'ye ulaşılamıyorken biriken veri bağlanınca SIRAYLA gider.
 */
class SampleQueue(private val file: File?, private val max: Int = 30) {
    private val items = ArrayList<Sample>()

    init {
        try {
            file?.takeIf { it.isFile }?.forEachLine { line ->
                if (line.isBlank()) return@forEachLine
                val j = JSONObject(line)
                items.add(Sample(
                    j.getLong("ts"),
                    if (j.has("hr")) j.getInt("hr") else null,
                    if (j.has("acc")) j.getString("acc") else null,
                    if (j.has("steps")) j.getInt("steps") else null,
                    if (j.has("kcal")) j.getInt("kcal") else null,
                ))
            }
        } catch (e: Exception) { items.clear() }
        trim()
    }

    @Synchronized fun add(s: Sample) {
        if (s.hr != null && items.any { it.hr != null && it.ts == s.ts }) return // aynı ölçüm iki kez gelmesin
        items.add(s)
        items.sortBy { it.ts }
        trim()
        persist()
    }

    @Synchronized fun snapshot(): List<Sample> = items.toList()
    val size: Int get() = synchronized(this) { items.size }

    /** Başarıyla gönderilen örneği çıkarır. */
    @Synchronized fun remove(s: Sample) { if (items.remove(s)) persist() }

    private fun trim() { while (items.size > max) items.removeAt(0) }

    private fun persist() {
        val f = file ?: return
        try {
            val tmp = File(f.path + ".tmp")
            tmp.writeText(items.joinToString("\n") { s ->
                val j = JSONObject().put("ts", s.ts)
                s.hr?.let { j.put("hr", it) }; s.acc?.let { j.put("acc", it) }
                s.steps?.let { j.put("steps", it) }; s.kcal?.let { j.put("kcal", it) }
                j.toString()
            })
            if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
        } catch (_: Exception) {}
    }
}
