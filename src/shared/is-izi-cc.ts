// ── İş izi: Claude Code olay akışından oturum başına iş durumu (saf; tests/is-izi-cc.test.ts) ─────────────────────────────────────────
// Ana süreç (main/is-izi.ts) 'claudecode:olay' zarflarını bu indirgeyiciden geçirir: oturum özeti, üst düzeyde son süren araç (canlı fiil), alt ajanlar
// (iç adımları, izin bekleyen adımı) ve Claude Code'un arka plan işleri. Metin parçaları, düşünme ve yapılacaklar işi değiştirmez (yok sayılır: akış sık,
// yayın yalnız iş değişince). `ccIzIsleri` durumu iş kayıtlarına çevirir (shared/is-izi.ts eşlemeleri; Claude Code sayfası da aynı eşlemeyi kullanır).
import type { CcAracTipi, CcArkaIs, CcOlayZarfi, CcOturumOzeti } from './cc-olay.ts';
import { ccAltAjanIsi, ccArkaIsIsi, ccOturumIsi, type CcAltAjanGirdisi, type IsKaydi } from './is-izi.ts';

interface Arac { id: string; tip: CcAracTipi; ad: string; ozet: string; durum: 'calisiyor' | 'tamam' | 'hata' | 'kesildi' }
export interface CcIzOturumu {
  ozet: CcOturumOzeti | null;
  sonArac: Arac | null;
  /** Alt ajanlar geliş sırasıyla (bu turun ve süren önceki turların). */
  ajanlar: Map<string, CcAltAjanGirdisi & { sira: number }>;
  /** Araç kimliği → içinde çalıştığı alt ajanın kimliği. */
  aracUst: Map<string, string>;
  /** İzin isteği → alt ajan. */
  izinler: Map<string, string>;
  arkaIsler: CcArkaIs[];
  sira: number;
}
export type CcIzDurumu = Map<string, CcIzOturumu>;

const yeniOturum = (): CcIzOturumu => ({ ozet: null, sonArac: null, ajanlar: new Map(), aracUst: new Map(), izinler: new Map(), arkaIsler: [], sira: 0 });

