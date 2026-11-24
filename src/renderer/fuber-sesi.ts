// ── Fuber'in sesi — pencere tarafı (Görev 21, K9): akışlı konuşma istemcisi + Web Audio PCM çalar ────────────────────────────────
// Ada, sohbet, tostlar ve Ayarlar'daki "Dinle" aynı yolu kullanır: `fuberKonus()` ana süreçte bir konuşma açar (main/ses.ts), model
// yazdıkça `ekle()`, bitince `bitir()`. Ana süreç tamamlanan her cümleyi akışla seslendirir ve 22,05 kHz PCM parçaları 'ses:akis' ile
// gönderir; burada çözücü beklemeden Web Audio'da arka arkaya (boşluksuz) çalınır.
//  - Pencerede aynı anda TEK konuşma: yenisi başlarken eskisi susar (iki ses üst üste binmez).
//  - `kes()` (Sustur, Durdur, kullanıcı konuştu, Esc): çalan ses 8 ms'lik yumuşak kısılmayla ANINDA durur, ana süreçteki istekler kesilir.
//  - Ses seçilmez (0.13): ses kipin karakterine bağlıdır. `kip` turun başında kilitlenen kiptir (sohbet olayı `basladi.kip`); kip tur sürerken
//    değişse de araç sonrası yeniden açılan konuşma aynı sesle söyler. Verilmezse ana süreç şu anki kipe bakar.
//  - Ses yoksa (anahtar yok + yedek ses kurulu değil, sesli yanıt kapalı) ya da ses üretilemezse (hata) `sonuc` bunu söyler: yazı kalır,
//    başka sese geçilmez (tarayıcı sesi YOK). Sessiz düşüş yok (0.13): `fuberKonus`un `satirSoyle`si nedeni tek satırla ekrana verir (ada, sohbet).
//  - Kulak kendi sesimizi duymasın: çalarken kalan süre + 0,8 sn 'kulak:bekle' (gün kaydı ve soru yakalama bekler); "Hey Fuber" söz
//    kesmek için dinlemeye devam eder.
//  - Ölçüm: ilk metin parçasından ilk sesin hoparlöre çıktığı ana (ms; çıkış gecikmesi dahil) ana sürece 'ses:olcum' ile yazılır.
import { cagir, dinle } from './api';
import type { KipKimligi } from '../shared/karakterler';

export type KonusmaSonucu = 'bitti' | 'yok' | 'hata' | 'kesildi';
export type KonusmaKaynagi = 'yanit' | 'bildirim' | 'onizleme' | 'sohbet';

type AkisOlayi =
  | { tur: 'basladi'; id: string; motor: string; hz: number; bicim?: 'pcm16' | 'mp3' }
  | { tur: 'ses'; id: string; sira: number; pcm: Uint8Array }
  | { tur: 'bitti'; id: string; ilkSesMs?: number }
  /** `yok` (0.10 E3): sunucuda ses modeli yok ve yedek ses kurulu değil — hata değil, "ses yok". `satir` (0.13): kullanıcıya söylenecek tek satır. */
  | { tur: 'hata'; id: string; mesaj: string; yok?: true; satir?: string }
  /** Karakterin sesi yerine bu bilgisayarın sesi çalıyor (0.13): tek satır, oturumda bir kez. */
  | { tur: 'uyari'; id: string; mesaj: string };

/** 'ses:konus-baslat' yanıtı: konuşma açıldı, hiç ses yok ama söylenecek bir satır var, ya da ses istenmedi (null). */
type Acilis = { id: string; motor: string; hz: number; bicim?: 'pcm16' | 'mp3'; hiz?: number } | { yok: true; satir: string } | null;

// ── Çalar ──
class Calar {
  private ctx: AudioContext | null = null;
  private kazanc: GainNode | null = null;
  private sonZaman = 0;
  private kaynaklar = new Set<AudioBufferSourceNode>();
  private bosaldi: (() => void) | null = null;

