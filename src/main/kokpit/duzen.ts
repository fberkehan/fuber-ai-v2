// ── Dinamik kokpit ───────────────────────────────────────────────────────────────────────────────────────────
// Kokpitte sohbet, son e-postalar, AI önerileri, geçmiş sohbetler, dikkat edilmesi gerekenler, planlar ve araç
// kitleri bulunur; "yarın sabah toplantım var" denince hatırlatıcı kokpitte sol üstte görünür; yerleşimi tamamen
// AI belirler, dinamiktir. → Kokpit verisi tek yerde toplanır; yardımcı model bu durumu + kullanıcının
// kayıtlı yerleşim tercihlerini (hafıza, etiket "kokpit") görür ve 12 sütunluk ızgarada hangi kartın nerede, ne
// büyüklükte duracağına karar verir. Kurallar: acil/yaklaşan → sol üst; boş kart gösterilmez; özel kartlar önceliğe
// göre. Model yanıt veremezse kurallı yedek yerleşim kullanılır. Planlama en sık 90 sn'de bir (zorla = hemen).
import { veritabani, simdi } from '../vt.js';
import { hitapMetni } from '../../shared/hitap.js';
import { yayinla } from '../olaylar.js';
import { hatirlaticilar, gorevler, kokpitYapilacaklari, oneriler } from '../planlama.js';
import { kartGorevleri } from '../../shared/yapilacaklar.js';
import { hafizaListesi, hafizaAra, hafizaSayisi } from '../hafiza/depo.js';
import { yardimciJson, hazirMotorlar } from '../motor/secici.js';
import { tekMotorYolu } from '../motor/yerel.js';
import { kokpitGizlisiz } from '../../shared/gizli-suzgec.js';
import { ayarlar } from '../ayarlar.js';
import { whatsappIzinli } from '../entegrasyon/whatsapp-kapisi.js';
import { kokpitDusunmeVerisi } from '../gunkaydi/dusunme.js';
import { yerlesimiOturt, onemleriBirlestir, onemGecerli } from '../../shared/izgara.js';
import { kartDoluMu } from '../../shared/pano-duzen.js';
import { panoAyari } from '../pano/pano.js';
import type { KokpitDurumu, KokpitVerisi, KartYerlesimi, KartTipi, OzelKart, SohbetOzet } from '../../shared/tipler.js';

type S = Record<string, unknown>;
/** Kokpitin Yapılacaklar verisi en çok bu kadar madde taşır (açıklar + bugün işaretlenenler). Kart sığanı gösterir, "Tümü" levhası
 *  hepsini; sınır yalnız aşırı uçlar için (eskiden 12'ydi: 13. açık madde kokpitten erişilemiyordu — 0.11 G5 denetleyici eki). */
const YAPILACAK_KOKPIT_EN_COK = 200;
/** Kokpitin hatırlatıcı verisi en çok bu kadar (bekleyenler + son 12 saatte bildirilenler); aynı makul sınır (düzeltme turu 1, K4). */
const HATIRLATICI_KOKPIT_EN_COK = 200;

// ── Özel kartlar ─────────────────────────────────────────────────────────────────────────────────────────────
export function ozelKartYaz(k: { id: string; baslik: string; icerik?: string; liste?: string[]; metrikler?: { ad: string; deger: string }[]; oncelik?: number; saat?: number }): void {
  const z = simdi();
  const veri = JSON.stringify({ icerik: k.icerik, liste: k.liste, metrikler: k.metrikler });
  veritabani()
    .prepare(`INSERT INTO ozel_kartlar(id, baslik, veri, oncelik, olusturma, guncelleme, bitis) VALUES(?,?,?,?,?,?,?)
              ON CONFLICT(id) DO UPDATE SET baslik=excluded.baslik, veri=excluded.veri, oncelik=excluded.oncelik, guncelleme=excluded.guncelleme, bitis=excluded.bitis`)
    .run(k.id.slice(0, 60), k.baslik.slice(0, 120), veri, k.oncelik ?? 3, z, z, k.saat ? new Date(Date.now() + k.saat * 3600_000).toISOString() : null);
}
export function ozelKartSil(id: string): void { veritabani().prepare('DELETE FROM ozel_kartlar WHERE id = ?').run(id); }
function ozelKartlar(): OzelKart[] {
  return (veritabani().prepare('SELECT * FROM ozel_kartlar WHERE bitis IS NULL OR bitis > ? ORDER BY oncelik DESC, guncelleme DESC').all(simdi()) as S[]).map((s) => {
    const v = JSON.parse(String(s.veri));
    return { id: String(s.id), baslik: String(s.baslik), icerik: v.icerik, liste: v.liste, metrikler: v.metrikler, oncelik: Number(s.oncelik), guncelleme: String(s.guncelleme) };
  });
}

