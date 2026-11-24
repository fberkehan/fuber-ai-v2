// ── Görev gözcüleri (0.11 G9; spec §8; birim testli: tests/isler-gozcu.test.ts) ────────────────────────────────────────────────────────
// Yapay zekâsız, ucuz kontrol: "değişiklik var mı?". Değişiklik yoksa zamanlayıcı yapay zekâyı ÇAĞIRMAZ (token yok) ve aralığı uzatır.
//  · whatsapp: yerel `wa_mesajlar`da önceki izden sonra hedef KİŞİDEN (görev başlarken çözülen jid; görünen ada bakılmaz — düzeltme turu 1)
//    GELEN mesaj; hedef yoksa herkesten.
//  · eposta: yerel eşitlenmiş postada önceki izden sonra gönderende ya da konuda hedef geçen ileti (hesap varsa en çok dakikada bir eşitlenir).
//  · sayfa: adresin görünen metninin özet izi (betik/stil düşer; gövde 2 MB'ta kesilir); Gizli'de görevler çalışmaz, yalnız Normal modda ağa çıkar.
//  · ekran: küçük ekran görüntüsünün kaba izi (16×9 parlaklık; birkaç hücre değişirse değişti). Bilgisayar aracının koordinat hâline dokunmaz,
//    Ayarlar'da ekran/fare yetkisi kapalıyken bakmaz; ekran kullanımdayken zamanlayıcı onu hiç çağırmaz.
//  · saat: kontrol yok, her zaman "değişti" (gözcüsüz iş; her aralıkta yapay zekâ — plan bunu onay kartında söyler).
// İz: whatsapp/eposta için en son kaydın kimliği (yeni kayıt bir kez sayılır), sayfa için metin özeti, ekran için kaba iz. İlk kontrolde
// (önceki iz yok) yalnız iz kaydedilir ve "değişmedi" denir — görev açılmadan önce gelmiş mesaj adım tetiklemez (karar; saat hariç).
// Ağ ve ekran kaynakları testte sahtelenir (gozcuKaynaklari): testler ağa çıkmaz, ekrana bakmaz.
import { createHash } from 'node:crypto';
import { nativeImage } from 'electron';
import { veritabani } from '../vt.js';
import { ayarlar } from '../ayarlar.js';
import { jidAyniMi, type IsOzet } from '../../shared/isler.js';

export interface GozcuSonucu { degisti: boolean; iz: string; bulgu?: string }

export interface GozcuKaynaklari {
  /** Sayfanın ham HTML'i (zaman aşımlı). */
  getir: (adres: string) => Promise<string>;
  /** Ekranın kaba izi (16×9 hücre, hücre başına 0-f parlaklık); ekran alınamazsa null. */
  ekranIzi: () => Promise<string | null>;
  /** Yerel postayı sunucuyla eşitler (hesap yoksa hiçbir şey yapmaz). */
  epostaEsitle: () => Promise<unknown>;
}

