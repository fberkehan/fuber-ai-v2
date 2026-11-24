// 0.13 G: masaüstü yerel model kataloğu (src/main/yerel/katalog.ts). Açık kaynaklı modeller Hugging Face'ten çekilir, kişi hangi modeli istiyorsa onu kullanabilir;
// modeller katalogda açılıp kapatılabilir. Liste sunucudan gelir, önbelleğe alınır; sunucu yoksa üç Bonsai.
// P14 mutlak: Gizli ve "Yalnız bu bilgisayar"da katalog ağa çıkmaz; kapatılan ama kurulu model çalışmaya devam eder. Önbellek bozuk ya da liste boş olsa da.
// Sahte hesap sunucusu 127.0.0.1'de her isteği sayar; Hugging Face'e giden indirme sahte fetch ile verilir (sahnenin ağ bekçisi başka her isteği düşürür).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { anaSurecSahnesi, ipcKurBos, ipcIsleyicileri } from './yardimci/ana-surec.ts';
import { yerelKatalog, KATALOG_BOS } from '../src/shared/yerel-katalog.ts';
import { yerelHataSade } from '../src/shared/yerel-bekleyen.ts';

const { klasor } = anaSurecSahnesi('yerel-katalog-sunucu', {
  kurulumTamam: true, mod: 'gelistirici', proaktif: { etkin: false }, baslangictaAc: false, ses: { surum: 2, uyandirma: false }, yerel: { gpu: 'cpu' },
});
(globalThis as Record<string, unknown>).__sifreleme = true;

// ── Sahte hesap sunucusu ──
const istekler: { yol: string; kimlik?: string }[] = [];
let yanit: { durum: number; govde: string } = { durum: 200, govde: '{"modeller":[]}' };
const sunucu = http.createServer((q, r) => {
  istekler.push({ yol: String(q.url), ...(q.headers.authorization ? { kimlik: q.headers.authorization } : {}) });
  r.statusCode = yanit.durum;
  r.setHeader('content-type', 'application/json');
  r.end(yanit.govde);
});
await new Promise<void>((c) => sunucu.listen(0, '127.0.0.1', () => c()));
after(() => sunucu.close());
const port = (sunucu.address() as { port: number }).port;
process.env.FUBER_DEMO = '1';
process.env.FUBER_HESAP_ADRES = `http://127.0.0.1:${port}`;
const YEREL = path.join(klasor, 'yerel');
process.env.FUBER_MODEL_DIZINI = YEREL;
process.env.FUBER_WHISPER_TABAN = 'http://127.0.0.1:9'; // 0.14.1: yazıya çevirme kurulu sayılır — bu dosya yalnız modelin inişini sınar (sesin inişi: yerel-ses-kurulum.test.ts)
(globalThis as Record<string, unknown>).__fuberTestDonanim = { ramGB: 32, nvidia: false, bosDiskGB: 400 };

await ipcKurBos();
const { ayarlariKaydet, ayarlar, sirYaz } = await import('../src/main/ayarlar.ts');
const { katalogListe, katalogBul, katalogYenile, katalogBildirici, modelDosyaYolu, kuruluModeliKaydet, hfAdresiMi } = await import('../src/main/yerel/katalog.ts');
const { YEREL_MODELLER, LLAMA, PIPER } = await import('../src/main/yerel/paketler.ts');
const { modelKuruluMu, yerelYollar, yerelKur, yerelIndirmeDurumu, yerelKuruluMu } = await import('../src/main/yerel/kurulum.ts');
const { yerelDurumu } = await import('../src/main/yerel/durum.ts');
const { yerelTaban, yerelSunucuDurumu } = await import('../src/main/yerel/sunucu.ts');
const { yerelModelEtiketi } = await import('../src/main/motor/yerel.ts');
const { yerelModelBilgileri } = await import('../src/main/motor/model-listesi.ts');
const { yedekKlasoru } = await import('../src/main/yerel/piper.ts');

