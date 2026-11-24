// Görev 27: geçmiş oturum dökümü (JSONL'nin sonundan, sayfalı), "başka yerde açık" tespiti, projeler, CLAUDE.md, auth durumu (yalnız
// iki alan), etkin ajanlar ve git özeti. Her şey geçici klasörde: gerçek ~/.claude'a ve gerçek claude.exe'ye dokunulmaz.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';

const kok = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber-cc-dokum-'));
process.env.FUBER_CLAUDE_DIZIN = path.join(tmp, '.claude');
process.env.FUBER_CLAUDE_KOMUT = JSON.stringify([process.execPath, path.join(kok, 'scripts/dev/sahte-claude.mjs')]);
delete process.env.FUBER_SAHTE_CLAUDE_KAYIT;
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const { dokumOku, oturumDosyasiBul, baskaYerdeAcik, projeleriTopla, claudeMdOku, claudeMdYaz, YAKIN_YAZIM_MS, bilinenProjeKlasoru, dosyaEslestir } = await import('../src/main/claudecode/dokum.ts');
const { ccAuthDurumu, authCiktisiniOku, etkinAjanMetni, ajanOnbellekSil, gitOzeti, gitFark, porcelainCoz, ajanlardaAcik, projeDosyalari, dosyaOnbellekSil,
  guvenliOldur, surecBaslat, yasiyorMu, bizimPidler } = await import('../src/main/claudecode/yurutucu.ts');
const gitVar = () => { try { execFileSync('git', ['--version'], { windowsHide: true, stdio: 'ignore' }); return true; } catch { return false; } };

const KIMLIK = 'dddd4444-0000-4000-8000-000000000004';
const projeKlasoru = path.join(tmp, 'kod', 'mavi');
fs.mkdirSync(projeKlasoru, { recursive: true });
const dosya = path.join(process.env.FUBER_CLAUDE_DIZIN, 'projects', 'C--kod-mavi', `${KIMLIK}.jsonl`);
fs.mkdirSync(path.dirname(dosya), { recursive: true });
// 40 tur: kullanıcı istemi + asistan (metin + araç) + araç sonucu; arada meta ve dev bir satır (> 4 MB, atlanmalı).
const satirlar: unknown[] = [];
for (let i = 0; i < 40; i++) {
  const t = new Date(Date.UTC(2026, 9, 20, 10, i)).toISOString();
  satirlar.push({ type: 'user', uuid: `u${i}`, timestamp: t, cwd: projeKlasoru, message: { role: 'user', content: `istem ${i} ğüşiöç` } });
  satirlar.push({ type: 'assistant', uuid: `a${i}`, timestamp: t, message: { id: `m${i}`, role: 'assistant', content: [{ type: 'text', text: `yanıt ${i}` }, { type: 'tool_use', id: `t${i}`, name: 'Read', input: { file_path: `f${i}.ts` } }] } });
  satirlar.push({ type: 'user', uuid: `r${i}`, timestamp: t, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: i === 20 ? 'z'.repeat(5 * 1024 * 1024) : `içerik ${i}` }] } });
  if (i % 10 === 0) satirlar.push({ type: 'user', isMeta: true, message: { role: 'user', content: 'meta' } });
}
fs.writeFileSync(dosya, satirlar.map((s) => JSON.stringify(s)).join('\n') + '\n');
const eski = Date.now() - 3600_000;
fs.utimesSync(dosya, eski / 1000, eski / 1000);

test('döküm: dosyanın SONUNDAN sayfa sayfa ("Daha eskisi" imleciyle) kronolojik okunur; Türkçe karakterler bozulmaz', () => {
  assert.equal(oturumDosyasiBul(KIMLIK), dosya);
  assert.equal(oturumDosyasiBul('../../etc'), null, 'yol kaçışı yok');
  const s1 = dokumOku(dosya, { adet: 6 });
  const kullanici = (s: typeof s1) => s.olaylar.filter((x) => x.olay.tur === 'kullanici').map((x) => (x.olay as { metin: string }).metin);
  assert.deepEqual(kullanici(s1), ['istem 38 ğüşiöç', 'istem 39 ğüşiöç']);
  assert.equal(s1.olaylar.at(-1)!.olay.tur, 'arac-bitti');
  assert.ok(s1.once !== null && s1.once > 0);
  assert.equal(s1.olaylar[0].zaman, Date.parse(new Date(Date.UTC(2026, 9, 20, 10, 38)).toISOString()));
  const s2 = dokumOku(dosya, { adet: 6, once: s1.once! });
  assert.deepEqual(kullanici(s2), ['istem 36 ğüşiöç', 'istem 37 ğüşiöç']);
  // Sona kadar sayfala: her istem bir kez, sırayla; dev satır (5 MB'lık araç çıktısı) atlanır ama sayfalama bozulmaz.
  const hepsi: string[] = [];
  let once: number | null | undefined;
  let tur = 0;
  let devSonucu = false;
  do {
    const s = dokumOku(dosya, { adet: 25, ...(once != null ? { once } : {}) });
    hepsi.unshift(...kullanici(s));
    if (s.olaylar.some((x) => x.olay.tur === 'arac-bitti' && (x.olay as { id: string }).id === 't20')) devSonucu = true;
    once = s.once;
    tur++;
  } while (once !== null && tur < 50);
  assert.equal(once, null, 'başa gelindi');
  assert.deepEqual(hepsi, Array.from({ length: 40 }, (_, i) => `istem ${i} ğüşiöç`));
  assert.equal(devSonucu, false, '4 MB üstü satır atlandı');
});

