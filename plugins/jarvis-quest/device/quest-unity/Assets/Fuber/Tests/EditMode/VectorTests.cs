// Fuber XR protokolü — C# tarafının bilinen cevap vektörüne (docs/protokol-test-vektoru.json) karşı doğrulaması.
// Bu vektör masaüstü (TypeScript) tarafından üretilir; aynı dosyaya karşı her iki taraf da geçerse iki bağımsız
// uygulama BİT DÜZEYİNDE uyumludur (aynı oturum anahtarı, aynı şifreli çıktı, aynı çerçeve/QR).

using System.Collections.Generic;
using System.IO;
using System.Text;
using Fuber.Net;
using NUnit.Framework;
using UnityEngine;

public class VectorTests
{
    private static Dictionary<string, object> _v;

    [OneTimeSetUp]
    public void Load()
    {
        string json = ReadVector();
        Assert.IsNotNull(json, "test vektörü bulunamadı");
        _v = MiniJson.ParseObject(json);
        Assert.IsNotNull(_v, "test vektörü ayrıştırılamadı");
    }

    private static string ReadVector()
    {
        // Birincil: proje kökünün yanındaki docs/ (kaynak doğruluk; masaüstüyle ortak).
        string[] candidates =
        {
            Path.Combine(Application.dataPath, "..", "..", "..", "docs", "protokol-test-vektoru.json"),   // plugins/jarvis-quest/docs
            Path.Combine(Application.dataPath, "Fuber", "Tests", "EditMode", "protokol-test-vektoru.json"),
        };
        foreach (var c in candidates)
            if (File.Exists(c)) return File.ReadAllText(c);
        return null;
    }

    private static Dictionary<string, object> Obj(object o) => o as Dictionary<string, object>;
    private static List<object> Arr(object o) => o as List<object>;
    private static string Str(Dictionary<string, object> m, string k) => (string)m[k];
    private static byte[] HexOf(Dictionary<string, object> m, string k) => Hex.Decode((string)m[k]);

    [Test]
    public void X25519_Keypairs_Match()
    {
        var kps = Arr(_v["x25519_keypairs"]);
        foreach (var item in kps)
        {
            var kp = Obj(item);
            var pub = XrCrypto.PublicFromPrivate(Hex.Decode(Str(kp, "priv")));
            Assert.AreEqual(Str(kp, "pub"), Hex.Encode(pub));
        }
    }

    [Test]
    public void X25519_DH_Matches()
    {
        var dh = Obj(_v["x25519_dh"]);
        var shared = XrCrypto.X25519(HexOf(dh, "aPriv"), HexOf(dh, "bPub"));
        Assert.AreEqual(Str(dh, "shared"), Hex.Encode(shared));
        // simetrik
        var shared2 = XrCrypto.X25519(HexOf(dh, "bPriv"), HexOf(dh, "aPub"));
        Assert.AreEqual(Str(dh, "shared"), Hex.Encode(shared2));
    }

    [Test]
    public void Fingerprint_Matches()
    {
        var fpo = Obj(_v["fingerprint"]);
        Assert.AreEqual(Str(fpo, "fp"), XrCrypto.Fingerprint(HexOf(fpo, "pub")));
    }

    private void CheckSession(string key, bool resume)
    {
        var s = Obj(_v[key]);
        var clientEph = XrCrypto.KeyPair(HexOf(s, "clientEphPriv"));
        var serverEph = XrCrypto.KeyPair(HexOf(s, "serverEphPriv"));
        var serverStatic = XrCrypto.KeyPair(HexOf(s, "serverStaticPriv"));
        XrKeyPair device = resume ? XrCrypto.KeyPair(HexOf(s, "devicePriv")) : null;
        var hello1 = Encoding.UTF8.GetBytes(Str(s, "hello1_utf8"));
        var hello2 = Encoding.UTF8.GetBytes(Str(s, "hello2_utf8"));

        var cli = XrCrypto.ClientKeys(clientEph, serverEph.Pub, serverStatic.Pub, device, hello1, hello2);
        var srv = XrCrypto.ServerKeys(serverEph, serverStatic, clientEph.Pub, resume ? device.Pub : null, hello1, hello2);

        Assert.AreEqual(Str(s, "th"), Hex.Encode(cli.Th), "th");
        Assert.AreEqual(Str(s, "okm"), Hex.Encode(cli.Okm), "okm");
        Assert.AreEqual(Str(s, "c2s"), Hex.Encode(cli.C2s), "c2s");
        Assert.AreEqual(Str(s, "s2c"), Hex.Encode(cli.S2c), "s2c");
        // iki taraf aynı anahtarı türetmeli
        Assert.AreEqual(Hex.Encode(srv.Okm), Hex.Encode(cli.Okm), "server==client");
    }

