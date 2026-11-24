// ── Toplantı modu: Electron bağlantıları (12 Kas 2026) ─────────────────────────────────────────────────────────────────────────────────────
// Çekirdek main/toplanti/oturum.ts'te (Electron'suz, testli); burada ayarlar, Fuber hesabı, Whisper, yapay zekâ (motor/secici.ts yardimciMetin), depo,
// iş izi ve pencere bağlanır.
//  · Bilgisayarın sesi (Windows loopback): arayüz getDisplayMedia ister; istek YALNIZ 'toplanti:baslat'tan sonraki kısa pencerede ve yalnız uygulamanın
//    kendi sayfasından kabul edilir (setDisplayMediaRequestHandler → { video: birincil ekran, audio: 'loopback' }); görüntü izi arayüzde hemen durdurulur.
//  · Tek toplantı: ikinci 'baslat' süreni döndürür. Döküm yalnız toplantıyı başlatan pencereye gider ('toplanti:degisti'; telefona ve çentiğe gitmez);
//    çentik iş izinden "Toplantı · dinliyor" görür.
//  · Bitiş: özetle birlikte bu bilgisayardaki depoya yazılır (main/toplanti/depo.ts). Uygulama kapanırken süren toplantı hemen durur ve elde kalan
//    döküm özetsiz saklanır (ağ beklenmez). Hiçbir şey kendiliğinden yüklenmez.
import type { Session, WebContents } from 'electron';
import { randomBytes } from 'node:crypto';
import { ayarlar, sirOku, sirYaz } from './ayarlar.js';
import { yollar } from './yollar.js';
import { yardimciMetin } from './motor/secici.js';
import { cekirdekMetni } from './hafiza/depo.js';
import { whisperBaslat, whisperCevir, whisperHazirMi, whisperIndirmeBoyutu, whisperKur, whisperKurulumu, whisperTani } from './gunkaydi/whisper.js';
import { tekMotorYolu, yerelHazirMi, yerelModelEtiketi } from './motor/yerel.js';
import { secim, cagirSecimle } from './motor/secici.js';
import { claudeRolSecimi, claudeSecili } from '../shared/motor-secimi.js';
import { tercihDeposu } from './toplanti/tercih.js';
import { yzCagrisiKur } from './toplanti/yz.js';
import { yaziSecenekleri, yaziSeciliDeger, yzEtiketi, yzSecenekleri, yzSeciliDeger, type SecimSecenegi, type ToplantiTercihi, type YzBaglami } from '../shared/toplanti-model.js';
import { WINDOWS_MIKROFON_AYARI } from '../shared/toplanti-kaynak.js';
import { modelAdi } from '../shared/model-bilgisi.js';
import { baglamTemizle, type ToplantiBaglami } from '../shared/toplanti-baglam.js';
import { toplantiIziYaz } from './is-izi.js';
import { ToplantiOturumu, type AkisFabrikasi, type ParcaGirdisi, type ToplantiStt, type YzIstegi, type YzYolu } from './toplanti/oturum.js';
import { ScribeAkisi } from './toplanti/akis.js';
import { geminiYaziya } from './toplanti/gemini.js';
import { GeminiHatasi, geminiAnahtariGecerli, geminiSorunMetni } from '../shared/gemini-yazi.js';
import { toplantiDeposu } from './toplanti/depo.js';
import { sahteStt, sahteYz } from './toplanti/sahte.js';
import { sesBuBilgisayarda } from '../shared/nerede.js';
import { dilGecerli, kayitYap, motorEtiketleri, toplantiIsi, toplantiKimligi, toplantiYolu, varsayilanHedef, type Konusan, type ToplantiDurumu, type YaziYolu } from '../shared/toplanti.js';

const sahteMi = (): boolean => Boolean(process.env.FUBER_DEMO) && process.env.FUBER_TOPLANTI_DENEME === '1';
/** Önizleme senaryosu (yalnız sahte kipte): 'hesap-dustu' (bulutta yazıya çevirme 404), 'yol-yok' (hesapsız, yerel tanıyıcı kurulu değil), 'yerel-yol' (hesapsız, yerel tanıyıcı kurulu). */
const senaryo = (): string => (sahteMi() ? process.env.FUBER_TOPLANTI_DENEME_SENARYO ?? '' : '');
const bulutsuz = (): boolean => sesBuBilgisayarda(ayarlar().yerel);
const depo = () => toplantiDeposu(yollar.veri());

