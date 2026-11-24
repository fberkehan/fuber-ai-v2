// Gerçek kayıtlarla ölçüm (0.13 T8, inceleme 1. tur): doğru uyanma ölçütü 18/20 örneklem içi olduğu için AÇIK; tek komutla kapanacak adım bu betik.
// Gerçek komut satırı, gerçek WASM ve gerçek klip: betiğin sözü "klasör ver, doğru uyanmayı oku".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wavdanPcm, pcmdenWav } from '../src/shared/pcm.ts';

const KOK = join(import.meta.dirname, '..');
const BETIK = join(KOK, 'scripts/dev/uyandirma/kayit-olc.mjs');
const koş = (klasor: string) => spawnSync(process.execPath, [BETIK, klasor], { encoding: 'utf8', cwd: KOK });

/** 16 kHz klibi 48 kHz stereo WAV'a çevirir (telefon/kaydedici çıktısı gibi): her örnek üç kez, iki kanal. */
function kirksekizStereo(klip: string): Uint8Array {
  const w = wavdanPcm(new Uint8Array(readFileSync(klip)))!;
  const i = new Int16Array(w.pcm.slice().buffer);
  const o = new Int16Array(i.length * 6);
  for (let k = 0; k < i.length; k++) for (let c = 0; c < 6; c++) o[k * 6 + c] = i[k];
  const wav = pcmdenWav(new Uint8Array(o.buffer), 48000);
  new DataView(wav.buffer).setUint16(22, 2, true); // kanal sayısı
  new DataView(wav.buffer).setUint32(28, 48000 * 4, true);
  new DataView(wav.buffer).setUint16(32, 4, true);
  return wav;
}

test('klasörde kayıt yoksa ölçüm uydurmaz, açık hatayla çıkar', () => {
  const d = mkdtempSync(join(tmpdir(), 'fuber-kayit-'));
  try {
    const r = koş(d);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /kayıt bulunamadı/);
  } finally { rmSync(d, { recursive: true, force: true }); }
});
