// ── Yerel sohbet turunun KISA sistem istemi (0.14.1 vakası; saf, birim testli: tests/yerel-istek-sigma.test.ts) ─────────────────────
// 5 Kas: yerel modelle kısa bir selam bile gönderilemiyordu ("bağlam sığmadı"). Kök neden: Gizli / "Yalnız bu bilgisayar" turunda modele
// bulut turunun TAM sistem metni gidiyordu (kişilik + EYLEMLER + GÜN KAYDI + 20 aracın kullanım notları + karakter ≈ 9.000 karakter) — yerelde
// hiç araç yokken (P14). Yerel sunucunun yuvası 4.096 token (shared/yerel-butce.ts); bu metin + bağlam + 1.500 yanıt payı yuvayı aşıyordu.
// Yerel turda istem kısadır: kimlik, yapabildikleri ve yapamadıkları (TEK yerde; 11 Kas: <baglam>'daki ikinci araçsızlık paragrafı kalktı, Gizli'de
// yalnız kısa bir Gizli cümlesi kalır: shared/tek-motor.ts aracsizTurIstemi), dil, hitap, temel güvenlik kuralları ve karakterin üslubu (kısaltılmış).
// Araç adı GEÇMEZ (model olmayan aracı çağırmaya kalkmasın). Hatırlatıcı, yapılacak iş, tarih ve aritmetik modele hiç gelmez: kodla yapılır
// (ajan/yerel-yol.ts, shared/yerel-yonlendirme.ts).
import type { Karakter } from './karakterler.js';

/** Karakter metninin yerel istemdeki tavanı (karakter: sunucudan gelir, uzunluğu bilinmez). 11 Kas: 600 → 300 — yer önce kullanıcının tercihlerine
 *  (çekirdek) ve 600 token'lık hafıza bağlamına; karakter yalnız üsluptur. */
export const YEREL_KARAKTER_TAVANI = 300;
/** Çekirdek hafızanın yerel istemdeki tavanı (karakter). */
export const YEREL_CEKIRDEK_TAVANI = 1200;
/** Sohbet özetinin yerel istemdeki tavanı (karakter; 11 Kas: 800 → 600, aynı nedenle). */
export const YEREL_OZET_TAVANI = 600;
/** Yerel turda ilgili hafıza bağlamının bütçesi (token; depo.ts turBaglami — bulutta 1.800). 11 Kas analizi #4: 300 token "Kahve" gibi
 *  gürültüyle doluyor, 2. günün tercihi 28. gün bağlama girmiyordu; istem kısaldı, bağlam 600'e çıktı (yuvaya sığar: tests/yerel-istek-sigma). */
export const YEREL_HAFIZA_BUTCESI = 600;

const kisalt = (s: string, n: number): string => (s.length <= n ? s : `${s.slice(0, n).trimEnd()}…`);

// ── Türkçe ek uyumu (11 Kas analizi #13: "Fuber'sın", "Selin'nın" — ekler sabit yazılmıştı; küçük model bozuk Türkçeyi taklit ediyor) ──
const UNLU = /[aeıioöuüâîû]/giu;
const sonUnlu = (ad: string): string => (ad.toLocaleLowerCase('tr-TR').match(UNLU) ?? []).at(-1) ?? 'e';
const dar = (u: string): string => ({ a: 'ı', ı: 'ı', â: 'ı', o: 'u', u: 'u', û: 'u', e: 'i', i: 'i', î: 'i', ö: 'ü', ü: 'ü' } as Record<string, string>)[u] ?? 'i';
/** İlgi eki: "Selin" → "Selin’in", "Ada" → "Ada’nın", "Deniz Yılmaz" → "Deniz Yılmaz’ın". */
export function ilgiEki(ad: string): string {
  const t = ad.trim();
  if (!t) return t;
  const u = dar(sonUnlu(t));
  return /[aeıioöuüâîû]$/iu.test(t) ? `${t}’n${u}n` : `${t}’${u}n`;
}
/** Bildirme eki (sen): "Fuber" → "Fuber’sin", "Ada" → "Ada’sın". */
export const kopulaEki = (ad: string): string => `${ad.trim()}’s${dar(sonUnlu(ad))}n`;

export interface YerelIstemGirdisi { asistanAdi: string; kullaniciAdi: string; hitap: string; karakter: Karakter }

/** Yerel turun sabit sistem metni (Gizli ve "Yalnız bu bilgisayar"; araçsız). 11 Kas analizi §6.4 (aynı modelle 14 → 20/40): yapabildikleri ÖNCE;
 *  araçsızlık bir kez ve yalnız istenince söylenir (eskiden "aracın yok" iki kez veriliyordu: model taslak ve yeniden yazmayı da reddediyordu). */
export function yerelSistemIstemi(g: YerelIstemGirdisi): string {
  const ad = g.asistanAdi || 'Fuber';
  const kullanici = g.kullaniciAdi || 'kullanıcı';
  const kim = g.kullaniciAdi ? ilgiEki(kullanici) : 'kullanıcının';
  const kar = g.karakter.sade
    ? `# KİMLİK\n${kisalt(g.karakter.sistemIstemi, YEREL_KARAKTER_TAVANI)}`
    : `# KARAKTER: ${g.karakter.ad}\n${kisalt(g.karakter.sistemIstemi, YEREL_KARAKTER_TAVANI)}\nAdın Fuber; kendini bir hayvan ya da başka bir karakter olarak tanıtma. Karakter yalnız üslubu belirler; aşağıdaki kurallar değişmez.`;
  return `Sen ${kopulaEki(ad)}: ${kim} kişisel yapay zekâ asistanısın; bu bilgisayarda, internetsiz çalışıyorsun.
Yapabildiklerin: soru yanıtlamak; e-posta ve metin taslağı, özet, çeviri, yeniden yazma, sınıflandırma, liste ve plan; <baglam>'daki hafıza kayıtlarını kullanmak.
Yapamadıkların: göndermek (e-posta, WhatsApp), internete ya da ekrana bakmak. Biri istenirse metni yine hazırla, sonda tek cümleyle göndermeyi ${kim} yapacağını söyle; istenmedikçe bundan söz etme.
- Türkçe yaz (İngilizce yazılırsa İngilizce). ${g.hitap ? `Ona "${g.hitap}" diye hitap et.` : 'Adını öğrenince adıyla hitap et.'} Kısa ve net: önce cevap.
- Çekirdek hafızadaki tercihlere (hitap, biçim, saatler) her yanıtta uy.
- Hesap ya da tarih sorusunda adımları kısaca yaz, sonra "Sonuç:" satırını ver (taslak ve çeviride değil).
- Kayıtlar çelişirse en yeni tarihli olanı esas al; kayda dayanıyorsan [H-12] gibi atıf ver.
- Bilmediğini uydurma, emin değilsen söyle. Şifre, kart, anahtar gibi sırları yazma.

${kar}`;
}

/** Yerel turun yarı sabit bölümü: çekirdek hafıza ve sohbet özeti, ikisi de kısaltılmış. */
export function yerelSistemYari(cekirdek: string, ozet: string): string {
  const c = cekirdek.trim() ? kisalt(cekirdek.trim(), YEREL_CEKIRDEK_TAVANI) : '(henüz yok)';
  return `# ÇEKİRDEK HAFIZA\n${c}${ozet.trim() ? `\n\n# BU SOHBETİN ÖNCEKİ BÖLÜMÜNÜN ÖZETİ\n${kisalt(ozet.trim(), YEREL_OZET_TAVANI)}` : ''}`;
}
