// HUD paneli tabanı: çerçeve (köşesi kesik yarı saydam zemin), başlık, durum çipi ("BAĞLI DEĞİL" / "GECİKMELİ"),
// açılış (boot) animasyonu, hover parlaması, tutup taşıma / iki elle ölçek / fırlatıp kapatma, çimdikle basılan düğmeler.
// Alt sınıflar yalnız BuildContent (statik içerik + metinler) ve Draw (dinamik çizim + metin değerleri) yazar.
// Tek mesh + tek malzeme (Fuber/Hud) → panel başına ≈1 çizim; metinler ortak font malzemesini paylaşır.

using System;
using System.Collections.Generic;
using Fuber.Net;
using UnityEngine;

namespace Fuber.App
{
    public sealed class HudKit
    {
        public Font Font;
        public Material Material;
    }

    /// <summary>Panelin veri durumu: Live = taze veri, Stale = gecikmeli (soluk, son değerler), Off = yok (sayı gösterilmez).</summary>
    public enum PanelState { Off, Stale, Live }

    public sealed class HudButton : MonoBehaviour
    {
        public int Index;
        public Rect Area;               // panel-yerel (merkez x,y + boyut: x,y = sol-alt)
        public PinchTarget Target;
        public bool Hover;
        public Action Pressed;
    }

    public abstract class HudPanelBase : MonoBehaviour, IPinchReactor
    {
        public string PanelId = "";
        public string Tag = "";
        public string Title = "";
        public float W = 0.5f, H = 0.3f;
        public bool Closable = true;
        public float BootDuration = 1.1f;

        public HudKit Kit;
        public Action<HudPanelBase> OnClosed;

        public PanelState State { get; private set; } = PanelState.Off;
        public bool IsClosed { get; private set; }
        /// <summary>Bu sekmede gösterilmiyor (kullanıcı kapatması IsClosed ayrı).</summary>
        public bool TabHidden;
        public Vector3 HomeLocal;
        public float HomeYaw;
        public Vector3 HomeScale = Vector3.one;

        protected readonly HudMesh M = new HudMesh();
        protected HudSnapshot Snap;
        protected readonly List<HudText> ContentTexts = new List<HudText>();
        protected readonly List<HudText> ChromeTexts = new List<HudText>();
        protected readonly List<HudButton> Buttons = new List<HudButton>();
        protected HudText TitleText, TagText, ChipText, OffText;
        protected PinchTarget PanelTarget;
        protected float TimeAlive;
        /// <summary>Yeni snapshot/durum geldi: animasyonlu paneller metinleri yalnız bu karede günceller (GC/ kare maliyeti).</summary>
        protected bool NewData = true;

        /// <summary>Alt sınıf true yaparsa mesh her karede (≈30 Hz) yeniden çizilir (EKG, canlı grafik).</summary>
        protected bool Animated;

        private Mesh _mesh;
        private MeshRenderer _mr;
        private MaterialPropertyBlock _mpb;
        private static readonly int ParamsId = Shader.PropertyToID("_Params");

        private float _bootT = -1f;      // <0: başlamadı
        private float _bootDelay;
        private float _boot = 0f, _glow, _glowTarget, _dim = 1f, _dimTarget = 1f;
        private bool _dirty = true, _bootDone;
        private int _themeVersion = -1;
        private float _nextAnimDraw;
        private string _chip = "";
        private HudRole _chipRole = HudRole.Accent;
        private float _closeT = -1f;
        private Vector3 _closeVel;
        private Vector3 _closeFrom;
        private bool _forceInstant;

        // ───────── kurulum ─────────

        public void Setup(HudKit kit, string id, string tag, string title, float w, float h)
        {
            Kit = kit; PanelId = id; Tag = tag; Title = title; W = w; H = h;
            gameObject.name = "Panel " + id;

            var mf = gameObject.AddComponent<MeshFilter>();
            _mr = gameObject.AddComponent<MeshRenderer>();
            _mr.sharedMaterial = kit.Material;
            _mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            _mr.receiveShadows = false;
            _mr.lightProbeUsage = UnityEngine.Rendering.LightProbeUsage.Off;
            _mr.reflectionProbeUsage = UnityEngine.Rendering.ReflectionProbeUsage.Off;
            _mesh = new Mesh { name = "HudMesh " + id };
            _mesh.MarkDynamic();
            mf.sharedMesh = _mesh;
            _mpb = new MaterialPropertyBlock();

            var box = gameObject.AddComponent<BoxCollider>();
            box.size = new Vector3(w + 0.02f, h + 0.02f, 0.03f);
            PanelTarget = gameObject.AddComponent<PinchTarget>();
            PanelTarget.movable = true;
            PanelTarget.scalable = true;
            PanelTarget.throwable = Closable;
            PanelTarget.onThrown = v => Close(v);

            M.W = w; M.H = h;
            BuildStaticMesh();
            PushParams(true);
        }

