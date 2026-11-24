// Android'de UDP yayınlarını (keşif, 47853) almak için Wi-Fi çok noktaya yayın kilidi. Bazı cihazlar kilit yokken
// yayın paketlerini güç tasarrufu için düşürür. İzin (CHANGE_WIFI_MULTICAST_STATE) derlemede manifeste eklenir
// (Editor/FuberAndroidManifest). Kilit alınamazsa yalnız uyarı yazılır; keşif yine denenir.

using UnityEngine;

namespace Fuber.App
{
    public static class FuberAndroidNet
    {
#if UNITY_ANDROID && !UNITY_EDITOR
        private static AndroidJavaObject _lock;
#endif

        public static void AcquireMulticastLock()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            if (_lock != null) return;
            try
            {
                AndroidJavaObject activity;
                using (var player = new AndroidJavaClass("com.unity3d.player.UnityPlayer"))
                    activity = player.GetStatic<AndroidJavaObject>("currentActivity");
                using (var context = activity.Call<AndroidJavaObject>("getApplicationContext"))
                using (var wifi = context.Call<AndroidJavaObject>("getSystemService", "wifi"))
                {
                    _lock = wifi.Call<AndroidJavaObject>("createMulticastLock", "fuberxr");
                    _lock.Call("setReferenceCounted", false);
                    _lock.Call("acquire");
                }
                Debug.Log("[FuberXR] Wi-Fi yayın kilidi alındı.");
            }
            catch (System.Exception e)
            {
                _lock = null;
                Debug.LogWarning("[FuberXR] Wi-Fi yayın kilidi alınamadı: " + e.Message);
            }
#endif
        }

        public static void ReleaseMulticastLock()
        {
#if UNITY_ANDROID && !UNITY_EDITOR
            try { _lock?.Call("release"); } catch { }
            _lock = null;
#endif
        }
    }
}
