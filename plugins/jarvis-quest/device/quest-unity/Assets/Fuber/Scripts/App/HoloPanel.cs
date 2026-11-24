// Holografik pano. Konumu DÜNYADA sabittir (kameraya bağlı değildir); yalnız yönü kullanıcıya döner (billboard,
// yatay eksende). Çimdikle tutulup taşınabilir (PinchTarget + FuberHandInteractor). Üstüne gelinince ve
// dokunulunca parlar. İçeriği (sohbet, Bugün kartları, onay) sonraki turlarda köprüden gelecek.

using UnityEngine;

namespace Fuber.App
{
    public sealed class HoloPanel : MonoBehaviour
    {
        [Tooltip("Panonun baktığı dönüşüm; boşsa ana kamera.")]
        public Transform lookTarget;

        [Tooltip("Dönüşü yalnız yatay eksende tut (pano dik kalsın).")]
        public bool yawOnly = true;

        [Tooltip("Kullanıcıya dönme yumuşaklığı (büyük = hızlı).")]
        public float turnSharpness = 6f;

        private HoloTint _tint;
        private float _highlight;
        private float _flash;

        private void Start()
        {
            _tint = new HoloTint(gameObject);
            FaceTarget(1f);
        }

        private void Update()
        {
            FaceTarget(1f - Mathf.Exp(-turnSharpness * Time.deltaTime));
            _flash = Mathf.MoveTowards(_flash, 0f, Time.deltaTime * 2f);
            if (_tint != null) _tint.Apply(_highlight * 0.7f + _flash, _highlight * 0.15f + _flash * 0.2f);
        }

        private void FaceTarget(float t)
        {
            Transform target = lookTarget;
            if (target == null && Camera.main != null) target = Camera.main.transform;
            if (target == null) return;

            Vector3 dir = transform.position - target.position;
            if (yawOnly) dir.y = 0f;
            if (dir.sqrMagnitude < 1e-5f) return;
            var goal = Quaternion.LookRotation(dir.normalized, Vector3.up);
            transform.rotation = Quaternion.Slerp(transform.rotation, goal, t);
        }

        public void SetHighlight(float level) => _highlight = level;

        public void Poke() => _flash = 1f;
    }
}
