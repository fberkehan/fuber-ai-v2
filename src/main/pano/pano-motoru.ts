// ── Pano motoru (Görev 24, K14): kaynakları önbellekten verir, bayatlayanı arka planda tazeler ──────────────────────────────────
// `durum()` ANINDA döner (önbellek; ağ beklenmez) ve bayat/eksik kaynağın tazelenmesini başlatır; iş bitince `degisti` ile yeni durum
// yayınlanır (arayüz 'pano:degisti'). Kurallar:
//  - Kapalı kaynağa hiç istek gitmez; haber akışları yalnız "Haberler" ya da "Gündemdeki konular" açıksa istenir.
//  - Her kaynak/anahtar için aynı anda tek istek; hata olursa geri çekilme (2 dk → 30 dk); çevrimdışında son veri yaşıyla döner.
//  - Ağ yoksa (demo, sahte sunucu verilmemiş) hiç istek yapılmaz: önbellekte ne varsa o.
//  - Gizli mod açıkken (F1, son inceleme K1) hiç istek yapılmaz: son önbellek `gizli` işaretiyle, yoksa kaynak "yok" + `gizli`.
// Electron'suz (getirici, ayar ve yayın dışarıdan): tests/pano-motoru.test.ts sahte yerel sunucuyla sınar.
import { metinGetir, havaGetir, type Getirici } from './getir.ts';
import { PanoOnbellek } from './onbellek.ts';
import { rssCoz, haberleriBirlestir, konulariCikar, metCoz, ecbCoz, ecbPiyasa, tcmbCoz, tcmbPiyasa } from '../../shared/pano-cozucu.ts';
import {
  panoKonumu, koordinat, haberKaynaklari, yerelPara, geriCekilmeMs, KUR_KAYNAGI,
  type PanoAyari, type PanoDurumu, type PanoKaynak, type PanoKaynakAdi, type PanoKonumu, type Haber, type HaberKaynagi,
} from '../../shared/pano.ts';

export interface Tabanlar { hava: string; haber: (k: HaberKaynagi) => string; ecb: string; tcmb: string }
/** Gerçek adresler (MET Norway, yayıncıların akışları, ECB son 90 gün, TCMB). */
export const GERCEK_TABANLAR: Tabanlar = {
  hava: 'https://api.met.no/weatherapi/locationforecast/2.0/compact',
  haber: (k) => k.url,
  ecb: 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-hist-90d.xml',
  tcmb: 'https://www.tcmb.gov.tr/kurlar/today.xml',
};
/** Önizleme/test: bütün kaynaklar tek yerel sahte sunucuda (yalnız FUBER_DEMO ile; main/pano/pano.ts). */
export function sahteTabanlar(kok: string): Tabanlar {
  const k = kok.replace(/\/+$/, '');
  return { hava: `${k}/hava`, haber: (h) => `${k}/haber/${encodeURIComponent(h.id)}`, ecb: `${k}/kur/ecb`, tcmb: `${k}/kur/tcmb` };
}

export interface PanoMotoruSecenegi {
  ayar: () => PanoAyari;
  saatDilimi: () => string | undefined;
  dil: () => string | undefined;
  /** null: ağ yok (hiç istek yapılmaz). */
  getir: Getirici | null;
  tabanlar: Tabanlar | null;
  ua: string;
  onbellek: PanoOnbellek;
  degisti: (d: PanoDurumu) => void;
  simdi?: () => number;
  zamanAsimiMs?: number;
  /** Yanıt gövdesi sınırı (açılmış bayt; varsayılan getir.ts EN_COK_BAYT = 3 MB). */
  enCokBayt?: number;
  /** F1 (son inceleme K1): Gizli mod açık mı — açıkken HİÇ istek yapılmaz (tazeleme de "Şimdi yenile" de); son önbellek `gizli`
   *  işaretiyle verilir, yoksa kaynak "yok" + `gizli`. */
  gizli?: () => boolean;
}

/** Gündem konularında sayılmayacak adlar (her başlıkta geçen ülke adı). */
const ULKE_ADI: Record<string, string[]> = {
  TR: ['Türkiye', 'Turkey', 'Türk'], DE: ['Deutschland', 'Almanya', 'Germany'], AT: ['Österreich', 'Avusturya', 'Austria'], FR: ['France', 'Fransa'],
  NL: ['Nederland', 'Hollanda', 'Netherlands'], GB: ['UK', 'Britain', 'British'], US: ['US', 'America', 'American'],
};
/** Zorla yenilemede bile bir kaynağa 60 sn'den sık sorulmaz. */
const ZORLA_EN_AZ_MS = 60_000;

/** Önbellekteki haber listesi dışarıdan bozulmuş olabilir: yalnız alanları düzgün olanlar. */
function haberleriSuz(l: unknown): Haber[] | null {
  if (!Array.isArray(l)) return null;
  const s = (x: unknown) => typeof x === 'string';
  const temiz = l.filter((h): h is Haber => Boolean(h) && s(h.id) && s(h.baslik) && s(h.link) && s(h.kaynak) && s(h.kaynakId) && (h.zaman === undefined || s(h.zaman)));
  return temiz.length ? temiz : null;
}
const NOTR_KONUM = (): PanoKonumu => panoKonumu(undefined, 'Europe/Istanbul', 'tr-TR');

