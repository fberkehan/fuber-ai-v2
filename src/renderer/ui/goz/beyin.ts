// ── Gözler: hareket beyni (11 Kas, "Pamuk"; tests/goz-hareket.test.ts) — olay güdümlü, boşta sürekli çizim yok ─────────────────────────────────
// Onaylı tasarımın `Beyin` sınıfının ürüne taşınmış hâli (goz-tasarimi-2/index.html). DOM'a bağlı değildir: öğeler soyuttur (E), hareket `Canlandirici`
// (Gozler.tsx'te Web Animations; testte kaydedici), zaman `Saat` (testte sahte) üzerinden. Böylece kurallar sahte zamanlayıcıyla sınanır.
//   · Yalnız transform ve opacity canlanır. Her öğede tek kanal: yeni hareket o anki hesaplanmış değerden başlar (yarıda kesilse bile sıçrama yok).
//   · Sakkad ve kırpma tek atımlık zamanlayıcıyla çalışır (döngü yok). Düşünme ve konuşma döngüleri yalnız o hâl sürerken takılıdır.
//   · Uyku (R13): canlı gözde 'bosta' iken son girdiden 60 sn. Yarıya düşme, iki yavaş kırpma, kapanma (7,2 sn), 6 nefes (kök svg'de, kompozitörde) ve
//     tam durgunluk: uykuda hiçbir zamanlayıcı yok, nefesten sonra hiçbir şey çizilmez. Uyanış 1,6 sn ve o anki konumdan başlar.
//   · Uyku defteri: çentiğin dinlenme yüzü hap ya da medya yüzünden çıkıp geri gelince geri sayım sıfırlanmaz (defter modül düzeyinde, Ada.tsx).
//   · İmleç (R14) yalnız pencere kutusunda; alan dışında 600 ms'de ortaya döner. Az hareket (R16): sakkad, imleç, döngü, zıplama ve nefes yok;
//     kırpma ve kısa hâl geçişleri kalır.
import {
  AZ_UYKU_SURE, CIFT_KIRPMA_ARA, CIFT_KIRPMA_OLASILIGI, DUSUNME_DONGUSU, EGRI_DONUS, EGRI_IMLEC, EGRI_SAKKAD, EGRI_SUZ, EGRI_YAYLI, EGRI_YUMUSAK,
  KIRPMA_SURE, KONUSMA_DONGUSU, MOD_KIRPMA_SURE, modKirpmaKareleri, NEFES_GECIKME, NEFES_SAYI, NEFES_SURE, PAMUK, nefesKareleri, SALLA, SALLA_SURE, UYANIS_SURE,
  UYKU_INIS, UYKU_KAPAK, UYKU_SURE, ZIPLA, ZIPLA_SURE, bakisDonusumu, halBakisi, hedef, imlecBakisi, kapakP, kapakT, kirpmaKareleri, uyanisKareleri,
  yanakT, yayKareleri, yuv, SEKILLER, type Kare, type KapakKaresi, type GozSekli, type GozSekliAdi,
} from './geometri.ts';
import { GOZ_DONUS_MS, UYKU_MS, type GozDurumu, type GozTetigi } from '../../../shared/goz.ts';

/** Bir gözün canlanan öğeleri (iç içe gruplar: bakis > durum > dongu > govde{bebek > bebekDurum, yanak, kapak} + kapali). */
export interface GozOgeleri<E> { s: number; bakis: E; durum: E; dongu: E; bebek: E; bebekDurum: E; yanak: E; kapak: E; kapali: E }
export type CanliOzellik = 'transform' | 'opacity';
export interface DonguKaresi { transform: string; offset?: number; easing?: string }
export interface Canlandirici<E> {
  /** Öğenin o anki değerinden başlayıp karelere giden tek atımlık hareket; öğedeki önceki hareketler iptal edilir, son değer kalıcı yazılır. sure ≤ 0: anında. */
  diz(el: E, ozellik: CanliOzellik, kareler: readonly Kare[], sure: number, gecik?: number): void;
  /** Tekrarlanan hareket (döngü ya da nefes). `tekrar`: Infinity yalnız etkin hâlde. */
  dongu(el: E, kareler: readonly DonguKaresi[], o: { sure: number; gecik: number; tekrar: number; egri?: string }): void;
  /** Kapağın o anki dikey ötelemesi (göz birimi). */
  kapakF(el: E): number;
}
export interface Saat { simdi(): number; kur(fn: () => void, ms: number): unknown; iptal(t: unknown): void }
export const GERCEK_SAAT: Saat = {
  simdi: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  kur: (fn, ms) => setTimeout(fn, ms),
  iptal: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
};

