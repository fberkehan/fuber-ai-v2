// ── Görevler: arayüzün saf görünümü (0.11 G10; spec §8 Görünürlük; tests/isler-arayuz.test.ts) ─────────────────────────────────────────
// Bir şeyin takibi istenince Fuber aralıklar üretip kendi kendini tetikler — kullanıcı bu işleri kokpitteki Görevler
// kartında görür: süren işte kalan süre, son kontrol, adım sayısı ve Durdur; duran işte nedeni ve Sürdür; biten işte tek satır sonuç.
// Burada yalnız düz metin ve karar var (DOM, React, Electron yok): kart, ada hapı ve telefon/özet yolları aynı cümleleri kullanır.
// Cümleler sakindir ve İş dilinde yazılır (shared/is-dili.ts IS_YASAK; teknik sözcük yok); iç talimat hiçbir yerde yok — arayüz yalnız
// G9'un sakladığı özetleri (`sonOzet`, `sonuc`) gösterir. Başlık, özet ve sonuç kullanıcının/yapay zekânın metnidir: kırpma bileşenlerin işi; İş modunda yasak
// sözcük taşıyorsa Etkinlik akışıyla AYNI yardımcıdan (beyin.ts isGuvenliMetin) geçer — başlık "Görev" olur, özet/sonuç düşer.
import type { IsOzet } from './isler.ts';
import type { Mod } from './tipler.ts';
import { isGuvenliMetin } from './beyin.ts';
import { TERIM } from './terimler.ts';

/** Rozet tonu — renderer/ui/Rozet.tsx RozetTonu ile aynı küme (paylaşılan modül arayüze bağlanmaz). */
export type GorevRozetTonu = 'notr' | 'iyi' | 'uyari' | 'hata' | 'bilgi';
export interface GorevSatiriGorunumu {
  baslik: string;
  /** Tek satırlık durum cümlesi ("2 dk 10 sn kaldı · son kontrol 12 sn önce · 3 adım", "Fuber kapandığı için durdu", "Bitti · <sonuç>"). */
  alt: string;
  rozet: { ton: GorevRozetTonu; metin: string };
  /** Satırın tek eylemi: süren iş durdurulur, duran (sürdürülebilirse) sürdürülür, biten işte yok. */
  eylem: 'durdur' | 'surdur' | null;
}

/** Boş durum (ilk kullanımda bir kez): sade dille, tek satır. */
export const GOREV_BOS_METNI = 'Fuber’e bir işi takip ettirebilirsin';
/** Durdur / Sürdür IPC'si düşerse (güvenlik eylemi sessiz kalmaz): kartta tost, adada hapta tek satır; sakin ve İş dilinde. */
export const GOREV_DURDUR_HATASI = `${TERIM.gorev} durdurulamadı; yeniden dene.`;
export const GOREV_SURDUR_HATASI = `${TERIM.gorev} sürdürülemedi; yeniden dene.`;

/** Kullanıcının/yapay zekânın metni (başlık, özet, sonuç): İş modunda yasak sözcük taşıyorsa `yedek` (Etkinlik akışıyla aynı kural ve aynı yardımcı). */
const guvenli = (metin: string | null | undefined, mod: Mod, yedek: string): string => (metin ? isGuvenliMetin(metin, mod, yedek) ?? '' : '');

/**
 * İlk kullanım satırı "görüldü" yazılsın mı — "bir kez" yalnız satır gerçekten çizilip pencere görünürken harcanır: kokpit verisi gelmeden
 * (satır çizilmedi) ya da pencere hiç gösterilmeden (tepsiden `--gizli` başlangıç) değil; bir kez.
 */
export function gorevBosGorulduYazilsin(o: { hali: 'liste' | 'bos' | 'yok'; hazir: boolean; gorunur: boolean; yazildi: boolean }): boolean {
  return o.hali === 'bos' && o.hazir && o.gorunur && !o.yazildi;
}
/**
 * Pencere görünür mü: belge gizli değil VE ana süreç (BrowserWindow.isVisible, 'pencere:durum'.gorunur) "ekranda" diyor. Hiç gösterilmemiş
 * `--gizli` pencerenin belgesi `document.hidden` demeyebilir; ana süreç henüz yanıtlamadıysa (undefined) karar verilmez (görünür sayılmaz).
 */
