// Köprü istemcisi (gözlük): protocol.ts'in gözlük tarafı. Arka plan iş parçacığında TCP bağlanır, el sıkışmayı
// (pair/resume) yürütür, şifreli çerçeveleri çözer ve olayları ANA İŞ PARÇACIĞI kuyruğuna koyar (Unity API'leri
// yalnız ana iş parçacığından çağrılır). Yeniden bağlanma: artan bekleme ile adres listesini sırayla dener.
//
// Kullanım (ana iş parçacığı): her karede Pump() çağır; olaylar OnJson/OnBinary/OnStateChanged ile gelir.
// Send/SendJson ana iş parçacığından güvenle çağrılır (gönderim kilidi + sayaç şifreleyici korumalı).

using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net.Sockets;
using System.Text;
using System.Threading;

namespace Fuber.Net
{
    public enum BridgeState { Disconnected, Connecting, Handshaking, Connected, Failed }

    public enum BridgeMode { Pair, Resume }

    public sealed class BridgeConfig
    {
        public string[] Hosts;
        public int Port = XrConst.Port;
        public string ExpectedFp;          // QR/kayıttan beklenen bilgisayar parmak izi
        public BridgeMode Mode = BridgeMode.Resume;
        public string PairCode;            // Pair kipinde QR sırrı (ya da PIN akışı için ayrı)
        public string PairPin;             // Pair kipinde PIN (kod yoksa)
        public XrKeyPair DeviceKey;        // kalıcı cihaz anahtarı
        public string DeviceId;            // resume kipinde PC'nin atadığı kimlik
        public string DeviceName = "Meta Quest 3";
        public string DeviceModel = "Quest 3";
        public string AppVersion = "0.1.0";
        public bool AutoReconnect = true;
    }

    public sealed class BridgeEvent
    {
        public enum Kind { State, Json, Binary, Paired, Error }
        public Kind Type;
        public BridgeState State;
        public string Json;
        public byte Channel;
        public uint Seq;
        public byte[] Data;
        public string Message;
    }

    public sealed class BridgeClient
    {
        private readonly BridgeConfig _cfg;
        private Thread _thread;
        private volatile bool _running;
        private volatile BridgeState _state = BridgeState.Disconnected;

        private TcpClient _tcp;
        private NetworkStream _stream;
        private CipherState _send;   // c2s (gözlük → PC)
        private CipherState _recv;   // s2c (PC → gözlük)
        private readonly object _sendLock = new object();

        private readonly ConcurrentQueue<BridgeEvent> _events = new ConcurrentQueue<BridgeEvent>();
        private readonly ConcurrentQueue<byte[]> _outbox = new ConcurrentQueue<byte[]>(); // şifrelenmemiş düz metin

        public BridgeState State => _state;
        public event Action<BridgeState> OnStateChanged;
        public event Action<string> OnJson;                  // ham JSON
        public event Action<byte, uint, byte[]> OnBinary;
        public event Action<string> OnError;

        public BridgeClient(BridgeConfig cfg) { _cfg = cfg; }

        public void Start()
        {
            if (_running) return;
            _running = true;
            _thread = new Thread(Run) { IsBackground = true, Name = "FuberXrBridge" };
            _thread.Start();
        }

        public void Stop()
        {
            _running = false;
            CloseSocket();
        }

        // Ana iş parçacığından: olay kuyruğunu boşalt.
        public void Pump()
        {
            while (_events.TryDequeue(out var ev))
            {
                switch (ev.Type)
                {
                    case BridgeEvent.Kind.State: OnStateChanged?.Invoke(ev.State); break;
                    case BridgeEvent.Kind.Json: OnJson?.Invoke(ev.Json); break;
                    case BridgeEvent.Kind.Binary: OnBinary?.Invoke(ev.Channel, ev.Seq, ev.Data); break;
                    case BridgeEvent.Kind.Error: OnError?.Invoke(ev.Message); break;
                }
            }
        }