test('döküm: tek satırlık, satır sonu olmayan ve boş dosya', () => {
  const d = path.join(tmp, 'tek.jsonl');
  fs.writeFileSync(d, JSON.stringify({ type: 'user', message: { role: 'user', content: 'yalnız' } }));
  const s = dokumOku(d, { adet: 10 });
  assert.deepEqual(s.olaylar.map((x) => x.olay.tur), ['kullanici']);
  assert.equal(s.once, null);
  fs.writeFileSync(d, '');
  assert.deepEqual(dokumOku(d).olaylar, []);
});

test('başka yerde açık: JSONL son 90 sn içinde yazıldıysa ya da `claude agents --json` kimliği içeriyorsa; uygulamanın CANLI oturumu sayılmaz', async () => {
  ajanOnbellekSil();
  const ajan = () => etkinAjanMetni();
  const bos = { canli: new Set<string>() };
  assert.deepEqual(await baskaYerdeAcik(KIMLIK, bos, ajan), { acik: false });
  fs.utimesSync(dosya, new Date(), new Date());
  assert.deepEqual(await baskaYerdeAcik(KIMLIK, bos, ajan), { acik: true, neden: 'yakin-yazildi' });
  assert.deepEqual(await baskaYerdeAcik(KIMLIK, { canli: new Set([KIMLIK]) }, ajan), { acik: false }, 'kendi canlı oturumumuz');
  assert.deepEqual(await baskaYerdeAcik(KIMLIK, bos, ajan, Date.now() + YAKIN_YAZIM_MS + 1000), { acik: false });
  fs.utimesSync(dosya, eski / 1000, eski / 1000);
  // 2.1.310'un gerçek biçimi (denetleyici doğruladı): nesne dizisi, sessionId + pid; açık terminal oturumu da listelenir.
  process.env.SAHTE_CC_AJANLAR = JSON.stringify([{ id: 'a1', cwd: projeKlasoru, kind: 'interactive', startedAt: 1, sessionId: KIMLIK, name: 'x', state: 'running', pid: 999_991, status: 'idle', waitingFor: null }]);
  ajanOnbellekSil();
  try {
    assert.deepEqual(await baskaYerdeAcik(KIMLIK, bos, ajan), { acik: true, neden: 'etkin-ajan' });
    assert.deepEqual(await baskaYerdeAcik('eeee5555-0000-4000-8000-000000000005', bos, ajan), { acik: false });
    assert.deepEqual(await baskaYerdeAcik(KIMLIK, { canli: new Set(), pidler: new Set([999_991]) }, ajan), { acik: false }, 'listedeki süreç bizim');
  } finally {
    delete process.env.SAHTE_CC_AJANLAR;
    ajanOnbellekSil();
  }
});

// Düzeltme 4: uygulamada kapatılan oturum — kendi kapanış yazımımız "başka yerde" sayılmaz, kapanıştan SONRAKİ yazım (terminal) sayılır.
test('başka yerde: kapanış zamanımızdan sonraki JSONL yazımı başkasınındır; bizim kapanış yazımımız değil', async () => {
  const yok = async () => '';
  const kapanis = Date.now() - 10_000;
  fs.utimesSync(dosya, (kapanis + 1000) / 1000, (kapanis + 1000) / 1000); // kapanırken bizim yazdığımız
  assert.deepEqual(await baskaYerdeAcik(KIMLIK, { canli: new Set(), kapanislar: new Map([[KIMLIK, kapanis]]) }, yok), { acik: false });
  fs.utimesSync(dosya, (kapanis + 8000) / 1000, (kapanis + 8000) / 1000); // kapandıktan 8 sn sonra terminal yazdı
  assert.deepEqual(await baskaYerdeAcik(KIMLIK, { canli: new Set(), kapanislar: new Map([[KIMLIK, kapanis]]) }, yok), { acik: true, neden: 'yakin-yazildi' });
  fs.utimesSync(dosya, eski / 1000, eski / 1000);
});

