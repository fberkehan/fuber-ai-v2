// JARVIS HUD veri modeli ve ayrıştırıcı (docs/PROTOCOL.md §7 ile birebir).
// Kurallar:
//  • Ayrıştırıcı ASLA istisna fırlatmaz; bozuk JSON → null, eksik/yanlış tipli alan → varsayılan (sayılar için null).
//  • Fazla (bilinmeyen) alanlar yok sayılır.
//  • "Yok" ile "0" karıştırılmaz: sayısal alanlar float? tutulur → arayüz null'ı asla sayıya çevirmez.

using System;
using System.Collections.Generic;
using System.Globalization;
using UnityEngine;

namespace Fuber.Net
{
    public enum HudStatus { Ok, Stale, Off }

    public sealed class HudClock { public string Time = "", Date = "", Tz = "", Place = ""; }

    public sealed class HudHourly { public string Time = ""; public float? TempC; }

    public sealed class HudEnv
    {
        public HudStatus Status = HudStatus.Off;
        public string Place = "", Condition = "", WindDir = "";
        public float? Lat, Lon, TempC, WindKmh, Humidity, VisibilityKm, Uv;
        public List<HudHourly> Hourly = new List<HudHourly>();
    }

    public sealed class HudCalItem { public string Ref = "", Time = "", Title = "", Place = ""; public bool Current; }

    public sealed class HudCal
    {
        public HudStatus Status = HudStatus.Off;
        public float? NextInSec;
        public List<HudCalItem> Items = new List<HudCalItem>();
    }

    public sealed class HudBio
    {
        public HudStatus Status = HudStatus.Off;   // live → Ok
        public string Source = "none";
        public bool Worn;
        public float? Battery, Hr, Spo2, Steps, Kcal, SkinTemp, Stress, SleepMin, LastSampleAgoSec;
        public List<float> HrSeries = new List<float>();
    }

    public sealed class HudCoreInfo
    {
        public string Label = "", Value = "", Unit = "", Sub = "";
        public float? Cpu, Gpu, Ram, Vram, TempC;
        // opsiyonel ayrıntı (ATÖLYE sekmesi)
        public List<float> CpuSeries = new List<float>(), GpuSeries = new List<float>(), RamSeries = new List<float>(), Cores = new List<float>();
        public float? RamUsedGb, RamTotalGb, VramUsedGb, VramTotalGb, UptimeSec;
        public string GpuName = "", TempSource = "";
    }

    public sealed class HudVoice
    {
        public string State = "idle";   // idle | listening | thinking | speaking
        public string Text = "";
    }

    public sealed class HudLoad
    {
        public float? Score;            // 0..100
        public string Level = "";       // calm | normal | busy | critical
        public List<string> Reasons = new List<string>();
    }

    public sealed class HudJob { public string Id = "", Title = "", ModuleId = "", Status = ""; public long StartedAt; }

    public sealed class HudNotice { public string Ref = "", Ts = "", Title = "", Body = "", ModuleId = ""; public bool Pending; }

    /// <summary>hud.voice (~15 Hz): durum + 0..1 ses düzeyi. Düzey yoksa (eski PC) null: arayüz seviye UYDURMAZ.</summary>
    public sealed class HudVoiceMessage { public string State = "idle"; public float? Level; }

    public sealed class HudFinItem
    {
        public string Sym = "", Name = "", Currency = "";
        public float? Price, ChangePct;
        public List<float> Series = new List<float>();
    }

    public sealed class HudFin
    {
        public HudStatus Status = HudStatus.Off;
        public bool MarketOpen;
        public string Focus = "";
        public List<HudFinItem> Items = new List<HudFinItem>();
    }

    public sealed class HudLinkItem
    {
        public string Id = "", Name = "", Kind = "", Detail = "";
        public float? LatencyMs;
        public float Quality;   // 0..1
        public bool Up;
    }

