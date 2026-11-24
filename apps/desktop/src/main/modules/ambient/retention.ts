// Saklama süreleri (gün): tek kaynak. Ana süreç (not tutucu, saklama görevi) ve arayüz (rıza ekranı, Ayarlar ›
// Gizlilik) aynı sabiti okur; rıza ekranında yazan süre ile gerçekten uygulanan süre ayrışamaz.
// Ham dökümün süresi burada değildir: politikadan gelir (`policy.ambient.retentionDays`, en çok 7 gün).
// Bu dosya saf kalmalıdır (içe aktarma yok): arayüz demetine de girer.
export const RETENTION = {
  /** Gündelik not. */
  casualNoteDays: 7,
  /** Önemli not (karar, söz, tarih, para). */
  importantNoteDays: 30,
  dailyReportDays: 60,
  weeklyReportDays: 365,
  /** Kapanan mesele ve sonuçlanan hafıza önerisi. */
  closedIssueDays: 30,
  /** Eşlikçinin araya girme kaydı. */
  interjectionDays: 30,
} as const;