export class PanoMotoru {
  private suren = new Map<string, Promise<void>>();
  private hatalar = new Map<string, { sayi: number; sonra: number }>();
  /** Kaynak/anahtar başına son deneme anı (başarılı ya da değil): "Şimdi yenile" 60 sn'den sık ağa çıkmaz (çevrimdışında da). */
  private sonDeneme = new Map<string, number>();
  private readonly o: PanoMotoruSecenegi;
  constructor(o: PanoMotoruSecenegi) { this.o = o; }

  private simdi() { return this.o.simdi?.() ?? Date.now(); }
  konum(): PanoKonumu {
    try { return panoKonumu(this.o.ayar(), this.o.saatDilimi(), this.o.dil()); } catch { return NOTR_KONUM(); }
  }
  private anahtar(ad: PanoKaynakAdi, k: PanoKonumu): string {
    return ad === 'hava' ? `${koordinat(k.enlem)},${koordinat(k.boylam)}` : ad === 'haberler' ? k.haberUlke : KUR_KAYNAGI;
  }
  /** Şu an istek sürüyor mu. */
  suruyor(ad: PanoKaynakAdi, anahtar: string) { return this.suren.has(`${ad}|${anahtar}`); }

  /**
   * Anlık durum (önbellekten); bayat/eksik kaynakların tazelenmesini başlatır. Önbellek boşken "yukleniyor" (arayüzde iskelet) YALNIZ ilk
   * denemede: bir kez başarısız olan kaynak sonraki denemelerde "yok" kalır (düzeltme turu 1: çevrimdışında her yeniden denemede kartlar
   * iskelete dönüp kayboluyordu). Türetmeler try içinde: bozuk önbellek kaydı ya da çözücü hatası paneli düşürmez.
   */
  durum(): PanoDurumu {
    const a = this.o.ayar();
    const konum = this.konum();
    const simdi = this.simdi();
    const gizli = this.gizliMi();
    const kaynak = <H, T>(ad: PanoKaynakAdi, etkin: boolean, cevir: (ham: H) => T | null | undefined): PanoKaynak<T> => {
      if (!etkin) return { durum: 'kapali' };
      const anahtar = this.anahtar(ad, konum);
      const is = `${ad}|${anahtar}`;
      const k = this.o.onbellek.oku<H>(ad, anahtar);
      const taze = Boolean(k) && this.o.onbellek.tazeMi(ad, anahtar, simdi);
      if (!taze) this.planla(ad, konum);
      let veri: T | null | undefined = null;
      try { veri = k ? cevir(k.veri) : null; } catch { veri = null; }
      // K1: Gizli modda tazeleme yok — son önbellek "Gizli mod" işaretiyle (çevrimdışı sayılmaz); yoksa "yok" (iskelet değil).
      if (k && veri) return gizli ? { durum: 'hazir', veri, zaman: k.zaman, bayat: !taze, gizli: true } : { durum: 'hazir', veri, zaman: k.zaman, bayat: !taze, cevrimdisi: this.hatalar.has(is) || undefined };
      if (gizli) return { durum: 'yok', gizli: true };
      return { durum: this.suruyor(ad, anahtar) && !this.hatalar.has(is) ? 'yukleniyor' : 'yok' };
    };
    const hava = kaynak('hava', a.hava, (j: unknown) => metCoz(j, konum.saatDilimi, simdi));
    const akis = kaynak('haberler', a.haberler || a.gundem, haberleriSuz);
    const piyasa = kaynak('piyasa', a.piyasa, (v: unknown) => (KUR_KAYNAGI === 'ecb'
      ? ecbPiyasa(Array.isArray(v) ? (v as ReturnType<typeof ecbCoz>) : [], yerelPara(konum.paraUlke))
      : tcmbPiyasa(v as ReturnType<typeof tcmbCoz>)));
    const haberler: PanoDurumu['haberler'] = a.haberler ? akis : { durum: 'kapali' };
    let gundem: PanoDurumu['gundem'] = { durum: 'kapali' };
    if (a.gundem) {
      if (akis.durum === 'hazir') {
        let konular: ReturnType<typeof konulariCikar> = [];
        try { konular = konulariCikar(akis.veri!, [...(ULKE_ADI[konum.ulke] ?? []), konum.sehir]); } catch (e) { console.warn('[pano] gündem çıkarılamadı:', (e as Error).message); }
        gundem = konular.length ? { durum: 'hazir', veri: konular, zaman: akis.zaman, bayat: akis.bayat, cevrimdisi: akis.cevrimdisi, ...(akis.gizli ? { gizli: true } : {}) } : { durum: 'yok', ...(gizli ? { gizli: true } : {}) };
      } else gundem = { durum: akis.durum === 'yukleniyor' ? 'yukleniyor' : 'yok', ...(gizli ? { gizli: true } : {}) };
    }
    return { konum, hava, haberler, gundem, piyasa };
  }

