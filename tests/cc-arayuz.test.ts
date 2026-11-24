// Görev 28 (K17): Claude Code çalışma alanının saf yardımcıları — döküm modeli, fark, yazma kutusu tetikleri, biçim, sanal liste.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DokumModeli, modelKur, OGE_SINIRI, anlikGoruntu, birakilacaklar, ESKI_SAYFA_SINIRI, bekleyenTorunVar, type DokumOgesi } from '../src/renderer/claudecode/dokum-modeli.ts';
import { satirFarki, myers, birlesikFarkCoz, duzenlemeBaslangici, aracFarki, parcalaraBol, icerikFarki, numaraliSatirlar, farkSayilari } from '../src/renderer/claudecode/fark.ts';
import {
  tetikBul, tamamla, komutSuz, gecikmeliSorgu, halBilgisi, turSuruyor, sureMetni, maliyetMetni, belirtecMetni, goreliYol, kisaYol, satirKatla,
  gecmisGrupla, oturumEslesir, konumlar, gorunurAralik, izinBasligi, aracAdiTr, YERLESIK_KOMUTLAR, hataSade, dosyaGruplari, komutYedegi, baglantiHedefi, BAGLANTI_YOK, taslakGeriKoy, okunurAd, sonucEtiketi, maliyetSatiri, taslakModelleri, hesapMetni, eforSecenekleri, type Saatci,
} from '../src/renderer/claudecode/yardimci.ts';
import { ccOturumBaglantisi, ccBaglantiYolu, ccCipaCoz, bloklardaYolGuncelle, CC_VARSAYILAN_MODELLER, CC_MODEL_RE } from '../src/shared/cc-olay.ts';
import { ccGorunenOturum, ccEkrandaMi } from '../src/renderer/claudecode/gorunurluk.ts';
import type { CcOlay } from '../src/shared/cc-olay.ts';

const ol = (olay: CcOlay, zaman = 1) => ({ olay, zaman });

// ── Döküm modeli ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('döküm: metin-parca toplu parçaları EKLER (bir olay çok belirteç), tam metin aynı öğeyi DEĞİŞTİRİR', () => {
  const m = new DokumModeli('t-');
  m.uygula({ tur: 'kullanici', id: 'u1', metin: 'merhaba', gorselSayisi: 0 });
  m.uygula({ tur: 'metin-parca', blok: 'm1#0', metin: 'Bir iki ', ust: null });
  m.uygula({ tur: 'metin-parca', blok: 'm1#0', metin: 'üç dört beş ', ust: null });
  let l = m.liste();
  assert.equal(l.length, 2);
  assert.deepEqual(l.map((o) => o.tur), ['kullanici', 'metin']);
  const metin = l[1] as Extract<DokumOgesi, { tur: 'metin' }>;
  assert.equal(metin.metin, 'Bir iki üç dört beş ');
  assert.equal(metin.akiyor, true);
  m.uygula({ tur: 'metin', blok: 'm1#0', metin: 'Bir iki üç dört beş altı.', ust: null });
  l = m.liste();
  assert.equal(l.length, 2, 'tam metin yeni öğe açmaz');
  assert.equal((l[1] as typeof metin).metin, 'Bir iki üç dört beş altı.');
  assert.equal((l[1] as typeof metin).akiyor, false);
});

test('döküm: değişmeyen öğe aynı nesne kalır (memo); değişen yeni nesne', () => {
  const m = new DokumModeli();
  m.uygula({ tur: 'kullanici', id: 'u1', metin: 'a', gorselSayisi: 0 });
  m.uygula({ tur: 'metin-parca', blok: 'b', metin: 'x', ust: null });
  const l1 = m.liste();
  assert.equal(m.liste(), l1, 'değişiklik yoksa aynı dizi');
  m.uygula({ tur: 'metin-parca', blok: 'b', metin: 'y', ust: null });
  const l2 = m.liste();
  assert.notEqual(l2, l1);
  assert.equal(l2[0], l1[0], 'kullanıcı öğesi aynı nesne');
  assert.notEqual(l2[1], l1[1], 'akan metin yeni nesne');
});

test('döküm: araç kartı başlangıç + bitişle birleşir; alt ajanın iç olayları onun çocukları (iç içe)', () => {
  const m = new DokumModeli();
  m.uygula({ tur: 'arac-basladi', id: 't1', ad: 'Read', tip: 'okuma', girdi: { file_path: 'a.ts' }, ozet: 'a.ts', ust: null });
  m.uygula({ tur: 'alt-ajan', id: 'g1', aciklama: 'Tara', istem: 'Projeyi incele', ajanTipi: 'general-purpose', ust: null });
  m.uygula({ tur: 'arac-basladi', id: 't2', ad: 'Grep', tip: 'arama', girdi: { pattern: 'x' }, ozet: '“x”', ust: 'g1' });
  m.uygula({ tur: 'metin', blok: 'ic#0', metin: 'alt ajan düşündü', ust: 'g1' });
  m.uygula({ tur: 'arac-bitti', id: 't2', hata: false, cikti: 'a.ts', kisaltildi: false, ust: 'g1' });
  m.uygula({ tur: 'arac-bitti', id: 't1', hata: true, cikti: 'yok', kisaltildi: false, ust: null });
  const once = m.liste();
  assert.deepEqual(once.map((o) => o.tur), ['arac', 'alt-ajan']);
  const r = once[0] as Extract<DokumOgesi, { tur: 'arac' }>;
  assert.equal(r.durum, 'hata');
  assert.equal(r.cikti, 'yok');
  const g = once[1] as Extract<DokumOgesi, { tur: 'alt-ajan' }>;
  assert.equal(g.durum, 'calisiyor');
  assert.deepEqual(g.cocuklar.map((c) => c.tur), ['arac', 'metin']);
  assert.equal((g.cocuklar[0] as typeof r).durum, 'tamam');
  m.uygula({ tur: 'arac-bitti', id: 'g1', hata: false, cikti: 'Rapor: yolunda', kisaltildi: false, ust: null });
  const sonra = m.liste();
  assert.equal(sonra[0], once[0], 'Read kartı değişmedi');
  assert.equal((sonra[1] as typeof g).durum, 'tamam');
  assert.equal((sonra[1] as typeof g).cikti, 'Rapor: yolunda');
});

test('döküm: çocuğu değişen alt ajan yeni nesne olur (ata zinciri)', () => {
  const m = new DokumModeli();
  m.uygula({ tur: 'alt-ajan', id: 'g1', aciklama: 'A', istem: '', ust: null });
  m.uygula({ tur: 'metin-parca', blok: 'c', metin: 'a', ust: 'g1' });
  const l1 = m.liste();
  m.uygula({ tur: 'metin-parca', blok: 'c', metin: 'b', ust: 'g1' });
  const l2 = m.liste();
  assert.notEqual(l2[0], l1[0]);
  assert.equal(((l2[0] as Extract<DokumOgesi, { tur: 'alt-ajan' }>).cocuklar[0] as Extract<DokumOgesi, { tur: 'metin' }>).metin, 'ab');
});

