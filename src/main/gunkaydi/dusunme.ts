// ── Düşünme motoru: orkestra şefi ───────────────────────────────────────────────────────────────────────────────
// Ajanlar (her biri kendi işini, kendi zamanında yapar; durumları kokpitte görünür):
//   Kulak (dinleyici) → Yazıcı (döküm) → Not tutucu (madde: önemli/önemsiz, mesele, kalıcı bilgi)
//                    ↘ Eşlikçi (araya girme)            Raporcu (gün/hafta/ay)        Bekçi (saklama)
// Kulak yalnız: gün kaydı açık + rıza verilmiş + çalışma saatinde + duraklatılmamış + (ayara göre) ekran kilitli değilken
// dinler. Ses hiçbir yere yazılmaz: kulak konuşma bölümünü (WAV, bellekte) yazıcıya verir, yazıcı metne çevirir.
import { powerMonitor } from 'electron';
import { ayarlar, ayarDinle } from '../ayarlar.js';
import { yayinla } from '../olaylar.js';
import { hafizaListesi } from '../hafiza/depo.js';
import { satirEkle, sonSatirlar, gunSayaclari, maddeler, raporlar, meseleler, sonEslikler, eslikSayisi, raporGetir } from './depo.js';
import { calismadaMi, gunAnahtari, vadeliRaporlar } from './donem.js';
import { notTut, bekleyenSatirlar, gizliBekleyenleriNotla } from './not-tutucu.js';
import { gizliRaporNotu } from '../../shared/gizli-suzgec.js';
import { eslikDegerlendir } from './eslikci.js';
import { raporHazirla, donemdeVeriVar } from './raporcu.js';
import { bekciCalis } from './bekci.js';
import { whisperDurumu, whisperHazirMi, whisperCevir, whisperBaslat, whisperDurdur, whisperBildirici } from './whisper.js';
import type { AjanDurumu, DusunmeDurumu, KokpitVerisi, RaporTuru } from '../../shared/tipler.js';
import type { BolgeId } from '../../shared/beyin.js';
import { beyinBasla, sinyal } from '../beyin.js';
import { seslenmeMi, seslenmeyeYanit, fuberKonustu } from './seslenme-yanit.js';

type AjanAdi = 'kulak' | 'yazici' | 'notTutucu' | 'eslikci' | 'raporcu' | 'bekci';
// Ayarlar → Gün kaydı → "Son çalışmalar" satırının adı: kullanıcıya görünür (0.13 T15: düz ad; iç kimlikler kulak, yazici, notTutucu… değişmez).
const ETIKET: Record<AjanAdi, string> = { kulak: 'Dinleme', yazici: 'Konuşmayı yazıya çevirme', notTutucu: 'Günün notları', eslikci: 'Araya girme', raporcu: 'Raporlar', bekci: 'Eski notları silme' };
const ajanlar = new Map<AjanAdi, AjanDurumu>((Object.keys(ETIKET) as AjanAdi[]).map((a) => [a, { ad: a, etiket: ETIKET[a], durum: 'bekliyor', sayac: 0 }]));

let kilitli = false;
let kulakaGonder: (v: KulakAyari) => void = () => undefined;
let asistanaSoyle: (v: { metin: string; tur: string; sesli: boolean; ses?: { mime: string; veri: string }; sohbetId?: number }) => void = () => undefined;
let asistanaGonder: (b: { tur: 'mesaj'; baslik: string; metin: string }) => void = () => undefined;
let eslikZaman: NodeJS.Timeout | null = null;
let sonNotTutma = 0;
let sonBekci = 0;
let sonRaporDenemesi = 0;
let sonKulak = '';

export interface KulakAyari { gunKaydi: boolean; sesGonder: boolean; uyandirma: boolean }

// Beyin sayfası: ajanın "çalışıyor" aralığı beyindeki bölgesinde yanar. Kulak sürekli dinler: o "dinliyor" olarak
// gösterilir (burada izlenmez).
const BOLGE: Partial<Record<AjanAdi, BolgeId>> = { yazici: 'yazici', notTutucu: 'not', eslikci: 'eslikci', raporcu: 'rapor', bekci: 'bekci' };
const beyinBitis = new Map<AjanAdi, (hata?: boolean, metin?: string, ayrinti?: string) => void>();
/** Hata durumunun sade yazısı; ham ileti `ayrinti`ye (yalnız Geliştirici; Ruling O — Beyin ve ayarlar İş'te ham hata göstermez). */
const hataDurumu = (e: unknown): Partial<AjanDurumu> => ({ durum: 'hata', not: 'bir sorun oldu', ayrinti: String((e as Error)?.message ?? e).slice(0, 120) });
const YAZICI_ADI = { whisper: 'Whisper', vosk: 'Vosk' } as const;

