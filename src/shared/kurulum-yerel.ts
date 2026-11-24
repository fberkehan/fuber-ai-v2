// ── Kurulumda Gizli mod ve cihazdaki yapay zekâ kararları (saf; birim testli: tests/kurulum-yerel.test.ts) ──────────────────────────
// 0.10 E4 düzeltme turu 1 (inceleme): Gizli mod kaydedilip HİÇ hazır olmayan bir hâlde sessizce kalabiliyordu. Gizli modda motor yolu
// yalnız yerel yapay zekâ hazırsa vardır (shared/tek-motor.ts motorYolu: hazır = açık (yerel.etkin) + kurulu); yoksa hiçbir şey çalışmaz.
// Ölü yollar: kurulu ama kapalı yerel (yükseltilmiş/yeniden açılmış profil), öneri gelmeden "Devam", haritadan cihazdaki yapay zekâ
// sayfası atlanarak geçilmesi. Kararlar burada; sihirbaz (sayfalar/Kurulum.tsx) yalnız uygular.
import { HESAP_DURUM_METNI } from './masaustu-hesap.ts';
import type { MotorGorunumu } from './motor-durumu.ts';
import type { SistemBilgisi } from './sistem-kontrol.ts';
import { buyukBasla, yerelAdi } from './terimler.ts';
import { GIZLI_BULUT_KAPALI, YEREL_BULUT_KAPALI } from './gizlilik-metni.ts';
import type { Mod, YerelModelAdi } from './tipler.ts';
import { yerelEtiketi, yerelOnerisi, type YerelModelOzeti, type YerelOneri } from './yerel-boyut.ts';

/** Gizlilik sayfasından çıkarken kaydedilecek yerel ayar yaması (değişiklik yoksa null). Gizli mod seçildi ve bir yerel yapay zekâ KURULU
 *  ise onu da açar (yoksa Gizli mod "hazır değil" kalırdı); kapatılırken yalnız Gizli mod kapanır (yerelin açık/kapalısı korunur). */
export function gizliKaydi(gizli: boolean, yerel: { gizliMod?: boolean; etkin?: boolean }, kurulu: boolean): { gizliMod: boolean; etkin?: true } | null {
  if (gizli) {
    if (kurulu) return yerel.gizliMod && yerel.etkin ? null : { gizliMod: true, etkin: true };
    return yerel.gizliMod ? null : { gizliMod: true };
  }
  return yerel.gizliMod ? { gizliMod: false } : null;
}

/** Gizli mod İSTENDİ mi (yerelHazirlik'in `gizli` girdisi): Gizlilik sayfasındaki seçim varsa o; yoksa kayıtlı ayar. Ekranda bilgisayar
 *  "uygun değil" çıkınca "Normal"e dönen seçim BUNA bakılmadan okunursa, öneri gelmeden kaydedilmiş Gizli mod hiç geri alınmazdı. */
export function gizliIstendiMi(secim: 'gizli' | 'normal' | null, kayitli: boolean): boolean {
  return secim === null ? kayitli : secim === 'gizli';
}

/** Cihazdaki yapay zekâ sayfasından çıkarken ETKİN seçim (I1 incelemesi, Önemli): sayfa öneriyi hiç göstermediyse ("Bilgisayarına
 *  bakıyorum…" ya da ~10 sn sonra "bakamadım") seçim "Şimdilik hayır" olur — süreye bakılmaz (yeniden açılan sihirbazda harita ilk 10 sn
 *  içinde de çıkarır). Durum sonradan gelince sihirbaz biterken kullanıcının hiç görmediği çok GB'lık bir indirme başlamasın; sol paneldeki
 *  özet de bunu söyler. `sureDoldu` yalnız belgeleme için (karar ona bağlı değil). */
export function yerelCikisSecimi(secim: 'evet' | 'hayir', g: { oneriVar: boolean; sureDoldu?: boolean }): 'evet' | 'hayir' {
  return g.oneriVar ? secim : 'hayir';
}

