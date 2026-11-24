// ── Yedek ses: Piper (tr_TR-dfki-medium) — Görev 21 (K9): yerel beyinden BAĞIMSIZ ───────────────────────────────────────────────
// ElevenLabs anahtarı yokken ve Gizli modda Fuber bu sesle konuşur (her yerde aynı ses). Eskiden Piper yalnız yerel beyinle birlikte
// (9 GB'lık kurulumun parçası olarak %APPDATA%\Fuber AI\yerel\piper) iniyor, yerel beyin kaldırılınca siliniyordu. Artık yer sırası:
//   1. Pakette: kaynak/piper/ (piper.exe + tr_TR-dfki-medium.onnx + .onnx.json). Depoya eklenmedi (≈ 85 MB ikili; denetleyici kararı:
//      rapor) — paketleme adımı koyarsa kendiliğinden kullanılır.
//   2. Bağımsız kurulum: %APPDATA%\Fuber AI\ses\piper (Ayarlar → Ses → "Yedek sesi indir", ≈ 85 MB, SHA-256 doğrulamalı; yerel beyin
//      kurulumu da Piper'ı artık buraya indirir).
//   3. Eski yer: …\yerel\piper (0.8.0'da yerel beyinle kurulmuş). Açılışta bağımsız yere TAŞINIR (aynı disk: anında); taşınamazsa
//      yerinde kullanılır. Böylece yerel beyni kaldırmak sesi götürmez.
// Test: FUBER_DEMO + FUBER_TEST_PIPER (sahte piper, scripts/dev/sahte-piper.mjs) → ayrı bir Node süreciyle çalıştırılır: komut dizisi
// (JSON, ör. ["node", "<sahte-piper.mjs>"]) ya da yalnız betik yolu (→ ["node", yol]). 0.12 H6: Electron sigortalarında RunAsNode KAPALI —
// uygulamanın kendi exe'si Node olarak çalıştırılmaz (kaynakta o ortam değişkeni yok; tests/ses-akis.test.ts). Gerçek piper.exe yolu aynen.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { app } from 'electron';
import { yollar } from '../yollar.js';
import { indir, hazirMi, zipAc, dosyaBul } from '../indirme.js';
import { PIPER, type Varlik } from './paketler.js';
import { sureciKapat } from './kaldirma.js';
import { PiperSureci, type PiperYollari } from '../ses/piper-surec.js';

export const yedekKlasoru = () => path.join(yollar.veri(), 'ses', 'piper');
const eskiKlasor = () => path.join(process.env.FUBER_MODEL_DIZINI || path.join(app.getPath('userData'), 'yerel'), 'piper');
const paketKlasoru = () => yollar.kaynak('piper');
/** Sahte Piper komutu (yalnız FUBER_DEMO): [çalıştırıcı, ...argümanlar]; yoksa null. */
function testKomutu(): string[] | null {
  const h = process.env.FUBER_DEMO && process.env.FUBER_TEST_PIPER ? process.env.FUBER_TEST_PIPER : '';
  if (!h) return null;
  try {
    const d: unknown = JSON.parse(h);
    if (Array.isArray(d) && d.length > 0 && d.every((x) => typeof x === 'string' && x)) return d as string[];
  } catch { /* düz betik yolu */ }
  return ['node', h];
}

/** Klasördeki piper.exe + Türkçe ses (ikisi de varsa). */
function klasordeki(k: string, tamamGerekir: boolean): PiperYollari | null {
  try {
    if (!fs.existsSync(k) || (tamamGerekir && !fs.existsSync(path.join(k, '.tamam')))) return null;
    const ses = path.join(k, PIPER.ses.ad);
    if (!fs.existsSync(ses) || !fs.existsSync(path.join(k, PIPER.sesAyari.ad))) return null;
    const calistirici = dosyaBul(k, /^piper\.exe$/i);
    return calistirici ? { calistirici, ses } : null;
  } catch { return null; }
}

let tasindi = false;
/** 0.8.0'da yerel beyinle kurulmuş Piper'ı bağımsız yere taşır (oturumda bir kez; süreç açılmadan önce). `zorla`: yerel beyin
 *  kaldırılırken süreçler kapandıktan sonra yeniden dene. */
