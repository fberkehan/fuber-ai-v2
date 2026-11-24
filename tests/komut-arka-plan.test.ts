// Analiz 11 Kas (geliştirici bulgu 4): komut_calistir arka plan modu — dev sunucusu / izleyici 120 sn'de öldürülmez; "Çalışan süreçler"
// listesinde (surec:liste) canlı çıktı ve Durdur; her seferinde onay; uygulama kapanınca ağacıyla kapanır. Ön plan komutu 120 sn sınırını korur.
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { KOMUT_SURE_MS } from '../src/shared/komut-siniflama.ts';
import { anaSurecSahnesi, esbuildHazir } from './yardimci/ana-surec.ts';

const sahne = anaSurecSahnesi('komut-arka', {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', mod: 'gelistirici', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false },
  proaktif: { etkin: false }, baslangictaAc: false,
});
process.env.FUBER_DEMO = '1';
await esbuildHazir();
const { komutAraciniKaydet, komutuCalistir, ARKA_PLAN_METNI } = await import('../src/main/ajan/araclar/komut.ts');
const { aracBul } = await import('../src/main/ajan/araclar/kayit.ts');
const { surecListesi, surecCiktisi, surecDurdur, tumSurecleriDurdur, arkaPlandaBaslat, surecDinle } = await import('../src/main/ajan/surec-yoneticisi.ts');
komutAraciniKaydet();

const windows = process.platform === 'win32';
const calisma = path.join(sahne.klasor, 'calisma');
fs.mkdirSync(calisma, { recursive: true });
const yasiyor = (pid: number) => { try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };
async function bekle(kosul: () => boolean, ms = 15_000): Promise<boolean> {
  const son = Date.now() + ms;
  while (Date.now() < son) { if (kosul()) return true; await new Promise((c) => setTimeout(c, 100)); }
  return kosul();
}
after(() => { tumSurecleriDurdur(true); });

type Istek = { baslik: string; aciklama: string; onizleme?: string; tehlike: string };
async function cagir(ad: string, girdi: Record<string, unknown>, karar: 'bir_kez' | 'reddet' = 'bir_kez', uzak = false) {
  const sorular: Istek[] = [];
  const arac = aracBul(ad);
  assert.ok(arac, `${ad} kayıtlı değil`);
  const r = await arac.calistir({ ...(ad === 'komut_calistir' ? { klasor: calisma } : {}), ...girdi }, {
    sohbetId: 1, sinyal: new AbortController().signal, gorevIzinleri: new Set(), ...(uzak ? { uzak: true } : {}),
    onay: async (i: Istek) => { sorular.push(i); return karar; },
  } as never);
  return { r, sorular };
}
// Sonsuz izleyici: her 200 ms'de bir satır (gerçek dev sunucusu gibi kendisi bitmez).
const IZLEYICI = `node -e "let n=0; setInterval(() => console.log('tik ' + (++n)), 200)"`;

test('araç kaydı: komut_calistir arka_plan alır; surec_cikti ve surec_durdur aynı grupta (yalnız Developer mode)', () => {
  const s = aracBul('komut_calistir')!.tanim.sema as { properties: Record<string, { type: string }> };
  assert.equal(s.properties.arka_plan.type, 'boolean');
  assert.equal(aracBul('surec_cikti')!.grup, 'komut');
  assert.equal(aracBul('surec_durdur')!.grup, 'komut');
  assert.equal(KOMUT_SURE_MS, 120_000, 'ön plan sınırı değişmedi');
});

test('arka plan: serbest komut bile onay ister (kart arka planı söyler); reddedilince başlamaz', { skip: !windows && 'yalnız Windows' }, async () => {
  const once = surecListesi().length;
  const { r, sorular } = await cagir('komut_calistir', { komut: 'Get-ChildItem', arka_plan: true }, 'reddet');
  assert.equal(sorular.length, 1, 'serbest komut arka planda onay ister');
  assert.match(sorular[0].baslik, /arka planda/);
  assert.ok(sorular[0].aciklama.includes(ARKA_PLAN_METNI));
  assert.equal(r.hata, true);
  assert.equal(surecListesi().length, once, 'reddedilen komut listeye girmedi');
  // Proje kodu çalıştıran komut: kart proje kodunu da söyler (son incelemenin kuralı korunur).
  const p = await cagir('komut_calistir', { komut: 'npm run dev', arka_plan: true }, 'reddet');
  assert.match(p.sorular[0].aciklama, /projenin kodunu/);
});