/** Kalıcı seçim (model + yazıya çevirme yolu; main/toplanti/tercih.ts). Her istek o an okur: oturum sürerken değişiklik sonraki istekte devreye girer. */
const tercihler = tercihDeposu(() => yollar.veri());

/** Kept for the quit sequence in main.ts: there are no hosted-speech duration reports in this build, so nothing is ever pending. */
export function toplantiRaporlariniBekle(_ms = 3000): Promise<void> | null {
  return null;
}
/** Live (streaming) transcription needs a hosted token broker, which this build does not have: meetings use local Whisper or the user's own Gemini key. */
const gercekAkis: AkisFabrikasi = {
  kullanilir: () => false,
  ac: () => { throw new Error('Canlı akış bu derlemede yok.'); },
};
/** Önizleme (yalnız sahte kip): FUBER_TOPLANTI_DENEME_SCRIBE verilmişse sahte ElevenLabs sunucusuna (127.0.0.1) bağlanan GERÇEK akış istemcisi; gerçek ağ yok. */
let sahteBelirtecNo = 0;
const sahteAkis = (): AkisFabrikasi | undefined => {
  const taban = process.env.FUBER_TOPLANTI_DENEME_SCRIBE;
  if (!taban || !/^http:\/\/127\.0\.0\.1:\d+$/.test(taban)) return undefined;
  return {
    kullanilir: () => !bulutsuz() && tercihler.oku().yazi !== 'yerel' && !['yol-yok', 'yerel-yol', 'yerel-asili'].includes(senaryo()),
    ac: (konusan, o) => new ScribeAkisi({
      taban, belirtecAl: async () => (senaryo() === 'hesap-dustu' ? null : { token: `${konusan}-${++sahteBelirtecNo}`, sureSn: Number(process.env.FUBER_TOPLANTI_DENEME_SURE ?? 120) }),
      zamanlar: process.env.FUBER_TOPLANTI_DENEME_SURE ? { yenidenDenemeMs: [50, 100, 200] } : undefined, ...o,
    }),
  };
};

/** Kullanıcının kendi Gemini anahtarı (safeStorage; 'api:gemini'): arayüze ASLA gitmez, yalnız "kayıtlı mı" bilgisi. */
const geminiAnahtari = (): string | undefined => { try { return sirOku('api:gemini') || undefined; } catch { return undefined; } };
/** Gemini yolu seçili mi: tercih 'gemini', anahtar kayıtlı ve Gizli / "Yalnız bu bilgisayar" DEĞİL (P14: o kipte hiçbir ses buluta çıkmaz). */
const geminiSecili = (): boolean => !bulutsuz() && tercihler.oku().yazi === 'gemini' && Boolean(geminiAnahtari());
/** Gemini hatası → oturumun bulut hata yoluna (3 üst üste → yerel). Kullanıcıya tek cümle çipte (ana süreç günlüğünde neden). */
async function geminiCevir(wav: Uint8Array): Promise<string | null> {
  const k = geminiAnahtari();
  if (!k) throw new GeminiHatasi('anahtar');
  try { return await geminiYaziya(wav, k); } catch (e) { if (e instanceof GeminiHatasi) console.info(`[toplantı] ${geminiSorunMetni(e.neden)}`); throw e; }
}
/** Ayarlar'dan: Gemini anahtarını kaydet/sil/sor. `{ anahtar: string | null }` yazar (biçim denetlenir; ham anahtar hiç geri dönmez). */
export async function toplantiGemini(v?: unknown): Promise<{ var: boolean; hata?: string }> {
  const o = v && typeof v === 'object' ? (v as { anahtar?: unknown }) : {};
  if (o.anahtar === null || o.anahtar === '') { try { sirYaz('api:gemini', null); } catch (e) { return { var: Boolean(geminiAnahtari()), hata: (e as Error).message }; } if (tercihler.oku().yazi === 'gemini') tercihler.yaz({ yazi: 'otomatik' }); etkin?.oturum.yenile(); return { var: false }; }
  if (typeof o.anahtar === 'string') {
    const k = o.anahtar.trim();
    if (!geminiAnahtariGecerli(k)) return { var: Boolean(geminiAnahtari()), hata: 'Bu bir Google (Gemini) anahtarına benzemiyor: "AIza" ile başlar, boşluk içermez.' };
    try { sirYaz('api:gemini', k); } catch (e) { return { var: false, hata: (e as Error).message }; }
  }
  return { var: Boolean(geminiAnahtari()) };
}

