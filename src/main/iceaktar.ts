// ── İçe aktarma klasörü ──────────────────────────────────────────────────────────────────────────────────────
// Geçmiş sohbetler içe aktarılabilir: bir klasöre ne bırakılırsa Fuber onları bilir,
// inceleyip öğrenir, kendi hafızasında tutar. → Belgeler\Fuber AI\İçe Aktar klasörü izlenir. Bırakılan her
// dosya: metne çevrilir → parçalanıp tam metin dizinine girer (atıf: D-<id>) → yardımcı model özet çıkarır ve kalıcı
// bilgileri hafıza yazıcısına işler. Sohbet dışa aktarımları (ChatGPT, Claude, Claude Code .jsonl) her konuşma ayrı
// belge olarak tanınır. Aynı içerik (sha1) ikinci kez işlenmez; dosyalar yerinde kalır (silinmez, taşınmaz).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ayarlar } from './ayarlar.js';
import { veritabani, simdi, yerelGun, meta, metaYaz, metaSil } from './vt.js';
import { yayinla } from './olaylar.js';
import { sadelestir } from './hafiza/normal.js';
import { yardimciMetin } from './motor/secici.js';
import { tekMotorYolu, yerelBaglamAsimiMi } from './motor/yerel.js';
import { hafizaYaz } from './hafiza/yazici.js';
import { aracKaydet, sema, metinKisalt, type Arac } from './ajan/araclar/kayit.js';
import { kokIcindeMi } from './yol-izni.js';
import { ICE_AKTAR_UZANTILARI, ICE_AKTAR_AZAMI_BOYUT, iceAktarimKarari } from '../shared/iceaktar-kural.js';
import { belgeSilindiMi, belgeIslendiYaz, belgeOzetsizYaz, silinmisIzleriKaldir, parcaVarMi, OZETSIZ_NEDEN } from './belge-depo.js';
import { MotorHatasi } from './motor/tipler.js';
import { yerelGirdiButcesi } from '../shared/yerel-butce.js';
import { belgeAyristir, ayristirmaHatasi } from './belge-ayristir.js';
import { ekSinifla, ekMetniKisalt, EK_METIN_SINIRI, BELGE_AZAMI_BAYT, type MetinEki } from '../shared/ek-kural.js';

const UZANTILAR = new Set(ICE_AKTAR_UZANTILARI);
const AZAMI_BOYUT = ICE_AKTAR_AZAMI_BOYUT;

export function iceAktarKlasoru(): string {
  const k = ayarlar().iceAktarKlasoru;
  fs.mkdirSync(k, { recursive: true });
  return k;
}

interface Parca { ad: string; metin: string; tarih?: string }

// ── Biçim ayrıştırıcılar ─────────────────────────────────────────────────────────────────────────────────────
function chatgptDisaAktarim(j: unknown): Parca[] | null {
  if (!Array.isArray(j) || !j.length || typeof j[0] !== 'object' || !('mapping' in (j[0] as object))) return null;
  return (j as { title?: string; create_time?: number; mapping: Record<string, { message?: { author?: { role?: string }; content?: { parts?: unknown[] }; create_time?: number } }> }[]).map((k) => {
    const satirlar = Object.values(k.mapping)
      .map((d) => d.message)
      .filter((m): m is NonNullable<typeof m> => Boolean(m?.content?.parts?.length) && (m?.author?.role === 'user' || m?.author?.role === 'assistant'))
      .sort((a, b) => (a.create_time ?? 0) - (b.create_time ?? 0))
      .map((m) => `${m.author?.role === 'user' ? 'Kullanıcı' : 'Asistan'}: ${(m.content?.parts ?? []).filter((p) => typeof p === 'string').join('\n')}`);
    return { ad: `ChatGPT: ${k.title ?? 'Sohbet'}`, metin: satirlar.join('\n\n'), tarih: k.create_time ? new Date(k.create_time * 1000).toISOString() : undefined };
  });
}

function claudeDisaAktarim(j: unknown): Parca[] | null {
  if (!Array.isArray(j) || !j.length || typeof j[0] !== 'object' || !('chat_messages' in (j[0] as object))) return null;
  return (j as { name?: string; created_at?: string; chat_messages: { sender?: string; text?: string }[] }[]).map((k) => ({
    ad: `Claude: ${k.name || 'Sohbet'}`,
    metin: k.chat_messages.map((m) => `${m.sender === 'human' ? 'Kullanıcı' : 'Asistan'}: ${m.text ?? ''}`).join('\n\n'),
    tarih: k.created_at,
  }));
}

