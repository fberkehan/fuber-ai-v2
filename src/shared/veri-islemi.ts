// ── Veri yaşam döngüsünün arayüz sözleşmesi ve metinleri (0.11 G2, spec §2; saf) ──────────────────────────────────────────────────────
// "Tekrar hoş geldin" (renderer/sayfalar/TekrarHosGeldin.tsx) ve Ayarlar → Veri (renderer/ayarlar/Veri.tsx) aynı özeti (`veri:ozet`)
// ve aynı metinleri okur. Dosya işlemleri ana süreçte: main/veri/temizlik.ts. İş dili: "anahtar", "model", "beyin" yok (shared/is-dili.ts).
import { gbMetni } from './model-bilgisi.ts';

/** `veri:ozet` yanıtı. */
export interface VeriDurumu {
  /** Veri klasöründe `.yeniden-kurulum` işareti var (kaldırıcı "verilerim kalsın" dedi). */
  yenidenKurulum: boolean;
  /** Silinmemiş hafıza notu sayısı. */
  hafiza: number;
  /** Mesajı olan, arşivde olmayan sohbet sayısı. */
  sohbet: number;
  /** En yeni mesajın zamanı (ISO) ya da null. */
  sonKullanim: string | null;
  /** Bağlı Fuber hesabının e-postası ya da null. */
  hesapEposta: string | null;
  /** "Yeni başla"dan kalan yedek klasörü sayısı ve toplam boyutu (boyut yalnız `boyut: true` istenince; değilse null — K2). */
  yedekSayisi: number;
  yedekBayt: number | null;
  /** İndirilen yapay zekânın (yerel/ + whisper/ + ses/) boyutu (yalnız `boyut: true`; değilse null). */
  yerelBayt: number | null;
  /** Boyut taraması sınıra takılmadan bitti mi (değilse boyutlar alt sınırdır). */
  boyutTam: boolean;
  /** Kurulu (paketli) uygulama: "Fuber'i bu bilgisayardan kaldır" yalnız bunda çalışır. */
  kaldirilabilir: boolean;
}

/** `veri:yeni-basla`, `veri:sil`, `veri:kaldir` yanıtı (tamam: uygulama yeniden açılıyor / kapanıyor). */
export type VeriIslemYaniti = { tamam: true } | { tamam: false; hata: string };

/** Boyut: 1 GB ve üstü "≈1,9 GB", altı "≈350 MB" (en az 1 MB). `tam` false (boyut taraması sınıra takıldı: `boyutTam: false`) ise ölçü bir
 *  alt sınırdır: "en az ≈1,9 GB" (G8, Kü-1). */
export function boyutMetni(bayt: number, tam = true): string {
  const m = bayt >= 1e9 ? `≈${gbMetni(bayt / 1e9)}` : `≈${Math.max(1, Math.round(bayt / 1e6)).toLocaleString('tr-TR')} MB`;
  return tam ? m : `en az ${m}`;
}

// ── Ayarlar → Veri'nin yükleme hâli (0.11 G8, G2 incelemesi Kü-1; saf, birim testli: tests/veri-yukleme.test.ts) ────────────────────────
// `veri:ozet` iki çağrıda gelir: önce SAYILAR (hızlı: yedek sayısı, hafıza, sohbet), sonra BOYUTLAR (`{ boyut: true }`; eşzamansız, sınırlı
// tarama, ≤2 sn). Boyutlar gelene dek `yedekBayt` / `yerelBayt` null'dır. Tarama sürerken satır "Yedek yok." DEMEZ (nötr yükleniyor hâli),
// onay kutusu hiçbir şeyi beklemez, boyutu gelmemiş seçenek "yok" sayılmaz. Çağrılardan biri düşerse (düzeltme turu 1, K6) sonsuz yükleniyor kalmaz:
// boyut çağrısı düşerse "boyutu bilinmiyor" der (seçenek yine seçilebilir), sayı çağrısı düşerse "Kaldır" nedenini söyler.
type YedekGirdisi = Pick<VeriDurumu, 'yedekSayisi' | 'yedekBayt' | 'boyutTam'>;
export const BOYUT_BILINMIYOR = 'boyutu bilinmiyor';
export const YEDEK_DENETLENEMEDI = 'Yedekler denetlenemedi; sayfayı yeniden açınca denenir.';
export const KALDIR_DURUM_YOK = 'Kurulum durumu okunamadı; sayfayı yeniden açınca denenir.';
/** "Eski yedekler" satırı: `yukleniyor` (sayı henüz gelmedi: Iskelet çizilir, düğme yok), açıklama ve "Eski yedekleri sil" düğmesi.
 *  `boyutHata`: boyut çağrısı düştü — sayı yeter, boyut yerine "boyutu bilinmiyor" yazılır (sonsuz bekleme yok). */
