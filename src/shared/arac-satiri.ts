// ── Araç adımı: insan diliyle tek satır (0.11 G6) ───────────────────────────────────────────────────────────────────────────
// Araç adımlarının tasarımı tutarsızdı. Sohbet ve ada bir araç adımını TEK satır olarak gösterir: simge · ne yapıldığı ·
// durum. Örnek: "Hatırlatıcı kuruldu · Yarın 09:00 · Yatırımcı görüşmesi". Satır metni aracın adından, girdisinden ve durumundan saf
// işlevle kurulur (ana süreçteki `etiket` yalnız bu tabloda olmayan araçların yedeğidir).
//   · İş modu: araç adı, ham girdi/çıktı, koordinat ve teknik sözcük yok (IS_YASAK); Geliştirici: teknik ayrıntı (koordinat, tuş, sunucu · araç) satırda,
//     ham girdi/çıktı kartın "Ayrıntılar"ında (renderer/bilesenler/AracAdimlari.tsx).
//   · P10: YAZILAN METİN hiçbir satırda yok — bilgisayar_yaz / tarayici_yaz yalnız hedefi ve karakter sayısını, whatsapp_gonder yalnız alıcıyı,
//     e-posta alıcıyı ve konuyu söyler (gövde yok).
//   · Hata satırı ham iletiyi taşımaz (page.goto: net::ERR_…, şema hatası): yalnız ne olmadığı; reddedilen onay "Onay verilmedi" der.
import { IS_YASAK } from './is-dili.ts';
import { KART_ARACI } from './kart.ts';
import type { Mod } from './tipler.ts';

export type AracDurumu = 'calisiyor' | 'tamam' | 'hata' | 'reddedildi';
/** Aracın şimdiki hâli. `etiket`: ana sürecin kayıt defterindeki etiketi — tabloda olmayan (MCP dışı) araçlar için yedek. */
export interface AracSonuc { durum: AracDurumu; ozet?: string; etiket?: string }
export interface AracSatiriSonucu { simge: string; metin: string; durum: 'suruyor' | 'tamam' | 'hata' }

type G = Record<string, unknown>;
type Cumleler = readonly [suruyor: string, tamam: string, hata: string];
interface Giris {
  /** Ikon adı (renderer/bilesenler/Ikon.tsx). */
  simge: string;
  /** [sürüyor, tamam, hata]; duruma ve girdiye göre değişenler işlev olur. */
  c: Cumleler | ((g: G, mod: Mod) => Cumleler);
  /** Onay istenen araçta kullanıcı reddederse "…gönderilmedi" gibi olumsuz yalın cümle (yoksa hata cümlesi). */
  r?: string;
  /** "·" ile eklenen ayrıntılar (boşlar düşer). */
  d?: (g: G, mod: Mod, simdi: Date) => (string | undefined)[];
}

const nesne = (g: unknown): G => (typeof g === 'object' && g !== null && !Array.isArray(g) ? (g as G) : {});

/** Tek satır: satır sonları tek boşluk; `n` karakterden uzunsa … ile biter (kod noktasıyla). Dize ya da sayı değilse undefined. */
function kisa(d: unknown, n: number): string | undefined {
  if (typeof d !== 'string' && typeof d !== 'number') return undefined;
  const s = String(d).replace(/\s+/g, ' ').trim();
  if (!s) return undefined;
  const k = [...s];
  return k.length > n ? `${k.slice(0, n - 1).join('').trimEnd()}…` : s;
}
const tirnakli = (d: unknown, n = 40): string | undefined => { const s = kisa(d, n); return s ? `“${s}”` : undefined; };

const GUN = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const iki = (n: number) => String(n).padStart(2, '0');

