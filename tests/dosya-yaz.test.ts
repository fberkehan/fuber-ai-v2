// 0.14 T17 (R9, B22): dosya oluşturma, düzenleme, silme ve belge üretme araçları (grup 'dosya-yaz').
// Kurallar: yalnız kullanıcı klasörlerinde yazılır (Masaüstü, Belgeler, İndirilenler, OneDrive, İçe Aktar; bağlantı/".." ile kaçış yok);
// YENİ dosya onaysız, var olan dosyanın üzerine yazma (dosya_yaz uzerine, dosya_duzenle, belge_uret) ve silme HER SEFERİNDE onaylı (fark önizlemeli);
// silme Geri Dönüşüm Kutusu'na gider. Gerçek main/ajan/araclar/dosya-yaz.ts + belge-uret.ts; Electron sahte (shell.trashItem sahte kutu),
// USERPROFILE geçici klasör — kullanıcının gerçek Masaüstü/Belgeler/İndirilenler'ine yazılmaz.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import mammoth from 'mammoth';
// exceljs, ana-surec.ts'in modül kancası kurulduktan sonra İLK kez yüklenirse Node "module is not linked" der (yalnız bu test sahnesinde;
// üretimde kanca yok). Kanca kurulmadan önce yüklenir: sonraki `import('exceljs')` (belge-uret.ts) önbellekten gelir.
import 'exceljs';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';

const sahne = anaSurecSahnesi('dosya-yaz', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false }, baslangictaAc: false,
});
process.env.FUBER_DEMO = '1';
await esbuildHazir();
const { dosyaYazAraclariniKaydet, farkOnizleme } = await import('../src/main/ajan/araclar/dosya-yaz.ts');
const { aracBul } = await import('../src/main/ajan/araclar/kayit.ts');
const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const electron = (await import('electron')).default as unknown as { shell: { trashItem: (p: string) => Promise<void> } };
dosyaYazAraclariniKaydet();

// ── Sahne: sahte ev (USERPROFILE) ve ev dışı klasör ──
const ev = process.env.USERPROFILE!;
assert.ok(ev.startsWith(sahne.klasor), 'ev geçici klasörde olmalı (gerçek profil değil)');
const masaustu = path.join(ev, 'Desktop');
const belgeler = path.join(ev, 'Documents');
const indirilenler = path.join(ev, 'Downloads');
const disari = path.join(sahne.klasor, 'disari');
const kutu = path.join(sahne.klasor, 'geri-donusum');
for (const d of [masaustu, belgeler, indirilenler, disari, kutu]) fs.mkdirSync(d, { recursive: true });

// Sahte Geri Dönüşüm Kutusu: dosyayı kutu klasörüne taşır, çağrıları kaydeder.
const kutuCagrilari: string[] = [];
let kutuHatasi: Error | null = null;
electron.shell.trashItem = async (p: string) => {
  kutuCagrilari.push(p);
  if (kutuHatasi) throw kutuHatasi;
  fs.renameSync(p, path.join(kutu, `${Date.now()}-${path.basename(p)}`));
};

type Istek = { baslik: string; aciklama: string; onizleme?: string; tehlike: string };
async function cagir(ad: string, girdi: Record<string, unknown>, karar: 'bir_kez' | 'reddet' = 'bir_kez') {
  const sorular: Istek[] = [];
  const arac = aracBul(ad);
  assert.ok(arac, `araç kayıtlı değil: ${ad}`);
  const r = await arac.calistir(girdi, {
    sohbetId: 1, sinyal: new AbortController().signal, gorevIzinleri: new Set(),
    onay: async (i: Istek) => { sorular.push(i); return karar; },
  } as never);
  return { r, sorular };
}
const oku = (y: string) => fs.readFileSync(y, 'utf8');
const ozet = (y: string) => crypto.createHash('sha256').update(fs.readFileSync(y)).digest('hex');
const sirala = (...l: string[]) => path.join(masaustu, ...l);

test('araç kaydı: dört araç, grup dosya-yaz, risk onay; etiket yazılan metni taşımaz (P10)', () => {
  for (const ad of ['dosya_yaz', 'dosya_duzenle', 'dosya_sil', 'belge_uret']) {
    const a = aracBul(ad)!;
    assert.equal(a.grup, 'dosya-yaz', ad);
    assert.equal(a.risk, 'onay', ad);
    assert.ok(a.tanim.aciklama.length > 40, ad);
  }
  const e = aracBul('dosya_yaz')!.etiket({ yol: 'C:\\x\\rapor.txt', icerik: 'GİZLİ-METİN', kip: 'yeni' });
  assert.ok(!e.includes('GİZLİ') && e.includes('rapor.txt'), e);
  const d = aracBul('dosya_duzenle')!.etiket({ yol: 'C:\\x\\rapor.txt', eski: 'GİZLİ-ESKİ', yeni: 'GİZLİ-YENİ' });
  assert.ok(!d.includes('GİZLİ'), d);
  // Şemalar: tam JSON şeması (modele aynen gider).
  const s = aracBul('dosya_yaz')!.tanim.sema as { properties: Record<string, { enum?: string[] }>; required: string[] };
  assert.deepEqual(s.properties.kip.enum, ['yeni', 'uzerine', 'ekle']);
  assert.deepEqual(s.required, ['yol', 'kip']);
  const b = aracBul('belge_uret')!.tanim.sema as { properties: Record<string, { enum?: string[]; properties?: Record<string, unknown> }>; required: string[] };
  assert.deepEqual(b.properties.tur.enum, ['docx', 'xlsx', 'pptx', 'pdf']);
  assert.deepEqual(Object.keys(b.properties.icerik.properties!).sort(), ['baslik', 'bolumler', 'sayfalar', 'slaytlar']);
  // Hücreler `string` (tür dizisi yok: bazı sağlayıcılar reddeder); açıklama sayıyı metin olarak yazmayı söyler.
  assert.deepEqual((b.properties.icerik.properties!.sayfalar as { items: { properties: { satirlar: unknown } } }).items.properties.satirlar, { type: 'array', items: { type: 'array', items: { type: 'string' } } });
  assert.match(aracBul('belge_uret')!.tanim.aciklama, /sayıyı metin olarak yaz/);
});

