// ── İçe aktarılmış belgeler: liste, arama, silme ───────────────────────────────────────────────────────────────────────
// Görev 20b (K3): öğretme klasörüne bırakılan belgeler (D-…) arayüzde görünmüyordu (yalnız son 12 ad), aranamıyor, silinemiyordu.
// Hafıza → Belgeler bunları gösterir. Silme tek işlemde (yarım kalmaz): belgenin parçaları ve arama dizini gider; YALNIZ bu
// belgeden öğrenilen hafıza kayıtları unutulur (kaynağı yalnız "dosya:D-<id>"); başka kaynağı da olan kayıt kalır, kaynağından
// bu belge düşer. Dosya klasörde kaldığı için (Fuber dosyaları silmez/taşımaz) belge satırı "silindi" izi olarak kalır: içerik özeti
// (ozet_hash) aynı dosyanın açılış taramasında yeniden öğrenilmesini engeller; metin ve özet silinir.
// Veritabanı parametreyle gelir (birim testi bellek içi SQLite ile çalışır).
import type { DatabaseSync } from 'node:sqlite';
import { sadelestir, ftsSorgusu } from './hafiza/normal.ts';
import type { BelgeOzeti } from '../shared/belge.ts';

export type { BelgeOzeti };

type Satir = Record<string, unknown>;
const ref = (id: number) => `dosya:D-${id}`;
export const kaynakParcalari = (kaynak: string) => kaynak.split(', ').map((s) => s.trim()).filter(Boolean);

/** Belge kimliği → ondan öğrenilen kayıt sayısı ve bunlardan YALNIZ ondan öğrenilenler (silinince unutulacaklar). Kaynak alanı
 *  "a, b, dosya:D-12" biçiminde; D-120 D-12 sayılmaz. */
function hafizaSayilari(vt: DatabaseSync): Map<number, { toplam: number; yalniz: number }> {
  const out = new Map<number, { toplam: number; yalniz: number }>();
  const satirlar = vt.prepare("SELECT kaynak FROM hafizalar WHERE silindi = 0 AND kaynak LIKE '%dosya:D-%'").all() as Satir[];
  for (const s of satirlar) {
    const parcalar = [...new Set(kaynakParcalari(String(s.kaynak)))];
    for (const p of parcalar) {
      const m = /^dosya:D-(\d+)$/.exec(p);
      if (!m) continue;
      const k = out.get(Number(m[1])) ?? { toplam: 0, yalniz: 0 };
      k.toplam++;
      if (parcalar.length === 1) k.yalniz++;
      out.set(Number(m[1]), k);
    }
  }
  return out;
}

/** Belge silindi mi (ya da hiç yok mu)? İçe aktarma ve hafıza yazıcısı uzun bir model çağrısından dönünce sorar (Görev 20b). */
export function belgeSilindiMi(vt: DatabaseSync, id: number): boolean {
  const b = vt.prepare('SELECT durum FROM belgeler WHERE id = ?').get(id) as Satir | undefined;
  return !b || b.durum === 'silindi';
}

/** Hafıza yazımının kaynağı ("dosya:D-12") silinmiş bir belge mi? Öyleyse yazıcı işi bırakır (silinen belgeden kayıt düşmez). */
export function kaynakBelgesiSilindiMi(vt: DatabaseSync, kaynak: string): boolean {
  const m = /(?:^|,\s*)dosya:D-(\d+)(?:$|,)/.exec(kaynak);
  return m ? belgeSilindiMi(vt, Number(m[1])) : false;
}

/**
 * A4 (son düzeltme): içeriği `hash` olan dosya AÇIKÇA yeniden öğretiliyor ("Dosya öğret" seçimi, dosya_oku ogren). Silinmiş belgelerin
 * izleri ("silindi" satırları; açılış taraması ve klasör izleyicisi aynı dosyayı yeniden öğrenmesin diye duruyordu) kaldırılır — böylece
 * yeniden öğrenilir. Hâlâ duran (silinmemiş) parçalar dokunulmaz. Dönen: kaldırılan iz sayısı.
 */
export function silinmisIzleriKaldir(vt: DatabaseSync, hash: string): number {
  const r = vt.prepare("DELETE FROM belgeler WHERE durum = 'silindi' AND ozet_hash LIKE ?").run(`${hash.replace(/[%_]/g, '')}:%`);
  return Number(r.changes);
}

/** Bu içerik özetinin (`hash:sira`) parçası belgelerde var mı (silinmiş iz dahil)? */
export function parcaVarMi(vt: DatabaseSync, anahtar: string): boolean {
  return Boolean(vt.prepare('SELECT 1 FROM belgeler WHERE ozet_hash = ?').get(anahtar));
}

/** 'ozetsiz' belgenin nedeni (`hata` sütunu; cila düzeltme turu 2): motor yolu yok (model iniyor / hesap onay bekliyor) ve geçici hata
 *  (bağlantı, sunucu kapalı, 5xx) deneme hakkı harcamaz; kalıcı hata (bağlam aşımı, biçim) harcar; hak bitince kendiliğinden denenmez —
 *  arayüz "Dosya öğret ile yeniden dene" der (BelgeOzeti.ozetHakkiBitti). */
export const OZETSIZ_NEDEN = { motorYok: 'motor yok', gecici: 'geçici hata', kalici: 'özet çıkarılamadı', hakBitti: 'özet çıkarılamadı; deneme hakkı bitti' } as const;

/** 0.12 cila düzeltme turu 1 (I-1): özet çıkarılamadı (model çağrısı başarısız; yerelde bağlam aşımı dahil) — belge boş özetle "işlendi"
 *  OLMAZ, 'ozetsiz' kalır (parçaları aranabilir; iceaktar.ts ozetsizBelgeleriIsle sonra yeniden dener). Silindiyse dokunulmaz (false). */
