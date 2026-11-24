// HUD panel görünümleri: üst çubuk, selam, ENV, CAL, BIO, FIN, BAĞLANTILAR, LOG ve sekme panelleri.
// Her sayı doğrudan snapshot'tan gelir; alan null ise "—" yazılır (ASLA uydurma/varsayılan sayı gösterilmez).

using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
using Fuber.Net;
using UnityEngine;

namespace Fuber.App
{
    public static class HudFmt
    {
        public const string None = "—";

        public static string N(float? v, int decimals = 0, string suffix = "")
        {
            if (!v.HasValue) return None;
            string f = decimals <= 0 ? "0" : "0." + new string('0', decimals);
            return v.Value.ToString(f, CultureInfo.InvariantCulture).Replace('.', ',') + suffix;
        }

        public static string Signed(float? v, int decimals = 2, string suffix = "")
        {
            if (!v.HasValue) return None;
            string s = N(Mathf.Abs(v.Value), decimals);
            return (v.Value < 0f ? "-" : "+") + s + suffix;
        }

        /// <summary>Türkçe büyük harf (i→İ, ı→I) — kültür verisine bağımlı olmadan.</summary>
        public static string Up(string s)
        {
            if (string.IsNullOrEmpty(s)) return "";
            return s.Replace('i', 'İ').ToUpperInvariant();
        }

        public static string Cut(string s, int max)
        {
            if (string.IsNullOrEmpty(s)) return "";
            s = s.Replace('\n', ' ');
            return s.Length <= max ? s : s.Substring(0, Mathf.Max(1, max - 1)) + "…";
        }

        public static string Countdown(float? sec)
        {
            if (!sec.HasValue) return None;
            int t = Mathf.Max(0, Mathf.FloorToInt(sec.Value));
            return "T-" + (t / 3600).ToString("00") + ":" + (t % 3600 / 60).ToString("00") + ":" + (t % 60).ToString("00");
        }

        public static string Minutes(float? min)
        {
            if (!min.HasValue) return None;
            int m = Mathf.Max(0, Mathf.RoundToInt(min.Value));
            return (m / 60) + "S " + (m % 60).ToString("00") + "DK";
        }
    }

    // ═══════════════════════ ÜST ÇUBUK ═══════════════════════
    public sealed class HudTopBar : HudPanelBase
    {
        public Action<string> OnTab;
        public string ActiveTab = "overview";
        public Func<string> PcName;
        private HudText _brand, _sub, _time, _date, _toast, _load;
        private static readonly string[] TabNames = { "GENEL", "ATÖLYE", "İLETİŞİM" };   // HudActions.Tabs sırasıyla
        private readonly HudText[] _tabs = new HudText[HudActions.Tabs.Length];
        private float _toastUntil;
        private const float TabW = 0.19f;
        /// <summary>Sekme etiketinin yatay merkezi: sekmeler çubuğun ortasında yan yana dizilir.</summary>
        private float TabX(int i) => (i - (_tabs.Length - 1) / 2f) * TabW;

        protected override bool ShowChrome => false;
        protected override bool DrawWhenOff => true;

        protected override void BuildStaticExtra()
        {
            float x0 = -W / 2f, x1 = W / 2f, y0 = -H / 2f, y1 = H / 2f;
            var a = HudTheme.Accent;
            M.QuadV(x0, y0, x1, y1, new Color(HudTheme.Bg.r, HudTheme.Bg.g, HudTheme.Bg.b, 0.35f), new Color(HudTheme.Bg.r, HudTheme.Bg.g, HudTheme.Bg.b, 0.7f));
            M.Line(x0, y0, x1, y0, 0.0015f, new Color(a.r, a.g, a.b, 0.55f));
            M.Line(x0, y0, x0 + 0.05f, y0, 0.004f, HudTheme.Bright, 0.5f);
            M.Line(x1 - 0.05f, y0, x1, y0, 0.004f, HudTheme.Bright, 0.5f);
        }

        protected override void BuildContent()
        {
            _brand = Txt(-W / 2f + 0.02f, 0.014f, 0.024f, HudRole.Bright); _brand.Set("FUBER AI");
            _sub = Txt(-W / 2f + 0.02f, -0.018f, 0.011f, HudRole.Dim);
            _time = Txt(W / 2f - 0.02f, 0.012f, 0.03f, HudRole.Bright, TextAnchor.MiddleRight);
            _date = Txt(W / 2f - 0.02f, -0.02f, 0.011f, HudRole.Dim, TextAnchor.MiddleRight);
            _toast = Txt(0f, -H / 2f - 0.02f, 0.015f, HudRole.Bright, TextAnchor.MiddleCenter);
            _load = Txt(0.495f, 0.02f, 0.0125f, HudRole.Dim);
            for (int i = 0; i < _tabs.Length; i++)
            {
                float cx = TabX(i);
                _tabs[i] = Txt(cx, 0f, 0.017f, HudRole.Dim, TextAnchor.MiddleCenter);
                _tabs[i].Set(TabNames[i]);
                string tab = HudActions.Tabs[i];
                AddButton(cx - TabW / 2f + 0.004f, -0.034f, TabW - 0.008f, 0.068f, () => OnTab?.Invoke(tab));
            }
        }

        public static string LoadLevelTr(string level)
        {
            switch (level) { case "calm": return "SAKİN"; case "normal": return "NORMAL"; case "busy": return "YOĞUN"; case "critical": return "KRİTİK"; default: return ""; }
        }

        public void Toast(string text, float seconds = 2.2f)
        {
            _toast.Set(text);
            _toastUntil = Time.unscaledTime + seconds;
            MarkDirty();
        }

