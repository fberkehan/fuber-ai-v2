// ── Türkçe metin normalizasyonu ve arama sorgusu ─────────────────────────────────────────────────────────────
// FTS5 unicode61 "ı"yı "i" saymaz ve Türkçe ekleri bilmez: "toplantı" araması "toplantısı"nı bulamazdı (Electron
// içinde denendi). Çözüm: dizine ve sorguya AYNI sadeleştirilmiş metin girer (tr küçük harf + ı→i, ş→s …) ve 4+
// harfli kelimeler ÖNEK araması (kelime*) olur; Türkçe ekler böylece yakalanır. Sık kelimeler (ve, bir, the…) atılır.

import { turkceKok, esAnlamlilar } from '../../shared/tr-kok.ts';

const HARITA: Record<string, string> = { ı: 'i', i̇: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' };

export function sadelestir(metin: string): string {
  return metin
    .toLocaleLowerCase('tr-TR')
    .replace(/[ışğüöçâîû]|i̇/g, (h) => HARITA[h] ?? h)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

const DURAK = new Set(
  (
    've veya ile ama fakat ancak ki da de mi mı mu mü bu şu o bir iki için gibi kadar daha çok az en ne nasıl neden niye ' +
    'hangi kim nerede ne zaman şey şeyi var yok olan olarak olur oldu olsun ise eğer hem her hiç bana beni benim sana seni ' +
    'senin biz bizim siz onu onun ona şimdi sonra önce yine zaten artık lütfen tamam evet hayır acaba bile sadece hep ' +
    'the a an and or but of to in on at for with is are was were be been this that it you i me my we our your what how why ' +
    'when where which who can could would should please hey fuber'
  )
    .split(/\s+/)
    .map(sadelestir),
);

/** Sadeleştirilmiş, durak kelimeleri atılmış anahtar kelimeler (sırası korunur, tekrar yok). */
export function anahtarKelimeler(metin: string, en = 12): string[] {
  const out: string[] = [];
  for (const k of sadelestir(metin).split(/[^\p{L}\p{N}_]+/u)) {
    if (k.length < 2 || DURAK.has(k) || out.includes(k)) continue;
    out.push(k);
    if (out.length >= en) break;
  }
  return out;
}

/** Sözcüğün arama öneki: eski kural (sözcük − 2 harf, en az 4) ile Türkçe kökün (shared/tr-kok.ts) KISASI — "toplantılarımı" → "toplan"*. */
export function aramaOneki(w: string): string {
  if (w.length < 4) return w;
  const eski = w.slice(0, Math.max(4, w.length - 2));
  const kok = turkceKok(w);
  return kok.length >= 4 && kok.length < eski.length ? kok : eski;
}

/** FTS5 MATCH ifadesi: kelimeler VEYA ile; 4+ harf önek araması (Türkçe ekler, hafif kökleyici). Sık eş anlamlılar ("rapor"~"özet",
 *  "toplantı"~"görüşme") aynı terimin VEYA'lı eşi olur (11 Kas analizi #5). Boşsa null. */
export function ftsSorgusu(metin: string, kip: 've' | 'veya' = 'veya'): string | null {
  const terim = (t: string) => (t.length >= 4 ? `"${t}"*` : `"${t}"`);
  const k = anahtarKelimeler(metin).map((w) => {
    const on = aramaOneki(w);
    const es = esAnlamlilar(turkceKok(w)).filter((x) => !x.startsWith(on)); // eşler zaten kök: önek kısaltılmaz
    return es.length ? `(${[on, ...es].map(terim).join(' OR ')})` : terim(on);
  });
  if (!k.length) return null;
  return k.join(kip === 've' ? ' AND ' : ' OR ');
}

// ── Tarih ifadeleri ──────────────────────────────────────────────────────────────────────────────────────────
// "dün", "geçen hafta", "bu ay", "18 ekim", "3 gün önce" → [başlangıç, bitiş) ISO aralığı. Hafıza aramasında tarih
// süzgeci olur ("geçen hafta ACME için ne konuşmuştuk").
const AYLAR = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];

function gunBasi(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function gunEkle(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

export function tarihAraligi(metin: string, simdi = new Date()): { baslangic: string; bitis: string; ifade: string } | null {
  const s = sadelestir(metin);
  const bugun = gunBasi(simdi);
  const aralik = (a: Date, b: Date, ifade: string) => ({ baslangic: a.toISOString(), bitis: b.toISOString(), ifade });
  let m: RegExpMatchArray | null;
  if (/\bbugun\b/.test(s)) return aralik(bugun, gunEkle(bugun, 1), 'bugün');
  if (/\bdun\b/.test(s)) return aralik(gunEkle(bugun, -1), bugun, 'dün');
  if (/\bevvelsi gun\b/.test(s)) return aralik(gunEkle(bugun, -2), gunEkle(bugun, -1), 'evvelsi gün');
  if ((m = s.match(/\b(\d{1,2}) (gun|hafta|ay) (once|evvel)\b/))) {
    const n = Number(m[1]);
    const gun = m[2] === 'gun' ? n : m[2] === 'hafta' ? n * 7 : n * 30;
    const merkez = gunEkle(bugun, -gun);
    const pay = m[2] === 'gun' ? 1 : m[2] === 'hafta' ? 4 : 15;
    return aralik(gunEkle(merkez, -pay + 1), gunEkle(merkez, pay), `${n} ${m[2]} önce`);
  }
  if (/\bgecen hafta\b/.test(s)) {
    const pzt = gunEkle(bugun, -((bugun.getDay() + 6) % 7));
    return aralik(gunEkle(pzt, -7), pzt, 'geçen hafta');
  }
  if (/\bbu hafta\b/.test(s)) {
    const pzt = gunEkle(bugun, -((bugun.getDay() + 6) % 7));
    return aralik(pzt, gunEkle(pzt, 7), 'bu hafta');
  }
  if (/\bgecen ay\b/.test(s)) {
    const a = new Date(bugun.getFullYear(), bugun.getMonth() - 1, 1);
    return aralik(a, new Date(bugun.getFullYear(), bugun.getMonth(), 1), 'geçen ay');
  }
  if (/\bbu ay\b/.test(s)) return aralik(new Date(bugun.getFullYear(), bugun.getMonth(), 1), new Date(bugun.getFullYear(), bugun.getMonth() + 1, 1), 'bu ay');
  if ((m = s.match(/\b(\d{1,2}) (ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)(?: (\d{4}))?/))) {
    const ay = AYLAR.indexOf(m[2]);
    let yil = m[3] ? Number(m[3]) : bugun.getFullYear();
    const a = new Date(yil, ay, Number(m[1]));
    if (!m[3] && a > simdi) { yil -= 1; a.setFullYear(yil); }
    return aralik(a, gunEkle(a, 1), `${m[1]} ${m[2]}`);
  }
  return null;
}

/** Kaba token tahmini (Türkçe metinde ≈ 3,2 karakter/token); bağlam bütçesi için yeterli. */
export function tokenTahmini(metin: string): number {
  return Math.ceil(metin.length / 3.2);
}
