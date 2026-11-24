// ── Claude Code canlı dökümünün modeli (Görev 28, K17) — saf; birim testli: tests/cc-arayuz.test.ts ──────────────────────────────
// Motorun sade olay kayıtlarını (shared/cc-olay.ts CcOlay; canlı 'claudecode:olay' ya da JSONL dökümü) çizilecek ÖĞELERE çevirir:
//  • kullanıcı mesajı · asistan metni (blok başına TEK öğe: 'metin-parca' EKLENİR — bir olay ~50 ms'lik birden çok belirteç taşır —,
//    'metin' tam metinle DEĞİŞTİRİR) · düşünme göstergesi · araç kartı (arac-basladi + arac-bitti aynı kimlikte birleşir) · alt ajan
//    (iç içe: `ust` = parent_tool_use_id olan olaylar onun çocukları) · yapılacaklar (art arda gelen güncellemeler tek kartta) · izin
//    isteği (yanıtlanınca kararı işlenir; bekleyenler ayrıca listelenir) · sonuç satırı · sistem notu · mod/model notu.
//  • Düzeltme turu 1: izin isteği kendi araç kartına bağlanır (`aracKimligi` = tool_use kimliği): o araç dökümde kart olarak varsa
//    izin AYRI satır olmaz — bekleyen istek kartın içinde karar düğmeleriyle çizilir, yanıtlanınca kararı kartta küçük rozet olur.
//    Kartı olmayan istek (ör. dökümde görünmeyen araç) satır + yazma kutusunun üstündeki kart olarak kalır.
//  • Nesne kimliği: değişen öğe (ve alt ajan zincirinde ataları) YENİ nesne olur, değişmeyen aynı kalır → React.memo yalnız değişeni
//    yeniden çizer; sanallaştırılmış döküm 5 000 olayda da akıcı.
//  • "Daha eskisi" (JSONL sayfası) öne eklenir; sayfa sınırında sonucu yeni sayfada kalan araç kartı eski sayfadaki başlangıcıyla
//    birleşir (yetim sonuç kart olmaz).
import type { CcOlay, CcIzinIstegi, CcSonuc, CcYapilacak, CcAracTipi } from '../../shared/cc-olay.ts';

export type AracDurumu = 'calisiyor' | 'tamam' | 'hata' | 'kesildi';
interface Temel { anahtar: string; zaman: number; ust: string | null }
export type KullaniciOgesi = Temel & { tur: 'kullanici'; metin: string; gorselSayisi: number };
export type MetinOgesi = Temel & { tur: 'metin'; blok: string; metin: string; akiyor: boolean };
export type DusunmeOgesi = Temel & { tur: 'dusunme'; blok: string; bitti: boolean };
export type AracOgesi = Temel & {
  tur: 'arac'; id: string; ad: string; tip: CcAracTipi; girdi: Record<string, unknown>; ozet: string; durum: AracDurumu;
  cikti?: string; kisaltildi?: boolean; girdiKisaltildi?: boolean; bitis?: number;
  /** Bu aracın izin isteğine verilen karar (kartta rozet). */
  izinKarari?: 'izin' | 'hep' | 'ret' | 'iptal';
};
export type AltAjanOgesi = Temel & {
  tur: 'alt-ajan'; id: string; aciklama: string; ajanTipi?: string; istem: string; durum: AracDurumu; cikti?: string; bitis?: number;
  cocuklar: DokumOgesi[];
};
export type YapilacakOgesi = Temel & { tur: 'yapilacaklar'; id: string; maddeler: CcYapilacak[]; eski: boolean };
export type IzinOgesi = Temel & { tur: 'izin'; istek: CcIzinIstegi; karar?: 'izin' | 'hep' | 'ret' | 'iptal'; aracId?: string };
/** `arkaPlan`: sonuç geldiği an (ve sonra düştükçe) arkada süren iş sayısı; >0 iken kart "Bitti" demez. Yalnız SON sonuç kartı canlı sayar. */
export type SonucOgesi = Temel & { tur: 'sonuc'; sonuc: CcSonuc; arkaPlan: number };
export type SistemOgesi = Temel & { tur: 'sistem'; seviye: 'bilgi' | 'uyari' | 'hata'; metin: string; ayrinti?: string };
export type NotOgesi = Temel & { tur: 'not'; metin: string };
export type DokumOgesi = KullaniciOgesi | MetinOgesi | DusunmeOgesi | AracOgesi | AltAjanOgesi | YapilacakOgesi | IzinOgesi | SonucOgesi | SistemOgesi | NotOgesi;