/**
 * F1 (son inceleme K3): cihazdaki yapay zekâ sayfasının TEK önerisi — yalnız ÖLÇÜLMÜŞ bilgisayardan. Bir yerel yapay zekâ zaten kuruluysa
 * o (ölçüm gerekmez); bilgisayar okunamadıysa (`sistem` 'hata': sistem:kontrol hata verdi ya da 10 sn'de yanıt vermedi) öneri YOK —
 * eskiden "8 GB, NVIDIA yok" varsayılıp öneri ölçülmüş gibi gösteriliyor ve disk denetlenmiyordu (I1: ölçülmemiş şey söylenmez). Sayfa
 * "bakamadım" der (yerelBakamadimMi), çıkışta seçim "Şimdilik hayır" (yerelCikisSecimi). null: bilinmiyor (okunuyor ya da okunamadı).
 */
export function kurulumOnerisi(g: {
  sistem: SistemBilgisi | 'hata' | null;
  yerel: { kurulu: { calistirici: boolean; model: boolean }; modeller: readonly YerelModelOzeti[] } | null;
  /** Ayardaki model (kuruluysa önce o). */
  model: YerelModelAdi;
  /** Ayarlar'da "Yalnız işlemci". */
  islemciZorla: boolean;
}): YerelOneri | null {
  if (!g.yerel || !g.sistem) return null;
  const liste = g.yerel.modeller.map((m) => ({ ad: m.ad, boyut: m.boyut, ramGB: m.ramGB, ...(m.vramGB !== undefined ? { vramGB: m.vramGB } : {}), kurulu: Boolean(m.kurulu) }));
  // Bir yerel model zaten kuruluysa (önceki kurulum) yenisi önerilmez: kurulu olan hazır sayılır.
  const kurulu = g.yerel.kurulu.calistirici && g.yerel.kurulu.model ? liste.find((m) => m.kurulu && m.ad === g.model) ?? liste.find((m) => m.kurulu) : undefined;
  if (kurulu) return { uygun: true, model: kurulu.ad, etiket: yerelEtiketi(kurulu.ad, liste), ekranKarti: false, kurulu: true, bayt: 0, metin: 'kurulu' };
  if (g.sistem === 'hata') return null;
  const b = g.sistem;
  return yerelOnerisi({ nvidia: b.nvidia, vramGB: b.vramGB, ramGB: b.ramGB, bosDiskGB: b.bosDiskGB, islemciZorla: g.islemciZorla, calistiriciKurulu: g.yerel.kurulu.calistirici }, liste);
}

/** F1 (K3): sayfa "Bu bilgisayara bakamadım" der mi — öneri yokken bilgisayar okunamadıysa HEMEN (10 sn beklenmez), değilse ~10 sn dolunca. */
export function yerelBakamadimMi(g: { oneriVar: boolean; sureDoldu: boolean; sistemHata: boolean }): boolean {
  return !g.oneriVar && (g.sureDoldu || g.sistemHata);
}

/** Sol paneldeki özetin okuduğu seçim: öneri gösterilmemişken ("bakıyorum" / "bakamadım") "İstiyorum" denmez (boş); çıkışta "Şimdilik
 *  hayır" olduysa "Sonra". */
export function yerelOzetSecimi(secim: 'evet' | 'hayir', g: { oneriVar: boolean }): 'evet' | 'hayir' | undefined {
  return g.oneriVar || secim === 'hayir' ? secim : undefined;
}

/** Cihazdaki yapay zekânın kararı sayfa haritayla ATLANIRKEN ve "Bitti"de uygulanır mı: yalnız sayfa görüldüyse ya da Gizli mod BU sihirbazda
 *  açıldıysa (indirmesi başlasın ya da hazırlanamıyorsa geri alınsın). Önceden kayıtlı Gizli mod, sayfasına uğranmadan geri alınmaz; görülmemiş
 *  varsayılan "İstiyorum" indirme başlatmaz. (Sayfadan "Devam"la çıkış her zaman uygular: sayfa görüldü.) */
export function yerelKarariUygulansinMi(g: { yerelGoruldu: boolean; gizliIstendi: boolean; acilistaGizli: boolean }): boolean {
  return g.yerelGoruldu || (g.gizliIstendi && !g.acilistaGizli);
}

export interface YerelHazirlikGirdisi {
  /** Gizli mod seçili (kaydedilmiş ya da sayfada seçilmiş). */
  gizli: boolean;
  /** Cihazdaki yapay zekâ sayfasında "İstiyorum". */
  istiyor: boolean;
  /** Bu bilgisayarın önerisi; null: bilinmiyor (bilgisayar okunamadı/okunuyor). */
  oneri: { uygun: boolean } | null;
  /** Bir yerel yapay zekâ zaten kurulu (çalıştırıcı + model). */
  kurulu: boolean;
  /** Bir indirme sürüyor. */
  iniyor: boolean;
  /** Bu sihirbaz bir indirme başlattı. */
  baslatildi: boolean;
}
export type YerelEylem = 'indir' | 'durdur' | 'gizli-geri-al' | 'yok';

