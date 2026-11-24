// HUD çizim kiti: tema (palet), vertex-renkli mesh oluşturucu ve metin sarmalayıcı.
// Tüm çizgi/yüzey geometrisi TEK malzeme (Fuber/Hud) ile çizilir; kareler arası GC üretmemek için listeler yeniden kullanılır.

using System.Collections.Generic;
using Fuber.Net;
using UnityEngine;

namespace Fuber.App
{
    public enum HudRole { Accent, Bright, Dim, Warn, Alert, Ok }

    public static class HudTheme
    {
        public static string Name { get; private set; } = "cyan";
        public static Color Accent = new Color(0.25f, 0.88f, 1f);
        public static Color Bright = new Color(0.8f, 0.97f, 1f);
        public static Color Dim = new Color(0.36f, 0.62f, 0.72f);
        public static Color Warn = new Color(1f, 0.72f, 0.2f);
        public static Color Alert = new Color(1f, 0.36f, 0.3f);
        public static Color Bg = new Color(0.015f, 0.06f, 0.09f, 0.78f);
        /// <summary>Renk her değiştiğinde artar; paneller/halkalar buna bakıp geometrisini yeniden boyar.</summary>
        public static int Version { get; private set; }
        public static bool Transitioning => _t < 1f;
        public const float TransitionSeconds = 1.5f;

        private static Color _from, _to;
        private static float _t = 1f, _sinceBump;
        private const float BumpInterval = 1f / 15f;   // geçişte en çok 15 Hz yeniden boya (maliyet)

        /// <summary>Palet: cyan | blue | ember | ice (tanınmayan → cyan). İlk çağrı anlık, sonrakiler ~1.5 sn yumuşak geçişle. Hedef değiştiyse true.</summary>
        public static bool Set(string name, bool instant = false)
        {
            name = HudPalette.Normalize(name);
            if (Version == 0 || instant)
            {
                Name = name; _to = _from = HudPalette.Accent(name); _t = 1f;
                Derive(_to);
                return true;
            }
            if (name == Name) return false;
            _from = Accent; _to = HudPalette.Accent(name); _t = 0f; _sinceBump = 0f;
            Name = name;
            return true;
        }

        /// <summary>Her karede çağrılır (HudController.Update): geçişi ilerletir.</summary>
        public static void Tick(float dt)
        {
            if (_t >= 1f) return;
            _t = Mathf.Min(1f, _t + dt / TransitionSeconds);
            _sinceBump += dt;
            if (_t >= 1f || _sinceBump >= BumpInterval)
            {
                _sinceBump = 0f;
                Derive(HudPalette.Blend(_from, _to, _t));
            }
        }

        private static void Derive(Color a)
        {
            Accent = a;
            Bright = Color.Lerp(a, Color.white, 0.65f);
            Dim = Color.Lerp(a, new Color(0.2f, 0.3f, 0.35f), 0.5f);
            Bg = new Color(Mathf.Lerp(0.015f, a.r * 0.1f, 0.5f), Mathf.Lerp(0.05f, a.g * 0.1f, 0.5f), Mathf.Lerp(0.08f, a.b * 0.1f, 0.5f), 0.78f);
            Version++;
        }

        public static Color Role(HudRole r)
        {
            switch (r)
            {
                case HudRole.Bright: return Bright;
                case HudRole.Dim: return Dim;
                case HudRole.Warn: return Warn;
                case HudRole.Alert: return Alert;
                case HudRole.Ok: return Accent;
                default: return Accent;
            }
        }

        public static Color Level(int level) => level >= 3 ? Alert : level == 2 ? Warn : Accent;
    }

    /// <summary>Vertex renkli düzlemsel mesh (panel-yerel metre). Statik kısım + her yenilemede yeniden yazılan dinamik kısım.</summary>
    public sealed class HudMesh
    {
        private readonly List<Vector3> _v = new List<Vector3>(512);
        private readonly List<Color> _c = new List<Color>(512);
        private readonly List<Vector4> _uv = new List<Vector4>(512);
        private readonly List<int> _t = new List<int>(1024);
        private int _mv, _mt;

        /// <summary>uv normalizasyonu için panel boyutu (0 ise uv=(0.5,1): hep görünür).</summary>
        public float W, H;
        public float Z;
        public int VertexCount => _v.Count;

