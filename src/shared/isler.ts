// ── Görevler: süreli/sürekli işler (0.11 G9; spec §8; saf, birim testli: tests/isler-kurallar.test.ts) ─────────────────────────────────
// Ajana görev verilebilir: token harcamamak için 10 ya da 30 saniyelik aralar bırakarak kendi kendini tetikler; bir şeyin
// takibi istenince bunu anlar ve işe uygun aralıklar üreterek kendi kendini tetikler. Bir görev: amaç +
// plan (gözcü, aralık, bitiş, izinler, en çok adım). Gözcü yapay zekâsız ucuz kontroldür (main/isler/gozculer.ts); "değişiklik yok" derse
// yapay zekâ çağrılmaz ve aralık uzar, değişiklik varsa en kısaya döner ve bir yapay zekâ adımı çalışır (main/isler/zamanlayici.ts).
// Kodda adı `is`/`isler`: mevcut `gorev*` kodu Yapılacaklar'dır (G4) ve adı değişmez; arayüzde "Görev" (shared/terimler.ts TERIM.gorev).
// Bu modül kuralların saf parçaları: plan doğrulama, sonraki aralık, bitiş, izin kapsamı ve onay kartının insan dili.
import type { Mod } from './tipler.ts';

export type GozcuTuru = 'whatsapp' | 'eposta' | 'sayfa' | 'ekran' | 'saat';
/** G9 düzeltme turu 1 (Ö1): WhatsApp izni KİŞİYE bağlıdır, yazılan ada değil — `jid` görev başlarken (main/isler/kisiler.ts) gönderimle aynı
 *  kuralla çözülür ve onay kartında numarasının sonuyla görünür. Modelin verdiği `jid` yok sayılır (isPlaniDogrula onu almaz). E-posta izni
 *  (son inceleme C1) TEK çıplak adrestir (küçük harf; görünen ad, liste, grup yok) ve gönderimin gerçek alıcılarıyla tam eşitlikle karşılaştırılır. */
export type IsIzni = { tur: 'whatsapp_gonder'; kisi: string; jid?: string } | { tur: 'eposta_gonder'; adres: string } | { tur: 'ekran' } | { tur: 'tarayici'; alan: string };
/** `sigorta`: saniye cinsinden en uzun süre (koşul hiç gerçekleşmese de, kullanıcı durdurmasa da görev o süre dolunca biter). */
export type IsBitisi = { tur: 'sure'; saniye: number } | { tur: 'zaman'; iso: string } | { tur: 'kosul'; aciklama: string; sigorta: number } | { tur: 'elle'; sigorta: number };
export interface IsPlani {
  /** `jid` (whatsapp gözcüsü): hedef kişinin çözülmüş jid'i — gözcü yalnız ondan gelen mesajla tetiklenir (görünen ada bakmaz). */
  gozcu: { tur: GozcuTuru; hedef?: string; jid?: string };
  /** Saniye. Değişiklik yokken aralık ×1,5 uzar (en çok `max`), değişince `min`e döner. */
  aralik: { min: number; max: number };
  bitis: IsBitisi;
  izinler: IsIzni[];
  /** Yapay zekâ en çok kaç kez çalışır (adım). */
  azamiAdim: number;
}
export type IsDurumu = 'onay' | 'suruyor' | 'durdu' | 'bitti' | 'hata';
/** Araç yok, görev çalışamaz — gerçek neden ayrı kaydedilir (0.11 son inceleme I1): 'gizli' YALNIZ Gizli mod açıkken; 'yerel' yol başka bir
 *  nedenle yalnız bu bilgisayardaki yapay zekâ olduğunda (Geliştirici'nin "Yalnız bu bilgisayardaki yapay zekâ" anahtarı ya da bulut hesabı
 *  kullanılamazken kurulu yerel yapay zekâ; shared/tek-motor.ts). 'yerel'in sözlerinde gizlilik vaadi YOK (R17). */
