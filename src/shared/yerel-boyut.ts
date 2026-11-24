// ── Yerel modelin diskte kapladığı yer ve kurulumun TEK önerisi (saf; birim testli: tests/yerel-kaldirma.test.ts, tests/yerel-oneri.test.ts) ──
// İndirme onayı ve (Görev 20b, K2) "Kaldır" onayı aynı kalıpla boyut yazar: kurulu modellerin dosyaları + çalıştırıcı (llama.cpp)
// ve yerel ses (Piper) için yaklaşık pay.
// 0.10 E4 (K5) — kurulum yerel modeli de bilir; tek ürün olduğu için çok fazla seçim sunulmaz.
// Kurulumda kullanıcıya model listesi gösterilmez: donanımdan (sistem:kontrol) TEK öneri hesaplanır (yerelOnerisi) ve sayfa yalnız
// "Bu bilgisayar için önerilen: Hafif sürüm · ~1,9 GB iner" der. Geliştirici modeli Ayarlar → Gizlilik'ten değiştirir.
import type { YerelModelAdi } from './tipler.ts';
import { TERIM, buyukBasla } from './terimler.ts';
import { WHISPER_BOYUT_MB, WHISPER_CALISTIRICI_MB } from './dikte-yolu.ts';

/** Çalıştırıcı + Piper (yerel klasöre inen pay, yaklaşık; "Kaldır" bunu siler). */
export const CALISTIRICI_PAYI = 0.66e9;
/** 0.14.1: yazıya çevirme (Whisper: işlemci çalıştırıcısı + varsayılan model) — ilk kurulumda AYNI akışta iner (main/yerel/kurulum.ts). */
export const SES_PAYI = (WHISPER_CALISTIRICI_MB.cpu + WHISPER_BOYUT_MB['large-v3-turbo-q5_0']) * 1e6;
/** İlk kurulumda modele eklenen pay (yaklaşık): çalıştırıcı + ses (Piper) + yazıya çevirme (Whisper). Kart, düğme ve onay bu sayıyı yazar. */
export const ILK_KURULUM_PAYI = CALISTIRICI_PAYI + SES_PAYI;
/** Kurulum için model dosyasının yanında diskte gereken pay (geçici dosyalar; model-bilgisi.ts KURULUM_PAYI_GB ile aynı). */
const KURULUM_PAYI_GB = 1;

const YEREL_IS = buyukBasla(TERIM.yzYerel);

/** Kaldırma hatasının metni: IPC öneki atılır; İş modunda ham kod/yol gösterilmez (Görev 20b düzeltme turu 1). */
export function kaldirmaHataMetni(ham: string, is: boolean): string {
  const temiz = ham.replace(/^Error invoking remote method '[^']*': (?:\w*Error: )?/, '').trim();
  if (!is) return temiz;
  return /EBUSY|EPERM|ENOTEMPTY|kilit|busy|locked/i.test(temiz)
    ? `${YEREL_IS} kaldırılamadı: bir dosyası şu an kullanımda. Fuber’i kapatıp yeniden açtıktan sonra tekrar dene.`
    : `${YEREL_IS} kaldırılamadı. Biraz sonra tekrar dene; sürerse Fuber’i yeniden başlat.`;
}

/** "Kaldır"ın sileceği yaklaşık bayt: kurulu modeller + (çalıştırıcı kuruluysa) payı. */
export function yerelKaldirmaBoyutu(d: { kurulu: { calistirici: boolean }; modeller: readonly { boyut: number; kurulu: boolean }[] }): number {
  const modeller = d.modeller.filter((m) => m.kurulu).reduce((n, m) => n + m.boyut, 0);
  return modeller + (d.kurulu.calistirici ? CALISTIRICI_PAYI : 0);
}

