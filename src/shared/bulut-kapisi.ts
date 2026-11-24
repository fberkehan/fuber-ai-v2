// ── Bulut kapısı (0.14 T0, P14; saf → birim testli: tests/bulut-kapisi.test.ts) ──
// Gizli mod ya da "Yalnız bu bilgisayar" seçiliyken bulut kapalıdır: şarkı sözü, web araması, MCP (bağlı servisler), katalog güncellemesi ve
// OAuth yenilemesi dahil. Karar kuruluşta değil İSTEK ANINDA verilir (süren isteği de kesmek için çağıran her adımda yeniden sorar).
// Gizli'de katalog ve takvim yalnız bu bilgisayardaki önbellekten okunur. Yerel modelde araç yoktur (ayrı kural, burada değil).
// Metinler yalnız neyin kapalı olduğunu söyler; mutlak gizlilik sözü (“hiçbir şey çıkmaz” vb.) vermez.

/** Bulut kapısının girdisi: iki ayar, istek anındaki değerleriyle. */
export interface BulutDurumu { gizliMod: boolean; yalnizYerel: boolean }

/** Bulut (internet) kullanımı yasak mı: Gizli mod ya da "Yalnız bu bilgisayar". */
export function bulutYasak(g: BulutDurumu): boolean {
  return g.gizliMod || g.yalnizYerel;
}

/** Kapalı özelliklerin kullanıcıya görünen metinleri (Türkçe, tam yazımlı). */
export const BULUT_KAPALI_METNI: Record<'soz' | 'web' | 'mcp' | 'takvim', string> = {
  soz: 'Şarkı sözleri internetten gelir; Gizli modda ve "Yalnız bu bilgisayar" seçiliyken kapalı.',
  web: 'İnternet araması Gizli modda ve "Yalnız bu bilgisayar" seçiliyken kapalı.',
  mcp: 'Bağlı servisler internet üzerinden çalışır; Gizli modda ve "Yalnız bu bilgisayar" seçiliyken kullanılmaz.',
  takvim: 'Gizli modda ve "Yalnız bu bilgisayar" seçiliyken takvim bu bilgisayardaki son kopyadan gösterilir.',
};

/** Sohbet boş durumunun tek satırı (0.14 T14, B24): bulut yasakken (Gizli ya da "Yalnız bu bilgisayar" — arayüzde `aracsiz`) web aramasının kapalı olduğu söylenir;
 *  yasak değilse satır yok. Yalnız neyin kapalı olduğunu söyler, mutlak söz vermez. */
export function sohbetBosWebSatiri(bulutKapali: boolean): string | null {
  return bulutKapali ? BULUT_KAPALI_METNI.web : null;
}
