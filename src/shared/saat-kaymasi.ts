// Ana sürecin saati (arayüz tarafı). Üretimde kayma 0 (Date.now()); YALNIZ FUBER_DEMO'da test saati (ada:test-saat, main/saat.ts)
// ileri alınınca ana süreç 'motor:durum' ile kaymayı bildirir ve arayüzdeki süreli durumlar (deneme kalan süresi, ödeme sorununun
// sarı → kırmızı geçişi) ana süreçle aynı saatle hesaplanır. Saf modül (DOM yok): dizin.ts ve arayüz bileşenleri okur.
let kayma = 0;

export const anaSimdi = (): number => Date.now() + kayma;

export function saatKaymasiYaz(ms: unknown): void {
  const n = Number(ms);
  kayma = Number.isFinite(n) ? n : 0;
}