        /// <summary>pair iletisi. Sözleşme (JARVIS-HUD): cihaz türü hem üst düzey `kind` hem `device.kind` olarak gönderilir.</summary>
        public static Dictionary<string, object> BuildPairMessage(BridgeConfig cfg)
        {
            var pair = new Dictionary<string, object>
            {
                { "t", "pair" },
                { "kind", "quest" },
                { "device", new Dictionary<string, object> { { "name", cfg.DeviceName }, { "pub", XrCrypto.B64u(cfg.DeviceKey.Pub) }, { "model", cfg.DeviceModel }, { "kind", "quest" }, { "app", cfg.AppVersion } } }
            };
            if (!string.IsNullOrEmpty(cfg.PairCode)) pair["code"] = cfg.PairCode;
            else pair["pin"] = cfg.PairPin;
            return pair;
        }

        public void SendJson(string json)
        {
            _outbox.Enqueue(FrameCodec.EncodeJson(json));
            FlushOutbox();
        }

        public void SendJson(Dictionary<string, object> msg) => SendJson(MiniJson.Serialize(msg));

        public void SendBinary(byte channel, uint seq, byte[] data)
        {
            _outbox.Enqueue(FrameCodec.EncodeBinary(channel, seq, data));
            FlushOutbox();
        }

        private void SetState(BridgeState s)
        {
            _state = s;
            _events.Enqueue(new BridgeEvent { Type = BridgeEvent.Kind.State, State = s });
        }

        private void Run()
        {
            int attempt = 0;
            while (_running)
            {
                try
                {
                    if (ConnectOnce()) { attempt = 0; ReceiveLoop(); }
                }
                catch (Exception e)
                {
                    _events.Enqueue(new BridgeEvent { Type = BridgeEvent.Kind.Error, Message = e.Message });
                }
                CloseSocket();
                if (!_running || !_cfg.AutoReconnect) { SetState(BridgeState.Disconnected); break; }
                SetState(BridgeState.Failed);
                attempt++;
                int waitMs = Math.Min(10000, 500 * attempt);
                Sleep(waitMs);
            }
        }

        private void Sleep(int ms)
        {
            int slept = 0;
            while (_running && slept < ms) { Thread.Sleep(50); slept += 50; }
        }

        private bool ConnectOnce()
        {
            SetState(BridgeState.Connecting);
            foreach (var host in _cfg.Hosts)
            {
                if (!_running) return false;
                try
                {
                    var tcp = new TcpClient();
                    var ar = tcp.BeginConnect(host, _cfg.Port, null, null);
                    if (!ar.AsyncWaitHandle.WaitOne(2000)) { tcp.Close(); continue; }
                    tcp.EndConnect(ar);
                    tcp.NoDelay = true;
                    _tcp = tcp;
                    _stream = tcp.GetStream();
                    if (Handshake()) return true;
                    CloseSocket();
                }
                catch { CloseSocket(); }
            }
            return false;
        }

        private bool Handshake()
        {
            SetState(BridgeState.Handshaking);
            var clientEph = XrCrypto.KeyPair(RandomBytes(32));

            // hello1
            var hello1 = new Dictionary<string, object> { { "t", "hello" }, { "v", (long)XrConst.ProtocolVersion }, { "mode", _cfg.Mode == BridgeMode.Pair ? "pair" : "resume" }, { "eph", XrCrypto.B64u(clientEph.Pub) } };
            if (_cfg.Mode == BridgeMode.Resume) hello1["deviceId"] = _cfg.DeviceId;
            var hello1Bytes = Encoding.UTF8.GetBytes(MiniJson.Serialize(hello1));
            WriteFrameRaw(hello1Bytes);

            // serverHello (düz)
            var shFrame = ReadFrameRaw();
            if (shFrame == null) return false;
            var sh = MiniJson.ParseObject(Encoding.UTF8.GetString(shFrame));
            if (sh == null || !(sh.TryGetValue("t", out var t) && (t as string) == "hello"))
            {
                _events.Enqueue(new BridgeEvent { Type = BridgeEvent.Kind.Error, Message = "reject: " + (sh != null && sh.TryGetValue("code", out var c) ? c : "?") });
                return false;
            }
            var serverEphPub = XrCrypto.FromB64u((string)sh["eph"], 32);
            var serverStaticPub = XrCrypto.FromB64u((string)sh["static"], 32);
            if (!string.IsNullOrEmpty(_cfg.ExpectedFp) && XrCrypto.Fingerprint(serverStaticPub) != _cfg.ExpectedFp)
            {
                _events.Enqueue(new BridgeEvent { Type = BridgeEvent.Kind.Error, Message = "parmak izi tutmadı (MITM)" });
                return false;
            }

            XrKeyPair device = _cfg.Mode == BridgeMode.Resume ? _cfg.DeviceKey : null;
            var keys = XrCrypto.ClientKeys(clientEph, serverEphPub, serverStaticPub, device, hello1Bytes, shFrame);
            _send = new CipherState(keys.C2s);
            _recv = new CipherState(keys.S2c);

            // ilk şifreli: pair ya da auth
            if (_cfg.Mode == BridgeMode.Pair)
            {
                var pair = BuildPairMessage(_cfg);
                WriteEncrypted(FrameCodec.EncodeJson(MiniJson.Serialize(pair)));
            }
            else
            {
                WriteEncrypted(FrameCodec.EncodeJson(MiniJson.Serialize(new Dictionary<string, object> { { "t", "auth" } })));
            }

            SetState(BridgeState.Connected);
            return true;
        }

