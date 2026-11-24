// Fuber Quest — editör kurulum betiği (toplu kip, -executeMethod Fuber.Editor.FuberSetup.ConfigureAll).
// Kararlı, derlemeyi ASLA bozmayan API'lerle: asgari sahne (holografik pano + Jarvis çekirdeği yer tutucu),
// Android oynatıcı ayarları (IL2CPP, ARM64, Vulkan, minSdk 32, Linear), yapı sahne listesi. XR/URP ince ayarı
// FuberXrConfig'te (yansımayla, en iyi çaba). Hiçbir adım istisna fırlatmaz; her adım loglanır.

using System;
using System.IO;
using Fuber.App;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.SceneManagement;

namespace Fuber.Editor
{
    public static class FuberSetup
    {
        public const string ScenePath = "Assets/Fuber/Scenes/Main.unity";

        /// <summary>Toplu kip giriş noktası: tüm kurulum.</summary>
        public static void ConfigureAll()
        {
            Log("=== Fuber Quest kurulum başladı ===");
            try { ConfigurePlayerSettings(); } catch (Exception e) { LogErr("PlayerSettings", e); }
            try { FuberXrConfig.ConfigureBestEffort(); } catch (Exception e) { LogErr("XR/URP", e); }
            try { CreateScene(); } catch (Exception e) { LogErr("Scene", e); }
            AssetDatabase.SaveAssets();
            AssetDatabase.Refresh();
            Log("=== Fuber Quest kurulum bitti ===");
        }

        public static void ConfigurePlayerSettings()
        {
            Log("Android oynatıcı ayarları uygulanıyor...");
            var android = NamedBuildTarget.Android;

            PlayerSettings.SetScriptingBackend(android, ScriptingImplementation.IL2CPP);
            PlayerSettings.Android.targetArchitectures = AndroidArchitecture.ARM64;
            // API uyumluluğu enum adı sürüme göre değişir; yansımayla güvenli dene (derlemeyi bozma).
            TrySetNetStandard(android);

            // Vulkan (Auto Graphics kapalı → yalnız Vulkan).
            PlayerSettings.SetUseDefaultGraphicsAPIs(BuildTarget.Android, false);
            PlayerSettings.SetGraphicsAPIs(BuildTarget.Android, new[] { GraphicsDeviceType.Vulkan });

            PlayerSettings.Android.minSdkVersion = AndroidSdkVersions.AndroidApiLevel32; // Quest: 32
            try { PlayerSettings.Android.targetSdkVersion = AndroidSdkVersions.AndroidApiLevelAuto; } catch { }

            PlayerSettings.colorSpace = ColorSpace.Linear;
            // Quest telemetri kotası: Log/Warning satırlarına yığın izi ekleme (Error kalsın).
            PlayerSettings.SetStackTraceLogType(LogType.Log, StackTraceLogType.None);
            PlayerSettings.SetStackTraceLogType(LogType.Warning, StackTraceLogType.None);
            PlayerSettings.SetStackTraceLogType(LogType.Error, StackTraceLogType.ScriptOnly);

            PlayerSettings.companyName = "Fuber";
            PlayerSettings.productName = "Fuber AI";
            try { PlayerSettings.SetApplicationIdentifier(android, "ai.fuber.quest"); } catch { }

            // VR'de taşınabilirlik: çoklu iş parçacığı render + otomatik döndürme kapalı.
            PlayerSettings.MTRendering = true;
            // Köprü (TCP 47852 / UDP 47853) için İnternet izni her zaman (otomatik algılamaya bırakma).
            PlayerSettings.Android.forceInternetPermission = true;
            PlayerSettings.defaultInterfaceOrientation = UIOrientation.LandscapeLeft;

            Log("Android oynatıcı ayarları tamam (IL2CPP, ARM64, Vulkan, minSdk 32, Linear).");
        }

        public const string CameraRigPrefab = "Packages/com.meta.xr.sdk.core/Prefabs/OVRCameraRig.prefab";
        public const string HandPrefab = "Packages/com.meta.xr.sdk.core/Prefabs/OVRHandPrefab.prefab";
        public const string MaterialDir = "Assets/Fuber/Materials";
        public const string FontPath = "Assets/Fuber/Fonts/ChakraPetch-Medium.ttf";