export const pencereGorunurMu = (belgeGizli: boolean, anaSurecGorunur: boolean | undefined): boolean => !belgeGizli && anaSurecGorunur === true;
/** Satırlarda sonuç/özet bu kadar karakterde kesilir (tek satır; tamamı kartta `title`'da, görev sohbetinde). */
const TEK_SATIR_EN_COK = 140;

/** Boşluk ve satır sonları tek boşluk; `n` karakterden uzunsa … ile kesilir. */
function tekSatir(metin: string, n = TEK_SATIR_EN_COK): string {
  const t = metin.replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
}

const zamanMs = (iso: string | null | undefined): number => (iso ? Date.parse(iso) : Number.NaN);

/** "12 sn önce", "1 dk önce", "2 sa önce", "1 gün önce"; beş saniyeden yeni (ya da saat kaymasıyla gelecekte) "az önce"; zaman yoksa/bozuksa boş. */
export function goreliOnce(iso: string | null | undefined, simdi: Date): string {
  const t = zamanMs(iso);
  if (!Number.isFinite(t)) return '';
  const sn = Math.floor((simdi.getTime() - t) / 1000);
  if (sn < 5) return 'az önce';
  if (sn < 60) return `${sn} sn önce`;
  const dk = Math.floor(sn / 60);
  if (dk < 60) return `${dk} dk önce`;
  const sa = Math.floor(dk / 60);
  return sa < 24 ? `${sa} sa önce` : `${Math.floor(sa / 24)} gün önce`;
}

/** Kalan süre: "45 sn kaldı", "2 dk 10 sn kaldı" (10 dakikaya dek saniyeli), "12 dk kaldı", "1 sa 30 dk kaldı"; bitti/bilinmiyorsa "az kaldı". */
export function kalanMetni(sn: number): string {
  if (!Number.isFinite(sn) || sn <= 0) return 'az kaldı';
  const s = Math.ceil(sn);
  if (s < 60) return `${s} sn kaldı`;
  if (s < 600) { const d = Math.floor(s / 60), k = s % 60; return k ? `${d} dk ${k} sn kaldı` : `${d} dk kaldı`; }
  if (s < 3600) return `${Math.floor(s / 60)} dk kaldı`;
  const sa = Math.floor(s / 3600), dk = Math.floor((s % 3600) / 60);
  return dk ? `${sa} sa ${dk} dk kaldı` : `${sa} sa kaldı`;
}

/** Duran/hata veren görev yeniden başlatılabilir mi — motorun `isSurdur` kuralları (adım sınırı dolmadı, bitiş zamanı geçmedi). Gizli/yerel yol ve
 *  "aynı anda en çok 3" motorda sorulur (Sürdür bir cümleyle reddedilir; arayüz onu gösterir). */
export function surdurulebilirMi(is: IsOzet, simdi: Date): boolean {
  if (is.durum !== 'durdu' && is.durum !== 'hata') return false;
  if (is.adim >= is.plan.azamiAdim) return false;
  const b = is.plan.bitis;
  return !(b.tur === 'zaman' && Date.parse(b.iso) <= simdi.getTime());
}

/** Duran görevin nedeni: sakin, tek cümle (G9 durmaMetni'nin kart dili — özne gizli, üçüncü kişi). 'gizli' YALNIZ Gizli mod açıldığında; yol
 *  başka bir nedenle yalnız bu bilgisayardaki yapay zekâ olduysa 'yerel' (son inceleme I1) — gizlilik vaadi yok. */
function durmaCumlesi(is: IsOzet): string {
  switch (is.durmaNedeni) {
    case 'kapanis': return 'Fuber kapandığı için durdu';
    case 'acil': return 'Acil durdurmayla durdu';
    case 'gizli': return 'Gizli mod açıldığı için durdu';
    case 'yerel': return 'Bu bilgisayardaki yapay zekâyla görev çalışmaz; durdu';
    case 'kullanici': return 'Durdurdun';
    case 'hata': return 'İlerleyemediği için durdu';
    case 'sinir': return 'Adım sınırına ulaştı';
    default: return 'Durdu';
  }
}

