// ── Kokpitin sohbet paneli: hangi sohbet açılır, açılır listede kimler var (0.11 G7) ──────────────────────────────────────────────────
// Yeni sohbete ve önceki sohbetlere ana sayfadan erişilebilmeli (ana sayfada tek sohbet kalıyordu). Panel eskiden yalnız
// "ana" sohbeti gösteriyordu; artık başlığındaki seçiciden (renderer/pano/SohbetSecici.tsx) yeni sohbet açılır ya da son sohbetlere geçilir.
// Bu dosya saf seçim mantığıdır (tests/kokpit-sohbet.test.ts); ekran ve ayar okuma/yazma renderer/pano/useKokpitSohbet.ts'te.
//  · Son seçim `localStorage`da değil ayarda durur (`kokpit.sonSohbet`; shared/tipler.ts Ayarlar.kokpit) ve telefondan yazılamaz
//    (shared/kopru-protokol.ts uzakAyarSuz izin listesinde yok).
//  · Sohbet listesi `sohbet:liste`den gelir: arşivdeki sohbetler zaten yoktur; önizlemeler iç talimat taşımaz (G1/F2).
//  · 0.11 G10: GÖREV sohbetleri (`tur: 'gorev'`, "Görev · <başlık>"; her adımı ayrı mesajdır) kokpit seçicisinde ve "son 8"de GÖRÜNMEZ, okunmamışları
//    kenar çubuğu/telefon toplamına ve "Ana sohbette N yeni mesaj" çipine SAYILMAZ — onlar Sohbetler sayfasında ayırt edilerek durur ve görev
//    durumu Görevler kartında görünür; kullanıcıya giden haber yalnız ana sohbete yazılan satırlardır (main/isler/zamanlayici.ts duyur).
import type { SohbetOzet } from './tipler.ts';

/** Bir Görev'in kendi sohbeti mi (sohbetler.tur 'gorev'; main/isler açar). */
export const gorevSohbetiMi = (s: Pick<SohbetOzet, 'tur'>): boolean => s.tur === 'gorev';

/** Kokpit paneline girebilen sohbetler: görev sohbetleri hariç (seçici, "son sohbetler" ve açılış kararı bu listeyle çalışır). */
export const kokpitSohbetleri = (liste: readonly SohbetOzet[]): SohbetOzet[] => liste.filter((s) => !gorevSohbetiMi(s));

/**
 * Okunmamış mesaj toplamı (kenar çubuğu rozeti, telefon rozeti, Sohbetler'deki liste düğmesi): GÖREV sohbetlerinin adım mesajları sayılmaz.
 * `anaHaric`: ana sohbet de sayılmaz (kenar çubuğunda ana sohbet kokpitin kendisidir).
 */
export function okunmamisToplami(liste: readonly SohbetOzet[], o: { anaHaric?: boolean } = {}): number {
  return liste.reduce((n, s) => (gorevSohbetiMi(s) || (o.anaHaric && s.tur === 'ana') ? n : n + (s.okunmamis ?? 0)), 0);
}

/** Panelin seçimi: kayıtlı sohbetin kimliği, 'yeni' (taslak: kayıt ilk mesajda açılır) ya da null (açılışta henüz belirlenmedi). */
export type KokpitSecimi = number | 'yeni' | null;

/** Açılır listede "Ana sohbet"in altında gösterilen son sohbet sayısı. */
export const KOKPIT_SON_SOHBET_SAYISI = 8;

/**
 * Kokpit açılırken hangi sohbet gösterilir: ana sohbette okunmamış mesaj varsa ana (Fuber kendiliğinden yazmıştır, kaçmasın); yoksa
 * son seçilen sohbet hâlâ listedeyse (silinmemiş, arşivlenmemiş) o; değilse ana. Bozuk kayıt (sayı olmayan) "seçim yok" demektir.
 */
export function kokpitSohbeti(o: { anaId: number; sonSecilen: number | null; anaOkunmamis: number; liste: readonly SohbetOzet[] }): number {
  if (o.anaOkunmamis > 0) return o.anaId;
  const s = o.sonSecilen;
  if (typeof s === 'number' && Number.isInteger(s) && kokpitSohbetleri(o.liste).some((x) => x.id === s)) return s;
  return o.anaId;
}