const gercekStt: ToplantiStt = {
  get bulutAdi() { return 'Gemini'; },
  // Gemini seçiliyken canlı Fuber akışı kurulmaz (yol toplu Gemini); aksi hâlde eski kural.
  akis: { kullanilir: () => !geminiSecili() && gercekAkis.kullanilir(), ac: gercekAkis.ac },
  // Dil gönderilmez: sunucu sezer; sezilen dil metinden bulunur (shared/toplanti.ts dilSez). Kullanıcı "Bu bilgisayar"ı seçtiyse hesap yok sayılır (bulut yolu kapanır).
  hesap: { kullanilir: () => geminiSecili() || (false), yaziya: (wav) => geminiCevir(wav) },
  // Toplantıda yerel istek en çok 25 sn bekler (sıra tek yuvalı: asılı bir istek bütün satırları "…"de tutuyordu) ve başlatılamazsa NEDENİYLE fırlatır (WhisperHatasi → çip).
  whisper: {
    hazirMi: whisperHazirMi,
    cevir: (wav) => whisperCevir(Buffer.from(wav), '', undefined, { zamanAsimiMs: 25_000, firlat: true }),
    tani: () => { const t = whisperTani(); return { calisiyor: t.calisiyor, donanim: t.donanim ?? 'bilinmiyor', model: t.model ?? '', derleme: t.derleme ?? '', gecikmeMs: t.gecikmeMs, sonHata: t.sonHata }; },
  },
  // Bulut kullanıcının seçimi dışında neden kapalı (hesap yok / pasif / sunucuda model yok): yerel yazıya düşünce çipte söylenir. "Bu bilgisayar" seçimi ve Gizli hata değildir.
  bulutNeden: () => (bulutsuz() || tercihler.oku().yazi === 'yerel' ? null : null),
};

/** Önizleme: sahte yazıya çevirme de kullanıcının yol seçimini izler ("Bu bilgisayar" seçilince bulut yolu kapanır; gerçek yolla aynı kural). */
function sahteSttSecimli(): ToplantiStt {
  const s = sahteStt({ hesapDusur: senaryo() === 'hesap-dustu', hesapYok: senaryo() === 'yerel-yol' || senaryo() === 'yerel-asili', yerelAsili: senaryo() === 'yerel-asili' });
  return { ...s, hesap: s.hesap && { ...s.hesap, kullanilir: () => tercihler.oku().yazi !== 'yerel' && s.hesap!.kullanilir() } };
}

/** Seçimin dayandığı durum: Gizli mi, Developer mı, Claude (kendi anahtar) etkin mi, yerel yapay zekâ hazır mı (shared/toplanti-model.ts). */
function yzBaglami(): YzBaglami {
  const a = ayarlar();
  const b = bulutsuz();
  const claude = sahteMi() ? process.env.FUBER_TOPLANTI_DENEME_CLAUDE === '1' : claudeSecili(a);
  const e = motorEtiketleriVarsayilan('yok', b); // yz satırı yazıya çevirme yoluna bağlı değil
  return { bulutsuz: b, gelistirici: a.mod === 'gelistirici', claudeSecili: claude, yerelHazir: sahteMi() ? true : yerelHazirMi(), yerelAd: yerelModelEtiketi(), varsayilanEtiket: e.yz, ...(claude ? { claudeYardimci: claudeRolSecimi(a, 'yardimci').model } : {}) };
}

