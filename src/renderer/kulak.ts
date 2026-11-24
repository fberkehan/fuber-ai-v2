// ── Kulak: "Hey Fuber" uyandırma sözcüğü + gün kaydı (görünmez pencere, tamamen cihazda) ────────────────────────
// Uyandırma 0.13'te Vosk dil bilgisinden çıktı (T8): dar dil bilgisi her sesi "hey + fiber"e zorluyordu. Yeni motor seçici anahtar sözcük
// algılamadır; ölçüm, kurallar ve yaşam döngüsü uyandirma.ts'te. Vosk Türkçe küçük modeli (Apache-2.0) YALNIZ gün kaydı içindir, WASM'da çalışır,
// ses buluta GİTMEZ; gün kaydı kapalıyken model hiç yüklenmez (T10).
// Yanlış uyanmada asistan 3 sn konuşma duymazsa kendiliğinden kapanır; sohbete bir şey yazılmaz, yazıya çevirmeye ses GİTMEZ (konuşma duyulana dek örnekler
// burada bekler) ve kurulum/uyarı satırı istenmez.
// Uyanınca: asistan (ada) ekranın üstünden iner, soru yakalanır (0,7 sn sessizlikle biter) ve yazıya çevrilir — Görev 21 (K9): konuşma
// duyulunca ses SÜRERKEN ana sürece akar; Fuber hesabı (canlı Scribe, ara metin canlı) ya da kurulu Whisper (Gizli, "Yalnız bu bilgisayar"). Yol yoksa
// ('yok') Vosk'a DÖNÜLMEZ: konuşulduysa tek satır söylenir (dikteYokSatiri).
// Söz kesme: Fuber konuşurken de "Hey Fuber" dinlenir (ada sesi anında keser); gün kaydı ve soru yakalama Fuber'in sesini duymaz.
//
// GÜN KAYDI (düşünme motoru açıkken): ikinci, serbest bir Vosk tanıyıcısı sürekli dinler ve konuşmanın sınırlarını
// bulur (VAD + yedek metin). Ana süreç Whisper/OpenAI istiyorsa (sesGonder) o bölümün sesi halka arabellekten kesilip
// 16 kHz WAV olarak BELLEKTE gönderilir; diske yazılmaz. Fuber konuşurken (bekle) ve soru yakalanırken susar.
import { createModel, type Model, type KaldiRecognizer } from 'vosk-browser';
import { cagir, dinle } from './api';
import { seviyeOlcer, soruBekle, dinlemeAc, dikteYokSatiri } from './ses-yakala';
import { dikteKapisi } from './dikte-kapisi';
import { uyandiriciKur, type Uyandirici } from './uyandirma';
import { pcm16Yap } from '../shared/pcm';
import { gunKaydiUygulayici, modelYoneticisi } from './gun-kaydi-modeli';

interface KulakAyari { gunKaydi: boolean; sesGonder: boolean; uyandirma: boolean }

/** Vosk modeli yalnız gün kaydı açıkken yüklü durur (gun-kaydi-modeli.ts); dikte kullanmaz. */
const model = modelYoneticisi<Model>({
  yukle: async () => createModel(await cagir<string>('ses:vosk-adresi'), -1),
  birak: (m) => m.terminate(),
  hata: (e) => console.error('[kulak] gün kaydı modeli yüklenemedi:', e),
});
let baglam: AudioContext | null = null;
let akis: MediaStream | null = null;
let seviye: () => number = () => 0;
let uyandirici: Uyandirici | null = null;
let mesgul = false;
/** Fuber konuşuyor (yankı): gün kaydı ve soru yakalama bu ana dek beklemez/beslenmez. "Hey Fuber" dinlenmeye devam eder (söz kesme). */
let bekleBitis = 0;
/** Bir soru az önce bitti: sorunun kuyruğu yeniden uyandırmasın. */
let uyanmaKilidi = 0;
/** Soru yakalanırken mikrofon örnekleri buraya da akar (ana sürece, yazıya çevirme). */
let ornekBesle: ((o: Float32Array, hz: number) => void) | null = null;
let ayar: KulakAyari = { gunKaydi: false, sesGonder: false, uyandirma: true };

