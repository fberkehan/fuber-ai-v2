// Gözlük tarafı eşleşme deposu (docs/PROTOCOL.md §2). Cihaz statik X25519 anahtarı + eşleşmiş bilgisayar kaydı
// (parmak izi, ad, PC'nin atadığı deviceId, son bilinen adresler). persistentDataPath'teki JSON dosyası; yol
// dışarıdan verilir (SAF, EditMode'da sınanabilir). protocol.ts PairingStore'un gözlük eşdeğeri.

using System.Collections.Generic;
using System.IO;

namespace Fuber.Net
{
    public sealed class PairedPc
    {
        public string PcFp;
        public string PcName;
        public string DeviceId;   // bilgisayarın atadığı kimlik
        public string[] Hosts;    // son bilinen adresler (resume için)
        public int Port;
    }

    public sealed class PairingStore
    {
        private readonly string _file;
        public XrKeyPair DeviceKey { get; private set; }
        public PairedPc Pc { get; private set; }

        private PairingStore(string file, XrKeyPair device, PairedPc pc)
        {
            _file = file;
            DeviceKey = device;
            Pc = pc;
        }

        public static PairingStore Open(string file, System.Func<byte[]> randomBytes32)
        {
            try
            {
                if (File.Exists(file))
                {
                    var obj = MiniJson.ParseObject(File.ReadAllText(file));
                    if (obj != null && obj.TryGetValue("devicePriv", out var dpv) && dpv is string dpriv)
                    {
                        var device = XrCrypto.KeyPair(Hex.Decode(dpriv));
                        PairedPc pc = null;
                        if (obj.TryGetValue("pc", out var pcv) && pcv is Dictionary<string, object> pm)
                        {
                            pc = new PairedPc
                            {
                                PcFp = Get(pm, "fp"),
                                PcName = Get(pm, "name"),
                                DeviceId = Get(pm, "deviceId"),
                                Port = pm.TryGetValue("port", out var pp) && pp is long pl ? (int)pl : XrConst.Port,
                                Hosts = GetHosts(pm)
                            };
                        }
                        return new PairingStore(file, device, pc);
                    }
                }
            }
            catch { /* bozuk dosya → yeniden üret */ }

            var fresh = XrCrypto.KeyPair(randomBytes32());
            var store = new PairingStore(file, fresh, null);
            store.Save();
            return store;
        }

        private static string Get(Dictionary<string, object> m, string k) => m.TryGetValue(k, out var v) && v is string s ? s : null;

        private static string[] GetHosts(Dictionary<string, object> m)
        {
            if (m.TryGetValue("hosts", out var hv) && hv is List<object> list)
            {
                var outArr = new List<string>();
                foreach (var h in list) if (h is string hs) outArr.Add(hs);
                return outArr.ToArray();
            }
            return new string[0];
        }

        public void SetPaired(PairedPc pc)
        {
            Pc = pc;
            Save();
        }

        public void Forget()
        {
            Pc = null;
            Save();
        }

        public void Save()
        {
            var root = new Dictionary<string, object>
            {
                { "v", 1L },
                { "devicePriv", Hex.Encode(DeviceKey.Priv) }
            };
            if (Pc != null)
            {
                root["pc"] = new Dictionary<string, object>
                {
                    { "fp", Pc.PcFp },
                    { "name", Pc.PcName },
                    { "deviceId", Pc.DeviceId },
                    { "port", (long)Pc.Port },
                    { "hosts", new List<object>(Pc.Hosts ?? new string[0]) }
                };
            }
            var dir = Path.GetDirectoryName(_file);
            if (!string.IsNullOrEmpty(dir)) Directory.CreateDirectory(dir);
            var tmp = _file + ".tmp";
            File.WriteAllText(tmp, MiniJson.Serialize(root));
            if (File.Exists(_file)) File.Delete(_file);
            File.Move(tmp, _file);
        }
    }

    public static class Hex
    {
        public static string Encode(byte[] b)
        {
            var sb = new System.Text.StringBuilder(b.Length * 2);
            foreach (var x in b) sb.Append(x.ToString("x2"));
            return sb.ToString();
        }

        public static byte[] Decode(string s)
        {
            var outBytes = new byte[s.Length / 2];
            for (int i = 0; i < outBytes.Length; i++)
                outBytes[i] = System.Convert.ToByte(s.Substring(i * 2, 2), 16);
            return outBytes;
        }
    }
}
