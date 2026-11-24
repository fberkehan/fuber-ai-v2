// JARVIS HUD snapshot ayrıştırıcı testleri. Örnek JSON sözleşmeden (docs/hud-snapshot-ornek.json) üretilir.
// Ayrıştırıcı eksik/fazla/yanlış tipli alanlarda ve bozuk JSON'da ÇÖKMEMELİ; "yok" ile "0" karıştırılmamalı.

using System.Collections.Generic;
using System.IO;
using Fuber.Net;
using NUnit.Framework;
using UnityEngine;

public class HudSnapshotTests
{
    private static string Sample()
    {
        string[] candidates =
        {
            Path.Combine(Application.dataPath, "..", "..", "..", "docs", "hud-snapshot-ornek.json"),   // plugins/jarvis-quest/docs
        };
        foreach (var c in candidates) if (File.Exists(c)) return File.ReadAllText(c);
        Assert.Fail("docs/hud-snapshot-ornek.json bulunamadı");
        return null;
    }

    [Test]
    public void FullSample_ParsesEveryContractSection()
    {
        var s = HudSnapshot.ParseMessage(Sample());
        Assert.IsNotNull(s);
        Assert.AreEqual(1763460300000L, s.Ts);
        Assert.AreEqual("Günaydın, efendim.", s.Greeting);
        Assert.AreEqual("cyan", s.Palette);
        Assert.AreEqual("overview", s.Tab);
        Assert.AreEqual("15:45:54", s.Clock.Time);

        Assert.IsTrue(s.HasEnv); Assert.AreEqual(HudStatus.Ok, s.Env.Status);
        Assert.AreEqual(12.4f, s.Env.TempC.Value, 1e-3f);
        Assert.AreEqual(5, s.Env.Hourly.Count);
        Assert.AreEqual("KB", s.Env.WindDir);

        Assert.IsTrue(s.HasCal); Assert.AreEqual(6, s.Cal.Items.Count);
        Assert.AreEqual(2529f, s.Cal.NextInSec.Value);
        Assert.IsTrue(s.Cal.Items[1].Current); Assert.AreEqual("cal:2", s.Cal.Items[1].Ref);

        Assert.IsTrue(s.HasBio); Assert.AreEqual(HudStatus.Ok, s.Bio.Status);   // "live" → Ok
        Assert.AreEqual(73f, s.Bio.Hr.Value); Assert.AreEqual(7, s.Bio.HrSeries.Count);
        Assert.AreEqual(33.1f, s.Bio.SkinTemp.Value, 1e-3f); Assert.IsTrue(s.Bio.Worn);

        Assert.IsTrue(s.HasCore); Assert.AreEqual(37f, s.Core.Cpu.Value); Assert.AreEqual("37", s.Core.Value);
        Assert.AreEqual("GPU 61% · RAM 48%", s.Core.Sub);

        Assert.IsTrue(s.HasFin); Assert.IsTrue(s.Fin.MarketOpen); Assert.AreEqual("BIST100", s.Fin.Focus);
        Assert.AreEqual(4, s.Fin.Items.Count); Assert.AreEqual(12, s.Fin.Items[0].Series.Count);
        Assert.AreEqual(-0.34f, s.Fin.Items[2].ChangePct.Value, 1e-4f);

        Assert.IsTrue(s.HasLinks); Assert.AreEqual(5, s.Links.Linked); Assert.AreEqual(6, s.Links.Total);
        Assert.IsNull(s.Links.Items[5].LatencyMs);        // null → "yok", sıfır DEĞİL
        Assert.IsFalse(s.Links.Items[5].Up);
        Assert.AreEqual(0.9f, s.Links.Items[1].Quality, 1e-4f);

        Assert.AreEqual(6, s.Log.Count); Assert.AreEqual("log:5", s.Log[0].Ref); Assert.AreEqual("", s.Log[1].Ref);
    }

    [Test]
    public void DataObjectWithoutEnvelope_AlsoParses()
    {
        var s = HudSnapshot.ParseMessage("{\"ts\":5,\"greeting\":\"Merhaba\",\"palette\":\"ember\"}");
        Assert.IsNotNull(s);
        Assert.AreEqual("Merhaba", s.Greeting);
        Assert.AreEqual("ember", s.Palette);
    }

    [Test]
    public void MissingSections_AreMarkedAbsent_NoFakeNumbers()
    {
        var s = HudSnapshot.ParseMessage("{\"t\":\"hud.snapshot\",\"seq\":1,\"data\":{\"ts\":1,\"greeting\":\"x\"}}");
        Assert.IsNotNull(s);
        Assert.IsFalse(s.HasEnv); Assert.IsFalse(s.HasCal); Assert.IsFalse(s.HasBio); Assert.IsFalse(s.HasCore);
        Assert.IsFalse(s.HasFin); Assert.IsFalse(s.HasLinks);
        Assert.AreEqual(HudStatus.Off, s.Env.Status);
        Assert.IsNull(s.Env.TempC); Assert.IsNull(s.Bio.Hr); Assert.IsNull(s.Core.Cpu);
    }

