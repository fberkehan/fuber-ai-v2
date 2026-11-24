// ── Kurulum v2'nin saf kuralları (0.12 H3a, spec §1; 0.13 T5, spec B; birim testli: tests/kurulum-v2.test.ts) ─────────────────────────
// Kurulum sayfaları baştan hazırlandı; Apple/fintech havası. Her ekran TEK soru, önerilen seçili, yalnız
// "Devam" (ve Enter) ile ilerler. Adımların sırası ve her adımın "geçerli mi" kuralı burada; çizim renderer/kurulum2/ (ADIMLAR: { id,
// Bilesen, Onizleme, gecerliMi }). Hesap (H3b) ve Nerede (H3c: Fuber · Yalnız bu bilgisayar · Gizli + model kartları) adımları kendi dosyalarında.
// 0.13 T5: kurulumda yalnız iki kip var (Business mode, Developer mode). Rol çipleri kalktı: mod değildi, yalnız örnek cümleyi değiştiriyordu;
// kayıtlı `isProfili.rol` silinmez, kurulum onu yazmaz. Görünüm adımı geri geldi: seçim taslakta kalır, kurulum bitince uygulanır (pencere kurulum
// boyunca opak). Ses seçimi yok: ses kipin karakterine bağlı. "İleri, ileri, ileri": önerilenle sona kadar gidilir.
import { hitapMetni, sizliMi } from './hitap.ts';
import { KM, ilkSozCiftleri, sec } from './kurulum-metin.ts';
import { KIP_ADI, etkinKarakter, type Karakter, type KipKimligi } from './karakterler.ts';
import { GUN_VARSAYILAN, sessizSaatleri } from './kurulum-adimlari.ts';
import { HESAP_DURUM_ETIKETI, type HesapDurumu } from './masaustu-hesap.ts';
import type { Nerede } from './nerede.ts';
import { sesDusuMetni } from './ses-kimligi.ts';
import { TEMALAR, temaGocu } from './tema-cozum.ts';
import type { Ayarlar, Mod, Tema, YerelModelAdi } from './tipler.ts';
import { DAGITIM } from './dagitim.ts';

export const KURULUM2_SIRASI = ['hosgeldin', 'hesap', 'tanisma', 'kip', 'gunun', 'nerede', 'gorunum', 'ses', 'baglantilar', 'izinler', 'hazirsin'] as const;
export type Kurulum2Adim = (typeof KURULUM2_SIRASI)[number];
/** 'ilk' yeni kurulum · 'yeniden' Ayarlar → "Kurulumu yeniden aç" · 'yalniz-hesap' eksik tek zorunlu şey (shared/kurulum-adimlari.ts kurulumYolu). */
export type Kurulum2Kipi = 'ilk' | 'yeniden' | 'yalniz-hesap';

export function kurulum2Sirasi(kip: Kurulum2Kipi, hesapAcik: boolean = false): Kurulum2Adim[] {
  // Açık kaynak hazırlığı: hesapsız derlemede (false false) hesap ekranı hiç yok.
  if (!hesapAcik) return kip === 'yalniz-hesap' ? [] : KURULUM2_SIRASI.filter((a) => a !== 'hesap');
  return kip === 'yalniz-hesap' ? ['hesap'] : [...KURULUM2_SIRASI];
}

/** Hitap çipleri: '' = yalnız adıyla (0.13.1: "Sadece adımla"). */
export const HITAPLAR: readonly (readonly [string, string])[] = [['', 'Sadece adımla'], ['Bey', 'Bey'], ['Hanım', 'Hanım'], ['Hocam', 'Hocam']];

/** "Günün" kalıpları (segment) — elle değişen saat hiçbirine uymazsa segment seçimsiz görünür. */
export const GUN_KALIPLARI: readonly (readonly [string, string, string, string])[] = [
  ['erken', '08:00', '17:00', 'Erken'], ['klasik', GUN_VARSAYILAN.gunBas, GUN_VARSAYILAN.gunBit, 'Klasik'], ['gec', '10:00', '20:00', 'Geç'],
];
export function gunKalibi(bas: string, bit: string): string | null {
  return GUN_KALIPLARI.find(([, b, e]) => b === bas && e === bit)?.[0] ?? null;
}

