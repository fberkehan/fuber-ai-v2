// ── Kural tabanlı Türkçe zaman çözücü (11 Kas analizi #9; saf, birim testli: tests/tr-zaman.test.ts) ──────────────────────────────────────
// "Yalnız bu bilgisayar"da hatırlatıcı modelsiz kurulur: 9B model tarih hesabında 2/10 aldı ("45 gün sonra 25 Ocak"), 30 günde 6 hatırlatma
// isteğinin hiçbiri kurulmadı. Bu modül yaygın ifadeleri kesin zamana çevirir: "yarın 14:00", "cuma 16:00", "24 Ekim 15:00", "perşembe
// 16:00’da", "haftaya salı 3’te", "her pazartesi 10:30", "2 saat sonra", "45 gün sonra"; "bir gün önce de hatırlat" olayın bir gün öncesine.
// Anlamadığı ifadede null döner (uydurmaz). Saat verilmezse 09:00; tek haneli 1–7 saat iş saati sayılır (3’te → 15:00).

const HARITA: Record<string, string> = { ı: 'i', ş: 's', ğ: 'g', ü: 'u', ö: 'o', ç: 'c', â: 'a', î: 'i', û: 'u' };
const sade = (s: string): string => s.toLocaleLowerCase('tr-TR').replace(/[ışğüöçâîû]/g, (h) => HARITA[h] ?? h).normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[’'`´]/g, ' ').replace(/\s+/g, ' ');

export const AYLAR = ['ocak', 'subat', 'mart', 'nisan', 'mayis', 'haziran', 'temmuz', 'agustos', 'eylul', 'ekim', 'kasim', 'aralik'];
const GUNLER = ['pazar', 'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi'];
const SAYI: Record<string, number> = { bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10, yarim: 0.5, onbes: 15, yirmi: 20, otuz: 30, kirk: 40, elli: 50 };
const sayi = (s: string): number => (/^\d+$/.test(s) ? Number(s) : SAYI[s] ?? NaN);
const SAYI_RE = '(\\d{1,3}|bir|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on|yarim|onbes|yirmi|otuz|kirk|elli)';
// Gün adı: "cumartesi" "cuma"dan, "pazartesi" "pazar"dan önce denenir.
const GUN_RE = '(pazartesi|cumartesi|pazar|sali|carsamba|persembe|cuma)';

export type Tekrar = 'yok' | 'gunluk' | 'hafta_ici' | 'haftalik' | 'aylik';
export interface ZamanCozumu {
  zaman: Date;
  /** Saat açıkça verildi mi (yoksa 09:00 varsayıldı). */
  saatVar: boolean;
  tekrar: Tekrar;
  /** "bir gün önce" gibi: hatırlatma olayın bu kadar gün öncesine kurulur (`zaman` hatırlatma anıdır; `olay` asıl zaman). */
  olay?: Date;
  /** Metinde zamanı anlatan parçalar (başlıktan çıkarılır). */
  parcalar: string[];
}

const gunBasi = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const gunEkle = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

/** Metindeki zaman ifadesini çözer; zaman bulunamazsa null. `simdi` yerel saatle yorumlanır. */
export function zamanCoz(metin: string, simdi: Date = new Date()): ZamanCozumu | null {
  const s = ` ${sade(metin)} `;
  const parcalar: string[] = [];
  let m: RegExpMatchArray | null;
  const bul = (re: RegExp) => { const r = s.match(re); if (r) parcalar.push(r[0].trim()); return r; };

  // 1) Göreli dakika/saat: "2 saat sonra", "yarım saat sonra", "20 dakika sonra" — doğrudan ana göre.
  if ((m = bul(new RegExp(`\\b${SAYI_RE} (dakika|dk|saat) (sonra|icinde)\\b`)))) {
    const n = sayi(m[1]);
    if (!Number.isNaN(n)) return { zaman: new Date(simdi.getTime() + n * (m[2] === 'saat' ? 3600_000 : 60_000)), saatVar: true, tekrar: 'yok', parcalar };
  }

  // 2) Tekrar
  let tekrar: Tekrar = 'yok';
  let haftaGunu: number | null = null;
  if (bul(/\b(her hafta ici|hafta ici her gun)\b/)) tekrar = 'hafta_ici';
  else if (bul(/\bher gun\b/)) tekrar = 'gunluk';
  else if (bul(/\bher ay\b/)) tekrar = 'aylik';
  else if ((m = bul(new RegExp(`\\bher ${GUN_RE}\\b`)))) { tekrar = 'haftalik'; haftaGunu = GUNLER.indexOf(m[1]); }

  // 3) Gün
  const bugun = gunBasi(simdi);
  let gun: Date | null = null;
  let haftaGunuSecildi = false;
  if (bul(/\bbugun\b/)) gun = bugun;
  else if (bul(/\b(obur gun|ertesi gun|yarindan sonra)\b/)) gun = gunEkle(bugun, 2);
  else if (bul(/\byarin\b/)) gun = gunEkle(bugun, 1);
  else if ((m = bul(new RegExp(`\\b${SAYI_RE} (gun|hafta|ay) sonra\\b`)))) {
    const n = sayi(m[1]);
    if (!Number.isNaN(n)) gun = m[2] === 'gun' ? gunEkle(bugun, n) : m[2] === 'hafta' ? gunEkle(bugun, n * 7) : new Date(bugun.getFullYear(), bugun.getMonth() + n, bugun.getDate());
  } else if ((m = bul(/\b(\d{1,2}) (ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik)(?: (\d{4}))?\b/))) {
    const yilVar = Boolean(m[3]);
    let yil = yilVar ? Number(m[3]) : bugun.getFullYear();
    let d = new Date(yil, AYLAR.indexOf(m[2]), Number(m[1]));
    if (!yilVar && d < bugun) { yil += 1; d = new Date(yil, AYLAR.indexOf(m[2]), Number(m[1])); }
    if (d.getDate() === Number(m[1])) gun = d;
    bul(new RegExp(`\\b${GUN_RE}\\b`)); // "24 Ekim cumartesi": gün adı başlıktan da çıksın
  } else if (haftaGunu === null && (m = bul(new RegExp(`\\b(haftaya |gelecek hafta |onumuzdeki hafta |bu )?${GUN_RE}\\b`)))) {
    const hedef = GUNLER.indexOf(m[2]);
    const haftaya = Boolean(m[1]) && m[1].trim() !== 'bu';
    let fark = (hedef - bugun.getDay() + 7) % 7;
    if (haftaya) {
      // "haftaya salı": gelecek takvim haftasının (pazartesi başlangıçlı) salısı.
      const pzt = gunEkle(bugun, -((bugun.getDay() + 6) % 7) + 7);
      gun = gunEkle(pzt, (hedef + 6) % 7);
    } else {
      gun = gunEkle(bugun, fark);
      haftaGunuSecildi = fark === 0;
    }
    fark = 0;
  } else if (bul(/\b(haftaya|gelecek hafta)\b/)) gun = gunEkle(bugun, 7);
  if (haftaGunu !== null) {
    gun = gunEkle(bugun, (haftaGunu - bugun.getDay() + 7) % 7);
    haftaGunuSecildi = true;
  }

  // 4) Saat
  let saat: number | null = null;
  let dk = 0;
  if ((m = bul(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/))) { saat = Number(m[1]); dk = Number(m[2]); }
  else if ((m = bul(/\bsaat (\d{1,2})( bucuk)?\b/))) { saat = Number(m[1]); dk = m[2] ? 30 : 0; }
  else if ((m = bul(/\b(\d{1,2}) ?(te|ta|de|da|e|a|ye|ya)\b(?! (ocak|subat|mart|nisan|mayis|haziran|temmuz|agustos|eylul|ekim|kasim|aralik|gun|hafta|ay|dakika|saat))/))) { saat = Number(m[1]); }
  if (saat !== null && saat > 23) saat = null;
  const bolum = bul(/\b(sabah|ogleden sonra|ogle|oglen|aksam|gece)\b/)?.[1];
  const saatVar = saat !== null;
  if (saat === null) saat = bolum === 'ogleden sonra' ? 14 : bolum === 'ogle' || bolum === 'oglen' ? 12 : bolum === 'aksam' ? 19 : bolum === 'gece' ? 22 : 9;
  else if ((bolum === 'aksam' || bolum === 'ogleden sonra') && saat < 12) saat += 12;
  else if (bolum === 'gece' && saat >= 8 && saat < 12) saat += 12;
  else if (!bolum && saat >= 1 && saat <= 7 && !/^0/.test(String(m?.[1] ?? ''))) saat += 12; // "3’te" iş saati: 15:00

  if (!gun && !saatVar && !bolum && tekrar === 'yok') return null;
  let zaman = new Date(gun ?? bugun);
  zaman.setHours(saat, dk, 0, 0);
  if (!gun && zaman <= simdi) zaman = gunEkle(zaman, 1); // yalnız saat: geçtiyse yarın
  if (haftaGunuSecildi && zaman <= simdi) zaman = gunEkle(zaman, 7); // bugünün gün adı ve saat geçti: gelecek hafta
  if (tekrar !== 'yok' && zaman <= simdi) zaman = gunEkle(zaman, tekrar === 'haftalik' ? 7 : 1);

  // 5) "bir gün önce (de) hatırlat": hatırlatma olaydan önce.
  if ((m = bul(new RegExp(`\\b${SAYI_RE} (gun|saat) once\\b`)))) {
    const n = sayi(m[1]);
    if (!Number.isNaN(n) && n > 0) {
      const olay = zaman;
      return { zaman: new Date(olay.getTime() - n * (m[2] === 'gun' ? 86_400_000 : 3600_000)), saatVar, tekrar, olay, parcalar };
    }
  }
  return { zaman, saatVar, tekrar, parcalar };
}

/** Kullanıcıya gösterilen zaman: "6 Ekim Salı 14:00". */
export function zamanMetni(d: Date): string {
  const gun = d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' });
  const [g, ay, hafta] = gun.replace(',', '').split(' ');
  const tarih = /^\d/.test(g) ? `${g} ${ay} ${hafta ?? ''}`.trim() : gun;
  return `${tarih} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Yalnız tarih: "26 Aralık 2026 Cumartesi". */
export function tarihMetni(d: Date): string {
  const ay = d.toLocaleDateString('tr-TR', { month: 'long' });
  const hafta = d.toLocaleDateString('tr-TR', { weekday: 'long' });
  return `${d.getDate()} ${ay} ${d.getFullYear()} ${hafta}`;
}
