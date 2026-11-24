// ── Ses (Görev 21, K9): Fuber'in TEK sesi + konuşmadan yazıya — Electron bağlantıları ───────────────────────────────────────────
// Her yerde aynı ses: tek bir ses kimliği, hepsi için tek bir ElevenLabs API'si, olabildiğince hızlı.
// Çekirdek main/ses/merkez.ts'te (Electron'suz, testli); burada ayarlar, Fuber hesabı (main/hesap.ts), Chromium ağ yığını (konuşma
// başlarken session.preconnect ile sunucuya ısınmış bağlantı), yedek ses (yerel/piper.ts), Whisper ve pencereler bağlanır.
//  - Seslendirme: Fuber hesabının sesi (Gizli mod kapalıyken; barındırılan servis, cümle başına MP3); yoksa yedek ses (Piper dfki). Google
//    Çeviri, Windows/PowerShell, OpenAI/Azure/Google Cloud TTS, tarayıcı sesi ve kullanıcının kendi ElevenLabs anahtarı KALKTI (eski
//    `api:elevenlabs` sırrı silinmez ama okunmaz).
//  - 0.13: kullanıcı ses SEÇMEZ (ses listesi, hesap sesleri ve kayıtlı `ses.elevenSes` kalktı). Hesabın sesinde sunucu kipin sesini seçer;
//    kip arayüzden gelir (turun başında kilitlenen `basladi.kip`) ve konuşma başında bir kez okunur (ses/merkez.ts baslat).
//  - Ses parçaları isteyen pencereye 'ses:akis' olayıyla gider ({ id, tur: basladi|ses|bitti|hata, … }); pencere Web Audio ile hemen
//    çalar (renderer/ses-calar.ts). İlk ses gecikmesi günlüğe yazılır ve 'ses:bilgi'de son 10 ölçüm döner.
//  - Yazıya çevirme (0.13 C): bulut kipinde yalnız Fuber hesabı (canlı Scribe, düşerse toplu); Whisper yalnız Gizli ve "Yalnız bu bilgisayar"da (kurulu değilse ilk elle
//    dikte isteğinde kurulur: 'ses:dikte-yok'); yol yoksa 'yok' ve tek satır (Vosk dikteye dönmez). Ara metin pencereye 'ses:dinleme' ile gider.
import { session, type WebContents } from 'electron';
import { ayarlar } from './ayarlar.js';
import { beyinBasla } from './beyin.js';
import { SesMerkezi, dinlemeUyarisi, type KonusmaKaynagi } from './ses/merkez.js';
import { YEDEK_SES, hizDuzelt } from '../shared/ses-kimligi.js';
import { yayinla } from './olaylar.js';
import { piperHazirMi, yedekPcm, yedekIndirmeDurumu, yedekSesKur, YEDEK_BOYUT } from './yerel/piper.js';
import { whisperHazirMi, whisperBaslat, whisperCevir, whisperKur, whisperKurulumu, whisperIndirmeBoyutu } from './gunkaydi/whisper.js';
import type { KonusmaOlayi, SesBicimi } from './ses/konusma.js';
import { TELEFON_SES_HATA, TELEFON_SES_YOK, sesModeliYokMu } from '../shared/masaustu-hesap.js';
import { modKip, kipTemizle } from '../shared/karakterler.js';
import { turKarakteri, sesKipi } from '../shared/karakter-gorunum.js';
import { onizlemeSozu } from '../shared/kurulum-taslak.js';
import type { DikteSatiri } from '../shared/dikte-yolu.js';
import { sesBuBilgisayarda } from '../shared/nerede.js';
import type { SesBilgisi, SesSecenegi } from '../shared/tipler.js';

/** Gizli mod (bulutsuz; K10) ya da "Yalnız bu bilgisayar" (0.12 H3c düzeltme turu 1, Ö1): ses ve yazıya çevirme de bu bilgisayardan
 *  çıkmaz — yerel beyin hazır olmasa bile (söz bozulmaz). Kural tek yerde: shared/nerede.ts sesBuBilgisayarda. */
const bulutsuz = (): boolean => sesBuBilgisayarda(ayarlar().yerel);