const SIR = 'hesap:cihaz';
const ONBELLEK = path.join(klasor, 'yerel-katalog.json');
const BONSAI = ['bonsai2-27b', 'bonsai2-9b', 'bonsai2-4b'];
const GGUF = Buffer.concat([Buffer.from('GGUF'), Buffer.alloc(2048, 7)]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const kayit = (id: string, ek: Record<string, unknown> = {}) => ({
  id, hfRepo: 'Qwen/Qwen3-0.6B-GGUF', dosya: 'Qwen3-0.6B-Q8_0.gguf', ad: 'Qwen 3 · 0.6B', ozet: 'Küçük ve hızlı', boyut: GGUF.length, sha256: sha(GGUF), ramGB: 6, lisans: 'apache-2.0', acik: true, sira: 40, ...ek,
});
const liste = (...m: unknown[]) => ({ durum: 200, govde: JSON.stringify({ modeller: m }) });
const hesapAc = () => {
  sirYaz(SIR, 'SAHTE-cihaz-anahtari');
  ayarlariKaydet((a) => { a.hesap = { eposta: 'x@ornek.test', cihazAdi: 'test', durum: 'aktif' } as never; });
};
const sifirla = () => {
  fs.rmSync(ONBELLEK, { force: true });
  fs.rmSync(YEREL, { recursive: true, force: true });
  ayarlariKaydet((a) => { delete a.hesap; a.yerel.gizliMod = false; a.yerel.yalnizYerel = false; a.yerel.etkin = false; a.yerel.model = 'bonsai2-27b'; delete a.yerel.bekleyenKurulum; });
  sirYaz(SIR, null);
  istekler.length = 0;
  yanit = liste();
};
const modelDosyasiKoy = (k: Parameters<typeof modelDosyaYolu>[0], icerik: Buffer = GGUF) => {
  const y = modelDosyaYolu(k);
  fs.mkdirSync(path.dirname(y), { recursive: true });
  fs.writeFileSync(y, icerik);
  fs.writeFileSync(`${y}.dogrulandi`, k.sha256);
  return y;
};
/** Çalıştırıcı ve ses "kurulu": yerelKur yalnız modeli indirir (gerçek paketler inmez). */
const calistiriciKoy = () => {
  const k = path.join(YEREL, `llama-${LLAMA.surum}-cpu`);
  fs.mkdirSync(k, { recursive: true });
  fs.writeFileSync(path.join(k, 'llama-server.exe'), '');
  fs.writeFileSync(path.join(k, '.tamam'), 'test');
  const p = yedekKlasoru();
  fs.mkdirSync(p, { recursive: true });
  for (const d of ['piper.exe', PIPER.ses.ad, PIPER.sesAyari.ad, '.tamam']) fs.writeFileSync(path.join(p, d), 'test');
};
/** Hugging Face'in sahtesi: `bayt` döner, gidilen adresler kaydedilir. */
async function indirmeyle<T>(bayt: Buffer, f: () => Promise<T>): Promise<{ sonuc: T; adresler: string[] }> {
  const adresler: string[] = [];
  const gercek = globalThis.fetch;
  globalThis.fetch = (async (u: unknown) => { adresler.push(String(u)); return new Response(bayt, { status: 200, headers: { 'content-length': String(bayt.length) } }); }) as typeof fetch;
  try { return { sonuc: await f(), adresler }; } finally { globalThis.fetch = gercek; }
}

// ── Başlangıç listesi, önbellek ──
test('sunucu yoksa Bonsai üçlüsü: önbellek yok, hesap yok; kayıtlar paketler.ts ile aynı', () => {
  sifirla();
  assert.deepEqual(katalogListe().map((k) => k.id), BONSAI);
  const k = katalogBul('bonsai2-4b')!;
  const m = YEREL_MODELLER['bonsai2-4b'];
  assert.deepEqual([k.hfRepo, k.dosya, k.ad, k.ozet, k.boyut, k.sha256, k.ramGB, k.acik], ['prism-ml/Ternary-Bonsai-2-4B-gguf', m.ad, m.etiket, m.ozet, m.boyut, m.sha256, m.ramGB, true]);
  assert.equal(k.url, m.url);
  assert.equal(k.vramGB, undefined);
  assert.equal(katalogBul('bonsai2-27b')!.vramGB, 9);
  assert.equal(katalogBul('yok-boyle-bir-model'), null);
  assert.equal(katalogBul('__proto__'), null);
  assert.equal(katalogBul('constructor'), null);
});

test('bozuk önbellek yok sayılır: yarım JSON, yanlış biçim Bonsai üçlüsüne döner; geçerli kayıtlar bozuk komşusuyla düşmez', () => {
  sifirla();
  fs.writeFileSync(ONBELLEK, '{"modeller":[{"id"');
  assert.deepEqual(katalogListe().map((k) => k.id), BONSAI);
  fs.writeFileSync(ONBELLEK, JSON.stringify({ modeller: 5 }));
  assert.deepEqual(katalogListe().map((k) => k.id), BONSAI);
  fs.writeFileSync(ONBELLEK, JSON.stringify({ modeller: [{ id: 'yarim' }] }));
  assert.deepEqual(katalogListe().map((k) => k.id), BONSAI, 'hiçbir kaydı geçerli değil: boş liste sayılmaz');
  fs.writeFileSync(ONBELLEK, JSON.stringify({ modeller: [kayit('qwen-1'), { id: 'yarim' }, kayit('qwen-2', { sha256: 'kisa' })] }));
  assert.deepEqual(katalogListe().map((k) => k.id), ['qwen-1']);
});

// ── P14 ve anahtar kapıları ──
test("Gizli'de katalogYenile ağa çıkmaz; \"Yalnız bu bilgisayar\"da da, önbellek okunur", async () => {
  sifirla();
  hesapAc();
  fs.writeFileSync(ONBELLEK, JSON.stringify({ modeller: [kayit('onbellekteki')] }));
  ayarlariKaydet((a) => { a.yerel.gizliMod = true; });
  await katalogYenile();
  assert.deepEqual(istekler, [], 'Gizli: sunucuya SIFIR istek');
  assert.deepEqual(katalogListe().map((k) => k.id), ['onbellekteki']);
  ayarlariKaydet((a) => { a.yerel.gizliMod = false; a.yerel.yalnizYerel = true; });
  await katalogYenile();
  assert.deepEqual(istekler, [], 'Yalnız bu bilgisayar: sunucuya SIFIR istek');
  assert.deepEqual(katalogListe().map((k) => k.id), ['onbellekteki']);
});

test('anahtarsız istek gitmez: hesap yok, anahtar yok ya da yalnız biri var; önbellek ya da Bonsai üçlüsü', async () => {
  sifirla();
  await katalogYenile();
  assert.deepEqual(istekler, [], 'hesapsız');
  assert.deepEqual(katalogListe().map((k) => k.id), BONSAI);
  sirYaz(SIR, 'SAHTE-hesapsiz-anahtar');
  await katalogYenile();
  assert.deepEqual(istekler, [], 'anahtar var, hesap kaydı yok');
  sirYaz(SIR, null);
  ayarlariKaydet((a) => { a.hesap = { eposta: 'x@ornek.test', cihazAdi: 'test', durum: 'aktif' } as never; });
  await katalogYenile();
  assert.deepEqual(istekler, [], 'hesap kaydı var, anahtar yok');
});

test('Ayarlar: seçili modelin eski dosyası için "Yeniden indir" düğmesi yerel:kur yolundan gider', () => {
  const g = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src', 'renderer', 'ayarlar', 'Gizlilik.tsx'), 'utf8');
  assert.match(g, /data-yeniden-indir=""/);
  assert.match(g, /k\.indirmeIste\(eski, true\)/);
});

test('okunamayan başlık dosyayı silmez: karar verilemedi (virüs tarayıcısı kilidi model götürmesin)', async () => {
  const { ggufBasligi } = await import('../src/main/indirme.ts');
  const y = path.join(klasor, 'baslik.gguf');
  fs.writeFileSync(y, GGUF);
  assert.equal(ggufBasligi(y), true);
  fs.writeFileSync(y, 'GG');
  assert.equal(ggufBasligi(y), false, 'kısa dosya GGUF değil');
  fs.writeFileSync(y, 'gguf');
  assert.equal(ggufBasligi(y), false, 'büyük-küçük harf duyarlı');
  assert.equal(ggufBasligi(path.join(klasor, 'yok.gguf')), null, 'açılamadı: bilinmiyor');
});

// ── Okuyucular ──
test('yerel:kur: katalogda olmayan model reddedilir, ayardaki modele sessizce düşülmez; hiçbir şey indirilmez', async () => {
  sifirla();
  hesapAc();
  calistiriciKoy();
  ayarlariKaydet((a) => { a.yerel.model = 'bonsai2-4b'; });
  const { sonuc, adresler } = await indirmeyle(GGUF, () => ipcIsleyicileri().get('yerel:kur')!({}, 'kaldirilan-model', { ac: true }) as Promise<{ tamam: boolean; hata?: string }>);
  assert.equal(sonuc.tamam, false);
  assert.match(sonuc.hata ?? '', /artık sunulmuyor/);
  assert.equal(yerelHataSade(sonuc.hata ?? ''), 'Bu sürüm artık sunulmuyor; listeden başka bir sürüm seç.');
  assert.deepEqual(adresler, []);
  assert.equal(ayarlar().yerel.bekleyenKurulum, undefined);
  assert.equal(ayarlar().yerel.model, 'bonsai2-4b');
});

test('etiket bilinmeyen modelde fırlatmaz: kimlik döner (eski ayar, silinmiş model)', () => {
  sifirla();
  ayarlariKaydet((a) => { a.yerel.model = 'hic-olmayan'; });
  assert.equal(yerelModelEtiketi(), 'hic-olmayan');
  assert.equal(modelKuruluMu('hic-olmayan'), false);
  assert.equal(yerelYollar().model, null);
  sifirla();
});
