// Ortadaki dönen halkalı çekirdek. Dört halka farklı hız/yönde döner; dönüş hızı ve parlaklık GERÇEK CPU yüküyle
// (snapshot.core.cpu) artar. Merkezde snapshot.core etiketi/değeri.
//
// KONUŞMA MODLARI (snapshot.voice + hud.voice):
//  • speaking : halkalar hızlanıp yeniden dizilir (iç halkalar dışarı kayar), yük sayısı solar, yerine `level` ile atan
//               ses dalgası halkası + nabız yapan iç disk gelir; altta konuşulan metin altyazı olarak akar.
//  • listening: içe doğru toplanan tik halkaları (dinliyorum deseni).
//  • thinking : dönen kuyruklu yaylar + yörüngede noktalar.
//  `level` gelmezse (eski PC) halka/dalga SAKİN sabit bir nefes animasyonu yapar; sahte seviye üretilmez.
// Mod geçişleri ~0.6 sn yumuşaktır (anında sıçrama yok). Veri/bağlantı yoksa mod sıfırlanır (idle).

using Fuber.Net;
using UnityEngine;

namespace Fuber.App
{
    public sealed class HudCoreView : MonoBehaviour, IPinchReactor
    {
        public HudKit Kit;
        public PanelState State { get; private set; } = PanelState.Off;

        private sealed class Ring
        {
            public Transform Tf;
            public MeshRenderer Mr;
            public Mesh Mesh;
            public System.Action<HudMesh> Fill;
            public float Speed;      // derece/sn (CPU yokken)
            public float Angle;
            public float Spin;       // CPU/ses ile hız çarpanı duyarlılığı
            public float SpeakScale = 1f, ListenScale = 1f;
        }

        private readonly Ring[] _rings = new Ring[5];
        private readonly HudMesh _tmp = new HudMesh();
        private HudText _label, _value, _unit, _sub, _cap;
        private MaterialPropertyBlock _mpb;
        private static readonly int ParamsId = Shader.PropertyToID("_Params");
        private HudCoreInfo _info;
        private float _cpu, _cpuTarget;
        private float _boot, _bootT = -1f, _dim = 1f, _dimTarget = 0.35f, _hover, _burst;
        private bool _instant;
        private int _themeVersion = -1;
        private string _baseLabel = "ÇEKİRDEK";

        // ses
        private string _vState = "idle";
        private readonly float[] _w = new float[3];   // 0 listening, 1 thinking, 2 speaking
        private float _level, _levelTarget, _levelStamp = -10f;
        private bool _levelEver;
        private string _vText = "";
        private float _capShown;
        private Mesh _voiceMesh;
        private MeshRenderer _voiceMr;
        private readonly HudMesh _vm = new HudMesh();
        private float _nextVoiceDraw;
        private bool _voiceEmpty = true;
        private float _t;

        public string VoiceState => _vState;
        public float VoiceWeight(int i) => _w[i];
        public bool HasLiveLevel => _levelEver && Time.unscaledTime - _levelStamp < 0.6f;

        public void Build(HudKit kit)
        {
            Kit = kit;
            gameObject.name = "Çekirdek";
            _mpb = new MaterialPropertyBlock();

            var col = gameObject.AddComponent<SphereCollider>();
            col.radius = 0.2f;
            var pt = gameObject.AddComponent<PinchTarget>();
            pt.movable = false;
            pt.onPress = () => _burst = 1f;

            BuildRings();
            // ses katmanı
            var vg = new GameObject("Ses");
            vg.transform.SetParent(transform, false);
            vg.transform.localPosition = new Vector3(0f, 0f, -0.008f);
            vg.AddComponent<MeshFilter>().sharedMesh = _voiceMesh = new Mesh { name = "CoreVoice" };
            _voiceMr = vg.AddComponent<MeshRenderer>();
            _voiceMr.sharedMaterial = Kit.Material;
            _voiceMr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            _voiceMr.receiveShadows = false;
            _vm.W = 0f; _vm.H = 0f;

            _label = HudText.Create(transform, kit.Font, "etiket", 0f, 0.052f, 0.0115f, HudRole.Dim, TextAnchor.MiddleCenter, -0.012f);
            _value = HudText.Create(transform, kit.Font, "değer", 0f, 0.003f, 0.065f, HudRole.Bright, TextAnchor.MiddleCenter, -0.012f);
            _unit = HudText.Create(transform, kit.Font, "birim", 0.05f, 0.012f, 0.02f, HudRole.Dim, TextAnchor.MiddleLeft, -0.012f);
            _sub = HudText.Create(transform, kit.Font, "alt", 0f, -0.057f, 0.0105f, HudRole.Dim, TextAnchor.MiddleCenter, -0.012f);
            _cap = HudText.Create(transform, kit.Font, "altyazı", 0f, -0.30f, 0.0155f, HudRole.Bright, TextAnchor.MiddleCenter, -0.012f);
            _label.Set(_baseLabel);
            _value.Set(""); _unit.Set(""); _sub.Set("BAĞLI DEĞİL"); _cap.Set("");
            _sub.SetRole(HudRole.Warn);
            Push();
        }