// Fuber sunucusuna bağlantıyı önceden aç (Chromium ağ yığını; TLS el sıkışması ilk cümleye kalmasın). Yalnız ana süreçte, uygulama hazırken.
let sonIsitma = 0;
function sicakTut(t: string): void {
  if (Date.now() - sonIsitma < 20_000) return;
  sonIsitma = Date.now();
  try { session.defaultSession.preconnect({ url: t, numSockets: 2 }); } catch { /* en iyi çaba */ }
}

export const sesMerkezi = new SesMerkezi({
  ayar: () => { const s = ayarlar().ses; return { hiz: hizDuzelt(s.hiz), dil: ayarlar().dil, bulutsuz: bulutsuz(), mod: ayarlar().mod }; },
  yedek: { hazirMi: piperHazirMi, pcm: yedekPcm },
  // Testte sahte sunucu; kurulu uygulamada ortam kapısı yalnız bu bilgisayarın adresini geçirir (shared/ortam-kapisi.ts). Belirteç bu adresin sorgusunda gider.
  scribeTaban: () => process.env.FUBER_SES_TABAN_ELEVENLABS || 'https://api.elevenlabs.io',
  whisper: {
    hazirMi: whisperHazirMi,
    isit: () => { void whisperBaslat().catch(() => undefined); },
    cevir: (wav, dil) => whisperCevir(Buffer.from(wav), `${ayarlar().kullaniciAdi}, Fuber.`, dil),
    kurulum: whisperKurulumu,
    boyutMB: whisperIndirmeBoyutu,
    kur: () => { void whisperKur(); },
  },
  gunluk: (m) => console.info(m),
});

/** Bir sesli tur başlıyor (kullanıcı konuşmaya başladı, uyandırma): ElevenLabs bağlantısını ısıt, Whisper'ı aç. */
export function sesIsit(): void {
  const k = sesMerkezi.kimlik();
  if (sesMerkezi.yaziyaMotoru() === 'whisper') void whisperBaslat().catch(() => undefined);
}

// ── Konuşma: pencere başına ──
const izlenen = new WeakSet<WebContents>();
function sahip(wc: WebContents): string {
  if (!izlenen.has(wc)) {
    izlenen.add(wc);
    const temizle = () => sesMerkezi.sahibiTemizle(String(wc.id));
    wc.once('destroyed', temizle);
    wc.on('did-start-navigation', (_e, _u, yerinde, anaCerceve) => { if (anaCerceve && !yerinde) temizle(); });
  }
  return String(wc.id);
}

/** Beyin sayfasındaki "Ses" bölgesinin çalışma aralıkları: konuşma kimliği → (pencere, bitir). */
const beyinBitisleri = new Map<string, { sahip: string; bitir: (hata?: boolean, metin?: string) => void }>();
const beyniKapat = (id: string, hata: boolean, metin: string) => { beyinBitisleri.get(id)?.bitir(hata, metin); beyinBitisleri.delete(id); };

/** Konuşma başlatır; ses yoksa ya da sesli yanıt kapalıysa null (arayüz yalnız yazı gösterir). Olaylar bu pencereye 'ses:akis' ile.
 *  `bicim` 'mp3' (0.10 E3, Fuber hesabının sesi): her 'ses' parçası bir cümlenin MP3'ü (renderer/fuber-sesi.ts çözüp sırayla çalar).
 *  `kip` (0.13): turun başında kilitlenen kip (`basladi.kip`) ya da kurulumda seçilen kip ("Dinle"); geçersizse şu anki kip.
 *  `{ yok, satir }` (0.13): sesli yanıt açık ama hiç ses yok: yanıt yazı kalır, tek satır söylenir (oturumda bir kez). */
