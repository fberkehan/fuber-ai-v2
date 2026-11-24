// ── Kurulumun sistem kontrolü (saf mantık; birim testli: tests/sistem-kontrol.test.ts) ──────────────────────────────
// Kurulum sihirbazının "Sistem ve gizlilik" adımı bilgisayarı tanır: işletim sistemi, bellek, disk, yerel beyin (0.12 H3a: buzlu cam satırı kalktı; mikrofonu
// Ses adımı sayar ve gösterir — Ruling CB; `mikrofon` verilmezse satırı yok).
// Bilgiyi ana süreç toplar (src/main/sistem-kontrol.ts; mikrofonu arayüz sayar), değerlendirme buradadır. HİÇBİR satır kurulumu
// durdurmaz: uymayan özellik "uyarı" (yavaş çalışabilir) ya da "yok" (bu bilgisayarda kapalı kalır) olarak açıklanır (tasarım §5.11).
// Satır metinleri kısa ve teknik olmayan Türkçedir; kullanıcı bir şirket yöneticisidir.
import type { Uygunluk } from './model-bilgisi.ts';
import { buyukBasla, yerelAdi } from './terimler.ts';

/** vramGB: NVIDIA ekran kartının belleği (birden çok kartta en büyüğü); kart yoksa ya da okunamadıysa yok. Yerel modelin uygunluğu
 *  (shared/model-bilgisi.ts → yerelUygunluk) bununla hesaplanır. */
export interface SistemBilgisi { platform: string; surum: string; ramGB: number; bosDiskGB: number; nvidia: boolean; vramGB?: number; mikrofon?: boolean }
/** tamam: hazır · uyari: çalışır ama zorlanabilir · yok: bu bilgisayarda kullanılamaz (kurulum yine sürer). */
export type KontrolDurumu = 'tamam' | 'uyari' | 'yok';
export interface KontrolSatiri { ad: string; durum: KontrolDurumu; metin: string }

/** Windows 10 21H2'nin derlemesi (en düşük desteklenen); Windows 11 22000'den başlar. */
const WIN10_21H2 = 19044;
const WIN11 = 22000;
/** macOS 13 Ventura = Darwin 22. */
const MAC_VENTURA_DARWIN = 22;

/** 2,4 GB · 64 GB · 1.737 GB (on ve üstünde ondalık yok). */
const gb = (n: number) => `${n.toLocaleString('tr-TR', { maximumFractionDigits: n >= 10 ? 0 : 1 })} GB`;

function isletimSistemi(platform: string, surum: string): KontrolSatiri {
  const ad = 'İşletim sistemi';
  if (platform === 'win32') {
    const derleme = Number(surum.split('.')[2]);
    if (!Number.isInteger(derleme)) return { ad, durum: 'uyari', metin: 'Windows sürümü okunamadı' };
    if (derleme >= WIN11) return { ad, durum: 'tamam', metin: 'Windows 11' };
    if (derleme >= WIN10_21H2) return { ad, durum: 'tamam', metin: 'Windows 10' };
    return { ad, durum: 'uyari', metin: 'Windows 10 güncel değil; Windows Update ile güncellemeni öneririm' };
  }
  if (platform === 'darwin') {
    const ana = Number(surum.split('.')[0]);
    return ana >= MAC_VENTURA_DARWIN
      ? { ad, durum: 'tamam', metin: 'macOS' }
      : { ad, durum: 'uyari', metin: 'macOS 13 Ventura ya da üstü önerilir' };
  }
  return { ad, durum: 'uyari', metin: 'Bu işletim sistemi resmî olarak desteklenmiyor' };
}

/** Yerel model satırı: bu bilgisayarın en iyi yerel seçeneği (model-bilgisi.ts → enIyiYerel); ekran kartı şart değildir (hafif model
 *  işlemcide çalışır). Bilinmiyorsa "denetlenemedi". Adı sözlükten moda göre (I2, P2): İş "Bu bilgisayardaki yapay zekâ", Geliştirici
 *  "Yerel model". */