        /// <summary>Panel kurulduktan sonra alt sınıf içeriğini (metinler, düğmeler) üretir. HudBuilder çağırır.</summary>
        public void Init()
        {
            TagText = ChromeText(-W / 2f + 0.016f, H / 2f - 0.024f, 0.012f, HudRole.Dim, TextAnchor.MiddleLeft);
            TagText.Set(ShowChrome ? Tag : "");
            TitleText = ChromeText(-W / 2f + 0.016f + 0.014f * Mathf.Max(4, Tag.Length) * 0.62f + 0.014f, H / 2f - 0.024f, 0.016f, HudRole.Bright, TextAnchor.MiddleLeft);
            TitleText.Set(ShowChrome ? Title : "");
            ChipText = ChromeText(W / 2f - 0.02f, H / 2f - 0.024f, 0.012f, HudRole.Accent, TextAnchor.MiddleRight);
            OffText = ChromeText(0f, -0.01f, 0.026f, HudRole.Warn, TextAnchor.MiddleCenter);
            OffText.Set("");
            BuildContent();
            _dirty = true;
        }

        /// <summary>false: çerçeve/başlık/çip çizilmez (üst çubuk, selam).</summary>
        protected virtual bool ShowChrome => true;
        /// <summary>true: veri yokken de Draw(null olabilir) çağrılır (üst çubuk sekmeleri hep görünsün).</summary>
        protected virtual bool DrawWhenOff => false;

        protected abstract void BuildContent();
        protected abstract void Draw(HudSnapshot s);

        // ───────── metin / düğme yardımcıları ─────────

        protected HudText ChromeText(float x, float y, float size, HudRole role, TextAnchor anchor)
        {
            var t = HudText.Create(transform, Kit.Font, "t", x, y, size, role, anchor);
            ChromeTexts.Add(t);
            return t;
        }

        protected HudText Txt(float x, float y, float size, HudRole role, TextAnchor anchor = TextAnchor.MiddleLeft)
        {
            var t = HudText.Create(transform, Kit.Font, "t", x, y, size, role, anchor);
            ContentTexts.Add(t);
            return t;
        }

        protected HudButton AddButton(float x0, float y0, float w, float h, Action pressed, float holdSeconds = 0f)
        {
            var go = new GameObject("Düğme " + Buttons.Count);
            go.transform.SetParent(transform, false);
            go.transform.localPosition = new Vector3(x0 + w / 2f, y0 + h / 2f, -0.012f);
            var col = go.AddComponent<BoxCollider>();
            col.size = new Vector3(w, h, 0.03f);
            var pt = go.AddComponent<PinchTarget>();
            pt.movable = false;
            pt.holdSeconds = holdSeconds;
            var b = go.AddComponent<HudButton>();
            b.Index = Buttons.Count; b.Area = new Rect(x0, y0, w, h); b.Target = pt; b.Pressed = pressed;
            pt.onHover = hv => { b.Hover = hv; _dirty = true; };
            pt.onPress = () => b.Pressed?.Invoke();
            pt.onHoldComplete = () => b.Pressed?.Invoke();
            Buttons.Add(b);
            return b;
        }

        protected static void SetButton(HudButton b, bool on)
        {
            if (b == null) return;
            if (b.gameObject.activeSelf != on) b.gameObject.SetActive(on);
            if (!on) b.Hover = false;
        }

        // ───────── statik çerçeve ─────────

        private void BuildStaticMesh()
        {
            M.Clear();
            float x0 = -W / 2f, x1 = W / 2f, y0 = -H / 2f, y1 = H / 2f;
            const float cut = 0.018f;
            if (!ShowChrome) { BuildStaticExtra(); M.MarkStatic(); _themeVersion = HudTheme.Version; return; }
            var accent = HudTheme.Accent;
            var bgTop = HudTheme.Bg; var bgBot = new Color(HudTheme.Bg.r * 0.6f, HudTheme.Bg.g * 0.7f, HudTheme.Bg.b * 0.8f, HudTheme.Bg.a * 0.92f);
            M.CutFill(x0, y0, x1, y1, cut, bgTop, bgBot);
            // üst kenarda hafif iç parıltı
            M.QuadV(x0 + cut, y1 - 0.05f, x1, y1, new Color(accent.r, accent.g, accent.b, 0f), new Color(accent.r, accent.g, accent.b, 0.10f), 1f);
            M.CutOutline(x0, y0, x1, y1, cut, 0.0018f, new Color(accent.r, accent.g, accent.b, 0.7f));
            M.Line(x0 + 0.012f, y1 - 0.047f, x1 - 0.012f, y1 - 0.047f, 0.0012f, new Color(accent.r, accent.g, accent.b, 0.35f));
            // köşe vurguları (sağ-üst, sol-alt)
            var br = HudTheme.Bright; br.a = 0.95f;
            M.Line(x1 - 0.034f, y1, x1, y1, 0.004f, br, 0.5f); M.Line(x1, y1, x1, y1 - 0.034f, 0.004f, br, 0.5f);
            M.Line(x0, y0 + 0.034f, x0, y0, 0.004f, br, 0.5f); M.Line(x0, y0, x0 + 0.034f, y0, 0.004f, br, 0.5f);
            BuildStaticExtra();
            M.MarkStatic();
            _themeVersion = HudTheme.Version;
        }