/** F1 (son inceleme Ö2): bu bilgisayardaki yapay zekâ HAZIRLANIYOR mu — indirme/kurulum sürüyor ya da istenmiş kurulumun kaydı var ve
 *  kalıcı hatası yok (yarıda kaldıysa "Sürdür" bekler; kırmızı değil). "Kaldır" sürerken hazırlık değildir. TEK kural: ana süreç sinyali
 *  (main/abonelik.ts motorDurumu → `hazirlaniyor`) bunu okur; Gizli + hazır değil + hazırlanıyor → nötr 'hazirlaniyor' (motor-durumu.ts). */
export function yerelHazirlaniyor(g: { iniyor: boolean; bekleyen?: { hata?: string } | null; kaldiriliyor?: boolean }): boolean {
  if (g.kaldiriliyor) return false;
  return g.iniyor || Boolean(g.bekleyen && !g.bekleyen.hata);
}

/**
 * F1 (son inceleme Ö1): Ayarlar → Gizlilik'teki Gizli mod anahtarı. GERÇEK hâli gösterir (`gizliMod`; eskiden yerel kurulu ve açık değilse
 * Gizli açıkken "kapalı" çiziliyordu); Gizli'den ÇIKMAK her zaman serbest, AÇMAK kurulu ve açık yerel ister. `not` satırın ek cümlesi:
 * hazırlanırken Hazırsın satırının aynısı (hazirDurumu; duraklamışsa — `yarim` — onun yarım dalı), hazır değilken kapatılabileceği,
 * kapalıyken eski kural ("Önce … kur ve aç.").
 */
export function gizliAnahtari(g: { mod: Mod; gizliMod: boolean; kurulu: boolean; etkin: boolean; hazirlaniyor?: boolean; yarim?: boolean }): { acik: boolean; devreDisi: boolean; not: string } {
  const sade = g.mod !== 'gelistirici';
  const yerel = yerelAdi(sade);
  const hazir = g.kurulu && g.etkin;
  if (!g.gizliMod) return { acik: false, devreDisi: !hazir, not: hazir ? '' : ` Önce ${yerel}${sade ? 'yı' : 'i'} kur ve aç.` };
  if (hazir) return { acik: true, devreDisi: false, not: ' Şu an açık: yanıtları bu bilgisayar veriyor.' };
  if (g.hazirlaniyor) return { acik: true, devreDisi: false, not: ` ${hazirDurumu({ mod: g.mod, gorunum: 'hazirlaniyor', gizliMod: true, yerelHazir: false, yerelIniyor: !g.yarim, yerelIstendi: true, yerelYarim: Boolean(g.yarim) })}` };
  return { acik: true, devreDisi: false, not: ` Şu an açık ama ${yerel} hazır değil; kurabilir ya da Gizli modu kapatabilirsin.` };
}

/** F1 (son inceleme K1): Geliştirici'de Gizli modun kapsamı dışındaki tek şey — Claude Code oturumları (kod ve istemler Anthropic'e gider). */
export const GIZLI_CLAUDE_CODE = 'Claude Code oturumları Gizli modun kapsamı dışında; Anthropic üzerinden çalışır.';

/**
 * F1 (son inceleme K1): Gizli modun KAPSAMI — sihirbazın Gizlilik sayfası ve Ayarlar → Gizlilik aynı metni söyler ve yalnız doğru olanı
 * söz verir (koda göre): sohbet, ses, notlar ve hafıza bu bilgisayarda kalır (yanıtlar yerel modelle: motor/secici.ts tekMotorYolu);
 * araçlar kapalı (ajan/dongu.ts: Gizli turda araç yok); e-posta ve WhatsApp bağlantıları kendi sunucularıyla eşitlemeyi sürdürür
 * (entegrasyon/eposta.ts, whatsapp.ts — Gizli kapısı yok); pano ağa çıkmaz (main/pano/pano.ts); Geliştirici'de Claude Code kapsam dışı.
 * "Hiçbir şey dışarı gitmez" gibi mutlak söz yok — e-posta/WhatsApp eşitlemesi, telefon köprüsü ve Claude Code sürer. (0.12 H3b: Gizli'de hesap
 * çağrıları ağa ÇIKMAZ; yalnız kullanıcının açık onayıyla Ayarlar çıkışının tek isteği gider — hesap.ts iste().)
 *  · secenek       sihirbazın "Gizli mod" seçeneğinin açıklaması
 *  · hazirlaniyor  Gizli seçilince sayfanın sakin notu (hazır olana kadar sohbet bekler)
 *  · dip           kapsamın geri kalanı (bağlantılar, pano; Geliştirici'de Claude Code)
 */
