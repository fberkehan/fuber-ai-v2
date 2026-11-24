// Beyin "Nasıl çalışır? Canlandır" anlatımı: AÇIKÇA etiketli örnek senaryo (gerçek akışa karışmaz). Telefon (Fuber AI) bu adımları kullanır;
// masaüstünde Beyin sayfası yok (Etkinlik). ms: bir önceki adımdan sonra bekleme; yazi: adımın anlatımı.
// 0.13 T15: anlatımda bölge adı yok (Kulak, Yazıcı, Eşlikçi, Akıl…): düz cümleler. İç bölge kimlikleri (kulak, yazici…) olay verisinde kalır.
import type { BeyinOlayi, BolgeId } from '../../shared/beyin';

export type DemoOlay = Omit<BeyinOlayi, 'id' | 'zaman'>;
export interface Adim { ms: number; yazi?: string; olaylar: DemoOlay[] }
const B = (bolge: BolgeId, metin?: string): DemoOlay => ({ tur: 'basla', bolge, metin });
const BT = (bolge: BolgeId): DemoOlay => ({ tur: 'bitti', bolge });
const S = (bolge: BolgeId, hedef: BolgeId, metin?: string): DemoOlay => ({ tur: 'sinyal', bolge, hedef, metin });
const MI = (bolge: BolgeId, model: string): DemoOlay => ({ tur: 'motor', faz: 'istek', bolge, motor: 'anthropic', model });
const MY = (bolge: BolgeId, model: string): DemoOlay => ({ tur: 'motor', faz: 'yanit', bolge, motor: 'anthropic', model });
const HAIKU = 'claude-haiku-5-5', OPUS = 'claude-opus-5-5';
export const SENARYO: Adim[] = [
  { ms: 300, yazi: 'Mikrofon ortamı dinliyor. Fuber, bir konuşmanın nerede başlayıp bittiğini cihazda buluyor.', olaylar: [B('kulak')] },
  { ms: 2200, yazi: '“Ali kira sözleşmesini cumartesi gönderecek.” 3,2 saniyelik bölüm yazıya çevrilmeye gidiyor; ses diske yazılmıyor.', olaylar: [S('kulak', 'yazici'), BT('kulak'), B('yazici')] },
  { ms: 2400, yazi: 'Whisper yazıya döktü. Fuber soruyor: araya girmeli miyim? Önce notlarda ve hafızada iz arıyor.', olaylar: [BT('yazici'), S('yazici', 'eslikci'), B('eslikci'), S('eslikci', 'hafiza')] },
  { ms: 2200, yazi: 'İz var; karar için ucuz yardımcı modele soruyor.', olaylar: [MI('eslikci', HAIKU)] },
  { ms: 2000, yazi: 'Karar: şimdilik sus. Gereksiz yere konuşmaz.', olaylar: [MY('eslikci', HAIKU), BT('eslikci')] },
  { ms: 2000, yazi: 'Birikmiş satırlar TOPLU okunuyor (token yemesin): 1 önemli madde, 1 takip edilecek iş: Ali · hedef cumartesi.', olaylar: [S('yazici', 'not'), B('not'), MI('not', HAIKU)] },
  { ms: 2600, yazi: 'Kalıcı bilgi Hafıza’ya geçti.', olaylar: [MY('not', HAIKU), S('not', 'hafiza'), BT('not')] },
  { ms: 2200, yazi: '“Hey Fuber, Ali sözleşmeyi gönderdi mi?” Asistan açılıyor, soru Fuber’e gidiyor.', olaylar: [S('kulak', 'uyanma'), B('uyanma'), S('uyanma', 'ajan'), BT('uyanma'), B('ajan')] },
  { ms: 2200, yazi: 'Fuber hafızaya ve gün kaydına bakıp ana modelle düşünüyor.', olaylar: [S('ajan', 'hafiza'), MI('ajan', OPUS)] },
  { ms: 2800, yazi: '“Henüz göndermedi; hedef cumartesi. Cuma akşamı hatırlatayım mı?” Yanıt sesli okunuyor, hatırlatıcı kuruluyor.', olaylar: [MY('ajan', OPUS), S('ajan', 'saat'), B('saat'), S('ajan', 'ses'), B('ses')] },
  { ms: 2400, yazi: 'Kokpit yeniden diziliyor: hatırlatıcı sol üste çıkıyor.', olaylar: [BT('saat'), BT('ses'), S('ajan', 'kokpit'), B('kokpit'), MI('kokpit', HAIKU)] },
  { ms: 2200, olaylar: [MY('kokpit', HAIKU), BT('kokpit'), BT('ajan')] },
  { ms: 1200, yazi: 'Gün sonu: günün notlarından rapor yazılıyor; önemsizlerden günün esprisi çıkıyor.', olaylar: [S('not', 'rapor'), B('rapor'), MI('rapor', HAIKU)] },
  { ms: 2800, yazi: 'Rapor sohbete düşüyor. Haftalık rapor günlüklerin, aylık rapor haftalıkların süzülmüşü.', olaylar: [MY('rapor', HAIKU), S('rapor', 'ajan'), BT('rapor')] },
  { ms: 2600, yazi: 'Saatte bir eski notlara bakılıyor: süresi dolan önemsiz notlar siliniyor; önemliler rapora taşınmış durumda.', olaylar: [B('bekci'), S('bekci', 'not')] },
  { ms: 2400, yazi: 'Gerçek etkinlik de aynı biçimde, anında akar.', olaylar: [BT('bekci')] },
  { ms: 2600, olaylar: [] },
];

/** İş modundaki anlatım (Ruling O / K6): aynı adımlar, sağlayıcı/model/token adı olmadan (motor çağrıları "Fuber’in yapay zekâsı"
 *  hapına akar; model kimliği Beyin sayfasında İş modunda yazılmaz: shared/beyin.ts olayMetni). */
const YAZI_IS: Readonly<Record<number, string>> = {
  2: 'Yazıya döküldü. Fuber soruyor: araya girmeli miyim? Önce notlarda ve hafızada iz arıyor.',
  3: 'İz var; karar için Fuber’in yapay zekâsına kısa bir soru soruyor.',
  5: 'Birikmiş satırlar tek tek değil TOPLU okunuyor: 1 önemli madde, 1 takip edilecek iş: Ali · hedef cumartesi.',
  8: 'Fuber hafızaya ve gün kaydına bakıp kendi yapay zekâsıyla düşünüyor.',
};
export const SENARYO_IS: Adim[] = SENARYO.map((a, i) => (YAZI_IS[i] ? { ...a, yazi: YAZI_IS[i] } : a));
/** Moda göre anlatım (masaüstü Beyin sayfası; telefon kendi SENARYO'sunu kullanır). */
export const senaryo = (mod: 'is' | 'gelistirici'): Adim[] => (mod === 'is' ? SENARYO_IS : SENARYO);