test('izinli klasör dışına yazma reddedilir (onayla bile): dört araç; ".." ve bağlantı ile kaçış yok', async () => {
  const hedef = path.join(disari, 'x.txt');
  const { r, sorular } = await cagir('dosya_yaz', { yol: hedef, icerik: 'a', kip: 'yeni' });
  assert.equal(r.hata, true);
  assert.match(r.icerik, /Masaüstü|Belgeler|İndirilenler/);
  assert.equal(fs.existsSync(hedef), false);
  assert.equal(sorular.length, 0, 'onay bile sorulmaz');

  // ".." ile çıkış
  const izli = path.join(masaustu, '..', '..', 'disari', 'y.txt');
  assert.equal((await cagir('dosya_yaz', { yol: izli, icerik: 'a', kip: 'uzerine' })).r.hata, true);
  assert.equal(fs.existsSync(path.join(disari, 'y.txt')), false);

  // Göreli yol: tahmin edilmez, reddedilir.
  assert.equal((await cagir('dosya_yaz', { yol: 'not.txt', icerik: 'a', kip: 'yeni' })).r.hata, true);
  assert.equal(fs.existsSync(path.resolve('not.txt')), false);

  // Ev dışındaki var olan dosya: düzenle, sil, ekle de reddedilir ve dosya aynı kalır.
  const var_ = path.join(disari, 'var.txt');
  fs.writeFileSync(var_, 'bir iki');
  for (const [ad, g] of [['dosya_duzenle', { yol: var_, eski: 'bir', yeni: 'üç' }], ['dosya_sil', { yol: var_ }], ['dosya_yaz', { yol: var_, icerik: 'z', kip: 'ekle' }],
    ['belge_uret', { tur: 'docx', yol: path.join(disari, 'b.docx'), icerik: { bolumler: [{ paragraflar: ['x'] }] } }]] as const) {
    const s = await cagir(ad, g as never);
    assert.equal(s.r.hata, true, ad);
    assert.equal(s.sorular.length, 0, `${ad}: onay sorulmaz`);
  }
  assert.equal(oku(var_), 'bir iki');
  assert.equal(fs.existsSync(path.join(disari, 'b.docx')), false);
  assert.deepEqual(kutuCagrilari, []);
});

test('bağlantı (junction) ile izinli klasörden kaçış reddedilir: gerçek yol izinli kökün içinde olmalı', async (t) => {
  const bag = path.join(masaustu, 'kacis');
  try { fs.symlinkSync(disari, bag, 'junction'); } catch (e) { t.skip(`bağlantı kurulamadı: ${(e as Error).message}`); return; }
  try {
    const s = await cagir('dosya_yaz', { yol: path.join(bag, 'kacak.txt'), icerik: 'a', kip: 'yeni' });
    assert.equal(s.r.hata, true);
    assert.equal(fs.existsSync(path.join(disari, 'kacak.txt')), false, 'bağlantının hedefine yazılmadı');
    assert.equal(s.sorular.length, 0);
    fs.writeFileSync(path.join(disari, 'hedef.txt'), 'dokunma');
    assert.equal((await cagir('dosya_sil', { yol: path.join(bag, 'hedef.txt') })).r.hata, true);
    assert.equal((await cagir('dosya_duzenle', { yol: path.join(bag, 'hedef.txt'), eski: 'dokunma', yeni: 'x' })).r.hata, true);
    assert.equal(oku(path.join(disari, 'hedef.txt')), 'dokunma');
    assert.deepEqual(kutuCagrilari, []);
  } finally { fs.rmSync(bag, { recursive: true, force: true }); }
});

test('Windows tuzakları: akış adı (a.txt:gizli), ayrılmış ad (CON, NUL), UNC reddedilir; ~ ev klasörüne açılır', async () => {
  for (const y of [sirala('a.txt:gizli'), sirala('CON.txt'), sirala('nul'), sirala('COM1.log'), '\\\\localhost\\c$\\x.txt', `${masaustu}\\`]) {
    const s = await cagir('dosya_yaz', { yol: y, icerik: 'a', kip: 'yeni' });
    assert.equal(s.r.hata, true, y);
    assert.equal(s.sorular.length, 0, y);
  }
  assert.equal(fs.existsSync(sirala('a.txt')), false);
  const s = await cagir('dosya_yaz', { yol: '~/Documents/tilde.txt', icerik: 'ok', kip: 'yeni' });
  assert.equal(s.r.hata, undefined, s.r.icerik);
  assert.equal(oku(path.join(belgeler, 'tilde.txt')), 'ok');
});

