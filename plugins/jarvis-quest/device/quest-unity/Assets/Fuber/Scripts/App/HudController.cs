// JARVIS HUD denetleyicisi: panelleri kullanıcının önünde ~1.4 m'lik hafif kavisli bir yay üzerine kurar, dünyada
// sabit tutar (açılışta bir kez yerleşir; "çağır" hareketiyle yeniden önüne gelir), köprüden gelen hud.snapshot /
// hud.log verisini panellere dağıtır, hud.action iletilerini gönderir.
//
// VERİ DÜRÜSTLÜĞÜ: hiç snapshot gelmediyse ya da bölüm `off` ise panel "BAĞLI DEĞİL" yazar (sayı yok); köprü kopmuş
// ya da son snapshot 12 sn'den eskiyse / bölüm `stale` ise panel soluk + "GECİKMELİ" gösterir (son gerçek değerler).

using System.Collections.Generic;
using Fuber.Net;
using UnityEngine;

namespace Fuber.App
{
    public sealed class HudController : MonoBehaviour
    {
        [Header("Bağlantılar")]
        public BridgeDriver driver;
        public FuberHandInteractor interactor;
        public GameObject pairingPanel;
        public Font font;
        public Material material;

        [Header("Yerleşim")]
        [Tooltip("Panellerin başa uzaklığı (m): 1.2–1.6 aralığı.")]
        public float radius = 1.28f;
        [Tooltip("Göz hizasına göre yükseklik (m).")]
        public float heightOffset = -0.05f;
        public float maxPoseWait = 3f;

        [Header("Önizleme (ekran görüntüsü / test)")]
        public bool previewMode;

        public const float StaleAfterSec = 12f;

        public HudTopBar Top { get; private set; }
        public HudGreeting Greeting { get; private set; }
        public HudEnvPanel Env { get; private set; }
        public HudCalPanel Cal { get; private set; }
        public HudBioPanel Bio { get; private set; }
        public HudFinPanel Fin { get; private set; }
        public HudLinksPanel Links { get; private set; }
        public HudLogPanel Log { get; private set; }
        public HudWorkshopPanel Workshop { get; private set; }
        public HudJobsPanel Jobs { get; private set; }
        public HudNoticesPanel Notices { get; private set; }
        public string CurrentTab { get; private set; } = "overview";
        public HudCoreView Core { get; private set; }
        public HudMenuPanel Menu { get; private set; }
        public HudGestures Gestures { get; private set; }
        public HudSnapshot Snapshot { get; private set; }
        public bool EverReceived => _ever;
        public int SnapshotsReceived { get; private set; }
        public int SnapshotsRejected { get; private set; }

        private HudKit _kit;
        private Transform _panels;
        private Transform _root;                 // yerleşim çerçevesi (baş konumu + yön)
        private readonly Dictionary<string, HudPanelBase> _byId = new Dictionary<string, HudPanelBase>();
        private readonly List<HudPanelBase> _all = new List<HudPanelBase>();
        private readonly List<HudLogEntry> _log = new List<HudLogEntry>();
        private bool _built, _placed, _ever;
        private float _t, _recvAt, _nextState, _nextLinks, _connectedSince = -1f;
        private bool _prevLaggy = true;

        // yan etki: çekirdek + panel başlangıç noktaları
        private sealed class Home { public Transform T; public Vector3 Local; public float Yaw; public Vector3 Scale; }
        private readonly List<Home> _homes = new List<Home>();
        private Home _coreHome;
        private Vector3 _coreDefault;
        private readonly Dictionary<string, (Vector3 local, float yaw)> _defaults = new Dictionary<string, (Vector3, float)>();
        private string _localMode;
        private float _tabLockUntil, _voiceStamp = -10f;
        private OVRDisplay _display;

        // çağır animasyonu
        private float _summonT = -1f;
        private readonly List<(Transform t, Vector3 p, Quaternion r, Vector3 s)> _summonFrom = new List<(Transform, Vector3, Quaternion, Vector3)>();

        // bağlantı çizgileri
        private Mesh _linkMesh;
        private readonly HudMesh _lm = new HudMesh();

        // ───────── kurulum ─────────

        private void Awake()
        {
            HudTheme.Set("cyan", true);
            var p = new GameObject("Paneller");
            p.transform.SetParent(transform, false);
            p.SetActive(false);                 // yerleşene kadar görünmesin
            _panels = p.transform;
            var r = new GameObject("Yerleşim çerçevesi");
            r.transform.SetParent(transform, false);
            _root = r.transform;
        }