function yerelSatir(y: { durum: Uygunluk; neden: string } | null | undefined, sade: boolean): KontrolSatiri {
  const ad = buyukBasla(yerelAdi(sade));
  if (!y) return { ad, durum: 'uyari', metin: 'Denetlenemedi; sonra Ayarlar → Gizlilik’ten bakabilirsin' };
  if (y.durum === 'rahat') return { ad, durum: 'tamam', metin: `Kurulabilir · ${y.neden}` };
  if (y.durum === 'zorlanir') return { ad, durum: 'uyari', metin: `Kurulabilir ama yavaş · ${y.neden}` };
  return { ad, durum: 'yok', metin: `Bu bilgisayarda çalışmaz · ${y.neden}` };
}

/** Bilgisayarı tanır; satırlar her zaman aynı sırada gelir. `yerel`: en iyi yerel seçeneğin uygunluğu (arayüz yerel:durum ile hesaplar). */
export function sistemDegerlendir(b: SistemBilgisi, yerel?: { durum: Uygunluk; neden: string } | null, sade = true): KontrolSatiri[] {
  const bellek: KontrolSatiri = b.ramGB >= 16 ? { ad: 'Bellek', durum: 'tamam', metin: gb(b.ramGB) }
    : b.ramGB >= 8 ? { ad: 'Bellek', durum: 'tamam', metin: `${gb(b.ramGB)} · 16 GB önerilir` }
    : { ad: 'Bellek', durum: 'uyari', metin: `${gb(b.ramGB)} · en az 8 GB gerekir, yavaş çalışabilir` };
  const disk: KontrolSatiri = !Number.isFinite(b.bosDiskGB) ? { ad: 'Disk', durum: 'uyari', metin: 'Boş yer ölçülemedi; en az 3 GB gerekir' }
    : b.bosDiskGB >= 3 ? { ad: 'Disk', durum: 'tamam', metin: `${gb(b.bosDiskGB)} boş` }
    : { ad: 'Disk', durum: 'uyari', metin: `${gb(b.bosDiskGB)} boş · en az 3 GB gerekir` };
  return [
    isletimSistemi(b.platform, b.surum),
    bellek,
    disk,
    yerelSatir(yerel, sade),
    ...(b.mikrofon === undefined ? []
      : [b.mikrofon ? { ad: 'Mikrofon', durum: 'tamam', metin: 'Hey Fuber ve sesli komut' } as KontrolSatiri : { ad: 'Mikrofon', durum: 'yok', metin: 'Bulunamadı; yazarak konuşabilirsin' } as KontrolSatiri]),
  ];
}

/** `nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits` çıktısı (MiB, satır başına bir kart) → en büyük kartın
 *  belleği (GB, bir ondalık); okunamazsa undefined ("[N/A]", boş çıktı). */
export function ekranKartiBellegi(cikti: string): number | undefined {
  const mib = String(cikti).split(/\r?\n/).map((s) => Number(s.trim())).filter((n) => Number.isFinite(n) && n > 0);
  return mib.length ? Math.round((Math.max(...mib) / 1024) * 10) / 10 : undefined;
}

/** Standart bellek boyları (GB). */
const BELLEK_BOYLARI = [2, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 192, 256];
/** 8 GB'lık dizüstünde tümleşik ekran kartı 1,5–2 GB ayırabilir: Windows 5,9–6,5 GiB gösterir. Bu eşikten büyük ve 8'den küçük her
 *  görünen bellek 8 GB sınıfı sayılır ("en az 8 GB gerekir" denmez). */
const SEKIZ_GB_SINIFI_GIB = 5.5;
/**
 * İşletim sisteminin gördüğü bellek (bayt) → takılı bellek tahmini (GB). Sistem ve tümleşik ekran kartı bir pay ayırır: 16 GB'lık
 * bilgisayar 15,7 GiB (ya da 13,9 GiB) görünür; yoksa 16 GB'lık bilgisayara "16 GB önerilir" denirdi. 5,5–8 GiB arası 8 GB sınıfıdır
 * (yukarıda); ötesinde en yakın büyük standart boyun %85'ine ulaşıyorsa o boy, değilse yuvarlanmış değer.
 */
export function bellekGB(bayt: number): number {
  const gib = bayt / 2 ** 30;
  if (gib >= SEKIZ_GB_SINIFI_GIB && gib < 8) return 8;
  const boy = BELLEK_BOYLARI.find((x) => x >= gib);
  return boy && gib >= boy * 0.85 ? boy : Math.round(gib);
}
