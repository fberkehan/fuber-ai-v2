// ── Ada: üst ortadan inen çentik (Dynamic Island benzeri) — pencere ve arayüzden bağımsız saf mantık ──────────────
// Eski sağ alt asistanın yerini alır. Ana süreç (ada penceresi) ve arayüz (Ada.tsx) AYNI kuralları buradan okur:
//  1. Hal: adanın o an hangi biçimde durduğu. Birden çok şey aynı anda doğru olabilir (yanıt var + bildirim var);
//     `adaHaliBul` sabit bir öncelikle tek hal seçer, onay hiçbir şeyle ezilmez.
//  2. Ölçü: her halin CSS px boyutu. Pencere sabit bir kutudur (ADA_PENCERE); ada kutunun üst ortasında büyür/küçülür,
//     kutunun dışı tıklamayı alttaki uygulamaya geçirir. Boy 'icerik' ise içeriğe göre uzar (en çok 440 px, sonra içi kayar).
//  3. Tam ekran: film/sunumda ada inmez. İstisna: hatırlatıcı ve kullanıcının kendi açtığı ada (kısayol, "Hey Fuber").
//  4. Kuyruk: inemeyen ya da başka olayla meşgulken gelen olaylar kaybolmaz; onay > hatırlatma > kullanıcı > Fuber
//     sırasıyla, aynı öncelikte ilk gelen önce çıkar. Bayatlayan olay (yanıtlanmış onay, 30 dk'dan eski Fuber mesajı) düşer.
//  5. Yol (K4, K5): uygulama öndeyken (ana pencere odaklı ve görünür) ada inmez — hatırlatma/mesaj ana pencerede tost olur,
//     onay kuyrukta bekler; ada kapalı ya da 1 saat gizliyken hiçbir şey adaya inmez — hatırlatma ve onay Windows bildirimi
//     olur. Kullanıcının kendi çağrısı (kısayol, "Hey Fuber") her koşulda iner.
//  6. Çentiği yalnız üç şey açar (0.13): kullanıcının kendi çağrısı, zamanı gelen hatırlatıcı, onay isteği. Fuber'in kendi sözü adayı açmaz
//     (`adaYolu` 'nokta'): sessiz çentikte küçük bir nokta belirir, üzerine gelince mesaj görünür. 0.14 T23: imleç boştaki çentikte (dinlenme, Kapalı) durunca
//     açık panel ('panel', 560×188; sayfalar shared/centik-sayfalar.ts) açılır; tıklama paneli Asistan sayfasıyla sabitler (gözler selam verir, yazı alanı odakta).
// Electron/DOM yok (hem ana süreç hem arayüz içe aktarır): tests/ada.test.ts doğrudan sınar.

import { motorEngelliMi, motorHapiVarMi, type MotorGorunumu } from './motor-durumu.ts';
import { TERIM } from './terimler.ts';
import type { SistemUyarisi } from './sistem-uyarilari.ts';

/** Adanın biçimi. Ölçüleri `adaOlcusu` verir. 0.14 T19 (R13): 'dinlenme' boştaki çentiktir (karakterin yüzü bakar); 'sessiz' artık Kapalı haptır
 *  (boşta ama medya çalıyor ya da Fuber'in mesaj noktası var: saat ve sağda simge). */
export type AdaHal =
  | 'dinlenme' | 'sessiz' | 'panel' | 'bildirim' | 'kart' | 'sor' | 'dinliyor' | 'dusunuyor' | 'yanit' | 'onay' | 'ekranda' | 'motor-durdu' | 'motor-hap' | 'gorev' | 'uyari'
  /** İş izi (11 Kas): iş hapının üstüne gelince açılan liste — en çok 3 satır (durum işareti, fiil, yer); satıra tıklayınca o yere gidilir. */
  | 'isler';

/** İmleç boştaki çentikte bu kadar durunca panel açılır (ekranın üst kenarından geçen imleç çentiği oynatmasın; R13). 0.14 çentik cilası (5 Kas): 120 → 60 ms —
 *  panel çok geç tetikleniyordu; ilk karede CSS :hover şişmesi tepki verir, panelin içeriği 60 + 50 ms'de girmeye başlar (R13'ün 120 ms bütçesi içinde). */
export const HOVER_GECIKME_MS = 60;
/** İmleç çıkınca noktadaki mesaj bu kadar sonra kalkar (kenarda bir an kayan imleç titretmesin). Yalnız görünümün gecikmesidir: tıklama yakalama beklemez. */
export const HOVER_CIKIS_MS = 80;
/** 0.14 T23 (R13): imleç çıkınca açık panel bu kadar sonra kapanır (panelde yazı alanı odaktaysa kapanmaz: panelKapanirMi). */
export const PANEL_KAPANIS_MS = 300;

/** Açık paneli kapatabilen olaylar: imleç çıktı (PANEL_KAPANIS_MS sonunda), pencere odağı gitti, ekran değişti (Review Focus 1, B28), Alt+Shift+Q, Esc. */
export type PanelOlayi = 'cikis' | 'odak-kaybi' | 'ekran' | 'acil' | 'esc';
/** Panel bu olayla kapanır mı? Yalnız imlecin çıkışı yazı alanı odaktayken paneli tutar (kullanıcı yazıyor); öbürleri her zaman kapatır — ekran olayında kutu yer
 *  ve ölçek değiştirdi (`mouseleave` gelmeyebilir), odak kaybında kullanıcı başka yere geçti. */
export function panelKapanirMi(o: PanelOlayi, d: { yaziOdakta: boolean }): boolean {
  return o === 'cikis' ? !d.yaziOdakta : true;
}
/** Tıklamanın sonucu (R13): gözler selam verir (`tetik`; gözün kendi pointerdown'u değil — çentik penceresi tıklamayı yutabilir), panel Asistan
 *  sayfasıyla açılır, yazı alanı odakta. Sade modda selam yok (göz yok), gerisi aynı. */
