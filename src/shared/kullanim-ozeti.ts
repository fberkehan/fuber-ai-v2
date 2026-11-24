// ── Kullanım özeti (`kullanim:ozet`; saf, birim testli: tests/kullanim-ozeti.test.ts) ──────────────────────────────────────────────────
// Denetim K5 (Ruling O): Claude dışı modellerde maliyet hep 0 görünüyordu (fiyat tablosu yalnız Claude'du). Artık maliyet, kayıtlı token
// sayılarından model bilgisinin fiyatıyla (shared/model-bilgisi.ts modelFiyati: yerleşik tablo + OpenRouter canlı listesi) OKUMA anında
// hesaplanır — eski kayıtlar da düzelir. Fiyatı bilinmeyen çağrının maliyeti `null`dır ("—"), 0 YAZILMAZ ve toplama katılmaz; kaç çağrının
// fiyatı bilinmediği `bilinmeyen`de. Fiyat bugün bilinmiyor ama çağrı anında biliniyorduysa (canlı liste o an önbellekteydi) kayıttaki
// maliyet kullanılır (yalnız bütün çağrıları fiyatlı ve sıfırdan büyükse: eski sürüm bilinmeyene 0 yazardı).
// Ana süreç (main/motor/kullanim.ts) satırları SQL ile gruplar (sağlayıcı, model, amaç) ve fiyat bulucuyu verir; arayüz yalnız gösterir.
import { cagriMaliyeti, modelFiyati, type Fiyat } from './model-bilgisi.ts';

/** (sağlayıcı, model, amaç) grubunun toplamları. `kayitliMaliyet`: kayıttaki maliyetlerin toplamı, `kayitliSayi`: maliyeti dolu kayıt sayısı. */
export interface KullanimSatiri {
  saglayici: string; model: string; amac: string; istek: number;
  giris: number; cikis: number; onbellekOkuma: number; onbellekYazma: number;
  kayitliMaliyet: number | null; kayitliSayi: number;
}
export interface KullanimOzeti {
  /** Fiyatı bilinen çağrıların yaklaşık toplamı ($). */
  toplam: number;
  /** Bütün motor çağrıları (işlem). */
  istek: number; giris: number; cikis: number;
  /** Kullanıcının gördüğü tamamlanmış yanıtlar (sohbet, ada, tarayıcının "Fuber'e sor"u; her kullanıcı turu bir; başarısız ya da
   *  metinsiz durdurulan tur sayılmaz) — İş modunun "bu ay N yanıt"ı (Ruling O, düzeltme turu). */
  yanit: number;
  /** Yanıt dışındaki motor işleri: hafıza, notlar, raporlar, kokpit planı, başlık, özet, e-posta önemi, kendiliğinden mesajlar. */
  arkaPlan: number;
  /** Fiyatı bilinmeyen çağrı sayısı (maliyeti toplama katılmadı). */
  bilinmeyen: number;
  /** Amaç başına; maliyet null = o amacın hiçbir çağrısının fiyatı bilinmiyor. */
  amaclar: { amac: string; maliyet: number | null; istek: number; bilinmeyen: number }[];
  modeller: { saglayici: string; model: string; giris: number; cikis: number; maliyet: number | null; istek: number }[];
}

export type FiyatBulucu = (saglayici: string, model: string) => Fiyat | undefined;
/** Varsayılan bulucu: yalnız yerleşik bilgi (canlı liste yok). */
export const yerlesikFiyat: FiyatBulucu = (s, m) => modelFiyati(s, m);

const sayi = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : Number(n) || 0);

/** Bir grubun maliyeti: fiyat biliniyorsa tokenlerden; değilse (bütün çağrıları fiyatlı ve > 0 ise) kayıttaki; yoksa null. */
export function grupMaliyeti(r: KullanimSatiri, fiyat: Fiyat | undefined): number | null {
  if (fiyat) return cagriMaliyeti(r.saglayici, fiyat, { giris: sayi(r.giris), cikis: sayi(r.cikis), onbellekOkuma: sayi(r.onbellekOkuma), onbellekYazma: sayi(r.onbellekYazma) });
  const kayitli = r.kayitliMaliyet === null ? null : sayi(r.kayitliMaliyet);
  return kayitli !== null && kayitli > 0 && sayi(r.kayitliSayi) >= sayi(r.istek) ? kayitli : null;
}

const topla = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : a + b);

/** Bir motor çağrısı arka plan işi mi: kullanıcının turunu yanıtlayan çağrılar (ana sohbet `sohbet`, yerel hızlı yanıt ve seslenme
 *  `hizli…`/`hitap…`) dışındaki her şey. */
export const arkaPlanMi = (amac: string): boolean => !(amac === 'sohbet' || amac.startsWith('hizli') || amac.startsWith('hitap'));

/** Mesaj kaydının sayım için gereken izi (sohbet, sıra, rol, kaynak, metni var mı). */
export interface MesajIzi { sohbetId: number; id: number; rol: string; kaynak?: string | null; metinli: boolean | number }

/** yanitSay'in girdisi (ana süreç main/motor/kullanim.ts; birim testi tests/kullanim-ozeti.test.ts aynı sorguyu bellekte çalıştırır).
 *  Yalnız pencere (`?` = pencerenin başı, ISO; olusturma dizini, vt.ts göç 4) ve yalnız sayıma girenler: kullanıcı turları (araç
 *  sonuçları hariç), metinli Fuber mesajları ve notlar (bekleyen turu kapatır). `metin` kayıtta zaten kırpılmış (sohbet.ts mesajEkle).
 *  ORDER BY yok: sıralamayı yanitSay yapar (sohbet + kimlik); ORDER BY sohbet_id, id planlayıcıyı sıralamasız bütün tablo taramasına
 *  (mesajlar_sohbet dizini) götürüyordu. */
