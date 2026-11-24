// Görünüm geçişi (src/renderer/gecis.ts): atlanan View Transition "Transition was skipped" reddi yakalanmalı — Görev 19
// denetiminde kokpitte yakalanmamış söz reddi konsol hatası bırakıyordu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gorunumGecisi } from '../src/renderer/gecis.ts';

const atlandi = () => Object.assign(new Error('Transition was skipped'), { name: 'AbortError' });

test('geçiş atlanınca (ready reddedilir) yakalanmamış red kalmaz; değişiklik yine yapılır', async () => {
  const reddler: unknown[] = [];
  const dinle = (e: unknown) => reddler.push(e);
  process.on('unhandledRejection', dinle);
  try {
    let yapildi = 0;
    const belge = { startViewTransition(f: () => void) { f(); return { ready: Promise.reject(atlandi()), finished: Promise.resolve() }; } };
    gorunumGecisi(() => { yapildi++; }, belge);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(yapildi, 1);
    assert.deepEqual(reddler, []);
  } finally {
    process.off('unhandledRejection', dinle);
  }
});

test('geçiş desteklenmiyorsa değişiklik doğrudan yapılır', () => {
  let yapildi = 0;
  gorunumGecisi(() => { yapildi++; }, {});
  assert.equal(yapildi, 1);
});