test('yeni dosya onaysız; var olan dosyada uzerine onay ister, önizlemede fark', async () => {
  const y = sirala('not.txt');
  const yeni = await cagir('dosya_yaz', { yol: y, icerik: 'merhaba\ndünya\n', kip: 'yeni' });
  assert.equal(yeni.r.hata, undefined, yeni.r.icerik);
  assert.equal(yeni.sorular.length, 0, 'yeni dosya onay istemez');
  assert.equal(oku(y), 'merhaba\ndünya\n');

  // Aynı yola "yeni": sessizce ezilmez.
  const tekrar = await cagir('dosya_yaz', { yol: y, icerik: 'başka', kip: 'yeni' });
  assert.equal(tekrar.r.hata, true);
  assert.match(tekrar.r.icerik, /uzerine/);
  assert.equal(tekrar.sorular.length, 0);
  assert.equal(oku(y), 'merhaba\ndünya\n');

  // Üzerine yaz, reddedilirse dosya aynı kalır; önizleme farkı gösterir.
  const red = await cagir('dosya_yaz', { yol: y, icerik: 'merhaba\nevren\n', kip: 'uzerine' }, 'reddet');
  assert.equal(red.sorular.length, 1);
  assert.equal(red.r.hata, true);
  assert.match(red.r.icerik, /onay vermedi|reddedildi/i);
  assert.equal(oku(y), 'merhaba\ndünya\n');
  const o = red.sorular[0];
  assert.ok(o.baslik.includes('üzerine') || o.baslik.includes('Üzerine'), o.baslik);
  assert.ok(o.aciklama.includes('not.txt'));
  assert.equal(o.tehlike, 'orta');
  assert.match(o.onizleme ?? '', /^- dünya$/m);
  assert.match(o.onizleme ?? '', /^\+ evren$/m);
  assert.match(o.onizleme ?? '', /^ {2}merhaba$/m, 'değişmeyen satır bağlam olarak görünür');

  // Onaylanırsa yazılır.
  const tamam = await cagir('dosya_yaz', { yol: y, icerik: 'merhaba\nevren\n', kip: 'uzerine' }, 'bir_kez');
  assert.equal(tamam.sorular.length, 1);
  assert.equal(tamam.r.hata, undefined, tamam.r.icerik);
  assert.equal(oku(y), 'merhaba\nevren\n');

  // Var olmayan yola "uzerine": yeni dosya sayılır, onay istemez; alt klasörler oluşturulur.
  const alt = await cagir('dosya_yaz', { yol: sirala('proje', 'alt', 'yeni.md'), icerik: '# başlık', kip: 'uzerine' });
  assert.equal(alt.sorular.length, 0);
  assert.equal(oku(sirala('proje', 'alt', 'yeni.md')), '# başlık');

  // Aynı içerikle üzerine yazmak değişiklik değildir: onay sorulmaz.
  const ayni = await cagir('dosya_yaz', { yol: y, icerik: 'merhaba\nevren\n', kip: 'uzerine' });
  assert.equal(ayni.sorular.length, 0);
  assert.equal(ayni.r.hata, undefined);
});

test('dosya_yaz: boş içerik geçerli (boş dosya), içerik hiç verilmezse hata; klasör ve aşırı büyük içerik reddedilir', async () => {
  const bos = await cagir('dosya_yaz', { yol: sirala('bos.txt'), icerik: '', kip: 'yeni' });
  assert.equal(bos.r.hata, undefined, bos.r.icerik);
  assert.equal(oku(sirala('bos.txt')), '');
  const yok = await cagir('dosya_yaz', { yol: sirala('yok.txt'), kip: 'yeni' });
  assert.equal(yok.r.hata, true);
  assert.equal(fs.existsSync(sirala('yok.txt')), false);
  assert.equal((await cagir('dosya_yaz', { yol: masaustu, icerik: 'x', kip: 'uzerine' })).r.hata, true);
  fs.mkdirSync(sirala('klasorum'), { recursive: true });
  assert.equal((await cagir('dosya_yaz', { yol: sirala('klasorum'), icerik: 'x', kip: 'uzerine' })).r.hata, true);
  const buyuk = await cagir('dosya_yaz', { yol: sirala('buyuk.txt'), icerik: 'a'.repeat(1_000_001), kip: 'yeni' });
  assert.equal(buyuk.r.hata, true);
  assert.equal(fs.existsSync(sirala('buyuk.txt')), false);
});

