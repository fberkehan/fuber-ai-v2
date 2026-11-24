// Son bütün dal incelemesi K-5: "Yalnız bu bilgisayar" turunun ERTELENEN hafıza işi tura sabitlenir — tur hangi yolla yapıldıysa hafıza da o
// yolla yazılır. Eskiden başlık ve özet `sabit` alıyordu, hafiza/yazici.ts hafizaYaz almıyordu: tur bittikten sonraki bekleme süresinde kullanıcı
// Fuber'e geçerse o yalnız-yerel turunun içeriği BULUTTA işlenerek hafızaya özetlenirdi. GERÇEK ajan döngüsü (ajan/dongu.ts yanitla) + tur
// sonrası işler; bulut = sahte Fuber ağ geçidi, yerel = sahte llama-server (ikisi de 127.0.0.1).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { anaSurecSahnesi, ipcKurBos } from './yardimci/ana-surec.ts';
import { sahteGecit, gecitAyari } from './yardimci/sahte-gecit.ts';

const yerelIstekler: string[] = [];
const rolu = (sistem: string) => (/hafıza yazıcısısın/.test(sistem) ? 'hafiza' : /başlık ver/.test(sistem) ? 'baslik' : /yoğun bir özet/.test(sistem) ? 'ozet' : 'sohbet');
const yerelSunucu = http.createServer(async (q, r) => {
  if (q.method !== 'POST' || q.url !== '/v1/chat/completions') { r.writeHead(404); r.end(); return; }
  let h = '';
  for await (const d of q) h += d;
  const l = (JSON.parse(h).messages ?? []) as { role: string; content: string }[];
  const rol = rolu(l[0]?.role === 'system' ? String(l[0].content) : '');
  yerelIstekler.push(rol);
  const content = rol === 'hafiza' ? '{"islemler":[]}' : rol === 'baslik' ? 'Sunum hazırlığı' : rol === 'ozet' ? 'Özet.' : 'Merhaba Deniz, sunumun için buradayım.';
  r.writeHead(200, { 'content-type': 'application/json' });
  r.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
});
await new Promise<void>((c) => yerelSunucu.listen(0, '127.0.0.1', c));
after(() => new Promise<void>((c) => yerelSunucu.close(() => c())));

const gecit = await sahteGecit();
anaSurecSahnesi('yalniz-hafiza-sabit', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false, motorCalisti: true,
  ...gecitAyari(gecit),
  yerel: { gpu: 'cpu', yalnizYerel: true }, yalnizYerelGocu: 1,
});
(globalThis as Record<string, unknown>).__sifreleme = true;
process.env.FUBER_DEMO = '1';
process.env.FUBER_YEREL_TABAN = `http://127.0.0.1:${(yerelSunucu.address() as { port: number }).port}`;
await ipcKurBos();
const { sirYaz, ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;

const { tekMotorYolu } = await import('../src/main/motor/yerel.ts');
const { yanitla, turSonrasiniBitir } = await import('../src/main/ajan/dongu.ts');
const { hafizaYaziminiBekle } = await import('../src/main/hafiza/yazici.ts');
const { sohbetOlustur } = await import('../src/main/sohbet.ts');
after(() => { delete process.env.FUBER_YEREL_TABAN; });

const buluttaYardimci = () => gecit.istekler.filter((x) => /hafıza yazıcısısın|başlık ver|yoğun bir özet/.test(x.sistem)).map((x) => rolu(x.sistem));

test('K-5: yalnız-yerel turu bitti, bekleme süresinde Fuber seçildi → ertelenen hafıza (başlık, özet de) YEREL kalır; buluta hiçbiri gitmez', async () => {
  assert.equal(tekMotorYolu(), 'yerel', 'ön koşul: "Yalnız bu bilgisayar" seçili, yerel hazır');
  const sohbet = sohbetOlustur('Yeni sohbet', 'normal');
  await yanitla(sohbet, { metin: 'Merhaba, ben Deniz; bu hafta müşteri sunumuna hazırlanıyorum.' });
  assert.ok(yerelIstekler.includes('sohbet'), 'tur yerelde');
  assert.equal(gecit.istekler.length, 0, 'tur buluta gitmedi');
  // Kullanıcı tur sonrası işler ertelenmişken Ayarlar → Nerede çalışsın → Fuber seçti.
  ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; });
  assert.equal(tekMotorYolu(), 'bulut', 'şimdi yol bulut');
  await turSonrasiniBitir(6000);
  await hafizaYaziminiBekle();
  assert.deepEqual(buluttaYardimci(), [], 'yalnız-yerel turunun içeriği bulutta işlendi');
  // 11 Kas analizi #3: yerel yolda MODEL yazıcısı yok (yalnız kullanıcının açık sözleri kural tabanlı yazılır) — yol değişse de buluta da geçmez.
  assert.ok(!yerelIstekler.includes('hafiza'), `yerelde model yazıcısı çağrılmaz: ${JSON.stringify(yerelIstekler)}`);
});