export function konusmaBaslat(wc: WebContents, o: { kaynak?: unknown; kip?: unknown }): { id: string; motor: string; hz: number; bicim: SesBicimi; hiz: number } | { yok: true; satir: string } | null {
  if (!ayarlar().ses.seslendirme && o?.kaynak !== 'onizleme') return null;
  const kaynak: KonusmaKaynagi = (['yanit', 'bildirim', 'onizleme', 'sohbet'] as const).find((k) => k === o?.kaynak) ?? 'yanit';
  const s = sahip(wc);
  const gonder = (olay: KonusmaOlayi) => {
    if (!wc.isDestroyed()) wc.send('ses:akis', olay);
    if (olay.tur === 'bitti' || olay.tur === 'hata') beyniKapat(olay.id, olay.tur === 'hata', olay.tur === 'hata' ? 'bir sorun oldu' : 'konuştu');
  };
  const b = sesMerkezi.baslat(s, gonder, { kaynak, kip: kipTemizle(o?.kip) });
  if (!b) { const satir = sesMerkezi.sesYokSatiri(kaynak); return satir ? { yok: true, satir } : null; }
  // Beyin sayfası: sade metin iki modda; ses motoru teknik ayrıntı (yalnız Geliştirici'de; Ruling O).
  if (kaynak !== 'onizleme') beyinBitisleri.set(b.id, { sahip: s, bitir: beyinBasla('ses', 'sesle konuşuyor', b.kimlik.motor === 'elevenlabs' ? 'Fuber’in sesi' : 'yedek ses') });
  return { id: b.id, motor: b.kimlik.motor, hz: b.hz, bicim: b.bicim, hiz: b.hiz };
}
export const konusmaEkle = (id: unknown, metin: unknown) => { if (typeof id === 'string' && typeof metin === 'string') sesMerkezi.ekle(id, metin.slice(0, 20_000)); };
export const konusmaBitir = (id: unknown) => { if (typeof id === 'string') sesMerkezi.bitir(id); };
/** Kes (Sustur, Durdur, kullanıcı konuştu): id verilirse o konuşma, verilmezse bu pencerenin bütün konuşmaları. */
export function sesKes(wc: WebContents, id?: unknown): number {
  const s = sahip(wc);
  const tek = typeof id === 'string' ? id : undefined;
  for (const [k, v] of [...beyinBitisleri]) if (tek ? k === tek : v.sahip === s) beyniKapat(k, false, 'susturuldu');
  return sesMerkezi.kes(s, tek);
}
/** Acil durdurma: bütün konuşmalar. */
export function sesiHepsiniKes(): number {
  for (const k of [...beyinBitisleri.keys()]) beyniKapat(k, false, 'durduruldu');
  return sesMerkezi.hepsiniKes();
}
/** Kullanıcı konuşmaya başladı (uyandırma, sesle sor, dikte) ya da acil durdurma (düzeltme 5): Fuber'in sesi BÜTÜN pencerelerde anında
 *  susar — ana süreçteki üretim kesilir, pencerelerin çaları 'ses:kes' ile boşalır (yalnız ada değil). */
export function sesiHerYerdeKes(): number {
  const n = sesiHepsiniKes();
  yayinla('ses:kes', {});
  return n;
}
/** Arayüzün ölçtüğü gerçek ilk çalma gecikmesi (ms; Web Audio'da ilk örneğin çaldığı an). Günlüğe yazılır. */
export function sesOlcum(v: { id?: unknown; ilkCalmaMs?: unknown; kaynak?: unknown }): void {
  const ms = Number(v?.ilkCalmaMs);
  if (Number.isFinite(ms) && ms >= 0 && ms < 120_000) console.info(`[ses] ilk çalma ${Math.round(ms)} ms (${String(v?.kaynak ?? '').slice(0, 20)}; akış başlangıcından hoparlöre)`);
}

/** Fuber hesabının sesi (K3): "Fuber’in sesi" (sunucu kipin sesini seçer; kullanıcı ses adı görmez, sağlayıcı adı yok). */
function hesapSesiBilgisi(sesId: string): SesSecenegi {
  return { id: sesId || 'fuber', ad: 'Fuber’in sesi', aciklama: 'Karakterin sesi.', kaynak: 'fuber' };
}

export function sesBilgisi(): SesBilgisi {
  const a = ayarlar();
  const k = sesMerkezi.kimlik();
  return {
    motor: k?.motor ?? null,
    ses: k ? (k.hesap ? hesapSesiBilgisi(k.sesId) : YEDEK_SES) : null,
    hesapSesi: Boolean(k?.hesap),
    yedek: { kurulu: piperHazirMi(), boyut: YEDEK_BOYUT, ...(yedekIndirmeDurumu() ? { indirme: yedekIndirmeDurumu() } : {}) },
    gizliMod: a.yerel.gizliMod === true,
    ...(a.yerel.gizliMod !== true && a.yerel.yalnizYerel === true ? { yalnizYerel: true } : {}),
    hiz: hizDuzelt(a.ses.hiz),
    yaziya: sesMerkezi.yaziyaMotoru(),
    sonGecikmeler: sesMerkezi.sonGecikmeler.slice(0, 10),
  };
}