        /// <summary>
        /// Gerçek karma gerçeklik sahnesi: OVRCameraRig (kafa takibi, zemin kökeni) + passthrough (odayı gösterir) +
        /// iki el (OVRHandPrefab, OpenXR iskelet/örgü) + çimdik etkileşimi + dünyada sabit çekirdek ve pano.
        /// </summary>
        public static void CreateScene()
        {
            Log("XR sahnesi oluşturuluyor...");
            Directory.CreateDirectory("Assets/Fuber/Scenes");
            var mats = CreateMaterials();

            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            // ── 1) Kamera rig + kafa takibi ──
            var rigPrefab = AssetDatabase.LoadAssetAtPath<GameObject>(CameraRigPrefab);
            if (rigPrefab == null) throw new Exception("OVRCameraRig prefab bulunamadı: " + CameraRigPrefab);
            var rig = (GameObject)PrefabUtility.InstantiatePrefab(rigPrefab, scene);
            rig.name = "OVRCameraRig";
            rig.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);

            var manager = rig.GetComponent<OVRManager>();
            if (manager == null) manager = rig.AddComponent<OVRManager>();
            manager.isInsightPassthroughEnabled = true;
            var mso = new SerializedObject(manager);
            var origin = mso.FindProperty("_trackingOriginType");
            if (origin != null) origin.intValue = (int)OVRManager.TrackingOrigin.FloorLevel;
            mso.ApplyModifiedPropertiesWithoutUndo();
            Log("OVRCameraRig kuruldu: kafa takibi, takip kökeni = FloorLevel (OpenXR'de Stage), Insight Passthrough açık.");

            // ── 2) Passthrough katmanı (alt katman) + saydam kamera zemini ──
            var passthrough = rig.GetComponent<OVRPassthroughLayer>();
            if (passthrough == null) passthrough = rig.AddComponent<OVRPassthroughLayer>();
            passthrough.hidden = false;
            passthrough.textureOpacity = 1f;
            foreach (var cam in rig.GetComponentsInChildren<Camera>(true))
            {
                cam.clearFlags = CameraClearFlags.SolidColor;
                cam.backgroundColor = new Color(0f, 0f, 0f, 0f); // alfa 0 → passthrough görünür
                cam.allowHDR = false;
                if (cam.name == "CenterEyeAnchor") cam.tag = "MainCamera";
            }
            Log("OVRPassthroughLayer (Underlay) eklendi; kamera zemini saydam (alfa 0), HDR kapalı.");

            var trackingSpace = rig.transform.Find("TrackingSpace");
            var leftAnchor = rig.transform.Find("TrackingSpace/LeftHandAnchor");
            var rightAnchor = rig.transform.Find("TrackingSpace/RightHandAnchor");

            // ── 3) Eller ──
            var left = CreateHand(leftAnchor, false, trackingSpace, mats.hand);
            var right = CreateHand(rightAnchor, true, trackingSpace, mats.hand);

            // ── 4) İçerik: dünyada sabit; açılışta bir kez kullanıcının önüne yerleşir ──
            var content = new GameObject("FuberContent");
            content.transform.position = new Vector3(0f, 1.3f, 1.3f);
            var spawn = content.AddComponent<FuberSpawnInFront>();
            spawn.distance = 0.95f;       // eşleşme panosu JARVIS HUD'unun (1.4 m) önünde, yakın durur
            spawn.heightOffset = -0.12f;

            var panel = CreatePanel(content.transform, mats);
            panel.transform.localPosition = Vector3.zero;

            // ── 5) El etkileşimi ──
            var hands = new GameObject("FuberHands");
            var interactor = hands.AddComponent<FuberHandInteractor>();
            interactor.leftHand = left.hand;
            interactor.rightHand = right.hand;
            interactor.leftSkeleton = left.skeleton;
            interactor.rightSkeleton = right.skeleton;
            interactor.rayMaterial = mats.ray;

            // ── 6) Köprü sürücüsü ──
            var bridge = new GameObject("FuberBridge");
            var driver = bridge.AddComponent<BridgeDriver>();

