package ai.fuber.watch.net

import ai.fuber.watch.proto.Bio
import ai.fuber.watch.proto.CipherState
import ai.fuber.watch.proto.Crypto
import ai.fuber.watch.proto.FrameDecoder
import ai.fuber.watch.proto.Frames
import ai.fuber.watch.proto.Json
import ai.fuber.watch.proto.Plain
import ai.fuber.watch.proto.XrKeyPair
import ai.fuber.watch.proto.XrProtocolException
import ai.fuber.watch.proto.b64u
import ai.fuber.watch.proto.clientKeys
import ai.fuber.watch.proto.decodePlain
import ai.fuber.watch.proto.fromB64u
import org.json.JSONObject
import java.io.IOException
import java.io.InputStream
import java.net.Socket
import java.net.SocketTimeoutException
import java.util.ArrayDeque

enum class HandshakeMode { PAIR, RESUME }

/** Bağlantı kurma sonucu. */
sealed class Handshake {
    class Ok(val session: XrSession, val serverFp: String, val pcName: String, val deviceId: String?) : Handshake()
    /** PC reddetti ya da hata verdi: `reject` kodu (not_pairing, unknown_device, bad_version, busy...) ya da `error`/`bye` kodu. */
    class Rejected(val code: String) : Handshake()
}

/** Şifreli oturum (el sıkışma bitti). `send` iş parçacığı güvenli; `poll` tek okuyucu iş parçacığından çağrılır. */
class XrSession internal constructor(
    private val socket: Socket,
    private val sendCipher: CipherState,
    private val recvCipher: CipherState,
    private val decoder: FrameDecoder,
    private val pending: ArrayDeque<ByteArray>,
) : AutoCloseable {
    private val input: InputStream = socket.getInputStream()
    private val out = socket.getOutputStream()
    private val buf = ByteArray(16384)
    private val lock = Any()

    fun send(json: String) = synchronized(lock) {
        out.write(Frames.encode(sendCipher.seal(Frames.encodeJson(json))))
        out.flush()
    }

    /** Sonraki JSON iletiyi döndürür; `soTimeout` dolarsa null. Bağlantı kapanırsa IOException. */
    fun poll(): String? {
        while (true) {
            val frame = pending.pollFirst()
            if (frame != null) {
                val plain = recvCipher.open(frame)
                val d = decodePlain(plain)
                if (d is Plain.Json) return d.json
                continue // ikili kanallar saat tarafında kullanılmaz
            }
            val n = try {
                input.read(buf)
            } catch (e: SocketTimeoutException) {
                return null
            }
            if (n < 0) throw IOException("bağlantı kapandı")
            pending.addAll(decoder.push(buf, n))
        }
    }

    val isOpen: Boolean get() = !socket.isClosed && socket.isConnected && !socket.isInputShutdown

    fun setReadTimeout(ms: Int) { socket.soTimeout = ms }

    override fun close() { try { socket.close() } catch (_: Exception) {} }
}

object XrClient {
    private fun readExact(input: InputStream, n: Int): ByteArray {
        val out = ByteArray(n)
        var got = 0
        while (got < n) {
            val r = input.read(out, got, n - got)
            if (r < 0) throw IOException("bağlantı kapandı")
            got += r
        }
        return out
    }

    /**
     * El sıkışma (pair ya da resume). `socket` bağlı olmalı. Başarıda ilk şifreli yanıtlar (`paired`, `welcome`) tüketilir.
     * Hata kodu varsa `Rejected` döner; ağ hataları IOException olarak çıkar. `clientEph` yalnız sınama içindir.
     */
    fun handshake(
        socket: Socket,
        mode: HandshakeMode,
        deviceKey: XrKeyPair,
        deviceId: String?,
        expectedFp: String?,
        pin: String?,
        deviceName: String,
        model: String,
        app: String,
        clientEph: XrKeyPair = Crypto.keyPair(),
        timeoutMs: Int = 6000,
    ): Handshake {
        socket.tcpNoDelay = true
        socket.soTimeout = timeoutMs
        val input = socket.getInputStream()
        val out = socket.getOutputStream()

        // hello1: anahtar sırası PC ile aynı (t, v, mode, eph[, deviceId]); türetmede TEL baytları kullanılır.
        val hello1 = buildString {
            append("{\"t\":\"hello\",\"v\":1,\"mode\":").append(Json.str(if (mode == HandshakeMode.PAIR) "pair" else "resume"))
            append(",\"eph\":").append(Json.str(b64u(clientEph.pub)))
            if (mode == HandshakeMode.RESUME) append(",\"deviceId\":").append(Json.str(deviceId ?: ""))
            append('}')
        }.toByteArray(Charsets.UTF_8)
        out.write(Frames.encode(hello1))
        out.flush()

        val head = readExact(input, 4)
        val len = ((head[0].toLong() and 0xff) shl 24) or ((head[1].toLong() and 0xff) shl 16) or
            ((head[2].toLong() and 0xff) shl 8) or (head[3].toLong() and 0xff)
        if (len <= 0 || len > 65536) throw XrProtocolException("frame_size", "geçersiz el sıkışma çerçevesi")
        val hello2 = readExact(input, len.toInt())
        val sh = try { JSONObject(String(hello2, Charsets.UTF_8)) } catch (e: Exception) {
            throw XrProtocolException("bad_message", "el sıkışma JSON değil")
        }
        if (sh.optString("t") == "reject") return Handshake.Rejected(sh.optString("code", "reject"))
        if (sh.optString("t") != "hello") throw XrProtocolException("bad_hello", "sunucu hello değil")

        val serverEphPub = fromB64u(sh.getString("eph"), 32)
        val serverStaticPub = fromB64u(sh.getString("static"), 32)
        val fp = Crypto.fingerprint(serverStaticPub)
        if (expectedFp != null && fp != expectedFp) throw XrProtocolException("bad_fp", "parmak izi tutmadı (MITM)")

        val keys = clientKeys(
            clientEph, serverEphPub, serverStaticPub,
            if (mode == HandshakeMode.RESUME) deviceKey else null, hello1, hello2,
        )
        val send = CipherState(keys.c2s)
        val recv = CipherState(keys.s2c)

        val first = if (mode == HandshakeMode.PAIR) Bio.pair(deviceName, deviceKey.pub, model, app, pin ?: "") else Bio.auth(model, app)
        out.write(Frames.encode(send.seal(Frames.encodeJson(first))))
        out.flush()

        val decoder = FrameDecoder()
        val pending = ArrayDeque<ByteArray>()
        val session = XrSession(socket, send, recv, decoder, pending)
        var pairedId: String? = null
        var pcName = ""
        val deadline = System.currentTimeMillis() + timeoutMs
        while (System.currentTimeMillis() < deadline) {
            val msg = try { session.poll() } catch (e: IOException) {
                // PC ilk şifreli iletiden sonra kapatabilir; hata kodunu yutma
                return Handshake.Rejected("closed")
            } ?: continue
            val j = JSONObject(msg)
            when (j.optString("t")) {
                "paired" -> { pairedId = j.optString("deviceId").ifEmpty { null } }
                "welcome" -> {
                    pcName = j.optString("pcName")
                    return Handshake.Ok(session, fp, pcName, pairedId ?: j.optString("deviceId").ifEmpty { null })
                }
                "error" -> return Handshake.Rejected(j.optString("code", "error"))
                "bye" -> return Handshake.Rejected(j.optString("reason", "bye"))
            }
        }
        session.close()
        return Handshake.Rejected("timeout")
    }
}