test('döküm: art arda yapılacaklar güncellemesi TEK kartta; araya iş girince yeni kart, eskisi "eski"', () => {
  const m = new DokumModeli();
  const madde = (icerik: string, durum: 'bekliyor' | 'suruyor' | 'tamam') => ({ icerik, durum });
  m.uygula({ tur: 'yapilacaklar', id: 'a', maddeler: [madde('Test', 'bekliyor')], ust: null });
  m.uygula({ tur: 'yapilacaklar', id: 'b', maddeler: [madde('Test', 'suruyor'), madde('Belge', 'bekliyor')], ust: null });
  let l = m.liste();
  assert.equal(l.length, 1);
  assert.equal((l[0] as Extract<DokumOgesi, { tur: 'yapilacaklar' }>).maddeler.length, 2);
  m.uygula({ tur: 'metin', blok: 'x', metin: 'çalışıyorum', ust: null });
  m.uygula({ tur: 'yapilacaklar', id: 'c', maddeler: [madde('Test', 'tamam'), madde('Belge', 'tamam')], ust: null });
  l = m.liste();
  assert.deepEqual(l.map((o) => o.tur), ['yapilacaklar', 'metin', 'yapilacaklar']);
  assert.equal((l[0] as Extract<DokumOgesi, { tur: 'yapilacaklar' }>).eski, true);
  assert.equal((l[2] as Extract<DokumOgesi, { tur: 'yapilacaklar' }>).eski, false);
});

test('döküm: izin isteği bekleyen listesinde; yanıtlanınca karar işlenir ve listeden düşer', () => {
  const m = new DokumModeli();
  const istek = { tur: 'izin-istegi' as const, istekId: 'i1', arac: 'Bash', tip: 'kabuk' as const, girdi: { command: 'ls' }, ozet: 'ls', herZamanSunulur: true };
  m.uygula(istek);
  m.uygula(istek); // anlık görüntü + canlı: çift kart yok
  assert.equal(m.liste().length, 1);
  assert.deepEqual(m.bekleyenIzinler().map((i) => i.istekId), ['i1']);
  m.uygula({ tur: 'izin-yanitlandi', istekId: 'i1', karar: 'hep' });
  assert.deepEqual(m.bekleyenIzinler(), []);
  assert.equal((m.liste()[0] as Extract<DokumOgesi, { tur: 'izin' }>).karar, 'hep');
});

test('düzeltme 1: izin isteği kendi araç kartına bağlanır — bekleyen istek AYRI satır olmaz; kararı kartta rozet; kartsız istek ayrıca', () => {
  const m = new DokumModeli();
  m.uygula({ tur: 'arac-basladi', id: 't-edit', ad: 'Edit', tip: 'duzenleme', girdi: { file_path: 'a.ts', old_string: 'a', new_string: 'b' }, ozet: 'a.ts', ust: null });
  const istek = { tur: 'izin-istegi' as const, istekId: 'i1', arac: 'Edit', tip: 'duzenleme' as const, girdi: { file_path: 'a.ts', old_string: 'a', new_string: 'b' }, ozet: 'a.ts', herZamanSunulur: true, aracKimligi: 't-edit' };
  m.uygula(istek);
  assert.deepEqual(m.liste().map((o) => o.tur), ['arac'], 'fark yalnız kartta: izin satırı yok');
  assert.equal(m.kartliMi('t-edit'), true);
  assert.deepEqual(m.kartsizBekleyenler(), [], 'yazma kutusunun üstünde ikinci kart yok');
  assert.deepEqual(m.bekleyenIzinler().map((i) => i.istekId), ['i1']);
  m.uygula({ tur: 'izin-yanitlandi', istekId: 'i1', karar: 'hep' });
  const a = m.liste()[0] as Extract<DokumOgesi, { tur: 'arac' }>;
  assert.equal(a.izinKarari, 'hep');
  assert.deepEqual(m.bekleyenIzinler(), []);
  // Kartı olmayan istek (araç dökümde yok): satır + kartsız bekleyen
  m.uygula({ ...istek, istekId: 'i2', aracKimligi: 'gorunmeyen' });
  assert.deepEqual(m.liste().map((o) => o.tur), ['arac', 'izin']);
  assert.deepEqual(m.kartsizBekleyenler().map((i) => i.istekId), ['i2']);
  // Alt ajanın içindeki araç: "Göster" üst düzey alt ajan kartına kaydırır
  m.uygula({ tur: 'alt-ajan', id: 'g', aciklama: 'Tara', istem: '', ust: null });
  m.uygula({ tur: 'arac-basladi', id: 'ic', ad: 'Bash', tip: 'kabuk', girdi: { command: 'ls' }, ozet: 'ls', ust: 'g' });
  assert.equal(m.ustDuzeyAnahtar('ic'), m.liste().find((o) => o.tur === 'alt-ajan')!.anahtar);
});

test('düzeltme 2 (N1): alt ajanın içindeki (iç içe) bekleyen izin bulunur — ajan zorla açılır, gizli adım kalmaz', () => {
  const m = new DokumModeli();
  m.uygula({ tur: 'alt-ajan', id: 'g', aciklama: 'Tara', istem: '', ust: null });
  for (let i = 0; i < 3; i++) m.uygula({ tur: 'arac-basladi', id: `r${i}`, ad: 'Read', tip: 'okuma', girdi: {}, ozet: `r${i}`, ust: 'g' });
  m.uygula({ tur: 'alt-ajan', id: 'g2', aciklama: 'İç ajan', istem: '', ust: 'g' });
  m.uygula({ tur: 'arac-basladi', id: 'b', ad: 'Bash', tip: 'kabuk', girdi: { command: 'ls' }, ozet: 'ls', ust: 'g2' });
  for (let i = 3; i < 9; i++) m.uygula({ tur: 'arac-basladi', id: `r${i}`, ad: 'Read', tip: 'okuma', girdi: {}, ozet: `r${i}`, ust: 'g' });
  m.uygula({ tur: 'izin-istegi', istekId: 'i1', arac: 'Bash', tip: 'kabuk', girdi: { command: 'ls' }, ozet: 'ls', herZamanSunulur: true, aracKimligi: 'b' });
  const ajan = m.liste().find((o) => o.tur === 'alt-ajan')!;
  const bekleyen = new Set(m.bekleyenIzinler().map((i) => i.aracKimligi));
  assert.equal(bekleyenTorunVar(ajan, (id) => bekleyen.has(id)), true, 'iki kat içteki bekleyen araç bulunmadı');
  assert.equal(m.kartliMi('b'), true);
  assert.equal(m.ustDuzeyAnahtar('b'), ajan.anahtar);
  m.uygula({ tur: 'izin-yanitlandi', istekId: 'i1', karar: 'izin' });
  const sonra = new Set(m.bekleyenIzinler().map((i) => i.aracKimligi));
  assert.equal(bekleyenTorunVar(m.liste().find((o) => o.tur === 'alt-ajan')!, (id) => sonra.has(id)), false);
});

test('düzeltme 3: sohbette saklı claude_code_gorev kartının yolu ilk turdan sonra Claude Code kimliğiyle tamamlanır', () => {
  const b = [{ tur: 'metin', metin: 'x' }, { tur: 'arac_sonuc', id: 't', ad: 'claude_code_gorev', yol: 'claude#cc-o-1' }, { tur: 'arac_sonuc', id: 'u', ad: 'baska', yol: 'claude#cc-o-2' }];
  const y = bloklardaYolGuncelle(b, 'o-1', 'kim-1');
  assert.deepEqual(y?.map((x) => (x as { yol?: string }).yol), [undefined, 'claude#cc-o-1~kim-1', 'claude#cc-o-2']);
  assert.equal(bloklardaYolGuncelle(y!, 'o-1', 'kim-1'), null, 'ikinci kez değişmez');
  assert.equal(bloklardaYolGuncelle(b, 'o-9', 'kim-9'), null);
});