        // ───────── halka mesh'leri (tema değişince yerinde yeniden üretilir) ─────────

        private Ring AddRing(string name, System.Action<HudMesh> fill, float speed, float spin, float z, float speakScale, float listenScale)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            go.transform.localPosition = new Vector3(0f, 0f, z);
            var mesh = new Mesh { name = "Core " + name };
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = Kit.Material;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
            var r = new Ring { Tf = go.transform, Mr = mr, Mesh = mesh, Fill = fill, Speed = speed, Spin = spin, SpeakScale = speakScale, ListenScale = listenScale };
            return r;
        }

        private void BuildRings()
        {
            _rings[0] = AddRing("Zemin", m =>
            {
                var a = HudTheme.Accent;
                m.Glow(0f, 0f, 0.235f, 48, new Color(0.01f, 0.05f, 0.08f, 0.62f), new Color(0.01f, 0.05f, 0.08f, 0.5f), 0f);
                m.Glow(0f, 0f, 0.13f, 40, new Color(a.r, a.g, a.b, 0.32f), new Color(a.r, a.g, a.b, 0f), 1f);
                m.Arc(0f, 0f, 0.1f, 0.103f, 0f, 360f, 64, new Color(a.r, a.g, a.b, 0.8f));
            }, 0f, 0f, 0.002f, 1f, 1f);
            _rings[1] = AddRing("Dış halka", m =>
            {
                var a = HudTheme.Accent;
                m.Arc(0f, 0f, 0.204f, 0.2055f, 0f, 360f, 96, new Color(a.r, a.g, a.b, 0.7f));
                for (int i = 0; i < 90; i++)
                {
                    float ang = i * 4f * Mathf.Deg2Rad;
                    bool major = i % 5 == 0;
                    float r0 = 0.2f - (major ? 0.012f : 0.006f);
                    m.Line(Mathf.Cos(ang) * r0, Mathf.Sin(ang) * r0, Mathf.Cos(ang) * 0.2f, Mathf.Sin(ang) * 0.2f, major ? 0.0018f : 0.0009f, new Color(a.r, a.g, a.b, major ? 0.9f : 0.45f));
                }
            }, 4f, 0.4f, 0f, 1.05f, 1f);
            _rings[2] = AddRing("Yaylar", m =>
            {
                var a = HudTheme.Accent; var br = HudTheme.Bright;
                float[] start = { 8f, 98f, 188f, 278f };
                float[] len = { 62f, 40f, 62f, 40f };
                for (int i = 0; i < 4; i++)
                {
                    bool hot = i % 2 == 0;
                    m.Arc(0f, 0f, 0.148f, 0.172f, start[i], start[i] + len[i], 20, hot ? new Color(br.r, br.g, br.b, 0.92f) : new Color(a.r, a.g, a.b, 0.45f), hot ? 0.35f : 0f);
                    m.Arc(0f, 0f, 0.172f, 0.1745f, start[i], start[i] + len[i], 20, new Color(br.r, br.g, br.b, 0.9f), 0.5f);
                }
            }, -11f, 1.1f, -0.002f, 1.08f, 1f);
            _rings[3] = AddRing("Kesik halka", m =>
            {
                var br = HudTheme.Bright;
                for (int i = 0; i < 24; i++)
                    m.Arc(0f, 0f, 0.126f, 0.134f, i * 15f, i * 15f + 9f, 3, new Color(br.r, br.g, br.b, 0.95f), 0.4f);
            }, 28f, 2.2f, -0.004f, 1.17f, 1.04f);
            _rings[4] = AddRing("İç halka", m =>
            {
                var a = HudTheme.Accent;
                m.Arc(0f, 0f, 0.11f, 0.1115f, 20f, 160f, 24, new Color(a.r, a.g, a.b, 0.8f));
                m.Arc(0f, 0f, 0.11f, 0.1115f, 200f, 340f, 24, new Color(a.r, a.g, a.b, 0.8f));
                for (int i = 0; i < 36; i++)
                {
                    float ang = i * 10f * Mathf.Deg2Rad;
                    m.Line(Mathf.Cos(ang) * 0.1135f, Mathf.Sin(ang) * 0.1135f, Mathf.Cos(ang) * 0.12f, Mathf.Sin(ang) * 0.12f, 0.001f, new Color(a.r, a.g, a.b, 0.55f));
                }
            }, -17f, 1.6f, -0.006f, 1.2f, 1.1f);
            RefillRings();
        }