function ajan(a: AjanAdi, d: Partial<AjanDurumu>, say = false): void {
  const x = ajanlar.get(a)!;
  const b = BOLGE[a];
  if (b && d.durum === 'calisiyor' && !beyinBitis.has(a)) beyinBitis.set(a, beyinBasla(b, d.not || x.etiket, d.ayrinti));
  else if (b && d.durum && d.durum !== 'calisiyor') { beyinBitis.get(a)?.(d.durum === 'hata', d.not || undefined, d.ayrinti); beyinBitis.delete(a); }
  if ('not' in d && !('ayrinti' in d)) x.ayrinti = undefined; // yeni not eski ayrıntıyı taşımasın
  Object.assign(x, d);
  if (say) x.sayac++;
  if (d.durum && d.durum !== 'calisiyor') x.son = new Date().toISOString();
  durumBildir();
}

let bildirZaman: NodeJS.Timeout | null = null;
function durumBildir(): void {
  if (bildirZaman) return;
  bildirZaman = setTimeout(() => { bildirZaman = null; yayinla('gunkaydi:durum', dusunmeDurumu()); }, 250);
}

/** Dinlemiyorsa nedeni; dinliyorsa null. Mikrofon tamamen kapalıysa (sol menü) hiçbir koşulda dinlemez. */
function dinlememeNedeni(d = new Date()): string | null {
  const g = ayarlar().gunKaydi;
  if (!ayarlar().kurulumTamam) return 'kurulum tamamlanmadı';
  if (!g.etkin) return 'gün kaydı kapalı';
  if (ayarlar().ses.mikrofonKapali) return 'mikrofon kapalı';
  if (!g.rizaTarihi) return 'onay bekleniyor';
  if (g.duraklatBitis && new Date(g.duraklatBitis).getTime() > d.getTime()) return `duraklatıldı (${new Date(g.duraklatBitis).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}'e kadar)`;
  if (g.kilitteDuraklat && kilitli) return 'ekran kilitli';
  if (!calismadaMi(d, g.calisma)) return 'çalışma saatleri dışında';
  return null;
}

/** Yazıcı motoru: otomatik = Whisper kuruluysa Whisper, değilse Vosk (cihazda). 0.13 T15: OpenAI seçeneği kalktı (kullanıcı anahtarı okunmaz); eski kayıtlı 'openai' değeri otomatik gibi çalışır. */
function yaziciMotoru(): 'whisper' | 'vosk' {
  const m = ayarlar().gunKaydi.motor;
  if (m === 'whisper' || m === 'otomatik' || m === 'openai') return whisperHazirMi() ? 'whisper' : 'vosk';
  return 'vosk';
}

export function kulakAyari(): KulakAyari {
  return { gunKaydi: dinlememeNedeni() === null, sesGonder: yaziciMotoru() !== 'vosk', uyandirma: ayarlar().ses.uyandirma && !ayarlar().ses.mikrofonKapali };
}

let kulakYenile: () => void = () => undefined;

function kulagaBildir(): void {
  const k = kulakAyari();
  const imza = JSON.stringify(k);
  if (imza === sonKulak) return;
  sonKulak = imza;
  // Kulak penceresi gerekiyorsa kurulsun, gerekmiyorsa kapansın (mikrofon gerçekten bırakılsın), sonra ayar gitsin.
  kulakYenile();
  kulakaGonder(k);
  ajan('kulak', { durum: k.gunKaydi ? 'calisiyor' : 'kapali', not: k.gunKaydi ? 'dinliyor' : dinlememeNedeni() ?? '' });
  if (k.gunKaydi && k.sesGonder && yaziciMotoru() === 'whisper') void whisperBaslat().then(() => durumBildir());
  if (!k.gunKaydi && (!ayarlar().gunKaydi.etkin || ayarlar().ses.mikrofonKapali)) whisperDurdur();
}