function claudeCodeJsonl(metin: string, ad: string): Parca[] | null {
  const satirlar = metin.split('\n').filter(Boolean).slice(0, 50_000);
  const out: string[] = [];
  let tarih: string | undefined;
  let tanindi = 0;
  for (const s of satirlar) {
    let j: { type?: string; timestamp?: string; message?: { role?: string; content?: unknown } };
    try { j = JSON.parse(s); } catch { continue; }
    if (j.type !== 'user' && j.type !== 'assistant') continue;
    tanindi++;
    tarih ??= j.timestamp;
    const c = j.message?.content;
    const yazi = typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p: { type?: string }) => p?.type === 'text').map((p: { text?: string }) => p.text ?? '').join('\n') : '';
    if (yazi.trim() && !yazi.startsWith('<')) out.push(`${j.type === 'user' ? 'Kullanıcı' : 'Asistan'}: ${yazi.trim()}`);
  }
  if (tanindi < 2) return null;
  return [{ ad: `Claude Code: ${ad}`, metin: out.join('\n\n'), tarih }];
}

/** İnceleme M9: dosya en çok `azami` + 1 bayt okunur (denetimden sonra büyüyen dosya sınırı geçemez); fazlası varsa hata. */
function sinirliOku(dosya: string, azami: number): Buffer {
  const fd = fs.openSync(dosya, 'r');
  try {
    const b = Buffer.alloc(Math.min(azami + 1, Math.max(0, fs.fstatSync(fd).size) + 1));
    const n = fs.readSync(fd, b, 0, b.length, 0);
    if (n > azami) throw new Error(`dosya ${Math.round(azami / 1024 / 1024)} MB sınırını aşıyor`);
    return b.subarray(0, n);
  } finally { fs.closeSync(fd); }
}

/** İkili belge biçimleri (inceleme I1): ana süreçte değil, süre ve bellek sınırlı işçide (belge-ayristir.ts). */
const ISCI_BICIMLERI = new Set(['.pdf', '.docx', '.xlsx', '.pptx', '.eml']);

