// Hitap birleştirme: "Bey" tek başına yazılınca "Deniz Bey" olmalı (bildirilen hata).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hitapMetni } from '../src/shared/hitap.ts';

test('unvan tek başına → adla birleşir', () => {
  assert.equal(hitapMetni('Deniz', 'Bey'), 'Deniz Bey');
  assert.equal(hitapMetni('Deniz Kaya', 'bey'), 'Deniz Bey');
  assert.equal(hitapMetni('Ayşe', 'hanim'), 'Ayşe Hanım');
  assert.equal(hitapMetni('Deniz', 'Bay'), 'Bay Deniz');
});

test('tam ifade aynen; boşsa ad', () => {
  assert.equal(hitapMetni('Deniz', 'Deniz Bey'), 'Deniz Bey');
  assert.equal(hitapMetni('Deniz', 'Hocam'), 'Hocam');
  assert.equal(hitapMetni('Deniz', ''), 'Deniz');
  assert.equal(hitapMetni('', 'Bey'), 'Bey');
});
