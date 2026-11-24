// ── Konuşma oturumu (Görev 21, K9): akan metin → cümleler → akışlı ses, sırayla; kesilebilir ─────────────────────────────────────
// Electron'a bağımlı değil (birim testli: tests/ses-akis.test.ts). Bir oturum = Fuber'in bir konuşması (bir yanıt, bir bildirim, bir
// "Dinle"). Kurallar:
//  - Ses kimliği oturum BAŞLARKEN kilitlenir (`kimlik`; üretici ona bağlıdır): ayar konuşma sürerken değişse de ses değişmez.
//  - Model yazdıkça `ekle(parca)`; tamamlanan her cümle hemen seslendirilir (shared/cumle-bolucu.ts). İlk cümle uzun sürerse
//    `ilkZorlaMs` sonra yumuşak sınırdan kesilir (ilk ses gecikmesi bütçesi).
//  - Aynı anda en çok iki istek: çalınan cümle + bir sonraki (ön alma). Ses parçaları SIRAYLA gönderilir; ön alınan cümlenin sesi
//    öncekinin sesi bitene dek bekletilir.
//  - Hata: o cümlenin hiç sesi gelmediyse bir kez yeniden denenir; yine olmazsa (ya da akış ortada koptuysa) oturum "yalnız metin"e
//    geçer — `hata` olayı, kalan istekler kesilir, BAŞKA SESE GEÇİLMEZ (yedek ses de denenmez).
//  - `kes()`: kullanıcı konuştu, Durdur'a ya da Sustur'a bastı: bütün istekler hemen kesilir, başka olay gönderilmez.
//  - Gecikme: ilk metnin geldiği andan ilk ses parçasının gönderildiği ana (ms) ölçülür; `gecikme` geri çağrısı ve `bitti` olayı taşır.
import { CumleBolucu, type BolucuAyari } from '../../shared/cumle-bolucu.ts';
import { sayilariOku } from '../../shared/sayi-okuma.ts';
import type { SesKimligi } from '../../shared/ses-kimligi.ts';

export type KonusmaUretici = (metin: string, o: { sinyal: AbortSignal; onceki?: string }) => AsyncIterable<Uint8Array>;
/** Ses parçalarının biçimi: 'pcm16' (16 bit PCM, `hz`; akışlı ElevenLabs ve yedek ses) ya da 'mp3' (0.10 E3, K3: Fuber hesabının sesi —
 *  her 'ses' olayı bir cümlenin TAM MP3'ü; pencere çözüp sırayla çalar). */
export type SesBicimi = 'pcm16' | 'mp3';

export type KonusmaOlayi =
  | { tur: 'basladi'; id: string; motor: SesKimligi['motor']; hz: number; bicim: SesBicimi }
  /** `pcm`: 'pcm16'da PCM parçası, 'mp3'te bir cümlenin MP3'ü (alan adı eski telefon/arayüz uyumu için aynı). */
  | { tur: 'ses'; id: string; sira: number; pcm: Uint8Array }
  | { tur: 'bitti'; id: string; ilkSesMs?: number }
  /** Ses üretilemedi: bundan sonrası yalnız metin (başka sese geçilmez). `yok` (0.10 E3, sözleşme notu): sunucuda ses modeli yok ve bu
   *  bilgisayarda yedek ses de yok — hata değil, "ses yok". `satir` (0.13): kullanıcıya söylenecek tek satır (ham `mesaj` günlük içindir; main/ses/merkez.ts ekler). */
  | { tur: 'hata'; id: string; mesaj: string; yok?: true; satir?: string }
  /** Karakterin sesi yerine bu bilgisayarın sesi çalıyor (0.13): tek satır, oturumda bir kez, ilk sesten hemen önce (main/ses/merkez.ts). */
  | { tur: 'uyari'; id: string; mesaj: string };