  /** Bağlam sesin KENDİ hızında (22,05 kHz) açılır (düzeltme 7): parçalar tek tek yeniden örneklenmez (eskiden 48 kHz bağlamda her
   *  parçanın ayrı yeniden örneklenmesi sınırlarda duyulur ek yerleri bırakıyordu); sürekli çıkışı ses sistemi tek akış olarak dönüştürür.
   *  Başka hızda bir konuşma gelirse (çalan yokken) bağlam o hızda yeniden açılır. */
  private hazirla(hz: number): { ctx: AudioContext; kazanc: GainNode } {
    if (this.ctx && this.ctx.state !== 'closed' && this.ctx.sampleRate !== hz && !this.kaynaklar.size) { void this.ctx.close(); this.ctx = null; }
    if (!this.ctx || this.ctx.state === 'closed') {
      try { this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: hz }); } catch { this.ctx = new AudioContext({ latencyHint: 'interactive' }); }
      this.kazanc = this.ctx.createGain();
      this.kazanc.connect(this.ctx.destination);
      this.sonZaman = 0;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return { ctx: this.ctx, kazanc: this.kazanc! };
  }

  /** PCM16 LE parçasını sıraya koyar (bir öncekinin bittiği örneğe bitişik); sesin hoparlöre çıkacağı an (performance.now ms) döner. */
  besle(pcm: Uint8Array, hz: number): number {
    const { ctx, kazanc } = this.hazirla(hz);
    const n = pcm.length >> 1;
    if (!n) return performance.now();
    const v = new DataView(pcm.buffer, pcm.byteOffset, n * 2);
    const tampon = ctx.createBuffer(1, n, hz);
    const k = tampon.getChannelData(0);
    for (let i = 0; i < n; i++) k[i] = v.getInt16(i * 2, true) / 32768;
    const kaynak = ctx.createBufferSource();
    kaynak.buffer = tampon;
    kaynak.connect(kazanc);
    kazanc.gain.cancelScheduledValues(ctx.currentTime);
    kazanc.gain.setValueAtTime(1, ctx.currentTime);
    const bas = Math.max(ctx.currentTime + 0.015, this.sonZaman);
    kaynak.start(bas);
    this.sonZaman = bas + tampon.duration;
    this.kaynaklar.add(kaynak);
    kaynak.onended = () => { this.kaynaklar.delete(kaynak); if (!this.kaynaklar.size) { const f = this.bosaldi; this.bosaldi = null; f?.(); } };
    return performance.now() + (bas - ctx.currentTime + (ctx.outputLatency || ctx.baseLatency || 0)) * 1000;
  }

  // ── Kodlanmış ses (0.10 E3, K3: Fuber hesabının sesi — her parça bir cümlenin MP3'ü) ──
  // Düzeltme turu 1: konuşma hızı pencerede uygulanır (sunucuya gitmez) — HTMLAudioElement `playbackRate` + `preservesPitch` (perde
  // korunur; Web Audio'nun playbackRate'i perdeyi de kaydırırdı). Cümleler geldiği sırayla, biri bitince öteki çalar. Sunucu sesi yokken
  // sessizce yedek sese dönülen cümle WAV'dır (ana süreç onu hız 1 ile üretir; hız burada, aynı biçimde uygulanır).
  private kodluKuyruk: { url: string; hiz: number; coz: (t: number | null) => void }[] = [];
  private kodluCalan: { el: HTMLAudioElement; url: string; coz: (t: number | null) => void } | null = null;
  /** Son çalınan kodlu cümlenin ayarı (önizleme denetimi: hız ve perde koruması). */
  sonKodlu: { hiz: number; perde: boolean } | null = null;

  /** Bir cümlenin sesini sıraya koyar; sesin hoparlöre çıktığı an (performance.now ms) ya da çalınamadıysa/kesildiyse null. */
  besleKodlu(veri: Uint8Array, hiz: number): Promise<number | null> {
    const wav = veri.length > 4 && veri[0] === 0x52 && veri[1] === 0x49 && veri[2] === 0x46 && veri[3] === 0x46; // "RIFF"
    const url = URL.createObjectURL(new Blob([veri.slice()], { type: wav ? 'audio/wav' : 'audio/mpeg' }));
    return new Promise((coz) => {
      this.kodluKuyruk.push({ url, hiz: Math.min(1.15, Math.max(0.85, hiz || 1)), coz });
      this.kodluSiradaki();
    });
  }

  private kodluSiradaki(): void {
    if (this.kodluCalan) return;
    const p = this.kodluKuyruk.shift();
    if (!p) { this.bosaldiysaBildir(); return; }
    const el = new Audio(p.url);
    el.preservesPitch = true;
    el.playbackRate = p.hiz;
    this.sonKodlu = { hiz: el.playbackRate, perde: el.preservesPitch };
    const calan = { el, url: p.url, coz: p.coz };
    this.kodluCalan = calan;
    let basladi = false;
    const bitti = () => {
      if (this.kodluCalan !== calan) return;
      URL.revokeObjectURL(p.url);
      this.kodluCalan = null;
      if (!basladi) p.coz(null);
      this.kodluSiradaki();
    };
    el.onplaying = () => { if (!basladi) { basladi = true; p.coz(performance.now()); } };
    el.onended = bitti;
    el.onerror = () => { console.warn('[ses] cümle sesi çalınamadı'); bitti(); };
    void el.play().catch(() => bitti());
  }

  private bosaldiysaBildir(): void {
    if (this.kaynaklar.size || this.kodluCalan || this.kodluKuyruk.length) return;
    const f = this.bosaldi;
    this.bosaldi = null;
    f?.();
  }

  /** Sıradaki her şey çalınınca (hemen, sırada bir şey yoksa; sıradaki kodlu cümleler de "sırada" sayılır). */
  bitince(f: () => void): void { if (!this.kaynaklar.size && !this.kodluCalan && !this.kodluKuyruk.length) f(); else this.bosaldi = f; }

  /** Çalanı hemen durdurur (8 ms kısılma: tık sesi olmasın). Sıradaki kodlu cümleler de düşer. */
  kes(): void {
    this.bosaldi = null;
    for (const p of this.kodluKuyruk.splice(0)) { URL.revokeObjectURL(p.url); p.coz(null); }
    if (this.kodluCalan) {
      const c = this.kodluCalan;
      this.kodluCalan = null;
      c.el.onended = null; c.el.onerror = null; c.el.onplaying = null;
      try { c.el.pause(); } catch { /* bitti */ }
      URL.revokeObjectURL(c.url);
      c.coz(null);
    }
    if (!this.ctx || !this.kazanc) return;
    const t = this.ctx.currentTime;
    this.kazanc.gain.cancelScheduledValues(t);
    this.kazanc.gain.setValueAtTime(this.kazanc.gain.value, t);
    this.kazanc.gain.linearRampToValueAtTime(0, t + 0.008);
    for (const k of this.kaynaklar) { k.onended = null; try { k.stop(t + 0.01); } catch { /* bitti */ } }
    this.kaynaklar.clear();
    this.sonZaman = 0;
  }

  /** Sırada kalan çalma süresi (ms; kodlu cümlede çalanın kalanı + sıradaki her cümle için kaba 3 sn). */
  kalanMs(): number {
    if (this.kodluCalan) {
      const e = this.kodluCalan.el;
      const kalan = Number.isFinite(e.duration) ? Math.max(0, (e.duration - e.currentTime) / (e.playbackRate || 1)) * 1000 : 3000;
      return kalan + this.kodluKuyruk.length * 3000;
    }
    return this.ctx && this.kaynaklar.size ? Math.max(0, (this.sonZaman - this.ctx.currentTime) * 1000) : 0;
  }
  get caliyor(): boolean { return this.kaynaklar.size > 0 || Boolean(this.kodluCalan) || this.kodluKuyruk.length > 0; }
}