test('düzeltme 2 (N3): bayat "Oturumu aç" — aynı Claude Code kimlikli canlı ya da geçmiş oturuma düşer; yoksa kısa not', () => {
  assert.equal(ccOturumBaglantisi('o-1', 'kim-1'), '[Oturumu aç](#cc-o-1~kim-1)');
  assert.equal(ccBaglantiYolu('#cc-o-1~kim-1'), 'claude#cc-o-1~kim-1');
  assert.deepEqual(ccCipaCoz('cc-o-1~kim-1'), { id: 'o-1', kimlik: 'kim-1' });
  assert.deepEqual(ccCipaCoz('#cc-o-1'), { id: 'o-1' });
  assert.equal(ccCipaCoz('cc-<script>'), null);
  const canli = [{ id: 'a', kimlik: 'k-a' }], gecmis = [{ id: 'k-eski', baslik: 'Eski iş' }];
  assert.deepEqual(baglantiHedefi({ id: 'a' }, canli, gecmis), { tur: 'canli', id: 'a' });
  assert.deepEqual(baglantiHedefi({ id: 'gitti', kimlik: 'k-a' }, canli, gecmis), { tur: 'canli', id: 'a' }, 'aynı kimlik başka uygulama oturumunda');
  assert.deepEqual(baglantiHedefi({ id: 'gitti', kimlik: 'k-eski' }, canli, gecmis), { tur: 'gecmis', o: gecmis[0] });
  assert.deepEqual(baglantiHedefi({ id: 'gitti' }, canli, gecmis), { tur: 'yok' });
  assert.match(BAGLANTI_YOK, /artık açık değil; geçmişten sürdürebilirsin/);
});

test('düzeltme 2 (N4, N6, I2): boş/hatalı komut listesine yedek; başarısız gönderim kendi taslağına; bilinmeyen araç okunur adla', () => {
  const son = [{ ad: 'sahte-beceri', aciklama: 'x', ipucu: '', yerlesik: false, takmaAdlar: [] }];
  assert.deepEqual(komutYedegi({ komutlar: [], hata: 'oturum kapalı' }, []).komutlar.map((k) => k.ad).slice(0, 2), ['compact', 'clear']);
  assert.match(komutYedegi({ komutlar: [] }, []).not ?? '', /Beceri komutları/);
  assert.deepEqual(komutYedegi({ komutlar: [] }, son).komutlar, son);
  assert.deepEqual(komutYedegi({ komutlar: son }, []), { komutlar: son });
  const metinler = new Map<string, string>(), ekler = new Map<string, number[]>();
  metinler.set('B', 'B taslağı');
  assert.equal(taslakGeriKoy(metinler, ekler, 'A', 'A mesajı', [1], 'B'), false, 'ekrandaki B, geri konan A');
  assert.equal(metinler.get('A'), 'A mesajı');
  assert.equal(metinler.get('B'), 'B taslağı', 'B ezilmedi');
  assert.deepEqual(ekler.get('A'), [1]);
  metinler.set('A', 'yeni yazılan');
  taslakGeriKoy(metinler, ekler, 'A', 'A mesajı', [], 'A');
  assert.equal(metinler.get('A'), 'yeni yazılan', 'arada yazılan ezilmez');
  assert.equal(izinBasligi({ arac: 'DeployPreviewTool', tip: 'diger' }), 'Claude “Deploy preview tool” aracını kullanmak istiyor');
  assert.equal(aracAdiTr('custom_thing'), 'Araç · Custom thing');
  assert.equal(okunurAd('getURLStatus'), 'Get URL status');
});

test('düzeltme 1: izin başlığı Türkçe (İngilizce araç adı yok); Write yeni / var olan dosya ayrımı', () => {
  const g = (arac: string, tip: Parameters<typeof izinBasligi>[0]['tip'], girdi: Record<string, unknown> = {}) => ({ arac, tip, girdi });
  assert.equal(izinBasligi(g('Edit', 'duzenleme')), 'Claude bu dosyayı düzenlemek istiyor');
  assert.equal(izinBasligi(g('MultiEdit', 'duzenleme')), 'Claude bu dosyayı düzenlemek istiyor');
  assert.equal(izinBasligi(g('Write', 'duzenleme'), false), 'Claude yeni bir dosya oluşturmak istiyor');
  assert.equal(izinBasligi(g('Write', 'duzenleme'), true), 'Claude bu dosyanın üzerine yazmak istiyor');
  assert.equal(izinBasligi(g('Bash', 'kabuk')), 'Claude bu komutu çalıştırmak istiyor');
  assert.equal(izinBasligi(g('PowerShell', 'kabuk')), 'Claude bu komutu çalıştırmak istiyor');
  assert.equal(izinBasligi(g('WebFetch', 'web')), 'Claude bu sayfayı açmak istiyor');
  assert.equal(izinBasligi(g('WebSearch', 'web')), 'Claude web’de arama yapmak istiyor');
  assert.equal(izinBasligi(g('mcp__github__search_issues', 'mcp')), 'Claude “github” bağlantısındaki “search issues” aracını kullanmak istiyor');
  assert.equal(izinBasligi(g('ExitPlanMode', 'plan')), 'Claude planını onayına sunuyor');
  assert.equal(izinBasligi(g('Skill', 'diger')), 'Claude “Beceri” aracını kullanmak istiyor');
  for (const ad of ['Edit', 'Write', 'Bash', 'WebFetch', 'Read', 'Skill', 'SlashCommand', 'NotebookEdit', 'Task', 'Glob']) {
    assert.doesNotMatch(aracAdiTr(ad), /^(Edit|Write|Bash|WebFetch|Read|Skill|SlashCommand|NotebookEdit|Task|Glob)$/, `${ad} Türkçe değil`);
  }
});

test('düzeltme 1: "/" taslakta süreç açmadan — yerleşik komut listesi; sohbet özetinde oturum bağlantısı; hata metni tekrarlanmaz', () => {
  const ad = YERLESIK_KOMUTLAR.map((k) => k.ad);
  for (const k of ['compact', 'clear', 'init', 'review']) assert.ok(ad.includes(k), k);
  assert.ok(YERLESIK_KOMUTLAR.every((k) => k.yerlesik && k.aciklama));
  assert.equal(ccOturumBaglantisi('o-1'), '[Oturumu aç](#cc-o-1)');
  assert.equal(ccBaglantiYolu('#cc-o-1'), 'claude#cc-o-1');
  assert.equal(ccBaglantiYolu('https://x'), null);
  assert.equal(hataSade('Claude Code kapandı (çıkış kodu 3): x. Yeni bir mesajla sürdürebilirsin.'), 'Claude Code kapandı (çıkış kodu 3): x.');
});

