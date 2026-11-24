// Uygulama içi kısayollar (src/shared/uygulama-kisayol.ts; Görev 20b, K10): Ctrl+N yeni sohbet (yazarken de), Ctrl+1…7 ray
// sırasındaki görünür sayfalar (yazı alanında çakışmaz; İş modunda Claude Code yok → numaralar görünenlere), ipucu metni.
// 0.10 Görev 1 (D1, P1): ray sırası tek kaynak RAY_SIRASI; Etkinlik Bağlantılar'dan sonra, Ayarlar'dan önce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { kisayolCoz, siradakiSayfa, sayfaKisayolMetni, yeniSohbetKisayolu, yaziAlaniMi, RAY_SIRASI, gorunenRay } from '../src/shared/uygulama-kisayol.ts';
import { ccCanliVar } from '../src/shared/cc-olay.ts';

test('ray: İş', () => assert.deepEqual(gorunenRay('is'), ['kokpit', 'sohbetler', 'hafiza', 'toplanti', 'baglantilar', 'etkinlik', 'ayarlar']));
test('ray: Geliştirici', () => assert.deepEqual(gorunenRay('gelistirici'), ['kokpit', 'sohbetler', 'hafiza', 'toplanti', 'claude', 'baglantilar', 'etkinlik', 'ayarlar']));
test('0.13 son düzeltme 5: Developer\'dan Business\'a geçince canlı Claude Code oturumu ya da bekleyen izin ortada kalmaz: sayfa rayda ve açık kalır', () => {
  assert.deepEqual(gorunenRay('is', true), [...RAY_SIRASI], 'Business\'ta da rayda (numaralar görünenlere verilir)');
  assert.deepEqual(gorunenRay('is', false), gorunenRay('is'));
  assert.deepEqual(gorunenRay('gelistirici', false), [...RAY_SIRASI]);
  const o = { durum: 'bosta', bekleyenIzin: 0, kuyruk: 0, arkaPlan: 0 } as const;
  assert.equal(ccCanliVar([]), false);
  assert.equal(ccCanliVar([o]), false, 'biten oturum canlı değil: bildirimi yeter');
  assert.equal(ccCanliVar([{ ...o, durum: 'kapandi' }, { ...o, durum: 'hata' }]), false);
  for (const durum of ['calisiyor', 'izin', 'sirada'] as const) assert.equal(ccCanliVar([o, { ...o, durum }]), true, durum);
  assert.equal(ccCanliVar([{ ...o, bekleyenIzin: 1 }]), true, 'bekleyen izin');
  assert.equal(ccCanliVar([{ ...o, kuyruk: 2 }]), true, 'kuyruktaki mesaj');
  assert.equal(ccCanliVar([{ ...o, arkaPlan: 1 }]), true, 'arka planda süren iş');
  // Kabuk: kokpite atan etki yalnız kip geçişinde bakar; canlıysa atmaz. Sayfa kipe değil bu kurala göre çizilir: izin kartındaki "Aç" boşa gitmez.
  const kabuk = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src/renderer/main.tsx'), 'utf8');
  assert.match(kabuk, /useEffect\(\(\) => \{ if \(mod === 'is' && sayfa === 'claude' && !ccCanliRef\.current\) setSayfa\('kokpit'\); \}, \[mod\]\);/);
  assert.match(kabuk, /\{sayfa === 'claude' && <ClaudeCode \/>\}/);
  assert.match(kabuk, /gorunenRay\(mod \?\? 'is', ccCanli \|\| sayfa === 'claude'\)/);
  assert.match(kabuk, /dinle\('claudecode:olay', \(z: CcOlayZarfi\) => \{ if \(z\.olay\.tur === 'durum'\) ccTazele\(\); \}\)/, 'oturum hâli değişince tazelenir (metin akışında değil)');
});

test('ray sırası tek kaynak: Geliştirici görünümü RAY_SIRASI\'nın kendisi; "beyin" yok', () => {
  assert.deepEqual(gorunenRay('gelistirici'), [...RAY_SIRASI]);
  assert.ok(!(RAY_SIRASI as readonly string[]).includes('beyin'));
});

const tus = (key: string, o: Partial<{ code: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; repeat: boolean; isComposing: boolean }> = {}) => ({ key, ctrlKey: true, ...o });

test('Ctrl+N yeni sohbet; yazı alanındayken de çalışır, büyük harf de sayılır', () => {
  assert.deepEqual(kisayolCoz(tus('n')), { tur: 'yeni-sohbet' });
  assert.deepEqual(kisayolCoz(tus('n'), { yaziyor: true }), { tur: 'yeni-sohbet' });
  assert.deepEqual(kisayolCoz(tus('N', { code: 'KeyN' })), { tur: 'yeni-sohbet' });
});