/** Bellekte tutulan en çok üst düzey öğe (fazlası en eskiden atılır; sayısı `atilan`da). */
export const OGE_SINIRI = 6000;
const MOD_ADI: Record<string, string> = { default: 'Her şeyi sor', acceptEdits: 'Düzenlemelere izin ver', plan: 'Plan', bypassPermissions: 'Tam yetki' };

let modelSayaci = 0;

export class DokumModeli {
  private readonly onek: string;
  private sayac = 0;
  private kok: string[] = [];
  /** Öğenin kendi alanları (alt ajanda `cocuklar` boş tutulur; çocuklar `cocuk` haritasında). */
  private taban = new Map<string, DokumOgesi>();
  private cocuk = new Map<string, string[]>();
  private ebeveyn = new Map<string, string>();
  private aracAnahtari = new Map<string, string>();
  private blokAnahtari = new Map<string, string>();
  private izinAnahtari = new Map<string, string>();
  /** Başlangıcı bu modelde olmayan araç sonuçları (JSONL sayfa sınırı): öne eklenen sayfadaki kartla birleşir. */
  private yetimler = new Map<string, { hata: boolean; cikti: string; kisaltildi: boolean; zaman: number }>();
  /** ust ('' = ana iş parçacığı) → son yapılacaklar öğesi. */
  private sonYapilacak = new Map<string, string>();
  private insaEdilmis = new Map<string, DokumOgesi>();
  private kirli = new Set<string>();
  /** Arkada süren iş sayısı (son 'arka-plan' olayı) ve son sonuç kartının anahtarı. */
  private arkaPlan = 0;
  private sonSonuc: string | null = null;
  private onbellek: DokumOgesi[] | null = null;
  /** Sınır yüzünden atılan üst düzey öğe sayısı. */
  atilan = 0;
  /** Her değişiklikte artar (useSyncExternalStore / memo anahtarı). */
  surum = 0;

  constructor(onek?: string) { this.onek = onek ?? `d${++modelSayaci}-`; }

  get boyut(): number { return this.kok.length; }

  /** Tek olay; değişiklik olduysa true. */
  uygula(olay: CcOlay, zaman = Date.now()): boolean {
    const d = this.isle(olay, zaman);
    if (d) { this.surum++; this.onbellek = null; }
    return d;
  }

  /** Çok olay (anlık görüntü ya da döküm sayfası). */
  hepsi(olaylar: readonly { olay: CcOlay; zaman: number }[]): void {
    let d = false;
    for (const z of olaylar) d = this.isle(z.olay, z.zaman) || d;
    if (d) { this.surum++; this.onbellek = null; }
  }

  /** Çizilecek üst düzey öğeler (biten düşünme göstergeleri gizli). Değişmeyen öğeler aynı nesnedir. */
  liste(): DokumOgesi[] {
    if (this.onbellek) return this.onbellek;
    const out: DokumOgesi[] = [];
    for (const k of this.kok) {
      const o = this.insa(k);
      if (!o || (o.tur === 'dusunme' && o.bitti) || (o.tur === 'izin' && this.kartliMi(o.aracId))) continue;
      out.push(o);
    }
    this.kirli.clear();
    this.onbellek = out;
    return out;
  }

