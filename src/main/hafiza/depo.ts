// ── Hafıza deposu ────────────────────────────────────────────────────────────────────────────────────────────
// Üç katman (Claude'un hafızası gibi düşün):
//  1. ÇEKİRDEK (sabit=1): kim olduğun, nasıl çalıştığın, kalıcı kurallar. Her istekte sistem bölümüne girer; küçük
//     tutulur (≈1.500 token tavanı), önbelleğe alınır, her mesajda yeniden faturalanmaz.
//  2. HAFIZA KAYITLARI: projeler, kişiler, olaylar, tercihler, bilgiler. Her turda YALNIZ ilgili olanlar (bm25 +
//     önem + yenilik + tarih süzgeci) kısa bir bağlam bloğu olarak eklenir; daha fazlası gerekirse model `hafiza_ara`
//     aracını çağırır. Hafızanın tamamı asla prompta dökülmez ("token eritmez").
//  3. HAM KAYIT: bütün mesajlar ve içe aktarılan belgeler tam metin dizinli; atıflı aranabilir.
// Her kayıt [H-12 · 2026-10-18] biçiminde atıflanır; kaynak alanı nereden geldiğini (sohbet/mesaj/dosya) tutar.
import { veritabani, simdi, yerelGun } from '../vt.js';
import { sadelestir, ftsSorgusu, tarihAraligi, tokenTahmini } from './normal.js';
import type { HafizaKaydi, HafizaTuru, Atif } from '../../shared/tipler.js';
import { kaynakEtiketi, kaynakBirlestir, kullaniciKaynakliMi } from '../../shared/hafiza-kaynak.js';
import { benzerlik, benzerlikKumesi, kumeBenzerligi, ozKonusmaMi, BUDAMA_BIRLESTIR, SABIT_TAVANI, CANLI_KAYIT_BUTCESI } from '../../shared/hafiza-kurali.ts';

type Satir = Record<string, unknown>;

function kayda(s: Satir): HafizaKaydi {
  return {
    id: Number(s.id),
    tur: s.tur as HafizaTuru,
    baslik: String(s.baslik),
    icerik: String(s.icerik),
    etiketler: JSON.parse(String(s.etiketler || '[]')),
    onem: Number(s.onem),
    sabit: Boolean(s.sabit),
    kaynak: String(s.kaynak || ''),
    olayTarihi: (s.olay_tarihi as string) || undefined,
    olusturma: String(s.olusturma),
    guncelleme: String(s.guncelleme),
  };
}

function dizinle(id: number, baslik: string, icerik: string, etiketler: string[]): void {
  const vt = veritabani();
  vt.prepare('DELETE FROM hafiza_ara WHERE rowid = ?').run(id);
  vt.prepare('INSERT INTO hafiza_ara(rowid, baslik, icerik, etiketler) VALUES(?, ?, ?, ?)').run(
    id, sadelestir(baslik), sadelestir(icerik), sadelestir(etiketler.join(' ')),
  );
}

export interface YeniHafiza {
  tur: HafizaTuru;
  baslik: string;
  icerik: string;
  etiketler?: string[];
  onem?: number;
  sabit?: boolean;
  kaynak?: string;
  olayTarihi?: string;
}