        protected override void Draw(HudSnapshot s)
        {
            bool have = s != null;
            _time.SetVisible(have); _date.SetVisible(have);
            if (have)
            {
                _time.Set(s.Clock.Time);
                _date.Set(HudFmt.Up(s.Clock.Date) + (string.IsNullOrEmpty(s.Clock.Tz) ? "" : " · " + s.Clock.Tz));
            }
            string pc = PcName != null ? PcName() : "";
            _sub.Set(!have ? "KÖPRÜ · BAĞLI DEĞİL" : State == PanelState.Stale ? "KÖPRÜ · GECİKMELİ" : "KÖPRÜ" + (string.IsNullOrEmpty(pc) ? "" : " · " + HudFmt.Up(HudFmt.Cut(pc, 22))));
            _sub.SetRole(have && State != PanelState.Stale ? HudRole.Dim : HudRole.Warn);

            for (int i = 0; i < _tabs.Length; i++)
            {
                bool act = HudActions.Tabs[i] == ActiveTab && have;
                _tabs[i].SetRole(act ? HudRole.Bright : HudRole.Dim);
                float cx = TabX(i);
                if (act)
                {
                    var c = HudTheme.Accent;
                    M.QuadV(cx - TabW / 2f + 0.004f, -0.034f, cx + TabW / 2f - 0.004f, 0.034f, new Color(c.r, c.g, c.b, 0f), new Color(c.r, c.g, c.b, 0.22f), 1f);
                    M.Quad(cx - TabW / 2f + 0.004f, -0.036f, cx + TabW / 2f - 0.004f, -0.032f, new Color(c.r, c.g, c.b, 1f), 0.6f);
                }
            }
            // yoğunluk göstergesi: "YOĞUNLUK 62 · YOĞUN" + ince çubuk (yalnız PC load bildirdiyse)
            bool hasLoad = have && s.HasLoad && (s.Load.Score.HasValue || s.Load.Level.Length > 0);
            if (hasLoad)
            {
                string lv = LoadLevelTr(s.Load.Level);
                _load.Set("YOĞUNLUK" + (s.Load.Score.HasValue ? " " + HudFmt.N(s.Load.Score, 0) : "") + (lv.Length > 0 ? " · " + lv : ""));
                _load.SetRole(s.Load.Level == "critical" ? HudRole.Alert : s.Load.Level == "busy" ? HudRole.Warn : HudRole.Accent);
                if (s.Load.Score.HasValue)
                {
                    var c = HudTheme.Role(s.Load.Level == "critical" ? HudRole.Alert : s.Load.Level == "busy" ? HudRole.Warn : HudRole.Accent);
                    float bx0 = 0.495f, bw = 0.16f, by = -0.004f;
                    M.Quad(bx0, by, bx0 + bw, by + 0.006f, new Color(c.r, c.g, c.b, 0.15f));
                    M.Quad(bx0, by, bx0 + bw * Mathf.Clamp01(s.Load.Score.Value / 100f), by + 0.006f, new Color(c.r, c.g, c.b, 1f), 0.3f);
                }
            }
            else _load.Set("");
            foreach (var b in Buttons) SetButton(b, have);
            if (_toastUntil > 0f && Time.unscaledTime > _toastUntil) { _toastUntil = 0f; _toast.Set(""); }
        }

        private void LateUpdate()
        {
            if (_toastUntil > 0f && Time.unscaledTime > _toastUntil) { _toastUntil = 0f; _toast.Set(""); }
        }
    }

    // ═══════════════════════ SELAM ═══════════════════════
    public sealed class HudGreeting : HudPanelBase
    {
        private HudText _g, _s;
        protected override bool ShowChrome => false;

        protected override void BuildStaticExtra()
        {
            var a = HudTheme.Accent;
            M.Line(-W / 2f + 0.06f, -H / 2f + 0.002f, W / 2f - 0.06f, -H / 2f + 0.002f, 0.001f, new Color(a.r, a.g, a.b, 0.28f));
        }

        protected override void BuildContent()
        {
            _g = Txt(0f, 0.025f, 0.042f, HudRole.Bright, TextAnchor.MiddleCenter);
            _s = Txt(0f, -0.032f, 0.0175f, HudRole.Dim, TextAnchor.MiddleCenter);
        }

        protected override void Draw(HudSnapshot s)
        {
            _g.Set(HudFmt.Cut(s.Greeting, 40));
            _s.Set(HudFmt.Cut(s.Summary, 78));
        }
    }

    // ═══════════════════════ ENV ═══════════════════════
    public sealed class HudEnvPanel : HudPanelBase
    {
        private HudText _temp, _unit, _place, _coord, _cond;
        private readonly HudText[] _statL = new HudText[4], _statV = new HudText[4];
        private readonly HudText[] _hT = new HudText[5], _hV = new HudText[5];
        private static readonly string[] Labels = { "RÜZGAR", "NEM", "UV", "GÖRÜŞ" };


        protected override void BuildContent()
        {
            _temp = Txt(-W / 2f + 0.016f, 0.06f, 0.062f, HudRole.Bright);
            _unit = Txt(-W / 2f + 0.16f, 0.083f, 0.02f, HudRole.Dim);
            _place = Txt(W / 2f - 0.016f, 0.085f, 0.019f, HudRole.Bright, TextAnchor.MiddleRight);
            _coord = Txt(W / 2f - 0.016f, 0.058f, 0.0115f, HudRole.Dim, TextAnchor.MiddleRight);
            _cond = Txt(W / 2f - 0.016f, 0.034f, 0.0125f, HudRole.Accent, TextAnchor.MiddleRight);
            float colW = (W - 0.032f) / 4f;
            for (int i = 0; i < 4; i++)
            {
                float x = -W / 2f + 0.016f + i * colW;
                _statL[i] = Txt(x, -0.012f, 0.0105f, HudRole.Dim); _statL[i].Set(Labels[i]);
                _statV[i] = Txt(x, -0.037f, 0.0185f, HudRole.Bright);
            }
            float cw = (W - 0.028f) / 5f;
            for (int i = 0; i < 5; i++)
            {
                float cx = -W / 2f + 0.014f + (i + 0.5f) * cw;
                _hT[i] = Txt(cx, -0.098f, 0.0105f, HudRole.Dim, TextAnchor.MiddleCenter);
                _hV[i] = Txt(cx, -0.13f, 0.0185f, HudRole.Bright, TextAnchor.MiddleCenter);
            }
        }