export const MESAJ_IZI_SQL = `
  SELECT sohbet_id sohbetId, id, rol, kaynak, metin <> '' metinli
  FROM mesajlar
  WHERE olusturma >= ? AND rol IN ('user', 'assistant', 'not')
    AND (rol <> 'assistant' OR metin <> '') AND (rol <> 'user' OR COALESCE(kaynak, '') <> 'arac')`;

/** Bir kullanıcı turunu yanıtlayabilen Fuber mesajlarının kaynağı: ajan döngüsü (kaynaksız), yerel gündelik yanıt ('yerel'),
 *  seslenmeye hızlı yanıt ('hizli') ve durdurulan yanıttan kalan yarım metin ('durduruldu', K14: kullanıcı onu gördü). Ötekiler
 *  (proaktif, eşlikçi, hatırlatıcı, rapor ve bilinmeyen kaynaklar) kendiliğindendir: bekleyen turu yanıtlamaz. */
const YANIT_KAYNAKLARI: ReadonlySet<string> = new Set(['', 'yerel', 'hizli', 'durduruldu']);
/** Kullanıcı turu sayılmayan 'user' kayıtları: araç sonuçları ve kendiliğinden işlerin kaynakları. */
const TUR_DISI: ReadonlySet<string> = new Set(['arac', 'proaktif', 'eslikci']);

/**
 * Kullanıcının gördüğü tamamlanmış yanıtlar: her kullanıcı turu (rol 'user'; araç sonucu değil) ardından — bir sonraki kullanıcı turundan
 * ya da bir nottan önce — yanıt kaynaklı (YANIT_KAYNAKLARI), metni olan bir Fuber mesajı geldiyse BİR yanıt (araçlı turda kaç ara mesaj
 * olursa olsun). Not (rol 'not': hata notu, "Durduruldu." notu, kendiliğinden işin görünmez tetiği) bekleyen turu kapatır: hata ya da
 * metinsiz durdurulan tur sayılmaz, sonradan gelen kendiliğinden mesaj (proaktif, eşlikçi, hatırlatıcı, rapor) onu "yanıtlamaz".
 * Yarım metinle durdurulan tur (metin notundan önce) bir yanıttır.
 */
export function yanitSay(izler: readonly MesajIzi[]): number {
  const l = [...izler].sort((a, b) => a.sohbetId - b.sohbetId || a.id - b.id);
  let n = 0;
  let bekleyen = false; // yanıt bekleyen kullanıcı turu
  let sohbet = Number.NaN;
  for (const m of l) {
    if (m.sohbetId !== sohbet) { sohbet = m.sohbetId; bekleyen = false; }
    const kaynak = m.kaynak ?? '';
    if (m.rol === 'not') { bekleyen = false; continue; }
    if (m.rol === 'user') { if (!TUR_DISI.has(kaynak)) bekleyen = true; continue; }
    if (m.rol !== 'assistant' || !m.metinli || !YANIT_KAYNAKLARI.has(kaynak)) continue;
    if (bekleyen) { n++; bekleyen = false; }
  }
  return n;
}

export function kullanimDerle(satirlar: readonly KullanimSatiri[], fiyatBul: FiyatBulucu = yerlesikFiyat, izler: readonly MesajIzi[] = []): KullanimOzeti {
  const amac = new Map<string, KullanimOzeti['amaclar'][number]>();
  const model = new Map<string, KullanimOzeti['modeller'][number]>();
  const o: KullanimOzeti = { toplam: 0, istek: 0, giris: 0, cikis: 0, yanit: yanitSay(izler), arkaPlan: 0, bilinmeyen: 0, amaclar: [], modeller: [] };
  for (const r of satirlar) {
    const istek = sayi(r.istek);
    const m = grupMaliyeti(r, fiyatBul(r.saglayici, r.model));
    const bilinmeyen = m === null ? istek : 0;
    o.istek += istek; o.giris += sayi(r.giris); o.cikis += sayi(r.cikis); o.bilinmeyen += bilinmeyen;
    if (arkaPlanMi(r.amac)) o.arkaPlan += istek;
    if (m !== null) o.toplam += m;
    const a = amac.get(r.amac) ?? { amac: r.amac, maliyet: null, istek: 0, bilinmeyen: 0 };
    a.maliyet = topla(a.maliyet, m); a.istek += istek; a.bilinmeyen += bilinmeyen;
    amac.set(r.amac, a);
    const anahtar = `${r.saglayici}\n${r.model}`;
    const md = model.get(anahtar) ?? { saglayici: r.saglayici, model: r.model, giris: 0, cikis: 0, maliyet: null, istek: 0 };
    md.giris += sayi(r.giris); md.cikis += sayi(r.cikis); md.maliyet = topla(md.maliyet, m); md.istek += istek;
    model.set(anahtar, md);
  }
  // Sıra: maliyeti büyükten (bilinmeyen sonda), eşitte çağrı sayısı.
  const sira = <T extends { maliyet: number | null; istek: number }>(x: T, y: T) => (y.maliyet ?? -1) - (x.maliyet ?? -1) || y.istek - x.istek;
  o.amaclar = [...amac.values()].sort(sira);
  o.modeller = [...model.values()].sort(sira);
  return o;
}