/** Yapay zekâ: 'yerel' → yalnız bu bilgisayardaki yapay zekâ (sabit yol; Gizli kapansa da buluta çıkmaz); 'serbest' → kullanıcının Toplantı seçimi ya da uygulamanın bugünkü kuralı. */
let sonYzKullanimi = '';
const tekMi = (i: YzIstegi) => i.amac === 'toplantı çevirisi' || i.amac === 'toplantı soru denetimi';
const gercekYz = yzCagrisiKur({
  tercihYz: () => tercihler.oku().yz,
  baglam: yzBaglami,
  yerel: (i) => yardimciMetin(i.sistem, i.kullanici, i.amac, i.maxToken, i.json === true, 'yerel', { tekDeneme: tekMi(i) }),
  varsayilan: (i) => yardimciMetin(i.sistem, i.kullanici, i.amac, i.maxToken, i.json === true, undefined, { tekDeneme: tekMi(i) }),
  model: async (i, model) => {
    const y = await cagirSecimle({ saglayici: 'anthropic', model, efor: claudeRolSecimi(ayarlar(), 'yardimci').efor },
      { sistemSabit: i.sistem, mesajlar: [{ rol: 'user', bloklar: [{ tur: 'metin', metin: i.kullanici }] }], araclar: [], maxToken: i.maxToken, jsonCikti: i.json === true, arkaPlan: true, ...(tekMi(i) ? { tekDeneme: true } : {}) },
      i.amac, 'bulut');
    return y.bloklar.filter((b) => b.tur === 'metin').map((b) => (b as { metin: string }).metin).join('').trim();
  },
});
/** Önizleme: sahte yapay zekâ da seçimi izler; son isteği hangi yol karşıladı ('yerel' | 'varsayilan' | model kimliği) hazırlıkta görünür (yalnız sahte kipte). */
const sahteYzSecimli = yzCagrisiKur({
  tercihYz: () => tercihler.oku().yz,
  baglam: yzBaglami,
  yerel: (i) => { sonYzKullanimi = 'yerel'; return sahteYz(i); },
  varsayilan: (i) => { sonYzKullanimi = 'varsayilan'; return sahteYz(i); },
  model: (i, m) => { sonYzKullanimi = m; return sahteYz(i); },
});

interface Etkin { oturum: ToplantiOturumu; sahip: WebContents; kaydedildi: boolean }
let etkin: Etkin | null = null;
let sonDurum: ToplantiDurumu | null = null;
/** Son toplantıyı başlatan pencere (toplantı bittikten sonra da son durum ona gider). */
let sonSahip: WebContents | null = null;

function yayinla(d: ToplantiDurumu): void {
  if (!d.yama) sonDurum = d; // hafif yayın (yama) tam döküm değildir

  toplantiIziYaz(toplantiIsi(d));
  const wc = sonSahip;
  if (wc && !wc.isDestroyed()) wc.send('toplanti:degisti', d);
}

/** Üst şeritteki iki sade satır: hangi yazıya çevirme, hangi yapay zekâ (Ayarlar'daki seçimi yansıtır; teknik kimlik İş kipinde yok — shared/toplanti.ts motorEtiketleri). */
function etiketler(yazi: YaziYolu, b: boolean): { yazi: string; yz: string } {
  const e = motorEtiketleriVarsayilan(yazi, b);
  return { yazi: yazi === 'hesap' && geminiSecili() ? 'Gemini' : e.yazi, yz: yzEtiketi(tercihler.oku().yz, { ...yzBaglami(), varsayilanEtiket: e.yz }) };
}
/** Uygulamanın kendi seçimine göre iki etiket (kullanıcının Toplantı seçimi uygulanmadan). */
function motorEtiketleriVarsayilan(yazi: YaziYolu, b: boolean): { yazi: string; yz: string } {
  const gelistirici = ayarlar().mod === 'gelistirici';
  if (sahteMi()) return motorEtiketleri({ yazi, yz: b ? 'yerel' : 'bulut', yzSaglayici: 'fuber', gelistirici });
  if (b) return motorEtiketleri({ yazi, yz: 'yerel', yzAd: yerelModelEtiketi(), yerelYzHazir: yerelHazirMi(), gelistirici });
  const yol = tekMotorYolu();
  if (yol === 'yerel') return motorEtiketleri({ yazi, yz: 'yerel', yzAd: yerelModelEtiketi(), yerelYzHazir: yerelHazirMi(), gelistirici });
  if (yol === 'yok') return motorEtiketleri({ yazi, yz: 'yok', gelistirici });
  try { const s = secim('yardimci'); return motorEtiketleri({ yazi, yz: 'bulut', yzSaglayici: s.saglayici, yzAd: modelAdi(s.saglayici, s.model), gelistirici }); }
  catch { return motorEtiketleri({ yazi, yz: 'yok', gelistirici }); }
}