        public void Clear() { _v.Clear(); _c.Clear(); _uv.Clear(); _t.Clear(); _mv = _mt = 0; }
        public void MarkStatic() { _mv = _v.Count; _mt = _t.Count; }
        public void ResetToStatic()
        {
            if (_v.Count > _mv) { _v.RemoveRange(_mv, _v.Count - _mv); _c.RemoveRange(_mv, _c.Count - _mv); _uv.RemoveRange(_mv, _uv.Count - _mv); }
            if (_t.Count > _mt) _t.RemoveRange(_mt, _t.Count - _mt);
        }

        private int Vtx(float x, float y, Color c, float add, float shim)
        {
            float u = W > 0f ? x / W + 0.5f : 0.5f;
            float vv = H > 0f ? y / H + 0.5f : 1f;
            _v.Add(new Vector3(x, y, Z));
            _c.Add(c.linear);
            _uv.Add(new Vector4(u, vv, add, shim));
            return _v.Count - 1;
        }

        private void Tri(int a, int b, int c) { _t.Add(a); _t.Add(b); _t.Add(c); }

        public void Quad(float x0, float y0, float x1, float y1, Color c, float add = 0f, float shim = 0f)
            => QuadV(x0, y0, x1, y1, c, c, add, shim);

        /// <summary>Dikey gradyanlı dikdörtgen (alt/üst renk).</summary>
        public void QuadV(float x0, float y0, float x1, float y1, Color bottom, Color top, float add = 0f, float shim = 0f)
        {
            int a = Vtx(x0, y0, bottom, add, shim), b = Vtx(x1, y0, bottom, add, shim), c = Vtx(x1, y1, top, add, shim), d = Vtx(x0, y1, top, add, shim);
            Tri(a, b, c); Tri(a, c, d);
        }

        public void Line(Vector2 p, Vector2 q, float w, Color c, float add = 0f)
        {
            Vector2 d = q - p;
            float len = d.magnitude;
            if (len < 1e-6f) return;
            Vector2 n = new Vector2(-d.y, d.x) / len * (w * 0.5f);
            int a = Vtx(p.x + n.x, p.y + n.y, c, add, 0), b = Vtx(q.x + n.x, q.y + n.y, c, add, 0);
            int cc = Vtx(q.x - n.x, q.y - n.y, c, add, 0), dd = Vtx(p.x - n.x, p.y - n.y, c, add, 0);
            Tri(a, b, cc); Tri(a, cc, dd);
        }

        public void Line(float x0, float y0, float x1, float y1, float w, Color c, float add = 0f)
            => Line(new Vector2(x0, y0), new Vector2(x1, y1), w, c, add);

        /// <summary>Düz dikdörtgen çerçeve (içe doğru değil, çizgi ortalı).</summary>
        public void RectOutline(float x0, float y0, float x1, float y1, float w, Color c)
        {
            Line(x0, y0, x1, y0, w, c); Line(x1, y0, x1, y1, w, c); Line(x1, y1, x0, y1, w, c); Line(x0, y1, x0, y0, w, c);
        }

        private static void CutPoints(float x0, float y0, float x1, float y1, float cut, Vector2[] p)
        {
            p[0] = new Vector2(x0, y0);
            p[1] = new Vector2(x1 - cut, y0);
            p[2] = new Vector2(x1, y0 + cut);
            p[3] = new Vector2(x1, y1);
            p[4] = new Vector2(x0 + cut, y1);
            p[5] = new Vector2(x0, y1 - cut);
        }

        private static readonly Vector2[] _pts = new Vector2[6];

        /// <summary>Köşesi kesik (sol-üst ve sağ-alt) dolu panel zemini; üstten alta gradyan.</summary>
        public void CutFill(float x0, float y0, float x1, float y1, float cut, Color top, Color bottom)
        {
            CutPoints(x0, y0, x1, y1, cut, _pts);
            float cx = (x0 + x1) * 0.5f, cy = (y0 + y1) * 0.5f;
            Color mid = Color.Lerp(top, bottom, 0.5f);
            int center = Vtx(cx, cy, mid, 0, 0);
            int[] idx = new int[6];
            for (int i = 0; i < 6; i++) idx[i] = Vtx(_pts[i].x, _pts[i].y, _pts[i].y > cy ? top : bottom, 0, 0);
            for (int i = 0; i < 6; i++) Tri(center, idx[i], idx[(i + 1) % 6]);
        }

