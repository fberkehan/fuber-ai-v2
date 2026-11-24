// Fuber Geliştirici Paketi listesi (Görev 29, K18; src/shared/cc-eklentiler.ts): K18'in ★ ve isteğe bağlı listesi aynen, her öğede ne
// kazandırdığı / kaynak / lisans / yazdığı yer / ağ / gereksinim dolu; Graphify'ın PyPI adı TAM OLARAK `graphifyy` (çift y; sahte benzer adlar
// var) ve sürümü sabit; uv arşivinin adresi, boyutu ve SHA-256'sı denetleyicinin doğruladığı değerler (Ruling CC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  GELISTIRICI_PAKETI, GRAPHIFY_PAKETI, GRAPHIFY_SURUMU, GRAPHIFY_GEREKSINIMI, GRAPHIFY_TEKER_SHA256, UV_ARSIVI, UV_SURUMU, UV_DOSYALARI, CC_KATALOG,
  CC_KATALOG_DEPOSU, CC_YUKLEYICI_KOMUTU, eklentiKimligi, paketOgesi, secimiSuz, varsayilanSecim, paketOzeti,
  GRAPHIFY_BECERILERI, KOMUT_GOSTERIM_SINIRI, KOMUT_COK_UZUN, KOMUT_SATIR_SINIRI, ALAN_GOSTERIM_SINIRI, komutParcalari, komutGorunur, onayAyrintilari, ogeDesteklenirMi,
  paketSayaci, mcpHalAdi, TUR_ADI, graphifySorunu, mcpGorunenAd, ekYolu, yeniSurumVar, gecerliHal, GRAPHIFY_SORUNU, kurulumSecimi, ogeCozucu,
} from '../src/shared/cc-eklentiler.ts';

// R20 (0.10; K8, K18'in sıra kilidinin üstünde): Graphify önerilenlerin İLKİ değil, SONUNCUSU — öne çıkmaz.
const YILDIZLI = ['superpowers', 'frontend-design', 'code-review', 'feature-dev', 'context7', 'playwright', 'claude-md-management', 'commit-commands', 'graphify'];
const ISTEGE_BAGLI = ['security-guidance', 'pr-review-toolkit', 'typescript-lsp', 'pyright-lsp', 'serena', 'github', 'chrome-devtools-mcp', 'session-report', 'skill-creator', 'code-simplifier'];

test('K18 + R20: ★ varsayılan dokuz (Graphify en sonda) ve isteğe bağlı on öğe aynen ve bu sırayla; kimlikler tekil', () => {
  assert.deepEqual(GELISTIRICI_PAKETI.filter((o) => o.varsayilan).map((o) => o.id), YILDIZLI);
  assert.deepEqual(GELISTIRICI_PAKETI.filter((o) => !o.varsayilan).map((o) => o.id), ISTEGE_BAGLI);
  assert.equal(new Set(GELISTIRICI_PAKETI.map((o) => o.id)).size, GELISTIRICI_PAKETI.length);
  assert.deepEqual(varsayilanSecim(), YILDIZLI);
});

test('her öğede ad, kısa etiket, TEK cümlelik kazanç, kaynak, lisans, yazdığı yer, ağ ve gereksinim dolu', () => {
  for (const o of GELISTIRICI_PAKETI) {
    for (const [alan, deger] of Object.entries({ ad: o.ad, kisa: o.kisa, kazanc: o.kazanc, kaynak: o.kaynak, lisans: o.lisans, ag: o.ag, gereksinim: o.gereksinim })) {
      assert.ok(typeof deger === 'string' && deger.trim().length >= 2, `${o.id}.${alan} boş`);
    }
    assert.ok(o.yazdigiYer.length >= 1 && o.yazdigiYer.every((y) => y.trim().length > 4), `${o.id}.yazdigiYer boş`);
    // Tek cümle: noktayla biter, içinde ikinci bir cümle başlamaz.
    assert.match(o.kazanc, /\.$/, `${o.id}: kazanç noktayla bitmeli`);
    assert.doesNotMatch(o.kazanc.slice(0, -1), /[.!?]\s+\p{Lu}/u, `${o.id}: kazanç tek cümle olmalı`);
    assert.ok(o.kisa.split(/\s+/).length <= 3, `${o.id}: kısa etiket en çok üç sözcük`);
    assert.ok(o.kazanc.length <= 140, `${o.id}: kazanç kısa olmalı (${o.kazanc.length})`);
  }
});

