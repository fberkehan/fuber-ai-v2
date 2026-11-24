import { describe, expect, it } from 'vitest';
import { cleanRawError, describeCliCrash, describeCliError, type CliErrorClass } from './session-errors';

const RAW = /\{\s*"|"type"\s*:|node:internal|ECONNREFUSED|ENOTFOUND|\bat\s+\S+\s+\(|req_[0-9A-Za-z]{6,}|\[object Object\]|Credit balance|Invalid API key|ConnectionRefused/;

/** Kullanıcıya giden cümlede ham öğe yok, kısa ve noktayla bitiyor. */
function expectClean(text: string): void {
  expect(text).not.toMatch(RAW);
  expect(text.length).toBeLessThanOrEqual(260);
  expect(text).toMatch(/[.!]$/);
}

describe('Claude Code hata sınıfları', () => {
  it('ham metni ve asistan hata kodunu sınıflar; her sınıf tek cümle + eylemdir', () => {
    const cases: Array<[string, string | undefined, CliErrorClass, RegExp]> = [
      ['Credit balance is too low', undefined, 'billing', /kredi/i],
      ['Invalid API key · Please run /login', undefined, 'auth', /oturum açık değil/],
      ['API Error: Unable to connect to API (ConnectionRefused)', undefined, 'network', /internet bağlantınızı/],
      ['getaddrinfo ENOTFOUND api.anthropic.com', undefined, 'network', /internet/],
      ['fetch failed', undefined, 'network', /internet/],
      ["You've hit your limit · resets 5pm (Europe/Istanbul)", undefined, 'limit', /5pm \(Europe\/Istanbul\)/],
      ['API Error: 529 {"type":"error","error":{"type":"overloaded_error"}}', undefined, 'overloaded', /yoğun/],
      ['Claude Code native binary not found at C:\\x\\claude.exe. Please ensure Claude Code is installed', undefined, 'missing', /kurun/],
      ['Claude Code (claude.exe) bulunamadı. Kurulum: https://claude.com/claude-code', undefined, 'missing', /bulunamadı/],
      ["There's an issue with the selected model (claude-x). It may not exist", 'model_not_found', 'model', /model/],
      ['Prompt is too long', undefined, 'context', /compact/],
      ['', 'authentication_failed', 'auth', /oturum/],
      ['', 'billing_error', 'billing', /kredi/],
      ['', 'rate_limit', 'limit', /sınır/],
      ['', 'account_on_hold', 'billing', /askıda/],
      ['', 'verification_required', 'auth', /doğrulama/],
    ];
    for (const [raw, code, expected, pattern] of cases) {
      const info = describeCliError(raw, code);
      expect(info.class, raw || code).toBe(expected);
      expect(info.text).toMatch(pattern);
      expectClean(info.text);
    }
  });

  it('limit cümlesi sıfırlanma bilgisini taşır; bilgi yoksa genel limit cümlesi', () => {
    expect(describeCliError('Claude usage limit reached').text).not.toMatch(/sıfırlanma/);
    expect(describeCliError("You've hit your limit · resets at 9:30am").text).toMatch(/sıfırlanma: 9:30am/);
  });

  it('ham 401 JSON yalnız tek cümleye döner (kimlik, JSON, İngilizce ayrıntı yok)', () => {
    const raw = 'API Error: 401 {"type":"error","error":{"type":"authentication_error","message":"invalid x-api-key"},"request_id":"req_011CTx9Zk2m1abcDEFghijKL"}';
    const info = describeCliError(raw);
    expect(info.class).toBe('auth');
    expectClean(info.text);
    expect(info.text).not.toMatch(/401|x-api-key/);
    expect(info.text).toMatch(/Projeler › Claude Code oturumları › Ayarlar/);
  });

  it('sınıflanamayan hata: JSON, yığın ve istek kimliği atılır, kısaltılır, eylemle biter', () => {
    const info = describeCliError('Something odd {"a":{"b":1}}\n    at Foo (C:\\x\\y.js:1:2)\n    at node:internal/main:1:1 req_abcdef123456');
    expect(info.class).toBe('generic');
    expect(info.text).not.toMatch(/\{|\bat Foo|node:internal|req_/);
    expect(info.text).toMatch(/yeniden gönderin/);
    expect(describeCliError('x'.repeat(2000)).text.length).toBeLessThan(260);
    expect(describeCliError('').text).toMatch(/yeniden gönderin/);
    expect(describeCliError(undefined).class).toBe('generic');
    expect(cleanRawError('a  {"message":"merhaba"}  b')).toBe('a merhaba b');
    expect(cleanRawError('\u001b[31mkırmızı\u001b[0m  metin')).toBe('kırmızı metin');
  });

  it('süreç çökmesi: yığın izi görünmez; sınıflanırsa o cümle; çıkış kodu ve sinyal korunur', () => {
    const stack = 'Error: spawn EACCES\n    at ChildProcess.spawn (node:internal/child_process:420:11)\n    at node:internal/main:1:1';
    const crash = describeCliCrash({ code: 1, message: 'Claude Code process exited with code 1' }, stack);
    expect(crash.class).toBe('generic');
    expect(crash.text).not.toMatch(/node:internal|\bat\s+\S+\s*\(/);
    expect(crash.text).toMatch(/çıkış kodu 1/);
    expect(crash.text).toMatch(/Yeni bir iletiyle sürdürebilirsiniz\.$/);
    expect(describeCliCrash({ signal: 'SIGKILL' }, '').text).toMatch(/sinyal SIGKILL/);
    expect(describeCliCrash({ code: null }, '').text).toBe('Claude Code beklenmedik biçimde kapandı. Yeni bir iletiyle sürdürebilirsiniz.');
    expect(describeCliCrash({ code: '1' }, 'Error: connect ECONNREFUSED 127.0.0.1:443').class).toBe('network');
    expect(describeCliCrash({ code: 1 }, 'Not logged in · Please run /login').class).toBe('auth');
    expect(describeCliCrash({ code: 0 }, '').text).toMatch(/çıkış kodu 0/);
  });
});