test('`claude agents --json` ayrıştırma: sessionId eşleşmesi, bizim PID hariç; ayrıştırılamazsa metinde arama', () => {
  const liste = JSON.stringify([{ id: 'b', sessionId: 'S1', pid: 10, kind: 'background', status: 'busy' }, { id: 'c', sessionId: 'S2', kind: 'interactive' }]);
  assert.equal(ajanlardaAcik(liste, 'S1'), true);
  assert.equal(ajanlardaAcik(liste, 'S1', new Set([10])), false);
  assert.equal(ajanlardaAcik(liste, 'S2'), true);
  assert.equal(ajanlardaAcik(liste, 'S3'), false);
  assert.equal(ajanlardaAcik(JSON.stringify([{ id: 'S1' }]), 'S1'), false, 'yalnız sessionId alanı');
  assert.equal(ajanlardaAcik('eski biçim: S9 çalışıyor', 'S9'), true, 'ayrıştırılamayan çıktıda metin araması');
  assert.equal(ajanlardaAcik('', 'S1'), false);
});

test('bilinen proje klasörü (CLAUDE.md, @ önerisi, telefon): yalnız listedeki mutlak ve var olan klasör', () => {
  assert.equal(bilinenProjeKlasoru(projeKlasoru.toUpperCase(), [projeKlasoru]), projeKlasoru);
  assert.throws(() => bilinenProjeKlasoru(tmp, [projeKlasoru]), /bilinen bir Claude Code projesi değil/);
  assert.throws(() => bilinenProjeKlasoru('goreli/yol', [projeKlasoru]), /Geçersiz/);
  assert.throws(() => bilinenProjeKlasoru(path.join(tmp, 'yok'), [path.join(tmp, 'yok')]), /bulunamadı/);
});

test('"@" dosya önerisi: .gitignore\'a uyar (git ls-files -co --exclude-standard), git yoksa sınırlı gezinti; önek > ad > bulanık; en çok 50', async () => {
  // dosya adının başı (kısa önce) → klasör adının başı → bulanık (harf sırası korunur); eşleşmeyen yok.
  assert.deepEqual(dosyaEslestir(['src/app.ts', 'src/apple/x.ts', 'test/app.test.ts', 'README.md', 'docs/a/p/p.md'], 'app'), ['src/app.ts', 'test/app.test.ts', 'src/apple/x.ts', 'docs/a/p/p.md']);
  assert.deepEqual(dosyaEslestir(['src/app.ts', 'srcmap.ts'], 'src/'), ['src/app.ts'], 'yol öneki');
  assert.deepEqual(dosyaEslestir(['src/main/oturum.ts', 'src/shared/olay.ts'], 'smo'), ['src/main/oturum.ts']);
  assert.deepEqual(dosyaEslestir(['README.md', 'src/a.ts', 'b.ts'], ''), ['b.ts', 'README.md', 'src/a.ts']);
  assert.equal(dosyaEslestir(Array.from({ length: 200 }, (_, i) => `d/f${i}.ts`), 'f').length, 50);
  const d = path.join(tmp, 'kod', 'oneri');
  fs.mkdirSync(path.join(d, 'src'), { recursive: true });
  fs.mkdirSync(path.join(d, 'node_modules', 'paket'), { recursive: true });
  fs.writeFileSync(path.join(d, 'src', 'ana.ts'), '');
  fs.writeFileSync(path.join(d, 'gizli.log'), '');
  fs.writeFileSync(path.join(d, 'node_modules', 'paket', 'i.js'), '');
  fs.writeFileSync(path.join(d, '.gitignore'), '*.log\nnode_modules/\n');
  const gezinti = await projeDosyalari(d); // depo değil → gezinti (node_modules atlanır)
  assert.deepEqual([gezinti.liste.sort(), gezinti.kisaltildi, gezinti.kaynak], [['.gitignore', 'gizli.log', 'src/ana.ts'], false, 'gezinti']);
  if (!gitVar()) return;
  execFileSync('git', ['-C', d, 'init', '-q'], { windowsHide: true, stdio: 'ignore' });
  dosyaOnbellekSil();
  const g = await projeDosyalari(d);
  assert.deepEqual([g.liste.sort(), g.kisaltildi, g.kaynak], [['.gitignore', 'src/ana.ts'], false, 'git'], '.gitignore\'daki *.log ve node_modules yok');
});

/**
 * Bir klasör taramasının ana süreci dondurup dondurmadığını SAYAÇLA ölçer (G12a; duvar saati değil — yükte kayar). Tarama sürerken:
 * (1) eşzamanlı klasör/stat işlevleri (`readdirSync`…) çağrılırsa adları `esZamanli`ya yazılır; (2) her eşzamansız klasör okumasının
 * (`opendir`/`readdir`, geri çağrılı ve `promises`) başladığı andaki olay döngüsü TUR sayısı kaydedilir (tur = bir `setImmediate`
 * nabzı; döngü her dönüşünde bir kez atar). Ardışık iki okuma arasında tur ilerlediyse döngü o arada döndü (`ilerleyen`).
 * Eşzamanlı gezinti: esZamanli ≠ [] ve eşzamansız okuma yok; yük bu sayaçları değiştirmez.
 */
