// Sohbetin arka plan süreci (analiz 11 Kas bulgu 4; main/ajan/surec-yoneticisi.ts): 'surec:liste' / 'surec:degisti' yükü.
export interface SurecOzeti {
  kimlik: string; komut: string; klasor: string; pid?: number;
  /** `durduruluyor` (inceleme M1): Durdur istendi, süreç henüz çıkmadı (sayılır; kapanışta yeniden öldürülür). */
  durum: 'calisiyor' | 'durduruluyor' | 'bitti' | 'durduruldu' | 'hata';
  kod: number | null; baslangic: number; bitis?: number; hata?: string;
  /** Son satır (listede tek satır önizleme). */
  sonSatir: string;
  sohbetId?: number;
}