export interface KonusmaAyari {
  id: string;
  kimlik: SesKimligi;
  hz: number;
  /** Varsayılan 'pcm16'. */
  bicim?: SesBicimi;
  uret: KonusmaUretici;
  gonder: (o: KonusmaOlayi) => void;
  /** İlk metinden bu kadar sonra hâlâ hiç cümle çıkmadıysa ilk parça yumuşak sınırdan kesilir. */
  ilkZorlaMs?: number;
  /** Bir cümlenin ilk ses parçası için en uzun bekleme; sonra hata sayılır (yeniden denenir). */
  ilkParcaMs?: number;
  /** İki ses parçası arasında en uzun bekleme (akış asılı kaldı). */
  duraklamaMs?: number;
  /** Yeniden denemeden önce bekleme. */
  tekrarMs?: number;
  /** İlk ses gecikmesi ölçüldü (ms). */
  gecikme?: (ms: number) => void;
  /** Bir cümlenin sesi tamamlandı (günlük/ölçüm). */
  cumleBitti?: (sira: number, metin: string, ms: number) => void;
  bolucu?: Partial<BolucuAyari>;
  saat?: () => number;
}

interface Cumle {
  sira: number;
  metin: string;
  onceki?: string;
  parcalar: Uint8Array[];
  bitti: boolean;
  hata: Error | null;
  sesGeldi: boolean;
  kontrol: AbortController | null;
  bas: number;
}

export class Konusma {
  readonly id: string;
  private readonly a: Required<Pick<KonusmaAyari, 'ilkZorlaMs' | 'ilkParcaMs' | 'duraklamaMs' | 'tekrarMs'>> & KonusmaAyari;
  private readonly bolucu: CumleBolucu;
  private readonly cumleler: Cumle[] = [];
  private bas = 0; // sıradaki gönderilecek cümle (dizin)
  private sonraki = 0; // sıradaki başlatılacak cümle
  private calisan = 0;
  private metinBitti = false;
  private ilkMetin = 0;
  private ilkSes = 0;
  private zorlaZaman: ReturnType<typeof setTimeout> | null = null;
  private _durum: 'suruyor' | 'bitti' | 'kesildi' | 'hata' = 'suruyor';
  /** Toplam istek sayısı (yeniden denemeler dahil; test ve günlük). */
  istekSayisi = 0;

  constructor(a: KonusmaAyari) {
    this.id = a.id;
    this.a = { ilkZorlaMs: 650, ilkParcaMs: 5000, duraklamaMs: 5000, tekrarMs: 250, ...a };
    this.bolucu = new CumleBolucu(a.bolucu);
    this.gonder({ tur: 'basladi', id: this.id, motor: a.kimlik.motor, hz: a.hz, bicim: a.bicim ?? 'pcm16' });
  }

  get durum() { return this._durum; }
  get kimlik(): SesKimligi { return this.a.kimlik; }
  /** İlk metinden ilk ses parçasına (ms); henüz ses yoksa undefined. */
  get ilkSesMs(): number | undefined { return this.ilkSes ? this.ilkSes - this.ilkMetin : undefined; }

  private simdi = () => (this.a.saat ?? Date.now)();
  private gonder(o: KonusmaOlayi): void { try { this.a.gonder(o); } catch { /* alıcı yok (pencere kapandı) */ } }

  ekle(parca: string): void {
    if (this._durum !== 'suruyor' || this.metinBitti || !parca) return;
    if (!this.ilkMetin) {
      this.ilkMetin = this.simdi();
      this.zorlaZaman = setTimeout(() => { this.zorlaZaman = null; if (!this.cumleler.length && this._durum === 'suruyor') this.kuyruga(this.bolucu.zorla()); }, this.a.ilkZorlaMs);
    }
    this.kuyruga(this.bolucu.ekle(parca));
  }

  bitir(): void {
    if (this._durum !== 'suruyor' || this.metinBitti) return;
    this.metinBitti = true;
    this.zorlaIptal();
    this.kuyruga(this.bolucu.bitir());
    this.ilerle();
  }

  kes(): void {
    if (this._durum !== 'suruyor') return;
    this._durum = 'kesildi';
    this.zorlaIptal();
    for (const c of this.cumleler) c.kontrol?.abort();
  }

  private zorlaIptal(): void { if (this.zorlaZaman) { clearTimeout(this.zorlaZaman); this.zorlaZaman = null; } }

