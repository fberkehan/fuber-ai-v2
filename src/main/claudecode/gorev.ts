// ── claude_code_gorev aracının çekirdeği (Electron'a bağlı değil; birim testli: tests/cc-gorev.test.ts) ─────────────────────────
// Kararlar burada, bağımlılıklar dışarıdan (araclar.ts gerçeklerini verir):
//  • Ruling CA: telefondan gelen tur (b.uzak) yalnız var olan oturumda ya da BİLİNEN proje klasöründe; terminal AÇMAZ (Ayarlar'da eski
//    terminal yolu seçili olsa da); oturum en çok "Düzenlemelere izin ver" (yönetici kapatır).
//  • Telefondan, bilgisayarda AÇIK oturuma komut gitmez (düzeltme A): araç bunu dürüstçe söyler, sonuç sözü vermez.
//  • Son dalga B (I2) — onay kartı: aynı turda okunan bir e-posta/sayfa istem enjeksiyonu taşıyıp bu aracı çağırtabilir; kart o yüzden
//    HER ZAMAN çıkar, yalnız GENEL Tam yetki (yetki.tamYetki) açıksa ya da kullanıcı bu görev için "bu görev boyu" dediyse çıkmaz.
//    Claude Code'un kendi Tam yetkisi kartı ARTIK atlatmaz. Telefondan gelen turda kart her zaman çıkar ("bu görev boyu" sunulmaz).
//  • Sohbet aracından başlayan oturum en çok "Düzenlemelere izin ver" (yönetici: kaynak 'sohbet' → mod tavanı); Tam yetkiye kullanıcı
//    masada o oturumda açıkça geçer. Eski terminal yolu da sohbet aracından izinsiz kipte açılmaz (sayfanın "Terminalde aç"ı değişmedi).
//  • Düzeltme turu (N1): iş masada AÇIK bir Tam yetkili oturuma gidiyorsa yönetici önce oturumu "Düzenlemelere izin ver"e indirir
//    (indiremezse iş gitmez); kart oturumun şu anki modunu ve işin çalışacağı modu söyler. (N2) Ev klasörü, AppData, sistem ve Fuber'in
//    verisi gibi geniş/korunan klasörlerde yönetici oturum açmaz ('genis-klasor').
import type { AracBaglami, AracSonucu } from '../ajan/araclar/kayit.ts';
import type { CcOturum } from './indeks.ts';
import { MASADA_ACIK, type CcBaslatIstegi, type CcIslemSonucu } from './oturum-yoneticisi.ts';
import { ccOturumYolu, type CcOturumOzeti, type CcMod } from '../../shared/cc-olay.ts';
import { CC_MOD_ADLARI } from '../../shared/cc-ayar.ts';

export interface GorevBagimliliklari {
  /** Oturum dizininde kimlikle (ilk 8 karakter yeter) ara. */
  oturumBul: (id: string) => Promise<CcOturum | undefined>;
  ayar: () => { genelTamYetki: boolean; claudeTamYetki: boolean; yol: 'uygulama' | 'terminal' };
  /** Bilinen proje kökü (değilse fırlatır). */
  projeKlasoru: (cwd: string) => Promise<string>;
  terminaldeAc: (o: { cwd: string; oturum?: string; komut: string; tamYetki: boolean; baslik: string }) => { komutSatiri: string; pencere: string };
  baslat: (i: CcBaslatIstegi) => Promise<CcIslemSonucu & { oturum?: CcOturumOzeti }>;
  /** Klasörün kendi Claude Code ayarları var ve masada güvenilmedi mi (kartta not; uygulama içi oturum onları yüklemez). */
  klasorGuveni?: (cwd: string) => { gerekli: boolean; karar?: 'guven' | 'guvenme' };
  /** Düzeltme turu (N1): kart için oturumun ŞU ANKİ modu (sürdürülen oturum) ve işin çalışacağı (tavanlı) mod. */
  modOnizleme?: (kimlik?: string) => { simdiki?: CcMod; olacak: CcMod };
}

const kisalt = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * I2 doğruluk tablosu: kart gerekir mi. Telefon turu → her zaman. Masada → genel Tam yetki kapalıysa ve bu görev için "bu görev boyu"
 * verilmediyse. Claude Code'un Tam yetkisi bu kararda YOK (parametre bile değil).
 */
export function ccGorevKartiGerekli(o: { uzak: boolean; genelTamYetki: boolean; gorevBoyuIzni: boolean }): boolean {
  if (o.uzak) return true;
  return !(o.genelTamYetki || o.gorevBoyuIzni);
}

