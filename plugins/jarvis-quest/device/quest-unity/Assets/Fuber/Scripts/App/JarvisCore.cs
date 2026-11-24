// Fuber çekirdeği — yavaşça döner, nefes alır gibi ölçeklenir. Çimdikle dokunulunca (Poke) renk değiştirip nabız
// atar; el üstüne gelince (SetHighlight) parlar. Ses düzeyi (SetAudioLevel) nabız genliğini büyütür.
// Marka: FUBER AI (Marvel/Iron Man/Jarvis markası görselde ya da isimde kullanılmaz).

using UnityEngine;

namespace Fuber.App
{
    public sealed class JarvisCore : MonoBehaviour
    {
        [Tooltip("Saniyedeki derece cinsinden dönüş hızı.")]
        public float spinDegPerSec = 20f;

        [Tooltip("Nefes (nabız) genliği.")]
        public float pulseAmplitude = 0.06f;

        [Tooltip("Nefes hızı (Hz).")]
        public float pulseHz = 0.4f;

        [Tooltip("Çimdikle dokununca sırayla geçilen renkler.")]
        public Color[] pokeColors =
        {
            new Color(0.25f, 0.85f, 1f),
            new Color(1f, 0.55f, 0.15f),
            new Color(0.55f, 1f, 0.45f),
            new Color(0.85f, 0.4f, 1f),
        };

        private Vector3 _baseScale;
        private HoloTint _tint;
        private float _highlight;
        private float _burst;       // dokunma sonrası sönen nabız (0..1)
        private int _colorIndex;
        private float _spinBoost;

        private void Awake()
        {
            _baseScale = transform.localScale;
        }

        private void Start()
        {
            _tint = new HoloTint(gameObject);
            ApplyTint();
        }

        private void Update()
        {
            _burst = Mathf.MoveTowards(_burst, 0f, Time.deltaTime * 1.6f);
            _spinBoost = Mathf.MoveTowards(_spinBoost, 0f, Time.deltaTime * 240f);

            transform.Rotate(Vector3.up, (spinDegPerSec + _spinBoost) * Time.deltaTime, Space.Self);
            float s = 1f + pulseAmplitude * Mathf.Sin(Time.time * pulseHz * 2f * Mathf.PI) + 0.35f * _burst * _burst;
            transform.localScale = _baseScale * s;
            ApplyTint();
        }

        /// <summary>Çimdikle dokunma: renk değiştir, nabız patlaması, hızlı dönüş.</summary>
        public void Poke()
        {
            _colorIndex = (_colorIndex + 1) % Mathf.Max(1, pokeColors.Length);
            _burst = 1f;
            _spinBoost = 360f;
        }

        /// <summary>0 = normal, 0.6 = üstüne gelindi, 1 = tutuluyor.</summary>
        public void SetHighlight(float level)
        {
            _highlight = level;
        }

        /// <summary>Ses düzeyine (0..1) göre çekirdeği canlandır (BridgeDriver `level` iletisinden çağırır).</summary>
        public void SetAudioLevel(float level)
        {
            pulseAmplitude = Mathf.Lerp(0.04f, 0.22f, Mathf.Clamp01(level));
        }

        private void ApplyTint()
        {
            if (_tint == null) return;
            Color hue = pokeColors.Length > 0 ? pokeColors[_colorIndex % pokeColors.Length] : Color.cyan;
            _tint.Apply(_highlight * 0.5f + _burst, _burst * 0.3f, hue);
        }
    }
}