const calar = new Calar();

// ── Konuşmalar ──
export interface FuberKonusmasi {
  ekle(metin: string): void;
  bitir(): void;
  kes(): void;
  /** Konuşma bitti (ses çalınıp bittiğinde), ses yoktu, üretilemedi ya da kesildi. */
  readonly sonuc: Promise<KonusmaSonucu>;
  /** İlk ses hoparlöre çıkınca çözülür (hiç ses çıkmazsa çözülmez). */
  readonly basladi: Promise<void>;
  /** Ses var mı (ana süreç konuşmayı açtı; false: yalnız yazı). Açılış bitene dek undefined. */
  readonly sesVar: boolean | undefined;
}

let etkin: Konusma | null = null;
const kayitli = new Map<string, Konusma>();
let dinliyor = false;
function olaylariDinle(): void {
  if (dinliyor || typeof window === 'undefined' || !window.fuber) return;
  dinliyor = true;
  dinle('ses:akis', (o: AkisOlayi) => kayitli.get(o.id)?.olay(o));
  dinle('ses:kes', () => etkin?.kes());
}

/** Ölçümler (önizleme ve uçtan uca testler okur): her konuşmanın ilk çalma gecikmesi, kesilme anı. */
export const sesOlcumleri: { kaynak: string; ilkCalmaMs?: number; ilkCalmaZaman?: number; motor?: string; sonuc?: KonusmaSonucu; kesilmeMs?: number }[] = [];
(globalThis as { __fuberSes?: unknown }).__fuberSes = { olcumler: sesOlcumleri, caliyor: () => calar.caliyor, kalanMs: () => calar.kalanMs(), sonKodlu: () => calar.sonKodlu };

