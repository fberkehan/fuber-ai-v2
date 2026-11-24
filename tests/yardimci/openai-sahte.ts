// Helpers for tests that run their own fake OpenAI-compatible server (127.0.0.1 only): `fuberBicimi` flattens an OpenAI chat request into
// { systemPrompt, messages } (system text + the other messages), `openaiYaz` streams one reply the way the OpenAI SDK expects it.
// A `<arac ad="name">{json}</arac>` span in the reply becomes a real tool call. Not a *.test.ts file.
import type { ServerResponse } from 'node:http';

const metniAl = (c: unknown): string => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p?.type === 'text').map((p) => p.text).join(' ') : '');

export function fuberBicimi(g: unknown): { systemPrompt: string; messages: { role: string; content: unknown }[]; [k: string]: unknown } {
  const j = (g && typeof g === 'object' ? g : {}) as { messages?: { role: string; content: unknown }[] };
  const l = j.messages ?? [];
  return { ...j, systemPrompt: l.filter((m) => m.role === 'system').map((m) => metniAl(m.content)).join('\n'), messages: l.filter((m) => m.role !== 'system') };
}

export function openaiYaz(r: ServerResponse, icerik: string): void {
  const cagrilar = [...icerik.matchAll(/<arac ad="([^"]+)">([\s\S]*?)<\/arac>/g)];
  const metin = icerik.replace(/<arac ad="[^"]+">[\s\S]*?<\/arac>/g, '').trim();
  const parca = (delta: object, bitis: string | null = null) => `data: ${JSON.stringify({ id: 'sahte', object: 'chat.completion.chunk', model: 'sahte-model', choices: [{ index: 0, delta, finish_reason: bitis }] })}\n\n`;
  r.writeHead(200, { 'content-type': 'text/event-stream' });
  r.write(parca({ role: 'assistant', content: metin }));
  cagrilar.forEach((c, n) => r.write(parca({ tool_calls: [{ index: n, id: `cagri_${n}`, type: 'function', function: { name: c[1], arguments: c[2] || '{}' } }] })));
  r.write(parca({}, cagrilar.length ? 'tool_calls' : 'stop'));
  r.write(`data: ${JSON.stringify({ id: 'sahte', object: 'chat.completion.chunk', model: 'sahte-model', choices: [], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\n`);
  r.end('data: [DONE]\n\n');
}