  /** Yanıt bekleyen izin istekleri (geliş sırasıyla). */
  bekleyenIzinler(): CcIzinIstegi[] {
    const out: CcIzinIstegi[] = [];
    for (const k of this.izinAnahtari.values()) { const o = this.taban.get(k); if (o?.tur === 'izin' && !o.karar) out.push(o.istek); }
    return out;
  }

  /** Bu araç kimliği dökümde bir ARAÇ KARTI olarak var mı (izin isteği o kartın içinde çizilir). */
  kartliMi(aracId: string | undefined): boolean {
    if (!aracId) return false;
    const k = this.aracAnahtari.get(aracId);
    return Boolean(k && this.taban.get(k)?.tur === 'arac');
  }

  /** Bekleyen ama kendi araç kartı OLMAYAN istekler (yazma kutusunun üstündeki kartta yanıtlanır). */
  kartsizBekleyenler(): CcIzinIstegi[] { return this.bekleyenIzinler().filter((i) => !this.kartliMi(i.aracKimligi)); }

  /** Aracın dökümdeki ÜST DÜZEY öğesinin anahtarı (alt ajanın içindeki araç → alt ajan kartı): "Göster" oraya kaydırır. */
  ustDuzeyAnahtar(aracId: string): string | undefined {
    let k = this.aracAnahtari.get(aracId);
    while (k && this.ebeveyn.has(k)) k = this.ebeveyn.get(k);
    return k;
  }

  /** Akmakta olan metin ya da süren düşünme var mı (göstergeler için). */
  akiyorMu(): boolean {
    for (const o of this.taban.values()) if ((o.tur === 'metin' && o.akiyor) || (o.tur === 'dusunme' && !o.bitti)) return true;
    return false;
  }

  /** "Daha eskisi": daha eski bir sayfanın modelini başa ekler (o modelin anahtarları ayrı önekli). */
  oneEkle(eski: DokumModeli): void {
    // Sayfa sınırı: yeni sayfadaki yetim sonuçlar eski sayfadaki kartlara.
    for (const [id, y] of this.yetimler) {
      const k = eski.aracAnahtari.get(id);
      if (!k) continue;
      eski.aracBitir(k, y.hata, y.cikti, y.kisaltildi, y.zaman);
      this.yetimler.delete(id);
    }
    for (const [k, v] of eski.taban) this.taban.set(k, v);
    for (const [k, v] of eski.cocuk) this.cocuk.set(k, v);
    for (const [k, v] of eski.ebeveyn) this.ebeveyn.set(k, v);
    for (const [k, v] of eski.aracAnahtari) if (!this.aracAnahtari.has(k)) this.aracAnahtari.set(k, v);
    for (const [k, v] of eski.blokAnahtari) if (!this.blokAnahtari.has(k)) this.blokAnahtari.set(k, v);
    for (const [k, v] of eski.izinAnahtari) if (!this.izinAnahtari.has(k)) this.izinAnahtari.set(k, v);
    for (const [k, v] of eski.yetimler) if (!this.yetimler.has(k)) this.yetimler.set(k, v);
    for (const k of eski.kok) this.kirli.add(k);
    for (const k of eski.kirli) this.kirli.add(k);
    // Eski sayfanın son yapılacaklar kartı artık "eski" (yenisi bu modelde varsa).
    for (const [ust, k] of eski.sonYapilacak) {
      if (this.sonYapilacak.has(ust)) this.yapilacakEskit(k);
      else this.sonYapilacak.set(ust, k);
    }
    this.kok = [...eski.kok, ...this.kok];
    this.surum++;
    this.onbellek = null;
  }

  // ── İç ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private yeniAnahtar(): string { return `${this.onek}${++this.sayac}`; }

