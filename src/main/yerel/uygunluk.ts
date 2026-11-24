// ── Ana süreç uygunluk kapısı (0.12 H3c düzeltme turu 1, Ö2) ───────────────────────────────────────────────────────────────────
// "Uymayan seçilemez" yalnız arayüzde değil: `yerel:kur` kurulu olmayan bir sürümü indirmeden ÖNCE bu bilgisayarın gerçek donanımıyla
// (sistem-kontrol.ts sistemBilgisi: bellek, ekran kartı, boş disk) denetler ve arayüzün kartıyla AYNI kararı verir
// (shared/yerel-katalog.ts yerelKatalog + kurulumUygunlugu; "Sürdür", eski istek ya da arayüz hatası belleğe sığmayan sürümü indirtemez).
// Donanım okunamazsa TUTUCU (kurulu olmayan sürüm reddedilir; Kü1). Kurulu sürüm ölçüm istemez (bu bilgisayarda çalışmış olandır); inen
// sürüm diske yeniden ölçülmez (Ö3: kendi yarım dosyası boş yeri azaltır).
import { ayarlar } from '../ayarlar.js';
import { sistemBilgisi } from '../sistem-kontrol.js';
import { yerelDurumu } from './durum.js';
import { yerelYarimBayt } from './kurulum.js';
import { kurulumUygunlugu, yarimlaBosDisk, yerelKatalog, type KatalogDonanimi } from '../../shared/yerel-katalog.js';
import type { YerelModelAdi } from '../../shared/tipler.js';

/** Bu bilgisayarın donanımı. Önizleme/sınama (yalnız FUBER_DEMO): arayüzün `sistem:kontrol` taklidiyle aynı makine
 *  (`globalThis.__fuberTestDonanim`; 'hata' = okunamadı). */
async function donanim(): Promise<KatalogDonanimi | 'hata'> {
  const test = process.env.FUBER_DEMO === '1' ? (globalThis as { __fuberTestDonanim?: KatalogDonanimi | 'hata' }).__fuberTestDonanim : undefined;
  if (test !== undefined) return test;
  try {
    const s = await sistemBilgisi();
    return { ramGB: s.ramGB, nvidia: s.nvidia, ...(s.vramGB !== undefined ? { vramGB: s.vramGB } : {}), bosDiskGB: s.bosDiskGB };
  } catch {
    return 'hata';
  }
}

/** Bu sürüm bu bilgisayara kurulabilir mi; değilse nedeni (arayüzdeki kartın cümlesiyle aynı). */
export async function yerelKurUygunlugu(ad: YerelModelAdi): Promise<{ uygun: boolean; neden: string | null }> {
  const d = yerelDurumu();
  if (d.modeller.find((m) => m.ad === ad)?.kurulu) return { uygun: true, neden: null };
  const a = ayarlar();
  const k = yerelKatalog({
    // Takip turu: yarım indirme dosyaları boş yer sayılır ("Sürdür" haksız reddedilmez; asıl disk koruması kurulum.ts'te).
    donanim: yarimlaBosDisk(await donanim(), yerelYarimBayt(ad)), modeller: d.modeller, calistiriciKurulu: d.kurulu.calistirici, cuda: d.cuda,
    islemciZorla: a.yerel.gpu === 'cpu', sade: a.mod !== 'gelistirici', inen: d.inen ?? null,
  });
  return kurulumUygunlugu(k, ad);
}
