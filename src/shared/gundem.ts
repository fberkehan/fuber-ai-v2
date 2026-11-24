// ── Gündem bandı (Görev 24, K14): "bekleyen takvimler her zaman yukarıda" ─────────────────────────────────────────────────
// Kokpitin en üstündeki bandın sol yarısı: bugün ne bekliyor? Hatırlatıcılar (bugün ya da geciken), toplantı/görüşme içeren e-postalar
// (son 2 gün, okunmamış ya da önemli), son tarihi bugün/geçmiş açık işler, hedefi bugün/geçmiş meseleler. Bugün bir şey yoksa sıradaki
// 7 günün kayıtları ("Sıradaki"); o da yoksa bant boş kalmaz — arayüz günün özetini ve hızlı başlangıçları gösterir (tur: 'bos').
// Saf işlev (DOM yok): tests/gundem.test.ts.
import type { KokpitVerisi } from './tipler.ts';

export type GundemTuru = 'hatirlatici' | 'toplanti' | 'gorev' | 'mesele';
export interface GundemOgesi {
  id: string;
  tur: GundemTuru;
  baslik: string;
  /** Zaman (ISO): hatırlatıcı/son tarih; e-postada gelme zamanı. Meselede gün (YYYY-AA-GG). */
  zaman?: string;
  /** Geçmiş (gecikmiş) iş. */
  gecikti: boolean;
  /** Kısa ikincil bilgi: "e-posta · Ece Aydın", "Mavi Kuş". */
  alt?: string;
  /** Kaynak kaydın kimliği (tıklama: hatırlatıcı/e-posta/görev numarası). */
  kayit: number;
}
export interface Gundem { kip: 'bugun' | 'siradaki' | 'bos'; ogeler: GundemOgesi[]; toplam: number }

/** Toplantı/görüşme sözcükleri (Türkçe + İngilizce davet dili), sözcük başında (düzeltme turu 1: "sunum", "call", "takvim" gibi geniş
 *  sözcükler çıkarıldı — bülten ve fatura e-postaları gündeme düşmesin). Türkçe ekler serbest ("toplantısı", "görüşmemiz"). */
export const TOPLANTI_RE = /(?:^|[^\p{L}\p{N}])(?:toplantı|görüşme|randevu|davet(?:i|iye|lisin)?\b|buluşma|webinar|meeting|invitation|invite\b|zoom\b|teams toplant|google meet)/iu;

const gunSonu = (t: number) => { const d = new Date(t); d.setHours(23, 59, 59, 999); return d.getTime(); };
const gunAnahtari = (t: number) => new Date(t).toLocaleDateString('sv-SE');