        protected override void Draw(HudSnapshot s)
        {
            var e = s.Env;
            var da = HudTheme.Accent;
            M.Line(-W / 2f + 0.014f, 0.008f, W / 2f - 0.014f, 0.008f, 0.001f, new Color(da.r, da.g, da.b, 0.22f));
            for (int i = 0; i < Mathf.Min(5, e.Hourly.Count); i++)
            {
                float cx = -W / 2f + 0.014f + (i + 0.5f) * ((W - 0.028f) / 5f);
                float cw = (W - 0.028f) / 5f - 0.008f;
                M.Quad(cx - cw / 2f, -0.158f, cx + cw / 2f, -0.082f, new Color(da.r, da.g, da.b, 0.07f), 1f);
            }
            SetChip(HudFmt.Cut(HudFmt.Up(e.Condition), 14), HudRole.Accent);
            _temp.Set(HudFmt.N(e.TempC, 1));
            _unit.Tf.localPosition = new Vector3(-W / 2f + 0.016f + Mathf.Max(1, _temp.Text.Length) * 0.04f + 0.012f, 0.083f, -0.004f);
            _unit.Set(e.TempC.HasValue ? "°C" : "");
            _place.Set(HudFmt.Cut(HudFmt.Up(e.Place), 20));
            _coord.Set(e.Lat.HasValue && e.Lon.HasValue
                ? HudFmt.N(Mathf.Abs(e.Lat.Value), 2) + (e.Lat >= 0 ? " K / " : " G / ") + HudFmt.N(Mathf.Abs(e.Lon.Value), 2) + (e.Lon >= 0 ? " D" : " B")
                : "");
            _cond.Set(HudFmt.Cut(HudFmt.Up(e.Condition), 26));
            _statV[0].Set(e.WindKmh.HasValue ? HudFmt.N(e.WindKmh, 0) + " KM/S " + HudFmt.Up(e.WindDir) : HudFmt.None);
            _statV[1].Set(e.Humidity.HasValue ? "%" + HudFmt.N(e.Humidity, 0) : HudFmt.None);
            _statV[2].Set(HudFmt.N(e.Uv, 0));
            _statV[3].Set(e.VisibilityKm.HasValue ? HudFmt.N(e.VisibilityKm, 0) + " KM" : HudFmt.None);
            for (int i = 0; i < 5; i++)
            {
                bool has = i < e.Hourly.Count;
                _hT[i].Set(has ? e.Hourly[i].Time : "");
                _hV[i].Set(has ? HudFmt.N(e.Hourly[i].TempC, 0, "°") : "");
            }
        }
    }

    // ═══════════════════════ CAL ═══════════════════════
    public sealed class HudCalPanel : HudPanelBase
    {
        public Action<string> OnOpen;
        private const int Rows = 6;
        private HudText _nextL, _next;
        private readonly HudText[] _t = new HudText[Rows], _title = new HudText[Rows], _place = new HudText[Rows];
        private int _lastSec = -1;
        private float _recvAt;

        public HudCalPanel() { Animated = false; }

        protected override void BuildContent()
        {
            _nextL = Txt(-W / 2f + 0.016f, 0.1f, 0.0105f, HudRole.Dim); _nextL.Set("SONRAKİ OLAY");
            _next = Txt(W / 2f - 0.016f, 0.1f, 0.02f, HudRole.Bright, TextAnchor.MiddleRight);
            for (int i = 0; i < Rows; i++)
            {
                float y = 0.06f - i * 0.04f;
                _t[i] = Txt(-W / 2f + 0.02f, y, 0.0145f, HudRole.Dim);
                _title[i] = Txt(-W / 2f + 0.085f, y, 0.0155f, HudRole.Bright);
                _place[i] = Txt(W / 2f - 0.02f, y, 0.0105f, HudRole.Dim, TextAnchor.MiddleRight);
                int idx = i;
                AddButton(-W / 2f + 0.008f, y - 0.019f, W - 0.016f, 0.038f, () => { if (Snap != null && idx < Snap.Cal.Items.Count) OnOpen?.Invoke(Snap.Cal.Items[idx].Ref); });
            }
        }

        public void NoteReceived() { _recvAt = Time.unscaledTime; _lastSec = -1; }

        private void LateUpdate()
        {
            if (State == PanelState.Off || Snap == null || !Snap.Cal.NextInSec.HasValue) return;
            int sec = Mathf.Max(0, Mathf.FloorToInt(Snap.Cal.NextInSec.Value - (Time.unscaledTime - _recvAt)));
            if (sec != _lastSec) { _lastSec = sec; if (State == PanelState.Live) _next.Set(HudFmt.Countdown(sec)); }
        }

        protected override void Draw(HudSnapshot s)
        {
            var c = s.Cal;
            SetChip(c.Items.Count > 0 ? c.Items.Count + " OLAY" : "BOŞ", HudRole.Accent);
            _next.Set(HudFmt.Countdown(c.NextInSec.HasValue ? Mathf.Max(0f, c.NextInSec.Value - (Time.unscaledTime - _recvAt)) : (float?)null));
            for (int i = 0; i < Rows; i++)
            {
                bool has = i < c.Items.Count;
                SetButton(Buttons[i], has && !string.IsNullOrEmpty(c.Items[i].Ref));
                _t[i].Set(has ? c.Items[i].Time : "");
                _title[i].Set(has ? HudFmt.Cut(c.Items[i].Title, 27) : "");
                _place[i].Set(has ? HudFmt.Cut(HudFmt.Up(c.Items[i].Place), 9) : "");
                if (!has) continue;
                float y = 0.06f - i * 0.04f;
                bool cur = c.Items[i].Current;
                _title[i].SetRole(cur ? HudRole.Bright : HudRole.Accent);
                if (cur)
                {
                    var a = HudTheme.Accent;
                    M.QuadV(-W / 2f + 0.008f, y - 0.018f, W / 2f - 0.008f, y + 0.018f, new Color(a.r, a.g, a.b, 0.04f), new Color(a.r, a.g, a.b, 0.18f), 1f);
                    M.Quad(-W / 2f + 0.008f, y - 0.018f, -W / 2f + 0.011f, y + 0.018f, new Color(a.r, a.g, a.b, 1f), 0.5f);
                }
                else M.Line(-W / 2f + 0.014f, y - 0.02f, W / 2f - 0.014f, y - 0.02f, 0.0008f, new Color(HudTheme.Accent.r, HudTheme.Accent.g, HudTheme.Accent.b, 0.14f));
            }
        }
    }