    public sealed class HudLinks
    {
        public HudStatus Status = HudStatus.Off;
        public int Linked, Total;
        public List<HudLinkItem> Items = new List<HudLinkItem>();
    }

    public sealed class HudLogEntry
    {
        public string Ts = "", Tag = "", Text = "", Ref = "";
    }

    public sealed class HudSnapshot
    {
        public long Ts;
        public string Greeting = "", Summary = "", Palette = "cyan", Tab = "overview";
        public string PaletteMode = "";            // "auto" | "manual" ("" = PC bildirmedi)
        public HudVoice Voice = new HudVoice();
        public HudLoad Load = new HudLoad();
        public List<HudJob> Jobs = new List<HudJob>();
        public List<HudNotice> Notices = new List<HudNotice>();
        public bool HasVoice, HasLoad, HasJobs, HasNotices;
        public HudClock Clock = new HudClock();
        public HudEnv Env = new HudEnv();
        public HudCal Cal = new HudCal();
        public HudBio Bio = new HudBio();
        public HudCoreInfo Core = new HudCoreInfo();
        public HudFin Fin = new HudFin();
        public HudLinks Links = new HudLinks();
        public List<HudLogEntry> Log = new List<HudLogEntry>();

        // Hangi bölümlerin gerçekten mesajda bulunduğu (yoksa "BAĞLI DEĞİL" gösterilir, sahte veri değil).
        public bool HasEnv, HasCal, HasBio, HasCore, HasFin, HasLinks;

        /// <summary>Tam mesajdan (<c>{"t":"hud.snapshot","seq":n,"data":{…}}</c>) ya da yalnız veri nesnesinden ayrıştırır. Bozuksa null.</summary>
        public static HudSnapshot ParseMessage(string json)
        {
            try
            {
                var root = MiniJson.ParseObject(json);
                if (root == null) return null;
                if (root.TryGetValue("data", out var d) && d is Dictionary<string, object> dd) return FromDict(dd);
                if (root.ContainsKey("t") && !root.ContainsKey("ts")) return null; // veri taşımayan başka ileti
                return FromDict(root);
            }
            catch (Exception) { return null; }
        }