/** ISO zaman → "Bugün 18:30", "Yarın 09:00", "Cuma 09:00" (2–6 gün), "12 Kas 08:00"; yerel saatle, 24 saat. ISO olmayan (ör. "yarın") ya da bozuk değer: undefined. */
function zamanMetni(d: unknown, simdi: Date): string | undefined {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(d.trim())) return undefined;
  const t = new Date(d.trim());
  if (Number.isNaN(t.getTime())) return undefined;
  const gunNo = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / 86_400_000;
  const fark = Math.round(gunNo(t) - gunNo(simdi));
  const saat = `${iki(t.getHours())}:${iki(t.getMinutes())}`;
  if (fark === 0) return `Bugün ${saat}`;
  if (fark === 1) return `Yarın ${saat}`;
  if (fark === -1) return `Dün ${saat}`;
  if (fark >= 2 && fark <= 6) return `${GUN[t.getDay()]} ${saat}`;
  return `${t.getDate()} ${AY[t.getMonth()]}${t.getFullYear() === simdi.getFullYear() ? '' : ` ${t.getFullYear()}`} ${saat}`;
}

/** Yolun son parçası ("C:\Kullanicilar\Deniz\Belgeler\rapor.pdf" → "rapor.pdf"); web adresiyse sunucu adı. Tam yol satıra girmez. */
function hedefAdi(d: unknown): string | undefined {
  const s = kisa(d, 400);
  if (!s) return undefined;
  if (/^https?:\/\//i.test(s)) { try { return kisa(new URL(s).hostname, 50); } catch { return kisa(s, 50); } }
  const parca = s.split(/[\\/]+/).filter(Boolean);
  return kisa(parca[parca.length - 1] ?? s, 50);
}
const webMi = (d: unknown) => typeof d === 'string' && /^https?:\/\//i.test(d.trim());
const karakter = (d: unknown): string | undefined => { const n = typeof d === 'string' ? [...d].length : 0; return n > 0 ? `${n} karakter` : undefined; };

// ── Araç tablosu ───────────────────────────────────────────────────────────────────────────────────────────────────────────
// Etkin/edilgen: veriyi değiştirenler edilgen ("kuruldu", "gönderildi"), bakıp okuyanlar etkin ("baktı", "okudu"). Çekim eklerinde ’ kullanılır.
const TABLO: Record<string, Giris> = {
  hafiza_ara: { simge: 'hafiza', c: ['Hafızada arıyor', 'Hafızada aradı', 'Hafızada aranamadı'], d: (g) => [tirnakli(g.sorgu)] },
  hafiza_kaydet: { simge: 'hafiza', c: ['Hafızaya kaydediliyor', 'Hafızaya kaydedildi', 'Hafızaya kaydedilemedi'], d: (g) => [kisa(g.baslik, 40)] },
  hafiza_guncelle: { simge: 'hafiza', c: ['Hafıza güncelleniyor', 'Hafıza güncellendi', 'Hafıza güncellenemedi'], d: (g) => [kisa(g.baslik, 40)] },
  hafiza_sil: { simge: 'cop', c: ['Hafızadan siliniyor', 'Hafızadan silindi', 'Hafızadan silinemedi'] },

  hatirlatici_kur: { simge: 'zil', c: ['Hatırlatıcı kuruluyor', 'Hatırlatıcı kuruldu', 'Hatırlatıcı kurulamadı'], d: (g, _m, s) => [zamanMetni(g.zaman, s), kisa(g.baslik, 40)] },
  hatirlatici_listele: { simge: 'zil', c: ['Hatırlatıcılara bakıyor', 'Hatırlatıcılara baktı', 'Hatırlatıcılara bakılamadı'] },
  hatirlatici_guncelle: {
    simge: 'zil',
    c: (g) => (g.durum === 'tamam' ? ['Hatırlatıcı tamamlanıyor', 'Hatırlatıcı tamamlandı', 'Hatırlatıcı tamamlanamadı']
      : g.durum === 'iptal' ? ['Hatırlatıcı iptal ediliyor', 'Hatırlatıcı iptal edildi', 'Hatırlatıcı iptal edilemedi']
      : ['Hatırlatıcı güncelleniyor', 'Hatırlatıcı güncellendi', 'Hatırlatıcı güncellenemedi']),
    d: (g, _m, s) => [zamanMetni(g.zaman, s), kisa(g.baslik, 40)],
  },
  gorev_ekle: { simge: 'liste', c: ['Yapılacaklara ekleniyor', 'Yapılacaklara eklendi', 'Yapılacaklara eklenemedi'], d: (g) => [kisa(g.baslik, 40)] },
  gorev_listele: { simge: 'liste', c: ['Yapılacaklara bakıyor', 'Yapılacaklara baktı', 'Yapılacaklara bakılamadı'] },
  gorev_guncelle: {
    simge: 'liste',
    c: (g) => (g.durum === 'tamam' ? ['Yapılacak iş tamamlanıyor', 'Yapılacak iş tamamlandı', 'Yapılacak iş güncellenemedi'] : ['Yapılacak iş güncelleniyor', 'Yapılacak iş güncellendi', 'Yapılacak iş güncellenemedi']),
    d: (g) => [kisa(g.baslik, 40)],
  },
  oneri_ekle: { simge: 'isik', c: (g) => (g.tur === 'dikkat' ? ['Kokpite uyarı ekleniyor', 'Kokpite uyarı eklendi', 'Kokpite uyarı eklenemedi'] : ['Kokpite öneri ekleniyor', 'Kokpite öneri eklendi', 'Kokpite öneri eklenemedi']), d: (g) => [kisa(g.baslik, 40)] },
  kokpit_kart: { simge: 'kokpit', c: ['Kokpite kart koyuluyor', 'Kokpite kart koyuldu', 'Kokpite kart koyulamadı'], d: (g) => [kisa(g.baslik, 40)] },
  kokpit_kart_kaldir: { simge: 'kokpit', c: ['Kokpitten kart kaldırılıyor', 'Kokpitten kart kaldırıldı', 'Kokpitten kart kaldırılamadı'] },
  kokpit_duzen: { simge: 'kokpit', c: ['Kokpit yerleşimi ayarlanıyor', 'Kokpit yerleşimi ayarlandı', 'Kokpit yerleşimi ayarlanamadı'] },
  zaman: { simge: 'saat', c: ['Saate bakıyor', 'Saate baktı', 'Saate bakılamadı'] },

  gun_kaydi_ara: { simge: 'saat', c: ['Gün kaydında arıyor', 'Gün kaydında aradı', 'Gün kaydında aranamadı'], d: (g) => [tirnakli(g.sorgu)] },
  gun_notlari: { simge: 'saat', c: ['Gün notlarına bakıyor', 'Gün notlarına baktı', 'Gün notlarına bakılamadı'] },
  gun_raporu: {
    simge: 'saat',
    c: (g) => { const t = g.tur === 'haftalik' ? 'Haftalık' : g.tur === 'aylik' ? 'Aylık' : 'Günlük'; return [`${t} rapora bakıyor`, `${t} rapora baktı`, `${t} rapora bakılamadı`]; },
  },
  meseleler: { simge: 'liste', c: ['Takip edileceklere bakıyor', 'Takip edileceklere baktı', 'Takip edileceklere bakılamadı'] },
  mesele_guncelle: { simge: 'liste', c: ['Takip edilecek iş güncelleniyor', 'Takip edilecek iş güncellendi', 'Takip edilecek iş güncellenemedi'] },
  gun_kaydi_duraklat: {
    simge: 'duraklat',
    c: (g) => (Number(g.dakika) > 0 ? ['Dinleme duraklatılıyor', 'Dinleme duraklatıldı', 'Dinleme duraklatılamadı'] : ['Dinleme sürdürülüyor', 'Dinleme sürdürüldü', 'Dinleme sürdürülemedi']),
    d: (g) => [Number(g.dakika) > 0 ? `${Math.round(Number(g.dakika))} dk` : undefined],
  },

  bilgisayar_ekran: { simge: 'ekran', c: ['Ekrana bakıyor', 'Ekrana baktı', 'Ekrana bakılamadı'], r: 'Ekrana bakılmadı' },
  bilgisayar_tikla: {
    simge: 'hedef',
    c: (g) => { const t = g.dugme === 'sag' ? 'sağ ' : Number(g.adet) === 2 ? 'çift ' : ''; return [`Ekranda ${t}tıklıyor`, `Ekranda ${t}tıkladı`, `Ekranda ${t}tıklanamadı`]; },
    r: 'Ekranda tıklanmadı',
    d: (g, mod) => [mod === 'gelistirici' && Number.isFinite(Number(g.x)) && Number.isFinite(Number(g.y)) && g.x !== undefined && g.y !== undefined ? `(${Math.round(Number(g.x))}, ${Math.round(Number(g.y))})` : undefined],
  },
  bilgisayar_yaz: { simge: 'kalem', c: ['Odaktaki alana yazıyor', 'Odaktaki alana yazdı', 'Odaktaki alana yazılamadı'], r: 'Odaktaki alana yazılmadı', d: (g) => [karakter(g.metin)] },
  bilgisayar_tus: { simge: 'terminal', c: ['Tuşa basıyor', 'Tuşa bastı', 'Tuşa basılamadı'], r: 'Tuşa basılmadı', d: (g) => [kisa(g.kombin, 30)] },
  bilgisayar_kaydir: {
    simge: 'asagi',
    c: (g) => { const y = Number(g.miktar) > 0 ? 'yukarı' : 'aşağı'; return [`Ekranı ${y} kaydırıyor`, `Ekranı ${y} kaydırdı`, 'Ekran kaydırılamadı']; },
    r: 'Ekran kaydırılmadı',
  },
  bilgisayar_surukle: { simge: 'hedef', c: ['Ekranda sürüklüyor', 'Ekranda sürükledi', 'Ekranda sürüklenemedi'], r: 'Ekranda sürüklenmedi' },
  bilgisayar_pencereler: { simge: 'panel', c: ['Açık pencerelere bakıyor', 'Açık pencerelere baktı', 'Açık pencerelere bakılamadı'] },
  bilgisayar_odakla: { simge: 'panel', c: ['Pencere öne getiriliyor', 'Pencere öne getirildi', 'Pencere öne getirilemedi'], d: (g) => [kisa(g.baslik, 40)] },
  uygulama_ac: {
    simge: 'dis',
    c: (g) => (webMi(g.hedef) ? ['Web adresi açılıyor', 'Web adresi açıldı', 'Web adresi açılamadı'] : ['Dosya ya da uygulama açılıyor', 'Dosya ya da uygulama açıldı', 'Dosya ya da uygulama açılamadı']),
    d: (g) => [hedefAdi(g.hedef)],
  },

  claude_code_oturumlari: {
    simge: 'kod',
    c: (g, mod) => (mod === 'gelistirici'
      ? (g.ara ? ['Claude Code oturumlarında arıyor', 'Claude Code oturumlarında aradı', 'Claude Code oturumlarında aranamadı'] : ['Claude Code oturumlarına bakıyor', 'Claude Code oturumlarına baktı', 'Claude Code oturumlarına bakılamadı'])
      : ['Bilgisayardaki kod işlerine bakıyor', 'Bilgisayardaki kod işlerine baktı', 'Bilgisayardaki kod işlerine bakılamadı']),
    d: (g, mod) => [mod === 'gelistirici' ? tirnakli(g.ara) : undefined],
  },
  claude_code_oturum: {
    simge: 'kod',
    c: (_g, mod) => (mod === 'gelistirici'
      ? ['Claude Code oturumunun son hâline bakıyor', 'Claude Code oturumunun son hâline baktı', 'Claude Code oturumuna bakılamadı']
      : ['Bir kod işinin son hâline bakıyor', 'Bir kod işinin son hâline baktı', 'Bir kod işine bakılamadı']),
  },
  claude_code_gorev: {
    simge: 'kod',
    c: (_g, mod) => (mod === 'gelistirici'
      ? ['Claude Code’a iş veriliyor', 'Claude Code’a iş verildi', 'Claude Code’a iş verilemedi']
      : ['Bilgisayarda bir iş başlatılıyor', 'Bilgisayarda bir iş başlatıldı', 'Bilgisayarda iş başlatılamadı']),
    r: 'Bilgisayarda iş başlatılmadı',
    d: (g, mod) => [mod === 'gelistirici' ? tirnakli(g.komut) : undefined],
  },
  // 0.14 T18: yalnız Developer mode'da sunulur; komut metni yalnız Developer satırında.
  komut_calistir: {
    simge: 'kod', c: ['Komut çalıştırılıyor', 'Komut çalıştırıldı', 'Komut çalıştırılamadı'], r: 'Komut çalıştırılmadı',
    d: (g, mod) => [mod === 'gelistirici' ? tirnakli(g.komut, 60) : undefined],
  },
  // Analiz 11 Kas (bulgu 4): arka plan süreçleri (yalnız Developer mode).
  surec_cikti: { simge: 'kod', c: ['Süreç çıktısına bakıyor', 'Süreç çıktısına baktı', 'Süreç çıktısı okunamadı'], d: (g) => [kisa(g.kimlik, 20)] },
  surec_durdur: { simge: 'kod', c: ['Süreç durduruluyor', 'Süreç durduruldu', 'Süreç durdurulamadı'], d: (g) => [kisa(g.kimlik, 20)] },

  eposta_listele: {
    simge: 'posta',
    c: (g) => (g.ara ? ['E-postalarda arıyor', 'E-postalarda aradı', 'E-postalarda aranamadı'] : ['Gelen kutusuna bakıyor', 'Gelen kutusuna baktı', 'Gelen kutusuna bakılamadı']),
    d: (g) => [tirnakli(g.ara)],
  },
  eposta_oku: { simge: 'posta', c: ['E-postayı okuyor', 'E-postayı okudu', 'E-posta okunamadı'] },
  eposta_gonder: { simge: 'posta', c: ['E-posta gönderiliyor', 'E-posta gönderildi', 'E-posta gönderilemedi'], r: 'E-posta gönderilmedi', d: (g) => [kisa(g.kime, 40), kisa(g.konu, 40)] },
  mcp_kullan: {
    simge: 'baglanti',
    c: (_g, mod) => (mod === 'gelistirici' ? ['MCP sunucusu açılıyor', 'MCP sunucusu açıldı', 'MCP sunucusu açılamadı'] : ['Bağlı bir araç hazırlanıyor', 'Bağlı bir araç hazırlandı', 'Bağlı araç hazırlanamadı']),
    d: (g, mod) => [mod === 'gelistirici' ? kisa(g.sunucu, 40) : undefined],
  },
  whatsapp_sohbetler: { simge: 'wp', c: ['WhatsApp sohbetlerine bakıyor', 'WhatsApp sohbetlerine baktı', 'WhatsApp sohbetlerine bakılamadı'] },
  whatsapp_oku: { simge: 'wp', c: ['WhatsApp yazışmasını okuyor', 'WhatsApp yazışmasını okudu', 'WhatsApp yazışması okunamadı'], d: (g) => [kisa(g.kim, 40)] },
  whatsapp_gonder: { simge: 'wp', c: ['WhatsApp mesajı gönderiliyor', 'WhatsApp mesajı gönderildi', 'WhatsApp mesajı gönderilemedi'], r: 'WhatsApp mesajı gönderilmedi', d: (g) => [kisa(g.kime, 40)] },

  dosya_listele: { simge: 'klasor', c: ['Klasöre bakıyor', 'Klasöre baktı', 'Klasöre bakılamadı'], r: 'Klasöre bakılmadı', d: (g) => [hedefAdi(g.yol)] },
  dosya_oku: { simge: 'dosya', c: ['Dosyayı okuyor', 'Dosyayı okudu', 'Dosya okunamadı'], r: 'Dosya okunmadı', d: (g) => [hedefAdi(g.yol)] },
  // 0.14 T17: dosya yazma ve belge üretme. Yazılan metin satırda yok (P10): yalnız dosya adı.
  dosya_yaz: {
    simge: 'kalem',
    c: (g) => (g.kip === 'ekle' ? ['Dosyaya ekleniyor', 'Dosyaya eklendi', 'Dosyaya eklenemedi'] : ['Dosya yazılıyor', 'Dosya yazıldı', 'Dosya yazılamadı']),
    r: 'Dosya yazılmadı', d: (g) => [hedefAdi(g.yol)],
  },
  dosya_duzenle: { simge: 'kalem', c: ['Dosya düzenleniyor', 'Dosya düzenlendi', 'Dosya düzenlenemedi'], r: 'Dosya düzenlenmedi', d: (g) => [hedefAdi(g.yol)] },
  dosya_sil: { simge: 'dosya', c: ['Dosya Geri Dönüşüm Kutusu’na atılıyor', 'Dosya Geri Dönüşüm Kutusu’na atıldı', 'Dosya silinemedi'], r: 'Dosya silinmedi', d: (g) => [hedefAdi(g.yol)] },
  belge_uret: {
    simge: 'dosya',
    c: (g) => {
      const t = g.tur === 'docx' ? 'Word belgesi' : g.tur === 'xlsx' ? 'Excel tablosu' : g.tur === 'pptx' ? 'Sunum' : g.tur === 'pdf' ? 'PDF belgesi' : 'Belge';
      return [`${t} hazırlanıyor`, `${t} hazırlandı`, `${t} hazırlanamadı`];
    },
    r: 'Belge hazırlanmadı', d: (g) => [hedefAdi(g.yol)],
  },

  tarayici_ac: {
    simge: 'kure', c: ['Web’e bakıyor', 'Web’e baktı', 'Web’e bakılamadı'],
    d: (g) => [webMi(g.adres) ? hedefAdi(g.adres) : tirnakli(g.adres, 40)],
  },
  // 0.14 T14: Fuber'in kendi web araçları (sohbet modelinden bağımsız). web_ara: sorgu satırda; sayfa_oku: sunucu adı.
  web_ara: { simge: 'kure', c: ['Web’de arıyor', 'Web’de aradı', 'Web’de aranamadı'], d: (g) => [tirnakli(g.sorgu)] },
  sayfa_oku: { simge: 'kure', c: ['Web sayfasını okuyor', 'Web sayfasını okudu', 'Web sayfası okunamadı'], d: (g) => [hedefAdi(g.adres)] },
  tarayici_oku: { simge: 'kure', c: ['Sayfayı okuyor', 'Sayfayı okudu', 'Sayfa okunamadı'] },
  tarayici_tikla: { simge: 'kure', c: ['Sayfada tıklıyor', 'Sayfada tıkladı', 'Sayfada tıklanamadı'], r: 'Sayfada tıklanmadı', d: (g, mod) => [mod === 'gelistirici' && Number.isFinite(Number(g.no)) && g.no !== undefined ? `öğe ${Math.round(Number(g.no))}` : undefined] },
  tarayici_yaz: {
    simge: 'kalem',
    c: (g) => { const hedef = Number.isFinite(Number(g.no)) && g.no !== undefined && g.no !== null ? `Sayfada ${Math.round(Number(g.no))} numaralı alana` : 'Sayfadaki alana'; return [`${hedef} yazıyor`, `${hedef} yazdı`, `${hedef} yazılamadı`]; },
    r: 'Sayfadaki alana yazılmadı',
    d: (g) => [karakter(g.metin)],
  },
  tarayici_kaydir: { simge: 'kure', c: ['Sayfayı kaydırıyor', 'Sayfayı kaydırdı', 'Sayfa kaydırılamadı'] },
  tarayici_ekran: { simge: 'kamera', c: ['Sayfanın görüntüsünü alıyor', 'Sayfanın görüntüsünü aldı', 'Sayfanın görüntüsü alınamadı'] },
  tarayici_geri: { simge: 'geri', c: ['Önceki sayfaya dönüyor', 'Önceki sayfaya döndü', 'Önceki sayfaya dönülemedi'] },
  // 0.14 T15: sekmeler, açılır liste, tuşlar, bekleme, onaylı indirme. P10: basılan tuşlar ve seçilen değer satırda yok.
  tarayici_sekme: {
    simge: 'kure',
    c: (g) => (g.eylem === 'ac' ? ['Yeni sekme açıyor', 'Yeni sekme açtı', 'Yeni sekme açılamadı']
      : g.eylem === 'kapat' ? ['Sekmeyi kapatıyor', 'Sekmeyi kapattı', 'Sekme kapatılamadı']
      : g.eylem === 'gec' ? ['Başka sekmeye geçiyor', 'Başka sekmeye geçti', 'Sekmeye geçilemedi']
      : ['Sekmelere bakıyor', 'Sekmelere baktı', 'Sekmelere bakılamadı']),
  },
  tarayici_sec: { simge: 'liste', c: ['Listeden seçiyor', 'Listeden seçti', 'Listeden seçilemedi'], r: 'Listeden seçilmedi' },
  tarayici_tus: { simge: 'kalem', c: ['Sayfada tuşa basıyor', 'Sayfada tuşa bastı', 'Sayfada tuşa basılamadı'], r: 'Sayfada tuşa basılmadı' },
  tarayici_bekle: { simge: 'saat', c: ['Sayfayı bekliyor', 'Sayfayı bekledi', 'Sayfa beklenemedi'] },
  tarayici_indir: { simge: 'indir', c: ['Dosya indiriyor', 'Dosya indirdi', 'Dosya indirilemedi'], r: 'Dosya indirilmedi' },

  kart_goster: { simge: 'kart', c: ['Kart hazırlıyor', 'Kart hazırlandı', 'Kart hazırlanamadı'], d: (g, mod) => [mod === 'gelistirici' ? kisa(g.tur, 20) : undefined] },

  // 0.11 G9: Görevler (TERIM.gorev). Satırda yalnız görevin başlığı/numarası; adımın özeti ve bildirimi satıra girmez (görev sohbetinde ve ana
  // sohbette kendi mesajı olarak görünür).
  is_baslat: { simge: 'saat', c: ['Görev hazırlanıyor', 'Görev başladı', 'Görev başlatılamadı'], r: 'Görev başlatılmadı', d: (g) => [kisa(g.baslik, 40)] },
  is_adim_bitti: { simge: 'tamam', c: ['Adım kaydediliyor', 'Adım kaydedildi', 'Adım kaydedilemedi'] },
  is_listele: { simge: 'liste', c: ['Görevlere bakıyor', 'Görevlere baktı', 'Görevlere bakılamadı'] },
  is_durdur: { simge: 'dur', c: ['Görev durduruluyor', 'Görev durduruldu', 'Görev durdurulamadı'], d: (g) => [Number.isFinite(Number(g.id)) && g.id !== undefined && g.id !== null ? `#${Math.round(Number(g.id))}` : undefined] },
};

/** Tablodaki araç adları (yeni araç eklenince tests/arac-karti-etiket.test.ts hatırlatır). */
export const aracSatiriAdlari: readonly string[] = Object.keys(TABLO);

const YEDEK: Cumleler = ['Bir adım yapılıyor', 'Bir adım tamamlandı', 'Bir adım tamamlanamadı'];
const MCP_IS: Cumleler = ['Bağlı bir araç kullanılıyor', 'Bağlı bir araç kullanıldı', 'Bağlı araç kullanılamadı'];
const SIRA: Record<'suruyor' | 'tamam' | 'hata', 0 | 1 | 2> = { suruyor: 0, tamam: 1, hata: 2 };

function durumCoz(s: AracSonuc | null | undefined): { durum: 'suruyor' | 'tamam' | 'hata'; red: boolean } {
  if (!s || s.durum === 'calisiyor') return { durum: 'suruyor', red: false };
  if (s.durum === 'tamam') return { durum: 'tamam', red: false };
  return { durum: 'hata', red: s.durum === 'reddedildi' };
}

/**
 * Bir araç adımının tek satırı. `sonuc` yoksa adım sürüyor. `mod` İş ise teknik sözcük, araç adı ve ham değer yok; Geliştirici'de teknik ayrıntı
 * satırda. `simdi`: göreli zaman ("Yarın 09:00") için (testte sabitlenir).
 */
export function aracSatiri(arac: string, girdi: unknown, sonuc: AracSonuc | null | undefined, mod: Mod, simdi: Date = new Date()): AracSatiriSonucu {
  const { durum, red } = durumCoz(sonuc);
  const g = nesne(girdi);
  const i = SIRA[durum];
  const giris = Object.hasOwn(TABLO, arac) ? TABLO[arac] : undefined;
  if (giris) {
    const c = typeof giris.c === 'function' ? giris.c(g, mod) : giris.c;
    const ilk = red && giris.r ? giris.r : c[i];
    const parcalar = [ilk, ...(giris.d?.(g, mod, simdi) ?? []), ...(red ? ['Onay verilmedi'] : [])].filter((p): p is string => Boolean(p));
    return { simge: giris.simge, metin: parcalar.join(' · '), durum };
  }
  // MCP araçları kayıt defterinde değil: "mcp__Sunucu_adi__arac_adi" → Geliştirici "Sunucu adı · arac adı", İş sade cümle.
  const mcp = /^mcpg?__(.+?)__(.+)$/.exec(arac); // 0.14 T16: Developer sunucusu öneki mcpg__
  if (mcp) {
    const ad = `${mcp[1].replace(/_/g, ' ')} · ${mcp[2].replace(/_/g, ' ')}`;
    const metin = mod === 'gelistirici' ? (durum === 'hata' ? `${ad} · tamamlanamadı` : ad) : MCP_IS[i];
    return { simge: 'baglanti', metin: red ? `${metin} · Onay verilmedi` : metin, durum };
  }
  // Tabloda olmayan araç: kayıt defterinin etiketi (İş'te teknik sözcük taşımıyorsa), yoksa sade cümle.
  const e = kisa(sonuc?.etiket, 90);
  const kullan = e && (mod === 'gelistirici' || !IS_YASAK.test(e)) ? e : undefined;
  const metin = kullan && durum !== 'hata' ? kullan : YEDEK[i];
  return { simge: 'arac', metin: red ? `${metin} · Onay verilmedi` : metin, durum };
}

/** Yazılan metni taşıyan araçlarda o alan: "Ayrıntılar"da da yalnız karakter sayısı görünür (P10). */
const YAZILAN_ALAN: Record<string, string> = { bilgisayar_yaz: 'metin', tarayici_yaz: 'metin', whatsapp_gonder: 'metin', eposta_gonder: 'govde' };

/**
 * Adım satırı kullanıcıya gösterilir mi? İş kipinde BAŞARISIZ `kart_goster` satırı ("Kart hazırlanamadı · Olmadı") gösterilmez: model geçersiz
 * kartı düzeltip yeniden dener ya da metinle yanıtlar — satır yalnız gürültü. Geliştirici'de görünür kalır; sürüyorsa ("Kart hazırlıyor") ve başarılı
 * olanlar kartın kendisidir. Grup özeti ("N adım", "1 adım olmadı") gizlenen satırları saymaz; görünür adım kalmayan grup hiç çıkmaz.
 */
export function adimGorunurMu(arac: string, durum: AracDurumu, mod: Mod): boolean {
  return !(mod !== 'gelistirici' && arac === KART_ARACI && (durum === 'hata' || durum === 'reddedildi'));
}

/** "Ayrıntılar" (yalnız Geliştirici): ham girdi, okunur JSON; yazılan metin yerine "[24 karakter]"; `sinir` karakterde kesilir (kart içinde kaydırma yok). */
export function ayrintiMetni(arac: string, girdi: unknown, sinir = 700): string {
  const g: G = { ...nesne(girdi) };
  const alan = YAZILAN_ALAN[arac];
  if (alan && typeof g[alan] === 'string') g[alan] = `[${[...(g[alan] as string)].length} karakter]`;
  let s = '';
  try { s = JSON.stringify(g, null, 2) ?? ''; } catch { s = ''; }
  const k = [...s];
  return k.length > sinir ? `${k.slice(0, sinir - 1).join('')}…` : s;
}

/** Kayıt defterindeki `etiket` (ana süreç: şerit, Beyin, ada, telefon): yazılan metin YOK (P10) — "Odaktaki alana yazıyor · 24 karakter". */
export function yazmaEtiketi(arac: 'bilgisayar_yaz' | 'tarayici_yaz', girdi: unknown): string {
  return aracSatiri(arac, girdi, undefined, 'is').metin;
}
