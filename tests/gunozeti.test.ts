// Kokpit üst bandının yedek odak cümlesi: planlayıcı odak yazmadıysa (ilk açılış, motor yok) veriden çıkan gerçek sayılar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunOzeti } from '../src/shared/gunozeti.ts';

const bos = { hatirlaticilar: [], gorevler: [], epostalar: [], whatsapp: [], dusunme: { meseleler: [] } };

test('hiçbir şey bekleme: sakin, yönlendiren cümle', () => {
  assert.equal(gunOzeti(bos), 'Bekleyen bir şey yok; Fuber’e sorarak ya da hatırlatıcı kurarak başlayabilirsin.');
});

test('yalnız gerçek bekleyenler sayılır: bildirilmiş hatırlatıcı, okunmuş e-posta, kapalı mesele sayılmaz', () => {
  const v = {
    hatirlaticilar: [{ durum: 'bekliyor' }, { durum: 'bekliyor' }, { durum: 'gonderildi' }],
    gorevler: [{}, {}, {}],
    epostalar: [{ okundu: false }, { okundu: true }, { okundu: false }],
    whatsapp: [{ okunmamis: 2 }, { okunmamis: 0 }, { okunmamis: 1 }],
    dusunme: { meseleler: [{ durum: 'acik' }, { durum: 'kapali' }] },
  };
  assert.equal(gunOzeti(v), 'Bekleyenler: 2 hatırlatıcı, 3 açık görev, 2 okunmamış e-posta, 3 okunmamış WhatsApp mesajı ve 1 takip edilecek iş.');
});

test('0.11 G5 düzeltme turu 1 (K3): açık sayısı kokpitin yapılacaklarından (tek kaynak) — kısaltılmış gorevler (12) değil, işaretliler sayılmaz', () => {
  const yapilacaklar = [...Array.from({ length: 20 }, () => ({ durum: 'acik' })), { durum: 'tamam' }, { durum: 'tamam' }];
  assert.equal(gunOzeti({ ...bos, gorevler: Array.from({ length: 12 }, () => ({})), yapilacaklar }), 'Bekleyenler: 20 açık görev.');
  assert.equal(gunOzeti({ ...bos, gorevler: [{}], yapilacaklar: [{ durum: 'tamam' }] }), 'Bekleyen bir şey yok; Fuber’e sorarak ya da hatırlatıcı kurarak başlayabilirsin.');
});

test('tek kalem ve iki kalem cümlesi; eksik alanlar (dusunme yok) çökertmez', () => {
  assert.equal(gunOzeti({ ...bos, gorevler: [{}] }), 'Bekleyenler: 1 açık görev.');
  assert.equal(gunOzeti({ ...bos, hatirlaticilar: [{ durum: 'bekliyor' }], epostalar: [{ okundu: false }] }), 'Bekleyenler: 1 hatırlatıcı ve 1 okunmamış e-posta.');
  assert.equal(gunOzeti({ hatirlaticilar: [], gorevler: [], epostalar: [], whatsapp: [] }), 'Bekleyen bir şey yok; Fuber’e sorarak ya da hatırlatıcı kurarak başlayabilirsin.');
});
