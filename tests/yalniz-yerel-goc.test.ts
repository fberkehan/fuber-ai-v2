// Son bütün dal incelemesi K-1: 0.11'de Geliştirici'de "Yalnız bu bilgisayardaki yapay zekâ" açılıp İş'e dönülmüş profilde eski `yalnizYerel: true`
// 0.12'de birden etkin oluyordu (0.11'de İş'te yok sayılırdı; 0.12'de iki modda da etkin, hazır değilken sohbet bekler). Yükseltme göçü BİR KEZ:
// işaretsiz (0.12 öncesi) profilde değer İş'teyse (Geliştirici döneminden kalma) ya da yerel hazır değilse temizlenir; Geliştirici'de yerel
// hazırken korunur. Kullanıcının 0.12'de BİLEREK seçtiği "Yalnız bu bilgisayar" (işaretli profil; yeni kurulumda işaret bellekte) hiç dokunulmaz.
// Kural saf: shared/nerede.ts yalnizYerelGocu; uygulaması açılışta main.ts → yerel/gizli-geri-al.ts acilistaYalnizYerelGocu (yerel hazır mı
// orada bilinir). GERÇEK ayarlar.ts (dosya); yerel hazır = FUBER_YEREL_TABAN (sahte; ağ yok).
import { KURULUM_SURUMU } from '../src/shared/kurulum-adimlari.ts';
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { anaSurecSahnesi } from './yardimci/ana-surec.ts';
import { YALNIZ_YEREL_GOCU, yalnizYerelGocu } from '../src/shared/nerede.ts';

const PROFIL_011 = {
  kurulumTamam: true, kurulumSurumu: KURULUM_SURUMU, kullaniciAdi: 'Deniz', tanitimSurumu: '0.9.0', yenilikSurumu: '0.11.0',
  ses: { surum: 2, uyandirma: false }, proaktif: { etkin: false }, baslangictaAc: false,
};
const { klasor } = anaSurecSahnesi('yalniz-yerel-goc', { ...PROFIL_011, mod: 'is', yerel: { etkin: true, gizliMod: false, yalnizYerel: true } });
(globalThis as Record<string, unknown>).__sifreleme = true;
const dosya = path.join(klasor, 'ayarlar.json');
const diskte = () => JSON.parse(fs.readFileSync(dosya, 'utf8'));
const { ayarlar, ayarlariKaydet, sirYaz } = await import('../src/main/ayarlar.ts');
const { acilistaYalnizYerelGocu } = await import('../src/main/yerel/gizli-geri-al.ts');
const { ayarKaydiniSuz } = await import('../src/main/ayar-kaydi.ts');
/** Profili diskten yeniden yükletir (sirYaz önbelleği sıfırlar) — her senaryo yeni bir açılış gibi. */
const yenidenAc = (profil: Record<string, unknown> | null) => {
  if (profil) fs.writeFileSync(dosya, JSON.stringify(profil)); else fs.rmSync(dosya, { force: true });
  fs.rmSync(`${dosya}.bak`, { force: true });
  sirYaz('api:yok', null);
};
after(() => { delete process.env.FUBER_YEREL_TABAN; });

test('K-1 kural (saf): yalnız Geliştirici + yerel hazırken korunur; İş ya da hazır değilken temizlenir; kapalı değer kapalı kalır', () => {
  assert.equal(YALNIZ_YEREL_GOCU, 1);
  for (const mod of ['is', 'gelistirici'] as const) for (const yerelHazir of [true, false]) {
    assert.equal(yalnizYerelGocu({ yalnizYerel: false, mod, yerelHazir }), false);
    assert.equal(yalnizYerelGocu({ yalnizYerel: true, mod, yerelHazir }), mod === 'gelistirici' && yerelHazir, `${mod} hazır=${yerelHazir}`);
  }
});

