// ── Chrome bağlantısı (13 Kas, "Cowork çalışmıyor" onarımı) — saf; birim testli: tests/chrome-baglanti.test.ts ─────────────────────
// Beklenti: Fuber kullanıcının KENDİ Chrome'unda (oturumları ve eklentileriyle) iş yapabilsin. Fuber Tarayıcı bunu yapamaz
// (ayrı Electron profili). Fuber'in kendi Chrome eklentisi + yerel mesajlaşma köprüsü hiç yazılmadı (docs/chrome-eklentisi.md "yapılmadı").
// Bugün gerçekten çalışan yol: Anthropic'in "Claude in Chrome" eklentisi (Chrome Web Store'da yayında) + Claude Code'un kendi yerel
// mesajlaşma ana bilgisayarı. Claude Code `--chrome` ile açılınca `mcp__claude-in-chrome__*` araçlarını getirir; kayıt defteri anahtarını
// ve manifesti Claude Code'un kendisi yazar (Fuber kayıt defterine yazmaz). Fuber'in işi: bayrağı geçirmek, durumu dürüstçe göstermek,
// kullanıcıya "eklentiyi kur → Chrome'u aç → dene" yolunu tek cümleyle vermek.

/** Claude in Chrome eklentisinin Chrome Web Store kimliği (Claude Code ikilisinin ana bilgisayar manifestindeki allowed_origins ile aynı). */
export const CHROME_EKLENTI_KIMLIGI = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';
/** Mağaza sayfası (yalnız açılır; Fuber mağazaya bir şey yüklemez). */
export const CHROME_EKLENTI_ADRESI = `https://chromewebstore.google.com/detail/claude/${CHROME_EKLENTI_KIMLIGI}`;
/** Claude Code'un yerel mesajlaşma ana bilgisayarı: HKCU\Software\Google\Chrome\NativeMessagingHosts\<ad> (Claude Code yazar). */
export const CHROME_ANA_BILGISAYAR = 'com.anthropic.claude_code_browser_extension';

export type ChromeDurum =
  | 'chrome-yok' // Chrome kurulu görünmüyor
  | 'eklenti-yok' // Chrome var, Claude eklentisi hiçbir profilde yok
  | 'hazir'; // Chrome + eklenti var; Claude Code `--chrome` ile açılınca bağlanır

export interface ChromeGirdisi {
  /** Chrome "User Data" klasörü bulundu mu. */
  chromeVar: boolean;
  /** Claude eklentisinin klasörünü taşıyan profiller (ör. ["Default"]). */
  eklentiProfilleri: string[];
  /** Ana bilgisayar kaydı: kayıt anahtarı var, manifesti ve çalıştırdığı dosya yerinde (Claude Code ilk `--chrome` açılışında yazar). */
  anaBilgisayar: 'tamam' | 'yok' | 'bozuk';
}

export interface ChromeBilgisi {
  durum: ChromeDurum;
  anaBilgisayar: ChromeGirdisi['anaBilgisayar'];
  eklentiProfilleri: string[];
  /** Tek cümle: şu an ne oluyor. */
  ozet: string;
  /** Adım adım yol (hazırsa tek adım: dene). */
  adimlar: string[];
}

export function chromeDurumuHesapla(g: ChromeGirdisi): ChromeBilgisi {
  const taban = { anaBilgisayar: g.anaBilgisayar, eklentiProfilleri: g.eklentiProfilleri };
  if (!g.chromeVar) {
    return { ...taban, durum: 'chrome-yok', ozet: 'Chrome bu bilgisayarda bulunamadı.', adimlar: ['Google Chrome’u kur.', 'Claude eklentisini Chrome’a ekle.', 'Fuber’de Claude Code oturumu aç ve dene.'] };
  }
  if (g.eklentiProfilleri.length === 0) {
    return { ...taban, durum: 'eklenti-yok', ozet: 'Chrome’a Claude eklentisi kurulu değil.', adimlar: ['“Eklentiyi aç”a bas, açılan sayfada “Chrome’a ekle”yi seç.', 'Eklentide Claude hesabınla giriş yap.', 'Fuber’de Claude Code oturumu aç: “Chrome’da şu siteyi aç” de.'] };
  }
  const bozuk = g.anaBilgisayar === 'bozuk' ? ' Eski bağlantı kaydı bozuk görünüyor; Claude Code ilk açılışta onarır.' : '';
  return { ...taban, durum: 'hazir', ozet: `Claude eklentisi Chrome’da kurulu.${g.anaBilgisayar === 'tamam' ? '' : ' Bağlantı kaydını Claude Code ilk açılışta kendisi yazar; ardından Chrome’u bir kez kapatıp aç.'}${bozuk}`, adimlar: ['Fuber’de bir Claude Code oturumu aç.', '“Chrome’da şu siteyi aç ve şunu yap” de; her işlem için sana sorar.'] };
}

/** Claude Code sürecine geçirilecek ek bayraklar (SDK `extraArgs`): `--chrome` yalnız ayar açık VE eklenti kurulu görünüyorsa. */
export function chromeBayraklari(ayarAcik: boolean, durum: ChromeDurum): Record<string, string | null> {
  return ayarAcik && durum === 'hazir' ? { chrome: null } : {};
}

/** Ayarlar'daki Chrome profil klasörü adı mı ("Default", "Profile 3"); başka adlar (System Profile, Guest Profile…) eklenti aramasına girmez. */
export const chromeProfilAdiMi = (ad: string): boolean => ad === 'Default' || /^Profile \d{1,3}$/.test(ad);
