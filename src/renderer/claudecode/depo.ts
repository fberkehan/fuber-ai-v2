// ── Claude Code çalışma alanının deposu (Görev 28, K17): uygulama içi oturumlar, canlı döküm, kuyruk, komut/model önbelleği ─────
// Tek örnek; sayfa ilk açılınca 'claudecode:olay'a abone olur ve uygulama boyunca abone kalır (sayfadan çıkınca oturumlar sürer;
// dönünce döküm kaldığı yerden). Dökümü yalnız AÇILMIŞ oturumların tutulur (oturum-al anlık görüntüsü + sonraki canlı olaylar);
// yükleme sürerken gelen olaylar tamponda bekler, anlık görüntüden sonra `sira`sı büyük olanlar uygulanır (çift yok).
// Değişiklikler kare başına toplanır (requestAnimationFrame): ~50 ms'de bir gelen akış parçaları titreme ve gereksiz çizim yapmaz.
import { cagir, dinle } from '../api';
import { DokumModeli, modelKur, anlikGoruntu, birakilacaklar, ESKI_SAYFA_SINIRI } from './dokum-modeli';
import { taslakModelleri, type KomutBilgisi } from './yardimci';
import type { CcOlayZarfi, CcOturumOzeti, CcOturumAyrintisi, CcYapilacak, CcArkaIs } from '../../shared/cc-olay';

export interface ModelBilgisi { deger: string; ad: string; aciklama: string }
export interface CanliOturum {
  ozet: CcOturumOzeti;
  dokum: DokumModeli | null;
  /** Geçmişten sürdürülen oturumun önceki konuşması (JSONL sayfaları) ve "Daha eskisi" imleci. */
  oncesi: { model: DokumModeli; once: number | null; kimlik: string; sayfa: number; sinirda: boolean } | null;
  yukleniyor: boolean;
  tampon: CcOlayZarfi[];
  sonSira: number;
  /** Tur sürerken gönderilen, sırada bekleyen mesajlar (görünür). */
  kuyruk: { metin: string; gorselSayisi: number }[];
  yapilacaklar: CcYapilacak[];
  degisenDosyalar: string[];
  /** Claude Code'un işleri (analiz 11 Kas bulgu 5): döküm yüklü olmasa da her 'arka-isler' olayıyla güncellenir. */
  arkaIsler: CcArkaIs[];
  /** Son değişiklik sayacı (bileşenler bu oturum değişince yeniden çizilir). */
  surum: number;
}

type Dinleyici = () => void;

/** İşlem kanalı çağrısı: ana süreç fırlatırsa da `{ tamam: false, hata }` döner (arayüz satır içi gösterir). */
export function islem<T extends { tamam: boolean; hata?: string }>(kanal: Parameters<typeof cagir>[0], ...a: unknown[]): Promise<T> {
  return cagir<T>(kanal, ...a).catch((e) => ({ tamam: false, hata: (e as Error)?.message ?? String(e) }) as T);
}

class CcDepo {
  readonly oturumlar = new Map<string, CanliOturum>();
  private dinleyiciler = new Set<Dinleyici>();
  private surum = 0;
  private bekleyen = 0;
  private bagli = false;
  private komutOnbellek = new Map<string, { komutlar: KomutBilgisi[]; modeller: ModelBilgisi[]; canli: boolean; hata?: string }>();
  /** Son bilinen komut ve model listesi (taslak oturum için; ilk komutlar çağrısından). */
  sonKomutlar: KomutBilgisi[] = [];
  sonModeller: ModelBilgisi[] = [];
  /** Ana sürecin saklı model listesi (claudecode:modeller): oturum açılmadan önce de (taslakta) seçilebilsin. */
  private sakliModeller: ModelBilgisi[] | null = null;
  yuklendi = false;
  /** Sayfada şu an açık oturum (bellek: kapanmış ve görünmeyen oturumun dökümü bırakılır). */
  private gorunen: string | null = null;

  gorunenAyarla(id: string | null): void {
    this.gorunen = id;
    this.serbestBirak();
  }

  private serbestBirak(): void {
    const liste = [...this.oturumlar.values()].map((k) => ({ id: k.ozet.id, durum: k.ozet.durum, yuklu: Boolean(k.dokum) }));
    for (const id of birakilacaklar(liste, this.gorunen)) {
      const k = this.oturumlar.get(id);
      if (!k) continue;
      // Düzeltme 2 (N5): geçmişten sürdürülen oturumun ÖNCEKİ konuşması (`oncesi`, en çok ESKI_SAYFA_SINIRI sayfa) bırakılmaz —
      // motorun anlık görüntüsü onu içermez; yalnız yeniden yüklenebilen döküm bırakılır.
      k.dokum = null; k.tampon = []; k.sonSira = 0; k.surum++;
    }
  }

