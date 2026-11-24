// ── Odak zamanlayıcısı: ana süreç (0.14 T26; R26; tests/odak.test.ts) ─────────────────────────────────────────────────────────────────────────────
// Durum burada tutulur ve yerel veritabanının `meta` tablosuna yazılır (`odak-durum`): panel kapansa, çentik gizlense, uygulama yeniden başlasa da sayım
// sürer. Bitiş MUTLAK zamandır (shared/odak.ts); süre boyunca hiçbir şey yoklanmaz: sayım sürerken TEK setTimeout bitişe kurulur, bitince çentikte
// 'odak-bitti' hapı ("Odak bitti · Kısa mola") çıkar ve zil çalar. Uyku/uyanma: Windows'ta bekleme zamanlayıcısı uykuda ilerlemeyebilir, bu yüzden
// `uyandi()` (powerMonitor 'resume' ve 'unlock-screen') bitişi saatle karşılaştırır — geçtiyse bitirir, geçmediyse kalan süreye yeniden kurar; zamanlayıcı bitişten
// önce uyanırsa da (erken tetik) bitirmez, kalan süreye yeniden kurulur. Uygulama kapalıyken biten sayım açılışta sessizce sayılır (hap ve zil yok: kullanıcı
// orada değildi). Ağ yok, bulut yok (P14'e dokunmaz): yalnız yerel veritabanı, olay ve ses dosyası.
// Zil: resources/ses/odak-zil.wav (scripts/dev/zil-uret.mjs ile sentezlenir; lisans yok). Ana süreçte ses çıkışı yok: 'ada:odak-zil' olayıyla çentiğin arayüzü
// çalar (renderer/ada/odak-zil.ts); zil YALNIZ hap gerçekten gösterildiyse çalar (odakBittiBagi). Son inceleme I4: ana pencere öndeyse uygulama içi tost + zil,
// tam ekranda kuyrukta bekler (tam ekran bitince gösterilir), çentik gizli/kapalıyken bugünkü gibi hiçbir şey.
import { powerMonitor } from 'electron';
import { meta, metaYaz, yerelGun } from './vt.js';
import { adayaGonder, adaUyari, adaOdakYolu, adaOdakTost, adaOdakBeklet } from './ada.js';
import { odakAdimi, odakDurumuDogrula, odakUyarisi, type OdakAdimi, type OdakDurumu } from '../shared/odak.js';
import type { OdakBittiYolu, SistemUyarisi } from '../shared/sistem-uyarilari.js';

/** Kalıcı kayıt anahtarı (yerel `meta` tablosu): `{ d: OdakDurumu, gun: 'YYYY-AA-GG' }`. */
export const ODAK_KAYIT_ANAHTARI = 'odak-durum';
/** setTimeout'un en uzun süresi (32 bit): bozuk saat/kayıtla bitiş çok uzaksa tavanlanır, tetikte yeniden kurulur. */
const EN_UZUN_MS = 2 ** 31 - 1;

export interface OdakBagimliliklari {
  simdi: () => number;
  /** Yerel gün (YYYY-AA-GG): "bugün tamamlanan" günlüktür. */
  gun: () => string;
  oku: () => string | undefined;
  yaz: (kayit: string) => void;
  /** Tek atımlık zamanlayıcı kurar (varsayılan: setTimeout). */
  zamanla: (f: () => void, ms: number) => unknown;
  iptal: (zamanlayici: unknown) => void;
  /** Yeni durumu arayüze duyurur (yalnız çentiğin penceresine). */
  duyur: (d: OdakDurumu) => void;
  /** Sayım bitti: uyarı hapı + zil (varsayılan bağlayıcı ikisini de yapar). */
  bitti: (u: SistemUyarisi) => void;
}

export interface OdakYoneticisi {
  durum(): OdakDurumu;
  /** Arayüzün adımı (baslat, duraklat, surdur, sifirla). Yeni durumu döner. */
  adim(o: OdakAdimi): OdakDurumu;
  /** Bilgisayar uyandı/ekran açıldı: bitişi saatle karşılaştır. */
  uyandi(): void;
  /** Bekleyen zamanlayıcıyı bırakır (uygulama kapanıyor). */
  kapat(): void;
}