export const PANEL_TIKLAMA = { sayfa: 'asistan', tetik: 'selam', odak: 'yazi' } as const;
/** T23 düzeltme turu 1: tıklama bu kadar tazeyse Asistan sayfasındaki gözler selam verir. Tıklama paneli de açtığı için sayfa çoğu kez tıklamayla AYNI anda takılır;
 *  gözün hareket beyni takılmadaki tetik numarasını görülmüş sayar (oynatmaz). Sayfa bu yüzden tetiği takıldıktan sonra verir — ama yalnız taze tıklamada:
 *  hover’la sonradan takılan sayfa eski tıklamanın selamını oynatmaz. */
export const PANEL_TIKLAMA_TAZE_MS = 300;
export const tiklamaTazeMi = (s: { no: number; an: number }, simdi: number): boolean => s.no > 0 && simdi - s.an <= PANEL_TIKLAMA_TAZE_MS;

/** Selam cümlesi dört dilde (0.13); arayüzün geri kalanı henüz Türkçe olduğundan bilinmeyen dil Türkçeye düşer. `dil`: BCP 47 etiketi (navigator.language). */
const SELAM_METINLERI = { tr: 'Nasıl yardımcı olabilirim?', en: 'How can I help?', de: 'Wie kann ich helfen?', fr: 'Comment puis-je vous aider ?' } as const;
export const selamMetni = (dil: string | undefined): string => {
  const kisa = (dil ?? '').slice(0, 2).toLowerCase();
  return kisa === 'en' || kisa === 'de' || kisa === 'fr' ? SELAM_METINLERI[kisa] : SELAM_METINLERI.tr;
};

/** Boştaki hapın kısa metni (A2; 0.10 Görev 2): yalnız çalışan bağlantı kopunca (durdu) — kırmızı nokta + bu yazı; ayrıntı tam kartta.
 *  Hap metni shared/motor-durumu.ts motorBildirimi'nin `kisa`sından (hesap kapalıyken ve kullanım hakkı dolunca da). */
export const MOTOR_HAP_METNI = 'Bağlantı koptu';

/** Ada penceresinin sabit kutusu (CSS px, ölçek 1). Ada bunun içinde üst ortada durur; yalnız şekli tıklamayı tutar. 0.14 R15: kutu ölçekle
 *  büyür (centikOlcegi; main/ada-konum.ts); açık panel en çok 440 yüksek, omuzlar ve gölgeyle kutuya sığar. */
export const ADA_PENCERE = { en: 720, boy: 460 };

/** Çentiğin ölçeği (R15): ekranın DIP eni < 1700 → 1; < 2400 → 1,12; değilse 1,25. DIP eni Windows'un ölçeğini zaten içerir (%150'deki 2880 px'lik
 *  ekran 1920 DIP'tir): çentik ekranın görünen boyuna göre büyür. */
export function centikOlcegi(dipEn: number): number {
  return dipEn < 1700 ? 1 : dipEn < 2400 ? 1.12 : 1.25;
}

const OLCULER: Record<AdaHal, { en: number; boy: number | 'icerik' }> = {
  // 0.14 T19 (R13): boşta; karakterin yüzü (40 px) çentikten bakar, alt yarısı kırpılı.
  dinlenme: { en: 132, boy: 30 },
  // 0.14 T19: Kapalı hap — boşta ama medya çalıyor ya da Fuber'in mesaj noktası var: solda saat, sağda simge.
  sessiz: { en: 200, boy: 32 },
  // 0.14 T23: açık panel — üst satır (sayfa adı, tarih ve saat, medya), sayfa gövdesi, altta noktalar. Kutuya (720×460) omuz ve gölgeyle sığar.
  panel: { en: 560, boy: 188 },
  bildirim: { en: 360, boy: 44 },
  ekranda: { en: 340, boy: 36 },
  // Motor durdu kartı (önizleme gerçeği + iki düğme; Ruling O / K1): içerik boyunda, en geniş halin eni. Yalnız kısayolla (soru kutusu),
  // hapın üstüne gelince ya da tıklayınca açılır (0.13: kendiliğinden hiç inmez).
  'motor-durdu': { en: 440, boy: 'icerik' },
  // A2 (son düzeltme): boşta + bağlantı koptu = küçük hap (boştaki adanın boyu; "● Kullanım hakkın doldu" sığsın diye biraz geniş): 440 px
  // kart her uygulamanın üstünde ve her Alt+Tab'de yeniden inmesin. 0.10 Görev 2: hiç bağlanmamışken hap YOK (ada normal sessiz).
  'motor-hap': { en: 204, boy: 32 },
  dinliyor: { en: 380, boy: 64 },
  dusunuyor: { en: 300, boy: 44 },
  sor: { en: 440, boy: 56 },
  kart: { en: 440, boy: 'icerik' },
  yanit: { en: 440, boy: 'icerik' },
  onay: { en: 440, boy: 'icerik' },
  // 0.11 G10 (spec §8): bir görev adımı çalışırken ya da görev ekranı tutarken küçük hap "Görev: <başlık>" + Durdur.
  gorev: { en: 400, boy: 44 },
  // İş izi (11 Kas): iş hapının açık hâli — üstte hap satırı, altında en çok 3 iş satırı (içerik boyunda).
  isler: { en: 440, boy: 'icerik' },
  // 0.14 T22: sistem uyarı hapı (kulaklık, şarj, ses/parlaklık bindirmesi, Caps Lock, dil, internet; shared/sistem-uyarilari.ts): simge + metin (+ düzey çubuğu).
  uyari: { en: 300, boy: 36 },
};

/** Görev hapının yazısı: "Görev: <başlık>" (başlık boşsa yalnız "Görev"); sözcük tek sözlükten (shared/terimler.ts TERIM.gorev). */
export function gorevHapMetni(baslik: string): string {
  const b = baslik.replace(/\s+/g, ' ').trim();
  return b ? `${TERIM.gorev}: ${b}` : TERIM.gorev;
}

