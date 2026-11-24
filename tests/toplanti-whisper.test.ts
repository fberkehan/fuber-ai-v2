// Toplantı: satır "…"de takılmaz, bulut → yerel geçişi her zaman çipte, yerel Whisper hataları gerçek nedenle söylenir, Ayrıntılar (tanı) alanı (14 Kas 2026, 0.18.2).
// Kök neden (paketli ortamda yeniden üretildi): v1.9.2 "cublas-11.8.0" arşivi cublas64_11.dll içermiyor → whisper-server sessizce işlemciye düşüyor, large-v3-turbo her istekte ~11 sn →
// tek yuvalı kuyrukta satırlar sonsuza dek "…" kalıyordu ve hiçbir hata yoktu. Burada sahte motorlarla: asılı istek, eksik model, hesapsız kullanıcı, kopan akış.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToplantiOturumu, type AkisFabrikasi, type AkisOlaylari, type CanliAkis, type ToplantiBagimliliklari } from '../src/main/toplanti/oturum.ts';
import { BULUT_NEDENI_METNI, SATIR_ZAMAN_ASIMI_MS, UYARI, bulutGecisMetni, type BulutNedeni, type Konusan, type ToplantiDurumu } from '../src/shared/toplanti.ts';
import { WhisperHatasi } from '../src/shared/whisper-tani.ts';

const blok = () => new Uint8Array(3200); // 100 ms @16 kHz PCM16

interface Ayar {
  hesap?: boolean; whisperHazir?: boolean; bulutNeden?: BulutNedeni | null; bulutsuz?: boolean; gelistirici?: boolean;
  whisperCevir?: (wav: Uint8Array, k: Konusan) => Promise<string | null>;
  hesapYaziya?: () => Promise<string | null>;
  akis?: AkisFabrikasi;
}
function kur(o: Ayar = {}) {
  const t = { now: 1_000_000 };
  const durumlar: ToplantiDurumu[] = [];
  const d: ToplantiBagimliliklari = {
    bulutsuz: () => o.bulutsuz ?? false,
    stt: {
      ...(o.hesap === false ? {} : { hesap: { kullanilir: () => o.hesap ?? false, yaziya: async () => (o.hesapYaziya ? o.hesapYaziya() : null) } }),
      whisper: {
        hazirMi: () => o.whisperHazir ?? true, cevir: async (wav, k) => (o.whisperCevir ? o.whisperCevir(wav, k) : 'merhaba dünya'),
        tani: () => ({ calisiyor: true, donanim: 'cpu', model: 'small-q5_1', derleme: 'cpu', gecikmeMs: 1800, sonHata: '' }),
      },
      ...(o.bulutNeden !== undefined ? { bulutNeden: () => o.bulutNeden! } : {}),
      ...(o.akis ? { akis: o.akis } : {}),
    },
    yz: async () => '[TR] x',
    degisti: (x) => durumlar.push(x),
    simdi: () => t.now,
    kapanisBeklemeMs: 200,
    onCeviri: false,
    gelistirici: () => o.gelistirici ?? true,
    etiketler: () => ({ yazi: o.gelistirici === false ? 'Bu bilgisayar' : 'Bu bilgisayar · Whisper', yz: 'Fuber' }),
  };
  const oturum = new ToplantiOturumu(d, { id: 't-20261114-100000-abcd', hedefDil: 'tr', robot: false });
  return { t, oturum, durumlar };
}
const ses = (oturum: ToplantiOturumu, k: Konusan, no: number, blokSayisi = 12) => { for (let i = 0; i < blokSayisi; i++) oturum.sesGeldi(k, no, blok(), i * 100); };