// ── Zihin durumu (kokpitteki beyin) ──────────────────────────────────────────────────────────────────────────
let zihin: KokpitVerisi['zihin']['durum'] = 'bos';
export function zihinDurumu(d: KokpitVerisi['zihin']['durum']): void {
  if (zihin === d) return;
  zihin = d;
  yayinla('zihin:durum', d);
}

// ── Veri ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function sohbetOzetleri(limit = 8): SohbetOzet[] {
  return (veritabani()
    .prepare(`SELECT s.id, s.baslik, s.tur, s.guncelleme, s.okunmamis,
              (SELECT metin FROM mesajlar m WHERE m.sohbet_id = s.id AND m.rol IN ('user','assistant') AND m.metin != '' ORDER BY m.id DESC LIMIT 1) son
              FROM sohbetler s WHERE s.arsiv = 0 AND s.tur != 'gorev' ORDER BY (s.tur = 'ana') DESC, s.guncelleme DESC LIMIT ?`)
    .all(limit) as S[]).map((s) => ({ id: Number(s.id), baslik: String(s.baslik), tur: s.tur as SohbetOzet['tur'], guncelleme: String(s.guncelleme), sonMesaj: s.son ? String(s.son).slice(0, 140) : undefined, okunmamis: Number(s.okunmamis) }));
}

export function kokpitVerisi(): KokpitVerisi {
  const vt = veritabani();
  const epostalar = (vt.prepare('SELECT id, hesap, kimden, konu, tarih, ozet, okundu, onem FROM epostalar ORDER BY tarih DESC LIMIT 12').all() as S[]).map((s) => ({
    id: Number(s.id), hesap: String(s.hesap), kimden: String(s.kimden ?? ''), konu: String(s.konu ?? '(konusuz)'), tarih: String(s.tarih ?? ''), ozet: String(s.ozet ?? ''), okundu: Boolean(s.okundu), onem: Number(s.onem),
  }));
  // WhatsApp yalnız yetki varken (modül + İş modu + WhatsApp hakkı; whatsapp-kapisi.ts) — yoksa kart boş, yerel kayıt dursa da.
  const whatsapp = !whatsappIzinli() ? [] : (vt.prepare(`SELECT jid, MAX(ad) ad, MAX(zaman) zaman, SUM(CASE WHEN okundu = 0 AND yon = 'gelen' THEN 1 ELSE 0 END) okunmamis,
      (SELECT metin FROM wa_mesajlar w2 WHERE w2.jid = w.jid ORDER BY zaman DESC LIMIT 1) son
      FROM wa_mesajlar w GROUP BY jid ORDER BY zaman DESC LIMIT 8`).all() as S[]).map((s) => ({ jid: String(s.jid), ad: String(s.ad ?? s.jid), sonMesaj: String(s.son ?? ''), zaman: String(s.zaman), okunmamis: Number(s.okunmamis) }));
  const ice = vt.prepare(`SELECT SUM(durum='bekliyor') bekleyen, SUM(durum='islendi') islenen, SUM(durum='hata') hata, SUM(durum='ozetsiz') ozetsiz, MAX(islenme) son FROM belgeler`).get() as S;
  return {
    // 0.11 G5 düzeltme turu 1 (K4): kartın "Tümü" levhası bekleyenlerin TAMAMINI gösterir, sayısı gerçek toplamdır (eskiden 12'de
    // kesiliyordu). Planlayıcı özeti yine ilk 6'yı okur (durumOzeti): istem büyümez.
    hatirlaticilar: hatirlaticilar({ limit: HATIRLATICI_KOKPIT_EN_COK }),
    gorevler: gorevler({ limit: 12 }),
    // 0.11 G4: Yapılacaklar kartı = açıklar + yerel bugünün işaretlileri (üstü çizili kalır). `gorevler` açık kalır: gündem, gün özeti,
    // kart önemi ve planlayıcı özeti işaretli maddeyi "bekleyen" saymasın; Gizli'de tamamlananlar da planlayıcıya gitmesin.
    yapilacaklar: kokpitYapilacaklari(new Date(), YAPILACAK_KOKPIT_EN_COK),
    oneriler: oneriler(10),
    epostalar,
    whatsapp,
    sohbetler: sohbetOzetleri(8),
    projeler: hafizaListesi({ tur: 'proje', limit: 10 }).map((h) => ({ id: h.id, baslik: h.baslik, icerik: h.icerik.slice(0, 220), guncelleme: h.guncelleme })),
    hafiza: hafizaListesi({ limit: 8 }).map((h) => ({ id: h.id, baslik: h.baslik, tur: h.tur, guncelleme: h.guncelleme })),
    iceAktarma: { bekleyen: Number(ice?.bekleyen ?? 0), islenen: Number(ice?.islenen ?? 0), hata: Number(ice?.hata ?? 0), ozetsiz: Number(ice?.ozetsiz ?? 0), son: (ice?.son as string) || undefined },
    ozelKartlar: ozelKartlar(),
    zihin: { durum: zihin, hafizaSayisi: hafizaSayisi(), bagliMotorlar: hazirMotorlar() },
    dusunme: kokpitDusunmeVerisi(),
  };
}