test('düzeltme 1: anlık görüntü — bekleyen izinler tampondan ÖNCE; tampondaki "yanıtlandı" eski isteği yeniden bekletmez', () => {
  const istek = { tur: 'izin-istegi' as const, istekId: 'i9', arac: 'Bash', tip: 'kabuk' as const, girdi: { command: 'ls' }, ozet: 'ls', herZamanSunulur: false };
  const z = (sira: number, olay: CcOlay) => ({ sira, zaman: sira, olay });
  // Döküm sınırı isteği kesmiş: yalnız anlık görüntünün bekleyenIzinler'inde; yanıt tamponda (sira 6 > 5).
  const a = { olaylar: [z(5, { tur: 'kullanici', metin: 'merhaba' })], bekleyenIzinler: [istek] };
  const g = anlikGoruntu(a, [z(4, { tur: 'kullanici', metin: 'eski' }), z(6, { tur: 'izin-yanitlandi', istekId: 'i9', karar: 'ret' })]);
  assert.equal(g.sonSira, 5);
  assert.deepEqual(g.sonra.map((x) => x.sira), [6], 'anlık görüntüdeki eski olay yeniden uygulanmaz');
  for (const x of g.sonra) g.model.uygula(x.olay, x.zaman);
  assert.deepEqual(g.model.bekleyenIzinler(), [], 'yanıtlanan istek bekleyen kalmaz');
});

test('düzeltme 1: bellek — kapanmış ve ekranda olmayan oturumun dökümü bırakılır; "Daha eskisi" sayfa sınırı', () => {
  const l = [
    { id: 'a', durum: 'kapandi', yuklu: true }, { id: 'b', durum: 'kapandi', yuklu: true }, { id: 'c', durum: 'hazir', yuklu: true }, { id: 'd', durum: 'kapandi', yuklu: false },
  ];
  assert.deepEqual(birakilacaklar(l, 'b'), ['a']);
  assert.deepEqual(birakilacaklar(l, null), ['a', 'b']);
  assert.ok(ESKI_SAYFA_SINIRI >= 5 && ESKI_SAYFA_SINIRI <= 20);
});

test('düzeltme 1: denetçi dosyaları — "Bu oturumda" önce (git durumuyla), sonra depodaki diğer değişiklikler', () => {
  const cwd = 'C:\\kod\\proje';
  const d = { git: true, dosyalar: [{ yol: 'src/b.ts', durum: ' M' }, { yol: 'README.md', durum: '??' }, { yol: 'src/a.ts', durum: 'A ' }], oturumDosyalari: ['C:\\kod\\proje\\src\\b.ts', 'C:\\kod\\proje\\yeni.txt'] };
  const g = dosyaGruplari(d, [], cwd);
  assert.deepEqual(g.oturumda.map((f) => [f.yol, f.durum]), [['src/b.ts', ' M'], ['yeni.txt', 'M']]);
  assert.deepEqual(g.diger.map((f) => f.yol), ['README.md', 'src/a.ts']);
  // git yoksa yalnız bu oturumun dosyaları; döküm henüz gelmediyse depodaki liste yedek
  assert.deepEqual(dosyaGruplari({ git: false, dosyalar: [], oturumDosyalari: ['C:\\kod\\proje\\x.ts'] }, [], cwd), { oturumda: [{ yol: 'x.ts', durum: 'M' }], diger: [] });
  assert.deepEqual(dosyaGruplari(null, ['C:\\kod\\proje\\y.ts'], cwd).oturumda.map((f) => f.yol), ['y.ts']);
});

test('döküm: sonuç akan metni ve süren göstergeleri kapatır; çalışan araç "kesildi"; biten düşünme gizli', () => {
  const m = new DokumModeli();
  m.uygula({ tur: 'dusunme', blok: 'd', durum: 'basladi', ust: null });
  assert.equal(m.liste()[0].tur, 'dusunme');
  assert.equal(m.akiyorMu(), true);
  m.uygula({ tur: 'metin-parca', blok: 'b', metin: 'yarım', ust: null });
  m.uygula({ tur: 'arac-basladi', id: 't', ad: 'Bash', tip: 'kabuk', girdi: { command: 'sleep 9' }, ozet: 'sleep 9', ust: null });
  m.uygula({ tur: 'sonuc', basarili: false, kesildi: true, sureMs: 1200, turSayisi: 1, maliyetUsd: 0.01, belirtec: { girdi: 1, cikti: 1, onbellekOkuma: 0, onbellekYazma: 0 } });
  const l = m.liste();
  assert.deepEqual(l.map((o) => o.tur), ['metin', 'arac', 'sonuc'], 'düşünme göstergesi bitti → gizli');
  assert.equal((l[0] as Extract<DokumOgesi, { tur: 'metin' }>).akiyor, false);
  assert.equal((l[1] as Extract<DokumOgesi, { tur: 'arac' }>).durum, 'kesildi');
  assert.equal(m.akiyorMu(), false);
});

test('döküm: mod/model/sistem notları; bilinmeyen ve liste dışı olaylar öğe değil', () => {
  const m = new DokumModeli();
  m.uygula({ tur: 'mod', mod: 'plan' });
  m.uygula({ tur: 'model', model: 'default' });
  m.uygula({ tur: 'sistem', seviye: 'uyari', metin: 'Yeniden deneniyor' });
  assert.equal(m.uygula({ tur: 'unutuldu' }), false);
  assert.equal(m.uygula({ tur: 'baslangic', kimlik: 'k', model: 'x', mod: 'default', surum: '1', cwd: 'C:/', araclar: [], komutlar: [], yetenekler: [] }), false);
  const l = m.liste();
  assert.deepEqual(l.map((o) => (o.tur === 'not' || o.tur === 'sistem' ? o.metin : o.tur)), ['Mod: Plan', 'Model: varsayılan', 'Yeniden deneniyor']);
});

test('döküm: "Daha eskisi" sayfası öne eklenir; sayfa sınırındaki yetim sonuç eski karta birleşir', () => {
  const yeni = modelKur([
    ol({ tur: 'arac-bitti', id: 'sinir', hata: false, cikti: 'tamam çıktı', kisaltildi: false, ust: null }),
    ol({ tur: 'kullanici', id: 'u2', metin: 'ikinci', gorselSayisi: 0 }),
  ], 'y-');
  assert.deepEqual(yeni.liste().map((o) => o.tur), ['kullanici'], 'yetim sonuç kart olmaz');
  const eski = modelKur([
    ol({ tur: 'kullanici', id: 'u1', metin: 'birinci', gorselSayisi: 0 }),
    ol({ tur: 'arac-basladi', id: 'sinir', ad: 'Bash', tip: 'kabuk', girdi: { command: 'ls' }, ozet: 'ls', ust: null }),
  ], 'e-');
  yeni.oneEkle(eski);
  const l = yeni.liste();
  assert.deepEqual(l.map((o) => o.tur), ['kullanici', 'arac', 'kullanici']);
  const a = l[1] as Extract<DokumOgesi, { tur: 'arac' }>;
  assert.equal(a.durum, 'tamam');
  assert.equal(a.cikti, 'tamam çıktı');
  assert.equal(new Set(l.map((o) => o.anahtar)).size, 3, 'anahtarlar çakışmaz');
});

