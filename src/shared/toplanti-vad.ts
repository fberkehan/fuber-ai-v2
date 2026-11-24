// ── Toplantı modu: ses akışını konuşmalara ve parçalara bölen enerji tabanlı VAD (12 Kas 2026; saf — tests/toplanti.test.ts) ────────────────────
// Her ses akışı (bilgisayarın sesi = "Karşı taraf", mikrofon = "Siz") kendi kesicisinden geçer; konuşan etiketi akıştan gelir. Arayüzde bu kod bir
// işçide (renderer/toplanti/yakalama-isci.ts) koşar: AudioWorklet örnekleri doğrudan işçiye akıtır, ana iş parçacığına yalnız parçalar gelir.
// Kurallar (16 kHz, 20 ms çerçeve):
//  · Eşik uyarlanır: sessizlikteki gürültü tabanının 3 katı (en az MIN_ESIK). Konuşma 3 ardışık yüksek çerçeveyle başlar (tık sesi konuşma sayılmaz);
//    başlangıcın 240 ms öncesi de parçaya katılır (ilk hece kaybolmasın).
//  · Parça ≈ 2–4 sn: konuşma ≥ 2 sn sürüp kısa bir duraklama (≥ 250 ms) gelince ya da 4 sn dolunca kesilir — yazıya çevirme hemen başlar, ara metin
//    erken görünür. Konuşma 700 ms sessizlikle biter (son parça `son: true`). Bir satır en çok 20 sn: uzun konuşma yeni satırla sürer.
//  · Yalnız bir parçalık ve 300 ms'den kısa "konuşma" yazıya çevrilmez ('vazgecildi'): öksürük, masa sesi kredi harcamasın.
// Zaman damgaları akışın örnek sayacından (ms): duvar saatine bağlı değil, testte belirlenimci.
// AKIŞ KİPİ (14 Kas; `VAD_AKIS`, `akis: 1`): ses PARÇALANMAZ — konuşma başlar başlamaz (240 ms ön ses dahil) ~80 ms'lik bloklar hâlinde 'ses' olayı olarak akar; VAD yalnız
// konuşmanın nerede başlayıp bittiğini söyler ('basladi' / 'bitti'): bitişe 450 ms sessizlik yeter, 12 sn'yi aşan konuşma yeni satırla sürer. Sessizlikte hiçbir ses gitmez
// (kredi harcanmaz). Gerçek zamanlı yazıya çevirme bunu doğrudan alır; parça beklemek yok. Konuşma kısa kalırsa ('vazgecildi') ses çoktan gitmiş olabilir: ana süreç commit
// edip sonucu atar.
import { Ornekleyici } from './pcm.ts';

export const VAD = {
  hz: 16_000,
  cerceveMs: 20,
  onSesMs: 240,
  baslaCerceve: 3,
  parcaEnAzMs: 2000,
  parcaEnCokMs: 4000,
  kisaSessizlikMs: 250,
  bitisSessizlikMs: 700,
  satirEnCokMs: 20_000,
  enAzKonusmaMs: 300,
  minEsik: 0.012,
  gurultuKat: 3,
  /** 1: akış kipi (parça yok; 'ses' blokları + 'bitti'). */
  akis: 0,
  akisBlokMs: 80,
} as const;
export type VadAyari = { -readonly [K in keyof typeof VAD]: number };
/** Gerçek zamanlı akış için ayar (arayüz işçisi bunu kullanır): bitiş 450 ms, satır en çok 12 sn. */
export const VAD_AKIS: Partial<VadAyari> = { akis: 1, bitisSessizlikMs: 450, satirEnCokMs: 12_000 };

export type KesiciOlayi =
  | { tur: 'basladi'; konusmaNo: number; basMs: number }
  | { tur: 'parca'; konusmaNo: number; parcaNo: number; pcm: Uint8Array; son: boolean; basMs: number; bitMs: number }
  /** Akış kipi: bir konuşmanın sesi (16 kHz PCM16), sırayla. */
  | { tur: 'ses'; konusmaNo: number; pcm: Uint8Array; basMs: number }
  /** Akış kipi: konuşma bitti (satır kesinleşir). */
  | { tur: 'bitti'; konusmaNo: number; bitMs: number }
  | { tur: 'vazgecildi'; konusmaNo: number };

const pcmBayt = (f: Float32Array): Uint8Array => {
  const o = new Int16Array(f.length);
  for (let i = 0; i < f.length; i++) o[i] = Math.max(-32768, Math.min(32767, Math.round(f[i] * 32767)));
  return new Uint8Array(o.buffer);
};