        public static HudSnapshot FromDict(Dictionary<string, object> m)
        {
            if (m == null) return null;
            var s = new HudSnapshot
            {
                Ts = J.Long(m, "ts"),
                Greeting = J.Str(m, "greeting"),
                Summary = J.Str(m, "summary"),
                Palette = J.Str(m, "palette", "cyan"),
                Tab = J.Str(m, "tab", "overview"),
                PaletteMode = J.Str(m, "paletteMode"),
            };

            var voice = J.Obj(m, "voice");
            if (voice != null) { s.HasVoice = true; s.Voice.State = NormVoice(J.Str(voice, "state")); s.Voice.Text = J.Str(voice, "text"); }
            var load = J.Obj(m, "load");
            if (load != null)
            {
                s.HasLoad = true;
                s.Load.Score = J.Num(load, "score");
                if (s.Load.Score.HasValue) s.Load.Score = Mathf.Clamp(s.Load.Score.Value, 0f, 100f);
                s.Load.Level = J.Str(load, "level");
                if (load.TryGetValue("reasons", out var rs) && rs is List<object> rl)
                    foreach (var r in rl) if (r is string rstr) s.Load.Reasons.Add(rstr);
            }
            if (m.TryGetValue("jobs", out var jv) && jv is List<object>)
            {
                s.HasJobs = true;
                foreach (var i in J.Objs(m, "jobs"))
                    s.Jobs.Add(new HudJob { Id = J.Str(i, "id"), Title = J.Str(i, "title"), ModuleId = J.Str(i, "moduleId"), Status = J.Str(i, "status"), StartedAt = J.Long(i, "startedAt") });
            }
            if (m.TryGetValue("notices", out var nv) && nv is List<object>)
            {
                s.HasNotices = true;
                foreach (var i in J.Objs(m, "notices"))
                    s.Notices.Add(new HudNotice { Ref = J.Str(i, "ref"), Ts = J.Str(i, "ts"), Title = J.Str(i, "title"), Body = J.Str(i, "body"), ModuleId = J.Str(i, "moduleId"), Pending = J.Bool(i, "pending") });
            }

            var clock = J.Obj(m, "clock");
            if (clock != null)
                s.Clock = new HudClock { Time = J.Str(clock, "time"), Date = J.Str(clock, "date"), Tz = J.Str(clock, "tz"), Place = J.Str(clock, "place") };

            var env = J.Obj(m, "env");
            if (env != null)
            {
                s.HasEnv = true;
                var e = s.Env;
                e.Status = J.Status(env, "status");
                e.Place = J.Str(env, "place"); e.Condition = J.Str(env, "condition"); e.WindDir = J.Str(env, "windDir");
                e.Lat = J.Num(env, "lat"); e.Lon = J.Num(env, "lon"); e.TempC = J.Num(env, "tempC");
                e.WindKmh = J.Num(env, "windKmh"); e.Humidity = J.Num(env, "humidity");
                e.VisibilityKm = J.Num(env, "visibilityKm"); e.Uv = J.Num(env, "uv");
                foreach (var h in J.Objs(env, "hourly"))
                    e.Hourly.Add(new HudHourly { Time = J.Str(h, "time"), TempC = J.Num(h, "tempC") });
            }

            var cal = J.Obj(m, "cal");
            if (cal != null)
            {
                s.HasCal = true;
                s.Cal.Status = J.Status(cal, "status");
                s.Cal.NextInSec = J.Num(cal, "nextInSec");
                foreach (var i in J.Objs(cal, "items"))
                    s.Cal.Items.Add(new HudCalItem { Ref = J.Str(i, "ref"), Time = J.Str(i, "time"), Title = J.Str(i, "title"), Place = J.Str(i, "place"), Current = J.Bool(i, "current") });
            }

            var bio = J.Obj(m, "bio");
            if (bio != null)
            {
                s.HasBio = true;
                var b = s.Bio;
                b.Status = J.Status(bio, "status");
                b.Source = J.Str(bio, "source", "none"); b.Worn = J.Bool(bio, "worn");
                b.Battery = J.Num(bio, "battery"); b.Hr = J.Num(bio, "hr"); b.Spo2 = J.Num(bio, "spo2");
                b.Steps = J.Num(bio, "steps"); b.Kcal = J.Num(bio, "kcal"); b.SkinTemp = J.Num(bio, "skinTemp");
                b.Stress = J.Num(bio, "stress"); b.SleepMin = J.Num(bio, "sleepMin"); b.LastSampleAgoSec = J.Num(bio, "lastSampleAgoSec");
                b.HrSeries = J.NumList(bio, "hrSeries");
            }

            var core = J.Obj(m, "core");
            if (core != null)
            {
                s.HasCore = true;
                var c = s.Core;
                c.Label = J.Str(core, "label"); c.Value = J.Str(core, "value"); c.Unit = J.Str(core, "unit"); c.Sub = J.Str(core, "sub");
                c.CpuSeries = J.NumList(core, "cpuSeries"); c.GpuSeries = J.NumList(core, "gpuSeries"); c.RamSeries = J.NumList(core, "ramSeries"); c.Cores = J.NumList(core, "cores");
                c.RamUsedGb = J.Num(core, "ramUsedGb"); c.RamTotalGb = J.Num(core, "ramTotalGb"); c.VramUsedGb = J.Num(core, "vramUsedGb"); c.VramTotalGb = J.Num(core, "vramTotalGb");
                c.UptimeSec = J.Num(core, "uptimeSec"); c.GpuName = J.Str(core, "gpuName"); c.TempSource = J.Str(core, "tempSource");
                c.Cpu = J.Num(core, "cpu"); c.Gpu = J.Num(core, "gpu"); c.Ram = J.Num(core, "ram"); c.Vram = J.Num(core, "vram"); c.TempC = J.Num(core, "tempC");
            }

            var fin = J.Obj(m, "fin");
            if (fin != null)
            {
                s.HasFin = true;
                s.Fin.Status = J.Status(fin, "status");
                s.Fin.MarketOpen = J.Bool(fin, "marketOpen");
                s.Fin.Focus = J.Str(fin, "focus");
                foreach (var i in J.Objs(fin, "items"))
                    s.Fin.Items.Add(new HudFinItem { Sym = J.Str(i, "sym"), Name = J.Str(i, "name"), Currency = J.Str(i, "currency"), Price = J.Num(i, "price"), ChangePct = J.Num(i, "changePct"), Series = J.NumList(i, "series") });
            }

            var links = J.Obj(m, "links");
            if (links != null)
            {
                s.HasLinks = true;
                s.Links.Status = J.Status(links, "status");
                s.Links.Linked = (int)(J.Num(links, "linked") ?? 0);
                s.Links.Total = (int)(J.Num(links, "total") ?? 0);
                foreach (var i in J.Objs(links, "items"))
                    s.Links.Items.Add(new HudLinkItem { Id = J.Str(i, "id"), Name = J.Str(i, "name"), Kind = J.Str(i, "kind"), Detail = J.Str(i, "detail"), LatencyMs = J.Num(i, "latencyMs"), Quality = Clamp01(J.Num(i, "quality") ?? 0f), Up = J.Bool(i, "up") });
            }

            foreach (var l in J.Objs(m, "log")) s.Log.Add(ParseLogDict(l));
            return s;
        }