export interface ToplantiHazirligi {
  yol: YaziYolu; bulutsuz: boolean; hedefDil: string; suren: ToplantiDurumu | null; sahteSes: boolean;
  /** Fuber hesabı yazıya çevirmeye açık mı (giriş yapılmış, Gizli kapalı…). Hesapsız kullanıcıda yol Whisper'dır (kuruluysa). */
  hesapVar: boolean;
  /** Kullanıcının Gemini anahtarı kayıtlı (yalnız varlık; anahtar hiç gelmez). Gizli'de false. */
  geminiVar: boolean;
  /** Geliştirici kipi: teknik ayrıntılar (model adı, ham hata) ve Gemini anahtar kutusu yalnız burada görünür. */
  gelistirici: boolean;
  whisper: { kurulu: boolean; indirme?: { yuzde: number; adim: string; hata?: string }; boyutMB?: number };
  motorlar: { yazi: string; yz: string };
  baglam: ToplantiBaglami | null;
  /** Kullanıcının kalıcı seçimi + seçilebilir seçenekler (13 Kas): Gizli/"Yalnız bu bilgisayar"da bulut satırı YOK; Business'ta sade ad, Developer'da model adı. */
  tercih: ToplantiTercihi;
  secenekler: { yz: SecimSecenegi[]; yazi: SecimSecenegi[]; yzDeger: string; yaziDeger: 'bulut' | 'yerel' | 'gemini' };
  /** Yalnız önizleme (sahte kip): son yapay zekâ isteğini hangi yol karşıladı. */
  sonYz?: string;
}

/** Başlamadan önce ekrana: yazıya çevirme yolu ve (yoksa) kullanıcıya söylenecek durum. */
function hazirlikCekirdek(): Omit<ToplantiHazirligi, 'whisper'> & { whisper: { kurulu: boolean; indirme?: { yuzde: number; adim: string; hata?: string } } } {
  const b = bulutsuz();
  const kurulu = sahteMi() ? senaryo() !== 'yol-yok' : whisperHazirMi();
  const hesapVar = sahteMi() ? !['yol-yok', 'yerel-yol', 'yerel-asili'].includes(senaryo()) : false;
  const t = tercihler.oku();
  const geminiVar = !b && !sahteMi() && Boolean(geminiAnahtari());
  const yol = toplantiYolu({ bulutsuz: b, hesapKullanilir: hesapVar || (geminiVar && t.yazi === 'gemini'), bulutDustu: false, whisperKurulu: kurulu, tercih: t.yazi === 'gemini' ? 'otomatik' : t.yazi });
  const w = whisperKurulumu();
  const gelistirici = ayarlar().mod === 'gelistirici';
  const yb = yzBaglami();
  return {
    yol, bulutsuz: b, hedefDil: varsayilanHedef(ayarlar().dil), suren: etkin ? etkin.oturum.anlik() : null, sahteSes: sahteMi() && Boolean(process.env.FUBER_TOPLANTI_DENEME_SESI),
    hesapVar: hesapVar && !b, geminiVar, gelistirici, whisper: { kurulu, ...(w.indirme ? { indirme: w.indirme } : {}) }, motorlar: etiketler(yol, b), baglam: taslakBaglam,
    tercih: t,
    secenekler: { yz: yzSecenekleri(yb), yazi: yaziSecenekleri({ bulutsuz: b, gelistirici, hesapVar, whisperKurulu: kurulu, geminiVar }), yzDeger: yzSeciliDeger(t.yz, yb), yaziDeger: yaziSeciliDeger(t.yazi, { bulutsuz: b, hesapVar, geminiVar }) },
    ...(sahteMi() ? { sonYz: sonYzKullanimi } : {}),
  };
}
/** Kullanıcı seçimi (model / yazıya çevirme): kalıcı yazılır; süren toplantıda sonraki istekte devreye girer (etiketler hemen tazelenir). Yeni hazırlığı döndürür. */
export async function toplantiTercihYaz(ham: unknown): Promise<ToplantiHazirligi> {
  tercihler.yaz(ham);
  etkin?.oturum.yenile();
  return toplantiHazirlik();
}
export async function toplantiHazirlik(): Promise<ToplantiHazirligi> {
  const h = hazirlikCekirdek();
  // Inecek GERÇEK boyut yalnız kurulu değilse sorulur (satırda bir kez söylenir; kota sürprizi olmasın).
  const boyutMB = !h.whisper.kurulu ? await whisperIndirmeBoyutu().catch(() => undefined) : undefined;
  return { ...h, whisper: { ...h.whisper, ...(boyutMB ? { boyutMB } : {}) } };
}