export function gizliKapsami(mod: Mod): { secenek: string; hazirlaniyor: string; dip: string } {
  const gel = mod === 'gelistirici';
  return {
    secenek: 'Sohbet, ses, notlar ve hafıza bu bilgisayarda işlenir. Bu modda Fuber hatırlatıcı kuramaz; e-posta, WhatsApp ve tarayıcıyla iş yapamaz.',
    hazirlaniyor: `${gel ? 'Yerel modeli' : 'Bu bilgisayardaki yapay zekâyı'} hazırlıyorum; hazır olana dek sohbetin bekler. ${GIZLI_BULUT_KAPALI}.`,
    // Düzeltme turu 1 (K-4): "gelenleri" → "yeni iletileri".
    dip: `Bağlı e-posta ve WhatsApp yeni iletileri almayı sürdürür; hava, haber ve döviz Gizli modda güncellenmez.${gel ? ` ${GIZLI_CLAUDE_CODE}` : ''}`,
  };
}

/** Gizli modun kendiliğinden kapanma nedeni (yerel.gizliGeriAlindi): 'vazgec' — bekleyen kurulumdan vazgeçildi ya da indirme durduruldu;
 *  'hata' — kurulum kalıcı hatayla bitti; 'hazir-degil' — açılışta Gizli açık ama yerel ne hazır ne hazırlanıyordu (F1 düzeltme turu 1, N-1). */
export type GizliGeriAlmaNedeni = 'vazgec' | 'hata' | 'hazir-degil';

/** F1 (Ö1): Gizli mod kendiliğinden kapandığında kokpitin TEK sakin cümlesi (main/yerel/gizli-geri-al.ts → yerel.gizliGeriAlindi).
 *  Sözlük: İş "bu bilgisayardaki yapay zekâ", Geliştirici "yerel model". Düzeltme turu 1: N-3 — Gizlilik'teki anahtar yerel kurulmadan
 *  açılmaz, "yeniden kurup açabilirsin"; N-1 — açılış denetiminin nötr nedeni ("kurulamadı" denmez). */
export function gizliGeriAlindiMetni(neden: GizliGeriAlmaNedeni, mod: Mod): string {
  const yerel = buyukBasla(yerelAdi(mod !== 'gelistirici'));
  if (neden === 'hata') return `${yerel} kurulamadı; Gizli modu kapattım. Ayarlar → Gizlilik’ten yeniden deneyebilirsin.`;
  if (neden === 'hazir-degil') return `${yerel} hazır değildi; Gizli modu kapattım. Ayarlar → Gizlilik’ten kurup açabilirsin.`;
  return `${yerel} kurulmadı; Gizli modu kapattım. İstediğin an Ayarlar → Gizlilik’ten yeniden kurup açabilirsin.`;
}

/**
 * Cihazdaki yapay zekâ sayfası İLERİ geçilirken (haritadan atlanarak da) ve sihirbaz biterken: istenen (ya da Gizli modun gerektirdiği)
 * ve bu bilgisayara uygun sürüm iner; Gizli mod seçili ama hiçbir şey hazırlanamıyorsa (bilgisayar uygun değil ya da bilinmiyor) Gizli mod
 * GERİ ALINIR — sessizce hiç hazır olmayan Gizli mod kalmaz. "Şimdilik hayır" yalnız bu sihirbazın başlattığı indirmeyi durdurur.
 */
export function yerelHazirlik(g: YerelHazirlikGirdisi): YerelEylem {
  if (g.kurulu) return 'yok';
  if (g.gizli || g.istiyor) {
    if (g.iniyor || g.baslatildi) return 'yok';
    if (g.oneri?.uygun) return 'indir';
    return g.gizli ? 'gizli-geri-al' : 'yok';
  }
  return g.baslatildi && g.iniyor ? 'durdur' : 'yok';
}