        /// <summary><c>{"t":"hud.log","entry":{…}}</c> iletisinden satır; bozuksa null.</summary>
        public static HudLogEntry ParseLogMessage(string json)
        {
            try
            {
                var root = MiniJson.ParseObject(json);
                var e = root != null ? J.Obj(root, "entry") : null;
                return e != null ? ParseLogDict(e) : null;
            }
            catch (Exception) { return null; }
        }

        public static string NormVoice(string st)
        {
            switch (st) { case "listening": case "thinking": case "speaking": return st; default: return "idle"; }
        }

        /// <summary>{"t":"hud.voice","state":"speaking","level":0.42}; bozuksa null. Düzey yoksa Level null (NaN null olur, [0,1]'e kıstırılır).</summary>
        public static HudVoiceMessage ParseVoiceMessage(string json)
        {
            try
            {
                var root = MiniJson.ParseObject(json);
                if (root == null || !root.ContainsKey("state")) return null;
                var v = new HudVoiceMessage { State = NormVoice(J.Str(root, "state")) };
                var lv = J.Num(root, "level");
                if (lv.HasValue) v.Level = Mathf.Clamp01(lv.Value);
                return v;
            }
            catch (Exception) { return null; }
        }

        private static HudLogEntry ParseLogDict(Dictionary<string, object> l) =>
            new HudLogEntry { Ts = J.Str(l, "ts"), Tag = J.Str(l, "tag"), Text = J.Str(l, "text"), Ref = J.Str(l, "ref") };

        private static float Clamp01(float v) => v < 0f ? 0f : v > 1f ? 1f : v;
    }

    /// <summary>Quest → PC eylem iletileri (sözleşme: hud.action).</summary>
    public static class HudActions
    {
        public static readonly string[] Tabs = { "overview", "workshop", "comms" };
        public static readonly string[] Palettes = { "cyan", "blue", "ember", "ice" };

        public static Dictionary<string, object> Tab(string tab) => Make("tab", "tab", tab);
        public const string PaletteAuto = "auto";
        public static Dictionary<string, object> Palette(string palette) => Make("palette", "palette", palette);
        public static Dictionary<string, object> Open(string @ref) => Make("open", "ref", @ref);
        public static Dictionary<string, object> Stop() => Make("stop", null, null);