    [Test]
    public void NullAndMissingNumbers_StayNull_ZeroStaysZero()
    {
        var s = HudSnapshot.ParseMessage("{\"data\":{\"bio\":{\"status\":\"stale\",\"hr\":null,\"spo2\":0,\"steps\":0}}}");
        Assert.IsNotNull(s);
        Assert.AreEqual(HudStatus.Stale, s.Bio.Status);
        Assert.IsNull(s.Bio.Hr);
        Assert.IsNull(s.Bio.Kcal);                 // alan hiç yok
        Assert.AreEqual(0f, s.Bio.Spo2.Value);     // gerçek sıfır
        Assert.AreEqual(0f, s.Bio.Steps.Value);
    }

    [Test]
    public void UnknownOrMissingStatus_FailsSafeToOff()
    {
        var s = HudSnapshot.ParseMessage("{\"data\":{\"env\":{\"status\":\"weird\",\"tempC\":5},\"fin\":{\"marketOpen\":true}}}");
        Assert.AreEqual(HudStatus.Off, s.Env.Status);
        Assert.AreEqual(HudStatus.Off, s.Fin.Status);
    }

    [Test]
    public void ExtraUnknownFields_AreIgnored()
    {
        var s = HudSnapshot.ParseMessage("{\"data\":{\"ts\":1,\"yeniAlan\":{\"a\":[1,2,3]},\"env\":{\"status\":\"ok\",\"tempC\":3,\"ekstra\":\"x\",\"hourly\":[{\"time\":\"1\",\"tempC\":1,\"foo\":9}]}}}");
        Assert.IsNotNull(s);
        Assert.AreEqual(3f, s.Env.TempC.Value);
        Assert.AreEqual(1, s.Env.Hourly.Count);
    }

    [Test]
    public void WrongTypes_DoNotThrow()
    {
        string json = "{\"data\":{\"ts\":\"abc\",\"greeting\":12,\"clock\":\"şu\",\"env\":{\"status\":5,\"tempC\":\"12.5\",\"hourly\":\"yok\"},"
                    + "\"cal\":{\"items\":[1,2,{\"title\":7}]},\"bio\":{\"hrSeries\":[1,\"a\",2.5,null]},\"links\":{\"items\":{\"x\":1},\"linked\":\"3\"},"
                    + "\"log\":{\"a\":1}}}";
        HudSnapshot s = null;
        Assert.DoesNotThrow(() => s = HudSnapshot.ParseMessage(json));
        Assert.IsNotNull(s);
        Assert.AreEqual("12", s.Greeting);
        Assert.AreEqual(12.5f, s.Env.TempC.Value, 1e-4f);   // sayı-dize kabul
        Assert.AreEqual(0, s.Env.Hourly.Count);
        Assert.AreEqual(1, s.Cal.Items.Count);               // yalnız nesne olan öğe
        Assert.AreEqual(2, s.Bio.HrSeries.Count);            // yalnız sayılar
        Assert.AreEqual(3, s.Links.Linked);
        Assert.AreEqual(0, s.Log.Count);
    }

    [Test]
    public void BrokenJsonAndNonObjects_ReturnNull_NeverThrow()
    {
        string[] bad = { null, "", "   ", "{", "{\"data\":", "[1,2,3]", "\"x\"", "123", "not json", "{\"data\":{\"env\":{\"tempC\":}}}", "{\"t\":\"hud.log\",\"entry\":{}}" };
        foreach (var b in bad)
        {
            HudSnapshot s = HudSnapshot.FromDict(null);
            Assert.DoesNotThrow(() => s = HudSnapshot.ParseMessage(b), "girdi: " + b);
            Assert.IsNull(s, "girdi: " + b);
        }
    }

    [Test]
    public void InfinityAndHugeNumbers_NeverBecomeValues()
    {
        var s = HudSnapshot.ParseMessage("{\"data\":{\"core\":{\"cpu\":1e999,\"ram\":-1e999}}}");
        Assert.IsNotNull(s);
        Assert.IsNull(s.Core.Cpu);
        Assert.IsNull(s.Core.Ram);
    }

