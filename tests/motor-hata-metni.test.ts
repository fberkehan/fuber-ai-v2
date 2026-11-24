import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { motorHataMetni } from '../src/shared/motor-hata-metni.ts';

const HAM = '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits."},"request_id":"req_011C"}';

test('bakiye hatası sade cümle; ham JSON ve istek kimliği yok', () => {
  const m = motorHataMetni('Claude', HAM);
  assert.match(m, /bakiyesi bitti/);
  assert.doesNotMatch(m, /[{}]|req_|invalid_request|API/);
});

test('bağlam, model ve bilinmeyen hata da ham metin taşımaz', () => {
  assert.match(motorHataMetni('Claude', '400 prompt is too long: 300000 tokens'), /Yeni bir sohbet/);
  assert.match(motorHataMetni('OpenAI', 'The model `x` does not exist'), /başka bir model/);
  const b = motorHataMetni('OpenRouter', '400 {"weird":"gövde"}');
  assert.match(b, /kabul etmedi/);
  assert.doesNotMatch(b, /weird/);
});

test('motorlar ham e.message yazmaz', () => {
  for (const f of ['src/main/motor/anthropic.ts', 'src/main/motor/openai.ts']) {
    const s = readFileSync(f, 'utf8');
    assert.doesNotMatch(s, /new MotorHatasi\(`[^`]*\$\{e\.message\}/, f);
    assert.match(s, /motorHataMetni\(/, f);
  }
});
