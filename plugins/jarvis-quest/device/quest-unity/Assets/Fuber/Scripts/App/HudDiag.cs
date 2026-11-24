// Tanı günlüğü: el izleme zinciri nerede kopuyor? 1 sn'de bir, yığın izi olmadan (Log stack trace = None) tek satır.
// Kök neden bulunduktan sonra da düşük hızda (5 sn) kalır; kapatmak için PlayerPrefs "fuber.diag"=0.

using System;
using System.Text;
using UnityEngine;

namespace Fuber.App
{
    public sealed class HudDiag : MonoBehaviour
    {
        public FuberHandInteractor interactor;
        public float interval = 1f;
        private float _next;
        private int _n;

        private void Update()
        {
            if (Time.unscaledTime < _next) return;
            _n++;
            _next = Time.unscaledTime + (_n < 120 ? interval : 5f);
            var sb = new StringBuilder(512);
            int targets = FindObjectsByType<PinchTarget>(FindObjectsSortMode.None).Length;
            int cols = FindObjectsByType<Collider>(FindObjectsSortMode.None).Length;
            sb.Append("[FuberDiag] #").Append(_n).Append(" hedef=").Append(targets).Append(" collider=").Append(cols);
            try { sb.Append(" ovrHandTracking=").Append(OVRPlugin.GetHandTrackingEnabled()); } catch (System.Exception e) { sb.Append(" ovrHT=hata:").Append(e.Message); }
            sb.Append(" ovrMgr=").Append(OVRManager.instance != null);
            try
            {
                var subs = new System.Collections.Generic.List<UnityEngine.XR.Hands.XRHandSubsystem>();
                SubsystemManager.GetSubsystems(subs);
                sb.Append(" xrHands=").Append(subs.Count);
                foreach (var s in subs) sb.Append(s.running ? "(çalışıyor" : "(durmuş").Append(" L=").Append(s.leftHand.isTracked).Append(" R=").Append(s.rightHand.isTracked).Append(')');
            }
            catch (System.Exception e) { sb.Append(" xrHands=hata:").Append(e.Message); }
            try
            {
                var oxr = UnityEngine.XR.OpenXR.OpenXRSettings.Instance;
                if (oxr != null)
                {
                    sb.Append(" oxr=[");
                    foreach (var f in oxr.GetFeatures<UnityEngine.XR.OpenXR.Features.OpenXRFeature>()) if (f.enabled) sb.Append(f.GetType().Name).Append(',');
                    sb.Append(']');
                }
                else sb.Append(" oxr=NULL");
            }
            catch (System.Exception e) { sb.Append(" oxr=hata:").Append(e.Message); }
            sb.Append(Environment.NewLine + "  SOL ").Append(interactor != null ? interactor.DiagLine(0) : "etkileşim yok");
            sb.Append(Environment.NewLine + "  SAĞ ").Append(interactor != null ? interactor.DiagLine(1) : "etkileşim yok");
            Debug.Log(sb.ToString());
        }
    }
}