test('döküm: 5 000+ olay (uzun oturum) hızlı; üst düzey öğe sınırı en eskiden atar', () => {
  const m = new DokumModeli();
  const t0 = performance.now();
  for (let i = 0; i < 2600; i++) {
    m.uygula({ tur: 'arac-basladi', id: `t${i}`, ad: 'Read', tip: 'okuma', girdi: { file_path: `d${i}.ts` }, ozet: `d${i}.ts`, ust: null });
    m.uygula({ tur: 'arac-bitti', id: `t${i}`, hata: false, cikti: 'x', kisaltildi: false, ust: null });
    if (i % 50 === 0) m.liste();
  }
  const sure = performance.now() - t0;
  assert.equal(m.liste().length, 2600);
  assert.ok(sure < 1500, `5 200 olay ${sure.toFixed(0)} ms`);
  const k = new DokumModeli();
  for (let i = 0; i < OGE_SINIRI + 25; i++) k.uygula({ tur: 'sistem', seviye: 'bilgi', metin: `n${i}` });
  assert.equal(k.liste().length, OGE_SINIRI);
  assert.equal(k.atilan, 25);
  assert.equal((k.liste()[0] as Extract<DokumOgesi, { tur: 'sistem' }>).metin, 'n25');
});

// ── Fark ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test('fark: satır farkı (ortak baş/son, değişen orta); numara yalnız başlangıç verilince', () => {
  const f = satirFarki('a\nb\nc\nd', 'a\nB\nc\nd\ne');
  assert.deepEqual(f.map((s) => `${s.tur[0]}${s.metin}`), ['aa', 'sb', 'eB', 'ac', 'ad', 'ee']);
  assert.ok(f.every((s) => s.eski === undefined && s.yeni === undefined), 'numara uydurulmaz');
  const n = satirFarki('x\ny', 'x\nz', { eskiBas: 10, yeniBas: 10 });
  assert.deepEqual(n.map((s) => [s.tur, s.eski, s.yeni]), [['ayni', 10, 10], ['sil', 11, undefined], ['ekle', undefined, 11]]);
  assert.deepEqual(farkSayilari(f), { eklenen: 2, silinen: 1 });
  assert.deepEqual(satirFarki('', 'yeni').map((s) => s.tur), ['ekle']);
  assert.deepEqual(satirFarki('aynı\r\n', 'aynı\n'), [{ tur: 'ayni', metin: 'aynı' }], 'CRLF ve son satır sonu fark değil');
});

test('fark: Myers en kısa düzenlemeyi bulur; sınırı aşan çok farklı girdi null (çağıran hepsi−/hepsi+ düşer)', () => {
  const a = 'a b c a b b a'.split(' '), b = 'c b a b a c'.split(' ');
  const ops = myers(a, b)!;
  assert.equal(ops.filter((o) => o !== '=').length, 5, 'D = 5 (Myers makalesindeki örnek)');
  const x = Array.from({ length: 400 }, (_, i) => `x${i}`), y = Array.from({ length: 400 }, (_, i) => `y${i}`);
  assert.equal(myers(x, y, 100), null);
  const f = satirFarki(x.join('\n'), y.join('\n'), { sinir: 100 });
  assert.equal(f.length, 800);
  assert.deepEqual([f[0].tur, f[399].tur, f[400].tur], ['sil', 'sil', 'ekle']);
  // Büyük dosyada tek satırlık değişiklik (CLAUDE.md) hızlı ve doğru
  const buyuk = Array.from({ length: 20000 }, (_, i) => `satır ${i}`);
  const degisik = buyuk.slice(); degisik[12345] = 'değişti';
  const t0 = performance.now();
  const bf = satirFarki(buyuk.join('\n'), degisik.join('\n'));
  assert.ok(performance.now() - t0 < 500);
  assert.deepEqual(farkSayilari(bf), { eklenen: 1, silinen: 1 });
});

test('fark: parçalar değişikliğin çevresinde bağlamla; yakın değişiklikler birleşir', () => {
  const a = Array.from({ length: 30 }, (_, i) => `s${i}`);
  const b = a.slice(); b[5] = 'X'; b[8] = 'Y'; b[25] = 'Z';
  const p = parcalaraBol(satirFarki(a.join('\n'), b.join('\n')), 2);
  assert.equal(p.length, 2);
  assert.equal(p[0].satirlar[0].metin, 's3');
  assert.ok(p[1].satirlar.some((s) => s.metin === 'Z'));
  assert.deepEqual(parcalaraBol(satirFarki('a', 'a')), []);
});

test('fark: git diff ayrıştırma (iki dosya, parça numaraları, yeni dosya, ikili, başlıksız ekleme yedeği)', () => {
  const metin = [
    'diff --git a/src/a.ts b/src/a.ts', 'index 111..222 100644', '--- a/src/a.ts', '+++ b/src/a.ts',
    '@@ -10,3 +10,4 @@ function f() {', ' bir', '-iki', '+İKİ', '+yeni', ' üç',
    'diff --git a/yeni.md b/yeni.md', 'new file mode 100644', '--- /dev/null', '+++ b/yeni.md', '@@ -0,0 +1,2 @@', '+# Başlık', '+--- çizgi değil başlık değil',
    'diff --git a/logo.png b/logo.png', 'Binary files a/logo.png and b/logo.png differ',
  ].join('\n');
  const d = birlesikFarkCoz(metin);
  assert.deepEqual(d.map((x) => x.yol), ['src/a.ts', 'yeni.md', 'logo.png']);
  assert.equal(d[0].parcalar[0].baslik, 'function f() {');
  assert.deepEqual(d[0].parcalar[0].satirlar.map((s) => [s.tur, s.eski ?? null, s.yeni ?? null]), [['ayni', 10, 10], ['sil', 11, null], ['ekle', null, 11], ['ekle', null, 12], ['ayni', 12, 13]]);
  assert.deepEqual([d[0].eklenen, d[0].silinen], [2, 1]);
  assert.equal(d[1].yeni, true);
  assert.equal(d[1].parcalar[0].satirlar[1].metin, '--- çizgi değil başlık değil');
  assert.equal(d[2].ikili, true);
  const yedek = birlesikFarkCoz('--- /dev/null\n+++ b/notlar.txt\n+ilk\n+ikinci');
  assert.equal(yedek[0].yol, 'notlar.txt');
  assert.deepEqual(yedek[0].parcalar[0].satirlar.map((s) => s.yeni), [1, 2]);
});

test('fark: Edit sonucundaki cat -n parçasından gerçek satır numarası; belirsizse numara yok', () => {
  const cikti = "The file a.ts has been updated. Here's the result of running `cat -n` on a snippet:\n    41→const a = 1;\n    42→const b = 2;\n    43→export { a, b };";
  assert.deepEqual(numaraliSatirlar(cikti).map((s) => s.no), [41, 42, 43]);
  assert.equal(duzenlemeBaslangici(cikti, 'const b = 2;\nexport { a, b };'), 42);
  assert.equal(duzenlemeBaslangici('   1\tx\n   2\tx', 'x'), null, 'iki eşleşme: numara uydurulmaz');
  assert.equal(duzenlemeBaslangici(undefined, 'x'), null);
  const e = aracFarki('Edit', { file_path: 'a.ts', old_string: 'const b = 1;', new_string: 'const b = 2;' }, cikti)!;
  assert.deepEqual(e.satirlar.map((s) => [s.tur, s.eski ?? null, s.yeni ?? null]), [['sil', 42, null], ['ekle', null, 42]]);
  const w = aracFarki('Write', { file_path: 'b.ts', content: 'x\ny\n' })!;
  assert.equal(w.yeniDosya, true);
  assert.deepEqual(w.satirlar, icerikFarki('x\ny'));
  const me = aracFarki('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b' }, { old_string: 'c', new_string: 'd' }] })!;
  assert.deepEqual(me.satirlar.map((s) => s.tur), ['sil', 'ekle', 'ayni', 'sil', 'ekle']);
  assert.equal(aracFarki('Read', {}), null);
});