export function eskiyiTasi(zorla = false): void {
  if (tasindi && !zorla) return;
  tasindi = true;
  try {
    const eski = eskiKlasor(), yeni = yedekKlasoru();
    if (!klasordeki(eski, true) || klasordeki(yeni, true)) return;
    fs.mkdirSync(path.dirname(yeni), { recursive: true });
    if (fs.existsSync(yeni)) fs.rmSync(yeni, { recursive: true, force: true });
    fs.renameSync(eski, yeni);
    console.info('[ses] yedek ses yerel modelden bağımsız klasöre taşındı');
  } catch (e) { console.warn('[ses] yedek ses taşınamadı, eski yerinde kullanılıyor:', (e as Error).message); }
}

export function piperYollari(): PiperYollari | null {
  eskiyiTasi();
  const test = testKomutu();
  if (test) return { calistirici: test[0], ses: PIPER.ses.ad };
  return klasordeki(paketKlasoru(), false) ?? klasordeki(yedekKlasoru(), true) ?? klasordeki(eskiKlasor(), true);
}

export const piperHazirMi = () => Boolean(piperYollari());

const surec = new PiperSureci(piperYollari, (komut, argumanlar, o) => {
  const test = testKomutu();
  if (test) return spawn(test[0], [...test.slice(1), ...argumanlar], { cwd: path.dirname(test[test.length - 1]), windowsHide: true });
  return spawn(komut, argumanlar, { cwd: o.cwd, windowsHide: true });
});

/** Konuşma oturumunun yedek ses üreticisi (cümle → PCM 22,05 kHz). */
export const yedekPcm = (metin: string, hiz: number, sinyal?: AbortSignal) => surec.pcm(metin, hiz, sinyal);

/** Yerel beynin "Dene"si: tek cümlenin WAV'ı. */
export const piperWav = (metin: string) => surec.wav(metin, 1);

export function piperKapat(): void { surec.kapat(); }

/** Piper'ı kapatır ve çıkışını bekler (klasör silinirken/taşınırken çalışan piper.exe kilitler). */
export async function piperKapatBekle(): Promise<void> { await sureciKapat(surec.kapat()); }

// ── Bağımsız kurulum ("Yedek sesi indir") ──
let indirme: { yuzde: number; adim: string; hata?: string } | undefined;
let suren: Promise<void> | null = null;
let bildir: () => void = () => undefined;
export const yedekBildirici = (f: () => void) => { bildir = f; };
export const yedekIndirmeDurumu = () => indirme;
export const YEDEK_BOYUT = PIPER.calistirici.boyut + PIPER.ses.boyut + PIPER.sesAyari.boyut;

export function yedekSesKur(): Promise<void> {
  if (piperHazirMi()) return Promise.resolve();
  suren ??= (async () => {
    const k = yedekKlasoru();
    const indirilen = path.join(path.dirname(k), 'indirilen');
    try {
      fs.mkdirSync(k, { recursive: true });
      fs.mkdirSync(indirilen, { recursive: true });
      const isler: [Varlik, string, string][] = [
        [PIPER.calistirici, path.join(indirilen, PIPER.calistirici.ad), 'Ses çalıştırıcısı'],
        [PIPER.ses, path.join(k, PIPER.ses.ad), 'Türkçe ses'],
        [PIPER.sesAyari, path.join(k, PIPER.sesAyari.ad), 'Türkçe ses'],
      ];
      let biten = 0;
      for (const [v, hedef, adim] of isler) {
        indirme = { yuzde: Math.round((biten / YEDEK_BOYUT) * 97), adim }; bildir();
        if (!(await hazirMi(hedef, v.boyut, v.sha256))) {
          await indir(v.url, hedef, v.sha256, (g) => { indirme = { yuzde: Math.round(((biten + g) / YEDEK_BOYUT) * 97), adim }; bildir(); });
        }
        biten += v.boyut;
      }
      indirme = { yuzde: 98, adim: 'Açılıyor' }; bildir();
      await zipAc(path.join(indirilen, PIPER.calistirici.ad), k);
      fs.writeFileSync(path.join(k, '.tamam'), new Date().toISOString());
      fs.rmSync(indirilen, { recursive: true, force: true });
      if (!piperHazirMi()) throw new Error('Yedek ses kurulamadı (piper.exe bulunamadı).');
      indirme = { yuzde: 100, adim: 'Hazır' }; bildir();
      setTimeout(() => { if (indirme?.yuzde === 100) { indirme = undefined; bildir(); } }, 6000);
    } catch (e) {
      indirme = { yuzde: indirme?.yuzde ?? 0, adim: 'Kurulum durdu', hata: (e as Error).message }; bildir();
      throw e;
    }
  })().finally(() => { suren = null; });
  return suren;
}
