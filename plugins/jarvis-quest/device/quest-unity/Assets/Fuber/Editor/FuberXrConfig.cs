// XR/URP ince ayarı — EN İYİ ÇABA, yansımayla. Fuber.Editor yalnız çekirdek UnityEditor/UnityEngine'e bağlıdır;
// OpenXR/XR Management/Meta/URP düzenleyici API'leri yansımayla çağrılır ki paket sürümü ne olursa olsun DERLEME
// BOZULMASIN. Her adım loglanır; bulunamayan API "elle yapılacak" olarak raporlanır. Doğrulama: FuberSetup logları.

using System;
using System.Linq;
using System.Reflection;
using UnityEditor;
using UnityEngine;
using UnityEngine.Rendering;

namespace Fuber.Editor
{
    public static class FuberXrConfig
    {
        public static void ConfigureBestEffort()
        {
            ConfigureOvrProjectConfig();
            ConfigureUrp();
            EnableOpenXrLoaderAndroid();
        }

        // ───────── OVRProjectConfig (el izleme / passthrough / scene / anchor) ─────────
        // Serileştirilmiş asta doğrudan SerializedObject ile yazar (tip referansı gerekmez → derleme güvenli).
        private static void ConfigureOvrProjectConfig()
        {
            const string path = "Assets/Oculus/OculusProjectConfig.asset";
            var obj = AssetDatabase.LoadMainAssetAtPath(path);
            if (obj == null) { FuberSetup.Log("OVRProjectConfig bulunamadı (Meta SDK içe aktarınca oluşur)."); return; }
            var so = new SerializedObject(obj);
            // El izleme: HandsOnly (2). Passthrough/Scene: Required, Anchor: Enabled.
            SetInt(so, "handTrackingSupport", 2);     // 0=ControllersOnly,1=ControllersAndHands,2=HandsOnly
            SetInt(so, "anchorSupport", 1);           // 0=Disabled,1=Enabled
            SetInt(so, "sceneSupport", 2);            // 0=None,1=Supported,2=Required
            SetInt(so, "sharedAnchorSupport", 1);
            // Passthrough alanı sürüme göre "insightPassthroughSupport" ya da "insightPassthroughEnabled" olabilir.
            SetInt(so, "insightPassthroughSupport", 2);
            SetBool(so, "insightPassthroughEnabled", true);
            so.ApplyModifiedPropertiesWithoutUndo();
            EditorUtility.SetDirty(obj);
            FuberSetup.Log("OVRProjectConfig: el izleme HandsOnly, Passthrough/Scene Required, Anchor Enabled (mevcut alanlar).");
        }

        private static void SetInt(SerializedObject so, string prop, int value)
        {
            var p = so.FindProperty(prop);
            if (p != null) p.intValue = value;
        }

        private static void SetBool(SerializedObject so, string prop, bool value)
        {
            var p = so.FindProperty(prop);
            if (p != null) p.boolValue = value;
        }

        // ───────── URP ─────────
        private static void ConfigureUrp()
        {
            // Var olan bir URP varlığı ata; yoksa yansımayla oluşturmayı dene.
            var guids = AssetDatabase.FindAssets("t:UniversalRenderPipelineAsset");
            RenderPipelineAsset urp = null;
            if (guids.Length > 0)
            {
                urp = AssetDatabase.LoadAssetAtPath<RenderPipelineAsset>(AssetDatabase.GUIDToAssetPath(guids[0]));
                FuberSetup.Log("Mevcut URP varlığı bulundu.");
            }
            else
            {
                urp = TryCreateUrpAsset();
            }

            if (urp != null)
            {
                GraphicsSettings.defaultRenderPipeline = urp;
                QualitySettings.renderPipeline = urp;
                FuberSetup.Log("URP varlığı GraphicsSettings/QualitySettings'e atandı.");

                // Passthrough için ZORUNLU: HDR kapalı (HDR biçimi alfa taşımaz → kamera alfa 0 yazamaz → passthrough siyah).
                // MSAA 4x: Quest'te kenar yumuşatma (holografik çizgiler titremesin).
                var so = new SerializedObject(urp);
                var hdr = so.FindProperty("m_SupportsHDR");
                if (hdr != null) hdr.boolValue = false;
                var msaa = so.FindProperty("m_MSAA");
                if (msaa != null) msaa.intValue = 4;
                so.ApplyModifiedPropertiesWithoutUndo();
                EditorUtility.SetDirty(urp);
                FuberSetup.Log($"URP: HDR kapalı ({(hdr != null ? "ayarlandı" : "alan YOK")}), MSAA 4x ({(msaa != null ? "ayarlandı" : "alan YOK")}).");
            }
            else
            {
                FuberSetup.Log("URP varlığı oluşturulamadı; editörde 'Create > Rendering > URP Asset' ile elle eklenmeli (DOĞRULANMADI).");
            }
        }

