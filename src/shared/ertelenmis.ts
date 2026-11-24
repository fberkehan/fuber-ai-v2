// ── Geri alınabilir silme: 5 sn bekle, sonra uygula (saf) ───────────────────────────────────────────────────────────────
// Görev 20b (K2): Hafıza "Unut", e-posta "Kaldır" ve belge silme tek tıkla geri alınamazdı. Silme HEMEN uygulanmaz: kayıt
// arayüzde gizlenir, "Geri al" tostu 5 sn görünür, süre dolunca uygulanır. Kuyruk ANA SÜREÇTE durur (main/silme-kuyrugu.ts):
//  - Normal çıkışta (tepsi "Çık", app.quit, oturum kapanışı) bekleyenler HEMEN uygulanır (`hepsiniHemenUygula`): kullanıcı "Unut"
//    deyip uygulamayı kapattıysa kayıt gerçekten unutulur.
//  - Çökme/zorla kapatma pencere içinde olursa silme hiç uygulanmamış olur: veri kaybı ve yarım silme yok (ör. e-posta hesabı kalkıp
//    parolası kalmaz); kayıt yeniden açılışta yerinde görünür.
// Uygulanmış silmenin anahtarı oturum boyunca gizli kalır (liste yenilenene dek kayıt bir an geri belirmesin). Uygulama hata verirse
// kayıt geri belirir ve hata bildirilir.
// Düzeltme turu 2:
//  - Bir GRUP (aynı türden art arda silinenler; tek "Geri al" tostu) TEK süre paylaşır: gruba yeni silme katılınca öncekilerin süresi
//    de yenisininkine uzar. Eskiden tost en yeninin süresini gösterirken önceki üye kendi süresiyle siliniyor, "Geri al" yalnız
//    sonuncuyu kurtarıyordu.
//  - Duraklatma GRUP BAŞINA (`duraklat(grup)`): yalnız üstüne gelinen/odaklanan tostun süresi durur, öteki tostlar akar (çizgileri de).
//    Grup boşalınca (uygulandı ya da geri alındı) duraklatması da kalkar; grupsuz `duraklat()`/`surdur()` o an bekleyen bütün
//    grupları durdurur/sürdürür (ana süreç pencere gizlenince, odağı kaybedince ya da arayüz yeniden yüklenince sürdürür: takılı
//    kalmaz).

export const GERI_AL_MS = 5000;

export interface ErtelenmisIs { anahtar: string; etiket: string; bitis: number; grup?: string; durakli?: boolean }
export interface Saat { kur(f: () => void, ms: number): unknown; iptal(k: unknown): void; simdi(): number }

const gercekSaat: Saat = {
  kur: (f, ms) => setTimeout(f, ms),
  iptal: (k) => clearTimeout(k as ReturnType<typeof setTimeout>),
  simdi: () => Date.now(),
};

interface Kayit extends ErtelenmisIs { uygula: () => unknown; hata?: (e: unknown) => void; zaman: unknown; kalan: number; sira: number }

const grubu = (k: { grup?: string; anahtar: string }) => k.grup ?? k.anahtar;

export class ErtelenmisSilme {
  private readonly bekleyen = new Map<string, Kayit>();
  private readonly uygulaniyor = new Set<string>();
  private readonly uygulanan = new Set<string>();
  private readonly dinleyiciler = new Set<() => void>();
  private readonly durakliGruplar = new Set<string>();
  private readonly saat: Saat;
  private readonly sure: number;
  private sayac = 0;

  constructor(saat: Saat = gercekSaat, sure = GERI_AL_MS) {
    this.saat = saat;
    this.sure = sure;
  }