// ── Yerleşim ─────────────────────────────────────────────────────────────────────────────────────────────────
// Görev 24: doldurucular (hava, haberler, piyasa, ipuclari) da planlayıcının yerleştirebileceği tiplerdir (kullanıcı "hava en üstte"
// derse); yerleştirilmeyenleri arayüz boşluğa göre kendisi ekler (shared/pano-duzen.ts). Gündem bandı ('gundem') planlanmaz: arayüz
// onu her zaman zihin bandının altına koyar.
const TIPLER: KartTipi[] = ['zihin', 'hatirlatici', 'eposta', 'oneriler', 'dikkat', 'plan', 'sohbetler', 'projeler', 'arac_kiti', 'whatsapp', 'hafiza', 'ice_aktarma', 'ozel', 'dusunme', 'meseleler', 'hava', 'haberler', 'piyasa', 'ipuclari'];

/** Metni kelime sınırında kısalt (yarım kelime bırakma). */
function kelimeKisalt(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ');
  if (t.length <= n) return t;
  const k = t.slice(0, n + 1);
  const son = Math.max(k.lastIndexOf(' '), k.lastIndexOf(','));
  return `${(son > n * 0.5 ? k.slice(0, son) : t.slice(0, n)).replace(/[,;:.\s]+$/, '')}…`;
}

function selamlama(): string {
  const h = new Date().getHours();
  const ad = hitapMetni(ayarlar().kullaniciAdi, ayarlar().hitap);
  // 11 Kas (tasarımcı bulgu 13): gece yarısından sonra "İyi geceler" (veda sözü) değil "Merhaba".
  const s = h < 5 ? 'Merhaba' : h < 12 ? 'Günaydın' : h < 18 ? 'İyi günler' : 'İyi akşamlar';
  return ad ? `${s}, ${ad}` : s;
}

/** Kurallı yedek yerleşim: acil hatırlatıcı sol üstte; boş kartlar yok. */
/** Yalnız bekleyenler: bildirilmiş (geçmiş) hatırlatıcı kartı "acil" yapmaz, sol üste çekmez. */
const bekleyenler = (v: KokpitVerisi) => v.hatirlaticilar.filter((h) => h.durum === 'bekliyor');

