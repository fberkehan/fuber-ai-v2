// Görev 26 (gerçek motorla uçtan uca): sohbet görünümünde ham mesajların yeri — iç talimat gizli, balonlar yalnız araç döngüsünde
// birleşir. Görünüm (main/sohbet.ts gorunume) Electron'a bağlı olduğundan kural saf işlevde (shared/sohbet-gorunum.ts) sınanır; gorunume'nin
// onu kullandığı kaynaktan denetlenir.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { gizliTetikMi, gorunumYerleri, turunMesajlari } from '../src/shared/sohbet-gorunum.ts';

const m = (rol: string, kaynak?: string | null, aracSonucu = false) => ({ rol, kaynak, aracSonucu });

test('kendiliğinden turun iç talimatı (not + proaktif) görünmez; öteki notlar (⚠, Durduruldu, motor geçişi) görünür', () => {
  assert.equal(gizliTetikMi({ rol: 'not', kaynak: 'proaktif' }), true);
  assert.equal(gizliTetikMi({ rol: 'not' }), false);
  assert.equal(gizliTetikMi({ rol: 'not', kaynak: null }), false);
  assert.equal(gizliTetikMi({ rol: 'assistant', kaynak: 'proaktif' }), false);
  assert.deepEqual(gorunumYerleri([m('not', 'proaktif'), m('assistant')]), ['atla', 'yeni']);
  assert.deepEqual(gorunumYerleri([m('not', null), m('assistant')]), ['yeni', 'yeni']);
});

test('araç döngüsü (asistan → araç sonucu → asistan) tek balon; araç sonucu kartına birleşir', () => {
  assert.deepEqual(gorunumYerleri([m('user', 'kullanici'), m('assistant'), m('user', 'arac', true), m('assistant'), m('user', 'arac', true), m('assistant')]),
    ['yeni', 'yeni', 'atla', 'devam', 'atla', 'devam']);
});

test('ayrı olaylar önceki Fuber balonuna EKLENMEZ: Claude Code özeti, eşlikçi, rapor/sabah özeti, kendiliğinden tur', () => {
  // Eskiden ardışık her asistan mesajı birleşiyordu: Claude Code'un iş bitti özeti önceki yanıtın balonunda (onun saatiyle) kayboluyordu.
  assert.deepEqual(gorunumYerleri([m('user', 'kullanici'), m('assistant'), m('assistant', 'claudecode')]), ['yeni', 'yeni', 'yeni']);
  assert.deepEqual(gorunumYerleri([m('assistant'), m('assistant', 'eslikci'), m('assistant', 'proaktif')]), ['yeni', 'yeni', 'yeni']);
  // İç talimat gizlenince kendiliğinden turun yanıtı dünkü son yanıta yapışmaz; o turun kendi araç döngüsü yine tek balon.
  assert.deepEqual(gorunumYerleri([m('user', 'kullanici'), m('assistant'), m('not', 'proaktif'), m('assistant'), m('user', 'arac', true), m('assistant')]),
    ['yeni', 'yeni', 'atla', 'yeni', 'atla', 'devam']);
  // Eşlikçi araç döngüsünün ortasına düşerse döngünün devamı eşlikçinin balonuna yapışmaz.
  assert.deepEqual(gorunumYerleri([m('assistant'), m('assistant', 'eslikci'), m('user', 'arac', true), m('assistant')]), ['yeni', 'yeni', 'atla', 'yeni']);
});

// Son inceleme (G26 küçüğü): pause_turn devamı (asistan → asistan, arada araç sonucu yok; ajan/dongu.ts `durma === 'duraklat'`) tek balon.
test('pause_turn devamı (aynı turda ardışık iki Fuber mesajı) tek balon; tur arası kullanıcı mesajı ya da bağımsız mesaj birleşmeyi keser', () => {
  assert.deepEqual(gorunumYerleri([m('user', 'kullanici'), m('assistant'), m('assistant')]), ['yeni', 'yeni', 'devam']);
  // Duraklat → devam → araç → yanıt: hepsi tek balon.
  assert.deepEqual(gorunumYerleri([m('user', 'kullanici'), m('assistant'), m('assistant'), m('user', 'arac', true), m('assistant')]), ['yeni', 'yeni', 'devam', 'atla', 'devam']);
  // Yeni tur (kullanıcı) ya da araya düşen ⚠/Durduruldu notu birleşmeyi keser.
  assert.deepEqual(gorunumYerleri([m('assistant'), m('user', 'kullanici'), m('assistant')]), ['yeni', 'yeni', 'yeni']);
  assert.deepEqual(gorunumYerleri([m('assistant'), m('not', null), m('assistant')]), ['yeni', 'yeni', 'yeni']);
});

// G26 küçüğü: turun balonu yalnız turun kendi kayıtlarından (dongu.ts turBaslangicId) — tur sürerken düşen eşlikçi/Claude Code mesajı
// "son asistan mesajı" sanılmaz.
test('turunMesajlari: tur sonu balonu yalnız turun kaydettiği mesajlardan; dongu.ts bunu kullanır', () => {
  const l = [{ id: 10, rol: 'user' }, { id: 11, rol: 'assistant' }, { id: 12, rol: 'assistant', kaynak: 'claudecode' }, { id: 13, rol: 'user' }, { id: 14, rol: 'assistant' }, { id: 15, rol: 'assistant', kaynak: 'eslikci' }];
  assert.deepEqual(turunMesajlari(l, [10, 11, 13, 14]).map((x) => x.id), [10, 11, 13, 14]);
  assert.deepEqual(turunMesajlari(l, []).map((x) => x.id), []);
  const d = fs.readFileSync(path.resolve(import.meta.dirname, '../src/main/ajan/dongu.ts'), 'utf8');
  assert.match(d, /const yeni = turunMesajlari\(mesajlar\(sohbetId, \{ sonrasi: turBaslangicId\[0\] - 1 \}\), turBaslangicId\);/);
});

test('gorunume bu kuralı kullanır (kaynak denetimi: birleşme yalnız "devam"da)', () => {
  const kaynak = fs.readFileSync(path.resolve(import.meta.dirname, '../src/main/sohbet.ts'), 'utf8');
  const govde = kaynak.slice(kaynak.indexOf('export function gorunume'), kaynak.indexOf('export function gorunenMesajlar'));
  assert.match(govde, /gorunumYerleri\(/);
  assert.match(govde, /if \(yerler\[i\] === 'atla'\) continue;/);
  assert.match(govde, /if \(yerler\[i\] === 'devam' && onceki && onceki\.rol === 'assistant' && m\.rol === 'assistant'\)/);
});