export type DurmaNedeni = 'kullanici' | 'acil' | 'kapanis' | 'sinir' | 'hata' | 'gizli' | 'yerel';
/** Durma nedeninin sade cümlesi (görev sohbetindeki not, araç listesi; başlatma/sürdürme reddi de bundan: main/isler/zamanlayici.ts engelMetni). */
export function durmaMetni(neden: DurmaNedeni): string {
  switch (neden) {
    case 'kullanici': return 'Görev durduruldu.';
    case 'acil': return 'Acil durdurmayla görev durdu.';
    case 'kapanis': return 'Fuber kapandığı için görev durdu; istediğinde sürdürebilirsin.';
    case 'sinir': return 'Görev adım sınırına ulaştı.';
    case 'hata': return 'Üst üste üç denemede ilerleyemediğim için görevi durdurdum; istediğinde sürdürebilirsin.';
    case 'gizli': return 'Gizli modda görevler çalışmaz; görev durdu.';
    case 'yerel': return 'Yapay zekâ şu an yalnız bu bilgisayarda çalıştığı için görevler çalışmaz; görev durdu.';
  }
}
/** İzinle (mesaj başına onay sorulmadan) yapılan gönderim: alıcının adı, kanal, zaman (ISO). Mesajın METNİ YOK. */
export interface Gonderim { alici: string; kanal: 'WhatsApp' | 'e-posta'; zaman: string }
/** "Gönderilenler: Ahmet Yılmaz (WhatsApp, 18:42); ece@ornek.co (e-posta, 18:43)" — görev sohbetine ve bitişte ana sohbete (spec §8 İzinler).
 *  Yerel saatle; boş listede boş dize. */