        protected virtual void BuildStaticExtra() { }

        // ───────── veri ─────────

        public void Apply(HudSnapshot s, PanelState st)
        {
            Snap = s;
            NewData = true;
            if (State != st)
            {
                State = st;
                _dimTarget = st == PanelState.Stale ? 0.36f : 1f;
            }
            _dirty = true;
        }

        protected void SetChip(string text, HudRole role)
        {
            if (text == _chip && role == _chipRole) return;
            _chip = text; _chipRole = role;
            ChipText?.Set(text);
            ChipText?.SetRole(role);
        }

        // ───────── yaşam döngüsü ─────────

        public void StartBoot(float delay)
        {
            _bootDelay = delay; _bootT = -delay; _bootDone = false; _boot = 0f; _dirty = true;
            if (_forceInstant) _bootT = 10f;
        }

        public void BootInstant() { _forceInstant = true; _bootT = 10f; _bootDone = false; }

        private void Update()
        {
            float dt = Time.deltaTime;
            TimeAlive += dt;

            if (_closeT >= 0f) { TickClose(dt); return; }

            // açılış
            if (_bootT >= 0f && !_bootDone)
            {
                _bootT += dt;
                float b = Mathf.Clamp01(_bootT / BootDuration);
                _boot = b;
                float rv = Mathf.Clamp01(b * 1.7f - 0.35f);
                foreach (var t in ChromeTexts) { t.Reveal(rv); t.Alpha(Mathf.Clamp01(b * 3f - 0.2f)); }
                foreach (var t in ContentTexts) { t.Reveal(Mathf.Clamp01(b * 1.7f - 0.6f)); t.Alpha(Mathf.Clamp01(b * 3f - 1.2f) * _dim); }
                if (b >= 1f)
                {
                    _bootDone = true;
                    foreach (var t in ChromeTexts) { t.Reveal(1f); t.Alpha(1f); }
                    foreach (var t in ContentTexts) { t.Reveal(1f); t.Alpha(_dim); }
                }
            }
            else if (_bootT < 0f) { _boot = 0f; }

            _glow = Mathf.MoveTowards(_glow, _glowTarget, dt * 5f);
            if (!Mathf.Approximately(_dim, _dimTarget))
            {
                _dim = Mathf.MoveTowards(_dim, _dimTarget, dt * 2.5f);
                if (_bootDone) foreach (var t in ContentTexts) t.Alpha(_dim);
            }

            if (_themeVersion != HudTheme.Version)
            {
                BuildStaticMesh();
                foreach (var t in ChromeTexts) t.SyncTheme();
                foreach (var t in ContentTexts) t.SyncTheme();
                _dirty = true;
            }

            if (Animated && State != PanelState.Off && Time.unscaledTime >= _nextAnimDraw)
            {
                _nextAnimDraw = Time.unscaledTime + 1f / 30f;
                _dirty = true;
            }
            if (_dirty) Rebuild();
            PushParams(false);
        }

