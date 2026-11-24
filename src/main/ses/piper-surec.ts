// ── Yedek ses süreci: Piper (tr_TR-dfki-medium), sürekli açık (Görev 21: yerel beyinden bağımsız) ──────────────────────────────
// --json-input ile model bir kez yüklenir; her satır bir cümle → WAV dosyası (geçici klasöre yazılır, okunur, silinir). Ölçüm (19 Eki
// 2026): ilk cümle ~0,4 sn, sonra ~0,12 sn; işlemcide. Electron'a bağımlı değil (yollar ve süreç başlatıcı dışarıdan): main/yerel/piper.ts.
import { spawn as nodeSpawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { wavdanPcm } from '../../shared/pcm.ts';

export interface PiperYollari { calistirici: string; ses: string }
export type Baslatici = (komut: string, argumanlar: string[], o: { cwd: string }) => ChildProcessWithoutNullStreams;

const varsayilanBaslatici: Baslatici = (k, a, o) => nodeSpawn(k, a, { cwd: o.cwd, windowsHide: true });

export class PiperSureci {
  private surec: ChildProcessWithoutNullStreams | null = null;
  private tampon = '';
  private bekleyen: ((satir: string | null) => void)[] = [];
  private sira: Promise<unknown> = Promise.resolve();
  private sayac = 0;
  private hiz = 1;
  private readonly yollar: () => PiperYollari | null;
  private readonly baslat: Baslatici;

  constructor(yollar: () => PiperYollari | null, baslat: Baslatici = varsayilanBaslatici) { this.yollar = yollar; this.baslat = baslat; }

  private ac(hiz: number): ChildProcessWithoutNullStreams {
    if (this.surec && !this.surec.killed && this.hiz === hiz) return this.surec;
    this.kapat();
    const y = this.yollar();
    if (!y) throw new Error('Yedek ses kurulu değil.');
    const arg = ['--model', y.ses, '--json-input', '--quiet'];
    if (Math.abs(hiz - 1) > 0.01) arg.push('--length_scale', (1 / hiz).toFixed(3));
    const p = this.baslat(y.calistirici, arg, { cwd: path.dirname(y.calistirici) });
    this.surec = p;
    this.hiz = hiz;
    p.stdout.setEncoding('utf8');
    p.stdout.on('data', (d: string) => {
      this.tampon += d;
      let i: number;
      while ((i = this.tampon.indexOf('\n')) >= 0) {
        const satir = this.tampon.slice(0, i).trim();
        this.tampon = this.tampon.slice(i + 1);
        if (satir) this.bekleyen.shift()?.(satir);
      }
    });
    p.on('error', () => { if (this.surec === p) { this.surec = null; while (this.bekleyen.length) this.bekleyen.shift()?.(null); } });
    p.on('exit', () => {
      if (this.surec !== p) return;
      this.surec = null;
      while (this.bekleyen.length) this.bekleyen.shift()?.(null);
    });
    return p;
  }

  /** Metni WAV'a çevirir (cümleler sırayla işlenir). */
  wav(metin: string, hiz = 1, sinyal?: AbortSignal): Promise<Uint8Array> {
    const is = this.sira.then(async () => {
      if (sinyal?.aborted) throw Object.assign(new Error('Kesildi'), { name: 'AbortError' });
      const p = this.ac(hiz);
      const klasor = path.join(os.tmpdir(), 'fuber-piper');
      fs.mkdirSync(klasor, { recursive: true });
      const yol = path.join(klasor, `${process.pid}-${++this.sayac}.wav`);
      const bitti = new Promise<string | null>((coz) => {
        const z = setTimeout(() => { const i = this.bekleyen.indexOf(sar); if (i >= 0) { this.bekleyen.splice(i, 1); coz(null); } }, 20_000);
        const sar = (s: string | null) => { clearTimeout(z); coz(s); };
        this.bekleyen.push(sar);
      });
      p.stdin.write(`${JSON.stringify({ text: metin.replace(/\s+/g, ' ').trim(), output_file: yol })}\n`);
      const cikti = await bitti;
      try {
        if (!cikti || !fs.existsSync(yol)) throw new Error('Yedek ses üretemedi.');
        return new Uint8Array(fs.readFileSync(yol));
      } finally { fs.rmSync(yol, { force: true }); }
    });
    this.sira = is.catch(() => undefined);
    return is;
  }

  /** Konuşma oturumunun üreticisi: cümle → tek PCM parçası (22,05 kHz). */
  async *pcm(metin: string, hiz: number, sinyal?: AbortSignal): AsyncGenerator<Uint8Array> {
    const w = wavdanPcm(await this.wav(metin, hiz, sinyal));
    if (!w) throw new Error('Yedek sesin çıktısı okunamadı.');
    if (sinyal?.aborted) throw Object.assign(new Error('Kesildi'), { name: 'AbortError' });
    yield w.pcm;
  }

  kapat(): ChildProcessWithoutNullStreams | null {
    const p = this.surec;
    this.surec = null;
    try { p?.kill(); } catch { /* kapalı */ }
    while (this.bekleyen.length) this.bekleyen.shift()?.(null);
    return p;
  }
}