/** Başlamadan önce verilen bağlam: yalnız bellekte (uygulama kapanınca gider); toplantı başlayınca oturuma geçer, kayıtla birlikte saklanır. */
let taslakBaglam: ToplantiBaglami | null = null;
/** Bağlam (konu, katılımcılar, notlar, ton, belgeler): toplantı sürüyorsa oturuma, yoksa taslağa. Her durumda sınırlara indirilir. */
export function toplantiBaglam(wc: WebContents, ham: unknown): ToplantiBaglami {
  const b = baglamTemizle(ham);
  const o = sahibi(wc);
  if (o) o.baglamAyarla(b); else taslakBaglam = b;
  return b;
}

/** Yerel yazıya çevirmeyi (Whisper) KULLANICI düğmeye basınca indirir; hiçbir şey kendiliğinden inmez. Süren kurulum varsa ona katılır. */
export async function toplantiWhisperIndir(): Promise<{ kurulu: boolean; indirme?: { yuzde: number; adim: string; hata?: string } }> {
  if (!whisperHazirMi()) void whisperKur().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 50));
  return whisperKurulumu();
}

/** Bilgisayarın sesi kesilince arayüz yeniden ister: yalnız süren toplantının sahibi pencere için kısa izin penceresi yeniden açılır. */
export function toplantiSesiYeniden(wc: WebContents): boolean {
  if (!sahibi(wc) || etkin?.oturum.anlik().hal !== 'dinliyor') return false;
  ekranSesiSonu = Date.now() + 15_000;
  return true;
}

/** Bir ses kaynağı açılamadı: ham hata (ad + ileti) ana sürecin günlüğüne yazılır; kullanıcıya teknik iz gösterilmez (arayüz yalnız tek cümle + eylem). */
export function toplantiKaynakHatasi(v: { konusan?: unknown; ad?: unknown; ileti?: unknown; asama?: unknown }): void {
  const k = v?.konusan === 'karsi' ? 'bilgisayarın sesi' : v?.konusan === 'siz' ? 'mikrofon' : 'ses motoru';
  const kes = (x: unknown, n: number) => String(x ?? '').replace(/[\r\n]+/g, ' ').slice(0, n);
  console.warn(`[toplantı] ${k} açılamadı${v?.asama ? ` (${kes(v.asama, 40)})` : ''}: ${kes(v?.ad, 60)}: ${kes(v?.ileti, 300)}`);
}
/** "Windows ayarlarını aç" eylemi: yalnız bu sabit ms-settings adresi (Gizlilik → Mikrofon) açılır. */
export async function toplantiWindowsMikrofonAyari(): Promise<boolean> {
  if (process.platform !== 'win32') return false;
  try { const { shell } = await import('electron'); await shell.openExternal(WINDOWS_MIKROFON_AYARI); return true; } catch { return false; }
}

