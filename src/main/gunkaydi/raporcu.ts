// ── Raporcu ajan: günlük → haftalık → aylık ─────────────────────────────────────────────────────────────────────
// Günlük: günün not maddelerinden (önemli + önemsiz) rapor; önemsizlerden hafif bir "günün esprisi". Ana sohbete düşer.
// Haftalık: günlük raporlardan (gereksizler ayıklanır) önemli + önemsiz listeleri. Önemsiz kalemler 1 hafta, önemliler
// 1 ay yaşar (bekçi budar). Aylık: haftalıklardan yalnız önemliler + kararlar; kalıcıdır.
// Token ekonomisi: her katman yalnız bir alt katmanın KISA özetini okur (ham döküm hiçbir rapora gitmez).
import { sinyal } from '../beyin.js';
import { ayarlar } from '../ayarlar.js';
import { anaSohbet, mesajEkle, gorunume } from '../sohbet.js';
import { sohbetOlayi, yayinla } from '../olaylar.js';
import { sessizMi } from '../zamanlayici.js';
import { maddeler, raporYaz, raporGetir, raporlar, meseleler, sonEslikler, gundeMaddeVarMi } from './depo.js';
import { haftaGunleri, ayGunleri, ayHaftalari, gunAnahtari, isoHafta, ayAnahtari, silinmeTarihi } from './donem.js';
import { ajanJson, kullaniciHitabi, gunAdi, isYolu } from './model.js';
import { motorYokHatasi } from '../motor/secici.js';
import type { Rapor, RaporTuru } from '../../shared/tipler.js';

interface Cikti { baslik?: string; ozet?: string; onemli?: string[]; onemsiz?: string[]; kararlar?: string[]; acik_meseleler?: string[]; ileriye?: string[]; espri?: string }

const ORTAK = (hitap: string) => `Sen Fuber'in RAPORCU ajanısın; ${hitap} için profesyonel ama sıcak, kısa ve net raporlar yazarsın. Türkçe yaz. Uydurma: yalnız verilen notlara dayan. Her kalem tek satır, en çok 140 karakter.`;

const GUNLUK = (hitap: string) => `${ORTAK(hitap)}
GÜNLÜK RAPOR: Günün not maddelerinden:
- onemli: önemli olanlar, öncelik sırasıyla (en çok 12);
- onemsiz: gündelik/eğlenceli olanların kısa listesi (en çok 8);
- kararlar, acik_meseleler (hâlâ bekleyenler, kimden/ne zaman), ileriye (yarın/yakında yapılacaklar);
- espri: önemsiz şeylerden tek cümlelik, kırıcı olmayan hafif bir espri (yoksa boş);
- baslik: günün kısa başlığı ("Kira sözleşmesi ve çiğ köfte kararı"); ozet: 2 cümle.
JSON: {"baslik":"…","ozet":"…","onemli":[],"onemsiz":[],"kararlar":[],"acik_meseleler":[],"ileriye":[],"espri":"…"}`;

const HAFTALIK = (hitap: string) => `${ORTAK(hitap)}
HAFTALIK RAPOR: Haftanın günlük raporlarından. Gereksizleri ve tekrarları AYIKLA; aynı konuyu tek kalemde birleştir.
- onemli: haftanın önemli gelişmeleri, kararları, ilerlemeleri (en çok 15);
- onemsiz: haftanın akılda kalan hafif/eğlenceli anları (en çok 8);
- kararlar, acik_meseleler (hafta sonunda hâlâ açık olanlar), ileriye (gelecek hafta);
- espri: haftaya dair tek cümle hafif espri (isteğe bağlı); baslik + ozet (2-3 cümle).
JSON: {"baslik":"…","ozet":"…","onemli":[],"onemsiz":[],"kararlar":[],"acik_meseleler":[],"ileriye":[],"espri":"…"}`;