// ── Yazma kutusu ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('yazma kutusu: "/" yalnız metnin başında; "@" sözcük başında (e-posta değil); imleç sözcük içinde', () => {
  assert.deepEqual(tetikBul('/comp', 5), { tur: 'komut', sorgu: 'comp', bas: 0, son: 5 });
  assert.deepEqual(tetikBul('/', 1), { tur: 'komut', sorgu: '', bas: 0, son: 1 });
  assert.equal(tetikBul('yolu src/a.ts yap', 9), null, 'ortadaki / yol');
  assert.equal(tetikBul('/compact şimdi', 14), null, 'ilk sözcükten sonra palet kapanır');
  assert.equal(tetikBul('/src/a.ts', 9), null, 'baştaki yol komut değil');
  assert.deepEqual(tetikBul('şuna bak @src/ma', 16), { tur: 'dosya', sorgu: 'src/ma', bas: 9, son: 16 });
  assert.deepEqual(tetikBul('@', 1), { tur: 'dosya', sorgu: '', bas: 0, son: 1 });
  assert.equal(tetikBul('ben@ornek.com', 13), null, 'e-posta');
  assert.deepEqual(tetikBul('a @x b', 4), { tur: 'dosya', sorgu: 'x', bas: 2, son: 4 });
});

test('yazma kutusu: tamamlama tetiği seçilenle değiştirir, tek boşluk ve imleç sonda; boşluklu yol tırnaklı', () => {
  const t = tetikBul('bak @src/ma sonra', 11)!;
  assert.deepEqual(tamamla('bak @src/ma sonra', t, 'src/main.ts'), { metin: 'bak @src/main.ts sonra', imlec: 17 });
  const k = tetikBul('/co', 3)!;
  assert.deepEqual(tamamla('/co', k, 'compact'), { metin: '/compact ', imlec: 9 });
  const b = tetikBul('@be', 3)!;
  assert.equal(tamamla('@be', b, 'belgeler/yeni dosya.md').metin, '@"belgeler/yeni dosya.md" ');
});

test('komut paleti: ad öneki önce, takma ad, içerik, açıklama; Türkçe harf katlamalı', () => {
  const k = [
    { ad: 'compact', aciklama: 'Bağlamı küçültür', ipucu: '', yerlesik: true, takmaAdlar: [] },
    { ad: 'clear', aciklama: 'Konuşmayı temizler', ipucu: '', yerlesik: true, takmaAdlar: ['reset'] },
    { ad: 'gözden-geçir', aciklama: 'Kod incelemesi', ipucu: '<pr>', yerlesik: false, takmaAdlar: [] },
  ];
  assert.deepEqual(komutSuz(k, 'c').map((x) => x.ad), ['clear', 'compact']);
  assert.deepEqual(komutSuz(k, 'res').map((x) => x.ad), ['clear']);
  assert.deepEqual(komutSuz(k, 'gozden').map((x) => x.ad), ['gözden-geçir']);
  assert.deepEqual(komutSuz(k, 'temiz').map((x) => x.ad), ['clear']);
  assert.deepEqual(komutSuz(k, '').map((x) => x.ad), ['gözden-geçir', 'clear', 'compact'], 'boş sorguda kullanıcı becerileri önce');
});

test('"@" önerisi gecikmeli: ~120 ms içindeki tuşlar tek istek; bayat yanıt yok sayılır', async () => {
  const kurulan: { f: () => void; ms: number; iptal: boolean }[] = [];
  const saat: Saatci = { kur: (f, ms) => { const z = { f, ms, iptal: false }; kurulan.push(z); return z; }, iptal: (z) => { (z as { iptal: boolean }).iptal = true; } };
  const istekler: string[] = [];
  const cozumler: ((v: string[]) => void)[] = [];
  const gelen: [string, string[]][] = [];
  const g = gecikmeliSorgu((q) => { istekler.push(q); return new Promise<string[]>((r) => cozumler.push(r)); }, (q, r) => gelen.push([q, r]), 120, saat);
  g.iste('s'); g.iste('sr'); g.iste('src');
  assert.equal(kurulan.filter((z) => !z.iptal).length, 1, 'yalnız son tuşun zamanlayıcısı');
  assert.equal(kurulan.at(-1)!.ms, 120);
  kurulan.at(-1)!.f();
  assert.deepEqual(istekler, ['src']);
  g.iste('src/a');
  kurulan.at(-1)!.f();
  cozumler[1](['src/a.ts']);
  cozumler[0](['src/eski.ts']); // eski istek sonra döndü
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(gelen, [['src/a', ['src/a.ts']]], 'bayat yanıt uygulanmaz');
});

// ── Hâl ve biçim ─────────────────────────────────────────────────────────────────────────────────────────────────────────
test('oturum hâli etiketi: Çalışıyor / İzin bekliyor / Bitti / Hata / Sırada / Hazır / Kapandı', () => {
  const h = (durum: 'calisiyor' | 'izin' | 'bosta' | 'hata' | 'sirada' | 'kapandi', ek: object = {}) => halBilgisi({ durum, bekleyenIzin: 0, ...ek }).etiket;
  assert.equal(h('calisiyor'), 'Çalışıyor');
  assert.equal(h('izin', { bekleyenIzin: 1 }), 'İzin bekliyor');
  assert.equal(h('izin', { bekleyenIzin: 2 }), 'İzin bekliyor · 2');
  assert.equal(h('bosta', { turSayisi: 3 }), 'Bitti');
  assert.equal(h('bosta'), 'Hazır');
  assert.equal(h('hata'), 'Hata');
  assert.equal(h('sirada', { siraNo: 2 }), 'Sırada · 2.');
  assert.equal(h('kapandi'), 'Kapandı');
  assert.equal(turSuruyor({ durum: 'izin' }), true);
  assert.equal(turSuruyor({ durum: 'bosta' }), false);
});

test('biçim: süre, maliyet (Türkçe ondalık), belirteç, göreli yol, satır katlama', () => {
  assert.equal(sureMetni(850), '850 ms');
  assert.equal(sureMetni(12_400), '12 sn');
  assert.equal(sureMetni(184_000), '3 dk 4 sn');
  assert.equal(sureMetni(3_720_000), '1 sa 2 dk');
  assert.match(maliyetMetni(0.0012), /0,0012/);
  assert.match(maliyetMetni(1.5), /1,50/);
  assert.match(belirtecMetni(12_345), /12,3/);
  assert.equal(goreliYol('C:\\Kod\\Proje\\src\\a.ts', 'C:\\Kod\\Proje'), 'src/a.ts');
  assert.equal(goreliYol('c:/kod/proje/src/a.ts', 'C:\\Kod\\Proje\\'), 'src/a.ts');
  assert.equal(goreliYol('D:/baska/x.ts', 'C:/Kod/Proje'), 'D:/baska/x.ts');
  assert.equal(kisaYol('C:\\Kullanicilar\\Deniz\\AppData\\Local\\kod\\mavi-kus'), '…\\kod\\mavi-kus', 'uzun yolun anlamlı ucu');
  assert.equal(kisaYol('/home/deniz/kod/site'), '…/kod/site');
  assert.equal(kisaYol('C:\\kod\\x'), 'C:\\kod\\x', 'kısa yol olduğu gibi');
  const uzun = Array.from({ length: 50 }, (_, i) => `satır ${i}`).join('\n');
  assert.deepEqual([satirKatla(uzun, 12, false).gizli, satirKatla(uzun, 12, false).gorunen.split('\n').length], [38, 12]);
  assert.equal(satirKatla(uzun, 12, true).gizli, 0);
});