test('çalıştırılabilir/betik uzantılı YENİ dosya onay ister (.bat, .ps1, .lnk…); düz uzantılar istemez', async () => {
  const bat = await cagir('dosya_yaz', { yol: sirala('calistir.bat'), icerik: 'echo x', kip: 'yeni' }, 'reddet');
  assert.equal(bat.sorular.length, 1);
  assert.equal(fs.existsSync(sirala('calistir.bat')), false);
  const ps = await cagir('dosya_yaz', { yol: sirala('betik.PS1'), icerik: 'echo x', kip: 'yeni' }, 'bir_kez');
  assert.equal(ps.sorular.length, 1);
  assert.equal(ps.sorular[0].tehlike, 'yuksek');
  assert.ok(fs.existsSync(sirala('betik.PS1')));
  for (const uz of ['txt', 'md', 'csv', 'json', 'html', 'py', 'ts']) assert.equal((await cagir('dosya_yaz', { yol: sirala(`duz.${uz}`), icerik: 'x', kip: 'yeni' })).sorular.length, 0, uz);
});

test('I1: kullanıcının var olan dosyasına ekle onay ister (fark önizlemeli); reddedilirse dosya aynı; yoksa onaysız oluşturur', async () => {
  const y = sirala('gunluk.txt');
  fs.writeFileSync(y, 'bir\n');
  const red = await cagir('dosya_yaz', { yol: y, icerik: 'iki\n', kip: 'ekle' }, 'reddet');
  assert.equal(red.sorular.length, 1, 'var olan kullanıcı dosyasına ekleme kart ister');
  assert.match(red.sorular[0].baslik, /ekle/i);
  assert.match(red.sorular[0].onizleme ?? '', /^\+ iki$/m);
  assert.equal(red.r.hata, true);
  assert.equal(oku(y), 'bir\n', 'reddedilen ekleme dosyayı değiştirmez');
  const e = await cagir('dosya_yaz', { yol: y, icerik: 'iki\n', kip: 'ekle' });
  assert.equal(e.sorular.length, 1);
  assert.equal(e.r.hata, undefined, e.r.icerik);
  assert.equal(oku(y), 'bir\niki\n');
  const yeni = await cagir('dosya_yaz', { yol: sirala('ekle-yeni.txt'), icerik: 'ilk', kip: 'ekle' });
  assert.equal(yeni.sorular.length, 0);
  assert.equal(oku(sirala('ekle-yeni.txt')), 'ilk');
});

test('I1: ajanın bu sohbette oluşturduğu dosyaya parça parça ekleme onaysız; dosya sonradan dışarıda değişirse yine onay', async () => {
  const y = sirala('parcali.md');
  assert.equal((await cagir('dosya_yaz', { yol: y, icerik: 'a\n', kip: 'yeni' })).sorular.length, 0);
  assert.equal((await cagir('dosya_yaz', { yol: y, icerik: 'b\n', kip: 'ekle' })).sorular.length, 0, 'kendi oluşturduğu dosya');
  assert.equal((await cagir('dosya_yaz', { yol: y, icerik: 'c\n', kip: 'ekle' })).sorular.length, 0);
  assert.equal(oku(y), 'a\nb\nc\n');
  fs.appendFileSync(y, 'kullanici\n'); // kullanıcı dosyayı değiştirdi: artık onun dosyası
  assert.equal((await cagir('dosya_yaz', { yol: y, icerik: 'd\n', kip: 'ekle' }, 'reddet')).sorular.length, 1);
  assert.equal(oku(y), 'a\nb\nc\nkullanici\n');
});

test('I1: sabit bağlantı (nlink > 1) ve sembolik bağlantı üzerinden yazma reddedilir (onay bile sorulmaz); hedef değişmez', async (t) => {
  const hedef = path.join(disari, 'sabit-hedef.txt');
  fs.writeFileSync(hedef, 'dokunma');
  const bag = sirala('sabit-bag.txt');
  try { fs.linkSync(hedef, bag); } catch (e) { t.skip(`sabit bağlantı kurulamadı: ${(e as Error).message}`); return; }
  for (const [ad, g] of [['dosya_yaz', { yol: bag, icerik: 'x', kip: 'ekle' }], ['dosya_yaz', { yol: bag, icerik: 'x', kip: 'uzerine' }],
    ['dosya_duzenle', { yol: bag, eski: 'dokunma', yeni: 'x' }]] as const) {
    const s = await cagir(ad, g as never);
    assert.equal(s.r.hata, true, `${ad} ${JSON.stringify(g)}`);
    assert.match(s.r.icerik, /bağlantı/i);
    assert.equal(s.sorular.length, 0, 'onay sorulmaz');
  }
  assert.equal(oku(hedef), 'dokunma', 'izinli kök dışındaki hedef değişmedi');
  // Aynı kökün içindeki dosyaya sembolik bağlantı (kurulabiliyorsa: geliştirici modu/yönetici gerekir).
  const ic = sirala('sembol-hedef.txt');
  fs.writeFileSync(ic, 'iç');
  const sem = sirala('sembol.txt');
  let semVar = true;
  try { fs.symlinkSync(ic, sem, 'file'); } catch { semVar = false; }
  if (semVar) {
    for (const [ad, g] of [['dosya_yaz', { yol: sem, icerik: 'x', kip: 'ekle' }], ['dosya_yaz', { yol: sem, icerik: 'x', kip: 'uzerine' }],
      ['dosya_duzenle', { yol: sem, eski: 'iç', yeni: 'x' }], ['dosya_sil', { yol: sem }]] as const) {
      const s = await cagir(ad, g as never);
      assert.equal(s.r.hata, true, ad);
      assert.match(s.r.icerik, /bağlantı/i);
      assert.equal(s.sorular.length, 0);
    }
    assert.equal(oku(ic), 'iç');
  }
});