export async function ccGorevCalistir(g: Record<string, unknown>, b: AracBaglami, d: GorevBagimliliklari): Promise<AracSonucu> {
  const o = g.oturum_id ? await d.oturumBul(String(g.oturum_id)) : undefined;
  if (g.oturum_id && !o) return { icerik: 'Bu kimlikle oturum bulunamadı; önce claude_code_oturumlari ile ara.', hata: true };
  let cwd = o?.cwd || String(g.klasor ?? '');
  if (!cwd) return { icerik: 'Ne oturum ne klasör verildi.', hata: true };
  const uzak = b.uzak === true;
  if (uzak && !o) {
    try { cwd = await d.projeKlasoru(cwd); } catch { return { icerik: 'Telefondan yalnız bilinen bir proje klasöründe (daha önce Claude Code oturumu açılmış) iş verilebilir.', hata: true }; }
  }
  const a = d.ayar();
  const terminal = a.yol === 'terminal' && !uzak; // telefondan bilgisayarın ekranında terminal açılmaz
  const komut = String(g.komut ?? '');
  let guvenNotu = '';
  try {
    const gv = !terminal ? d.klasorGuveni?.(cwd) : undefined;
    if (gv?.gerekli && gv.karar !== 'guven') guvenNotu = '\nBu klasörün kendi Claude Code ayarları (kancalar, izin kuralları, MCP) yüklenmeyecek: masada güvenilmedi.';
  } catch { /* not isteğe bağlı */ }
  if (ccGorevKartiGerekli({ uzak, genelTamYetki: a.genelTamYetki, gorevBoyuIzni: b.gorevIzinleri.has('claudecode') })) {
    // N1: kart oturumun gerçek ŞU ANKİ modunu ve işin çalışacağı modu söyler (masadaki Tam yetkili oturum bu iş için indirilir).
    let mo: { simdiki?: CcMod; olacak: CcMod } | undefined;
    try { mo = d.modOnizleme?.(g.catalla === true ? undefined : o?.id); } catch { mo = undefined; }
    const ad = (m: CcMod) => `“${CC_MOD_ADLARI[m].ad}”`;
    const modNotu = terminal ? '\nTerminal izinsiz modda açılmaz; Claude Code orada kendisi sorar.'
      : mo?.simdiki && mo.simdiki !== mo.olacak ? `\nMod: oturum şu an ${ad(mo.simdiki)}; bu iş ${ad(mo.olacak)} ile çalışır (Tam yetkiye yalnız bilgisayarda, oturumun içinden geçilir).`
        : mo ? `\nMod: ${ad(mo.olacak)} (en çok “${CC_MOD_ADLARI.acceptEdits.ad}”; Tam yetkiye yalnız bilgisayarda, oturumun içinden geçilir).`
          : `\nMod: en çok “${CC_MOD_ADLARI.acceptEdits.ad}” (Tam yetkiye yalnız bilgisayarda, oturumun içinden geçilir).`;
    const k = await b.onay({
      baslik: terminal ? 'Claude Code terminalde açılsın mı?' : 'Claude Code bu işe başlasın mı?',
      aciklama: `${o ? `Oturum: ${o.baslik}\n` : 'Yeni oturum\n'}Klasör: ${cwd}\nKomut: ${komut}${modNotu}${guvenNotu}`,
      tehlike: 'orta', gorevBoyu: !uzak,
    });
    if (k === 'reddet') return { icerik: 'Kullanıcı reddetti.', hata: true };
    if (k === 'bu_gorev' && !uzak) b.gorevIzinleri.add('claudecode');
  }
  const ozet = o ? `${o.proje} · ${kisalt(o.baslik, 30)}` : 'yeni oturum';
  if (terminal) {
    const etkin = Date.now() - (o?.sonZaman ? Date.parse(o.sonZaman) : 0) < 90_000;
    // I2: sohbet aracının açtığı terminal de izinsiz (--dangerously-skip-permissions) AÇILMAZ; Claude Code terminalde kendisi sorar.
    const r = d.terminaldeAc({ cwd, oturum: o?.id, komut, tamYetki: false, baslik: `Fuber → ${o?.proje ?? cwd.split(/[\\/]/).pop()}` });
    return {
      icerik: `Terminal açıldı (${r.pencere}): ${cwd}\n${r.komutSatiri}${etkin ? '\nNot: bu oturum son 1,5 dakikada kullanılmış; başka bir pencerede açık olabilir.' : ''}\nİş Claude Code'da sürüyor; sonucu o terminalde görürsün.`,
      ozet,
    };
  }
  const r = await d.baslat({ cwd, surdur: o?.id, catalla: g.catalla === true, istem: komut, baslik: o?.baslik, kaynak: 'sohbet', sohbetId: b.sohbetId, uzak });
  if (!r.tamam) {
    if (r.kod === 'masada-acik') return { icerik: `${MASADA_ACIK} Komutu iletmedim; bu iş için sonuç yazılmayacak.`, hata: true, ozet, ...(r.oturum ? { yol: ccOturumYolu(r.oturum.id, r.oturum.kimlik) } : {}) };
    if (r.kod === 'mod-dusurulemedi' || r.kod === 'genis-klasor') return { icerik: `${r.hata ?? 'Claude Code başlatılamadı.'} Bu iş için sonuç yazılmayacak.`, hata: true, ozet };
    if (r.kod === 'baska-yerde') return { icerik: 'Bu Claude Code oturumu şu an başka bir yerde (terminal ya da başka bir uygulama) açık görünüyor; doğrudan sürdürmedim. Kullanıcıya sor: o sohbetin kopyasında (catalla: true) sürdüreyim mi?', hata: true };
    return { icerik: r.hata ?? 'Claude Code başlatılamadı.', hata: true };
  }
  const s = r.oturum!;
  return {
    icerik: `Claude Code uygulama içinde başladı (${o ? `oturum: ${o.baslik}` : 'yeni oturum'} · ${cwd} · mod: ${CC_MOD_ADLARI[s.mod].ad}). Komut olduğu gibi iletildi.${s.durum === 'sirada' ? ` Şu an sırada (${s.siraNo}.): aynı anda en çok 4 oturum çalışır.` : ''}${guvenNotu ? ' Bu klasörün kendi Claude Code ayarları yüklenmedi (masada güvenilmedi).' : ''} İş Claude Code sayfasında sürüyor; izin isterse orada ve adada görünür; bitince sonucu bu sohbete kısaca yazacağım.`,
    ozet,
    // Sohbetteki araç kartında "Oturumu aç" (Görev 28 düzeltme 1): Claude Code sayfasında bu oturum.
    yol: ccOturumYolu(s.id, s.kimlik),
  };
}
