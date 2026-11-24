// Yerel beyni kaldırma (src/main/yerel/kaldirma.ts; Görev 20b, K2 + G13/G11): indirme sürüyorsa önce durdurulur ve İŞİ BİTENE
// (yarım dosyanın yazıcısı kapanıp silinene) dek beklenir, sonra sunucu/ses süreçleri kapanıp çıkışları beklenir, en son klasör
// silinir. Eskiden durdur + hemen rmSync: Windows'ta açık dosya/çalışan .exe yüzünden EBUSY/EPERM/ENOTEMPTY riski.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { siraylaKaldir, klasoruSil, sureciKapat } from '../src/main/yerel/kaldirma.ts';

test('sıra: indirme durdurulur ve işi bitene dek beklenir → süreçler kapanır → klasör silinir', async () => {
  const olaylar: string[] = [];
  let bitir: () => void = () => undefined;
  const is = new Promise<void>((_, red) => { bitir = () => { olaylar.push('indirme temizlendi'); red(Object.assign(new Error('İndirme durduruldu.'), { name: 'AbortError' })); }; });
  const p = siraylaKaldir({
    suren: { durdur: () => { olaylar.push('durdur'); setTimeout(bitir, 40); }, is },
    surecleriKapat: async () => { olaylar.push('süreçler kapandı'); },
    sil: async () => { olaylar.push('silindi'); },
  });
  await p;
  assert.deepEqual(olaylar, ['durdur', 'indirme temizlendi', 'süreçler kapandı', 'silindi']);
});

test('indirme yoksa doğrudan süreçler ve silme; indirme hatası kaldırmayı durdurmaz', async () => {
  const olaylar: string[] = [];
  await siraylaKaldir({ suren: null, surecleriKapat: async () => { olaylar.push('kapat'); }, sil: async () => { olaylar.push('sil'); } });
  await siraylaKaldir({ suren: { durdur: () => undefined, is: Promise.reject(new Error('Diskte yer kalmadı.')) }, surecleriKapat: async () => { olaylar.push('kapat2'); }, sil: async () => { olaylar.push('sil2'); } });
  assert.deepEqual(olaylar, ['kapat', 'sil', 'kapat2', 'sil2']);
});

test('açık yazıcıyı kapatan indirme beklenince klasör sorunsuz silinir (gerçek dosya sistemi)', async () => {
  const kok = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-yerel-kaldir-'));
  fs.mkdirSync(path.join(kok, 'modeller'), { recursive: true });
  fs.writeFileSync(path.join(kok, 'modeller', 'eski.gguf'), Buffer.alloc(1024));
  const gecici = path.join(kok, 'modeller', 'yeni.gguf.indiriliyor');
  const yaz = fs.createWriteStream(gecici);
  const durdurucu = new AbortController();
  // Sahte indirme: durdurulana dek yazar; durunca indir() gibi yazıcıyı kapatır ve yarım dosyayı siler.
  const is = (async () => {
    while (!durdurucu.signal.aborted) { yaz.write(Buffer.alloc(64 * 1024)); await new Promise((r) => setTimeout(r, 5)); }
    await new Promise<void>((c) => yaz.end(c));
    fs.rmSync(gecici, { force: true });
    throw Object.assign(new Error('İndirme durduruldu.'), { name: 'AbortError' });
  })();
  await new Promise((r) => setTimeout(r, 30));
  await siraylaKaldir({ suren: { durdur: () => durdurucu.abort(), is }, surecleriKapat: async () => undefined, sil: () => klasoruSil(kok) });
  assert.equal(fs.existsSync(kok), false);
  assert.equal(yaz.closed, true, 'silmeden önce yazıcı kapanmıştı');
});

test('süreç kapatılır ve ÇIKIŞI beklenir (çalışan .exe silinemezdi); zaten kapalı süreç beklemez', async () => {
  const p = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
  await new Promise((r) => p.once('spawn', r));
  const t0 = Date.now();
  await sureciKapat(p, 5000);
  assert.ok(p.exitCode !== null || p.signalCode !== null, 'süreç çıktı');
  assert.ok(Date.now() - t0 < 5000);
  await sureciKapat(p, 5000); // ikinci kez: hemen döner
  await sureciKapat(null, 5000);
});