  private ekle(o: DokumOgesi, ust: string | null): void {
    const ebeveyn = ust ? this.aracAnahtari.get(ust) : undefined;
    const e = ebeveyn ? this.taban.get(ebeveyn) : undefined;
    this.taban.set(o.anahtar, o);
    if (e?.tur === 'alt-ajan') {
      const l = this.cocuk.get(e.anahtar) ?? [];
      l.push(o.anahtar);
      this.cocuk.set(e.anahtar, l);
      this.ebeveyn.set(o.anahtar, e.anahtar);
      this.kirlet(e.anahtar);
    } else {
      this.kok.push(o.anahtar);
      if (this.kok.length > OGE_SINIRI) this.bas(this.kok.length - OGE_SINIRI);
    }
    this.kirli.add(o.anahtar);
  }

  /** En eski üst düzey öğeleri (ve çocuklarını) atar. */
  private bas(n: number): void {
    const atilanlar = this.kok.splice(0, n);
    this.atilan += n;
    const sil = (k: string) => {
      const o = this.taban.get(k);
      this.taban.delete(k); this.insaEdilmis.delete(k); this.ebeveyn.delete(k); this.kirli.delete(k);
      if (o && (o.tur === 'arac' || o.tur === 'alt-ajan') && this.aracAnahtari.get(o.id) === k) this.aracAnahtari.delete(o.id);
      if (o && (o.tur === 'metin' || o.tur === 'dusunme') && this.blokAnahtari.get(o.blok) === k) this.blokAnahtari.delete(o.blok);
      if (o?.tur === 'izin' && this.izinAnahtari.get(o.istek.istekId) === k) this.izinAnahtari.delete(o.istek.istekId);
      for (const c of this.cocuk.get(k) ?? []) sil(c);
      this.cocuk.delete(k);
    };
    for (const k of atilanlar) sil(k);
  }

  private degistir(k: string, f: (o: DokumOgesi) => DokumOgesi): void {
    const o = this.taban.get(k);
    if (!o) return;
    this.taban.set(k, f(o));
    this.kirlet(k);
  }

  private kirlet(k: string): void {
    for (let x: string | undefined = k; x; x = this.ebeveyn.get(x)) this.kirli.add(x);
  }

  private insa(k: string): DokumOgesi | undefined {
    if (!this.kirli.has(k)) { const h = this.insaEdilmis.get(k); if (h) return h; }
    const o = this.taban.get(k);
    if (!o) return undefined;
    let sonuc: DokumOgesi = o;
    if (o.tur === 'alt-ajan') {
      const cocuklar: DokumOgesi[] = [];
      for (const c of this.cocuk.get(k) ?? []) { const x = this.insa(c); if (x && !(x.tur === 'dusunme' && x.bitti)) cocuklar.push(x); }
      sonuc = { ...o, cocuklar };
    }
    this.insaEdilmis.set(k, sonuc);
    return sonuc;
  }

  private aracBitir(k: string, hata: boolean, cikti: string, kisaltildi: boolean, zaman: number): void {
    this.degistir(k, (o) => (o.tur === 'arac' || o.tur === 'alt-ajan' ? { ...o, durum: hata ? 'hata' : 'tamam', cikti, ...(o.tur === 'arac' ? { kisaltildi } : {}), bitis: zaman } as DokumOgesi : o));
  }

  private yapilacakEskit(k: string): void {
    this.degistir(k, (o) => (o.tur === 'yapilacaklar' && !o.eski ? { ...o, eski: true } : o));
  }

