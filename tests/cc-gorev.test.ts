// Görev 27 düzeltme 2: claude_code_gorev aracının kararları (src/main/claudecode/gorev.ts; bağımlılıklar sahte). Telefondan gelen tur
// (b.uzak) yalnız bilinen klasörde, terminal açmadan; açık oturuma komut gitmez ve araç sonuç sözü vermez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ccGorevCalistir, ccGorevKartiGerekli, type GorevBagimliliklari } from '../src/main/claudecode/gorev.ts';
import type { AracBaglami } from '../src/main/ajan/araclar/kayit.ts';
import type { OnayKarari } from '../src/main/olaylar.ts';
import type { CcOturumOzeti } from '../src/shared/cc-olay.ts';

const BILINEN = 'C:\\kod\\mavi';
const ozet = (ek: Partial<CcOturumOzeti> = {}): CcOturumOzeti => ({
  id: 'o1', cwd: BILINEN, proje: 'mavi', baslik: 'b', durum: 'calisiyor', mod: 'acceptEdits', kaynak: 'sohbet', bekleyenIzin: 0, kuyruk: 0,
  degisenDosyaSayisi: 0, yetenekler: [], olusturma: 0, sonEtkinlik: 0, ...ek,
});

type Onay = Parameters<AracBaglami['onay']>[0];
function kur(o: { yol?: 'uygulama' | 'terminal'; tamYetki?: boolean; genelTamYetki?: boolean; onayKarari?: OnayKarari; guven?: { gerekli: boolean; karar?: 'guven' | 'guvenme' }; baslatSonucu?: Awaited<ReturnType<GorevBagimliliklari['baslat']>> } = {}) {
  const cagrilar = { projeKlasoru: [] as string[], terminal: [] as Parameters<GorevBagimliliklari['terminaldeAc']>[0][], baslat: [] as Parameters<GorevBagimliliklari['baslat']>[0][], onay: 0, onaylar: [] as Onay[] };
  const d: GorevBagimliliklari = {
    oturumBul: async (id) => (id.startsWith('aaaa') ? { id: 'aaaa1111-0000-4000-8000-000000000001', dosya: '', cwd: BILINEN, proje: 'mavi', baslik: 'Eski iş', istemler: [], istemSayisi: 1, boyut: 0, okunan: 0 } : undefined),
    ayar: () => ({ genelTamYetki: o.genelTamYetki ?? false, claudeTamYetki: o.tamYetki ?? true, yol: o.yol ?? 'uygulama' }),
    projeKlasoru: async (cwd) => { cagrilar.projeKlasoru.push(cwd); if (cwd.toLowerCase() !== BILINEN.toLowerCase()) throw new Error('bilinmiyor'); return BILINEN; },
    terminaldeAc: (x) => { cagrilar.terminal.push(x); return { komutSatiri: 'claude --resume x', pencere: 'test' }; },
    baslat: async (i) => { cagrilar.baslat.push(i); return o.baslatSonucu ?? { tamam: true, oturum: ozet() }; },
    ...(o.guven ? { klasorGuveni: () => o.guven! } : {}),
  };
  const izinler = new Set<string>();
  const b = (uzak: boolean, gorevIzinleri = izinler): AracBaglami => ({ sohbetId: 42, sinyal: new AbortController().signal, gorevIzinleri, uzak, onay: async (x) => { cagrilar.onay++; cagrilar.onaylar.push(x); return o.onayKarari ?? 'bir_kez'; } });
  return { d, b, cagrilar, izinler };
}

test('telefondan gelen tur: bilinmeyen klasör reddedilir (klasör denetimi), bilinen klasör kabul edilir (gerçek yol kullanılır)', async () => {
  const t = kur();
  const r = await ccGorevCalistir({ komut: 'testleri çalıştır', klasor: 'D:\\yabanci' }, t.b(true), t.d);
  assert.equal(r.hata, true);
  assert.match(r.icerik, /yalnız bilinen bir proje klasöründe/);
  assert.deepEqual(t.cagrilar.projeKlasoru, ['D:\\yabanci']);
  assert.equal(t.cagrilar.baslat.length, 0, 'bilinmeyen klasörde oturum başlamadı');
  const r2 = await ccGorevCalistir({ komut: 'testleri çalıştır', klasor: 'c:\\KOD\\mavi' }, t.b(true), t.d);
  assert.equal(r2.hata, undefined);
  assert.equal(t.cagrilar.baslat[0].cwd, BILINEN);
  assert.equal(t.cagrilar.baslat[0].uzak, true, 'yönetici telefon kipinde (mod en çok acceptEdits)');
  // Masadan gelen tur klasörü bilinen-proje denetimine sokmaz (eski davranış).
  await ccGorevCalistir({ komut: 'x', klasor: 'D:\\yabanci' }, t.b(false), t.d);
  assert.equal(t.cagrilar.projeKlasoru.length, 2);
  assert.equal(t.cagrilar.baslat[1].cwd, 'D:\\yabanci');
});

