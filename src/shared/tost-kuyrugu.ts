// ── Uygulama içi tostların tek kuyruğu ve yerleşimi (saf; Görev 20b düzeltme turu 2) ───────────────────────────────────────
// Kural: tostlar sayfayı oynatmaz. Turu 1'deki alt şerit sayfa alanını her tostta ~77 px kısaltıyor, yazarken sohbet kutusu ve
// Kokpit yazı alanı zıplıyordu. Artık bütün uygulama içi bildirimler (Geri al, bilgi/hata, adanın uygulama içi karşılığı:
// hatırlatıcı, Fuber'in sözü, onay) TEK yerde, çentiğin altından inen katmanda (renderer/bilesenler/TostAlani.tsx): yerleşim kayması
// yok. Katman düğmelerin üstüne binmesin diye EN ÇOK 2 tost görünür (çentikle sayfanın ilk denetimi arasındaki şeride sığar);
// kalanı öncelik sırasıyla bekler ("+N"):
//   "Geri al" (kullanıcının az önceki işi, 5 sn) > onay (bir iş bekliyor) > hatırlatıcı > hata > Fuber'in sözü/mesajı > bilgi.
// Süre yalnız tost GÖRÜNÜRKEN ve üstünde imleç yokken işler (sırada bekleyenin süresi geçmez); çıkınca okumaya en az 1,5 sn kalır.
// Sırada bekleyen süreli tost 30 sn içinde gösterilemezse düşer (bayat "Öğrendim: …" sonradan çıkmasın) — HATA düşmez (B8: görülmeden
// kaybolmasın; sırada bekler, sayısı çipte). Hatırlatıcı ve onay kendiliğinden kalkmaz; B8 (son düzeltme): görünür olduktan 8 sn sonra
// (imleç üstündeyken süre durur) çentiğe "+N" hapı olarak KATLANIR — kalıcı tost sayfanın üstünü sürekli örtmesin, sıradakiler görünsün;
// hapa tıklayınca açılır. Duraklatma takılı kalmaz: tost görünmez olunca ya da pencere odağı gidince kalkar.
import type { Saat } from './ertelenmis.ts';

export type TostTuru = 'bilgi' | 'hata' | 'hatirlatma' | 'mesaj' | 'soz' | 'onay';
export type YerlesimTuru = TostTuru | 'geri-al';

/** `yol`: tostun "Aç"ı ana pencereyi oraya götürür (ör. Claude Code oturumu 'claude#cc-<id>'; Görev 28). */
export interface TostGirdisi { tur: TostTuru; metin: string; baslik?: string; sure: number | null; sohbetId?: number; onayId?: string; yol?: string }
/** `katli`: kalıcı tost çentiğe katlandı (B8): yerleşime girmez, "+N" hapında sayılır. */
export interface Tost extends TostGirdisi { id: number; sira: number; katli?: boolean }

export const GORUNEN_TOST = 2;
export const SIRADA_BEKLEME_MS = 30_000;
/** Kalıcı tost (hatırlatıcı, onay) görünür kaldıktan bu kadar sonra çentiğe katlanır (B8). */
export const KATLAMA_MS = 8000;
const EN_AZ_KALAN_MS = 1500;
const AZAMI_TOST = 8;

const ONCELIK: Record<YerlesimTuru, number> = { 'geri-al': 0, onay: 1, hatirlatma: 2, hata: 3, soz: 4, mesaj: 4, bilgi: 5 };

/** Görünecek en çok `azami` öğe (öncelik, sonra geliş sırasıyla) ve sırada bekleyenler. */
export function tostYerlesimi<T extends { tur: YerlesimTuru; sira: number }>(ogeler: readonly T[], azami = GORUNEN_TOST): { gorunen: T[]; sirada: T[] } {
  const sirali = [...ogeler].sort((a, b) => ONCELIK[a.tur] - ONCELIK[b.tur] || a.sira - b.sira);
  return { gorunen: sirali.slice(0, azami), sirada: sirali.slice(azami) };
}

const gercekSaat: Saat = {
  kur: (f, ms) => setTimeout(f, ms),
  iptal: (k) => clearTimeout(k as ReturnType<typeof setTimeout>),
  simdi: () => Date.now(),
};

interface Kayit extends Tost {
  kalan: number; zaman: unknown; basladi: number; gorunur: boolean; gorundu: boolean; durakli: boolean; bekleme: unknown;
  /** Kalıcı tostun katlanmasına kalan (ms) ve zamanlayıcısı (B8). */
  katlamaKalan: number; katlama: unknown; katlamaBasladi: number;
}

export class TostKuyrugu {
  private readonly kayitlar = new Map<number, Kayit>();
  private readonly dinleyiciler = new Set<() => void>();
  private readonly saat: Saat;
  private sayac = 0;
  private no = 0;

  constructor(saat: Saat = gercekSaat) { this.saat = saat; }

