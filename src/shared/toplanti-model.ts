// ── Toplantı modu: model ve yazıya çevirme seçimi (13 Kas 2026, 0.17.3; saf — tests/toplanti.test.ts) ─────────────────────────────────────────────
// Toplantıda modeller değiştirilemiyordu. Toplantı sayfasında iki seçim: "Çeviri ve öneri" modeli ve "Yazıya çevirme" yolu. Kurallar uygulamanın geneliyle aynı:
//  · Business'ta sade ad (Hızlı / Dengeli / En güçlü), Developer'da model adı (shared/model-bilgisi.ts modelAdi).
//  · Gizli ve "Yalnız bu bilgisayar"da (P14) YALNIZ bu bilgisayardaki yapay zekâ ve Whisper; bulut seçeneği görünmez (hiçbir ses ya da metin buluta gitmez).
//  · Claude modelleri yalnız Claude (Anthropic) etkinken (kullanıcının kendi anahtarı) seçilebilir; Fuber hesabında model sunucuda sabittir ("Fuber").
//  · Seçim kalıcıdır (main/toplanti/tercih.ts) ve toplantı sürerken de değişir: her istek seçimi o an okur, değişiklik SONRAKİ istekte devreye girer.
import { claudeModelGecerli } from './motor-secimi.ts';
import { ONERILEN_MODELLER, modelAdi } from './model-bilgisi.ts';

/** 'gemini' (0.18.2): kullanıcının kendi Google anahtarıyla toplu yazıya çevirme (shared/gemini-yazi.ts); yalnız anahtar kayıtlıyken ve Gizli değilken geçerlidir. */
export type YaziTercihi = 'otomatik' | 'bulut' | 'yerel' | 'gemini';
/** `yz`: 'varsayilan' (uygulamanın bugünkü seçimi) | 'yerel' (bu bilgisayar) | bir Claude model kimliği. */
export interface ToplantiTercihi { yz: string; yazi: YaziTercihi }
export const VARSAYILAN_TERCIH: Readonly<ToplantiTercihi> = { yz: 'varsayilan', yazi: 'otomatik' };

/** Diskten/arayüzden gelen ham değeri temiz tercihe indirir (bilinmeyen alan düşer, geçersiz değer varsayılana döner). */
export function tercihTemizle(ham: unknown, onceki: ToplantiTercihi = VARSAYILAN_TERCIH): ToplantiTercihi {
  const o = ham && typeof ham === 'object' && !Array.isArray(ham) ? (ham as Record<string, unknown>) : {};
  const yz = typeof o.yz === 'string' && (o.yz === 'varsayilan' || o.yz === 'yerel' || claudeModelGecerli(o.yz)) ? o.yz : onceki.yz;
  const yazi: YaziTercihi = o.yazi === 'bulut' || o.yazi === 'yerel' || o.yazi === 'otomatik' || o.yazi === 'gemini' ? o.yazi : onceki.yazi;
  return { yz, yazi };
}

export interface SecimSecenegi { deger: string; etiket: string; aciklama?: string; devreDisi?: boolean }

export interface YzBaglami {
  /** Gizli ya da "Yalnız bu bilgisayar". */
  bulutsuz: boolean;
  gelistirici: boolean;
  /** Claude (Anthropic) seçili ve anahtar kayıtlı. */
  claudeSecili: boolean;
  yerelHazir: boolean;
  yerelAd?: string;
  /** Uygulamanın bugünkü seçiminin üst şerit etiketi (ör. "Fuber", "Claude Haiku 5.5"). */
  varsayilanEtiket: string;
  /** Claude yardımcı rolünün şimdiki modeli (listede yoksa eklenir). */
  claudeYardimci?: string;
}

/** Business'ta sade ad: model ailesine göre. Developer'da model adı. */
export function sadeModelAdi(id: string): string {
  if (/haiku/i.test(id)) return 'Hızlı';
  if (/sonnet/i.test(id)) return 'Dengeli';
  if (/opus/i.test(id)) return 'En güçlü';
  return 'Gelişmiş';
}
export const claudeEtiketi = (id: string, gelistirici: boolean): string => (gelistirici ? modelAdi('anthropic', id) : sadeModelAdi(id));

const yerelEtiketi = (g: Pick<YzBaglami, 'gelistirici' | 'yerelAd'>): string => (g.gelistirici && g.yerelAd ? `Bu bilgisayar · ${g.yerelAd}` : 'Bu bilgisayar');