function taramaIzle() {
  let tur = 0;
  let calisiyor = true;
  const nabiz = () => { tur++; if (calisiyor) setImmediate(nabiz); };
  setImmediate(nabiz);
  const esZamanli: string[] = [];
  const okumaTurleri: number[] = [];
  const geri: (() => void)[] = [];
  const sar = (nesne: Record<string, unknown>, ad: string, kayit: () => void) => {
    const asil = nesne[ad];
    if (typeof asil !== 'function') return;
    nesne[ad] = function (this: unknown, ...a: unknown[]) { kayit(); return (asil as (...x: unknown[]) => unknown).apply(this, a); };
    geri.push(() => { nesne[ad] = asil; });
  };
  const fsNesne = fs as unknown as Record<string, unknown>;
  for (const ad of ['readdirSync', 'opendirSync', 'globSync', 'statSync', 'lstatSync']) sar(fsNesne, ad, () => esZamanli.push(ad));
  for (const ad of ['opendir', 'readdir']) {
    sar(fsNesne, ad, () => okumaTurleri.push(tur));
    sar(fs.promises as unknown as Record<string, unknown>, ad, () => okumaTurleri.push(tur));
  }
  syncBuiltinESMExports();
  return {
    bitir() {
      calisiyor = false;
      for (const g of geri.reverse()) g();
      syncBuiltinESMExports();
      let ilerleyen = 0;
      for (let i = 1; i < okumaTurleri.length; i++) if (okumaTurleri[i] > okumaTurleri[i - 1]) ilerleyen++;
      return { esZamanli, okuma: okumaTurleri.length, ilerleyen };
    },
  };
}