test('katalog öğeleri resmi katalogdan (claude-plugins-official), kimlik ad@katalog; Graphify katalogda değil, PyPI\'dan', () => {
  assert.equal(CC_KATALOG, 'claude-plugins-official');
  assert.equal(CC_KATALOG_DEPOSU, 'anthropics/claude-plugins-official');
  for (const o of GELISTIRICI_PAKETI.filter((x) => x.tur === 'katalog')) {
    assert.match(o.kaynak, /claude-plugins-official/, o.id);
    assert.equal(eklentiKimligi(o), `${o.id}@claude-plugins-official`);
    assert.match(o.id, /^[a-z0-9-]+$/);
  }
  const g = paketOgesi('graphify')!;
  assert.equal(g.tur, 'graphify');
  // R20: tek kaynak satırı, sürüm yinelenmez ("Sürüm 0.9.95" ayrı satırda); paket adı (çift y) kaynakta kalır.
  assert.equal(g.kaynak, 'PyPI (graphifyy) · github.com/Graphify-Labs/graphify');
  assert.doesNotMatch(g.kaynak, /0\.9\.95|==/);
  assert.equal(g.surum, '0.9.95');
  assert.equal(g.lisans, 'Apache-2.0 + MIT');
  // Kart açıklaması: beceri + arama araçlarından önce kanca, graphify-out/, sorgu günlüğü kapalı, telemetri yok.
  const yazi = `${g.yazdigiYer.join(' ')} ${g.ag}`;
  for (const s of ['~/.claude/skills', 'kanca', 'graphify-out/', 'GRAPHIFY_QUERY_LOG_DISABLE=1', 'telemetri yok']) assert.ok(yazi.includes(s), `Graphify kartında yok: ${s}`);
});

