// ── Süreli durumların saati (1 saat gizle, rahatsız etme) ────────────────────────────────────────────────────────
// Üretimde Date.now(). YALNIZ FUBER_DEMO'da test kancası (ada:test-saat, ipc.ts) saati ileri alabilir: "1 saat gizle"nin
// bitişi bir saat beklemeden sınansın (scripts/dev/ada-testi.mjs). Kayma dinleyicileri (ada) süreleri yeniden değerlendirir.
let kayma = 0;
const dinleyiciler = new Set<() => void>();

export const simdi = (): number => Date.now() + (process.env.FUBER_DEMO ? kayma : 0);

/** YALNIZ FUBER_DEMO: saati `ms` kadar ileri (0: gerçek saate dön). `sessiz`: dinleyicilere haber verilmez — uykudan uyanma gibi,
 *  zamanlayıcılar kaymayı fark etmez (yoklama ve powerMonitor 'resume' yolu sınanır). */
export function saatiKaydir(ms: number, sessiz = false): void {
  if (!process.env.FUBER_DEMO) return;
  kayma = Number(ms) || 0;
  if (sessiz) return;
  for (const f of dinleyiciler) { try { f(); } catch (e) { console.error('[saat] dinleyici hata verdi:', e); } }
}

export function saatDinle(f: () => void): () => void {
  dinleyiciler.add(f);
  return () => dinleyiciler.delete(f);
}
