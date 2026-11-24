// 11 Kas analizi #9, §6.3: "Yalnız bu bilgisayar"da hatırlatıcı, yapılacak iş, tarih ve aritmetik KODLA yapılır (ajan/yerel-yol.ts, ajan/dongu.ts) —
// GERÇEK yanitla, Electron'suz sahne, sahte yerel model (yalnız 127.0.0.1). Sınanır: onay kartıyla kurulum (model çağrılmaz), reddedince kurulmaz,
// zaman anlaşılmazsa sorulur (uydurulmaz), aritmetik kesin, kodla çözülemeyen hesapta model yanıtlar + dürüst not, Gizli'de kod yolu yok.
// Ayrıca hafıza budamasının günlük tek atımlık zamanlayıcısı (yoklama yok): zamanlayici.ts budamaGecikmesi.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { anaSurecSahnesi, ipcKurBos } from './yardimci/ana-surec.ts';

const yerelIstekler: string[] = [];
const sunucu = http.createServer(async (q, r) => {
  let h = '';
  q.on('data', (d) => { h += d; });
  await new Promise((c) => q.on('end', c));
  const g = h ? JSON.parse(h) : {};
  const sistem = String(g.messages?.[0]?.content ?? '');
  if (!/hafıza yazıcısısın|başlık ver|kokpit/.test(sistem)) yerelIstekler.push(String(g.messages?.at(-1)?.content ?? '').slice(-200));
  r.writeHead(200, { 'content-type': 'application/json' });
  r.end(JSON.stringify({ choices: [{ message: { content: /başlık ver/.test(sistem) ? 'Sohbet' : 'Adımlar: 1.250.000 − 1.000.000 = 250.000; 250.000 / 1.250.000 = 0,2. Sonuç: %20.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1 } }));
});
await new Promise<void>((c) => sunucu.listen(0, '127.0.0.1', c));
after(() => new Promise<void>((c) => sunucu.close(() => c())));

anaSurecSahnesi('yerel-kod-yolu', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Selin', hitap: 'Selin', mod: 'is', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false, motorCalisti: true,
  yerel: { yalnizYerel: true, etkin: true, model: 'bonsai2-9b' },
});
process.env.FUBER_DEMO = '1';
process.env.FUBER_TEST_ANA_ONDE = '1';
process.env.FUBER_YEREL_TABAN = `http://127.0.0.1:${(sunucu.address() as { port: number }).port}`;
await ipcKurBos();
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;
after(() => { delete process.env.FUBER_YEREL_TABAN; delete process.env.FUBER_TEST_ANA_ONDE; });
const { yanitla, turSonrasiniBitir } = await import('../src/main/ajan/dongu.ts');
const { sohbetOlustur, mesajlar } = await import('../src/main/sohbet.ts');
const { hatirlaticilar, gorevler } = await import('../src/main/planlama.ts');
const { herOlayiDinle, onayYanitla } = await import('../src/main/olaylar.ts');
const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const { budamaGecikmesi } = await import('../src/main/zamanlayici.ts');
const { YEREL_HESAP_NOTU } = await import('../src/shared/yerel-yonlendirme.ts');

let karar: 'bir_kez' | 'reddet' = 'bir_kez';
const kartlar: { baslik: string; aciklama: string }[] = [];
herOlayiDinle((kanal, veri) => {
  const v = veri as { tur?: string; istek?: { id: string; baslik: string; aciklama: string } };
  if (kanal === 'sohbet:olay' && v?.tur === 'onay' && v.istek) { kartlar.push(v.istek); setTimeout(() => onayYanitla(v.istek!.id, karar), 0); }
});
const tur = async (metin: string) => {
  const s = sohbetOlustur();
  const once = yerelIstekler.length;
  const son = await yanitla(s, { metin });
  await turSonrasiniBitir(3000);
  return { yanit: (son?.bloklar ?? []).map((b: { metin?: string }) => b.metin ?? '').join(''), model: yerelIstekler.length - once, kayit: mesajlar(s) };
};

test('hatırlatıcı: onay kartıyla kurulur, model çağrılmaz; reddedilince kurulmaz; zaman anlaşılmazsa sorulur', async () => {
  const r = await tur('Yarın 14:00’te Atlas Gıda toplantısını hatırlat.');
  assert.equal(r.model, 0, 'yerel model çağrılmadı');
  assert.equal(kartlar.at(-1)!.baslik, 'Hatırlatıcı kurulsun mu?');
  assert.match(kartlar.at(-1)!.aciklama, /^Atlas Gıda toplantısı · /);
  assert.match(r.yanit, /^⏰ Kurdum: \*\*Atlas Gıda toplantısı\*\*/);
  const h = hatirlaticilar({ limit: 20 }).find((x) => x.baslik === 'Atlas Gıda toplantısı')!;
  assert.ok(h);
  const z = new Date(h.zaman);
  assert.equal(z.getHours(), 14);
  const yarin = new Date();
  yarin.setDate(yarin.getDate() + 1);
  assert.equal(z.toDateString(), yarin.toDateString(), 'yarın');
  karar = 'reddet';
  const red = await tur('Cuma 16:00’da Elif’le görüşmeyi hatırlat.');
  assert.match(red.yanit, /kurmadım/);
  assert.ok(!hatirlaticilar({ limit: 20 }).some((x) => /Elif/.test(x.baslik)), 'reddedilince kurulmadı');
  karar = 'bir_kez';
  const kartOnce = kartlar.length;
  const belirsiz = await tur('Bana raporu hatırlatır mısın?');
  assert.match(belirsiz.yanit, /Ne zaman hatırlatayım/);
  assert.equal(kartlar.length, kartOnce, 'zaman yokken kart çıkmadı (uydurulmadı)');
  assert.equal(belirsiz.model, 0);
});

test('yapılacak iş onayla eklenir; aritmetik kesin (model yok); kodla çözülemeyen hesapta model yanıtlar ve dürüst not düşer', async () => {
  const g = await tur('ISO 9001 kontrol listesini yapılacaklara ekle, 21 Ekim’e kadar bitmeli.');
  assert.equal(g.model, 0);
  assert.ok(gorevler({ limit: 20 }).some((x) => x.baslik === 'ISO 9001 kontrol listesi' && x.sonTarih));
  const a = await tur('12*(3+4) kaç eder?');
  assert.equal(a.model, 0);
  assert.match(a.yanit, /= \*\*84\*\*$/);
  const m = await tur('Kâr marjı nedir: gelir 1.250.000 TL, maliyet 1.000.000 TL?');
  assert.equal(m.model, 1, 'model yanıtladı');
  assert.ok(m.kayit.some((x) => x.rol === 'not' && x.metin === YEREL_HESAP_NOTU), 'dürüst not düştü');
});

test('Gizli\'de kod yolu yok (Gizli bölüm iz bırakmaz): hatırlatıcı kurulmaz, kart çıkmaz, yanıtı yerel model verir', async () => {
  ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; a.yerel.gizliMod = true; });
  try {
    const kartOnce = kartlar.length;
    const r = await tur('Yarın 10:00’da dişçiyi hatırlat.');
    assert.equal(r.model, 1);
    assert.equal(kartlar.length, kartOnce);
    assert.ok(!hatirlaticilar({ limit: 20 }).some((x) => /dişçi/i.test(x.baslik)));
  } finally { ayarlariKaydet((a) => { a.yerel.gizliMod = false; a.yerel.yalnizYerel = true; }); }
});

test('budama zamanlayıcısı: tek atımlık — hiç koşmadıysa ya da 24 saatten eskiyse 5 dk sonra, değilse sıradaki 03:30', () => {
  const s = new Date(2026, 10, 11, 1, 30);
  assert.equal(budamaGecikmesi(s, undefined), 5 * 60_000);
  assert.equal(budamaGecikmesi(s, new Date(2026, 10, 9, 3, 30).toISOString()), 5 * 60_000);
  assert.equal(budamaGecikmesi(s, new Date(2026, 10, 10, 3, 30).toISOString()), 2 * 3600_000, 'bugün 03:30');
  assert.equal(budamaGecikmesi(new Date(2026, 10, 11, 9, 0), new Date(2026, 10, 11, 3, 30).toISOString()), 18.5 * 3600_000, 'yarın 03:30');
});