test('Minor 2: Belgeler\\WindowsPowerShell ve Belgeler\\PowerShell altına yazılmaz; .psd1 ve .ps1xml çalıştırılabilir tür sayılır', async () => {
  for (const alt of ['WindowsPowerShell', 'PowerShell']) {
    const y = path.join(belgeler, alt, 'Modules', 'Kotu', 'Kotu.psm1');
    const s = await cagir('dosya_yaz', { yol: y, icerik: 'x', kip: 'yeni' });
    assert.equal(s.r.hata, true, alt);
    assert.equal(s.sorular.length, 0);
    assert.equal(fs.existsSync(y), false);
  }
  for (const uz of ['psd1', 'ps1xml']) assert.equal((await cagir('dosya_yaz', { yol: sirala(`mod.${uz}`), icerik: 'x', kip: 'yeni' }, 'reddet')).sorular.length, 1, uz);
});

test('dosya_duzenle: eski metin yoksa ya da iki kez geçiyorsa hata, dosya değişmez', async () => {
  const y = sirala('duzen.txt');
  fs.writeFileSync(y, 'bir iki üç iki');
  const once = ozet(y);
  for (const [eski, kelime] of [['iki', /2 kez|iki kez/i], ['dört', /bulunamadı|yok/i], ['', /boş/i]] as const) {
    const s = await cagir('dosya_duzenle', { yol: y, eski, yeni: 'x' });
    assert.equal(s.r.hata, true, eski);
    assert.match(s.r.icerik, kelime, eski);
    assert.equal(s.sorular.length, 0, 'hata onaydan önce');
    assert.equal(ozet(y), once, 'dosya değişmedi');
  }
  assert.equal((await cagir('dosya_duzenle', { yol: y, eski: 'bir', yeni: 'bir' })).r.hata, true, 'eski = yeni: değişiklik yok');
  assert.equal((await cagir('dosya_duzenle', { yol: y, eski: 'bir' })).r.hata, true, 'yeni verilmedi');
  assert.equal((await cagir('dosya_duzenle', { yol: sirala('yok-dosya.txt'), eski: 'a', yeni: 'b' })).r.hata, true);
  assert.equal((await cagir('dosya_duzenle', { yol: masaustu, eski: 'a', yeni: 'b' })).r.hata, true);
  assert.equal(ozet(y), once);
});

test('dosya_duzenle: tek eşleşme onay ister (fark önizlemeli), onaylanırsa değişir; "yeni" boş olabilir (silme)', async () => {
  const y = sirala('duzen2.txt');
  fs.writeFileSync(y, 'satır bir\nsatır iki\nsatır üç\n');
  const red = await cagir('dosya_duzenle', { yol: y, eski: 'satır iki', yeni: 'satır 2' }, 'reddet');
  assert.equal(red.sorular.length, 1);
  assert.equal(red.r.hata, true);
  assert.equal(oku(y), 'satır bir\nsatır iki\nsatır üç\n');
  assert.match(red.sorular[0].onizleme ?? '', /^- satır iki$/m);
  assert.match(red.sorular[0].onizleme ?? '', /^\+ satır 2$/m);
  const tamam = await cagir('dosya_duzenle', { yol: y, eski: 'satır iki', yeni: 'satır 2' });
  assert.equal(tamam.sorular.length, 1);
  assert.equal(tamam.r.hata, undefined, tamam.r.icerik);
  assert.equal(oku(y), 'satır bir\nsatır 2\nsatır üç\n');
  const sil = await cagir('dosya_duzenle', { yol: y, eski: 'satır 2\n', yeni: '' });
  assert.equal(sil.r.hata, undefined, sil.r.icerik);
  assert.equal(oku(y), 'satır bir\nsatır üç\n');
});

test('dosya_duzenle: CRLF dosyada LF ile verilen eski/yeni satır sonları dosyanınkine uyar; BOM korunur', async () => {
  const y = sirala('crlf.txt');
  fs.writeFileSync(y, 'a\r\nb\r\nc\r\n');
  const s = await cagir('dosya_duzenle', { yol: y, eski: 'a\nb', yeni: 'x\ny\nz' });
  assert.equal(s.r.hata, undefined, s.r.icerik);
  assert.equal(oku(y), 'x\r\ny\r\nz\r\nc\r\n');
  const b = sirala('bom.txt');
  fs.writeFileSync(b, '\uFEFFmerhaba dünya', 'utf8');
  assert.equal((await cagir('dosya_duzenle', { yol: b, eski: 'dünya', yeni: 'evren' })).r.hata, undefined);
  assert.equal(oku(b), '\uFEFFmerhaba evren');
});

test('dosya_duzenle: metin olmayan (ikili ya da UTF-8 olmayan) dosya düzenlenmez', async () => {
  const ik = sirala('ikili.bin');
  fs.writeFileSync(ik, Buffer.from([0x41, 0x00, 0x42, 0x43]));
  const a = await cagir('dosya_duzenle', { yol: ik, eski: 'B', yeni: 'X' });
  assert.equal(a.r.hata, true);
  assert.deepEqual([...fs.readFileSync(ik)], [0x41, 0x00, 0x42, 0x43]);
  const l1 = sirala('latin1.txt');
  fs.writeFileSync(l1, Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x20, 0x61, 0x62])); // "café ab" Latin-1
  const b = await cagir('dosya_duzenle', { yol: l1, eski: 'ab', yeni: 'cd' });
  assert.equal(b.r.hata, true);
  assert.deepEqual([...fs.readFileSync(l1)], [0x63, 0x61, 0x66, 0xe9, 0x20, 0x61, 0x62]);
});