export function dusunmeDurumu(): DusunmeDurumu {
  const g = ayarlar().gunKaydi;
  const neden = dinlememeNedeni();
  const motor = yaziciMotoru();
  const bugun = gunAnahtari(new Date());
  const s = gunSayaclari(bugun);
  const son = sonEslikler(1)[0];
  return {
    etkin: g.etkin,
    dinliyor: neden === null,
    neden: neden ?? undefined,
    yazici: { motor, aciklama: motor === 'whisper' ? `Whisper ${g.whisperModel} (yerel, ücretsiz)` : 'Vosk Türkçe (cihazda, hızlı; Whisper kurulursa daha isabetli)' },
    whisper: whisperDurumu(),
    bugun: { ...s, eslik: eslikSayisi(new Date(new Date().toDateString()).toISOString()) },
    ajanlar: [...ajanlar.values()].map((a) => ({ ...a, durum: !g.etkin && a.durum !== 'calisiyor' ? 'kapali' : a.durum })),
    sonEslik: son ? { zaman: son.zaman, metin: son.metin } : undefined,
    acikMesele: meseleler('acik', 200).length,
  };
}

export function kokpitDusunmeVerisi(): KokpitVerisi['dusunme'] {
  return {
    durum: dusunmeDurumu(),
    bugunOnemli: maddeler({ gun: gunAnahtari(new Date()), onem: 'onemli', limit: 8 }),
    sonRapor: raporlar({ limit: 1 })[0],
    meseleler: meseleler('acik', 12),
  };
}

// Whisper'ın "prompt"u: özel adlar (proje, kişi) doğru yazılsın. Kısa tutulur (ilk 224 token kullanılır).
let ipucuOnbellek = { zaman: 0, metin: '' };
function sozlukIpucu(): string {
  if (Date.now() - ipucuOnbellek.zaman < 10 * 60_000) return ipucuOnbellek.metin;
  const a = ayarlar();
  const adlar = new Set<string>([a.kullaniciAdi, a.asistanAdi || 'Fuber']);
  for (const t of ['proje', 'kisi'] as const) for (const h of hafizaListesi({ tur: t, limit: 25 })) adlar.add(h.baslik.split(/[—:-]/)[0].trim());
  const metin = `${[...adlar].filter(Boolean).slice(0, 40).join(', ')}.`;
  ipucuOnbellek = { zaman: Date.now(), metin };
  return metin;
}

/** Kulaktan gelen bir konuşma bölümü: metin (Vosk) ve/veya ses (WAV, bellekte). */
export async function bolumAl(v: { voskMetin?: string; wav?: string; sure?: number }): Promise<void> {
  if (dinlememeNedeni() !== null) return; // durum az önce değişti
  const motor = yaziciMotoru();
  let metin: string | null = null;
  sinyal('kulak', 'yazici', v.sure ? `${v.sure.toFixed(1).replace('.', ',')} sn konuşma` : 'konuşma bölümü');
  // Sade yazı iki modda; yazıcı motorunun adı teknik ayrıntı (yalnız Geliştirici'de).
  ajan('yazici', { durum: 'calisiyor', not: 'yazıya döküyor', ayrinti: YAZICI_ADI[motor] });
  try {
    if (v.wav && motor === 'whisper') metin = await whisperCevir(Buffer.from(v.wav, 'base64'), sozlukIpucu());
    if (metin === null && v.voskMetin) metin = v.voskMetin; // yedek: cihazdaki Vosk metni
    ajan('yazici', { durum: 'bekliyor', not: metin ? 'yazıya döktü' : 'konuşma çıkmadı', ayrinti: metin === v.voskMetin ? YAZICI_ADI.vosk : YAZICI_ADI[motor] }, Boolean(metin));
  } catch (e) {
    metin = v.voskMetin ?? null;
    ajan('yazici', hataDurumu(e));
  }
  const temiz = metin?.replace(/\s+/g, ' ').trim();
  if (!temiz || temiz.length < 2) return;
  // Uyandırma sözcüğü ve asistana sorulan soru gün kaydına girmez (o zaten sohbete yazılıyor).
  if (/^(hey|hay|ey)\s+(fuber|fiber)/i.test(temiz)) return;
  // Gizli mod açıkken duyulan satır Gizli bölüme yazılır (Görev 21 düzeltme turu 2): hiçbir bulut işi onu okumaz.
  satirEkle(temiz, metin === v.voskMetin ? 'vosk' : motor, v.sure, new Date(), ayarlar().yerel.gizliMod === true);
  durumBildir();
  // Fuber'e seslenildi ("ee Fuber nasılsın", "Fuber buralarda mısın") ya da az önce konuştuğu şeye yanıt: hızlı yol.
  // Bu satır için eşlikçi çalışmaz (iki ayrı tepki üst üste binmesin).
  if (seslenmeMi(temiz)) {
    void seslenmeyeYanit(temiz, sonSatirlar(5).map((s) => s.metin).slice(0, -1), asistanaSoyle).catch((e) => console.warn('[seslenme]', (e as Error).message));
    return;
  }
  // Eşlikçi: 2,5 sn biriktir (cümle bölünmüş olabilir), sonra değerlendir.
  if (eslikZaman) clearTimeout(eslikZaman);
  eslikZaman = setTimeout(() => {
    eslikZaman = null;
    sinyal('yazici', 'eslikci', 'yeni cümle');
    ajan('eslikci', { durum: 'calisiyor', not: 'araya girmeli mi?' });
    eslikDegerlendir(sonSatirlar(6), (m, tur) => { sinyal('eslikci', 'ses', tur === 'espri' ? 'espri' : 'araya girdi'); asistanaSoyle({ metin: m, tur, sesli: ayarlar().gunKaydi.eslikciSesli }); fuberKonustu(); })
      .then((r) => ajan('eslikci', { durum: 'bekliyor', not: r === 'konustu' ? 'araya girdi' : r === 'sus' ? 'sustu' : '' }, r === 'konustu'))
      .catch((e) => ajan('eslikci', hataDurumu(e)));
  }, 2500);
  // Not tutucu: 15 satır birikti mi?
  // Bulut yolunda takılı Gizli satırlar sayılmaz (düzeltme turu 3): tetik her satırda ateşlenmesin.
  if (bekleyenSatirlar(20).length >= 15) void notTutucuCalistir();
}

