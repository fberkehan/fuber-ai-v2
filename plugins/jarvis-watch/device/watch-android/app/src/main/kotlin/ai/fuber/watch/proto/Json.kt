package ai.fuber.watch.proto

/** Anahtar sırası sabit, elle kurulan JSON (el sıkışma baytları ve test vektörü için). */
object Json {
    fun str(s: String): String {
        val sb = StringBuilder("\"")
        for (c in s) when {
            c == '"' -> sb.append("\\\"")
            c == '\\' -> sb.append("\\\\")
            c == '\n' -> sb.append("\\n")
            c == '\r' -> sb.append("\\r")
            c == '\t' -> sb.append("\\t")
            c < ' ' -> sb.append("\\u%04x".format(c.code))
            else -> sb.append(c) // JSON.stringify gibi: ASCII dışı olduğu gibi kalır
        }
        return sb.append('"').toString()
    }

    fun num(d: Double): String = if (d == Math.rint(d) && Math.abs(d) < 1e15) d.toLong().toString() else d.toString()
}

/** Sözleşme (plugins/jarvis-quest/docs/PROTOCOL.md §7.4, saat → PC) iletileri. */
object Bio {
    /** Boş alan YOK: yalnız gerçekten ölçülenler yazılır. */
    fun sample(
        ts: Long,
        hr: Int? = null,
        hrAcc: String? = null,
        spo2: Int? = null,
        steps: Int? = null,
        kcal: Int? = null,
        skinTemp: Double? = null,
        ibi: List<Int>? = null,
    ): String {
        val sb = StringBuilder("{\"t\":\"bio.sample\",\"ts\":").append(ts)
        if (hr != null) sb.append(",\"hr\":").append(hr)
        if (hrAcc != null) sb.append(",\"hrAcc\":").append(Json.str(hrAcc))
        if (spo2 != null) sb.append(",\"spo2\":").append(spo2)
        if (steps != null) sb.append(",\"steps\":").append(steps)
        if (kcal != null) sb.append(",\"kcal\":").append(kcal)
        if (skinTemp != null) sb.append(",\"skinTemp\":").append(Json.num(skinTemp))
        if (!ibi.isNullOrEmpty()) sb.append(",\"ibi\":[").append(ibi.joinToString(",")).append(']')
        return sb.append('}').toString()
    }

    fun status(worn: Boolean, battery: Int, measuring: Boolean): String =
        "{\"t\":\"bio.status\",\"worn\":$worn,\"battery\":${battery.coerceIn(0, 100)},\"measuring\":$measuring}"

    fun ping(ts: Long) = "{\"t\":\"ping\",\"ts\":$ts}"

    fun auth(model: String, app: String) =
        "{\"t\":\"auth\",\"kind\":\"watch\",\"model\":${Json.str(model)},\"app\":${Json.str(app)}}"

    fun pair(name: String, devicePub: ByteArray, model: String, app: String, pin: String) =
        "{\"t\":\"pair\",\"kind\":\"watch\",\"device\":{\"name\":${Json.str(name)},\"pub\":${Json.str(b64u(devicePub))}," +
            "\"model\":${Json.str(model)},\"app\":${Json.str(app)},\"kind\":\"watch\"},\"pin\":${Json.str(pin)}}"
}
