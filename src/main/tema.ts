// ── Tema (ana süreç) ─────────────────────────────────────────────────────────────────────────────────────────
// Açık tema da var. Ayarlar → Görünüm: Koyu | Açık | Şeffaf | Otomatik ('sistem': Windows'un teması).
// nativeTheme.themeSource ayara eşitlenir: arayüzdeki `prefers-color-scheme` böylece İLK karede doğru temayı verir
// (açılışta siyah/beyaz parlama yok), "Otomatik" de Windows'u canlı izler. Şeffaf koyu ailedendir (themeSource 'dark').
// Etkin tema (koyu | açık | cam) burada çözülür (shared/tema-cozum.ts: cam desteklenmiyorsa Koyu'ya düşer) ve her değişimde 'tema:degisti' ile
// bütün pencerelere yayınlanır; arayüz `data-tema`yı buna göre kurar.
// Ana pencerenin zemini temaya uyar; camda zemin saydamdır ve pencereye sistem malzemesi uygulanır (Windows 11: acrylic · macOS: vibrancy).
// 0.12 H3a — kurulum sihirbazı yarı şeffaf, bozuk bir ekran olarak açılıyordu: tema topyekûn kaldırılmıştı. 0.13 T13 —
// Şeffaf tema geri geldi, ama KURULUM, TEKRAR HOŞ GELDİN ve AÇILIŞ her durumda opaktır: kurulum ya da Tekrar hoş geldin
// görünürken (`opakSahne`; arayüz 'tema:sahne' ile bildirir, ilk kurulumda baştan açık) pencere malzemesi 'none', zemini opak koyudur — tema
// camda kalsa bile (shared/tema-cozum.ts pencereMalzemesi / pencereZeminiBul; sayfa tarafı tasarim.css). Açılış örtüsü sayfada opaktır.
// Renkler tasarim.css'teki --bg ile aynı olmalı. Başlık düğmelerini arayüz çizer (Görev 22; renderer/pencere/pencere.css).
import os from 'node:os';
import { app, BrowserWindow, nativeTheme } from 'electron';
import { ayarlar, ayarDinle } from './ayarlar.js';
import { yayinla } from './olaylar.js';
import { camDestekli, etkinTemaBul, pencereMalzemesi, pencereZeminiBul, temaGocu, type EtkinTema } from '../shared/tema-cozum.js';
import type { Tema } from '../shared/tipler.js';

/** Bu bilgisayarda Şeffaf var mı (Windows 11 22H2+ / macOS)? Süreç boyunca değişmez. */
const CAM_DESTEKLI = camDestekli(process.platform, os.release());

const temaAyari = (): Tema => temaGocu(ayarlar().gorunum?.tema);
// Şeffaf da koyu aileden: nativeTheme koyu kalır (sistem açıkken bile sistem malzemesi koyu boyansın).
const kaynak = (t: Tema): 'dark' | 'light' | 'system' => (t === 'acik' ? 'light' : t === 'sistem' ? 'system' : 'dark');

/** Kurulum ya da Tekrar hoş geldin ekranı açık mı? İlk kurulumda (kurulum bitmemiş) pencere daha oluşmadan açıktır. */
let opakSahne = false;
export const opakSahneMi = (): boolean => opakSahne;

/** Şu an etkin tema ("Otomatik" → Windows'un o anki teması; cam desteklenmiyorsa koyu). */
export const etkinTema = (): EtkinTema => etkinTemaBul(temaAyari(), nativeTheme.shouldUseDarkColors, CAM_DESTEKLI);
export const camVarMi = (): boolean => CAM_DESTEKLI;
/** Pencere oluşturulurken: boş kare (sayfa yüklenmeden) bu renkte görünür (camda saydam; kurulumda opak). */
export const pencereZemini = (): string => pencereZeminiBul(etkinTema(), opakSahne);
/** Zemin ve sistem malzemesi etkin temaya (ve kurulumun açık olup olmadığına) uyar; camdan çıkınca malzeme kaldırılır. Ana pencere ve Fuber
 *  Tarayıcı (tarayici.ts 'tema:degisti' olayında yeniden) kullanır; kurulum bayrağı yalnız ana pencere içindir (`opak`). */
export function pencereyeUygula(w: BrowserWindow, opak = false): void {
  const t = etkinTema();
  const malzeme = pencereMalzemesi(process.platform, t, opak);
  // Malzeme ÖNCE: setBackgroundMaterial pencere zeminini kendi değerine sıfırlar ('none' → beyaz), zemin sonra yazılır.
  if (CAM_DESTEKLI) {
    if (process.platform === 'win32') w.setBackgroundMaterial(malzeme === 'acrylic' ? 'acrylic' : 'none');
    else if (process.platform === 'darwin') w.setVibrancy(malzeme === 'under-window' ? 'under-window' : null);
  }
  w.setBackgroundColor(pencereZeminiBul(t, opak));
}

/** Pencereler oluşturulmadan ÖNCE çağrılır (themeSource ilk karede geçerli olsun). */
export function temaKur(anaPencere: () => BrowserWindow | null): void {
  let secim: Tema | null = null;
  let son: EtkinTema | null = null;
  opakSahne = !ayarlar().kurulumTamam;
  const anayaUygula = () => {
    const w = anaPencere();
    if (w && !w.isDestroyed()) pencereyeUygula(w, opakSahne);
  };
  // Arayüz kurulum / Tekrar hoş geldin açıldığında ya da kapandığında bildirir ('tema:sahne'): malzeme ve zemin anında değişir.
  sahneDegisti = (opak) => { if (opak === opakSahne) return; opakSahne = opak; anayaUygula(); };
  // Etkin tema değiştiyse pencere ve arayüz güncellenir ("Otomatik"te Windows teması değişince de buradan geçer).
  const guncelle = () => {
    const yeni = etkinTema();
    if (yeni === son) return;
    son = yeni;
    anayaUygula();
    yayinla('tema:degisti', { tema: yeni });
  };
  const uygula = () => {
    const t = temaAyari();
    if (t !== secim) { secim = t; nativeTheme.themeSource = kaynak(t); }
    guncelle();
  };
  uygula();
  ayarDinle(uygula);
  nativeTheme.on('updated', guncelle);
  // Ana pencere temaKur'dan SONRA (ya da kapandıktan sonra yeniden) oluşur: sistem malzemesi ona da uygulansın.
  // `ana` değişkeni yapıcı döndükten sonra atanır; bu yüzden bir sonraki turda bakılır.
  app.on('browser-window-created', (_e, w) => {
    setImmediate(() => { if (!w.isDestroyed() && w === anaPencere()) pencereyeUygula(w, opakSahne); });
  });
}

let sahneDegisti: (opak: boolean) => void = () => undefined;
/** Arayüz (kurulum / Tekrar hoş geldin) açıkken `true`, kapanınca `false` bildirir; ipc.ts 'tema:sahne'. */
export const opakSahneKur = (opak: boolean): void => sahneDegisti(opak === true);