/**
 * Görevler kartının bir satırı. Süren: kalan süre · son kontrol · adım; duran: nedeni (+ Sürdür); biten: "Bitti · <sonuç>".
 * `simdi` dışarıdan verilir (kart saniyede bir tazelenir; test sabit saatle sınar). `mod` (varsayılan İş): İş'te yasak sözcük taşıyan başlık
 * "Görev" olur, sonuç düşer (Etkinlik akışıyla aynı kural); Geliştirici'de olduğu gibi.
 */
export function gorevSatiri(is: IsOzet, simdi: Date, mod: Mod = 'is'): GorevSatiriGorunumu {
  const baslik = guvenli(is.baslik, mod, TERIM.gorev) || TERIM.gorev;
  switch (is.durum) {
    case 'suruyor': {
      const bitis = zamanMs(is.bitisZamani);
      const kalan = Number.isFinite(bitis) ? kalanMetni((bitis - simdi.getTime()) / 1000) : '';
      const son = goreliOnce(is.sonKontrol, simdi);
      const alt = [kalan, son ? `son kontrol ${son}` : 'henüz kontrol etmedi', is.adim > 0 ? `${is.adim} adım` : ''].filter(Boolean).join(' · ');
      return { baslik, alt, rozet: is.adimda ? { ton: 'bilgi', metin: 'Çalışıyor' } : { ton: 'iyi', metin: 'Sürüyor' }, eylem: 'durdur' };
    }
    case 'bitti': {
      const sonuc = tekSatir(guvenli(is.sonuc, mod, ''));
      return {
        baslik, alt: sonuc ? `Bitti · ${sonuc}` : 'Bitti',
        rozet: is.durmaNedeni === 'sinir' ? { ton: 'uyari', metin: 'Sınıra ulaştı' } : { ton: 'iyi', metin: 'Bitti' },
        eylem: null,
      };
    }
    case 'durdu':
    case 'hata': {
      const hata = is.durum === 'hata' || is.durmaNedeni === 'hata';
      const uyari = is.durmaNedeni === 'gizli' || is.durmaNedeni === 'yerel' || is.durmaNedeni === 'acil';
      return {
        baslik, alt: durmaCumlesi(is),
        rozet: hata ? { ton: 'hata', metin: 'Sorun' } : { ton: uyari ? 'uyari' : 'notr', metin: 'Durdu' },
        eylem: surdurulebilirMi(is, simdi) ? 'surdur' : null,
      };
    }
    default:
      return { baslik, alt: 'Onayın bekleniyor', rozet: { ton: 'notr', metin: 'Onay bekliyor' }, eylem: null };
  }
}

/**
 * Görev adımının izin DIŞI isteğinin onay kartı açıklaması (son inceleme küçük 4): "Görev: <başlık> · <aracın açıklaması>" — kart adadan iner,
 * kullanıcı hangi arka plan görevinin sorduğunu görür. Başlık kullanıcının/yapay zekânın metnidir: tek satıra iner, kırpılır; İş modunda yasak
 * sözcük taşıyorsa Görevler kartıyla AYNI kural (isGuvenliMetin) — yalnız "Görev · …" kalır.
 */
export function gorevOnayAciklamasi(baslik: string, aciklama: string, mod: Mod = 'is'): string {
  const ad = tekSatir(guvenli(baslik, mod, ''), 80);
  return `${ad ? `${TERIM.gorev}: ${ad}` : TERIM.gorev} · ${aciklama}`;
}

/** Süren/duran görevin son adım özeti (tek satır); biten görevde sonuç zaten alt satırda olduğundan yok. */
export function gorevOzeti(is: IsOzet, mod: Mod = 'is'): string | null {
  if (is.durum === 'bitti' || !is.sonOzet) return null;
  return tekSatir(guvenli(is.sonOzet, mod, '')) || null;
}

