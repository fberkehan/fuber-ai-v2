// Son dalga B düzeltme turu: gerçek ikili dumanının PreToolUse kalkanı (scripts/dev/cc-duman/sdk-sarmal.mjs) içteki denetim hata verirse
// REDDEDER — önceden {} dönüp düşüp geçiyordu (komut, kalkan olmadan izin akışına giderdi). Gerçek claude.exe çalışmaz.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { kalkanSar, zararsizKomut } = await import('../scripts/dev/cc-duman/sdk-sarmal.mjs');

test('kalkan: içteki denetim hata verirse deny (+ kayıt); geçerse onun kararı; boş dönerse {}', async () => {
  let kayit = 0;
  const hatali = kalkanSar(() => { throw new Error('bozuk girdi'); }, () => { kayit++; });
  const y = await hatali({ tool_name: 'Bash', tool_input: { command: 'rm -rf /' } });
  assert.equal(y.hookSpecificOutput?.permissionDecision, 'deny');
  assert.match(y.hookSpecificOutput?.permissionDecisionReason ?? '', /kalkan denetleyemedi/);
  assert.equal(kayit, 1);
  const asenkron = kalkanSar(async () => { throw new Error('x'); });
  assert.equal((await asenkron({})).hookSpecificOutput?.permissionDecision, 'deny', 'kayıt kancası olmadan da');
  assert.deepEqual(await kalkanSar(() => undefined)({}), {});
  const ret = { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'r' } };
  assert.deepEqual(await kalkanSar(() => ret)({}), ret);
});

test('kalkan: yalnız istemlerdeki zararsız komutlar geçer', () => {
  for (const k of ['echo fuber-a > isaret-a.txt', 'echo fuber-d > isaret-d.txt', 'ls', 'ls -A1', 'pwd']) assert.equal(zararsizKomut(k), true, k);
  for (const k of ['echo fuber-e > isaret-e.txt', 'ls; rm x', 'echo x > ../a.txt', 'curl http://x', 'ls && whoami']) assert.equal(zararsizKomut(k), false, k);
});