        private void ReceiveLoop()
        {
            var decoder = new FrameDecoder();
            var buf = new byte[16384];
            while (_running)
            {
                FlushOutbox();
                int n;
                try { n = _stream.Read(buf, 0, buf.Length); }
                catch { break; }
                if (n <= 0) break;
                List<byte[]> frames;
                try { frames = decoder.Push(buf, n); }
                catch (Exception e) { _events.Enqueue(new BridgeEvent { Type = BridgeEvent.Kind.Error, Message = e.Message }); break; }
                foreach (var frame in frames)
                {
                    byte[] plain;
                    try { plain = _recv.Open(frame); }
                    catch (Exception) { return; } // şifre çözme hatası → bağlantı kapanır
                    var msg = FrameCodec.DecodePlain(plain);
                    if (msg.Kind == PlainKind.Json)
                        _events.Enqueue(new BridgeEvent { Type = BridgeEvent.Kind.Json, Json = msg.Json });
                    else
                        _events.Enqueue(new BridgeEvent { Type = BridgeEvent.Kind.Binary, Channel = msg.Channel, Seq = msg.Seq, Data = msg.Data });
                }
            }
        }

        private void FlushOutbox()
        {
            if (_send == null || _stream == null) return;
            while (_outbox.TryDequeue(out var plain))
            {
                try { WriteEncrypted(plain); }
                catch { break; }
            }
        }

        private void WriteEncrypted(byte[] plain)
        {
            lock (_sendLock)
            {
                if (_send == null || _stream == null) return;
                var frame = FrameCodec.EncodeFrame(_send.Seal(plain));
                _stream.Write(frame, 0, frame.Length);
            }
        }

        private void WriteFrameRaw(byte[] body)
        {
            var frame = FrameCodec.EncodeFrame(body);
            _stream.Write(frame, 0, frame.Length);
        }

        private byte[] ReadFrameRaw()
        {
            var head = ReadExact(4);
            if (head == null) return null;
            long len = ((long)head[0] << 24) | ((long)head[1] << 16) | ((long)head[2] << 8) | head[3];
            if (len <= 0 || len > XrConst.MaxFrame) throw new XrProtocolException("frame_size", "geçersiz çerçeve");
            return ReadExact((int)len);
        }

        private byte[] ReadExact(int n)
        {
            var outBytes = new byte[n];
            int got = 0;
            while (got < n)
            {
                int r = _stream.Read(outBytes, got, n - got);
                if (r <= 0) return null;
                got += r;
            }
            return outBytes;
        }

        private void CloseSocket()
        {
            try { _stream?.Close(); } catch { }
            try { _tcp?.Close(); } catch { }
            _stream = null;
            _tcp = null;
            _send = null;
            _recv = null;
        }

        private static byte[] RandomBytes(int n)
        {
            var b = new byte[n];
            var rng = new Org.BouncyCastle.Security.SecureRandom();
            rng.NextBytes(b);
            return b;
        }
    }
}