export class KonusmaKesici {
  private readonly a: VadAyari;
  private readonly olay: (o: KesiciOlayi) => void;
  private readonly cerceve: number;
  private artik = new Float32Array(0);
  /** İşlenen örnek sayısı (zaman damgası). */
  private sayac = 0;
  private gurultu: number;
  private hal: 'sessiz' | 'konusma' = 'sessiz';
  private yuksekArdisik = 0;
  /** Konuşma öncesi halka tampon (çerçeveler). */
  private onSes: Float32Array[] = [];
  private parca: Float32Array[] = [];
  private parcaBasOrnek = 0;
  private konusmaBasOrnek = 0;
  private sessizlikMs = 0;
  private sesliMs = 0;
  private konusmaNo = 0;
  private parcaNo = 0;

  constructor(olay: (o: KesiciOlayi) => void, ayar: Partial<VadAyari> = {}) {
    this.a = { ...VAD, ...ayar };
    this.olay = olay;
    this.cerceve = Math.round((this.a.hz * this.a.cerceveMs) / 1000);
    this.gurultu = this.a.minEsik / this.a.gurultuKat;
  }

  /** Şu anki eşik (ölçüm/önizleme için). */
  get esik(): number { return Math.max(this.a.minEsik, this.gurultu * this.a.gurultuKat); }
  get konusuyor(): boolean { return this.hal === 'konusma'; }

  /** 16 kHz örnekler (−1…1), istenen uzunlukta. */
  besle(ornekler: Float32Array): void {
    let x = ornekler;
    if (this.artik.length) { const b = new Float32Array(this.artik.length + x.length); b.set(this.artik); b.set(x, this.artik.length); x = b; }
    let i = 0;
    for (; i + this.cerceve <= x.length; i += this.cerceve) this.cerceveIsle(x.slice(i, i + this.cerceve));
    this.artik = x.slice(i);
  }

  /** Akış bitti (Durdur): süren konuşma son parçasıyla kapanır. */
  bitir(): void {
    if (this.artik.length) { const c = new Float32Array(this.cerceve); c.set(this.artik); this.artik = new Float32Array(0); this.cerceveIsle(c); }
    if (this.hal === 'konusma') this.konusmaBitir();
  }

  private ms(ornek: number): number { return Math.round((ornek * 1000) / this.a.hz); }

  private cerceveIsle(c: Float32Array): void {
    let t = 0;
    for (let i = 0; i < c.length; i++) t += c[i] * c[i];
    const rms = Math.sqrt(t / c.length);
    this.sayac += c.length;
    const esik = this.esik;
    if (this.hal === 'sessiz') {
      // Gürültü tabanı yalnız sessizlikte (ve eşiğin altındaki çerçevelerde) uyarlanır.
      if (rms < esik) this.gurultu = this.gurultu * 0.95 + rms * 0.05;
      this.onSes.push(c);
      const onSesCerceve = Math.ceil(this.a.onSesMs / this.a.cerceveMs) + this.a.baslaCerceve;
      while (this.onSes.length > onSesCerceve) this.onSes.shift();
      this.yuksekArdisik = rms >= esik ? this.yuksekArdisik + 1 : 0;
      if (this.yuksekArdisik >= this.a.baslaCerceve) {
        this.hal = 'konusma';
        this.konusmaNo++;
        this.parcaNo = 0;
        this.parca = [...this.onSes];
        this.onSes = [];
        this.parcaBasOrnek = Math.max(0, this.sayac - this.parca.reduce((n, p) => n + p.length, 0));
        this.konusmaBasOrnek = this.parcaBasOrnek;
        this.sessizlikMs = 0;
        this.sesliMs = this.a.baslaCerceve * this.a.cerceveMs;
        this.olay({ tur: 'basladi', konusmaNo: this.konusmaNo, basMs: this.ms(this.konusmaBasOrnek) });
        if (this.a.akis) this.sesBosalt(true); // ön ses dahil ilk blok hemen gider
      }
      return;
    }
    this.parca.push(c);
    if (this.a.akis) this.sesBosalt(false);
    // Gecikmeli bitiş (histerezis): konuşma içinde eşiğin %70'i yeter.
    if (rms >= esik * 0.7) { this.sessizlikMs = 0; this.sesliMs += this.a.cerceveMs; } else this.sessizlikMs += this.a.cerceveMs;
    const parcaMs = this.ms(this.parca.reduce((n, p) => n + p.length, 0));
    const konusmaMs = this.ms(this.sayac - this.konusmaBasOrnek);
    if (this.sessizlikMs >= this.a.bitisSessizlikMs) { this.konusmaBitir(); return; }
    if (this.a.akis) {
      if (konusmaMs >= this.a.satirEnCokMs) {
        // Sürekli konuşma: satır kesinleşir, yenisi hemen açılır (parça yok; ses akmaya devam eder).
        this.sesBosalt(true);
        this.olay({ tur: 'bitti', konusmaNo: this.konusmaNo, bitMs: this.ms(this.parcaBasOrnek) });
        this.konusmaNo++;
        this.konusmaBasOrnek = this.sayac;
        this.sesliMs = this.a.enAzKonusmaMs; // sürüyen konuşma: kısa kuyruk 'vazgecildi' sayılmaz
        this.olay({ tur: 'basladi', konusmaNo: this.konusmaNo, basMs: this.ms(this.konusmaBasOrnek) });
      }
      return;
    }
    if (parcaMs >= this.a.parcaEnCokMs || (parcaMs - this.sessizlikMs >= this.a.parcaEnAzMs && this.sessizlikMs >= this.a.kisaSessizlikMs)) {
      const satirDoldu = konusmaMs >= this.a.satirEnCokMs;
      this.parcaGonder(satirDoldu);
      if (satirDoldu) {
        // Konuşma sürüyor: yeni satır hemen açılır.
        this.konusmaNo++;
        this.parcaNo = 0;
        this.konusmaBasOrnek = this.sayac;
        this.sesliMs = 0;
        this.olay({ tur: 'basladi', konusmaNo: this.konusmaNo, basMs: this.ms(this.konusmaBasOrnek) });
      }
    }
  }