/** `firlat`: kullanıcı "Şimdi not tut"a bastı — hata (ör. motor yok) iletilir; arka plan çağrıları sessiz kalır. Eskiden hata
 *  yutuluyor, arayüz "Yeni not çıkmadı." diyordu (Görev 19 denetimi). */
export async function notTutucuCalistir(firlat = false): Promise<{ madde: number }> {
  sonNotTutma = Date.now();
  const bekleyenSatir = bekleyenSatirlar(200).length;
  if (bekleyenSatir) sinyal('yazici', 'not', `${bekleyenSatir} satır`);
  ajan('notTutucu', { durum: 'calisiyor', not: bekleyenSatir ? `${bekleyenSatir} satırı nota çeviriyor` : 'konuşmalara bakıyor' });
  try {
    const r = await notTut();
    ajan('notTutucu', { durum: 'bekliyor', not: r.madde ? `${r.madde} madde${r.mesele ? `, ${r.mesele} takip edilecek iş` : ''}` : 'yeni konuşma yok' }, r.madde > 0);
    if (r.madde) yayinla('kokpit:veri-degisti', {});
    return { madde: r.madde };
  } catch (e) {
    ajan('notTutucu', hataDurumu(e));
    if (firlat) throw e;
    return { madde: 0 };
  }
}

/** Gizli mod kapandı (main.ts, yerel sunucu kapanmadan önce; düzeltme turu 3): bekleyen Gizli satırlar yerelde notlanır. Hata sessiz
 *  (satırlar Gizli kalır, bulut işleri onları görmez). */
export async function gizliKapandi(): Promise<void> {
  try {
    const r = await gizliBekleyenleriNotla();
    if (r.madde) { ajan('notTutucu', { durum: 'bekliyor', not: `${r.madde} madde` }, true); yayinla('kokpit:veri-degisti', {}); }
  } catch (e) {
    console.warn('[gunkaydi] Gizli bekleyen satırlar notlanamadı:', (e as Error).message);
  }
}

const surenRaporlar = new Map<string, Promise<ReturnType<typeof raporGetir>>>();

/** Aynı rapor zaten hazırlanıyorsa onu bekler (zamanlayıcı ile "Şimdi hazırla" çakışmasın). `firlat`: kullanıcı "Şimdi hazırla"ya
 *  bastı — hata (ör. motor yok) iletilir; eskiden yutulup "Bu dönem için rapor çıkaracak not yok." deniyordu (Görev 19 denetimi). */