export function yedekSatiri(d: YedekGirdisi | null, boyutHata = false): { yukleniyor: boolean; aciklama: string; dugme: boolean } {
  if (!d) return { yukleniyor: true, aciklama: '', dugme: false };
  if (d.yedekSayisi <= 0) return { yukleniyor: false, aciklama: 'Yedek yok.', dugme: false };
  const boyut = d.yedekBayt !== null ? ` · ${boyutMetni(d.yedekBayt, d.boyutTam)}` : boyutHata ? ` · ${BOYUT_BILINMIYOR}` : '';
  return { yukleniyor: false, aciklama: `${d.yedekSayisi} yedek${boyut} — “Yeni başla” ile kenara taşınan eski hafıza, sohbetler ve ayarlar.`, dugme: true };
}
/** "Eski yedekler silinsin mi?" onayının listesi: sayı hemen, boyut varsa yanında. */
export const yedekSilListesi = (d: YedekGirdisi): string[] => [`${d.yedekSayisi} yedek klasörü${d.yedekBayt !== null ? ` (${boyutMetni(d.yedekBayt, d.boyutTam)})` : ''}`];
/** "İndirilen yapay zekâ da silinsin" seçeneği: boyut gelene dek `bekliyor` (Iskelet), sonra indirilmiş bir şey yoksa `yok`, varsa etiketiyle.
 *  `boyutHata` (boyut ya da sayı çağrısı düştü; ikinci durumda `d` hiç gelmemiştir): ne olduğu bilinmediğinden seçenek yine sunulur —
 *  "(boyutu bilinmiyor)"; varsayılan kapalı kalır. Sonsuz Iskelet yok. */
export function yerelSecenegiDurumu(d: Pick<VeriDurumu, 'yerelBayt' | 'boyutTam'> | null, boyutHata = false): { durum: 'bekliyor' } | { durum: 'yok' } | { durum: 'var'; etiket: string } {
  if (boyutHata && (!d || d.yerelBayt === null)) return { durum: 'var', etiket: `İndirilen yapay zekâ da silinsin (${BOYUT_BILINMIYOR})` };
  if (!d || d.yerelBayt === null) return { durum: 'bekliyor' };
  return d.yerelBayt > 0 ? { durum: 'var', etiket: yerelSecenegi(d.yerelBayt, d.boyutTam) } : { durum: 'yok' };
}

/** Son kullanım: bugün / dün / "26 Ekim" (bu yıl) / "26 Ekim 2025". */
export function sonKullanimMetni(iso: string | null, simdi: Date = new Date()): string {
  if (!iso) return 'Bilinmiyor';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Bilinmiyor';
  const gun = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const fark = Math.round((gun(simdi) - gun(d)) / 86_400_000);
  if (fark === 0) return 'Bugün';
  if (fark === 1) return 'Dün';
  return d.toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', ...(d.getFullYear() === simdi.getFullYear() ? {} : { year: 'numeric' }) });
}

/** "Fuber'i kaldır" düğmesi: yalnız kurulu (paketli) uygulamada çalışır; durum henüz gelmediyse kapalı (neden yok: kısa süre), sayı çağrısı düştüyse
 *  kapalı ve NEDENİ söylenir (sessiz kapalı düğme yok), geliştirme kopyasında kapalı ve nedeni söylenir. */
export function kaldirDurumu(d: Pick<VeriDurumu, 'kaldirilabilir'> | null, sayiHata = false): { kapali: boolean; neden?: string } {
  if (sayiHata) return { kapali: true, neden: KALDIR_DURUM_YOK };
  if (!d) return { kapali: true };
  return d.kaldirilabilir ? { kapali: false } : { kapali: true, neden: KALDIR_GELISTIRME };
}