            // ── 6b) JARVIS HUD: yayda duran paneller + çekirdek + avuç menüsü (hepsi çalışma anında kodla kurulur) ──
            var hudGo = new GameObject("FuberHud");
            var hud = hudGo.AddComponent<HudController>();
            hud.driver = driver;
            hud.interactor = interactor;
            hud.pairingPanel = panel;
            hud.font = AssetDatabase.LoadAssetAtPath<Font>(FontPath);
            hud.material = mats.hud;
            driver.hud = hud;
            Log($"JARVIS HUD bağlandı (font:{hud.font != null}, malzeme:{hud.material != null}).");

            // ── 7) Eşleşme arayüzü (pano üstünde: durum, PIN, tuş takımı) ──
            var ui = panel.AddComponent<PairingUi>();
            ui.driver = driver;
            ui.title = panel.transform.Find("Başlık")?.GetComponent<TextMesh>();
            ui.status = panel.transform.Find("Durum")?.GetComponent<TextMesh>();
            ui.pinText = panel.transform.Find("PIN")?.GetComponent<TextMesh>();
            ui.keypad = panel.transform.Find("Tuş takımı")?.gameObject;
            Log($"Eşleşme arayüzü bağlandı (başlık:{ui.title != null}, durum:{ui.status != null}, PIN:{ui.pinText != null}, tuş takımı:{ui.keypad != null}).");
            EditorSceneManager.SaveScene(scene, ScenePath);
            Log($"Sahne kaydedildi: {ScenePath}");

            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
            Log("Sahne yapı listesine eklendi.");
        }

        private struct HandRefs
        {
            public OVRHand hand;
            public OVRSkeleton skeleton;
        }

        /// <summary>OVRHandPrefab'ı el çapasına koyar; OpenXR el iskeleti/örgüsü (sol/sağ) seçilir, saydam holografik malzeme atanır.</summary>
        private static HandRefs CreateHand(Transform anchor, bool isRight, Transform trackingSpace, Material handMat)
        {
            var prefab = AssetDatabase.LoadAssetAtPath<GameObject>(HandPrefab);
            if (prefab == null) throw new Exception("OVRHandPrefab bulunamadı: " + HandPrefab);
            if (anchor == null) throw new Exception("El çapası bulunamadı (OVRCameraRig/TrackingSpace/*HandAnchor).");

            var go = (GameObject)PrefabUtility.InstantiatePrefab(prefab, anchor);
            go.name = isRight ? "OVRHand (Sağ)" : "OVRHand (Sol)";
            go.transform.localPosition = Vector3.zero;
            go.transform.localRotation = Quaternion.identity;

            var hand = go.GetComponent<OVRHand>();
            var skeleton = go.GetComponent<OVRSkeleton>();
            var mesh = go.GetComponent<OVRMesh>();

            if (hand != null)
            {
                var so = new SerializedObject(hand);
                var ht = so.FindProperty("HandType");
                if (ht != null) ht.intValue = (int)(isRight ? OVRHand.Hand.HandRight : OVRHand.Hand.HandLeft);
                var root = so.FindProperty("_pointerPoseRoot");
                if (root != null) root.objectReferenceValue = trackingSpace; // işaretçi pozu dünya uzayında doğru olsun
                so.ApplyModifiedPropertiesWithoutUndo();
            }
            if (skeleton != null)
            {
                var so = new SerializedObject(skeleton);
                var st = so.FindProperty("_skeletonType");
                if (st != null) st.intValue = (int)(isRight ? OVRSkeleton.SkeletonType.XRHandRight : OVRSkeleton.SkeletonType.XRHandLeft);
                so.ApplyModifiedPropertiesWithoutUndo();
            }
            if (mesh != null)
            {
                var so = new SerializedObject(mesh);
                var mt = so.FindProperty("_meshType");
                if (mt != null) mt.intValue = (int)(isRight ? OVRMesh.MeshType.XRHandRight : OVRMesh.MeshType.XRHandLeft);
                so.ApplyModifiedPropertiesWithoutUndo();
            }
            foreach (var smr in go.GetComponentsInChildren<SkinnedMeshRenderer>(true))
            {
                smr.sharedMaterial = handMat;
                smr.shadowCastingMode = ShadowCastingMode.Off;
            }
            Log($"El eklendi: {go.name} (HandType/Skeleton/Mesh = OpenXR {(isRight ? "sağ" : "sol")}, holografik malzeme).");
            return new HandRefs { hand = hand, skeleton = skeleton };
        }

