// ── Düşünme motoru deposu: döküm satırları, not maddeleri, raporlar, meseleler, eşlikler ────────────────────────
// Ses HİÇ saklanmaz; yalnız yazıya dökülmüş satırlar (saklama süresi kadar). Tam metin dizinleri hafızayla aynı
// Türkçe sadeleştirmeyi kullanır ("köfte" araması "köftesi"ni bulur).
import { veritabani, simdi } from '../vt.js';
import { sadelestir, ftsSorgusu } from '../hafiza/normal.js';
import { gunAnahtari } from './donem.js';
import type { DokumSatiri, NotMaddesi, Rapor, RaporTuru, Mesele, Onem } from '../../shared/tipler.js';

type S = Record<string, unknown>;

/** Gizli bölüm (Görev 21 düzeltme turu 2): Gizli mod açıkken oluşan kayıtlar `gizli = 1`. Bulut işleri (rapor, eşlikçi, not tutucu,
 *  kokpit planı, sohbet araçları) okurken `gizliHaric: true` verir; yerel beyin ve arayüz hepsini görür. */
export interface Suzgec { gizliHaric?: boolean }
const gizliMi = (r: S) => (Number(r.gizli ?? 0) === 1 ? { gizli: true } : {});

// ── Döküm ──
export function satirEkle(metin: string, motor: string, sure?: number, zaman = new Date(), gizli = false): DokumSatiri {
  const z = zaman.toISOString();
  const id = Number(veritabani().prepare('INSERT INTO dokum(zaman, gun, metin, motor, sure, gizli) VALUES(?,?,?,?,?,?)').run(z, gunAnahtari(zaman), metin, motor, sure ?? null, gizli ? 1 : 0).lastInsertRowid);
  veritabani().prepare('INSERT INTO dokum_ara(rowid, metin) VALUES(?, ?)').run(id, sadelestir(metin));
  return { id, zaman: z, metin, motor, ...(gizli ? { gizli: true } : {}) };
}
const satir = (r: S): DokumSatiri => ({ id: Number(r.id), zaman: String(r.zaman), metin: String(r.metin), motor: String(r.motor ?? ''), ...gizliMi(r) });
export function gunDokumu(gun: string): DokumSatiri[] {
  return (veritabani().prepare('SELECT * FROM dokum WHERE gun = ? ORDER BY id').all(gun) as S[]).map(satir);
}
/** `yalnizGizli`: yalnız Gizli satırlar (Gizli mod kapanırken yerelde notlanacaklar; düzeltme turu 4: önlerindeki yüzlerce Gizli olmayan
 *  satır sınırı doldurup onları gizlemesin). */
export function notlanmamisSatirlar(limit = 400, o: Suzgec & { yalnizGizli?: boolean } = {}): DokumSatiri[] {
  const k = o.yalnizGizli ? ' AND gizli = 1' : o.gizliHaric ? ' AND gizli = 0' : '';
  return (veritabani().prepare(`SELECT * FROM dokum WHERE notlandi = 0${k} ORDER BY id LIMIT ?`).all(limit) as S[]).map(satir);
}
/** Verilen satırlar notlandı (yalnız bunlar: bulut turunda atlanan Gizli satırlar notlanmamış kalır, yerel beyin sonra işler). */
export function satirlariNotlandir(idler: number[]): void {
  if (!idler.length) return;
  veritabani().prepare(`UPDATE dokum SET notlandi = 1 WHERE id IN (${idler.map(() => '?').join(',')})`).run(...idler);
}
export function sonSatirlar(n: number): DokumSatiri[] {
  return (veritabani().prepare('SELECT * FROM (SELECT * FROM dokum ORDER BY id DESC LIMIT ?) ORDER BY id').all(n) as S[]).map(satir);
}
export function dokumAra(sorgu: string, limit = 8, o: Suzgec = {}): DokumSatiri[] {
  const q = ftsSorgusu(sorgu);
  if (!q) return [];
  return (veritabani().prepare(`SELECT d.* FROM dokum_ara a JOIN dokum d ON d.id = a.rowid WHERE dokum_ara MATCH ?${o.gizliHaric ? ' AND d.gizli = 0' : ''} ORDER BY rank LIMIT ?`).all(q, limit) as S[]).map(satir);
}