// ── "Tekrar hoş geldin" (spec §2) ──
export const TEKRAR_BASLIK = 'Bu bilgisayarda Fuber’in hafızası duruyor';
export const TEKRAR_GIRIS = 'Fuber’i yeniden kurdun; eski hafızan, sohbetlerin ve ayarların yerinde. Kaldığın yerden sürdürebilir ya da temiz bir sayfa açabilirsin.';
export const DEVAM_DUGME = 'Kaldığın yerden devam et';
export const YENI_BASLA_DUGME = 'Yeni başla';
export const YENI_BASLA_NOTU = 'Eski veriler bir yedeğe taşınır; istediğin an Ayarlar → Veri’den silebilirsin.';

// 0.12 H3a (spec §2): "Tekrar hoş geldin" baştan — tek kart (baş harf, e-posta, "Son kullanım: 3 gün önce", "142 sohbet · 38 hafıza") ve
// iki büyük seçenek: kaldığın yerden devam et (önerilen) / sıfırdan başla.
export const TEKRAR_BASLIK_KISA = 'Tekrar hoş geldin';
export const TEKRAR_GIRIS_KISA = 'Bu bilgisayarda Fuber’in hafızası duruyor. Kaldığın yerden sürdürebilir ya da temiz bir sayfa açabilirsin.';
export const DEVAM_ACIKLAMA = 'Hafızan, sohbetlerin ve ayarların olduğu gibi.';
export const SIFIRDAN_DUGME = 'Sıfırdan başla';
/** H3a düzeltme turu 1 (inceleme Minor 8): "Sıfırdan başla" bu bilgisayarı hesabından da çıkarır (hesaptanCik) — not bunu da söyler. */
export const SIFIRDAN_NOTU = 'Eski veriler yedeğe alınır, silinmez; bu bilgisayar hesabından çıkar.';
/** 0.12 H3b düzeltme turu 2 (yeniden inceleme Y2): Gizli'de çıkış sunucuya bildirilmez (Gizli'de sıfır hesap isteği) — "bağlantı kapatılır"
 *  sözü verilmez: oturum bu bilgisayardan silinir. 11 Kas: "Fuber Yönetim'den kapatılabilir" kalktı (açık kaynak kullanıcısında Yönetim yok). */
export const GIZLI_CIKIS_SATIRI = 'Oturum bilgisi bu bilgisayardan silinir';
export const sifirdanNotu = (gizli: boolean): string =>
  (gizli ? 'Eski veriler yedeğe alınır, silinmez; hesabının oturumu bu bilgisayardan silinir (Gizli moddasın: çıkış sunucuya bildirilmez).' : SIFIRDAN_NOTU);
/** Tekrar hoş geldin'de seçeneklerin altındaki sakin not: iki yolun ne yaptığı (T34b, P14: "hiçbir şey" denmez; sıfırdan başla yedeğe taşır). */
export const TEKRAR_GUVENCE = 'Devam edersen verilerin yerinde kalır; sıfırdan başlarsan eski verilerin yedeğe alınır, istediğin an Ayarlar → Veri’den bakarsın.';

/** "Son kullanım" göreli: Bugün · Dün · 3 gün önce (< 30 gün) · 2 ay önce (< 12 ay) · yoksa tarih. */
export function sonKullanimGoreli(iso: string | null, simdi: Date = new Date()): string {
  if (!iso) return 'Bilinmiyor';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Bilinmiyor';
  const gun = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const fark = Math.round((gun(simdi) - gun(d)) / 86_400_000);
  if (fark <= 0) return 'Bugün';
  if (fark === 1) return 'Dün';
  if (fark < 30) return `${fark} gün önce`;
  const ay = Math.floor(fark / 30);
  if (ay < 12) return `${ay} ay önce`;
  return sonKullanimMetni(iso, simdi);
}

/** Baş harf (avatar): e-postanın ya da adın ilk harfi, büyük; yoksa "F". */
export function basHarf(ad: string | null | undefined, eposta: string | null | undefined): string {
  const k = (ad?.trim() || eposta?.trim() || 'F').charAt(0);
  return k.toLocaleUpperCase('tr-TR');
}

/** Tekrar hoş geldin kartının satırı: `deger` null → "Boş" (onay işareti yok). */
export interface TekrarSatiri { id: 'sohbet' | 'hafiza' | 'ayarlar' | 'yerel'; ad: string; simge: string; deger: string | null; birim?: string }
export const TEKRAR_BOS = 'Boş';
/**
 * Tekrar hoş geldin kartında "bu bilgisayarda duranlar" (0.12 H3a düzeltme turu 1, inceleme Ö4): uygulamanın KENDİ sayıları (`veri:ozet`).
 * Sayı 0 ise satır "Boş" der ve onay işareti taşımaz — "0 sohbet" ile "Yerinde ✓" bir arada olmaz. İndirilen yapay zekâ yalnız gerçekten
 * varsa (boyut taraması geldiyse ve > 0; "Sıfırdan başla" onu da yerinde bırakır).
 */