/** "Çeviri ve öneri" için seçilebilen modeller. Gizli/"Yalnız bu bilgisayar"da yalnız yerel (bulut satırı hiç yok). */
export function yzSecenekleri(g: YzBaglami): SecimSecenegi[] {
  const yerel: SecimSecenegi = { deger: 'yerel', etiket: yerelEtiketi(g), ...(g.yerelHazir ? {} : { aciklama: 'Hazır değil', devreDisi: true }) };
  if (g.bulutsuz) return [yerel];
  const l: SecimSecenegi[] = [{ deger: 'varsayilan', etiket: g.varsayilanEtiket, aciklama: 'Uygulamanın seçimi' }];
  if (g.claudeSecili) {
    const idler = [...new Set([...(g.claudeYardimci ? [g.claudeYardimci] : []), ...ONERILEN_MODELLER.anthropic])];
    for (const id of idler) l.push({ deger: id, etiket: claudeEtiketi(id, g.gelistirici), ...(g.gelistirici ? { aciklama: id } : {}) });
  }
  l.push(yerel);
  return l;
}

/** Tercihin bu bağlamda GEÇERLİ karşılığı: Gizli'de her şey yerel; seçilen Claude artık etkin değilse ya da liste dışıysa varsayılan. */
export type YzKarari = { tur: 'varsayilan' } | { tur: 'yerel' } | { tur: 'model'; model: string };
export function yzKarari(tercih: string, g: YzBaglami): YzKarari {
  if (g.bulutsuz) return { tur: 'yerel' };
  if (tercih === 'yerel') return { tur: 'yerel' };
  if (g.claudeSecili && claudeModelGecerli(tercih)) return { tur: 'model', model: tercih };
  return { tur: 'varsayilan' };
}
/** Seçicide işaretli değer (kararın seçenek karşılığı). */
export const yzSeciliDeger = (tercih: string, g: YzBaglami): string => { const k = yzKarari(tercih, g); return k.tur === 'model' ? k.model : k.tur === 'yerel' ? 'yerel' : 'varsayilan'; };
/** Üst şerit etiketi: karar neyse onun adı (varsayılanda uygulamanın kendi etiketi). */
export function yzEtiketi(tercih: string, g: YzBaglami): string {
  const k = yzKarari(tercih, g);
  if (k.tur === 'yerel') return g.yerelHazir ? yerelEtiketi(g) : `${yerelEtiketi(g)} (hazır değil)`;
  if (k.tur === 'model') return claudeEtiketi(k.model, g.gelistirici);
  return g.varsayilanEtiket;
}

export interface YaziBaglami { bulutsuz: boolean; gelistirici: boolean; hesapVar: boolean; whisperKurulu: boolean; /** Kullanıcının Gemini anahtarı kayıtlı. */ geminiVar?: boolean }

/** "Yazıya çevirme" için seçilebilen yollar. Gizli/"Yalnız bu bilgisayar"da bulut yolu hiç gösterilmez (P14). */
export function yaziSecenekleri(g: YaziBaglami): SecimSecenegi[] {
  const yerel: SecimSecenegi = { deger: 'yerel', etiket: g.gelistirici ? 'Bu bilgisayar · Whisper' : 'Bu bilgisayar', aciklama: g.whisperKurulu ? undefined : 'İndirilmeli' };
  if (g.bulutsuz) return [yerel];
  return [
    { deger: 'bulut', etiket: 'Bulut', ...(g.hesapVar ? {} : { aciklama: 'Bu derlemede yok', devreDisi: true }) },
    yerel,
    ...(g.geminiVar ? [{ deger: 'gemini', etiket: 'Gemini', aciklama: 'Google hesabınla' }] : []),
  ];
}
/** Seçicide işaretli yol: otomatikte hesap varsa bulut, yoksa bu bilgisayar; Gizli'de hep yerel; hesapsızken 'bulut' tercihi yerele iner. */
export function yaziSeciliDeger(tercih: YaziTercihi, g: Pick<YaziBaglami, 'bulutsuz' | 'hesapVar' | 'geminiVar'>): 'bulut' | 'yerel' | 'gemini' {
  if (g.bulutsuz) return 'yerel';
  if (tercih === 'gemini' && g.geminiVar) return 'gemini';
  if (tercih === 'yerel') return 'yerel';
  return g.hesapVar ? 'bulut' : 'yerel';
}