        private void Start() { if (!_built) Build(); }

        private float Sin(float deg) => Mathf.Sin(deg * Mathf.Deg2Rad);
        private float Cos(float deg) => Mathf.Cos(deg * Mathf.Deg2Rad);

        private T AddPanel<T>(string id, string tag, string title, float w, float h, float yawDeg, float y, float? r = null, bool closable = true) where T : HudPanelBase
        {
            var go = new GameObject(id);
            go.transform.SetParent(_panels, false);
            var panel = go.AddComponent<T>();
            panel.Closable = closable;
            panel.Setup(_kit, id, tag, title, w, h);
            panel.Init();
            float rad = r ?? radius;
            panel.HomeLocal = new Vector3(rad * Sin(yawDeg), y, rad * Cos(yawDeg));
            panel.HomeYaw = yawDeg;
            panel.HomeScale = Vector3.one;
            panel.OnClosed = _ => { if (Menu != null) Menu.Redraw(); };
            _byId[id] = panel;
            _all.Add(panel);
            return panel;
        }

        public void Build()
        {
            if (_built) return;
            _built = true;
            if (font == null || material == null) { Debug.LogError("[FuberHud] font/malzeme atanmamış."); return; }
            _kit = new HudKit { Font = font, Material = material };

            // Yay: sol sütun −27°, sağ sütun +27°; üstte sekmeler + selam.
            Top = AddPanel<HudTopBar>("top", "", "", 1.8f, 0.09f, 0f, 0.70f, null, false);
            Greeting = AddPanel<HudGreeting>("greet", "", "", 0.8f, 0.13f, 0f, 0.46f, null, false);
            Env = AddPanel<HudEnvPanel>("env", "ENV.06", "YEREL KOŞULLAR", 0.52f, 0.34f, -27f, 0.30f);
            Cal = AddPanel<HudCalPanel>("cal", "CAL.02", "BUGÜN / TAKVİM", 0.52f, 0.36f, -27f, -0.075f);
            Bio = AddPanel<HudBioPanel>("bio", "BIO.05", "BİYOMETRİ", 0.52f, 0.34f, -27f, -0.45f);
            Fin = AddPanel<HudFinPanel>("fin", "FIN.03", "PORTFÖY / PİYASA", 0.52f, 0.36f, 27f, 0.30f);
            Links = AddPanel<HudLinksPanel>("links", "LNK.07", "BAĞLANTILAR", 0.52f, 0.36f, 27f, -0.08f);
            Log = AddPanel<HudLogPanel>("log", "LOG.04", "ASİSTAN GÜNLÜĞÜ", 0.52f, 0.36f, 27f, -0.46f);
            // sekmeye özel paneller (yalnız ATÖLYE / İLETİŞİM sekmesinde görünür)
            Workshop = AddPanel<HudWorkshopPanel>("workshop", "ATL.08", "ÇEKİRDEK AYRINTISI", 0.62f, 0.42f, -30f, 0.0f);
            Jobs = AddPanel<HudJobsPanel>("jobs", "İŞ.09", "İŞLER", 0.5f, 0.36f, 30f, 0.0f);
            Notices = AddPanel<HudNoticesPanel>("notices", "BİL.10", "BİLDİRİMLER", 0.52f, 0.36f, 30f, -0.04f);
            foreach (var hp in new HudPanelBase[] { Workshop, Jobs, Notices }) { hp.TabHidden = true; hp.gameObject.SetActive(false); }
            foreach (var hp in _all) _defaults[hp.PanelId] = (hp.HomeLocal, hp.HomeYaw);

            Top.OnTab = tab =>
            {
                if (!SendAction(HudActions.Tab(tab), "SEKME · " + TabName(tab))) return;
                Top.ActiveTab = tab; _tabLockUntil = Time.unscaledTime + 1.5f;
                ApplyTab(tab);
            };
            Top.PcName = () => driver != null ? driver.PcName : "";
            Cal.OnOpen = r => SendAction(HudActions.Open(r), "OLAY · MASAÜSTÜNDE AÇILIYOR");
            Jobs.OnOpen = r => SendAction(HudActions.Open(r), "İŞ · MASAÜSTÜNDE AÇILIYOR");
            Notices.OnOpen = r => SendAction(HudActions.Open(r), "BİLDİRİM · MASAÜSTÜNDE AÇILIYOR");
            Log.OnOpen = r => SendAction(HudActions.Open(r), "KAYIT · MASAÜSTÜNDE AÇILIYOR");

            // Çekirdek (yay ortası)
            var coreGo = new GameObject("Çekirdek");
            coreGo.transform.SetParent(_panels, false);
            Core = coreGo.AddComponent<HudCoreView>();
            Core.Build(_kit);
            _coreHome = new Home { T = coreGo.transform, Local = new Vector3(0f, 0.06f, radius), Yaw = 0f, Scale = Vector3.one };
            _coreDefault = _coreHome.Local;

            // Avuç menüsü (elde taşınır, dünyada sabit değil)
            var menuGo = new GameObject("menu");
            menuGo.transform.SetParent(transform, false);
            Menu = menuGo.AddComponent<HudMenuPanel>();
            Menu.Setup(_kit, "menu", "AVUÇ", "MENÜ", 0.34f, 0.33f);
            Menu.Init();
            Menu.IsOpen = id => _byId.TryGetValue(id, out var p) && p.gameObject.activeSelf && !p.IsClosed;
            Menu.OnToggle = TogglePanel;
            Menu.OnPalette = pal =>
            {
                bool ok = SendAction(HudActions.Palette(pal), "PALET · " + (pal == HudActions.PaletteAuto ? "OTOMATİK" : HudFmt.Up(pal)));
                if (!ok) return;
                if (pal == HudActions.PaletteAuto) _localMode = "auto";
                else { _localMode = "manual"; HudTheme.Set(pal); }
            };
            Menu.CurrentMode = () => _localMode ?? (Snapshot != null ? Snapshot.PaletteMode : "");
            Menu.OnStop = () => SendAction(HudActions.Stop(), "ACİL DURDURMA GÖNDERİLDİ", true);
            Menu.CurrentPalette = () => HudTheme.Name;
            Menu.Connected = IsConnected;
            Menu.Apply(null, PanelState.Live);
            menuGo.transform.localScale = Vector3.one * 0.72f;
            menuGo.SetActive(false);

            // Bağlantı çizgileri
            var lg = new GameObject("Bağlantı çizgileri");
            lg.transform.SetParent(_panels, false);
            lg.AddComponent<MeshFilter>().sharedMesh = _linkMesh = new Mesh { name = "HudLinks" };
            var lmr = lg.AddComponent<MeshRenderer>();
            lmr.sharedMaterial = material;
            lmr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            lmr.receiveShadows = false;
            _lm.W = 0f; _lm.H = 0f;

            // Eller
            if (interactor != null)
            {
                var diag = gameObject.AddComponent<HudDiag>(); diag.interactor = interactor;
                Gestures = gameObject.AddComponent<HudGestures>();
                Gestures.leftHand = interactor.leftHand; Gestures.rightHand = interactor.rightHand;
                Gestures.leftSkeleton = interactor.leftSkeleton; Gestures.rightSkeleton = interactor.rightSkeleton;
                Gestures.Summon += Summon;
            }

            foreach (var p in _all) p.Apply(null, PanelState.Off);
            Core.Apply(null, PanelState.Off);
            Top.Apply(null, PanelState.Off);
            Log.SetEntries(_log);
        }

