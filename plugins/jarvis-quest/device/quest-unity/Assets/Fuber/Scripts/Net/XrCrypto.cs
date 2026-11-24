// Fuber XR köprü protokolü — kriptografi (C# karşılığı; kaynak sözleşme: plugins/jarvis-quest/docs/PROTOCOL.md,
// masaüstü uygulaması: apps/desktop/src/main/modules/xr/protocol.ts). BouncyCastle 2.4.0 kullanır: X25519,
// HKDF-SHA256, SHA-256. AES-256-GCM CipherState.cs'te. Tüm değerler masaüstü tarafıyla BİT DÜZEYİNDE uyumludur
// (docs/protokol-test-vektoru.json ile doğrulanır).

using System;
using Org.BouncyCastle.Crypto.Agreement;
using Org.BouncyCastle.Crypto.Digests;
using Org.BouncyCastle.Crypto.Generators;
using Org.BouncyCastle.Crypto.Parameters;
using Org.BouncyCastle.Security;

namespace Fuber.Net
{
    /// <summary>Protokol sabitleri.</summary>
    public static class XrConst
    {
        public const int ProtocolVersion = 1;
        public const int Port = 47852;
        public const int DiscoveryPort = 47853;
        public const int MaxFrame = 4 * 1024 * 1024;
        public const string HkdfInfo = "fuber-xr-v1";
        public const int TagBytes = 16;

        public const byte KindJson = 0x01;
        public const byte KindBinary = 0x02;
        public const byte ChMic = 1;
        public const byte ChTts = 2;
        public const byte ChScreen = 3;
    }

    public sealed class XrProtocolException : Exception
    {
        public string Code { get; }
        public XrProtocolException(string code, string message) : base(message) { Code = code; }
    }

    /// <summary>32 baytlık ham X25519 anahtar çifti.</summary>
    public sealed class XrKeyPair
    {
        public readonly byte[] Priv; // 32
        public readonly byte[] Pub;  // 32
        public XrKeyPair(byte[] priv, byte[] pub) { Priv = priv; Pub = pub; }
    }

    public sealed class SessionKeys
    {
        public readonly byte[] Th;  // 32
        public readonly byte[] Okm; // 64
        public readonly byte[] C2s; // 32
        public readonly byte[] S2c; // 32
        public SessionKeys(byte[] th, byte[] okm, byte[] c2s, byte[] s2c) { Th = th; Okm = okm; C2s = c2s; S2c = s2c; }
    }