/** Paylaşılan son etkinlik anı (null: henüz yok). `aboneler`: takılı beyinler (dışarıdan gelen girdi canlı göze de ulaşsın). */
export interface UykuDefteri { son: number | null; aboneler?: Set<() => void> }
/** Gözün kendi olayları dışından gelen kullanıcı girdisi (çentiğe tekerlek, tuş, basma): deftere yazar, takılı gözlere söyler (uyuyorsa uyanır). */
export function defterEtkinligi(d: UykuDefteri, an: number): void {
  d.son = an;
  for (const f of [...(d.aboneler ?? [])]) f();
}
/** Takılırken uyuyor mu: defterde süresi dolmuş bir etkinlik varsa ilk çizim uyuyan gözdür (uyku dizisi oynamaz). */
export const baslangictaUyurMu = (defter: UykuDefteri | undefined, simdi: number, durum: GozDurumu): boolean =>
  durum === 'bosta' && defter?.son != null && simdi - defter.son >= UYKU_MS;

export interface BeyinSecenekleri<E> {
  gozler: readonly GozOgeleri<E>[];
  /** Çift (zıplama, sallanma, uykuda iniş). */
  cift: E;
  /** Kök svg (nefes: kompozitörde çalışan tek dönüşüm). */
  kok: E;
  can: Canlandirici<E>;
  saat?: Saat;
  rastgele?: () => number;
  /** Az hareket mi (ayar ya da sistem); her kararda okunur. */
  az?: () => boolean;
  /** Göz biriminin CSS pikseli (nefes kök svg'de piksel ister). */
  birimPx?: () => number;
  /** Canlı göz: sakkad, kırpma, imleç ve uyku saati. Durağan göz yalnız dış tetikleri ve hâl geçişlerini oynar. */
  canli: boolean;
  defter?: UykuDefteri;
  /** Uyku başladı / bitti (kök svg'nin data-uyuyor'u). */
  uykuDegisti?: (uyuyor: boolean) => void;
  /** Gözün biçimi (12 Kas; Business Pamuk, Developer Odak): her kararda okunur. Verilmezse Pamuk. */
  sekil?: () => GozSekli;
  /** Çizilen biçimi değiştir (Gozler: kök svg'nin data-sekil'i; katmanlar anında). Beyin bunu kırpmanın kapalı anında çağırır (sekilDegisti). */
  sekilUygula?: (ad: GozSekliAdi) => void;
}

type Zaman = 'sakkadZ' | 'kirpZ' | 'donusZ' | 'uyanZ' | 'tekZ' | 'uykuZ' | 'ciftZ' | 'modZ' | 'selamZ' | 'nefesZ' | 'sekilZ';
const ZAMANLAR: readonly Zaman[] = ['sakkadZ', 'kirpZ', 'donusZ', 'uyanZ', 'tekZ', 'uykuZ', 'ciftZ', 'modZ', 'selamZ', 'nefesZ', 'sekilZ'];
/** Biçim takasının mod kırpmasının başından gecikmesi: kapak 0,25'te kapanır, 0,5'e dek kapalı durur; ortası (120 ms). */
export const SEKIL_TAKAS_MS = Math.round(MOD_KIRPMA_SURE * 0.375);
/** Takastan sonra bebek, yanak ve duruşun yeni biçime süzülmesi (mod zıplaması 480 ms içinde biter: ModGecisi'nden sonra takılan göz sıçramaz). */
export const SEKIL_SUZULME_MS = 220;
const KIRPMA_ARALIGI: Record<GozDurumu, readonly [number, number]> = {
  bosta: [2400, 5600], dinliyor: [3600, 6800], dusunuyor: [4200, 7600], konusuyor: [2600, 5200], mutlu: [3000, 6000], hata: [2600, 5200], uyuyor: [0, 0],
};
const DURGUN = 'translate(0px, 0px) scale(1, 1)';
const rnd = (r: () => number, a: number, b: number) => a + r() * (b - a);

interface Goz<E> extends GozOgeleri<E> { kapakHedef: string; hedefP: number; rot: number; kapanisRot?: number }