  /** Tost ekler, kimliğini döner. Aynı bilgi/hata metni ya da aynı onay yeniden gelirse yeni tost açılmaz (süresi tazelenir). */
  ekle(g: TostGirdisi): number {
    const ayni = [...this.kayitlar.values()].find((k) => (g.onayId ? k.onayId === g.onayId : (g.tur === 'bilgi' || g.tur === 'hata') && k.tur === g.tur && k.metin === g.metin));
    if (ayni) {
      if (ayni.sure != null && g.sure != null) {
        this.durdur(ayni);
        ayni.kalan = g.sure;
        this.calistir(ayni);
      }
      return ayni.id;
    }
    const k: Kayit = {
      ...g, id: ++this.no, sira: ++this.sayac, kalan: g.sure ?? 0, zaman: null, basladi: 0, gorunur: false, gorundu: false, durakli: false, bekleme: null,
      katli: false, katlamaKalan: KATLAMA_MS, katlama: null, katlamaBasladi: 0,
    };
    // Süreli tost sırada beklerken bayatlar: 30 sn içinde hiç gösterilemezse düşer. Hata düşmez (B8: görülmeden kaybolmasın).
    if (k.sure != null && k.tur !== 'hata') k.bekleme = this.saat.kur(() => { if (!k.gorundu) this.kaldir(k.id); }, SIRADA_BEKLEME_MS);
    this.kayitlar.set(k.id, k);
    this.tasmayiBirak();
    this.bildir();
    return k.id;
  }

  kaldir(id: number): void {
    const k = this.kayitlar.get(id);
    if (!k) return;
    this.durdur(k);
    if (k.bekleme != null) this.saat.iptal(k.bekleme);
    this.kayitlar.delete(id);
    this.bildir();
  }

  /** Katlanmış kalıcı tostlar ("+N" hapına tıklandı): yeniden açılır; görünür olunca katlama süresi baştan işler. */
  katlilariAc(): void {
    let degisti = false;
    for (const k of this.kayitlar.values()) if (k.katli) { k.katli = false; k.katlamaKalan = KATLAMA_MS; degisti = true; }
    if (degisti) this.bildir();
  }

  /** Koşula uyan tostları kaldırır (ör. yanıtlanan onay). */
  suz(f: (t: Tost) => boolean): void {
    for (const k of [...this.kayitlar.values()]) if (f(k)) this.kaldir(k.id);
  }

  /** Katman şu an hangi tostları gösteriyor: süre yalnız onlarda işler; görünmez olanın süresi ve duraklatması durur/kalkar. */
  gorunenler(idler: readonly number[]): void {
    const ac = new Set(idler);
    for (const k of this.kayitlar.values()) {
      const gorunur = ac.has(k.id);
      if (gorunur === k.gorunur) continue;
      k.gorunur = gorunur;
      if (gorunur) { k.gorundu = true; this.calistir(k); }
      else { this.durdur(k); k.durakli = false; }
    }
  }

  /** İmleç üstünde / odakta: süre durur; çıkınca kalandan (en az 1,5 sn) sürer. */
  duraklat(id: number, v: boolean): void {
    const k = this.kayitlar.get(id);
    if (!k || k.durakli === v) return;
    k.durakli = v;
    if (v) this.durdur(k);
    else { k.kalan = Math.max(k.kalan, EN_AZ_KALAN_MS); this.calistir(k); }
  }

  /** Pencere odağı gitti / gizlendi: üstünde imleç kalmış olsa da bütün süreler sürer (takılı kalmaz). */
  hepsiniSurdur(): void {
    for (const k of this.kayitlar.values()) if (k.durakli) this.duraklat(k.id, false);
  }

  /** Geliş sırasıyla bütün tostlar (katlanmışlar `katli: true`). */
  liste(): Tost[] {
    return [...this.kayitlar.values()].sort((a, b) => a.sira - b.sira)
      .map(({ id, sira, tur, metin, baslik, sure, sohbetId, onayId, katli, yol }) => ({ id, sira, tur, metin, sure, ...(baslik ? { baslik } : {}), ...(sohbetId != null ? { sohbetId } : {}), ...(onayId ? { onayId } : {}), ...(katli ? { katli } : {}), ...(yol ? { yol } : {}) }));
  }

  dinle(f: () => void): () => void {
    this.dinleyiciler.add(f);
    return () => { this.dinleyiciler.delete(f); };
  }

  private calistir(k: Kayit): void {
    if (!k.gorunur || k.durakli) return;
    if (k.sure == null) {
      // B8: kalıcı tost görünür ve üstünde imleç yokken katlanma süresi işler; dolunca çentiğe katlanır.
      if (k.katli || k.katlama != null) return;
      k.katlamaBasladi = this.saat.simdi();
      k.katlama = this.saat.kur(() => { k.katlama = null; k.katli = true; k.gorunur = false; this.bildir(); }, Math.max(k.katlamaKalan, EN_AZ_KALAN_MS));
      return;
    }
    if (k.zaman != null) return;
    k.basladi = this.saat.simdi();
    k.zaman = this.saat.kur(() => { k.zaman = null; this.kaldir(k.id); }, k.kalan);
  }

  private durdur(k: Kayit): void {
    if (k.katlama != null) {
      this.saat.iptal(k.katlama);
      k.katlama = null;
      k.katlamaKalan = Math.max(0, k.katlamaKalan - (this.saat.simdi() - k.katlamaBasladi));
    }
    if (k.zaman == null) return;
    this.saat.iptal(k.zaman);
    k.zaman = null;
    k.kalan = Math.max(0, k.kalan - (this.saat.simdi() - k.basladi));
  }

  /** Çok tost birikirse en eski süreli olan düşer (onay hiç, hatırlatıcı en son). */
  private tasmayiBirak(): void {
    while (this.kayitlar.size > AZAMI_TOST) {
      const l = [...this.kayitlar.values()].sort((a, b) => a.sira - b.sira);
      const kurban = l.find((k) => k.sure != null) ?? l.find((k) => k.tur === 'hatirlatma');
      if (!kurban) return;
      this.durdur(kurban);
      if (kurban.bekleme != null) this.saat.iptal(kurban.bekleme);
      this.kayitlar.delete(kurban.id);
    }
  }

  private bildir(): void { for (const f of [...this.dinleyiciler]) f(); }
}