        private static GameObject CreateCore(Transform parent, Materials mats)
        {
            var core = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            core.name = "JarvisCore";
            core.transform.SetParent(parent, false);
            core.transform.localPosition = new Vector3(-0.38f, 0f, 0f);
            core.transform.localScale = Vector3.one * 0.18f;
            core.GetComponent<Renderer>().sharedMaterial = mats.core;
            core.GetComponent<Renderer>().shadowCastingMode = ShadowCastingMode.Off;
            // Çimdikle yakalamayı kolaylaştırmak için çarpıştırıcı görselden biraz büyük.
            var col = core.GetComponent<SphereCollider>();
            if (col != null) col.radius = 0.75f;

            var halo = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            halo.name = "Hale";
            DestroyImmediate(halo.GetComponent<Collider>());
            halo.transform.SetParent(core.transform, false);
            halo.transform.localScale = Vector3.one * 1.55f;
            halo.GetComponent<Renderer>().sharedMaterial = mats.halo;
            halo.GetComponent<Renderer>().shadowCastingMode = ShadowCastingMode.Off;

            core.AddComponent<JarvisCore>();
            var target = core.AddComponent<PinchTarget>();
            target.movable = true;
            return core;
        }

        private static GameObject CreatePanel(Transform parent, Materials mats)
        {
            const float w = 0.62f, h = 0.40f;
            var panel = new GameObject("HoloPanel");
            panel.transform.SetParent(parent, false);
            panel.transform.localPosition = new Vector3(0.22f, 0.02f, 0f);

            var glass = GameObject.CreatePrimitive(PrimitiveType.Quad);
            glass.name = "Cam";
            DestroyImmediate(glass.GetComponent<Collider>());
            glass.transform.SetParent(panel.transform, false);
            glass.transform.localScale = new Vector3(w, h, 1f);
            glass.GetComponent<Renderer>().sharedMaterial = mats.glass;
            glass.GetComponent<Renderer>().shadowCastingMode = ShadowCastingMode.Off;

            // Parlayan çerçeve: dört ince çubuk.
            const float t = 0.008f;
            AddBar(panel.transform, "Üst", new Vector3(0f, h / 2f, 0f), new Vector3(w + t, t, t), mats.frame);
            AddBar(panel.transform, "Alt", new Vector3(0f, -h / 2f, 0f), new Vector3(w + t, t, t), mats.frame);
            AddBar(panel.transform, "Sol", new Vector3(-w / 2f, 0f, 0f), new Vector3(t, h + t, t), mats.frame);
            AddBar(panel.transform, "Sağ", new Vector3(w / 2f, 0f, 0f), new Vector3(t, h + t, t), mats.frame);

            AddText(panel.transform, "Başlık", "FUBER AI", new Vector3(0f, 0.135f, -0.004f), 0.0042f, new Color(0.75f, 0.97f, 1f));
            AddText(panel.transform, "Durum", "Fuber PC aranıyor…", new Vector3(0f, 0.035f, -0.004f), 0.0020f, new Color(0.6f, 0.9f, 1f, 0.95f));
            AddText(panel.transform, "PIN", "", new Vector3(0f, -0.085f, -0.004f), 0.0040f, new Color(0.85f, 1f, 1f));
            AddText(panel.transform, "İpucu", "Panoyu çimdikle tut, taşı", new Vector3(0f, -0.172f, -0.004f), 0.0012f, new Color(0.55f, 0.85f, 1f, 0.7f));

            var box = panel.AddComponent<BoxCollider>();
            box.size = new Vector3(w + 0.03f, h + 0.03f, 0.04f);

            CreateKeypad(panel.transform, mats);

            panel.AddComponent<HoloPanel>();
            var target = panel.AddComponent<PinchTarget>();
            target.movable = true;
            return panel;
        }