test('geçmiş: projelere göre gruplanır (en yeni önce), canlı kimlikler çıkarılır; arama harf katlamalı', () => {
  const l = [
    { id: 'a', cwd: 'C:/k/mavi', proje: 'mavi', baslik: 'Giriş taşması', sonZaman: '2026-10-20', istemSayisi: 2 },
    { id: 'b', cwd: 'C:/k/yesil', proje: 'yesil', baslik: 'Ödeme', sonZaman: '2026-10-25', istemSayisi: 1 },
    { id: 'c', cwd: 'C:/K/MAVI', proje: 'mavi', baslik: 'Logo', sonZaman: '2026-10-22', istemSayisi: 5 },
  ];
  const g = gecmisGrupla(l, new Set(['b']));
  assert.deepEqual(g.map((x) => [x.proje, x.oturumlar.map((o) => o.id)]), [['mavi', ['c', 'a']]]);
  assert.equal(oturumEslesir(l[1], 'odeme'), true);
  assert.equal(oturumEslesir(l[0], 'mavi taşma'), true);
  assert.equal(oturumEslesir(l[0], 'yesil'), false);
});

test('ada/tost: yalnız ekranda AÇIK olan oturumun bildirimi tekrarlanmaz; başka oturumunki ve sayfa kapalıyken gösterilir', () => {
  const g = globalThis as { document?: unknown };
  const eski = g.document;
  g.document = { visibilityState: 'visible' };
  try {
    ccGorunenOturum('o-1');
    assert.equal(ccEkrandaMi('claude#cc-o-1'), true);
    // Düzeltme 3 (F1): bildirim yolu Claude Code kimliğini de taşır ('claude#cc-<id>~<kimlik>'): kimlik eki karşılaştırmayı bozmaz.
    assert.equal(ccEkrandaMi('claude#cc-o-1~89b3e219-01c9-4a87-b9e1-4331a34a2135'), true, 'kimlik ekli yol aynı oturum');
    assert.equal(ccEkrandaMi('claude#cc-o-2~89b3e219'), false);
    assert.equal(ccEkrandaMi('ayarlar#cc-o-1'), false, 'başka sayfa');
    assert.equal(ccEkrandaMi('claude#cc-o-2'), false, 'başka oturum: tost (Aç ile gidilir)');
    assert.equal(ccEkrandaMi(undefined), false);
    g.document = { visibilityState: 'hidden' };
    assert.equal(ccEkrandaMi('claude#cc-o-1'), false, 'pencere gizli');
    g.document = { visibilityState: 'visible' };
    ccGorunenOturum(null);
    assert.equal(ccEkrandaMi('claude#cc-o-1'), false, 'sayfa kapalı');
  } finally { g.document = eski; }
});

test('sanal liste: konumlar ve görünür aralık (ikili arama, pay dahil)', () => {
  const ofs = konumlar([100, 50, 200, 80], 10);
  assert.deepEqual([...ofs], [0, 110, 170, 380, 460]);
  assert.deepEqual(gorunurAralik(ofs, 0, 100, 0), { bas: 0, son: 1 });
  assert.deepEqual(gorunurAralik(ofs, 120, 100, 0), { bas: 1, son: 3 });
  assert.deepEqual(gorunurAralik(ofs, 120, 100, 200), { bas: 0, son: 4 });
  assert.deepEqual(gorunurAralik(ofs, 2000, 100, 0), { bas: 3, son: 4 });
  assert.deepEqual(gorunurAralik(konumlar([], 10), 0, 100, 0), { bas: 0, son: 0 });
  const buyuk = konumlar(Array.from({ length: 5000 }, () => 40), 8);
  const r = gorunurAralik(buyuk, 48 * 2500, 600, 300);
  assert.ok(r.son - r.bas < 40 && r.bas > 2400, JSON.stringify(r));
});

// ── 0.13 T12: arka plan işi, tahmini maliyet, taslakta model listesi ───────────────────────────────────────────────────────────
const sonucOlayi = (ek: Partial<Extract<CcOlay, { tur: 'sonuc' }>> = {}): CcOlay => ({
  tur: 'sonuc', basarili: true, kesildi: false, sureMs: 6_480_000, turSayisi: 27, maliyetUsd: 5869.84, paraGoster: true,
  belirtec: { girdi: 1, cikti: 1, onbellekOkuma: 0, onbellekYazma: 0 }, ...ek,
});

test('arka plan: sayı > 0 iken sonuç kartı "Bitti" demez, "Arka planda N iş sürüyor" der', () => {
  const bos = sonucEtiketi({ basarili: true, kesildi: false, sureMs: 1000, turSayisi: 2, maliyetUsd: 0 }, 0);
  assert.equal(bos.baslik, 'Bitti');
  const e = sonucEtiketi({ basarili: true, kesildi: false, sureMs: 1000, turSayisi: 2, maliyetUsd: 0 }, 1);
  assert.equal(e.baslik, 'Arka planda 1 iş sürüyor');
  assert.equal(sonucEtiketi({ basarili: true, kesildi: false, sureMs: 1000, turSayisi: 2, maliyetUsd: 0 }, 3).baslik, 'Arka planda 3 iş sürüyor');
  assert.notEqual(e.ton, 'tamam', 'yeşil "bitti" tonu değil');
  // Hata ve durdurma arka plan işinden etkilenmez (zaten bitmiş bir sonuç).
  assert.equal(sonucEtiketi({ basarili: false, kesildi: true, sureMs: 1, turSayisi: 1, maliyetUsd: 0 }, 2).baslik, 'Durduruldu');
});

test('arka plan: döküm modeli — sonuç kartı sayıyı taşır; son iş bitince aynı kart "Bitti"ye döner; yeni sonuç eskiyi sıfırlar', () => {
  const m = new DokumModeli('ap-');
  m.uygula({ tur: 'arka-plan', sayi: 2 });
  m.uygula(sonucOlayi());
  const kart = () => m.liste().filter((o) => o.tur === 'sonuc') as Extract<DokumOgesi, { tur: 'sonuc' }>[];
  assert.equal(kart()[0].arkaPlan, 2);
  const once = kart()[0];
  m.uygula({ tur: 'arka-plan', sayi: 1 });
  assert.equal(kart()[0].arkaPlan, 1);
  assert.notEqual(kart()[0], once, 'değişen kart yeni nesne (memo yeniden çizer)');
  m.uygula({ tur: 'arka-plan', sayi: 0 });
  assert.equal(kart()[0].arkaPlan, 0, 'son iş bitince "Bitti"ye döner');
  // Sayı sonradan artarsa bitmiş kart yeniden "sürüyor" olmaz (o başka bir turun işi).
  m.uygula({ tur: 'arka-plan', sayi: 1 });
  assert.equal(kart()[0].arkaPlan, 0);
  // Yeni tur sonucu gelince önceki kart (hâlâ sürüyor görünüyorsa) sıfırlanır: yalnız SON sonuç canlı sayıyı gösterir.
  const m2 = new DokumModeli('ap2-');
  m2.uygula({ tur: 'arka-plan', sayi: 1 });
  m2.uygula(sonucOlayi());
  m2.uygula(sonucOlayi());
  const k2 = m2.liste().filter((o) => o.tur === 'sonuc') as Extract<DokumOgesi, { tur: 'sonuc' }>[];
  assert.deepEqual(k2.map((o) => o.arkaPlan), [0, 1]);
});