  /** K1: Gizli mod açık mı (seçenek verilmediyse hayır; okunamazsa güvenli yön: açık say — ağa çıkılmaz). */
  private gizliMi(): boolean {
    try { return this.o.gizli?.() === true; } catch { return true; }
  }

  /** Açık kaynakları şimdi tazeler (son denemesi — başarılı ya da değil — 60 sn'den yeni olan atlanır) ve bitince durumu döner. */
  async yenile(): Promise<PanoDurumu> {
    const a = this.o.ayar();
    const konum = this.konum();
    const simdi = this.simdi();
    for (const [ad, etkin] of [['hava', a.hava], ['haberler', a.haberler || a.gundem], ['piyasa', a.piyasa]] as [PanoKaynakAdi, boolean][]) {
      if (!etkin) continue;
      const anahtar = this.anahtar(ad, konum);
      const k = this.o.onbellek.oku(ad, anahtar);
      const son = Math.max(k ? Date.parse(k.zaman) : 0, this.sonDeneme.get(`${ad}|${anahtar}`) ?? 0);
      if (simdi - son < ZORLA_EN_AZ_MS) continue;
      this.planla(ad, konum, true);
    }
    await Promise.allSettled([...this.suren.values()]);
    return this.durum();
  }

  private planla(ad: PanoKaynakAdi, konum: PanoKonumu, zorla = false): void {
    // K1: Gizli modda hiçbir kaynağa istek gitmez ("Şimdi yenile" de bu yoldan geçer).
    if (!this.o.getir || !this.o.tabanlar || this.gizliMi()) return;
    const anahtar = this.anahtar(ad, konum);
    const is = `${ad}|${anahtar}`;
    if (this.suren.has(is)) return;
    const h = this.hatalar.get(is);
    if (!zorla && h && h.sonra > this.simdi()) return;
    this.sonDeneme.set(is, this.simdi());
    const p = this.tazele(ad, anahtar, konum)
      .then(() => { this.hatalar.delete(is); })
      .catch((e: Error) => {
        const sayi = (h?.sayi ?? 0) + 1;
        this.hatalar.set(is, { sayi, sonra: this.simdi() + geriCekilmeMs(sayi) });
        console.warn(`[pano] ${ad} alınamadı (${sayi}. kez):`, e?.message ?? e);
      })
      .finally(() => {
        this.suren.delete(is);
        try { this.o.degisti(this.durum()); } catch (e) { console.warn('[pano] durum yayınlanamadı:', (e as Error).message); }
      });
    this.suren.set(is, p);
  }

  private async tazele(ad: PanoKaynakAdi, anahtar: string, konum: PanoKonumu): Promise<void> {
    const t = this.o.tabanlar!;
    const g = { getir: this.o.getir!, ua: this.o.ua, zamanAsimiMs: this.o.zamanAsimiMs, enCokBayt: this.o.enCokBayt };
    const zaman = () => new Date(this.simdi()).toISOString();
    if (ad === 'hava') {
      const onceki = this.o.onbellek.oku<unknown>('hava', anahtar);
      const r = await havaGetir(g, `${t.hava}?lat=${koordinat(konum.enlem)}&lon=${koordinat(konum.boylam)}`, onceki?.sonDegisiklik);
      if (r.degismedi) {
        if (!onceki) throw new Error('304 ama önbellek yok');
        this.o.onbellek.yaz('hava', { ...onceki, zaman: zaman(), bitis: r.bitis, sonDegisiklik: r.sonDegisiklik });
        return;
      }
      if (!metCoz(r.json, konum.saatDilimi, this.simdi())) throw new Error('hava yanıtı çözülemedi');
      this.o.onbellek.yaz('hava', { anahtar, zaman: zaman(), veri: r.json, bitis: r.bitis, sonDegisiklik: r.sonDegisiklik });
      return;
    }
    if (ad === 'haberler') {
      const kaynaklar = haberKaynaklari(konum.haberUlke);
      const sonuc = await Promise.allSettled(kaynaklar.map(async (k) => rssCoz(await metinGetir(g, t.haber(k)), k)));
      const akislar = sonuc.flatMap((s) => (s.status === 'fulfilled' ? [s.value] : []));
      const birlesik = haberleriBirlestir(akislar, 40, this.simdi());
      if (!birlesik.length) throw new Error(`haber akışı yok (${sonuc.filter((s) => s.status === 'rejected').length}/${kaynaklar.length} hata)`);
      this.o.onbellek.yaz('haberler', { anahtar, zaman: zaman(), veri: birlesik });
      return;
    }
    if (KUR_KAYNAGI === 'ecb') {
      const gunler = ecbCoz(await metinGetir(g, t.ecb)).slice(-31);
      if (!gunler.length) throw new Error('kur yanıtı çözülemedi');
      this.o.onbellek.yaz('piyasa', { anahtar, zaman: zaman(), veri: gunler });
    } else {
      const tc = tcmbCoz(await metinGetir(g, t.tcmb));
      if (!tc) throw new Error('kur yanıtı çözülemedi');
      this.o.onbellek.yaz('piyasa', { anahtar, zaman: zaman(), veri: tc });
    }
  }
}