test('Graphify paket adı TAM OLARAK "graphifyy" (çift y), sürüm 0.9.95 sabit; eklenti kurucusu bu sabiti kullanır, başka graphify* paketi kurmaz', () => {
  assert.equal(GRAPHIFY_PAKETI, 'graphifyy');
  assert.equal(GRAPHIFY_SURUMU, '0.9.95');
  assert.equal(GRAPHIFY_GEREKSINIMI, 'graphifyy==0.9.95');
  assert.match(GRAPHIFY_TEKER_SHA256, /^[0-9a-f]{64}$/);
  assert.equal(GRAPHIFY_TEKER_SHA256, 'e067c9256e5e762406816e51039c4e775f8d2f39a893ecc0b7095d594f6c3120');
  const kaynak = fs.readFileSync(path.resolve(import.meta.dirname, '../src/main/claudecode/eklenti-kurucu.ts'), 'utf8');
  assert.match(kaynak, /\['tool', 'install', GRAPHIFY_GEREKSINIMI\]/, 'uv tool install sabit gereksinimle');
  // Kaynakta tırnak içinde "graphify" ile başlayıp çift y olmayan bir paket adı (graphify==, graphify-ai, graphifyai …) geçmez.
  for (const m of kaynak.matchAll(/['"`](graphify[A-Za-z0-9_.=-]*)['"`]/g)) {
    assert.ok(['graphify', 'graphify.exe', 'graphifyy'].includes(m[1]), `şüpheli paket adı: ${m[1]}`);
  }
});

test('uv 0.13.5: adres, boyut ve SHA-256 denetleyicinin doğruladığı değerler (Ruling CC); çıkarılan dosyalar yalnız uv/uvx/uvw', () => {
  assert.equal(UV_SURUMU, '0.13.5');
  assert.equal(UV_ARSIVI.url, 'https://github.com/astral-sh/uv/releases/download/0.13.5/uv-x86_64-pc-windows-msvc.zip');
  assert.equal(UV_ARSIVI.boyut, 15264056);
  assert.equal(UV_ARSIVI.sha256, 'a38b8d1902b7cfbc76b423ba1bb456f623f42064cdc72628b6075b89afd1019a');
  assert.deepEqual([...UV_DOSYALARI], ['uv.exe', 'uvx.exe', 'uvw.exe']);
  assert.equal(CC_YUKLEYICI_KOMUTU, 'irm https://claude.ai/install.ps1 | iex');
});

// ── Düzeltme turu 1 ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// Kaynakta görünmez karakter YOK: hepsi kod noktasından üretilir (düzenleyici/araç kaçışları sessizce çevirmesin).
const K = (...cp: number[]) => String.fromCodePoint(...cp);
test('onay gösterimi: görünmeyen / yön değiştiren karakterler (U+202E, sıfır genişlik, denetim) "U+XXXX" olarak GÖRÜNÜR; metin kısaltılmaz', () => {
  const komut = `npm i -g x && echo "${K(0x202e)}exe.kotu${K(0x202c)}"${K(0x200b)}${K(7)}${K(13)}${K(9)}son`;
  const { parcalar, gizliVar } = komutParcalari(komut);
  assert.equal(gizliVar, true);
  assert.deepEqual(parcalar.filter((p) => p.tur === 'gizli').map((p) => p.metin), ['U+202E', 'U+202C', 'U+200B', 'U+0007', 'U+000D', 'U+0009']);
  // Görünür parçalar + işaretler: özgün metindeki HER görünür karakter yerinde (kısaltma yok).
  assert.equal(parcalar.filter((p) => !p.tur).map((p) => p.metin).join(''), [...komut].filter((c) => c.codePointAt(0)! >= 0x20 && c.codePointAt(0)! <= 0x7e).join(''));
  assert.equal(komutGorunur(`a${K(0x202e)}b`), 'a⟨U+202E⟩b');
  assert.equal(komutGorunur(`a${K(0xe0041)}b`), 'a⟨U+E0041⟩b', 'etiket karakteri (görünmez) de');
  assert.deepEqual(komutParcalari('npm install -g x\nikinci satir'), { parcalar: [{ metin: 'npm install -g x\nikinci satir' }], gizliVar: false, isaretliVar: false }, 'satır sonu görünür (pre içinde)');
  assert.equal(komutGorunur('a\nb', { satirSonu: false }), 'a⟨U+000A⟩b', 'tek satırlık alanda satır sonu da işaretli');
  const uzun = 'x'.repeat(5000);
  assert.equal(komutParcalari(uzun).parcalar[0].metin.length, 5000, 'gösterim katmanı da kısaltmaz');
  assert.ok(KOMUT_GOSTERIM_SINIRI >= 500 && KOMUT_GOSTERIM_SINIRI <= 2000);
  assert.equal(KOMUT_SATIR_SINIRI, 20);
  assert.equal(ALAN_GOSTERIM_SINIRI, 200);
  assert.match(KOMUT_COK_UZUN, /gösterilemeyecek kadar uzun; kurulmadı\.$/);
  assert.deepEqual(onayAyrintilari({ komut: 'node h.js', sha256: 'a'.repeat(64), tur: 'entry_helper', pluginId: 'x@k', arsivAdresi: 'https://o.example/x.tgz', katalogSurumu: 'r1' }).map((s) => [s.etiket, s.deger]),
    [['Tür', 'Kurulum yardımcısı'], ['Eklenti', 'x@k'], ['İndirilecek arşiv', 'https://o.example/x.tgz'], ['Katalog sürümü', 'r1']]);
});

// Sertleştirme (birleşim turu, 2b): izin listesi — yazdırılabilir ASCII ve (komutta) satır sonu dışındaki HER karakter işaretli.
test('izin listesi: NBSP, U+2000–200A, U+034F, U+E0100 yalnız kaçış olarak; İbranice harf okunur ama işaretli; Türkçe harf de işaretli', () => {
  const g = (s: string) => komutParcalari(s).parcalar;
  // Görünmez / boşluk benzeri → yalnız "⟨U+…⟩" (karakterin kendisi kartta HİÇ yok).
  assert.equal(komutGorunur(`npm${K(0xa0)}i`), 'npm⟨U+00A0⟩i', 'NBSP');
  for (let cp = 0x2000; cp <= 0x200a; cp++) {
    const p = g(`a${K(cp)}b`);
    assert.deepEqual(p.map((x) => [x.metin, x.tur ?? '']), [['a', ''], [`U+${cp.toString(16).toUpperCase()}`, 'gizli'], ['b', '']], `U+${cp.toString(16)}`);
  }
  assert.equal(komutGorunur(`e${K(0x34f)}x`), 'e⟨U+034F⟩x', 'U+034F (birleştirme engelleyici, görünmez)');
  assert.equal(komutGorunur(`x${K(0xe0100)}y`), 'x⟨U+E0100⟩y', 'U+E0100 (değişken seçici ek)');
  assert.ok(!g(`x${K(0xe0100)}y`).some((p) => p.metin.includes(K(0xe0100))), 'görünmez karakter parçada kaldı');
  // Görünür ASCII dışı → okunur kalır, işaretli ve kodlu (İbranice: sağdan sola; kartta yönü yalıtılır).
  const he = komutParcalari(`echo ${K(0x5d0)}-b`);
  assert.deepEqual(he.parcalar.map((p) => [p.metin, p.tur ?? '', p.kod ?? '']), [['echo ', '', ''], [K(0x5d0), 'isaretli', 'U+05D0'], ['-b', '', '']]);
  assert.deepEqual([he.gizliVar, he.isaretliVar], [false, true]);
  assert.equal(komutGorunur(`echo ${K(0x5d0)}`), `echo ${K(0x5d0)}⟨U+05D0⟩`);
  assert.equal(komutGorunur(`np${K(0x43c)}`), `np${K(0x43c)}⟨U+043C⟩`, 'Kiril benzeri harf de işaretli');
  assert.equal(komutGorunur('ş'), 'ş⟨U+015F⟩');
  // Yazdırılabilir ASCII'nin tamamı düz.
  const ascii = Array.from({ length: 95 }, (_, i) => K(0x20 + i)).join('');
  assert.deepEqual(komutParcalari(ascii), { parcalar: [{ metin: ascii }], gizliVar: false, isaretliVar: false });
});

test('Graphify: yalnız Windows (Windows dışında ★ seçimde gelmez); becerisi TAM adla tanınır', () => {
  assert.deepEqual(varsayilanSecim('win32'), YILDIZLI);
  assert.deepEqual(varsayilanSecim('darwin'), YILDIZLI.filter((x) => x !== 'graphify'));
  const g = paketOgesi('graphify')!;
  assert.equal(ogeDesteklenirMi(g, 'darwin'), false);
  assert.equal(ogeDesteklenirMi(g, 'win32'), true);
  assert.equal(ogeDesteklenirMi(paketOgesi('superpowers')!, 'darwin'), true);
  assert.match(g.gereksinim, /^Windows/);
  // Graphify'ın becerisi TAM adla tanınır (kullanıcının "graphify-notlar" becerisi onun değildir).
  assert.deepEqual([...GRAPHIFY_BECERILERI], ['graphify']);
});

// R20 (K8): Graphify'ın "Ayrıntılar"ı ötekilerle AYNI biçimde ve boyda — "Not" / "Kaldırma" yok (bozuk kanca artık canlı algılanır ve
// "Yeniden kur" onarır; kaldırma Beceriler'de), "Nereye yazar" ötekilerin en uzunundan fazla madde değil, toplam metin ötekilerin en uzunundan uzun değil.
test('R20: Graphify’ın ayrıntısı ötekilerle aynı biçimde ve boyda (Not / Kaldırma yok; en uzun ötekinden uzun değil)', () => {
  const g = paketOgesi('graphify')!;
  const otekiler = GELISTIRICI_PAKETI.filter((o) => o.id !== 'graphify');
  assert.equal(g.notlar, undefined);
  assert.equal(g.kaldirma, undefined);
  assert.ok(otekiler.every((o) => !o.notlar && !o.kaldirma), 'öteki öğelerde de yok (aynı biçim)');
  assert.ok(g.yazdigiYer.length <= Math.max(...otekiler.map((o) => o.yazdigiYer.length)), `Nereye yazar ${g.yazdigiYer.length} madde`);
  const boy = (o: typeof g) => [o.kaynak, o.lisans, o.ag, o.gereksinim, ...o.yazdigiYer].join(' ').length;
  const enUzun = Math.max(...otekiler.map(boy));
  assert.ok(boy(g) <= enUzun, `Graphify ayrıntısı ${boy(g)} > en uzun öteki ${enUzun}`);
  for (const s of ['~/.claude/skills', 'kanca', 'graphify-out/', 'GRAPHIFY_QUERY_LOG_DISABLE=1', 'telemetri yok']) assert.ok(`${g.yazdigiYer.join(' ')} ${g.ag}`.includes(s), `Graphify ayrıntısında yok: ${s}`);
});

test('secimiSuz: yalnız bilinen kimlikler, tekrar yok, paketin sırasıyla; paketOzeti sayar', () => {
  assert.deepEqual(secimiSuz(['graphify', 'context7', 'yok-boyle', 'context7', 7, null]), ['context7', 'graphify'], 'paketin sırası (R20: Graphify en sonda)');
  assert.deepEqual(secimiSuz('graphify'), []);
  assert.deepEqual(secimiSuz(undefined), []);
  const o = paketOzeti({ ogeler: [{ id: 'a', hal: 'kuruldu' }, { id: 'b', hal: 'kurulu' }, { id: 'c', hal: 'onay' }, { id: 'd', hal: 'hata' }, { id: 'e', hal: 'sirada' }, { id: 'f', hal: 'reddedildi' }, { id: 'g', hal: 'bekliyor' }] });
  assert.deepEqual(o, { tamam: 2, suren: 1, onay: 1, hata: 1, bekleyen: 1, toplam: 6 });
});

// M3 (son inceleme): Graphify'ın kancası Fuber'in uygulama veri klasöründeki ortamı ister; o klasör silinirse her Claude Code oturumu
// (terminaldeki dahil) bozuk kancaya takılır. K8 + R20: bu artık kartta ya da ayrıntıda duran bir uyarı DEĞİL — sorun gerçekten
// algılanınca (graphifySorunu) satır tek hata hâline geçer ve "Yeniden kur" onarır.
test('M3 + K8 + R20: Graphify için kartta da ayrıntıda da sabit uyarı yok; sorun yalnız algılanınca', () => {
  const g = paketOgesi('graphify')!;
  assert.equal(g.kartNotu, undefined, 'K8: kartın kendisinde uyarı yok');
  assert.ok(!JSON.stringify(g).includes('veri klasörü silinirse'), 'ayrıntıda sabit uyarı yok');
  assert.match(GRAPHIFY_SORUNU, /bulunamıyor/);
});

// ── Görev 7 (0.10; B-7, B-23, B-24, B-25, B-32, B-36) + K8 ("Önerilen araçlar": tek satır ad + tek kısa cümle, Graphify öne çıkmaz) ──
const durumYap = (ogeler: { id: string; hal: string }[]) => ({
  claude: { kurulu: true }, paket: { adimGoruldu: true, calisiyor: false, claudeBekleniyor: false, ogeler: ogeler as never, gunluk: '' },
});
test('G7: paketSayaci — 9 önerilenin 8’i kurulu, 1’i onay bekliyor → 9 / 8 / 1 / 1; isteğe bağlılar paydaya girmez; sorunlu da buradan', () => {
  const ogeler = YILDIZLI.map((id) => ({ id, hal: id === 'context7' ? 'onay' : id === 'graphify' ? 'kurulu' : 'kuruldu' }));
  assert.deepEqual(paketSayaci(GELISTIRICI_PAKETI, durumYap(ogeler)), { onerilen: 9, hazir: 8, kurulacak: 1, onayBekleyen: 1, sorunlu: 0 });
  // İsteğe bağlı iki araç kurulu, biri onay bekliyor: önerilenlerin payı ve paydası değişmez; onay bekleyen her öğe sayılır.
  const ek = [...ogeler, { id: 'serena', hal: 'kuruldu' }, { id: 'github', hal: 'kurulu' }, { id: 'typescript-lsp', hal: 'onay' }];
  assert.deepEqual(paketSayaci(GELISTIRICI_PAKETI, durumYap(ek)), { onerilen: 9, hazir: 8, kurulacak: 1, onayBekleyen: 2, sorunlu: 0 });
  // Hâl yok / sırada / hata / reddedildi hazır sayılmaz; "hata" sorunlu sayılır (isteğe bağlı da).
  assert.deepEqual(paketSayaci(GELISTIRICI_PAKETI, durumYap([{ id: 'superpowers', hal: 'sirada' }, { id: 'context7', hal: 'hata' }, { id: 'playwright', hal: 'reddedildi' }, { id: 'serena', hal: 'hata' }])), { onerilen: 9, hazir: 0, kurulacak: 9, onayBekleyen: 0, sorunlu: 2 });
  assert.deepEqual(paketSayaci(GELISTIRICI_PAKETI, null), { onerilen: 9, hazir: 0, kurulacak: 9, onayBekleyen: 0, sorunlu: 0 });
  // Windows dışında Graphify bu bilgisayarda kurulamaz: paydaya girmez.
  assert.deepEqual(paketSayaci(GELISTIRICI_PAKETI, durumYap(ogeler), 'darwin'), { onerilen: 8, hazir: 7, kurulacak: 1, onayBekleyen: 1, sorunlu: 0 });
});

// Denetleyici kararı (düzeltme turu 1): bozuk Graphify'ın TEK hâli var — satır da sayaçlar da aynı çözücüden (gecerliHal → paketSayaci).
test('G7: gecerliHal — bozuk Graphify tek "hata" (ileti graphifySorunu); kurulurken ilerleme; onarım düşerse yine TEK sorun', () => {
  const g = paketOgesi('graphify')!, sp = paketOgesi('superpowers')!;
  const sorun = graphifySorunu({ graphify: { kanca: true, calistirilabilir: false } });
  const k = (hal: string, ileti?: string) => ({ id: 'graphify', hal, ...(ileti ? { ileti } : {}) }) as never;
  // Kayıtta "kuruldu" + kanca bozuk → hata, ileti sorun metni.
  assert.deepEqual(gecerliHal(g, k('kuruldu'), { kurulu: true, listelerVar: true, graphifySorunu: sorun }), { id: 'graphify', hal: 'hata', ileti: sorun });
  // Kayıtta hiç yok (başka yoldan kurulmuş) + kanca bozuk → yine hata.
  assert.equal(gecerliHal(g, undefined, { kurulu: true, listelerVar: true, graphifySorunu: sorun })?.hal, 'hata');
  // Onarım sürüyor → ilerleme gösterilir (hata değil).
  for (const h of ['sirada', 'kuruluyor']) assert.equal(gecerliHal(g, k(h), { kurulu: true, listelerVar: true, graphifySorunu: sorun })?.hal, h);
  // Onarım düştü → yine TEK hata; ileti sorunu ve son denemenin nedenini birlikte söyler.
  const d = gecerliHal(g, k('hata', 'Graphify kurulamadı (uv). error: sahte'), { kurulu: true, listelerVar: true, graphifySorunu: sorun });
  assert.equal(d?.hal, 'hata');
  assert.ok(d?.ileti?.startsWith(sorun!) && d.ileti.includes('Graphify kurulamadı (uv)'), d?.ileti);
  // Sorun yokken eski davranış: kayıttaki "kuruldu" listede yoksa kurulmamış; listede varsa "kurulu"; sorun başka öğeye bulaşmaz.
  assert.equal(gecerliHal(sp, { id: 'superpowers', hal: 'kuruldu' } as never, { kurulu: false, listelerVar: true, graphifySorunu: sorun }), undefined);
  assert.deepEqual(gecerliHal(sp, undefined, { kurulu: true, listelerVar: true, graphifySorunu: sorun }), { id: 'superpowers', hal: 'kurulu' });
  assert.deepEqual(gecerliHal(g, k('kuruldu'), { kurulu: true, listelerVar: true, graphifySorunu: null }), { id: 'graphify', hal: 'kuruldu' });
  // Sayaçlar: sekiz hazır + bozuk Graphify → 8/9, 1 kurulacak, 1 sorunlu (ayrıca "+1" yok).
  const ogeler = GELISTIRICI_PAKETI.filter((o) => o.varsayilan).map((o) => gecerliHal(o, o.id === 'graphify' ? k('kuruldu') : ({ id: o.id, hal: 'kuruldu' } as never), { kurulu: true, listelerVar: true, graphifySorunu: sorun })!);
  assert.deepEqual(paketSayaci(GELISTIRICI_PAKETI, durumYap(ogeler)), { onerilen: 9, hazir: 8, kurulacak: 1, onayBekleyen: 0, sorunlu: 1 });
});

// Düzeltme turu 2: "liste okundu" işareti TÜRE GÖRE — Graphify (beceri) Beceriler listesine, katalog eklentileri Kurulu eklentiler listesine
// bakar. O türün listesi okunmadıysa (ya da okunamadıysa) kayıttaki hâl geçerli: hiçbir zaman "kurulacak" sayılmaz.
test('G7: ogeCozucu — bir liste geç gelir / okunamazsa sayaçlar kayıttaki gerçekte kalır; ikisi de okununca gerçek kaldırma görülür', () => {
  const kayit = durumYap(YILDIZLI.map((id) => ({ id, hal: 'kuruldu' })));
  const katalog = YILDIZLI.filter((id) => id !== 'graphify').map((id) => ({ id: `${id}@claude-plugins-official` }));
  const graphifyBecerisi = [{ kaynak: 'graphify' }, { kaynak: 'kullanici' }];
  const say = (eklentiler: { id: string }[] | null, beceriler: { kaynak: string }[] | null, d = kayit) => {
    const coz = ogeCozucu(d, { eklentiler, beceriler });
    const ogeler = GELISTIRICI_PAKETI.map(coz).filter((x): x is NonNullable<typeof x> => Boolean(x));
    return paketSayaci(GELISTIRICI_PAKETI, { paket: { ...d.paket, ogeler } });
  };
  const tam = { onerilen: 9, hazir: 9, kurulacak: 0, onayBekleyen: 0, sorunlu: 0 };
  assert.deepEqual(say(null, null), tam, 'hiçbir liste yok: kayıt');
  assert.deepEqual(say(null, graphifyBecerisi), tam, 'yalnız beceriler okundu (eklenti listesi geç geliyor): katalog eklentileri kayıttan — "1/9", "8 aracı kur" YOK');
  assert.deepEqual(say(katalog, null), tam, 'yalnız eklentiler okundu (beceriler gelmedi): Graphify kayıttan');
  // `claude plugin list` düştü / zaman aşımı: sekme listeyi null tutar (ListeSonucu.liste === null) → okunmamış gibi, kayıttaki gerçek.
  assert.deepEqual(say(null, graphifyBecerisi), tam, 'eklenti listesi okunamadı');
  // Bir türün listesi OKUNDUYSA o türde gerçek kaldırma görülür, öteki tür kayıtta kalır.
  assert.deepEqual(say(null, [{ kaynak: 'kullanici' }]), { ...tam, hazir: 8, kurulacak: 1 }, 'beceriler okundu, Graphify’ın becerisi yok → yalnız Graphify kurulmamış');
  assert.deepEqual(say(katalog.filter((e) => !e.id.startsWith('superpowers@')), null), { ...tam, hazir: 8, kurulacak: 1 }, 'eklentiler okundu, superpowers yok → yalnız o');
  assert.deepEqual(say(katalog, graphifyBecerisi), tam, 'ikisi de okundu, hepsi yerinde');
  // Bozuk Graphify kancası liste durumundan bağımsız tek "hata".
  const bozuk = { ...kayit, graphify: { kanca: true, calistirilabilir: false } };
  for (const [e, b] of [[null, null], [katalog, null], [null, graphifyBecerisi], [katalog, graphifyBecerisi]] as const) {
    assert.deepEqual(say(e as never, b as never, bozuk as never), { ...tam, hazir: 8, kurulacak: 1, sorunlu: 1 }, `bozuk kanca, listeler: ${Boolean(e)}/${Boolean(b)}`);
  }
});

test('G7: kurulumSecimi — "Seçilenleri kur" kurulu öğeyi YENİDEN kuyruğa koymaz (bozuk Graphify’ı da: onun tek eylemi "Yeniden kur"); süren / onay bekleyen düşmez', () => {
  const hal: Record<string, string> = { superpowers: 'kuruldu', 'frontend-design': 'kurulu', context7: 'onay', playwright: 'sirada', graphify: 'hata', 'code-review': 'hata', serena: '' };
  const h = (o: { id: string }) => (hal[o.id] ? ({ id: o.id, hal: hal[o.id] } as never) : undefined);
  const secim = ['superpowers', 'frontend-design', 'code-review', 'context7', 'playwright', 'graphify', 'serena'];
  const sorun = graphifySorunu({ graphify: { kanca: true, calistirilabilir: false } });
  assert.deepEqual(kurulumSecimi(secim, h, { graphifySorunu: sorun }), { gonderilecek: ['code-review', 'context7', 'playwright', 'serena'], yeni: ['code-review', 'serena'] });
  // Sorun yokken Graphify'ın "hata"sı sıradan bir kurulamadı: seçiliyse yeniden denenir.
  assert.deepEqual(kurulumSecimi(secim, h, { graphifySorunu: null }).yeni, ['code-review', 'graphify', 'serena']);
  // Bu bilgisayarda kurulamayan (Windows dışında Graphify) hiç gönderilmez.
  assert.ok(!kurulumSecimi(['graphify'], () => undefined, { platform: 'darwin' }).gonderilecek.includes('graphify'));
  assert.deepEqual(kurulumSecimi([], h, {}), { gonderilecek: [], yeni: [] });
});

test('G7: mcpHalAdi — Claude Code’un ham hâli Türkçe üç hâle', () => {
  assert.equal(mcpHalAdi('connected'), 'Bağlı');
  assert.equal(mcpHalAdi('✓ Connected'), 'Bağlı');
  assert.equal(mcpHalAdi('bagli'), 'Bağlı');
  assert.equal(mcpHalAdi('failed'), 'Bağlanamadı');
  assert.equal(mcpHalAdi('Failed to connect'), 'Bağlanamadı');
  assert.equal(mcpHalAdi('✗ Failed to connect'), 'Bağlanamadı');
  assert.equal(mcpHalAdi('hata'), 'Bağlanamadı');
  assert.equal(mcpHalAdi('Not connected'), 'Bağlanamadı', '"connected" geçiyor ama bağlı değil');
  for (const h of ['pending', '⏸ Needs authentication', 'bekliyor', 'bilinmiyor', '']) assert.equal(mcpHalAdi(h), 'Bekliyor', h);
});

test('G7: TUR_ADI — kurulum komutunun türü Türkçe; onay kartında tür sözlükten (ham değer ayrı), bilinmeyen tür gösterilmez', () => {
  assert.equal(TUR_ADI.entry_helper, 'Kurulum yardımcısı');
  assert.equal(TUR_ADI.command_source, 'Komut kaynağı');
  const sha = 'a'.repeat(64);
  const a = onayAyrintilari({ komut: 'node h.js', sha256: sha, tur: 'entry_helper', pluginId: 'x@k' });
  assert.deepEqual(a[0], { etiket: 'Tür', deger: 'Kurulum yardımcısı', duz: true, ham: 'entry_helper' });
  assert.ok(!onayAyrintilari({ komut: 'x', sha256: sha, tur: 'bilinmeyen_tur', pluginId: 'x@k' }).some((s) => s.etiket === 'Tür'), 'bilinmeyen tür gösterilmez');
  // Claude Code'dan gelen alanlar (eklenti, arşiv, kip, katalog sürümü) düz değil: görünmeyen karakter denetiminden geçer.
  assert.ok(onayAyrintilari({ komut: 'x', sha256: sha, tur: 'command_source', pluginId: 'x@k', mod: 'global' }).filter((s) => s.etiket !== 'Tür').every((s) => !s.duz));
});

test('G7: graphifySorunu — kanca kurulu ama graphify bulunamıyorsa hata metni; ikisi de varsa ya da kanca yoksa null', () => {
  const m = graphifySorunu({ graphify: { kanca: true, calistirilabilir: false } });
  assert.ok(m && /Graphify/.test(m) && /bulunamıyor/.test(m), String(m));
  assert.doesNotMatch(m!, /'/, 'kesme işareti ’ (U+2019)');
  assert.equal(graphifySorunu({ graphify: { kanca: true, calistirilabilir: true } }), null);
  assert.equal(graphifySorunu({ graphify: { kanca: false, calistirilabilir: false } }), null);
  assert.equal(graphifySorunu({}), null, 'denetim yoksa (eski ana süreç) sorun yok');
  assert.equal(graphifySorunu(null), null);
});

test('G7: mcpGorunenAd — eklentinin sunucusu "playwright (Playwright eklentisinden)"; kullanıcı sunucusu olduğu gibi', () => {
  assert.equal(mcpGorunenAd('plugin:playwright:playwright'), 'playwright (Playwright eklentisinden)');
  assert.equal(mcpGorunenAd('plugin:context7:context7'), 'context7 (Context7 eklentisinden)');
  assert.equal(mcpGorunenAd('plugin:chrome-devtools-mcp:chrome-devtools'), 'chrome-devtools (Chrome DevTools eklentisinden)');
  assert.equal(mcpGorunenAd('plugin:benim-araci:sunucu'), 'sunucu (benim-araci eklentisinden)');
  assert.equal(mcpGorunenAd('sahte-dosyalar'), 'sahte-dosyalar');
  assert.equal(mcpGorunenAd('claude.ai Gmail'), 'claude.ai Gmail');
});

test('G7: ekYolu — tek ayraç (/), ev "~", eklenti klasörü "~/.claude/plugins/…/superpowers" diye kısaltılır', () => {
  assert.equal(ekYolu('~\\.claude\\plugins\\cache\\claude-plugins-official\\superpowers\\1.0.0', 'superpowers'), '~/.claude/plugins/…/superpowers');
  assert.equal(ekYolu('~/.claude/plugins/cache/claude-plugins-official/superpowers/1.0.0', 'superpowers'), '~/.claude/plugins/…/superpowers');
  assert.equal(ekYolu('~\\.claude\\skills\\graphify'), '~/.claude/skills/graphify', 'kısa yol yalnız ayraçta değişir');
  assert.equal(ekYolu('C:\\a\\b\\c\\d\\e\\f\\g'), 'C:/a/b/…/g', 'ad bilinmiyorsa son parça');
  assert.equal(ekYolu('~\\.claude\\plugins\\cache\\x\\yok\\2.0'), '~/.claude/plugins/…/2.0', 'ad yolda yoksa son parça');
  for (const y of [ekYolu('~\\.claude\\plugins\\cache\\a\\b\\1'), ekYolu('C:\\x/y\\z')]) assert.ok(!y.includes('\\'), y);
});

test('G7: yeniSurumVar — satırda "Güncelle" yalnız katalogdaki sürüm kuruludan yeniyse', () => {
  assert.equal(yeniSurumVar('1.0.0', '1.0.1'), true);
  assert.equal(yeniSurumVar('1.2.0', '1.10.0'), true, 'sayısal karşılaştırma');
  assert.equal(yeniSurumVar('v1.0.0', '1.1'), true);
  assert.equal(yeniSurumVar('1.0.1', '1.0.0'), false);
  assert.equal(yeniSurumVar('1.0.0', '1.0.0'), false);
  assert.equal(yeniSurumVar('1.0', '1.0.0'), false);
  assert.equal(yeniSurumVar(undefined, '1.0.0'), false);
  assert.equal(yeniSurumVar('1.0.0', undefined), false);
  assert.equal(yeniSurumVar('abc', 'abd'), false, 'sayısal olmayan sürümde bilinmiyor');
});

test('K8: her araç tek satır ad + tek KISA, sade cümle; "Fuber Geliştirici Paketi" adı yerine "Önerilen araçlar"; kartlarda Graphify’a özel yazı yok', () => {
  for (const o of GELISTIRICI_PAKETI) {
    assert.ok(o.kazanc.length <= 80, `${o.id}: kazanç kısa olmalı (${o.kazanc.length})`);
    assert.doesNotMatch(o.kazanc, /;/, `${o.id}: tek yan cümle`);
    assert.doesNotMatch(o.ad, /\n/);
    assert.equal(o.kartNotu, undefined, `${o.id}: kartta not yok`);
  }
  const oku = (y: string) => fs.readFileSync(path.resolve(import.meta.dirname, '..', y), 'utf8');
  for (const y of ['src/renderer/claudecode/Eklentiler.tsx', 'src/renderer/claudecode/AraclarTeklifi.tsx', 'src/renderer/claudecode/GelistiriciPaketi.tsx']) {
    assert.doesNotMatch(oku(y), /Geliştirici Paketi|Geliştirici paketi/, `${y}: eski ad`);
  }
  const ek = oku('src/renderer/claudecode/Eklentiler.tsx');
  assert.match(ek, /Önerilen araçlar/);
  assert.doesNotMatch(ek, /kartNotu|PyPI graphifyy|ekl__kart-notu/, 'kartta Graphify’a özel not / PyPI satırı yok');
  assert.doesNotMatch(ek, /'kullanıcı'/, 'B-7: "· kullanıcı" kapsam etiketi yok');
  assert.doesNotMatch(ek, /KATALOG_YERI/, 'B-7: katalogdaki ortak metin satır başına yinelenmez');
  assert.doesNotMatch(ek, /ad="asagi"/, 'B-32: Kur düğmeleri açılır menü okuyla değil indirme simgesiyle');
  assert.match(ek, /ad="indir"/);
  assert.doesNotMatch(oku('src/renderer/claudecode/AraclarTeklifi.tsx'), /Graphify/, 'B-35: teklifte Graphify öne çıkmaz');
  assert.match(oku('src/renderer/bilesenler/Ikon.tsx'), /\n\s+indir: '/);
});
