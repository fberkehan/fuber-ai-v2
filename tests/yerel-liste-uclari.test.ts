// Son bütün dal incelemesi Ö-2: Gizli ya da "Yalnız bu bilgisayar" seçiliyken iki liste ucu kayıtlı anahtarla sağlayıcıya GİTMEZ —
// `motor:modeller` (Ayarlar → Gün kaydı → "Not ve rapor modeli: Özel model"; telefona da açık) ve `ses:sesler` (0.13'te hiç ağa çıkmaz: hep boş
// liste; kullanıcı ses seçmez). Kardeş uç `motor:model-bilgileri` e57ad80'de kapandı (main/motor/model-listesi.ts); kalıp aynı: kapı ağa çıkan her yoldan ÖNCE,
// ağa çıkmadan boş liste (shared/nerede.ts LISTE_ALINMAZ). GERÇEK ipc.ts işleyicileri; sahte OpenAI ve
// ElevenLabs yalnız 127.0.0.1'de, istekleri sayılır. Kontrol: ikisi de kapalıyken aynı uçlar sağlayıcıya GİDER (test gerçekten ölçer).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { anaSurecSahnesi, ipcKurBos, ipcIsleyicileri } from './yardimci/ana-surec.ts';

const istekler: string[] = [];
const sunucu = http.createServer((q, r) => {
  istekler.push(`${q.method} ${q.url?.split('?')[0]}`);
  const json = (v: unknown) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end(JSON.stringify(v)); };
  if (q.url?.startsWith('/v1/models')) return json({ object: 'list', data: [{ id: 'sahte-model', object: 'model', created: 0, owned_by: 'test' }] });
  if (q.url?.startsWith('/v2/voices')) return json({ voices: [{ voice_id: 'hesap-sesi-1', name: 'Hesap Sesi', category: 'cloned', labels: {} }], has_more: false });
  r.writeHead(404); r.end();
});
await new Promise<void>((c) => sunucu.listen(0, '127.0.0.1', c));
after(() => new Promise<void>((c) => sunucu.close(() => c())));
const taban = `http://127.0.0.1:${(sunucu.address() as { port: number }).port}`;

anaSurecSahnesi('yerel-liste-uclari', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false,
  saglayicilar: { openai: { etkin: true, anahtarVar: true, tabanUrl: `${taban}/v1` } },
  yerel: { gizliMod: false, yalnizYerel: false },
});
(globalThis as Record<string, unknown>).__sifreleme = true;
process.env.FUBER_DEMO = '1';
process.env.FUBER_SIR_API_OPENAI = 'sk-sahte-yerel-liste';
process.env.FUBER_SIR_API_ELEVENLABS = 'sahte-anahtar';
process.env.FUBER_SES_TABAN_ELEVENLABS = taban;
await ipcKurBos();
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;
const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const { LISTE_ALINMAZ } = await import('../src/shared/nerede.ts');
after(() => { delete process.env.FUBER_SIR_API_OPENAI; delete process.env.FUBER_SIR_API_ELEVENLABS; delete process.env.FUBER_SES_TABAN_ELEVENLABS; });

const ipc = (k: string, ...a: unknown[]) => ipcIsleyicileri().get(k)!({}, ...a) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const yerelSec = (y: { gizliMod?: boolean; yalnizYerel?: boolean }) => ayarlariKaydet((a) => { a.yerel.gizliMod = y.gizliMod === true; a.yerel.yalnizYerel = y.yalnizYerel === true; });

test('Ö-2 · not metni: sakin, düz kesme işareti yok, "buluttaki yapay zekâ kapalı" (T34b, P14)', () => {
  assert.match(LISTE_ALINMAZ, /Gizli ya da “Yalnız bu bilgisayar”/);
  assert.match(LISTE_ALINMAZ, /buluttaki yapay zekâ kapalı/);
  assert.doesNotMatch(LISTE_ALINMAZ, /'/);
});
