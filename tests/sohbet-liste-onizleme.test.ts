// G1 (F2, yol 1): sohbet listesinin önizlemesi (main/sohbet.ts sohbetListesi → Sohbetler.tsx, telefonda cep/Sohbet.tsx ve cep/Bugun.tsx)
// kendiliğinden turun iç talimatını (rol 'not' + kaynak 'proaktif') GÖSTERMEZ: proaktif tur başarısız ya da durdurulmuşsa (gizliTetik'te
// durdurma notu yazılmıyor, ajan/durdurma.ts) son kayıt iç talimattır — MERAK metni böyle göründü. Kural sohbet görünümüyle TEK
// kaynak (shared/sohbet-gorunum.ts gizliTetikMi); öteki notlar ("Durduruldu.", ⚠, Gizli geçişi) sohbette göründüğü gibi önizlemede de
// görünür. Gerçek main/sohbet.ts + geçici FUBER_VERI (node:sqlite), ağ yok.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';

anaSurecSahnesi('liste-onizleme', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false }, baslangictaAc: false,
});
process.env.FUBER_DEMO = '1';
await esbuildHazir();
const { anaSohbet, sohbetOlustur, mesajEkle, sohbetListesi, gorunenMesajlar } = await import('../src/main/sohbet.ts');
const { sohbetOzetleri } = await import('../src/main/kokpit/duzen.ts');
const { gizliTetikMi } = await import('../src/shared/sohbet-gorunum.ts');

const MERAK = 'MERAK SORUSU: Kullanıcıyı daha iyi tanımak istiyorsun. Çekirdek hafızaya ve son hafıza kayıtlarına bak (hafiza_ara gerekirse).';
const metin = (m: string) => [{ tur: 'metin' as const, metin: m }];
const onizleme = (id: number) => sohbetListesi().find((s) => s.id === id)?.sonMesaj;

test('son kayıt proaktif tetikse önizleme bir önceki görünür mesajdır (tetik metni değil)', () => {
  const ana = anaSohbet();
  mesajEkle(ana, { rol: 'user', bloklar: metin('Yarın toplantım var mı?'), kaynak: 'kullanici' });
  mesajEkle(ana, { rol: 'assistant', bloklar: metin('Evet, 10:00’da ekip toplantın var.') });
  mesajEkle(ana, { rol: 'not', bloklar: metin(MERAK), kaynak: 'proaktif' }); // başarısız/durdurulmuş proaktif tur: yalnız tetik kaldı
  assert.equal(onizleme(ana), 'Evet, 10:00’da ekip toplantın var.');
  // Art arda birden çok başarısız tur da sızdırmaz.
  mesajEkle(ana, { rol: 'not', bloklar: metin('SABAH ÖZETİ hazırla. Önce hatirlatici_listele (24 saat) ile bugüne bak.'), kaynak: 'proaktif' });
  mesajEkle(ana, { rol: 'not', bloklar: metin(MERAK), kaynak: 'proaktif' });
  assert.equal(onizleme(ana), 'Evet, 10:00’da ekip toplantın var.');
  // Sohbetin kendisiyle aynı kural: tetik görünümde de yok.
  assert.ok(!JSON.stringify(gorunenMesajlar(ana)).includes('MERAK SORUSU'));
});

test('sohbette yalnız tetik varsa önizleme boş (tetik metni değil)', () => {
  const id = sohbetOlustur('Yalnız tetik');
  mesajEkle(id, { rol: 'not', bloklar: metin('KURULUM BİTTİ: Kullanıcıyla ilk kez tanışıyorsun.'), kaynak: 'proaktif' });
  assert.equal(onizleme(id), undefined);
});

test('öteki notlar sohbette göründüğü gibi önizlemede de görünür ("Durduruldu.", ⚠); kokpit listesi de tetiği göstermez', () => {
  const id = sohbetOlustur('Notlar');
  mesajEkle(id, { rol: 'user', bloklar: metin('Uzun bir rapor yaz.'), kaynak: 'kullanici' });
  mesajEkle(id, { rol: 'not', bloklar: metin('Durduruldu.') });
  assert.equal(onizleme(id), 'Durduruldu.');
  mesajEkle(id, { rol: 'not', bloklar: metin('⚠ Bir sorun oldu.') });
  assert.equal(onizleme(id), '⚠ Bir sorun oldu.');
  const ana = anaSohbet();
  assert.equal(sohbetOzetleri().find((s) => s.id === ana)?.sonMesaj, 'Evet, 10:00’da ekip toplantın var.');
});

test('tek kaynak: önizleme gizliTetikMi’nin gizlediğini — ve yalnız onu — atlar', () => {
  const ornekler: { rol: 'user' | 'assistant' | 'not'; kaynak?: string }[] = [
    { rol: 'not', kaynak: 'proaktif' }, { rol: 'not' }, { rol: 'not', kaynak: 'kullanici' },
    { rol: 'assistant', kaynak: 'proaktif' }, { rol: 'assistant' }, { rol: 'user', kaynak: 'proaktif' }, { rol: 'user', kaynak: 'kullanici' },
  ];
  for (const o of ornekler) {
    const id = sohbetOlustur('Kural');
    mesajEkle(id, { rol: 'assistant', bloklar: metin('önceki') });
    mesajEkle(id, { rol: o.rol, bloklar: metin('son kayıt'), ...(o.kaynak ? { kaynak: o.kaynak } : {}) });
    assert.equal(onizleme(id), gizliTetikMi(o) ? 'önceki' : 'son kayıt', JSON.stringify(o));
  }
});

// G10 düzeltme turu 1 (K3): kokpitin "Geçmiş sohbetler" kartının verisi (sohbetOzetleri, main/kokpit/duzen.ts) görev sohbetlerini (tur 'gorev') ASLA içermez —
// en yeni olsalar ve LIMIT'i doldursalar da (adım mesajları sohbetin `guncelleme`sini sürekli öne alır); ana ve normal sohbetler aynen, `sohbet:liste`
// (Sohbetler sayfası) ise görev sohbetlerini tutar (orada "Görev · …" olarak ayırt edilir).
test('G10 (K3): sohbetOzetleri görev sohbetlerini içermez — LIMIT\'i de onlar doldurmaz; sohbetListesi (Sohbetler sayfası) tutar', () => {
  const normal = Array.from({ length: 3 }, (_, i) => sohbetOlustur(`Normal ${i + 1}`));
  const gorevler = Array.from({ length: 10 }, (_, i) => sohbetOlustur(`Görev · İş ${i + 1}`, 'gorev'));
  for (const id of gorevler) mesajEkle(id, { rol: 'assistant', bloklar: metin('Adım özeti'), kaynak: 'proaktif', okunmamis: true }); // en yeni: güncelleme şimdi
  const ozet = sohbetOzetleri(8);
  assert.equal(ozet.length, 8, 'LIMIT normal sohbetlerle dolar (görev sohbetleri yer kapmaz)');
  assert.ok(ozet.every((s) => s.tur !== 'gorev'), 'görev sohbeti kokpit kartında yok');
  const idler = sohbetOzetleri(100).map((s) => s.id);
  assert.ok(gorevler.every((id) => !idler.includes(id)), 'geniş listede de yok');
  assert.ok(normal.every((id) => idler.includes(id)), 'normal sohbetler aynen');
  assert.ok(idler.includes(anaSohbet()), 'ana sohbet aynen');
  const tum = sohbetListesi().map((s) => s.id);
  assert.ok(gorevler.every((id) => tum.includes(id)), 'Sohbetler sayfasının listesi görev sohbetlerini tutar');
});