// Düzeltme B: dosya önerisi ana süreci DONDURMAZ — eşzamansız, klasör/süre bütçeli, kısmi sonuç işaretli; cwd başına tek tarama;
// git taşarsa gezintiye düşülmez (kısmi git listesi).
test('dosya önerisi: çok klasörlü ağaçta bütçe içinde döner, olay döngüsü akar (IPC yanıt verir), kısmi sonuç işaretlenir', { timeout: 180_000 }, async () => { // zaman aşımı yalnız takılma bekçisi
  // Görev 26 (G27 park küçüğü): test eşzamanlı bir gezintiyi HİÇ yakalayamıyordu — gezinti taramanın SON adımı ve `await`ın hemen
  // ardından clearInterval geliyordu: bloktan sonra nabız bir kez bile atmadan durduruluyor, boşluk ölçülmüyordu (eşzamanlı mutasyonla
  // 145–190 ms bloklayan gezinti "6 ms" ölçüldü). Artık nabız bloktan sonra en az bir kez atar (30 ms bekleme). Ayrıca fikstür eşiği
  // açıkça aşacak büyüklükte (4000 klasör: eşzamanlı gezinti ~110–190 ms; eşzamansızın en uzun boşluğu ~7–11 ms) ve eşik 50 ms
  // (eskiden 2500 klasör / 120 ms: eşzamanlı gezinti ~75–130 ms, eşiğin altında kalabiliyordu).
  const d = path.join(tmp, 'kod', 'kalabalik');
  for (let i = 0; i < 4000; i++) { const k = path.join(d, `k${i % 50}`, `alt${i}`); fs.mkdirSync(k, { recursive: true }); fs.writeFileSync(path.join(k, 'f.ts'), ''); }
  // Dizin sınırı: kısmi + işaretli. G12a: süre bütçesi bu sınamayı etkilemesin diye çok büyük (yük altında 300 ms'lik varsayılan, ilk
  // dosyadan önce bitip "0 dosya" döndürebiliyordu); yalnız DİZİN sınırı keser.
  dosyaOnbellekSil();
  const sinirli = await projeDosyalari(d, { dizinSiniri: 100, sureMs: 600_000 });
  assert.equal(sinirli.kisaltildi, true);
  assert.ok(sinirli.liste.length > 0 && sinirli.liste.length < 4000, `${sinirli.liste.length} dosya`);
  // Olay döngüsü taramanın sürdüğü boyunca akar.
  // G12a (kararlı ölçüm): eskiden "5 ms'lik nabızda en uzun boşluk < 50 ms" ve "tarama < 1,5 sn" duvar saatiydi; makine yükteyken
  // (başka süreçler CPU'yu paylaşırken) işletim sistemi bizi 50 ms'den uzun bekletince DOĞRU kod da düşüyordu. Artık ölçü SAYAÇ: (a) tarama
  // boyunca hiçbir eşzamanlı klasör okuması (readdirSync/opendirSync/…) çağrılmaz, (b) her klasör okuması eşzamansız yapılır ve ardışık
  // iki okuma arasında olay döngüsü EN AZ BİR tur döner (setImmediate sayacı ilerler). Eşzamanlı gezinti bu sayaçlarda her yükte yakalanır
  // (okuma sayısı ≠ 0, eşzamansız okuma yok); doğru kod her yükte geçer (sayaç duvar saatine bağlı değil). Tarama süre bütçesiyle
  // KESİLMESİN diye bütçe çok büyük verilir (yükte 300 ms'lik varsayılan taramayı erken kesip sayacı küçültür); bütçenin kendisi
  // aşağıda SANAL saatle sınanır. Böylece sonuç TAM'dır: 4000 klasör, 4000 dosya, işaretsiz.
  dosyaOnbellekSil();
  // 0.11 G12b (inceleme kalanı): tarama hata verirse de sarmalayıcılar geri alınır ve nabız durur (try/finally) — yoksa `fs.readdir…` sarılı
  // kalır, setImmediate döngüsü süreci açık tutar ve sonraki testler bozuk fs ile koşardı.
  const iz = taramaIzle();
  let tam: Awaited<ReturnType<typeof projeDosyalari>>;
  let ozet: ReturnType<typeof iz.bitir>;
  try { tam = await projeDosyalari(d, { sureMs: 600_000 }); } finally { ozet = iz.bitir(); }
  assert.equal(ozet.esZamanli.length, 0, `tarama ${ozet.esZamanli.length} eşzamanlı klasör okuması yaptı (ana süreci dondurur): ${[...new Set(ozet.esZamanli)].join(', ')}`);
  assert.ok(ozet.okuma >= 4000, `${ozet.okuma} eşzamansız klasör okuması (4000 klasör gezilmeliydi)`);
  assert.ok(ozet.ilerleyen >= 0.9 * (ozet.okuma - 1), `klasör okumaları arasında olay döngüsü dönmedi: ${ozet.ilerleyen}/${ozet.okuma - 1}`);
  assert.equal(tam.liste.length, 4000);
  assert.equal(tam.kisaltildi, false);
  // Süre bütçesi aşılınca kısmi: gerçek saat değil SANAL saat (her Date.now() çağrısı 1 ms ilerler) — bütçe 50 birimse, gezintinin her
  // dosyada bütçeye baktığı varsayımıyla, 50'den fazla dosya listelenemez; yük sonucu değiştirmez.
  dosyaOnbellekSil();
  const gercekSimdi = Date.now;
  let sanal = 1_000_000;
  Date.now = () => ++sanal;
  let butceli;
  try { butceli = await projeDosyalari(d, { sureMs: 50 }); } finally { Date.now = gercekSimdi; }
  assert.equal(butceli.kisaltildi, true);
  assert.ok(butceli.liste.length <= 50, `${butceli.liste.length} dosya (sanal bütçe 50)`);
  // Süre bütçesi aşılınca kısmi.
  dosyaOnbellekSil();
  const kisa = await projeDosyalari(d, { sureMs: 1 });
  assert.equal(kisa.kisaltildi, true);
});

test('dosya önerisi: aynı klasörde eşzamanlı istekler TEK taramayı paylaşır; sonuç önbellekten', async () => {
  const d = path.join(tmp, 'kod', 'tek-tarama');
  fs.mkdirSync(path.join(d, 'src'), { recursive: true });
  fs.writeFileSync(path.join(d, 'src', 'a.ts'), '');
  dosyaOnbellekSil();
  const [a, b, c] = await Promise.all([projeDosyalari(d), projeDosyalari(d), projeDosyalari(d)]);
  assert.ok(a === b && b === c, 'üç tuş vuruşu tek tarama');
  assert.equal(await projeDosyalari(d), a, 'önbellek');
});

test('dosya önerisi: git listesi taşarsa gezintiye DÜŞÜLMEZ — kısmi git listesi (yok sayılanlar hâlâ yok) işaretli döner', async () => {
  if (!gitVar()) return;
  const d = path.join(tmp, 'kod', 'tasan-depo');
  fs.mkdirSync(d, { recursive: true });
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(d, `dosya-${String(i).padStart(2, '0')}.ts`), '');
  fs.writeFileSync(path.join(d, 'gizli.log'), '');
  fs.writeFileSync(path.join(d, '.gitignore'), '*.log\n');
  execFileSync('git', ['-C', d, 'init', '-q'], { windowsHide: true, stdio: 'ignore' });
  dosyaOnbellekSil();
  const r = await projeDosyalari(d, { gitAzamiBayt: 120 });
  assert.equal(r.kaynak, 'git', 'gezintiye düşüldü');
  assert.equal(r.kisaltildi, true);
  assert.ok(r.liste.length > 0 && r.liste.length < 41, `${r.liste.length} yol`);
  assert.ok(!r.liste.includes('gizli.log'));
  assert.ok(r.liste.every((p) => /^(\.gitignore|dosya-\d\d\.ts)$/.test(p)), `yarım yol yok: ${r.liste}`);
});