export interface KurulumTaslagi {
  ad: string;
  hitap: string;
  /** Şirket adı (isteğe bağlı; iş profiline yazılır). */
  sirket: string;
  /** "Nasıl kullanacaksın?" seçimi. Kart seçilince anında da kaydedilir: sonraki adımlar ve "Dinle" kipi görsün (Vazgeç geri alır). */
  mod: Mod;
  /** Developer'da "Claude Code notlarımı oku" (varsayılan kapalı, C-11); yalnız kurulum:tamamla okur. */
  claudeHafiza: boolean;
  gunBas: string;
  gunBit: string;
  /** Sabah özeti saati; '' = kapalı. */
  sabah: string;
  /** 0.12 H3c: Nerede adımında kullanıcının BU kurulumdaki son AÇIK seçimi (Fuber · Yalnız bu bilgisayar · Gizli); null = henüz seçmedi.
   *  Ön seçim taslaktan değil (Y1): shared/nerede.ts neredeOnSecimi — açık seçim yoksa o anki gerçek hâl. */
  nerede: Nerede | null;
  /** Yalnız bu bilgisayar / Gizli'de açıkça seçilen model kartı; null = bu bilgisayarın varsayılanı (kurulu ya da Önerilen; yerel-katalog.ts). */
  model: YerelModelAdi | null;
  /** Görünüm seçimi: taslakta kalır, kurulum bitince uygulanır (pencere kurulum boyunca opak; spec B). */
  tema: Tema;
  heyFuber: boolean;
  /** "Windows açılınca başlat" (Günün; varsayılan açık): Fuber kapalıyken sabah özeti gelmez. Kurulum bitince uygulanır (kurulum:tamamla); Vazgeç hiç yazmaz. */
  baslangictaAc: boolean;
  izin: { bilgisayar: boolean; tarayici: boolean; dosyaOkuma: boolean; bildirim: boolean };
  /** Akışın kendi durumu (kullanıcı seçimi değil; geçerlilik kuralları okur). */
  akis: {
    /** Fuber hesabı bağlı. */
    hesapBagli: boolean;
    /** Hesap sunucusuna ulaşılamadığı için "Şimdilik hesapsız devam et" seçildi. */
    hesapsiz: boolean;
    /** Nerede adımı bilgisayarın önerisini bekliyor (en çok ~10 sn; sonra "bakamadım" hâliyle geçilir). */
    yerelBekliyor: boolean;
  };
}

/** Taslağın açılış hâli: yeni kurulumda önerilenler, yeniden açılan kurulumda kayıtlı ayarlar. */
export function taslakBaslangici(a: {
  kullaniciAdi?: string; hitap?: string; mod?: Mod; gorunum?: { tema?: Tema }; isProfili?: { sirket?: string };
  proaktif?: { sabahOzeti?: string; etkin?: boolean }; yerel?: { gizliMod?: boolean };
  ses?: { uyandirma?: boolean }; baslangictaAc?: boolean; yetki?: { bilgisayar?: boolean; tarayici?: boolean; dosyaOkuma?: boolean };
  hesap?: unknown;
}, kip: Kurulum2Kipi, gun?: { bas: string; bit: string }): KurulumTaslagi {
  const ilk = kip === 'ilk';
  return {
    ad: ilk ? '' : (a.kullaniciAdi ?? ''),
    hitap: ilk ? '' : (a.hitap ?? ''),
    sirket: ilk ? '' : (a.isProfili?.sirket ?? ''),
    // Yeni profilde kayıt 'is': Business önerilen olarak seçili gelir. Yarıda kalmış kurulumda yapılan seçim korunur (kart anında kaydedilir).
    mod: a.mod === 'gelistirici' ? 'gelistirici' : 'is',
    claudeHafiza: false,
    gunBas: gun?.bas ?? GUN_VARSAYILAN.gunBas,
    gunBit: gun?.bit ?? GUN_VARSAYILAN.gunBit,
    sabah: ilk ? GUN_VARSAYILAN.sabah : (a.proaktif?.sabahOzeti ?? ''),
    nerede: null,
    model: null,
    tema: temaGocu(a.gorunum?.tema, 'sistem'),
    heyFuber: a.ses?.uyandirma !== false,
    // Yeni kurulumda açık önerilir ("ileri ileri" geçen yöneticiye sabah özeti gerçekten gelsin); yeniden açılanda kayıtlı değer.
    baslangictaAc: ilk ? true : a.baslangictaAc !== false,
    izin: {
      bilgisayar: a.yetki?.bilgisayar === true,
      tarayici: a.yetki?.tarayici !== false,
      dosyaOkuma: a.yetki?.dosyaOkuma !== false,
      bildirim: a.proaktif?.etkin !== false,
    },
    akis: { hesapBagli: Boolean(a.hesap), hesapsiz: false, yerelBekliyor: false },
  };
}