    [Test]
    public void LogMessage_Parses_AndBrokenReturnsNull()
    {
        var e = HudSnapshot.ParseLogMessage("{\"t\":\"hud.log\",\"entry\":{\"ts\":\"07:44:05\",\"tag\":\"SAT\",\"text\":\"merhaba\",\"ref\":\"log:9\"}}");
        Assert.IsNotNull(e);
        Assert.AreEqual("SAT", e.Tag); Assert.AreEqual("log:9", e.Ref); Assert.AreEqual("merhaba", e.Text);
        Assert.IsNull(HudSnapshot.ParseLogMessage("{\"t\":\"hud.log\"}"));
        Assert.IsNull(HudSnapshot.ParseLogMessage("{{{"));
        Assert.IsNull(HudSnapshot.ParseLogMessage(null));
    }

    [Test]
    public void Actions_MatchContract()
    {
        Assert.AreEqual("{\"t\":\"hud.action\",\"action\":\"tab\",\"tab\":\"comms\"}", MiniJson.Serialize(HudActions.Tab("comms")));
        Assert.AreEqual("{\"t\":\"hud.action\",\"action\":\"palette\",\"palette\":\"ember\"}", MiniJson.Serialize(HudActions.Palette("ember")));
        Assert.AreEqual("{\"t\":\"hud.action\",\"action\":\"open\",\"ref\":\"cal:2\"}", MiniJson.Serialize(HudActions.Open("cal:2")));
        Assert.AreEqual("{\"t\":\"hud.action\",\"action\":\"stop\"}", MiniJson.Serialize(HudActions.Stop()));
        CollectionAssert.AreEqual(new[] { "overview", "workshop", "comms" }, HudActions.Tabs);
        CollectionAssert.AreEqual(new[] { "cyan", "blue", "ember", "ice" }, HudActions.Palettes);
    }

    [Test]
    public void PairMessage_CarriesKindQuest()
    {
        var cfg = new BridgeConfig { DeviceKey = new XrKeyPair(new byte[32], new byte[32]), PairPin = "123456" };
        var m = BridgeClient.BuildPairMessage(cfg);
        Assert.AreEqual("pair", m["t"]);
        Assert.AreEqual("quest", m["kind"]);
        var dev = (Dictionary<string, object>)m["device"];
        Assert.AreEqual("quest", dev["kind"]);
        Assert.AreEqual("Quest 3", dev["model"]);       // "model" Quest ile başlar (köprü türü buradan da çıkarır)
        Assert.AreEqual("123456", m["pin"]);
    }

    // ───────── 2. tur: voice / paletteMode / load / sekme verisi ─────────

    [Test]
    public void NewFields_VoiceLoadPaletteMode_Parse()
    {
        var s = HudSnapshot.ParseMessage(Sample());
        Assert.IsTrue(s.HasVoice); Assert.AreEqual("idle", s.Voice.State);
        Assert.AreEqual("auto", s.PaletteMode);
        Assert.IsTrue(s.HasLoad); Assert.AreEqual(62f, s.Load.Score.Value); Assert.AreEqual("busy", s.Load.Level);
        CollectionAssert.AreEqual(new[] { "CPU %37", "GPU %61", "2 iş çalışıyor" }, s.Load.Reasons);
        Assert.IsTrue(s.HasJobs); Assert.AreEqual(3, s.Jobs.Count); Assert.AreEqual("running", s.Jobs[0].Status);
        Assert.IsTrue(s.HasNotices); Assert.AreEqual(3, s.Notices.Count); Assert.IsTrue(s.Notices[0].Pending); Assert.AreEqual("notice:1", s.Notices[0].Ref);
        Assert.AreEqual(12, s.Core.CpuSeries.Count); Assert.AreEqual(16, s.Core.Cores.Count);
        Assert.AreEqual(15.4f, s.Core.RamUsedGb.Value, 1e-3f); Assert.AreEqual("RTX 4090", s.Core.GpuName);
    }

    [Test]
    public void OldSnapshotWithoutNewFields_StillParses_NoVoiceNoLoad()
    {
        var s = HudSnapshot.ParseMessage("{\"data\":{\"ts\":1,\"greeting\":\"x\",\"palette\":\"ice\"}}");
        Assert.IsNotNull(s);
        Assert.IsFalse(s.HasVoice); Assert.IsFalse(s.HasLoad); Assert.IsFalse(s.HasJobs); Assert.IsFalse(s.HasNotices);
        Assert.AreEqual("", s.PaletteMode);
        Assert.AreEqual("idle", s.Voice.State);
        Assert.IsNull(s.Load.Score);
    }