  /** Tanılama (önizleme betiği): oturum başına bellekteki döküm. */
  bellek(): { id: string; durum: string; yuklu: boolean; oge: number; oncesiSayfa: number }[] {
    return [...this.oturumlar.values()].map((k) => ({ id: k.ozet.id, durum: k.ozet.durum, yuklu: Boolean(k.dokum), oge: k.dokum?.boyut ?? 0, oncesiSayfa: k.oncesi?.sayfa ?? 0 }));
  }

  bagla(): void {
    if (this.bagli) return;
    this.bagli = true;
    dinle('claudecode:olay', (z: CcOlayZarfi) => this.olay(z));
    void this.yenile();
    void this.modelleriYenile();
  }

  /** Taslak (oturumsuz) ve geçmiş görünümü için model listesi: canlı oturumdan gelen, yoksa saklı, yoksa opus / sonnet / haiku — boş değil. */
  modelListesi = (): ModelBilgisi[] => [...taslakModelleri(this.sonModeller, this.sakliModeller)];

  /** Saklı listeyi ana süreçten alır (seçici açılınca ve sayfa açılışında; süreç AÇMAZ). */
  async modelleriYenile(): Promise<void> {
    const l = await cagir<ModelBilgisi[]>('claudecode:modeller').catch(() => null);
    if (!Array.isArray(l) || !l.length) return;
    this.sakliModeller = l;
    this.degisti();
  }

  abone = (f: Dinleyici): (() => void) => { this.dinleyiciler.add(f); return () => { this.dinleyiciler.delete(f); }; };
  anlik = (): number => this.surum;

  /** Değişiklik bildirimi bir kareye toplanır. */
  private degisti(): void {
    if (this.bekleyen) return;
    const bildir = () => { this.bekleyen = 0; this.surum++; for (const f of this.dinleyiciler) f(); };
    this.bekleyen = typeof requestAnimationFrame === 'function' ? requestAnimationFrame(bildir) : (setTimeout(bildir, 16) as unknown as number);
  }

  /** Listeyi ana süreçten tazeler (sayfaya dönüşte; bu arada unutulan kayıtlar düşer). */
  async yenile(): Promise<void> {
    const l = await cagir<CcOturumOzeti[]>('claudecode:oturumlar').catch(() => null);
    if (!l) return;
    const var_ = new Set(l.map((o) => o.id));
    for (const id of [...this.oturumlar.keys()]) if (!var_.has(id)) this.oturumlar.delete(id);
    for (const o of l) this.ozetYaz(o);
    this.yuklendi = true;
    this.degisti();
  }

  liste(): CanliOturum[] {
    return [...this.oturumlar.values()].sort((a, b) => b.ozet.sonEtkinlik - a.ozet.sonEtkinlik);
  }

  al(id: string | null | undefined): CanliOturum | undefined { return id ? this.oturumlar.get(id) : undefined; }

  ozetYaz(o: CcOturumOzeti): CanliOturum {
    let k = this.oturumlar.get(o.id);
    if (!k) {
      k = { ozet: o, dokum: null, oncesi: null, yukleniyor: false, tampon: [], sonSira: 0, kuyruk: [], yapilacaklar: [], degisenDosyalar: [], arkaIsler: [], surum: 0 };
      this.oturumlar.set(o.id, k);
    } else k.ozet = o;
    // Görünen kuyruk motorun sayısına eşitlenir (gönderilen mesaj başladıysa ya da Durdur kuyruğu sildiyse düşer).
    if (k.kuyruk.length > o.kuyruk) k.kuyruk = k.kuyruk.slice(k.kuyruk.length - o.kuyruk);
    k.surum++;
    return k;
  }

  private olay(z: CcOlayZarfi): void {
    if (z.olay.tur === 'unutuldu') { this.oturumlar.delete(z.oturum); this.degisti(); return; }
    if (z.olay.tur === 'durum') { this.ozetYaz(z.olay.ozet); if (z.olay.ozet.durum === 'kapandi') this.serbestBirak(); this.degisti(); return; }
    const k = this.oturumlar.get(z.oturum);
    if (!k) return;
    // İşler listesi anlık hâldir (dökümde yok): döküm yüklü olmasa da, yüklenirken de hemen yazılır.
    if (z.olay.tur === 'arka-isler') { k.arkaIsler = z.olay.isler; k.surum++; this.degisti(); return; }
    if (k.yukleniyor) { k.tampon.push(z); return; }
    if (!k.dokum || z.sira <= k.sonSira) return;
    this.uygula(k, z);
    this.degisti();
  }