export function gundemOgeleri(v: Pick<KokpitVerisi, 'hatirlaticilar' | 'gorevler' | 'epostalar'> & { dusunme?: Pick<KokpitVerisi['dusunme'], 'meseleler'> }, simdi = Date.now(), enCok = 12): Gundem {
  const bugunSonu = gunSonu(simdi);
  const haftaSonu = gunSonu(simdi + 7 * 86_400_000);
  const bugun = gunAnahtari(simdi);
  const bugunler: GundemOgesi[] = [];
  const siradakiler: GundemOgesi[] = [];
  const t = (iso?: string) => Date.parse(iso ?? '');

  for (const h of v.hatirlaticilar) {
    if (h.durum !== 'bekliyor') continue;
    const z = t(h.zaman);
    if (!Number.isFinite(z)) continue;
    const o: GundemOgesi = { id: `h:${h.id}`, tur: 'hatirlatici', baslik: h.baslik, zaman: h.zaman, gecikti: z < simdi, alt: h.aciklama || undefined, kayit: h.id };
    if (z <= bugunSonu) bugunler.push(o); else if (z <= haftaSonu) siradakiler.push(o);
  }
  for (const g of v.gorevler) {
    const z = t(g.sonTarih);
    if (!Number.isFinite(z)) continue;
    const o: GundemOgesi = { id: `g:${g.id}`, tur: 'gorev', baslik: g.baslik, zaman: g.sonTarih, gecikti: z < simdi, alt: g.proje || undefined, kayit: g.id };
    if (z <= bugunSonu) bugunler.push(o); else if (z <= haftaSonu) siradakiler.push(o);
  }
  for (const e of v.epostalar) {
    const z = t(e.tarih);
    if (!Number.isFinite(z) || simdi - z > 48 * 3600_000) continue;
    if ((e.okundu && e.onem < 4) || !TOPLANTI_RE.test(`${e.konu} ${e.ozet}`)) continue;
    bugunler.push({ id: `e:${e.id}`, tur: 'toplanti', baslik: e.konu || '(konusuz)', zaman: e.tarih, gecikti: false, alt: `e-posta · ${e.kimden.replace(/<.*>/, '').trim()}`, kayit: e.id });
  }
  for (const m of v.dusunme?.meseleler ?? []) {
    if (m.durum !== 'acik' || !m.hedef) continue;
    const hedef = m.hedef.slice(0, 10);
    const o: GundemOgesi = { id: `m:${m.id}`, tur: 'mesele', baslik: m.baslik, zaman: hedef, gecikti: hedef < bugun, alt: m.kisi || undefined, kayit: m.id };
    if (hedef <= bugun) bugunler.push(o); else if (hedef <= gunAnahtari(haftaSonu)) siradakiler.push(o);
  }

  // Sıra: gecikenler önce, sonra zamana göre; e-postalar (gelme zamanı geçmişte) gecikme sayılmaz → zamanlı işlerin arkasına.
  const sira = (o: GundemOgesi) => (o.tur === 'toplanti' ? Number.MAX_SAFE_INTEGER - 1 : o.tur === 'mesele' ? Date.parse(`${o.zaman}T23:59:00`) : t(o.zaman));
  const sirala = (l: GundemOgesi[]) => l.sort((a, b) => Number(b.gecikti) - Number(a.gecikti) || sira(a) - sira(b));
  if (bugunler.length) return { kip: 'bugun', ogeler: sirala(bugunler).slice(0, enCok), toplam: bugunler.length };
  if (siradakiler.length) return { kip: 'siradaki', ogeler: sirala(siradakiler).slice(0, enCok), toplam: siradakiler.length };
  return { kip: 'bos', ogeler: [], toplam: 0 };
}

/** "HH:MM" → gün içindeki dakika; geçersizse null. */
function dakikaOku(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s).trim());
  if (!m) return null;
  const sa = Number(m[1]), dk = Number(m[2]);
  return sa > 23 || dk > 59 ? null : sa * 60 + dk;
}

/** 0.13 T15 (Spec I, "Gece ne değişti"): gece gelen e-posta ve mesaj sayısı. Gece = `simdi`'ye göre EN SON başlayan sessiz saat aralığı
 *  (Ayarlar → Kendiliğinden yazma; `bas`–`bit` "HH:MM", gece yarısını aşabilir); `olaylar`ın zamanı aralıkta (uçlar dahil, `simdi`den ilerisi
 *  hariç) olanlar sayılır, gündüz gelenler sayılmaz. Başlangıç = bitiş ya da geçersiz saat: aralık yok, 0. */
export function geceGelenler(simdi: number, sessiz: { bas: string; bit: string }, olaylar: readonly { zaman: string }[]): number {
  const bas = dakikaOku(sessiz.bas), bit = dakikaOku(sessiz.bit);
  if (bas === null || bit === null || bas === bit) return 0;
  const sure = ((bit - bas + 1440) % 1440) * 60_000; // aralığın uzunluğu (ms)
  const gun = new Date(simdi);
  let baslangic = new Date(gun.getFullYear(), gun.getMonth(), gun.getDate(), Math.floor(bas / 60), bas % 60).getTime();
  if (baslangic > simdi) baslangic = new Date(gun.getFullYear(), gun.getMonth(), gun.getDate() - 1, Math.floor(bas / 60), bas % 60).getTime();
  const son = Math.min(baslangic + sure, simdi);
  return olaylar.filter((o) => { const z = Date.parse(o.zaman); return Number.isFinite(z) && z >= baslangic && z <= son; }).length;
}

/** Günün ne kadarı geçti (0–1): boş bantta ilerleme çizgisi. */
export function gunIlerlemesi(simdi = Date.now()): number {
  const d = new Date(simdi);
  return (d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds()) / 86_400;
}

/** ISO hafta numarası (Pazartesi başlar). */
export function haftaNumarasi(simdi = Date.now()): number {
  const d = new Date(simdi);
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const gun = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - gun);
  const yil = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t.getTime() - yil.getTime()) / 86_400_000 + 1) / 7);
}
