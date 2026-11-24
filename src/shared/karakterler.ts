// ── Kipler ve karakterler (0.13 A; saf; tests/karakterler.test.ts) — iki kipin (Business mode / Developer mode) karakter sözleşmesinin TEK kaynağı ──
// Barındırılan servis (bu sürümde yok) iki kipi de dönebilir: ad, tanım, sistem istemi, görsel (Faz 2, boş). Ses kimliği (`sesId`) BİLEREK burada yok:
// ses serviste kalır, istemci seslendirme isteğine yalnız `kip` ekler. Servis karakter vermezse masaüstü aşağıdaki gömülü varsayılanlarla çalışır —
// 0.12 kurulumları bozulmaz; bozuk kayıt gelirse son geçerli kayıt korunur, o da yoksa yine gömülüler. Karakter istemi Fuber'in güvenlik ve araç
// kurallarının (kisilik.ts) ÜSTÜNE eklenir, onları ezemez.
import type { Mod } from './tipler.ts';

export type KipKimligi = 'business' | 'developer';
export interface Karakter {
  kip: KipKimligi;
  ad: string;
  /** Yönetim ve seçicide görünen tek satırlık tanım. */
  tanim: string;
  /** Fuber'in kurallarının üstüne eklenen kişilik istemi. */
  sistemIstemi: string;
  /** Karakter görseli (Faz 2; şimdilik hep null). */
  gorsel: string | null;
  /** 0.14 son inceleme I5: Sade modun nötr kimliği (shared/karakter-gorunum.ts turKarakteri); sunucu kaydında yoktur. */
  sade?: true;
}

/** Kullanıcı metninde kip adları çevrilmez; dört dilde aynıdır. İç değerler (`'is'`, `'gelistirici'`) değişmez. */
export const KIP_ADI: Record<Mod, string> = { is: 'Business mode', gelistirici: 'Developer mode' };
/** Sade modda (karakter yok) kip kartlarının tek cümlesi: kişilik değil, kipin işlevi (11 Kas, tasarımcı bulgu 10). */
export const KIP_ISLEVI: Record<Mod, string> = {
  is: 'Günlük işler: e-posta, takvim, hatırlatıcı ve özetler.',
  gelistirici: 'Günlük işlere ek olarak kod ve terminal işleri.',
};
export const modKip = (m: Mod): KipKimligi => (m === 'gelistirici' ? 'developer' : 'business');
/** Arayüzden ana sürece gelen kip güvenilmez girdidir (ses:konus-baslat): yalnız iki geçerli kip, ötesi undefined (ana süreç şu anki kipe bakar). */
export const kipTemizle = (x: unknown): KipKimligi | undefined => (x === 'business' || x === 'developer' ? x : undefined);

/** Görünen ad: iki modda da "Fuber" (11 Kas: hayvanlar yerine gözler seçildi; ad ve kişilik hayvan kimliği taşımaz). */
export const FUBER_AD = 'Fuber';

/** Gömülü taslaklar (Yönetim'den değiştirilebilir). Ton modun: Business sıcak ve iş odaklı, Developer teknik. Hayvan kimliği yok. Fuber'in güvenlik ve
 *  onay kapıları (gönderim, silme) gevşemez. */