  private uygula(k: CanliOturum, z: CcOlayZarfi): void {
    k.sonSira = z.sira;
    const o = z.olay;
    if (o.tur === 'kullanici') {
      const i = k.kuyruk.findIndex((m) => m.metin === o.metin);
      if (i >= 0) k.kuyruk.splice(i, 1);
    } else if (o.tur === 'yapilacaklar' && o.ust === null) k.yapilacaklar = o.maddeler;
    // Değişen dosyalar denetçide 'claudecode:degisiklikler'den (motorun kuralı: yalnız başarıyla biten düzenleme) tazelenir.
    k.dokum?.uygula(o, z.zaman);
    k.surum++;
  }

  /** Oturumun dökümünü yükler (bir kez; sonra canlı olaylarla sürer). */
  async yukle(id: string, zorla = false): Promise<void> {
    const k = this.oturumlar.get(id);
    if (!k || k.yukleniyor || (k.dokum && !zorla)) return;
    k.yukleniyor = true;
    k.tampon = [];
    try {
      const a = await cagir<CcOturumAyrintisi | null>('claudecode:oturum-al', id);
      if (!a) { this.oturumlar.delete(id); return; }
      const g = anlikGoruntu(a, k.tampon.splice(0));
      k.dokum = g.model;
      k.sonSira = g.sonSira;
      k.kuyruk = a.kuyrukMesajlari.map((m) => ({ metin: m.metin, gorselSayisi: m.gorselSayisi }));
      k.yapilacaklar = a.yapilacaklar;
      k.degisenDosyalar = a.degisenDosyalar;
      if (a.arkaIsler) k.arkaIsler = a.arkaIsler;
      const { olaylar: _o, bekleyenIzinler: _b, kuyrukMesajlari: _k, degisenDosyalar: _d, yapilacaklar: _y, arkaIsler: _i, ...ozet } = a;
      k.ozet = ozet;
      k.yukleniyor = false;
      // Bekleyen izinler (döküm sınırında kaybolmuş olabilir) anlikGoruntu'da TAMPONDAN ÖNCE işlendi; şimdi tampondaki canlı olaylar.
      for (const z of g.sonra) if (z.sira > k.sonSira) this.uygula(k, z);
      for (const z of k.tampon.splice(0)) if (z.sira > k.sonSira) this.uygula(k, z); // anlık görüntü işlenirken gelenler
    } catch {
      k.dokum = null;
    } finally {
      k.yukleniyor = false;
      k.surum++;
      this.degisti();
    }
  }

  /** Geçmişten sürdürülen oturuma önceki konuşmayı bağlar (sürdürmeden önce görüntülenen JSONL sayfaları). */
  oncesiBagla(id: string, model: DokumModeli, once: number | null, kimlik: string): void {
    const k = this.oturumlar.get(id);
    if (!k) return;
    k.oncesi = { model, once, kimlik, sayfa: 0, sinirda: false };
    k.surum++;
    this.degisti();
  }

  async dahaEskisi(id: string): Promise<void> {
    const k = this.oturumlar.get(id);
    const o = k?.oncesi;
    if (!k || !o || o.once === null || o.sinirda) return;
    const s = await cagir<{ olaylar: { zaman: number; olay: CcOlayZarfi['olay'] }[]; once: number | null }>('claudecode:dokum', o.kimlik, { once: o.once, adet: 80 });
    const eski = modelKur(s.olaylar);
    o.model.oneEkle(eski);
    o.once = s.once;
    o.sayfa++;
    if (o.sayfa >= ESKI_SAYFA_SINIRI && o.once !== null) { o.sinirda = true; o.once = null; }
    k.surum++;
    this.degisti();
  }

  kuyrugaEkle(id: string, metin: string, gorselSayisi: number): void {
    const k = this.oturumlar.get(id);
    if (!k) return;
    k.kuyruk = [...k.kuyruk, { metin, gorselSayisi }];
    if (k.kuyruk.length > k.ozet.kuyruk) k.kuyruk = k.kuyruk.slice(k.kuyruk.length - k.ozet.kuyruk);
    k.surum++;
    this.degisti();
  }

  /** "/" komutları ve model listesi (oturum başına bir kez; süreç yoksa motor tur başlatmadan açar). */
  async komutlar(id: string, tazele = false): Promise<{ komutlar: KomutBilgisi[]; modeller: ModelBilgisi[]; canli: boolean; hata?: string }> {
    const h = this.komutOnbellek.get(id);
    if (h && !tazele && h.canli) return h;
    const r = await cagir<{ canli: boolean; komutlar: KomutBilgisi[]; modeller: ModelBilgisi[]; hata?: string }>('claudecode:komutlar', id)
      .catch((e) => ({ canli: false, komutlar: [], modeller: [], hata: (e as Error).message }));
    if (r.komutlar.length) this.sonKomutlar = r.komutlar;
    if (r.modeller.length) this.sonModeller = r.modeller;
    if (r.canli) this.komutOnbellek.set(id, r);
    this.degisti();
    return r;
  }
}

export const ccDepo = new CcDepo();