/** Açılır liste: "Ana sohbet" her zaman ayrı ve ilk; ardından en yeniden eskiye en çok `azami` sohbet (ana tekrarlanmaz). */
export function acilirListe(liste: readonly SohbetOzet[], anaId: number, azami = KOKPIT_SON_SOHBET_SAYISI): { ana: SohbetOzet | null; son: SohbetOzet[] } {
  const ana = liste.find((s) => s.id === anaId) ?? null;
  const son = kokpitSohbetleri(liste).filter((s) => s.id !== anaId).sort((a, b) => b.guncelleme.localeCompare(a.guncelleme)).slice(0, Math.max(0, azami));
  return { ana, son };
}

/**
 * Panelde açık sohbet okunuyor sayılır (düzeltme turu 1, Ö1): Sohbet bileşeni mesajları yükleyince `sohbet:okundu` çağırır ama ana süreç bunun
 * için olay yayınlamaz; renderer'daki liste bayat kalıp "Ana sohbette N yeni mesaj" çipini az önce okunmuş mesaj için geri getirirdi. Liste her
 * yazıldığında (ve bir sohbet seçilince, iyimser olarak) açık sohbetin okunmamışı 0'lanır. Girdi değişmez; değişen yoksa aynı dizi döner.
 */
export function acikOkunmusSay(liste: readonly SohbetOzet[], acikId: number | null): SohbetOzet[] {
  if (acikId === null || !liste.some((s) => s.id === acikId && (s.okunmamis ?? 0) !== 0)) return liste as SohbetOzet[];
  return liste.map((s) => (s.id === acikId ? { ...s, okunmamis: 0 } : s));
}

/** Çipteki sayı: ana sohbette okunmamış mesaj var VE panel ana sohbette değil (başka sohbet ya da taslak). Panel açılış kararını beklerken 0. */
export function anaYeniSayisi(o: { secim: KokpitSecimi; anaId: number | null; liste: readonly SohbetOzet[] }): number {
  if (o.secim === null || o.anaId === null || o.secim === o.anaId) return 0;
  return o.liste.find((s) => s.id === o.anaId)?.okunmamis ?? 0;
}

/**
 * Liste BAŞARIYLA alındı ve seçili sohbet orada yok (başka pencerede/telefonda arşivlendi ya da silindi): panel ana sohbete düşer. Ana, taslak
 * ve belirlenmemiş seçim olduğu gibi kalır. Liste alınamadıysa bu işlev çağrılmaz (hata "sohbet silindi" demek değildir).
 */
export function gecerliSecim(secim: KokpitSecimi, o: { anaId: number; liste: readonly SohbetOzet[] }): KokpitSecimi {
  if (typeof secim !== 'number' || secim === o.anaId) return secim;
  return kokpitSohbetleri(o.liste).some((s) => s.id === secim) ? secim : o.anaId;
}

/** Sıra dışı yanıt koruması (düzeltme turu 1, K10): her istek `al()` ile numara alır; yanıt gelince `uygula(no)` — kendinden YENİ bir istek zaten
 *  uygulandıysa false (yanıt atılır), değilse true ve bu numara "uygulanan" olur. */
export function siraliIstekler(): { al: () => number; uygula: (no: number) => boolean } {
  let son = 0;
  let uygulanan = 0;
  return { al: () => ++son, uygula: (no) => { if (no < uygulanan) return false; uygulanan = no; return true; } };
}

/** Seçicinin tetiğindeki başlık: taslak "Yeni sohbet", ana "Ana sohbet", kayıtlı sohbet kendi başlığı; bilinmiyorsa nötr "Sohbet" (var olan bir
 *  sohbetin yerinde asla "Yeni sohbet" denmez). */
export function secimBasligi(secim: KokpitSecimi, o: { anaId: number | null; liste: readonly SohbetOzet[] }): string {
  if (secim === 'yeni') return 'Yeni sohbet';
  if (secim === null || secim === o.anaId) return 'Ana sohbet';
  return o.liste.find((s) => s.id === secim)?.baslik || 'Sohbet';
}

/** Başka bir sohbetteyken ana sohbete kendiliğinden mesaj gelince panelin çipi: gerçek sayıyı söyler. */
export const anaYeniMesajMetni = (n: number): string => `Ana sohbette ${n} yeni mesaj`;