export class GozBeyni<E> {
  /** Çizilen durum (uykuda 'uyuyor'). */
  durum: GozDurumu | null = null;
  uyku = false;
  uyaniyor = false;
  imlecte = false;
  private bakis = { x: 0, y: 0 };
  private dusunYon = -1;
  /** Odak bakışında kalan "satır okuma" adımı. */
  private okuma = 0;
  /** Çizilen biçim (takas kırpmanın kapalı anında; o ana dek eski biçim görünür). */
  private cizilen: GozSekliAdi;
  /** Ebeveynin istediği durum (uyanınca buna döner). */
  private istenen: GozDurumu = 'bosta';
  private sonEtkinlik = 0;
  private calisiyor = false;
  private readonly g: Goz<E>[];
  private readonly o: BeyinSecenekleri<E>;
  private readonly saat: Saat;
  private readonly r: () => number;
  private readonly zaman: Partial<Record<Zaman, unknown>> = {};
  private readonly disGirdi = () => { if (this.calisiyor) this.etkinlik(); };

  constructor(o: BeyinSecenekleri<E>) {
    this.o = o;
    this.saat = o.saat ?? GERCEK_SAAT;
    this.r = o.rastgele ?? Math.random;
    this.g = o.gozler.map((x) => ({ ...x, kapakHedef: kapakT(0), hedefP: 0, rot: 0 }));
    this.cizilen = this.sk().ad;
  }

  private az(): boolean { return this.o.az?.() ?? false; }
  private sk(): GozSekli { return this.o.sekil?.() ?? SEKILLER.pamuk; }
  private kur(ad: Zaman, fn: () => void, ms: number): void {
    this.sil(ad);
    this.zaman[ad] = this.saat.kur(() => { this.zaman[ad] = undefined; fn(); }, Math.max(0, ms));
  }
  private sil(ad: Zaman): void {
    const t = this.zaman[ad];
    if (t !== undefined) { this.saat.iptal(t); this.zaman[ad] = undefined; }
  }
  /** Kurulu tek atımlık zamanlayıcı sayısı (test: uykuda ve durağanda 0). */
  get bekleyen(): number { return ZAMANLAR.filter((z) => this.zaman[z] !== undefined).length; }
  private git(el: E, oz: CanliOzellik, v: string, sure: number, e: string = EGRI_YUMUSAK, gecik = 0): void {
    this.o.can.diz(el, oz, [{ o: 1, v, e }], sure, gecik);
  }

  // ── Yaşam döngüsü ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Takılma: ilk durum zaten çizili (Gozler.tsx satır içi stil). Yalnız zamanlayıcılar ve döngüler kurulur; defterde süre dolmuşsa uykuda başlar. */
  baslat(ilk: GozDurumu): void {
    this.calisiyor = true;
    // Canlı gözün uyuyarak başlaması (defter) ebeveynin isteği değildir: istenen 'bosta' kalır, ilk istek (useEffect) uyandırmaz.
    this.istenen = ilk === 'uyuyor' && this.o.canli ? 'bosta' : ilk;
    const d = this.o.defter;
    if (this.o.canli && d) {
      d.son ??= this.saat.simdi();
      this.sonEtkinlik = d.son;
      (d.aboneler ??= new Set()).add(this.disGirdi);
    } else this.sonEtkinlik = this.saat.simdi();
    if (ilk === 'uyuyor' || (this.o.canli && baslangictaUyurMu(d, this.saat.simdi(), ilk))) {
      // Durağan uyuyan göz: kapak kapalı, yay görünür, çift inik. Dizi ve nefes oynamaz; zamanlayıcı yok.
      this.durum = 'uyuyor';
      this.uyku = this.o.canli;
      for (const g of this.g) { g.kapakHedef = kapakT(1); g.hedefP = 1; g.rot = 0; }
      if (this.uyku) this.o.uykuDegisti?.(true);
      return;
    }
    this.durum = ilk;
    for (const g of this.g) { const h = hedef(ilk, g.s, this.sk()); g.kapakHedef = h.kapak; g.hedefP = h.p; g.rot = h.rot; }
    const b = halBakisi(ilk, this.dusunYon);
    if (b) this.bakis = b;
    if (this.o.canli) for (const g of this.g) this.dongu(g, ilk, this.az());
    if (this.o.canli && (ilk === 'bosta' || ilk === 'konusuyor')) this.kur('sakkadZ', () => this.sakkad(), ilk === 'bosta' ? 900 : 1000);
    this.kirpPlani();
    this.uykuSaati();
  }

  /** Sökülme: bütün zamanlayıcılar silinir, defter aboneliği biter. */
  durdur(): void {
    this.calisiyor = false;
    this.o.defter?.aboneler?.delete(this.disGirdi);
    for (const z of ZAMANLAR) this.sil(z);
  }

  /** Ebeveynin hâli değişti. Etkinlik sayılır (uyuyorsa uyanır). */
  istek(dd: GozDurumu): void {
    if (dd === this.istenen) return;
    this.istenen = dd;
    if (dd !== 'uyuyor') this.sonEtkinlikYaz();
    this.durumYap(dd);
    this.uykuSaati();
  }