const SAAT = /^([01]\d|2[0-3]):[0-5]\d$/;
const dk = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

/** Her adımın "Devam"ı açık mı. Hiçbir adım ad gibi kişisel bir girdi zorlamaz; yalnız hesap (spec: herkes kayıt olur) ve saatler. */
export const ADIM_GECERLILIGI: Readonly<Record<Kurulum2Adim, (t: KurulumTaslagi) => boolean>> = {
  hosgeldin: () => true,
  hesap: (t) => t.akis.hesapBagli || t.akis.hesapsiz,
  tanisma: (t) => t.ad.trim().length <= 60 && t.hitap.trim().length <= 40 && t.sirket.trim().length <= 80,
  kip: () => true,
  gunun: (t) => SAAT.test(t.gunBas) && SAAT.test(t.gunBit) && t.gunBas !== t.gunBit && (t.sabah === '' || SAAT.test(t.sabah)),
  nerede: (t) => !t.akis.yerelBekliyor,
  gorunum: () => true,
  ses: () => true,
  baglantilar: () => true,
  izinler: () => true,
  hazirsin: () => true,
};

// ── 0.13 T5 (spec B): kip kartları, görünüm seçenekleri, kurulumun sonu ──────────────────────────────────────────────────────────────
export interface KipKarti { mod: Mod; ad: string; karakter: string; tanim: string }
/** "Nasıl kullanacaksın?" kartları: kipin adı (dört dilde aynı) + karakterin adı ve tek cümlelik tanımı. Hesap adımı önce gelir: Yönetim'in
 *  değerleri varsa onlar, yoksa (hesapsız, eski sunucu) gömülü varsayılanlar. */
export function kipKartlari(k: Record<KipKimligi, Karakter> | undefined): KipKarti[] {
  return (['is', 'gelistirici'] as const).map((mod) => {
    const c = etkinKarakter(mod, k);
    return { mod, ad: KIP_ADI[mod], karakter: c.ad, tanim: c.tanim };
  });
}
/** Developer mode'un kapsamı (simge, metin): kurulumun önizlemesi (kurulum2/adimlar/Kip.tsx) ve Ayarlar → Genel'in kartı aynı kaynaktan. */
export const DEVELOPER_KAPSAMI: readonly (readonly [string, string])[] = [['canta', 'Business mode’daki her şey'], ['terminal', 'Claude Code sayfası'], ['grafik', 'Kullanım ayrıntısı ve araçlar']];
/** "Claude Code notlarımı oku" yalnız Developer'da ve yalnız ilk kurulumda: notları kurulum:tamamla okur, yeniden açılan kurulum onu çağırmaz. */
export const claudeNotlariGorunur = (kip: Kurulum2Kipi, mod: Mod): boolean => kip === 'ilk' && mod === 'gelistirici';

/** "Dinle" sözü (kurulum, Ayarlar, telefon): kipin karakteri kendini tanıtır. */
export const dinlemeSozu = (ad: string, siz = false): string => sec(siz, KM.dinlemeSozu(ad));
/** Telefonun "Telefonda dinle"si (ana süreç ses:dene): metin yoksa ya da eski telefonun sabit "ben Fuber" sözüyse (2.1.1 kendisi yollar, yeni APK yok) karakter kendini tanıtır. */
export function onizlemeSozu(metin: unknown, ad: string): string {
  const m = typeof metin === 'string' ? metin.trim() : '';
  return m && !m.startsWith('Merhaba, ben Fuber.') ? m.slice(0, 300) : dinlemeSozu(ad);
}

