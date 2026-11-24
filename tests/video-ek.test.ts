// Analiz 11 Kas (geliştirici bulgu 9): video ekinin saf parçaları — PCM'in Whisper için 60 sn'lik WAV parçalarına bölünmesi ve modele giden metin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pcmWavParcalari, zamanDamgasi, videoEkMetni } from '../src/shared/video-ek.ts';

test('PCM → 60 sn\'lik WAV parçaları: başlık doğru, son parça kısa, başlangıç saniyeleri', () => {
  const sn = 130;
  const pcm = Buffer.alloc(sn * 16_000 * 2, 1);
  const p = pcmWavParcalari(pcm);
  assert.deepEqual(p.map((x) => x.bas), [0, 60, 120]);
  const w = p[0].wav;
  assert.equal(w.toString('ascii', 0, 4), 'RIFF');
  assert.equal(w.toString('ascii', 8, 12), 'WAVE');
  assert.equal(w.readUInt32LE(24), 16_000);
  assert.equal(w.readUInt16LE(22), 1, 'mono');
  assert.equal(w.readUInt16LE(34), 16, '16 bit');
  assert.equal(w.readUInt32LE(40), 60 * 16_000 * 2);
  assert.equal(p[2].wav.readUInt32LE(40), 10 * 16_000 * 2, 'son parça 10 sn');
  assert.deepEqual(pcmWavParcalari(Buffer.alloc(0)), []);
});

test('zaman damgası ve video ek metni: kareler, konuşma yazısı ya da nedeni', () => {
  assert.equal(zamanDamgasi(65.4), '1:05');
  assert.equal(zamanDamgasi(3723), '1:02:03');
  const m = videoEkMetni({ ad: 'toplanti.mp4', sureSn: 134, genislik: 1920, yukseklik: 1080, kareZamanlari: [16, 50, 83, 117], yazi: [{ bas: 0, metin: ' Merhaba ekip ' }, { bas: 60, metin: 'Bütçe onaylandı.' }] });
  assert.match(m, /^Video: toplanti\.mp4 · 2 dk 14 sn · 1920×1080$/m);
  assert.match(m, /Kareler: 4 kare \(0:16, 0:50, 1:23, 1:57\) bu mesaja görsel olarak ekli\./);
  assert.match(m, /\[0:00\] Merhaba ekip\n\[1:00\] Bütçe onaylandı\./);
  const y = videoEkMetni({ ad: 'a.webm', sureSn: 5, kareZamanlari: [], yazi: null, sesNotu: 'bu bilgisayarda yerel Whisper kurulu değil.' });
  assert.match(y, /Konuşma yazısı yok: bu bilgisayarda yerel Whisper kurulu değil\./);
  assert.doesNotMatch(y, /Kareler/);
});
