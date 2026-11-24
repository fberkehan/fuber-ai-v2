// ── Kokpit tanıtım turu: sürüm işareti ve duraklar (Ruling 20; birim testli: tests/tanitim.test.ts) ─────────────────────────────────
// Ayarlar.tanitimSurumu = bu profilin en son izlediği (ya da geçtiği) turun sürümü; '' ya da hiç yok = izlemedi. Tur, kurulum bitmiş
// ve işaret bu sürüm değilse açılır: yeni kurulumda kurulum bitince, yükselen kurulu profilde ilk açılışta — bir kez; bitince ya da
// geçilince işaret yazılır, bir daha açılmaz. Ayarlar → Görünüm → "Tanıtımı yeniden izle" işareti '' yapar.
// Turun içeriği köklü değişirse TANITIM_SURUMU artırılır: herkes yeni turu bir kez görür. (Uygulama sürümünden bağımsızdır.)
// Görev 23 (K11): 0.9.0 turu — yeni duraklar: pano (gündem bandı), hızlı denetimler. 0.12 H3a: yükseltme sihirbazı yok; kurulum, "Tekrar
// hoş geldin" ya da yalnız hesap ekranı açıkken kabuk (ve tur) çizilmez (renderer/main.tsx), ekran bitince tur açılır. Durak sayısı moda göre (İş'te Claude Code durağı
// yok). 0.10 Görev 1 (D1): 3B beyin kalktı, "beyin" durağı da kalktı. 0.10 E4 (P6): İş 4, Geliştirici 5 durak; işaret 0.9.0 kalır (turu
// izleyen yeniden görmez).
import { HESAP_DURUM_METNI } from './masaustu-hesap.ts';
import type { MotorGorunumu } from './motor-durumu.ts';
import type { Ayarlar, Mod } from './tipler.ts';

export const TANITIM_SURUMU = '0.9.0';

/**
 * Tur açılsın mı: kurulum bitmiş ve bu sürümün turu izlenmemiş. 0.12 H3a: kurulum sürümü karara girmez (yükseltme sihirbazı yok);
 * `oturumOrtasi` (Görev 29) yalnız belgeleme için kalır — açılışta da oturum ortasında da aynı kural.
 */
export function tanitimAcilsinMi(a: Pick<Ayarlar, 'kurulumTamam'> & { tanitimSurumu?: string; kurulumSurumu?: number; mod?: Mod }, _oturumOrtasi = false): boolean {
  return a.kurulumTamam && a.tanitimSurumu !== TANITIM_SURUMU;
}

export interface TanitimDuragi {
  id: string;
  baslik: string;
  metin: string;
  /** Yalnız bu kullanım biçiminde (Claude Code: Geliştirici). */
  mod?: Mod;
  /** Vurgulanan öğe (CSS seçici); verilmezse `[data-tur="<id>"]` (ray düğmeleri). Son durak (ada) hedefsizdir: pencerenin çentiği. */
  hedef?: string;
  /** Kartın yeri: 'alt' = hedefin altında (önce sağı denenmez; kokpit balonu selamlamanın altında durur). */
  yer?: 'alt';
}

/**
 * 0.10 E4 (G8 Step 7, P6; denetim C-28): tur kısa ve iş öğretir — İş 4, Geliştirici 5 durak. Kokpit durağı rayın simgesini değil
 * kokpitin üst kartını (selamlama) vurgular, balon onun ALTINDA; ikinci durak kokpitteki sohbetin yazı alanı; son durak ada (kartın eylemi
 * sonDurakEylemi). Yalnız simgeyi tanıtan ray durakları (pano, sohbetler, bağlantılar, ayarlar, hızlı denetimler) kalktı.
 */
const DURAKLAR: readonly TanitimDuragi[] = [
  { id: 'kokpit', baslik: 'Kokpit', metin: 'Günün tek bakışta: hatırlatıcılar, önemli e-postalar, açık işler. Neyin öne çıkacağına ben karar veririm.', hedef: '.izgara > [data-kart="zihin"]', yer: 'alt' },
  { id: 'sohbet-yazi', baslik: 'Bana yaz', metin: 'Bir şey istemek için buraya yaz ya da sesle sor. “Yarın 9’da hatırlat” demen yeter.', hedef: '.kokpit__sohbet .yazici' },
  { id: 'hafiza', baslik: 'Hafıza', metin: 'Öğrendiklerimi kaynağı ve tarihiyle saklarım. Yanlış bir şey görürsen buradan düzeltir ya da silersin.' },
  { id: 'claude', baslik: 'Claude Code', metin: 'Yazılım projelerin varsa oturumlarını bulur, kaldığın yerden açarım. Kullanmıyorsan buraya dokunman gerekmez.', mod: 'gelistirici' },
  { id: 'ada', baslik: 'Ada ekranın üstünde', metin: 'Sana söyleyeceğim bir şey olunca ekranın üst ortasından inerim; iş bitince geri çekilirim.' },
];