test('arka plan: onaylı izleyici ön plan sınırından uzun yaşar, listede görünür, çıktısı okunur; surec_durdur ağacını kapatır', { skip: !windows && 'yalnız Windows' }, async () => {
  const yayin: unknown[] = [];
  surecDinle((l) => yayin.push(l));
  // Aynı izleyici ön planda kısa sınırla öldürülür…
  const on = await komutuCalistir(IZLEYICI, { klasor: calisma, sureMs: 1_200 });
  assert.equal(on.durum, 'zaman', 'ön plan komutu süre sınırında kapandı');
  // …arka planda yaşar.
  const { r, sorular } = await cagir('komut_calistir', { komut: IZLEYICI, arka_plan: true });
  assert.equal(sorular.length, 1);
  assert.equal(r.hata ?? false, false, r.icerik);
  const kimlik = /kimlik (s\d+)/.exec(r.icerik)?.[1];
  assert.ok(kimlik, r.icerik);
  assert.match(r.icerik, /tik \d/, 'ilk çıktı sonuçta');
  const s = surecListesi().find((x) => x.kimlik === kimlik)!;
  assert.equal(s.durum, 'calisiyor');
  assert.ok(s.pid && yasiyor(s.pid));
  await new Promise((c) => setTimeout(c, 2_000));
  assert.equal(surecListesi().find((x) => x.kimlik === kimlik)!.durum, 'calisiyor', 'ön plan sınırının (1,2 sn) ötesinde hâlâ çalışıyor');
  // 120 sn sınırı arka planda yok: zamanlayıcılar 130 sn ilerletilse de süreç kapatılmaz (yönetici süre zamanlayıcısı kurmaz).
  mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  try { mock.timers.tick(130_000); } finally { mock.timers.reset(); }
  assert.ok(yasiyor(s.pid!), '130 sn ilerletildi: arka plan süreci yaşıyor');
  const c = surecCiktisi(kimlik, 5)!;
  assert.ok(c.satirlar.length > 0 && c.satirlar.length <= 5 && c.satirlar.every((x) => /^tik \d+$/.test(x)), JSON.stringify(c.satirlar));
  const oku = await cagir('surec_cikti', { kimlik });
  assert.match(oku.r.icerik, /^Çalışıyor/);
  const liste = await cagir('surec_cikti', {});
  assert.match(liste.r.icerik, new RegExp(`${kimlik} · calisiyor`));
  assert.ok(yayin.length > 0, 'arayüze surec:degisti yayınlandı');
  const d = await cagir('surec_durdur', { kimlik });
  assert.equal(d.r.hata ?? false, false, d.r.icerik);
  assert.ok(await bekle(() => !yasiyor(s.pid!), 10_000), 'süreç ağacı kapandı');
  // İnceleme M1: süreç gerçekten çıkınca "durduruldu" (o ana dek "durduruluyor" ve sayılır).
  assert.ok(await bekle(() => surecListesi().find((x) => x.kimlik === kimlik)!.durum === 'durduruldu', 5_000), surecListesi().find((x) => x.kimlik === kimlik)!.durum);
  assert.equal(surecDurdur('yok').tamam, false);
});

test('uygulama kapanırken süren bütün arka plan süreçleri ağacıyla kapanır', { skip: !windows && 'yalnız Windows' }, async () => {
  const a = arkaPlandaBaslat({ komut: 'izleyici', klasor: calisma, exe: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: { ...process.env } as Record<string, string> });
  const b = arkaPlandaBaslat({ komut: 'izleyici 2', klasor: calisma, exe: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], env: { ...process.env } as Record<string, string> });
  assert.ok(a.kimlik && b.kimlik && a.pid && b.pid);
  assert.ok(yasiyor(a.pid!) && yasiyor(b.pid!));
  assert.ok(tumSurecleriDurdur() >= 2);
  assert.ok(await bekle(() => !yasiyor(a.pid!) && !yasiyor(b.pid!), 10_000), 'ikisi de kapandı');
});

test('inceleme I3: telefondan gelen turda arka plan komutu başlatılmaz — onay sorulmaz, masada başlat denir; ön plan komutu etkilenmez', { skip: !windows && 'yalnız Windows' }, async () => {
  const once = surecListesi().length;
  const { r, sorular } = await cagir('komut_calistir', { komut: IZLEYICI, arka_plan: true }, 'bir_kez', true);
  assert.equal(sorular.length, 0, 'onay kartı telefona gitmez');
  assert.equal(r.hata, true);
  assert.match(r.icerik, /bilgisayarın başında/);
  assert.equal(surecListesi().length, once, 'süreç başlamadı');
  const on = await cagir('komut_calistir', { komut: 'Get-ChildItem' }, 'bir_kez', true);
  assert.equal(on.r.hata ?? false, false, on.r.icerik);
});
