// 0.11 G7: kokpit sohbet seçicisinin ana süreçteki dayanakları (gerçek main/sohbet.ts + main/ayarlar.ts, geçici FUBER_VERI, ağ yok):
//  · `sohbet:liste` arşivdeki sohbeti vermez → açılır listenin "son 8"inde arşivli sohbet hiç görünmez, ana her zaman ilk;
//  · ana sohbetteki okunmamış sayısı listede gelir (çipin "Ana sohbette N yeni mesaj" sayısı) ve okundu işaretlenince sıfırlanır;
//  · son seçim ayarda `kokpit.sonSohbet` olarak kalır; diğer ayarlara dokunmaz, yeniden okunur, silinmiş sohbet seçimi ana'ya döner.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';

anaSurecSahnesi('kokpit-sohbet', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Deniz', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false }, baslangictaAc: false,
});
process.env.FUBER_DEMO = '1';
await esbuildHazir();
const { anaSohbet, sohbetOlustur, sohbetArsivle, mesajEkle, okunduIsaretle, sohbetListesi } = await import('../src/main/sohbet.ts');
const { ayarlar, ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const { acilirListe, kokpitSohbeti } = await import('../src/shared/kokpit-sohbet.ts');

const metin = (m: string) => [{ tur: 'metin' as const, metin: m }];

test('G7: arşivdeki sohbet açılır listeye girmez; ana ilk, son sohbetler en çok 8 ve en yeni önce', async () => {
  const ana = anaSohbet();
  const idler: number[] = [];
  for (let i = 1; i <= 10; i++) {
    const id = sohbetOlustur(`Konu ${i}`);
    mesajEkle(id, { rol: 'user', bloklar: metin(`Merhaba ${id}`), kaynak: 'kullanici' });
    idler.push(id);
    await new Promise((c) => setTimeout(c, 4)); // güncelleme zamanları ayrışsın (milisaniye)
  }
  const arsivli = idler[9]; // en yeni olan arşivlenir
  sohbetArsivle(arsivli);
  const a = acilirListe(sohbetListesi(), ana);
  assert.equal(a.ana?.id, ana, 'ana her zaman ilk');
  assert.equal(a.ana?.tur, 'ana');
  assert.ok(!a.son.some((s) => s.id === arsivli), 'arşivli sohbet görünmemeli');
  assert.equal(a.son.length, 8);
  assert.deepEqual(a.son.map((s) => s.id), [...idler.slice(0, 9)].reverse().slice(0, 8), 'en yeni önce, arşivli atlanır');
});

test('G7: ana sohbetin okunmamış sayısı listede gelir (çipin sayısı) ve okundu işaretleyince sıfırlanır', () => {
  const ana = anaSohbet();
  const sayi = () => sohbetListesi().find((s) => s.id === ana)?.okunmamis ?? -1;
  okunduIsaretle(ana);
  assert.equal(sayi(), 0);
  mesajEkle(ana, { rol: 'assistant', bloklar: metin('Günaydın Deniz!'), kaynak: 'proaktif', okunmamis: true });
  mesajEkle(ana, { rol: 'assistant', bloklar: metin('Bir hatırlatıcın var.'), kaynak: 'proaktif', okunmamis: true });
  assert.equal(sayi(), 2);
  const liste = sohbetListesi();
  // Okunmamış ana varken açılışta ana seçilir (başka bir sohbet son seçilmiş olsa da).
  const baska = liste.find((s) => s.tur !== 'ana')!.id;
  assert.equal(kokpitSohbeti({ anaId: ana, sonSecilen: baska, anaOkunmamis: sayi(), liste }), ana);
  okunduIsaretle(ana);
  assert.equal(sayi(), 0);
  assert.equal(kokpitSohbeti({ anaId: ana, sonSecilen: baska, anaOkunmamis: sayi(), liste: sohbetListesi() }), baska);
});

test('G7: son seçim ayarda kokpit.sonSohbet olarak kalır; öteki ayarlara dokunmaz, silinmiş sohbet ana\'ya döner', () => {
  const ana = anaSohbet();
  assert.equal(ayarlar().kokpit?.sonSohbet ?? null, null, 'ilk açılışta seçim yok');
  const x = sohbetOlustur('Seçilecek');
  const hitapOnce = ayarlar().hitap;
  // 0.12 H3a: yeni profilin teması Otomatik ('sistem'); seçim kaydı temaya dokunmaz.
  const temaOnce = ayarlar().gorunum.tema;
  assert.equal(temaOnce, 'sistem');
  ayarlariKaydet({ kokpit: { sonSohbet: x } });
  assert.equal(ayarlar().kokpit?.sonSohbet, x);
  assert.equal(ayarlar().hitap, hitapOnce);
  assert.equal(ayarlar().gorunum.tema, temaOnce);
  assert.equal(kokpitSohbeti({ anaId: ana, sonSecilen: ayarlar().kokpit?.sonSohbet ?? null, anaOkunmamis: 0, liste: sohbetListesi() }), x);
  // Seçilen sohbet arşivlenince (sohbet:liste vermez) panel ana'ya döner.
  sohbetArsivle(x);
  assert.equal(kokpitSohbeti({ anaId: ana, sonSecilen: ayarlar().kokpit?.sonSohbet ?? null, anaOkunmamis: 0, liste: sohbetListesi() }), ana);
  // Ana sohbet seçimi (ya da temizlenmiş seçim) de saklanabilir.
  ayarlariKaydet({ kokpit: { sonSohbet: null } });
  assert.equal(ayarlar().kokpit?.sonSohbet, null);
});