        private static RenderPipelineAsset TryCreateUrpAsset()
        {
            try
            {
                const string asm = "Unity.RenderPipelines.Universal.Runtime";
                var rendererDataType = Type.GetType($"UnityEngine.Rendering.Universal.UniversalRendererData, {asm}");
                var urpType = Type.GetType($"UnityEngine.Rendering.Universal.UniversalRenderPipelineAsset, {asm}");
                if (rendererDataType == null || urpType == null) { FuberSetup.Log("URP tipleri yansımada yok."); return null; }

                System.IO.Directory.CreateDirectory("Assets/Fuber/Rendering");
                var rendererData = ScriptableObject.CreateInstance(rendererDataType);
                AssetDatabase.CreateAsset(rendererData, "Assets/Fuber/Rendering/FuberRenderer.asset");

                // internal static UniversalRenderPipelineAsset Create(ScriptableRendererData rendererData = null)
                var create = urpType.GetMethods(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic)
                    .FirstOrDefault(m => m.Name == "Create" && m.GetParameters().Length == 1);
                if (create == null) { FuberSetup.Log("URP Create metodu bulunamadı."); return null; }
                var urpObj = create.Invoke(null, new object[] { rendererData }) as ScriptableObject;
                if (urpObj == null) return null;
                AssetDatabase.CreateAsset(urpObj, "Assets/Fuber/Rendering/FuberURP.asset");
                AssetDatabase.SaveAssets();
                FuberSetup.Log("URP varlığı yansımayla oluşturuldu: Assets/Fuber/Rendering/FuberURP.asset");
                return urpObj as RenderPipelineAsset;
            }
            catch (Exception e)
            {
                FuberSetup.Log("URP oluşturma başarısız (yansıma): " + e.Message);
                return null;
            }
        }

        // ───────── OpenXR yükleyici (Android) ─────────
        private static void EnableOpenXrLoaderAndroid()
        {
            try
            {
                // XRGeneralSettingsPerBuildTarget (com.unity.xr.management editör)
                var perBuildType = FindType("UnityEditor.XR.Management.XRGeneralSettingsPerBuildTarget, Unity.XR.Management.Editor");
                var generalType = FindType("UnityEngine.XR.Management.XRGeneralSettings, Unity.XR.Management");
                var managerType = FindType("UnityEngine.XR.Management.XRManagerSettings, Unity.XR.Management");
                var metaStoreType = FindType("UnityEditor.XR.Management.Metadata.XRPackageMetadataStore, Unity.XR.Management.Editor");
                if (perBuildType == null || metaStoreType == null)
                {
                    FuberSetup.Log("XR Management editör API'si yansımada yok; OpenXR yükleyici ELLE etkinleştirilmeli (DOĞRULANMADI).");
                    return;
                }

                // XRGeneralSettingsPerBuildTarget örneğini al/yarat.
                var getOrCreate = perBuildType.GetMethod("GetOrCreate", BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.Static);
                object perBuild = getOrCreate != null ? getOrCreate.Invoke(null, null) : null;
                if (perBuild == null) { FuberSetup.Log("XRGeneralSettingsPerBuildTarget alınamadı (DOĞRULANMADI)."); return; }

                // Android için XRGeneralSettings.
                var getSettings = perBuildType.GetMethod("SettingsForBuildTarget");
                object general = getSettings?.Invoke(perBuild, new object[] { BuildTargetGroup.Android });
                if (general == null)
                {
                    var createDefault = perBuildType.GetMethod("CreateDefaultManagerSettingsForBuildTarget");
                    createDefault?.Invoke(perBuild, new object[] { BuildTargetGroup.Android });
                    general = getSettings?.Invoke(perBuild, new object[] { BuildTargetGroup.Android });
                }
                if (general == null) { FuberSetup.Log("Android XRGeneralSettings oluşturulamadı (DOĞRULANMADI)."); return; }

                // Manager + OpenXR loader ata.
                var mgrProp = generalType.GetProperty("Manager") ?? generalType.GetProperty("AssignedSettings");
                object manager = mgrProp?.GetValue(general);
                bool assigned = false;
                var assignLoader = metaStoreType.GetMethod("AssignLoader", BindingFlags.Public | BindingFlags.Static);
                if (assignLoader != null && manager != null)
                {
                    // AssignLoader(XRManagerSettings, string loaderTypeName, BuildTargetGroup)
                    assigned = (bool)assignLoader.Invoke(null, new object[] { manager, "UnityEngine.XR.OpenXR.OpenXRLoader", BuildTargetGroup.Android });
                }
                EditorUtility.SetDirty((UnityEngine.Object)general);
                FuberSetup.Log(assigned
                    ? "OpenXR yükleyici Android için atandı."
                    : "OpenXR yükleyici atanamadı; XR Plug-in Management'ta ELLE işaretlenmeli (DOĞRULANMADI).");

                EnableOpenXrFeatures();
            }
            catch (Exception e)
            {
                FuberSetup.Log("OpenXR yükleyici yapılandırması başarısız (yansıma): " + e.Message + " (ELLE yapılacak, DOĞRULANMADI).");
            }
        }