/** 1,9 · 7,9 (bir ondalık, virgüllü). */
const gbYaz = (gb: number) => gb.toLocaleString('tr-TR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const gbYuvarla = (bayt: number) => Math.round(bayt / 1e8) / 10;

/** İndirilecek tek sayı (G8, C-15: kart, düğme ve onay aynı sayıyı yazar): model + (ilk kurulumda) çalıştırıcı ve ses payı. */
export function yerelIndirmeBoyutu(m: { boyut: number }, calistiriciKurulu = false): { gb: number; metin: string } {
  const gb = gbYuvarla(m.boyut + (calistiriciKurulu ? 0 : ILK_KURULUM_PAYI));
  return { gb, metin: `${gbYaz(gb)} GB iner` };
}

/** Önerinin okuduğu bilgisayar bilgisi (sistem:kontrol) ve yerel ayar. */
export interface YerelOneriGirdisi {
  nvidia: boolean;
  /** NVIDIA ekran kartının belleği (GB); okunamadıysa yok. */
  vramGB?: number;
  ramGB: number;
  /** Veri sürücüsündeki boş yer (GB); ölçülemediyse yok ya da NaN — engel sayılmaz. */
  bosDiskGB?: number;
  /** Ayarlar'da "Yalnız işlemci" seçili: ekran kartı sayılmaz. */
  islemciZorla?: boolean;
  /** Çalıştırıcı zaten kurulu: yalnız model iner. */
  calistiriciKurulu?: boolean;
}
/** yerel:durum'daki modellerin önerinin okuduğu alanları. */
export interface YerelModelOzeti { ad: YerelModelAdi; boyut: number; ramGB: number; vramGB?: number; kurulu?: boolean }

export type YerelOneri =
  | { uygun: true; model: YerelModelAdi; etiket: string; ekranKarti: boolean; kurulu: boolean; bayt: number; metin: string }
  | { uygun: false; neden: string };

/** Modelin sade etiketi boyut sırasından (en büyük "Büyük sürüm", en küçük "Hafif sürüm", arası "Orta sürüm"; model adı yok). 0.13 G: katalog üçten uzunsa orta sıralar numaralanır
 *  ("2. orta sürüm"): iki kart aynı adı taşımaz, onay cümlesi hangisinin indiğini söyler. */
export function yerelEtiketi(ad: YerelModelAdi, modeller: readonly YerelModelOzeti[]): string {
  const l = [...modeller].sort((a, b) => b.boyut - a.boyut);
  const i = l.findIndex((m) => m.ad === ad);
  if (l.length <= 1 || i === l.length - 1) return 'Hafif sürüm';
  if (i === 0) return 'Büyük sürüm';
  return i > 1 ? `${i}. orta sürüm` : 'Orta sürüm';
}

/**
 * K5: ekran kartı belleği ≥ 16 GB → en büyük; ≥ 8 GB → orta; yoksa en hafif (işlemcide). Seçilen diske sığmıyorsa bir küçüğüne iner
 * (kurulu model diske bakmaz); işlemcide çalışacak en hafif için sistem belleği yetmiyorsa ya da hiçbiri diske sığmıyorsa `uygun: false`
 * ve kısa neden. Etiket boyut sırasından ("Büyük/Orta/Hafif sürüm"; model adı yok); `metin` tek sayı ("~1,9 GB iner" ya da "kurulu").
 */
export function yerelOnerisi(g: YerelOneriGirdisi, modeller: readonly YerelModelOzeti[]): YerelOneri {
  const l = [...modeller].sort((a, b) => b.boyut - a.boyut);
  if (!l.length) return { uygun: false, neden: 'Bu bilgisayar için uygun bir sürüm bulunamadı' };
  const vram = g.nvidia && !g.islemciZorla && typeof g.vramGB === 'number' && Number.isFinite(g.vramGB) ? g.vramGB : 0;
  const ekranKarti = vram >= 8;
  const ilk = vram >= 16 ? 0 : vram >= 8 ? Math.min(1, l.length - 1) : l.length - 1;
  const bayt = (m: YerelModelOzeti) => m.boyut + (g.calistiriciKurulu ? 0 : ILK_KURULUM_PAYI);
  const disk = typeof g.bosDiskGB === 'number' && Number.isFinite(g.bosDiskGB) ? g.bosDiskGB : Infinity;
  const sigar = (m: YerelModelOzeti) => Boolean(m.kurulu) || bayt(m) / 1e9 + KURULUM_PAYI_GB <= disk;
  // Önerilen boydan küçüğe doğru: diske sığmayan ya da (işlemcide çalışacaksa) belleğe sığmayan bir küçüğe iner; hiçbiri olmazsa en
  // hafifin nedeni. Ekran kartı (≥ 8 GB) varken kart istemeyen hafif sürüm de kartta çalışır — sistem belleğine takılmaz.
  let neden = '';
  for (let i = ilk; i < l.length; i++) {
    const m = l[i];
    if (!sigar(m)) { neden = `Diskte en az ${gbYaz(gbYuvarla(bayt(m)) + KURULUM_PAYI_GB)} GB boş yer gerekir`; continue; }
    const kartta = ekranKarti && (m.vramGB === undefined || vram >= m.vramGB);
    if (!kartta && g.ramGB < m.ramGB) { neden = `En az ${m.ramGB} GB bellek gerekir`; continue; }
    return {
      uygun: true, model: m.ad, etiket: yerelEtiketi(m.ad, l), ekranKarti: kartta, kurulu: Boolean(m.kurulu), bayt: bayt(m),
      metin: m.kurulu ? 'kurulu' : `~${gbYaz(gbYuvarla(bayt(m)))} GB iner`,
    };
  }
  return { uygun: false, neden };
}
