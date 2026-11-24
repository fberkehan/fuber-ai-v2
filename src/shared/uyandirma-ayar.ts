// ── "Hey Fuber" uyandırma ayarı (0.13 T8): sherpa-onnx anahtar sözcük algılama ──────────────────────────────────────────────────────
// Tek kaynak: tarayıcı işçisi, testler ve scripts/dev/uyandirma/olc.mjs --urun bunu okur; ölçülen ayar = dağıtılan ayar.
// MODEL: k2-fsa icefall KWS zipformer zh-en 3M, 2025-12-20 (chunk-16, int8); yazar pkufool, Apache-2.0 (ModelScope üstverisi). Türkçe model yok:
// İngilizce sesbirim + pinyin belirteçleriyle çalışır. Sözlük yazımı ("HH EY1 F UW1 B ER0") Türkçe sesi NEREDEYSE HİÇ yakalamıyor (1-2/20), çünkü
// model "Hey Fuber"i şöyle duyuyor: Türkçe dokunmalı r → T, "hey" → HIY, kimi seste pinyin. Liste bu yüzden modelin DUYDUĞU söylenişlerden
// (Tolga + iki Piper sesi, sekiz hizalama; arac: duyulan2) kurulu, sonra yanlış uyanma günlüğüyle budanmıştır: "HH EY1 V B EH1 T" ("Heybeliada",
// "Heybetli" gibi gerçek sözcükler) ve "HH IY1 F AO1 R B EH1 T" (5,3 saatte 8 yanlış uyanmanın 6'sı) çıkarıldı.
// YOL 8 (varsayılan 4 değil): akışta kısa ömürlü dal budanınca söz kaçıyor; 4'te sürekli akışta 15,5/20, 8'de 18/20. Kuşku varsa: sürekli akış
// ölçümü (set-hazirla akisli), klip başına taze akıştan daha zordur ve uygulamanın gerçek hâlidir.
// ÖLÇÜM (31 Eki, olc.mjs --urun, ayar seçiminde kullanılmayan 10,03 saatlik sınama seti; Vosk aynı sette):
//   yanlış uyanma 0,80/saat (8) ← Vosk 58,6/saat (588); gerçek Türkçe konuşmada 4 / 6,7 saat ← 511; kasıtlı benzer 240 klipte 3 ← 15.
// DOĞRU UYANMA ÖLÇÜTÜ AÇIK (geçti sayılmaz): 18/20 örneklem içidir, aynı klipler ayar seçiminde kullanıldı. Yansız tek ölçü, liste kurulurken
// kullanılmayan fettah sesi: 16/21 (aynı seste Vosk 19/21). Sürekli akış + −60 dBFS taban gürültüsü: Tolga 15,0/20 ← Vosk 17,8; üç Piper sesi
// 50,0/63 ← Vosk 26,8. Gerçek kişi kaydı ölçülmedi: ölçütü gerçek kayıtlar kapatır (scripts/dev/uyandirma/kayit-olc.mjs).
// fettah söylenişleri listeye bilerek EKLENMEDİ: tek yansız ölçü kalsın.
export interface UyandirmaAyari {
  dosyalar: { encoder: string; decoder: string; joiner: string; tokens: string };
  /** Satır başına bir anahtar sözcük: belirteçler + @ad (keywords_buf biçimi). */
  anahtar: string;
  esik: number;
  skor: number;
  kuyruk: number;
  yol: number;
}

const SOYLENISLER = [
  'h ēi f ú b a', 'h ēi f ù b a', 'h ēi f ú b à', 'p éi f ú b a', 'p éi f ú b à', 'p éi f ù b a',
  'P EY1 F AO1 R B AH1 T', 'P EY1 F AO1 R B EH1 T', 'HH EY1 F AO1 R B AH1 T',
  'HH IY1 F L UW1 B EH1 T', 'HH IY1 F UW1 B EH1 T', 'HH IY1 F AH0 L B EH1 T', 'HH EY1 F AH0 L B AH1 T',
  'HH EY1 V Y UW1 B EH1 T', 'AH0 F L UW1 B EH1 T', 'EY1 F Y UW1 B EH1 T', 'P EY1 F UW1 B AH1 T', 'HH EY1 F UW1 B ER0',
];

export const UYANDIRMA_AYARI: UyandirmaAyari = {
  dosyalar: {
    encoder: 'encoder-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
    decoder: 'decoder-epoch-13-avg-2-chunk-16-left-64.onnx',
    joiner: 'joiner-epoch-13-avg-2-chunk-16-left-64.int8.onnx',
    tokens: 'tokens.txt',
  },
  anahtar: SOYLENISLER.map((s, i) => `${s} @hf${i}`).join('\n'),
  esik: 0.1,
  skor: 2,
  kuyruk: 1,
  yol: 8,
};

/** Motor çalışmıyorken kullanıcının gördüğü tek cümle: çentik/tost ve Ayarlar → Ses ve ada satırı aynı metni yazar. */
export const UYANDIRMA_DUSTU_METNI = '“Hey Fuber” şu an çalışmıyor; kısayolla konuşabilirsin.';

/** calisiyor → dustu (30 sn sonra bir kez yeniden denenir) → calisiyor ya da vazgecti (yeni deneme yok, ayar değişene ya da uygulama açılana dek).
 *  Kulak her başarılı açılışta 'calisiyor' bildirir: ana süreçte kalan eski 'vazgecti' yeni pencereyle biter. */
export type UyandirmaDurumu = 'calisiyor' | 'dustu' | 'vazgecti';

/** Ayarlar değişince: kullanıcı "Hey Fuber"i ya da mikrofonu kapattıysa düşme hâli biter (yeniden açınca motor baştan dener). Kulak penceresi
 *  (dolayısıyla mikrofon) gerekli mi? Pencere kapanınca mikrofon gerçekten bırakılır: uyandırma vazgeçtiyse yalnız gün kaydı tutar. Pencere gün kaydı
 *  için yaşıyor olsa da durum değişmiş olabilir: çağıran `durum` değiştiyse yayınlar, yoksa Ayarlar satırı bayat kalır. */
export function kulakKarari(o: { durum: UyandirmaDurumu; mikrofonKapali: boolean; uyandirma: boolean; gunKaydi: boolean; kurulumTamam: boolean }): { durum: UyandirmaDurumu; gerekli: boolean } {
  const durum: UyandirmaDurumu = !o.uyandirma || o.mikrofonKapali ? 'calisiyor' : o.durum;
  return { durum, gerekli: !o.mikrofonKapali && o.kurulumTamam && ((o.uyandirma && durum !== 'vazgecti') || o.gunKaydi) };
}

/** Ana sürecin kararı: ilk düşüşte bir kez söyle (yeniden denemede yinelenmez), vazgeçince kulağı yeniden değerlendir. */
export function uyandirmaGecisi(onceki: UyandirmaDurumu, yeni: UyandirmaDurumu): { durum: UyandirmaDurumu; soyle: boolean; kulakYenile: boolean } {
  return { durum: yeni, soyle: onceki === 'calisiyor' && yeni !== 'calisiyor', kulakYenile: yeni === 'vazgecti' };
}
