// ── Kendiliğinden mesajların tekrar bekçisi (11 Kas analizi #6; saf, birim testli: tests/proaktif-tekrar.test.ts) ─────────────────────────
// Analiz (bulut, yedek model): aynı merak sorusu 20 gün, aynı bayat sabah özeti 25 gün tekrarlandı. Koruma modelin hafızaya "Merak sorusu"
// kaydı yazmasına bağlıydı (yazılmayınca hiç çalışmıyordu) ve hafiza_ara yalnız son 10 kayda bakıyordu. Artık koruma KODDA:
//  · gönderilen her kendiliğinden mesaj `meta`daki dönen listeye (son 60) yazılır; hafızaya yazılmaz;
//  · yeni mesaj, listedeki HER mesajla (yalnız son 10 değil) köklü sözcük benzerliğiyle karşılaştırılır (≥ 0,6 → tekrar): gösterilmez, bir kez
//    "şunları tekrar etme" listesiyle yeniden denenir; yine tekrarsa o gün gönderilmez;
//  · bekleme: iki kendiliğinden mesaj arası en az 90 dk; son 3 merak sorusu yanıtsızsa merak 2 gün susar; kullanıcı son 30 dk'da yazdıysa
//    merak sorulmaz.
import { benzerlik } from './hafiza-kurali.ts';

export interface ProaktifIz { is: string; metin: string; zaman: string }

export const PROAKTIF_GECMIS_BOYU = 60;
export const TEKRAR_ESIGI = 0.6;
export const PROAKTIF_ARALIK_MS = 90 * 60_000;
export const MERAK_SUSMA_MS = 2 * 86_400_000;
export const YAZIYORKEN_SUSMA_MS = 30 * 60_000;

/** Mesajın gövdesi: baştaki selam satırı ("Günaydın Selin!", "Günün özeti:") ve kısa bölüm başlıkları ("Bugün:", "Açık yapılacaklar:") düşer —
 *  aynı kalıp iki farklı özeti "benzer" göstermesin. */
export function govde(metin: string): string {
  const satirlar = metin.split('\n').map((s) => s.trim()).filter(Boolean);
  if (satirlar.length > 1 && /^(günaydın|gunaydin|iyi akşamlar|günün özeti|merhaba)\b/iu.test(satirlar[0]) && satirlar[0].length < 60) satirlar.shift();
  return satirlar.filter((s) => !(s.length < 30 && /:$/.test(s))).join('\n');
}

/** Metin, geçmişteki herhangi bir kendiliğinden mesajın tekrarı mı (bütün liste; tür fark etmez — sabah özeti merak kılığına da girmesin). */
export function tekrarMi(metin: string, gecmis: readonly ProaktifIz[]): boolean {
  const m = govde(metin.trim());
  if (!m) return false;
  return gecmis.some((g) => benzerlik(m, govde(g.metin)) >= TEKRAR_ESIGI);
}

/** Şablonla (modelsiz) yazılan özetin bir öncekiyle AYNI olup olmadığı: veri değişmediyse ertesi gün aynı liste yeniden gönderilmez. */
export function oncekiyleAyniMi(metin: string, gecmis: readonly ProaktifIz[], is: string): boolean {
  const onceki = gecmis.filter((g) => g.is === is).at(-1);
  const n = (s: string) => govde(s).replace(/\s+/g, ' ').trim().toLocaleLowerCase('tr-TR');
  return Boolean(onceki) && n(onceki!.metin) === n(metin);
}

/** Listeye ekler; en eskiler düşer. */
export function gecmiseEkle(gecmis: readonly ProaktifIz[], iz: ProaktifIz): ProaktifIz[] {
  return [...gecmis, { ...iz, metin: iz.metin.slice(0, 600) }].slice(-PROAKTIF_GECMIS_BOYU);
}

/** Bozuk/eski meta değerine dayanıklı okuma. */
export function gecmisiOku(ham: string | undefined | null): ProaktifIz[] {
  if (!ham) return [];
  try {
    const v = JSON.parse(ham);
    return Array.isArray(v) ? v.filter((x) => x && typeof x.metin === 'string' && typeof x.is === 'string').slice(-PROAKTIF_GECMIS_BOYU) : [];
  } catch { return []; }
}

/** Modele giden talimata eklenen "daha önce yazdıkların" bölümü (aynı türün son `n` mesajı; yoksa boş). */
export function oncekilerMetni(gecmis: readonly ProaktifIz[], is: string, n = 12): string {
  const l = gecmis.filter((g) => g.is === is).slice(-n);
  if (!l.length) return '';
  const ad = is === 'merak' ? 'Daha önce sorduğun sorular (bunları ya da benzerlerini SORMA)' : 'Daha önceki mesajların (aynısını ya da benzerini YAZMA)';
  return `\n${ad}:\n${l.map((g) => `- ${g.metin.replace(/\s+/g, ' ').slice(0, 200)}`).join('\n')}`;
}

/** İlk deneme tekrar çıkınca ikinci denemenin ek talimatı. */
export const TEKRAR_UYARISI = '\nÖnceki denemen eski bir mesajını tekrarladı. Tamamen farklı, bugüne özgü bir mesaj yaz; yeni bir şey yoksa yalnız "Günaydın" deyip kısa kes.';

/**
 * Bu kendiliğinden iş şimdi beklemeli mi (gönderilmez, deneme sayılmaz; sonraki tikte yeniden sorulur)?
 * `yanitsiz`: son merak sorularının her biri için kullanıcı ardından yazdı mı (en yeni sonda). `sonKullanici`: kullanıcının son mesajının zamanı.
 */
export function beklemeli(is: string, gecmis: readonly ProaktifIz[], simdi: number, o: { yanitlandi: boolean[]; sonKullanici?: number }): boolean {
  const son = gecmis.at(-1);
  if (son && simdi - Date.parse(son.zaman) < PROAKTIF_ARALIK_MS) return true;
  if (is !== 'merak') return false;
  if (o.sonKullanici !== undefined && simdi - o.sonKullanici < YAZIYORKEN_SUSMA_MS) return true;
  const merak = gecmis.filter((g) => g.is === 'merak');
  const son3 = o.yanitlandi.slice(-3);
  if (son3.length === 3 && son3.every((y) => !y)) {
    const sonMerak = merak.at(-1);
    if (sonMerak && simdi - Date.parse(sonMerak.zaman) < MERAK_SUSMA_MS) return true;
  }
  return false;
}