  private isle(olay: CcOlay, zaman: number): boolean {
    switch (olay.tur) {
      case 'kullanici': {
        if (!olay.metin.trim() && !olay.gorselSayisi) return false;
        this.ekle({ tur: 'kullanici', anahtar: this.yeniAnahtar(), zaman, ust: null, metin: olay.metin, gorselSayisi: olay.gorselSayisi }, null);
        return true;
      }
      case 'metin-parca':
      case 'metin': {
        const k = this.blokAnahtari.get(olay.blok);
        const o = k ? this.taban.get(k) : undefined;
        if (k && o?.tur === 'metin') {
          const metin = olay.tur === 'metin' ? olay.metin : o.metin + olay.metin;
          const akiyor = olay.tur === 'metin-parca';
          if (metin === o.metin && akiyor === o.akiyor) return false;
          this.degistir(k, () => ({ ...o, metin, akiyor }));
          return true;
        }
        if (!olay.metin) return false;
        const yeni: MetinOgesi = { tur: 'metin', anahtar: this.yeniAnahtar(), zaman, ust: olay.ust, blok: olay.blok, metin: olay.metin, akiyor: olay.tur === 'metin-parca' };
        this.blokAnahtari.set(olay.blok, yeni.anahtar);
        this.ekle(yeni, olay.ust);
        return true;
      }
      case 'dusunme': {
        const k = this.blokAnahtari.get(olay.blok);
        if (k) {
          const o = this.taban.get(k);
          if (o?.tur !== 'dusunme' || o.bitti === (olay.durum === 'bitti')) return false;
          this.degistir(k, () => ({ ...o, bitti: olay.durum === 'bitti' }));
          return true;
        }
        if (olay.durum === 'bitti') return false; // tam iletideki/dökümdeki düşünme: gösterge gerekmez
        const yeni: DusunmeOgesi = { tur: 'dusunme', anahtar: this.yeniAnahtar(), zaman, ust: olay.ust, blok: olay.blok, bitti: false };
        this.blokAnahtari.set(olay.blok, yeni.anahtar);
        this.ekle(yeni, olay.ust);
        return true;
      }
      case 'arac-basladi': {
        const var_ = this.aracAnahtari.get(olay.id);
        if (var_) {
          // Aynı araç ikinci kez (anlık görüntü + canlı): girdi güncellenir, yeni kart açılmaz.
          this.degistir(var_, (o) => (o.tur === 'arac' ? { ...o, girdi: olay.girdi, ozet: olay.ozet } : o));
          return true;
        }
        const yeni: AracOgesi = {
          tur: 'arac', anahtar: this.yeniAnahtar(), zaman, ust: olay.ust, id: olay.id, ad: olay.ad, tip: olay.tip, girdi: olay.girdi, ozet: olay.ozet,
          durum: 'calisiyor', ...(olay.kisaltildi ? { girdiKisaltildi: true } : {}),
        };
        this.aracAnahtari.set(olay.id, yeni.anahtar);
        this.ekle(yeni, olay.ust);
        const y = this.yetimler.get(olay.id);
        if (y) { this.yetimler.delete(olay.id); this.aracBitir(yeni.anahtar, y.hata, y.cikti, y.kisaltildi, y.zaman); }
        return true;
      }
      case 'alt-ajan': {
        if (this.aracAnahtari.has(olay.id)) return false;
        const yeni: AltAjanOgesi = {
          tur: 'alt-ajan', anahtar: this.yeniAnahtar(), zaman, ust: olay.ust, id: olay.id, aciklama: olay.aciklama, istem: olay.istem,
          ...(olay.ajanTipi ? { ajanTipi: olay.ajanTipi } : {}), durum: 'calisiyor', cocuklar: [],
        };
        this.aracAnahtari.set(olay.id, yeni.anahtar);
        this.ekle(yeni, olay.ust);
        return true;
      }
      case 'arac-bitti': {
        const k = this.aracAnahtari.get(olay.id);
        if (!k) { this.yetimler.set(olay.id, { hata: olay.hata, cikti: olay.cikti, kisaltildi: olay.kisaltildi, zaman }); return false; }
        this.aracBitir(k, olay.hata, olay.cikti, olay.kisaltildi, zaman);
        return true;
      }
      case 'yapilacaklar': {
        const ustAnahtar = olay.ust ?? '';
        const son = this.sonYapilacak.get(ustAnahtar);
        const sonOge = son ? this.taban.get(son) : undefined;
        // Art arda gelen güncellemeler (TaskCreate ×n, TaskUpdate, TaskList) tek kartta: son öğe aynı listeyse yerinde güncellenir.
        const kardes = olay.ust ? this.cocuk.get(this.aracAnahtari.get(olay.ust) ?? '') ?? [] : this.kok;
        if (son && sonOge?.tur === 'yapilacaklar' && kardes[kardes.length - 1] === son) {
          this.degistir(son, () => ({ ...sonOge, maddeler: olay.maddeler, zaman }));
          return true;
        }
        if (son) this.yapilacakEskit(son);
        const yeni: YapilacakOgesi = { tur: 'yapilacaklar', anahtar: this.yeniAnahtar(), zaman, ust: olay.ust, id: olay.id, maddeler: olay.maddeler, eski: false };
        this.sonYapilacak.set(ustAnahtar, yeni.anahtar);
        this.ekle(yeni, olay.ust);
        return true;
      }
      case 'izin-istegi': {
        if (this.izinAnahtari.has(olay.istekId)) return false;
        const yeni: IzinOgesi = { tur: 'izin', anahtar: this.yeniAnahtar(), zaman, ust: null, istek: olay, ...(olay.aracKimligi ? { aracId: olay.aracKimligi } : {}) };
        this.izinAnahtari.set(olay.istekId, yeni.anahtar);
        this.ekle(yeni, null);
        return true;
      }
      case 'izin-yanitlandi': {
        const k = this.izinAnahtari.get(olay.istekId);
        const o = k ? this.taban.get(k) : undefined;
        if (!k || o?.tur !== 'izin' || o.karar === olay.karar) return false;
        this.degistir(k, () => ({ ...o, karar: olay.karar }));
        // Kararı kendi araç kartında küçük rozet olarak (ayrı satır yok).
        const ak = o.aracId ? this.aracAnahtari.get(o.aracId) : undefined;
        const a = ak ? this.taban.get(ak) : undefined;
        if (ak && a?.tur === 'arac') this.degistir(ak, () => ({ ...a, izinKarari: olay.karar }));
        return true;
      }
      case 'sonuc': {
        // Tur bitti: akan metinler ve süren göstergeler kapanır; hâlâ "çalışıyor" görünen araçlar kesildi sayılır.
        for (const [k, o] of this.taban) {
          if (o.tur === 'metin' && o.akiyor) this.degistir(k, () => ({ ...o, akiyor: false }));
          else if (o.tur === 'dusunme' && !o.bitti) this.degistir(k, () => ({ ...o, bitti: true }));
          else if ((o.tur === 'arac' || o.tur === 'alt-ajan') && o.durum === 'calisiyor') this.degistir(k, () => ({ ...o, durum: 'kesildi' } as DokumOgesi));
        }
        // Önceki sonuç kartı hâlâ "arkada iş sürüyor" diyorsa artık değil: yeni tur başladı, canlı sayıyı yalnız son kart taşır.
        if (this.sonSonuc) this.degistir(this.sonSonuc, (o) => (o.tur === 'sonuc' && o.arkaPlan > 0 ? { ...o, arkaPlan: 0 } : o));
        const kart: SonucOgesi = { tur: 'sonuc', anahtar: this.yeniAnahtar(), zaman, ust: null, sonuc: olay, arkaPlan: this.arkaPlan };
        this.ekle(kart, null);
        this.sonSonuc = kart.anahtar;
        return true;
      }
      case 'arka-plan': {
        this.arkaPlan = olay.sayi;
        // Son sonuç kartı "arkada N iş sürüyor" diyorsa sayı düştükçe güncellenir; 0 olunca "Bitti"ye döner. Bitmiş kart yeniden açılmaz.
        const o = this.sonSonuc ? this.taban.get(this.sonSonuc) : undefined;
        if (!this.sonSonuc || o?.tur !== 'sonuc' || o.arkaPlan === 0 || o.arkaPlan === olay.sayi) return false;
        this.degistir(this.sonSonuc, () => ({ ...o, arkaPlan: olay.sayi }));
        return true;
      }
      case 'sistem': {
        if (!olay.metin.trim()) return false;
        this.ekle({ tur: 'sistem', anahtar: this.yeniAnahtar(), zaman, ust: null, seviye: olay.seviye, metin: olay.metin, ...(olay.ayrinti ? { ayrinti: olay.ayrinti } : {}) }, null);
        return true;
      }
      case 'mod': {
        this.ekle({ tur: 'not', anahtar: this.yeniAnahtar(), zaman, ust: null, metin: `Mod: ${MOD_ADI[olay.mod] ?? olay.mod}` }, null);
        return true;
      }
      case 'model': {
        this.ekle({ tur: 'not', anahtar: this.yeniAnahtar(), zaman, ust: null, metin: `Model: ${olay.model === 'default' ? 'varsayılan' : olay.model}` }, null);
        return true;
      }
      default: return false; // baslangic, durum, unutuldu: dökümde öğe değil
    }
  }
}

