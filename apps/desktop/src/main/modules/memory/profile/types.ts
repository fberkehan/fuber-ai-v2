// Kullanıcı profili (hafızanın yapılandırılmış katmanı): Jarvis'in kullanıcıyı NASIL tanıdığı. Serbest hafıza kayıtları
// (`memory_items`: bilgi / olay / söz) aranır; profil ise her turda isteme giren, kategorili, çelişkisi çözülmüş özdür.
import type { Channel, Id, IsoDateTime, Ok } from '@fuber/shared';

/**
 * Profil kategorileri.
 *  identity   kimlik (ad, hitap, yaş, yaşadığı yer, meslek)
 *  circle     yakın çevre (aile, ortaklar, ekip, muhasebeci…)
 *  work       işler, şirketler, projeler
 *  preference tercihler ("böyle isterim")
 *  style      üslup ve hitap (nasıl konuşulmasını ister)
 *  routine    rutinler (saatler, alışkanlıklar)
 *  interest   ilgi alanları ve takip ettiği konular
 *  dislike    sevmedikleri, istemedikleri
 *  ongoing    sürmekte olan meseleler
 *  rule       davranış kuralı: "bunu böyle yap / bir daha böyle yapma" (her turda uygulanır)
 */
export const PROFILE_CATEGORIES = ['identity', 'circle', 'work', 'preference', 'style', 'routine', 'interest', 'dislike', 'ongoing', 'rule'] as const;
export type ProfileCategory = (typeof PROFILE_CATEGORIES)[number];

/**
 * Bilginin nereden geldiği (güvenin dayanağı):
 *  said      kullanıcı açıkça söyledi (kodla yakalanan açık söz ya da modelin kullanıcının sözünden çıkardığı)
 *  inferred  model konuşmadan çıkardı (kullanıcı böyle demedi)
 *  observed  davranıştan öğrenildi (yinelenen istek, onay/ret, brifinge ilgi)
 *  user      kullanıcı Hafıza sayfasında elle yazdı ya da düzeltti
 *  intro     tanışma sorusuna verdiği yanıt
 */
export type ProfileOrigin = 'said' | 'inferred' | 'observed' | 'user' | 'intro';

export interface ProfileItem {
  id: Id;
  category: ProfileCategory;
  /** Konu anahtarı (katlanmış, kısa): aynı kategoride aynı anahtar AYNI konudur; yenisi eskisinin yerini alır. */
  key: string;
  /** Tek başına anlaşılır, üçüncü kişi ağzından kısa cümle: "Yanıtların kısa olmasını ister." */
  text: string;
  /** 0–1. Açık söz 1,0 · model çıkarımı 0,7 · davranıştan 0,5–0,8 (yinelendikçe artar). */
  confidence: number;
  origin: ProfileOrigin;
  channel: Channel | 'system' | 'ui';
  /** Kaynak tur (hangi konuşmada, hangi sözde öğrenildi); elle eklenende `null`. */
  sessionId: Id | null;
  messageId: Id | null;
  learnedAt: IsoDateTime;
  updatedAt: IsoDateTime;
  /** Aynı bilgi kaç kez yinelendi / doğrulandı. */
  confirmations: number;
  /** Kullanıcı elle düzeltti: kendiliğinden öğrenme bu kaydın üstüne yazmaz (yalnız kullanıcının yeni açık sözü). */
  locked: boolean;
  status: 'active' | 'superseded';
  /** Bu kaydın yerini alan yeni kayıt; etkinse `null`. */
  supersededBy: Id | null;
  /** Bu kayıt bir eskisinin yerini aldıysa eskisinin metni ("önceden: …"); yoksa `null`. */
  previousText: string | null;
}

export interface ProfileGroup {
  category: ProfileCategory;
  /** Kategorinin Türkçe adı. */
  title: string;
  items: ProfileItem[];
}

export interface ProfileIntroState {
  /** Tanışma soruları açık mı (kullanıcı "sorma" dediyse kapalı). */
  enabled: boolean;
  /** Sorulan ve yanıtlanan soru sayısı. */
  asked: number;
  answered: number;
  /** Kullanıcı istemediğini söylediyse o an. */
  declinedAt: IsoDateTime | null;
  /** Profilde hâlâ boş olan, sorulabilecek alanlar (Türkçe kısa ad). */
  missing: string[];
}

/** Hafıza sayfasındaki "Beni nasıl tanıyorsun" görünümü. */
export interface ProfileOverview {
  /** İnsan diliyle kısa özet (2–6 cümle); profil boşsa "henüz tanımıyorum" cümlesi. */
  summary: string;
  groups: ProfileGroup[];
  /** Etkin kayıt sayısı ve davranış kuralı sayısı. */
  total: number;
  rules: number;
  /** Son değişen kayıtların geçmişi (yeni bilgi eskisinin yerini aldı): en yeni önce, en çok 20. */
  history: Array<{ id: Id; category: ProfileCategory; text: string; replacedBy: string; at: IsoDateTime }>;
  intro: ProfileIntroState;
  /** Her turda isteme giren bloğun o anki boyu (karakter): zengin yol ve yerel yol. */
  promptChars: { rich: number; compact: number };
  /** İlk kaydın öğrenildiği an (kaç gündür tanıyor); profil boşsa `null`. */
  since: IsoDateTime | null;
}

export interface ProfileSaveInput {
  /** Verilirse o kayıt düzeltilir; verilmezse yeni kayıt açılır. */
  id?: Id;
  category: ProfileCategory;
  text: string;
}

declare module '@fuber/shared' {
  interface Api {
    'memory.profile.get': { req: void; res: ProfileOverview };
    /** Elle ekleme ya da düzeltme: güven 1, kayıt kilitlenir (kendiliğinden öğrenme ezmez). */
    'memory.profile.save': { req: ProfileSaveInput; res: ProfileItem };
    /** Kaydı ve yerini aldığı eski sürümleri KALICI siler. */
    'memory.profile.remove': { req: { id: Id }; res: Ok };
    /** Tanışma sorularını açar/kapatır. */
    'memory.profile.setIntro': { req: { enabled: boolean }; res: ProfileIntroState };
  }
  interface BusEvents {
    'memory.profile.changed': { reason: 'learned' | 'edited' | 'removed' | 'intro'; ids: Id[] };
  }
  interface WindowEvents {
    'memory.profile.changed': { reason: 'learned' | 'edited' | 'removed' | 'intro'; ids: Id[] };
  }
}
