// H3c takip turu (yeniden inceleme 2, takip b): bulutta başlayan tur sürerken "Yalnız bu bilgisayar" seçildi — Gizli'deki koruma gibi süren
// adımın ZATEN üretilmiş araç çağrıları da çalışmaz (özellikle claude_code_gorev gibi buluta giden araçlar) ve tur yeni bir bulut çağrısı yapmadan
// "“Yalnız bu bilgisayar” seçildi; bu yanıt buluta gitmesin diye durdu." notuyla durur. GERÇEK ajan döngüsü (ajan/dongu.ts yanitla), motor bu
// bilgisayardaki sahte Fuber ağ geçidi (127.0.0.1; araçlar metin protokolüyle).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { anaSurecSahnesi, ipcKurBos } from './yardimci/ana-surec.ts';
import { sahteGecit, gecitAyari } from './yardimci/sahte-gecit.ts';

const gecit = await sahteGecit();
anaSurecSahnesi('yalniz-tur-ortasi', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.9.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false, motorCalisti: true,
  ...gecitAyari(gecit),
});
(globalThis as Record<string, unknown>).__sifreleme = true;
process.env.FUBER_DEMO = '1';
process.env.FUBER_TEST_TAM_EKRAN = '0';
process.env.FUBER_TEST_ANA_ONDE = '1';
delete process.env.FUBER_YEREL_TABAN; // yerel yanıt yolu yok: "Yalnız bu bilgisayar" seçilince yol 'yok'
await ipcKurBos();
const { sirYaz, ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const yerelFetch = (globalThis as Record<string, unknown>).__yerelFetch as typeof fetch;
globalThis.fetch = ((u: string, i?: RequestInit) => yerelFetch(u, i)) as typeof fetch;

const { aracKaydet } = await import('../src/main/ajan/araclar/kayit.ts');
const { yanitla } = await import('../src/main/ajan/dongu.ts');
const { mesajlar, sohbetOlustur } = await import('../src/main/sohbet.ts');
const { YALNIZ_YEREL_SECILDI_DURDU } = await import('../src/shared/abonelik.ts');

let calisti = 0;
aracKaydet({
  tanim: { ad: 'test_bulut_araci', aciklama: 'Sınama aracı (buluta giden bir aracın yerine).', sema: { type: 'object', properties: {} } },
  risk: 'serbest', grup: 'kokpit', etiket: () => 'Sınama aracı',
  calistir: async () => { calisti++; return { icerik: 'çalıştı' }; },
});

test('tur ortasında "Yalnız bu bilgisayar" seçildi: süren adımın araç çağrısı ÇALIŞMAZ, yeni bulut çağrısı yok, tur yalnızın notuyla durur', async () => {
  const sohbet = sohbetOlustur('Sınama', 'normal');
  let ac: () => void = () => undefined;
  gecit.bekle = new Promise<void>((c) => { ac = c; });
  gecit.yanitlar.push('<arac ad="test_bulut_araci">{}</arac>');
  const sayi = () => gecit.istekler.filter((x) => !/hafıza yazıcısısın|başlık ver|yoğun bir özet/.test(x.sistem)).length;
  const tur = yanitla(sohbet, { metin: 'Bir iş yap' });
  for (let i = 0; i < 100 && sayi() === 0; i++) await new Promise((c) => setTimeout(c, 30));
  assert.equal(sayi(), 1, 'tur bulutta başladı');
  // Kullanıcı tur sürerken Ayarlar → Nerede çalışsın → "Yalnız bu bilgisayar" seçti.
  ayarlariKaydet((a) => { a.yerel.yalnizYerel = true; });
  ac();
  gecit.bekle = null;
  await tur;
  try {
    assert.equal(calisti, 0, 'süren adımın aracı çalışmadı');
    assert.equal(sayi(), 1, 'tur yeni bir bulut çağrısı yapmadı');
    const kayit = JSON.stringify(mesajlar(sohbet));
    assert.ok(kayit.includes(YALNIZ_YEREL_SECILDI_DURDU), kayit.slice(-400));
  } finally { ayarlariKaydet((a) => { a.yerel.yalnizYerel = false; }); }
});