    [Test]
    public void VoiceAndLoad_BadValues_AreSanitized()
    {
        var s = HudSnapshot.ParseMessage("{\"data\":{\"voice\":{\"state\":\"dancing\",\"text\":5},\"load\":{\"score\":250,\"level\":7,\"reasons\":[1,\"a\",null]},\"jobs\":[1,{\"id\":3}],\"notices\":\"x\"}}");
        Assert.IsNotNull(s);
        Assert.AreEqual("idle", s.Voice.State);            // bilinmeyen durum → idle
        Assert.AreEqual(100f, s.Load.Score.Value);         // 0..100'e kıstırıldı
        CollectionAssert.AreEqual(new[] { "a" }, s.Load.Reasons);
        Assert.AreEqual(1, s.Jobs.Count);
        Assert.IsFalse(s.HasNotices);                      // dizi değil → yok
    }

    [Test]
    public void VoiceMessage_WithAndWithoutLevel()
    {
        var v = HudSnapshot.ParseVoiceMessage("{\"t\":\"hud.voice\",\"state\":\"speaking\",\"level\":0.42}");
        Assert.AreEqual("speaking", v.State); Assert.AreEqual(0.42f, v.Level.Value, 1e-4f);
        var old = HudSnapshot.ParseVoiceMessage("{\"t\":\"hud.voice\",\"state\":\"listening\"}");   // eski PC: düzey yok
        Assert.AreEqual("listening", old.State); Assert.IsNull(old.Level);                              // sahte seviye YOK
        Assert.AreEqual(1f, HudSnapshot.ParseVoiceMessage("{\"state\":\"speaking\",\"level\":7}").Level.Value);
        Assert.AreEqual(0f, HudSnapshot.ParseVoiceMessage("{\"state\":\"speaking\",\"level\":-3}").Level.Value);
        Assert.IsNull(HudSnapshot.ParseVoiceMessage("{\"state\":\"speaking\",\"level\":1e999}").Level);
        Assert.AreEqual("idle", HudSnapshot.ParseVoiceMessage("{\"state\":\"???\"}").State);
        Assert.IsNull(HudSnapshot.ParseVoiceMessage("{\"t\":\"hud.voice\"}"));
        Assert.IsNull(HudSnapshot.ParseVoiceMessage("{{"));
        Assert.IsNull(HudSnapshot.ParseVoiceMessage(null));
    }

    [Test]
    public void PaletteAuto_ActionMatchesContract()
    {
        Assert.AreEqual("{\"t\":\"hud.action\",\"action\":\"palette\",\"palette\":\"auto\"}", MiniJson.Serialize(HudActions.Palette(HudActions.PaletteAuto)));
    }

    [Test]
    public void PaletteInterpolation_IsSmoothAndExact()
    {
        var a = HudPalette.Accent("cyan"); var b = HudPalette.Accent("ember");
        Assert.AreEqual(a, HudPalette.Blend(a, b, 0f));
        Assert.AreEqual(b, HudPalette.Blend(a, b, 1f));
        Assert.AreEqual(a, HudPalette.Blend(a, b, -5f));      // dışarı taşma kıstırılır
        Assert.AreEqual(b, HudPalette.Blend(a, b, 9f));
        var mid = HudPalette.Blend(a, b, 0.5f);
        Assert.AreEqual((a.r + b.r) / 2f, mid.r, 1e-4f);      // smoothstep(0.5) = 0.5
        Assert.AreEqual((a.b + b.b) / 2f, mid.b, 1e-4f);
        // tek yönlü artış (monoton) ve uçlarda sıfır eğim → anlık sıçrama yok
        float prev = -1f;
        for (int i = 0; i <= 30; i++)
        {
            float e = HudPalette.Ease(i / 30f);
            Assert.GreaterOrEqual(e, prev); prev = e;
        }
        Assert.Less(HudPalette.Ease(0.02f), 0.002f);
        Assert.Greater(HudPalette.Ease(0.98f), 0.998f);
        // ardışık adımlar arasındaki en büyük renk sıçraması küçük (1.5 sn, 15 Hz ≈ 22 adım)
        float maxStep = 0f; var last = a;
        for (int i = 1; i <= 22; i++)
        {
            var c = HudPalette.Blend(a, b, i / 22f);
            maxStep = Mathf.Max(maxStep, Mathf.Abs(c.r - last.r), Mathf.Abs(c.g - last.g), Mathf.Abs(c.b - last.b));
            last = c;
        }
        Assert.Less(maxStep, 0.12f);
    }

    [Test]
    public void PaletteNames_AllKnown_UnknownFallsBackToCyan()
    {
        foreach (var n in new[] { "cyan", "blue", "ember", "ice" }) Assert.AreEqual(n, HudPalette.Normalize(n));
        Assert.AreEqual("cyan", HudPalette.Normalize("auto"));
        Assert.AreEqual("cyan", HudPalette.Normalize(null));
        Assert.AreNotEqual(HudPalette.Accent("blue"), HudPalette.Accent("ember"));
    }
}