test('asılı yerel istek: satır "…"de sonsuza dek kalmaz; SATIR_ZAMAN_ASIMI_MS sonra "yazıya çevrilemedi" (hata), kesin, çipte neden', async () => {
  const { t, oturum } = kur({ whisperCevir: () => new Promise(() => undefined) }); // asla dönmeyen istek
  ses(oturum, 'karsi', 1);
  let s = oturum.anlik().satirlar[0];
  assert.equal(s.metin, '');
  assert.equal(s.kesin, false);
  t.now += SATIR_ZAMAN_ASIMI_MS - 1000;
  oturum.satirlariDenetle();
  assert.equal(oturum.anlik().satirlar[0].hata, undefined, 'süre dolmadan satır bırakılmaz');
  t.now += 1500;
  oturum.satirlariDenetle();
  const d = oturum.anlik();
  s = d.satirlar[0];
  assert.equal(s.hata, true);
  assert.equal(s.kesin, true, 'satır artık "…" değil, sonuçlandı');
  assert.equal(s.metin, '');
  assert.equal(s.ceviriDurum, 'yok');
  assert.ok(d.uyari && d.uyariSeviyesi === 'sorun', 'çip: ne oldu');
  assert.equal(d.tani?.basarisiz, 1);
  oturum.iptal();
});

test('zaman aşımı SONRA gelen ses satırı geri getirmez; yeni satır normal yazılır', async () => {
  const { t, oturum } = kur({ whisperCevir: async (_w, _k) => 'ikinci cümle' });
  // ilk satır: sessizce metinsiz kalan (akış yok, whisper hep boş döner)
  const { oturum: o2, t: t2 } = kur({ whisperCevir: () => new Promise(() => undefined) });
  ses(o2, 'karsi', 1);
  t2.now += SATIR_ZAMAN_ASIMI_MS + 1;
  o2.satirlariDenetle();
  ses(o2, 'karsi', 1, 3); // aynı satıra geç gelen ses yok sayılır
  assert.equal(o2.anlik().satirlar.filter((s) => s.id === 'karsi:1').length, 1);
  assert.equal(o2.anlik().satirlar[0].hata, true);
  o2.iptal();
  // normal yol: metin gelir, hata yok
  ses(oturum, 'karsi', 1);
  oturum.konusmaBitti('karsi', 1, 1200);
  await oturum.bosalinca();
  const s = oturum.anlik().satirlar[0];
  assert.equal(s.metin, 'ikinci cümle');
  assert.equal(s.hata, undefined);
  assert.equal(oturum.anlik().tani?.gelenMetin, 1);
  void t;
  oturum.iptal();
});

test('Whisper hata eşleme: eksik model → "Yerel ses modeli eksik" + İndir eylemi; satır silinmez, yazıya çevrilemedi olur', async () => {
  const { oturum } = kur({ whisperCevir: async () => { throw new WhisperHatasi('model-yok', 'model ya da çalıştırıcı yok'); } });
  ses(oturum, 'karsi', 1);
  oturum.konusmaBitti('karsi', 1, 1300);
  await oturum.bosalinca();
  const d = oturum.anlik();
  assert.match(d.uyari!, /Yerel ses tanıma eksik/);
  assert.equal(d.uyariEylemi, 'whisper-indir');
  assert.equal(d.satirlar.length, 1, 'satır sessizce silinmedi');
  assert.equal(d.satirlar[0].hata, true);
  assert.equal(d.satirlar[0].kesin, true);
  assert.match(d.tani!.sonHata, /model-yok/, 'Ayrıntılar son hatayı gösterir (Geliştirici)');
  oturum.iptal();
});

test('Whisper hataları: zaman aşımı, çökme, başlatılamadı, GPU yok — her biri kendi cümlesi', async () => {
  const beklenen: [ConstructorParameters<typeof WhisperHatasi>[0], RegExp, string | undefined][] = [
    ['zaman-asimi', /zamanında yanıt vermedi/, undefined],
    ['cokme', /beklenmedik biçimde kapandı/, undefined],
    ['baslamadi', /başlatılamadı/, 'whisper-indir'],
    ['gpu-yok', /Ekran kartı/, 'whisper-indir'],
  ];
  for (const [neden, re, eylem] of beklenen) {
    const { oturum } = kur({ whisperCevir: async () => { throw new WhisperHatasi(neden); } });
    ses(oturum, 'siz', 1);
    oturum.konusmaBitti('siz', 1, 1300);
    await oturum.bosalinca();
    const d = oturum.anlik();
    assert.match(d.uyari!, re, neden);
    assert.equal(d.uyariEylemi, eylem, neden);
    oturum.iptal();
  }
});