    public static class XrCrypto
    {
        // ───────── base64url (dolgusuz) ─────────
        public static string B64u(byte[] bytes)
        {
            return Convert.ToBase64String(bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        }

        public static byte[] FromB64u(string text, int expectedBytes = -1)
        {
            if (text == null) throw new XrProtocolException("bad_b64", "null");
            foreach (char c in text)
            {
                bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
                if (!ok) throw new XrProtocolException("bad_b64", "geçersiz base64url");
            }
            string t = text.Replace('-', '+').Replace('_', '/');
            switch (t.Length % 4) { case 2: t += "=="; break; case 3: t += "="; break; case 1: throw new XrProtocolException("bad_b64", "uzunluk"); }
            byte[] outBytes;
            try { outBytes = Convert.FromBase64String(t); }
            catch { throw new XrProtocolException("bad_b64", "çözülemedi"); }
            if (expectedBytes >= 0 && outBytes.Length != expectedBytes)
                throw new XrProtocolException("bad_b64", $"beklenen {expectedBytes} bayt, gelen {outBytes.Length}");
            // Kanonik: yeniden kodlayınca aynı metin çıkmalı.
            if (B64u(outBytes) != text) throw new XrProtocolException("bad_b64", "kanonik değil");
            return outBytes;
        }

        // ───────── hash ─────────
        public static byte[] Sha256(byte[] data)
        {
            var d = new Sha256Digest();
            d.BlockUpdate(data, 0, data.Length);
            var outBytes = new byte[d.GetDigestSize()];
            d.DoFinal(outBytes, 0);
            return outBytes;
        }

        public static byte[] Sha256(byte[] a, byte[] b)
        {
            var d = new Sha256Digest();
            d.BlockUpdate(a, 0, a.Length);
            d.BlockUpdate(b, 0, b.Length);
            var outBytes = new byte[d.GetDigestSize()];
            d.DoFinal(outBytes, 0);
            return outBytes;
        }

        // ───────── X25519 ─────────
        public static byte[] PublicFromPrivate(byte[] priv)
        {
            if (priv.Length != 32) throw new XrProtocolException("bad_key", "X25519 özel anahtarı 32 bayt olmalı");
            var p = new X25519PrivateKeyParameters(priv, 0);
            return p.GeneratePublicKey().GetEncoded();
        }

        public static XrKeyPair KeyPair(byte[] priv)
        {
            var raw = (byte[])priv.Clone();
            return new XrKeyPair(raw, PublicFromPrivate(raw));
        }

        private static readonly SecureRandom _rng = new SecureRandom();

        /// <summary>Kriptografik rastgele baytlar (uygulama katmanı BouncyCastle'a doğrudan dokunmasın diye merkezi).</summary>
        public static byte[] RandomBytes(int n)
        {
            var b = new byte[n];
            _rng.NextBytes(b);
            return b;
        }

        public static XrKeyPair GenerateKeyPair()
        {
            return KeyPair(RandomBytes(32));
        }

        /// <summary>X25519(priv, pub). Sonuç sıfırsa (küçük dereceli nokta) fırlatır.</summary>
        public static byte[] X25519(byte[] priv, byte[] pub)
        {
            if (priv.Length != 32 || pub.Length != 32) throw new XrProtocolException("bad_key", "X25519 anahtarı 32 bayt olmalı");
            var privP = new X25519PrivateKeyParameters(priv, 0);
            var pubP = new X25519PublicKeyParameters(pub, 0);
            var agr = new X25519Agreement();
            agr.Init(privP);
            var secret = new byte[agr.AgreementSize];
            agr.CalculateAgreement(pubP, secret, 0);
            bool allZero = true;
            foreach (var x in secret) if (x != 0) { allZero = false; break; }
            if (allZero) throw new XrProtocolException("bad_key", "X25519 sonucu sıfır");
            return secret;
        }

        /// <summary>fp = base64url(SHA-256(S_pub_raw32)), 43 karakter.</summary>
        public static string Fingerprint(byte[] staticPub)
        {
            return B64u(Sha256(staticPub));
        }

        public static string ShortFingerprint(string fp)
        {
            return fp.Length >= 4 ? fp.Substring(0, 4) : fp;
        }

        // ───────── HKDF-SHA256 ─────────
        public static byte[] Hkdf(byte[] ikm, byte[] salt, byte[] info, int length)
        {
            var gen = new HkdfBytesGenerator(new Sha256Digest());
            gen.Init(new HkdfParameters(ikm, salt, info));
            var outBytes = new byte[length];
            gen.GenerateBytes(outBytes, 0, length);
            return outBytes;
        }

        private static byte[] Concat(params byte[][] parts)
        {
            int total = 0;
            foreach (var p in parts) total += p.Length;
            var outBytes = new byte[total];
            int off = 0;
            foreach (var p in parts) { Buffer.BlockCopy(p, 0, outBytes, off, p.Length); off += p.Length; }
            return outBytes;
        }

        /// <summary>th = SHA-256(hello1 || hello2); okm = HKDF(dh..., th, "fuber-xr-v1", 64).</summary>
        public static SessionKeys DeriveSessionKeys(byte[][] dh, byte[] hello1, byte[] hello2)
        {
            var th = Sha256(hello1, hello2);
            var ikm = Concat(dh);
            var info = System.Text.Encoding.UTF8.GetBytes(XrConst.HkdfInfo);
            var okm = Hkdf(ikm, th, info, 64);
            var c2s = new byte[32];
            var s2c = new byte[32];
            Buffer.BlockCopy(okm, 0, c2s, 0, 32);
            Buffer.BlockCopy(okm, 32, s2c, 0, 32);
            return new SessionKeys(th, okm, c2s, s2c);
        }

        /// <summary>Gözlük (istemci) tarafı: dh1 = X25519(Ce, Se), dh2 = X25519(Ce, S), resume'da dh3 = X25519(D, Se).</summary>
        public static SessionKeys ClientKeys(XrKeyPair clientEph, byte[] serverEphPub, byte[] serverStaticPub, XrKeyPair device, byte[] hello1, byte[] hello2)
        {
            byte[][] dh = device == null
                ? new[] { X25519(clientEph.Priv, serverEphPub), X25519(clientEph.Priv, serverStaticPub) }
                : new[] { X25519(clientEph.Priv, serverEphPub), X25519(clientEph.Priv, serverStaticPub), X25519(device.Priv, serverEphPub) };
            return DeriveSessionKeys(dh, hello1, hello2);
        }

        /// <summary>Bilgisayar (sunucu) tarafı: dh1 = X25519(Se, Ce), dh2 = X25519(S, Ce), resume'da dh3 = X25519(Se, D).</summary>
        public static SessionKeys ServerKeys(XrKeyPair serverEph, XrKeyPair serverStatic, byte[] clientEphPub, byte[] devicePub, byte[] hello1, byte[] hello2)
        {
            byte[][] dh = devicePub == null
                ? new[] { X25519(serverEph.Priv, clientEphPub), X25519(serverStatic.Priv, clientEphPub) }
                : new[] { X25519(serverEph.Priv, clientEphPub), X25519(serverStatic.Priv, clientEphPub), X25519(serverEph.Priv, devicePub) };
            return DeriveSessionKeys(dh, hello1, hello2);
        }
    }
}
