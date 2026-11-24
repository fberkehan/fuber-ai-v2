// I6 (son inceleme): model doğru bir hafızayı sessizce silmişti. GERÇEK ana süreç modülleriyle (ipc.ts kuyruğu, hafiza/depo.ts, ajan
// araçları, kişilik) sınanır:
//  · bağlam satırları (çekirdek, tur bağlamı, hafiza_ara) kaydın kaynağını taşır: "(kurulum)", "(sen söyledin)", "(sohbetten)"…;
//  · hafiza_sil kullanıcıdan gelen kayıtta (kurulum, elle eklenen, ayarlardaki ad) ONAY ister; reddedilirse silinmez;
//  · modelin silmesi hemen uygulanmaz: geri alınabilir silme kuyruğunda "Fuber bir hafızayı sildi" tostu (ayrı grup); "Geri al" kaydı
//    korur, süre dolunca silinir;
//  · kişilik: "yanlış kaydı düzelt" yalnız kullanıcı kaynaklı olmayanlarla; araç/anlatım kuralı (I5) ve "Kod işleri" kapısı.
// Electron sahte, veri/ev geçici, ağ yok (tests/yardimci/ana-surec.ts).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anaSurecSahnesi, ipcKurBos, ipcIsleyicileri } from './yardimci/ana-surec.ts';
import { kaynakEtiketi, kullaniciKaynakliMi, hafizaKaynaklari } from '../src/shared/hafiza-kaynak.ts';