export function odakYoneticisiKur(b: OdakBagimliliklari): OdakYoneticisi {
  let zamanlayici: unknown = null;
  let d: OdakDurumu;
  let gun: string;

  const kaydet = () => b.yaz(JSON.stringify({ d, gun }));
  const durdur = () => { if (zamanlayici !== null) { b.iptal(zamanlayici); zamanlayici = null; } };
  /** Sayım sürüyorsa tek zamanlayıcıyı bitişe kurar; yoksa hiçbir şey bekletmez. */
  const kur = () => {
    durdur();
    if (d.bitis === null) return;
    zamanlayici = b.zamanla(tetik, Math.min(EN_UZUN_MS, Math.max(0, d.bitis - b.simdi())));
  };
  /** Gün değiştiyse "bugün tamamlanan" sıfırlanır. */
  const gunKontrol = () => {
    const bugun = b.gun();
    if (bugun === gun) return;
    gun = bugun;
    d = { ...d, tamamlanan: 0 };
    kaydet();
  };
  const bitir = (hap: boolean) => {
    const biten = d.tur;
    d = odakAdimi(d, { tur: 'bitti' }, b.simdi());
    kaydet();
    durdur();
    b.duyur(d);
    if (hap) b.bitti(odakUyarisi(biten, d));
  };
  function tetik(): void {
    zamanlayici = null;
    if (d.bitis === null) return;
    if (b.simdi() < d.bitis) { kur(); return; } // erken tetik (ya da tavanlanmış uzun bekleme): kalan süreye yeniden
    bitir(true);
  }

  // Yükleme: bozuk kayıt temiz başlangıca düşer. Kapalıyken biten sayım sessizce sayılır.
  let kayit: { d?: unknown; gun?: unknown } | null = null;
  try { kayit = JSON.parse(b.oku() ?? 'null'); } catch { kayit = null; }
  d = odakDurumuDogrula(kayit?.d);
  gun = typeof kayit?.gun === 'string' ? kayit.gun : b.gun();
  gunKontrol();
  if (d.bitis !== null && d.bitis <= b.simdi()) { d = odakAdimi(d, { tur: 'bitti' }, b.simdi()); kaydet(); }
  kur();

  return {
    durum() { gunKontrol(); return d; },
    adim(o) {
      gunKontrol();
      d = odakAdimi(d, o, b.simdi());
      kaydet();
      kur();
      b.duyur(d);
      return d;
    },
    uyandi() {
      gunKontrol();
      if (d.bitis !== null && d.bitis <= b.simdi()) bitir(true);
      else kur();
    },
    kapat: durdur,
  };
}

// ── Gerçek bağlayıcılar ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Sayım bitince (0.14 son inceleme I4: Odak kullanıcının kendi zamanlayıcısıdır, sistem uyarısı değil — shared/sistem-uyarilari.ts odakBittiYolu):
 *   · çentik kapalı / 1 saat gizli: bugünkü gibi hiçbir şey (hap ve zil yok);
 *   · ana pencere önde: uygulama içi tost (`tost`; zili tostla birlikte ana pencerenin arayüzü çalar: AdaTost.tsx);
 *   · çentiğin ekranında tam ekran: kuyrukta bekler (`beklet`); tam ekran bitince — olayla, yoklamasız (ada.ts tamEkranOlayi) — yeniden karar verilir
 *     (onayın kuyrukta beklemesi gibi);
 *   · değilse hap; zil YALNIZ hap gerçekten gösterildiyse çalar (`hap` false dönerse — pencere yok, başka iş — zil de yok).
 */
export function odakBittiBagi(b: {
  yol: () => OdakBittiYolu; hap: (u: SistemUyarisi) => boolean; tost: (u: SistemUyarisi) => void; zil: () => void; beklet: (tekrar: () => void) => void;
}): (u: SistemUyarisi) => void {
  const dene = (u: SistemUyarisi): void => {
    const y = b.yol();
    if (y === 'yok') return;
    if (y === 'tost') { b.tost(u); return; }
    if (y === 'bekle') { b.beklet(() => dene(u)); return; }
    if (b.hap(u)) b.zil();
  };
  return dene;
}

let tekil: OdakYoneticisi | null = null;
/** Sürecin tek zamanlayıcısı (ilk kullanımda yüklenir; vt hazır olmalı). */
export function odakYoneticisi(): OdakYoneticisi {
  tekil ??= odakYoneticisiKur({
    simdi: () => Date.now(),
    gun: () => yerelGun(new Date()),
    oku: () => meta(ODAK_KAYIT_ANAHTARI),
    yaz: (k) => metaYaz(ODAK_KAYIT_ANAHTARI, k),
    zamanla: (f, ms) => { const z = setTimeout(f, ms); z.unref?.(); return z; },
    iptal: (z) => clearTimeout(z as NodeJS.Timeout),
    duyur: (d) => adayaGonder('odak:durum', d),
    bitti: odakBittiBagi({ yol: adaOdakYolu, hap: adaUyari, tost: adaOdakTost, zil: () => adayaGonder('ada:odak-zil', {}), beklet: adaOdakBeklet }),
  });
  return tekil;
}

/** Açılışta: kayıtlı sayımı yükler (kapalıyken bittiyse sayar, sürüyorsa zamanlayıcıyı kurar) ve uyku/ekran kilidi dönüşünü dinler. */
export function odakKur(): void {
  const y = odakYoneticisi();
  powerMonitor.on('resume', () => y.uyandi());
  powerMonitor.on('unlock-screen', () => y.uyandi());
}