        /// <summary>Panonun altında 0-9 + SİL + OK holografik tuş takımı (her tuş ayrı çimdik hedefi, taşınmaz).</summary>
        private static GameObject CreateKeypad(Transform panel, Materials mats)
        {
            var keypad = new GameObject("Tuş takımı");
            keypad.transform.SetParent(panel, false);
            keypad.transform.localPosition = new Vector3(0f, -0.36f, -0.03f);

            string[,] layout =
            {
                { "1", "2", "3" },
                { "4", "5", "6" },
                { "7", "8", "9" },
                { "del", "0", "ok" },
            };
            const float size = 0.058f, pitch = 0.07f;
            for (int row = 0; row < 4; row++)
            {
                for (int col = 0; col < 3; col++)
                {
                    string key = layout[row, col];
                    var go = new GameObject("Tuş " + key);
                    go.transform.SetParent(keypad.transform, false);
                    go.transform.localPosition = new Vector3((col - 1) * pitch, (1.5f - row) * pitch, 0f);

                    var visual = GameObject.CreatePrimitive(PrimitiveType.Cube);
                    visual.name = "Görsel";
                    DestroyImmediate(visual.GetComponent<Collider>());
                    visual.transform.SetParent(go.transform, false);
                    visual.transform.localScale = new Vector3(size, size, 0.012f);
                    var r = visual.GetComponent<Renderer>();
                    r.sharedMaterial = key == "ok" ? mats.keyAccent : mats.key;
                    r.shadowCastingMode = ShadowCastingMode.Off;

                    string label = key == "del" ? "SİL" : key == "ok" ? "OK" : key;
                    float charSize = key.Length > 1 ? 0.0019f : 0.0030f;
                    AddText(go.transform, "Etiket", label, new Vector3(0f, 0f, -0.008f), charSize, new Color(0.9f, 1f, 1f));

                    var col3 = go.AddComponent<BoxCollider>();
                    col3.size = new Vector3(size, size, 0.03f);
                    go.AddComponent<KeypadKey>().key = key;
                    go.AddComponent<PinchTarget>().movable = false;
                }
            }
            return keypad;
        }

        private static void AddBar(Transform parent, string name, Vector3 pos, Vector3 scale, Material mat)
        {
            var bar = GameObject.CreatePrimitive(PrimitiveType.Cube);
            bar.name = "Çerçeve " + name;
            DestroyImmediate(bar.GetComponent<Collider>());
            bar.transform.SetParent(parent, false);
            bar.transform.localPosition = pos;
            bar.transform.localScale = scale;
            bar.GetComponent<Renderer>().sharedMaterial = mat;
            bar.GetComponent<Renderer>().shadowCastingMode = ShadowCastingMode.Off;
        }

        private static void AddText(Transform parent, string name, string text, Vector3 pos, float charSize, Color color)
        {
            var font = AssetDatabase.LoadAssetAtPath<Font>(FontPath);
            if (font == null) { Log("Yazı tipi yok, metin atlandı: " + FontPath); return; }
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            var tm = go.AddComponent<TextMesh>();
            tm.font = font;
            tm.text = text;
            tm.fontSize = 96;
            tm.characterSize = charSize;
            tm.anchor = TextAnchor.MiddleCenter;
            tm.alignment = TextAlignment.Center;
            tm.color = color;
            var mr = go.GetComponent<MeshRenderer>();
            mr.sharedMaterial = font.material;
            mr.shadowCastingMode = ShadowCastingMode.Off;
        }

        private struct Materials
        {
            public Material core, halo, glass, frame, hand, ray, key, keyAccent, hud;
        }

        private static Materials CreateMaterials()
        {
            Directory.CreateDirectory(MaterialDir);
            return new Materials
            {
                core = UnlitMaterial("FuberCore", new Color(0.25f, 0.85f, 1f, 1f), transparent: false),
                halo = UnlitMaterial("FuberHalo", new Color(0.3f, 0.85f, 1f, 0.16f), transparent: true),
                glass = UnlitMaterial("FuberGlass", new Color(0.05f, 0.35f, 0.5f, 0.38f), transparent: true),
                frame = UnlitMaterial("FuberFrame", new Color(0.35f, 0.95f, 1f, 0.95f), transparent: true),
                hand = UnlitMaterial("FuberHand", new Color(0.35f, 0.85f, 1f, 0.4f), transparent: true),
                ray = UnlitMaterial("FuberRay", new Color(0.6f, 0.95f, 1f, 0.75f), transparent: true),
                key = UnlitMaterial("FuberKey", new Color(0.1f, 0.45f, 0.6f, 0.55f), transparent: true),
                keyAccent = UnlitMaterial("FuberKeyOk", new Color(0.15f, 0.6f, 0.35f, 0.6f), transparent: true),
                hud = HudMaterial(),
            };
        }