anaSurecSahnesi('hafiza-silme', { kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', hitap: 'Bey', mod: 'is', tanitimSurumu: '0.9.0', ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false });
await ipcKurBos();
const depo = await import('../src/main/hafiza/depo.ts');
const { temelAraclariKaydet } = await import('../src/main/ajan/araclar/temel.ts');
const { aracBul } = await import('../src/main/ajan/araclar/kayit.ts');
const { kisilikMetni } = await import('../src/main/ajan/kisilik.ts');
const { ARAC_ANLATIM_KURALI, HAFIZA_DUZELTME_KURALI } = await import('../src/main/ajan/anlatim-kurali.ts');
const { ayarlariKaydet } = await import('../src/main/ayarlar.ts');
const { claudeYoluSifirla } = await import('../src/main/claudecode/yurutucu.ts');
temelAraclariKaydet();
const cagir = (k: string, ...a: unknown[]) => { const f = ipcIsleyicileri().get(k); assert.ok(f, `${k} yok`); return f(undefined, ...a); };

test('kaynak etiketi: kullanıcıdan gelen kaynak önce; birleşik kaynakta kullanıcı parçası kaydı korur', () => {
  assert.equal(kaynakEtiketi('kurulum'), 'kurulum');
  assert.equal(kaynakEtiketi('kullanici'), 'sen söyledin');
  assert.equal(kaynakEtiketi('ayarlar'), 'ayarlardan');
  assert.equal(kaynakEtiketi('sohbet:3/mesaj:41'), 'sohbetten');
  assert.equal(kaynakEtiketi('dosya:D-4'), 'belgeden');
  assert.equal(kaynakEtiketi('gunkaydi:2026-10-24'), 'gün kaydından');
  assert.equal(kaynakEtiketi(''), 'eski kayıt');
  assert.equal(kaynakEtiketi('sohbet:3, kurulum'), 'kurulum', 'sonradan güncellenmiş kurulum kaydı');
  assert.deepEqual(hafizaKaynaklari('sohbet:3, kullanici'), ['sohbet', 'kullanici']);
  for (const k of ['kurulum', 'kullanici', 'ayarlar', 'sohbet:9, kurulum']) assert.equal(kullaniciKaynakliMi(k), true, k);
  for (const k of ['sohbet:3', 'dosya:D-1', 'gunkaydi:x', '', undefined]) assert.equal(kullaniciKaynakliMi(k), false, String(k));
});

test('bağlam satırları kaynağı taşır: çekirdek hafıza, tur bağlamı ve hafiza_ara', async () => {
  depo.hafizaEkle({ tur: 'kullanici', baslik: 'Kendini anlatışı (kurulum)', icerik: 'Deniz bir kafe zinciri yönetiyor.', sabit: true, onem: 5, kaynak: 'kurulum' });
  depo.hafizaEkle({ tur: 'tercih', baslik: 'Kahve tercihi', icerik: 'Deniz sütsüz filtre kahve içer.', onem: 4, kaynak: 'kullanici' });
  depo.hafizaEkle({ tur: 'proje', baslik: 'Mavi Kuş kahve uygulaması', icerik: 'Mavi Kuş kahve sipariş uygulaması Kasımda çıkıyor.', onem: 4, kaynak: 'sohbet:2/mesaj:7' });
  assert.match(depo.cekirdekMetni(), /\[H-\d+\] \(kullanici; kurulum\) Kendini anlatışı/);
  const b = depo.turBaglami('kahve', 1, 1800).metin;
  assert.match(b, /\(tercih; sen söyledin\) Kahve tercihi/);
  assert.match(b, /\(proje; sohbetten\) Mavi Kuş/);
  const r = await aracBul('hafiza_ara')!.calistir({ sorgu: 'kahve' }, { sohbetId: 1, sinyal: new AbortController().signal, gorevIzinleri: new Set(), onay: async () => 'reddet' });
  assert.match(r.icerik, /\(tercih; sen söyledin\) Kahve tercihi/);
  assert.match(r.icerik, /\(proje; sohbetten\) Mavi Kuş/);
});

const bul = (baslik: string) => depo.hafizaListesi({ limit: 200 }).find((h) => h.baslik === baslik);
const baglam = (karar: 'bir_kez' | 'reddet', istekler: { baslik: string; onizleme?: string }[]) => ({
  sohbetId: 1, sinyal: new AbortController().signal, gorevIzinleri: new Set<string>(),
  onay: async (i: { baslik: string; onizleme?: string }) => { istekler.push(i); return karar; },
});
type Durum = { bekleyen: { anahtar: string; etiket: string; grup?: string }[] };

test('hafiza_sil: kullanıcıdan gelen kayıt ONAY ister; reddedilirse silinmez ve kuyruğa girmez', async () => {
  const h = bul('Kahve tercihi')!;
  const istekler: { baslik: string; onizleme?: string }[] = [];
  const r = await aracBul('hafiza_sil')!.calistir({ id: h.id }, baglam('reddet', istekler));
  assert.equal(istekler.length, 1, 'onay sorulmadı');
  assert.match(istekler[0].baslik, /silinsin mi/);
  assert.match(istekler[0].onizleme ?? '', /sütsüz filtre/);
  assert.equal(r.hata, true);
  assert.match(r.icerik, /reddedildi/, 'kart "onay verilmedi" olur (dongu.ts reddedildi kalıbı)');
  assert.ok(depo.hafizaGetir(h.id), 'kayıt silindi');
  assert.equal(((await cagir('silme:durum')) as Durum).bekleyen.length, 0);
});

test('hafiza_sil: modelin silmesi "Fuber bir hafızayı sildi" geri al tostuna girer; Geri al kaydı korur', async () => {
  const h = bul('Mavi Kuş kahve uygulaması')!;
  const istekler: { baslik: string }[] = [];
  const r = await aracBul('hafiza_sil')!.calistir({ id: h.id }, baglam('bir_kez', istekler));
  assert.equal(istekler.length, 0, 'sohbetten çıkarılmış kayıtta onay sorulmaz');
  assert.equal(r.hata, undefined);
  const d = (await cagir('silme:durum')) as Durum;
  assert.equal(d.bekleyen.length, 1);
  assert.equal(d.bekleyen[0].anahtar, `hafiza:${h.id}`);
  assert.equal(d.bekleyen[0].grup, 'hafiza-fuber', 'Fuber\'in silmesi kendi tostunda');
  assert.equal(d.bekleyen[0].etiket, 'Fuber bir hafızayı sildi: “Mavi Kuş kahve uygulaması”');
  assert.ok(depo.hafizaGetir(h.id), 'süre dolmadan uygulanmaz');
  assert.equal(await cagir('silme:geri-al', `hafiza:${h.id}`), true);
  assert.ok(depo.hafizaGetir(h.id), 'Geri al sonrası kayıt yerinde');
  assert.equal(((await cagir('silme:durum')) as Durum).bekleyen.length, 0);
});

test('hafiza_sil: onaylanan kullanıcı kaydı da kuyruktan geçer; süre dolunca gerçekten silinir', async () => {
  const h = bul('Kahve tercihi')!;
  await aracBul('hafiza_sil')!.calistir({ id: h.id }, baglam('bir_kez', []));
  assert.equal(((await cagir('silme:durum')) as Durum).bekleyen[0]?.anahtar, `hafiza:${h.id}`);
  await new Promise((c) => setTimeout(c, 5400)); // GERI_AL_MS = 5000
  assert.equal(depo.hafizaGetir(h.id), null, 'süre dolunca silindi');
});

// ── Düzeltme turu 2 ──
test('kaynak birleştirme: 400 karakteri aşan güncellemelerde baştaki "kurulum"/"kullanici" etiketi KESİLMEZ (eskiden .slice(-400))', () => {
  const h = depo.hafizaEkle({ tur: 'kullanici', baslik: 'Kurulumda anlattığı iş', icerik: 'Deniz üç şube yönetiyor.', onem: 5, kaynak: 'kurulum' });
  for (let i = 1; i <= 60; i++) depo.hafizaGuncelle(h.id, { kaynak: `sohbet:${1000 + i}/mesaj:${50000 + i}` });
  const son = depo.hafizaGetir(h.id)!;
  assert.ok(son.kaynak.length <= 400, `${son.kaynak.length} karakter`);
  assert.ok(son.kaynak.startsWith('kurulum, '), son.kaynak.slice(0, 60));
  assert.equal(kullaniciKaynakliMi(son.kaynak), true, 'kayıt hâlâ kullanıcıdan');
  assert.match(son.kaynak, /sohbet:1060\/mesaj:50060$/, 'en yeni parça kalır, en eskiler düşer');
  assert.doesNotMatch(son.kaynak, /sohbet:1001\//);
  // Aynı parça yeniden eklenmez.
  depo.hafizaGuncelle(h.id, { kaynak: 'sohbet:1060/mesaj:50060' });
  assert.equal(depo.hafizaGetir(h.id)!.kaynak, son.kaynak);
});

test('hafiza_guncelle: kullanıcıdan gelen kayıt ONAY ister (hafiza_sil ile tutarlı); reddedilirse değişmez, onaylanırsa değişir', async () => {
  const h = depo.hafizaEkle({ tur: 'tercih', baslik: 'Toplantı saati', icerik: 'Deniz toplantıları sabah 10\'da sever.', onem: 4, kaynak: 'kullanici' });
  const istekler: { baslik: string; onizleme?: string }[] = [];
  const r = await aracBul('hafiza_guncelle')!.calistir({ id: h.id, icerik: 'Deniz toplantıları öğleden sonra sever.' }, baglam('reddet', istekler));
  assert.equal(istekler.length, 1, 'onay sorulmadı');
  assert.match(istekler[0].baslik, /değişsin mi/);
  assert.match(istekler[0].onizleme ?? '', /sabah 10[\s\S]*öğleden sonra/);
  assert.equal(r.hata, true);
  assert.match(r.icerik, /reddedildi/);
  assert.equal(depo.hafizaGetir(h.id)!.icerik, 'Deniz toplantıları sabah 10\'da sever.');
  await aracBul('hafiza_guncelle')!.calistir({ id: h.id, icerik: 'Deniz toplantıları öğleden sonra sever.' }, baglam('bir_kez', []));
  assert.equal(depo.hafizaGetir(h.id)!.icerik, 'Deniz toplantıları öğleden sonra sever.');
  // Sohbetten çıkarılmış kayıt onaysız güncellenir.
  const s = depo.hafizaEkle({ tur: 'proje', baslik: 'Sunum', icerik: 'Sunum cuma.', onem: 3, kaynak: 'sohbet:4' });
  const ist2: { baslik: string }[] = [];
  await aracBul('hafiza_guncelle')!.calistir({ id: s.id, icerik: 'Sunum perşembe.' }, baglam('reddet', ist2));
  assert.equal(ist2.length, 0);
  assert.equal(depo.hafizaGetir(s.id)!.icerik, 'Sunum perşembe.');
});

test('hafiza_sil: telefondan ya da kendiliğinden (proaktif) başlayan turda sohbetten gelen kayıt da ONAYLA silinir (Geri al tostu görülmeyebilir)', async () => {
  for (const tur of [{ uzak: true }, { proaktif: true }]) {
    const h = depo.hafizaEkle({ tur: 'bilgi', baslik: `Uzak silme ${Object.keys(tur)[0]}`, icerik: 'Sohbetten çıkarılmış bir bilgi.', onem: 2, kaynak: 'sohbet:8' });
    const istekler: { baslik: string; aciklama?: string }[] = [];
    const r = await aracBul('hafiza_sil')!.calistir({ id: h.id }, { ...baglam('reddet', istekler), ...tur });
    assert.equal(istekler.length, 1, `${Object.keys(tur)[0]}: onay sorulmadı`);
    assert.match(istekler[0].aciklama ?? '', tur.uzak ? /Telefondan/ : /Kendiliğinden/);
    assert.equal(r.hata, true);
    assert.ok(depo.hafizaGetir(h.id), 'reddedildi: kayıt yerinde');
    assert.equal(((await cagir('silme:durum')) as Durum).bekleyen.length, 0, 'kuyruğa da girmez');
    // Onaylanırsa masaüstünün geri al kuyruğuna girer (yine "Geri al" var).
    await aracBul('hafiza_sil')!.calistir({ id: h.id }, { ...baglam('bir_kez', []), ...tur });
    assert.equal(((await cagir('silme:durum')) as Durum).bekleyen[0]?.anahtar, `hafiza:${h.id}`);
    await cagir('silme:geri-al', `hafiza:${h.id}`);
  }
});

test('kişilik: araç anlatım kuralı (I5), hafıza düzeltme kuralı (I6) metinde; "Kod işleri" araçlarla aynı kapıdan', () => {
  const k = kisilikMetni();
  assert.ok(k.includes(ARAC_ANLATIM_KURALI), 'I5 kuralı kişilikte yok');
  assert.ok(k.includes(HAFIZA_DUZELTME_KURALI), 'I6 kuralı kişilikte yok');
  assert.doesNotMatch(k, /yanlış olan hafıza kaydını düzelt\./, 'eski davet');
  assert.match(HAFIZA_DUZELTME_KURALI, /"sen söyledin", "kurulum" ya da "ayarlardan" gelen kaydı kullanıcı açıkça istemeden değiştirme ve silme/);
  // İş modunda bölüm yok; Geliştirici + yönetici açık + kurulu (sahte yol) iken var; claude.exe yokken yok.
  assert.doesNotMatch(k, /KOD İŞLERİ/);
  process.env.FUBER_CLAUDE_KOMUT = JSON.stringify(['yok-asla-calismaz']); // claudeYolu() 'test' döner; hiçbir şey çalıştırılmaz
  ayarlariKaydet((a) => { a.mod = 'gelistirici'; a.claudeCode.etkin = true; });
  assert.match(kisilikMetni(), /# KOD İŞLERİ/);
  ayarlariKaydet((a) => { a.claudeCode.etkin = false; });
  assert.doesNotMatch(kisilikMetni(), /KOD İŞLERİ/, 'yönetici kapalı: araçlar yok, bölüm de yok');
  ayarlariKaydet((a) => { a.claudeCode.etkin = true; });
  delete process.env.FUBER_CLAUDE_KOMUT;
  claudeYoluSifirla(null); // claude.exe bulunamadı
  assert.doesNotMatch(kisilikMetni(), /KOD İŞLERİ/, 'claude.exe yok: bölüm yok');
  claudeYoluSifirla();
});