        public void CutOutline(float x0, float y0, float x1, float y1, float cut, float w, Color c)
        {
            CutPoints(x0, y0, x1, y1, cut, _pts);
            for (int i = 0; i < 6; i++) Line(_pts[i], _pts[(i + 1) % 6], w, c);
        }

        /// <summary>Halka dilimi: yarıçap r0..r1, açı a0..a1 (derece, 0 = sağ, saat yönü tersi).</summary>
        public void Arc(float cx, float cy, float r0, float r1, float a0, float a1, int segs, Color c, float add = 0f)
        {
            if (segs < 1) segs = 1;
            int prevO = -1, prevI = -1;
            for (int i = 0; i <= segs; i++)
            {
                float a = Mathf.Lerp(a0, a1, i / (float)segs) * Mathf.Deg2Rad;
                float cs = Mathf.Cos(a), sn = Mathf.Sin(a);
                int o = Vtx(cx + cs * r1, cy + sn * r1, c, add, 0), ii = Vtx(cx + cs * r0, cy + sn * r0, c, add, 0);
                if (prevO >= 0) { Tri(prevI, prevO, o); Tri(prevI, o, ii); }
                prevO = o; prevI = ii;
            }
        }

        /// <summary>Merkezden kenara solan yuvarlak parıltı (toplamalı).</summary>
        public void Glow(float cx, float cy, float r, int segs, Color inner, Color outer, float add = 1f)
        {
            int center = Vtx(cx, cy, inner, add, 0);
            int first = -1, prev = -1;
            for (int i = 0; i < segs; i++)
            {
                float a = i / (float)segs * Mathf.PI * 2f;
                int v = Vtx(cx + Mathf.Cos(a) * r, cy + Mathf.Sin(a) * r, outer, add, 0);
                if (first < 0) first = v; else Tri(center, prev, v);
                prev = v;
            }
            Tri(center, prev, first);
        }

        /// <summary>Çok noktalı çizgi.</summary>
        public void Polyline(IList<Vector2> pts, float w, Color c, float add = 0f)
        {
            for (int i = 1; i < pts.Count; i++) Line(pts[i - 1], pts[i], w, c, add);
        }

        /// <summary>Eğri altı dolgu (tabana kadar) — üst renk eğride, alt renk tabanda.</summary>
        public void FillUnder(IList<Vector2> pts, float baseY, Color topC, Color bottomC)
        {
            for (int i = 1; i < pts.Count; i++)
            {
                int a = Vtx(pts[i - 1].x, pts[i - 1].y, topC, 0, 0), b = Vtx(pts[i].x, pts[i].y, topC, 0, 0);
                int c = Vtx(pts[i].x, baseY, bottomC, 0, 0), d = Vtx(pts[i - 1].x, baseY, bottomC, 0, 0);
                Tri(a, b, c); Tri(a, c, d);
            }
        }

        /// <summary>Küçük dolu kare (düğüm/nokta).</summary>
        public void Dot(float x, float y, float size, Color c, float add = 0f)
            => Quad(x - size * 0.5f, y - size * 0.5f, x + size * 0.5f, y + size * 0.5f, c, add);

        private int Vtx3(Vector3 p, Color c, float add)
        {
            _v.Add(p); _c.Add(c.linear); _uv.Add(new Vector4(0.5f, 1f, add, 0f));
            return _v.Count - 1;
        }

        /// <summary>3B uzayda kameraya dönük kalın çizgi (bağlantı çizgileri).</summary>
        public void Line3(Vector3 a, Vector3 b, Vector3 cam, float w, Color c, float add = 0f)
        {
            Vector3 d = b - a;
            Vector3 n = Vector3.Cross(d, cam - (a + b) * 0.5f);
            if (n.sqrMagnitude < 1e-12f) return;
            n = n.normalized * (w * 0.5f);
            int i0 = Vtx3(a + n, c, add), i1 = Vtx3(b + n, c, add), i2 = Vtx3(b - n, c, add), i3 = Vtx3(a - n, c, add);
            Tri(i0, i1, i2); Tri(i0, i2, i3);
        }

        public void Dot3(Vector3 center, Vector3 right, Vector3 up, float size, Color c, float add = 0f)
        {
            Vector3 r = right.normalized * (size * 0.5f), u = up.normalized * (size * 0.5f);
            int i0 = Vtx3(center - r - u, c, add), i1 = Vtx3(center + r - u, c, add), i2 = Vtx3(center + r + u, c, add), i3 = Vtx3(center - r + u, c, add);
            Tri(i0, i1, i2); Tri(i0, i2, i3);
        }

