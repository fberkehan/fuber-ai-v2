// 0.11 G12b (G11 incelemesi K4): sessiz saat kuralı TEK yerde. Açılış sesi (shared/acilis.ts sessizSaatteMi) ve proaktif motor
// (main/zamanlayici.ts sessizMi) aynı aralığa bakar ("23:00"–"08:00" gece yarısını aşar; bitiş dışarıda; başlangıç = bitiş sessiz sayılmaz);
// iki kopya kural zamanla ayrışırdı — sessizMi artık sessizSaatteMi'yi çağırır ve yalnız "Rahatsız etme"yi ekler. Birim: tests/acilis.test.ts.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';
import { sessizSaatteMi } from '../src/shared/acilis.ts';

anaSurecSahnesi('sessiz-saat', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false, sessizBaslangic: '23:00', sessizBitis: '08:00' }, baslangictaAc: false,
});
process.env.FUBER_DEMO = '1';
await esbuildHazir();
const { sessizMi } = await import('../src/main/zamanlayici.ts');
const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');

const an = (s: number, d: number) => new Date(2026, 9, 28, s, d);
const araliklar: [string, string][] = [['23:00', '08:00'], ['13:00', '15:00'], ['22:30', '07:15'], ['00:00', '00:00'], ['08:30', '08:30'], ['', '']];

test('zamanlayici.ts sessiz saat aralığını kendisi hesaplamaz: sessizSaatteMi çağrılır (tek kural)', () => {
  const kaynak = fs.readFileSync(path.resolve(import.meta.dirname, '../src/main/zamanlayici.ts'), 'utf8');
  assert.match(kaynak, /import \{[^}]*\bsessizSaatteMi\b[^}]*\} from '\.\.\/shared\/acilis\.js'/, 'sessizSaatteMi shared/acilis.ts’ten alınmıyor');
  assert.doesNotMatch(kaynak, /n >= a \|\| n < b/, 'aralık karşılaştırması zamanlayici.ts’te yinelenmiş (ikinci kopya kural)');
});

test('sessizMi, sessizSaatteMi ile gün boyunca (her dakika) ve her aralıkta birebir aynı; Rahatsız etme dışında ek kural yok', () => {
  for (const [b, s] of araliklar) {
    ayarlariKaydet((a) => { a.proaktif.sessizBaslangic = b; a.proaktif.sessizBitis = s; a.proaktif.rahatsizEtmeBitis = undefined; });
    const farklar: string[] = [];
    for (let dk = 0; dk < 1440; dk++) {
      const d = an(Math.floor(dk / 60), dk % 60);
      if (sessizMi(d) !== sessizSaatteMi(b, s, d)) farklar.push(`${b}–${s} ${String(Math.floor(dk / 60)).padStart(2, '0')}:${String(dk % 60).padStart(2, '0')}`);
    }
    assert.deepEqual(farklar.slice(0, 5), [], `${b}–${s}: ${farklar.length} dakikada ayrışıyor`);
  }
});

test('sessizMi bilinen anlar: gece yarısını aşan aralık, bitiş dışarıda, başlangıç = bitiş sessiz değil', () => {
  ayarlariKaydet((a) => { a.proaktif.sessizBaslangic = '23:00'; a.proaktif.sessizBitis = '08:00'; a.proaktif.rahatsizEtmeBitis = undefined; });
  assert.equal(sessizMi(an(23, 0)), true);
  assert.equal(sessizMi(an(1, 35)), true);
  assert.equal(sessizMi(an(7, 59)), true);
  assert.equal(sessizMi(an(8, 0)), false);
  assert.equal(sessizMi(an(14, 0)), false);
  ayarlariKaydet((a) => { a.proaktif.sessizBaslangic = '00:00'; a.proaktif.sessizBitis = '00:00'; });
  assert.equal(sessizMi(an(3, 0)), false);
});

test('Rahatsız etme sürerken sessizMi aralık dışında da true; bitince yalnız aralığa bakar', () => {
  ayarlariKaydet((a) => { a.proaktif.sessizBaslangic = '23:00'; a.proaktif.sessizBitis = '08:00'; a.proaktif.rahatsizEtmeBitis = '2100-01-01T00:00:00.000Z'; });
  assert.equal(sessizMi(an(14, 0)), true, 'rahatsız etme sürüyor');
  ayarlariKaydet((a) => { a.proaktif.rahatsizEtmeBitis = '2000-01-01T00:00:00.000Z'; });
  assert.equal(sessizMi(an(14, 0)), false, 'rahatsız etme bitti');
  assert.equal(sessizMi(an(2, 0)), true, 'aralık yine geçerli');
});