test('K-1: 0.11 İş profili (Geliştirici döneminden kalma yalnizYerel) → açılışta temizlenir, işaret diske yazılır; ikinci açılışta göç yok', () => {
  process.env.FUBER_YEREL_TABAN = 'http://127.0.0.1:9'; // yerel hazır sayılsa da İş'te temizlenir
  assert.equal(ayarlar().yerel.yalnizYerel, true, 'ön koşul: 0.11 değeri yüklendi');
  assert.equal(acilistaYalnizYerelGocu(), true, 'temizledi');
  assert.equal(ayarlar().yerel.yalnizYerel, false);
  assert.equal(diskte().yerel.yalnizYerel, false, 'diske yazıldı');
  assert.equal(diskte().yalnizYerelGocu, YALNIZ_YEREL_GOCU, 'işaret diskte');
  // 0.12'de BİLEREK seçilirse (işaretli profil) sonraki açılışlarda dokunulmaz.
  ayarlariKaydet((a) => { a.yerel.yalnizYerel = true; });
  yenidenAc(diskte());
  assert.equal(acilistaYalnizYerelGocu(), false);
  assert.equal(ayarlar().yerel.yalnizYerel, true, 'bilinçli 0.12 seçimi korunur');
});

test('K-1: 0.11 Geliştirici profili — yerel hazırken korunur (0.11\'de de etkindi), hazır değilken temizlenir', () => {
  process.env.FUBER_YEREL_TABAN = 'http://127.0.0.1:9';
  yenidenAc({ ...PROFIL_011, mod: 'gelistirici', yerel: { etkin: true, gizliMod: false, yalnizYerel: true } });
  assert.equal(acilistaYalnizYerelGocu(), false);
  assert.equal(ayarlar().yerel.yalnizYerel, true);
  assert.equal(diskte().yalnizYerelGocu, YALNIZ_YEREL_GOCU, 'karar verildi, işaret yazıldı');
  delete process.env.FUBER_YEREL_TABAN; // yerel kurulu değil (sahte model klasörü boş) → hazır değil
  yenidenAc({ ...PROFIL_011, mod: 'gelistirici', yerel: { etkin: true, gizliMod: false, yalnizYerel: true } });
  assert.equal(acilistaYalnizYerelGocu(), true, '0.11\'de etkin değildi (hazır değil): 0.12\'de sessizce beklemesin');
  assert.equal(diskte().yerel.yalnizYerel, false);
});

test('K-1: YENİ kurulum (dosya yok) — işaret bellekte; İş\'te bilerek seçilen "Yalnız bu bilgisayar" yeniden açılışta korunur; dosya erken yazılmaz', () => {
  process.env.FUBER_YEREL_TABAN = 'http://127.0.0.1:9';
  yenidenAc(null);
  assert.equal(ayarlar().yalnizYerelGocu, YALNIZ_YEREL_GOCU, 'yeni profil işaretli (bellekte)');
  assert.equal(acilistaYalnizYerelGocu(), false);
  assert.equal(fs.existsSync(dosya), false, 'göç yeni profilin dosyasını erken yazmaz');
  ayarlariKaydet((a) => { a.mod = 'is'; a.yerel.yalnizYerel = true; });
  assert.equal(diskte().yalnizYerelGocu, YALNIZ_YEREL_GOCU, 'ilk kayıtla işaret diske');
  yenidenAc(diskte());
  assert.equal(acilistaYalnizYerelGocu(), false);
  assert.equal(ayarlar().yerel.yalnizYerel, true);
});

test('K-1: işareti yalnız ana süreç yazar — arayüzün ayarlar:kaydet kopyası onu silemez/değiştiremez', () => {
  const c = ayarKaydiniSuz({ yalnizYerelGocu: 0, kullaniciAdi: 'Deniz' } as never) as Record<string, unknown>;
  assert.equal('yalnizYerelGocu' in c, false);
  assert.equal(c.kullaniciAdi, 'Deniz');
});

test('K-1: main.ts göçü açılışta bekleyen kurulum denetiminden SONRA, Gizli denetiminden ÖNCE çağırır', () => {
  const ana = fs.readFileSync(path.resolve(import.meta.dirname, '..', 'src/main/main.ts'), 'utf8');
  const b = ana.indexOf('bekleyenDenetle();'), y = ana.indexOf('acilistaYalnizYerelGocu();'), g = ana.indexOf('acilistaGizliDenetle();');
  assert.ok(b > 0 && y > b && g > y, `sıra: bekleyen ${b} · yalnız ${y} · Gizli ${g}`);
  // Son yeniden inceleme Y-4: göçün ayar yazması başarısız olursa açılışın geri kalanı atlanmaz (işaret yazılmadığı için sonraki açılışta yeniden).
  assert.match(ana, /try \{ acilistaYalnizYerelGocu\(\); \} catch \(e\) \{ console\.warn\(/);
});
