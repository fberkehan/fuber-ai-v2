// Toplantı: Gemini ile yazıya çevirme (kullanıcının kendi anahtarı; 14 Kas 2026, 0.18.2) — saf yardımcılar ve sahte fetch. Ağ yok.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GEMINI_ETIKET, GEMINI_MODEL, GEMINI_UYARISI, GeminiHatasi, geminiAnahtariGecerli, geminiDurumNedeni, geminiGovde, geminiSorunMetni, geminiYanitCoz } from '../src/shared/gemini-yazi.ts';
import { geminiYaziya, type Getir } from '../src/main/toplanti/gemini.ts';
import { tercihTemizle, yaziSecenekleri, yaziSeciliDeger } from '../src/shared/toplanti-model.ts';
import { toplantiYolu } from '../src/shared/toplanti.ts';
import { CAGRI_KANALLARI } from '../src/shared/kanallar.ts';
import { isDiliIhlali } from '../src/shared/is-dili.ts';

const ANAHTAR = 'AIza' + 'SyDUMMYDUMMYDUMMYDUMMYDUMMYDUMMY12';

test('anahtar biçimi: AIza ile başlar, boşluksuz; Anthropic/OpenAI anahtarı ya da boş reddedilir', () => {
  assert.equal(geminiAnahtariGecerli(ANAHTAR), true);
  assert.equal(geminiAnahtariGecerli(`  ${ANAHTAR} `), true, 'kenar boşluğu kırpılır');
  for (const k of ['', 'sk-ant-' + 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', 'AIza kısa', `AIza ${'a'.repeat(35)}`, null, 42]) assert.equal(geminiAnahtariGecerli(k), false, String(k));
});

test('istek gövdesi: ses satır içi base64 WAV, sıcaklık 0, yalnız dökümü iste', () => {
  const g = geminiGovde('QUJD') as { contents: { parts: Record<string, unknown>[] }[]; generationConfig: { temperature: number } };
  assert.equal(g.generationConfig.temperature, 0);
  assert.deepEqual(g.contents[0].parts[1], { inline_data: { mime_type: 'audio/wav', data: 'QUJD' } });
  assert.match(String(g.contents[0].parts[0].text), /ONLY the transcript/);
});

test('yanıt çözme: parçalar birleşir; boş, "konuşma yok" ve nokta null; engellenen istek GeminiHatasi(engel)', () => {
  const y = (t: unknown) => ({ candidates: [{ content: { parts: [{ text: t }] } }] });
  assert.equal(geminiYanitCoz(y('  Merhaba   dünya. ')), 'Merhaba dünya.');
  assert.equal(geminiYanitCoz({ candidates: [{ content: { parts: [{ text: 'Hello ' }, { text: 'there' }] } }] }), 'Hello there');
  for (const t of ['', '   ', 'No speech', 'no clear speech', '[silence]', '...']) assert.equal(geminiYanitCoz(y(t)), null, t);
  assert.equal(geminiYanitCoz({}), null);
  assert.equal(geminiYanitCoz(null), null);
  assert.throws(() => geminiYanitCoz({ promptFeedback: { blockReason: 'SAFETY' } }), (e: unknown) => e instanceof GeminiHatasi && e.neden === 'engel');
});

test('HTTP durumları: 400/401/403 anahtar, 429 kota, 5xx ağ; her neden tek cümle', () => {
  assert.equal(geminiDurumNedeni(400), 'anahtar');
  assert.equal(geminiDurumNedeni(403), 'anahtar');
  assert.equal(geminiDurumNedeni(429), 'kota');
  assert.equal(geminiDurumNedeni(503), 'ag');
  assert.equal(geminiDurumNedeni(418), 'bilinmeyen');
  for (const n of ['anahtar', 'kota', 'ag', 'engel', 'bilinmeyen'] as const) assert.ok(geminiSorunMetni(n).endsWith('.'), n);
});

function sahteGetir(yanit: { ok: boolean; status: number; json?: () => Promise<unknown> } | Error): { getir: Getir; cagrilar: { url: string; headers: Record<string, string>; body: string }[] } {
  const cagrilar: { url: string; headers: Record<string, string>; body: string }[] = [];
  const getir: Getir = async (url, init) => {
    cagrilar.push({ url, headers: init.headers, body: init.body });
    if (yanit instanceof Error) throw yanit;
    return { ok: yanit.ok, status: yanit.status, json: yanit.json ?? (async () => ({})) };
  };
  return { getir, cagrilar };
}

test('geminiYaziya: anahtar YALNIZ başlıkta (adreste yok), doğru uç, WAV base64; metin döner', async () => {
  const { getir, cagrilar } = sahteGetir({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: 'Merhaba' }] } }] }) });
  const m = await geminiYaziya(new Uint8Array([1, 2, 3]), ANAHTAR, { getir });
  assert.equal(m, 'Merhaba');
  assert.equal(cagrilar.length, 1);
  assert.equal(cagrilar[0].url, `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`);
  assert.ok(!cagrilar[0].url.includes(ANAHTAR), 'anahtar adreste yok');
  assert.equal(cagrilar[0].headers['x-goog-api-key'], ANAHTAR);
  assert.ok(cagrilar[0].body.includes(Buffer.from([1, 2, 3]).toString('base64')));
});