test('auth durumu: `claude auth status` çıktısından YALNIZ giriş durumu ve yöntem (e-posta, belirteç, kuruluş asla)', async () => {
  try {
    process.env.SAHTE_CC_AUTH = 'acik';
    const a = await ccAuthDurumu();
    assert.deepEqual(a, { kurulu: true, girisYapildi: true, yontem: 'claude.ai' });
    assert.doesNotMatch(JSON.stringify(a), /gizli|sk-ant|Kuruluş|max/);
    process.env.SAHTE_CC_AUTH = 'kapali';
    assert.deepEqual(await ccAuthDurumu(), { kurulu: true, girisYapildi: false, yontem: 'none' });
    process.env.SAHTE_CC_AUTH = 'bozuk';
    assert.deepEqual(await ccAuthDurumu(), { kurulu: true, girisYapildi: false, hata: 'Claude Code oturum durumu okunamadı.' });
  } finally {
    delete process.env.SAHTE_CC_AUTH;
  }
  assert.deepEqual(authCiktisiniOku('uyarı satırı\n{"loggedIn":true,"authMethod":"api-key","apiKey":"sk-x"}\n'), { girisYapildi: true, yontem: 'api-key' });
  assert.equal(authCiktisiniOku('json yok'), null);
});

test('projeler: oturum klasörlerinden (son etkinlik, oturum sayısı, dal, CLAUDE.md var mı), canlı oturum klasörleri de', () => {
  fs.writeFileSync(path.join(projeKlasoru, 'CLAUDE.md'), '# Mavi\n');
  const yeni = path.join(tmp, 'kod', 'yeni');
  fs.mkdirSync(yeni);
  const p = projeleriTopla([
    { id: '1', dosya: '', cwd: projeKlasoru, proje: 'mavi', baslik: 'a', istemler: [], istemSayisi: 1, sonZaman: '2026-10-20T10:00:00Z', dal: 'eski', boyut: 0, okunan: 0 },
    { id: '2', dosya: '', cwd: projeKlasoru, proje: 'mavi', baslik: 'b', istemler: [], istemSayisi: 1, sonZaman: '2026-10-21T10:00:00Z', dal: 'main', boyut: 0, okunan: 0 },
    { id: '3', dosya: '', cwd: path.join(tmp, 'silinmis'), proje: 'silinmis', baslik: 'c', istemler: [], istemSayisi: 1, sonZaman: '2026-10-19T10:00:00Z', boyut: 0, okunan: 0 },
  ], [yeni]);
  assert.deepEqual(p.map((x) => [x.ad, x.oturumSayisi, x.dal, x.claudeMd, x.var]), [['yeni', 0, undefined, false, true], ['mavi', 2, 'main', true, true], ['silinmis', 1, undefined, false, false]]);
});

test('CLAUDE.md: yalnız proje kökündeki dosya; okunduktan sonra değiştiyse yazılmaz; atomik yazım', () => {
  const d = path.join(tmp, 'kod', 'md');
  fs.mkdirSync(d);
  const bos = claudeMdOku(d);
  assert.deepEqual([bos.var, bos.icerik, bos.yol], [false, '', path.join(d, 'CLAUDE.md')]);
  const y1 = claudeMdYaz(d, '# Kurallar\nTürkçe yaz.\n', bos.ozet);
  assert.equal(y1.tamam, true);
  const okunan = claudeMdOku(d);
  assert.equal(okunan.icerik, '# Kurallar\nTürkçe yaz.\n');
  assert.equal(okunan.ozet, y1.ozet);
  fs.writeFileSync(path.join(d, 'CLAUDE.md'), 'başka biri yazdı');
  assert.deepEqual(claudeMdYaz(d, 'benim', okunan.ozet), { tamam: false, kod: 'degisti' });
  assert.equal(claudeMdOku(d).icerik, 'başka biri yazdı');
  assert.deepEqual(claudeMdYaz(d, 'x'.repeat(1024 * 1024 + 1), undefined), { tamam: false, kod: 'buyuk' });
  assert.deepEqual(fs.readdirSync(d), ['CLAUDE.md'], 'geçici dosya kalmadı');
});