export const VARSAYILAN_KARAKTERLER: Record<KipKimligi, Karakter> = {
  business: {
    kip: 'business',
    ad: FUBER_AD,
    tanim: 'Sıcak, açık sözlü, işini bilen iş ortağı.',
    sistemIstemi: [
      'Üslubun: kullanıcının sıcak ve işini bilen iş ortağısın. Kısa, net ve güler yüzlü konuşursun; önce cevabı verir, gerekirse gerekçeyi tek',
      'cümleyle eklersin. Pazarlık, fiyat ve risk konusunda dürüst görüş bildirirsin: iyi bir fikre iyi, zayıf bir fikre nazikçe ama açıkça zayıf',
      'dersin. Gereksiz çekince ve uzun uyarı yok; yine de yasa dışı işlere yardım etmezsin. Bu üslup Fuber\'in güvenlik ve araç kurallarının',
      'üstüne eklenir, onları gevşetmez: e-posta gönderme, silme gibi işler için kullanıcının onayını almadan ilerlemezsin. Sırları (şifre,',
      'anahtar) yazıya dökmezsin.',
    ].join(' '),
    gorsel: null,
  },
  developer: {
    kip: 'developer',
    ad: FUBER_AD,
    tanim: 'Teknik, dikkatli, sınırları net geliştirici yoldaşı.',
    sistemIstemi: [
      'Üslubun: kullanıcının teknik ve dikkatli geliştirici yoldaşısın. Kesin ve gerektiği kadar ayrıntılı konuşursun; dosya, komut ve hata adlarını',
      'olduğu gibi yazarsın. Sınırlarını baştan söylersin: neyi yapabildiğini, neyi yapmadığını, neyden emin olmadığını açıkça belirtirsin; tahmini',
      'kesin bilgi gibi sunmazsın. Değişiklik yapmadan önce ne yapacağını bir cümleyle anlatır, geri alınamaz işlerde önce durup sorarsın. Kodda',
      've komutta doğruluk önce gelir. Bu üslup Fuber\'in güvenlik ve araç kurallarının üstüne eklenir, onları gevşetmez: silme, gönderme,',
      'çalıştırma gibi işlerde kullanıcının onayı şarttır. Sırları (şifre, anahtar) yazıya dökmezsin.',
    ].join(' '),
    gorsel: null,
  },
};

/** Eski hayvan kimliğinin izi (sunucudaki eski kayıt: canlı sunucu ayrı bir yayınla güncellenir). */
const ESKI_KIMLIK = /tilki|bukalemun|\bfox\b|chameleon/i;
/** Kipin kimliği: ad her zaman "Fuber"; tanım ya da istem eski hayvan kimliğini taşıyorsa (sunucu henüz güncellenmedi) o alan gömülü taslaktan gelir.
 *  Yönetim'den yazılan hayvansız ton olduğu gibi kalır. */
export function fuberKimligi(k: Karakter): Karakter {
  const v = VARSAYILAN_KARAKTERLER[k.kip] ?? VARSAYILAN_KARAKTERLER.business;
  return {
    ...k,
    ad: FUBER_AD,
    tanim: ESKI_KIMLIK.test(k.tanim) ? v.tanim : k.tanim,
    sistemIstemi: ESKI_KIMLIK.test(k.sistemIstemi) ? v.sistemIstemi : k.sistemIstemi,
  };
}

const KIPLER: readonly KipKimligi[] = ['business', 'developer'];
const kisaMetin = (v: unknown, en: number, bosOlur = false): string | undefined => {
  if (typeof v !== 'string' || v.length > en) return undefined;
  const t = v.trim();
  return t || bosOlur ? t : undefined;
};

/** Sunucunun `karakterler` alanı güvenilmez girdidir: iki kipin ikisi de geçerli değilse null (yarım kayıt kullanılmaz). `sesId` ve bilinmeyen
 *  alanlar düşer. Görsel yalnız kısa bir metin ya da null olabilir. */
export function karakterlerDogrula(x: unknown): Record<KipKimligi, Karakter> | null {
  if (!x || typeof x !== 'object') return null;
  const y = x as Record<string, unknown>;
  const sonuc = {} as Record<KipKimligi, Karakter>;
  for (const kip of KIPLER) {
    const k = y[kip];
    if (!k || typeof k !== 'object') return null;
    const r = k as Record<string, unknown>;
    const ad = kisaMetin(r.ad, 60);
    const tanim = kisaMetin(r.tanim ?? '', 300, true);
    const sistemIstemi = kisaMetin(r.sistemIstemi, 8000);
    if (!ad || tanim === undefined || !sistemIstemi) return null;
    const gorsel = typeof r.gorsel === 'string' && r.gorsel.length <= 2048 ? r.gorsel : null;
    sonuc[kip] = { kip, ad, tanim, sistemIstemi, gorsel };
  }
  return sonuc;
}

/** Geçerli kipin karakteri: sunucudan gelen kayıt varsa o, yoksa gömülü varsayılan. */
export const etkinKarakter = (mod: Mod, k: Record<KipKimligi, Karakter> | undefined): Karakter => fuberKimligi((k ?? VARSAYILAN_KARAKTERLER)[modKip(mod)]);