export function yedekYerlesim(v: KokpitVerisi): KartYerlesimi[] {
  // Zihin bandı HER ZAMAN ilk kart, tam genişlikte ve tek başına bir satırdır (komşusu onu germez); yaklaşan
  // hatırlatıcı bandın hemen altında sol üstte durur.
  const out: KartYerlesimi[] = [{ id: 'zihin', tip: 'zihin', kolon: 1, genislik: 12, yukseklik: 'k' }];
  const yakin = bekleyenler(v).filter((h) => Date.parse(h.zaman) - Date.now() < 36 * 3600_000);
  const acil = bekleyenler(v).some((h) => Date.parse(h.zaman) - Date.now() < 3 * 3600_000);
  if (yakin.length) out.push({ id: 'hatirlatici', tip: 'hatirlatici', kolon: 1, genislik: 4, yukseklik: 'o', vurgu: acil });
  const dikkat = v.oneriler.filter((o) => o.tur === 'dikkat');
  const oneri = v.oneriler.filter((o) => o.tur !== 'dikkat');
  if (v.dusunme.durum.etkin) out.push({ id: 'dusunme', tip: 'dusunme', kolon: 1, genislik: v.dusunme.meseleler.length ? 7 : 12, yukseklik: 'o' });
  if (v.dusunme.meseleler.length) out.push({ id: 'meseleler', tip: 'meseleler', kolon: v.dusunme.durum.etkin ? 8 : 1, genislik: v.dusunme.durum.etkin ? 5 : 6, yukseklik: 'o', vurgu: v.dusunme.meseleler.some((m) => m.hedef && m.hedef <= new Date(Date.now() + 86_400_000).toLocaleDateString('sv-SE')) });
  if (dikkat.length) out.push({ id: 'dikkat', tip: 'dikkat', kolon: 1, genislik: 6, yukseklik: 'k', vurgu: true });
  if (oneri.length) out.push({ id: 'oneriler', tip: 'oneriler', kolon: dikkat.length ? 7 : 1, genislik: dikkat.length ? 6 : 12, yukseklik: 'k' });
  for (const k of v.ozelKartlar.slice(0, 4)) out.push({ id: `ozel:${k.id}`, tip: 'ozel', kolon: 1, genislik: k.metrikler?.length ? 6 : 4, yukseklik: 'k', baslik: k.baslik });
  if (kartGorevleri(v).length) out.push({ id: 'plan', tip: 'plan', kolon: 1, genislik: 6, yukseklik: 'o' });
  if (v.epostalar.length) out.push({ id: 'eposta', tip: 'eposta', kolon: 7, genislik: 6, yukseklik: 'o' });
  if (!yakin.length && v.hatirlaticilar.length) out.push({ id: 'hatirlatici', tip: 'hatirlatici', kolon: 1, genislik: 6, yukseklik: 'k' });
  if (v.whatsapp.length) out.push({ id: 'whatsapp', tip: 'whatsapp', kolon: 1, genislik: 6, yukseklik: 'k' });
  if (v.projeler.length) out.push({ id: 'projeler', tip: 'projeler', kolon: 7, genislik: 6, yukseklik: 'k' });
  // Görev 24 (K14): boş kart yok — geçmiş sohbet yoksa "Geçmiş sohbetler" kartı da yok (boşluğu arayüz doldurucularla kapatır).
  if (kartDoluMu('sohbetler', v)) out.push({ id: 'sohbetler', tip: 'sohbetler', kolon: 1, genislik: 6, yukseklik: 'k' });
  out.push({ id: 'arac_kiti', tip: 'arac_kiti', kolon: 7, genislik: 6, yukseklik: 'k', yedek: true });
  if (v.iceAktarma.bekleyen) out.push({ id: 'ice_aktarma', tip: 'ice_aktarma', kolon: 1, genislik: 6, yukseklik: 'k' });
  if (v.hafiza.length) out.push({ id: 'hafiza', tip: 'hafiza', kolon: 7, genislik: 6, yukseklik: 'k' });
  return out;
}