class Konusma implements FuberKonusmasi {
  private id: string | null = null;
  private acilis: Promise<void>;
  private bekleyen: string[] = [];
  private metinBitti = false;
  private bitti = false;
  private ilkMetin = 0;
  private ilkSes = false;
  private sonBekle = 0;
  private hz = 22050;
  /** 'mp3' (0.10 E3): her parça bir cümlenin MP3'ü — çözülüp sırayla çalınır. */
  private bicim: 'pcm16' | 'mp3' = 'pcm16';
  /** Hesabın sesinde konuşma hızı (pencere uygular; öteki yollarda 1). */
  private hiz = 1;
  private sonucCoz!: (s: KonusmaSonucu) => void;
  private basladiCoz!: () => void;
  readonly sonuc: Promise<KonusmaSonucu>;
  readonly basladi: Promise<void>;
  sesVar: boolean | undefined;
  private readonly olcum: (typeof sesOlcumleri)[number];

  constructor(private readonly kaynak: KonusmaKaynagi, kip?: KipKimligi, private readonly satirSoyle?: (m: string) => void) {
    this.sonuc = new Promise((c) => { this.sonucCoz = c; });
    this.basladi = new Promise((c) => { this.basladiCoz = c; });
    this.olcum = { kaynak };
    sesOlcumleri.push(this.olcum);
    if (sesOlcumleri.length > 30) sesOlcumleri.shift();
    this.acilis = cagir<Acilis>('ses:konus-baslat', { kaynak, kip }).then((r) => {
      if (this.bitti) { if (r && 'id' in r) void cagir('ses:sustur', r.id).catch(() => undefined); return; }
      if (!r || 'yok' in r) { if (r) this.satirSoyle?.(r.satir); this.sesVar = false; this.sonla('yok'); return; }
      this.id = r.id; this.hz = r.hz; this.bicim = r.bicim === 'mp3' ? 'mp3' : 'pcm16'; this.hiz = Number(r.hiz) || 1; this.sesVar = true; this.olcum.motor = r.motor;
      kayitli.set(r.id, this);
      for (const m of this.bekleyen) void cagir('ses:konus-ekle', r.id, m).catch(() => undefined);
      this.bekleyen = [];
      if (this.metinBitti) void cagir('ses:konus-bitir', r.id).catch(() => undefined);
    }, () => { this.sesVar = false; this.sonla('yok'); });
  }

  ekle(metin: string): void {
    if (this.bitti || this.metinBitti || !metin) return;
    if (!this.ilkMetin) this.ilkMetin = performance.now();
    if (this.id) void cagir('ses:konus-ekle', this.id, metin).catch(() => undefined);
    else this.bekleyen.push(metin);
  }

  bitir(): void {
    if (this.bitti || this.metinBitti) return;
    this.metinBitti = true;
    if (!this.ilkMetin) this.ilkMetin = performance.now();
    if (this.id) void cagir('ses:konus-bitir', this.id).catch(() => undefined);
  }

