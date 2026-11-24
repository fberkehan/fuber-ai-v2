// Fake OpenAI-compatible gateway (127.0.0.1 only): POST /v1/chat/completions records the request and streams the next queued reply.
// Tools are requested with a small text convention in the queued reply (<arac ad="name">{json}</arac>), which the fake turns into real
// OpenAI `tool_calls` deltas. Mode 'yanki' echoes everything after the context block of the last user message, the way a small model
// does. The memory writer's request gets an empty operation list.
// This file is not a *.test.ts: `npm test` does not run it on its own.
import { after } from 'node:test';
import http from 'node:http';

export interface GecitIstegi { sistem: string; son: string; hepsi: string }
/** `bekle`: when set, the chat reply (not the helper jobs) is held until the promise resolves (a turn that keeps running). */
export interface SahteGecit { taban: string; istekler: GecitIstegi[]; yanitlar: string[]; kip: 'sira' | 'yanki'; varsayilan: string; bekle: Promise<void> | null }

const metniAl = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text).join(' ') : '');

/** Settings that point the app at this fake as its OpenAI-compatible provider. */
export const gecitAyari = (g: { taban: string }) => ({ motorSecimi: 'openai' as const, openaiUyumlu: { tabanUrl: `${g.taban}/v1`, model: 'sahte-model' } });

export async function sahteGecit(): Promise<SahteGecit> {
  const g: SahteGecit = { taban: '', istekler: [], yanitlar: [], kip: 'sira', varsayilan: 'Tamam.', bekle: null };
  const sunucu = http.createServer((q, r) => {
    if (q.method !== 'POST' || q.url !== '/v1/chat/completions') { r.writeHead(404); r.end(); return; }
    let govde = '';
    q.on('data', (d) => { govde += d; });
    q.on('end', async () => {
      const j = govde ? JSON.parse(govde) as { messages?: { role: string; content: unknown }[] } : {};
      const mesajlar = j.messages ?? [];
      const sistem = mesajlar.filter((m) => m.role === 'system').map((m) => metniAl(m.content)).join('\n');
      const metinler = mesajlar.filter((m) => m.role !== 'system').map((m) => metniAl(m.content));
      const i: GecitIstegi = { sistem, son: metinler.at(-1) ?? '', hepsi: metinler.join('\n') };
      g.istekler.push(i);
      // Post-turn helper jobs (memory writer, chat title, summary) do not consume queued replies and are not held.
      const yardimci = /hafıza yazıcısısın|başlık ver|yoğun bir özet/.test(i.sistem);
      if (!yardimci && g.bekle) await g.bekle;
      const icerik = /hafıza yazıcısısın/.test(i.sistem) ? '{"islemler":[]}'
        : yardimci ? 'Sahte başlık'
        : g.kip === 'yanki' ? i.son.replace(/^[\s\S]*<\/baglam>\s*/, '')
        : g.yanitlar.shift() ?? g.varsayilan;
      const cagrilar = [...icerik.matchAll(/<arac ad="([^"]+)">([\s\S]*?)<\/arac>/g)];
      const metin = icerik.replace(/<arac ad="[^"]+">[\s\S]*?<\/arac>/g, '').trim();
      const parca = (delta: object, bitis: string | null = null) => `data: ${JSON.stringify({ id: 'sahte', object: 'chat.completion.chunk', model: 'sahte-model', choices: [{ index: 0, delta, finish_reason: bitis }] })}\n\n`;
      r.writeHead(200, { 'content-type': 'text/event-stream' });
      r.write(parca({ role: 'assistant', content: metin }));
      cagrilar.forEach((c, n) => r.write(parca({ tool_calls: [{ index: n, id: `cagri_${n}`, type: 'function', function: { name: c[1], arguments: c[2] || '{}' } }] })));
      r.write(parca({}, cagrilar.length ? 'tool_calls' : 'stop'));
      r.write(`data: ${JSON.stringify({ id: 'sahte', object: 'chat.completion.chunk', model: 'sahte-model', choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`);
      r.end('data: [DONE]\n\n');
    });
  });
  await new Promise<void>((c) => sunucu.listen(0, '127.0.0.1', c));
  g.taban = `http://127.0.0.1:${(sunucu.address() as { port: number }).port}`;
  after(() => new Promise<void>((c) => sunucu.close(() => c())));
  return g;
}