/** Dosya → metin parçaları. `azamiKarakter`: tutulacak metin (fazlası sayılır, tutulmaz); `azamiBayt`: okunacak en çok bayt. */
async function metneCevir(dosya: string, o: { azamiKarakter?: number; azamiBayt?: number } = {}): Promise<Parca[] & { toplam?: number; kesildi?: boolean; not?: string }> {
  const uz = path.extname(dosya).toLowerCase();
  const ad = path.basename(dosya);
  const azamiKarakter = o.azamiKarakter ?? 2_000_000;
  if (ISCI_BICIMLERI.has(uz)) {
    if (fs.statSync(dosya).size > (o.azamiBayt ?? AZAMI_BOYUT)) throw new Error(`dosya ${Math.round((o.azamiBayt ?? AZAMI_BOYUT) / 1024 / 1024)} MB sınırını aşıyor`);
    const r = await belgeAyristir(dosya, { azamiKarakter });
    const h = ayristirmaHatasi(ad, r);
    if (h || 'hata' in r) throw new Error(h ?? 'okunamadı');
    return Object.assign(r.parcalar.map((x) => ({ ad: x.ad, metin: x.metin, ...(x.tarih ? { tarih: x.tarih } : {}) })), { toplam: r.toplam, kesildi: r.kesildi, ...(r.not ? { not: r.not } : {}) });
  }
  const buf = sinirliOku(dosya, o.azamiBayt ?? AZAMI_BOYUT);
  const metin = buf.toString('utf8');
  if (uz === '.jsonl') return claudeCodeJsonl(metin, ad) ?? [{ ad, metin }];
  if (uz === '.json') {
    try {
      const j = JSON.parse(metin);
      return chatgptDisaAktarim(j) ?? claudeDisaAktarim(j) ?? [{ ad, metin: JSON.stringify(j, null, 1).slice(0, 2_000_000) }];
    } catch { return [{ ad, metin }]; }
  }
  if (uz === '.html' || uz === '.htm') return [{ ad, metin: metin.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n\n') }];
  return [{ ad, metin }];
}

/**
 * Sohbet eki (analiz 11 Kas bulgu 8): dosyayı dosya_oku'nun ayrıştırıcısıyla (metneCevir; ikili biçimler sınırlı işçide) metne çevirir. Tür ve boyut
 * shared/ek-kural.ts'ten; metin EK_METIN_SINIRI'nda AÇIKÇA kısaltılır. Yol preload'dan gelir (gerçek bırakılan/seçilen dosya). Dosya kopyalanmaz.
 */
export async function ekMetniOku(yol: unknown): Promise<MetinEki | { hata: string }> {
  if (typeof yol !== 'string' || !path.isAbsolute(yol)) return { hata: 'Dosyanın yolu okunamadı; dosyayı yeniden seç.' };
  let st: fs.Stats;
  try { st = fs.statSync(yol); } catch { return { hata: `${path.basename(yol)} bulunamadı.` }; }
  if (!st.isFile()) return { hata: `${path.basename(yol)} bir dosya değil.` };
  const k = ekSinifla(path.basename(yol), '', st.size);
  if ('hata' in k) return { hata: k.hata };
  if (k.tur !== 'belge') return { hata: `${path.basename(yol)} belge değil.` };
  try {
    const p = await metneCevir(yol, { azamiKarakter: EK_METIN_SINIRI + 2_000, azamiBayt: BELGE_AZAMI_BAYT });
    const ham = p.length > 1 ? p.map((x) => `## ${x.ad}\n${x.metin}`).join('\n\n') : (p[0]?.metin ?? '');
    const temiz = ham.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n').trim();
    if (!temiz) return { hata: `${path.basename(yol)} içinde okunabilir metin yok (taranmış PDF olabilir).` };
    // Yalnız işçi metni gerçekten kestiyse (ya da metin sınırı aşıyorsa) "kısaltıldı" denir; boşluk temizliği kısaltma sayılmaz.
    const kesildi = Boolean(p.kesildi) || temiz.length > EK_METIN_SINIRI;
    const toplam = kesildi ? Math.max(temiz.length, p.toplam ?? 0) : temiz.length;
    const c = ekMetniKisalt(temiz, EK_METIN_SINIRI, toplam);
    const metin = p.not ? `${c.metin}\n…(${p.not})` : c.metin;
    return { ad: path.basename(yol), tur: 'belge', metin, ...(c.kisaltildi || p.not ? { kisaltildi: true, toplam } : {}) };
  } catch (e) {
    const m = String((e as Error)?.message ?? e);
    return { hata: m.startsWith(path.basename(yol)) ? m.slice(0, 220) : `${path.basename(yol)} okunamadı: ${m.slice(0, 160)}` };
  }
}

/** Ardışık parçaların örtüşmesi (karakter): parçalardan metin yeniden kurulurken çıkarılır (ozetsizBelgeleriIsle). */
const PARCA_ORTUSME = 200;
function parcala(metin: string, boy = 1800, ortusme = PARCA_ORTUSME): string[] {
  const out: string[] = [];
  const paragraf = metin.replace(/\r/g, '').split(/\n{2,}/);
  let tampon = '';
  for (const p of paragraf) {
    if ((tampon + '\n\n' + p).length > boy && tampon) { out.push(tampon); tampon = tampon.slice(-ortusme); }
    tampon = tampon ? `${tampon}\n\n${p}` : p;
    while (tampon.length > boy * 1.6) { out.push(tampon.slice(0, boy)); tampon = tampon.slice(boy - ortusme); }
  }
  if (tampon.trim()) out.push(tampon);
  return out;
}

// ── İşleme kuyruğu ───────────────────────────────────────────────────────────────────────────────────────────
// `acik`: kullanıcı dosyayı AÇIKÇA öğretmek istedi ("Dosya öğret" seçimi, dosya_oku ogren=true): silinmiş belgenin izi kalkar ve dosya
// yeniden öğrenilir (A4). Açılış taraması ve klasör izleyicisi açık değildir: silinen belgenin değişmemiş dosyası yeniden öğrenilmez.
let kuyruk: { yol: string; acik: boolean }[] = [];
let calisiyor = false;

export function dosyaEkle(...yollar_: string[]): void {
  for (const y of yollar_) if (!kuyruk.some((k) => k.yol === y)) kuyruk.push({ yol: y, acik: false });
  void isle();
}

/** Açık öğretme (A4): kuyrukta zaten bekliyorsa açık sayılır. */
export function dosyaOgret(yol: string): void {
  const k = kuyruk.find((x) => x.yol === yol);
  if (k) k.acik = true; else kuyruk.push({ yol, acik: true });
  void isle();
}

/** Kullanıcının YENİ bıraktığı (klasör izleyicisi) ya da seçtiği dosya: öğretilemiyorsa nedeni bildirilir (eskiden sessizce yok
 *  sayılıyordu); geçici/sistem dosyası ve klasör sessiz geçilir. Açılıştaki tarama dosyaEkle'yi doğrudan çağırır (bildirim yok).
 *  `acik`: "Dosya öğret" seçimi — silinmiş belge yeniden öğrenilir (A4). */
export function dosyaBirak(yol: string, acik = false): void {
  let st: fs.Stats;
  try { st = fs.statSync(yol); } catch { return; } // silindi/taşındı
  if (!st.isFile()) return;
  const k = iceAktarimKarari(path.basename(yol), st.size);
  if (k.tur === 'red') { yayinla('iceaktar:hata', { dosya: path.basename(yol), mesaj: k.neden }); return; }
  if (k.tur === 'al') { if (acik) dosyaOgret(yol); else dosyaEkle(yol); }
}

async function isle(): Promise<void> {
  if (calisiyor) return;
  calisiyor = true;
  try {
    while (kuyruk.length) {
      const { yol: dosya, acik } = kuyruk.shift()!;
      try { await dosyaIsle(dosya, acik); } catch (e) { yayinla('iceaktar:hata', { dosya: path.basename(dosya), mesaj: (e as Error).message }); }
      yayinla('kokpit:veri-degisti', { neden: 'iceaktar' });
    }
  } finally { calisiyor = false; }
}

async function dosyaIsle(dosya: string, acik = false): Promise<void> {
  if (!fs.existsSync(dosya)) return;
  const st = fs.statSync(dosya);
  if (!st.isFile() || st.size === 0 || st.size > AZAMI_BOYUT || !UZANTILAR.has(path.extname(dosya).toLowerCase())) return;
  const hash = crypto.createHash('sha1').update(fs.readFileSync(dosya)).digest('hex');
  const vt = veritabani();
  // A4: açık öğretmede silinmiş belgenin izi kalkar (yeniden öğrenilir); hâlâ duran parçalar aşağıda tek tek atlanır. Açık değilse
  // (açılış taraması, klasör izleyicisi) bu içerikten herhangi bir iz varsa dosya geçilir — silinen belge kendiliğinden geri gelmez.
  if (acik) silinmisIzleriKaldir(vt, hash);
  else if (vt.prepare('SELECT 1 FROM belgeler WHERE ozet_hash LIKE ?').get(`${hash}%`)) return;
  const parcalar = await metneCevir(dosya);
  let sira = 0;
  let zatenVar = 0, yeni = 0;
  const ozetiYinele: number[] = [];
  for (const p of parcalar) {
    const metin = p.metin.trim();
    if (metin.length < 20) continue;
    const anahtar = `${hash}:${sira++}`;
    if (parcaVarMi(vt, anahtar)) {
      // Açık öğretmede silinmemiş parça yeniden işlenmez — ama özeti çıkarılamamışsa ('ozetsiz') "Dosya öğret" özeti yeniden dener.
      const b = acik ? vt.prepare('SELECT id, durum FROM belgeler WHERE ozet_hash = ?').get(anahtar) as { id: number; durum: string } | undefined : undefined;
      if (b?.durum === 'ozetsiz') ozetiYinele.push(Number(b.id)); else zatenVar++;
      continue;
    }
    yeni++;
    const r = vt.prepare("INSERT INTO belgeler(yol, ad, tur, boyut, ozet_hash, durum, olusturma) VALUES(?,?,?,?,?, 'bekliyor', ?)")
      .run(dosya, p.ad.slice(0, 200), path.extname(dosya).slice(1), metin.length, anahtar, p.tarih ?? simdi());
    const belgeId = Number(r.lastInsertRowid);
    yayinla('kokpit:veri-degisti', { neden: 'iceaktar' }); // Hafıza → Belgeler "inceleniyor" satırını hemen gösterir
    const bolumler = parcala(metin);
    vt.exec('BEGIN');
    try {
      const ekle = vt.prepare('INSERT INTO parcalar(belge_id, sira, metin) VALUES(?,?,?)');
      const dizin = vt.prepare('INSERT INTO parca_ara(rowid, metin) VALUES(?, ?)');
      bolumler.forEach((b, i) => { const pr = ekle.run(belgeId, i, b); dizin.run(Number(pr.lastInsertRowid), sadelestir(b)); });
      vt.prepare('UPDATE belgeler SET parca_sayisi = ? WHERE id = ?').run(bolumler.length, belgeId);
      vt.exec('COMMIT');
    } catch (e) { vt.exec('ROLLBACK'); throw e; }
    await ozetVeHafiza(belgeId, p.ad, p.tarih, metin);
  }
  if (ozetiYinele.length) {
    // Cila düzeltme turu 3 (N-11): yeniden seçilen belgenin özeti şimdi çıkarılamadıysa (yol yok, hata) sessiz kalınmaz.
    const n = await ozetsizBelgeleriIsle({ idler: ozetiYinele });
    if (n < ozetiYinele.length) yayinla('iceaktar:ozet-sonra', { dosya: path.basename(dosya) });
  }
  // Açıkça seçilen dosya zaten öğrenilmişse sessiz kalınmaz (eskiden "Dosya öğret" hiçbir şey olmamış gibi dönüyordu).
  if (acik && !yeni && zatenVar && !ozetiYinele.length) yayinla('iceaktar:zaten', { dosya: path.basename(dosya) });
}

// ── Özet + hafıza ────────────────────────────────────────────────────────────────────────────────────────────
const OZET_SISTEMI = 'Bu belgeyi/konuşmayı 2-4 cümleyle Türkçe özetle: konu, kimler, kararlar, tarihler. Yalnız özeti yaz.';
const OZET_CIKIS = 600;
/** Kendiliğinden yeniden deneme sınırı (zamanlayıcı); sonrası yalnız "Dosya öğret"le. */
const OZET_DENEME_EN_COK = 3;
const denemeAnahtari = (id: number) => `iceaktar:ozet-deneme:${id}`;

const GECICI_KODLAR: ReadonlySet<string> = new Set(['baglanti', 'limit', 'anahtar']);
/**
 * Özet hatasının türü. Cila düzeltme turu 3 (N-10): varsayılan KALICI — yalnız gerçekten geçici olanlar hak harcamaz: bağlantı kurulamadı /
 * sunucu kapalı (MotorHatasi 'baglanti', fetch'in bağlantı hataları), HTTP 5xx, 429 ve hız/kredi sınırı ('limit'), anahtar/oturum ('anahtar').
 * Kalıcı (hak harcar, 3'te durur): zaman aşımı (yerel 90 sn — aynı belge aynı sonucu verir), boş yanıt (Fuber ağ geçidi 'bilinmiyor'), kodsuz
 * ya da 'bilinmiyor'/'istek' 4xx (404/413/422…), bağlam aşımı, beklenmeyen hata. Eskiden 'istek' dışındaki her şey geçiciydi: yerel zaman
 * aşımı ve bulutun boş yanıtı SONSUZA DEK yeniden deneniyordu (bulutta faturalı).
 */
export function ozetHataTuru(e: unknown): 'kalici' | 'gecici' {
  if (e instanceof MotorHatasi) {
    if (GECICI_KODLAR.has(e.kod)) return 'gecici';
    const durum = e.durum ?? Number(/(?:HTTP|hatası) (\d{3})\b/.exec(e.message)?.[1] ?? 0);
    return durum >= 500 || durum === 429 ? 'gecici' : 'kalici';
  }
  const h = e as { name?: string; message?: string; cause?: { code?: unknown } } | null;
  if (h?.name === 'TimeoutError') return 'kalici';
  if (/ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|EHOSTUNREACH|ENETUNREACH/.test(String(h?.cause?.code ?? '')) || (h?.name === 'TypeError' && /fetch failed/i.test(h.message ?? ''))) return 'gecici';
  return 'kalici';
}

/** Belgenin özeti (yardımcı model). Başarısızsa YUTULMAZ: `{ hata }` döner, çağıran belgeyi 'ozetsiz' bırakır. 0.12 cila düzeltme turu 1
 *  (I-1): yerel yolda girdi yerel sunucunun yuvasına sığacak kadar (shared/yerel-butce.ts). Düzeltme turu 2 (a): yerel bağlam aşımında girdi
 *  yarıya indirilip BİR kez yeniden denenir. Boş yanıt biçim hatasıdır (kalıcı). */
async function belgeOzeti(ad: string, metin: string): Promise<{ ozet: string } | { hata: 'kalici' | 'gecici' }> {
  const bas = `Belge: ${ad}\n\n`;
  const sinir = tekMotorYolu() === 'yerel' ? Math.min(14000, Math.max(500, yerelGirdiButcesi(OZET_SISTEMI, OZET_CIKIS) - bas.length)) : 14000;
  // Cila düzeltme turu 3 (N-10): iç yeniden deneme yok (tekDeneme) — yeniden deneme zamanlayıcının ve deneme hakkının işi.
  const dene = async (n: number) => (await yardimciMetin(OZET_SISTEMI, bas + metin.slice(0, n), 'iceaktar-ozet', OZET_CIKIS, false, undefined, { tekDeneme: true })).trim();
  try {
    let o: string;
    try { o = await dene(sinir); } catch (e) { if (!yerelBaglamAsimiMi(e)) throw e; o = await dene(Math.floor(sinir / 2)); }
    if (o) return { ozet: o };
    console.warn(`[içe aktar] özet boş döndü (${ad})`);
    return { hata: 'kalici' };
  } catch (e) {
    console.warn(`[içe aktar] özet çıkarılamadı (${ad}): ${(e as Error).message}`);
    return { hata: ozetHataTuru(e) };
  }
}

/** 'ozetsiz' yazımı ve deneme hakkı: yalnız kalıcı hata hak harcar (N-1); hak bitince neden "deneme hakkı bitti" olur (arayüz söyler). */
function ozetsizYaz(belgeId: number, neden: 'motorYok' | 'gecici' | 'kalici'): boolean {
  const vt = veritabani();
  let n: string = OZETSIZ_NEDEN[neden];
  if (neden === 'kalici') {
    const d = Number(meta(denemeAnahtari(belgeId)) ?? 0) + 1;
    metaYaz(denemeAnahtari(belgeId), String(d));
    if (d >= OZET_DENEME_EN_COK) n = OZETSIZ_NEDEN.hakBitti;
  } else if (vt.prepare('SELECT 1 FROM belgeler WHERE id = ? AND hata = ?').get(belgeId, OZETSIZ_NEDEN.hakBitti)) n = OZETSIZ_NEDEN.hakBitti;
  return belgeOzetsizYaz(vt, belgeId, n, simdi());
}

/**
 * Özet + hafıza (yardımcı model), sonra belge "işlendi". 0.12 cila: kapı tek kuraldır (yol) — "Yalnız bu bilgisayar"/Gizli'de bulut motoru
 * yokken de yerel hazırsa özet yerelde (tek seçici: motor/secici.ts). Düzeltme turu 1 (I-1): özet çağrısı başarısızsa belge boş özetle
 * "işlendi" OLMAZ — 'ozetsiz' kalır, hafızaya işlenmez; zamanlayıcı ve "Dosya öğret" yeniden dener (ozetsizBelgeleriIsle). Düzeltme turu 2
 * (N-2): motor yolu yokken de (model iniyor, hesap onay bekliyor) 'ozetsiz' — hak harcamadan; yol hazır olunca zamanlayıcı özetler (eskiden
 * boş özetle "işlendi" oluyor ve hiç özetlenmiyordu). Dönen: belgenin son hâli.
 */
async function ozetVeHafiza(belgeId: number, ad: string, tarih: string | undefined, metin: string): Promise<'islendi' | 'ozetsiz' | 'gecici' | 'silindi'> {
  const vt = veritabani();
  const ozetsiz = (neden: 'motorYok' | 'gecici' | 'kalici'): 'ozetsiz' | 'silindi' => {
    if (!ozetsizYaz(belgeId, neden)) return 'silindi';
    yayinla('iceaktar:ozetsiz', { id: belgeId, ad });
    return 'ozetsiz';
  };
  if (tekMotorYolu() === 'yok') return ozetsiz('motorYok');
  const o = await belgeOzeti(ad, metin);
  // Özet beklenirken kullanıcı belgeyi sildiyse (Hafıza → Belgeler, "inceleniyor"): hafızaya işlenmez (Görev 20b).
  if (belgeSilindiMi(vt, belgeId)) return 'silindi';
  if ('hata' in o) {
    const r = ozetsiz(o.hata);
    return r === 'silindi' ? r : o.hata === 'gecici' ? 'gecici' : 'ozetsiz'; // 'gecici': yeniden deneme koşusu durur (turu 3)
  }
  const ozet = o.ozet;
  hafizaYaz({ kullanici: `[İçe aktarılan belge: ${ad}${tarih ? `, ${yerelGun(tarih)}` : ''}]\n${metin.slice(0, 9000)}`, asistan: ozet, kaynak: `dosya:D-${belgeId}` });
  // Silinmiş belge "işlendi" olup geri gelmez (koşullu güncelleme).
  if (!belgeIslendiYaz(vt, belgeId, ozet, simdi())) return 'silindi';
  metaSil(denemeAnahtari(belgeId));
  yayinla('iceaktar:islendi', { id: belgeId, ad });
  return 'islendi';
}

/** Süren yeniden deneme koşusu (tek koşu; kendiliğinden koşu süren varken atlanır, "Dosya öğret" onu BEKLER — turu 3, N-11). */
let surenKosu: Promise<unknown> | null = null;
export interface OzetKosusu { islenen: number; gecici: boolean }
/**
 * Düzeltme turu 1 (I-1): özeti çıkarılamamış ('ozetsiz') belgelerin özetini yeniden dener — metin parçalarından yeniden kurulur (örtüşme
 * çıkarılır). Kendiliğinden (zamanlayıcı, 15 dk'da bir, sessiz saat dışında; `idler` yok): motor yolu varken, içe aktarma kuyruğu boşken.
 * Düzeltme turu 2 (N-1): adaylar hakkı KALANLAR (kalıcı hata < OZET_DENEME_EN_COK), en az denenmiş ve en eski önce — hakkı bitenler artık
 * sıranın başını tutmaz; hak yalnız kalıcı hatada harcanır (ozetsizYaz). `idler` ("Dosya öğret" aynı dosyayı yeniden seçti): sınır yok.
 * Dönen: işlenen belge sayısı.
 */
export async function ozetsizBelgeleriIsle(o: { idler?: number[] } = {}): Promise<number> {
  return (await ozetKosusu(o)).islenen;
}

/**
 * Yeniden deneme koşusu; zamanlayıcı geri çekilme için sonucu da okur (zamanlayici.ts bekleyenOzetler). Cila düzeltme turu 3 (N-10):
 *  · koşu İLK geçici sonuçta durur (sunucu/ağ aşağıyken kalan belgeler boşuna denenmez; koşu en çok bir başarısız geçici çağrı yapar);
 *  · sıra: hakkı kalanlar, en az denenmiş, sonra en uzun süredir denenmemiş (COALESCE(islenme, olusturma); 'ozetsiz' yazımı islenme'yi
 *    günceller) — geçici hata veren aynı belge her koşuda başa gelmez;
 *  · N-11: "Dosya öğret" (`idler`) süren koşuyu bekler, sonra dener (eskiden sessizce 0 dönüyordu);
 *  · N-12: metni boş belge sırayı tutmaz — hakkı bitmiş sayılır.
 */
export async function ozetKosusu(o: { idler?: number[] } = {}): Promise<OzetKosusu> {
  const elle = Boolean(o.idler);
  if (!elle && (surenKosu || calisiyor)) return { islenen: 0, gecici: false };
  while (surenKosu) await surenKosu.catch(() => undefined);
  if (tekMotorYolu() === 'yok') return { islenen: 0, gecici: false };
  const kosu = (async (): Promise<OzetKosusu> => {
    let n = 0, gecici = false;
    const vt = veritabani();
    const satirlar = (elle
      ? o.idler!.map((id) => vt.prepare("SELECT id, ad, olusturma FROM belgeler WHERE id = ? AND durum = 'ozetsiz'").get(id))
      : vt.prepare(`SELECT b.id, b.ad, b.olusturma FROM belgeler b LEFT JOIN meta m ON m.k = 'iceaktar:ozet-deneme:' || b.id
          WHERE b.durum = 'ozetsiz' AND CAST(COALESCE(m.v, '0') AS INTEGER) < ? AND COALESCE(b.hata, '') != ?
          ORDER BY CAST(COALESCE(m.v, '0') AS INTEGER), COALESCE(b.islenme, b.olusturma), b.id LIMIT 5`).all(OZET_DENEME_EN_COK, OZETSIZ_NEDEN.hakBitti)
    ).filter(Boolean) as { id: number; ad: string; olusturma: string }[];
    for (const b of satirlar) {
      const id = Number(b.id);
      if (tekMotorYolu() === 'yok') break; // yol arada gittiyse (model kaldırıldı, Gizli açıldı) kalan belgeler "motor yok" diye işaretlenmesin
      const parca = vt.prepare('SELECT metin FROM parcalar WHERE belge_id = ? ORDER BY sira').all(id) as { metin: string }[];
      const metin = parca.map((x, i) => (i ? x.metin.slice(PARCA_ORTUSME) : x.metin)).join('').trim();
      if (!metin) { // N-12: özetlenecek metin yok — kendiliğinden hiç denenmez
        metaYaz(denemeAnahtari(id), String(OZET_DENEME_EN_COK));
        belgeOzetsizYaz(vt, id, OZETSIZ_NEDEN.hakBitti, simdi());
        continue;
      }
      const sonuc = await ozetVeHafiza(id, String(b.ad), String(b.olusturma), metin);
      if (sonuc === 'islendi') n++;
      if (sonuc === 'gecici') { gecici = true; break; }
    }
    if (n) yayinla('kokpit:veri-degisti', { neden: 'iceaktar' });
    return { islenen: n, gecici };
  })();
  surenKosu = kosu;
  try { return await kosu; } finally { if (surenKosu === kosu) surenKosu = null; }
}

// ── İzleme ───────────────────────────────────────────────────────────────────────────────────────────────────
let izleyici: fs.FSWatcher | null = null;
let yenidenIzle: NodeJS.Timeout | null = null;
const zamanlar = new Map<string, NodeJS.Timeout>();

function izle(): void {
  izleyici?.close();
  izleyici = null;
  const k = iceAktarKlasoru(); // silindiyse yeniden oluşturulur
  try {
    const w = fs.watch(k, { recursive: true }, (_t, ad) => {
      if (!ad || ad === 'BENİ OKU.txt') return;
      const y = path.join(k, ad);
      clearTimeout(zamanlar.get(y));
      zamanlar.set(y, setTimeout(() => { zamanlar.delete(y); dosyaBirak(y); }, 2500)); // kopyalama bitsin
    });
    // Klasör silinir/taşınırsa ya da sürücü koparsa 'error' gelir: dinleyicisiz 'error' ana süreci düşürür.
    // İzleyici kapatılıp 30 sn sonra yeniden kurulur.
    w.on('error', (e) => {
      console.error('[içe aktar] klasör izlemesi koptu:', e.message);
      if (izleyici === w) { w.close(); izleyici = null; }
      if (!yenidenIzle) yenidenIzle = setTimeout(() => { yenidenIzle = null; izle(); }, 30_000);
    });
    izleyici = w;
  } catch { /* izleme desteklenmiyor */ }
}

export function iceAktarmayiBaslat(): void {
  const k = iceAktarKlasoru();
  const benioku = path.join(k, 'BENİ OKU.txt');
  if (!fs.existsSync(benioku)) fs.writeFileSync(benioku, 'Bu klasöre bıraktığın her şeyi Fuber okur, özetler ve hafızasına işler.\n\nDesteklenen: ChatGPT/Claude dışa aktarımları (conversations.json), Claude Code sohbet kayıtları (.jsonl), PDF, Word (.docx), e-posta (.eml), metin, Markdown, CSV, HTML.\nDosyalar yerinde kalır; aynı içerik iki kez işlenmez.\n', 'utf8');
  // Açılışta: klasördeki işlenmemiş dosyalar.
  const tara = (d: string, derinlik = 0) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const y = path.join(d, e.name);
      if (e.isDirectory() && derinlik < 4) tara(y, derinlik + 1);
      else if (e.isFile() && e.name !== 'BENİ OKU.txt') dosyaEkle(y);
    }
  };
  try { tara(k); } catch { /* klasör okunamadı */ }
  izle();
}

