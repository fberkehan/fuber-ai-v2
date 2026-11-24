// Çerçeve kodlama/çözme, düz metin iletileri ve QR (protocol.ts karşılığı).
// Çerçeve = u32 BE uzunluk + gövde. Düz metin = 0x01 + UTF-8 JSON | 0x02 + u8 kanal + u32 BE sıra + veri.

using System;
using System.Collections.Generic;
using System.Text;

namespace Fuber.Net
{
    public enum PlainKind { Json, Binary }

    public sealed class PlainMessage
    {
        public PlainKind Kind;
        public string Json;    // Kind == Json: ham UTF-8 JSON metni
        public byte Channel;   // Kind == Binary
        public uint Seq;       // Kind == Binary
        public byte[] Data;    // Kind == Binary gövdesi
    }

    public static class FrameCodec
    {
        public static byte[] EncodeFrame(byte[] body)
        {
            if (body.Length == 0 || body.Length > XrConst.MaxFrame)
                throw new XrProtocolException("frame_size", $"geçersiz çerçeve boyu {body.Length}");
            var outBytes = new byte[4 + body.Length];
            outBytes[0] = (byte)(body.Length >> 24);
            outBytes[1] = (byte)(body.Length >> 16);
            outBytes[2] = (byte)(body.Length >> 8);
            outBytes[3] = (byte)body.Length;
            Buffer.BlockCopy(body, 0, outBytes, 4, body.Length);
            return outBytes;
        }

        // ───────── düz metin ─────────
        public static byte[] EncodeJson(string json)
        {
            var body = Encoding.UTF8.GetBytes(json);
            var outBytes = new byte[1 + body.Length];
            outBytes[0] = XrConst.KindJson;
            Buffer.BlockCopy(body, 0, outBytes, 1, body.Length);
            return outBytes;
        }

        public static byte[] EncodeBinary(byte channel, uint seq, byte[] data)
        {
            var outBytes = new byte[6 + data.Length];
            outBytes[0] = XrConst.KindBinary;
            outBytes[1] = channel;
            outBytes[2] = (byte)(seq >> 24);
            outBytes[3] = (byte)(seq >> 16);
            outBytes[4] = (byte)(seq >> 8);
            outBytes[5] = (byte)seq;
            Buffer.BlockCopy(data, 0, outBytes, 6, data.Length);
            return outBytes;
        }

        public static PlainMessage DecodePlain(byte[] plain)
        {
            if (plain.Length < 1) throw new XrProtocolException("bad_message", "boş ileti");
            byte kind = plain[0];
            if (kind == XrConst.KindJson)
            {
                return new PlainMessage { Kind = PlainKind.Json, Json = Encoding.UTF8.GetString(plain, 1, plain.Length - 1) };
            }
            if (kind == XrConst.KindBinary)
            {
                if (plain.Length < 6) throw new XrProtocolException("bad_message", "ikili ileti başlığı eksik");
                uint seq = (uint)((plain[2] << 24) | (plain[3] << 16) | (plain[4] << 8) | plain[5]);
                var data = new byte[plain.Length - 6];
                Buffer.BlockCopy(plain, 6, data, 0, data.Length);
                return new PlainMessage { Kind = PlainKind.Binary, Channel = plain[1], Seq = seq, Data = data };
            }
            throw new XrProtocolException("bad_message", $"bilinmeyen ileti türü {kind}");
        }
    }

    /// <summary>Akıştan (TCP) çerçeve ayıklar; u32 BE uzunluk önekli. 0 ya da MaxFrame üstü = hata.</summary>
    public sealed class FrameDecoder
    {
        private readonly List<byte> _buf = new List<byte>();

        public List<byte[]> Push(byte[] chunk, int length)
        {
            for (int i = 0; i < length; i++) _buf.Add(chunk[i]);
            var frames = new List<byte[]>();
            while (true)
            {
                if (_buf.Count < 4) break;
                long len = ((long)_buf[0] << 24) | ((long)_buf[1] << 16) | ((long)_buf[2] << 8) | _buf[3];
                if (len == 0 || len > XrConst.MaxFrame) throw new XrProtocolException("frame_size", $"geçersiz çerçeve boyu {len}");
                if (_buf.Count < 4 + len) break;
                var frame = new byte[len];
                _buf.CopyTo(4, frame, 0, (int)len);
                _buf.RemoveRange(0, (int)(4 + len));
                frames.Add(frame);
            }
            return frames;
        }
    }

    public sealed class XrQrInfo
    {
        public string[] Hosts;
        public int Port;
        public string Fp;
        public string Code;
        public string Name;
    }

    public static class QrCodec
    {
        public const int MaxBytes = 213;

        public static string BuildUri(XrQrInfo info)
        {
            var hosts = new List<string>(info.Hosts);
            if (hosts.Count > 4) hosts = hosts.GetRange(0, 4);
            string name = info.Name ?? "";
            Func<string> make = () =>
                $"fuberxr:{XrConst.ProtocolVersion}?h={string.Join(",", hosts)}&p={info.Port}&f={info.Fp}&c={info.Code}&n={Uri.EscapeDataString(name)}";
            while (Encoding.UTF8.GetByteCount(make()) > MaxBytes && hosts.Count > 1) hosts.RemoveAt(hosts.Count - 1);
            while (Encoding.UTF8.GetByteCount(make()) > MaxBytes && name.Length > 0) name = name.Substring(0, name.Length - 1);
            return make();
        }

        public static XrQrInfo ParseUri(string uri)
        {
            string s = uri.Trim();
            int q = s.IndexOf('?');
            if (q < 0 || !s.StartsWith("fuberxr:")) throw new XrProtocolException("bad_qr", "fuberxr: içeriği değil");
            string verStr = s.Substring("fuberxr:".Length, q - "fuberxr:".Length);
            if (!int.TryParse(verStr, out int ver)) throw new XrProtocolException("bad_qr", "sürüm yok");
            if (ver != XrConst.ProtocolVersion) throw new XrProtocolException("bad_version", "desteklenmeyen QR sürümü");
            var map = new Dictionary<string, string>();
            foreach (var part in s.Substring(q + 1).Split('&'))
            {
                int eq = part.IndexOf('=');
                if (eq > 0) map[part.Substring(0, eq)] = part.Substring(eq + 1);
            }
            string hraw = map.TryGetValue("h", out var hv) ? hv : "";
            var hosts = new List<string>();
            foreach (var h in hraw.Split(',')) if (h.Length > 0) hosts.Add(h);
            if (!map.TryGetValue("p", out var pstr) || !int.TryParse(pstr, out int port) || port < 1 || port > 65535 || hosts.Count == 0)
                throw new XrProtocolException("bad_qr", "adres ya da kapı eksik");
            string fp = map.TryGetValue("f", out var fv) ? fv : "";
            string code = map.TryGetValue("c", out var cv) ? cv : "";
            XrCrypto.FromB64u(fp, 32);
            XrCrypto.FromB64u(code, 16);
            string name = map.TryGetValue("n", out var nv) ? Uri.UnescapeDataString(nv) : "";
            return new XrQrInfo { Hosts = hosts.ToArray(), Port = port, Fp = fp, Code = code, Name = name };
        }
    }
}
