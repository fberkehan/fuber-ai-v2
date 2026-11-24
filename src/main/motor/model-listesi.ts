// ── Model seçicinin listesi (`motor:model-bilgileri`; Ayarlar → Yapay zekâ → model seçici) ─────────────────────────────────
// Sağlayıcı başına: anahtar kayıtlıysa sağlayıcının ayrıntılı listesi (modelBilgileri — OpenRouter: canlı bağlam/fiyat/yetenek;
// Anthropic: canlı ad/bağlam/yetenek + yerleşik fiyat; OpenAI: kimlikler + yerleşik tablo; Fuber: gateway anahtarları). Anahtar
// yoksa AĞA ÇIKMADAN yerleşik tablo (seçici "anahtar yok" der; satırlar bilgi için görünür). Liste alınamazsa yine yerleşik tablo
// + hata notu. Başarılı liste 10 dk önbellekte (OpenRouter yüzlerce model döndürür; seçici her açılışta beklemesin); taban adresi
// değişince ya da anahtar yeniden yazılınca (ipc.ts sir:yaz → modelOnbelleginiSil) yenilenir.
// Yerel sekme: katalogdaki modeller (0.13 G; yerel/katalog.ts: disk, bellek, ekran kartı gereksinimi, Developer için dosya adı); uygunluğu arayüz sistem:kontrol verisiyle hesaplar.
// Liste diskten okunur, Gizli'de de ağa çıkmaz.
// Hata notu sağlayıcının ham (İngilizce) metni değil, türüne göre kısa Türkçe ileti (listeHatasiMetni: "Anahtar geçersiz…",
// "Bağlantı kurulamadı.").
// Gizli ya da "Yalnız bu bilgisayar" seçiliyken liste sağlayıcıdan HİÇ istenmez (anahtar buluta taşınmasın): yerleşik tablo + `bilgi` notu
// (YEREL_LISTE_NOTU). Bu bilinçli bir mahremiyet davranışıdır, hata değil — not `hata` alanında DEĞİL (0.12 cila; seçici onu kilit simgeli
// sakin satırla gösterir, "Liste alınamadı" kutusuyla değil).
// Test kancası (YALNIZ FUBER_DEMO; ipc.ts → motor:test-model-kaynagi): sağlayıcının HAM yanıtı (kayıtlı örnek JSON) verilir; liste ağa
// çıkmadan GERÇEK dönüşümle ondan üretilir. `{ testHatasi: { status: 401 } }` verilirse sağlayıcı o hatayı vermiş gibi davranılır.
import { ayarlar } from '../ayarlar.js';
import { saglayici } from './secici.js';
import { katalogAciklamasi, katalogListe, modelEskiMi } from '../yerel/katalog.js';
import type { SaglayiciAdi } from '../../shared/tipler.js';
import {
  anthropicDonustur, listeHatasiMetni, openaiDonustur, openRouterDonustur, yerlesikListe, yerlesikBilgi,
  type ModelBilgisi, type ModelKaynagi, type ModelListesi,
} from '../../shared/model-bilgisi.js';
import { canliFiyatlariYaz } from './fiyat-onbellegi.js';
import { neredeYerelMi } from '../../shared/nerede.js';
import { KATALOG_ESKI, KATALOG_KALKTI } from '../../shared/yerel-katalog.js';

/** Gizli ya da "Yalnız bu bilgisayar": liste isteği anahtarı buluta taşır — sağlayıcıya gidilmez, yerleşik tablo gösterilir. */
export const YEREL_LISTE_NOTU = 'Gizli ya da “Yalnız bu bilgisayar” seçiliyken liste sağlayıcıdan alınmaz; yerleşik tablo gösterilir.';

const SAGLAYICILAR: readonly SaglayiciAdi[] = ['anthropic', 'openai', 'openrouter'];
const ONBELLEK_SURESI = 10 * 60_000;
const onbellek = new Map<SaglayiciAdi, { zaman: number; imza: string; liste: ModelListesi }>();
const testKaynaklari = new Map<SaglayiciAdi, unknown>();

/** Yerel beyin modelleri (katalog sırası): disk boyutu (GB, 1e9), bellek ve ekran kartı gereksinimi; açıklamanın sonunda dosya adı (Developer). */
export function yerelModelBilgileri(): ModelBilgisi[] {
  return katalogListe().map((k) => ({
    id: k.id, ad: k.ad, saglayici: 'yerel', aciklama: `${!k.acik ? KATALOG_KALKTI : modelEskiMi(k) ? KATALOG_ESKI : katalogAciklamasi(k)} · ${k.dosya}`, yetenekler: [],
    yerel: { boyutGB: Math.round((k.boyut / 1e9) * 100) / 100, ramGB: k.ramGB, ...(k.vramGB !== undefined ? { vramGB: k.vramGB } : {}), ...(k.acik ? {} : { listedenKalkti: true }) },
  }));
}

/** Sağlayıcının ham yanıtı → satırlar (test kancası ve modelBilgileri olmayan sağlayıcı için). */
function hamdan(s: SaglayiciAdi, ham: unknown): ModelBilgisi[] {
  if (s === 'openrouter') return openRouterDonustur(ham);
  if (s === 'anthropic') return anthropicDonustur(ham);
  if (s === 'openai') return openaiDonustur(ham);
  return [];
}

