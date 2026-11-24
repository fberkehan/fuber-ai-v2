// ── Açılış animasyonu ve sesi: karar işlevleri, zaman çizelgesi, ilk gösterim kapısı (0.11 G11, spec §9) ─────────────────────────
// Ana pencere her SÜREÇ başlangıcında ilk gösterildiğinde (tepsiden `--gizli` başlangıçta pencere gösterilene dek değil; sonraki
// gösterimlerde hiç) ürün işareti belirir, FUBER yazısı gelir, örtü kokpite erir. Saf mantık burada (testli); örtü: renderer/acilis/.
// Animasyon hiçbir şeyi BEKLETMEZ: örtü yalnız bir katmandır, uygulama arkada kendi hızında hazırlanır, veri beklenmez.

import { sureSuruyor } from './ada.ts';

/** Örtünün şekli: 'tam' = işaret çizilir + yazı gelir + erir; 'kisa' = azaltılmış hareket (işaret durağan, kısa solma); 'yok'. */
export type AcilisKipi = 'tam' | 'kisa' | 'yok';

/** Zaman çizelgesi (ms; örtü başlangıcından). Örtü CSS'inde HİÇBİR süre yazılı değildir: `acilisSureleri()` bu değerleri `--a-*` değişkenleri
 *  olarak verir (Acilis.tsx), acilis.css yalnız onları okur — tek kaynak (tests/acilis.test.ts: çizelge toplamları ve CSS'te süre yok). */
export const ACILIS = {
  /** Ürün işareti (0.12: mini logo — iki yol: üst çerçeve [y 0–97] + alt gövde [ilmek ve kase, y 61–159]) çizilir/ölçeklenir: 0–700.
   *  İşaret tüy gibi alttan yukarı açılır (`isaretAc`), ölçek+saydamlık (`isaretGel`); alt gövde ERKEN başlayıp yavaşça belirir
   *  (`parcaBas` + `parcaSure`; tam `isaretBit`'te biter): alttan süpüren maske ilk ~300 ms'de tam o bölgeden geçer — geç başlarsa işaret
   *  geç belirir ve süpürme bir solmaya benzer (inceleme, Minor-2). */
  isaretBas: 0, isaretBit: 700,
  isaretAc: 600, isaretGel: 560,
  parcaSure: 560, parcaBas: 140,
  /** FUBER yazısı: 300–900 (5 harf `harfAralik` arayla, her biri `harfSure`; son harf `yaziBit`'te biter). */
  yaziBas: 300, yaziBit: 900,
  harfAralik: 55, harfSure: 380,
  /** Örtü içeriğe erir: 1200'de başlar, 200 ms sürer → toplam 1,4 sn. İşaret+yazı zeminden ÖNCE söner (uygulamanın üstünde hayalet
   *  kalmasın): `eritBas - sahneOnce`'den `sahneSure` boyunca. */
  eritBas: 1200, eritSure: 200,
  sahneOnce: 80, sahneSure: 120,
  /** Tıklama/tuş atlatınca örtünün sönme süresi (ses kesilmez, kendi hâlinde biter). */
  atlaSure: 140,
  /** Azaltılmış hareket: işaret ve yazı hemen durağan görünür, kısa bekler, ~300 ms solar (spec 200 ms; denetleyici kararı ~300). */
  kisaBekle: 420, kisaSure: 300, kisaSahneOnce: 60, kisaSahneSure: 120,
  /** Her şey ters giderse (animasyon olayı gelmedi) örtü bu kadar sonra yine de kalkar. */
  emniyet: 2600,
} as const;
/** Örtünün en uzun görünür kalacağı süre (tam kip). */
export const ACILIS_TOPLAM = ACILIS.eritBas + ACILIS.eritSure;

/** Örtü CSS'inin okuduğu süre değişkenleri (ms dizgesi). acilis.css başka hiçbir süre içermez. */
export function acilisSureleri(): Record<string, string> {
  const a = ACILIS;
  const ms = (n: number) => `${n}ms`;
  return {
    '--a-isaret-ac': ms(a.isaretAc), '--a-isaret-gel': ms(a.isaretGel),
    '--a-parca-sure': ms(a.parcaSure), '--a-parca-bas': ms(a.parcaBas),
    '--a-yazi-bas': ms(a.yaziBas), '--a-harf-aralik': ms(a.harfAralik), '--a-harf-sure': ms(a.harfSure),
    '--a-erit-bas': ms(a.eritBas), '--a-erit-sure': ms(a.eritSure),
    '--a-sahne-bas': ms(a.eritBas - a.sahneOnce), '--a-sahne-sure': ms(a.sahneSure),
    '--a-kisa-bekle': ms(a.kisaBekle), '--a-kisa-sure': ms(a.kisaSure),
    '--a-kisa-sahne-bas': ms(a.kisaBekle - a.kisaSahneOnce), '--a-kisa-sahne-sure': ms(a.kisaSahneSure),
  };
}

export function acilisCalsinMi(o: { ilkGosterim: boolean; azaltilmisHareket: boolean }): AcilisKipi {
  if (!o.ilkGosterim) return 'yok';
  return o.azaltilmisHareket ? 'kisa' : 'tam';
}

export interface AcilisSesiGirdisi {
  /** Ayarlar → Ses → "Açılış sesi" (varsayılan açık). */
  ayar: boolean;
  /** Sessiz saat aralığında mı (Ayarlar → Kendiliğinden yazma). */
  sessizSaat: boolean;
  /** "Rahatsız etme" sürüyor mu (sol menü, 1 saat). */
  rahatsizEtme: boolean;
  /** FUBER_DEMO (testler, önizlemeler): ses ASLA çalınmaz. */
  demo: boolean;
}