        // ───────── yerleşim ─────────

        private void PlaceRoot()
        {
            var cam = Camera.main;
            Vector3 head = cam != null ? cam.transform.position : new Vector3(0f, 1.6f, 0f);
            Vector3 fwd = cam != null ? cam.transform.forward : Vector3.forward;
            fwd.y = 0f;
            if (fwd.sqrMagnitude < 1e-4f) fwd = Vector3.forward;
            fwd.Normalize();
            _root.position = new Vector3(head.x, head.y + heightOffset, head.z);
            _root.rotation = Quaternion.LookRotation(fwd, Vector3.up);
        }

        private void ApplyHome(Transform t, Vector3 local, float yaw, Vector3 scale)
        {
            t.position = _root.TransformPoint(local);
            t.rotation = _root.rotation * Quaternion.Euler(0f, yaw, 0f);
            t.localScale = scale;
        }

        private void LayoutAll()
        {
            foreach (var p in _all) if (p.gameObject.activeSelf && !p.IsClosed) ApplyHome(p.transform, p.HomeLocal, p.HomeYaw, p.HomeScale);
            ApplyHome(Core.transform, _coreHome.Local, _coreHome.Yaw, _coreHome.Scale);
        }

        /// <summary>Açılışta bir kez (kafa pozu hazır olunca) ve sistem "yeniden ortala"sında çalışır.</summary>
        private void FirstPlace()
        {
            PlaceRoot();
            _placed = true;
            _panels.gameObject.SetActive(true);
            LayoutAll();
            float d = 0.15f;
            Core.StartBoot(0f);
            Core.transform.localScale = Vector3.one;
            foreach (var p in _all)
            {
                if (previewMode) p.BootInstant();
                p.StartBoot(d);
                d += 0.16f;
            }
            if (previewMode) Core.BootInstant();
            Debug.Log($"[FuberHud] HUD yerleştirildi: kök {_root.position}, yarıçap {radius} m.");
        }