  /** Kullanıcı girdisi (imleç alanda, üzerine gelme, tık, dış tetik, defter): geri sayım yenilenir; uyuyorsa uyanır. */
  etkinlik(): void {
    this.sonEtkinlikYaz();
    if (this.uyku) this.durumYap(this.istenen);
    this.uykuSaati();
  }
  private sonEtkinlikYaz(): void {
    this.sonEtkinlik = this.saat.simdi();
    if (this.o.defter) this.o.defter.son = this.sonEtkinlik;
  }
  /** Uyku saati: yalnız canlı gözde ve 'bosta' istenirken; ateşlenince kalan süreyle yeniden kurulur (her girdide yeniden kurulmaz). */
  private uykuSaati(): void {
    if (!this.o.canli || !this.calisiyor || this.uyku || this.istenen !== 'bosta') { this.sil('uykuZ'); return; }
    if (this.zaman.uykuZ !== undefined) return;
    this.kur('uykuZ', () => {
      if (this.uyku || this.istenen !== 'bosta') return;
      const kalan = UYKU_MS - (this.saat.simdi() - this.sonEtkinlik);
      if (kalan > 0) { this.uykuSaati(); return; }
      this.durumYap('uyuyor');
    }, UYKU_MS - (this.saat.simdi() - this.sonEtkinlik));
  }