test('Whisper hatası geçince çip kalkar (geçici hata kalıcı çip bırakmaz)', async () => {
  let cagri = 0;
  const { oturum } = kur({ whisperCevir: async () => { if (++cagri === 1) throw new WhisperHatasi('zaman-asimi'); return 'tamam artık'; } });
  ses(oturum, 'karsi', 1);
  await oturum.bosalinca();
  assert.match(oturum.anlik().uyari ?? '', /zamanında yanıt vermedi/);
  oturum.konusmaBitti('karsi', 1, 1300);
  await oturum.bosalinca();
  const d = oturum.anlik();
  assert.equal(d.satirlar[0].metin, 'tamam artık');
  assert.equal(d.uyari, undefined, 'başarılı istekten sonra geçici çip kalkar');
  oturum.iptal();
});

test('geçiş çipi yok: kullanıcı yerel/Gizli seçtiyse (neden null) ya da bulut çalışıyorsa', () => {
  const a = kur({ bulutNeden: null });
  assert.equal(a.oturum.anlik().uyari, undefined, 'seçim hata değildir');
  a.oturum.iptal();
  const g = kur({ bulutsuz: true, bulutNeden: 'hesap-yok' });
  assert.equal(g.oturum.anlik().uyari, undefined, 'Gizli: bulut zaten hiç yok, çip yok');
  g.oturum.iptal();
  const h = kur({ hesap: true, bulutNeden: null });
  assert.equal(h.oturum.anlik().yol, 'hesap');
  assert.equal(h.oturum.anlik().uyari, undefined);
  h.oturum.iptal();
});

test('geçiş çipi başka çipin üstüne yazmaz: satır hatası/eksik model çipi korunur', async () => {
  const { oturum } = kur({ bulutNeden: 'hesap-yok', whisperCevir: async () => { throw new WhisperHatasi('model-yok'); } });
  ses(oturum, 'karsi', 1);
  oturum.konusmaBitti('karsi', 1, 1300);
  await oturum.bosalinca();
  assert.match(oturum.anlik().uyari!, /Yerel ses tanıma eksik/);
  assert.equal(oturum.anlik().uyariEylemi, 'whisper-indir');
  oturum.iptal();
});

// ── Canlı akış düşünce ──
function sahteAkis(): { fab: AkisFabrikasi; ev: Partial<Record<Konusan, AkisOlaylari>> } {
  const ev: Partial<Record<Konusan, AkisOlaylari>> = {};
  const fab: AkisFabrikasi = {
    kullanilir: () => true,
    ac: (k, o): CanliAkis => { ev[k] = o; let no = 0; let acik = false; return { baslat() {}, ses() { if (!acik) { acik = true; no++; } return no; }, commit() { if (!acik) return 0; acik = false; return no; }, kapat() {}, kapaliMi: false }; },
  };
  return { fab, ev };
}

test('canlı akış metin getirmezse (hiç kısmi yok) satır 20 sn sonra "yazıya çevrilemedi" olur — akışta da sonsuz "…" yok', () => {
  const { fab } = sahteAkis();
  const { t, oturum } = kur({ hesap: true, akis: fab });
  oturum.baslat();
  ses(oturum, 'karsi', 1);
  assert.equal(oturum.anlik().satirlar[0].kesin, false);
  t.now += SATIR_ZAMAN_ASIMI_MS + 1;
  oturum.satirlariDenetle();
  const s = oturum.anlik().satirlar[0];
  assert.equal(s.hata, true);
  assert.equal(s.kesin, true);
  oturum.iptal();
});

test('canlı akış düştü (belirteç alınamadı) ama toplu bulut sürüyor: sakin çip nedeniyle; Ayrıntılar "canlı akış kapalı"', () => {
  const { fab, ev } = sahteAkis();
  const { oturum } = kur({ hesap: true, akis: fab });
  oturum.baslat();
  ev.karsi!.dustu({ neden: 'belirtec', bekleyenler: [] });
  const d = oturum.anlik();
  assert.equal(d.yol, 'hesap');
  assert.match(d.uyari!, /^Canlı yazı kullanılamadı: canlı yazı için sunucudan izin alınamadı; yazı cümle bitince gelecek\.$/);
  assert.equal(d.uyariSeviyesi, 'bilgi');
  assert.match(d.tani!.baglanti, /karşı taraf düştü/);
  oturum.iptal();
});