/** Bu kullanım biçiminde turun durakları (sıra sabit; İş'te Claude Code yok). */
export function tanitimDuraklari(mod: Mod): TanitimDuragi[] {
  return DURAKLAR.filter((d) => !d.mod || d.mod === mod);
}

/** Son durağın ilk görevi: ana sohbetin yazı alanına yazılır (gönderilmez; kullanıcı Enter'a basar). */
export const ILK_GOREV_METNI = 'Yarın sabah 9’da bana günün planını hatırlat.';

/** Son durağın girdisi: motorun TEK hâli (shared/motor-durumu.ts motorGorunumu; I1, R19 — tur kendi kuralını kurmaz) ve Gizli mod. */
export interface SonDurakGirdisi {
  gorunum: MotorGorunumu; gizliMod: boolean;
  /** Masaüstü Fuber hesabı aktif (bağlantı koptuysa "giriş yap" değil "Yeniden dene"; shared/motor-durumu.ts motorBildirimi ile aynı). */
  hesapAktif?: boolean;
  /** 0.12 H3c: "Nerede çalışsın" → "Yalnız bu bilgisayar" seçili (motor-durumu.ts yalnizYerelSecili). */
  yalnizYerel?: boolean;
}

/** Son durağın birincil eylemi: yapay zekâ hazırsa somut bir ilk görev; hesap onay bekliyorsa yalnız "Bitir" (null; not söyler); erişim
 *  kapalı / kullanım hakkı dolduysa "Hesabı gör"; hesap aktif ama bağlantı koptuysa "Yeniden dene"; değilse Fuber hesabı girişi. Gizli modda
 *  HER ZAMAN yalnız "Bitir" (null): hatırlatıcı bu kipte kapalı ve bulut hesabı Gizli modda kullanılmaz (E4 düzeltme turu 1). */
export function sonDurakEylemi(g: SonDurakGirdisi): { tur: 'hatirlatici' | 'hesap' | 'yeniden-dene'; etiket: string } | null {
  if (g.gizliMod) return null;
  // 0.12 H3c: "Yalnız bu bilgisayar": hatırlatıcı yerelde araçsız, hesap girişi bu seçimin konusu değil — yalnız "Bitir". Düzeltme turu 1
  // (P14 K1): HER hâlde (yanıtlar hiçbir zaman buluta gitmez; hazır değilse kokpit kartı iki seçimi sunar).
  if (g.yalnizYerel || g.gorunum === 'yerel-hazir-degil') return null;
  switch (g.gorunum) {
    case 'hazir': return { tur: 'hatirlatici', etiket: 'Yarın sabah için bir hatırlatıcı kur' };
    case 'hesap-bekliyor': return null;
    case 'hesap-kapali': case 'kredi-bitti': return { tur: 'hesap', etiket: 'Hesabı gör' };
    case 'durdu': if (g.hesapAktif) return { tur: 'yeniden-dene', etiket: 'Yeniden dene' }; // eslint-disable-line no-fallthrough
    default: return { tur: 'hesap', etiket: 'Yapay zekâ bağla' };
  }
}

/** Son durağın sakin notu: hesabın R10 hâli (onay bekliyor / erişim kapalı / hak doldu) — kırmızı değil, tek satır. Öteki hâllerde ve Gizli
 *  modda yok. */
export function sonDurakNotu(g: SonDurakGirdisi): string | null {
  if (g.gizliMod) return null;
  if (g.gorunum === 'hesap-bekliyor') return HESAP_DURUM_METNI.bekliyor;
  if (g.gorunum === 'hesap-kapali') return HESAP_DURUM_METNI.kapali;
  if (g.gorunum === 'kredi-bitti') return HESAP_DURUM_METNI['kredi-bitti'];
  return null;
}