// ── Görev hapı: fare yakalama ve pencerenin yaşam döngüsü (0.11 G10 düzeltme turu 1; src/main/ada.ts bunu uygular, tests/ada.test.ts sıralı olay dizisiyle sınar) ──
// Gerçek sıra: Durdur tıklanır → görev durur → `isler:durum` (adım yok) → `ada:gorev` null (hap altından kalkar; `mouseleave` hiç gelmez) → bilgisayar kontrolü
// 1,2–4 sn SONRA biter (imlec.ts kontrolBitirSonra) → `ada:kontrol` false. Kurallar:
//  · Yakalama: imleç şekilde ve Fuber ekranı kullanmıyorken; kontrol sürerken yalnız Durdur düğmesinin üstünde (Durdur her zaman tıklanır).
//  · Hap kalkınca "Durdur üstünde" bayrağı düşer; hap için açılan pencere, kontrol SÜRÜYORSA kontrol bitince, sürmüyorsa hemen kapanır.
//  · Kontrol bitince: yalnız kontrol için açılan pencere ya da (adım bitmişse) hap için açılan pencere kapanır; adım sürüyorsa hap kalır ve adım bitince kapanır.
//  · Pencere kapanınca (adaGizle) imleç bayrakları da sıfırlanır.
export interface AdaYasami {
  /** İmleç adanın şeklinin üstünde (arayüz bildirir). */
  fareUzerinde: boolean;
  /** İmleç görev hapındaki Durdur düğmesinin üstünde (fareUzerinde'nin alt durumu). */
  durdurUzerinde: boolean;
  /** Fuber fareyi/klavyeyi kullanıyor. */
  kontrolde: boolean;
  /** Bir görev adımı çalışıyor (hap görünür). */
  gorevde: boolean;
  /** Pencere yalnız görev hapı için açıldı. */
  gorevAcmisti: boolean;
  /** Pencere yalnız ekran kontrolü için açıldı. */
  kontrolAcmisti: boolean;
}
export const ADA_YASAM_ILK: AdaYasami = { fareUzerinde: false, durdurUzerinde: false, kontrolde: false, gorevde: false, gorevAcmisti: false, kontrolAcmisti: false };
export type AdaYasamOlayi =
  /** `gorunur` (ana süreç `canli().isVisible()` ile doldurur; verilmezse görünür sayılır): pencere görünür değilken gelen "imleç üstünde" bayattır — bkz. adaYasamAdimi. */
  | { tur: 'fare'; uzerinde: boolean; durdur: boolean; gorunur?: boolean }
  | { tur: 'gorev'; var: boolean }
  | { tur: 'kontrol'; acik: boolean }
  /** 0.14 T19 (Review Focus 1): ekran eklendi, söküldü ya da ölçeği değişti; çentik yeniden kuruldu. İmleç artık şeklin üstünde sayılmaz (kutu yer ve ölçü
   *  değiştirdi, `mouseleave` gelmeyebilir): yakalama ve Durdur bayrağı düşer. Pencere kapanmaz; görev ve kontrol bayrakları sürer. */
  | { tur: 'ekran' };

/** Ada penceresi tıklamayı şimdi yakalamalı mı (aksi hâlde tıklama alttaki uygulamaya geçer). */
export const fareYakalansinMi = (d: Pick<AdaYasami, 'fareUzerinde' | 'durdurUzerinde' | 'kontrolde'>): boolean => d.fareUzerinde && (!d.kontrolde || d.durdurUzerinde);

/**
 * Görev hapındaki Durdur düğmesi yalnız 'gorev' halinde çizilir. Hal başka bir şeye geçtiyse (onay/bildirim hapı onu ezdi) düğme `mouseleave` HİÇ gelmeden
 * sökülmüştür: imleç artık onun üstünde değildir — arayüz "Durdur üstünde" bayrağını düşürür ve ana sürece `ada:fare(uzerinde, false)` yollar (G10 düzeltme turu 2).
 */
export const durdurSokuldu = (hal: AdaHal, durdurUstunde: boolean): boolean => durdurUstunde && hal !== 'gorev' && hal !== 'isler';

/** Bir olayın ardından yeni durum ve pencerenin kapanıp kapanmayacağı (`gizle`: ana süreç adaGizle çağırır; bayraklar zaten sıfırlanmış gelir). */
export function adaYasamAdimi(d: AdaYasami, o: AdaYasamOlayi): { durum: AdaYasami; gizle: boolean } {
  const kapan = (x: AdaYasami): { durum: AdaYasami; gizle: boolean } => ({ durum: { ...x, fareUzerinde: false, durdurUzerinde: false, gorevAcmisti: false, kontrolAcmisti: false }, gizle: true });
  switch (o.tur) {
    case 'fare': {
      // Görünür olmayan pencerede "imleç üstünde" (true) yok sayılır (G10 düzeltme turu 2, N1): arayüzün gecikmiş yanıtı (hap altından kalkarken `ada:fare(true, false)`)
      // ana süreç pencereyi kapatıp bayrakları sıfırladıktan SONRA gelirse yakalamayı yeniden kurmasın — sonraki gösterimde 480×480 şeffaf kutu tıklama yutardı.
      // "Çıktı" (false) her zaman işlenir.
      const uz = o.uzerinde && o.gorunur !== false;
      return { durum: { ...d, fareUzerinde: uz, durdurUzerinde: uz && o.durdur }, gizle: false };
    }
    case 'gorev': {
      const x = { ...d, gorevde: o.var, durdurUzerinde: o.var ? d.durdurUzerinde : false };
      return !o.var && d.gorevAcmisti && !d.kontrolde ? kapan(x) : { durum: x, gizle: false };
    }
    case 'kontrol': {
      const x = { ...d, kontrolde: o.acik };
      return !o.acik && (d.kontrolAcmisti || (d.gorevAcmisti && !d.gorevde)) ? kapan(x) : { durum: x, gizle: false };
    }
    case 'ekran':
      return { durum: { ...d, fareUzerinde: false, durdurUzerinde: false }, gizle: false };
  }
}