  // ── Bakış ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private bak(x: number, y: number, sure: number, egri: string, yakinsama = 0): void {
    const M = PAMUK.menzil;
    this.bakis = { x: Math.max(-M.x, Math.min(M.x, x)), y: Math.max(-M.y, Math.min(M.y, y)) };
    for (const g of this.g) {
      const t = bakisDonusumu(this.bakis.x, this.bakis.y, g.s, yakinsama);
      this.git(g.bebek, 'transform', t.bebek, sure, egri);
      this.git(g.bakis, 'transform', t.bakis, sure, egri);
    }
  }
  private sakkad(): void {
    this.sil('sakkadZ');
    if (!this.o.canli || !(this.durum === 'bosta' || this.durum === 'konusuyor') || this.imlecte || this.uyku || this.uyaniyor || this.az()) return;
    const M = PAMUK.menzil; const b = this.bakis; let h: { x: number; y: number };
    const tarz = this.sk().bakis;
    if (this.durum !== 'konusuyor' && tarz !== 'serbest') { this.sakinSakkad(tarz); return; }
    if (this.durum === 'konusuyor') h = { x: rnd(this.r, -1.8, 1.8), y: rnd(this.r, -0.5, 0.6) };
    else {
      const r = this.r();
      if (Math.hypot(b.x, b.y) > 2.5 && r < 0.42) h = { x: rnd(this.r, -0.5, 0.5), y: rnd(this.r, -0.3, 0.3) };
      else if (r < 0.63) h = { x: -M.x * rnd(this.r, 0.65, 1), y: rnd(this.r, -0.6, 0.8) };
      else if (r < 0.86) h = { x: M.x * rnd(this.r, 0.65, 1), y: rnd(this.r, -0.6, 0.8) };
      else if (r < 0.94) h = { x: M.x * rnd(this.r, -0.4, 0.4), y: -M.y * rnd(this.r, 0.5, 0.9) };
      else h = { x: b.x + rnd(this.r, -0.8, 0.8), y: b.y + rnd(this.r, -0.4, 0.4) };
    }
    const genlik = Math.hypot(h.x - b.x, h.y - b.y);
    const sure = Math.round(110 + genlik * 13);
    this.bak(h.x, h.y, sure, EGRI_SAKKAD);
    if (genlik > 8 && this.r() < 0.3) this.kur('ciftZ', () => this.kirp(), sure * 0.35);
    const bekle = this.durum === 'konusuyor' ? rnd(this.r, 800, 1700) : rnd(this.r, 700, 2800) * (genlik < 2 ? 1.3 : 1);
    this.kur('sakkadZ', () => this.sakkad(), bekle);
  }

  /**
   * Keskin biçimlerin boştaki bakışı. Odak: dar dikey bant, uzun bakışlar, ara sıra satır okur gibi soldan sağa 3–4 küçük adım (kodu okuyan dikkat);
   * Sakin: seyrek, yavaş, dar. İkisinde de bakış hızlı ve kısa (keskin), göz bebeği menzilin ortasında kalır.
   */
  private sakinSakkad(tarz: 'odak' | 'sakin'): void {
    const M = PAMUK.menzil; const b = this.bakis; let h: { x: number; y: number }; let bekle: number;
    const r = this.r();
    if (tarz === 'odak' && this.okuma > 0) {
      this.okuma--;
      h = { x: b.x + 1.2 + 0.4 * r, y: b.y + (r - 0.5) * 0.2 };
      bekle = this.okuma > 0 ? rnd(this.r, 280, 460) : rnd(this.r, 900, 1600);
    } else if (tarz === 'odak' && r < 0.3) {
      // Satırın başı: sola, sonra küçük adımlarla sağa.
      h = { x: -M.x * 0.8, y: rnd(this.r, -0.2, 0.5) };
      this.okuma = r < 0.15 ? 4 : 3;
      bekle = rnd(this.r, 300, 480);
    } else if (tarz === 'odak') {
      h = { x: M.x * rnd(this.r, -0.55, 0.55), y: rnd(this.r, -0.4, 0.4) };
      bekle = rnd(this.r, 1400, 3600);
    } else {
      h = { x: M.x * rnd(this.r, -0.7, 0.7), y: rnd(this.r, -0.3, 0.5) };
      bekle = rnd(this.r, 1800, 4200);
    }
    h = { x: Math.max(-M.x, Math.min(M.x, h.x)), y: Math.max(-1.1, Math.min(1.1, h.y)) };
    const genlik = Math.hypot(h.x - b.x, h.y - b.y);
    this.bak(h.x, h.y, Math.round((tarz === 'odak' ? 80 : 140) + genlik * (tarz === 'odak' ? 10 : 14)), EGRI_SAKKAD);
    this.kur('sakkadZ', () => this.sakkad(), bekle);
  }

  // ── Biçim değişimi (12 Kas) ───────────────────────────────────────────────────────────────────────────────────────────────────
  /**
   * Kip değişti, biçim değişebilir (Pamuk ↔ Odak). Göz zıplar (az harekette yok) ve 120 ms sonra kırpar; biçim kırpmanın KAPALI anında takas edilir
   * (kapaklar gövdeyi tam örter: takas görünmez), açılış yeni biçimin kapağına gider, bebek/yanak/duruş 220 ms'de süzülür. Gözler zaten kapalıysa
   * (uyku, durağan uyuyan göz) takas hemen olur; uyuyan canlı göz sonra yeni biçimle uyanır. Biçim aynıysa yalnız mod jesti.
   */
  sekilDegisti(): void {
    const yeni = this.sk();
    if (yeni.ad === this.cizilen) { this.tetikle('mod'); return; }
    this.sil('sekilZ'); this.sil('modZ');
    if (!this.calisiyor || this.uyku || this.uyaniyor || this.durum === 'uyuyor') {
      this.takas(yeni, this.uyaniyor);
      if (this.calisiyor && this.o.canli) this.etkinlik();
      return;
    }
    if (this.o.canli) this.etkinlik();
    this.zipla();
    this.kur('modZ', () => {
      const dd = this.durum ?? 'bosta';
      for (const g of this.g) { const h = hedef(dd, g.s, yeni); g.kapanisRot = g.rot; g.kapakHedef = h.kapak; g.hedefP = h.p; g.rot = h.rot; }
      this.kirp(false, true);
      this.kur('sekilZ', () => this.takas(yeni, false), SEKIL_TAKAS_MS);
    }, 120);
  }
  private takas(sk: GozSekli, kapakDa: boolean): void {
    this.cizilen = sk.ad;
    this.okuma = 0;
    this.o.sekilUygula?.(sk.ad);
    const dd = this.durum ?? 'bosta';
    for (const g of this.g) {
      const h = hedef(dd, g.s, sk);
      g.kapakHedef = h.kapak; g.hedefP = h.p; g.rot = h.rot;
      if (dd === 'uyuyor') continue;
      if (kapakDa) this.git(g.kapak, 'transform', h.kapak, 300);
      this.git(g.bebekDurum, 'transform', h.bebek, SEKIL_SUZULME_MS);
      this.git(g.yanak, 'transform', h.yanak, SEKIL_SUZULME_MS);
      this.git(g.durum, 'transform', h.durum, SEKIL_SUZULME_MS);
    }
  }

  // ── Kırpma ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Asimetrik kırpma: 75 ms hızlanarak kapanır, 35 ms durur, 150 ms yavaşlayarak açılır. Kapalı yay kapalı anda görünür. */
  kirp(cift = false, mod = false): void {
    if (this.uyku || this.uyaniyor) return;
    const sure = mod ? MOD_KIRPMA_SURE : KIRPMA_SURE;
    for (const g of this.g) {
      const p0 = kapakP(this.o.can.kapakF(g.kapak));
      const K = mod ? modKirpmaKareleri(g.hedefP) : kirpmaKareleri(g.hedefP);
      // Mod kırpması eski eğimle kapanır, yeni eğime yalnız KAPALIYKEN döner (kare kare denetim: kapanışın son karelerinde dönüş kenarda görünüyordu).
      const r0 = mod ? (g.kapanisRot ?? g.rot) : g.rot;
      this.o.can.diz(g.kapak, 'transform', K.map((k, i) => ({ o: k.o, v: i === K.length - 1 ? g.kapakHedef : kapakT(k.p, i === 0 ? r0 : g.rot), e: k.e })), sure);
      this.o.can.diz(g.kapali, 'opacity', yayKareleri(p0, K, 40), sure);
    }
    if (cift) this.kur('ciftZ', () => this.kirp(false), CIFT_KIRPMA_ARA);
  }
  private kirpPlani(): void {
    this.sil('kirpZ');
    if (!this.o.canli || this.uyku || !this.durum || this.durum === 'uyuyor') return;
    const [a, b] = KIRPMA_ARALIGI[this.durum];
    this.kur('kirpZ', () => { if (!this.uyaniyor) this.kirp(this.r() < CIFT_KIRPMA_OLASILIGI); this.kirpPlani(); }, rnd(this.r, a, b));
  }

  // ── Hâller ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  private durumYap(dd: GozDurumu): void {
    const onceki = this.durum;
    if (dd === onceki && dd !== 'hata' && dd !== 'mutlu') return;
    this.durum = dd;
    this.okuma = 0;
    this.sil('sakkadZ'); this.sil('tekZ'); this.sil('selamZ');
    if (dd === 'uyuyor') { this.uyu(); return; }
    const uyanacak = this.uyku || this.uyaniyor;
    if (this.uyku) this.uyan(dd);
    const az = this.az();
    for (const g of this.g) {
      const h = hedef(dd, g.s, this.sk());
      g.kapakHedef = h.kapak; g.hedefP = h.p; g.rot = h.rot;
      if (!uyanacak) this.git(g.kapak, 'transform', h.kapak, dd === 'hata' ? 380 : 320, EGRI_YUMUSAK);
      this.git(g.yanak, 'transform', h.yanak, dd === 'mutlu' ? 420 : 340, dd === 'mutlu' && !az ? EGRI_YAYLI : EGRI_YUMUSAK);
      this.git(g.durum, 'transform', h.durum, 360, dd === 'mutlu' && !az ? EGRI_YAYLI : EGRI_YUMUSAK);
      this.git(g.bebekDurum, 'transform', h.bebek, 320);
      this.dongu(g, dd, az);
    }
    if (dd === 'dusunuyor') this.dusunYon *= -1;
    const b = halBakisi(dd, this.dusunYon);
    if (b) this.bak(b.x, b.y, dd === 'dusunuyor' ? 760 : dd === 'dinliyor' ? 280 : dd === 'konusuyor' ? 260 : dd === 'hata' ? 300 : dd === 'mutlu' ? 320 : 360, dd === 'dusunuyor' ? EGRI_SUZ : EGRI_YUMUSAK);
    if (this.o.canli && dd === 'bosta') this.kur('sakkadZ', () => this.sakkad(), uyanacak ? UYANIS_SURE + 400 : 900);
    if (this.o.canli && dd === 'konusuyor') this.kur('sakkadZ', () => this.sakkad(), 1000);
    // Tek atımlık jestler (zıplama, sallanma) uyanışın sonuna ertelenir, uyanışla çakışmasın.
    const jest = () => { if (dd === 'mutlu') this.zipla(); if (dd === 'hata') this.salla(); };
    if (uyanacak) { if (dd === 'mutlu' || dd === 'hata') this.kur('tekZ', jest, UYANIS_SURE); } else jest();
    this.kirpPlani();
  }
  /** Hâl döngüleri (yalnız canlı gözün etkin hâllerinde; boşta, uykuda, durağan gözde ve az harekette yok). */
  private dongu(g: Goz<E>, dd: GozDurumu, az: boolean): void {
    this.git(g.dongu, 'transform', DURGUN, 260);
    if (az || !this.o.canli) return;
    if (dd === 'dusunuyor') this.o.can.dongu(g.dongu, DUSUNME_DONGUSU.kareler, { sure: DUSUNME_DONGUSU.sure, gecik: DUSUNME_DONGUSU.gecik, tekrar: Infinity, egri: DUSUNME_DONGUSU.egri });
    if (dd === 'konusuyor') this.o.can.dongu(g.dongu, KONUSMA_DONGUSU.kareler, { sure: KONUSMA_DONGUSU.sure, gecik: KONUSMA_DONGUSU.gecik, tekrar: Infinity });
  }
  private zipla(): void {
    if (this.az()) return;
    this.o.can.diz(this.o.cift, 'transform', ZIPLA, ZIPLA_SURE);
  }
  private salla(): void {
    if (this.az()) return;
    this.o.can.diz(this.o.cift, 'transform', SALLA, SALLA_SURE);
  }

  // ── Uyku ve uyanış ────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Uykuya dalış: yarıya düşme, iki yavaş kırpma, yavaşça kapanma, sonra 6 nefes ve tam durgunluk. */
  private uyu(): void {
    this.uyku = true; this.uyaniyor = false; this.imlecte = false;
    for (const z of ZAMANLAR) this.sil(z);
    this.o.uykuDegisti?.(true);
    const az = this.az();
    const b = halBakisi('uyuyor', this.dusunYon) ?? { x: 0, y: 0.8 };
    this.bak(b.x, b.y, az ? 300 : 1400, EGRI_SUZ);
    for (const g of this.g) {
      g.kapakHedef = kapakT(1); g.hedefP = 1; g.rot = 0;
      this.git(g.durum, 'transform', DURGUN, 700, EGRI_SUZ);
      this.git(g.yanak, 'transform', yanakT(0), 700, EGRI_SUZ);
      this.git(g.dongu, 'transform', DURGUN, 400);
      this.git(g.bebekDurum, 'transform', 'scale(1)', 700);
      const p0 = kapakP(this.o.can.kapakF(g.kapak));
      if (az) {
        const K: KapakKaresi[] = [{ o: 1, p: 1, e: 'cubic-bezier(0.45, 0, 0.4, 1)' }];
        this.git(g.kapak, 'transform', kapakT(1), AZ_UYKU_SURE, K[0].e);
        this.o.can.diz(g.kapali, 'opacity', yayKareleri(p0, K, 30), AZ_UYKU_SURE);
      } else {
        this.o.can.diz(g.kapak, 'transform', UYKU_KAPAK.map((k) => ({ o: k.o, v: kapakT(k.p), e: k.e })), UYKU_SURE);
        this.o.can.diz(g.kapali, 'opacity', yayKareleri(p0, UYKU_KAPAK, 240), UYKU_SURE);
      }
    }
    if (az) this.git(this.o.cift, 'transform', 'translate(0px, 0px)', 200);
    else this.o.can.diz(this.o.cift, 'transform', [{ o: 0.3, v: `translate(0px, ${yuv(UYKU_INIS)}px)`, e: EGRI_SUZ }, { o: 1, v: `translate(0px, ${yuv(UYKU_INIS)}px)` }], UYKU_SURE);
    // Nefes: kök svg'nin dönüşümü, adımlı (geometri.ts nefesKareleri: adım başına ≤ 0,2 px, çentikte saniyede ~3 yazım). Sürekli canlandırma değil, tek atımlık
    // zamanlayıcı zinciri: etkin bir Web Animation her ekran tazelemesinde işlenir (bosta-islemci: GPU ve işleyici), adımlar arasında ise hiçbir şey çizilmez.
    // Sayılı: 6 nefesten sonra zincir biter, artık hiçbir şey çizilmez. Az harekette yok.
    this.git(this.o.kok, 'transform', DURGUN, 0);
    if (!az) {
      const kareler = nefesKareleri(this.o.birimPx?.() ?? 1);
      const anlar: { t: number; v: string }[] = [];
      for (let n = 0; n < NEFES_SAYI; n++) for (const k of kareler) if (n === 0 || k.offset > 0) anlar.push({ t: (n + k.offset) * NEFES_SURE, v: k.transform });
      let i = 0;
      const adim = () => {
        this.o.can.diz(this.o.kok, 'transform', [{ o: 1, v: anlar[i].v }], 0);
        i++;
        if (i < anlar.length) this.kur('nefesZ', adim, anlar[i].t - anlar[i - 1].t);
      };
      this.kur('nefesZ', adim, UYKU_SURE + NEFES_GECIKME);
    }
  }
  /** Uyanış: yay söner, yarıya açılır, duraksar, tam açılır ve bir kez kırpar. O anki konumdan başlar. */
  private uyan(dd: GozDurumu): void {
    this.uyku = false; this.uyaniyor = true;
    this.sil('nefesZ');
    this.o.uykuDegisti?.(false);
    const az = this.az();
    this.git(this.o.kok, 'transform', DURGUN, az ? 0 : 300, 'ease-out');
    for (const g of this.g) {
      const h = hedef(dd, g.s, this.sk());
      const p0 = kapakP(this.o.can.kapakF(g.kapak));
      if (az) {
        const K: KapakKaresi[] = [{ o: 1, p: h.p, e: 'cubic-bezier(0.3, 0, 0.2, 1)' }];
        this.o.can.diz(g.kapali, 'opacity', yayKareleri(p0, K, 30), AZ_UYKU_SURE);
        this.git(g.kapak, 'transform', h.kapak, AZ_UYKU_SURE, K[0].e);
      } else {
        const K = uyanisKareleri(h.p);
        this.o.can.diz(g.kapak, 'transform', K.map((k) => ({ o: k.o, v: kapakT(k.p, h.rot * (k.r ?? 1)), e: k.e })), UYANIS_SURE);
        this.o.can.diz(g.kapali, 'opacity', yayKareleri(p0, K, 160), UYANIS_SURE);
      }
    }
    if (az) this.git(this.o.cift, 'transform', 'translate(0px, 0px)', 300);
    else this.o.can.diz(this.o.cift, 'transform', [{ o: 0.56, v: 'translate(0px, -0.5px)', e: 'cubic-bezier(0.3, 0, 0.2, 1)' }, { o: 1, v: 'translate(0px, 0px)', e: 'ease-in-out' }], UYANIS_SURE);
    this.kur('uyanZ', () => { this.uyaniyor = false; }, az ? AZ_UYKU_SURE : UYANIS_SURE);
  }

  // ── Dış olaylar ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Tek atımlık jest. Etkinlik sayılır: uyuyan göz önce uyanır. */
  tetikle(t: GozTetigi): void {
    if (this.calisiyor && this.o.canli) this.etkinlik();
    if (this.uyku || this.uyaniyor) return;
    if (t === 'kirp') { this.kirp(true); return; }
    if (t === 'mod') { this.zipla(); this.kur('modZ', () => this.kirp(), 120); return; }
    // Selam: kısa gülümseme (yanak kalkar, ^ ^) ve zıplama, sonra hâline döner. Az harekette yalnız çift kırpma.
    if (this.az()) { this.kirp(true); return; }
    for (const g of this.g) {
      const m = hedef('mutlu', g.s, this.sk());
      this.git(g.yanak, 'transform', m.yanak, 420, EGRI_YAYLI);
      this.git(g.durum, 'transform', m.durum, 360, EGRI_YAYLI);
    }
    this.zipla();
    this.kur('selamZ', () => {
      const dd = this.durum ?? 'bosta';
      if (dd === 'uyuyor') return;
      for (const g of this.g) { const h = hedef(dd, g.s, this.sk()); this.git(g.yanak, 'transform', h.yanak, 340); this.git(g.durum, 'transform', h.durum, 360); }
    }, 900);
  }

  /** İmleç (göz çiftinin merkezine göre, göz birimi). Alan içindeyse etkinlik sayılır. Düşünürken ve hatada bakış kendi işaretini taşır. */
  imlec(dx: number, dy: number): void {
    if (!this.o.canli) return;
    this.etkinlik();
    if (this.az() || this.uyku || this.uyaniyor || this.durum === 'dusunuyor' || this.durum === 'hata') return;
    this.imlecte = true;
    this.okuma = 0;
    this.sil('sakkadZ'); this.sil('donusZ');
    const b = imlecBakisi(dx, dy);
    this.bak(b.x, b.y, 140, EGRI_IMLEC, b.yakinsama);
  }
  /** İmleç alandan çıktı: gözler 600 ms'de ortaya döner, sonra sakkad sürer. */
  imlecGitti(): void {
    if (!this.imlecte) return;
    this.imlecte = false;
    this.bak(0, 0, GOZ_DONUS_MS, EGRI_DONUS);
    if (this.durum === 'bosta' || this.durum === 'konusuyor') this.kur('donusZ', () => this.sakkad(), 1400);
  }

  /** Az hareket ayarı değişti. */
  azDegisti(): void {
    this.sil('sakkadZ');
    if (this.uyku) { this.durum = null; this.durumYap('uyuyor'); return; }
    if (this.durum) for (const g of this.g) this.dongu(g, this.durum, this.az());
    if (this.az()) { this.imlecte = false; if (this.durum !== 'dusunuyor') this.bak(0, 0, 240, EGRI_YUMUSAK); }
    else if (this.o.canli && (this.durum === 'bosta' || this.durum === 'konusuyor')) this.kur('sakkadZ', () => this.sakkad(), 600);
  }
}