/** Zarfı uygular; iş görünümünü değiştirdiyse true (yayın yalnız o zaman). */
export function ccIzAdimi(d: CcIzDurumu, z: CcOlayZarfi, simdi: number): boolean {
  const o = z.olay;
  if (o.tur === 'unutuldu') return d.delete(z.oturum);
  if (o.tur === 'metin-parca' || o.tur === 'metin' || o.tur === 'dusunme' || o.tur === 'yapilacaklar' || o.tur === 'mod' || o.tur === 'model' || o.tur === 'sistem' || o.tur === 'baslangic' || o.tur === 'arka-plan') return false;
  let k = d.get(z.oturum);
  if (!k) { k = yeniOturum(); d.set(z.oturum, k); }
  switch (o.tur) {
    case 'durum': k.ozet = o.ozet; return true;
    case 'kullanici': {
      // Yeni tur: biten alt ajanlar düşer, sıra baştan (süren arka plan ajanı kalır).
      for (const [id, a] of k.ajanlar) if (a.durum !== 'calisiyor') k.ajanlar.delete(id);
      k.sira = k.ajanlar.size;
      k.sonArac = null;
      return true;
    }
    case 'alt-ajan': {
      if (k.ajanlar.has(o.id)) return false;
      k.ajanlar.set(o.id, { id: o.id, aciklama: o.aciklama, ...(o.ajanTipi ? { ajanTipi: o.ajanTipi } : {}), durum: 'calisiyor', baslangic: simdi, cocuklar: [], sira: k.sira++ });
      if (o.ust && k.ajanlar.has(o.ust)) k.aracUst.set(o.id, o.ust);
      return true;
    }
    case 'arac-basladi': {
      const a: Arac = { id: o.id, tip: o.tip, ad: o.ad, ozet: o.ozet, durum: 'calisiyor' };
      const ust = o.ust && k.ajanlar.get(o.ust);
      if (ust) { k.aracUst.set(o.id, o.ust!); ust.cocuklar = [...ust.cocuklar, a]; return true; }
      if (o.ust) return false; // bilinmeyen üst (iç içe derin adım): görünüm değişmez
      k.sonArac = a;
      return true;
    }
    case 'arac-bitti': {
      const durum = o.hata ? 'hata' : 'tamam';
      const ajan = k.ajanlar.get(o.id);
      if (ajan) { ajan.durum = durum; ajan.bitis = simdi; ajan.izinde = false; return true; }
      const ustId = k.aracUst.get(o.id) ?? o.ust ?? undefined;
      const ust = ustId ? k.ajanlar.get(ustId) : undefined;
      if (ust) { ust.cocuklar = ust.cocuklar.map((c) => (c.id === o.id ? { ...c, durum } : c)); return true; }
      if (k.sonArac?.id === o.id) { k.sonArac = { ...k.sonArac, durum }; return true; }
      return false;
    }
    case 'izin-istegi': {
      const ajanId = (o.aracKimligi && k.aracUst.get(o.aracKimligi)) || (o.ajan && k.ajanlar.has(o.ajan) ? o.ajan : undefined);
      const a = ajanId ? k.ajanlar.get(ajanId) : undefined;
      if (!a) return false;
      a.izinde = true;
      k.izinler.set(o.istekId, a.id);
      return true;
    }
    case 'izin-yanitlandi': {
      const id = k.izinler.get(o.istekId);
      if (!id) return false;
      k.izinler.delete(o.istekId);
      const a = k.ajanlar.get(id);
      if (a && ![...k.izinler.values()].includes(id)) a.izinde = false;
      return true;
    }
    case 'arka-isler': k.arkaIsler = o.isler; return true;
    case 'sonuc': {
      // Tur bitti: hâlâ süren (arka plana alınmamış) alt ajan kesildi sayılır (Claude Code sayfasıyla aynı kural). Arka plandaki ajan işi arka-isler'den sürer.
      const arkada = new Set(k.arkaIsler.filter((i) => i.durum === 'suruyor' && i.aracId).map((i) => i.aracId!));
      for (const a of k.ajanlar.values()) if (a.durum === 'calisiyor' && !arkada.has(a.id)) { a.durum = o.kesildi ? 'kesildi' : 'tamam'; a.bitis = simdi; a.izinde = false; }
      k.sonArac = null;
      return true;
    }
    default: return false;
  }
}

/** Oturumların iş kayıtları: oturum + alt ajanları + (alt ajan olmayan) arka plan işleri. Özeti gelmemiş oturum yok sayılır. */
export function ccIzIsleri(d: CcIzDurumu): IsKaydi[] {
  const l: IsKaydi[] = [];
  for (const k of d.values()) {
    const o = k.ozet;
    if (!o) continue;
    const oturum = ccOturumIsi(o, k.sonArac?.durum === 'calisiyor' ? k.sonArac : null);
    // Kendi süren aracı yokken yardımcılar çalışıyorsa oturumun fiili onları söyler ("3 yardımcı çalışıyor").
    const suren = [...k.ajanlar.values()].filter((a) => a.durum === 'calisiyor').length;
    if (oturum.hal === 'calisiyor' && oturum.ne === 'Çalışıyor' && suren) oturum.ne = `${suren} yardımcı çalışıyor`;
    l.push(oturum);
    for (const a of k.ajanlar.values()) l.push(ccAltAjanIsi(a, o, a.sira));
    for (const i of k.arkaIsler) {
      if (i.tip === 'ajan' && i.aracId && k.ajanlar.has(i.aracId)) continue; // alt ajan zaten satırında
      l.push(ccArkaIsIsi(i, o));
    }
  }
  return l;
}