/** Halin ölçüsü (CSS px; `olcek` verilirse çarpılıp yuvarlanır, R15). Dönen nesne kopyadır: çağıran değiştirse de tablo bozulmaz. Arayüz ölçeği kökte
 *  CSS `zoom` ile uyguladığı için tabanı (ölçek 1) okur; ölçekli değer pencere kutusu ve ekran denetimleri (ada-onizle) içindir. */
export function adaOlcusu(h: AdaHal, olcek = 1): { en: number; boy: number | 'icerik' } {
  const o = OLCULER[h];
  return { en: Math.round(o.en * olcek), boy: o.boy === 'icerik' ? 'icerik' : Math.round(o.boy * olcek) };
}

// ── Tam ekran kuralı ───────────────────────────────────────────────────────────────────────────────────────────
/** Olayı kim başlattı: kullanıcı (kısayol, "Hey Fuber"), hatırlatıcı, onay isteği ya da Fuber'in kendi bildirimi. */
export type AdaKaynak = 'kullanici' | 'hatirlatma' | 'onay' | 'fuber';

/** `asistan:soyle`nin kaynağı: yalnız kullanıcının kendi seslenmesi ('dinlendi') açar. Eşlikçinin `hatirlatma`sı modelin seçtiği bir sınıftır, zamanı gelen hatırlatıcı
 *  değil: Fuber'in sözüdür (gerçek hatırlatıcı yalnız asistan:bildir'den gelir). */
export const soyleKaynagi = (tur: string): AdaKaynak => (tur === 'dinlendi' ? 'kullanici' : 'fuber');

/** Ada şimdi inebilir mi? Tam ekranda yalnız kullanıcının kendi açtığı ve hatırlatıcı iner; gerisi bekler. */
export function insinMi(kaynak: AdaKaynak, tamEkran: boolean): boolean {
  return !tamEkran || kaynak === 'kullanici' || kaynak === 'hatirlatma';
}

/**
 * Görev hapı için ada KENDİLİĞİNDEN insin mi (0.11 son inceleme küçük 1; src/main/ada.ts gorevdeAc)? Uygulama öndeyken (K4: kokpitteki Görevler
 * kartı zaten görünür), ada kapalı/gizliyken (K5) ve tam ekranda (Fuber'in kendi işi: insinMi 'fuber') hayır. Sessiz saatte ya da "Rahatsız
 * etme"de (`sessiz`; main/zamanlayici.ts sessizMi — görevin bildirim satırları da ona uyar) de hayır: 30 sn'lik bir görev geceyi adayı indirip
 * kaldırarak geçirmesin. TEK istisna ekranı tutan adım (`ekran`: görevin ekran izni var, adım boyunca ekran onundur) — Fuber ekranı
 * kullanırken hap ve Durdur her zaman ulaşılabilir kalır.
 */
export function gorevHapiInsinMi(o: { anaOnde: boolean; kapali: boolean; tamEkran: boolean; sessiz: boolean; ekran: boolean }): boolean {
  if (o.anaOnde || o.kapali || !insinMi('fuber', o.tamEkran)) return false;
  return !o.sessiz || o.ekran;
}

// ── Öncelikli kuyruk ───────────────────────────────────────────────────────────────────────────────────────────
export interface AdaOlayi {
  kaynak: AdaKaynak;
  /** Arayüze gidecek IPC kanalı (ör. 'ada:bildirim'). */
  kanal: string;
  veri: unknown;
  /** Olayın oluştuğu an (ms). Sırayı belirlemez; sıra geliş sırasıdır. */
  zaman: number;
  /** Teslim anında olay hâlâ geçerli mi (ör. onay hâlâ yanıt bekliyor mu)? Verilmezse geçerli sayılır. */
  gecerli?: () => boolean;
}

/** Kuyrukta bu süreden uzun bekleyen Fuber olayı bayattır (uzun bir filmden sonra eski gevezelik); teslim edilmez. */
export const FUBER_OLAYI_OMRU_MS = 30 * 60_000;

/**
 * Kuyruktan çıkan olay şimdi teslim edilmeli mi? Bayatlayan olay düşer: 30 dakikadan eski Fuber olayı, yanıtlanmış/süresi
 * dolmuş onay (`gecerli` false döner; yoksa ölü kart arayüzde en öncelikli hal olarak takılır). Hatırlatma ve kullanıcı olayı
 * zaten kuyruğa girmez. `simdi` dışarıdan verilir (saat enjekte edilebilsin).
 */
export function olayGecerliMi(o: AdaOlayi, simdi: number): boolean {
  if (o.kaynak === 'fuber' && !sessizMesajTaze(o.zaman, simdi)) return false;
  return o.gecerli ? o.gecerli() : true;
}

/** Fuber'in sözü taze mi: kuyrukta da noktada da aynı ömür; süresi dolan söz adada düşer (mesaj sohbette kalır). */
export const sessizMesajTaze = (zaman: number, simdi: number): boolean => simdi - zaman <= FUBER_OLAYI_OMRU_MS;

/** Küçük sayı = önce çıkar. Onay başka bildirimle ezilmesin; hatırlatıcı mesajdan önce gelsin. */
const ONCELIK: Record<AdaKaynak, number> = { onay: 0, hatirlatma: 1, kullanici: 2, fuber: 3 };

export class AdaKuyrugu {
  private bekleyen: AdaOlayi[] = [];

  ekle(o: AdaOlayi): void {
    this.bekleyen.push(o);
  }