test('dosya_duzenle ve belge_uret var olan dosyanın üzerine yazmadan önce onay ister (fark önizlemeli); belge_uret yeni yola onaysız', async () => {
  const y = sirala('rapor.docx');
  const ilk = { baslik: 'İlk Sürüm', bolumler: [{ baslik: 'Giriş', paragraflar: ['birinci metin'] }] };
  const yeni = await cagir('belge_uret', { tur: 'docx', yol: y, icerik: ilk });
  assert.equal(yeni.r.hata, undefined, yeni.r.icerik);
  assert.equal(yeni.sorular.length, 0, 'belge_uret yeni yola onay istemez');
  assert.ok(fs.statSync(y).size > 1000);
  assert.match((await mammoth.extractRawText({ path: y })).value, /İlk Sürüm/);
  const once = ozet(y);

  const ikinci = { baslik: 'İkinci Sürüm', bolumler: [{ baslik: 'Giriş', paragraflar: ['ikinci metin'] }, { baslik: 'Ek', tablo: [['a', 'b'], ['1', '2']] }] };
  const red = await cagir('belge_uret', { tur: 'docx', yol: y, icerik: ikinci }, 'reddet');
  assert.equal(red.sorular.length, 1);
  assert.equal(red.r.hata, true);
  assert.equal(ozet(y), once, 'reddedilince dosya aynı');
  const o = red.sorular[0];
  assert.equal(o.tehlike, 'orta');
  assert.ok(o.aciklama.includes('rapor.docx'));
  assert.match(o.onizleme ?? '', /Şimdiki/); // eski dosyanın boyutu/tarihi
  assert.match(o.onizleme ?? '', /KB|bayt/);
  assert.match(o.onizleme ?? '', /Yeni/);
  assert.match(o.onizleme ?? '', /İkinci Sürüm/);
  assert.match(o.onizleme ?? '', /2 bölüm/);

  const tamam = await cagir('belge_uret', { tur: 'docx', yol: y, icerik: ikinci });
  assert.equal(tamam.sorular.length, 1);
  assert.equal(tamam.r.hata, undefined, tamam.r.icerik);
  assert.notEqual(ozet(y), once);
  assert.match((await mammoth.extractRawText({ path: y })).value, /İkinci Sürüm/);
  assert.ok(!fs.readdirSync(masaustu).some((a) => /fuber-tmp|\.tmp$/.test(a)), 'geçici dosya kalmadı');
});

test('belge_uret: tür ve uzantı uyuşmalı; uzantısız yola uzantı eklenir; her tür üretilir; geçersiz içerik hata', async () => {
  const uz = await cagir('belge_uret', { tur: 'docx', yol: sirala('uzantisiz'), icerik: { bolumler: [{ paragraflar: ['x'] }] } });
  assert.equal(uz.r.hata, undefined, uz.r.icerik);
  assert.ok(fs.existsSync(sirala('uzantisiz.docx')));
  assert.ok(uz.r.icerik.includes('uzantisiz.docx'));
  const yanlis = await cagir('belge_uret', { tur: 'docx', yol: sirala('yanlis.txt'), icerik: { bolumler: [{ paragraflar: ['x'] }] } });
  assert.equal(yanlis.r.hata, true);
  assert.equal(fs.existsSync(sirala('yanlis.txt')), false);
  const x = await cagir('belge_uret', { tur: 'xlsx', yol: sirala('t.xlsx'), icerik: { sayfalar: [{ ad: 'S', satirlar: [['a', 1]] }] } });
  assert.equal(x.r.hata, undefined, x.r.icerik);
  const p = await cagir('belge_uret', { tur: 'pptx', yol: sirala('s.pptx'), icerik: { slaytlar: [{ baslik: 'B', maddeler: ['m'] }] } });
  assert.equal(p.r.hata, undefined, p.r.icerik);
  const uyumsuz = await cagir('belge_uret', { tur: 'xlsx', yol: sirala('u.xlsx'), icerik: { bolumler: [{ paragraflar: ['x'] }] } });
  assert.equal(uyumsuz.r.hata, true);
  assert.equal(fs.existsSync(sirala('u.xlsx')), false);
  const eksik = await cagir('belge_uret', { tur: 'docx', yol: sirala('e.docx') });
  assert.equal(eksik.r.hata, true);
});

