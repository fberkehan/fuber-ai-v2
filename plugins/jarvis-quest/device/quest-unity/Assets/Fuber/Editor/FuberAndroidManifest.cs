// Gradle projesi üretildikten sonra unityLibrary manifestine ağ izinlerini ekler: INTERNET (TCP 47852),
// ACCESS_NETWORK_STATE / ACCESS_WIFI_STATE, CHANGE_WIFI_MULTICAST_STATE (UDP 47853 keşif yayınını almak için
// Wi-Fi yayın kilidi). Var olan izni yinelemez; manifest yoksa yalnız uyarı yazar (derlemeyi bozmaz).

using System.IO;
using System.Xml;
using UnityEditor.Android;
using UnityEngine;

namespace Fuber.Editor
{
    public sealed class FuberAndroidManifest : IPostGenerateGradleAndroidProject
    {
        private const string AndroidNs = "http://schemas.android.com/apk/res/android";

        private static readonly string[] Permissions =
        {
            "android.permission.INTERNET",
            "android.permission.ACCESS_NETWORK_STATE",
            "android.permission.ACCESS_WIFI_STATE",
            "android.permission.CHANGE_WIFI_MULTICAST_STATE",
        };

        public int callbackOrder => 999;

        public void OnPostGenerateGradleAndroidProject(string path)
        {
            string manifest = Path.Combine(path, "src", "main", "AndroidManifest.xml");
            if (!File.Exists(manifest))
            {
                Debug.LogWarning("[FuberManifest] Manifest bulunamadı: " + manifest);
                return;
            }
            var doc = new XmlDocument();
            doc.Load(manifest);
            var root = doc.DocumentElement;
            if (root == null) return;

            int added = 0;
            foreach (var perm in Permissions)
            {
                bool exists = false;
                foreach (XmlNode node in root.SelectNodes("uses-permission"))
                {
                    var attr = node.Attributes?["name", AndroidNs];
                    if (attr != null && attr.Value == perm) { exists = true; break; }
                }
                if (exists) continue;
                var el = doc.CreateElement("uses-permission");
                el.SetAttribute("name", AndroidNs, perm);
                root.PrependChild(el);
                added++;
            }
            doc.Save(manifest);
            Debug.Log($"[FuberManifest] Ağ izinleri işlendi ({added} eklendi): {manifest}");
        }
    }
}