// ── Bilgisayarın sesi ──
let ekranSesiSonu = 0;
/** Toplantı başlatılalı en çok 15 sn (ya da arayüz yeniden isteyince): bilgisayarın sesi isteği için izin penceresi açık mı (main.ts izin işleyicisi de sorar). */
export const toplantiEkranSesiIstegiMi = (): boolean => Date.now() <= ekranSesiSonu;
/** main.ts izinlerKur: bir kez. İstek yalnız 'toplanti:baslat'tan sonraki 15 sn içinde ve uygulamanın kendi sayfasından kabul edilir. */
export function toplantiEkranSesiKur(s: Session): void {
  s.setDisplayMediaRequestHandler((istek, cevap) => {
    const bizden = String(istek.frame?.url ?? '').startsWith('fuber://');
    if (!bizden || Date.now() > ekranSesiSonu || !istek.audioRequested) { cevap({}); return; }
    ekranSesiSonu = 0;
    // desktopCapturer tembel yüklenir (testlerin Electron taklidinde yok; yalnız istek gelince gerekir).
    void import('electron').then(({ desktopCapturer }) => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })).then((l) => {
      if (!l[0]) { cevap({}); return; }
      cevap({ video: l[0], audio: 'loopback' });
    }).catch(() => cevap({}));
  });
}

export function toplantiBaslat(wc: WebContents, o: { hedefDil?: unknown; robot?: unknown; baglam?: unknown }): ToplantiDurumu | { yok: true; yol: YaziYolu } {
  if (etkin && etkin.oturum.anlik().hal === 'dinliyor') return etkin.oturum.anlik();
  const h = hazirlikCekirdek();
  if (h.yol === 'yok') return { yok: true, yol: h.yol };
  const hedefDil = dilGecerli(o?.hedefDil) ? o.hedefDil : h.hedefDil;
  const sahte = sahteMi();
  const oturum = new ToplantiOturumu({
    bulutsuz,
    stt: sahte ? { ...sahteSttSecimli(), ...(sahteAkis() ? { akis: sahteAkis() } : {}) } : gercekStt,
    yz: sahte ? sahteYzSecimli : gercekYz,
    baglam: () => { try { return cekirdekMetni(800); } catch { return ''; } },
    etiketler,
    kullaniciAdi: () => ayarlar().kullaniciAdi ?? '',
    gelistirici: () => ayarlar().mod === 'gelistirici',
    degisti: yayinla,
    gunluk: (m) => console.info(m),
    // Uzun toplantı: yalnız değişen satırlar gider (ToplantiDurumu.yama), en sık 30 ms'de bir.
    hafifYayin: true,
    yayinAraligiMs: 30,
    // Önizleme (yalnız sahte kip): satır zaman aşımı kısaltılabilir (FUBER_TOPLANTI_DENEME_ZAMAN ms).
    ...(sahte && Number(process.env.FUBER_TOPLANTI_DENEME_ZAMAN) > 0 ? { satirZamanAsimiMs: Number(process.env.FUBER_TOPLANTI_DENEME_ZAMAN) } : {}),
  }, { id: toplantiKimligi(new Date(), randomBytes(3).toString('hex')), hedefDil, robot: o?.robot === true, baglam: o?.baglam ?? taslakBaglam });
  taslakBaglam = null;
  etkin = { oturum, sahip: wc, kaydedildi: false };
  sonSahip = wc;
  oturum.baslat(); // canlı akış bağlantıları önceden açılır
  ekranSesiSonu = Date.now() + 15_000;
  if (!sahte && oturum.anlik().yol === 'whisper') void whisperBaslat().catch(() => undefined);
  wc.once('destroyed', () => { if (etkin?.sahip === wc) toplantiKapat(); });
  const d = oturum.anlik();
  yayinla(d);
  return d;
}

const konusanMi = (k: unknown): k is Konusan => k === 'karsi' || k === 'siz';
const sayi = (x: unknown): number => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
const sahibi = (wc: WebContents): ToplantiOturumu | null => (etkin && etkin.sahip === wc ? etkin.oturum : null);