function gecerliYerlesim(liste: unknown, v: KokpitVerisi): KartYerlesimi[] | null {
  if (!Array.isArray(liste)) return null;
  const ozelIdler = new Set(v.ozelKartlar.map((k) => `ozel:${k.id}`));
  const out: KartYerlesimi[] = [];
  const gorulen = new Set<string>();
  for (const k of liste as Partial<KartYerlesimi>[]) {
    const tip = k?.tip as KartTipi;
    if (!TIPLER.includes(tip)) continue;
    const id = tip === 'ozel' ? String(k.id ?? '') : tip;
    if (tip === 'ozel' && !ozelIdler.has(id)) continue;
    if (gorulen.has(id)) continue;
    // Görev 24 (K14): verisi olmayan kart gösterilmez (kayıtlı eski yerleşimde de: veri sonradan boşalmış olabilir); kaynağı
    // Ayarlar → Pano'da kapalı doldurucu da.
    if (!kartDoluMu(tip, v, id)) continue;
    if ((tip === 'hava' || tip === 'haberler' || tip === 'piyasa') && !panoAyari()[tip]) continue;
    gorulen.add(id);
    const genislik = Math.max(3, Math.min(12, Math.round(Number(k.genislik) || 6)));
    const kolon = Math.max(1, Math.min(13 - genislik, Math.round(Number(k.kolon) || 1)));
    out.push({ id, tip, kolon, genislik, yukseklik: k.yukseklik === 'b' || k.yukseklik === 'k' ? k.yukseklik : 'o', vurgu: Boolean(k.vurgu), onem: onemGecerli(k.onem) ? k.onem : undefined, baslik: typeof k.baslik === 'string' ? k.baslik.slice(0, 60) : undefined, yedek: k.yedek === true || undefined });
  }
  // Zihin bandı: yoksa eklenir; HER ZAMAN ilk kart, tam genişlik, 'k' (komşusu onu germesin; shared/izgara.ts de aynısını zorlar).
  const zi = out.findIndex((k) => k.tip === 'zihin');
  const zihin: KartYerlesimi = { ...(zi >= 0 ? out.splice(zi, 1)[0] : { id: 'zihin', tip: 'zihin' as const }), kolon: 1, genislik: 12, yukseklik: 'k' };
  out.unshift(zihin);
  // Yaklaşan hatırlatıcı varsa kart MUTLAKA olsun (kural: bandın hemen altında, sol üstte görünür).
  if (bekleyenler(v).some((h) => Date.parse(h.zaman) - Date.now() < 36 * 3600_000) && !out.some((k) => k.tip === 'hatirlatici')) {
    out.splice(1, 0, { id: 'hatirlatici', tip: 'hatirlatici', kolon: 1, genislik: 4, yukseklik: 'o', vurgu: true });
  }
  // Verisi olan kart görünmeden kalmasın (planlayıcı unutsa bile); araç kiti her zaman erişilebilir.
  const sart: [KartTipi, boolean][] = [
    ['hatirlatici', v.hatirlaticilar.length > 0],
    ['dikkat', v.oneriler.some((o) => o.tur === 'dikkat')],
    ['plan', kartGorevleri(v).length > 0],
    ['eposta', v.epostalar.length > 0],
    ['oneriler', v.oneriler.some((o) => o.tur !== 'dikkat')],
    ['whatsapp', v.whatsapp.length > 0],
    ['dusunme', v.dusunme.durum.etkin],
    ['meseleler', v.dusunme.meseleler.length > 0],
    ['arac_kiti', true],
  ];
  for (const [tip, var_] of sart) if (var_ && !out.some((k) => k.tip === tip)) out.push({ id: tip, tip, kolon: 1, genislik: 6, yukseklik: tip === 'arac_kiti' ? 'k' : 'o', yedek: true });
  return out.length >= 2 ? out : null;
}