export interface HazirGirdisi {
  mod: Mod;
  /** Motorun TEK hâli (shared/motor-durumu.ts motorGorunumu; renderer/motor-sinyali.ts `gorunum`) — sihirbaz kendi kuralını kurmaz (I1, R19).
   *  Gizli modda okunmaz (Gizli modda bulut kullanılmaz; yalnız yerel hazırlık söylenir). */
  gorunum: MotorGorunumu;
  gizliMod: boolean;
  /** Yerel yapay zekâ hazır: kurulu ve açık. */
  yerelHazir: boolean;
  yerelIniyor: boolean;
  /** İndirme istendi (bu sihirbazda ya da önceden; bekleyen kurulum kaydı). */
  yerelIstendi: boolean;
  /** F1 düzeltme turu 1 (K-1): istenmiş kurulum DURAKLAMIŞ — kayıt var, hiçbir şey inmiyor ("yarıda kaldı"). */
  yerelYarim?: boolean;
  /** Sihirbaz Gizli modu geri aldı: 'yetmiyor' — bilgisayar ÖLÇÜLDÜ ve yetmiyor; 'hazir-degil' — ölçülmedi ya da hiçbir şey hazırlanamadı
   *  (ölçülmemiş şey söylenmez, I1 5b). */
  gizliGeriAlindi?: 'yetmiyor' | 'hazir-degil' | null;
  /** 0.12 H3c: "Nerede çalışsın" → "Yalnız bu bilgisayar" seçili (Gizli kapalı). Gizli değildir (gizlilik sözü yok) ama düzeltme turu 1'den
   *  (P14 K1) beri yanıtlar hiçbir zaman buluta gitmez: inerken sohbet bekler ve satır bunu söyler (shared/tek-motor.ts). */
  yalnizYerel?: boolean;
  /** 0.12 H3c: sihirbaz "Yalnız bu bilgisayar"ı geri aldı (Fuber'de sürer): 'yetmiyor' ölçüldü ve hiçbir sürüm uymuyor; 'hazir-degil' ölçülemedi. */
  yerelGeriAlindi?: 'yetmiyor' | 'hazir-degil' | 'olculemedi' | null;
  /** Düzeltme turu 1: iniyorsa yüzdesi. */
  yerelYuzde?: number | null;
  /** Düzeltme turu 1 (Kü2): hesap yok — geri alma cümlesi "Fuber’le sürdürüyorum" demez (hesapsız Bulut yapay zekâ da yok). */
  hesapsiz?: boolean;
  /** 0.13.1: resmî hitap (kurulum Adım 11; shared/kurulum-metin.ts): satır "siz" konuşur. */
  siz?: boolean;
}

/** Hazırsın sayfasının TEK nötr durum satırı (kırmızı yok; en çok iki cümle; İş dili). Her şey hazırsa null. Gizli mod açık ama yerel
 *  hazır değilse — hesap ya da bulut olsa da — HER ZAMAN söyler (Gizli modda bulut kullanılmaz). Normal modda hesabın R10 hâlleri (onay
 *  bekliyor / erişim kapalı / hak doldu) birebir metinleriyle; sihirbazda kırmızı değil, sakin satır. */