        /// <summary>"Çağır": paneller yeniden önüne gelir (kapalılar kapalı kalır).</summary>
        public void Summon()
        {
            if (!_placed) return;
            _summonFrom.Clear();
            foreach (var p in _all) if (p.gameObject.activeSelf && !p.IsClosed) _summonFrom.Add((p.transform, p.transform.position, p.transform.rotation, p.transform.localScale));
            _summonFrom.Add((Core.transform, Core.transform.position, Core.transform.rotation, Core.transform.localScale));
            PlaceRoot();
            _summonT = 0f;
            Top?.Toast("ÇAĞRILDI · PANELLER ÖNÜNDE", 1.8f);
        }

        private void TickSummon()
        {
            if (_summonT < 0f) return;
            _summonT += Time.deltaTime;
            float k = Mathf.SmoothStep(0f, 1f, Mathf.Clamp01(_summonT / 0.75f));
            foreach (var f in _summonFrom)
            {
                if (f.t == null) continue;
                Vector3 goalP; Quaternion goalR; Vector3 goalS;
                GoalOf(f.t, out goalP, out goalR, out goalS);
                f.t.position = Vector3.Lerp(f.p, goalP, k);
                f.t.rotation = Quaternion.Slerp(f.r, goalR, k);
                f.t.localScale = Vector3.Lerp(f.s, goalS, k);
            }
            if (_summonT >= 0.75f) _summonT = -1f;
        }

        private void GoalOf(Transform t, out Vector3 p, out Quaternion r, out Vector3 s)
        {
            if (t == Core.transform) { p = _root.TransformPoint(_coreHome.Local); r = _root.rotation * Quaternion.Euler(0f, _coreHome.Yaw, 0f); s = _coreHome.Scale; return; }
            var panel = t.GetComponent<HudPanelBase>();
            p = _root.TransformPoint(panel.HomeLocal);
            r = _root.rotation * Quaternion.Euler(0f, panel.HomeYaw, 0f);
            s = panel.HomeScale;
        }

        private void TogglePanel(string id)
        {
            if (!_byId.TryGetValue(id, out var p)) return;
            if (p.TabHidden) { Top?.Toast("BU SEKMEDE YOK · " + TabName(CurrentTab), 1.8f); return; }
            if (p.gameObject.activeSelf && !p.IsClosed) p.Close(Vector3.up * 0.6f);
            else p.Reopen(_root);
        }

        // ───────── veri ─────────

        public bool IsConnected()
        {
            if (previewMode) return true;
            return driver != null && driver.Phase == PairPhase.Connected && driver.State == BridgeState.Connected;
        }

        /// <summary>BridgeDriver ana iş parçacığında çağırır: tam hud.snapshot iletisi.</summary>
        public void OnSnapshotJson(string json)
        {
            var s = HudSnapshot.ParseMessage(json);
            if (s == null) { SnapshotsRejected++; Debug.LogWarning("[FuberHud] Bozuk hud.snapshot yok sayıldı."); return; }
            ApplySnapshot(s);
        }