  /** Silmeyi `sure` sonra uygular. Aynı anahtar bekliyorsa eskisi iptal edilir (tek bekleyen, en sona geçer). Gruptaki öteki
   *  bekleyenlerin süresi de yenisininkine uzar: grup tek süre paylaşır, "Geri al" hepsini geri alabilir. */
  ertele(is: { anahtar: string; etiket: string; grup?: string; uygula: () => unknown; hata?: (e: unknown) => void }): void {
    const eski = this.bekleyen.get(is.anahtar);
    if (eski?.zaman != null) this.saat.iptal(eski.zaman);
    this.bekleyen.delete(is.anahtar);
    this.uygulanan.delete(is.anahtar);
    const bitis = this.saat.simdi() + this.sure;
    this.bekleyen.set(is.anahtar, { anahtar: is.anahtar, etiket: is.etiket, grup: is.grup, uygula: is.uygula, hata: is.hata, bitis, kalan: this.sure, zaman: null, sira: ++this.sayac });
    const g = grubu(is);
    const durakli = this.durakliGruplar.has(g);
    for (const k of this.uyeler(g)) {
      if (k.zaman != null) this.saat.iptal(k.zaman);
      k.bitis = bitis;
      k.kalan = this.sure;
      k.zaman = durakli ? null : this.saat.kur(() => void this.uygula(k.anahtar), this.sure);
    }
    this.bildir();
  }

  /** Bekleyen silmeyi iptal eder; uygulanmış ya da uygulanmakta olan geri alınamaz (false). */
  geriAl(anahtar: string): boolean {
    const k = this.bekleyen.get(anahtar);
    if (!k) return false;
    if (k.zaman != null) this.saat.iptal(k.zaman);
    this.bekleyen.delete(anahtar);
    this.grupBosaldiysa(grubu(k));
    this.bildir();
    return true;
  }

  /** Grubun süresini durdurur (tostun üstüne gelindi / odaklandı); kalan süre saklanır. Grup verilmezse o an bekleyen bütün gruplar. */
  duraklat(grup?: string): void {
    const gruplar = grup === undefined ? this.gruplar() : this.uyeler(grup).length ? [grup] : [];
    const s = this.saat.simdi();
    let degisti = false;
    for (const g of gruplar) {
      if (this.durakliGruplar.has(g)) continue;
      this.durakliGruplar.add(g);
      degisti = true;
      for (const k of this.uyeler(g)) {
        if (k.zaman != null) this.saat.iptal(k.zaman);
        k.zaman = null;
        k.kalan = Math.max(0, k.bitis - s);
      }
    }
    if (degisti) this.bildir();
  }

  /** Grubun süresini kalanından sürdürür. Grup verilmezse duraklatılmış bütün gruplar. */
  surdur(grup?: string): void {
    const gruplar = grup === undefined ? [...this.durakliGruplar] : this.durakliGruplar.has(grup) ? [grup] : [];
    if (!gruplar.length) return;
    const s = this.saat.simdi();
    for (const g of gruplar) {
      this.durakliGruplar.delete(g);
      for (const k of this.uyeler(g)) {
        k.bitis = s + k.kalan;
        k.zaman = this.saat.kur(() => void this.uygula(k.anahtar), k.kalan);
      }
    }
    this.bildir();
  }

  /** Duraklatılmış grup var mı? */
  get durakli(): boolean { return this.durakliGruplar.size > 0; }
  /** Duraklatılmış gruplar (arayüz aynası). */
  duraklatilanlar(): string[] { return [...this.durakliGruplar]; }

  /** Çıkışta: bekleyenlerin HEPSİ şimdi ve eşzamanlı uygulanır (uygula sözü dönerse beklenmez; hatası bildirilir). */
  hepsiniHemenUygula(): void {
    if (!this.bekleyen.size) return;
    for (const k of [...this.bekleyen.values()]) {
      if (k.zaman != null) this.saat.iptal(k.zaman);
      this.bekleyen.delete(k.anahtar);
      try {
        const r = k.uygula();
        if (r && typeof (r as Promise<unknown>).then === 'function') (r as Promise<unknown>).catch((e) => k.hata?.(e));
        this.uygulanan.add(k.anahtar);
      } catch (e) {
        k.hata?.(e);
      }
    }
    this.durakliGruplar.clear();
    this.bildir();
  }

  /** Arayüz bu kaydı göstermesin mi? (bekliyor, uygulanıyor ya da uygulandı) */
  gizliMi(anahtar: string): boolean {
    return this.bekleyen.has(anahtar) || this.uygulaniyor.has(anahtar) || this.uygulanan.has(anahtar);
  }

