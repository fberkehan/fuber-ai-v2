package ai.fuber.watch.proto

import org.bouncycastle.math.ec.rfc7748.X25519
import java.io.ByteArrayOutputStream
import java.security.MessageDigest
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.Mac
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Fuber XR köprü protokolü v1, Kotlin istemci tarafı. Kaynak: masaüstü `xr/protocol.ts` + `pairing.ts`.
 * Tel düzeni: u32 BE uzunluk + gövde; el sıkışma düz JSON; sonrası AES-256-GCM (nonce = 4 sıfır || u64 BE sayaç).
 */
object Xr {
    const val VERSION = 1
    const val PORT = 47852
    const val DISCOVERY_PORT = 47853
    const val MAX_FRAME = 4 * 1024 * 1024
    const val HKDF_INFO = "fuber-xr-v1"
    const val TAG_BYTES = 16
    const val KIND_JSON = 0x01
    const val KIND_BINARY = 0x02
}

class XrProtocolException(val code: String, message: String) : Exception(message)

fun ByteArray.hex(): String = joinToString("") { "%02x".format(it) }
fun String.unhex(): ByteArray = ByteArray(length / 2) { substring(it * 2, it * 2 + 2).toInt(16).toByte() }

private val b64uEnc = Base64.getUrlEncoder().withoutPadding()
private val b64uDec = Base64.getUrlDecoder()

fun b64u(bytes: ByteArray): String = b64uEnc.encodeToString(bytes)

/** Dolgusuz, kanonik base64url; beklenen uzunluk tutmazsa fırlatır. */
fun fromB64u(text: String, expected: Int? = null): ByteArray {
    if (!Regex("^[A-Za-z0-9_-]*$").matches(text)) throw XrProtocolException("bad_b64", "geçersiz base64url")
    val out = try {
        b64uDec.decode(text)
    } catch (e: IllegalArgumentException) {
        throw XrProtocolException("bad_b64", "geçersiz base64url")
    }
    if (expected != null && out.size != expected) throw XrProtocolException("bad_b64", "beklenen $expected bayt, gelen ${out.size}")
    if (b64u(out) != text) throw XrProtocolException("bad_b64", "kanonik olmayan base64url")
    return out
}

class XrKeyPair(val priv: ByteArray, val pub: ByteArray)

object Crypto {
    fun publicFromPrivate(priv: ByteArray): ByteArray {
        require(priv.size == 32) { "X25519 özel anahtarı 32 bayt olmalı" }
        val r = ByteArray(32)
        X25519.scalarMultBase(priv, 0, r, 0)
        return r
    }

    fun keyPair(priv: ByteArray? = null): XrKeyPair {
        val raw = priv?.copyOf() ?: ByteArray(32).also { java.security.SecureRandom().nextBytes(it) }
        return XrKeyPair(raw, publicFromPrivate(raw))
    }

    /** X25519(priv, pub); sonuç sıfırsa fırlatır. */
    fun x25519(priv: ByteArray, pub: ByteArray): ByteArray {
        if (priv.size != 32 || pub.size != 32) throw XrProtocolException("bad_key", "X25519 anahtarı 32 bayt olmalı")
        val r = ByteArray(32)
        if (!X25519.calculateAgreement(priv, 0, pub, 0, r, 0) || r.all { it == 0.toByte() }) {
            throw XrProtocolException("bad_key", "X25519 sonucu sıfır")
        }
        return r
    }

    fun sha256(vararg parts: ByteArray): ByteArray {
        val md = MessageDigest.getInstance("SHA-256")
        parts.forEach { md.update(it) }
        return md.digest()
    }

    private fun hmac(key: ByteArray, vararg parts: ByteArray): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(key, "HmacSHA256"))
        parts.forEach { mac.update(it) }
        return mac.doFinal()
    }

    /** HKDF-SHA256 (RFC 5869): extract(salt, ikm) + expand(info, length). */
    fun hkdf(ikm: ByteArray, salt: ByteArray, info: ByteArray, length: Int): ByteArray {
        val prk = hmac(salt, ikm)
        val out = ByteArrayOutputStream()
        var t = ByteArray(0)
        var i = 1
        while (out.size() < length) {
            t = hmac(prk, t, info, byteArrayOf(i.toByte()))
            out.write(t)
            i++
        }
        return out.toByteArray().copyOf(length)
    }

    /** `fp = base64url(SHA-256(S_pub))`, 43 karakter. */
    fun fingerprint(staticPub: ByteArray): String = b64u(sha256(staticPub))
}

class SessionKeys(val th: ByteArray, val okm: ByteArray) {
    val c2s: ByteArray get() = okm.copyOfRange(0, 32)
    val s2c: ByteArray get() = okm.copyOfRange(32, 64)
}

/** `th = SHA-256(hello1 || hello2)`; `okm = HKDF-SHA256(dh1||dh2[||dh3], th, "fuber-xr-v1", 64)`. */
fun deriveSessionKeys(dh: List<ByteArray>, hello1: ByteArray, hello2: ByteArray): SessionKeys {
    val th = Crypto.sha256(hello1, hello2)
    val ikm = dh.fold(ByteArray(0)) { a, b -> a + b }
    val okm = Crypto.hkdf(ikm, th, Xr.HKDF_INFO.toByteArray(Charsets.UTF_8), 64)
    return SessionKeys(th, okm)
}

