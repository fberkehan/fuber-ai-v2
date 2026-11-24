// ── Kart aracı (0.11 G6) ─────────────────────────────────────────────────────────────────────────────────────────────────────
// `kart_goster`: yapay zekâ yanıtına yapılandırılmış kart koyar (özet, liste, tablo, adımlar, karşılaştırma, bağlantılar). Kartı çizen arayüzdür
// (renderer/bilesenler/YapayZekaKarti.tsx, aynı Fuber arayüz kütüphanesi): burada yalnız KATI doğrulama yapılır (shared/kart.ts) — geçerli ⇒ araç
// başarılı, sohbet görünümü (main/sohbet.ts gorunume) aynı girdiden kart bloğunu çıkarır; geçersiz ⇒ modele neden geri söylenir, kart çizilmez.
// Dışa etkisi yok (yazma/gönderme/ağ yok): risk serbest, onay yok. Gizli/yerel turda araç listesi zaten boş (ajan/dongu.ts).
import { aracKaydet, sema, type Arac } from './kayit.js';
import { kartDogrula, KART_SINIR } from '../../../shared/kart.js';

const metinler = { type: 'array', items: { type: 'string' } };
const arac: Arac = {
  grup: 'kart', risk: 'serbest',
  etiket: () => 'Kart hazırlıyor',
  tanim: {
    ad: 'kart_goster',
    aciklama: `Yanıtına düzenli bir KART koyar; uzun düz liste ya da tablo yerine kullan. Hangi alanlar tür'e bağlıdır, başkasını yollama: `
      + `ozet {baslik, maddeler ≤${KART_SINIR.ozet}} · liste {baslik?, ogeler ≤${KART_SINIR.liste}: {baslik, alt?, sag?}} · tablo {baslik?, sutunlar ≤${KART_SINIR.sutun}, satirlar ≤${KART_SINIR.satir}: her satır sütun sayısı kadar hücre} · `
      + `adimlar {baslik?, adimlar ≤${KART_SINIR.adim}} · karsilastirma {baslik?, secenekler ${KART_SINIR.secenekAz}-${KART_SINIR.secenekEn}, ozellikler ≤${KART_SINIR.ozellik}: {ad, degerler: seçenek sayısı kadar}} · baglantilar {baslik?, baglantilar ≤${KART_SINIR.baglanti}: {baslik, adres (yalnız http/https)}}. `
      + `Her metin düz metindir (en çok ${KART_SINIR.metin} karakter, başlıklar ${KART_SINIR.baslik}); kalın, Markdown ve HTML yazma. Kartı koyduktan sonra kısa bir cümleyle yorumla; içeriğini tekrar yazma.`,
    sema: sema({
      tur: { type: 'string', enum: ['ozet', 'liste', 'tablo', 'adimlar', 'karsilastirma', 'baglantilar'], description: 'Kartın türü' },
      baslik: { type: 'string', description: `Kart başlığı (≤${KART_SINIR.baslik}); ozet için zorunlu` },
      maddeler: { ...metinler, description: 'ozet: kısa maddeler' },
      ogeler: { type: 'array', description: 'liste: öğeler', items: { type: 'object', properties: { baslik: { type: 'string' }, alt: { type: 'string' }, sag: { type: 'string' } } } },
      sutunlar: { ...metinler, description: 'tablo: sütun başlıkları' },
      satirlar: { type: 'array', description: 'tablo: satırlar (her satır bir metin listesi)', items: metinler },
      adimlar: { ...metinler, description: 'adimlar: sıralı adımlar' },
      secenekler: { ...metinler, description: 'karsilastirma: karşılaştırılan 2-3 seçeneğin adı' },
      ozellikler: { type: 'array', description: 'karsilastirma: satırlar', items: { type: 'object', properties: { ad: { type: 'string' }, degerler: metinler } } },
      baglantilar: { type: 'array', description: 'baglantilar: bağlantılar', items: { type: 'object', properties: { baslik: { type: 'string' }, adres: { type: 'string' } } } },
    }, ['tur']),
  },
  async calistir(g) {
    const s = kartDogrula(g);
    if ('hata' in s) return { icerik: `Kart geçersiz: ${s.hata}. Düzeltip tekrar çağır.`, hata: true, ozet: 'kart geçersiz' };
    return { icerik: 'Kart kullanıcıya gösterildi.', ozet: 'gösterildi' };
  },
};

export function kartAraciniKaydet(): void { aracKaydet(arac); }