function durumOzeti(v: KokpitVerisi): string {
  const z = (iso: string) => new Date(iso).toLocaleString('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return JSON.stringify({
    simdi: new Date().toLocaleString('tr-TR', { dateStyle: 'full', timeStyle: 'short' }),
    // Planlayıcıya yalnız bekleyenler (eksi "kalan saat" kartı yanlışlıkla acil gösteriyordu).
    hatirlaticilar: bekleyenler(v).slice(0, 6).map((h) => ({ baslik: h.baslik, zaman: z(h.zaman), kalanSaat: Math.max(0, Math.round((Date.parse(h.zaman) - Date.now()) / 360_000) / 10) })),
    gorevler: v.gorevler.slice(0, 6).map((g) => ({ baslik: g.baslik, oncelik: g.oncelik, son: g.sonTarih ? z(g.sonTarih) : undefined })),
    dikkat: v.oneriler.filter((o) => o.tur === 'dikkat').map((o) => o.baslik),
    oneriler: v.oneriler.filter((o) => o.tur !== 'dikkat').map((o) => o.baslik),
    epostaOkunmamis: v.epostalar.filter((e) => !e.okundu).length,
    onemliEposta: v.epostalar.filter((e) => e.onem >= 4).map((e) => `${e.kimden}: ${e.konu}`).slice(0, 4),
    whatsappOkunmamis: v.whatsapp.reduce((n, w) => n + w.okunmamis, 0),
    projeler: v.projeler.map((p) => p.baslik),
    ozelKartlar: v.ozelKartlar.map((k) => ({ id: `ozel:${k.id}`, baslik: k.baslik, oncelik: k.oncelik })),
    iceAktarmaBekleyen: v.iceAktarma.bekleyen,
    sohbetSayisi: v.sohbetler.length,
    gunKaydi: v.dusunme.durum.etkin ? { dinliyor: v.dusunme.durum.dinliyor, bugunNot: v.dusunme.durum.bugun.madde, onemli: v.dusunme.bugunOnemli.slice(0, 4).map((m) => m.metin), sonRapor: v.dusunme.sonRapor?.baslik } : 'kapalı',
    acikMeseleler: v.dusunme.meseleler.slice(0, 6).map((m) => ({ baslik: m.baslik, kisi: m.kisi, hedef: m.hedef })),
    // Görev 24: açık doldurucular (Ayarlar → Pano); arayüz boşluğu bunlarla kendisi doldurur.
    doldurucular: [...(['hava', 'haberler', 'piyasa'] as const).filter((t) => panoAyari()[t]), 'arac_kiti', 'ipuclari'],
  });
}