  /**
   * Şimdi inebilecek en öncelikli olayı kuyruktan çıkarıp verir (yoksa undefined). Aynı öncelikte ilk eklenen önce
   * çıkar. Tam ekranda inemeyen olaylar atlanır ama kuyrukta kalır: tam ekran bitince sırayla gelirler. Ana pencere
   * öndeyken (K4) hiçbir şey çıkmaz: hepsi bekler, ana pencere arkaya geçince sırayla gelir.
   */
  al(tamEkran: boolean, anaOnde = false): AdaOlayi | undefined {
    if (anaOnde) return undefined;
    let en = -1;
    for (let i = 0; i < this.bekleyen.length; i++) {
      const o = this.bekleyen[i];
      if (!insinMi(o.kaynak, tamEkran)) continue;
      if (en < 0 || ONCELIK[o.kaynak] < ONCELIK[this.bekleyen[en].kaynak]) en = i;
    }
    return en < 0 ? undefined : this.bekleyen.splice(en, 1)[0];
  }

  get uzunluk(): number {
    return this.bekleyen.length;
  }
}

// ── Yol: ada mı, tost mu, Windows bildirimi mi (K4, K5) ────────────────────────────────────────────────────────
export interface AdaKosulu {
  tamEkran: boolean;
  /** Ana pencere odaklı ve görünür: kullanıcı uygulamanın içinde. */
  anaOnde: boolean;
  /** Ada tamamen kapalı ya da süreli gizli: kendiliğinden hiç inmez. */
  kapali: boolean;
}
export interface AdaYolu {
  /** 'simdi': ada iner; 'nokta': ada İNMEZ, sessiz çentikte nokta belirir (0.13: Fuber'in kendi sözü); 'bekle': kuyrukta bekler (tam ekran / uygulama önde
   *  bitince); 'yok': adaya hiç gitmez. */
  ada: 'simdi' | 'nokta' | 'bekle' | 'yok';
  /** Ana pencerede tost (kullanıcı uygulamanın içinde: hatırlatıcı ve mesaj kaybolmasın). */
  tost: boolean;
  /** Windows bildirimi (ada inmeyecek; kaybolmaması gereken hatırlatma ve onay için). */
  bildirim: boolean;
}

/**
 * Bir olay nereye gider? Sıra: kullanıcının kendi çağrısı her zaman ada · uygulama önde → tost (onay ayrıca kuyrukta bekler,
 * ana pencere arkaya geçince hâlâ yanıt bekliyorsa ada iner; ada kapalıysa beklemez) · ada kapalı/gizli → hatırlatma ve onay
 * Windows bildirimi, Fuber'in kendi sözü düşer (mesaj zaten sohbette) · değilse tam ekran kuralı (`insinMi`); inebilen Fuber sözü adayı açmaz, nokta olur.
 * `yeniden`: adada zaten bekleyen bildirimler için yeniden iniş (ada:goster) — yeni bir mesaj değildir: tost/bildirim olmaz;
 * uygulama öndeyken bekler, ada kapalıyken düşer.
 */
export function adaYolu(kaynak: AdaKaynak, k: AdaKosulu, yeniden = false): AdaYolu {
  const yol = (ada: AdaYolu['ada'], tost = false, bildirim = false): AdaYolu => ({ ada, tost, bildirim });
  const iner = kaynak === 'fuber' ? 'nokta' : 'simdi';
  if (kaynak === 'kullanici') return yol('simdi');
  if (yeniden) return yol(k.kapali ? 'yok' : k.anaOnde || !insinMi(kaynak, k.tamEkran) ? 'bekle' : iner);
  if (k.anaOnde) return yol(kaynak === 'onay' && !k.kapali ? 'bekle' : 'yok', true);
  if (k.kapali) return yol('yok', false, kaynak === 'hatirlatma' || kaynak === 'onay');
  return yol(insinMi(kaynak, k.tamEkran) ? iner : 'bekle');
}

/** Süreli bir durum (1 saat gizle, rahatsız etme) hâlâ sürüyor mu? ISO bitiş; boş, bozuk ya da geçmişse hayır. */
export function sureSuruyor(bitis: string | null | undefined, simdi: number): boolean {
  const t = bitis ? Date.parse(bitis) : NaN;
  return Number.isFinite(t) && t > simdi;
}

/** Ada şu an kapalı mı (kendiliğinden hiç inmez): "Adayı tamamen kapat" seçili ya da "1 saat gizle" sürüyor. */
export function adaKapaliMi(g: { ada?: 'goster' | 'kapali'; adaGizliBitis?: string } | undefined, simdi: number): boolean {
  return g?.ada === 'kapali' || sureSuruyor(g?.adaGizliBitis, simdi);
}