export function iceAktarmaDurumu(): { klasor: string; bekleyen: number; islenen: number; hata: number; ozetsiz: number; son: { ad: string; durum: string; zaman: string }[] } {
  const vt = veritabani();
  // Cila düzeltme turu 2 (N-3): 'ozetsiz' (parçaları aranabilir, özet sonra) kendi kovasında — "bekliyor" sayılmaz.
  const s = vt.prepare("SELECT SUM(durum='bekliyor') b, SUM(durum='islendi') i, SUM(durum='hata') h, SUM(durum='ozetsiz') o FROM belgeler").get() as Record<string, number>;
  // Hafıza → Belgeler'den silinen belgenin izi (durum 'silindi'; Görev 20b) burada görünmez.
  const son = (vt.prepare("SELECT ad, durum, COALESCE(islenme, olusturma) z FROM belgeler WHERE durum != 'silindi' ORDER BY id DESC LIMIT 12").all() as Record<string, string>[]).map((x) => ({ ad: x.ad, durum: x.durum, zaman: x.z }));
  return { klasor: iceAktarKlasoru(), bekleyen: (s?.b ?? 0) + kuyruk.length, islenen: s?.i ?? 0, hata: s?.h ?? 0, ozetsiz: s?.o ?? 0, son };
}

// ── Dosya araçları ───────────────────────────────────────────────────────────────────────────────────────────
/** Dosya araçlarının izinli kökleri (okuma: dosya_oku/dosya_listele; yazma: ajan/araclar/dosya-yaz.ts, R9). */
export function izinliKokler(): string[] {
  const ev = process.env.USERPROFILE ?? '';
  return [iceAktarKlasoru(), path.join(ev, 'Desktop'), path.join(ev, 'Documents'), path.join(ev, 'Downloads'), path.join(ev, 'OneDrive')];
}
const izinliMi = (y: string) => kokIcindeMi(y, izinliKokler());

