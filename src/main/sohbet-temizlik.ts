// ── Boş sohbetlerin temizliği ──────────────────────────────────────────────────────────────────────────────────────────
// Görev 20b (K11): "Yeni" her basışta kayıt açıyordu (motor yokken de); boş "Yeni sohbet"ler listede birikiyordu. Masaüstünde yeni
// sohbet artık ilk mesajda oluşur (renderer/bilesenler/Sohbet.tsx). Telefondan açılıp hiç yazılmamış ya da eski sürümden kalan
// mesajsız normal sohbetler açılışta ARŞİVE kalkar (silinmez; mesajı olmadığı için kaybolan bir şey yok). Son 24 saatte dokunulmuş
// olan (telefonda açık duruyor olabilir), ana ve asistan sohbetleri dokunulmaz; arşivdeki sohbete yine de mesaj yazılırsa arşivden
// çıkar (telefonda günlerce açık kalmış taslak). Veritabanı parametreyle gelir (birim testi).
import type { DatabaseSync } from 'node:sqlite';
import { icTalimatYankisiMi } from '../shared/ic-talimat.ts';
import { gizliTetikMi } from '../shared/sohbet-gorunum.ts';

/** Mesajsız ve `esikMs`dir (varsayılan 24 saat) dokunulmamış normal sohbetleri arşivler; arşivlenen sayısını döner. */
export function bosSohbetleriArsivle(vt: DatabaseSync, simdi = Date.now(), esikMs = 24 * 3_600_000): number {
  const r = vt.prepare(`UPDATE sohbetler SET arsiv = 1 WHERE tur = 'normal' AND arsiv = 0 AND guncelleme < ?
    AND NOT EXISTS (SELECT 1 FROM mesajlar m WHERE m.sohbet_id = sohbetler.id)`).run(new Date(simdi - esikMs).toISOString());
  return Number(r.changes);
}

/** Bu mesajı kullanıcı GERÇEKTEN mi yazdı/söyledi (masaüstü, ses, telefon)? Araç sonuçları da rol 'user' ile kaydedilir
 *  (kaynak 'arac'); onlar ve proaktif tetikler arşivdeki sohbeti geri getirmez (Görev 20b düzeltme turu 2). Bilinmeyen kaynak: hayır. */
export function kullaniciYazdiMi(rol: string, kaynak?: string | null): boolean {
  return rol === 'user' && (kaynak == null || kaynak === 'kullanici' || kaynak === 'ses' || kaynak === 'mobil');
}

/** Kullanıcı arşivdeki normal bir sohbete yazdı: sohbet listeye döner (true: arşivden çıktı). */
export function mesajlaArsivdenCikar(vt: DatabaseSync, sohbetId: number): boolean {
  return Number(vt.prepare("UPDATE sohbetler SET arsiv = 0 WHERE id = ? AND arsiv = 1 AND tur = 'normal'").run(sohbetId).changes) > 0;
}

/** Meta bayrağı: 0.10.0'dan kalan yankı balonları süpürüldü (bir kez). */
export const YANKI_SUPURME_ISARETI = 'g2-proaktif-yanki-supurme';

/**
 * 0.11 G2 (G1 incelemesi K3): 0.10.0'da G1'in yankı bekçisi yokken kaydolmuş proaktif yankı balonları açılışta BİR KEZ (meta bayrağıyla)
 * kayıttan kalkar. Yankı balonu: kaynağı 'proaktif' Fuber mesajı, aynı sohbette hemen önceki kayıt iç talimat (shared/sohbet-gorunum.ts
 * gizliTetikMi) ve yanıt o talimatı tekrar ediyor (shared/ic-talimat.ts icTalimatYankisiMi). G1'in yankı için seçtiği yolun aynısı
 * (sohbet.ts mesajlariSil): mesaj ve arama dizini kaydı SİLİNİR, okunmamış sayısı düşer; tetiğin kendisi modelin bağlamı için kalır.
 * Kaldırılan sayısını döner; bayrak varsa hiçbir şey yapmaz (0).
 */
export function proaktifYankilariSupur(vt: DatabaseSync): number {
  vt.exec('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)');
  if (vt.prepare('SELECT v FROM meta WHERE k = ?').get(YANKI_SUPURME_ISARETI)) return 0;
  const adaylar = vt.prepare("SELECT id, sohbet_id, metin FROM mesajlar WHERE rol = 'assistant' AND kaynak = 'proaktif' ORDER BY id").all() as { id: number; sohbet_id: number; metin: string }[];
  const onceki = vt.prepare('SELECT rol, kaynak, metin FROM mesajlar WHERE sohbet_id = ? AND id < ? ORDER BY id DESC LIMIT 1');
  const silinecek: { id: number; sohbet: number }[] = [];
  for (const m of adaylar) {
    const o = onceki.get(m.sohbet_id, m.id) as { rol: string; kaynak: string | null; metin: string } | undefined;
    if (o && gizliTetikMi({ rol: String(o.rol), kaynak: o.kaynak ?? null }) && icTalimatYankisiMi(String(m.metin ?? ''), String(o.metin ?? ''))) {
      silinecek.push({ id: Number(m.id), sohbet: Number(m.sohbet_id) });
    }
  }
  vt.exec('BEGIN');
  try {
    const dizinden = vt.prepare('DELETE FROM mesaj_ara WHERE rowid = ?');
    const kayittan = vt.prepare('DELETE FROM mesajlar WHERE id = ?');
    const okunmamis = vt.prepare('UPDATE sohbetler SET okunmamis = MAX(0, okunmamis - 1) WHERE id = ?');
    for (const x of silinecek) { dizinden.run(x.id); kayittan.run(x.id); okunmamis.run(x.sohbet); }
    vt.prepare('INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(YANKI_SUPURME_ISARETI, String(silinecek.length));
    vt.exec('COMMIT');
  } catch (e) {
    vt.exec('ROLLBACK');
    throw e;
  }
  return silinecek.length;
}