export function raporCalistir(tur: RaporTuru, donem?: string, bildir = false, firlat = false): Promise<ReturnType<typeof raporGetir>> {
  const anahtar = `${tur}:${donem ?? 'simdi'}`;
  const var_ = surenRaporlar.get(anahtar);
  if (var_) return var_;
  const p = raporCalistirTek(tur, donem, bildir, firlat).finally(() => surenRaporlar.delete(anahtar));
  surenRaporlar.set(anahtar, p);
  return p;
}

async function raporCalistirTek(tur: RaporTuru, donem: string | undefined, bildir: boolean, firlat: boolean): Promise<ReturnType<typeof raporGetir>> {
  sinyal('not', 'rapor', tur === 'gunluk' ? 'günün maddeleri' : tur === 'haftalik' ? 'günlük raporlar' : 'haftalık raporlar');
  ajan('raporcu', { durum: 'calisiyor', not: `${tur === 'gunluk' ? 'günlük' : tur === 'haftalik' ? 'haftalık' : 'aylık'} rapor ${donem ?? ''}`.trim() });
  try {
    if (tur === 'gunluk') await notTut(); // rapordan önce döküm notlansın
    const r = await raporHazirla(tur, donem, { bildir, asistanaGonder });
    ajan('raporcu', { durum: 'bekliyor', not: r?.yerelKorundu ? gizliRaporNotu(tur) : r ? `${tur} ${r.donem} hazır` : 'veri yok' }, Boolean(r));
    return r;
  } catch (e) {
    ajan('raporcu', hataDurumu(e));
    if (firlat) throw e;
    return null;
  }
}

async function tik(): Promise<void> {
  kulagaBildir();
  const g = ayarlar().gunKaydi;
  if (!g.etkin || !ayarlar().kurulumTamam) return;
  const simdi = new Date();
  // Not tutucu: en eski notlanmamış satır 5 dk'yı geçtiyse ya da 15 satır biriktiyse.
  const bekleyen = bekleyenSatirlar(20);
  if (bekleyen.length && (bekleyen.length >= 15 || simdi.getTime() - new Date(bekleyen[0].zaman).getTime() > 5 * 60_000) && simdi.getTime() - sonNotTutma > 2 * 60_000) await notTutucuCalistir();
  // Raporcu: vadesi gelenler (deneme arası 10 dk; motor hatasında döngüye girmesin).
  if (simdi.getTime() - sonRaporDenemesi > 10 * 60_000) {
    const vade = vadeliRaporlar(simdi, g.gunlukRaporSaati, (t, d) => Boolean(raporGetir(t, d)), donemdeVeriVar);
    if (vade.length) {
      sonRaporDenemesi = simdi.getTime();
      for (const v of vade) await raporCalistir(v.tur, v.donem, v.tur === 'gunluk' && v.donem === gunAnahtari(simdi) || v.tur === 'haftalik');
    }
  }
  // Bekçi: saatte bir.
  if (simdi.getTime() - sonBekci > 3600_000) {
    sonBekci = simdi.getTime();
    ajan('bekci', { durum: 'calisiyor', not: 'süresi dolanları budama' });
    try { const b = bekciCalis(); if (b.madde || b.dokum || b.kalem) sinyal('bekci', 'not', `${b.madde + b.dokum + b.kalem} kayıt budandı`); ajan('bekci', { durum: 'bekliyor', not: `${b.madde} madde, ${b.dokum} satır, ${b.kalem} kalem budandı` }, true); } catch (e) { ajan('bekci', hataDurumu(e)); }
  }
}

export function dusunmeBaslat(o: { kulakaGonder: (v: KulakAyari) => void; kulakYenile: () => void; asistanaSoyle: typeof asistanaSoyle; asistanaGonder: typeof asistanaGonder }): void {
  kulakaGonder = o.kulakaGonder;
  kulakYenile = o.kulakYenile;
  asistanaSoyle = o.asistanaSoyle;
  asistanaGonder = o.asistanaGonder;
  whisperBildirici(durumBildir);
  powerMonitor.on('lock-screen', () => { kilitli = true; kulagaBildir(); });
  powerMonitor.on('unlock-screen', () => { kilitli = false; kulagaBildir(); });
  ayarDinle(() => { sonKulak = ''; kulagaBildir(); durumBildir(); });
  setTimeout(() => void tik(), 4000);
  setInterval(() => void tik().catch(() => undefined), 30_000);
}

/** Kulak penceresi yeniden kurulunca son ayarı yeniden gönder. */
export function kulakYenilendi(): void { sonKulak = ''; kulagaBildir(); }