const dosyaAraclari: Arac[] = [
  {
    grup: 'dosya', risk: 'serbest',
    etiket: (g) => `Klasöre bakıyor: ${metinKisalt(String(g.yol ?? ''), 50)}`,
    tanim: { ad: 'dosya_listele', aciklama: 'Bir klasördeki dosyaları listeler (Masaüstü, Belgeler, İndirilenler, İçe Aktar serbest; başka yer onay ister).', sema: sema({ yol: { type: 'string' } }, ['yol']) },
    async calistir(g, b) {
      const y = path.resolve(String(g.yol).replace(/^~/, process.env.USERPROFILE ?? ''));
      if (!izinliMi(y) && !ayarlar().yetki.tamYetki) {
        const k = await b.onay({ baslik: 'Bu klasöre bakılsın mı?', aciklama: y, tehlike: 'dusuk' });
        if (k === 'reddet') return { icerik: 'İzin verilmedi (reddedildi).', hata: true };
      }
      const l = fs.readdirSync(y, { withFileTypes: true }).slice(0, 300).map((e) => {
        let ek = '';
        try { if (e.isFile()) ek = ` (${Math.round(fs.statSync(path.join(y, e.name)).size / 1024)} KB)`; } catch { /* okunamadı */ }
        return `${e.isDirectory() ? '📁' : '📄'} ${e.name}${ek}`;
      });
      return { icerik: `${y}\n${l.join('\n')}`, ozet: `${l.length} öğe` };
    },
  },
  {
    grup: 'dosya', risk: 'serbest',
    etiket: (g) => `Dosyayı okuyor: ${path.basename(String(g.yol ?? ''))}`,
    tanim: { ad: 'dosya_oku', aciklama: 'Bir dosyanın metnini okur (PDF, Word, e-posta, metin…). İzinli klasör dışı onay ister. ogren=true ise ayrıca içe aktarıp hafızaya işler.', sema: sema({ yol: { type: 'string' }, ogren: { type: 'boolean' } }, ['yol']) },
    async calistir(g, b) {
      const y = path.resolve(String(g.yol).replace(/^~/, process.env.USERPROFILE ?? ''));
      if (!izinliMi(y) && !ayarlar().yetki.tamYetki) {
        const k = await b.onay({ baslik: 'Bu dosya okunsun mu?', aciklama: y, tehlike: 'dusuk' });
        if (k === 'reddet') return { icerik: 'İzin verilmedi (reddedildi).', hata: true };
      }
      if (fs.statSync(y).size > AZAMI_BOYUT) return { icerik: 'Dosya çok büyük (60 MB üstü).', hata: true };
      const p = await metneCevir(y);
      if (g.ogren) dosyaOgret(y); // kullanıcı açıkça "öğren" dedi: silinmiş belge de yeniden öğrenilir (A4)
      const metin = p.map((x) => `## ${x.ad}\n${x.metin}`).join('\n\n');
      return { icerik: metin.slice(0, 50_000) + (metin.length > 50_000 ? `\n…(${metin.length} karakterin ilk 50.000'i)` : ''), ozet: `${Math.round(metin.length / 1000)}K karakter` };
    },
  },
];

export function dosyaAraclariniKaydet(): void { aracKaydet(...dosyaAraclari); }