test('terminal yolu Ayarlar\'da seçili olsa da telefondan gelen tur terminal AÇMAZ; masadan açar', async () => {
  const t = kur({ yol: 'terminal' });
  const uzak = await ccGorevCalistir({ komut: 'x', oturum_id: 'aaaa1111' }, t.b(true), t.d);
  assert.equal(t.cagrilar.terminal.length, 0, 'telefondan bilgisayarda terminal açıldı');
  assert.equal(t.cagrilar.baslat.length, 1);
  assert.match(uzak.icerik, /uygulama içinde başladı/);
  const masa = await ccGorevCalistir({ komut: 'x', oturum_id: 'aaaa1111' }, t.b(false), t.d);
  assert.equal(t.cagrilar.terminal.length, 1, 'masadan terminal yolu');
  assert.match(masa.icerik, /Terminal açıldı/);
  assert.equal(t.cagrilar.baslat.length, 1);
  // I2: Claude Code Tam yetkisi açık olsa da sohbet aracının açtığı terminal izinsiz kipte (--dangerously-skip-permissions) açılmaz.
  assert.equal(t.cagrilar.terminal[0].tamYetki, false);
});

// ── Son dalga B (I2): onay kartı doğruluk tablosu ──────────────────────────────────────────────────────────────────────────────
// Kart: telefon turu → HER ZAMAN; masa → genel Tam yetki kapalı VE "bu görev boyu" verilmemişse. Claude Code'un Tam yetkisi etkisiz.
test('I2 doğruluk tablosu: genel Tam yetki × Claude Code Tam yetki × telefon × "bu görev boyu" (16 durum)', async () => {
  const satirlar: string[] = [];
  for (const genel of [false, true]) for (const claude of [false, true]) for (const uzak of [false, true]) for (const gorevBoyu of [false, true]) {
    const t = kur({ genelTamYetki: genel, tamYetki: claude });
    const izinler = new Set<string>(gorevBoyu ? ['claudecode'] : []);
    await ccGorevCalistir({ komut: 'testleri çalıştır', klasor: BILINEN }, t.b(uzak, izinler), t.d);
    const beklenen = uzak || !(genel || gorevBoyu);
    assert.equal(ccGorevKartiGerekli({ uzak, genelTamYetki: genel, gorevBoyuIzni: gorevBoyu }), beklenen);
    satirlar.push(`${+genel}${+claude}${+uzak}${+gorevBoyu}:${t.cagrilar.onay}`);
    assert.equal(t.cagrilar.onay, beklenen ? 1 : 0, `genel=${genel} claude=${claude} telefon=${uzak} görevBoyu=${gorevBoyu}`);
    if (beklenen) {
      // "Bu görev boyu" seçeneği yalnız masada; telefonda kart hep çıktığı için sunulmaz.
      assert.equal(t.cagrilar.onaylar[0].gorevBoyu, !uzak);
      assert.match(t.cagrilar.onaylar[0].aciklama, /en çok “Düzenlemelere izin ver”/, 'kart mod tavanını söyler');
    }
    assert.equal(t.cagrilar.baslat[0].kaynak, 'sohbet', 'yönetici sohbet kaynağıyla başlatır (mod tavanı)');
  }
  // Claude Code Tam yetkisi (ikinci hane) hiçbir satırda sonucu değiştirmez.
  const harita = new Map(satirlar.map((s) => [s.slice(0, 4), s.slice(5)]));
  for (const [k, v] of harita) assert.equal(harita.get(`${k[0]}${k[1] === '1' ? '0' : '1'}${k[2]}${k[3]}`), v, `Claude Code Tam yetkisi kartı değiştirdi: ${k}`);
});

test('I2: masada "bu görev boyu" sonraki çağrıda kartı atlar; telefonda "bu görev boyu" kaydedilmez, kart yine çıkar', async () => {
  const masa = kur({ onayKarari: 'bu_gorev' });
  const izin = new Set<string>();
  await ccGorevCalistir({ komut: 'a', klasor: BILINEN }, masa.b(false, izin), masa.d);
  await ccGorevCalistir({ komut: 'b', klasor: BILINEN }, masa.b(false, izin), masa.d);
  assert.equal(masa.cagrilar.onay, 1, 'ikinci çağrı aynı görevde kartsız');
  assert.ok(izin.has('claudecode'));
  const tel = kur({ onayKarari: 'bu_gorev', genelTamYetki: true });
  const izin2 = new Set<string>();
  await ccGorevCalistir({ komut: 'a', klasor: BILINEN }, tel.b(true, izin2), tel.d);
  await ccGorevCalistir({ komut: 'b', klasor: BILINEN }, tel.b(true, izin2), tel.d);
  assert.equal(tel.cagrilar.onay, 2, 'telefon turunda her çağrı kart (genel Tam yetki açık olsa da)');
  assert.equal(izin2.has('claudecode'), false);
  const red = kur({ onayKarari: 'reddet', genelTamYetki: false, tamYetki: true });
  const r = await ccGorevCalistir({ komut: 'a', klasor: BILINEN }, red.b(false), red.d);
  assert.equal(r.hata, true);
  assert.equal(red.cagrilar.baslat.length, 0, 'reddedilince oturum başlamaz (Claude Code Tam yetkisi açıkken de)');
});