  private kuyruga(metinler: string[]): void {
    if (this._durum !== 'suruyor') return;
    for (const ham of metinler) {
      if (!this.ilkMetin) this.ilkMetin = this.simdi(); // bitir()'e tek seferde verilen metin
      // Saat, tarih, tutar ve sayılar yazıyla (Flash v2.5 sayıları zayıf okur; shared/sayi-okuma.ts — düzeltme 7).
      const metin = sayilariOku(ham);
      const onceki = this.cumleler[this.cumleler.length - 1]?.metin;
      this.cumleler.push({ sira: this.cumleler.length, metin, onceki, parcalar: [], bitti: false, hata: null, sesGeldi: false, kontrol: null, bas: 0 });
    }
    if (metinler.length) this.zorlaIptal();
    this.pompala();
  }

  private pompala(): void {
    while (this._durum === 'suruyor' && this.calisan < 2 && this.sonraki < this.cumleler.length) {
      const c = this.cumleler[this.sonraki++];
      this.calisan++;
      void this.uret(c).finally(() => { this.calisan--; this.pompala(); this.ilerle(); });
    }
  }

  private async uret(c: Cumle): Promise<void> {
    for (let deneme = 0; deneme < 2 && this._durum === 'suruyor'; deneme++) {
      if (deneme) await new Promise((r) => setTimeout(r, this.a.tekrarMs));
      if (this._durum !== 'suruyor') return;
      c.hata = null;
      const kontrol = new AbortController();
      c.kontrol = kontrol;
      c.bas = this.simdi();
      this.istekSayisi++;
      let saat: ReturnType<typeof setTimeout> | null = null;
      let zamanAsimi = false;
      const kur = (ms: number) => { if (saat) clearTimeout(saat); saat = setTimeout(() => { zamanAsimi = true; kontrol.abort(); }, ms); };
      kur(this.a.ilkParcaMs);
      try {
        for await (const p of this.a.uret(c.metin, { sinyal: kontrol.signal, onceki: c.onceki })) {
          if (this._durum !== 'suruyor') return;
          c.sesGeldi = true;
          c.parcalar.push(p);
          kur(this.a.duraklamaMs);
          this.ilerle();
        }
        if (saat) clearTimeout(saat);
        if (zamanAsimi) throw new Error('Ses zaman aşımı');
        c.bitti = true;
        this.a.cumleBitti?.(c.sira, c.metin, this.simdi() - c.bas);
        return;
      } catch (e) {
        if (saat) clearTimeout(saat);
        if (this._durum !== 'suruyor') return; // kesildi
        c.hata = zamanAsimi ? new Error('Ses sunucusu zamanında yanıt vermedi.') : (e as Error);
        // Ses ortada koptuysa yeniden denemek aynı sözleri tekrarlatır: yalnız hiç ses gelmediyse yeniden dene.
        if (c.sesGeldi) break;
      }
    }
    if (c.hata && this._durum === 'suruyor') c.bitti = true;
  }

  /** Sıradaki cümlenin biriken parçalarını gönderir; biten cümleyi geçer; sona gelince bitti/hata. */
  private ilerle(): void {
    while (this._durum === 'suruyor' && this.bas < this.cumleler.length) {
      const c = this.cumleler[this.bas];
      while (c.parcalar.length) {
        const pcm = c.parcalar.shift()!;
        if (!this.ilkSes) { this.ilkSes = this.simdi(); this.a.gecikme?.(this.ilkSes - this.ilkMetin); }
        this.gonder({ tur: 'ses', id: this.id, sira: c.sira, pcm });
      }
      if (!c.bitti) return;
      if (c.hata) {
        this._durum = 'hata';
        for (const x of this.cumleler) x.kontrol?.abort();
        this.gonder({ tur: 'hata', id: this.id, mesaj: c.hata.message, ...((c.hata as { sesYok?: unknown }).sesYok === true ? { yok: true as const } : {}) });
        return;
      }
      this.bas++;
    }
    if (this._durum === 'suruyor' && this.metinBitti && this.bas >= this.cumleler.length) {
      this._durum = 'bitti';
      this.gonder({ tur: 'bitti', id: this.id, ilkSesMs: this.ilkSesMs });
    }
  }
}