        private void Rebuild()
        {
            _dirty = false;
            bool off = State == PanelState.Off && !DrawWhenOff;
            bool offState = State == PanelState.Off;
            M.ResetToStatic();

            // durum çipi
            string chip = _chip;
            if (off) { chip = ""; }
            else if (State == PanelState.Stale) { chip = "GECİKMELİ"; }
            if (!ShowChrome) chip = "";
            if (ChipText != null && ShowChrome)
            {
                if (State == PanelState.Stale) { ChipText.Set("GECİKMELİ"); ChipText.SetRole(HudRole.Warn); }
                else if (offState) ChipText.Set("");
                else { ChipText.Set(_chip); ChipText.SetRole(_chipRole); }
            }
            if (!string.IsNullOrEmpty(chip))
            {
                float cw = 0.0105f * chip.Length + 0.022f;
                float cx1 = W / 2f - 0.012f, cx0 = cx1 - cw, cy = H / 2f - 0.024f;
                var cc = HudTheme.Role(State == PanelState.Stale ? HudRole.Warn : _chipRole);
                M.QuadV(cx0, cy - 0.012f, cx1, cy + 0.012f, new Color(cc.r, cc.g, cc.b, 0.06f), new Color(cc.r, cc.g, cc.b, 0.16f), 1f);
                cc.a = 0.85f;
                M.RectOutline(cx0, cy - 0.012f, cx1, cy + 0.012f, 0.0012f, cc);
            }

            foreach (var t in ContentTexts) t.SetVisible(!off);
            OffText.Set(off && offState ? "BAĞLI DEĞİL" : "");
            OffText.SetVisible(off && offState);
            foreach (var b in Buttons) if (off && b.gameObject.activeSelf) { b.gameObject.SetActive(false); b.Hover = false; }

            if (!off && (Snap != null || DrawWhenOff))
            {
                Draw(Snap);
                NewData = false;
                // düğme hover/hold geri bildirimi
                foreach (var b in Buttons)
                {
                    if (!b.gameObject.activeSelf) continue;
                    var r = b.Area;
                    float hold = b.Target.HoldProgress;
                    if (b.Hover || b.Target.IsHolding)
                    {
                        var c = HudTheme.Accent;
                        M.Quad(r.xMin, r.yMin, r.xMax, r.yMax, new Color(c.r, c.g, c.b, 0.16f), 1f);
                        M.Quad(r.xMin, r.yMin, r.xMin + 0.003f, r.yMax, new Color(c.r, c.g, c.b, 0.95f), 0.4f);
                    }
                    if (hold > 0f)
                    {
                        var c = HudTheme.Alert;
                        M.Quad(r.xMin, r.yMin, r.xMin + r.width * hold, r.yMin + 0.004f, new Color(c.r, c.g, c.b, 1f), 0.3f);
                    }
                }
            }
            M.Apply(_mesh);
        }

        protected void MarkDirty() => _dirty = true;
        public void Redraw() => _dirty = true;

        private float _lastBoot = -1, _lastGlow = -1, _lastDim = -1;

        private void PushParams(bool force)
        {
            if (!force && Mathf.Approximately(_lastBoot, _boot) && Mathf.Approximately(_lastGlow, _glow) && Mathf.Approximately(_lastDim, _dim)) return;
            _lastBoot = _boot; _lastGlow = _glow; _lastDim = _dim;
            _mr.GetPropertyBlock(_mpb);
            _mpb.SetVector(ParamsId, new Vector4(_boot, _glow, _dim, 0f));
            _mr.SetPropertyBlock(_mpb);
        }

        // ───────── etkileşim ─────────

        public void OnHighlight(float level)
        {
            _glowTarget = level * 0.35f;
            if (level >= 1f && PanelTarget != null && PanelTarget.IsHeld) FaceHead(1f);
        }

        public void OnPress() { }

        private void FaceHead(float t)
        {
            var cam = Camera.main;
            if (cam == null) return;
            Vector3 d = transform.position - cam.transform.position; d.y = 0f;
            if (d.sqrMagnitude < 1e-4f) return;
            transform.rotation = Quaternion.Slerp(transform.rotation, Quaternion.LookRotation(d.normalized, Vector3.up), t);
        }

        /// <summary>Fırlatma: pano hız yönünde uçup söner, kapanır; avuç menüsünden geri açılır.</summary>
        public void Close(Vector3 velocity)
        {
            if (IsClosed || !Closable) return;
            IsClosed = true;
            _closeT = 0f;
            foreach (var cl in GetComponentsInChildren<Collider>(true)) cl.enabled = false;   // kapanırken ışını yutmasın
            _closeVel = velocity.normalized * Mathf.Min(velocity.magnitude, 4f);
            _closeFrom = transform.position;
        }

        private void TickClose(float dt)
        {
            _closeT += dt;
            float k = Mathf.Clamp01(_closeT / 0.5f);
            transform.position = _closeFrom + _closeVel * (k * 0.5f);
            transform.localScale = transform.localScale * (1f - dt * 1.2f);
            _dim = Mathf.Lerp(1f, 0f, k);
            foreach (var t in ChromeTexts) t.Alpha(_dim);
            foreach (var t in ContentTexts) t.Alpha(_dim);
            PushParams(false);
            if (k >= 1f)
            {
                _closeT = -1f;
                gameObject.SetActive(false);
                OnClosed?.Invoke(this);
            }
        }

        /// <summary>Avuç menüsünden yeniden açma: konumu yuvasına koyar ve açılış animasyonunu oynatır.</summary>
        public void Reopen(Transform root)
        {
            IsClosed = false;
            _closeT = -1f;
            foreach (var cl in GetComponentsInChildren<Collider>(true)) cl.enabled = true;
            _dim = _dimTarget;
            gameObject.SetActive(true);
            transform.localScale = HomeScale;
            transform.position = root.TransformPoint(HomeLocal);
            transform.rotation = root.rotation * Quaternion.Euler(0f, HomeYaw, 0f);
            StartBoot(0f);
            _dirty = true;
        }
    }
}
