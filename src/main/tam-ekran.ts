// ── Tam ekran mı? Çentik film/sunum/oyunda inmesin diye (kural: src/shared/ada.ts `insinMi`) ─────────────────────────────────────────
// 0.14 T22: soru yok, son bilinen durum. Olay yardımcısı (resources/bin/fuber-olay.exe; main/olay-yardimcisi.ts) ön pencere kendi ekranını tam
// kapladığında ya da bıraktığında `tam-ekran` olayı yazar ({ acik, ekran }: o ekranın FİZİKSEL piksel kutusu). Yalnız ÇENTİĞİN ekranındaki tam ekran
// sayılır (Review Focus 2): başka ekranda film açıkken çentik yerinde kalır. Yardımcı yoksa, çöktüyse ya da durduysa hâl boştur → "tam ekran yok" (çentik
// eskisi gibi iner; hatırlatıcı yutulmaz). Değişiklik dinleyicilere olayla gider (`tamEkranDinle`): kuyruk ve boştaki çentik yoklamasız yeniden değerlendirilir.
// Fare/klavye yardımcısı (fuber-girdi.exe) bunun için ASLA açılmaz: o yalnız bilgisayar kontrolünde başlar.
// macOS ve diğerleri: yardımcı yok → false (macOS'ta tam ekran Space'leri çentik penceresini `visibleOnFullScreen: false` ile zaten dışarıda bırakır).
import type { Rectangle } from 'electron';
import { sistemDurumu, sistemOlayiDinle } from './olay-yardimcisi.ts';
import type { SistemDurumu } from '../shared/sistem-olay.ts';

/** Kutuların yuvarlama payı (fiziksel px; DPI dönüşümü 1 px kaydırabilir). */
const PAY = 2;

/**
 * Yardımcının tam ekranı çentiğin ekranında mı? `o.ekran` fiziksel px; `centikEkrani` aynı birimde `olcek` ile çarpılınca fiziksel olan kutu (ana süreç
 * Windows'ta zaten fizikselleştirip 1 verir; yoksa ekranın DIP kutusu ve scaleFactor). Boy ±2 px tutmalı ve tam ekran kutusunun ortası o ekranda olmalı.
 */
export function tamEkranCentikte(o: { acik: boolean; ekran: { x: number; y: number; en: number; boy: number } }, centikEkrani: Rectangle, olcek: number): boolean {
  if (!o.acik) return false;
  const s = Number.isFinite(olcek) && olcek > 0 ? olcek : 1;
  const k = { x: centikEkrani.x * s, y: centikEkrani.y * s, en: centikEkrani.width * s, boy: centikEkrani.height * s };
  if (Math.abs(o.ekran.en - k.en) > PAY || Math.abs(o.ekran.boy - k.boy) > PAY) return false;
  const ox = o.ekran.x + o.ekran.en / 2, oy = o.ekran.y + o.ekran.boy / 2;
  return ox >= k.x - PAY && ox <= k.x + k.en + PAY && oy >= k.y - PAY && oy <= k.y + k.boy + PAY;
}

/**
 * Tam ekran kararının bakacağı ekran (düzeltme turu 1, Important 1): çentiğin İNECEĞİ ekran. Görünür çentik yerinde kalıyorsa (`inecek` değil) durduğu ekran;
 * gizliyse ya da şimdi gösterilecekse (gösterim çentiği imlecin ekranına taşır: ada.ts konumla) imlecin ekranı. İmleç yalnız gerektiğinde, o an bir kez okunur.
 */
export function centikHedefEkrani<T>(k: { gorunur: boolean; inecek: boolean; son: T | null; imlec: () => T }): T {
  return k.gorunur && !k.inecek && k.son !== null ? k.son : k.imlec();
}

/** Çentiğin ekranının kutusu ve `kutu × olcek` = fiziksel px (ana süreç ada.ts centikKutusu: Windows'ta Electron'un dipToScreenRect'iyle fizikselleştirip
 *  ölçek 1 verir — çok ekranlı, karışık ölçekli düzende DIP kutusu bölmeyle çevrilemez). */
export interface CentikEkrani { kutu: Rectangle; olcek: number }

/** Test kancası, YALNIZ FUBER_DEMO: FUBER_TEST_TAM_EKRAN '1' → tam ekran, '0' → değil; tanımsızsa yardımcının son bilinen hâli. */
function sahteTamEkran(): boolean | null {
  const s = process.env.FUBER_DEMO ? process.env.FUBER_TEST_TAM_EKRAN : undefined;
  return s === '1' || s === '0' ? s === '1' : null;
}

/** Çentiğin ekranında tam ekran var mı — son bilinen hâlden, soru sormadan. */
export function tamEkranMi(ekran: CentikEkrani | null): boolean {
  const sahte = sahteTamEkran();
  if (sahte !== null) return sahte;
  return tamEkranHalinden(sistemDurumu().tamEkran, ekran);
}

function tamEkranHalinden(t: SistemDurumu['tamEkran'], ekran: CentikEkrani | null): boolean {
  return Boolean(t && t.acik && ekran) && tamEkranCentikte(t!, ekran!.kutu, ekran!.olcek);
}

const dinleyiciler = new Set<() => void>();
let abone = false;

/** Tam ekran bilgisi değişmiş olabilir (yardımcının tam ekran ya da durum olayı, çöküşü, test kancası): dinleyici kendi ekranıyla yeniden sorar. */
export function tamEkranDinle(f: () => void): () => void {
  dinleyiciler.add(f);
  if (!abone) {
    abone = true;
    sistemOlayiDinle((o) => { if (o.t === 'tam-ekran' || o.t === 'durum') yay(); });
  }
  return () => { dinleyiciler.delete(f); };
}

function yay(): void { for (const f of [...dinleyiciler]) f(); }

/** YALNIZ FUBER_DEMO (ada:test-tam-ekran): sabit tam ekran kancasını değiştirir ve dinleyicilere olay gibi bildirir (yoklama beklenmez). */
export function tamEkranTestAyarla(acik: boolean | null): void {
  if (!process.env.FUBER_DEMO) return;
  if (acik === null) delete process.env.FUBER_TEST_TAM_EKRAN; else process.env.FUBER_TEST_TAM_EKRAN = acik ? '1' : '0';
  yay();
}
