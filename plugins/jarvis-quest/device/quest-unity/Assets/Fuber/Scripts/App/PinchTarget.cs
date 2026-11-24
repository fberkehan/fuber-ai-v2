// Çimdikle etkileşilebilen nesne. FuberHandInteractor üzerine gelme (hover), çimdik başlangıcı (press), basılı tutma
// (hold), tutma/bırakma ve fırlatma olaylarını buraya iletir; nesne kendi tepkisini aynı GameObject'teki bileşenlerle
// (JarvisCore, HoloPanel ya da IPinchReactor) verir. `movable` açıksa el çimdik tutarken nesneyi taşır.

using UnityEngine;

namespace Fuber.App
{
    /// <summary>HUD panelleri/düğmeleri: parlama seviyesi ve basma olayını alır.</summary>
    public interface IPinchReactor
    {
        /// <summary>0 = normal, 0.6 = üstüne gelindi, 1 = tutuluyor/basılı.</summary>
        void OnHighlight(float level);
        void OnPress();
    }

    public sealed class PinchTarget : MonoBehaviour
    {
        [Tooltip("Çimdikle tutup taşınabilir mi?")]
        public bool movable = true;

        [Tooltip("İki elle tutulunca büyütülüp küçültülebilir mi?")]
        public bool scalable;

        [Tooltip("Hızlı fırlatılınca onThrown çağrılır mı? (panel kapatma)")]
        public bool throwable;

        [Tooltip(">0 ise basma, bu kadar saniye basılı tutulunca onHoldComplete olur (yanlışlıkla basılmasın).")]
        public float holdSeconds;

        /// <summary>Çimdik başlangıcında çağrılır (hold gerektirmeyenlerde).</summary>
        public System.Action onPress;
        public System.Action onHoldComplete;
        public System.Action<bool> onHover;
        public System.Action<Vector3> onThrown;
        public System.Action<bool> onGrab;

        public bool IsHovered => _hoverCount > 0;
        public bool IsHeld { get; private set; }
        public float HoldProgress { get; private set; }
        public bool IsHolding => _holding;

        private int _hoverCount;
        private JarvisCore _core;
        private HoloPanel _panel;
        private IPinchReactor _reactor;
        private HoloTint _ownTint;   // çekirdek/pano olmayan hedefler (tuşlar) kendileri parlar
        private float _flash;
        private bool _holding, _holdDone;
        private float _holdT;

        private void Awake()
        {
            _core = GetComponent<JarvisCore>();
            _panel = GetComponent<HoloPanel>();
            _reactor = GetComponent<IPinchReactor>();
        }

        private void Start()
        {
            if (_core == null && _panel == null && _reactor == null) _ownTint = new HoloTint(gameObject);
        }

        private void Update()
        {
            if (_ownTint == null || _flash <= 0f) return;
            _flash = Mathf.MoveTowards(_flash, 0f, Time.deltaTime * 4f);
            Refresh();
        }

        public void HoverEnter()
        {
            _hoverCount++;
            if (_hoverCount == 1) onHover?.Invoke(true);
            Refresh();
        }

        public void HoverExit()
        {
            bool was = _hoverCount > 0;
            _hoverCount = Mathf.Max(0, _hoverCount - 1);
            if (was && _hoverCount == 0) onHover?.Invoke(false);
            Refresh();
        }

        /// <summary>Basılı tutma gerektirmeyen hedefler için doğrudan basma.</summary>
        public void Press()
        {
            Debug.Log("[FuberHand] BASILDI → " + name);
            if (_core != null) _core.Poke();
            if (_panel != null) _panel.Poke();
            _reactor?.OnPress();
            _flash = 1f;
            Refresh();
            onPress?.Invoke();
        }

        public void BeginHold()
        {
            _holding = true; _holdDone = false; _holdT = 0f; HoldProgress = 0f;
            Refresh();
        }

        /// <summary>Basılı tutma ilerlemesi; tamamlanınca onHoldComplete bir kez çağrılır.</summary>
        public void TickHold(float dt)
        {
            if (!_holding || _holdDone || holdSeconds <= 0f) return;
            _holdT += dt;
            HoldProgress = Mathf.Clamp01(_holdT / holdSeconds);
            if (_holdT >= holdSeconds)
            {
                _holdDone = true;
                Debug.Log("[FuberHand] BASILI TUTMA tamam → " + name);
                _flash = 1f;
                _reactor?.OnPress();
                onHoldComplete?.Invoke();
            }
        }

        public void CancelHold()
        {
            if (!_holding) return;
            _holding = false; _holdT = 0f; HoldProgress = 0f;
            Refresh();
        }

        public void Grab()
        {
            IsHeld = true;
            Debug.Log("[FuberHand] TUTULDU → " + name);
            onGrab?.Invoke(true);
            Refresh();
        }

        public void Release()
        {
            IsHeld = false;
            onGrab?.Invoke(false);
            Refresh();
        }

        public void Thrown(Vector3 velocity) => onThrown?.Invoke(velocity);

        private void Refresh()
        {
            float level = IsHeld || _holding ? 1f : IsHovered ? 0.6f : 0f;
            if (_core != null) _core.SetHighlight(level);
            if (_panel != null) _panel.SetHighlight(level);
            _reactor?.OnHighlight(level);
            if (_ownTint != null) _ownTint.Apply(Mathf.Max(level, _flash) * 0.9f, Mathf.Max(level, _flash) * 0.35f);
        }
    }
}