        private static void EnableOpenXrFeatures()
        {
            try
            {
                var settingsType = FindType("UnityEngine.XR.OpenXR.OpenXRSettings");
                var getSettings = settingsType?.GetMethod("GetSettingsForBuildTargetGroup", new[] { typeof(BuildTargetGroup) });
                var settings = getSettings?.Invoke(null, new object[] { BuildTargetGroup.Android });
                if (settings == null) { FuberSetup.Log("OpenXRSettings (Android) alınamadı; el izleme özellikleri ELLE açılmalı."); return; }
                var features = settingsType.GetMethods().FirstOrDefault(m => m.Name == "GetFeatures" && !m.IsGenericMethod && m.GetParameters().Length == 0)?.Invoke(settings, null) as Array;
                if (features == null) { FuberSetup.Log("OpenXR özellik listesi alınamadı."); return; }
                // Hand Tracking Subsystem (XR Hands) + Meta Hand Tracking Aim. MetaXRFeature açık kalır; "Meta Quest Support" (MetaQuestFeature) KAPALI kalır (Meta XR ile çakışır).
                string[] want = { "HandTracking", "MetaHandTrackingAim" };
                foreach (var f in features)
                {
                    if (f == null) continue;
                    var ft = f.GetType();
                    var enabledProp = ft.GetProperty("enabled");
                    if (enabledProp == null) continue;
                    bool isWanted = Array.IndexOf(want, ft.Name) >= 0;
                    if (isWanted && !(bool)enabledProp.GetValue(f))
                    {
                        enabledProp.SetValue(f, true);
                        EditorUtility.SetDirty((UnityEngine.Object)f);
                        FuberSetup.Log("OpenXR özelliği AÇILDI: " + ft.Name);
                    }
                    else if (ft.Name == "MetaQuestFeature" && (bool)enabledProp.GetValue(f))
                    {
                        enabledProp.SetValue(f, false);
                        EditorUtility.SetDirty((UnityEngine.Object)f);
                    }
                }
                AssetDatabase.SaveAssets();
                var sb = new System.Text.StringBuilder();
                foreach (var f in features) { if (f != null && (bool)f.GetType().GetProperty("enabled").GetValue(f)) sb.Append(f.GetType().Name).Append(' '); }
                FuberSetup.Log("OpenXR Android açık özellikler: " + sb);
            }
            catch (Exception e)
            {
                FuberSetup.Log("OpenXR özellikleri yapılandırması: " + e.Message);
            }
        }

        private static Type FindType(string assemblyQualified)
        {
            var t = Type.GetType(assemblyQualified);
            if (t != null) return t;
            // Yalın ad ile tüm derlemelerde ara.
            var simple = assemblyQualified.Split(',')[0].Trim();
            foreach (var asm in AppDomain.CurrentDomain.GetAssemblies())
            {
                try { var tt = asm.GetType(simple); if (tt != null) return tt; } catch { }
            }
            return null;
        }
    }
}