export function belgeOzetsizYaz(vt: DatabaseSync, id: number, neden: string, simdi = new Date().toISOString()): boolean {
  const r = vt.prepare("UPDATE belgeler SET durum = 'ozetsiz', hata = ?, islenme = ? WHERE id = ? AND durum != 'silindi'").run(neden.slice(0, 300), simdi, id);
  return Number(r.changes) > 0;
}

/** İçe aktarma bitti: özet yazılır, belge "işlendi" olur — bu arada silindiyse DOKUNULMAZ (false; silinen belge geri gelmez). */
export function belgeIslendiYaz(vt: DatabaseSync, id: number, ozet: string, simdi = new Date().toISOString()): boolean {
  const r = vt.prepare("UPDATE belgeler SET durum = 'islendi', ozet = ?, hata = NULL, islenme = ? WHERE id = ? AND durum != 'silindi'").run(ozet || null, simdi, id);
  return Number(r.changes) > 0;
}

export function belgeListesi(vt: DatabaseSync, o: { sorgu?: string; limit?: number } = {}): BelgeOzeti[] {
  const limit = Math.min(Math.max(1, o.limit ?? 300), 1000);
  const satirlar = vt.prepare("SELECT id, ad, tur, boyut, durum, ozet, hata, olusturma FROM belgeler WHERE durum != 'silindi' ORDER BY olusturma DESC, id DESC").all() as Satir[];
  let secili = satirlar;
  const sorgu = (o.sorgu ?? '').trim();
  if (sorgu) {
    const kimlik = /^d-?(\d+)$/i.exec(sorgu)?.[1];
    const kelimeler = sadelestir(sorgu).split(/\s+/).filter(Boolean);
    const icerik = new Set<number>();
    const fts = ftsSorgusu(sorgu, 've');
    if (fts) {
      try {
        for (const p of vt.prepare('SELECT DISTINCT p.belge_id FROM parca_ara JOIN parcalar p ON p.id = parca_ara.rowid WHERE parca_ara MATCH ?').all(fts) as Satir[]) icerik.add(Number(p.belge_id));
      } catch { /* bozuk sorgu: yalnız ad araması */ }
    }
    secili = satirlar.filter((s) => {
      if (kimlik && Number(s.id) === Number(kimlik)) return true;
      const ad = sadelestir(String(s.ad));
      return kelimeler.every((k) => ad.includes(k)) || icerik.has(Number(s.id));
    });
  }
  const hafiza = hafizaSayilari(vt);
  return secili.slice(0, limit).map((s) => ({
    id: Number(s.id),
    ad: String(s.ad),
    tur: String(s.tur ?? '').toLowerCase(),
    boyut: Number(s.boyut ?? 0),
    durum: (['bekliyor', 'islendi', 'hata', 'ozetsiz'].includes(String(s.durum)) ? String(s.durum) : 'bekliyor') as BelgeOzeti['durum'],
    tarih: String(s.olusturma),
    ...(s.ozet ? { ozet: String(s.ozet) } : {}),
    ...(s.durum === 'ozetsiz' && s.hata === OZETSIZ_NEDEN.hakBitti ? { ozetHakkiBitti: true } : {}),
    hafiza: hafiza.get(Number(s.id))?.toplam ?? 0,
    yalnizBundan: hafiza.get(Number(s.id))?.yalniz ?? 0,
  }));
}

/** Belgeyi siler (tek işlem). `unutulan`: yalnız bu belgeden öğrenilip unutulan kayıt; `guncellenen`: kaynağından düşülen kayıt. */
export function belgeSil(vt: DatabaseSync, id: number, simdi = new Date().toISOString()): { silindi: boolean; unutulan: number; guncellenen: number } {
  const yok = { silindi: false, unutulan: 0, guncellenen: 0 };
  const b = vt.prepare("SELECT id FROM belgeler WHERE id = ? AND durum != 'silindi'").get(id) as Satir | undefined;
  if (!b) return yok;
  let unutulan = 0, guncellenen = 0;
  vt.exec('BEGIN');
  try {
    for (const p of vt.prepare('SELECT id FROM parcalar WHERE belge_id = ?').all(id) as Satir[]) vt.prepare('DELETE FROM parca_ara WHERE rowid = ?').run(Number(p.id));
    vt.prepare('DELETE FROM parcalar WHERE belge_id = ?').run(id);
    vt.prepare("UPDATE belgeler SET durum = 'silindi', ozet = NULL, hata = NULL, parca_sayisi = 0, islenme = ? WHERE id = ?").run(simdi, id);
    const r = ref(id);
    for (const h of vt.prepare("SELECT id, kaynak FROM hafizalar WHERE silindi = 0 AND kaynak LIKE ?").all(`%${r}%`) as Satir[]) {
      const parcalar = kaynakParcalari(String(h.kaynak));
      if (!parcalar.includes(r)) continue; // önek benzerliği (D-120)
      const kalan = parcalar.filter((p) => p !== r);
      if (!kalan.length) {
        vt.prepare('UPDATE hafizalar SET silindi = 1, guncelleme = ? WHERE id = ?').run(simdi, Number(h.id));
        vt.prepare('DELETE FROM hafiza_ara WHERE rowid = ?').run(Number(h.id));
        unutulan++;
      } else {
        vt.prepare('UPDATE hafizalar SET kaynak = ? WHERE id = ?').run(kalan.join(', '), Number(h.id));
        guncellenen++;
      }
    }
    vt.exec('COMMIT');
  } catch (e) {
    vt.exec('ROLLBACK');
    throw e;
  }
  return { silindi: true, unutulan, guncellenen };
}
