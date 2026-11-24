// İçerik kökünü (çekirdek + pano) uygulama açılınca BİR KEZ kullanıcının önüne, göz hizasının biraz altına koyar;
// sonra hiç hareket ettirmez → içerik dünyada sabit kalır, kullanıcı başını çevirince yerinde durur.
// Neden: OpenXR'de zemin kökeni "Stage" (oyun alanı merkezi) olur; kullanıcı merkezde durmuyorsa sabit dünya
// koordinatındaki içerik yanda/arkada kalabilir. Kafa pozu geçerli olunca bir kez yerleştirmek bunu çözer.
// Sistem "yeniden ortala" (recenter) yapılırsa içerik yeniden önüne alınır.

using UnityEngine;

namespace Fuber.App
{
    public sealed class FuberSpawnInFront : MonoBehaviour
    {
        [Tooltip("Kullanıcının önüne uzaklık (m).")]
        public float distance = 1.3f;

        [Tooltip("Göz hizasına göre yükseklik farkı (m, negatif = aşağı).")]
        public float heightOffset = -0.2f;

        [Tooltip("Kafa pozu bekleme süresi üst sınırı (sn); dolunca yine de yerleştirir.")]
        public float maxWait = 3f;

        private bool _placed;
        private float _t;
        private OVRDisplay _display;

        private void OnDisable()
        {
            if (_display != null) _display.RecenteredPose -= OnRecentered;
            _display = null;
        }

        private void OnRecentered() => _placed = false;

        private void LateUpdate()
        {
            // OVRManager.display, OVRManager başlatılınca oluşur; hazır olunca bir kez abone ol.
            if (_display == null && OVRManager.display != null)
            {
                _display = OVRManager.display;
                _display.RecenteredPose += OnRecentered;
            }
            if (_placed) return;
            var cam = Camera.main;
            if (cam == null) return;
            _t += Time.deltaTime;

            // Kafa pozu gelene kadar bekle (ilk karelerde kamera kökte, kimlik dönüşte durur).
            bool poseReady = cam.transform.localPosition.sqrMagnitude > 1e-6f || cam.transform.localRotation != Quaternion.identity;
            if (!poseReady && _t < maxWait) return;

            Vector3 fwd = cam.transform.forward;
            fwd.y = 0f;
            if (fwd.sqrMagnitude < 1e-4f) fwd = Vector3.forward;
            fwd.Normalize();

            Vector3 head = cam.transform.position;
            transform.position = new Vector3(head.x, head.y + heightOffset, head.z) + fwd * distance;
            transform.rotation = Quaternion.LookRotation(fwd, Vector3.up);
            _placed = true;
            Debug.Log($"[FuberSpawn] İçerik yerleştirildi: {transform.position} (bekleme {_t:0.00} sn)");
        }
    }
}
