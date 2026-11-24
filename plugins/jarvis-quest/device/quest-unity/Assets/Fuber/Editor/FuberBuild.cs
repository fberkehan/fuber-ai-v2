// APK derleme (toplu kip, -executeMethod Fuber.Editor.FuberBuild.BuildApk). Çıktı: <proje>/../build/FuberQuest.apk.
// Geliştirme derlemesi (hata ayıklanabilir). Android modülü bu makinede kurulu. Başarısızlık toplu kip çıkış
// koduna yansır; log'da neden görünür.

using System.IO;
using UnityEditor;
using UnityEditor.Build.Reporting;
using UnityEngine;

namespace Fuber.Editor
{
    public static class FuberBuild
    {
        public static void BuildApk()
        {
            Debug.Log("[FuberBuild] Android'e geçiliyor...");
            EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.Android, BuildTarget.Android);

            string outDir = Path.GetFullPath(Path.Combine(Application.dataPath, "..", "..", "build"));
            Directory.CreateDirectory(outDir);
            string apk = Path.Combine(outDir, "FuberQuest.apk");

            var scenes = new[] { FuberSetup.ScenePath };
            var opts = new BuildPlayerOptions
            {
                scenes = scenes,
                locationPathName = apk,
                target = BuildTarget.Android,
                targetGroup = BuildTargetGroup.Android,
                options = BuildOptions.Development | BuildOptions.AllowDebugging,
            };

            Debug.Log($"[FuberBuild] APK derleniyor → {apk}");
            BuildReport report = BuildPipeline.BuildPlayer(opts);
            var summary = report.summary;
            Debug.Log($"[FuberBuild] Sonuç: {summary.result}, süre: {summary.totalTime}, hata: {summary.totalErrors}, boyut: {summary.totalSize} bayt");
            if (summary.result != BuildResult.Succeeded)
            {
                Debug.LogError("[FuberBuild] APK derlemesi BAŞARISIZ.");
                EditorApplication.Exit(2);
            }
            else
            {
                Debug.Log("[FuberBuild] APK derlemesi BAŞARILI: " + apk);
                EditorApplication.Exit(0);
            }
        }
    }
}
