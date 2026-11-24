// H5 tur 2 (uçtan uca koşu, Adım 11): "Yalnız bu bilgisayar" seçili ve hiç bulut motoru YOKKEN (hesap onay bekliyor; anahtar yok) yardımcı
// roller de bu bilgisayardaki yapay zekâda çalışmalı. Eskiden hafıza yazıcısı (hafiza/yazici.ts) ve kokpit planlayıcısı (kokpit/duzen.ts
// planla) "hazır bulut motoru var mı" kapısına bakıyordu: yol 'yerel' olsa da iş sessizce atlanıyordu — hesap AKTİF olunca (bulut motoru
// sayılınca) aynı iş yerelde yapılıyordu (tutarsız). Kapı artık tek kuraldır: tekMotorYolu() !== 'yok'.
// GERÇEK ajan döngüsü (ajan/dongu.ts yanitla) + tur sonrası işler; motor bu bilgisayardaki sahte yerel model (FUBER_YEREL_TABAN, 127.0.0.1).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { anaSurecSahnesi, ipcKurBos } from './yardimci/ana-surec.ts';

const istekler: { sistem: string }[] = [];
const rolu = (sistem: string) => (/hafıza yazıcısısın/.test(sistem) ? 'hafiza' : /"selamlama"/.test(sistem) ? 'kokpit' : /başlık/.test(sistem) ? 'baslik' : 'sohbet');
const yerelSunucu = http.createServer(async (q, r) => {
  if (q.method !== 'POST' || q.url !== '/v1/chat/completions') { r.writeHead(404); r.end(); return; }
  let h = '';
  for await (const d of q) h += d;
  const l = (JSON.parse(h).messages ?? []) as { role: string; content: string }[];
  const sistem = l[0]?.role === 'system' ? String(l[0].content) : '';
  istekler.push({ sistem });
  const rol = rolu(sistem);
  const content = rol === 'hafiza' ? '{"islemler":[]}' : rol === 'kokpit' ? '{"selamlama":"Merhaba Deniz","odak":"","kartlar":[]}' : rol === 'baslik' ? 'Sunum hazırlığı' : 'Merhaba Deniz, sunumun için buradayım.';
  r.writeHead(200, { 'content-type': 'application/json' });
  r.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
});
await new Promise<void>((c) => yerelSunucu.listen(0, '127.0.0.1', c));
after(() => new Promise<void>((c) => yerelSunucu.close(() => c())));

anaSurecSahnesi('yalniz-yerel-yardimci', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false, yerel: { gpu: 'cpu', yalnizYerel: true },
});
(globalThis as Record<string, unknown>).__sifreleme = true;
process.env.FUBER_DEMO = '1';
process.env.FUBER_YEREL_TABAN = `http://127.0.0.1:${(yerelSunucu.address() as { port: number }).port}`;
process.env.FUBER_TEST_PLANLAYICI = '1';
await ipcKurBos();
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;

const { tekMotorYolu } = await import('../src/main/motor/yerel.ts');
const { hazirMotorlar } = await import('../src/main/motor/secici.ts');
const { yanitla, turSonrasiniBitir } = await import('../src/main/ajan/dongu.ts');
const { hafizaYaziminiBekle } = await import('../src/main/hafiza/yazici.ts');
const { kokpitYenile } = await import('../src/main/kokpit/duzen.ts');
const { sohbetOlustur } = await import('../src/main/sohbet.ts');
after(() => { delete process.env.FUBER_TEST_PLANLAYICI; delete process.env.FUBER_YEREL_TABAN; });

const roller = () => istekler.map((i) => rolu(i.sistem));

test('ön koşul: "Yalnız bu bilgisayar" seçili, bulut motoru yok → yol yerel', () => {
  assert.deepEqual(hazirMotorlar(), [], 'bulut motoru yok (hesap onay bekliyor gibi)');
  assert.equal(tekMotorYolu(), 'yerel');
});

// 11 Kas analizi #3: yerelde MODEL yazıcısı yok; kullanıcının açık sözü kural tabanlı yazılır (bulut motoru olmasa da).
test('yerelde model yazıcısı çağrılmaz; açık tercih kural tabanlı yazılır (bulut motoru yok diye atlanmaz)', async () => {
  const sohbet = sohbetOlustur('Yeni sohbet', 'normal');
  const once = istekler.length;
  await yanitla(sohbet, { metin: 'Merhaba, ben Deniz; bu hafta müşteri sunumuna hazırlanıyorum.' });
  await turSonrasiniBitir(6000);
  await hafizaYaziminiBekle();
  const yeni = roller().slice(once);
  assert.ok(yeni.includes('sohbet'), `yanıt yerelde: ${JSON.stringify(yeni)}`);
  assert.ok(!yeni.includes('hafiza'), `yerelde model yazıcısı yok: ${JSON.stringify(yeni)}`);
  await yanitla(sohbet, { metin: 'Bana hep kısa ve madde madde yaz, uzun paragraf sevmiyorum.' });
  await turSonrasiniBitir(6000);
  await hafizaYaziminiBekle();
  const { cekirdekMetni } = await import('../src/main/hafiza/depo.ts');
  assert.match(cekirdekMetni(), /madde madde/, 'açık tercih çekirdekte (modelsiz)');
  assert.ok(!roller().slice(once).includes('hafiza'));
});

test('kokpit planlayıcısı yerelde çalışır (bulut motoru yok diye yedek yerleşime düşmez)', async () => {
  const once = istekler.length;
  await kokpitYenile('test', true);
  const bas = Date.now();
  while (!roller().slice(once).includes('kokpit') && Date.now() - bas < 6000) await new Promise((c) => setTimeout(c, 50));
  assert.ok(roller().slice(once).includes('kokpit'), `kokpit planlayıcısı yerelde çağrıldı: ${JSON.stringify(roller().slice(once))}`);
});