test('Ctrl+1…9 sayfa sırası (rakam tuşu ya da tuş kodu); yazı alanında çakışmaz', () => {
  assert.deepEqual(kisayolCoz(tus('1', { code: 'Digit1' })), { tur: 'sayfa', sira: 1 });
  assert.deepEqual(kisayolCoz(tus('!', { code: 'Digit7' })), { tur: 'sayfa', sira: 7 }, 'düzen farkı: tuş kodu esas');
  assert.deepEqual(kisayolCoz(tus('3')), { tur: 'sayfa', sira: 3 });
  assert.equal(kisayolCoz(tus('3', { code: 'Digit3' }), { yaziyor: true }), null);
  assert.equal(kisayolCoz(tus('0', { code: 'Digit0' })), null);
});

test('değiştirici kuralı: Shift/Alt (AltGr = Ctrl+Alt) ve basılı tutma yok sayılır; Windows\'ta Meta, Mac\'te Ctrl sayılmaz', () => {
  assert.equal(kisayolCoz(tus('n', { shiftKey: true })), null);
  assert.equal(kisayolCoz(tus('2', { altKey: true })), null, 'Türkçe klavyede AltGr birleşimleri sayfa değiştirmesin');
  assert.equal(kisayolCoz(tus('n', { repeat: true })), null);
  assert.equal(kisayolCoz({ key: 'n', metaKey: true }), null);
  assert.equal(kisayolCoz({ key: 'n' }), null);
  assert.deepEqual(kisayolCoz({ key: 'n', metaKey: true }, { mac: true }), { tur: 'yeni-sohbet' });
  assert.equal(kisayolCoz(tus('n'), { mac: true }), null);
});

// Düzeltme turu 1: Ctrl+Z son silmeyi geri alır (yazı alanında metnin kendi geri alması kalır); IME ile yazı oluştururken
// (isComposing) hiçbir kısayol çalışmaz.
test('Ctrl+Z son silmeyi geri alır (yazarken değil); IME bileşimi sürerken kısayol yok', () => {
  assert.deepEqual(kisayolCoz(tus('z', { code: 'KeyZ' })), { tur: 'geri-al' });
  assert.equal(kisayolCoz(tus('z'), { yaziyor: true }), null, 'yazı alanında metnin geri alması');
  assert.equal(kisayolCoz(tus('z', { shiftKey: true })), null, 'Ctrl+Shift+Z (yinele) değil');
  assert.deepEqual(kisayolCoz({ key: 'z', metaKey: true }, { mac: true }), { tur: 'geri-al' });
  assert.equal(kisayolCoz({ ...tus('n'), isComposing: true }), null);
  assert.equal(kisayolCoz({ ...tus('1', { code: 'Digit1' }), isComposing: true }), null);
});

test('numaralar GÖRÜNEN ray öğelerine (P1; 12 Kas Toplantı 4.): İş 5 Bağlantılar, 6 Etkinlik, 7 Ayarlar, 8 boş; Geliştirici 5 Claude Code, 7 Etkinlik, 8 Ayarlar', () => {
  const is = gorunenRay('is');
  const gel = gorunenRay('gelistirici');
  assert.equal(siradakiSayfa(is, 4), 'toplanti');
  assert.equal(siradakiSayfa(is, 5), 'baglantilar');
  assert.equal(siradakiSayfa(is, 6), 'etkinlik');
  assert.equal(siradakiSayfa(is, 7), 'ayarlar');
  assert.equal(siradakiSayfa(is, 8), undefined);
  assert.equal(siradakiSayfa(gel, 4), 'toplanti');
  assert.equal(siradakiSayfa(gel, 5), 'claude');
  assert.equal(siradakiSayfa(gel, 6), 'baglantilar');
  assert.equal(siradakiSayfa(gel, 7), 'etkinlik');
  assert.equal(siradakiSayfa(gel, 8), 'ayarlar');
  assert.equal(siradakiSayfa(gel, 0), undefined);
});

test('ipucu metni: Windows "Ctrl+1", Mac "⌘1"; yeni sohbet "Ctrl+N" / "⌘N"', () => {
  assert.equal(sayfaKisayolMetni(1), 'Ctrl+1');
  assert.equal(sayfaKisayolMetni(4, true), '⌘4');
  assert.equal(yeniSohbetKisayolu(), 'Ctrl+N');
  assert.equal(yeniSohbetKisayolu(true), '⌘N');
});

test('yazı alanı: metin girdileri, metin kutusu ve düzenlenebilir içerik; onay kutusu/düğme değil', () => {
  assert.equal(yaziAlaniMi({ tagName: 'TEXTAREA' }), true);
  assert.equal(yaziAlaniMi({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(yaziAlaniMi({ tagName: 'INPUT', type: 'search' }), true);
  assert.equal(yaziAlaniMi({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(yaziAlaniMi({ tagName: 'BUTTON' }), false);
  assert.equal(yaziAlaniMi({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(yaziAlaniMi(null), false);
});