  private parcaGonder(son: boolean): void {
    const n = this.parca.reduce((t, p) => t + p.length, 0);
    const f = new Float32Array(n);
    let o = 0;
    for (const p of this.parca) { f.set(p, o); o += p.length; }
    const basMs = this.ms(this.parcaBasOrnek);
    this.parcaBasOrnek += n;
    this.parca = [];
    this.olay({ tur: 'parca', konusmaNo: this.konusmaNo, parcaNo: this.parcaNo++, pcm: pcmBayt(f), son, basMs, bitMs: this.ms(this.parcaBasOrnek) });
  }

  /** Akış kipi: biriken çerçeveleri `akisBlokMs`'lik bloklar hâlinde 'ses' olarak verir (`zorla`: kalan ne varsa). */
  private sesBosalt(zorla: boolean): void {
    const blok = Math.max(1, Math.round(this.a.akisBlokMs / this.a.cerceveMs));
    if (!this.parca.length || (!zorla && this.parca.length < blok)) return;
    const n = this.parca.reduce((t, p) => t + p.length, 0);
    const f = new Float32Array(n);
    let o = 0;
    for (const p of this.parca) { f.set(p, o); o += p.length; }
    const basMs = this.ms(this.parcaBasOrnek);
    this.parcaBasOrnek += n;
    this.parca = [];
    this.olay({ tur: 'ses', konusmaNo: this.konusmaNo, pcm: pcmBayt(f), basMs });
  }

  private konusmaBitir(): void {
    if (this.a.akis) {
      this.sesBosalt(true);
      const kisa = this.parcaNo === 0 && this.sesliMs < this.a.enAzKonusmaMs;
      const bitMs = this.ms(this.parcaBasOrnek);
      this.hal = 'sessiz';
      this.yuksekArdisik = 0;
      this.sessizlikMs = 0;
      this.olay(kisa ? { tur: 'vazgecildi', konusmaNo: this.konusmaNo } : { tur: 'bitti', konusmaNo: this.konusmaNo, bitMs });
      return;
    }
    // Sondaki sessizlik kırpılır (200 ms kalır): yazıya çevirmeye boşluk gitmesin.
    const fazla = Math.max(0, Math.floor((this.sessizlikMs - 200) / this.a.cerceveMs));
    if (fazla > 0) this.parca.splice(Math.max(0, this.parca.length - fazla), fazla);
    this.hal = 'sessiz';
    this.yuksekArdisik = 0;
    this.sessizlikMs = 0;
    if (this.parcaNo === 0 && this.sesliMs < this.a.enAzKonusmaMs) {
      this.parca = [];
      this.olay({ tur: 'vazgecildi', konusmaNo: this.konusmaNo });
      return;
    }
    this.parcaGonder(true);
  }
}

/** Bir akışın yakalayıcısı: herhangi bir örnekleme hızındaki örnekler → 16 kHz → kesici. `seviye`: son beslemenin RMS'i (gösterge). */
export class ToplantiYakalayici {
  private ornekleyici: Ornekleyici | null = null;
  readonly kesici: KonusmaKesici;
  seviye = 0;
  constructor(olay: (o: KesiciOlayi) => void, ayar: Partial<VadAyari> = {}) { this.kesici = new KonusmaKesici(olay, ayar); }

  besle(ornekler: Float32Array, hz: number): void {
    let t = 0;
    for (let i = 0; i < ornekler.length; i++) t += ornekler[i] * ornekler[i];
    this.seviye = ornekler.length ? Math.sqrt(t / ornekler.length) : 0;
    if (hz === VAD.hz) { this.kesici.besle(ornekler); return; }
    if (!this.ornekleyici || this.ornekleyici.girisHz !== hz) this.ornekleyici = new Ornekleyici(hz, VAD.hz);
    const b = this.ornekleyici.donustur(ornekler);
    const i16 = new Int16Array(b.buffer, b.byteOffset, b.byteLength >> 1);
    const f = new Float32Array(i16.length);
    for (let i = 0; i < i16.length; i++) f[i] = i16[i] / 32768;
    this.kesici.besle(f);
  }

  bitir(): void { this.kesici.bitir(); }
}