    // ═══════════════════════ BIO ═══════════════════════
    public sealed class HudBioPanel : HudPanelBase
    {
        private HudText _hr, _bpm, _l1, _v1, _l2, _v2, _line3, _line4;
        private float _phase;
        private const float EkgX0 = -0.065f, EkgX1 = 0.235f, EkgY = 0.06f, EkgH = 0.04f, Window = 3.2f;
        private readonly List<Vector2> _pts = new List<Vector2>(128);

        public HudBioPanel() { Animated = true; }


        protected override void BuildContent()
        {
            _hr = Txt(-W / 2f + 0.016f, 0.062f, 0.075f, HudRole.Bright);
            _bpm = Txt(-W / 2f + 0.016f, 0.012f, 0.013f, HudRole.Dim); _bpm.Set("NABIZ · BPM");
            _l1 = Txt(-W / 2f + 0.016f, -0.03f, 0.0105f, HudRole.Dim); _l1.Set("OKSİJEN DOYGUNLUĞU");
            _v1 = Txt(W / 2f - 0.016f, -0.03f, 0.0125f, HudRole.Bright, TextAnchor.MiddleRight);
            _l2 = Txt(-W / 2f + 0.016f, -0.082f, 0.0105f, HudRole.Dim); _l2.Set("STRES");
            _v2 = Txt(W / 2f - 0.016f, -0.082f, 0.0125f, HudRole.Bright, TextAnchor.MiddleRight);
            _line3 = Txt(-W / 2f + 0.016f, -0.128f, 0.0115f, HudRole.Dim);
            _line4 = Txt(-W / 2f + 0.016f, -0.152f, 0.0115f, HudRole.Dim);
        }

        private static float Ecg(float p)
        {
            // P (0.14), Q (0.27), R (0.30), S (0.33), T (0.55) — basit sentetik PQRST şekli.
            float v = 0f;
            v += 0.12f * Mathf.Exp(-Mathf.Pow((p - 0.14f) / 0.025f, 2f));
            v -= 0.14f * Mathf.Exp(-Mathf.Pow((p - 0.265f) / 0.008f, 2f));
            v += 1.00f * Mathf.Exp(-Mathf.Pow((p - 0.295f) / 0.009f, 2f));
            v -= 0.25f * Mathf.Exp(-Mathf.Pow((p - 0.325f) / 0.009f, 2f));
            v += 0.22f * Mathf.Exp(-Mathf.Pow((p - 0.55f) / 0.04f, 2f));
            return v;
        }

        private void SegBar(float x0, float y, float w, float frac, Color on)
        {
            const int n = 24;
            float segW = w / n;
            int lit = Mathf.RoundToInt(Mathf.Clamp01(frac) * n);
            for (int i = 0; i < n; i++)
            {
                var c = i < lit ? on : new Color(on.r, on.g, on.b, 0.14f);
                M.Quad(x0 + i * segW + 0.0008f, y, x0 + (i + 1) * segW - 0.0008f, y + 0.007f, c, i < lit ? 0.3f : 0f);
            }
        }

        protected override void Draw(HudSnapshot s)
        {
            var b = s.Bio;
            { var ga = HudTheme.Accent; for (int i = 0; i < 4; i++) M.Line(EkgX0, EkgY - 0.04f + i * 0.027f, EkgX1, EkgY - 0.04f + i * 0.027f, 0.0006f, new Color(ga.r, ga.g, ga.b, 0.09f)); }
            bool live = State == PanelState.Live && b.Hr.HasValue;
            if (NewData)
            {
                SetChip(b.Status == HudStatus.Ok ? "CANLI" : "SAAT", b.Status == HudStatus.Ok ? HudRole.Ok : HudRole.Warn);
                _hr.Set(b.Hr.HasValue ? HudFmt.N(b.Hr, 0) : HudFmt.None);
                _v1.Set(b.Spo2.HasValue ? "[ %" + HudFmt.N(b.Spo2, 0) + " ]" : "[ — ]");
                _v2.Set(b.Stress.HasValue ? "[ " + HudFmt.N(b.Stress, 0) + " / 100 ]" : "[ — ]");
                _line3.Set("ADIM " + HudFmt.N(b.Steps, 0) + "  ·  KCAL " + HudFmt.N(b.Kcal, 0) + "  ·  SAAT " + (b.Battery.HasValue ? "%" + HudFmt.N(b.Battery, 0) : HudFmt.None));
                _line4.Set("DERİ " + HudFmt.N(b.SkinTemp, 1, "°C") + "  ·  UYKU " + HudFmt.Minutes(b.SleepMin) + (b.Worn ? "" : "  ·  TAKILI DEĞİL"));
            }

            SegBarAt(-0.057f, b.Spo2.HasValue ? (b.Spo2.Value - 80f) / 20f : 0f, b.Spo2.HasValue);
            SegBarAt(-0.109f, b.Stress.HasValue ? b.Stress.Value / 100f : 0f, b.Stress.HasValue);

            // EKG: yalnız canlı ve gerçek nabız varken atar; aksi halde düz çizgi.
            var accent = HudTheme.Bright;
            _pts.Clear();
            const int N = 100;
            float hr = live ? Mathf.Clamp(b.Hr.Value, 30f, 220f) : 0f;
            float period = hr > 0f ? 60f / hr : 1f;
            if (live) _phase += Time.deltaTime / period;
            for (int i = 0; i < N; i++)
            {
                float u = i / (float)(N - 1);
                float y = 0f;
                if (live) y = Ecg(Frac(_phase - (1f - u) * Window / period));
                _pts.Add(new Vector2(Mathf.Lerp(EkgX0, EkgX1, u), EkgY + y * EkgH));
            }
            for (int i = 1; i < N; i++)
            {
                float u = i / (float)(N - 1);
                float al = live ? Mathf.Clamp01(u * 1.6f) : 0.3f;
                var c = new Color(accent.r, accent.g, accent.b, al);
                M.Line(_pts[i - 1], _pts[i], 0.007f, new Color(accent.r, accent.g, accent.b, al * 0.14f), 1f);
                M.Line(_pts[i - 1], _pts[i], 0.0022f, c);
            }
            if (live)
            {
                var tip = _pts[N - 1];
                M.Glow(tip.x, tip.y, 0.016f, 12, new Color(accent.r, accent.g, accent.b, 0.75f), new Color(accent.r, accent.g, accent.b, 0f));
            }
        }