  /** Gizlenmesi gereken bütün anahtarlar (arayüze aynası gider). */
  gizliAnahtarlar(): string[] {
    return [...new Set([...this.bekleyen.keys(), ...this.uygulaniyor, ...this.uygulanan])];
  }

  /** Tostlar: bekleyen silmeler, en eskisi önce (grubu duraklatılmışken bitiş = şimdi + kalan, `durakli: true`). */
  bekleyenler(): ErtelenmisIs[] {
    const s = this.saat.simdi();
    return [...this.bekleyen.values()].sort((a, b) => a.sira - b.sira).map(({ anahtar, etiket, grup, bitis, kalan }) => {
      const durakli = this.durakliGruplar.has(grup ?? anahtar);
      return { anahtar, etiket, bitis: durakli ? s + kalan : bitis, ...(grup ? { grup } : {}), ...(durakli ? { durakli } : {}) };
    });
  }

  dinle(f: () => void): () => void {
    this.dinleyiciler.add(f);
    return () => { this.dinleyiciler.delete(f); };
  }

  private uyeler(g: string): Kayit[] { return [...this.bekleyen.values()].filter((k) => grubu(k) === g); }
  private gruplar(): string[] { return [...new Set([...this.bekleyen.values()].map(grubu))]; }
  /** Grubun son üyesi gitti: duraklatması da kalkar (aynı türden sonraki silme duraklatılmış başlamasın). */
  private grupBosaldiysa(g: string): void { if (!this.uyeler(g).length) this.durakliGruplar.delete(g); }

  private async uygula(anahtar: string): Promise<void> {
    const k = this.bekleyen.get(anahtar);
    if (!k) return;
    this.bekleyen.delete(anahtar);
    this.grupBosaldiysa(grubu(k));
    this.uygulaniyor.add(anahtar);
    this.bildir();
    try {
      await k.uygula();
      this.uygulanan.add(anahtar);
    } catch (e) {
      k.hata?.(e);
    } finally {
      this.uygulaniyor.delete(anahtar);
      this.bildir();
    }
  }

  private bildir(): void { for (const f of [...this.dinleyiciler]) f(); }
}

// ── Tost grupları ──────────────────────────────────────────────────────────────────────────────────────────────────────
// Art arda silinenler tek tostta toplanır ("3 kayıt unutuldu · Geri al"); "Geri al" gruptakilerin hepsini geri alır.

export const SILME_COGUL: Record<string, (n: number) => string> = {
  hafiza: (n) => `${n} kayıt unutuldu`,
  // I6: Fuber'in (modelin) kendi silmeleri ayrı tostta (main/silme-kuyrugu.ts FUBER_SILME_GRUBU).
  'hafiza-fuber': (n) => `Fuber ${n} hafıza kaydını sildi`,
  eposta: (n) => `${n} e-posta hesabı kaldırıldı`,
  belge: (n) => `${n} belge silindi`,
};

export interface GeriAlGrubu { grup: string; anahtarlar: string[]; etiket: string; bitis: number; durakli: boolean }

/** Bekleyenleri gruplarına göre toplar (ilk görünüş sırasıyla); tek kayıtlı grup kendi etiketini, çok kayıtlı grup çoğul metni taşır.
 *  Grup tek süre paylaşır (kuyruk eşitler); bitiş yine de en geç olanıdır. */
export function geriAlGruplari(liste: readonly ErtelenmisIs[]): GeriAlGrubu[] {
  const gruplar = new Map<string, ErtelenmisIs[]>();
  for (const b of liste) {
    const g = b.grup ?? b.anahtar;
    gruplar.set(g, [...(gruplar.get(g) ?? []), b]);
  }
  return [...gruplar].map(([grup, l]) => ({
    grup,
    anahtarlar: l.map((x) => x.anahtar),
    etiket: l.length === 1 ? l[0].etiket : (SILME_COGUL[grup]?.(l.length) ?? `${l.length} öğe silindi`),
    bitis: Math.max(...l.map((x) => x.bitis)),
    durakli: l.some((x) => x.durakli),
  }));
}