export async function modelListesi(s: ModelKaynagi): Promise<ModelListesi> {
  if (s === 'yerel') return { saglayici: 'yerel', modeller: yerelModelBilgileri(), kaynak: 'yerlesik' };
  if (!SAGLAYICILAR.includes(s)) throw new Error('Geçersiz sağlayıcı');
  if (process.env.FUBER_DEMO && testKaynaklari.has(s)) {
    const ham = testKaynaklari.get(s) as { testHatasi?: unknown } | null;
    if (ham && typeof ham === 'object' && 'testHatasi' in ham) return { saglayici: s, modeller: yerlesikListe(s), kaynak: 'yerlesik', hata: listeHatasiMetni(ham.testHatasi) };
    const modeller = hamdan(s, ham);
    canliFiyatlariYaz(s, modeller);
    return { saglayici: s, modeller, kaynak: 'canli' };
  }
  const a = ayarlar().saglayicilar[s];
  if (!a.anahtarVar) return { saglayici: s, modeller: yerlesikListe(s), kaynak: 'yerlesik' };
  if (neredeYerelMi(ayarlar().yerel)) return { saglayici: s, modeller: yerlesikListe(s), kaynak: 'yerlesik', bilgi: YEREL_LISTE_NOTU };
  const imza ='tabanUrl' in a ? a.tabanUrl : '';
  const k = onbellek.get(s);
  if (k && k.imza === imza && Date.now() - k.zaman < ONBELLEK_SURESI) return k.liste;
  try {
    const p = saglayici(s);
    const modeller = p.modelBilgileri ? await p.modelBilgileri() : hamdan(s, await p.modeller());
    if (!modeller.length) return { saglayici: s, modeller: yerlesikListe(s), kaynak: 'yerlesik', hata: 'Sağlayıcı boş liste döndürdü.' };
    const liste: ModelListesi = { saglayici: s, modeller, kaynak: 'canli' };
    onbellek.set(s, { zaman: Date.now(), imza, liste });
    canliFiyatlariYaz(s, modeller); // Kullanım: tabloda olmayan kimliklerin (OpenRouter) fiyatı
    return liste;
  } catch (e) {
    console.warn(`[model-listesi] ${s}: ${(e as Error)?.message ?? e}`); // ayrıntı günlükte; arayüzde kısa Türkçe ileti
    return { saglayici: s, modeller: yerlesikListe(s), kaynak: 'yerlesik', hata: listeHatasiMetni(e) };
  }
}

/** Anahtar yazıldı/silindi: o sağlayıcının listesi yeniden alınsın. */
export function modelOnbelleginiSil(s?: SaglayiciAdi): void {
  if (s) onbellek.delete(s); else onbellek.clear();
}

/** YALNIZ FUBER_DEMO: sağlayıcının ham yanıtını ayarla (null: kaldır). */
export function testModelKaynagi(s: SaglayiciAdi, ham: unknown): void {
  if (!process.env.FUBER_DEMO || !SAGLAYICILAR.includes(s)) return;
  if (ham === null || ham === undefined) testKaynaklari.delete(s); else testKaynaklari.set(s, ham);
  onbellek.delete(s);
}

/**
 * İnceleme I4 (analiz 11 Kas bulgu 10): seçili bulut modeli görsel okur mu — true / false (kesin) / null (bilinmiyor: görsel gönderilir, uydurma ret
 * yok). Kaynak: sağlayıcının canlı listesi (önbellekte değilse en çok `beklemeMs` beklenir; Fuber /models `supportsVision`, OpenRouter modaliteleri,
 * Anthropic yetenekleri), yoksa yerleşik tablo. Gizli / "Yalnız bu bilgisayar"da sağlayıcıya gidilmez.
 */
export async function gorselOkurMu(s: SaglayiciAdi, model: string, beklemeMs = 2000): Promise<boolean | null> {
  if (!SAGLAYICILAR.includes(s) || !model) return null;
  let liste: ModelListesi | null = null;
  const k = onbellek.get(s);
  if (k) liste = k.liste;
  else if (!neredeYerelMi(ayarlar().yerel)) {
    liste = await Promise.race([modelListesi(s).catch(() => null), new Promise<null>((c) => setTimeout(() => c(null), beklemeMs))]);
  }
  const m = liste?.modeller.find((x) => x.id === model);
  if (m?.gorselKesin) return m.yetenekler.includes('gorsel');
  const t = yerlesikBilgi(s, model);
  return t ? t.yetenekler.includes('gorsel') : null;
}

/** Modelin görünen adı: önbellekteki canlı listeden (geçidin verdiği ad), yoksa yerleşik/kimlikten (notlarda kullanılır). */
export function canliModelAdi(s: SaglayiciAdi, model: string): string | undefined {
  const l = onbellek.get(s)?.liste.modeller ?? (process.env.FUBER_DEMO && testKaynaklari.has(s) ? hamdan(s, testKaynaklari.get(s)) : undefined);
  return l?.find((x) => x.id === model)?.ad;
}