test('akış düştü + toplu bulut da reddediyor (sunucuda model yok) + yerel kurulu: çip "Fuber bulutu kullanılamadı: Fuber sunucusunda …"', async () => {
  const { fab, ev } = sahteAkis();
  const { oturum } = kur({ hesap: true, akis: fab, hesapYaziya: async () => { const { SesModeliYok } = await import('../src/shared/masaustu-hesap.ts'); throw new SesModeliYok('stt'); } });
  oturum.baslat();
  ses(oturum, 'karsi', 1);
  ev.karsi!.dustu({ neden: 'belirtec', bekleyenler: [{ no: 1, pcm: new Uint8Array(32000), kesinlesmis: true }] });
  await oturum.bosalinca();
  const d = oturum.anlik();
  assert.equal(d.yol, 'whisper');
  assert.equal(d.uyari, bulutGecisMetni('sunucu-ses-yok'));
  oturum.iptal();
});

// ── Ayrıntılar (tanı) ──
test('Ayrıntılar: motor, bağlantı, son hata (arındırılmış), gelen parça ve metin sayıları; İş kipinde teknik ayrıntı yok', async () => {
  const gel = kur({ whisperCevir: async () => { throw new Error('C:\\Kullanicilar\\Ali\\AppData\\Roaming\\Fuber AI\\whisper\\model.bin açılamadı AIza' + 'SyDUMMYDUMMYDUMMYDUMMYDUMMYDUMMY12345'); } });
  ses(gel.oturum, 'karsi', 1, 12);
  await gel.oturum.bosalinca();
  const t = gel.oturum.anlik().tani!;
  assert.equal(t.motor, 'Bu bilgisayar · Whisper');
  assert.equal(t.gelenParca, 12);
  assert.ok(!/Ali|Roaming|AIzaSy/.test(t.sonHata), `yol ve anahtar maskeli: ${t.sonHata}`);
  assert.ok(t.sonHata.includes('<yol>') && t.sonHata.includes('<gizli>'));
  assert.match(t.baglanti, /yerel yazıya çevirme çalışıyor · işlemci/);
  assert.equal(t.yerel?.model, 'small-q5_1');
  gel.oturum.iptal();

  const is = kur({ gelistirici: false, whisperCevir: async () => { throw new WhisperHatasi('cokme', 'süreç kapandı'); } });
  ses(is.oturum, 'karsi', 1, 12);
  await is.oturum.bosalinca();
  const ti = is.oturum.anlik().tani!;
  assert.equal(ti.motor, 'Bu bilgisayar', 'İş kipinde Whisper adı yok');
  assert.equal(ti.yerel, undefined, 'model adı yalnız Geliştirici');
  assert.ok(!/Whisper|model/i.test(`${ti.sonHata} ${ti.baglanti} ${ti.motor}`));
  is.oturum.iptal();
});

test('metin gelince sayaçlar artar; satır tanıda metin dönen olarak sayılır', async () => {
  const { oturum } = kur({ whisperCevir: async () => 'hello there' });
  ses(oturum, 'karsi', 1);
  oturum.konusmaBitti('karsi', 1, 1300);
  await oturum.bosalinca();
  const t = oturum.anlik().tani!;
  assert.equal(t.gelenMetin, 1);
  assert.equal(t.basarisiz, 0);
  assert.equal(t.gelenParca, 12);
  oturum.iptal();
});

test('UYARI.satirYok: motor sorunu bilinmiyorsa genel cümle (sonsuz "…" yerine)', () => {
  const { t, oturum } = kur({ hesap: true, akis: sahteAkis().fab });
  oturum.baslat();
  ses(oturum, 'siz', 1);
  t.now += SATIR_ZAMAN_ASIMI_MS + 5;
  oturum.satirlariDenetle();
  assert.ok(oturum.anlik().uyari === UYARI.satirYok);
  oturum.iptal();
});
