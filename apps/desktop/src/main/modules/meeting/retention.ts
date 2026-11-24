// Toplantı saklama süreleri (gün): tek kaynak. Ana süreç (saklama görevi) ve arayüz (rıza ekranı) aynı sabiti okur.
// Ham döküm satırlarının süresi burada değildir: ortam dinlemeyle aynı politika alanından gelir
// (`policy.ambient.retentionDays`, 1–7 gün). Bu dosya saf kalmalıdır (içe aktarma yok): arayüz demetine de girer.
export const MEETING_RETENTION = {
  /** Toplantının özeti, kararları, yapılacakları ve verilen bağlam (ortam dinlemenin günlük raporuyla aynı). */
  summaryDays: 60,
  /** Ham dökümün en uzun süresi (politika daha uzun verse de). */
  transcriptMaxDays: 7,
} as const;