test('geminiYaziya hataları: durum → neden; ağ kopması → ag; JSON değil → bilinmeyen; hata iletisi anahtarı/gövdeyi içermez', async () => {
  const durumlar: [number, string][] = [[400, 'anahtar'], [403, 'anahtar'], [429, 'kota'], [500, 'ag']];
  for (const [status, neden] of durumlar) {
    await assert.rejects(geminiYaziya(new Uint8Array(4), ANAHTAR, { getir: sahteGetir({ ok: false, status }).getir }), (e: unknown) => e instanceof GeminiHatasi && e.neden === neden && !e.message.includes(ANAHTAR));
  }
  await assert.rejects(geminiYaziya(new Uint8Array(4), ANAHTAR, { getir: sahteGetir(new Error(`fetch failed ${ANAHTAR}`)).getir }), (e: unknown) => e instanceof GeminiHatasi && e.neden === 'ag' && !e.message.includes(ANAHTAR));
  await assert.rejects(geminiYaziya(new Uint8Array(4), ANAHTAR, { getir: sahteGetir({ ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } }).getir }), (e: unknown) => e instanceof GeminiHatasi && e.neden === 'bilinmeyen');
});

test('Gemini seçimi: tercih kalıcı geçerli; seçenek yalnız anahtar kayıtlıyken, Gizli\'de hiç; seçili değer yalnız anahtarla; yol "hesap" gibi toplu bulut', () => {
  assert.equal(tercihTemizle({ yazi: 'gemini' }).yazi, 'gemini');
  assert.equal(tercihTemizle({ yazi: 'bilinmeyen' }, { yz: 'varsayilan', yazi: 'yerel' }).yazi, 'yerel');
  const b = { bulutsuz: false, gelistirici: true, hesapVar: false, whisperKurulu: true };
  assert.ok(!yaziSecenekleri(b).some((x) => x.deger === 'gemini'), 'anahtar yokken seçenek yok');
  assert.ok(yaziSecenekleri({ ...b, geminiVar: true }).some((x) => x.deger === 'gemini' && x.etiket === 'Gemini'));
  assert.ok(!yaziSecenekleri({ ...b, bulutsuz: true, geminiVar: true }).some((x) => x.deger === 'gemini'), 'Gizli: bulut seçeneği yok (P14)');
  assert.equal(yaziSeciliDeger('gemini', { bulutsuz: false, hesapVar: false, geminiVar: true }), 'gemini');
  assert.equal(yaziSeciliDeger('gemini', { bulutsuz: false, hesapVar: false, geminiVar: false }), 'yerel', 'anahtar silindiyse yerele iner');
  assert.equal(yaziSeciliDeger('gemini', { bulutsuz: true, hesapVar: false, geminiVar: true }), 'yerel');
  // Gizli'de Gemini seçili olsa bile yol bulut olmaz.
  assert.equal(toplantiYolu({ bulutsuz: true, hesapKullanilir: true, bulutDustu: false, whisperKurulu: true, tercih: 'otomatik' }), 'whisper');
});

test('arayüz metinleri İş dilinde değil (Geliştirici kutusu): kutu İş kipinde çizilmez', () => {
  const kaynak = fs.readFileSync(path.resolve(import.meta.dirname, '../src/renderer/toplanti/Toplanti.tsx'), 'utf8');
  assert.match(kaynak, /if \(bulutsuz \|\| !gelistirici\) return null/);
  assert.ok(isDiliIhlali(GEMINI_ETIKET.sil) !== null, 'etiketlerde "anahtar" var: bu yüzden yalnız Geliştirici kipinde');
});