// ── Hal seçimi ─────────────────────────────────────────────────────────────────────────────────────────────────
/** Arayüzün bildiği durum. `hal`, asistan kancasının (src/renderer/asistan.tsx `Hal`) durumuyla birebir aynıdır. */
export interface AdaDurumu {
  hal: 'bos' | 'dinliyor' | 'yaziya' | 'dusunuyor' | 'konusuyor';
  /** Cevap bekleyen onay isteği sayısı. */
  onaySayisi: number;
  bildirimVar: boolean;
  /** Bildirimin kartı açıldı (bildirimVar iken anlamlı). */
  kartAcik: boolean;
  yanitVar: boolean;
  /** Kullanıcı "Fuber'e sor" kutusunu açtı. */
  sorAcik: boolean;
  /** Fuber fareyi/klavyeyi kullanıyor. */
  ekranda: boolean;
  /** Motorun hâli (0.10 Görev 2; shared/motor-durumu.ts — ada için adaMotoru: yerel model yanıtlıyorsa 'yerel'). Yanıt verilemiyorsa
   *  (motorEngelliMi) soru kutusu motor kartına döner; boşta hap yalnız kırmızı hâllerde (motorHapiVarMi: durdu, hesap kapalı, hak doldu). */
  motor: MotorGorunumu;
  /** Boşta + motorsuz: tam kart açık mı (hapın üstüne gelme ya da tıklama; A2). Yoksa küçük hap. */
  motorKartAcik?: boolean;
  /** Soru kutusunda kullanıcının yazdığı bir şey var (B10): kuyruktan gelen onay ya da bildirim yazı kutusunun yerine geçmez —
   *  kullanıcı gönderince ya da kutuyu kapatınca iner (yazarken kutu kaybolup tuşlar boşa gitmesin). */
  yaziyor?: boolean;
  /** Görev 28 düzeltme 3: baştaki bildirimin türü — hatırlatıcı ACİLDİR (sırada önde, soru kutusunda kendi çipi, boş kutuyu açarken
   *  iner, kısayol onu kapatır); 'bilgi' (ör. "Claude Code bitirdi") kutunun arkasında "Bildirim var" çipinde bekler. */
  bildirimTuru?: 'hatirlatma' | 'bilgi';
  /** 0.13: baştaki bildirim Fuber'in sessiz mesajı: adayı açmaz, noktada bekler (hatırlatıcı ve kullanıcıdan karar bekleyen bildirim sessiz değildir;
   *  kartına tıklanınca da sessizliği biter, olağan bildirim gibi kalır). */
  bildirimSessiz?: boolean;
  /** 0.13: imleç şeklin üstünde durdu (HOVER_GECIKME_MS; çıkınca panelde PANEL_KAPANIS_MS, noktadaki mesajda HOVER_CIKIS_MS sonra düşer). Yalnız boştaki
   *  çentiği açar (0.14 T23: panel). */
  hover?: boolean;
  /** 0.14 T23: panel tıklamayla ya da ana süreçten (`ada:sayfa`) açıldı: imleç çıkınca kapanmaz, kullanıcının işidir (soru kutusu gibi). */
  panelAcik?: boolean;
  /** 0.13: tam ekran film/sunum/oyun sürüyor (ana süreç söyler): hover hiçbir şey açmaz. */
  tamEkran?: boolean;
  /** 0.11 G10: şu an yapay zekâ adımı çalışan görev (yoksa null/yok). `ekran`: görevin ekran izni var — adım ekranı tutabilir (fare/klavye kontrolü
   *  sürerken hap "Fuber ekranında çalışıyor" halinin yerini alır; Durdur orada da tıklanır). `sayi`: aynı anda adımı süren görev sayısı (>1 ise hapta "+N"). */
  gorev?: { id: number; baslik: string; ekran: boolean; sayi?: number } | null;
  /** 0.14 T13 (R13): 8 sn'yi ya da 3 adımı aşan sohbet turu (main/ada.ts adaSohbetCalisiyor). Bugünkü çentikte görev hapı gibi çizilir: "Çalışıyor · N. adım ·
   *  <süren aracın etiketi>" + Durdur (sohbet:durdur). Görev adımı varsa onun hapı önde. */
  calisiyor?: { sohbetId: number; adim: number; etiket: string } | null;
  /** 0.14 T19 (R13): bilgisayarda medya çalıyor (olay yardımcısının medya oturumu; T21 kaynağı, bağlantısı T22/T25). Boştaki çentik dinlenme yerine
   *  Kapalı hap olur (saat ve sağda simge). */
  medya?: boolean;
  /** 0.14 T22: çentikte şu an gösterilen sistem uyarısı (ana süreç 'ada:uyari'; tek atımlık süreyle kalkar). Yalnız boşta görünür: iş onu ezer. */
  uyari?: SistemUyarisi | null;
  /** İş izi (11 Kas; shared/is-izi.ts centikGorunenSayisi): çentiğin gösterdiği iş sayısı (aktif, sürekli olmayan yapraklar + bir an kalan bitenler). >0 iken
   *  görev hapının yerinde iş hapı çizilir (yörüngede iş sayısı kadar nokta); üstüne gelince liste ('isler'). Görev adımı ve sohbet turu hapı önde kalır. */
  isler?: number;
  /** İş izi: aktif iş sayısı (isler'in bitmemiş olanları). Liste yalnız gösterecek ek bilgi varken açılır. */
  islerAktif?: number;
}

/** 0.14 T23: Çalışıyor hâlinin görünen adım yazısı ("Adım N"; uzun metin calisiyorHapMetni erişilebilir ad ve ipucunda kalır). */
export const calisiyorAdimMetni = (adim: number): string => `Adım ${Math.max(1, Math.floor(adim) || 1)}`;

/** Çalışıyor hapının yazısı (adım 1'den sayılır; etiket yoksa yalnız adım). */
export function calisiyorHapMetni(c: { adim: number; etiket: string }): string {
  return `Çalışıyor · ${c.adim}. adım${c.etiket.trim() ? ` · ${c.etiket.trim()}` : ''}`;
}

/** Bildirim sırası (düzeltme 3; 0.13): hatırlatıcı > karar bekleyen bildirim > sessiz mesaj; aynı sınıfta geliş sırası. Sessiz mesaj en arkada kalmalı: baştakinin
 *  sessizliği halı belirler (`bildirimSessiz`), öne düşerse arkasındaki izin isteği adayı açtığı hâlde görünmezdi. */
export function bildirimSiraya<T extends { kaynak: 'hatirlatma' | 'fuber'; sessiz?: boolean }>(l: readonly T[], yeni: T): T[] {
  const sinif = (b: T): number => (b.kaynak === 'hatirlatma' ? 0 : b.sessiz ? 2 : 1);
  const i = l.findIndex((b) => sinif(b) > sinif(yeni));
  return i < 0 ? [...l, yeni] : [...l.slice(0, i), yeni, ...l.slice(i)];
}