/** Telefon "Telefonda dinle" (akışsız): karakterin sesiyle tam WAV (ses seçilmez; eski telefonun gönderdiği ses kimliği yok sayılır). */
export async function sesDene(metin?: unknown): Promise<{ ses: { mime: string; veri: string } | null; hata?: string }> {
  try {
    const r = await sesMerkezi.wav(onizlemeSozu(metin, turKarakteri(ayarlar()).ad));
    if (!r) return { ses: null, hata: 'Ses yok: yedek ses kurulu değil.' };
    return { ses: { mime: r.mime, veri: Buffer.from(r.wav).toString('base64') } };
  } catch (e) {
    // 0.10 E3 düzeltme turu 1: telefona ham hata (sağlayıcı iletisi, durum kodu, "model") gitmez; ayrıntı yalnız günlükte.
    console.warn('[ses] telefon önizlemesi:', (e as Error).message);
    return { ses: null, hata: sesModeliYokMu(e) ? TELEFON_SES_YOK : TELEFON_SES_HATA };
  }
}

export const yedekSesiKur = () => yedekSesKur().then(() => sesBilgisi(), (e: Error) => ({ ...sesBilgisi(), hata: e.message }));
export { YEDEK_SES };

// ── Konuşmadan yazıya (soru ve dikte): pencere başına oturum ──
/** Kullanıcı konuşacak: önce Fuber'in sesi her yerde susar (kendi sesimiz yazıya çevrilmesin; düzeltme 5). */
export function dinlemeBaslat(wc: WebContents): { id: string; motor: string } {
  sesiHerYerdeKes();
  const r = sesMerkezi.dinlemeBaslat(sahip(wc), (metin) => { if (!wc.isDestroyed()) wc.send('ses:dinleme', { id: r.id, tur: 'kismi', metin }); });
  if (r.motor !== 'yok') sesIsit();
  return r;
}
/** Dikte yolu yok ve kullanıcı gerçekten istedi (elle bastı ya da uyandırıp konuştu): söylenecek tek satır. Yerel kipte Whisper kurulu değilse kurulum yalnız elle başlatılan
 *  diktede burada başlar (boyutu satır söyler); `uyandirma`da yalnız tek satır. Bulut kipinde hiçbir şey inmez. */
export const dikteYokSatiri = (yeniden = false, uyandirma = false): Promise<DikteSatiri> => sesMerkezi.dikteYokSatiri({ yeniden, uyandirma });
export const dinlemeParca = (id: unknown, pcm: unknown) => {
  if (typeof id !== 'string' || !(pcm instanceof Uint8Array) || pcm.length > 256_000) return;
  sesMerkezi.dinlemeParca(id, pcm);
};
/** Kesin metin; motor düştüyse ya da dikte sınırına gelindiyse moda uygun tek satırlık `uyari` da (düzeltme 6: sessiz kalmaz). O ana kadarki metin uyarıyla birlikte döner. */
export async function dinlemeBitir(id: unknown): Promise<{ metin: string | null; uyari?: string }> {
  if (typeof id !== 'string') return { metin: null };
  const r = await sesMerkezi.dinlemeBitir(id);
  if (r.dustu) beyinBasla('yazici', 'konuşmayı yazıya çeviremedi')(true, 'bir sorun oldu', 'ses tanıma düştü');
  const uyari = dinlemeUyarisi(r, ayarlar().mod);
  return { metin: r.metin, ...(uyari ? { uyari } : {}) };
}
export const dinlemeIptal = (id: unknown) => { if (typeof id === 'string') sesMerkezi.dinlemeIptal(id); };
/** Uygulama kapanırken (main.ts before-quit): süren dikteler kesilir, süre raporu kısa süre beklenir (rapor gitmezse 120 sn'lik rezerv kalır). Bekletecek bir şey yoksa null. */
export const dikteleriKapat = (): Promise<void> | null => sesMerkezi.dinlemeleriKapat();