        public void ApplySnapshot(HudSnapshot s)
        {
            if (!_built) Build();
            Snapshot = s;
            _ever = true;
            SnapshotsReceived++;
            _recvAt = Time.unscaledTime;
            HudTheme.Set(s.Palette);            // ~1.5 sn yumuşak geçiş (otomatik palet dahil)
            _localMode = null;
            if (Time.unscaledTime >= _tabLockUntil) { Top.ActiveTab = NormTab(s.Tab); ApplyTab(s.Tab); }

            // günlük: yeni → eski sıra (dizi yönünü ts'ten anla)
            var list = new List<HudLogEntry>(s.Log);
            if (list.Count >= 2 && string.CompareOrdinal(list[0].Ts, list[list.Count - 1].Ts) < 0) list.Reverse();
            _log.Clear();
            for (int i = 0; i < list.Count && i < 20; i++) _log.Add(list[i]);
            Log.SetEntries(_log);
            Cal.NoteReceived();
            Jobs.NoteReceived();
            DistributeStates(true);
            if (s.HasVoice)
            {
                Core.SetVoiceText(s.Voice.Text);
                if (Time.unscaledTime - _voiceStamp > 2f) Core.SetVoice(s.Voice.State, null, null, false);   // hud.voice akışı yoksa snapshot'a uy
            }
        }

        /// <summary>hud.voice (~15 Hz): durum + ses düzeyi (düzey yoksa null → sakin animasyon, seviye uydurulmaz).</summary>
        public void OnVoiceJson(string json)
        {
            var v = HudSnapshot.ParseVoiceMessage(json);
            if (v == null || !_built) return;
            _voiceStamp = Time.unscaledTime;
            Core.SetVoice(v.State, v.Level, null, true);
        }

        /// <summary>hud.log: asistan günlüğüne yeni satır (anında).</summary>
        public void OnLogJson(string json)
        {
            var e = HudSnapshot.ParseLogMessage(json);
            if (e == null || !_built) return;
            _log.Insert(0, e);
            if (_log.Count > 20) _log.RemoveRange(20, _log.Count - 20);
            Log.SetEntries(_log);
        }

        private bool Laggy() => !IsConnected() || Time.unscaledTime - _recvAt > StaleAfterSec;

        private PanelState StateOf(bool has, HudStatus st)
        {
            if (!_ever || Snapshot == null || !has || st == HudStatus.Off) return PanelState.Off;
            if (Laggy() || st == HudStatus.Stale) return PanelState.Stale;
            return PanelState.Live;
        }

        private void DistributeStates(bool force)
        {
            var s = Snapshot;
            bool has = _ever && s != null;
            var always = has ? (Laggy() ? PanelState.Stale : PanelState.Live) : PanelState.Off;
            Top.Apply(s, always);
            Greeting.Apply(s, always);
            Env.Apply(s, StateOf(has && s.HasEnv, has ? s.Env.Status : HudStatus.Off));
            Cal.Apply(s, StateOf(has && s.HasCal, has ? s.Cal.Status : HudStatus.Off));
            Bio.Apply(s, StateOf(has && s.HasBio, has ? s.Bio.Status : HudStatus.Off));
            Fin.Apply(s, StateOf(has && s.HasFin, has ? s.Fin.Status : HudStatus.Off));
            Links.Apply(s, StateOf(has && s.HasLinks, has ? s.Links.Status : HudStatus.Off));
            Log.Apply(s, has ? always : PanelState.Off);
            Core.Apply(s, StateOf(has && s.HasCore, HudStatus.Ok));
            Workshop.Apply(s, StateOf(has && s.HasCore, HudStatus.Ok));
            Jobs.Apply(s, has && s.HasJobs ? always : PanelState.Off);
            Notices.Apply(s, has && s.HasNotices ? always : PanelState.Off);
            if (!has || Laggy()) Core.SetVoice("idle", null, "", false);   // bağlantı yoksa konuşma animasyonu sürmez
        }

        // ───────── sekmeler ─────────

        public static string NormTab(string t)
        {
            foreach (var x in HudActions.Tabs) if (x == t) return t;
            return "overview";
        }

        public static string TabName(string t)
        {
            switch (t) { case "workshop": return "ATÖLYE"; case "comms": return "İLETİŞİM"; default: return "GENEL"; }
        }

        private struct Lay { public float yaw, y, scale; public Lay(float yaw, float y, float scale) { this.yaw = yaw; this.y = y; this.scale = scale; } }

        /// <summary>Sekmeye göre görünür paneller + yerleşim. null → o sekmede görünmez.</summary>
        private Dictionary<string, Lay> TabLayout(string tab, out Lay core)
        {
            var d = new Dictionary<string, Lay>();
            core = new Lay(0f, 0.06f, 1f);
            switch (tab)
            {
                case "workshop":
                    d["workshop"] = new Lay(-30f, 0.0f, 1f); d["jobs"] = new Lay(30f, 0.0f, 1f);
                    break;
                case "comms":
                    d["log"] = new Lay(-12f, -0.04f, 1.5f); d["notices"] = new Lay(30f, -0.04f, 1.15f); core = new Lay(24f, 0.26f, 0.5f);
                    break;
                default:
                    foreach (var id in new[] { "env", "cal", "bio", "fin", "links", "log" }) d[id] = new Lay(_defaults[id].yaw, _defaults[id].local.y, 1f);
                    break;
            }
            return d;
        }