export function hafizaEkle(h: YeniHafiza): HafizaKaydi {
  const vt = veritabani();
  const z = simdi();
  const etiket = (h.etiketler ?? []).slice(0, 12);
  const r = vt
    .prepare(`INSERT INTO hafizalar(tur, baslik, icerik, etiketler, onem, sabit, kaynak, olay_tarihi, olusturma, guncelleme)
              VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(h.tur, h.baslik.slice(0, 200), h.icerik.slice(0, 4000), JSON.stringify(etiket), clamp(h.onem ?? 3, 1, 5), h.sabit ? 1 : 0, h.kaynak ?? '', h.olayTarihi ?? null, z, z);
  const id = Number(r.lastInsertRowid);
  dizinle(id, h.baslik, h.icerik, etiket);
  return hafizaGetir(id)!;
}

export function hafizaGuncelle(id: number, d: Partial<YeniHafiza>): HafizaKaydi | null {
  const eski = hafizaGetir(id);
  if (!eski) return null;
  const yeni = {
    tur: d.tur ?? eski.tur,
    baslik: (d.baslik ?? eski.baslik).slice(0, 200),
    icerik: (d.icerik ?? eski.icerik).slice(0, 4000),
    etiketler: (d.etiketler ?? eski.etiketler).slice(0, 12),
    onem: clamp(d.onem ?? eski.onem, 1, 5),
    sabit: d.sabit ?? eski.sabit,
    olayTarihi: d.olayTarihi ?? eski.olayTarihi ?? null,
    // Zaten kayıtlı kaynak yeniden eklenmez ("sohbet:3, sohbet:3, …" birikmesin); 400 karakteri aşınca kullanıcıdan gelen etiket
    // ("kurulum", "kullanici", "ayarlar") hep kalır, en eski öteki parçalar düşer (düzeltme turu 2: `.slice(-400)` baştaki etiketi kesiyordu).
    kaynak: d.kaynak ? kaynakBirlestir(eski.kaynak, d.kaynak) : eski.kaynak,
  };
  veritabani()
    .prepare(`UPDATE hafizalar SET tur=?, baslik=?, icerik=?, etiketler=?, onem=?, sabit=?, olay_tarihi=?, kaynak=?, guncelleme=? WHERE id=?`)
    .run(yeni.tur, yeni.baslik, yeni.icerik, JSON.stringify(yeni.etiketler), yeni.onem, yeni.sabit ? 1 : 0, yeni.olayTarihi, yeni.kaynak, simdi(), id);
  dizinle(id, yeni.baslik, yeni.icerik, yeni.etiketler);
  return hafizaGetir(id);
}

export function hafizaSil(id: number): boolean {
  const vt = veritabani();
  const r = vt.prepare('UPDATE hafizalar SET silindi = 1, guncelleme = ? WHERE id = ? AND silindi = 0').run(simdi(), id);
  vt.prepare('DELETE FROM hafiza_ara WHERE rowid = ?').run(id);
  return Number(r.changes) > 0;
}

export function hafizaGetir(id: number): HafizaKaydi | null {
  const s = veritabani().prepare('SELECT * FROM hafizalar WHERE id = ? AND silindi = 0').get(id) as Satir | undefined;
  return s ? kayda(s) : null;
}

export function hafizaListesi(o: { tur?: string; sabit?: boolean; limit?: number; sayfa?: number } = {}): HafizaKaydi[] {
  const kosul: string[] = ['silindi = 0'];
  const p: (string | number)[] = [];
  if (o.tur) { kosul.push('tur = ?'); p.push(o.tur); }
  if (o.sabit !== undefined) { kosul.push('sabit = ?'); p.push(o.sabit ? 1 : 0); }
  const limit = o.limit ?? 200;
  p.push(limit, (o.sayfa ?? 0) * limit);
  return (veritabani().prepare(`SELECT * FROM hafizalar WHERE ${kosul.join(' AND ')} ORDER BY sabit DESC, guncelleme DESC LIMIT ? OFFSET ?`).all(...p) as Satir[]).map(kayda);
}

export function hafizaSayisi(): number {
  return Number((veritabani().prepare('SELECT COUNT(*) n FROM hafizalar WHERE silindi = 0').get() as { n: number }).n);
}

// ── Arama ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface AramaSecenegi {
  sorgu: string;
  tur?: string;
  baslangic?: string;
  bitis?: string;
  limit?: number;
  dokun?: boolean; // erişim sayacını artır (bağlama girenler için)
}

export interface Bulgu extends HafizaKaydi { puan: number }

export function hafizaAra(o: AramaSecenegi): Bulgu[] {
  const vt = veritabani();
  const limit = Math.min(o.limit ?? 8, 40);
  const tarih = o.baslangic ? { baslangic: o.baslangic, bitis: o.bitis ?? simdi() } : tarihAraligi(o.sorgu);
  const fts = ftsSorgusu(o.sorgu);
  let satirlar: (Satir & { bm?: number })[] = [];
  if (fts) {
    satirlar = vt
      .prepare(`SELECT h.*, bm25(hafiza_ara, 5.0, 1.0, 2.0) bm FROM hafiza_ara JOIN hafizalar h ON h.id = hafiza_ara.rowid
                WHERE hafiza_ara MATCH ? AND h.silindi = 0 ${o.tur ? 'AND h.tur = ?' : ''} ORDER BY bm LIMIT 80`)
      .all(...(o.tur ? [fts, o.tur] : [fts])) as (Satir & { bm?: number })[];
  }
  // Tarih ifadesi varsa o aralıkta güncellenen/olan kayıtlar da adaydır (kelime eşleşmese bile).
  if (tarih) {
    const ek = vt
      .prepare(`SELECT * FROM hafizalar WHERE silindi = 0 AND ((olay_tarihi >= ? AND olay_tarihi < ?) OR (guncelleme >= ? AND guncelleme < ?)) LIMIT 60`)
      .all(tarih.baslangic, tarih.bitis, tarih.baslangic, tarih.bitis) as Satir[];
    for (const e of ek) if (!satirlar.some((s) => s.id === e.id)) satirlar.push({ ...e, bm: 0 });
  }
  const now = Date.now();
  const puanli = satirlar.map((s) => {
    const k = kayda(s);
    const metin = -(Number(s.bm ?? 0)); // bm25 negatif: küçük = iyi → işaret çevrilir
    const gun = Math.max(0, (now - Date.parse(k.guncelleme)) / 86_400_000);
    const yenilik = 1 / (1 + gun / 30); // 30 günde yarıya
    let tarihBonus = 0;
    if (tarih) {
      const t = k.olayTarihi ?? k.guncelleme;
      if (t >= tarih.baslangic && t < tarih.bitis) tarihBonus = 2.5;
    }
    const puan = metin * 1.0 + k.onem * 0.35 + (k.sabit ? 0.6 : 0) + yenilik * 0.8 + tarihBonus;
    return { ...k, puan };
  });
  puanli.sort((a, b) => b.puan - a.puan);
  const sonuc = puanli.slice(0, limit);
  if (o.dokun && sonuc.length) {
    const z = simdi();
    const st = vt.prepare('UPDATE hafizalar SET son_erisim = ?, erisim_sayisi = erisim_sayisi + 1 WHERE id = ?');
    for (const s of sonuc) st.run(z, s.id);
  }
  return sonuc;
}

/** Konuşma kayıtlarında (bütün sohbetler) tam metin arama: "geçen hafta ne demiştim" türü sorular. */
export function mesajAra(sorgu: string, limit = 6, haric?: number): { id: number; sohbetId: number; rol: string; metin: string; zaman: string }[] {
  const fts = ftsSorgusu(sorgu);
  if (!fts) return [];
  const tarih = tarihAraligi(sorgu);
  const satirlar = veritabani()
    .prepare(`SELECT m.id, m.sohbet_id, m.rol, m.metin, m.olusturma FROM mesaj_ara JOIN mesajlar m ON m.id = mesaj_ara.rowid
              WHERE mesaj_ara MATCH ? AND m.gizli = 0 ${haric ? 'AND m.sohbet_id != ?' : ''} ${tarih ? 'AND m.olusturma >= ? AND m.olusturma < ?' : ''}
              ORDER BY bm25(mesaj_ara) LIMIT ?`)
    .all(...([fts, ...(haric ? [haric] : []), ...(tarih ? [tarih.baslangic, tarih.bitis] : []), limit] as (string | number)[])) as Satir[];
  return satirlar.map((s) => ({ id: Number(s.id), sohbetId: Number(s.sohbet_id), rol: String(s.rol), metin: String(s.metin), zaman: String(s.olusturma) }));
}

/** İçe aktarılan belgelerde arama. */
export function belgeAra(sorgu: string, limit = 4): { belgeId: number; ad: string; metin: string; tarih: string }[] {
  const fts = ftsSorgusu(sorgu);
  if (!fts) return [];
  return (veritabani()
    .prepare(`SELECT p.belge_id, b.ad, p.metin, b.olusturma FROM parca_ara JOIN parcalar p ON p.id = parca_ara.rowid
              JOIN belgeler b ON b.id = p.belge_id WHERE parca_ara MATCH ? ORDER BY bm25(parca_ara) LIMIT ?`)
    .all(fts, limit) as Satir[]).map((s) => ({ belgeId: Number(s.belge_id), ad: String(s.ad), metin: String(s.metin), tarih: String(s.olusturma) }));
}

export function mesajDizinle(id: number, metin: string): void {
  if (!metin.trim()) return;
  veritabani().prepare('INSERT INTO mesaj_ara(rowid, metin) VALUES(?, ?)').run(id, sadelestir(metin).slice(0, 20000));
}

// ── Bağlam ───────────────────────────────────────────────────────────────────────────────────────────────────
const tarihKisa = (iso: string) => (iso ? yerelGun(iso) : '');
export const atifEtiketi = (h: { id: number; olayTarihi?: string; guncelleme: string }) => `H-${h.id} · ${tarihKisa(h.olayTarihi ?? h.guncelleme)}`;

/** Çekirdek hafıza metni (sistem bölümü). Önbellek dostu: zaman damgası yok; sıra yalnız kayıt değişince değişir.
 *  11 Kas analizi #4, #11: önce kullanıcının açık TERCİHLERİ (rapor biçimi, hitap, saat), sonra kullanıcıdan gelenler, sonra önem; eşit önemde
 *  YENİ kayıt önce (eskiden en yeniler bütçe aşılınca sessizce düşüyordu). En çok SABIT_TAVANI satır; sığmayan sayısı günlüğe yazılır. */
export function cekirdekMetni(butce = 1500): string {
  const sabitler = (veritabani().prepare(`SELECT * FROM hafizalar WHERE sabit = 1 AND silindi = 0
    ORDER BY (tur = 'tercih') DESC, (kaynak LIKE '%kurulum%' OR kaynak LIKE '%kullanici%' OR kaynak LIKE '%ayarlar%') DESC, onem DESC, guncelleme DESC, id DESC`).all() as Satir[]).map(kayda);
  const satirlar: string[] = [];
  let toplam = 0;
  for (const h of sabitler.slice(0, SABIT_TAVANI)) {
    // I6: kaynak her satırda ("(kurulum)", "(sen söyledin)", "(sohbetten)"…; shared/hafiza-kaynak.ts): kullanıcıdan gelen kayıt silinmez.
    const s = `- [H-${h.id}] (${h.tur}; ${kaynakEtiketi(h.kaynak)}) ${h.baslik}: ${h.icerik}`;
    if (toplam + tokenTahmini(s) > butce) continue; // uzun bir satır yüzünden arkadaki kısa tercihler düşmesin
    toplam += tokenTahmini(s);
    satirlar.push(s);
  }
  const dusen = sabitler.length - satirlar.length;
  if (dusen > 0 && dusen !== sonDusenCekirdek) console.warn(`[hafıza] çekirdeğe sığmayan sabit kayıt: ${dusen}`);
  sonDusenCekirdek = dusen;
  return satirlar.join('\n');
}
let sonDusenCekirdek = 0;

// ── Arşiv (11 Kas analizi #1: silmek yerine arşivle — kullanıcının verisi geri alınabilir kalır) ────────────────────────────────────────────
// `silindi`: 0 canlı · 1 silindi (kullanıcı/model sildi, belge silindi) · 2 ARŞİV (budama, birleştirme ya da güncellemenin eski sürümü). Arşiv
// aramaya, bağlama ve listelere girmez; `hafizaArsivdenGeriAl` ile canlıya döner. Hiçbir yol arşivi kendiliğinden silmez.
export const ARSIV = 2;

/** Kaydı arşive taşır (canlıdan çıkar, dizinden düşer). */
export function hafizaArsivle(id: number): boolean {
  const vt = veritabani();
  const r = vt.prepare(`UPDATE hafizalar SET silindi = ${ARSIV}, guncelleme = ? WHERE id = ? AND silindi = 0`).run(simdi(), id);
  vt.prepare('DELETE FROM hafiza_ara WHERE rowid = ?').run(id);
  return Number(r.changes) > 0;
}

/** Arşivdeki kaydı canlıya döndürür. */
export function hafizaArsivdenGeriAl(id: number): HafizaKaydi | null {
  const vt = veritabani();
  const r = vt.prepare(`UPDATE hafizalar SET silindi = 0 WHERE id = ? AND silindi = ${ARSIV}`).run(id);
  if (!Number(r.changes)) return null;
  const h = hafizaGetir(id);
  if (h) dizinle(id, h.baslik, h.icerik, h.etiketler);
  return h;
}

/** Arşivdeki kayıtlar (en yeni önce). */
export function arsivListesi(limit = 200): HafizaKaydi[] {
  return (veritabani().prepare(`SELECT * FROM hafizalar WHERE silindi = ${ARSIV} ORDER BY guncelleme DESC LIMIT ?`).all(limit) as Satir[]).map(kayda);
}

/** Güncellemeden önce eski sürümün arşiv kopyası (yeni söz eskiyi ezer ama eski kaybolmaz). */
export function surumuArsivle(h: HafizaKaydi): void {
  if (!h.icerik.trim()) return;
  veritabani()
    .prepare(`INSERT INTO hafizalar(tur, baslik, icerik, etiketler, onem, sabit, kaynak, olay_tarihi, olusturma, guncelleme, silindi)
              VALUES(?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ${ARSIV})`)
    .run(h.tur, h.baslik, h.icerik, JSON.stringify(h.etiketler), h.onem, `${h.kaynak ? `${h.kaynak}, ` : ''}surum:H-${h.id}`.slice(0, 400), h.olayTarihi ?? null, h.olusturma, simdi());
}

/** Yeni kaydın canlı hafızadaki en yakın eşi (aynı tür önce; köklü sözcük benzerliği, shared/hafiza-kurali.ts). Yoksa null. */
export function yakinKayitBul(yeni: { tur?: string; baslik: string; icerik: string }, o: { sabit?: boolean } = {}): { kayit: HafizaKaydi; benzerlik: number } | null {
  const adaylar = new Map<number, HafizaKaydi>();
  for (const b of hafizaAra({ sorgu: `${yeni.baslik} ${yeni.icerik}`.slice(0, 600), limit: 20 })) adaylar.set(b.id, b);
  for (const b of hafizaAra({ sorgu: yeni.baslik, limit: 10 })) adaylar.set(b.id, b);
  if (o.sabit) for (const b of hafizaListesi({ sabit: true, limit: 50 })) adaylar.set(b.id, b);
  let en: { kayit: HafizaKaydi; benzerlik: number } | null = null;
  for (const k of adaylar.values()) {
    if (o.sabit !== undefined && k.sabit !== o.sabit) continue;
    const icerikB = benzerlik(`${yeni.baslik} ${yeni.icerik}`, `${k.baslik} ${k.icerik}`);
    const turCezasi = yeni.tur && k.tur !== yeni.tur ? 0.1 : 0;
    const b = Math.max(0, icerikB - turCezasi);
    if (!en || b > en.benzerlik) en = { kayit: k, benzerlik: b };
  }
  return en;
}

/** Sabit kayıt sayısı tavanı aşıyorsa en eskiler (önce kullanıcıdan GELMEYENLER) sabitten iner — silinmez, olağan kayıt olarak kalır. */
export function sabitTavaniniUygula(tavan = SABIT_TAVANI): number {
  const l = (veritabani().prepare('SELECT * FROM hafizalar WHERE sabit = 1 AND silindi = 0').all() as Satir[]).map(kayda);
  if (l.length <= tavan) return 0;
  const sira = [...l].sort((a, b) => Number(kullaniciKaynakliMi(b.kaynak)) - Number(kullaniciKaynakliMi(a.kaynak)) || Number(b.tur === 'tercih') - Number(a.tur === 'tercih') || b.guncelleme.localeCompare(a.guncelleme) || b.id - a.id);
  const inen = sira.slice(tavan);
  const st = veritabani().prepare('UPDATE hafizalar SET sabit = 0 WHERE id = ?');
  for (const h of inen) st.run(h.id);
  return inen.length;
}

export interface BudamaSonucu { birlesen: number; arsivlenen: number; sabittenInen: number; canli: number }

/**
 * Gece budaması (11 Kas analizi #1; zamanlayıcının günlük tek atımlık işi çağırır — yoklama yok). Modelsiz, belirlenimci:
 *  1. Yakın kopyalar (aynı tür, benzerlik ≥ BUDAMA_BIRLESTIR): en yeni kalır, kaynaklar birleşir, ötekiler ARŞİVE.
 *  2. Öz-konuşma ("Fuber'in erişimi yok") ve eski "Merak sorusu" kayıtları (kullanıcıdan gelmediyse) arşive.
 *  3. Çürüme: sabit olmayan, hiç bağlama girmemiş, önemi ≤ 2 ve 60 günden eski — ya da önemi 3 ve 180 günden eski — kayıtlar arşive.
 *  4. Bütçe: canlı kayıt CANLI_KAYIT_BUTCESI'ni aşarsa en düşük değerli (önem + erişim + yenilik) kullanıcıdan gelmeyenler arşive.
 *  5. Sabit tavanı. Kullanıcıdan gelen kayıt (kurulum, "sen söyledin", Ayarlar) 2–4. adımda asla arşivlenmez. Hiçbir şey kalıcı silinmez.
 */
export function hafizaBuda(simdiAn: Date = new Date()): BudamaSonucu {
  const vt = veritabani();
  const sonuc: BudamaSonucu = { birlesen: 0, arsivlenen: 0, sabittenInen: 0, canli: 0 };
  const canli = () => (vt.prepare('SELECT * FROM hafizalar WHERE silindi = 0 ORDER BY guncelleme DESC, id DESC').all() as Satir[]).map(kayda);
  // 1) Yakın kopyalar (kök kümeleri bir kez hesaplanır: 400 kayıtta ~80 bin karşılaştırma)
  const l = canli();
  const kume = new Map(l.map((h) => [h.id, benzerlikKumesi(`${h.baslik} ${h.icerik}`)]));
  const giden = new Set<number>();
  for (let i = 0; i < l.length; i++) {
    const a = l[i];
    if (giden.has(a.id)) continue;
    for (let j = i + 1; j < l.length; j++) {
      const b = l[j];
      if (giden.has(b.id) || a.tur !== b.tur) continue;
      if (kumeBenzerligi(kume.get(a.id)!, kume.get(b.id)!) < BUDAMA_BIRLESTIR) continue;
      // `a` daha yeni (sıra guncelleme DESC): kalır; eskinin kaynağı, sabitliği ve önemi aktarılır.
      vt.prepare('UPDATE hafizalar SET kaynak = ?, sabit = ?, onem = ? WHERE id = ?')
        .run(kaynakBirlestir(a.kaynak, b.kaynak), a.sabit || b.sabit ? 1 : 0, Math.max(a.onem, b.onem), a.id);
      a.kaynak = kaynakBirlestir(a.kaynak, b.kaynak);
      a.sabit = a.sabit || b.sabit;
      if (hafizaArsivle(b.id)) { giden.add(b.id); sonuc.birlesen++; }
    }
  }
  // 2–3) Öz-konuşma, merak kayıtları, çürüme
  const z = simdiAn.getTime();
  const gun = (iso: string) => (z - Date.parse(iso)) / 86_400_000;
  const erisim = new Map((vt.prepare('SELECT id, erisim_sayisi FROM hafizalar WHERE silindi = 0').all() as Satir[]).map((s) => [Number(s.id), Number(s.erisim_sayisi ?? 0)]));
  for (const h of canli()) {
    if (kullaniciKaynakliMi(h.kaynak)) continue;
    const ozKonusma = ozKonusmaMi(`${h.baslik}: ${h.icerik}`) || /^merak sorusu$/i.test(h.baslik.trim());
    const curuk = !h.sabit && (erisim.get(h.id) ?? 0) === 0 && ((h.onem <= 2 && gun(h.guncelleme) > 60) || (h.onem <= 3 && gun(h.guncelleme) > 180));
    if ((ozKonusma || curuk) && hafizaArsivle(h.id)) sonuc.arsivlenen++;
  }
  // 4) Bütçe
  const kalan = canli();
  if (kalan.length > CANLI_KAYIT_BUTCESI) {
    const deger = (h: HafizaKaydi) => h.onem + Math.log2(1 + (erisim.get(h.id) ?? 0)) + 2 / (1 + gun(h.guncelleme) / 30);
    const aday = kalan.filter((h) => !h.sabit && !kullaniciKaynakliMi(h.kaynak)).sort((a, b) => deger(a) - deger(b));
    for (const h of aday.slice(0, kalan.length - CANLI_KAYIT_BUTCESI)) if (hafizaArsivle(h.id)) sonuc.arsivlenen++;
  }
  // 5) Sabit tavanı
  sonuc.sabittenInen = sabitTavaniniUygula();
  sonuc.canli = hafizaSayisi();
  return sonuc;
}

export interface TurBaglami { metin: string; atiflar: Atif[] }

/** Bu tur için ilgili hafıza + geçmiş konuşma + belge parçaları; bütçeyi aşmaz.
 *  `oncekiAtiflar`: son yanıtlarda verilen [H-n] atıfları. O kayıtlar bu turun sorgusuyla bulunmasa da kısaca eklenir;
 *  yoksa model kendi verdiği doğru atfı göremeyip "doğrulayamadım" diye gereksiz düzeltme yapıyordu (19 Eki e2e). */
export function turBaglami(sorgu: string, sohbetId: number, butce = 1800, oncekiAtiflar: number[] = []): TurBaglami {
  const bulgular = hafizaAra({ sorgu, limit: 8, dokun: true }).filter((b) => !b.sabit && b.puan > 0.9);
  const parcalar: string[] = [];
  const atiflar: Atif[] = [];
  let toplam = 0;
  const ekle = (s: string) => { const t = tokenTahmini(s); if (toplam + t > butce) return false; toplam += t; parcalar.push(s); return true; };
  const bulunan = new Set(bulgular.map((b) => b.id));
  for (const id of [...new Set(oncekiAtiflar)].slice(0, 6)) {
    const h = bulunan.has(id) ? null : hafizaGetir(id);
    if (!h || h.sabit) continue; // sabitler zaten sistem bölümünde
    if (!ekle(`[${atifEtiketi(h)}] (${h.tur}; ${kaynakEtiketi(h.kaynak)}; az önce atıf verdin) ${h.baslik}: ${h.icerik.slice(0, 300)}`)) break;
  }
  for (const b of bulgular) {
    if (!ekle(`[${atifEtiketi(b)}] (${b.tur}; ${kaynakEtiketi(b.kaynak)}) ${b.baslik}: ${b.icerik.slice(0, 600)}`)) break;
    atiflar.push({ id: b.id, baslik: b.baslik, tarih: tarihKisa(b.olayTarihi ?? b.guncelleme) });
  }
  const gecmis = mesajAra(sorgu, 4, sohbetId).filter((m) => m.metin.length > 20);
  for (const m of gecmis) {
    if (!ekle(`[Konuşma M-${m.id} · ${tarihKisa(m.zaman)} · ${m.rol === 'user' ? 'sen' : 'Fuber'}] ${m.metin.slice(0, 400)}`)) break;
  }
  for (const p of belgeAra(sorgu, 3)) {
    if (!ekle(`[Belge D-${p.belgeId} · ${p.ad} · ${tarihKisa(p.tarih)}] ${p.metin.slice(0, 500)}`)) break;
  }
  return { metin: parcalar.join('\n'), atiflar };
}

function clamp(n: number, a: number, b: number) { return Math.max(a, Math.min(b, Math.round(n))); }
