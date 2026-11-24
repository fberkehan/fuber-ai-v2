// 13 Kas (paketli onarım): Claude Code hataları kullanıcıya TEK CÜMLE + EYLEM olarak gider; ham JSON, yığın izi, sistem kodu, istek kimliği gitmez.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ccHataAciklamasi, ccCokusAciklamasi, hamTemizle } from '../src/shared/cc-hata.ts';
import { ccNormallestir, dokumSatiriOlaylari, yeniBaglam, type CcOlay } from '../src/shared/cc-olay.ts';

const HAM = /\{\s*"|"type"\s*:|node:internal|ECONNREFUSED|ENOTFOUND|\bat\s+\S+\s+\(|req_[0-9A-Za-z]{6,}|\[object Object\]|Credit balance|Invalid API key|ConnectionRefused/;
const temiz = (m: string) => { assert.doesNotMatch(m, HAM, `ham öğe sızdı: ${m}`); assert.ok(m.length <= 260, `uzun: ${m.length}`); assert.match(m, /[.!]$/, 'cümle bitmeli'); };

test('sınıflar: kredi, giriş, ağ, limit, yoğun, yok, model, bağlam', () => {
  const kosu: [string, string | undefined, string, RegExp][] = [
    ['Credit balance is too low', undefined, 'kredi', /kredi/i],
    ['Invalid API key · Please run /login', undefined, 'giris', /oturum açık değil/],
    ['API Error: Unable to connect to API (ConnectionRefused)', undefined, 'ag', /internet bağlantını/],
    ['getaddrinfo ENOTFOUND api.anthropic.com', undefined, 'ag', /internet/],
    ['fetch failed', undefined, 'ag', /internet/],
    ["You've hit your limit · resets 5pm (Europe/Istanbul)", undefined, 'limit', /5pm \(Europe\/Istanbul\)/],
    ['API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}', undefined, 'yogun', /yoğun/],
    ['Claude Code native binary not found at C:\\x\\claude.exe. Please ensure Claude Code is installed', undefined, 'yok', /kur/],
    ['Claude Code (claude.exe) bulunamadı. Kurulum: https://claude.com/claude-code', undefined, 'yok', /bulunamadı/],
    ['There\'s an issue with the selected model (claude-x). It may not exist', 'model_not_found', 'model', /model/],
    ['Prompt is too long', undefined, 'baglam', /compact/],
    ['', 'authentication_failed', 'giris', /oturum/],
    ['', 'billing_error', 'kredi', /kredi/],
    ['', 'rate_limit', 'limit', /sınır/],
  ];
  for (const [ham, kod, sinif, desen] of kosu) {
    const a = ccHataAciklamasi(ham, kod);
    assert.equal(a.sinif, sinif, ham || kod);
    assert.match(a.metin, desen);
    temiz(a.metin);
  }
});

test('ham 401 JSON: yalnız tek cümle (kimlik, JSON, İngilizce ayrıntı yok)', () => {
  const ham = 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CTx9Zk2m1abcDEFghijKL"}';
  const a = ccHataAciklamasi(ham);
  assert.equal(a.sinif, 'giris');
  temiz(a.metin);
  assert.doesNotMatch(a.metin, /401|x-api-key/);
});

test('sınıflanamayan hata: JSON/yığın/kimlik atılır, kısaltılır, eylemle biter', () => {
  const a = ccHataAciklamasi('Something odd {"a":{"b":1}}\n    at Foo (C:\\x\\y.js:1:2)\n    at node:internal/main:1:1 req_abcdef123456');
  assert.equal(a.sinif, 'genel');
  assert.doesNotMatch(a.metin, /\{|\bat Foo|node:internal|req_/);
  assert.match(a.metin, /yeniden gönder/);
  assert.ok(ccHataAciklamasi('x'.repeat(2000)).metin.length < 260);
  assert.match(ccHataAciklamasi('').metin, /yeniden gönder/);
  assert.equal(hamTemizle('a  {"message":"merhaba"}  b'), 'a merhaba b');
});

test('süreç çökmesi: stderr yığın izi görünmez; sınıflanırsa o cümle; çıkış kodu korunur', () => {
  const yigin = 'Error: spawn EACCES\n    at ChildProcess.spawn (node:internal/child_process:420:11)\n    at node:internal/main:1:1';
  const a = ccCokusAciklamasi({ kod: '1', ileti: 'Claude Code process exited with code 1' }, yigin);
  assert.doesNotMatch(a.metin, /node:internal|\bat\s+\S+\s*\(/);
  assert.match(a.metin, /çıkış kodu 1/);
  assert.match(a.metin, /Yeni bir mesajla sürdürebilirsin\.$/);
  const ag = ccCokusAciklamasi({ kod: '1' }, 'Error: connect ECONNREFUSED 127.0.0.1:443');
  assert.equal(ag.sinif, 'ag');
  const giris = ccCokusAciklamasi({ kod: '1' }, 'Not logged in · Please run /login');
  assert.equal(giris.sinif, 'giris');
});

test('normalleştirici: sentetik asistan hata iletisi ham metin göstermez, tek hata satırı + sonuçta yinelenmez', () => {
  const b = yeniBaglam();
  const asistan = ccNormallestir({ type: 'assistant', message: { id: 'm1', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'API Error: 401 {"type":"error","request_id":"req_011CTx9Zk2m1abcDEF"}' }] }, error: 'authentication_failed', uuid: 'u1' }, b);
  assert.equal(asistan.length, 1);
  assert.equal(asistan[0].tur, 'sistem');
  const s = asistan[0] as Extract<CcOlay, { tur: 'sistem' }>;
  assert.equal(s.seviye, 'hata');
  temiz(s.metin);
  const sonuc = ccNormallestir({ type: 'result', subtype: 'success', is_error: true, result: 'API Error: 401 {"type":"error"}', duration_ms: 1, num_turns: 1, total_cost_usd: 0, usage: {} }, b)[0] as Extract<CcOlay, { tur: 'sonuc' }>;
  assert.equal(sonuc.basarili, false);
  assert.equal(sonuc.hataGorundu, true, 'cümle zaten dökümde: sonuç çizgisi yinelemez');
  temiz(sonuc.hata ?? '');
  // sonraki tur: bayrak sıfırlanmış
  const sonuc2 = ccNormallestir({ type: 'result', subtype: 'success', is_error: true, result: 'Credit balance is too low', duration_ms: 1, num_turns: 1, total_cost_usd: 0, usage: {} }, b)[0] as Extract<CcOlay, { tur: 'sonuc' }>;
  assert.equal(sonuc2.hataGorundu, undefined);
  assert.match(sonuc2.hata ?? '', /kredi/);
});

test('normalleştirici: "unknown" kodlu sentetik ağ hatası da Türkçe cümle olur; gerçek model iletisi dokunulmaz', () => {
  const b = yeniBaglam();
  const ag = ccNormallestir({ type: 'assistant', message: { id: 'm2', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'API Error: Unable to connect to API (ConnectionRefused)' }] }, error: 'unknown', uuid: 'u2' }, b);
  assert.equal(ag.length, 1);
  assert.match((ag[0] as { metin: string }).metin, /internet bağlantını/);
  const normal = ccNormallestir({ type: 'assistant', message: { id: 'm3', role: 'assistant', model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'Merhaba, API Error: 401 kodunu açıklayayım.' }] }, uuid: 'u3' }, b);
  assert.ok(normal.some((o) => o.tur === 'metin' || o.tur === 'metin-bitti' || JSON.stringify(o).includes('Merhaba')), 'normal asistan metni korunur');
});

test('geçmiş dökümü: isApiErrorMessage satırı tek cümleye çevrilir', () => {
  const b = yeniBaglam();
  const o = dokumSatiriOlaylari({ type: 'assistant', isApiErrorMessage: true, error: 'billing_error', message: { id: 'm', role: 'assistant', model: '<synthetic>', content: [{ type: 'text', text: 'Credit balance is too low' }] } }, b);
  assert.equal(o.length, 1);
  assert.match((o[0] as { metin: string }).metin, /kredi/);
});