const SAYFA_TAVAN = 2_000_000;
/** Gövde akışla okunur ve 2 MB'ta kesilir (düzeltme turu 1): çok büyük sayfa belleğe bütünüyle alınmaz. */
export async function sayfaGetir(adres: string): Promise<string> {
  const r = await fetch(adres, { signal: AbortSignal.timeout(20_000), redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (Fuber AI görev gözcüsü)' } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  if (!r.body) return '';
  const okuyucu = r.body.getReader();
  const cozucu = new TextDecoder();
  let metin = '', bayt = 0;
  try {
    for (;;) {
      const { done, value } = await okuyucu.read();
      if (done) break;
      const kalan = SAYFA_TAVAN - bayt;
      const parca = value.byteLength > kalan ? value.subarray(0, kalan) : value;
      bayt += parca.byteLength;
      metin += cozucu.decode(parca, { stream: true });
      if (bayt >= SAYFA_TAVAN) break;
    }
  } finally { await okuyucu.cancel().catch(() => undefined); }
  return metin + cozucu.decode();
}

/** Ekranın kaba izi. Düzeltme turu 1 (Ö3): bilgisayar aracının koordinat hâlini (sonGoruntu) DEĞİŞTİRMEYEN ayrı yakalama yolu. */
async function ekranIziAl(): Promise<string | null> {
  const { gozcuEkranGoruntusu } = await import('../bilgisayar.js');
  const veri = await gozcuEkranGoruntusu(160);
  if (!veri) return null;
  const bmp = nativeImage.createFromBuffer(Buffer.from(veri, 'base64')).resize({ width: 16, height: 9 }).toBitmap();
  if (bmp.length < 16 * 9 * 4) return null;
  let iz = '';
  for (let i = 0; i < 16 * 9; i++) {
    const [m, y, k] = [bmp[i * 4], bmp[i * 4 + 1], bmp[i * 4 + 2]]; // BGRA
    iz += Math.min(15, Math.floor((0.114 * m + 0.587 * y + 0.299 * k) / 16)).toString(16);
  }
  return iz;
}

let sonEsitleme = 0;
async function epostaEsitle(): Promise<unknown> {
  const { esitle, epostaHesaplari } = await import('../entegrasyon/eposta.js');
  if (!epostaHesaplari().length || Date.now() - sonEsitleme < 60_000) return 0;
  sonEsitleme = Date.now();
  return esitle().catch(() => 0);
}

let kaynak: GozcuKaynaklari = { getir: sayfaGetir, ekranIzi: ekranIziAl, epostaEsitle };
/** Test kancası: ağ ve ekran kaynaklarını değiştirir (verilmeyenler aynen kalır). */
export function gozcuKaynaklari(k: Partial<GozcuKaynaklari>): void { kaynak = { ...kaynak, ...k }; }

/** Görünen metin: betik/stil/yorum ve etiketler düşer, varlıklar sadeleşir, boşluklar teke iner. */
export function sayfaMetni(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>|<!--[\s\S]*?-->/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, '’')
    .replace(/\s+/g, ' ')
    .trim();
}

const kisa = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** WhatsApp gözcüsünün dinlediği hesap: görev başlarken çözülen jid (düzeltme turu 1, Ö1); numara/jid hedef doğrudan; çözülmemiş AD hiçbir
 *  mesajla eşleşmez (görünen ad gönderenin seçimidir — taklit edilebilir). Hedef yoksa herkes. */
function dinlenen(is: IsOzet): string | null | undefined {
  const { hedef, jid } = is.plan.gozcu;
  if (!hedef?.trim()) return undefined;
  if (jid) return jid;
  const r = hedef.replace(/\D/g, '');
  if (hedef.includes('@')) return hedef.trim();
  return r.length >= 10 ? `${r.startsWith('0') ? `9${r}` : r}@s.whatsapp.net` : null;
}

function whatsapp(is: IsOzet, onceki: string | null): GozcuSonucu {
  const vt = veritabani();
  const son = Number((vt.prepare('SELECT MAX(id) n FROM wa_mesajlar').get() as { n: number | null }).n ?? 0);
  const iz = String(son);
  if (onceki === null) return { degisti: false, iz };
  const kimden = dinlenen(is);
  const satirlar = (vt.prepare("SELECT ad, jid, metin FROM wa_mesajlar WHERE id > ? AND yon = 'gelen' ORDER BY id").all(Number(onceki) || 0) as { ad: string | null; jid: string; metin: string }[])
    .filter((m) => kimden === undefined || (kimden !== null && jidAyniMi(kimden, m.jid)));
  if (!satirlar.length) return { degisti: false, iz };
  const bulgu = satirlar.slice(-5).map((m) => `${m.ad ?? m.jid.split('@')[0]}: ${kisa(m.metin.replace(/\s+/g, ' '), 500)}`).join('\n');
  return { degisti: true, iz, bulgu };
}

async function eposta(is: IsOzet, onceki: string | null): Promise<GozcuSonucu> {
  await kaynak.epostaEsitle();
  const vt = veritabani();
  const son = Number((vt.prepare('SELECT MAX(id) n FROM epostalar').get() as { n: number | null }).n ?? 0);
  const iz = String(son);
  if (onceki === null) return { degisti: false, iz };
  const hedef = is.plan.gozcu.hedef?.trim() ?? '';
  // LIKE'ta % ve _ hedefin kendi karakteridir (kaçışlı): "%50" "her şey" demesin.
  const desen = `%${hedef.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const satirlar = (hedef
    ? vt.prepare("SELECT kimden, konu, ozet FROM epostalar WHERE id > ? AND (kimden LIKE ? ESCAPE '\\' OR konu LIKE ? ESCAPE '\\') ORDER BY id").all(Number(onceki) || 0, desen, desen)
    : vt.prepare('SELECT kimden, konu, ozet FROM epostalar WHERE id > ? ORDER BY id').all(Number(onceki) || 0)) as { kimden: string | null; konu: string | null; ozet: string | null }[];
  if (!satirlar.length) return { degisti: false, iz };
  const bulgu = satirlar.slice(-5).map((e) => `${e.kimden ?? '?'} — ${e.konu ?? '(konusuz)'}: ${kisa(String(e.ozet ?? '').replace(/\s+/g, ' '), 300)}`).join('\n');
  return { degisti: true, iz, bulgu };
}

async function sayfa(is: IsOzet, onceki: string | null): Promise<GozcuSonucu> {
  const adres = is.plan.gozcu.hedef ?? '';
  const metin = sayfaMetni(await kaynak.getir(adres));
  const iz = createHash('sha256').update(metin).digest('hex').slice(0, 24);
  if (onceki === null || iz === onceki) return { degisti: false, iz };
  return { degisti: true, iz, bulgu: `Sayfanın şimdiki metni (başı): ${kisa(metin, 1500)}` };
}

/** İki kaba ekran izi arasında parlaklığı belirgin değişen hücre sayısı. */
function izFarki(a: string, b: string): number {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(parseInt(a[i], 16) - parseInt(b[i], 16)) > 1) n++;
  return n;
}
const EKRAN_ESIGI = 6; // 144 hücrenin ~%4'ü: saat/imleç gibi küçük oynamalar değişiklik sayılmaz

async function ekran(onceki: string | null): Promise<GozcuSonucu> {
  // Düzeltme turu 1 (Ö3): Ayarlar → Yetkiler'de ekran/fare kapalıysa ekrana bakılmaz (zamanlayıcı hatayı "değişmedi" sayar, iz değişmez).
  if (!ayarlar().yetki.bilgisayar) throw new Error('ekran yetkisi kapalı');
  const iz = await kaynak.ekranIzi();
  if (!iz) throw new Error('ekran görüntüsü alınamadı');
  if (onceki === null || izFarki(onceki, iz) < EKRAN_ESIGI) return { degisti: false, iz };
  return { degisti: true, iz, bulgu: 'Ekranda belirgin bir değişiklik var (ayrıntı için ekrana bakabilirsin).' };
}

/** Gözcü sözleşmesi: önceki iz (ilk kontrolde null) → değişti mi, yeni iz, değişikliğin kısa bulgusu. Kaynak hatası fırlatır (zamanlayıcı onu
 *  "değişmedi" sayar). */
export async function gozcuKontrol(is: IsOzet, onceki: string | null): Promise<GozcuSonucu> {
  switch (is.plan.gozcu.tur) {
    case 'whatsapp': return whatsapp(is, onceki);
    case 'eposta': return eposta(is, onceki);
    case 'sayfa': return sayfa(is, onceki);
    case 'ekran': return ekran(onceki);
    case 'saat': return { degisti: true, iz: new Date().toISOString() };
  }
}
