// F1 düzeltme turu 1 (K-3): Geliştiricinin kendi Claude / OpenAI / OpenRouter anahtarlarında SDK'ların İÇ yeniden denemesi kapalı
// (maxRetries: 0). SDK 429/5xx/bağlantı hatasında kendi içinde yeniden gönderirse bu denemeler motor/secici.ts'in yeniden deneme döngüsüne
// dönmeden yapılır ve arada yol denetimi (Gizli mod açıldı mı — K2) olmaz: aynı bağlam buluta yeniden giderdi. Yeniden denemeyi yalnız
// secici yapar (artan bekleme + her denemeden önce yol). Sınama: gerçek motor/anthropic.ts ve motor/openai.ts, bu bilgisayardaki sahte
// sunucu (yalnız 127.0.0.1; her istek 503) — sağlayıcı BİR istek atıp hatayı çağırana verir.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';

let istekler: string[] = [];
const sunucu = http.createServer((q, r) => {
  istekler.push(`${q.method} ${q.url}`);
  r.writeHead(503, { 'content-type': 'application/json' });
  r.end(JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'sahte sunucu yoğun' } }));
});
await new Promise<void>((c) => sunucu.listen(0, '127.0.0.1', c));
after(() => new Promise<void>((c) => sunucu.close(() => c())));
const taban = `http://127.0.0.1:${(sunucu.address() as { port: number }).port}`;

anaSurecSahnesi('sdk-yeniden', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false }, baslangictaAc: false,
});
await esbuildHazir();
// Claude SDK'sı adresi ortamdan da okur: yalnız bu dosyanın sahte sunucusu (gerçek api.anthropic.com'a hiçbir şey gitmez).
process.env.ANTHROPIC_BASE_URL = taban;
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;
const { anthropicSaglayici } = await import('../src/main/motor/anthropic.ts');
const { openaiSaglayici } = await import('../src/main/motor/openai.ts');

test('K-3: Claude SDK 503\'te kendi içinde yeniden denemez (tek istek; yeniden deneme secici\'de, yol denetimiyle)', async () => {
  istekler = [];
  const s = anthropicSaglayici(() => 'SAHTE-claude-anahtari', () => 'gelistirici');
  await assert.rejects(s.modeller());
  assert.equal(istekler.length, 1, JSON.stringify(istekler));
});

test('K-3: OpenAI / OpenRouter SDK 503\'te kendi içinde yeniden denemez (tek istek)', async () => {
  for (const ad of ['openai', 'openrouter'] as const) {
    istekler = [];
    const s = openaiSaglayici(ad, () => 'SAHTE-openai-anahtari', () => `${taban}/v1`, () => 'gelistirici');
    await assert.rejects(s.modeller());
    assert.equal(istekler.length, 1, `${ad}: ${JSON.stringify(istekler)}`);
  }
});