        private void SegBarAt(float y, float frac, bool has)
        {
            var c = HudTheme.Accent; c.a = has ? 1f : 0.3f;
            SegBar(-W / 2f + 0.016f, y, W - 0.032f, has ? frac : 0f, c);
        }

        private static float Frac(float x) => x - Mathf.Floor(x);
    }

    // ═══════════════════════ FIN ═══════════════════════
    public sealed class HudFinPanel : HudPanelBase
    {
        private HudText _price, _chg, _sym, _name;
        private const int Rows = 4, N = 48;
        private readonly HudText[] _rs = new HudText[Rows], _rp = new HudText[Rows], _rc = new HudText[Rows];
        private readonly float[] _disp = new float[N];
        private readonly float[] _tgt = new float[N];
        private bool _hasDisp;
        private string _dispSym = "";
        private readonly List<Vector2> _pts = new List<Vector2>(N);
        private const float CX0 = -0.24f, CX1 = 0.24f, CY0 = -0.025f, CY1 = 0.06f;

        public HudFinPanel() { Animated = true; }


        protected override void BuildContent()
        {
            _price = Txt(-W / 2f + 0.016f, 0.1f, 0.05f, HudRole.Bright);
            _chg = Txt(-W / 2f + 0.17f, 0.095f, 0.0165f, HudRole.Accent);
            _sym = Txt(W / 2f - 0.016f, 0.108f, 0.0125f, HudRole.Dim, TextAnchor.MiddleRight);
            _name = Txt(W / 2f - 0.016f, 0.084f, 0.0115f, HudRole.Dim, TextAnchor.MiddleRight);
            for (int i = 0; i < Rows; i++)
            {
                float y = -0.07f - i * 0.03f;
                _rs[i] = Txt(-W / 2f + 0.018f, y, 0.0135f, HudRole.Bright);
                _rp[i] = Txt(0.06f, y, 0.0135f, HudRole.Dim, TextAnchor.MiddleRight);
                _rc[i] = Txt(W / 2f - 0.018f, y, 0.0135f, HudRole.Accent, TextAnchor.MiddleRight);
            }
        }

        private static HudFinItem Focus(HudFin f)
        {
            foreach (var i in f.Items) if (i.Sym == f.Focus) return i;
            return f.Items.Count > 0 ? f.Items[0] : null;
        }

        private static void Resample(List<float> src, float[] dst)
        {
            int n = src.Count;
            if (n == 0) return;
            for (int i = 0; i < dst.Length; i++)
            {
                float p = n == 1 ? 0f : i / (float)(dst.Length - 1) * (n - 1);
                int a = Mathf.FloorToInt(p), b = Mathf.Min(n - 1, a + 1);
                dst[i] = Mathf.Lerp(src[a], src[b], p - a);
            }
        }

        protected override void Draw(HudSnapshot s)
        {
            var f = s.Fin;
            { var ga = HudTheme.Accent;
              for (int i = 0; i < 4; i++) M.Line(CX0, Mathf.Lerp(CY0, CY1, i / 3f), CX1, Mathf.Lerp(CY0, CY1, i / 3f), 0.0006f, new Color(ga.r, ga.g, ga.b, 0.1f));
              M.Line(-W / 2f + 0.014f, -0.045f, W / 2f - 0.014f, -0.045f, 0.001f, new Color(ga.r, ga.g, ga.b, 0.22f)); }
            var item = Focus(f);
            if (NewData) SetChip(f.MarketOpen ? "PİYASA AÇIK" : "PİYASA KAPALI", f.MarketOpen ? HudRole.Ok : HudRole.Warn);
            if (item == null)
            {
                _price.Set(HudFmt.None); _chg.Set(""); _sym.Set(""); _name.Set("VERİ YOK");
                foreach (var t in _rs) t.Set(""); foreach (var t in _rp) t.Set(""); foreach (var t in _rc) t.Set("");
                return;
            }
            if (NewData)
            {
                _price.Set(HudFmt.N(item.Price, 2));
                _chg.Tf.localPosition = new Vector3(-W / 2f + 0.016f + Mathf.Max(1, _price.Text.Length) * 0.03f + 0.014f, 0.095f, -0.004f);
                _chg.Set(HudFmt.Signed(item.ChangePct, 2, "%"));
                _chg.SetRole(item.ChangePct.HasValue && item.ChangePct.Value < 0f ? HudRole.Alert : HudRole.Accent);
                _sym.Set(HudFmt.Up(item.Sym) + (string.IsNullOrEmpty(item.Currency) ? "" : " / " + HudFmt.Up(item.Currency)));
                _name.Set(HudFmt.Cut(HudFmt.Up(item.Name), 26));
            }

            // grafik: hedefi örnekle, normalize et, görüneni hedefe doğru akıt
            bool hasSeries = item.Series.Count >= 2;
            if (hasSeries)
            {
                float mn = float.MaxValue, mx = float.MinValue;
                foreach (var v in item.Series) { if (v < mn) mn = v; if (v > mx) mx = v; }
                float range = Mathf.Max(mx - mn, 1e-6f);
                Resample(item.Series, _tgt);
                for (int i = 0; i < N; i++) _tgt[i] = (_tgt[i] - mn) / range;
                if (!_hasDisp || _dispSym != item.Sym) { System.Array.Copy(_tgt, _disp, N); _hasDisp = true; _dispSym = item.Sym; }
                float k = 1f - Mathf.Exp(-7f * Time.deltaTime);
                for (int i = 0; i < N; i++) _disp[i] = Mathf.Lerp(_disp[i], _tgt[i], k);
                _pts.Clear();
                for (int i = 0; i < N; i++)
                    _pts.Add(new Vector2(Mathf.Lerp(CX0, CX1, i / (float)(N - 1)), Mathf.Lerp(CY0 + 0.004f, CY1 - 0.004f, _disp[i])));
                var a = HudTheme.Accent;
                M.FillUnder(_pts, CY0, new Color(a.r, a.g, a.b, 0.26f), new Color(a.r, a.g, a.b, 0f));
                M.Polyline(_pts, 0.0065f, new Color(a.r, a.g, a.b, 0.15f), 1f);
                M.Polyline(_pts, 0.0021f, HudTheme.Bright);
                var tip = _pts[_pts.Count - 1];
                float pulse = 0.5f + 0.5f * Mathf.Sin(TimeAlive * 4f);
                M.Glow(tip.x, tip.y, 0.012f + 0.006f * pulse, 12, new Color(a.r, a.g, a.b, 0.8f), new Color(a.r, a.g, a.b, 0f));
                M.Dot(tip.x, tip.y, 0.006f, HudTheme.Bright);
            }

            // liste
            if (!NewData) return;
            int row = 0;
            foreach (var it in f.Items)
            {
                if (row >= Rows) break;
                _rs[row].Set(HudFmt.Up(it.Sym));
                _rs[row].SetRole(it.Sym == f.Focus ? HudRole.Bright : HudRole.Accent);
                _rp[row].Set(HudFmt.N(it.Price, 2));
                _rc[row].Set(HudFmt.Signed(it.ChangePct, 2, "%"));
                _rc[row].SetRole(it.ChangePct.HasValue && it.ChangePct.Value < 0f ? HudRole.Alert : HudRole.Accent);
                row++;
            }
            for (; row < Rows; row++) { _rs[row].Set(""); _rp[row].Set(""); _rc[row].Set(""); }
        }
    }

