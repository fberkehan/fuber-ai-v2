// ── Toplantı: Gemini toplu yazıya çevirme (kullanıcının kendi anahtarıyla; Electron'suz, testte sahte fetch — tests/gemini-yazi.test.ts) ──────────────────────────────
// Anahtar yalnız `x-goog-api-key` başlığında gider (adrese konmaz: günlüklere ve hata iletilerine sızmasın); hata iletilerine gövde ya da anahtar girmez.
import { GEMINI_MODEL, GEMINI_TABAN, GeminiHatasi, geminiDurumNedeni, geminiGovde, geminiYanitCoz } from '../../shared/gemini-yazi.ts';

export type Getir = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function geminiYaziya(wav: Uint8Array, anahtar: string, o: { getir?: Getir; zamanAsimiMs?: number; taban?: string; model?: string } = {}): Promise<string | null> {
  const getir = o.getir ?? ((url, init) => fetch(url, init));
  let r;
  try {
    r = await getir(`${o.taban ?? GEMINI_TABAN}/models/${o.model ?? GEMINI_MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': anahtar },
      body: JSON.stringify(geminiGovde(Buffer.from(wav).toString('base64'))),
      signal: AbortSignal.timeout(o.zamanAsimiMs ?? 20_000),
    });
  } catch { throw new GeminiHatasi('ag'); }
  if (!r.ok) throw new GeminiHatasi(geminiDurumNedeni(r.status), `HTTP ${r.status}`);
  let j: unknown;
  try { j = await r.json(); } catch { throw new GeminiHatasi('bilinmeyen', 'yanıt JSON değil'); }
  return geminiYanitCoz(j);
}