  kes(): void {
    if (this.bitti) return;
    const t = performance.now();
    if (etkin === this) calar.kes();
    if (this.id) void cagir('ses:sustur', this.id).catch(() => undefined);
    this.olcum.kesilmeMs = Math.round(performance.now() - t);
    void cagir('kulak:devam').catch(() => undefined);
    this.sonla('kesildi');
  }

  /** Ana süreçten gelen akış olayı. */
  olay(o: AkisOlayi): void {
    if (this.bitti) return;
    if (o.tur === 'uyari') { this.satirSoyle?.(o.mesaj); return; }
    if (o.tur === 'hata' && o.satir) this.satirSoyle?.(o.satir);
    if (o.tur === 'ses') {
      if (this.bicim === 'mp3') {
        // Fuber hesabının sesi: cümlenin MP3'ü çözülür, sıra çalarda korunur; kesildiyse (bitti) hiçbir şey yapılmaz.
        void calar.besleKodlu(o.pcm, this.hiz).then((cikis) => { if (cikis !== null && !this.bitti) this.sesCikti(cikis); });
        return;
      }
      this.sesCikti(calar.besle(o.pcm, this.hz));
    } else if (o.tur === 'bitti' || o.tur === 'hata') {
      const s: KonusmaSonucu = o.tur === 'bitti' ? 'bitti' : o.yok ? 'yok' : 'hata';
      calar.bitince(() => this.sonla(s));
    }
  }

  /** Bir ses parçası sıraya girdi (`cikis`: hoparlöre çıkacağı an): ilk sesin ölçümü ve kulağın beklemesi. */
  private sesCikti(cikis: number): void {
    if (!this.ilkSes) {
      this.ilkSes = true;
      const ms = Math.max(0, cikis - this.ilkMetin);
      this.olcum.ilkCalmaMs = Math.round(ms);
      this.olcum.ilkCalmaZaman = Math.round(Date.now() + (cikis - performance.now()));
      setTimeout(() => this.basladiCoz(), Math.max(0, cikis - performance.now()));
      void cagir('ses:olcum', { id: this.id, ilkCalmaMs: ms, kaynak: this.kaynak }).catch(() => undefined);
    }
    // Kulak kendi sesimizi duymasın (yarım saniyede bir uzatılır).
    const simdi = performance.now();
    if (simdi - this.sonBekle > 500) { this.sonBekle = simdi; void cagir('kulak:bekle', Math.ceil(calar.kalanMs()) + 800).catch(() => undefined); }
  }

  private sonla(s: KonusmaSonucu): void {
    if (this.bitti) return;
    this.bitti = true;
    this.olcum.sonuc = s;
    if (this.id) kayitli.delete(this.id);
    if (etkin === this) etkin = null;
    this.sonucCoz(s);
  }

  /** Açılış (ana süreç cevabı) beklenir: testler ve "Dinle" düğmesi için. */
  get hazir(): Promise<void> { return this.acilis; }
}

/** Yeni konuşma; pencerede çalan konuşma varsa susar. `kip`: turun kilitli kipi ya da kurulumda seçilen kip ("Dinle"); boşsa şu anki kip.
 *  `satirSoyle` (0.13; sessiz düşüş yok): ses çalışmıyorsa ya da karakterin sesi yerine başka ses çalıyorsa kullanıcıya gösterilecek tek satır. */
export function fuberKonus(kaynak: KonusmaKaynagi, kip?: KipKimligi, satirSoyle?: (m: string) => void): FuberKonusmasi {
  olaylariDinle();
  etkin?.kes();
  const k = new Konusma(kaynak, kip, satirSoyle);
  etkin = k;
  return k;
}

/** Bir metni baştan sona söyler (bildirim, eşlikçi, "Dinle"). */
export function fuberSoyle(metin: string, kaynak: KonusmaKaynagi = 'bildirim', kip?: KipKimligi): FuberKonusmasi {
  const k = fuberKonus(kaynak, kip);
  k.ekle(metin);
  k.bitir();
  return k;
}

/** Pencerede çalan konuşmayı susturur (varsa). */
export function fuberSustur(): void { etkin?.kes(); }
export const fuberKonusuyorMu = () => calar.caliyor;