    // ═══════════════════════ BAĞLANTILAR ═══════════════════════
    public sealed class HudLinksPanel : HudPanelBase
    {
        private const int Rows = 6, Segs = 10;
        private readonly HudText[] _n = new HudText[Rows], _d = new HudText[Rows], _l = new HudText[Rows];

        protected override void BuildContent()
        {
            for (int i = 0; i < Rows; i++)
            {
                float y = 0.085f - i * 0.043f;
                _n[i] = Txt(-W / 2f + 0.016f, y, 0.0155f, HudRole.Bright);
                _d[i] = Txt(-W / 2f + 0.13f, y, 0.0108f, HudRole.Dim);
                _l[i] = Txt(W / 2f - 0.016f, y, 0.0135f, HudRole.Accent, TextAnchor.MiddleRight);
            }
        }

        protected override void Draw(HudSnapshot s)
        {
            var L = s.Links;
            SetChip(L.Linked + "/" + L.Total + " BAĞLI", L.Linked >= L.Total && L.Total > 0 ? HudRole.Ok : HudRole.Warn);
            for (int i = 0; i < Rows; i++)
            {
                if (i >= L.Items.Count) { _n[i].Set(""); _d[i].Set(""); _l[i].Set(""); continue; }
                var it = L.Items[i];
                float y = 0.085f - i * 0.043f;
                _n[i].Set(HudFmt.Cut(HudFmt.Up(it.Name), 11));
                _n[i].SetRole(it.Up ? HudRole.Bright : HudRole.Warn);
                _d[i].Set(HudFmt.Cut(HudFmt.Up(it.Detail), 9));
                _l[i].Set(it.Up ? (it.LatencyMs.HasValue ? HudFmt.N(it.LatencyMs, 0) + " MS" : "BAĞLI") : "YOK");
                _l[i].SetRole(it.Up ? HudRole.Accent : HudRole.Warn);
                float bx0 = 0.0f, segW = 0.0125f;
                int lit = it.Up ? Mathf.RoundToInt(it.Quality * Segs) : 0;
                var a = it.Up ? HudTheme.Accent : HudTheme.Warn;
                for (int k = 0; k < Segs; k++)
                {
                    bool on = k < lit;
                    M.Quad(bx0 + k * segW, y - 0.0045f, bx0 + (k + 1) * segW - 0.0016f, y + 0.0045f, new Color(a.r, a.g, a.b, on ? 1f : 0.13f), on ? 0.25f : 0f);
                }
                M.Line(-W / 2f + 0.014f, y - 0.0215f, W / 2f - 0.014f, y - 0.0215f, 0.0007f, new Color(HudTheme.Accent.r, HudTheme.Accent.g, HudTheme.Accent.b, 0.1f));
            }
        }
    }

    // ═══════════════════════ LOG ═══════════════════════
    public sealed class HudLogPanel : HudPanelBase
    {
        public Action<string> OnOpen;
        private const int Rows = 7;
        private readonly HudText[] _t = new HudText[Rows], _tag = new HudText[Rows], _txt = new HudText[Rows], _arrow = new HudText[Rows];
        private List<HudLogEntry> _entries = new List<HudLogEntry>();

        protected override void BuildContent()
        {
            for (int i = 0; i < Rows; i++)
            {
                float y = 0.1f - i * 0.041f;
                _t[i] = Txt(-W / 2f + 0.016f, y, 0.0108f, HudRole.Dim);
                _tag[i] = Txt(-W / 2f + 0.082f, y, 0.0108f, HudRole.Accent);
                _txt[i] = Txt(-W / 2f + 0.125f, y, 0.0145f, HudRole.Bright);
                _arrow[i] = Txt(W / 2f - 0.016f, y, 0.0145f, HudRole.Accent, TextAnchor.MiddleRight);
                int idx = i;
                AddButton(-W / 2f + 0.008f, y - 0.019f, W - 0.016f, 0.038f, () => { if (idx < _entries.Count && !string.IsNullOrEmpty(_entries[idx].Ref)) OnOpen?.Invoke(_entries[idx].Ref); });
            }
        }

        /// <summary>Yeni → eski sıralı liste (HudController hazırlar).</summary>
        public void SetEntries(List<HudLogEntry> newestFirst) { _entries = newestFirst; MarkDirty(); }

