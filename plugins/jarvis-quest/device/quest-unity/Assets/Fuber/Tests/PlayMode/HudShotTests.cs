// JARVIS HUD ekran görüntüleri (PlayMode, GPU gerekir: -batchmode, -nographics OLMADAN).
// Sahte (örnek) snapshot ile HUD'u kurar, bir kameradan RenderTexture'a çizer, PNG olarak build/shots/ altına yazar.
// Çıktılar referans tasarımla gözle karşılaştırılır. Varsayılan test koşusunu kirletmesin diye Category("Screenshot").

#if UNITY_EDITOR
using System.Collections;
using System.IO;
using Fuber.App;
using Fuber.Net;
using NUnit.Framework;
using UnityEditor;
using UnityEngine;
using UnityEngine.TestTools;

public class HudShotTests
{
    private const string Dir = "../build/shots";

    private static string OutDir()
    {
        string d = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "build", "shots"));
        Directory.CreateDirectory(d);
        return d;
    }

    private static string Sample() => File.ReadAllText(Path.Combine(Application.dataPath, "..", "..", "..", "docs", "hud-snapshot-ornek.json"));   // plugins/jarvis-quest/docs

    private Camera _cam;
    private RenderTexture _rt;
    private HudController _hud;

    private void Setup(float fov = 72f)
    {
        var camGo = new GameObject("ShotCam");
        camGo.tag = "MainCamera";
        _cam = camGo.AddComponent<Camera>();
        _cam.transform.position = new Vector3(0f, 1.6f, 0f);
        _cam.transform.rotation = Quaternion.identity;
        _cam.fieldOfView = fov;
        _cam.clearFlags = CameraClearFlags.SolidColor;
        _cam.backgroundColor = new Color(0.02f, 0.045f, 0.06f, 1f);
        _cam.nearClipPlane = 0.05f;
        _cam.farClipPlane = 20f;
        _rt = new RenderTexture(1600, 1000, 24, RenderTextureFormat.ARGB32);
        _cam.targetTexture = _rt;

        var hudGo = new GameObject("FuberHud");
        _hud = hudGo.AddComponent<HudController>();
        _hud.font = AssetDatabase.LoadAssetAtPath<Font>("Assets/Fuber/Fonts/ChakraPetch-Medium.ttf");
        _hud.material = AssetDatabase.LoadAssetAtPath<Material>("Assets/Fuber/Materials/FuberHud.mat");
        _hud.previewMode = true;
        Assert.IsNotNull(_hud.font); Assert.IsNotNull(_hud.material);
    }

    private void Shoot(string name)
    {
        _cam.Render();
        var prev = RenderTexture.active;
        RenderTexture.active = _rt;
        var tex = new Texture2D(_rt.width, _rt.height, TextureFormat.RGB24, false);
        tex.ReadPixels(new Rect(0, 0, _rt.width, _rt.height), 0, 0);
        tex.Apply();
        RenderTexture.active = prev;
        File.WriteAllBytes(Path.Combine(OutDir(), name + ".png"), tex.EncodeToPNG());
        Object.DestroyImmediate(tex);
    }

    [TearDown]
    public void Cleanup()
    {
        if (_cam != null) Object.DestroyImmediate(_cam.gameObject);
        if (_hud != null) Object.DestroyImmediate(_hud.gameObject);
        if (_rt != null) _rt.Release();
    }

    private IEnumerator Wait(float s)
    {
        float t = 0f;
        while (t < s) { t += Time.unscaledDeltaTime; yield return null; }
    }

    [UnityTest, Category("Screenshot")]
    public IEnumerator Hud_Live_Cyan()
    {
        Setup();
        yield return null;
        _hud.Build();
        _hud.OnSnapshotJson(Sample());
        yield return Wait(2.5f);
        Shoot("hud-canli-cyan");
        Assert.AreEqual(1, _hud.SnapshotsReceived);
    }

    [UnityTest, Category("Screenshot")]
    public IEnumerator Hud_Off_NoData()
    {
        Setup();
        yield return null;
        _hud.Build();
        yield return Wait(2.5f);
        Shoot("hud-bagli-degil");
    }

    [UnityTest, Category("Screenshot")]
    public IEnumerator Hud_Stale()
    {
        Setup();
        yield return null;
        _hud.Build();
        _hud.OnSnapshotJson(Sample());
        yield return Wait(2f);
        _hud.PreviewSetAge(30f);
        yield return Wait(1.5f);
        Shoot("hud-gecikmeli");
    }

    [UnityTest, Category("Screenshot")]
    public IEnumerator Hud_Ember_And_Menu()
    {
        Setup();
        yield return null;
        _hud.Build();
        var s = Sample().Replace("\"palette\": \"cyan\"", "\"palette\": \"ember\"").Replace("\"tab\": \"overview\"", "\"tab\": \"comms\"");
        _hud.OnSnapshotJson(s);
        yield return Wait(2f);
        Shoot("hud-ember");
        _hud.PreviewMenuAt(new Vector3(-0.18f, 1.38f, 0.55f), Quaternion.identity);
        yield return Wait(1f);
        _cam.fieldOfView = 55f;
        Shoot("hud-avuc-menu");
    }

    [UnityTest, Category("Screenshot")]
    public IEnumerator Hud_PartialData_And_BadSnapshot()
    {
        Setup();
        yield return null;
        _hud.Build();
        // bozuk snapshot reddedilir, HUD çökmez
        _hud.OnSnapshotJson("{bozuk");
        Assert.AreEqual(1, _hud.SnapshotsRejected);
        // yalnız ENV + bio.off: diğerleri BAĞLI DEĞİL
        _hud.OnSnapshotJson("{\"t\":\"hud.snapshot\",\"seq\":1,\"data\":{\"ts\":1,\"greeting\":\"Merhaba\",\"summary\":\"Kısmi veri\",\"env\":{\"status\":\"ok\",\"place\":\"X\",\"tempC\":5},\"bio\":{\"status\":\"off\",\"source\":\"none\"}}}");
        yield return Wait(2.5f);
        Shoot("hud-kismi");
    }

    // ───────── 2. tur ─────────

    private void CloseUp()
    {
        _cam.fieldOfView = 34f;
        _cam.transform.position = new Vector3(0f, 1.42f, 0f);
    }

    [UnityTest, Category("Screenshot")]
    public IEnumerator Core_Speaking_Frames()
    {
        Setup();
        yield return null;
        _hud.Build();
        _hud.OnSnapshotJson(Sample());
        yield return Wait(1.8f);
        CloseUp();
        // konuşma: gerçek düzey akışı (hud.voice ~15 Hz) simülasyonu
        string text = "Günaydın efendim. Bütün sistemler normal, toplantınıza kırk dakika var.";
        _hud.OnSnapshotJson(Sample().Replace("\"state\": \"idle\"", "\"state\": \"speaking\"").Replace("\"text\": \"\"", "\"text\": \"" + text + "\""));
        float t = 0f; int shot = 0;
        while (t < 3.2f)
        {
            float lv = 0.5f + 0.5f * Mathf.Sin(t * 7f) * Mathf.Sin(t * 2.3f);
            _hud.OnVoiceJson("{\"t\":\"hud.voice\",\"state\":\"speaking\",\"level\":" + lv.ToString("0.000", System.Globalization.CultureInfo.InvariantCulture) + "}");
            if ((shot == 0 && t > 0.25f) || (shot == 1 && t > 0.9f) || (shot == 2 && t > 2.4f)) { Shoot("cekirdek-konusma-" + (shot + 1)); shot++; }
            t += Time.unscaledDeltaTime; yield return null;
        }
        Assert.Greater(_hud.Core.VoiceWeight(2), 0.9f);
        Assert.IsTrue(_hud.Core.HasLiveLevel);
    }

    [UnityTest, Category("Screenshot")]
    public IEnumerator Core_Speaking_WithoutLevel_Calm_And_Listening_Thinking()
    {
        Setup();
        yield return null;
        _hud.Build();
        _hud.OnSnapshotJson(Sample());
        yield return Wait(1.8f);
        CloseUp();
        // eski PC: düzey YOK → sakin animasyon, seviye yok
        _hud.OnVoiceJson("{\"t\":\"hud.voice\",\"state\":\"speaking\"}");
        yield return Wait(1.2f);
        Assert.IsFalse(_hud.Core.HasLiveLevel);
        Shoot("cekirdek-konusma-seviyesiz");
        _hud.OnVoiceJson("{\"t\":\"hud.voice\",\"state\":\"listening\",\"level\":0.3}");
        yield return Wait(1.3f);
        Shoot("cekirdek-dinleme");
        _hud.OnVoiceJson("{\"t\":\"hud.voice\",\"state\":\"thinking\"}");
        yield return Wait(1.3f);
        Shoot("cekirdek-dusunme");
        // bitiş: animasyonla yük sayısına geri döner
        _hud.OnVoiceJson("{\"t\":\"hud.voice\",\"state\":\"idle\",\"level\":0}");
        yield return Wait(1.5f);
        Assert.Less(_hud.Core.VoiceWeight(2) + _hud.Core.VoiceWeight(0) + _hud.Core.VoiceWeight(1), 0.01f);
        Shoot("cekirdek-donus");
    }

    private IEnumerator IntensityShot(string palette, string level, int score, string file)
    {
        Setup();
        yield return null;
        _hud.Build();
        string j = Sample().Replace("\"palette\": \"cyan\"", "\"palette\": \"" + palette + "\"")
                           .Replace("\"score\": 62", "\"score\": " + score).Replace("\"level\": \"busy\"", "\"level\": \"" + level + "\"");
        _hud.OnSnapshotJson(j);
        yield return Wait(2.4f);          // 1.5 sn palet geçişi bitsin
        Assert.AreEqual(palette, HudTheme.Name);
        Shoot(file);
    }

    [UnityTest, Category("Screenshot")] public IEnumerator Intensity_Calm_Cyan() { yield return IntensityShot("cyan", "calm", 18, "yogunluk-1-sakin-cyan"); }
    [UnityTest, Category("Screenshot")] public IEnumerator Intensity_Normal_Blue() { yield return IntensityShot("blue", "normal", 41, "yogunluk-2-normal-mavi"); }
    [UnityTest, Category("Screenshot")] public IEnumerator Intensity_Busy_Ember() { yield return IntensityShot("ember", "busy", 72, "yogunluk-3-yogun-kor"); }
    [UnityTest, Category("Screenshot")] public IEnumerator Intensity_Critical_Ice() { yield return IntensityShot("ice", "critical", 94, "yogunluk-4-kritik-buz"); }

    [UnityTest, Category("Screenshot")]
    public IEnumerator Palette_Transition_IsSmooth()
    {
        Setup();
        yield return null;
        _hud.Build();
        _hud.OnSnapshotJson(Sample());
        yield return Wait(1.8f);
        var before = HudTheme.Accent;
        _hud.OnSnapshotJson(Sample().Replace("\"palette\": \"cyan\"", "\"palette\": \"ember\""));
        yield return null; yield return null;
        var early = HudTheme.Accent;
        Assert.Less(Mathf.Abs(early.r - before.r) + Mathf.Abs(early.g - before.g) + Mathf.Abs(early.b - before.b), 0.15f, "ilk karelerde sıçrama olmamalı");
        yield return Wait(0.75f);
        Shoot("palet-gecis-ortasi");
        var midC = HudTheme.Accent;
        Assert.AreNotEqual(before, midC); Assert.AreNotEqual(HudPalette.Accent("ember"), midC);
        yield return Wait(1.2f);
        Assert.AreEqual(HudPalette.Accent("ember").r, HudTheme.Accent.r, 0.01f);
    }

    [UnityTest, Category("Screenshot")]
    public IEnumerator Tabs_All()
    {
        Setup();
        yield return null;
        _hud.Build();
        _hud.OnSnapshotJson(Sample());
        yield return Wait(1.8f);
        foreach (var tab in new[] { "workshop", "comms", "overview" })
        {
            _hud.OnSnapshotJson(Sample().Replace("\"tab\": \"overview\"", "\"tab\": \"" + tab + "\""));
            yield return Wait(2.2f);
            Assert.AreEqual(tab, _hud.CurrentTab);
            Shoot("sekme-" + tab);
        }
    }

    [UnityTest, Category("Screenshot")]
    public IEnumerator Menu_Oto_Selected()
    {
        Setup();
        yield return null;
        _hud.Build();
        _hud.OnSnapshotJson(Sample());       // paletteMode: auto
        yield return Wait(1.5f);
        _hud.PreviewMenuAt(new Vector3(-0.12f, 1.4f, 0.5f), Quaternion.identity);
        yield return Wait(0.8f);
        _cam.fieldOfView = 40f;
        Shoot("avuc-menu-oto");
    }
}
#endif