// ── 0.13 T6: kurulumda bu bilgisayarın sesi (Gizli, "Yalnız bu bilgisayar"; yedek ses ≈ 86 MB) ────────────────────────────────────────────────────
/** Sesin bu bilgisayardan çıkıp çıkmadığı, "Sesli konuşma"nın açık olup olmadığı ve yedek sesin hâli. */
export interface YerelSesDurumu { seslendirme: boolean; bilgisayardan: boolean; kurulu: boolean; yuzde?: number | null; hata?: boolean }
/** Adımdan çıkarken yedek ses indirilsin mi: yalnız ses bu bilgisayardan çıkacaksa, kurulu değilse VE "Sesli konuşma" açıksa. Kapalıyken 86 MB inmez. */
export const sesIndirilsinMi = (g: Pick<YerelSesDurumu, 'seslendirme' | 'bilgisayardan' | 'kurulu'>): boolean => g.seslendirme && g.bilgisayardan && !g.kurulu;
/** Hazırsın'ın Ses satırı: sesin gerçek hâli ("Sesli konuşma kapalı" · karakter adı · "Bu bilgisayarın sesi" · henüz inmedi/iniyor). */
export function sesOzeti(karakter: string, g: YerelSesDurumu): string {
  if (!g.seslendirme) return 'Sesli konuşma kapalı';
  if (!g.bilgisayardan) return karakter;
  if (g.kurulu) return 'Bu bilgisayarın sesi';
  return `Bu bilgisayarın sesi · ${g.hata ? 'inemedi' : typeof g.yuzde === 'number' ? `%${g.yuzde} iniyor` : 'henüz inmedi'}`;
}
/** Hazırsın'ın düz notu: yerel ses seçili ama inmedi — ne olduğunu ve inene kadar ne olacağını söyler. Sorun yoksa (ya da ses kapalıysa) null. */
export function sesInmediNotu(g: YerelSesDurumu): string | null {
  if (!g.seslendirme || !g.bilgisayardan || g.kurulu) return null;
  const nasil = g.hata ? 'inemedi' : typeof g.yuzde === 'number' ? `iniyor (%${g.yuzde})` : 'henüz inmedi';
  return `Bu bilgisayarın sesi ${nasil}; inene kadar yanıtlar yazı olarak gelir.`;
}

/** Ses adımının girdisi (yedek ses bilgisi ana süreçten: renderer/kurulum2/adimlar/Ses.tsx). `hesapSesi`: karakterin sesi şu an çalabilir. */
export interface DinlemeGirdisi { bilgisayardan: boolean; hesapSesi: boolean; kurulu: boolean; hesapDurumu: HesapDurumu | null }
/** "Dinle"nin gerçek hâli. `yerel`: bugün çalacak ses bu bilgisayarın sesi; `indir`: o ses kurulu değil, tek çıkış "İndir ve dinle"; `not`: neden karakterin sesi değil;
 *  `rozet`: yan panelin kısa hâli. */
export interface DinlemeDurumu { yerel: boolean; indir: boolean; not: string | null; rozet: string }

/** Hesap onay beklerken ses yolu kapalıdır: "ses kurulu değil" yanlış olur, "Hazır" da (0.13 son düzeltme 4). Ses adımı ve yan panel aynı sonucu okur. */
export function dinlemeDurumu(g: DinlemeGirdisi, siz = false): DinlemeDurumu {
  if (!g.bilgisayardan && g.hesapSesi) return { yerel: false, indir: false, not: null, rozet: 'Hazır' };
  const kurulu = g.kurulu ? 'Hazır' : 'Kurulu değil';
  if (g.bilgisayardan || !g.hesapDurumu) return { yerel: true, indir: !g.kurulu, not: null, rozet: kurulu };
  const not = g.hesapDurumu === 'bekliyor' ? sec(siz, KM.sesHesapBekliyor) : sesDusuMetni({ bulutsuz: false, hesapDurumu: g.hesapDurumu, yedekVar: g.kurulu }, siz);
  return { yerel: true, indir: !g.kurulu, not, rozet: g.hesapDurumu === 'bekliyor' ? HESAP_DURUM_ETIKETI.bekliyor : kurulu };
}