        /// <summary>Sekme içeriği: GENEL tam düzen; ATÖLYE çekirdek ayrıntısı + işler; İLETİŞİM günlük büyük + bildirimler.</summary>
        public void ApplyTab(string tab)
        {
            tab = NormTab(tab);
            if (!_built || tab == CurrentTab) { return; }
            CurrentTab = tab;
            if (!_placed) { ApplyTabState(tab, false); return; }
            ApplyTabState(tab, true);
        }

        private void ApplyTabState(string tab, bool animate)
        {
            var layout = TabLayout(tab, out var coreLay);
            _summonFrom.Clear();
            foreach (var p in _all)
            {
                if (p == Top || p == Greeting) continue;
                if (layout.TryGetValue(p.PanelId, out var lay))
                {
                    p.HomeLocal = new Vector3(radius * Sin(lay.yaw), lay.y, radius * Cos(lay.yaw));
                    p.HomeYaw = lay.yaw;
                    p.HomeScale = Vector3.one * lay.scale;
                    bool wasHidden = p.TabHidden;
                    p.TabHidden = false;
                    if (p.IsClosed) continue;
                    if (wasHidden)
                    {
                        p.gameObject.SetActive(true);
                        if (_placed) { ApplyHome(p.transform, p.HomeLocal, p.HomeYaw, p.HomeScale); p.StartBoot(0.05f); }
                    }
                    else if (animate && p.gameObject.activeSelf) _summonFrom.Add((p.transform, p.transform.position, p.transform.rotation, p.transform.localScale));
                }
                else
                {
                    p.TabHidden = true;
                    if (p.gameObject.activeSelf) p.gameObject.SetActive(false);
                }
            }
            _coreHome.Local = new Vector3(radius * Sin(coreLay.yaw), coreLay.y, radius * Cos(coreLay.yaw));
            _coreHome.Yaw = coreLay.yaw; _coreHome.Scale = Vector3.one * coreLay.scale;
            if (animate && _placed)
            {
                _summonFrom.Add((Core.transform, Core.transform.position, Core.transform.rotation, Core.transform.localScale));
                _summonT = 0f;
            }
            Menu?.Redraw();
        }

        // ───────── eylemler ─────────

        public bool SendAction(Dictionary<string, object> msg, string toast, bool urgent = false)
        {
            bool ok = driver != null && IsConnected() && driver.SendJson(msg);
            Top?.Toast(ok ? toast : "BAĞLI DEĞİL · GÖNDERİLEMEDİ", ok ? (urgent ? 3f : 2.2f) : 2.5f);
            return ok;
        }

        // ───────── her kare ─────────

        private void OnDisable()
        {
            if (_display != null) _display.RecenteredPose -= OnRecentered;
            _display = null;
        }

        private void OnRecentered() { if (_placed) Summon(); }

        private void Update()
        {
            if (!_built) return;
            _t += Time.deltaTime;

#if !UNITY_EDITOR
            if (_display == null && OVRManager.display != null) { _display = OVRManager.display; _display.RecenteredPose += OnRecentered; }
#endif
            if (!_placed)
            {
                var cam = Camera.main;
                if (cam == null && !previewMode) return;
                bool ready = previewMode || cam.transform.localPosition.sqrMagnitude > 1e-6f || cam.transform.localRotation != Quaternion.identity;
                if (!ready && _t < maxPoseWait) return;
                FirstPlace();
                return;
            }

            HudTheme.Tick(Time.deltaTime);
            TickSummon();

            // veri durumu: zamana bağlı (bayatlama) geçişler
            if (Time.unscaledTime >= _nextState)
            {
                _nextState = Time.unscaledTime + 0.5f;
                bool laggy = Laggy();
                if (laggy != _prevLaggy) { _prevLaggy = laggy; DistributeStates(false); }
            }

            UpdateMenu();
            UpdatePairingPanel();

            if (Time.unscaledTime >= _nextLinks) { _nextLinks = Time.unscaledTime + 0.05f; RebuildLinks(); }
        }