export function gonderilenlerMetni(liste: readonly Gonderim[]): string {
  if (!liste.length) return '';
  const saat = (iso: string) => { const t = new Date(iso); return Number.isNaN(t.getTime()) ? '' : `, ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };
  return `Gönderilenler: ${liste.map((g) => `${g.alici.replace(/\s+/g, ' ').trim().slice(0, 60)} (${g.kanal}${saat(g.zaman)})`).join('; ')}`;
}

/** Arayüzün (G10) ve araçların gördüğü görev. `bitisZamani`: sürerken planlanan bitiş (süre/zaman/sigorta); durunca ya da bitince bittiği an.
 *  `adim`: yapay zekâ adımı sayısı; `kontrol`: gözcü kontrolü sayısı; `sohbetId`: görevin kendi sohbeti (tür 'gorev'). */
export interface IsOzet {
  id: number; baslik: string; amac: string; durum: IsDurumu; plan: IsPlani; baslangic: string | null; bitisZamani: string | null;
  sonraki: string | null; sonKontrol: string | null; adim: number; kontrol: number; sonOzet: string | null; sonuc: string | null;
  durmaNedeni: DurmaNedeni | null; sohbetId: number;
  /** G10 (arayüz): izinle (mesaj başına onay sorulmadan) yapılan gönderim sayısı — Görevler kartının "N gönderim" rozeti. Eski/yarım kayıtta yok. */
  gonderim?: number;
  /** G10: şu an bir yapay zekâ adımı çalışıyor (yalnız gözcü kontrolü değil) — kart "Çalışıyor" der, ada "Görev: …" hapını gösterir. */
  adimda?: boolean;
}

export const EN_KISA_ARALIK = 10;
export const VARSAYILAN_AZAMI_ADIM = 60;
export const EN_COK_ADIM = 500;
export const EN_UZUN_SURE = 86_400;
export const AYNI_ANDA_EN_COK = 3;
export const ARALIK_CARPANI = 1.5;
/** Aralığın üst sınırı (saniye) ve gözcüsüz (saat) işlerde en kısa aralık: her aralıkta yapay zekâ çalışır, 10 sn'de bir çağırmak israf. */
export const EN_UZUN_ARALIK = 3600;
export const SAAT_EN_KISA = 30;
const EN_COK_IZIN = 10;

const GOZCULER: readonly GozcuTuru[] = ['whatsapp', 'eposta', 'sayfa', 'ekran', 'saat'];
const nesne = (g: unknown): g is Record<string, unknown> => typeof g === 'object' && g !== null && !Array.isArray(g);
const metin = (d: unknown, n: number): string => (typeof d === 'string' ? d.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const sayi = (d: unknown): number | null => (typeof d === 'number' && Number.isFinite(d) ? Math.round(d) : typeof d === 'string' && d.trim() && Number.isFinite(Number(d)) ? Math.round(Number(d)) : null);
const httpMi = (s: string): boolean => { try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; } };

/** Tek, ÇIPLAK e-posta adresi (son inceleme C1): görünen ad, liste, grup, tırnak, yorum, köşeli ayraç, ters bölü, boşluk ve denetim karakteri
 *  yok; tek "@"; alan adında nokta. Bu karakterler olmadan nodemailer'ın ayrıştırıcısı dizeyi olduğu gibi TEK adres olarak okur (izin, gönderimin
 *  gerçek alıcısıyla karşılaştırılır: main/entegrasyon/eposta-alicilari.ts). Kodlanmış söz (=?…?=) de yok. */
const YALIN_ADRES = /^[^\s\u0000-\u001f\u007f"(),:;<>@[\]\\]+@[^\s\u0000-\u001f\u007f"(),:;<>@[\]\\]+\.[^\s\u0000-\u001f\u007f"(),:;<>@[\]\\.]+$/;
/** Yalnız ASCII görünür karakter: onay kartında bilinen bir adrese benzeyip başka alan adına giden adres (Kiril harf, sıfır genişlikli/yön
 *  işareti, NEL) izin olamaz (son inceleme yeniden incelemesi). */
const ASCII_GORUNUR = /^[\x21-\x7e]+$/;
export const yalinAdresMi = (s: string): boolean => s.length <= 254 && ASCII_GORUNUR.test(s) && YALIN_ADRES.test(s) && !s.includes('=?');

/** Alan adı: küçük harf; şema, yol, kapı ve baştaki "www." düşer ("https://www.Ornek.com/sepet" → "ornek.com"). Geçersizse boş. */
export function alanAdi(s: string): string {
  const a = s.trim().toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/[/?#].*$/, '').replace(/:\d+$/, '').replace(/^www\./, '');
  return /^[a-z0-9çğıöşü-]+(\.[a-z0-9çğıöşü-]+)+$/.test(a) ? a : '';
}

/**
 * Yapay zekânın önerdiği planı doğrular ve sadeleştirir (bilinmeyen alanlar düşer). Hata iletisi modele gider (düzeltip yeniden dener).
 * Kurallar: aralık min ≥ 10 sn (saat gözcüsünde ≥ 30), max ≥ min, max ≤ 3600; süre/sigorta 1..86400 sn; bitiş zamanı gelecekte ve en çok
 * 24 saat sonra; azamiAdim 1..500 (yoksa 60); sayfa gözcüsü yalnız http(s) adresle; izinlerde boş kişi/adres/alan yok.
 */
export function isPlaniDogrula(girdi: unknown, simdi: Date = new Date()): { plan: IsPlani } | { hata: string } {
  if (!nesne(girdi)) return { hata: 'plan bir nesne olmalı: { gozcu, aralik, bitis, izinler, azamiAdim }' };
  // Gözcü
  if (!nesne(girdi.gozcu) || !GOZCULER.includes(girdi.gozcu.tur as GozcuTuru)) return { hata: `gozcu.tur şunlardan biri olmalı: ${GOZCULER.join(', ')}` };
  const tur = girdi.gozcu.tur as GozcuTuru;
  const hedef = metin(girdi.gozcu.hedef, 300);
  if (tur === 'sayfa' && !httpMi(hedef)) return { hata: 'sayfa gözcüsünün hedefi http:// ya da https:// ile başlayan bir adres olmalı' };
  const gozcu: IsPlani['gozcu'] = (tur === 'whatsapp' || tur === 'eposta' || tur === 'sayfa') && hedef ? { tur, hedef } : { tur };
  // Aralık
  if (!nesne(girdi.aralik)) return { hata: 'aralik { min, max } (saniye) zorunlu' };
  const min = sayi(girdi.aralik.min), max = sayi(girdi.aralik.max);
  const enKisa = tur === 'saat' ? SAAT_EN_KISA : EN_KISA_ARALIK;
  if (min === null || min < enKisa) return { hata: `aralik.min en az ${enKisa} saniye olmalı${tur === 'saat' ? ' (gözcüsüz işte her aralıkta yapay zekâ çalışır)' : ''}` };
  if (max === null || max < min) return { hata: 'aralik.max, aralik.min’den küçük olamaz' };
  if (max > EN_UZUN_ARALIK) return { hata: `aralik.max en çok ${EN_UZUN_ARALIK} saniye olabilir` };
  // Bitiş
  const b = girdi.bitis;
  if (!nesne(b)) return { hata: 'bitis zorunlu: { tur: "sure" | "zaman" | "kosul" | "elle", … }' };
  const sinirli = (d: unknown, ad: string): number | string => {
    const s = sayi(d);
    if (s === null || s < 1) return `${ad} saniye cinsinden pozitif bir sayı olmalı`;
    if (s > EN_UZUN_SURE) return `${ad} en çok ${EN_UZUN_SURE} saniye (24 saat) olabilir`;
    return s;
  };
  let bitis: IsBitisi;
  if (b.tur === 'sure') {
    const s = sinirli(b.saniye, 'bitis.saniye');
    if (typeof s === 'string') return { hata: s };
    bitis = { tur: 'sure', saniye: s };
  } else if (b.tur === 'zaman') {
    const t = typeof b.iso === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(b.iso.trim()) ? Date.parse(b.iso.trim()) : Number.NaN;
    if (!Number.isFinite(t)) return { hata: 'bitis.iso saat dilimli ISO 8601 zaman olmalı (ör. 2026-10-28T18:00:00+03:00)' };
    if (t <= simdi.getTime()) return { hata: 'bitis.iso geçmişte kalıyor; gelecekte bir zaman ver' };
    if (t - simdi.getTime() > EN_UZUN_SURE * 1000) return { hata: 'bitis.iso en çok 24 saat sonrası olabilir' };
    bitis = { tur: 'zaman', iso: new Date(t).toISOString() };
  } else if (b.tur === 'kosul' || b.tur === 'elle') {
    const s = sinirli(b.sigorta, 'bitis.sigorta');
    if (typeof s === 'string') return { hata: s };
    if (b.tur === 'kosul') {
      const aciklama = metin(b.aciklama, 200);
      if (!aciklama) return { hata: 'bitis.aciklama (hangi koşulda biteceği) boş olamaz' };
      bitis = { tur: 'kosul', aciklama, sigorta: s };
    } else bitis = { tur: 'elle', sigorta: s };
  } else return { hata: 'bitis.tur şunlardan biri olmalı: sure, zaman, kosul, elle' };
  // İzinler
  if (girdi.izinler !== undefined && girdi.izinler !== null && !Array.isArray(girdi.izinler)) return { hata: 'izinler bir liste olmalı' };
  const ham = (girdi.izinler ?? []) as unknown[];
  if (ham.length > EN_COK_IZIN) return { hata: `en çok ${EN_COK_IZIN} izin verilebilir` };
  const izinler: IsIzni[] = [];
  for (const i of ham) {
    if (!nesne(i)) return { hata: 'her izin bir nesne olmalı' };
    if (i.tur === 'whatsapp_gonder') {
      const kisi = metin(i.kisi, 120);
      if (!kisi) return { hata: 'whatsapp_gonder izninde kişi boş olamaz' };
      // Düzeltme turu 2 (N4): grup izni bu sürümde yok (kart grubun kim olduğunu gösteremez).
      if (/@g\.us$/i.test(kisi)) return { hata: 'whatsapp_gonder izni bir kişi içindir; grup izni bu sürümde yok' };
      izinler.push({ tur: 'whatsapp_gonder', kisi });
    } else if (i.tur === 'eposta_gonder') {
      // Son inceleme C1: bir izin TEK çıplak adrestir — görünen ad ("Ece <ece@x.com>"), liste ("a@x.com, b@x.com"), grup ("Ekip: a@x.com;")
      // ya da kodlanmış söz kabul edilmez (boşluk sıkıştırılmaz: "a @x.com" da reddedilir).
      const adres = typeof i.adres === 'string' ? i.adres.trim().toLowerCase() : '';
      if (!yalinAdresMi(adres)) return { hata: 'eposta_gonder izninde adres tek bir e-posta adresi olmalı (ör. muhasebe@ornek.com; yalnız İngilizce harf, rakam ve işaretler); ad, liste ya da grup yazılmaz — her adres için ayrı izin ver' };
      izinler.push({ tur: 'eposta_gonder', adres });
    } else if (i.tur === 'ekran') izinler.push({ tur: 'ekran' });
    else if (i.tur === 'tarayici') {
      const alan = alanAdi(metin(i.alan, 200));
      if (!alan) return { hata: 'tarayici izninde alan geçerli bir alan adı olmalı (ör. ornek.com)' };
      izinler.push({ tur: 'tarayici', alan });
    } else return { hata: 'izin türü şunlardan biri olmalı: whatsapp_gonder, eposta_gonder, ekran, tarayici' };
  }
  // Düzeltme turu 1 (Ö3): ekran gözcüsü ekranı görür; kullanıcı bunu onay kartında "ekranı kullanabilir" izniyle açıkça onaylamalı.
  if (tur === 'ekran' && !izinler.some((i) => i.tur === 'ekran')) return { hata: 'ekran gözcüsü ekran izni ister: izinler’e {"tur":"ekran"} ekle' };
  // En çok adım
  const azami = girdi.azamiAdim === undefined || girdi.azamiAdim === null ? VARSAYILAN_AZAMI_ADIM : sayi(girdi.azamiAdim);
  if (azami === null || azami < 1 || azami > EN_COK_ADIM) return { hata: `azamiAdim 1 ile ${EN_COK_ADIM} arasında olmalı` };
  return { plan: { gozcu, aralik: { min, max }, bitis, izinler, azamiAdim: azami } };
}

/** Sonraki kontrolün aralığı (saniye). Yapay zekânın önerisi varsa [min, max]'a kırpılır; yoksa değişti → min, değişmedi → ×1,5 (yukarı yuvarlanır),
 *  en çok max. */
export function sonrakiAralik(simdiki: number, degisti: boolean, plan: IsPlani, oneri?: number): number {
  const { min, max } = plan.aralik;
  if (typeof oneri === 'number' && Number.isFinite(oneri)) return Math.min(max, Math.max(min, Math.round(oneri)));
  if (degisti) return min;
  return Math.min(max, Math.max(min, Math.ceil(simdiki * ARALIK_CARPANI)));
}

/** Planlanan bitiş anı (ISO): süre ve sigorta başlangıçtan sayılır, bitiş zamanı olduğu gibi. Başlamamışsa null. */
export function planlananBitis(plan: IsPlani, baslangic: string | null): string | null {
  if (!baslangic) return null;
  const t = Date.parse(baslangic);
  if (!Number.isFinite(t)) return null;
  const b = plan.bitis;
  if (b.tur === 'zaman') return b.iso;
  return new Date(t + (b.tur === 'sure' ? b.saniye : b.sigorta) * 1000).toISOString();
}

/** Görev şimdi bitmeli mi: süre/bitiş zamanı/sigorta dolduysa 'sure', adım sınırına ulaştıysa 'sinir'. */
export function bitmeliMi(is: IsOzet, simdi: Date): null | 'sure' | 'sinir' {
  const bitis = planlananBitis(is.plan, is.baslangic);
  if (bitis && simdi.getTime() >= Date.parse(bitis)) return 'sure';
  if (is.adim >= is.plan.azamiAdim) return 'sinir';
  return null;
}

// ── İzin kapsamı ──
const rakamlar = (s: string): string => { const r = s.replace(/@.*$/, '').replace(/\D/g, ''); return r.startsWith('0') ? `9${r}` : r; };
const numaraMi = (s: string): boolean => s.includes('@') || s.replace(/\D/g, '').length >= 10;
/** jid'in alan adı: "@s.whatsapp.net" (ya da eski "@c.us", ya da çıplak numara) kişi; "@lid", "@g.us" ve öteki alanlar AYRI hesaplardır. */
const jidAlani = (s: string): string => {
  const m = /@([a-z0-9.-]+)\s*$/i.exec(s);
  const a = m ? m[1].toLowerCase() : 's.whatsapp.net';
  return a === 'c.us' ? 's.whatsapp.net' : a;
};
/** Aynı WhatsApp hesabı mı: jid/numara rakamları (baştaki 0 → 90) VE alan adı aynı (düzeltme turu 2, N4: "…@lid" ya da "…@g.us", aynı rakamlı
 *  kişi hesabı değildir). Ad karşılaştırılmaz: görünen ad gönderenin kendi seçtiğidir (Ö1). */
export function jidAyniMi(a: string, b: string): boolean {
  if (!numaraMi(a) || !numaraMi(b)) return false;
  return jidAlani(a) === jidAlani(b) && rakamlar(a).length >= 6 && rakamlar(a) === rakamlar(b);
}
/** Numaranın son 4 hanesi ("…0001"; onay kartında kişinin kim olduğunu gösterir). */
export const numaraSonu = (jid: string): string => `…${rakamlar(jid).slice(-4)}`;
const hostAdi = (adres: unknown): string => {
  if (typeof adres !== 'string' || !adres.trim()) return '';
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(adres.trim()) ? adres.trim() : `https://${adres.trim()}`).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; }
};

/**
 * Bu araç çağrısı görev izninin kapsamında mı (evetse görev adımında onay sorulmaz; değilse normal onay kartına düşer)? whatsapp_gonder:
 * mesajın GERÇEKTEN gideceği hesap (`girdi.aliciJid`: ÇAĞIRAN `kime`'yi gönderimle aynı kuralla çözer ve modelin girdisinin üstüne yazar; ad
 * birden çok kişiye uyuyorsa ya da çözülemiyorsa boş) izindeki kişinin jid'iyle aynı; eposta_gonder: e-postanın GERÇEKTEN gideceği bütün
 * adresler (`girdi.epostaAlicilari`: ÇAĞIRAN kime + cc + bcc'yi gönderenin kendi ayrıştırıcısıyla — main/entegrasyon/eposta-alicilari.ts —
 * çözer ve modelin girdisinin üstüne yazar; ayrıştırılamayan, adressiz ya da grup içeren alanda null) en az bir tane ve HER BİRİ izinli bir
 * adresle tam aynı (büyük/küçük harf önemsiz; son inceleme C1 — ham `kime`/`cc` dizesine hiç bakılmaz); bilgisayar_*: ekran izni; tarayici_*:
 * sayfanın adresi (`girdi.adres`; açık sayfa için çağıran ekler) izinli alan adında ya da alt alan adında. Başka her şey: hayır.
 */
export function izinVarMi(plan: IsPlani, arac: string, girdi: Record<string, unknown>): boolean {
  const iz = plan.izinler;
  if (arac === 'whatsapp_gonder') {
    const alici = typeof girdi.aliciJid === 'string' ? girdi.aliciJid : '';
    return Boolean(alici) && iz.some((i) => i.tur === 'whatsapp_gonder' && Boolean(i.jid) && jidAyniMi(i.jid!, alici));
  }
  if (arac === 'eposta_gonder') {
    const alicilar = girdi.epostaAlicilari;
    const izinli = new Set(iz.flatMap((i) => (i.tur === 'eposta_gonder' ? [i.adres.toLowerCase()] : [])));
    return Array.isArray(alicilar) && alicilar.length > 0 && alicilar.every((a) => typeof a === 'string' && izinli.has(a.toLowerCase()));
  }
  if (arac.startsWith('bilgisayar_')) return iz.some((i) => i.tur === 'ekran');
  if (arac.startsWith('tarayici_')) {
    const host = hostAdi(girdi.adres);
    return Boolean(host) && iz.some((i) => i.tur === 'tarayici' && (host === i.alan || host.endsWith(`.${i.alan}`)));
  }
  return false;
}

/** Araç ADI bir iznin alanına giriyor mu (girdisiz; adımın araç listesi için): gönderim aracı ilgili izinle, bilgisayar_* ekranla, tarayici_*
 *  tarayıcı izniyle. Çağrının kendisi yine `izinVarMi` ile denetlenir. */
export function izinAlaninda(plan: IsPlani, arac: string): boolean {
  const turler = new Set(plan.izinler.map((i) => i.tur));
  if (arac === 'whatsapp_gonder' || arac === 'eposta_gonder') return turler.has(arac);
  if (arac.startsWith('bilgisayar_')) return turler.has('ekran');
  if (arac.startsWith('tarayici_')) return turler.has('tarayici');
  return false;
}

// ── Onay kartının insan dili (G10 kartı da kullanır) ──
export interface IsPlaniMetni { ne: string; nasil: string; bitis: string; izinler: string[]; sinir: string }

const UNLU = 'aeıioöuü';
const KALIN = 'aıou';
const SERT = 'fstkçşhp';
const sonUnlu = (s: string): string | null => { for (const c of [...s.toLocaleLowerCase('tr')].reverse()) if (UNLU.includes(c)) return c; return null; };
const harfleBiter = (s: string): boolean => /[a-zçğıöşü]$/i.test(s);
/** Ayrılma hâli: "Ahmet’ten", "Ece’den", "Ahmet Yılmaz’dan"; numara/adres: "905… numarasından". */
function ayrilma(ad: string): string {
  const s = ad.trim();
  if (numaraMi(s)) return `${rakamlar(s)} numarasından`;
  const u = sonUnlu(s);
  if (!u || !harfleBiter(s)) return `“${s}” kişisinden`;
  return `${s}’${SERT.includes(s.slice(-1).toLocaleLowerCase('tr')) ? 't' : 'd'}${KALIN.includes(u) ? 'a' : 'e'}n`;
}
/** Yönelme hâli: "Ahmet’e", "Ece’ye", "Burak’a"; numara: "905… numarasına". */
function yonelme(ad: string): string {
  const s = ad.trim();
  if (numaraMi(s)) return `${rakamlar(s)} numarasına`;
  const u = sonUnlu(s);
  if (!u || !harfleBiter(s)) return `“${s}” kişisine`;
  return `${s}’${UNLU.includes(s.slice(-1).toLocaleLowerCase('tr')) ? 'y' : ''}${KALIN.includes(u) ? 'a' : 'e'}`;
}
/** Yönelme hâli dışarıya (çentiğin yazı alanı: "Fuber’e sor…"). */
export const yonelmeHali = (ad: string): string => yonelme(ad);
/** "30 sn’de bir", "2 dk’da bir", "saatte bir". */
function siklik(sn: number): string {
  if (sn >= 3600) return 'saatte bir';
  if (sn >= 60 && sn % 60 === 0) return `${sn / 60} dk’da bir`;
  return `${sn} sn’de bir`;
}
/** "5 dakikaya kadar", "45 saniyeye kadar", "1 saate kadar". */
function kadar(sn: number): string {
  if (sn >= 3600) return '1 saate kadar';
  if (sn >= 60 && sn % 60 === 0) return `${sn / 60} dakikaya kadar`;
  return `${sn} saniyeye kadar`;
}
/** "3 dakika", "1 saat 30 dakika", "24 saat", "45 saniye". */
export function sureMetni(sn: number): string {
  const s = Math.max(0, Math.round(sn));
  const saat = Math.floor(s / 3600), dakika = Math.floor((s % 3600) / 60), saniye = s % 60;
  const p = [saat ? `${saat} saat` : '', dakika ? `${dakika} dakika` : '', saniye && !saat ? `${saniye} saniye` : ''].filter(Boolean);
  return p.length ? p.join(' ') : '0 saniye';
}
const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const zamanMetni = (iso: string): string => { const t = new Date(iso); return `${t.getDate()} ${AY[t.getMonth()]} ${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };

/** Görevin planı insan diliyle (onay kartı, G10 kartı): ne yapacak, nasıl kontrol edecek, ne zaman biter, izinler, sınır. İş'te teknik sözcük yok
 *  (shared/is-dili.ts IS_YASAK); Geliştirici'de aralığın sayısal sınırları da yazar. */
export function isPlaniMetni(p: IsPlani, mod: Mod): IsPlaniMetni {
  const { tur, hedef } = p.gozcu;
  const once = siklik(p.aralik.min);
  const uzar = p.aralik.max > p.aralik.min ? ` Değişiklik yoksa beklemeyi ${kadar(p.aralik.max)} uzatır.` : '';
  const yoksa = 'yoksa yapay zekâyı çağırmaz.';
  const host = tur === 'sayfa' && hedef ? hostAdi(hedef) || hedef : '';
  // Çözülmüş kişi: numarasının sonu da görünür (Ö1) — kullanıcı onaylarken HANGİ kişiyi onayladığını görür.
  const sonu = (ad: string, jid?: string) => (jid && !numaraMi(ad) ? ` (${numaraSonu(jid)})` : '');
  const kimden = hedef ? `${ayrilma(hedef)}${sonu(hedef, p.gozcu.jid)}` : '';
  const [ne, nasil] =
    tur === 'whatsapp' ? (hedef ? [`WhatsApp’ta ${kimden} gelen mesajları takip eder.`, `${once} WhatsApp’ta ${kimden} yeni mesaj var mı bakar; ${yoksa}`]
      : ['Gelen WhatsApp mesajlarını takip eder.', `${once} WhatsApp’ta yeni mesaj var mı bakar; ${yoksa}`])
    : tur === 'eposta' ? (hedef ? [`“${hedef}” ile ilgili e-postaları takip eder.`, `${once} “${hedef}” ile ilgili yeni e-posta var mı bakar; ${yoksa}`]
      : ['Gelen e-postaları takip eder.', `${once} yeni e-posta var mı bakar; ${yoksa}`])
    : tur === 'sayfa' ? [`${host} sayfasını takip eder.`, `${once} ${host} sayfası değişti mi bakar; değişmediyse yapay zekâyı çağırmaz.`]
    : tur === 'ekran' ? ['Ekrandaki değişiklikleri takip eder.', `${once} ekranda değişiklik var mı bakar; ${yoksa}`]
    : ['Belirli aralıklarla kendi kendine çalışır.', `${once} kendi kendine uyanır; her seferinde yapay zekâ çalışır.`];
  const b = p.bitis;
  const bitis = b.tur === 'sure' ? `${sureMetni(b.saniye)} sonra biter.`
    : b.tur === 'zaman' ? `${zamanMetni(b.iso)} olunca biter.`
    : b.tur === 'kosul' ? `Şu olunca biter: ${b.aciklama}. En geç ${sureMetni(b.sigorta)} sonra durur.`
    : `Sen durdurana dek sürer; en geç ${sureMetni(b.sigorta)} sonra durur.`;
  const izinler = p.izinler.map((i) =>
    i.tur === 'whatsapp_gonder' ? `${yonelme(i.kisi)}${sonu(i.kisi, i.jid)} WhatsApp’tan yazabilir`
    : i.tur === 'eposta_gonder' ? `${i.adres} adresine e-posta gönderebilir`
    : i.tur === 'ekran' ? 'Ekranı, fareyi ve klavyeyi kullanabilir'
    : `Tarayıcıda ${i.alan} sitesini kullanabilir`);
  const teknik = mod === 'gelistirici' ? ` (aralık ${p.aralik.min}–${p.aralik.max} sn)` : '';
  return { ne, nasil: `${nasil}${uzar}${teknik}`, bitis, izinler, sinir: `En çok ${p.azamiAdim} adım (yapay zekâ en çok ${p.azamiAdim} kez çalışır).` };
}