export function tekrarSatirlari(d: Pick<VeriDurumu, 'sohbet' | 'hafiza' | 'yerelBayt' | 'boyutTam'>): TekrarSatiri[] {
  const sayi = (n: number) => (n > 0 ? n.toLocaleString('tr-TR') : null);
  const s: TekrarSatiri[] = [
    { id: 'sohbet', ad: 'Sohbetlerin', simge: 'sohbet', deger: sayi(d.sohbet), birim: 'sohbet' },
    { id: 'hafiza', ad: 'Hafızan', simge: 'hafiza', deger: sayi(d.hafiza), birim: 'not' },
    { id: 'ayarlar', ad: 'Ayarların', simge: 'ayarlar', deger: 'Yerinde' },
  ];
  if ((d.yerelBayt ?? 0) > 0) s.push({ id: 'yerel', ad: 'İndirilen yapay zekâ', simge: 'isik', deger: boyutMetni(d.yerelBayt as number, d.boyutTam) });
  return s;
}

/** Özetin satırları ([etiket, değer]); hesap yoksa hesap satırı yok. */
export function tekrarOzetSatirlari(d: Pick<VeriDurumu, 'hafiza' | 'sohbet' | 'sonKullanim' | 'hesapEposta'>, simdi: Date = new Date()): [string, string][] {
  return [
    ['Hafıza notu', d.hafiza.toLocaleString('tr-TR')],
    ['Sohbet', d.sohbet.toLocaleString('tr-TR')],
    ['Son kullanım', sonKullanimMetni(d.sonKullanim, simdi)],
    ...(d.hesapEposta ? [['Fuber hesabı', d.hesapEposta] as [string, string]] : []),
  ];
}

// ── Ayarlar → Veri onay sayfaları (spec §2) ──
export const ONAY_KUTUSU = 'Bunun geri alınamayacağını biliyorum';
/** "İndirilen yapay zekâ da silinsin (≈N GB)" — taramada sınıra takılınca "(en az ≈N GB)". */
export const yerelSecenegi = (bayt: number, tam = true): string => `İndirilen yapay zekâ da silinsin (${boyutMetni(bayt, tam)})`;
/** "Verilerimi sil ve çıkış yap": silinenler (spec listesi). */
export const SIL_LISTESI: readonly string[] = [
  'Hafıza ve sohbetler',
  'Ayarlar',
  'Bağlantılar: e-posta hesapları, WhatsApp ve tarayıcı oturumları',
  '“Yeni başla”dan kalan eski yedekler',
  'Kayıtlı anahtarlar ve oturum bilgisi bu bilgisayardan silinir',
];
/** "Fuber'i bu bilgisayardan kaldır": her şey (indirilen yapay zekâ dahil) + uygulamanın kendisi. */
export const KALDIR_LISTESI: readonly string[] = [
  ...SIL_LISTESI,
  'İndirilen yapay zekâ',
  'Fuber uygulamasının kendisi',
];
/** Onay listeleri Gizli'ye göre (Y2): Gizli'de hesap satırı GIZLI_CIKIS_SATIRI; değilse SIL_LISTESI / KALDIR_LISTESI aynen. */
const hesapSatiriGizli = (l: readonly string[]): string[] => l.map((x) => (x === SIL_LISTESI[SIL_LISTESI.length - 1] ? GIZLI_CIKIS_SATIRI : x));
export const silListesi = (gizli: boolean): readonly string[] => (gizli ? hesapSatiriGizli(SIL_LISTESI) : SIL_LISTESI);
export const kaldirListesi = (gizli: boolean): readonly string[] => (gizli ? hesapSatiriGizli(KALDIR_LISTESI) : KALDIR_LISTESI);
export const BELGELER_KALIR = 'Belgeler klasöründeki dosyaların kalır.';
export const KALDIR_GELISTIRME = 'Bu bir geliştirme kopyası; kaldırma yalnız kurulu Fuber’de çalışır.';