        public void Apply(Mesh mesh)
        {
            mesh.Clear();
            mesh.SetVertices(_v);
            mesh.SetColors(_c);
            mesh.SetUVs(0, _uv);
            mesh.SetTriangles(_t, 0, false);
            mesh.bounds = W > 0f ? new Bounds(Vector3.zero, new Vector3(W + 0.2f, H + 0.2f, 0.2f)) : new Bounds(Vector3.zero, new Vector3(8f, 8f, 8f));
        }
    }

    /// <summary>TextMesh sarmalayıcı: tema rolüne göre renk, değişmeyen metni yeniden yazmaz, açılış "akma" efekti.</summary>
    public sealed class HudText
    {
        public const int FontPx = 64;
        /// <summary>Quest 3 okunaklılığı: tüm yazılar bu çarpanla büyür, en küçük boy MinSize (em, metre).</summary>
        public const float SizeScale = 1.12f, MinSize = 0.0128f;
        public readonly TextMesh Tm;
        public readonly MeshRenderer Mr;
        public readonly Transform Tf;
        public HudRole Role;
        public float BaseAlpha = 1f;

        private string _full = "";
        private float _reveal = 1f, _alpha = 1f;
        private Color _applied = new Color(-1, -1, -1, -1);
        private int _themeVersion = -1;

        public static HudText Create(Transform parent, Font font, string name, float x, float y, float size, HudRole role,
                                     TextAnchor anchor = TextAnchor.MiddleLeft, float z = -0.004f)
        {
            size = Mathf.Max(size * SizeScale, MinSize);
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = new Vector3(x, y, z);
            var tm = go.AddComponent<TextMesh>();
            tm.font = font;
            tm.fontSize = FontPx;
            tm.characterSize = size / (FontPx * 0.1f);
            tm.anchor = anchor;
            tm.alignment = anchor == TextAnchor.MiddleRight || anchor == TextAnchor.UpperRight || anchor == TextAnchor.LowerRight ? TextAlignment.Right
                         : anchor == TextAnchor.MiddleCenter || anchor == TextAnchor.UpperCenter || anchor == TextAnchor.LowerCenter ? TextAlignment.Center : TextAlignment.Left;
            tm.richText = false;
            var mr = go.GetComponent<MeshRenderer>();
            mr.sharedMaterial = font.material;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
            mr.sortingOrder = 10;
            var t = new HudText(tm, mr, role);
            t.Recolor();
            return t;
        }

        private HudText(TextMesh tm, MeshRenderer mr, HudRole role) { Tm = tm; Mr = mr; Tf = tm.transform; Role = role; }

        public string Text => _full;

        public void Set(string s)
        {
            s = s ?? "";
            if (s == _full) return;
            _full = s;
            Show();
        }

        public void SetRole(HudRole r) { if (r == Role) return; Role = r; Recolor(true); }

        /// <summary>0..1: metnin ne kadarı görünür (açılışta akma).</summary>
        public void Reveal(float f)
        {
            f = Mathf.Clamp01(f);
            if (Mathf.Approximately(f, _reveal)) return;
            _reveal = f;
            Show();
        }

        public void Alpha(float a)
        {
            if (Mathf.Abs(a - _alpha) < 0.004f) return;
            _alpha = a;
            Recolor();
        }

        public void SetVisible(bool v) { if (Mr.enabled != v) Mr.enabled = v; }

        private void Show()
        {
            string shown = _reveal >= 1f || _full.Length == 0 ? _full : _full.Substring(0, Mathf.Min(_full.Length, Mathf.CeilToInt(_full.Length * _reveal)));
            if (shown != Tm.text) Tm.text = shown;
        }

        public void Recolor(bool force = false)
        {
            if (!force && _themeVersion == HudTheme.Version && _applied.a >= 0f) { ApplyColor(); return; }
            _themeVersion = HudTheme.Version;
            ApplyColor();
        }

        private void ApplyColor()
        {
            Color c = HudTheme.Role(Role);
            c.a = Mathf.Clamp01(BaseAlpha * _alpha);
            if (c != _applied) { _applied = c; Tm.color = c; }
        }

        /// <summary>Tema değiştiyse rengi yeniden uygula (her yenilemede çağrılabilir, ucuz).</summary>
        public void SyncTheme() { if (_themeVersion != HudTheme.Version) Recolor(true); }
    }
}