// ── Not maddeleri ──
const madde = (r: S): NotMaddesi => ({
  id: Number(r.id), gun: String(r.gun), zaman: String(r.zaman), metin: String(r.metin), onem: String(r.onem) as Onem,
  konu: r.konu ? String(r.konu) : undefined, kisiler: JSON.parse(String(r.kisiler || '[]')), eglenceli: Boolean(r.eglenceli),
  satirlar: String(r.satirlar ?? ''), silinme: String(r.silinme), ...gizliMi(r),
});
export function maddeEkle(m: Omit<NotMaddesi, 'id'>): NotMaddesi {
  const id = Number(veritabani().prepare('INSERT INTO not_maddeleri(gun, zaman, metin, onem, konu, kisiler, eglenceli, satirlar, silinme, olusturma, gizli) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(m.gun, m.zaman, m.metin, m.onem, m.konu ?? null, JSON.stringify(m.kisiler ?? []), m.eglenceli ? 1 : 0, m.satirlar, m.silinme, simdi(), m.gizli ? 1 : 0).lastInsertRowid);
  veritabani().prepare('INSERT INTO madde_ara(rowid, metin, konu) VALUES(?,?,?)').run(id, sadelestir(m.metin), sadelestir(m.konu ?? ''));
  return { ...m, id };
}
export function maddeler(o: { gun?: string; gunler?: string[]; onem?: Onem; limit?: number } & Suzgec = {}): NotMaddesi[] {
  const k: string[] = ['silinme > ?'];
  const p: (string | number)[] = [simdi()];
  if (o.gun) { k.push('gun = ?'); p.push(o.gun); }
  if (o.gunler?.length) { k.push(`gun IN (${o.gunler.map(() => '?').join(',')})`); p.push(...o.gunler); }
  if (o.onem) { k.push('onem = ?'); p.push(o.onem); }
  if (o.gizliHaric) k.push('gizli = 0');
  p.push(o.limit ?? 500);
  return (veritabani().prepare(`SELECT * FROM not_maddeleri WHERE ${k.join(' AND ')} ORDER BY zaman DESC, id DESC LIMIT ?`).all(...p) as S[]).map(madde);
}
export function maddeAra(sorgu: string, limit = 10, o: Suzgec = {}): NotMaddesi[] {
  const q = ftsSorgusu(sorgu);
  if (!q) return [];
  return (veritabani().prepare(`SELECT m.* FROM madde_ara a JOIN not_maddeleri m ON m.id = a.rowid WHERE madde_ara MATCH ? AND m.silinme > ?${o.gizliHaric ? ' AND m.gizli = 0' : ''} ORDER BY rank LIMIT ?`).all(q, simdi(), limit) as S[]).map(madde);
}
export function gundeMaddeVarMi(gunler: string[], o: Suzgec = {}): boolean {
  if (!gunler.length) return false;
  return Boolean(veritabani().prepare(`SELECT 1 FROM not_maddeleri WHERE gun IN (${gunler.map(() => '?').join(',')})${o.gizliHaric ? ' AND gizli = 0' : ''} LIMIT 1`).get(...gunler));
}
/** Süresi dolan maddeler (ve dizin girdileri) silinir. Silinen sayısı döner. */
export function suresiDolanMaddeleriSil(): number {
  const vt = veritabani();
  const ids = (vt.prepare('SELECT id FROM not_maddeleri WHERE silinme <= ?').all(simdi()) as S[]).map((r) => Number(r.id));
  for (const id of ids) { vt.prepare('DELETE FROM madde_ara WHERE rowid = ?').run(id); vt.prepare('DELETE FROM not_maddeleri WHERE id = ?').run(id); }
  return ids.length;
}
/** Notlandırılmış ve saklama süresi dolmuş ham döküm silinir. Gizli satırlar notlanmamış olsa da süresi dolunca silinir: yalnız yerel
 *  beyin işleyebilir; Gizli mod bir daha açılmadıysa sonsuza dek birikmesin (saklama süresi sözü). */
export function eskiDokumuSil(gunOnce: string): number {
  const vt = veritabani();
  const ids = (vt.prepare('SELECT id FROM dokum WHERE gun < ? AND (notlandi = 1 OR gizli = 1)').all(gunOnce) as S[]).map((r) => Number(r.id));
  for (const id of ids) { vt.prepare('DELETE FROM dokum_ara WHERE rowid = ?').run(id); vt.prepare('DELETE FROM dokum WHERE id = ?').run(id); }
  return ids.length;
}

// ── Raporlar ── (yapi: bölümler; önemsiz/önemli kalemlerin kendi silinme tarihi olabilir)
const rapor = (r: S): Rapor => {
  const y = JSON.parse(String(r.yapi || '{}'));
  return {
    id: Number(r.id), tur: String(r.tur) as RaporTuru, donem: String(r.donem), baslik: String(r.baslik), ozet: String(r.ozet ?? ''),
    onemli: y.onemli ?? [], onemsiz: y.onemsiz ?? [], kararlar: y.kararlar ?? [], acikMeseleler: y.acikMeseleler ?? [], ileriye: y.ileriye ?? [],
    espri: y.espri || undefined, maddeSayisi: Number(r.madde_sayisi ?? 0), model: r.model ? String(r.model) : undefined,
    olusturma: String(r.olusturma), guncelleme: String(r.guncelleme), ...gizliMi(r),
  };
};
/** Rapor yeniden yazılınca `gizli` da yeniden belirlenir: bulut yolunda Gizli kayıtlar olmadan yazılan rapor gizli değildir. */
export function raporYaz(r: Omit<Rapor, 'id' | 'olusturma' | 'guncelleme'>): Rapor {
  const vt = veritabani();
  const yapi = JSON.stringify({ onemli: r.onemli, onemsiz: r.onemsiz, kararlar: r.kararlar, acikMeseleler: r.acikMeseleler, ileriye: r.ileriye, espri: r.espri });
  const z = simdi();
  vt.prepare(`INSERT INTO raporlar(tur, donem, baslik, ozet, yapi, madde_sayisi, model, olusturma, guncelleme, gizli) VALUES(?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(tur, donem) DO UPDATE SET baslik = excluded.baslik, ozet = excluded.ozet, yapi = excluded.yapi, madde_sayisi = excluded.madde_sayisi,
    model = excluded.model, guncelleme = excluded.guncelleme, gizli = excluded.gizli`).run(r.tur, r.donem, r.baslik, r.ozet, yapi, r.maddeSayisi, r.model ?? null, z, z, r.gizli ? 1 : 0);
  const kayit = rapor(vt.prepare('SELECT * FROM raporlar WHERE tur = ? AND donem = ?').get(r.tur, r.donem) as S);
  vt.prepare('DELETE FROM rapor_ara WHERE rowid = ?').run(kayit.id);
  vt.prepare('INSERT INTO rapor_ara(rowid, baslik, icerik) VALUES(?,?,?)').run(kayit.id, sadelestir(r.baslik), sadelestir([r.ozet, ...r.onemli.map((x) => x.metin), ...r.onemsiz.map((x) => x.metin), ...r.kararlar, ...r.acikMeseleler].join('\n')));
  return kayit;
}
export function raporGetir(tur: RaporTuru, donem: string, o: Suzgec = {}): Rapor | null {
  const r = veritabani().prepare(`SELECT * FROM raporlar WHERE tur = ? AND donem = ?${o.gizliHaric ? ' AND gizli = 0' : ''}`).get(tur, donem) as S | undefined;
  return r ? rapor(r) : null;
}
export function raporlar(o: { tur?: RaporTuru; limit?: number; donemler?: string[] } & Suzgec = {}): Rapor[] {
  const k: string[] = [];
  const p: (string | number)[] = [];
  if (o.tur) { k.push('tur = ?'); p.push(o.tur); }
  if (o.donemler?.length) { k.push(`donem IN (${o.donemler.map(() => '?').join(',')})`); p.push(...o.donemler); }
  if (o.gizliHaric) k.push('gizli = 0');
  p.push(o.limit ?? 30);
  return (veritabani().prepare(`SELECT * FROM raporlar ${k.length ? `WHERE ${k.join(' AND ')}` : ''} ORDER BY donem DESC, id DESC LIMIT ?`).all(...p) as S[]).map(rapor);
}
export function raporAra(sorgu: string, limit = 4, o: Suzgec = {}): Rapor[] {
  const q = ftsSorgusu(sorgu);
  if (!q) return [];
  return (veritabani().prepare(`SELECT r.* FROM rapor_ara a JOIN raporlar r ON r.id = a.rowid WHERE rapor_ara MATCH ?${o.gizliHaric ? ' AND r.gizli = 0' : ''} ORDER BY rank LIMIT ?`).all(q, limit) as S[]).map(rapor);
}
/** Raporların süresi dolan kalemlerini ayıklar (haftalık raporun önemsizleri 1 hafta, önemlileri 1 ay…). */
export function raporKalemleriniBuda(): number {
  const vt = veritabani();
  const z = simdi();
  let n = 0;
  for (const r of vt.prepare('SELECT id, yapi FROM raporlar').all() as S[]) {
    const y = JSON.parse(String(r.yapi || '{}'));
    let degisti = false;
    for (const k of ['onemli', 'onemsiz'] as const) {
      const once = (y[k] ?? []).length;
      y[k] = (y[k] ?? []).filter((x: { silinme?: string }) => !x.silinme || x.silinme > z);
      if (y[k].length !== once) { degisti = true; n += once - y[k].length; }
    }
    if (degisti) vt.prepare('UPDATE raporlar SET yapi = ? WHERE id = ?').run(JSON.stringify(y), Number(r.id));
  }
  return n;
}

// ── Meseleler ──
const mesele = (r: S): Mesele => ({
  id: Number(r.id), baslik: String(r.baslik), ayrinti: r.ayrinti ? String(r.ayrinti) : undefined, kisi: r.kisi ? String(r.kisi) : undefined,
  ilkGun: String(r.ilk_gun), hedef: r.hedef ? String(r.hedef) : undefined, durum: String(r.durum) as Mesele['durum'],
  kapanis: r.kapanis ? String(r.kapanis) : undefined, kaynak: r.kaynak ? String(r.kaynak) : undefined, guncelleme: String(r.guncelleme),
  ...gizliMi(r),
});
export function meseleler(durum: 'acik' | 'kapandi' | 'hepsi' = 'acik', limit = 100, o: Suzgec = {}): Mesele[] {
  const k = [durum === 'hepsi' ? '' : durum === 'acik' ? "durum = 'acik'" : "durum != 'acik'", o.gizliHaric ? 'gizli = 0' : ''].filter(Boolean);
  return (veritabani().prepare(`SELECT * FROM meseleler ${k.length ? `WHERE ${k.join(' AND ')}` : ''} ORDER BY CASE WHEN hedef IS NULL THEN 1 ELSE 0 END, hedef, id DESC LIMIT ?`).all(limit) as S[]).map(mesele);
}
export function meseleGetir(id: number): Mesele | null {
  const r = veritabani().prepare('SELECT * FROM meseleler WHERE id = ?').get(id) as S | undefined;
  return r ? mesele(r) : null;
}
export function meseleEkle(m: { baslik: string; ayrinti?: string; kisi?: string; ilkGun: string; hedef?: string; kaynak?: string; gizli?: boolean }): Mesele {
  const z = simdi();
  const id = Number(veritabani().prepare('INSERT INTO meseleler(baslik, ayrinti, kisi, ilk_gun, hedef, kaynak, olusturma, guncelleme, gizli) VALUES(?,?,?,?,?,?,?,?,?)')
    .run(m.baslik, m.ayrinti ?? null, m.kisi ?? null, m.ilkGun, m.hedef ?? null, m.kaynak ?? null, z, z, m.gizli ? 1 : 0).lastInsertRowid);
  return meseleGetir(id)!;
}
/** `gizli: true`: Gizli bir döküm bu meseleyi güncelledi — mesele de Gizli bölüme geçer (geri dönmez; içeriğine gizli bilgi karıştı). */
export function meseleGuncelle(id: number, d: Partial<Pick<Mesele, 'durum' | 'hedef' | 'baslik' | 'ayrinti'>> & { kaynakEk?: string; gizli?: boolean }): Mesele | null {
  const e = meseleGetir(id);
  if (!e) return null;
  const durum = d.durum ?? e.durum;
  const kapanis = durum !== 'acik' && e.durum === 'acik' ? simdi() : durum === 'acik' ? null : e.kapanis ?? null;
  const kaynak = d.kaynakEk ? [e.kaynak, d.kaynakEk].filter(Boolean).join(', ').slice(-400) : e.kaynak ?? null;
  veritabani().prepare('UPDATE meseleler SET baslik = ?, ayrinti = ?, hedef = ?, durum = ?, kapanis = ?, kaynak = ?, guncelleme = ?, gizli = ? WHERE id = ?')
    .run(d.baslik ?? e.baslik, d.ayrinti ?? e.ayrinti ?? null, d.hedef === undefined ? e.hedef ?? null : d.hedef || null, durum, kapanis, kaynak, simdi(), e.gizli || d.gizli ? 1 : 0, id);
  return meseleGetir(id);
}

// ── Eşlikler (Fuber'in araya girmesi) ──
export function eslikEkle(e: { tetik: string; metin: string; tur: string; kaynaklar?: string[]; gizli?: boolean }): void {
  veritabani().prepare('INSERT INTO eslikler(zaman, tetik, metin, tur, kaynaklar, gizli) VALUES(?,?,?,?,?,?)').run(simdi(), e.tetik, e.metin, e.tur, JSON.stringify(e.kaynaklar ?? []), e.gizli ? 1 : 0);
}
export function sonEslikler(n = 5, o: Suzgec = {}): { zaman: string; metin: string; tur: string; tetik: string; gizli?: boolean }[] {
  return (veritabani().prepare(`SELECT zaman, metin, tur, tetik, gizli FROM eslikler${o.gizliHaric ? ' WHERE gizli = 0' : ''} ORDER BY id DESC LIMIT ?`).all(n) as S[]).map((r) => ({ zaman: String(r.zaman), metin: String(r.metin), tur: String(r.tur), tetik: String(r.tetik), ...gizliMi(r) }));
}
export function eslikSayisi(sonra: string): number {
  return Number((veritabani().prepare('SELECT COUNT(*) n FROM eslikler WHERE zaman >= ?').get(sonra) as S).n);
}

export function gunSayaclari(gun: string): { satir: number; madde: number; onemli: number } {
  const vt = veritabani();
  return {
    satir: Number((vt.prepare('SELECT COUNT(*) n FROM dokum WHERE gun = ?').get(gun) as S).n),
    madde: Number((vt.prepare('SELECT COUNT(*) n FROM not_maddeleri WHERE gun = ? AND silinme > ?').get(gun, simdi()) as S).n),
    onemli: Number((vt.prepare("SELECT COUNT(*) n FROM not_maddeleri WHERE gun = ? AND onem = 'onemli' AND silinme > ?").get(gun, simdi()) as S).n),
  };
}

/** Kullanıcının "kayıtları sil" isteği. */
export function gunKaydiniSil(kapsam: 'bugun-dokum' | 'tum-dokum' | 'hepsi'): void {
  const vt = veritabani();
  if (kapsam === 'bugun-dokum') {
    const g = gunAnahtari(new Date());
    for (const r of vt.prepare('SELECT id FROM dokum WHERE gun = ?').all(g) as S[]) vt.prepare('DELETE FROM dokum_ara WHERE rowid = ?').run(Number(r.id));
    vt.prepare('DELETE FROM dokum WHERE gun = ?').run(g);
    return;
  }
  vt.exec('DELETE FROM dokum; DELETE FROM dokum_ara;');
  if (kapsam === 'hepsi') vt.exec('DELETE FROM not_maddeleri; DELETE FROM madde_ara; DELETE FROM raporlar; DELETE FROM rapor_ara; DELETE FROM meseleler; DELETE FROM eslikler;');
}