        /// <summary>HUD'un tek malzemesi (Fuber/Hud): vertex renkli, alfa-önçarpımlı, iki yüzlü.</summary>
        public static Material HudMaterial()
        {
            var shader = Shader.Find("Fuber/Hud");
            if (shader == null) throw new Exception("Fuber/Hud gölgelendiricisi bulunamadı.");
            string path = $"{MaterialDir}/FuberHud.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null) { mat = new Material(shader); AssetDatabase.CreateAsset(mat, path); }
            mat.shader = shader;
            mat.SetVector("_Params", new Vector4(1f, 0f, 1f, 0f));
            mat.renderQueue = (int)RenderQueue.Transparent;
            EditorUtility.SetDirty(mat);
            return mat;
        }

        /// <summary>URP Unlit malzemesi (opak ya da alfa karışımlı saydam, iki yüzlü). Varlık olarak kaydedilir ki yapıya girsin.</summary>
        private static Material UnlitMaterial(string name, Color color, bool transparent)
        {
            var shader = Shader.Find("Universal Render Pipeline/Unlit");
            if (shader == null) throw new Exception("URP Unlit gölgelendiricisi bulunamadı.");
            string path = $"{MaterialDir}/{name}.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null)
            {
                mat = new Material(shader);
                AssetDatabase.CreateAsset(mat, path);
            }
            mat.shader = shader;
            mat.SetColor("_BaseColor", color);
            if (mat.HasProperty("_Cull")) mat.SetFloat("_Cull", (float)CullMode.Off);
            if (transparent)
            {
                mat.SetFloat("_Surface", 1f);
                mat.SetFloat("_Blend", 0f);
                mat.SetFloat("_SrcBlend", (float)BlendMode.SrcAlpha);
                mat.SetFloat("_DstBlend", (float)BlendMode.OneMinusSrcAlpha);
                if (mat.HasProperty("_SrcBlendAlpha")) mat.SetFloat("_SrcBlendAlpha", (float)BlendMode.One);
                if (mat.HasProperty("_DstBlendAlpha")) mat.SetFloat("_DstBlendAlpha", (float)BlendMode.OneMinusSrcAlpha);
                mat.SetFloat("_ZWrite", 0f);
                mat.EnableKeyword("_SURFACE_TYPE_TRANSPARENT");
                mat.SetOverrideTag("RenderType", "Transparent");
                mat.renderQueue = (int)RenderQueue.Transparent;
            }
            else
            {
                mat.SetFloat("_Surface", 0f);
                mat.SetFloat("_ZWrite", 1f);
                mat.DisableKeyword("_SURFACE_TYPE_TRANSPARENT");
                mat.SetOverrideTag("RenderType", "Opaque");
                mat.renderQueue = (int)RenderQueue.Geometry;
            }
            EditorUtility.SetDirty(mat);
            return mat;
        }

        private static void DestroyImmediate(UnityEngine.Object o) { if (o != null) UnityEngine.Object.DestroyImmediate(o); }

        // .NET Standard API uyumluluğunu yansımayla ayarla (enum değer adı sürüme göre: "NET_Standard" / "NET_Standard_2_0").
        private static void TrySetNetStandard(NamedBuildTarget target)
        {
            try
            {
                foreach (var name in new[] { "NET_Standard", "NET_Standard_2_1", "NET_Standard_2_0" })
                {
                    if (Enum.IsDefined(typeof(ApiCompatibilityLevel), name))
                    {
                        var level = (ApiCompatibilityLevel)Enum.Parse(typeof(ApiCompatibilityLevel), name);
                        PlayerSettings.SetApiCompatibilityLevel(target, level);
                        Log("API uyumluluğu: " + name);
                        return;
                    }
                }
            }
            catch (Exception e) { LogErr("ApiCompatibility", e); }
        }

        internal static void Log(string m) => Debug.Log("[FuberSetup] " + m);
        internal static void LogErr(string where, Exception e) => Debug.LogWarning($"[FuberSetup] {where} atlandı: {e.Message}");
    }
}