test('dosya_sil onay ister ve Geri Dönüşüm Kutusu\'na gönderir; reddedilirse dosya yerinde', async () => {
  const y = sirala('silinecek.txt');
  fs.writeFileSync(y, 'önemli içerik\nikinci satır');
  const gercekYol = fs.realpathSync.native(y);
  kutuCagrilari.length = 0;
  const red = await cagir('dosya_sil', { yol: y }, 'reddet');
  assert.equal(red.sorular.length, 1);
  assert.equal(red.r.hata, true);
  assert.ok(fs.existsSync(y));
  assert.deepEqual(kutuCagrilari, []);
  const o = red.sorular[0];
  assert.equal(o.tehlike, 'yuksek');
  assert.ok(o.aciklama.includes('silinecek.txt'));
  assert.match(o.aciklama + (o.onizleme ?? ''), /Geri Dönüşüm Kutusu/);
  assert.match(o.onizleme ?? '', /önemli içerik/);

  const tamam = await cagir('dosya_sil', { yol: y });
  assert.equal(tamam.sorular.length, 1, 'her seferinde onay');
  assert.equal(tamam.r.hata, undefined, tamam.r.icerik);
  assert.equal(kutuCagrilari.length, 1);
  assert.equal(kutuCagrilari[0].toLowerCase(), gercekYol.toLowerCase(), "kutuya gerçek (çözülmüş) yol gider");
  assert.equal(path.basename(kutuCagrilari[0]), 'silinecek.txt');
  assert.equal(fs.existsSync(y), false);
  assert.match(tamam.r.icerik, /Geri Dönüşüm Kutusu/);
});

test('dosya_sil: yok olan, klasör ve izinli kökün kendisi silinmez; kutu hata verirse kalıcı silme YOK', async () => {
  kutuCagrilari.length = 0;
  assert.equal((await cagir('dosya_sil', { yol: sirala('hic-yok.txt') })).r.hata, true);
  fs.mkdirSync(sirala('benim-klasor'), { recursive: true });
  const k = await cagir('dosya_sil', { yol: sirala('benim-klasor') });
  assert.equal(k.r.hata, true);
  assert.equal(k.sorular.length, 0);
  assert.ok(fs.existsSync(sirala('benim-klasor')));
  for (const kok of [masaustu, belgeler, indirilenler]) assert.equal((await cagir('dosya_sil', { yol: kok })).r.hata, true, kok);
  assert.deepEqual(kutuCagrilari, []);

  const y = sirala('kutu-hatasi.txt');
  fs.writeFileSync(y, 'kalmalı');
  kutuHatasi = new Error('geri dönüşüm kutusu yok');
  try {
    const s = await cagir('dosya_sil', { yol: y });
    assert.equal(s.r.hata, true);
    assert.match(s.r.icerik, /silinmedi|kutu/i);
    assert.equal(oku(y), 'kalmalı', 'kutu başarısızsa dosya kalıcı silinmez');
  } finally { kutuHatasi = null; }
});

test('farkOnizleme: değişen satırlar -/+ ile, çevresinde iki satır bağlam; uzun fark kırpılır', () => {
  const eski = ['bir', 'iki', 'üç', 'dört', 'beş', 'altı', 'yedi'].join('\n');
  const yeni = ['bir', 'iki', 'üç', 'DÖRT', 'beş', 'altı', 'yedi'].join('\n');
  const f = farkOnizleme(eski, yeni);
  assert.match(f, /^ {2}iki$/m);
  assert.match(f, /^ {2}üç$/m);
  assert.match(f, /^- dört$/m);
  assert.match(f, /^\+ DÖRT$/m);
  assert.match(f, /^ {2}beş$/m);
  assert.match(f, /^ {2}altı$/m);
  assert.doesNotMatch(f, /bir$/m, 'bağlam iki satırla sınırlı');
  assert.equal(farkOnizleme('aynı', 'aynı'), '(değişiklik yok)');
  const uzun = farkOnizleme('x', Array.from({ length: 500 }, (_, i) => `satır numarası ${i}`).join('\n'), 600);
  assert.ok(uzun.length <= 600, String(uzun.length));
  assert.match(uzun, /…/);
  // Satır sonu farkı (CRLF/LF) tek başına "değişiklik" sayılmaz.
  assert.equal(farkOnizleme('a\r\nb', 'a\nb'), '(değişiklik yok)');
});