        private static Dictionary<string, object> Make(string action, string key, string val)
        {
            var d = new Dictionary<string, object> { { "t", "hud.action" }, { "action", action } };
            if (key != null) d[key] = val;
            return d;
        }
    }

    /// <summary>MiniJson sonuçlarından güvenli (istisnasız) okuma yardımcıları.</summary>
    internal static class J
    {
        public static Dictionary<string, object> Obj(Dictionary<string, object> m, string k) =>
            m != null && m.TryGetValue(k, out var v) ? v as Dictionary<string, object> : null;

        public static IEnumerable<Dictionary<string, object>> Objs(Dictionary<string, object> m, string k)
        {
            if (m == null || !m.TryGetValue(k, out var v) || !(v is List<object> list)) yield break;
            foreach (var o in list) if (o is Dictionary<string, object> d) yield return d;
        }

        public static string Str(Dictionary<string, object> m, string k, string def = "")
        {
            if (m == null || !m.TryGetValue(k, out var v) || v == null) return def;
            if (v is string s) return s;
            if (v is bool b) return b ? "true" : "false";
            if (v is long l) return l.ToString(CultureInfo.InvariantCulture);
            if (v is double d) return d.ToString("0.###", CultureInfo.InvariantCulture);
            return def;
        }

        public static float? Num(Dictionary<string, object> m, string k)
        {
            if (m == null || !m.TryGetValue(k, out var v) || v == null) return null;
            float f;
            if (v is long l) f = l;
            else if (v is double d) f = (float)d;
            else if (v is string s && float.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var p)) f = p;
            else return null;
            return float.IsNaN(f) || float.IsInfinity(f) ? (float?)null : f;
        }

        public static long Long(Dictionary<string, object> m, string k)
        {
            if (m == null || !m.TryGetValue(k, out var v) || v == null) return 0;
            if (v is long l) return l;
            if (v is double d && !double.IsNaN(d) && !double.IsInfinity(d) && Math.Abs(d) < 9e18) return (long)d;
            return 0;
        }

        public static bool Bool(Dictionary<string, object> m, string k) =>
            m != null && m.TryGetValue(k, out var v) && (v is bool b ? b : v is long l && l != 0);

        public static List<float> NumList(Dictionary<string, object> m, string k)
        {
            var res = new List<float>();
            if (m == null || !m.TryGetValue(k, out var v) || !(v is List<object> list)) return res;
            foreach (var o in list)
            {
                if (o is long l) res.Add(l);
                else if (o is double d && !double.IsNaN(d) && !double.IsInfinity(d)) res.Add((float)d);
            }
            return res;
        }

        public static HudStatus Status(Dictionary<string, object> m, string k)
        {
            switch (Str(m, k))
            {
                case "ok": case "live": return HudStatus.Ok;
                case "stale": return HudStatus.Stale;
                default: return HudStatus.Off; // bilinmeyen/eksik → güvenli taraf: BAĞLI DEĞİL
            }
        }
    }
}

namespace Fuber.Net
{
    /// <summary>HUD paletleri ve yumuşak geçiş matematiği (test edilebilir).</summary>
    public static class HudPalette
    {
        public static readonly string[] Names = { "cyan", "blue", "ember", "ice" };

        public static string Normalize(string name)
        {
            foreach (var n in Names) if (n == name) return n;
            return "cyan";
        }

        public static Color Accent(string name)
        {
            switch (name)
            {
                case "blue": return new Color(0.4f, 0.6f, 1f);
                case "ember": return new Color(1f, 0.56f, 0.2f);
                case "ice": return new Color(0.82f, 0.94f, 1f);
                default: return new Color(0.25f, 0.88f, 1f);
            }
        }

        /// <summary>Smoothstep: 0..1 → 0..1, uçlarda sıfır eğim (renk sıçraması yok).</summary>
        public static float Ease(float t) { t = Mathf.Clamp01(t); return t * t * (3f - 2f * t); }

        public static Color Blend(Color from, Color to, float t) => Color.Lerp(from, to, Ease(t));
    }
}
