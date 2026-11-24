// ── Görevler deposu (0.11 G9; tablo `isler`, göç vt.ts #6) ─────────────────────────────────────────────────────────────────────────
// Satır = görev: başlık, amaç, plan (JSON; shared/isler.ts IsPlani), durum, zamanlar, sayaçlar, son özet(ler), gözcü izi, görevin sohbeti.
// Dışarıya (arayüz, araçlar) IsOzet gider; zamanlayıcının iç alanları (gözcü izi, şimdiki aralık, art arda başarısız adım, son 3 özet) IsKaydi'de.
import { veritabani, simdi } from '../vt.js';
import type { IsOzet, IsPlani, IsDurumu, DurmaNedeni, Gonderim } from '../../shared/isler.js';

/** Zamanlayıcının gördüğü tam kayıt. `iz`: gözcünün son izi (ilk kontrolde null); `aralik`: şimdiki aralık (sn); `basarisiz`: art arda başarısız
 *  adım; `ozetler`: son 3 adımın özeti (adımın bağlamı); `gonderilenler`: izinle (onaysız) yapılan gönderimlerin izi — alıcı ve zaman, metin yok. */
export interface IsKaydi extends IsOzet { iz: string | null; aralik: number; basarisiz: number; ozetler: string[]; gonderilenler: Gonderim[] }

type S = Record<string, unknown>;
const bosMu = (v: unknown) => v === null || v === undefined;
const yaziVeyaBos = (v: unknown): string | null => (bosMu(v) ? null : String(v));

function kayit(s: S): IsKaydi {
  let ozetler: string[] = [];
  try { const o = JSON.parse(String(s.ozetler ?? '[]')); if (Array.isArray(o)) ozetler = o.map(String); } catch { /* bozuk: boş */ }
  let gonderilenler: Gonderim[] = [];
  try { const o = JSON.parse(String(s.gonderilenler ?? '[]')); if (Array.isArray(o)) gonderilenler = o as Gonderim[]; } catch { /* bozuk: boş */ }
  return {
    id: Number(s.id), baslik: String(s.baslik), amac: String(s.amac ?? ''), durum: s.durum as IsDurumu, plan: JSON.parse(String(s.plan)) as IsPlani,
    baslangic: yaziVeyaBos(s.baslangic), bitisZamani: yaziVeyaBos(s.bitis_zamani), sonraki: yaziVeyaBos(s.sonraki), sonKontrol: yaziVeyaBos(s.son_kontrol),
    adim: Number(s.adim ?? 0), kontrol: Number(s.kontrol ?? 0), sonOzet: yaziVeyaBos(s.son_ozet), sonuc: yaziVeyaBos(s.sonuc),
    durmaNedeni: (yaziVeyaBos(s.durma_nedeni) as DurmaNedeni | null), sohbetId: Number(s.sohbet_id),
    iz: yaziVeyaBos(s.iz), aralik: Number(s.aralik ?? 10), basarisiz: Number(s.basarisiz ?? 0), ozetler, gonderilenler,
  };
}

/** Arayüze ve araçlara giden görünüm (zamanlayıcının iç alanları yok). `gonderim` (0.11 G10): izinle yapılan gönderim SAYISI — alıcı ve zaman
 *  arayüze taşınmaz (ayrıntı görev sohbetindeki "Gönderilenler: …" satırındadır). */
export function ozete(k: IsKaydi): IsOzet {
  const { iz: _iz, aralik: _a, basarisiz: _b, ozetler: _o, gonderilenler, ...ozet } = k;
  return { ...ozet, gonderim: gonderilenler.length };
}

/** İzinle yapılan gönderimi göreve ekler (adımın başarısından bağımsız: yankıda tur kayıtları silinse de iz kalır). */
export function gonderimEkle(id: number, g: Gonderim): void {
  veritabani().prepare("UPDATE isler SET gonderilenler = json_insert(gonderilenler, '$[#]', json(?)) WHERE id = ?").run(JSON.stringify(g), id);
}

export function isEkle(o: { baslik: string; amac: string; plan: IsPlani; sohbetId: number; baslangic: string; bitisZamani: string | null; aralik: number }): IsKaydi {
  const z = simdi();
  const r = veritabani().prepare(`INSERT INTO isler(baslik, amac, durum, plan, baslangic, bitis_zamani, sonraki, sohbet_id, aralik, olusturma, guncelleme)
    VALUES(?, ?, 'suruyor', ?, ?, ?, ?, ?, ?, ?, ?)`).run(o.baslik, o.amac, JSON.stringify(o.plan), o.baslangic, o.bitisZamani, o.baslangic, o.sohbetId, o.aralik, z, z);
  return isGetir(Number(r.lastInsertRowid))!;
}

export function isGetir(id: number): IsKaydi | null {
  const s = veritabani().prepare('SELECT * FROM isler WHERE id = ?').get(id) as S | undefined;
  return s ? kayit(s) : null;
}

/** Görevler: süren önce, sonra en son değişen; `durum` verilirse yalnız o. */
export function isKayitlari(o: { durum?: IsDurumu; limit?: number } = {}): IsKaydi[] {
  const vt = veritabani();
  const satirlar = (o.durum
    ? vt.prepare('SELECT * FROM isler WHERE durum = ? ORDER BY id').all(o.durum)
    : vt.prepare("SELECT * FROM isler ORDER BY (durum = 'suruyor') DESC, guncelleme DESC, id DESC LIMIT ?").all(o.limit ?? 50)) as S[];
  return satirlar.map(kayit);
}

const SUTUN: Record<string, string> = {
  durum: 'durum', baslangic: 'baslangic', bitisZamani: 'bitis_zamani', sonraki: 'sonraki', sonKontrol: 'son_kontrol', adim: 'adim', kontrol: 'kontrol',
  sonOzet: 'son_ozet', sonuc: 'sonuc', durmaNedeni: 'durma_nedeni', iz: 'iz', aralik: 'aralik', basarisiz: 'basarisiz', ozetler: 'ozetler',
};
export type IsGuncellemesi = Partial<Pick<IsKaydi, 'durum' | 'baslangic' | 'bitisZamani' | 'sonraki' | 'sonKontrol' | 'adim' | 'kontrol' | 'sonOzet' | 'sonuc' | 'durmaNedeni' | 'iz' | 'aralik' | 'basarisiz' | 'ozetler'>>;

export function isGuncelle(id: number, g: IsGuncellemesi): void {
  const alanlar = Object.entries(g).filter(([k, v]) => k in SUTUN && v !== undefined);
  if (!alanlar.length) return;
  const deger = (k: string, v: unknown) => (k === 'ozetler' ? JSON.stringify(v) : v as string | number | null);
  veritabani().prepare(`UPDATE isler SET ${alanlar.map(([k]) => `${SUTUN[k]} = ?`).join(', ')}, guncelleme = ? WHERE id = ?`)
    .run(...alanlar.map(([k, v]) => deger(k, v)), simdi(), id);
}