// Izgara kuralları planlayıcıya da söylenir; yine de yanıt ne olursa olsun shared/izgara.ts satırları deliksiz dizer.
const PLANLAYICI = `Sen Fuber'in kokpit tasarımcısısın. Kullanıcının ana ekranını 12 sütunluk ızgarada düzenliyorsun.
Kart tipleri: zihin (üst kart: selamlama + günün odağı + durum hapları; her zaman var), hatirlatici, dikkat, oneriler, plan, eposta, whatsapp, sohbetler, projeler, arac_kiti, hafiza, ice_aktarma, dusunme (gün kaydı: bugünün önemli notları, son rapor, ajanlar; gün kaydı açıksa), meseleler (açık meseleler: kim, ne zaman), ozel (özel kartlar "ozel:<id>").
Doldurucular (kullanıcı verisi değil; "doldurucular" listesindekiler açık): hava, haberler, piyasa (döviz), ipuclari (Fuber'le yapılabilecekler). Zihin'in hemen altında her zaman "gündem" bandı (bugün bekleyenler + gündemdeki konular) vardır; onu sen koymazsın. Ekranda boş yer kalırsa arayüz doldurucuları kendisi ekler; sen yalnız kullanıcı tercih ettiyse (ör. "hava durumu en üstte") ya da veri çok azsa doldurucu koy.
Kurallar:
1. zihin HER ZAMAN ilk karttır ve tek başına bir satırdır (üst bant): genişlik 12, yükseklik k, yanına hiçbir kart koyma. Ondan sonra en acil/zamana bağlı şey SOL ÜSTE (zihin'den sonraki ilk kart). 3 saat içinde hatırlatıcı varsa hatirlatici kartı zihin'den hemen sonra gelir.
2. Boş veri olan kartı koyma (eposta yoksa eposta kartı yok, geçmiş sohbet yoksa sohbetler yok vb.); boş kart zaten gösterilmez. zihin hep var.
3. Kullanıcının yerleşim tercihleri her şeyin önündedir.
4. Kartları okuma sırasıyla ver (soldan sağa, yukarıdan aşağı); sıra önceliktir. Genişlik YALNIZ 3, 4, 6, 8, 9 ya da 12; dusunme en az 6, listeler (eposta, plan, hatirlatici…) en az 4; zihin her zaman 12 ve k (kural 1). Zihin dışındaki her satırın genişlik toplamı TAM 12 olsun (ör. 4+8, 6+6, 4+4+4, 8+4, 3+9, 12). Yükseklik: k (küçük), o (orta), b (büyük); aynı satırdaki kartlar aynı boyda gösterilir, satırdakilere aynı boyu ver. kolon verme.
5. onem (kartın kenar rengi): "acil" = 1 saat içinde hatırlatıcı/toplantı, son tarihi geçmiş görev, hedefi geçmiş mesele, hemen yanıt isteyen çok önemli e-posta (en çok 2 kart). "dikkat" = 3 saat içinde hatırlatıcı, yanıt bekleyen önemli e-posta, hedefi bugün/yarın olan mesele, dikkat listesi. "olumlu" = gerçek iyi haber (hedefe ulaşıldı, bekleyen iş kalmadı, olumlu metrik). Gerisi "normal"; zihin hep "normal". Her şeyi önemli yapma: önem yalnız gerçekten öne çıkması gerekende.
6. Günün saatine uy: sabah plan/hatırlatıcı/e-posta öne; akşam özet/öneriler.
7. 5-9 kart yeterli; kalabalık etme.
JSON: {"selamlama": "EN ÇOK 5 KELİME, sıcak, kişisel (adını kullan; sonda nokta yok; gece yarısından sonra \"İyi geceler\" deme, \"Merhaba\" de; ör. \"Günaydın, Deniz\")", "odak": "günün tek cümlelik odağı, en çok 120 karakter (veriden çıkar, uydurma)", "kartlar": [{"id","tip","genislik","yukseklik","onem","baslik?"}], "gerekce": "tek cümle"}`;

let sonPlan = 0;
let zamanlayici: NodeJS.Timeout | null = null;
let calisiyor = false;
let bekleyenNeden = '';

function kayitliDurum(): Omit<KokpitDurumu, 'veri'> | null {
  const s = veritabani().prepare('SELECT duzen, guncelleme FROM kokpit WHERE id = 1').get() as S | undefined;
  if (!s) return null;
  try { return { ...JSON.parse(String(s.duzen)), guncelleme: String(s.guncelleme) }; } catch { return null; }
}

export function kokpitDurumu(): KokpitDurumu {
  const veri = kokpitVerisi();
  const k = kayitliDurum();
  const kartlar = (k && gecerliYerlesim(k.kartlar, veri)) || yedekYerlesim(veri);
  // Kayıtlı yerleşimde olmayan yeni özel kartlar sona eklenir (bir sonraki planlamaya kadar).
  for (const o of veri.ozelKartlar) if (!kartlar.some((x) => x.id === `ozel:${o.id}`)) kartlar.push({ id: `ozel:${o.id}`, tip: 'ozel', kolon: 1, genislik: 6, yukseklik: 'k', baslik: o.baslik });
  // Izgara: deliksiz 12 sütunluk satırlar (arayüz dar ızgarada 6/1 sütuna yeniden dizer). Önem her okumada TAZE veriden
  // de hesaplanır: yaklaşan hatırlatıcı yeniden planlama beklemeden kırmızıya döner.
  const duzgun = onemleriBirlestir(yerlesimiOturt(kartlar), veri);
  return { selamlama: k?.selamlama || selamlama(), odak: k?.odak || '', kartlar: duzgun, gerekce: k?.gerekce, guncelleme: k?.guncelleme ?? simdi(), veri };
}

