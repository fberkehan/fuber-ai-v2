// ── Düşünme motoru: saf hesaplar (birim testli: tests/donem.test.ts) ─────────────────────────────────────────
// Dönem anahtarları (gün "2026-10-19", ISO hafta "2026-W43", ay "2026-10"), çalışma saati, vadesi gelen raporlar,
// saklama (silinme) tarihleri ve mesele eşleştirme. Tarihler KULLANICININ yerel saatine göre (UTC değil).
// İçe aktarma YOK (testler Node'un tür ayıklamasıyla .ts'yi doğrudan yükler; .js uzantılı içe aktarma çözülmez):
// hafiza/normal.ts'teki sadeleştirmenin kısa eşi burada.

const HARITA: Record<string, string> = { ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' };
const sadelestir = (m: string) => m.toLocaleLowerCase('tr-TR').replace(/[ışğüöçâîû]/g, (h) => HARITA[h] ?? h).normalize('NFKD').replace(/[̀-ͯ]/g, '');

const iki = (n: number) => String(n).padStart(2, '0');
const GUN = 86_400_000;

export const gunAnahtari = (d: Date): string => `${d.getFullYear()}-${iki(d.getMonth() + 1)}-${iki(d.getDate())}`;
export const ayAnahtari = (d: Date): string => `${d.getFullYear()}-${iki(d.getMonth() + 1)}`;
const gunBasi = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const gundenTarih = (g: string): Date => { const [y, a, d] = g.split('-').map(Number); return new Date(y, a - 1, d); };
export const gunEkle = (g: string, n: number): string => { const d = gundenTarih(g); d.setDate(d.getDate() + n); return gunAnahtari(d); };

/** ISO 8601 hafta: pazartesi başlar; yılın ilk perşembesini içeren hafta 1. */
export function isoHafta(d: Date): string {
  const t = gunBasi(d);
  const haftaGunu = (t.getDay() + 6) % 7; // Pzt = 0
  t.setDate(t.getDate() - haftaGunu + 3); // o haftanın perşembesi
  const yil = t.getFullYear();
  const ilkPersembe = new Date(yil, 0, 4);
  ilkPersembe.setDate(ilkPersembe.getDate() - ((ilkPersembe.getDay() + 6) % 7) + 3);
  const hafta = 1 + Math.round((t.getTime() - ilkPersembe.getTime()) / (7 * GUN));
  return `${yil}-W${iki(hafta)}`;
}

/** "2026-W43" → o haftanın pazartesi…pazar gün anahtarları. */
export function haftaGunleri(hafta: string): string[] {
  const [y, w] = hafta.split('-W').map(Number);
  const pzt = new Date(y, 0, 4);
  pzt.setDate(pzt.getDate() - ((pzt.getDay() + 6) % 7) + (w - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => gunAnahtari(new Date(pzt.getFullYear(), pzt.getMonth(), pzt.getDate() + i)));
}

export function ayGunleri(ay: string): string[] {
  const [y, a] = ay.split('-').map(Number);
  const n = new Date(y, a, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${ay}-${iki(i + 1)}`);
}

/** Ayla kesişen ISO haftalar (aylık rapor haftalık raporlardan kurulur). */
export function ayHaftalari(ay: string): string[] {
  return [...new Set(ayGunleri(ay).map((g) => isoHafta(gundenTarih(g))))];
}

export const oncekiHafta = (d: Date): string => isoHafta(new Date(d.getFullYear(), d.getMonth(), d.getDate() - 7));
export const oncekiAy = (d: Date): string => ayAnahtari(new Date(d.getFullYear(), d.getMonth() - 1, 1));

const dakika = (s: string) => { const [h, m] = s.split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/** Çalışma saatinde mi? bas > bit ise gece yarısını aşan aralık (ör. 20:00–02:00). gunler: 0 = Pazar. */
export function calismadaMi(d: Date, c: { bas: string; bit: string; gunler: number[] }): boolean {
  const s = d.getHours() * 60 + d.getMinutes();
  const b = dakika(c.bas), e = dakika(c.bit);
  if (b === e) return c.gunler.includes(d.getDay());
  if (b < e) return c.gunler.includes(d.getDay()) && s >= b && s < e;
  // gece yarısını aşan: akşam kısmı bugünün günü, sabah kısmı dünün günü sayılır
  if (s >= b) return c.gunler.includes(d.getDay());
  if (s < e) return c.gunler.includes((d.getDay() + 6) % 7);
  return false;
}

export type RaporTuruP = 'gunluk' | 'haftalik' | 'aylik';
export interface VadeliRapor { tur: RaporTuruP; donem: string }

/**
 * Şimdi hazırlanması gereken raporlar (en eski önce): bugünün günlüğü rapor saatinden sonra; kaçırılmış dün/evvelsi gün;
 * biten önceki ISO hafta; biten önceki ay. Var olan ya da verisi olmayan dönem atlanır.
 */
export function vadeliRaporlar(simdi: Date, gunlukSaat: string, varMi: (tur: RaporTuruP, donem: string) => boolean, veriVar: (tur: RaporTuruP, donem: string) => boolean): VadeliRapor[] {
  const out: VadeliRapor[] = [];
  const bugun = gunAnahtari(simdi);
  for (const g of [gunEkle(bugun, -2), gunEkle(bugun, -1)]) if (!varMi('gunluk', g) && veriVar('gunluk', g)) out.push({ tur: 'gunluk', donem: g });
  if (simdi.getHours() * 60 + simdi.getMinutes() >= dakika(gunlukSaat) && !varMi('gunluk', bugun) && veriVar('gunluk', bugun)) out.push({ tur: 'gunluk', donem: bugun });
  const h = oncekiHafta(simdi);
  if (!varMi('haftalik', h) && veriVar('haftalik', h)) out.push({ tur: 'haftalik', donem: h });
  const a = oncekiAy(simdi);
  if (!varMi('aylik', a) && veriVar('aylik', a)) out.push({ tur: 'aylik', donem: a });
  return out;
}

/** Gün sonundan itibaren n gün sonra (o günün 23:59:59'u + n gün) silinir. */
export function silinmeTarihi(gun: string, n: number): string {
  const d = gundenTarih(gunEkle(gun, n));
  d.setHours(23, 59, 59, 0);
  return d.toISOString();
}

// ── Mesele eşleştirme: aynı konunun yeni dökümde tekrar geçmesi yeni mesele açmasın ──
const DOLGU = new Set(['bir', 've', 'ile', 'icin', 'bu', 'su', 'o', 'de', 'da', 'mi', 'mu', 'ki', 'gibi', 'olan', 'olarak', 'ama', 'cok', 'daha']);
export function anlamliKelimeler(m: string): Set<string> {
  return new Set(sadelestir(m).split(/\s+/).filter((k) => k.length > 2 && !DOLGU.has(k)).map((k) => k.slice(0, 6)));
}
export function benzerlik(a: string, b: string): number {
  const x = anlamliKelimeler(a), y = anlamliKelimeler(b);
  if (!x.size || !y.size) return 0;
  let ortak = 0;
  for (const k of x) if (y.has(k)) ortak++;
  return ortak / Math.min(x.size, y.size);
}
/** En benzer açık meseleyi bul (≥ 0,6; kişiler ikisinde de yazılıysa aynı olmalı). */
export function meseleEslestir<T extends { id: number; baslik: string; kisi?: string | null }>(baslik: string, kisi: string | undefined, mevcut: T[]): T | null {
  let en: T | null = null, puan = 0;
  for (const m of mevcut) {
    if (kisi && m.kisi && sadelestir(kisi) !== sadelestir(m.kisi)) continue;
    const p = benzerlik(baslik, m.baslik);
    if (p > puan) { puan = p; en = m; }
  }
  return puan >= 0.6 ? en : null;
}
