// AES-256-GCM yön şifresi (protocol.ts CipherState karşılığı). nonce = 4 bayt sıfır || u64 BE sayaç; her yön kendi
// sayacını 0'dan başlatır, her çerçevede 1 artar. Şifreli gövde = şifreli metin || 16 bayt etiket. AAD yok.
// BouncyCastle GcmBlockCipher kullanır (System.Security.Cryptography.AesGcm tüm Unity/IL2CPP hedeflerinde yok).

using System;
using Org.BouncyCastle.Crypto.Engines;
using Org.BouncyCastle.Crypto.Modes;
using Org.BouncyCastle.Crypto.Parameters;

namespace Fuber.Net
{
    public sealed class CipherState
    {
        private readonly byte[] _key;
        private ulong _counter;

        public CipherState(byte[] key)
        {
            if (key.Length != 32) throw new XrProtocolException("bad_key", "AES-256 anahtarı 32 bayt olmalı");
            _key = (byte[])key.Clone();
            _counter = 0;
        }

        public ulong NextCounter => _counter;

        public static byte[] NonceFor(ulong counter)
        {
            var nonce = new byte[12];
            // 4 bayt sıfır + u64 büyük-uçlu sayaç
            nonce[4] = (byte)(counter >> 56);
            nonce[5] = (byte)(counter >> 48);
            nonce[6] = (byte)(counter >> 40);
            nonce[7] = (byte)(counter >> 32);
            nonce[8] = (byte)(counter >> 24);
            nonce[9] = (byte)(counter >> 16);
            nonce[10] = (byte)(counter >> 8);
            nonce[11] = (byte)counter;
            return nonce;
        }

        public byte[] Seal(byte[] plain)
        {
            var cipher = new GcmBlockCipher(new AesEngine());
            var p = new AeadParameters(new KeyParameter(_key), XrConst.TagBytes * 8, NonceFor(_counter));
            cipher.Init(true, p);
            var outBuf = new byte[cipher.GetOutputSize(plain.Length)];
            int len = cipher.ProcessBytes(plain, 0, plain.Length, outBuf, 0);
            cipher.DoFinal(outBuf, len);
            _counter++;
            return outBuf; // ciphertext || tag
        }

        public byte[] Open(byte[] sealedBytes)
        {
            if (sealedBytes.Length < XrConst.TagBytes) throw new XrProtocolException("decrypt", "şifreli çerçeve çok kısa");
            var cipher = new GcmBlockCipher(new AesEngine());
            var p = new AeadParameters(new KeyParameter(_key), XrConst.TagBytes * 8, NonceFor(_counter));
            cipher.Init(false, p);
            var outBuf = new byte[cipher.GetOutputSize(sealedBytes.Length)];
            byte[] result;
            try
            {
                int len = cipher.ProcessBytes(sealedBytes, 0, sealedBytes.Length, outBuf, 0);
                len += cipher.DoFinal(outBuf, len);
                if (len == outBuf.Length) result = outBuf;
                else { result = new byte[len]; Buffer.BlockCopy(outBuf, 0, result, 0, len); }
            }
            catch (Exception)
            {
                throw new XrProtocolException("decrypt", "şifre çözülemedi (bozuk, yeniden oynatılmış ya da sıra dışı çerçeve)");
            }
            _counter++;
            return result;
        }
    }
}