test('Business ve Developer\'da araçlar var; Gizli\'de ve "Yalnız bu bilgisayar"da yok (bulut kapısı)', async () => {
  const { turAraclari } = await import('../src/main/ajan/dongu.ts');
  const adlar = async () => (await turAraclari('merhaba', false)).map((a) => a.tanim.ad);
  const DORT = ['dosya_yaz', 'dosya_duzenle', 'dosya_sil', 'belge_uret'];
  try {
    ayarlariKaydet((a) => { a.mod = 'is'; a.yerel.gizliMod = false; a.yerel.yalnizYerel = false; });
    const is_ = await adlar();
    for (const ad of DORT) assert.ok(is_.includes(ad), `Business: ${ad}`);
    ayarlariKaydet((a) => { a.mod = 'gelistirici'; });
    const gel = await adlar();
    for (const ad of DORT) assert.ok(gel.includes(ad), `Developer: ${ad}`);
    // Gizli: dört araç da yok.
    ayarlariKaydet((a) => { a.yerel.gizliMod = true; });
    const gizli = await adlar();
    for (const ad of DORT) assert.ok(!gizli.includes(ad), `Gizli: ${ad}`);
    // Yalnız bu bilgisayar: yok.
    ayarlariKaydet((a) => { a.yerel.gizliMod = false; a.yerel.yalnizYerel = true; });
    const yalniz = await adlar();
    for (const ad of DORT) assert.ok(!yalniz.includes(ad), `Yalnız bu bilgisayar: ${ad}`);
    // Ayarlar'daki "Dosyalar" izni kapalıysa (yetki.dosyaOkuma) yazma araçları da yok, iki modda; izin açılınca geri gelir.
    ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; });
    for (const mod of ['is', 'gelistirici'] as const) {
      ayarlariKaydet((a) => { a.mod = mod; a.yetki = { ...a.yetki, dosyaOkuma: false }; });
      const kapali = await adlar();
      for (const ad of DORT) assert.ok(!kapali.includes(ad), `Dosyalar izni kapalı (${mod}): ${ad}`);
      assert.ok(!kapali.includes('dosya_oku'), 'okuma da kapalı (tutarlılık)');
      ayarlariKaydet((a) => { a.yetki = { ...a.yetki, dosyaOkuma: true }; });
      const acik = await adlar();
      for (const ad of DORT) assert.ok(acik.includes(ad), `Dosyalar izni açık (${mod}): ${ad}`);
    }
  } finally { ayarlariKaydet((a) => { a.mod = 'is'; a.yerel.gizliMod = false; a.yerel.yalnizYerel = false; a.yetki = { ...a.yetki, dosyaOkuma: true }; }); }
});

test('kablolama: main.ts araçları kaydeder, dongu.ts grupEtkin bulut kapısına bağlı, iceaktar izinli kökleri dışa açar, satır tablosunda dört araç var', async () => {
  const kaynak = (...p: string[]) => fs.readFileSync(path.resolve(import.meta.dirname, '..', ...p), 'utf8');
  assert.match(kaynak('src', 'main', 'main.ts'), /dosyaYazAraclariniKaydet\(\);/);
  assert.match(kaynak('src', 'main', 'main.ts'), /import \{ dosyaYazAraclariniKaydet \} from '\.\/ajan\/araclar\/dosya-yaz\.js';/);
  assert.match(kaynak('src', 'main', 'ajan', 'dongu.ts'), /if \(grup === 'dosya-yaz'\) return a\.yetki\.dosyaOkuma && !bulutYasak\(/);
  assert.match(kaynak('src', 'main', 'iceaktar.ts'), /export function izinliKokler\(\)/);
  const { aracSatiri, aracSatiriAdlari } = await import('../src/shared/arac-satiri.ts');
  const { isDiliIhlali } = await import('../src/shared/is-dili.ts');
  for (const ad of ['dosya_yaz', 'dosya_duzenle', 'dosya_sil', 'belge_uret']) assert.ok(aracSatiriAdlari.includes(ad), ad);
  const s = (ad: string, g: Record<string, unknown>, durum: 'tamam' | 'calisiyor' | 'hata' | 'reddedildi') => aracSatiri(ad, g, { durum }, 'is', new Date(2026, 10, 2));
  assert.equal(s('dosya_yaz', { yol: 'C:\\Kullanicilar\\Deniz\\Desktop\\not.txt', kip: 'yeni', icerik: 'GİZLİ' }, 'tamam').metin, 'Dosya yazıldı · not.txt');
  assert.equal(s('dosya_yaz', { yol: 'C:\\x\\not.txt', kip: 'ekle' }, 'tamam').metin, 'Dosyaya eklendi · not.txt');
  assert.equal(s('dosya_yaz', { yol: 'C:\\x\\not.txt', kip: 'uzerine' }, 'reddedildi').metin, 'Dosya yazılmadı · not.txt · Onay verilmedi');
  assert.equal(s('dosya_duzenle', { yol: 'C:\\x\\a.md' }, 'tamam').metin, 'Dosya düzenlendi · a.md');
  assert.equal(s('dosya_sil', { yol: 'C:\\x\\a.md' }, 'tamam').metin, 'Dosya Geri Dönüşüm Kutusu’na atıldı · a.md');
  assert.equal(s('belge_uret', { tur: 'docx', yol: 'C:\\x\\r.docx' }, 'tamam').metin, 'Word belgesi hazırlandı · r.docx');
  assert.equal(s('belge_uret', { tur: 'xlsx', yol: 'C:\\x\\r.xlsx' }, 'calisiyor').metin, 'Excel tablosu hazırlanıyor · r.xlsx');
  assert.equal(s('belge_uret', { tur: 'pptx', yol: 'C:\\x\\r.pptx' }, 'hata').metin, 'Sunum hazırlanamadı · r.pptx');
  assert.equal(s('belge_uret', { tur: 'pdf', yol: 'C:\\x\\r.pdf' }, 'tamam').metin, 'PDF belgesi hazırlandı · r.pdf');
  for (const ad of ['dosya_yaz', 'dosya_duzenle', 'dosya_sil', 'belge_uret']) for (const d of ['tamam', 'calisiyor', 'hata', 'reddedildi'] as const) {
    const m = s(ad, { yol: 'C:\\x\\a.txt', tur: 'docx', kip: 'yeni' }, d).metin;
    assert.equal(isDiliIhlali(m), null, m);
    assert.doesNotMatch(m, /GİZLİ|[a-z]+_[a-z_]+|[A-Za-z]:\\/);
  }
});

