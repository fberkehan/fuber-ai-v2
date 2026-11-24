// ── Bağlanma kapısı: vazgeçilen denemenin geç sonuçları yok sayılır (saf) ───────────────────────────────────────────────────
// Görev 20b (G19): WhatsApp "Vazgeç" bağlanırken (modül yüklenirken, oturum okunurken ya da QR görseli üretilirken) basılınca,
// await'ten dönen eski deneme yine soket kuruyor ve geç gelen QR'ı ekrana getiriyordu. Her vazgeçiş nesli artırır; deneme her
// await'ten sonra hem neslini hem ayarın hâlâ açık olduğunu ("etkin") denetler.

export class BaglantiKapisi {
  private nesil = 0;
  /** Denemenin nesli (başlarken alınır). */
  basla(): number { return this.nesil; }
  /** Vazgeç / çıkış: süren denemeler geçersizleşir. */
  iptal(): void { this.nesil++; }
  /** Deneme sürmeli mi? (vazgeçilmedi ve ayar açık) */
  gecerli(n: number, etkin: boolean): boolean { return etkin && n === this.nesil; }
}