export function hazirDurumu(g: HazirGirdisi): string | null {
  // Sözlük (P2; shared/terimler.ts): İş "bu bilgisayardaki yapay zekâ", Geliştirici "yerel model".
  const yerel = yerelAdi(g.mod !== 'gelistirici');
  const s = (sen: string, siz: string) => (g.siz ? siz : sen);
  if (g.gizliGeriAlindi === 'yetmiyor') return 'Bu bilgisayar gizli mod için yetmiyor; Normal modda sürdürüyorum.';
  if (g.gizliGeriAlindi === 'hazir-degil') return `Gizli mod için ${yerel} hazır değil; Normal modda sürdürüyorum.`;
  if (g.yerelGeriAlindi === 'yetmiyor') return g.hesapsiz ? 'Bu bilgisayar kendi yapay zekâsını çalıştırmaya yetmiyor; sohbet için Ayarlar’dan bir bulut yapay zekâ ' + s('bağlayabilirsin', 'bağlayabilirsiniz') + '.' : 'Bu bilgisayar kendi yapay zekâsını çalıştırmaya yetmiyor; Fuber’le sürdürüyorum.';
  // Düzeltme turu 2: boş disk ölçülemedi — "yetmiyor" denmez (ölçülmemiş şey söylenmez).
  if (g.yerelGeriAlindi === 'olculemedi') return g.hesapsiz ? `Bu bilgisayarı ölçemedim; sürümü Ayarlar → Gizlilik’ten ${s('seçebilirsin', 'seçebilirsiniz')}.` : `Bu bilgisayarı ölçemedim; Fuber’le sürdürüyorum. Sürümü Ayarlar → Gizlilik’ten ${s('seçebilirsin', 'seçebilirsiniz')}.`;
  if (g.yerelGeriAlindi === 'hazir-degil') return g.hesapsiz ? `${buyukBasla(yerel)} şimdilik hazırlanamadı; Ayarlar → Gizlilik’ten yeniden ${s('deneyebilirsin', 'deneyebilirsiniz')}.` : `${buyukBasla(yerel)} hazırlanamadı; Fuber’le sürdürüyorum.`;
  if (g.gizliMod) {
    if (g.yerelHazir) return null;
    // F1 düzeltme turu 1 (K-1): kayıt var ama hiçbir şey inmiyor (uygulama indirme sürerken kapanmıştı) — beklemek bir şey açmaz.
    if (g.yerelYarim) return 'Gizli mod hazırlanıyor — indirme yarıda kaldı; sürdürünce sohbet açılır.';
    if (g.yerelIniyor || g.yerelIstendi) return `Gizli mod hazırlanıyor — ${yerel} iniyor; inince sohbet açılır.`;
    return `Gizli mod açık ama ${yerel} hazır değil. Ayarlar → Gizlilik’ten ${s('kurarsın', 'kurarsınız')}.`;
  }
  // 0.12 H3c: "Yalnız bu bilgisayar" (Gizli değil). Düzeltme turu 1 (P14 K1): inerken de buluttaki yapay zekâ kapalı — sohbet bekler.
  if (g.yalnizYerel) {
    if (g.yerelHazir) return null;
    const Yerel = buyukBasla(yerel);
    if (g.yerelYarim) return `${Yerel} indirmesi yarıda kaldı; sürdürünce yanıtları bu bilgisayar verir.`;
    if (g.yerelIniyor || g.yerelIstendi) return `${Yerel} iniyor${typeof g.yerelYuzde === 'number' ? ` · %${g.yerelYuzde}` : ''} — hazır olunca yanıtlar bu bilgisayarda üretilir.`;
    return `${Yerel} hazır değil. ${YEREL_BULUT_KAPALI}; yeniden indirebilir ya da Fuber’le ${s('devam edebilirsin', 'devam edebilirsiniz')}.`;
  }
  switch (g.gorunum) {
    case 'hazir': case 'yerel': return null;
    case 'hesap-bekliyor': return s(HESAP_DURUM_METNI.bekliyor, HESAP_DURUM_METNI.bekliyor.replace('Hesabın ', 'Hesabınız '));
    case 'hesap-kapali': return s(HESAP_DURUM_METNI.kapali, HESAP_DURUM_METNI.kapali.replace('iletişime geç.', 'iletişime geçin.'));
    case 'kredi-bitti': return s(HESAP_DURUM_METNI['kredi-bitti'], HESAP_DURUM_METNI['kredi-bitti'].replace('Kullanım hakkın ', 'Kullanım hakkınız ').replace('iletişime geç.', 'iletişime geçin.'));
    default:
      if (g.yerelIniyor || g.yerelIstendi) return `${buyukBasla(yerel)} arka planda iniyor; inince sohbet açılır.`;
      if (g.gorunum === 'durdu') return s('Fuber’in bağlantısı koptu; verilerin yerinde.', 'Fuber’in bağlantısı koptu; verileriniz yerinde.');
      // 0.13: iki kipte de aynı; Developer'da kişi kendi anahtarını giremez (ürün kararı), kurulum artık Developer'a ulaşır.
      return s('Sohbet için istediğin an Ayarlar’dan bir bulut yapay zekâ bağlarsın.', 'Sohbet için istediğiniz an Ayarlar’dan bir bulut yapay zekâ bağlarsınız.');
  }
}