const AYLIK = (hitap: string) => `${ORTAK(hitap)}
AYLIK RAPOR: Ayın haftalık raporlarından YALNIZ kalıcı değeri olanları süz: büyük gelişmeler, kararlar, tamamlananlar, tekrar eden konular, ay sonunda açık kalanlar. Önemsizleri atla (onemsiz en çok 3 hatıra kalemi).
JSON: {"baslik":"…","ozet":"3-4 cümle","onemli":[],"onemsiz":[],"kararlar":[],"acik_meseleler":[],"ileriye":[],"espri":""}`;

const AY_ADI = (ay: string) => { const [y, a] = ay.split('-').map(Number); return new Date(y, a - 1, 1).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }); };
const liste = (x?: string[]) => (Array.isArray(x) ? x.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().slice(0, 220)) : []);

export function mevcutDonem(tur: RaporTuru, d = new Date()): string {
  return tur === 'gunluk' ? gunAnahtari(d) : tur === 'haftalik' ? isoHafta(d) : ayAnahtari(d);
}

/** Görev 21 düzeltme turu 2: bulut yolunda Gizli kayıtlar sayılmaz (yalnız Gizli notu olan gün için bulut raporu yazılmaz). */
export function donemdeVeriVar(tur: RaporTuru, donem: string): boolean {
  const h = { gizliHaric: isYolu()?.gizliHaric ?? true };
  if (tur === 'gunluk') return gundeMaddeVarMi([donem], h);
  if (tur === 'haftalik') return raporlar({ tur: 'gunluk', donemler: haftaGunleri(donem), limit: 1, ...h }).length > 0 || gundeMaddeVarMi(haftaGunleri(donem), h);
  return raporlar({ tur: 'haftalik', donemler: ayHaftalari(donem), limit: 1, ...h }).length > 0 || raporlar({ tur: 'gunluk', donemler: ayGunleri(donem), limit: 1, ...h }).length > 0;
}

/**
 * Raporu hazırlar (varsa günceller). bildir: günlük raporu ana sohbete yaz + asistanda göster.
 * Gizli mod (Görev 21 düzeltme turu 2): yol işin başında seçilir. Bulut yolunda Gizli maddeler, meseleler, eşlikler ve raporlar HİÇ
 * okunmaz (yeniden yazılan rapor da Gizli içeriksiz olur). Yerel yolda hepsi okunur; okunanlardan biri Gizli ise rapor Gizli bölüme
 * yazılır (sonraki bulut raporları onu görmez) ve sohbete düşen mesajı da Gizli işaretlenir.
 */
