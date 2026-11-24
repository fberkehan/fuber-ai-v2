// ── Gizli mod kapanışı: notla, SONRA yerel sunucuyu kapat (Görev 21 düzeltme turu 3-4; Electron'dan bağımsız, birim testli:
// tests/gizli-kapanis.test.ts) ──────────────────────────────────────────────────────────────────────────────────────────────────
// Gizli mod kapanınca bekleyen Gizli gün kaydı satırları yerel beyin HÂLÂ açıkken notlanır; sunucu ancak bu iş bittikten sonra kapanır
// (notlama hata verse de). Bu arada Gizli mod yeniden açıldıysa (yerel beyin yine tek motor) sunucu kapatılmaz.

export interface GizliKapanisBag {
  /** Bekleyen Gizli satırları yerelde notlar (gunkaydi/dusunme.ts gizliKapandi). */
  notla: () => Promise<unknown>;
  /** Yerel beyin şu an tek motor mu (Gizli mod yeniden açıldı mı)? */
  tekMotor: () => boolean;
  /** Yerel sunucuyu kapatır. */
  durdur: () => void;
  /** Arayüze yerel durumu bildirir. */
  bildir: () => void;
}

export async function gizliKapanisi(b: GizliKapanisBag): Promise<void> {
  try {
    await b.notla();
  } catch {
    /* notlama en iyi çaba: satırlar Gizli kalır, bulut işleri onları görmez */
  } finally {
    if (!b.tekMotor()) b.durdur();
    b.bildir();
  }
}