        private void RefillRings()
        {
            _themeVersion = HudTheme.Version;
            foreach (var r in _rings)
            {
                _tmp.Clear(); _tmp.W = 0f; _tmp.H = 0f; _tmp.Z = 0f;
                r.Fill(_tmp);
                _tmp.Apply(r.Mesh);
            }
        }

        public void StartBoot(float delay) { _bootT = -delay; _boot = 0f; if (_instant) _bootT = 10f; }
        public void BootInstant() { _instant = true; _bootT = 10f; }

        // ───────── veri ─────────

        public void Apply(HudSnapshot s, PanelState st)
        {
            State = st;
            _dimTarget = st == PanelState.Live ? 1f : st == PanelState.Stale ? 0.5f : 0.35f;
            _info = st != PanelState.Off && s != null && s.HasCore ? s.Core : null;
            _cpuTarget = _info != null && _info.Cpu.HasValue ? Mathf.Clamp01(_info.Cpu.Value / 100f) : 0f;
            if (_info == null)
            {
                _value.Set(""); _unit.Set("");
                _baseLabel = "ÇEKİRDEK";
                _sub.Set("BAĞLI DEĞİL"); _sub.SetRole(HudRole.Warn);
            }
            else
            {
                _baseLabel = HudFmt.Up(HudFmt.Cut(string.IsNullOrEmpty(_info.Label) ? "ÇEKİRDEK" : _info.Label, 18));
                _value.Set(string.IsNullOrEmpty(_info.Value) ? HudFmt.None : _info.Value);
                _unit.Set(_info.Unit ?? "");
                _unit.Tf.localPosition = new Vector3(Mathf.Max(1, _value.Text.Length) * 0.02f + 0.012f, 0.014f, -0.012f);
                _sub.Set(HudFmt.Cut(HudFmt.Up(_info.Sub), 34)); _sub.SetRole(HudRole.Dim);
            }
        }

        /// <summary>Konuşma durumu. level null → seviye YOK (sakin animasyon). Veri yoksa idle'a zorlanır.</summary>
        public void SetVoice(string state, float? level, string text, bool streamed)
        {
            state = HudSnapshot.NormVoice(state);
            if (State == PanelState.Off) state = "idle";
            _vState = state;
            if (level.HasValue) { _levelTarget = Mathf.Clamp01(level.Value); _levelStamp = Time.unscaledTime; _levelEver = true; }
            else if (!streamed) { /* snapshot: seviye bilgisi taşımaz, mevcut akışı bozma */ }
            if (state == "idle") _levelTarget = 0f;
            if (text != null) SetCaption(text);
        }

        public void SetVoiceText(string text) => SetCaption(text ?? "");

