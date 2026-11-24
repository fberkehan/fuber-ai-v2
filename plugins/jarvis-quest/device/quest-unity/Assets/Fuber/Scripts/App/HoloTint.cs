// Renk değiştirmek için ortak yardımcı: URP Unlit `_BaseColor` değerini MaterialPropertyBlock ile yazar (malzemeyi
// kopyalamaz). Her renderer'ın başlangıç rengi saklanır; çarpan ve ek parlaklık buna göre uygulanır.

using System.Collections.Generic;
using UnityEngine;

namespace Fuber.App
{
    public sealed class HoloTint
    {
        private static readonly int BaseColor = Shader.PropertyToID("_BaseColor");

        private readonly List<Renderer> _renderers = new List<Renderer>();
        private readonly List<Color> _base = new List<Color>();
        private readonly MaterialPropertyBlock _mpb = new MaterialPropertyBlock();

        public HoloTint(GameObject root, bool includeChildren = true)
        {
            var found = includeChildren ? root.GetComponentsInChildren<Renderer>(true) : root.GetComponents<Renderer>();
            var owner = root.GetComponentInParent<PinchTarget>();
            foreach (var r in found)
            {
                // Başka bir çimdik hedefine ait parça (ör. pano içindeki tuş) o hedefin kendi rengidir; boyama.
                if (owner != null && r.GetComponentInParent<PinchTarget>() != owner) continue;
                // Yazı (TextMesh) malzemesini boyama; yalnız _BaseColor taşıyan malzemeler.
                if (r.sharedMaterial == null || !r.sharedMaterial.HasProperty(BaseColor)) continue;
                _renderers.Add(r);
                _base.Add(r.sharedMaterial.GetColor(BaseColor));
            }
        }

        /// <summary>Başlangıç rengini `boost` (0..1+) kadar beyaza/parlak tona kaydırır, alfa `alphaBoost` kadar artar.</summary>
        public void Apply(float boost, float alphaBoost = 0f, Color? overrideHue = null)
        {
            for (int i = 0; i < _renderers.Count; i++)
            {
                var r = _renderers[i];
                if (r == null) continue;
                Color c = _base[i];
                if (overrideHue.HasValue) c = new Color(overrideHue.Value.r, overrideHue.Value.g, overrideHue.Value.b, c.a);
                Color lit = Color.Lerp(c, Color.white, Mathf.Clamp01(boost * 0.6f));
                lit.a = Mathf.Clamp01(c.a + alphaBoost);
                r.GetPropertyBlock(_mpb);
                _mpb.SetColor(BaseColor, lit);
                r.SetPropertyBlock(_mpb);
            }
        }
    }
}