test('git özeti: argüman dizisiyle; depo değilse git:false; değişen/izlenmeyen dosyalar ve fark; klasör dışına çıkılmaz', async () => {
  assert.deepEqual(porcelainCoz(' M a.ts\0R  yeni.ts\0eski.ts\0?? not.md\0'), [{ yol: 'a.ts', durum: 'M' }, { yol: 'yeni.ts', durum: 'R' }, { yol: 'not.md', durum: '??' }]);
  const d = path.join(tmp, 'kod', 'depo');
  fs.mkdirSync(d);
  assert.deepEqual(await gitOzeti(d), { git: false, dosyalar: [] });
  if (!gitVar()) return;
  const g = (...a: string[]) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { windowsHide: true, stdio: 'ignore' });
  g('init', '-q', '-b', 'deneme');
  fs.writeFileSync(path.join(d, 'a.txt'), 'bir\n');
  g('add', 'a.txt');
  g('commit', '-q', '-m', 'ilk');
  fs.writeFileSync(path.join(d, 'a.txt'), 'iki\n');
  fs.writeFileSync(path.join(d, 'yeni dosya.md'), 'merhaba\n');
  const o = await gitOzeti(d);
  assert.equal(o.git, true);
  assert.equal(o.dal, 'deneme');
  assert.deepEqual(o.dosyalar.sort((x, y) => x.yol.localeCompare(y.yol)), [{ yol: 'a.txt', durum: 'M' }, { yol: 'yeni dosya.md', durum: '??' }]);
  const f = await gitFark(d, 'a.txt');
  assert.match(f.fark, /-bir\n\+iki/);
  assert.match((await gitFark(d, 'yeni dosya.md')).fark, /\+merhaba/);
  await assert.rejects(gitFark(d, '..\\..\\disari.txt'), /dışında/);
});