        private void SetCaption(string text)
        {
            text = HudFmt.Cut(text, 90);
            if (text == _vText) return;
            if (!text.StartsWith(_vText)) _capShown = 0f;   // devam eden akış değilse baştan akıt
            _vText = text;
            _cap.Set(text);
        }

        // ───────── kare ─────────

        private void Update()
        {
            float dt = Time.deltaTime;
            _t += dt;
            if (_bootT >= 0f && _boot < 1f) { _bootT += dt; _boot = Mathf.Clamp01(_bootT / 1.5f); }
            _cpu = Mathf.Lerp(_cpu, _cpuTarget, 1f - Mathf.Exp(-3f * dt));
            _dim = Mathf.MoveTowards(_dim, _dimTarget, dt * 2f);
            _burst = Mathf.MoveTowards(_burst, 0f, dt * 1.6f);
            if (State == PanelState.Off) _vState = "idle";

            // ses ağırlıkları (0.6 sn yumuşak geçiş)
            float rate = dt / 0.6f;
            _w[0] = Mathf.MoveTowards(_w[0], _vState == "listening" ? 1f : 0f, rate);
            _w[1] = Mathf.MoveTowards(_w[1], _vState == "thinking" ? 1f : 0f, rate);
            _w[2] = Mathf.MoveTowards(_w[2], _vState == "speaking" ? 1f : 0f, rate);
            float wAny = Mathf.Max(_w[0], Mathf.Max(_w[1], _w[2]));
            float lvTarget = HasLiveLevel ? _levelTarget : 0f;
            _level = Mathf.Lerp(_level, lvTarget, 1f - Mathf.Exp(-(lvTarget > _level ? 24f : 7f) * dt));

            if (_themeVersion != HudTheme.Version) RefillRings();

            float bootSpin = (1f - Mathf.SmoothStep(0f, 1f, _boot)) * 220f;
            float bootK = Mathf.SmoothStep(0f, 1f, _boot);
            float voiceSpeed = 1f + _w[2] * (2.2f + (HasLiveLevel ? _level * 1.5f : 0f)) + _w[1] * 1.6f + _w[0] * 0.25f;
            for (int i = 1; i < _rings.Length; i++)
            {
                var r = _rings[i];
                float cpuMul = State == PanelState.Off ? 0f : _cpu * r.Spin * 1.6f;
                float dir = Mathf.Sign(r.Speed);
                // dinlerken ters yöne yavaşça dön, konuşurken hızlan
                r.Angle += (r.Speed * (1f + cpuMul) * voiceSpeed + dir * bootSpin) * dt * (State == PanelState.Off ? 0.35f : 1f);
                r.Tf.localRotation = Quaternion.Euler(0f, 0f, r.Angle);
                float arrange = Mathf.Lerp(1f, r.SpeakScale, _w[2]) * Mathf.Lerp(1f, r.ListenScale, _w[0]) * Mathf.Lerp(1f, 0.96f, _w[1] * (i % 2 == 0 ? 1f : 0f));
                float pulse = 1f + _burst * 0.06f + (i == 4 ? _level * 0.06f * _w[2] : 0f);
                float sc = Mathf.Lerp(0.55f, 1f, bootK) * arrange * pulse;
                r.Tf.localScale = new Vector3(sc, sc, 1f);
            }
            _rings[0].Tf.localScale = Vector3.one * Mathf.Lerp(0.55f, 1f, bootK);

            // metinler
            float rv = Mathf.Clamp01(_boot * 1.8f - 0.5f);
            float ta = Mathf.Clamp01(_boot * 3f - 1f) * Mathf.Clamp01(_dim + 0.1f);
            float numA = ta * (1f - wAny);
            _value.Reveal(rv); _value.Alpha(numA);
            _unit.Reveal(rv); _unit.Alpha(numA);
            _sub.Reveal(rv); _sub.Alpha(numA);
            string lab = _w[2] > 0.5f ? "KONUŞUYOR" : _w[0] > 0.5f ? "DİNLİYOR" : _w[1] > 0.5f ? "DÜŞÜNÜYOR" : _baseLabel;
            _label.Set(lab);
            _label.Tf.localPosition = new Vector3(0f, Mathf.Lerp(0.052f, -0.254f, Mathf.SmoothStep(0f, 1f, wAny)), -0.012f);
            _label.SetRole(wAny > 0.5f ? HudRole.Accent : HudRole.Dim);
            _label.Reveal(rv); _label.Alpha(ta);

            // altyazı: konuşma/dinleme/düşünme sırasında ve metin varsa; harf harf akar
            float capA = wAny > 0.3f && _vText.Length > 0 ? Mathf.Clamp01((wAny - 0.3f) * 2f) : 0f;
            if (_vText.Length > 0) _capShown = Mathf.Min(_vText.Length, _capShown + dt * 38f);
            _cap.Reveal(_vText.Length > 0 ? _capShown / _vText.Length : 1f);
            _cap.Alpha(capA * ta);

            DrawVoice(wAny, capA);
            Push();
        }