export function toplantiBasladi(wc: WebContents, v: { konusan?: unknown; konusmaNo?: unknown; basMs?: unknown }): void {
  if (konusanMi(v?.konusan)) sahibi(wc)?.basladi(v.konusan, sayi(v.konusmaNo), sayi(v.basMs));
}
export function toplantiVazgecildi(wc: WebContents, v: { konusan?: unknown; konusmaNo?: unknown }): void {
  if (konusanMi(v?.konusan)) sahibi(wc)?.vazgecildi(v.konusan, sayi(v.konusmaNo));
}
export function toplantiParca(wc: WebContents, v: Partial<Record<keyof ParcaGirdisi, unknown>>): void {
  const o = sahibi(wc);
  if (!o || !konusanMi(v?.konusan) || !(v.pcm instanceof Uint8Array) || v.pcm.length > 2_000_000) return;
  o.parca({ konusan: v.konusan, konusmaNo: sayi(v.konusmaNo), parcaNo: sayi(v.parcaNo), pcm: v.pcm, son: v.son === true, basMs: sayi(v.basMs), bitMs: sayi(v.bitMs) });
}
/** Akış kipi (14 Kas): VAD olayları tek kanaldan, gönderildiği sırayla — 'basladi' | 'ses' (16 kHz PCM16 blok) | 'bitti' | 'vazgecildi'. */
export function toplantiOlay(wc: WebContents, v: { tur?: unknown; konusan?: unknown; konusmaNo?: unknown; basMs?: unknown; bitMs?: unknown; pcm?: unknown }): void {
  const o = sahibi(wc);
  if (!o || !konusanMi(v?.konusan)) return;
  if (v.tur === 'ses') { if (v.pcm instanceof Uint8Array && v.pcm.length <= 262_144) o.sesGeldi(v.konusan, sayi(v.konusmaNo), v.pcm, sayi(v.basMs)); }
  else if (v.tur === 'basladi') o.basladi(v.konusan, sayi(v.konusmaNo), sayi(v.basMs));
  else if (v.tur === 'bitti') o.konusmaBitti(v.konusan, sayi(v.konusmaNo), sayi(v.bitMs));
  else if (v.tur === 'vazgecildi') o.vazgecildi(v.konusan, sayi(v.konusmaNo));
}
export function toplantiAyar(o: { hedefDil?: unknown; robot?: unknown }): ToplantiDurumu | null {
  if (!etkin) return null;
  if (dilGecerli(o?.hedefDil)) etkin.oturum.hedefDilDegistir(o.hedefDil);
  if (typeof o?.robot === 'boolean') etkin.oturum.robotAc(o.robot);
  return etkin.oturum.anlik();
}

function sakla(e: Etkin, d: ToplantiDurumu): string | null {
  if (e.kaydedildi) return d.id;
  e.kaydedildi = true;
  const k = kayitYap(d, d.bitis ?? Date.now(), e.oturum.baglamKaydi());
  if (!k.satirlar.length) return null; // boş toplantı saklanmaz
  try { depo().kaydet(k); return k.id; } catch (h) { console.warn('[toplantı] saklanamadı:', (h as Error).message); return null; }
}

/** Durdur (arayüz ya da iş izinin "Durdur"u): bekleyenler biter, özet çıkar, saklanır. Durum 'ozetleniyor' olunca arayüz yakalamayı kapatır. */
export async function toplantiDurdur(): Promise<{ durum: ToplantiDurumu; kayit: string | null } | null> {
  const e = etkin;
  if (!e) return null;
  const d = await e.oturum.durdur();
  const kayit = sakla(e, d);
  if (etkin === e) etkin = null;
  yayinla(d);
  toplantiIziYaz(null);
  return { durum: d, kayit };
}

/** Hemen kapat (uygulama kapanıyor, pencere gitti): özet yok, elde kalan döküm saklanır. */
export function toplantiKapat(): void {
  const e = etkin;
  if (!e) return;
  etkin = null;
  const d = e.oturum.iptal();
  sakla(e, d);
  sonDurum = d;
  toplantiIziYaz(null);
}

export const toplantiDurumu = (): ToplantiDurumu | null => (etkin ? etkin.oturum.anlik() : sonDurum);
export const toplantiGecmisi = () => depo().liste();
export const toplantiAl = (id: unknown) => (typeof id === 'string' ? depo().al(id) : null);
export const toplantiSil = (id: string): boolean => depo().sil(id);
