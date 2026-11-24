// İçe aktarılmış belgenin özeti (Hafıza → Belgeler; Görev 20b, K3). Ana süreç: main/belge-depo.ts.

const TUR_ADI: Record<string, string> = {
  pdf: 'PDF', docx: 'Word', eml: 'E-posta', md: 'Markdown', markdown: 'Markdown', txt: 'Metin', log: 'Metin', csv: 'Tablo (CSV)',
  html: 'Web sayfası', htm: 'Web sayfası', xml: 'XML', json: 'Sohbet / JSON', jsonl: 'Sohbet kaydı', yaml: 'YAML', yml: 'YAML',
  ts: 'Kod', js: 'Kod', py: 'Kod',
};
/** Belge türünün adı. A5 (son düzeltme): .jsonl İş modunda "Sohbet kaydı" (araç adı yok, K2); Geliştirici'de "Claude Code sohbeti". */
export function belgeTurAdi(tur: string, mod: 'is' | 'gelistirici' | null = 'is'): string {
  if (tur === 'jsonl' && mod === 'gelistirici') return 'Claude Code sohbeti';
  return TUR_ADI[tur] ?? (tur ? tur.toUpperCase() : 'Belge');
}
/** Özeti henüz çıkarılamamış belgenin sakin notu (Hafıza → Belgeler). */
export const OZETSIZ_NOTU = 'Özet henüz çıkarılamadı; Fuber sonra yeniden dener. Belge şimdiden aranabilir.';
/** Cila düzeltme turu 2 (N-1): kendiliğinden deneme hakkı bitti — Fuber artık kendiliğinden denemez; "yeniden dener" denmez. */
export const OZETSIZ_BITTI_NOTU = 'Özet çıkarılamadı; Dosya öğret ile yeniden dene. Belge şimdiden aranabilir.';
export interface BelgeOzeti {
  id: number;
  ad: string;
  /** Dosya uzantısı (pdf, docx, md, json…). */
  tur: string;
  /** Çıkarılan metnin uzunluğu (karakter). */
  boyut: number;
  /** 'ozetsiz' (0.12 cila düzeltme turu 1): parçaları aranabilir ama özet henüz çıkarılamadı — Fuber sonra yeniden dener (OZETSIZ_NOTU). */
  durum: 'bekliyor' | 'islendi' | 'hata' | 'ozetsiz';
  /** Belgenin tarihi (sohbet dışa aktarımında konuşmanın tarihi, yoksa içe aktarma anı). */
  tarih: string;
  ozet?: string;
  /** 'ozetsiz' ve kendiliğinden deneme hakkı bitti (cila düzeltme turu 2): arayüz OZETSIZ_BITTI_NOTU gösterir. */
  ozetHakkiBitti?: boolean;
  /** Bu belgeden öğrenilen (hâlâ kayıtlı) hafıza kaydı sayısı. */
  hafiza: number;
  /** Bunlardan YALNIZ bu belgeden öğrenilenler: belge silinince unutulur (ötekilerin kaynağından yalnız belge düşer). */
  yalnizBundan: number;
}