        /// <summary>Önizleme: son snapshot'ı `seconds` sn önce gelmiş say (bayat durumu göstermek için).</summary>
        public void PreviewSetAge(float seconds) { _recvAt = Time.unscaledTime - seconds; DistributeStates(true); }

        private bool _menuPinned;

        /// <summary>Önizleme/ekran görüntüsü: avuç menüsünü verilen dünya konumunda sabit göster.</summary>
        public void PreviewMenuAt(Vector3 worldPos, Quaternion rot)
        {
            _menuPinned = true;
            Menu.transform.SetPositionAndRotation(worldPos, rot);
            Menu.gameObject.SetActive(true);
            Menu.StartBoot(0f);
            if (previewMode) Menu.BootInstant();
        }

        private void UpdateMenu()
        {
            if (_menuPinned) return;
            bool show = Gestures != null && Gestures.LeftPalmFacingHead;
            if (interactor != null) { interactor.leftSuppressed = show; interactor.rightSuppressed = Gestures != null && Gestures.RightPalmUp; }
            if (show != Menu.gameObject.activeSelf)
            {
                Menu.gameObject.SetActive(show);
                if (show) Menu.StartBoot(0f);
            }
            if (show && Gestures != null)
            {
                var cam = Camera.main;
                Vector3 pos = Gestures.LeftPalmPos + Gestures.LeftPalmNormal * 0.13f;
                Vector3 look = cam != null ? Menu.transform.position - cam.transform.position : Vector3.forward;
                Menu.transform.position = Vector3.Lerp(Menu.transform.position, pos, 1f - Mathf.Exp(-18f * Time.deltaTime));
                if (look.sqrMagnitude > 1e-4f) Menu.transform.rotation = Quaternion.Slerp(Menu.transform.rotation, Quaternion.LookRotation(look.normalized, Vector3.up), 1f - Mathf.Exp(-12f * Time.deltaTime));
            }
        }

        private void UpdatePairingPanel()
        {
            if (pairingPanel == null || driver == null) return;
            bool conn = driver.Phase == PairPhase.Connected;
            if (conn) { if (_connectedSince < 0f) _connectedSince = Time.unscaledTime; }
            else _connectedSince = -1f;
            bool show = !conn || Time.unscaledTime - _connectedSince < 2.5f;
            if (pairingPanel.activeSelf != show) pairingPanel.SetActive(show);
        }

        private void RebuildLinks()
        {
            if (Camera.main == null && !previewMode) return;
            Vector3 camWorld = Camera.main != null ? Camera.main.transform.position : _root.position;
            Vector3 cam = _panels.InverseTransformPoint(camWorld);
            _lm.Clear();
            Vector3 c = _panels.InverseTransformPoint(Core.transform.position);
            var a = HudTheme.Accent; var br = HudTheme.Bright;
            Vector3 camRight = _panels.InverseTransformDirection(Camera.main != null ? Camera.main.transform.right : Vector3.right);
            Vector3 camUp = _panels.InverseTransformDirection(Camera.main != null ? Camera.main.transform.up : Vector3.up);
            foreach (var p in _all)
            {
                if (p == Top || p == Greeting) continue;
                if (!p.gameObject.activeSelf || p.IsClosed) continue;
                Vector3 pc = _panels.InverseTransformPoint(p.transform.position);
                Vector3 dir = pc - c;
                if (dir.sqrMagnitude < 1e-6f) continue;
                Vector3 start = c + dir.normalized * 0.245f * Core.transform.localScale.x;
                float sx = pc.x > c.x ? -1f : 1f;
                Vector3 end = _panels.InverseTransformPoint(p.transform.position + p.transform.right * (sx * p.W * 0.5f * p.transform.localScale.x));
                // dirsek: çekirdekten kısa çapraz, sonra panele doğru
                Vector3 mid = Vector3.Lerp(start, end, 0.55f);
                mid.y = Mathf.Lerp(mid.y, end.y, 0.85f);
                _lm.Line3(start, mid, cam, 0.0022f, new Color(a.r, a.g, a.b, 0.55f));
                _lm.Line3(mid, end, cam, 0.0022f, new Color(a.r, a.g, a.b, 0.55f));
                _lm.Dot3(start, camRight, camUp, 0.009f, br, 0.5f);
                _lm.Dot3(end, camRight, camUp, 0.009f, br, 0.5f);
            }
            _lm.Apply(_linkMesh);
        }
    }
}