        protected override void Draw(HudSnapshot s)
        {
            SetChip(_entries.Count + " KAYIT", HudRole.Accent);
            for (int i = 0; i < Rows; i++)
            {
                bool has = i < _entries.Count;
                var e = has ? _entries[i] : null;
                SetButton(Buttons[i], has && !string.IsNullOrEmpty(e.Ref));
                _t[i].Set(has ? e.Ts : "");
                _tag[i].Set(has ? HudFmt.Up(e.Tag) : "");
                _txt[i].Set(has ? HudFmt.Cut(e.Text, 36) : "");
                _arrow[i].Set(has && !string.IsNullOrEmpty(e.Ref) ? "›" : "");
                if (has) M.Line(-W / 2f + 0.014f, 0.1f - i * 0.041f - 0.0205f, W / 2f - 0.014f, 0.1f - i * 0.041f - 0.0205f, 0.0007f, new Color(HudTheme.Accent.r, HudTheme.Accent.g, HudTheme.Accent.b, 0.1f));
            }
        }
    }

    // ═══════════════════════ ATÖLYE: ÇEKİRDEK AYRINTISI ═══════════════════════
    public sealed class HudWorkshopPanel : HudPanelBase
    {
        private readonly HudText[] _l = new HudText[4], _v = new HudText[4], _s = new HudText[4];
        private HudText _coresL, _legCpu, _legGpu, _legRam;
        private const float CX0 = -0.29f, CX1 = 0.12f, CY0 = -0.14f, CY1 = 0.0f;
        private readonly List<Vector2> _pts = new List<Vector2>(64);
        private static readonly string[] Labels = { "CPU", "GPU", "RAM", "VRAM" };

        protected override void BuildContent()
        {
            float colW = 0.15f;
            for (int i = 0; i < 4; i++)
            {
                float x = -W / 2f + 0.02f + i * colW;
                _l[i] = Txt(x, 0.123f, 0.0115f, HudRole.Dim); _l[i].Set(Labels[i]);
                _v[i] = Txt(x, 0.093f, 0.026f, HudRole.Bright);
                _s[i] = Txt(x, 0.056f, 0.0112f, HudRole.Dim);
            }
            _coresL = Txt(0.15f, 0.015f, 0.0112f, HudRole.Dim); _coresL.Set("ÇEKİRDEK BAŞINA");
            _legCpu = Txt(CX0, -0.168f, 0.0115f, HudRole.Accent); _legCpu.Set("CPU");
            _legGpu = Txt(CX0 + 0.07f, -0.168f, 0.0115f, HudRole.Warn); _legGpu.Set("GPU");
            _legRam = Txt(CX0 + 0.14f, -0.168f, 0.0115f, HudRole.Bright); _legRam.Set("RAM");
        }

        private void Series(List<float> src, Color c)
        {
            if (src == null || src.Count < 2) return;
            _pts.Clear();
            for (int i = 0; i < src.Count; i++)
                _pts.Add(new Vector2(Mathf.Lerp(CX0, CX1, i / (float)(src.Count - 1)), Mathf.Lerp(CY0, CY1, Mathf.Clamp01(src[i] / 100f))));
            M.Polyline(_pts, 0.0018f, c);
        }

        protected override void Draw(HudSnapshot s)
        {
            var c = s.Core;
            if (NewData)
            {
                SetChip(c.TempC.HasValue ? HudFmt.N(c.TempC, 0, "°C") + (c.TempSource.Length > 0 ? " " + HudFmt.Up(c.TempSource) : "") : "ÇEKİRDEK", HudRole.Accent);
                _v[0].Set(c.Cpu.HasValue ? HudFmt.N(c.Cpu, 0, "%") : HudFmt.None);
                _v[1].Set(c.Gpu.HasValue ? HudFmt.N(c.Gpu, 0, "%") : HudFmt.None);
                _v[2].Set(c.Ram.HasValue ? HudFmt.N(c.Ram, 0, "%") : HudFmt.None);
                _v[3].Set(c.Vram.HasValue ? HudFmt.N(c.Vram, 0, "%") : HudFmt.None);
                _s[0].Set(c.Cores.Count > 0 ? c.Cores.Count + " ÇEKİRDEK" : "");
                _s[1].Set(HudFmt.Cut(HudFmt.Up(c.GpuName), 14));
                _s[2].Set(c.RamUsedGb.HasValue && c.RamTotalGb.HasValue ? HudFmt.N(c.RamUsedGb, 1) + "/" + HudFmt.N(c.RamTotalGb, 0) + " GB" : "");
                _s[3].Set(c.VramUsedGb.HasValue && c.VramTotalGb.HasValue ? HudFmt.N(c.VramUsedGb, 1) + "/" + HudFmt.N(c.VramTotalGb, 0) + " GB" : "");
            }
            var a = HudTheme.Accent;
            for (int i = 0; i < 5; i++) M.Line(CX0, Mathf.Lerp(CY0, CY1, i / 4f), CX1, Mathf.Lerp(CY0, CY1, i / 4f), 0.0006f, new Color(a.r, a.g, a.b, 0.1f));
            M.RectOutline(CX0, CY0, CX1, CY1, 0.0010f, new Color(a.r, a.g, a.b, 0.35f));
            Series(c.CpuSeries, HudTheme.Accent);
            Series(c.GpuSeries, HudTheme.Warn);
            Series(c.RamSeries, HudTheme.Bright);
            // çekirdek başına yük: 2 sütun x 8 satır yatay çubuk
            int n = Mathf.Min(16, c.Cores.Count);
            for (int i = 0; i < n; i++)
            {
                int col = i / 8, row = i % 8;
                float x0 = 0.15f + col * 0.075f, y = 0.0f - row * 0.0155f;
                M.Quad(x0, y - 0.0045f, x0 + 0.066f, y + 0.0045f, new Color(a.r, a.g, a.b, 0.12f));
                M.Quad(x0, y - 0.0045f, x0 + 0.066f * Mathf.Clamp01(c.Cores[i] / 100f), y + 0.0045f, new Color(a.r, a.g, a.b, 0.95f), 0.25f);
            }
        }
    }