// Görev 28 düzeltme 2 (N2): proje bir deponun ALT klasörüyse git yolları proje klasörüne göre (porcelain depo köküne göre yazar);
// proje dışındaki değişiklikler listelenmez; oturumun dosyaları denetçide "Bu oturumda" doğru durumla, farkı boş değil.
test('git özeti: proje deponun alt klasöründe — yollar projeye göre, dışarısı yok, "Bu oturumda" doğru durum ve dolu fark', async () => {
  if (!gitVar()) return;
  const depo = path.join(tmp, 'kod', 'tekdepo');
  const proje = path.join(depo, 'paketler', 'uygulama');
  fs.mkdirSync(path.join(proje, 'src'), { recursive: true });
  const g = (...a: string[]) => execFileSync('git', ['-C', depo, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { windowsHide: true, stdio: 'ignore' });
  g('init', '-q', '-b', 'ana');
  fs.writeFileSync(path.join(proje, 'src', 'a.ts'), 'export const a = 1;\n');
  fs.writeFileSync(path.join(depo, 'KOK.md'), 'kök\n');
  g('add', '.');
  g('commit', '-q', '-m', 'ilk');
  fs.writeFileSync(path.join(proje, 'src', 'a.ts'), 'export const a = 2;\n');
  fs.writeFileSync(path.join(proje, 'src', 'yeni.ts'), 'export const y = 1;\n');
  fs.writeFileSync(path.join(depo, 'KOK.md'), 'kök değişti\n'); // proje DIŞI
  const o = await gitOzeti(proje);
  assert.equal(o.git, true);
  assert.deepEqual(o.dosyalar.sort((x, y) => x.yol.localeCompare(y.yol)), [{ yol: 'src/a.ts', durum: 'M' }, { yol: 'src/yeni.ts', durum: '??' }], JSON.stringify(o.dosyalar));
  const { dosyaGruplari } = await import('../src/renderer/claudecode/yardimci.ts');
  const grup = dosyaGruplari({ ...o, oturumDosyalari: [path.join(proje, 'src', 'a.ts'), path.join(proje, 'src', 'yeni.ts')] }, [], proje);
  assert.deepEqual(grup.oturumda, [{ yol: 'src/a.ts', durum: 'M' }, { yol: 'src/yeni.ts', durum: '??' }]);
  assert.deepEqual(grup.diger, []);
  for (const f of grup.oturumda) assert.match((await gitFark(proje, f.yol)).fark, /^\+export const/m, `${f.yol} farkı boş`);
  assert.match((await gitFark(proje, 'src/a.ts')).fark, /-export const a = 1;\n\+export const a = 2;/);
});

// Düzeltme 12: bağlantı noktası / sembolik bağlantı proje dışına çıkarıyorsa fark okunmaz.
test('git farkı: proje içindeki bağlantı (junction) dışarıyı gösteriyorsa okunmaz', async () => {
  const d = path.join(tmp, 'kod', 'baglantili');
  const disari = path.join(tmp, 'disari');
  fs.mkdirSync(d, { recursive: true });
  fs.mkdirSync(disari, { recursive: true });
  fs.writeFileSync(path.join(disari, 'gizli.txt'), 'PROJE-DISI-SIR\n');
  fs.symlinkSync(disari, path.join(d, 'baglanti'), 'junction');
  await assert.rejects(gitFark(d, 'baglanti/gizli.txt'), /dışında/);
  fs.writeFileSync(path.join(d, 'ic.txt'), 'iceride\n');
  assert.match((await gitFark(d, 'ic.txt')).fark, /\+iceride/, 'proje içindeki gerçek dosya okunur');
});

// Düzeltme 12: deponun yapılandırması (diff.external, textconv, core.fsmonitor) git özeti/farkı sırasında program ÇALIŞTIRAMAZ.
test('git sertleştirme: diff.external / textconv / core.fsmonitor çalışmaz (aynı ayarla düz git çalıştırıyor — denetim geçerli)', async () => {
  if (!gitVar()) return;
  const d = path.join(tmp, 'kod', 'kotu-depo');
  fs.mkdirSync(d, { recursive: true });
  const isaret = path.join(tmp, 'isaret.txt');
  const betik = path.join(tmp, 'isaret.cjs');
  fs.writeFileSync(betik, `require('fs').appendFileSync(${JSON.stringify(isaret)}, 'calisti\\n');`);
  const komut = `"${process.execPath.replace(/\\/g, '/')}" "${betik.replace(/\\/g, '/')}"`;
  const g = (...a: string[]) => execFileSync('git', ['-C', d, '-c', 'user.name=t', '-c', 'user.email=t@t', ...a], { windowsHide: true, stdio: 'ignore' });
  g('init', '-q');
  fs.writeFileSync(path.join(d, 'a.txt'), 'bir\n');
  fs.writeFileSync(path.join(d, '.gitattributes'), '*.txt diff=sahte\n');
  g('add', '.');
  g('commit', '-q', '-m', 'ilk');
  fs.writeFileSync(path.join(d, 'a.txt'), 'iki\n');
  g('config', 'diff.external', komut);
  g('config', 'diff.sahte.textconv', komut);
  g('config', 'core.fsmonitor', komut);
  // Denetim: düz git bu ayarlarla programı çalıştırıyor.
  try { execFileSync('git', ['-C', d, 'diff', 'HEAD'], { windowsHide: true, stdio: 'ignore' }); } catch { /* dış fark aracı sıfır olmayan döner */ }
  try { execFileSync('git', ['-C', d, 'status'], { windowsHide: true, stdio: 'ignore' }); } catch { /* */ }
  assert.ok(fs.existsSync(isaret), 'denetim: düz git kötü yapılandırmayı çalıştırmalıydı');
  fs.rmSync(isaret);
  const o = await gitOzeti(d);
  const f = await gitFark(d, 'a.txt');
  assert.equal(o.git, true);
  assert.deepEqual(o.dosyalar, [{ yol: 'a.txt', durum: 'M' }]);
  assert.match(f.fark, /-bir\n\+iki/);
  assert.equal(fs.existsSync(isaret), false, 'deponun yapılandırması program çalıştırdı');
});

// Düzeltme 3: yalnız bizim başlattığımız ve yaşayan süreç öldürülür (yeniden kullanılmış PID başka programa ait olabilir).
test('güvenli öldürme: bizim olmayan süreç öldürülmez; bizimki ağacıyla öldürülür, çıkınca izlenmez', async () => {
  const { spawn } = await import('node:child_process');
  const yabanci = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e6)'], { stdio: 'ignore', windowsHide: true });
  try {
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(guvenliOldur(yabanci.pid), false);
    assert.equal(yasiyorMu(yabanci.pid!), true, 'yabancı süreç yaşıyor');
    const bizim = surecBaslat({ exe: process.execPath, onArgs: ['-e', 'setInterval(() => {}, 1e6)'], test: true }, { args: [], env: process.env });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal(guvenliOldur(bizim.pid), true);
    // G12a: sabit bekleme (3 sn + 100 ms) makine yükteyken yetmiyordu (taskkill ve çıkış olayı geç gelir). Koşul gerçekleşene dek
    // beklenir (üst sınır 10 sn: yalnız takılma bekçisi): önce işletim sistemi süreci kaldırdı, sonra uygulama çıkış anını kaydetti
    // (çıkış olayı; 31 sn sonrasına bakınca "izlenmiyor" olur).
    const bekle = () => new Promise((r) => setTimeout(r, 50));
    for (let i = 0; i < 200 && yasiyorMu(bizim.pid!); i++) await bekle();
    assert.equal(yasiyorMu(bizim.pid!), false);
    for (let i = 0; i < 200 && bizimPidler(Date.now() + 31_000).has(bizim.pid!); i++) await bekle();
    assert.equal(guvenliOldur(bizim.pid), false, 'çıkan süreç artık izlenmiyor');
    // `claude agents` için: çıkmış PID'imiz yalnız ~30 sn bizim sayılır (sonra numara başka sürece geçebilir).
    assert.equal(bizimPidler().has(bizim.pid!), true, 'az önce çıkan PID bizim');
    assert.equal(bizimPidler(Date.now() + 31_000).has(bizim.pid!), false, '30 sn sonra artık bizim sayılmaz');
  } finally {
    yabanci.kill();
  }
});