// ── Gün kaydı: serbest tanıyıcı + yalnız ona beslenen örneklerin halka arabelleği ──
let gunluk: KaldiRecognizer | null = null;
const HALKA_SN = 40;
let halka = new Float32Array(1);
let halkaToplam = 0; // gunluk'a beslenen toplam örnek (tanıyıcı başlangıcından beri)

const olay = (v: Record<string, unknown>) => void cagir('kulak:olay', v).catch(() => undefined);

function halkayaYaz(veri: Float32Array): void {
  const n = halka.length;
  for (let i = 0; i < veri.length; i++) halka[(halkaToplam + i) % n] = veri[i];
  halkaToplam += veri.length;
}

function halkadanKes(bas: number, bit: number): Float32Array | null {
  const n = halka.length;
  bas = Math.max(bas, halkaToplam - n + 1, 0);
  bit = Math.min(bit, halkaToplam);
  if (bit - bas < 0.3 * (baglam?.sampleRate ?? 48000)) return null;
  const out = new Float32Array(bit - bas);
  for (let i = 0; i < out.length; i++) out[i] = halka[(bas + i) % n];
  return out;
}

/** Alçak geçiren süzgeçle 16 kHz'e indir (shared/pcm.ts; katlanma yok), PCM16 mono WAV yap, base64 döndür. */
function wav16k(ornekler: Float32Array, kaynakHizi: number): string {
  const bayt = pcm16Yap(ornekler, kaynakHizi, 16000);
  const pcm = new Int16Array(bayt.buffer, bayt.byteOffset, bayt.byteLength >> 1);
  const tampon = new ArrayBuffer(44 + pcm.byteLength);
  const d = new DataView(tampon);
  const yaz = (o: number, s: string) => { for (let i = 0; i < s.length; i++) d.setUint8(o + i, s.charCodeAt(i)); };
  yaz(0, 'RIFF'); d.setUint32(4, 36 + pcm.byteLength, true); yaz(8, 'WAVE'); yaz(12, 'fmt ');
  d.setUint32(16, 16, true); d.setUint16(20, 1, true); d.setUint16(22, 1, true); d.setUint32(24, 16000, true);
  d.setUint32(28, 32000, true); d.setUint16(32, 2, true); d.setUint16(34, 16, true); yaz(36, 'data'); d.setUint32(40, pcm.byteLength, true);
  new Int16Array(tampon, 44).set(pcm);
  const u = new Uint8Array(tampon);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

function gunlukKur(): void {
  const vosk = model.al();
  if (!vosk || !baglam || gunluk || !ayar.gunKaydi) return;
  halka = new Float32Array(Math.round(baglam.sampleRate * HALKA_SN));
  halkaToplam = 0;
  const hiz = baglam.sampleRate;
  gunluk = new vosk.KaldiRecognizer(hiz);
  gunluk.setWords(true);
  gunluk.on('result', (m) => {
    if (m.event !== 'result') return;
    const voskMetin = (m.result.text || '').trim();
    const kelimeler = m.result.result ?? [];
    if (!voskMetin || !kelimeler.length) return;
    const bas = Math.round((kelimeler[0].start - 0.25) * hiz);
    const bit = Math.round((kelimeler[kelimeler.length - 1].end + 0.3) * hiz);
    const sure = Math.max(0, (bit - bas) / hiz);
    if (!ayar.sesGonder) { void cagir('gunkaydi:satir', { voskMetin, sure }).catch(() => undefined); return; }
    // En çok 30 sn (uzun tek parça konuşmada son 30 sn); fazlası halkadan zaten düşmüştür.
    const ornek = halkadanKes(Math.max(bas, bit - 30 * hiz), bit);
    if (!ornek) { void cagir('gunkaydi:satir', { voskMetin, sure }).catch(() => undefined); return; }
    void cagir('gunkaydi:ses', { wav: wav16k(ornek, hiz), voskMetin, sure }).catch(() => undefined);
  });
}

function gunlukKapat(): void {
  if (!gunluk) return;
  try { gunluk.remove(); } catch { /* kaldırıldı */ }
  gunluk = null;
  halka = new Float32Array(1);
  halkaToplam = 0;
}

/** Açılıştaki ilk ayar ve `gunkaydi:kulak` olayı AYNI uygulayıcıdan geçer (gun-kaydi-modeli.ts): model yüklü mü diye bakılmaz, gün kaydı çalışma anında açılınca da yüklenir. */
const ayarUygula = gunKaydiUygulayici<KulakAyari, Model>({ model, ayarYaz: (v) => { ayar = v; }, gunlukKur, gunlukKapat, uyandirmaEsitle: () => uyandirmaEsitle() });

/** Ayar açıksa motoru açar, kapalıysa kapatır. Vosk modelini beklemez: gün kaydı modeli yüklenmese de "Hey Fuber" çalışır. */
function uyandirmaEsitle(): void {
  if (ayar.uyandirma && !uyandirici) {
    uyandirici = uyandiriciKur({ durum: (durum) => olay({ tur: 'uyandirma', durum }) }, () => {
      if (!mesgul && Date.now() >= uyanmaKilidi) void soruyuYakala(true);
    });
  } else if (!ayar.uyandirma && uyandirici) {
    uyandirici.kapat();
    uyandirici = null;
  }
}

async function hazirla(): Promise<void> {
  akis = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
  baglam = new AudioContext();
  if (baglam.state === 'suspended') await baglam.resume();
  const kaynak = baglam.createMediaStreamSource(akis);
  seviye = seviyeOlcer(baglam, kaynak);
  // ScriptProcessor eski ama Vosk'un (gün kaydı) beklediği AudioBuffer'ı doğrudan verir; çıkış sessizdir.
  const islem = baglam.createScriptProcessor(4096, 1, 1);
  islem.onaudioprocess = (e) => {
    // "Hey Fuber" Fuber konuşurken de dinlenir (söz kesme); yalnız soru yakalanırken durur. Kopya: örnekler işçiye aktarılır.
    if (uyandirici && !mesgul) uyandirici.besle(new Float32Array(e.inputBuffer.getChannelData(0)), e.inputBuffer.sampleRate);
    // Soru yazıya çevrilirken (Scribe/Whisper) Fuber'in KENDİ sesi akmasın (düzeltme 5): soru başlarken ana süreç bütün pencerelerde sesi
    // keser (ses.ts sesiHerYerdeKes); kuyrukta kalan yankı ve araya giren bir ses (bekle) bitene dek örnek gönderilmez.
    if (ornekBesle && Date.now() >= bekleBitis) { try { ornekBesle(new Float32Array(e.inputBuffer.getChannelData(0)), e.inputBuffer.sampleRate); } catch { /* oturum kapandı */ } }
    // Gün kaydı: Fuber konuşurken (yankı) ve soru yakalanırken beslenmez; halka yalnız beslenen örnekleri tutar
    // (Vosk'un kelime zamanları beslenen akışa göredir).
    if (gunluk && !mesgul && Date.now() >= bekleBitis) {
      try { gunluk.acceptWaveform(e.inputBuffer); halkayaYaz(e.inputBuffer.getChannelData(0)); } catch { /* kaldırıldı */ }
    }
  };
  kaynak.connect(islem);
  islem.connect(baglam.destination);

  // "Hey Fuber" modeli beklemez; Vosk modeli yalnız gün kaydı açıksa yüklenir (ayarUygula → model.ayarla).
  ayarUygula(await cagir<KulakAyari>('gunkaydi:kulak-ayar').catch(() => ayar));
}

async function soruyuYakala(uyandirmayla: boolean): Promise<void> {
  if (mesgul) return;
  // Hazır değilken sessiz dönmek asistanı "Dinliyorum…"da bırakıyordu: durumu bildir.
  const hazirDegil = () => olay({ tur: 'hata', mesaj: 'Mikrofon henüz hazır değil ya da açılamadı; birkaç saniye sonra tekrar dene ya da yaz.' });
  if (!akis || !baglam) { hazirDegil(); return; }
  mesgul = true;
  try {
    olay({ tur: 'uyandi', uyandirmayla });
    // Ana süreç 'uyandi'da bütün pencerelerde Fuber'in sesini keser (main.ts kulakOlay): kalan yankı payı kısa (120 ms).
    bekleBitis = Math.min(bekleBitis, Date.now() + 120);
    let son = 0;
    const seviyeBildir = (v: number) => { const t = performance.now(); if (t - son > 90) { son = t; olay({ tur: 'seviye', v: Math.min(1, v * 9) }); } };

    // Hesap (canlı Scribe) / Whisper: ses konuşurken ana sürece akar; Scribe'ın ara metni canlı gösterilir. Uyandırma yolunda oturum konuşma DUYULUNCA açılır
    // (dikte-kapisi.ts): yanlış uyanmada belirteç alınmaz, soket açılmaz, tek örnek gitmez. Elle açılan dinlemede (kullanıcı bastı) hemen açılır ve yol yoksa
    // nedeni HEMEN söylenir (Vosk'a dönülmez; yerel kipte Whisper kurulumu da şimdi başlar; uyandırma yolunda indirme başlamaz, yalnız tek satır).
    const kapi = dikteKapisi(() => dinlemeAc((m) => olay({ tur: 'kismi', metin: uyandirmayiAt(m) })));
    const yokSoyle = async () => { const d = await dikteYokSatiri({ uyandirma: uyandirmayla }); olay({ tur: 'hata', mesaj: d.satir, ...(d.yenidenDene ? { yenidenDene: true } : {}) }); };
    if (!uyandirmayla) {
      kapi.baslat();
      if (!(await kapi.oturum())) { await yokSoyle(); return; }
    }
    ornekBesle = (o, hz) => kapi.besle(o, hz);
    const r = await soruBekle(akis, seviye, uyandirmayla, seviyeBildir, () => kapi.baslat());
    ornekBesle = null;
    if (!r.konustu) { kapi.iptal(); olay({ tur: 'bos' }); return; }
    // Uyandırma yolunda konuşuldu ama yol yok ('yok'): sessiz kalınmaz — tek satır.
    const oturum = await kapi.oturum();
    if (!oturum) { await yokSoyle(); return; }
    olay({ tur: 'yaziya' });
    const s = await oturum.bitir().catch(() => ({ metin: null, uyari: undefined }));
    // Başa karışan uyandırma sözcüğü ("Hey Fuber" → "beyhude", "hey fiber"…) sorudan atılır.
    const metin = uyandirmayiAt(s.metin ?? '');
    // Motor düştüyse soru (anlaşıldıysa) yine gider; uyarı tek satır görünür. Anlaşılamadıysa "boş" değil uyarı.
    olay(metin ? { tur: 'metin', metin, ...(s.uyari ? { uyari: s.uyari } : {}) } : s.uyari ? { tur: 'hata', mesaj: s.uyari } : { tur: 'bos' });
  } catch (e) {
    olay({ tur: 'hata', mesaj: (e as Error).message });
  } finally {
    ornekBesle = null;
    bekleBitis = Math.max(bekleBitis, Date.now() + 1500);
    uyanmaKilidi = Date.now() + 1500;
    mesgul = false;
  }
}

/** Başa karışan uyandırma sözcüğü ("Hey Fuber" → "beyhude", "hey fiber"…) sorudan atılır. */
const uyandirmayiAt = (m: string) => m.replace(/^(?:(?:h?ey|hay|bey)\s*,?\s+(?:fuber|fiber|füber|fuar|full ver)|beyhude)\s*[,.!?]?\s*/i, '').trim();

dinle('kulak:komut', (k: { tur: 'dinle' | 'bekle' | 'devam'; ms?: number }) => {
  if (k.tur === 'dinle') void soruyuYakala(false);
  else if (k.tur === 'bekle') bekleBitis = Math.max(bekleBitis, Date.now() + (k.ms ?? 0));
  // Asistan konuşmayı susturdu: kalan bekleme süresini bekleme, hemen "Hey Fuber"i dinle (yankı payı 300 ms).
  else if (k.tur === 'devam') bekleBitis = Math.min(bekleBitis, Date.now() + 300);
});
dinle('gunkaydi:kulak', ayarUygula);

hazirla().catch((e) => console.error('[kulak] başlatılamadı:', e));