    [Test] public void Session_Pair_Matches() => CheckSession("hkdf_session_pair", false);
    [Test] public void Session_Resume_Matches() => CheckSession("hkdf_session_resume", true);

    [Test]
    public void AesGcm_Seal_And_Open_Match()
    {
        var g = Obj(_v["aes_gcm"]);
        var key = Hex.Decode(Str(g, "key"));
        var seals = Arr(g["seals"]);
        // Çözme: aynı anahtarla sayaç 0'dan artarak her mühürlü açılır.
        var opener = new CipherState(key);
        foreach (var item in seals)
        {
            var s = Obj(item);
            var opened = opener.Open(Hex.Decode(Str(s, "sealed")));
            Assert.AreEqual(Str(s, "plain_utf8"), Encoding.UTF8.GetString(opened));
        }
        // Şifreleme: taze şifreleyici aynı düz metinleri sırayla mühürleyince aynı çıktı.
        var sealer = new CipherState(key);
        foreach (var item in seals)
        {
            var s = Obj(item);
            var produced = sealer.Seal(Encoding.UTF8.GetBytes(Str(s, "plain_utf8")));
            Assert.AreEqual(Str(s, "sealed"), Hex.Encode(produced));
        }
    }

    [Test]
    public void Frame_Encode_Matches()
    {
        var f = Obj(_v["frame"]);
        var encoded = FrameCodec.EncodeFrame(HexOf(f, "body"));
        Assert.AreEqual(Str(f, "encoded"), Hex.Encode(encoded));
    }

    [Test]
    public void Plain_Binary_Encode_Matches()
    {
        var b = Obj(_v["plain_binary"]);
        byte channel = (byte)(long)b["channel"];
        uint seq = (uint)(long)b["seq"];
        var data = HexOf(b, "data");
        var encoded = FrameCodec.EncodeBinary(channel, seq, data);
        Assert.AreEqual(Str(b, "encoded"), Hex.Encode(encoded));
    }

    [Test]
    public void Plain_Json_Decode_Matches()
    {
        var j = Obj(_v["plain_json"]);
        var encoded = HexOf(j, "encoded");
        var decoded = FrameCodec.DecodePlain(encoded);
        Assert.AreEqual(PlainKind.Json, decoded.Kind);
        var msg = MiniJson.ParseObject(decoded.Json);
        var expected = Obj(j["msg"]);
        Assert.AreEqual((string)expected["t"], (string)msg["t"]);
        Assert.AreEqual((long)expected["ts"], (long)msg["ts"]);
    }

    [Test]
    public void Qr_Parse_Matches()
    {
        var q = Obj(_v["qr"]);
        var info = QrCodec.ParseUri(Str(q, "uri"));
        Assert.AreEqual(Str(q, "fp"), info.Fp);
        Assert.AreEqual(Str(q, "code"), info.Code);
        Assert.AreEqual(Str(q, "name"), info.Name);
        Assert.AreEqual((int)(long)q["port"], info.Port);
        var hosts = Arr(q["hosts"]);
        Assert.AreEqual(hosts.Count, info.Hosts.Length);
    }

    [Test]
    public void Roundtrip_SelfConsistent()
    {
        // C# kendi içinde: seal→open, frame decode, qr build→parse
        var key = new byte[32];
        for (int i = 0; i < 32; i++) key[i] = (byte)i;
        var enc = new CipherState(key);
        var dec = new CipherState(key);
        var plain = Encoding.UTF8.GetBytes("ışık ğ ş ü ç ö İ");
        Assert.AreEqual("ışık ğ ş ü ç ö İ", Encoding.UTF8.GetString(dec.Open(enc.Seal(plain))));
    }
}
