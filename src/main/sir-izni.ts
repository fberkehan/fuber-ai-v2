// ── sir:yaz izni (saf; tests/claude-anahtari.test.ts) ─────────────────────────────────────────────────────────────────────────
// 0.13 T15 (Spec H): kimse yapay zekâ API anahtarı girmez — yeni motor/ses anahtarı yazılmaz (silmek her zaman serbest; eski kayıtlar okunmaz).
// 0.14 istisnası (ürün kararı; 5 Kas: Business'ta da): her modda 'api:anthropic' yazılabilir, biçimi geçerliyse (shared/motor-secimi.ts
// claudeAnahtariGecerli). OpenAI, OpenRouter, Fuber ve ElevenLabs anahtarları hiçbir modda yazılmaz. sir:yaz telefondan zaten kapalı
// (kopru-protokol.ts UZAKTAN_KAPALI). Ret metinleri anahtarın kendisini asla içermez.
import { claudeAnahtariGecerli, openaiAnahtariGecerli } from '../shared/motor-secimi.ts';
import type { Mod } from '../shared/tipler.js';

/** Yasak motor/ses anahtarı adları (yazma; silme serbest). */
export const YASAK_ANAHTAR = /^api:(anthropic|openai|openrouter|fuber|elevenlabs)$/;
export const ANAHTAR_REDDI = 'Bu anahtar burada kullanılmaz: Claude için Anthropic anahtarını, öteki sağlayıcılar için "Kendi sağlayıcın (OpenAI uyumlu)" satırını kullan.';
export const CLAUDE_BICIM_REDDI = 'Bu bir Anthropic anahtarına benzemiyor (sk-ant- ile başlar, boşluk içermez).';
export const OPENAI_BICIM_REDDI = 'Bu anahtar geçerli görünmüyor (boşluksuz, 8-512 karakter).';

/** Yazma reddedilecekse Türkçe neden, izinliyse null. `deger` boş/null = silme (her zaman izinli). */
export function sirYazmaReddi(ad: string, deger: string | null | undefined, mod: Mod): string | null {
  if (!deger) return null;
  if (!YASAK_ANAHTAR.test(ad)) return null;
  void mod; // 5 Kas: kural iki modda aynı (imza çağıranlar için korunur)
  if (ad === 'api:anthropic') return claudeAnahtariGecerli(deger) ? null : CLAUDE_BICIM_REDDI;
  // Açık kaynak hazırlığı (11 Kas): kendi OpenAI uyumlu sağlayıcının anahtarı (OpenAI, OpenRouter, başka uyumlu servis) — Fuber hesabı gerekmez.
  if (ad === 'api:openai') return openaiAnahtariGecerli(deger) ? null : OPENAI_BICIM_REDDI;
  return ANAHTAR_REDDI;
}
