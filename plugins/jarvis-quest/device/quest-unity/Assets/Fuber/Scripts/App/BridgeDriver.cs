// Köprüyü sahneye bağlayan sürücü + eşleşme akışı (docs/PROTOCOL.md §3, §5).
//  • Kayıtlı PC varsa açılışta RESUME ile otomatik bağlanır (adres değiştiyse keşif yayınından yeni adresi alır).
//  • Yoksa UDP 47853 keşfiyle ağdaki Fuber PC'yi bulur → kullanıcı holografik tuş takımıyla 6 haneli PIN girer →
//    PAIR el sıkışması → "paired" gelince eşleşme kaydedilir (sonraki açılışta resume).
//  • BridgeClient arka plan iş parçacığında çalışır; olaylar her karede Pump() ile ana iş parçacığında işlenir.
// Protokol ve kripto Fuber.Net'te (testli); burada yalnız akış yönetimi var.

using System.Collections.Generic;
using Fuber.Net;
using UnityEngine;

namespace Fuber.App
{
    public enum PairPhase
    {
        Searching,   // PC aranıyor (keşif dinleniyor)
        Found,       // PC bulundu, PIN bekleniyor
        Pairing,     // PIN gönderildi, yanıt bekleniyor
        Resuming,    // kayıtlı PC'ye bağlanılıyor
        Connected,   // bağlı (welcome alındı)
    }

    public sealed class BridgeDriver : MonoBehaviour
    {
        [Tooltip("Sese tepki verecek çekirdek (opsiyonel).")]
        public JarvisCore core;

        [Tooltip("JARVIS HUD: hud.snapshot / hud.log buraya iletilir.")]
        public HudController hud;

        public const int PinLength = 6;

        public PairPhase Phase { get; private set; } = PairPhase.Searching;
        public BridgeState State { get; private set; } = BridgeState.Disconnected;
        /// <summary>Kullanıcıya gösterilecek son durum/hata satırı (boş olabilir).</summary>
        public string Message { get; private set; } = "";
        /// <summary>Keşifte bulunan (seçili) PC; yoksa null.</summary>
        public DiscoveredPc FoundPc { get; private set; }
        /// <summary>Bağlı/kayıtlı PC adı.</summary>
        public string PcName => _store?.Pc?.PcName ?? FoundPc?.Name ?? "";

        private PairingStore _store;
        private BridgeClient _client;
        private DiscoveryListener _discovery;
        private DiscoveredPc _pairingPc;
        private string _pairingPin;
        private bool _welcomed;
        private float _nextPing;
        private float _nextDiscoveryCheck;

        private void Awake()
        {
            string file = System.IO.Path.Combine(Application.persistentDataPath, "fuber-xr-pairing.json");
            _store = PairingStore.Open(file, () => XrCrypto.RandomBytes(32));
            Debug.Log($"[FuberXR] Eşleşme dosyası: {file}; kayıtlı PC: {(_store.Pc != null ? _store.Pc.PcName : "yok")}");
            FuberAndroidNet.AcquireMulticastLock();
        }

        private void Start()
        {
            StartDiscovery();
            if (!TryResume()) SetPhase(PairPhase.Searching, "");
        }

        // ───────────── eşleşme ─────────────

        /// <summary>Bulunan PC'ye PIN ile eşleşmeyi başlatır (pair kipi). PIN 6 hane olmalı.</summary>
        public void BeginPairWithPin(string pin)
        {
            var pc = FoundPc;
            if (pc == null) { SetPhase(PairPhase.Searching, "Önce bilgisayar bulunmalı"); return; }
            if (pin == null || pin.Length != PinLength) { Message = "PIN 6 hane olmalı"; return; }
            if (!pc.Pairing) { Message = "Bilgisayarda eşleşmeyi aç (Fuber › Gözlük › Eşleştir)"; return; }

            _pairingPc = pc;
            _pairingPin = pin;
            var cfg = new BridgeConfig
            {
                Hosts = new[] { pc.Host },
                Port = pc.Port,
                ExpectedFp = pc.Fp,           // yayından gelen parmak izi (ekranda ilk 4 karakteri gösterilir)
                Mode = BridgeMode.Pair,
                PairPin = pin,
                DeviceKey = _store.DeviceKey,
                AutoReconnect = false,        // yanlış PIN otomatik tekrar denenmesin (PC'de 5 deneme hakkı)
            };
            SetPhase(PairPhase.Pairing, "Eşleşiyor…");
            StartClient(cfg);
        }

        /// <summary>Bağlıyken şifreli JSON iletisi gönderir (hud.action vb.). Bağlı değilse false.</summary>
        public bool SendJson(Dictionary<string, object> msg)
        {
            if (_client == null || State != BridgeState.Connected || Phase != PairPhase.Connected) return false;
            _client.SendJson(msg);
            return true;
        }