/** Son adım özetinin yanındaki "N gönderim" rozeti (izinle yapılan gönderim varsa; metin yok, yalnız sayı — ayrıntı görev sohbetinde). */
export function gonderimRozeti(is: IsOzet): { sayi: number; metin: string } | null {
  const n = Number(is.gonderim);
  return Number.isFinite(n) && n > 0 ? { sayi: n, metin: `${n} gönderim` } : null;
}

/**
 * Ada hapının kaynağı (shared/ada.ts AdaDurumu.gorev): şu an yapay zekâ adımı süren görev — birden çoksa en eski başlayan —, ekran izni ve kaç görevin
 * adımı sürdüğü. Süren olmayan görevin (durdurulmuş ama adımı henüz dönmemiş) adımı sayılmaz. Yoksa null.
 */
export function adimdakiGorev(liste: readonly IsOzet[]): { id: number; baslik: string; ekran: boolean; sayi: number } | null {
  const l = liste.filter((d) => d.durum === 'suruyor' && d.adimda === true)
    .sort((a, b) => (zamanMs(a.baslangic) || 0) - (zamanMs(b.baslangic) || 0) || a.id - b.id);
  const ilk = l[0];
  return ilk ? { id: ilk.id, baslik: ilk.baslik, ekran: ilk.plan.izinler.some((i) => i.tur === 'ekran'), sayi: l.length } : null;
}

export interface GorevKartiOgeleri {
  /** Süren görevler: önce başlayan üstte. */
  suren: IsOzet[];
  /** Bugün (yerel gün) biten ya da duran görevler: en yeni önce. */
  bugun: IsOzet[];
  /** Kartın sırası: süren, ardından bugün bitenler. */
  hepsi: IsOzet[];
}

/** Kartın ögeleri: süren işler + bugün biten/duran işler. Dünün (ya da zamanı bozuk) biten işleri kartta yok — Sohbetler'de görev sohbeti kalır. */
export function gorevKartiOgeleri(liste: readonly IsOzet[], simdi: Date): GorevKartiOgeleri {
  const gunBasi = new Date(simdi.getFullYear(), simdi.getMonth(), simdi.getDate()).getTime();
  const suren = liste.filter((d) => d.durum === 'suruyor')
    .sort((a, b) => (zamanMs(a.baslangic) || 0) - (zamanMs(b.baslangic) || 0) || a.id - b.id);
  const bugun = liste.filter((d) => (d.durum === 'durdu' || d.durum === 'bitti' || d.durum === 'hata') && zamanMs(d.bitisZamani) >= gunBasi)
    .sort((a, b) => zamanMs(b.bitisZamani) - zamanMs(a.bitisZamani) || b.id - a.id);
  return { suren, bugun, hepsi: [...suren, ...bugun] };
}

/** Süren görev sayısı ve adımı süren görev sayısı — Etkinlik'in "Şu an" kartı kokpitin Görevler kartıyla AYNI listeyi okur (11 Kas, bulgu 1). */
export function gorevSayaci(liste: readonly IsOzet[], simdi: Date): { suren: number; adimda: number } {
  const suren = gorevKartiOgeleri(liste, simdi).suren;
  return { suren: suren.length, adimda: suren.filter((d) => d.adimda === true).length };
}

/**
 * Kartın hâli: görev varsa 'liste'; boşken YALNIZ ilk kullanımda bir kez tek satır ('bos': "Fuber’e bir işi takip ettirebilirsin"), sonra 'yok'
 * (kart ızgarada yer tutmaz). Görev başlatamayan yolda (Gizli, yalnız bu bilgisayardaki yapay zekâ: `aracsiz`) o satır söylenmez — olmayacak bir
 * işi önermek yanıltıcı; duran görev satırları ise kalır (Sürdür'ün neden kapalı olduğu görünsün).
 */
export function gorevKartiHali(o: { hepsi: readonly IsOzet[]; ilkKullanim: boolean; aracsiz: boolean }): 'liste' | 'bos' | 'yok' {
  if (o.hepsi.length) return 'liste';
  return o.ilkKullanim && !o.aracsiz ? 'bos' : 'yok';
}