export async function raporHazirla(tur: RaporTuru, donem = mevcutDonem(tur), o: { bildir?: boolean; asistanaGonder?: (b: { tur: 'mesaj'; baslik: string; metin: string }) => void } = {}): Promise<Rapor | null> {
  const s = ayarlar().gunKaydi.saklama;
  const hitap = kullaniciHitabi();
  // Motor yoksa (Gizli modda yerel beyin hazır değil dahil) asıl neden söylenir — "çıkaracak not yok" denmez (düzeltme turu 3).
  const yol = isYolu();
  if (!yol) throw motorYokHatasi();
  // Bulut yolunda aynı dönemin Gizli (yerel) raporunun ÜSTÜNE yazılmaz (düzeltme turu 3): Gizli rapor kalır; bulut raporu yazılmaz.
  // Döndürülen rapor yalnız bu bilgisayarın arayüzüne gider; sohbet aracı Gizli raporu süzer (ajan/araclar/gunkaydi.ts).
  if (yol.gizliHaric) { const mevcut = raporGetir(tur, donem); if (mevcut?.gizli) return { ...mevcut, yerelKorundu: true }; }
  const h = { gizliHaric: yol.gizliHaric };
  let gizliOkundu = false;
  const izle = <T extends { gizli?: boolean }>(l: T[]): T[] => { if (l.some((x) => x.gizli)) gizliOkundu = true; return l; };
  let sistem: string, girdi: string, kalemSayisi = 0, sonGun: string;

  if (tur === 'gunluk') {
    const m = izle(maddeler({ gun: donem, ...h })).reverse(); // eskiden yeniye
    if (!m.length) return null;
    kalemSayisi = m.length;
    sonGun = donem;
    const eslik = izle(sonEslikler(20, h).filter((e) => new Date(e.zaman).toLocaleDateString('sv-SE') === donem));
    const acik = izle(meseleler('acik', 30, h));
    sistem = GUNLUK(hitap);
    girdi = [
      `Gün: ${gunAdi(donem)}`,
      'Not maddeleri:', ...m.map((x) => `- [${new Date(x.zaman).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}] (${x.onem}${x.eglenceli ? ', komik' : ''}) ${x.metin}`),
      acik.length ? `\nAçık meseleler:\n${acik.map((x) => `- ${x.baslik}${x.kisi ? ` (${x.kisi})` : ''}${x.hedef ? ` — hedef ${x.hedef}` : ''}`).join('\n')}` : '',
      eslik.length ? `\nFuber'in gün içindeki araya girişleri:\n${eslik.map((e) => `- ${e.metin}`).join('\n')}` : '',
    ].join('\n');
  } else if (tur === 'haftalik') {
    const gunler = haftaGunleri(donem);
    sonGun = gunler[6];
    const gunluk = izle(raporlar({ tur: 'gunluk', donemler: gunler, limit: 7, ...h })).reverse();
    const kapsanan = new Set(gunluk.map((r) => r.donem));
    const eksik = gunler.filter((g) => !kapsanan.has(g));
    const yedek = eksik.length ? izle(maddeler({ gunler: eksik, onem: 'onemli', ...h })).reverse() : [];
    const acikH = izle(meseleler('acik', 30, h));
    if (!gunluk.length && !yedek.length) return null;
    kalemSayisi = gunluk.reduce((t, r) => t + r.onemli.length + r.onemsiz.length, 0) + yedek.length;
    sistem = HAFTALIK(hitap);
    girdi = [
      `Hafta: ${donem} (${gunAdi(gunler[0])} – ${gunAdi(gunler[6])})`,
      ...gunluk.map((r) => `\n## ${gunAdi(r.donem)} — ${r.baslik}\n${r.ozet}\nÖnemli: ${r.onemli.map((x) => x.metin).join(' | ')}\nÖnemsiz: ${r.onemsiz.map((x) => x.metin).join(' | ')}\nKararlar: ${r.kararlar.join(' | ')}\nAçık: ${r.acikMeseleler.join(' | ')}`),
      yedek.length ? `\nRaporu olmayan günlerin önemli notları:\n${yedek.map((x) => `- ${x.gun}: ${x.metin}`).join('\n')}` : '',
      `\nŞu an açık meseleler:\n${acikH.map((x) => `- ${x.baslik}${x.hedef ? ` (hedef ${x.hedef})` : ''}`).join('\n') || '- yok'}`,
    ].join('\n');
  } else {
    const haftalar = ayHaftalari(donem);
    const gunler = ayGunleri(donem);
    sonGun = gunler[gunler.length - 1];
    const haftalik = izle(raporlar({ tur: 'haftalik', donemler: haftalar, limit: 6, ...h })).reverse();
    const kapsananGunler = new Set(haftalik.flatMap((r) => haftaGunleri(r.donem)));
    const gunluk = izle(raporlar({ tur: 'gunluk', donemler: gunler.filter((g) => !kapsananGunler.has(g)), limit: 31, ...h })).reverse();
    if (!haftalik.length && !gunluk.length) return null;
    kalemSayisi = [...haftalik, ...gunluk].reduce((t, r) => t + r.onemli.length, 0);
    sistem = AYLIK(hitap);
    girdi = [
      `Ay: ${AY_ADI(donem)}`,
      ...haftalik.map((r) => `\n## Hafta ${r.donem} — ${r.baslik}\n${r.ozet}\nÖnemli: ${r.onemli.map((x) => x.metin).join(' | ')}\nKararlar: ${r.kararlar.join(' | ')}\nAçık: ${r.acikMeseleler.join(' | ')}`),
      ...gunluk.map((r) => `\n## ${gunAdi(r.donem)} — ${r.baslik}\nÖnemli: ${r.onemli.map((x) => x.metin).join(' | ')}`),
    ].join('\n');
  }

  const { veri, model } = await ajanJson<Cikti>(sistem, girdi, `gunkaydi:rapor-${tur}`, 3500, yol.sabit);
  if (!veri) throw new Error('Raporcu geçerli JSON döndürmedi');
  const [onemliGun, onemsizGun] = tur === 'gunluk' ? [s.onemli, s.onemsiz] : tur === 'haftalik' ? [s.haftalikOnemli, s.haftalikOnemsiz] : [0, 0];
  // Günlük raporun kalemleri en az haftalık rapor yazılana dek yaşar (haftanın önemsizleri de haftalığa girebilsin).
  const enGec = (a: string, b: string) => (a > b ? a : b);
  const haftaSonu = tur === 'gunluk' ? silinmeTarihi(haftaGunleri(isoHafta(new Date(`${donem}T12:00:00`)))[6], 1) : '';
  const bolum = (x: string[], gun: number) => x.map((metin) => (gun ? { metin, silinme: tur === 'gunluk' ? enGec(silinmeTarihi(sonGun, gun), haftaSonu) : silinmeTarihi(sonGun, gun) } : { metin }));
  const varsayilanBaslik = tur === 'gunluk' ? gunAdi(donem) : tur === 'haftalik' ? `${donem} haftası` : AY_ADI(donem);
  const r = raporYaz({
    tur, donem, baslik: (veri.baslik || varsayilanBaslik).slice(0, 140), ozet: (veri.ozet ?? '').slice(0, 800),
    onemli: bolum(liste(veri.onemli), onemliGun), onemsiz: bolum(liste(veri.onemsiz), onemsizGun),
    kararlar: liste(veri.kararlar), acikMeseleler: liste(veri.acik_meseleler), ileriye: liste(veri.ileriye),
    espri: veri.espri?.trim().slice(0, 240) || undefined, maddeSayisi: kalemSayisi, model, ...(gizliOkundu ? { gizli: true } : {}),
  });
  yayinla('kokpit:veri-degisti', {});

  if (o.bildir && tur !== 'aylik' && !sessizMi()) {
    sinyal('rapor', 'ajan', tur === 'gunluk' ? 'günün raporu sohbete' : 'haftanın raporu sohbete');
    const baslikSatiri = tur === 'gunluk' ? '📓 **Günün raporu**' : '🗓️ **Haftanın raporu**';
    const metin = [
      `${baslikSatiri} — ${r.baslik}`, r.ozet,
      r.onemli.length ? `\n**Önemli**\n${r.onemli.slice(0, 6).map((x) => `- ${x.metin}`).join('\n')}` : '',
      r.acikMeseleler.length ? `\n**Bekleyenler**\n${r.acikMeseleler.slice(0, 4).map((x) => `- ${x}`).join('\n')}` : '',
      r.espri ? `\n😄 ${r.espri}` : '',
    ].filter(Boolean).join('\n');
    const ana = anaSohbet();
    const m = mesajEkle(ana, { rol: 'assistant', bloklar: [{ tur: 'metin', metin }], kaynak: 'proaktif', okunmamis: true, ...(gizliOkundu ? { gizli: true } : {}) });
    sohbetOlayi({ tur: 'yeni_mesaj', sohbetId: ana, mesaj: gorunume([m])[0] });
    o.asistanaGonder?.({ tur: 'mesaj', baslik: tur === 'gunluk' ? 'Günün raporu hazır' : 'Haftanın raporu hazır', metin: `${r.baslik}\n\n${r.ozet}${r.espri ? `\n\n😄 ${r.espri}` : ''}` });
  }
  return r;
}

export { raporGetir };