        /// <summary>Kayıtlı PC'ye yeniden bağlanır (resume kipi). Kayıt yoksa false.</summary>
        public bool TryResume(string[] hostsOverride = null)
        {
            var pc = _store.Pc;
            if (pc == null || string.IsNullOrEmpty(pc.DeviceId)) return false;
            var hosts = hostsOverride ?? pc.Hosts;
            if (hosts == null || hosts.Length == 0) return false;
            var cfg = new BridgeConfig
            {
                Hosts = hosts,
                Port = pc.Port > 0 ? pc.Port : XrConst.Port,
                ExpectedFp = pc.PcFp,
                Mode = BridgeMode.Resume,
                DeviceKey = _store.DeviceKey,
                DeviceId = pc.DeviceId,
                AutoReconnect = true,
            };
            SetPhase(PairPhase.Resuming, $"{pc.PcName} bilgisayarına bağlanıyor…");
            StartClient(cfg);
            return true;
        }

        /// <summary>Eşleşmeyi unut (PC'ye de bildirir) ve aramaya dön.</summary>
        public void ForgetPairing()
        {
            if (_client != null && State == BridgeState.Connected)
                _client.SendJson(new Dictionary<string, object> { { "t", "pairing.forget" } });
            StopClient();
            _store.Forget();
            SetPhase(PairPhase.Searching, "Eşleşme silindi");
        }

        private void StartClient(BridgeConfig cfg)
        {
            StopClient();
            _welcomed = false;
            _client = new BridgeClient(cfg);
            var mode = cfg.Mode;
            _client.OnStateChanged += (s) => OnState(s, mode);
            _client.OnError += (m) => OnClientError(m, mode);
            _client.OnJson += HandleJson;
            _client.OnBinary += (ch, seq, data) => { /* ses/ekran sonraki turda */ };
            _client.Start();
        }

        private void StopClient()
        {
            _client?.Stop();
            _client = null;
            State = BridgeState.Disconnected;
        }

        private void OnState(BridgeState s, BridgeMode mode)
        {
            State = s;
            if (s == BridgeState.Connected)
            {
                _nextPing = Time.unscaledTime + 1f;
                return;
            }
            if (s == BridgeState.Disconnected || s == BridgeState.Failed)
            {
                bool wasConnected = Phase == PairPhase.Connected;
                _welcomed = false;
                if (mode == BridgeMode.Pair && s == BridgeState.Disconnected && Phase == PairPhase.Pairing)
                {
                    // Eşleşme bağlantısı paired gelmeden kapandı (yanlış PIN / pencere kapalı / ağ).
                    SetPhase(FoundPc != null ? PairPhase.Found : PairPhase.Searching,
                        string.IsNullOrEmpty(Message) || Message == "Eşleşiyor…" ? "Eşleşme olmadı, PIN'i tekrar gir" : Message);
                }
                else if (wasConnected && _store.Pc != null)
                {
                    // Bağlantı koptu: kayıtlı PC'ye otomatik yeniden bağlan.
                    if (mode == BridgeMode.Pair) TryResume();
                    else SetPhase(PairPhase.Resuming, "Bağlantı koptu, yeniden bağlanıyor…");
                }
            }
        }

        private void OnClientError(string message, BridgeMode mode)
        {
            Debug.LogWarning($"[FuberXR] {message}");
            if (message == null) return;
            if (mode == BridgeMode.Resume && message.Contains("unknown_device"))
            {
                // PC bu gözlüğü artık tanımıyor → kaydı sil, yeniden eşleş.
                StopClient();
                _store.Forget();
                SetPhase(PairPhase.Searching, "Bilgisayar eşleşmeyi tanımıyor, yeniden eşleş");
            }
            else if (message.Contains("not_pairing"))
            {
                Message = "Bilgisayarda eşleşmeyi aç (Fuber › Gözlük › Eşleştir)";
            }
            else if (message.Contains("busy"))
            {
                Message = "Bilgisayara başka bir gözlük bağlı";
            }
            else if (message.Contains("parmak izi"))
            {
                Message = "Güvenlik: bilgisayar kimliği tutmadı";
            }
        }