async function planla(neden: string): Promise<void> {
  // Test kipinde (önizleme, tanıtım görselleri) elle kurulmuş yerleşim korunur, yapay zekâ planlamaz. Görev 26: uçtan uca test
  // (scripts/e2e/tam-akis.mjs Ö1/Ö2 ölçümü; FUBER_DEMO ister) planlayıcıyı FUBER_TEST_PLANLAYICI=1 ile açar.
  if (process.env.FUBER_DEMO && process.env.FUBER_TEST_PLANLAYICI !== '1') return;
  if (calisiyor) { bekleyenNeden = neden; return; }
  calisiyor = true;
  try {
    const veri = kokpitVerisi();
    let duzen: { selamlama: string; odak: string; kartlar: KartYerlesimi[]; gerekce?: string } = { selamlama: selamlama(), odak: '', kartlar: yedekYerlesim(veri) };
    // Görev 21 düzeltme turu 2: yol başta seçilir; bulut yolunda planlayıcıya Gizli mod notları/meseleleri/raporu GİTMEZ (arayüz yine
    // hepsini gösterir — yerel). Arada Gizli mod açılırsa bulut çağrısı yapılmaz (sabit yol).
    const yol = tekMotorYolu();
    // H5 tur 2: yalnız yol sorulur — bulut motoru yokken "Yalnız bu bilgisayar"da yol 'yerel'dir ve plan yerelde yapılır.
    if (yol !== 'yok') {
      const bulut = yol === 'bulut';
      const tercihler = hafizaAra({ sorgu: 'kokpit yerleşim tercih', tur: 'tercih', limit: 6 }).map((h) => h.icerik);
      const kullanici = `Kullanıcı: ${hitapMetni(ayarlar().kullaniciAdi, ayarlar().hitap) || '(adı bilinmiyor)'} (selamlamada TAM BU hitabı kullan)\nTetikleyen: ${neden}\nYerleşim tercihleri: ${JSON.stringify(tercihler)}\nDurum: ${durumOzeti(bulut ? kokpitGizlisiz(veri) : veri)}`;
      const j = await yardimciJson<{ selamlama?: string; odak?: string; kartlar?: unknown; gerekce?: string }>(PLANLAYICI, kullanici, 'kokpit', 2500, bulut ? 'bulut' : 'yerel').catch(() => null);
      const kartlar = j && gecerliYerlesim(j.kartlar, veri);
      if (j && kartlar) duzen = { selamlama: kelimeKisalt(String(j.selamlama || duzen.selamlama), 48), odak: kelimeKisalt(String(j.odak || ''), 170), kartlar, gerekce: j.gerekce ? String(j.gerekce).slice(0, 200) : undefined };
    }
    veritabani().prepare('INSERT INTO kokpit(id, duzen, guncelleme) VALUES(1, ?, ?) ON CONFLICT(id) DO UPDATE SET duzen = excluded.duzen, guncelleme = excluded.guncelleme').run(JSON.stringify(duzen), simdi());
    sonPlan = Date.now();
    yayinla('kokpit:durum', kokpitDurumu());
  } finally {
    calisiyor = false;
    if (bekleyenNeden) { const n = bekleyenNeden; bekleyenNeden = ''; void kokpitYenile(n); }
  }
}

/** Kokpiti tazele: veri hemen yayınlanır; yapay zekâ planlaması seyreltilir (zorla = hemen). */
let zorlaBekliyor = false;
export async function kokpitYenile(neden: string, zorla = false): Promise<void> {
  yayinla('kokpit:durum', kokpitDurumu());
  // Bekleyen zorunlu planlamayı sıradan bir yenileme ERTELEYEMEZ (aynı turda hatırlatıcı + görev eklenince
  // görev çağrısı hatırlatıcının planlamasını 90 sn sonraya itiyordu → kart ve "odak" cümlesi bayat kalıyordu).
  if (!zorla && zorlaBekliyor && zamanlayici) return;
  if (zamanlayici) clearTimeout(zamanlayici);
  const gecen = Date.now() - sonPlan;
  // Zorunlu: 1,2 sn toplama (bir turdaki birden çok araç çağrısı tek planlamada birleşir).
  const gecikme = zorla ? 1200 : Math.max(8_000, 90_000 - gecen);
  zorlaBekliyor = zorla || zorlaBekliyor;
  zamanlayici = setTimeout(() => { zamanlayici = null; zorlaBekliyor = false; void planla(neden); }, gecikme);
}