        private static float Hash(float x) => Mathf.Repeat(Mathf.Sin(x * 12.9898f) * 43758.5453f, 1f);

        private void DrawVoice(float wAny, float capA)
        {
            if (wAny < 0.01f && capA < 0.01f)
            {
                if (!_voiceEmpty) { _vm.Clear(); _vm.Apply(_voiceMesh); _voiceEmpty = true; }
                return;
            }
            if (Time.unscaledTime < _nextVoiceDraw) return;
            _nextVoiceDraw = Time.unscaledTime + 1f / 30f;
            _voiceEmpty = false;
            _vm.Clear();
            var br = HudTheme.Bright; var ac = HudTheme.Accent;
            float t = _t;
            bool live = HasLiveLevel;

            // ── konuşma: ses dalgası halkası + nabız yapan iç disk ──
            float ws = _w[2];
            if (ws > 0.01f)
            {
                const int N = 56;
                float baseR = 0.05f;
                for (int i = 0; i < N; i++)
                {
                    float a = i / (float)N * Mathf.PI * 2f;
                    float n = 0.5f + 0.5f * Mathf.Sin(i * 0.9f + t * 9f) * Mathf.Sin(i * 0.37f - t * 5.3f + 1.3f);
                    float mixN = 0.45f + 0.55f * n;
                    float len = live
                        ? 0.005f + _level * 0.048f * mixN                     // GERÇEK ses düzeyi
                        : 0.005f + 0.010f * (0.5f + 0.5f * Mathf.Sin(i * 0.4f + t * 1.8f));  // sakin sabit nefes (seviye değil)
                    float r1 = baseR + len;
                    float ca = Mathf.Cos(a), sa = Mathf.Sin(a);
                    var c = new Color(br.r, br.g, br.b, ws * (live ? 0.95f : 0.6f));
                    _vm.Line(ca * baseR, sa * baseR, ca * r1, sa * r1, 0.0042f, c, 0.35f);
                }
                float discR = 0.034f + (live ? _level * 0.02f : 0.004f * (0.5f + 0.5f * Mathf.Sin(t * 2f)));
                _vm.Glow(0f, 0f, discR + 0.012f, 24, new Color(ac.r, ac.g, ac.b, 0.5f * ws), new Color(ac.r, ac.g, ac.b, 0f), 1f);
                _vm.Arc(0f, 0f, discR, discR + 0.0022f, 0f, 360f, 40, new Color(br.r, br.g, br.b, 0.9f * ws), 0.4f);
                // dışa yayılan halka dalgası (yalnız canlı düzeyde, düzeyle orantılı)
                if (live)
                {
                    float ph = Mathf.Repeat(t * 1.1f, 1f);
                    float rr = 0.1f + ph * 0.02f;
                    _vm.Arc(0f, 0f, rr, rr + 0.0016f, 0f, 360f, 48, new Color(br.r, br.g, br.b, (1f - ph) * 0.6f * ws * _level), 0.4f);
                }
            }

            // ── dinleme: içe toplanan tik halkaları ──
            float wl = _w[0];
            if (wl > 0.01f)
            {
                for (int k = 0; k < 3; k++)
                {
                    float ph = Mathf.Repeat(t * 0.7f + k / 3f, 1f);
                    float r = 0.1f - ph * 0.058f;
                    float al = Mathf.Sin(ph * Mathf.PI) * wl;
                    for (int i = 0; i < 24; i++)
                    {
                        float a = i / 24f * Mathf.PI * 2f + k * 0.13f;
                        float ca = Mathf.Cos(a), sa = Mathf.Sin(a);
                        _vm.Line(ca * r, sa * r, ca * (r + 0.009f), sa * (r + 0.009f), 0.0028f, new Color(br.r, br.g, br.b, 0.9f * al), 0.4f);
                    }
                }
                float cr = 0.03f + (live ? _level * 0.018f : 0.002f);
                _vm.Glow(0f, 0f, cr + 0.01f, 20, new Color(ac.r, ac.g, ac.b, 0.45f * wl), new Color(ac.r, ac.g, ac.b, 0f), 1f);
                _vm.Arc(0f, 0f, cr, cr + 0.002f, 0f, 360f, 32, new Color(br.r, br.g, br.b, 0.9f * wl), 0.4f);
            }

            // ── düşünme: dönen kuyruklu yaylar + yörünge noktaları ──
            float wt = _w[1];
            if (wt > 0.01f)
            {
                for (int k = 0; k < 3; k++)
                {
                    float a0 = t * 300f + k * 120f;
                    for (int seg = 0; seg < 6; seg++)
                    {
                        float f = seg / 6f;
                        _vm.Arc(0f, 0f, 0.062f, 0.07f, a0 - seg * 9f, a0 - seg * 9f - 9f, 3, new Color(br.r, br.g, br.b, (1f - f) * 0.95f * wt), 0.4f);
                    }
                }
                for (int k = 0; k < 3; k++)
                {
                    float a = (-t * 180f + k * 120f) * Mathf.Deg2Rad;
                    _vm.Dot(Mathf.Cos(a) * 0.088f, Mathf.Sin(a) * 0.088f, 0.007f, new Color(ac.r, ac.g, ac.b, wt), 0.5f);
                }
                _vm.Glow(0f, 0f, 0.04f, 20, new Color(ac.r, ac.g, ac.b, 0.28f * wt), new Color(ac.r, ac.g, ac.b, 0f), 1f);
            }

            // altyazı arka planı
            if (capA > 0.01f && _vText.Length > 0)
            {
                float w = Mathf.Min(0.62f, _vText.Length * 0.0105f + 0.05f);
                float zc = -0.30f;
                var bg = HudTheme.Bg; bg.a = 0.7f * capA;
                _vm.Quad(-w / 2f, zc - 0.016f, w / 2f, zc + 0.016f, bg);
                _vm.Line(-w / 2f, zc - 0.016f, w / 2f, zc - 0.016f, 0.0012f, new Color(ac.r, ac.g, ac.b, 0.6f * capA));
            }
            _vm.Apply(_voiceMesh);
        }

        private void Push()
        {
            float glow = _hover * 0.4f + _burst * 0.8f + (State == PanelState.Off ? 0f : 0.05f + _cpu * 1.0f) + _w[2] * (live0() ? _level * 0.6f : 0.15f);
            for (int i = 0; i < _rings.Length; i++)
            {
                var r = _rings[i];
                if (r == null || r.Mr == null) continue;
                r.Mr.GetPropertyBlock(_mpb);
                _mpb.SetVector(ParamsId, new Vector4(_boot, i == 0 ? glow * 0.5f : glow, _dim, 0f));
                r.Mr.SetPropertyBlock(_mpb);
            }
            if (_voiceMr != null)
            {
                _voiceMr.GetPropertyBlock(_mpb);
                _mpb.SetVector(ParamsId, new Vector4(Mathf.Max(_boot, 0.001f), 0f, 1f, 0f));
                _voiceMr.SetPropertyBlock(_mpb);
            }
        }

        private bool live0() => HasLiveLevel;

        public void OnHighlight(float level) { _hover = level; }
        public void OnPress() { _burst = 1f; }
    }
}
