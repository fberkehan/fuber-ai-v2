// ── PCM / WAV yardımcıları (Görev 21): yedek sesin WAV'ı ham PCM'e, telefon önizlemesinin PCM'i WAV'a ───────────────────────────
// Saf (birim testli: tests/ses-akis.test.ts).

/** RIFF/WAVE dosyasından "data" bölümünü ve biçimi çıkarır (16 bit PCM bekler). Uygun değilse null. */
export function wavdanPcm(wav: Uint8Array): { pcm: Uint8Array; hz: number; kanal: number } | null {
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const dize = (o: number) => String.fromCharCode(wav[o], wav[o + 1], wav[o + 2], wav[o + 3]);
  if (wav.length < 44 || dize(0) !== 'RIFF' || dize(8) !== 'WAVE') return null;
  let o = 12, hz = 0, kanal = 1, bit = 16;
  while (o + 8 <= wav.length) {
    const ad = dize(o), boy = v.getUint32(o + 4, true);
    if (ad === 'fmt ') { kanal = v.getUint16(o + 10, true); hz = v.getUint32(o + 12, true); bit = v.getUint16(o + 22, true); }
    else if (ad === 'data') {
      if (bit !== 16 || !hz) return null;
      const son = Math.min(wav.length, o + 8 + boy);
      return { pcm: wav.subarray(o + 8, son - ((son - o - 8) % 2)), hz, kanal };
    }
    o += 8 + boy + (boy % 2);
  }
  return null;
}

/** Ham PCM16 (tek kanal) → WAV. */
export function pcmdenWav(pcm: Uint8Array, hz: number): Uint8Array {
  const out = new Uint8Array(44 + pcm.length);
  const v = new DataView(out.buffer);
  const yaz = (o: number, s: string) => { for (let i = 0; i < s.length; i++) out[o + i] = s.charCodeAt(i); };
  yaz(0, 'RIFF'); v.setUint32(4, 36 + pcm.length, true); yaz(8, 'WAVE'); yaz(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, hz, true);
  v.setUint32(28, hz * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); yaz(36, 'data'); v.setUint32(40, pcm.length, true);
  out.set(pcm, 44);
  return out;
}

/**
 * Akış örnekleyicisi (mikrofon → yazıya çevirme, 16 kHz PCM16 LE; düzeltme 7). Eskiden her ~40 ms'lik parça ayrı ayrı ve süzgeçsiz
 * doğrusal ara değerlemeyle indiriliyordu: parça sınırında evre (konum) sıfırlanıyor, 8 kHz üstü (ıslıklı sesler, gürültü) 16 kHz'e
 * katlanıp (aliasing) tanımayı bozuyordu. Şimdi:
 *  - İndirmeden önce alçak geçiren süzgeç (Blackman pencereli sinc, 97 katsayı; kesim = çıkışın Nyquist'inin %90'ı).
 *  - Durum parçalar arasında korunur (süzgeç geçmişi + kesirli konum): parça parça vermek, tek seferde vermekle aynı sonucu verir.
 * Yükseltmede süzgeç yok (yalnız ara değerleme); aynı hızda yalnız biçim dönüşümü.
 */
export class Ornekleyici {
  readonly girisHz: number;
  readonly cikisHz: number;
  private readonly oran: number;
  private readonly katsayi: Float32Array | null;
  private gecmis: Float32Array;
  private kalan = new Float32Array(0);
  private konum = 0;

  constructor(girisHz: number, cikisHz = 16000) {
    this.girisHz = girisHz;
    this.cikisHz = cikisHz;
    this.oran = girisHz / cikisHz;
    this.katsayi = this.oran > 1 ? alcakGecir(0.45 / this.oran, 97) : null;
    this.gecmis = new Float32Array(this.katsayi ? this.katsayi.length - 1 : 0);
  }

  donustur(o: Float32Array): Uint8Array {
    const y = this.suz(o);
    const tampon = new Float32Array(this.kalan.length + y.length);
    tampon.set(this.kalan); tampon.set(y, this.kalan.length);
    const out: number[] = [];
    if (this.oran === 1) {
      for (const s of tampon) out.push(s);
      this.kalan = new Float32Array(0);
    } else {
      let k = this.konum;
      while (Math.floor(k) + 1 < tampon.length) {
        const a = Math.floor(k), t = k - a;
        out.push(tampon[a] * (1 - t) + tampon[a + 1] * t);
        k += this.oran;
      }
      const bas = Math.min(Math.floor(k), tampon.length);
      this.kalan = tampon.slice(bas);
      this.konum = k - bas;
    }
    const pcm = new Int16Array(out.length);
    for (let i = 0; i < out.length; i++) pcm[i] = Math.max(-32768, Math.min(32767, Math.round(out[i] * 32767)));
    return new Uint8Array(pcm.buffer);
  }

  private suz(o: Float32Array): Float32Array {
    const h = this.katsayi;
    if (!h) return o;
    const n = h.length, g = this.gecmis;
    const x = new Float32Array(g.length + o.length);
    x.set(g); x.set(o, g.length);
    const y = new Float32Array(o.length);
    for (let i = 0; i < o.length; i++) {
      let s = 0;
      const son = i + n - 1; // x'teki bu çıkışın en yeni örneği
      for (let k = 0; k < n; k++) s += h[k] * x[son - k];
      y[i] = s;
    }
    this.gecmis = x.slice(x.length - (n - 1));
    return y;
  }
}

/** Blackman pencereli sinc alçak geçiren süzgeç; `fc`: kesim (giriş örnekleme hızına göre, devir/örnek), toplamı 1. */
function alcakGecir(fc: number, n: number): Float32Array {
  const h = new Float32Array(n);
  const m = (n - 1) / 2;
  let toplam = 0;
  for (let k = 0; k < n; k++) {
    const x = k - m;
    const sinc = x === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * x) / (Math.PI * x);
    const w = 0.42 - 0.5 * Math.cos((2 * Math.PI * k) / (n - 1)) + 0.08 * Math.cos((4 * Math.PI * k) / (n - 1));
    h[k] = sinc * w;
    toplam += h[k];
  }
  for (let k = 0; k < n; k++) h[k] /= toplam;
  return h;
}

/** Tek seferlik dönüşüm (tam kayıt): Float32 (−1…1) → `hedef` Hz PCM16 LE. Akışta Ornekleyici kullanılır (durum korunur). */
export function pcm16Yap(ornekler: Float32Array, kaynakHz: number, hedefHz = 16000): Uint8Array {
  return new Ornekleyici(kaynakHz, hedefHz).donustur(ornekler);
}

/** PCM parçalarını birleştirir. */
export function birlestir(parcalar: Uint8Array[]): Uint8Array {
  const n = parcalar.reduce((t, p) => t + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parcalar) { out.set(p, o); o += p.length; }
  return out;
}
