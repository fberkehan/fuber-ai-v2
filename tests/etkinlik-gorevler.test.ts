// 11 Kas tasarımcı analizi, bulgu 1 (Kritik): Etkinlik sayfası iki görev sürerken "Hazır · Sessiz; Fuber hazır bekliyor" ve "Henüz bir şey
// olmadı" diyordu; kokpitin Görevler kartı aynı anda iki görevi "Durdur" düğmesiyle gösteriyordu. Kök neden: shared/beyin.ts durumOzeti yalnız
// çalışan bölgeleri sayıyordu, arka plan görevlerini (isler) hiç görmüyordu. Artık "Şu an" kartı kokpitle AYNI kaynaktan (isler-gorunum.ts
// gorevKartiOgeleri → suren) beslenen görev sayısını alır; Akış boşken de görev sürüyorsa "Henüz bir şey olmadı" denmez.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { durumOzeti } from '../src/shared/beyin.ts';
import { akisBosMetni } from '../src/shared/etkinlik.ts';
import { gorevKartiOgeleri, gorevSayaci } from '../src/shared/isler-gorunum.ts';
import { isPlaniDogrula, type IsOzet } from '../src/shared/isler.ts';

const SIMDI = new Date(2026, 10, 11, 12, 0, 0);
const plan = () => {
  const r = isPlaniDogrula({ gozcu: { tur: 'whatsapp', hedef: 'Ece' }, aralik: { min: 30, max: 120 }, bitis: { tur: 'sure', saniye: 3600 }, izinler: [], azamiAdim: 60 }, SIMDI);
  assert.ok('plan' in r);
  return r.plan;
};
const is = (ek: Partial<IsOzet>): IsOzet => ({
  id: 1, baslik: 'Ece’nin yanıtını bekle', amac: 'x', durum: 'suruyor', plan: plan(), baslangic: new Date(SIMDI.getTime() - 3600_000).toISOString(),
  bitisZamani: new Date(SIMDI.getTime() + 3600_000).toISOString(), sonraki: null, sonKontrol: null, adim: 0, kontrol: 0, sonOzet: null, sonuc: null,
  durmaNedeni: null, sohbetId: 9, ...ek,
});

test('görev sayacı kokpitin Görevler kartıyla aynı kaynaktan: süren görevler ve adımı süren görevler', () => {
  const liste = [
    is({ id: 1 }),
    is({ id: 2, adimda: true }),
    is({ id: 3, durum: 'bitti', bitisZamani: new Date(SIMDI.getTime() - 60_000).toISOString() }),
    is({ id: 4, durum: 'durdu', durmaNedeni: 'kullanici', bitisZamani: new Date(SIMDI.getTime() - 60_000).toISOString() }),
  ];
  const s = gorevSayaci(liste, SIMDI);
  assert.equal(s.suren, gorevKartiOgeleri(liste, SIMDI).suren.length, 'Etkinlik ve kokpit aynı sayıyı görür');
  assert.deepEqual(s, { suren: 2, adimda: 1 });
  assert.deepEqual(gorevSayaci([], SIMDI), { suren: 0, adimda: 0 });
});

test('Şu an: görev sürerken "Hazır" denmez (bulgu 1)', () => {
  assert.deepEqual(durumOzeti('bos', [], false, { suren: 2, adimda: 0 }), { baslik: 'Görevleri takip ediyor', alt: '2 görev sürüyor; sıradaki kontrolü bekliyor.' });
  assert.deepEqual(durumOzeti('bos', [], false, { suren: 1, adimda: 1 }), { baslik: 'Görev üzerinde çalışıyor', alt: '1 görev sürüyor; şu an bir adım atıyor.' });
  assert.deepEqual(durumOzeti('bos', ['Günün notları'], false, { suren: 1, adimda: 0 }), { baslik: 'Görevleri takip ediyor', alt: '1 görev sürüyor; sıradaki kontrolü bekliyor. Günün notları çalışıyor.' });
  for (const g of [{ suren: 1, adimda: 0 }, { suren: 3, adimda: 2 }]) {
    const o = durumOzeti('bos', [], true, g);
    assert.notEqual(o.baslik, 'Hazır');
    assert.doesNotMatch(o.alt, /hazır bekliyor/);
  }
});

test('Şu an: düşünürken ya da konuşurken süren görev alt satırda söylenir; görev yokken eski metin aynen kalır', () => {
  assert.deepEqual(durumOzeti('dusunuyor', [], false, { suren: 2, adimda: 0 }), { baslik: 'Düşünüyor', alt: 'Yanıtı hazırlıyor · 2 görev sürüyor' });
  assert.deepEqual(durumOzeti('konusuyor', ['Ses'], false, { suren: 1, adimda: 1 }), { baslik: 'Konuşuyor', alt: 'Ses çalışıyor · 1 görev sürüyor' });
  assert.deepEqual(durumOzeti('bos', [], false, { suren: 0, adimda: 0 }), { baslik: 'Hazır', alt: 'Sessiz; Fuber hazır bekliyor.' });
  assert.deepEqual(durumOzeti('bos', []), { baslik: 'Hazır', alt: 'Sessiz; Fuber hazır bekliyor.' });
});

test('Akış boşken görev sürüyorsa "Henüz bir şey olmadı" denmez', () => {
  assert.match(akisBosMetni(0), /^Henüz bir şey olmadı/);
  assert.doesNotMatch(akisBosMetni(2), /Henüz bir şey olmadı/);
  assert.match(akisBosMetni(2), /2 görev/);
  assert.match(akisBosMetni(1), /1 görev/);
});