        private void HandleJson(string json)
        {
            var msg = MiniJson.ParseObject(json);
            if (msg == null || !msg.TryGetValue("t", out var tv)) return;
            switch (tv as string)
            {
                case "paired":
                    if (_pairingPc != null)
                    {
                        _store.SetPaired(new PairedPc
                        {
                            PcFp = _pairingPc.Fp,
                            PcName = msg.TryGetValue("name", out var nm) && nm is string ns && ns.Length > 0 ? ns : _pairingPc.Name,
                            DeviceId = msg.TryGetValue("deviceId", out var di) ? di as string : null,
                            Hosts = new[] { _pairingPc.Host },
                            Port = _pairingPc.Port,
                        });
                        Debug.Log("[FuberXR] Eşleşme kaydedildi.");
                    }
                    _pairingPin = null;
                    SetPhase(PairPhase.Connected, "Eşleşti");
                    break;
                case "welcome":
                    _welcomed = true;
                    if (msg.TryGetValue("pcName", out var pn) && pn is string pcName && pcName.Length > 0 && _store.Pc != null && _store.Pc.PcName != pcName)
                    {
                        _store.Pc.PcName = pcName;
                        _store.Save();
                    }
                    SetPhase(PairPhase.Connected, "");
                    _client?.SendJson(new Dictionary<string, object> { { "t", "snapshot" } });
                    Debug.Log("[FuberXR] Bağlantı kuruldu (welcome).");
                    break;
                case "error":
                    if (msg.TryGetValue("code", out var code) && (code as string) == "bad_code")
                        Message = "PIN yanlış, tekrar dene";
                    else if (msg.TryGetValue("message", out var em) && em is string es)
                        Message = es;
                    break;
                case "bye":
                    if (msg.TryGetValue("reason", out var rs) && (rs as string) == "device_removed")
                    {
                        StopClient();
                        _store.Forget();
                        SetPhase(PairPhase.Searching, "Bilgisayar eşleşmeyi kaldırdı");
                    }
                    break;
                case "hud.snapshot":
                    hud?.OnSnapshotJson(json);
                    break;
                case "hud.voice":
                    hud?.OnVoiceJson(json);
                    break;
                case "hud.log":
                    hud?.OnLogJson(json);
                    break;
                case "level":
                    if (core != null && msg.TryGetValue("v", out var vv))
                    {
                        float v = vv is double d ? (float)d : vv is long l ? l : 0f;
                        core.SetAudioLevel(v);
                    }
                    break;
            }
        }

        // ───────────── keşif ─────────────

        private void StartDiscovery()
        {
            try
            {
                _discovery = new DiscoveryListener();
                _discovery.Start();
                Debug.Log("[FuberXR] Keşif dinleniyor (UDP 47853).");
            }
            catch (System.Exception e)
            {
                _discovery = null;
                Message = "Ağ dinlenemiyor: " + e.Message;
                Debug.LogWarning("[FuberXR] Keşif başlatılamadı: " + e.Message);
            }
        }

        private void CheckDiscovery()
        {
            if (_discovery == null) return;
            var list = _discovery.Current();
            var paired = _store.Pc;

            if (paired != null)
            {
                // Kayıtlı PC başka adreste yayın yapıyorsa (IP değişti) resume'u yeni adresle yeniden başlat.
                if (Phase == PairPhase.Resuming)
                {
                    foreach (var pc in list)
                    {
                        if (pc.Fp != paired.PcFp) continue;
                        bool known = paired.Hosts != null && System.Array.IndexOf(paired.Hosts, pc.Host) >= 0;
                        if (!known)
                        {
                            paired.Hosts = new[] { pc.Host };
                            paired.Port = pc.Port;
                            _store.Save();
                            TryResume();
                        }
                        break;
                    }
                }
                return;
            }

            if (Phase != PairPhase.Searching && Phase != PairPhase.Found) return;
            // Eşleşme penceresi açık olanı tercih et; yoksa ilk bulunanı göster.
            DiscoveredPc best = null;
            foreach (var pc in list) { if (best == null || (pc.Pairing && !best.Pairing)) best = pc; }
            if (best != null)
            {
                bool changed = FoundPc == null || FoundPc.Fp != best.Fp || FoundPc.Host != best.Host || FoundPc.Pairing != best.Pairing;
                FoundPc = best;
                if (Phase == PairPhase.Searching || changed)
                    SetPhase(PairPhase.Found, best.Pairing ? "" : "Bilgisayarda eşleşmeyi aç (Fuber › Gözlük › Eşleştir)");
            }
            else if (Phase == PairPhase.Found)
            {
                FoundPc = null;
                SetPhase(PairPhase.Searching, "");
            }
        }

        private void SetPhase(PairPhase phase, string message)
        {
            if (Phase != phase) Debug.Log($"[FuberXR] Durum: {Phase} → {phase} {message}");
            Phase = phase;
            Message = message ?? "";
        }

        // ───────────── kare döngüsü ─────────────

        private void Update()
        {
            _client?.Pump();

            if (Time.unscaledTime >= _nextDiscoveryCheck)
            {
                _nextDiscoveryCheck = Time.unscaledTime + 0.5f;
                CheckDiscovery();
            }

            // Canlılık: PC 15 sn ileti görmezse kapatır → 5 sn'de bir ping.
            if (_client != null && State == BridgeState.Connected && Time.unscaledTime >= _nextPing)
            {
                _nextPing = Time.unscaledTime + 5f;
                long ts = (long)(System.DateTime.UtcNow - new System.DateTime(1970, 1, 1)).TotalMilliseconds;
                _client.SendJson(new Dictionary<string, object> { { "t", "ping" }, { "ts", ts } });
            }
        }

        private void OnApplicationPause(bool paused)
        {
            // Gözlük çıkarılınca uygulama duraklar; dönünce kayıtlı PC'ye yeniden bağlan.
            if (!paused && _store != null && _store.Pc != null && (_client == null || State != BridgeState.Connected))
                TryResume();
        }

        private void OnDestroy()
        {
            _client?.Stop();
            _discovery?.Stop();
            FuberAndroidNet.ReleaseMulticastLock();
        }
    }
}