test('N1: kart oturumun ŞU ANKİ modunu ve işin çalışacağı modu söyler; indirilemezse iş gitmez ve sonuç sözü verilmez', async () => {
  const sorulan: (string | undefined)[] = [];
  const t = kur();
  t.d.modOnizleme = (kimlik) => { sorulan.push(kimlik); return { simdiki: 'bypassPermissions', olacak: 'acceptEdits' }; };
  await ccGorevCalistir({ komut: 'devam et', oturum_id: 'aaaa1111' }, t.b(false), t.d);
  assert.match(t.cagrilar.onaylar[0].aciklama, /Mod: oturum şu an “Tam yetki”; bu iş “Düzenlemelere izin ver” ile çalışır/);
  assert.deepEqual(sorulan, ['aaaa1111-0000-4000-8000-000000000001']);
  await ccGorevCalistir({ komut: 'kopya', oturum_id: 'aaaa1111', catalla: true }, t.b(false), t.d);
  assert.equal(sorulan[1], undefined, 'çatal yeni oturumdur: kaynak oturumun modu sorulmaz');
  const yeni = kur();
  yeni.d.modOnizleme = () => ({ olacak: 'default' });
  await ccGorevCalistir({ komut: 'x', klasor: BILINEN }, yeni.b(false), yeni.d);
  assert.match(yeni.cagrilar.onaylar[0].aciklama, /Mod: “Her şeyi sor” \(en çok “Düzenlemelere izin ver”/);
  for (const kod of ['mod-dusurulemedi', 'genis-klasor']) {
    const r = kur({ baslatSonucu: { tamam: false, kod, hata: 'Neden metni.' } });
    const s = await ccGorevCalistir({ komut: 'x', klasor: BILINEN }, r.b(false), r.d);
    assert.equal(s.hata, true);
    assert.match(s.icerik, /^Neden metni\. Bu iş için sonuç yazılmayacak\.$/);
  }
});

test('I1: klasörün kendi ayarları güvenilmemişse kart ve sonuç bunu söyler; güvenildiyse sessiz', async () => {
  const t = kur({ guven: { gerekli: true } });
  const r = await ccGorevCalistir({ komut: 'x', klasor: BILINEN }, t.b(false), t.d);
  assert.match(t.cagrilar.onaylar[0].aciklama, /kendi Claude Code ayarları .* yüklenmeyecek/);
  assert.match(r.icerik, /ayarları yüklenmedi/);
  const g = kur({ guven: { gerekli: true, karar: 'guven' } });
  const r2 = await ccGorevCalistir({ komut: 'x', klasor: BILINEN }, g.b(false), g.d);
  assert.doesNotMatch(g.cagrilar.onaylar[0].aciklama + r2.icerik, /yüklenme/);
});

test('düzeltme A: oturum bilgisayarda açıkken telefondan komut — araç dürüstçe söyler, sonuç sözü VERMEZ', async () => {
  const t = kur({ baslatSonucu: { tamam: false, kod: 'masada-acik', hata: 'x', oturum: ozet() } });
  const r = await ccGorevCalistir({ komut: 'devam et', oturum_id: 'aaaa1111' }, t.b(true), t.d);
  assert.equal(r.hata, true);
  assert.match(r.icerik, /^Bu oturum bilgisayarda açık; komutu bilgisayardan ver\./);
  assert.match(r.icerik, /iletmedim/);
  assert.doesNotMatch(r.icerik, /iletildi|yazacağım/);
});

test('onay kuralı (genel Tam yetki yoksa sorar); bilinmeyen oturum kimliği ve eksik klasör', async () => {
  const t = kur({ tamYetki: false, onayKarari: 'reddet' });
  const r = await ccGorevCalistir({ komut: 'x', klasor: BILINEN }, t.b(false), t.d);
  assert.equal(t.cagrilar.onay, 1);
  assert.match(r.icerik, /reddetti/);
  assert.equal(t.cagrilar.baslat.length, 0);
  assert.match((await ccGorevCalistir({ komut: 'x', oturum_id: 'zzzz' }, t.b(false), t.d)).icerik, /bulunamadı/);
  assert.match((await ccGorevCalistir({ komut: 'x' }, t.b(false), t.d)).icerik, /Ne oturum ne klasör/);
});

// Görev 28 düzeltme 1: sohbetteki araç kartından o oturuma gidilir ("Oturumu aç" → Claude Code sayfası, claude#cc-<id>).
test('uygulama içi oturum başlayınca sonuç kartının hedefi o oturum (claude#cc-<id>); terminal yolunda hedef yok', async () => {
  const t = kur();
  const r = await ccGorevCalistir({ komut: 'testleri çalıştır', klasor: BILINEN }, t.b(false), t.d);
  assert.equal(r.yol, 'claude#cc-o1');
  const tt = kur({ yol: 'terminal' });
  const r2 = await ccGorevCalistir({ komut: 'x', klasor: BILINEN }, tt.b(false), tt.d);
  assert.equal(r2.yol, undefined);
});