/** Soru kutusundaki bekleyen çipi (düzeltme 3): onay > hatırlatıcı (başlığıyla, kendi çipi — gömülmez) > "Bildirim var"; yoksa null. */
export function bekleyenCip(d: AdaDurumu, hatirlatmaBasligi?: string): { tur: 'onay' | 'hatirlatma' | 'bilgi'; metin: string } | null {
  if (d.onaySayisi > 0) return { tur: 'onay', metin: 'Onay bekliyor' };
  if (!d.bildirimVar) return null;
  if (d.bildirimTuru === 'hatirlatma') return { tur: 'hatirlatma', metin: hatirlatmaBasligi ? `Hatırlatıcı · ${hatirlatmaBasligi}` : 'Hatırlatıcı' };
  return { tur: 'bilgi', metin: 'Bildirim var' };
}

/** BOŞ soru kutusu açıkken hatırlatıcı gelirse kutu kapanır ve hatırlatıcı iner (yazılmış bir şey kaybolmaz); yazarken (B10),
 *  dinlerken ya da yanıt varken kutu kalır — hatırlatıcı kutuda kendi çipiyle görünür. */
export function hatirlatmaKutuyuKapatirMi(d: AdaDurumu): boolean {
  return (d.sorAcik || Boolean(d.panelAcik)) && !d.yaziyor && d.hal === 'bos' && !d.yanitVar && !d.ekranda;
}

/**
 * Asistan kısayolu (Görev 28 düzeltme 2 (b)): ada kullanıcının işi, onay, hatırlatıcı (acil sayılır: kısayol onu kapatır — eski kural)
 * ya da ekrandaki kontrol için açıksa kapatır; YALNIZ Fuber'in acil olmayan bildirimi (ör. "Claude Code bitirdi") için açıksa soru
 * kutusunu açar — bildirim kutudaki "Bildirim var" çipine iner. Eskiden bildirim hapı görünürken kısayol adayı kapatıyordu.
 */
export function kisayolKarari(d: { acik: boolean; kullaniciActi: boolean; onayVar: boolean; hatirlatmaVar?: boolean; kontrolde: boolean }): 'gizle' | 'ac' {
  if (!d.acik) return 'ac';
  return !d.kullaniciActi && !d.onayVar && !d.hatirlatmaVar && !d.kontrolde ? 'ac' : 'gizle';
}

/**
 * Aynı anda doğru olan durumlardan tek bir hal seçer. Sıra: ekranda > onay (kullanıcı soru kutusuna yazarken değil; B10) >
 * dinliyor > düşünüyor (yazıya/düşünüyor) > yanıt (konuşuyor ya da yanıt var) > sor (kullanıcının açtığı soru kutusu; motor yoksa
 * motor-durdu — Ruling CE: acil olmayan bildirim kutudaki çipte bekler) > bildirim (kart açıksa kart) > görev hapı (0.11 G10; görev ekranı
 * tutuyorsa "ekranda"nın yerine, en üstte) > sistem uyarısı (0.14 T22; yalnız boşta) > bağlantı koptu / hesap
 * kapalı / hak doldu (kart açıksa motor-durdu, değilse motor-hap; hiç bağlanmamışken ve onay beklerken hap yok) > hover (0.13: noktadaki
 * mesaj, yoksa açık panel — 0.14 T23; tam ekranda ikisi de yok) > Kapalı hap ('sessiz': medya ya da Fuber noktası) > dinlenme (0.14 T19). Hover boş hâllerin hemen
 * önünde: imlecin altındaki iş (Durdur, onay, kart) asla ondan etkilenmez.
 */
export function adaHaliBul(d: AdaDurumu): AdaHal {
  // 0.11 G10: ekranı kullanan görevse "ekranda" halinin yerini görev hapı alır (Durdur'u ve Alt+Shift+Q ipucu hapta); ekranı kullanıcının kendi turu
  // kullanıyorsa (adım ekranı tutmuyor) "ekranda" kalır.
  if (d.ekranda) return d.gorev?.ekran ? 'gorev' : 'ekranda';
  // B10: kullanıcı soru kutusuna (0.14 T23: ya da paneldeki Asistan'ın yazı alanına) yazıyorsa onay ve bildirim kutunun yerine geçmez (sırada bekler).
  const yaziyor = (d.sorAcik || Boolean(d.panelAcik)) && Boolean(d.yaziyor);
  if (d.onaySayisi > 0 && !yaziyor) return 'onay';
  if (d.hal === 'dinliyor') return 'dinliyor';
  if (d.hal === 'yaziya' || d.hal === 'dusunuyor') return 'dusunuyor';
  if (d.hal === 'konusuyor' || d.yanitVar) return 'yanit';
  // Görev 28 düzeltme 2 (b): kullanıcının açtığı soru kutusu (kısayol, tepsi "Fuber'e sor", çip) acil olmayan bildirimin önünde —
  // bildirim kutudaki "Bildirim var" çipinde bekler, kutu kapanınca iner. (Eskiden boş kutuyu bildirim örtüyordu: mikrofon kapalıyken
  // sırada bir Claude Code bildirimi varsa yazarak sormak imkânsızdı.) Onay yine her şeyin önünde (yukarıda).
  // 0.14 T23: tıklamayla sabitlenen panel kullanıcının işidir (soru kutusunun yerinde); motor yoksa motor kartı.
  if (d.panelAcik) return motorEngelliMi(d.motor) ? 'motor-durdu' : 'panel';
  if (d.sorAcik) return motorEngelliMi(d.motor) ? 'motor-durdu' : 'sor';
  if (d.bildirimVar && !d.bildirimSessiz) return d.kartAcik ? 'kart' : 'bildirim';
  // 0.11 G10: görev adımı çalışıyor — kullanıcının işi, onay ve bildirim hapın önündedir; bağlantı hapından/sessizden öncedir. Kural BURADA, tek yerde.
  // (Ekran tutan görev yukarıda, "ekranda"nın yerinde döner; araçlar arasında ekran bırakılmışken buradan.)
  // 0.14 T13 (R13, B29): eşiği aşan sohbet turu ("Çalışıyor") aynı hapla, aynı yerde çizilir (T19 bu kuralı korur).
  // İş izi (11 Kas): iş hapı aynı yerde; üstüne gelince liste açılır — birden çok iş varken ya da tek iş görev/sohbet hapı değilse (o hap zaten aynı bilgiyi taşır).
  const isler = d.isler ?? 0;
  if (d.gorev || d.calisiyor || isler > 0) {
    const listeVar = isler > 1 || (isler === 1 && !d.gorev && !d.calisiyor);
    return d.hover && !d.tamEkran && listeVar ? 'isler' : 'gorev';
  }
  // 0.14 T22: sistem uyarısı yalnız boşta (onay, dinleme, yanıt, soru kutusu, bildirim ve görev yukarıda onu ezdi); bağlantı hapının, hover'ın ve Kapalı hapın önünde.
  if (d.uyari) return 'uyari';
  // 0.10 Görev 2 (C-1, A-3): hiç bağlanmamışken ve hesap onay beklerken ada NORMAL sessizdir (kırmızı hap yok; bildirim kokpitte).
  if (motorHapiVarMi(d.motor)) return d.motorKartAcik ? 'motor-durdu' : 'motor-hap';
  // 0.13: buraya gelen bildirim yalnız sessiz mesaj olabilir (açık bildirim yukarıda döndü). Hover yalnız hapı gösterir: kart ve ses ancak tıklanınca.
  // 0.14 T23 (R13): mesaj yoksa hover açık paneldir (Fuber'in mesajı paneli açmaz: önce hapı görünür).
  if (d.hover && !d.tamEkran) return d.bildirimVar ? 'bildirim' : 'panel';
  // 0.14 T19 (R13): boşta. Medya çalıyorsa ya da Fuber'in sessiz mesajı noktada bekliyorsa Kapalı hap ('sessiz'); gösterecek bir şey yoksa dinlenme.
  // (Buraya gelen bildirim yalnız sessiz mesaj olabilir: açık bildirim yukarıda döndü.)
  if (d.medya || d.bildirimVar) return 'sessiz';
  return 'dinlenme';
}

