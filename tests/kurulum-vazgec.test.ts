// Yeniden açılan kurulum sihirbazında "Vazgeç" (Görev 23 düzeltme 1, küçük 3): sihirbazın anında uyguladığı her ayar açılıştaki hâline
// döner — Gizli mod ve yerel beynin açık/kapalı durumu dahil (önceden dönmüyordu). Başlatılmış indirme sürer; sihirbazda açılan
// "indirme bitince Gizli modu aç" isteği geri alınır.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vazgecAnligi, vazgecGeriAlma } from '../src/shared/kurulum-vazgec.ts';

type Ornek = Parameters<typeof vazgecAnligi>[0];
const temel = (): Ornek => ({
  gorunum: { tema: 'koyu' }, mod: 'gelistirici', modeller: { ana: { saglayici: 'anthropic', model: 'x' } }, yetki: { dosya: true }, baslangictaAc: false,
  ses: { uyandirma: false, seslendirme: true, hiz: 1, kisayol: 'Ctrl+Shift+Space' },
  yerel: { etkin: false, gizliMod: false, model: 'bonsai2-4b' },
} as unknown as Ornek);

test('değişiklik yoksa geri alma yok', () => {
  const o = temel();
  assert.equal(vazgecAnligi(o), vazgecAnligi(structuredClone(o)));
  assert.equal(vazgecGeriAlma(o, structuredClone(o)), null);
});

test('Gizli mod sihirbazda açıldıysa Vazgeç kapatır; yerel beynin açık/kapalı durumu da döner, öteki yerel alanlar korunur', () => {
  const o = temel();
  const s = structuredClone(o);
  s.yerel = { ...s.yerel, gizliMod: true, etkin: true, model: 'bonsai2-27b' } as Ornek['yerel'];
  assert.notEqual(vazgecAnligi(o), vazgecAnligi(s), 'anlık Gizli modu ve etkinliği görür');
  const g = vazgecGeriAlma(o, s);
  assert.ok(g);
  assert.equal(g.ayar.yerel?.gizliMod, false);
  assert.equal(g.ayar.yerel?.etkin, false);
  assert.equal(g.ayar.yerel?.model, 'bonsai2-27b', 'model (indirme/kurulum) Vazgeç ile geri alınmaz');
  assert.equal(g.bekleyenGizliKapat, false);
});

test('0.12 H3c: Nerede adımında "Yalnız bu bilgisayar" seçildiyse Vazgeç açılıştakine döndürür (Gizli değil; tercih)', () => {
  const o = temel();
  const s = structuredClone(o);
  s.yerel = { ...s.yerel, yalnizYerel: true } as Ornek['yerel'];
  assert.notEqual(vazgecAnligi(o), vazgecAnligi(s), 'anlık "Yalnız bu bilgisayar"ı görür');
  const g = vazgecGeriAlma(o, s);
  assert.equal(g?.ayar.yerel?.yalnizYerel, false);
  assert.equal(g?.ayar.yerel?.gizliMod, false);
});

test('ses: kısayol gibi sihirbazın dokunmadığı alanlar şimdiki değerden; hız açılıştakine döner', () => {
  const o = temel();
  const s = structuredClone(o);
  s.ses = { ...s.ses, hiz: 1.1, kisayol: 'Ctrl+Alt+F' } as Ornek['ses'];
  const g = vazgecGeriAlma(o, s);
  assert.equal(g?.ayar.ses?.hiz, 1);
  assert.equal(g?.ayar.ses?.kisayol, 'Ctrl+Alt+F');
  assert.equal('baslangictaAc' in (g?.ayar ?? {}), false, 'Windows açılışı değişmediyse yazılmaz');
});

test('indirme bitince Gizli modu açma isteği sihirbazda verildiyse geri alınır (kapatılır)', () => {
  const o = temel();
  const s = structuredClone(o);
  s.yerel = { ...s.yerel, bekleyenKurulum: { model: 'bonsai2-27b', gizliMod: true } } as Ornek['yerel'];
  const g = vazgecGeriAlma(o, s);
  assert.ok(g, 'bekleyen Gizli mod isteği de bir değişikliktir');
  assert.equal(g.bekleyenGizliKapat, true);
});
