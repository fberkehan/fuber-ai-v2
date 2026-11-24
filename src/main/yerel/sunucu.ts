// ── Yerel beyin sunucusu: llama-server yalnız 127.0.0.1'de, rastgele boş portta ─────────────────────────────────
// Açıkken sıcak tutulur (ilk yanıt ~0,5 sn; soğuk açılış 27B'de ~5 sn). Çökerse bir sonraki istekte yeniden açılır
// (10 dakikada en çok 3 kez; döngüye girmesin). Düşünme kapalı (--reasoning-budget 0): hızlı, kısa yanıt.
// 0.13 G: katalogdan inen dosya llama-server'a verilmeden önce ilk 4 baytı GGUF olmalı; değilse silinir, hata açık (sahte ya da bozulmuş dosya başlatılmaz) ve neden, model yeniden kurulana ya
// da başka model seçilene dek kalır. Çalışan süreç modeli bellekte tutar: yeni dosya üstüne yazılsa da eski modelle yanıt vermeyi sürdürür (1 Kas ölçümü, işlemci yapısı), bu yüzden dosya yerine
// konmadan kapanır (modelDosyasiBirakilsin), ipc.ts yerel:kur ardından yeniden açar.
// Test: FUBER_YEREL_TABAN verilirse süreç başlatılmaz, o adres (sahte sunucu) kullanılır.
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { ayarlar } from '../ayarlar.js';
import { ggufBasligi } from '../indirme.js';
import { modelDegisimKancasi, modelDosyasiniSil, yerelYollar } from './kurulum.js';
import { sureciKapat } from './kaldirma.js';
import { YEREL_BAGLAM_TOPLAM, YEREL_YUVA_SAYISI } from '../../shared/yerel-butce.js';

let surec: ChildProcess | null = null;
let taban: string | null = null;
let aciliyor: Promise<string | null> | null = null;
let sonHata = '';
/** Sürecin açık tuttuğu model dosyası. */
let calisanModel: string | null = null;
/** GGUF başlığı yüzünden silinen modelin kimliği. */
let silinenModel: string | null = null;
const GGUF_SILINDI = 'Yerel model açılmadı: dosya model dosyası değil (GGUF başlığı yok), silindi. Yeniden indirmen gerekiyor.';
const baslatmalar: number[] = [];
let bildir: () => void = () => undefined;
export const yerelSunucuBildirici = (f: () => void) => { bildir = f; };

const bosPort = () => new Promise<number>((coz, red) => {
  const s = net.createServer();
  s.once('error', red);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => coz(p)); });
});

export function yerelSunucuDurumu(): { calisiyor: boolean; aciliyor: boolean; hata?: string; taban?: string } {
  if (process.env.FUBER_YEREL_TABAN) return { calisiyor: true, aciliyor: false, taban: process.env.FUBER_YEREL_TABAN };
  return { calisiyor: Boolean(surec && taban), aciliyor: Boolean(aciliyor), hata: sonHata || undefined, taban: taban ?? undefined };
}

/** Sunucu adresi; gerekirse açar. Açılamazsa null. */
export function yerelTaban(): Promise<string | null> {
  if (process.env.FUBER_YEREL_TABAN) return Promise.resolve(process.env.FUBER_YEREL_TABAN);
  if (surec && taban) return Promise.resolve(taban);
  aciliyor ??= ac().finally(() => { aciliyor = null; bildir(); });
  bildir();
  return aciliyor;
}

async function ac(): Promise<string | null> {
  const y = yerelYollar();
  const secili = ayarlar().yerel.model;
  if (!y.sunucu || !y.model) { sonHata = silinenModel === secili ? GGUF_SILINDI : 'Yerel model kurulu değil.'; return null; }
  silinenModel = null;
  if (ggufBasligi(y.model) === false) {
    modelDosyasiniSil(y.model);
    silinenModel = secili;
    sonHata = GGUF_SILINDI;
    return null;
  }
  const simdi = Date.now();
  while (baslatmalar.length && simdi - baslatmalar[0] > 10 * 60_000) baslatmalar.shift();
  if (baslatmalar.length >= 3) { sonHata = 'Yerel sunucu 10 dakikada 3 kez kapandı; Ayarlar → Gizlilik → Yeniden başlat.'; return null; }
  baslatmalar.push(simdi);
  const port = await bosPort();
  // Port beklenirken "Kaldır" başlamış olabilir (yerelYollar o sırada "kurulu değil" döner): silinen klasördeki .exe açılmasın.
  const y2 = yerelYollar();
  if (!y2.sunucu || !y2.model) { sonHata = 'Yerel model kurulu değil.'; return null; }
  const gpu = y2.cuda && ayarlar().yerel.gpu !== 'cpu';
  const arg = ['-m', y2.model, '--host', '127.0.0.1', '--port', String(port), '-ngl', gpu ? '99' : '0', '-c', String(YEREL_BAGLAM_TOPLAM), '-np', String(YEREL_YUVA_SAYISI),
    '--jinja', '--reasoning-budget', '0', '--no-webui'];
  const p = spawn(y2.sunucu, arg, { cwd: path.dirname(y2.sunucu), windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  let hataMetni = '';
  p.stderr?.on('data', (d: Buffer) => { hataMetni = (hataMetni + d.toString()).slice(-4000); });
  surec = p;
  calisanModel = y2.model;
  p.on('exit', (kod) => {
    if (surec !== p) return;
    surec = null; taban = null;
    sonHata = `Yerel sunucu kapandı (kod ${kod}). ${hataMetni.split('\n').filter((s) => /error|failed|out of memory/i.test(s)).slice(-2).join(' ')}`.trim();
    bildir();
  });
  const adres = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 400; i++) { // en çok ~120 sn (ilk açılışta model diskten okunur)
    if (surec !== p) return null;
    try {
      const r = await fetch(`${adres}/health`, { signal: AbortSignal.timeout(1000) });
      if (r.ok && ((await r.json()) as { status?: string }).status === 'ok') { taban = adres; sonHata = ''; return adres; }
    } catch { /* yükleniyor */ }
    await new Promise((c) => setTimeout(c, 300));
  }
  yerelDurdur();
  sonHata = 'Yerel sunucu 2 dakikada hazır olmadı.';
  return null;
}

export function yerelDurdur(): void {
  const p = surec;
  surec = null; taban = null;
  try { p?.kill(); } catch { /* zaten kapalı */ }
  bildir();
}

/** Sunucuyu kapatır ve sürecin ÇIKIŞINI bekler (yerel beyin kaldırılırken: çalışan llama-server.exe silinemez). */
export async function yerelDurdurBekle(): Promise<void> {
  const p = surec;
  surec = null; taban = null;
  bildir();
  await sureciKapat(p);
}

/** Bu dosyayla çalışan sunucuyu kapatır, çıkışını bekler (yeni dosya yerine konmadan). Sonraki istek yeni dosyayla açar; arayüz "indi" derken eski model yanıt vermez. */
export async function modelDosyasiBirakilsin(yol: string): Promise<void> {
  if (surec && calisanModel === yol) await yerelDurdurBekle();
}
modelDegisimKancasi(modelDosyasiBirakilsin);

/** Ayar değişince (model, GPU) ya da "Yeniden başlat"la. `ac`: ardından açılsın mı (Görev 21, K10: yerel beyin yalnız tek motorken —
 *  Gizli mod ya da bulutsuz kurulum — sıcak tutulur; main.ts karar verir). */
export function yerelYenidenBaslat(ac: boolean = ayarlar().yerel.etkin): void {
  baslatmalar.length = 0;
  yerelDurdur();
  if (ac) void yerelTaban();
}