/**
 * `oturum-al` anlık görüntüsünden model (düzeltme turu 1): önce döküm, SONRA anlık görüntünün bekleyen izinleri (döküm sınırında
 * kaybolmuş olabilirler), EN SON yükleme sürerken gelen canlı olaylar (`sira`sı büyük olanlar) — tampondaki bir "izin yanıtlandı"
 * eski isteği yeniden bekleyen yapmasın. Dönen `sonra`yı çağıran sırayla uygular (kuyruk/yapılacaklar yan etkileriyle).
 */
export function anlikGoruntu<Z extends { sira: number; zaman: number; olay: CcOlay }>(
  a: { olaylar: readonly Z[]; bekleyenIzinler: readonly CcIzinIstegi[] }, tampon: readonly Z[],
): { model: DokumModeli; sonSira: number; sonra: Z[] } {
  const model = modelKur(a.olaylar.map((z) => ({ olay: z.olay, zaman: z.zaman })));
  for (const i of a.bekleyenIzinler) model.uygula(i);
  const sonSira = a.olaylar.reduce((m, z) => Math.max(m, z.sira), 0);
  return { model, sonSira, sonra: tampon.filter((z) => z.sira > sonSira) };
}

/**
 * Düzeltme turu 2 (N1): alt ajanın (iç içe, her derinlikte) bir adımı izin bekliyor mu. Bekliyorsa alt ajan kartı açık ve bütün adımları
 * görünür tutulur — yoksa bekleyen kart kapalı ajanın ya da "Önceki N adımı göster"in arkasında kalır, tur sonsuza dek bekler.
 */
export function bekleyenTorunVar(o: DokumOgesi, bekliyor: (aracId: string) => boolean): boolean {
  if (o.tur === 'arac') return bekliyor(o.id);
  if (o.tur === 'alt-ajan') return o.cocuklar.some((c) => bekleyenTorunVar(c, bekliyor));
  return false;
}

/** Bellek: kapanmış ve ekranda olmayan oturumların dökümü bırakılır (yeniden açılınca motorun son 200 olayı yüklenir). */
export function birakilacaklar(oturumlar: readonly { id: string; durum: string; yuklu: boolean }[], gorunen: string | null): string[] {
  return oturumlar.filter((o) => o.yuklu && o.durum === 'kapandi' && o.id !== gorunen).map((o) => o.id);
}

/** "Daha eskisi" en çok bu kadar sayfa (80 satırlık) belleğe alınır; sonrası Claude Code'un kendi dökümünde. */
export const ESKI_SAYFA_SINIRI = 10;

/** Anlık görüntüden ya da döküm sayfasından model kurar. */
export function modelKur(olaylar: readonly { olay: CcOlay; zaman: number }[], onek?: string): DokumModeli {
  const m = new DokumModeli(onek);
  m.hepsi(olaylar);
  return m;
}