/** Açılış çanı gerçekten çalınacak mı. */
export function acilisSesiCalsinMi(o: AcilisSesiGirdisi): boolean {
  return o.ayar && !o.sessizSaat && !o.rahatsizEtme && !o.demo;
}

/** 'cal': çal. 'kaydet': FUBER_DEMO'da çalacaktı ama çalınmaz — ana süreç günlüğüne "acilis-sesi" yazılır (test bunu okur). 'yok'. */
export function acilisSesiEylemi(o: AcilisSesiGirdisi): 'cal' | 'kaydet' | 'yok' {
  if (acilisSesiCalsinMi(o)) return 'cal';
  return o.demo && o.ayar && !o.sessizSaat && !o.rahatsizEtme ? 'kaydet' : 'yok';
}

/** Çalma anındaki ayarlardan ses kararı. Ayarlar OKUNAMADIYSA (null/eksik) SES ÇALMAZ ve kaydedilmez: bilinmeyen sessiz saat/rahatsız etme
 *  gece 3'te çan çalmasın (açık-başarısız değil, kapalı-başarısız). */
export interface AcilisSesiAyari {
  ses?: { acilisSesi?: boolean };
  proaktif?: { sessizBaslangic: string; sessizBitis: string; rahatsizEtmeBitis?: string };
}
export function acilisSesiKarari(a: AcilisSesiAyari | null | undefined, o: { simdi: Date; demo: boolean }): 'cal' | 'kaydet' | 'yok' {
  if (!a || !a.ses || !a.proaktif) return 'yok';
  return acilisSesiEylemi({
    ayar: a.ses.acilisSesi !== false,
    sessizSaat: sessizSaatteMi(a.proaktif.sessizBaslangic, a.proaktif.sessizBitis, o.simdi),
    rahatsizEtme: sureSuruyor(a.proaktif.rahatsizEtmeBitis, o.simdi.getTime()),
    demo: o.demo,
  });
}

const dakika = (s: string) => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
/** Sessiz saat aralığında mı ("23:00"–"08:00" gece yarısını aşar; bitiş dışarıda; başlangıç = bitiş sessiz sayılmaz). TEK kural:
 *  main/zamanlayici.ts sessizMi de bunu çağırır (0.11 G12b, G11 incelemesi K4; "rahatsız etme" ayrı sorulur: shared/ada.ts sureSuruyor). */
export function sessizSaatteMi(baslangic: string, bitis: string, d: Date): boolean {
  const n = d.getHours() * 60 + d.getMinutes();
  const a = dakika(baslangic), b = dakika(bitis);
  return a > b ? n >= a || n < b : n >= a && n < b;
}

/** Örtüyü atlatan tıklama TÜKETİLSİN mi (alttaki görünmeyen denetime geçmesin)?
 *  - Pencere düğmeleri (Küçült/Büyüt/Kapat; örtünün ÜSTÜNDE, görünür): HİÇBİR ZAMAN — tıklama örtüyü yine atlatır ama düğmeye ulaşır
 *    (ilk tıklamada çalışır).
 *  - Üretimde (demo değil): HER ZAMAN.
 *  - FUBER_DEMO'da (yalnız testler): varsayılan olarak hayır (otomasyonun ilk tıklaması kaybolmasın); test kapısı (`demoKapisi`) üretim
 *    davranışını açar. */
export function acilisTiklamaTuketilsinMi(o: { demo: boolean; demoKapisi: boolean; pencereDugmesi: boolean }): boolean {
  if (o.pencereDugmesi) return false;
  return !o.demo || o.demoKapisi;
}

/** Açılış olayları (FUBER_DEMO günlüğü; main/acilis.ts). 'acilis-sesi': çalacaktı ama demo olduğu için çalınmadı. */
export const ACILIS_OLAYLARI = ['acilis-basladi', 'acilis-sesi', 'acilis-atlandi', 'acilis-bitti'] as const;
export type AcilisOlayi = (typeof ACILIS_OLAYLARI)[number];

/** Süreç başına BİR kez: ana pencerenin ilk gerçek gösterimi. `gosterildi()` pencere ilk 'show' olayını verince çağrılır; `al()`
 *  (IPC uygulama:ilk-gosterim) pencere henüz gösterilmediyse (`--gizli` başlangıç) gösterilene dek bekler, sonra TEK kez true döner;
 *  ikinci çağrıdan itibaren false. Arayüz yenilenip iki soru beklemedeyse true yalnız en sonuncuya gider (eskisinin penceresi gitti). */
export function ilkGosterimKapisi(): { gosterildi(): void; al(): Promise<boolean> } {
  let gosterilmis = false;
  let verildi = false;
  const bekleyen: ((b: boolean) => void)[] = [];
  return {
    gosterildi() {
      if (gosterilmis) return;
      gosterilmis = true;
      if (!bekleyen.length) return;
      verildi = true;
      const sonuncu = bekleyen.length - 1;
      bekleyen.splice(0).forEach((coz, i) => coz(i === sonuncu));
    },
    al() {
      if (verildi) return Promise.resolve(false);
      if (gosterilmis) { verildi = true; return Promise.resolve(true); }
      return new Promise<boolean>((coz) => { bekleyen.push(coz); });
    },
  };
}
