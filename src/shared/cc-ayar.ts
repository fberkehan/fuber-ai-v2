// ── Claude Code ayarı: varsayılanlar, göç, izin modu kuralı (Görev 27, Ruling BV) — saf; birim testli: tests/cc-ayar.test.ts ────
// Yeni profil: uygulama içi oturumlar "Düzenlemelere izin ver" (acceptEdits) ile başlar, "Tam yetki" kapalı. 0.6/0.7/0.8'den yükselen
// profil kayıtlı `tamYetki` değerini KORUR (eski varsayılan açıktı): açıksa varsayılan mod Tam yetki (bypassPermissions; eski
// davranış), kapalıysa Her şeyi sor (default; eski terminal yolunda da Claude Code soruyordu). Tam yetki modu yalnız Ayarlar'daki
// "Tam yetki" açıkken seçilebilir. Göç ham dosya değerinden yapılır (derin birleştirme eksik alanı doldurmadan önce) ve kalıcı yazım
// gerekmez: dosyaya ilk kayıtla `varsayilanMod` yazılır, kural bir daha çalışmaz. Öteki alanlara dokunulmaz (veri kaybı yok).
import { ccModMu, type CcMod } from './cc-olay.ts';

export interface CcAyari {
  etkin: boolean;
  terminal: 'wt' | 'konsol';
  /** Ayarlar → Claude Code → Tam yetki: Tam yetki modu seçilebilir; eski terminal yolu --dangerously-skip-permissions ile açar. */
  tamYetki: boolean;
  /** Yeni uygulama içi oturumun izin modu. */
  varsayilanMod: CcMod;
  /** Sohbetin claude_code_gorev aracı: uygulama içi oturum (varsayılan) ya da eski görünür terminal. */
  yol: 'uygulama' | 'terminal';
  /** 13 Kas: Claude Code oturumları kullanıcının kendi Chrome'unu (Claude eklentisi kuruluysa) kullanabilsin: sürece `--chrome` verilir. Her işlem yine onay ister. */
  chrome: boolean;
}

export const CC_AYAR_VARSAYILAN: CcAyari = { etkin: true, terminal: 'konsol', tamYetki: false, varsayilanMod: 'acceptEdits', yol: 'uygulama', chrome: true };

// Son dalga B (I1, G26 gerçek ikili bulgusu): "Her şeyi sor" HER komutu sormaz — Claude Code okumaları, zararsız (salt okur) komutları
// (ör. `ls`) ve kullanıcının kendi Claude Code ayarlarındaki izin kurallarına uyanları sormadan çalıştırır. Metin bunu söyler.
export const CC_MOD_ADLARI: Record<CcMod, { ad: string; aciklama: string }> = {
  default: { ad: 'Her şeyi sor', aciklama: 'Dosya düzenlemeleri ve değişiklik yapan komutlar için izin ister. Okumalar, zararsız komutlar (ör. ls) ve Claude Code ayarlarındaki izin kuralların sormadan geçer.' },
  acceptEdits: { ad: 'Düzenlemelere izin ver', aciklama: 'Dosya düzenlemeleri kendiliğinden; değişiklik yapan komutlar için izin ister (Claude Code ayarlarındaki izin kuralların sormadan geçer).' },
  plan: { ad: 'Plan', aciklama: 'Yalnız okur ve plan çıkarır; düzenleme ve komut çalıştırma kapalı.' },
  bypassPermissions: { ad: 'Tam yetki', aciklama: 'Hiç izin sormaz. Yalnız güvendiğin projelerde.' },
};

const nesne = (x: unknown): x is Record<string, unknown> => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

/**
 * `ham`: ayar dosyasındaki claudeCode nesnesi (yoksa undefined); `profilVar`: ayar dosyası okunabildi; `birlesik`: varsayılanlarla
 * derin birleştirilmiş değer. Dönen değer her alanı geçerli bir CcAyari'dır.
 */
export function ccAyarGoc(ham: unknown, profilVar: boolean, birlesik: Partial<CcAyari>): CcAyari {
  const h = nesne(ham) ? ham : {};
  const a: CcAyari = {
    etkin: typeof birlesik.etkin === 'boolean' ? birlesik.etkin : CC_AYAR_VARSAYILAN.etkin,
    terminal: birlesik.terminal === 'wt' ? 'wt' : 'konsol',
    tamYetki: typeof birlesik.tamYetki === 'boolean' ? birlesik.tamYetki : CC_AYAR_VARSAYILAN.tamYetki,
    varsayilanMod: ccModMu(birlesik.varsayilanMod) ? birlesik.varsayilanMod : CC_AYAR_VARSAYILAN.varsayilanMod,
    yol: birlesik.yol === 'terminal' ? 'terminal' : 'uygulama',
    chrome: typeof birlesik.chrome === 'boolean' ? birlesik.chrome : CC_AYAR_VARSAYILAN.chrome,
  };
  if (profilVar && !ccModMu(h.varsayilanMod)) {
    // 0.6–0.8 profili: tamYetki'nin eski varsayılanı açıktı (dosyada hiç yazılmamışsa da açık sayılır).
    a.tamYetki = h.tamYetki !== false;
    a.varsayilanMod = a.tamYetki ? 'bypassPermissions' : 'default';
  }
  return a;
}

/**
 * Görev 26 (K17/K18: Claude Code yalnız Geliştirici; "İş modunda hiçbiri görünmez"): sohbetin Claude Code araçları (claude_code_oturumlari /
 * claude_code_oturum / claude_code_gorev) ve kişilikteki "Kod işleri" bölümü yalnız Geliştirici modunda. Eskiden mod sorulmuyordu: İş
 * modunda Fuber kendini "Claude Code oturumlarını bulur, işi oraya devrederim" diye tanıtıyordu (gerçek motorla uçtan uca testte görüldü).
 */
export const ccSohbetteAcik = (mod: string, etkin: boolean, kurulu: boolean): boolean => mod === 'gelistirici' && etkin && kurulu;

/** Tam yetki modu yalnız Ayarlar'daki "Tam yetki" açıkken seçilebilir. */
export const ccModSecilebilir = (mod: CcMod, tamYetki: boolean) => mod !== 'bypassPermissions' || tamYetki;

/** Ruling CA: telefondan başlatılan/sürdürülen oturum en çok "Düzenlemelere izin ver" — Tam yetki ASLA (komutlar masada onaylanır). */
export const ccUzakModu = (mod: CcMod): CcMod => (mod === 'bypassPermissions' ? 'acceptEdits' : mod);
/**
 * Son dalga B (I2): mod TAVANI — telefondan ya da sohbetin claude_code_gorev aracından başlayan oturum en çok "Düzenlemelere izin ver";
 * Claude Code'un varsayılan modu Tam yetki olsa da. Tavan yalnız kullanıcı o oturumda MASADA açıkça Tam yetki seçince kalkar.
 */
export const ccTavanliMod = ccUzakModu;

/** Yeni oturumun modu: istenen (seçilebiliyorsa) → kayıtlı varsayılan (seçilebiliyorsa) → Düzenlemelere izin ver. */
export function ccBaslangicModu(a: Pick<CcAyari, 'tamYetki' | 'varsayilanMod'>, istenen?: unknown): CcMod {
  if (ccModMu(istenen) && ccModSecilebilir(istenen, a.tamYetki)) return istenen;
  if (ccModMu(a.varsayilanMod) && ccModSecilebilir(a.varsayilanMod, a.tamYetki)) return a.varsayilanMod;
  return 'acceptEdits';
}