    // ═══════════════════════ İŞLER ═══════════════════════
    public sealed class HudJobsPanel : HudPanelBase
    {
        public Action<string> OnOpen;
        private const int Rows = 6;
        private readonly HudText[] _t = new HudText[Rows], _m = new HudText[Rows], _st = new HudText[Rows];
        private readonly int[] _lastEl = new int[Rows];
        private HudText _empty;
        private float _recvAt;

        public HudJobsPanel() { Animated = true; }

        public void NoteReceived() { _recvAt = Time.unscaledTime; }

        protected override void BuildContent()
        {
            for (int i = 0; i < Rows; i++)
            {
                float y = 0.085f - i * 0.043f;
                _t[i] = Txt(-W / 2f + 0.018f, y, 0.0155f, HudRole.Bright);
                _m[i] = Txt(0.02f, y, 0.0105f, HudRole.Dim);
                _st[i] = Txt(W / 2f - 0.018f, y, 0.0125f, HudRole.Accent, TextAnchor.MiddleRight);
                int idx = i;
                AddButton(-W / 2f + 0.008f, y - 0.02f, W - 0.016f, 0.040f, () => { if (Snap != null && idx < Snap.Jobs.Count && Snap.Jobs[idx].Id.Length > 0) OnOpen?.Invoke("job:" + Snap.Jobs[idx].Id); });
                _lastEl[i] = -1;
            }
            _empty = Txt(0f, 0.0f, 0.0165f, HudRole.Dim, TextAnchor.MiddleCenter);
        }

        protected override void Draw(HudSnapshot s)
        {
            var jobs = s.Jobs;
            if (NewData)
            {
                int running = 0; foreach (var j in jobs) if (j.Status == "running") running++;
                SetChip(running > 0 ? running + " ÇALIŞIYOR" : jobs.Count > 0 ? jobs.Count + " SIRADA" : "BOŞ", running > 0 ? HudRole.Ok : HudRole.Accent);
                _empty.Set(jobs.Count == 0 ? "AKTİF İŞ YOK" : "");
                for (int i = 0; i < Rows; i++)
                {
                    bool has = i < jobs.Count;
                    SetButton(Buttons[i], has && jobs[i].Id.Length > 0);
                    _t[i].Set(has ? HudFmt.Cut(jobs[i].Title, 24) : "");
                    _m[i].Set(has ? HudFmt.Cut(HudFmt.Up(jobs[i].ModuleId), 10) : "");
                    if (!has) { _st[i].Set(""); _lastEl[i] = -1; }
                    else if (jobs[i].Status != "running") { _st[i].Set("SIRADA"); _st[i].SetRole(HudRole.Dim); _lastEl[i] = -1; }
                    else { _st[i].SetRole(HudRole.Accent); _lastEl[i] = -2; }   // geçen süre aşağıda
                }
            }
            for (int i = 0; i < Mathf.Min(Rows, jobs.Count); i++)
            {
                if (jobs[i].Status != "running" || jobs[i].StartedAt <= 0) { if (jobs[i].Status == "running" && _lastEl[i] != -3) { _st[i].Set("ÇALIŞIYOR"); _lastEl[i] = -3; } continue; }
                // geçen süre: PC saatiyle (snapshot.ts) hesaplanır, Quest saatine güvenilmez
                int el = Mathf.Max(0, Mathf.FloorToInt((s.Ts - jobs[i].StartedAt) / 1000f + (Time.unscaledTime - _recvAt)));
                if (el != _lastEl[i]) { _lastEl[i] = el; _st[i].Set((el / 60).ToString("00") + ":" + (el % 60).ToString("00")); }
            }
            var a = HudTheme.Accent;
            for (int i = 0; i < Mathf.Min(Rows, jobs.Count); i++)
                M.Line(-W / 2f + 0.014f, 0.085f - i * 0.043f - 0.0215f, W / 2f - 0.014f, 0.085f - i * 0.043f - 0.0215f, 0.0007f, new Color(a.r, a.g, a.b, 0.1f));
        }
    }

    // ═══════════════════════ BİLDİRİMLER ═══════════════════════
    public sealed class HudNoticesPanel : HudPanelBase
    {
        public Action<string> OnOpen;
        private const int Rows = 5;
        private readonly HudText[] _t = new HudText[Rows], _b = new HudText[Rows];

        protected override void BuildContent()
        {
            for (int i = 0; i < Rows; i++)
            {
                float y = 0.098f - i * 0.0575f;
                _t[i] = Txt(-W / 2f + 0.03f, y + 0.012f, 0.0155f, HudRole.Bright);
                _b[i] = Txt(-W / 2f + 0.03f, y - 0.014f, 0.0115f, HudRole.Dim);
                int idx = i;
                AddButton(-W / 2f + 0.008f, y - 0.027f, W - 0.016f, 0.054f, () => { if (Snap != null && idx < Snap.Notices.Count && Snap.Notices[idx].Ref.Length > 0) OnOpen?.Invoke(Snap.Notices[idx].Ref); });
            }
        }

        protected override void Draw(HudSnapshot s)
        {
            var n = s.Notices;
            if (NewData)
            {
                int pend = 0; foreach (var x in n) if (x.Pending) pend++;
                SetChip(pend > 0 ? pend + " BEKLİYOR" : n.Count + " BİLDİRİM", pend > 0 ? HudRole.Warn : HudRole.Accent);
                for (int i = 0; i < Rows; i++)
                {
                    bool has = i < n.Count;
                    SetButton(Buttons[i], has && n[i].Ref.Length > 0);
                    _t[i].Set(has ? HudFmt.Cut(n[i].Title, 34) : "");
                    _b[i].Set(has ? HudFmt.Cut(n[i].Body, 58) : "");
                }
            }
            var a = HudTheme.Accent;
            for (int i = 0; i < Mathf.Min(Rows, n.Count); i++)
            {
                float y = 0.098f - i * 0.0575f;
                var c = n[i].Pending ? HudTheme.Warn : a;
                M.Dot(-W / 2f + 0.017f, y + 0.012f, 0.008f, new Color(c.r, c.g, c.b, 1f), 0.3f);
                M.Line(-W / 2f + 0.014f, y - 0.0285f, W / 2f - 0.014f, y - 0.0285f, 0.0007f, new Color(a.r, a.g, a.b, 0.1f));
            }
        }
    }
}