export interface GorunumSecenegi { deger: Tema; baslik: string; aciklama: string; simge: string }
/** Görünüm adımının seçenekleri: liste verilen temalardan süzülür (varsayılan TEMALAR; arayüz sunulanTemalar ile Şeffaf'ı cam desteği olmayan bilgisayarda çıkarır). */
const GORUNUMLER: readonly (Omit<GorunumSecenegi, 'deger'> & { deger: string })[] = [
  { deger: 'sistem', baslik: 'Otomatik', aciklama: KM.gorunumSistem[0], simge: 'yenile' },
  { deger: 'koyu', baslik: 'Koyu', aciklama: 'Akşamları göz yormaz.', simge: 'ay' },
  { deger: 'acik', baslik: 'Açık', aciklama: 'Aydınlık ortamda net okunur.', simge: 'gunes' },
  { deger: 'cam', baslik: 'Şeffaf', aciklama: KM.gorunumCam[0], simge: 'cam' },
];
export const gorunumSecenekleri = (temalar: readonly string[] = TEMALAR): GorunumSecenegi[] => GORUNUMLER.filter((g) => temalar.includes(g.deger)) as GorunumSecenegi[];

/** kurulum:tamamla'nın gövdesi (yalnız ilk kurulum). Tema burada yazılır: pencere kurulum boyunca opak kalır, seçim kurulumu bitiren yazımla
 *  uygulanır. Rol yok (kayıtlı rol ana süreçte korunur: isProfiliSuz); boş şirket yazılmaz; Claude Code notları yalnız Developer seçiliyken okunur
 *  (anahtarı açıp Business'e dönen okutmaz). `mod`: son kip — kip kartının anlık kaydı yarışta kalsa da kurulum bitince kesinleşir (0.13 T6). */
export function kurulumTamamlaGovdesi(t: KurulumTaslagi) {
  const sirket = t.sirket.trim();
  return {
    kullaniciAdi: t.ad.trim(), hitap: t.hitap.trim(), claudeHafiza: t.mod === 'gelistirici' && t.claudeHafiza, sabahOzeti: t.sabah, tema: t.tema, mod: t.mod, baslangictaAc: t.baslangictaAc,
    isProfili: { ...(sirket ? { sirket } : {}), gunBas: t.gunBas, gunBit: t.gunBit },
  };
}
/** Yeniden açılan kurulumun "Bitti"si: tema değiştiyse ayarlar:kaydet'e eklenen yama; değişmediyse boş. "Vazgeç" hiç yazmaz. */
export function temaYamasi(g: Ayarlar['gorunum'], tema: Tema): Pick<Partial<Ayarlar>, 'gorunum'> {
  return g.tema === tema ? {} : { gorunum: { ...g, tema } };
}

// ── Canlı önizlemelerin saf hesapları ───────────────────────────────────────────────────────────────────────────────────────────────
/** Kokpitin selamı (main/kokpit/duzen.ts ile aynı eşikler). */
export function selamSozu(saat: number): string {
  return saat < 5 ? 'Merhaba' : saat < 12 ? 'Günaydın' : saat < 18 ? 'İyi günler' : 'İyi akşamlar';
}
/** "Günaydın, Deniz Bey." — ad yoksa yalnız selam. */
export function selamCumlesi(saat: number, ad: string, hitap: string): string {
  const h = hitapMetni(ad, hitap);
  return h ? `${selamSozu(saat)}, ${h}.` : `${selamSozu(saat)}.`;
}
/** "10 sa" · "9 sa 30 dk" · "45 dk". */
export function sureMetni(dakika: number): string {
  const s = Math.floor(dakika / 60), d = dakika % 60;
  if (!s) return `${d} dk`;
  return d ? `${s} sa ${d} dk` : `${s} sa`;
}

export interface GunSeridi {
  /** Mesai dilimleri (günün yüzdesi; gece yarısını aşan mesai iki dilim). */
  mesai: { bas: number; bit: number }[];
  /** Sabah özetinin yeri (yüzde) ya da null. */
  sabah: number | null;
  /** Mesainin süresi (dk). */
  sure: number;
  /** Sessiz saat (mesai dışı; sessizSaatleri) ya da null (gece vardiyası eşlenmez). */
  sessiz: { sessizBaslangic: string; sessizBitis: string } | null;
}
/** "Günün" önizlemesinin gün şeridi (00:00–24:00). */
export function gunSeridi(gunBas: string, gunBit: string, sabah: string): GunSeridi {
  const y = (s: string) => Math.round((dk(s) / 1440) * 10000) / 100;
  const b = dk(gunBas), e = dk(gunBit);
  const mesai = e > b ? [{ bas: y(gunBas), bit: y(gunBit) }] : [{ bas: y(gunBas), bit: 100 }, { bas: 0, bit: y(gunBit) }];
  return {
    mesai,
    sabah: sabah && SAAT.test(sabah) ? y(sabah) : null,
    sure: e > b ? e - b : 1440 - b + e,
    sessiz: sessizSaatleri(gunBas, gunBit, sabah),
  };
}