/** İstemci tarafı: dh1 = X25519(Ce, Se), dh2 = X25519(Ce, S), resume'da dh3 = X25519(D, Se). */
fun clientKeys(
    clientEph: XrKeyPair,
    serverEphPub: ByteArray,
    serverStaticPub: ByteArray,
    device: XrKeyPair?,
    hello1: ByteArray,
    hello2: ByteArray,
): SessionKeys {
    val dh = mutableListOf(Crypto.x25519(clientEph.priv, serverEphPub), Crypto.x25519(clientEph.priv, serverStaticPub))
    if (device != null) dh.add(Crypto.x25519(device.priv, serverEphPub))
    return deriveSessionKeys(dh, hello1, hello2)
}

fun nonceFor(counter: Long): ByteArray {
    val n = ByteArray(12)
    for (i in 0 until 8) n[11 - i] = (counter ushr (8 * i)).toByte()
    return n
}

/** Tek yönün şifresi; sayaç 0'dan başlar, her çerçevede artar. */
class CipherState(key: ByteArray) {
    private val keySpec: SecretKeySpec
    var counter = 0L
        private set

    init {
        if (key.size != 32) throw XrProtocolException("bad_key", "AES-256 anahtarı 32 bayt olmalı")
        keySpec = SecretKeySpec(key, "AES")
    }

    fun seal(plain: ByteArray): ByteArray {
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.ENCRYPT_MODE, keySpec, GCMParameterSpec(Xr.TAG_BYTES * 8, nonceFor(counter)))
        val out = c.doFinal(plain) // şifreli metin || etiket
        counter++
        return out
    }

    fun open(sealed: ByteArray): ByteArray {
        if (sealed.size < Xr.TAG_BYTES) throw XrProtocolException("decrypt", "şifreli çerçeve çok kısa")
        val c = Cipher.getInstance("AES/GCM/NoPadding")
        c.init(Cipher.DECRYPT_MODE, keySpec, GCMParameterSpec(Xr.TAG_BYTES * 8, nonceFor(counter)))
        val out = try {
            c.doFinal(sealed)
        } catch (e: Exception) {
            throw XrProtocolException("decrypt", "şifre çözülemedi")
        }
        counter++
        return out
    }
}

object Frames {
    fun encode(body: ByteArray): ByteArray {
        if (body.isEmpty() || body.size > Xr.MAX_FRAME) throw XrProtocolException("frame_size", "geçersiz çerçeve boyu ${body.size}")
        val n = body.size
        return byteArrayOf((n ushr 24).toByte(), (n ushr 16).toByte(), (n ushr 8).toByte(), n.toByte()) + body
    }

    fun encodeJson(json: String): ByteArray = byteArrayOf(Xr.KIND_JSON.toByte()) + json.toByteArray(Charsets.UTF_8)

    fun encodeBinary(channel: Int, seq: Long, data: ByteArray): ByteArray = byteArrayOf(
        Xr.KIND_BINARY.toByte(), channel.toByte(),
        (seq ushr 24).toByte(), (seq ushr 16).toByte(), (seq ushr 8).toByte(), seq.toByte(),
    ) + data
}

/** Akıştan çerçeve ayıklar. */
class FrameDecoder {
    private var buf = ByteArray(0)

    fun push(chunk: ByteArray, len: Int = chunk.size): List<ByteArray> {
        buf += chunk.copyOf(len)
        val frames = mutableListOf<ByteArray>()
        while (buf.size >= 4) {
            val n = ((buf[0].toLong() and 0xff) shl 24) or ((buf[1].toLong() and 0xff) shl 16) or
                ((buf[2].toLong() and 0xff) shl 8) or (buf[3].toLong() and 0xff)
            if (n == 0L || n > Xr.MAX_FRAME) throw XrProtocolException("frame_size", "geçersiz çerçeve boyu $n")
            if (buf.size < 4 + n) break
            frames.add(buf.copyOfRange(4, 4 + n.toInt()))
            buf = buf.copyOfRange(4 + n.toInt(), buf.size)
        }
        return frames
    }
}

sealed class Plain {
    data class Json(val json: String) : Plain()
    class Binary(val channel: Int, val seq: Long, val data: ByteArray) : Plain()
}

fun decodePlain(plain: ByteArray): Plain {
    if (plain.isEmpty()) throw XrProtocolException("bad_message", "boş ileti")
    return when (plain[0].toInt()) {
        Xr.KIND_JSON -> Plain.Json(String(plain, 1, plain.size - 1, Charsets.UTF_8))
        Xr.KIND_BINARY -> {
            if (plain.size < 6) throw XrProtocolException("bad_message", "ikili ileti başlığı eksik")
            val seq = ((plain[2].toLong() and 0xff) shl 24) or ((plain[3].toLong() and 0xff) shl 16) or
                ((plain[4].toLong() and 0xff) shl 8) or (plain[5].toLong() and 0xff)
            Plain.Binary(plain[1].toInt() and 0xff, seq, plain.copyOfRange(6, plain.size))
        }
        else -> throw XrProtocolException("bad_message", "bilinmeyen ileti türü ${plain[0]}")
    }
}
