// Avuç menüsü: sol avuç sana dönünce belirir. Palet seçimi, panel aç/kapa düğmeleri ve basılı tutmalı "ACİL DURDUR".
// Düğmeleri sağ elin çimdiği (yakın ya da ışın) ile kullanılır. Yerel durum (hangi panel açık) denetleyiciden okunur.

using System;
using Fuber.Net;
using UnityEngine;

namespace Fuber.App
{
    public sealed class HudMenuPanel : HudPanelBase
    {
        public Func<string, bool> IsOpen;
        public Action<string> OnToggle;
        public Action<string> OnPalette;
        public Action OnStop;
        public Func<string> CurrentPalette;
        public Func<string> CurrentMode;
        public Func<bool> Connected;
        public float StopHoldSeconds = 1.2f;

        public static readonly string[] ToggleIds = { "env", "cal", "bio", "fin", "links", "log" };
        private static readonly string[] ToggleLabels = { "ENV", "CAL", "BIO", "FIN", "BAĞ", "LOG" };
        private static readonly string[] PaletteLabels = { "OTO", "CYAN", "MAVİ", "KOR", "BUZ" };
        private static readonly Color[] PaletteColors =
        {
            new Color(0.7f, 0.9f, 0.95f), new Color(0.25f, 0.88f, 1f), new Color(0.4f, 0.6f, 1f), new Color(1f, 0.56f, 0.2f), new Color(0.82f, 0.94f, 1f),
        };

        private const float Cw = 0.056f, Pitch = 0.062f, TPitch = 0.075f, TCw = 0.068f;
        private HudButton _stop;
        private HudText _stopLabel, _stopHint;

        protected override bool DrawWhenOff => true;

        public HudMenuPanel() { Animated = true; Closable = false; BootDuration = 0.35f; }

        protected override void BuildContent()
        {
            PanelTarget.movable = false; PanelTarget.scalable = false; PanelTarget.throwable = false;
            var l1 = Txt(-W / 2f + 0.016f, 0.088f, 0.0105f, HudRole.Dim); l1.Set("PALET");
            var l2 = Txt(-W / 2f + 0.016f, 0.012f, 0.0105f, HudRole.Dim); l2.Set("PANELLER");
            for (int i = 0; i < 5; i++)
            {
                float cx = (i - 2f) * Pitch, cy = 0.05f;
                var t = Txt(cx, cy + 0.003f, 0.0125f, HudRole.Bright, TextAnchor.MiddleCenter); t.Set(PaletteLabels[i]);
                string pal = i == 0 ? HudActions.PaletteAuto : HudActions.Palettes[i - 1];
                AddButton(cx - Cw / 2f, cy - 0.018f, Cw, 0.036f, () => OnPalette?.Invoke(pal));
            }
            for (int i = 0; i < ToggleIds.Length; i++)
            {
                int row = i / 4, col = i % 4;
                int inRow = row == 0 ? Math.Min(4, ToggleIds.Length) : ToggleIds.Length - 4;
                float cx = (col - (inRow - 1) / 2f) * TPitch, cy = -0.025f - row * 0.042f;
                var t = Txt(cx, cy, 0.0125f, HudRole.Dim, TextAnchor.MiddleCenter); t.Set(ToggleLabels[i]);
                string id = ToggleIds[i];
                AddButton(cx - TCw / 2f, cy - 0.018f, TCw, 0.036f, () => OnToggle?.Invoke(id));
            }
            _stopLabel = Txt(0f, -0.128f, 0.0165f, HudRole.Alert, TextAnchor.MiddleCenter); _stopLabel.Set("ACİL DURDUR");
            _stopHint = Txt(0f, -0.1475f, 0.0085f, HudRole.Dim, TextAnchor.MiddleCenter); _stopHint.Set("BASILI TUT");
            _stop = AddButton(-0.125f, -0.155f, 0.25f, 0.05f, () => OnStop?.Invoke(), StopHoldSeconds);
        }

        protected override void Draw(HudSnapshot s)
        {
            bool conn = Connected != null && Connected();
            SetChip(conn ? "BAĞLI" : "BAĞLI DEĞİL", conn ? HudRole.Ok : HudRole.Warn);
            string cur = CurrentPalette != null ? CurrentPalette() : "cyan";
            bool auto = CurrentMode != null && CurrentMode() == "auto";
            for (int i = 0; i < 5; i++)
            {
                float cx = (i - 2f) * Pitch, cy = 0.05f;
                var c = PaletteColors[i];
                bool sel = auto ? i == 0 : (i > 0 && HudActions.Palettes[i - 1] == cur);
                M.Quad(cx - Cw / 2f, cy - 0.018f, cx + Cw / 2f, cy + 0.018f, new Color(c.r, c.g, c.b, sel ? 0.22f : 0.07f), 1f);
                M.Quad(cx - Cw / 2f, cy - 0.018f, cx + Cw / 2f, cy - 0.014f, new Color(c.r, c.g, c.b, 1f), sel ? 0.6f : 0.1f);
                if (sel) M.RectOutline(cx - Cw / 2f, cy - 0.018f, cx + Cw / 2f, cy + 0.018f, 0.0012f, new Color(c.r, c.g, c.b, 0.9f));
            }
            for (int i = 0; i < ToggleIds.Length; i++)
            {
                int row = i / 4, col = i % 4;
                int inRow = row == 0 ? Math.Min(4, ToggleIds.Length) : ToggleIds.Length - 4;
                float cx = (col - (inRow - 1) / 2f) * TPitch, cy = -0.025f - row * 0.042f;
                bool open = IsOpen != null && IsOpen(ToggleIds[i]);
                var a = HudTheme.Accent;
                M.Quad(cx - TCw / 2f, cy - 0.018f, cx + TCw / 2f, cy + 0.018f, new Color(a.r, a.g, a.b, open ? 0.2f : 0.05f), 1f);
                M.RectOutline(cx - TCw / 2f, cy - 0.018f, cx + TCw / 2f, cy + 0.018f, 0.001f, new Color(a.r, a.g, a.b, open ? 0.9f : 0.3f));
                ContentTexts[2 + 5 + i].SetRole(open ? HudRole.Bright : HudRole.Dim);
            }
            var al = HudTheme.Alert;
            float hp = _stop != null ? _stop.Target.HoldProgress : 0f;
            M.Quad(-0.125f, -0.155f, 0.125f, -0.105f, new Color(al.r, al.g, al.b, 0.1f), 1f);
            if (hp > 0f) M.Quad(-0.125f, -0.155f, -0.125f + 0.25f * hp, -0.105f, new Color(al.r, al.g, al.b, 0.55f), 1f);
            M.RectOutline(-0.125f, -0.155f, 0.125f, -0.105f, 0.0014f, new Color(al.r, al.g, al.b, 0.95f));
            // sol-alt ve sağ-üst uyarı çentikleri
            M.Line(-0.125f, -0.105f, -0.105f, -0.105f, 0.004f, new Color(al.r, al.g, al.b, 1f), 0.5f);
            M.Line(0.125f, -0.155f, 0.105f, -0.155f, 0.004f, new Color(al.r, al.g, al.b, 1f), 0.5f);
        }
    }
}
