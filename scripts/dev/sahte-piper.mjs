// Sahte Piper (yalnız test): piper.exe gibi --json-input satırlarını okur, her satır için 22,05 kHz 16 bit tek kanal bir WAV yazar ve
// dosya yolunu stdout'a basar. Gerçek ses modeli yok; süre metin uzunluğuyla orantılı. FUBER_SAHTE_PIPER_KAYIT verilirse aldığı
// argümanları ve satırları oraya ekler.
import fs from 'node:fs';
import readline from 'node:readline';

const kayit = process.env.FUBER_SAHTE_PIPER_KAYIT;
if (kayit) fs.appendFileSync(kayit, `${JSON.stringify({ argv: process.argv.slice(2) })}\n`);
const hz = 22050;
const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (satir) => {
  let j; try { j = JSON.parse(satir); } catch { return; }
  if (kayit) fs.appendFileSync(kayit, `${JSON.stringify({ metin: j.text })}\n`);
  const ornek = Math.max(2205, Math.round(String(j.text ?? '').length * 0.05 * hz));
  const pcm = Buffer.alloc(ornek * 2);
  for (let i = 0; i < ornek; i++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 140 * i) / hz) * 8000), i * 2);
  const b = Buffer.alloc(44);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(hz, 24); b.writeUInt32LE(hz * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length, 40);
  setTimeout(() => { fs.writeFileSync(j.output_file, Buffer.concat([b, pcm])); process.stdout.write(`${j.output_file}\n`); }, 30);
});