test('arka plan: oturum hâli etiketi "Arka planda" (tur bitmiş, iş sürüyor); çalışan/izin/hata öncelikli', () => {
  const h = (durum: 'calisiyor' | 'izin' | 'bosta' | 'hata' | 'sirada' | 'kapandi', ek: object = {}) => halBilgisi({ durum, bekleyenIzin: 0, ...ek });
  assert.equal(h('bosta', { turSayisi: 3, arkaPlan: 2 }).etiket, 'Arka planda');
  assert.equal(h('bosta', { turSayisi: 3, arkaPlan: 2 }).ton, 'calisiyor', 'canlı nokta: iş sürüyor');
  assert.equal(h('bosta', { turSayisi: 3, arkaPlan: 0 }).etiket, 'Bitti', 'son iş bitince Bitti\'ye döner');
  assert.equal(h('bosta', { turSayisi: 3 }).etiket, 'Bitti', 'alan yoksa (eski özet) Bitti');
  assert.equal(h('calisiyor', { arkaPlan: 1 }).etiket, 'Çalışıyor');
  assert.equal(h('izin', { bekleyenIzin: 1, arkaPlan: 1 }).etiket, 'İzin bekliyor');
  assert.equal(h('hata', { arkaPlan: 1 }).etiket, 'Hata');
  assert.equal(h('kapandi', { arkaPlan: 1 }).etiket, 'Kapandı', 'oturum kapanınca sayı anlamsız');
});

test('maliyet: üyelikle çalışan oturumda sonuç kartı ve Denetçi dolar göstermez; bilinmiyorsa da göstermez', () => {
  const s = sonucOlayi() as Extract<CcOlay, { tur: 'sonuc' }>;
  const uye = sonucEtiketi({ ...s, paraGoster: false }, 0);
  assert.equal(uye.parcalar, '1 sa 48 dk · 27 tur', 'üyelikle çalışan oturumun kartında tutar yok');
  assert.doesNotMatch(uye.parcalar, /\$|≈/);
  const bilinmiyor = sonucEtiketi({ ...s, paraGoster: undefined }, 0);
  assert.doesNotMatch(bilinmiyor.parcalar, /\$|≈/);
  // Denetçi satırı: ana süreç üyelikte maliyetUsd'yi özete koymaz → satır yok.
  assert.equal(maliyetSatiri({}), null);
  assert.equal(maliyetSatiri({ maliyetUsd: undefined }), null);
});

test('maliyet: API anahtarıyla çalışanda "≈" tutar kalır (kart ve Denetçi)', () => {
  const s = sonucOlayi() as Extract<CcOlay, { tur: 'sonuc' }>;
  const api = sonucEtiketi(s, 0);
  assert.match(api.parcalar, /^1 sa 48 dk · 27 tur · ≈ \$5\.869,84$/);
  assert.match(maliyetSatiri({ maliyetUsd: 5869.84 }) ?? '', /^≈ \$5\.869,84$/);
  // Arka plan sürerken de tutar (API anahtarında) aynı satırda kalır.
  assert.match(sonucEtiketi(s, 1).parcalar, /≈ \$5\.869,84/);
});

test('taslakta model listesi boş değil: oturum listesi yoksa saklı liste, o da yoksa opus / sonnet / haiku', () => {
  const canli = [{ deger: 'default', ad: 'Varsayılan', aciklama: '' }];
  const saklı = [{ deger: 'opus', ad: 'Opus 5', aciklama: 'x' }];
  assert.deepEqual(taslakModelleri(canli, saklı), canli, 'canlı oturumdan gelen liste en güncel');
  assert.deepEqual(taslakModelleri([], saklı), saklı);
  assert.deepEqual(taslakModelleri([], null), [...CC_VARSAYILAN_MODELLER]);
  assert.deepEqual(taslakModelleri([], []), [...CC_VARSAYILAN_MODELLER], 'boş saklı liste de yedeğe düşer');
  assert.deepEqual(CC_VARSAYILAN_MODELLER.map((m) => m.deger), ['opus', 'sonnet', 'haiku']);
  assert.ok(CC_VARSAYILAN_MODELLER.every((m) => m.ad && CC_MODEL_RE.test(m.deger)), 'her değer motorun model doğrulamasından geçer');
});

test('hesap satırı: "Kendi Claude hesabınla çalışır" (+ e-posta, plan); giriş yoksa `claude login` yönergesi', () => {
  assert.deepEqual(hesapMetni(null, null), { metin: 'Kendi Claude hesabınla çalışır', giris: false });
  assert.equal(hesapMetni({ eposta: 'deniz@ornek.test', plan: 'max' }, { girisYapildi: true }).metin, 'Kendi Claude hesabınla çalışır · deniz@ornek.test · Max');
  const yok = hesapMetni(null, { girisYapildi: false });
  assert.equal(yok.giris, true);
  assert.match(yok.metin, /claude login/);
  assert.match(yok.metin, /^Kendi Claude hesabınla çalışır/);
  // Giriş yokken eski e-posta gösterilmez (hesap bilgisi bayat olabilir).
  assert.doesNotMatch(hesapMetni({ eposta: 'eski@ornek.test' }, { girisYapildi: false }).metin, /eski@/);
});

test('düşünme gücü seçici: varsayılan + SDK EffortLevel değerleri (low … max)', () => {
  assert.deepEqual(eforSecenekleri().map((s) => s.deger), ['', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.equal(eforSecenekleri()[0].etiket, 'Düşünme: varsayılan');
});

// 0.15 sürüm doğrulaması (claudecode-onizle "Durdur ve geç: şerit kalktı"): ana süreç modu yayınlar, SONRA eski süreci kapatır (en çok ~4 sn) ve ancak o
// zaman yanıt verir. Şerit yanıtı beklediği için oturum Tam yetkideyken "Bu tur bitince kendiliğinden geçilecek" demeye devam ediyordu. Şerit, oturumun
// özetindeki mod hedef moda ulaşınca kalkar.
test('mod bekleme şeridi: oturumun modu hedefe ulaşınca biter; başka oturum, başka mod ya da oturum yoksa bitmez', async () => {
  const { modBeklemesiBitti } = await import('../src/renderer/claudecode/yardimci.ts');
  const u = { tur: 'mod-bekliyor' as const, id: 'a', mod: 'bypassPermissions' as const };
  assert.equal(modBeklemesiBitti(u, { id: 'a', mod: 'bypassPermissions' }), true);
  assert.equal(modBeklemesiBitti(u, { id: 'a', mod: 'default' }), false);
  assert.equal(modBeklemesiBitti(u, { id: 'b', mod: 'bypassPermissions' }), false);
  assert.equal(modBeklemesiBitti(u, undefined), false);
  assert.equal(modBeklemesiBitti({ tur: 'hata' }, { id: 'a', mod: 'bypassPermissions' }), false);
  assert.equal(modBeklemesiBitti(null, { id: 'a', mod: 'bypassPermissions' }), false);
});