// ── 0.13.1: Hazırsın'ın "siz/sen" metinleri ve önerilen ilk sözler (saf; çiftler shared/kurulum-metin.ts; tests/kurulum-cila.test.ts) ─────────
/** Hazırsın başlığı ve giriş cümlesi. Resmî hitapta (Bey, Hanım, Hocam…) "siz": "Hazırsınız, Deniz Bey." Hitapsızda "sen". */
export function hazirsinMetinleri(g: { ad: string; hitap: string; kip: Kurulum2Kipi }): { baslik: string; giris: string } {
  const siz = sizliMi(g.hitap);
  return { baslik: KM.hazirsin(siz, hitapMetni(g.ad, g.hitap)), giris: sec(siz, g.kip === 'ilk' ? KM.hazirsinGirisIlk : KM.hazirsinGirisYeniden) };
}

/** Hazırsın'ın örnek sözleri (Fuber seçiliyken): izinlere ve bağlantıya göre (kurulum-metin.ts ilkSozCiftleri); siz'de emirler "-in". */
export function ilkSozler(g: { eposta: boolean; dosya: boolean; tarayici: boolean; yerel?: boolean }, siz = false): string[] {
  return ilkSozCiftleri(g).map((c) => sec(siz, c));
}

/** "Hazırsın" özetinin Nerede satırı (0.12 H3c): seçim + yerel sürüm + indirmenin ilerlemesi ("Yalnız bu bilgisayar · Hafif sürüm · %34 iniyor"). */
export function neredeOzeti(n: Nerede, yerel?: { etiket?: string | null; yuzde?: number | null; kurulu?: boolean } | null): string {
  if (n === 'fuber') return 'Fuber';
  const bas = n === 'gizli' ? 'Gizli · bu bilgisayarda' : 'Yalnız bu bilgisayar';
  const parca = [bas, ...(yerel?.etiket ? [yerel.etiket] : []), ...(yerel?.kurulu ? [] : typeof yerel?.yuzde === 'number' ? [`%${yerel.yuzde} iniyor`] : [])];
  return parca.join(' · ');
}

/** Hiçbir bağlantı yokken özetin Bağlantılar değeri (0.13.1: "Bağlanmadı" hata gibi okunuyordu); soluk gösterilir. */
export const BAGLANTI_YOK = 'Henüz eklenmedi';

/** "Hazırsın" özet kartının satırları ([etiket, değer]). 0.13.1: dört satır — Kullanım, Nerede, Bağlantılar, İzinler. Ad başlıkta (kartta
 *  tekrar etmez); hesap, mesai, sabah özeti, görünüm ve ses ekranlarında zaten görüldü ya da kartın önemli olanı değil. `ek`: taslakta olmayan
 *  bilinenler (bağlantılar, Nerede satırı — etkin seçim ve indirme, yoksa taslağın açık seçimi; kipin karakteri). */
export function ozetSatirlari(t: KurulumTaslagi, ek: { epostaSayisi: number; whatsapp: boolean; nerede?: string; karakter?: string }): [string, string][] {
  const izinSayisi = [t.izin.bilgisayar, t.izin.tarayici, t.izin.dosyaOkuma, t.izin.bildirim].filter(Boolean).length;
  const baglanti = [...(ek.epostaSayisi ? [`${ek.epostaSayisi} e-posta`] : []), ...(ek.whatsapp ? ['WhatsApp'] : [])];
  return [
    ['Kullanım', [KIP_ADI[t.mod], ek.karakter].filter(Boolean).join(' · ')],
    ['Nerede', ek.nerede ?? neredeOzeti(t.nerede ?? 'fuber')],
    ['Bağlantılar', baglanti.length ? baglanti.join(' · ') : BAGLANTI_YOK],
    ['İzinler', `${izinSayisi} / 4 açık`],
  ];
}