/** Sessiz çentikte Fuber'in mesaj noktası görünsün mü: mesaj bekliyor ve ada başka bir iş göstermiyor (mesaj görünürken nokta yok). */
export const fuberNoktasiVar = (d: AdaDurumu): boolean => d.bildirimVar && Boolean(d.bildirimSessiz) && adaHaliBul(d) === 'sessiz';

/**
 * İmleç çıkınca (HOVER_CIKIS_MS sonunda) baştaki bildirim kalkar mı? Yalnız hover'la görünen sessiz mesaj kalkar (görülmüş sayılır). Tıklanıp açılan mesaj artık olağan
 * bildirimdir: kartı ve sesi sürer, Sustur keser. Ses burada hiç kesilmez: hover ses başlatmadığı için çıkışın susturacağı bir şey yok. İmlecin altında başlamış işin
 * (yanıt, onay, soru kutusu) süresine ve sesine de dokunulmaz.
 */
export const hoverCikinciKalkarMi = (d: AdaDurumu, b: { sessiz: boolean } | undefined): boolean => Boolean(b?.sessiz) && adaHaliBul(d) === 'bildirim';

// ── 0.14 T23: çentikteki karakterin mod geçişi (ModGecisi) ───────────────────────────────────────────────────────────────────────────
/** Çentiğin çizdiği kip: `gorunen` hedeftir (geçiş sürerken de yeni kip), `gecis` sürüyorsa iki kip, `bekleyen` süren tur bitince uygulanacak kip. */
export interface CentikKipi<K extends string = string> { gorunen: K; gecis: { eski: K; yeni: K } | null; bekleyen: K | null }
export type CentikKipOlayi<K extends string = string> =
  /** Ayarlarda mod değişti. `gorunur`: çentik ekranda (geri çekilmiş değil); `turSuruyor`: adanın başlattığı tur (dinleme, düşünme, yanıt) ya da Çalışıyor. */
  | { tur: 'mod'; kip: K; gorunur: boolean; turSuruyor: boolean }
  /** ModGecisi bitti (`bitti`). Yarıda kesilen geçiş bunu çağırmaz. */
  | { tur: 'bitti' }
  /** Süren tur bitti: bekleyen kip varsa şimdi uygulanır. */
  | { tur: 'tur-bitti'; gorunur: boolean };

/**
 * Mod değişince çentikteki karakter (0.14 T23, T5): görünür çentikte ModGecisi oynar (az harekette ve Sade'de bileşen kendisi 240 ms çapraz solar); görünmezken
 * anında değişir. Süren tur eski karakterle biter (0.13 kuralı: tur başında kip kilitlenir) — yeni kip `bekleyen`de durur. Yarıda kesilen geçişte (T5 küçük
 * notu) yeni geçiş, yarıda kalanın HEDEFİNDEN başlar: çentik bir kare bile eski karaktere dönmez; ModGecisi'nin durdurma yolu kalıcı hareketleri bırakır.
 */
export function centikKipiAdimi<K extends string>(d: CentikKipi<K>, o: CentikKipOlayi<K>): CentikKipi<K> {
  switch (o.tur) {
    case 'bitti':
      return d.gecis ? { ...d, gecis: null } : d;
    case 'tur-bitti':
      return d.bekleyen === null ? d : centikKipiAdimi({ ...d, bekleyen: null }, { tur: 'mod', kip: d.bekleyen, gorunur: o.gorunur, turSuruyor: false });
    case 'mod': {
      if (o.turSuruyor) return { ...d, bekleyen: o.kip === d.gorunen ? null : o.kip };
      if (o.kip === d.gorunen) return d.bekleyen === null ? d : { ...d, bekleyen: null };
      if (!o.gorunur) return { gorunen: o.kip, gecis: null, bekleyen: null };
      return { gorunen: o.kip, gecis: { eski: d.gorunen, yeni: o.kip }, bekleyen: null };
    }
  }
}
