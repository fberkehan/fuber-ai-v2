// ── Yerel Whisper (whisper.cpp) — ücretsiz, çevrimdışı, Türkçe + İngilizce yazıya dökme ─────────────────────────
// Kullanıcı Ayarlar'da "İndir ve kur"a basınca ya da (0.13 T10) Gizli / "Yalnız bu bilgisayar" kipinde ilk dikte isteğinde (boyut satırda söylenir;
// bulut kipinde otomatik indirme yok): whisper.cpp'nin RESMİ Windows derlemesi (sürüm SABİT: v1.9.2;
// NVIDIA varsa CUDA, yoksa OpenBLAS/işlemci) + seçilen GGML modeli (Hugging Face, ggerganov/whisper.cpp) indirilir,
// SHA-256 doğrulanır (GitHub varlık özeti / Hugging Face LFS özeti). Sunucu yalnız 127.0.0.1'de dinler; ses bu
// bilgisayardan çıkmaz ve diske yazılmaz (bellekten HTTP gövdesi olarak gider).
// Test: FUBER_WHISPER_TABAN verilirse süreç başlatılmaz, o adres (sahte sunucu) kullanılır; FUBER_WHISPER_DIZINI kurulum klasörü.
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { app } from 'electron';
import { ayarlar } from '../ayarlar.js';
import { zipAc, akisaYaz } from '../indirme.js';
import { nvidiaVarMi } from '../gpu.js';
import type { WhisperModeli } from '../../shared/tipler.js';
import { whisperIndirmeMB } from '../../shared/dikte-yolu.js';
import { asciiYol } from './ascii-yol.js';
import { ASCII_DISI, WHISPER_CUDA_SURUMU, WhisperHatasi, etkinWhisperModeli, gecikmeOrtalamasi, sunucuDonanimi, sunucuGunlukOzeti } from '../../shared/whisper-tani.js';

const SURUM = 'v1.9.2';
const MODEL_DOSYASI: Record<WhisperModeli, string> = {
  'large-v3-turbo-q5_0': 'ggml-large-v3-turbo-q5_0.bin',
  'large-v3-q5_0': 'ggml-large-v3-q5_0.bin',
  'small-q5_1': 'ggml-small-q5_1.bin',
};
// FUBER_WHISPER_DIZINI: testte gerçek Whisper'ın kurulacağı/okunacağı klasör (varsayılan userData/whisper).
const kok = () => process.env.FUBER_WHISPER_DIZINI || path.join(app.getPath('userData'), 'whisper');
const durumDosyasi = () => path.join(kok(), 'kurulum.json');

interface Kurulum {
  surum: string; derleme: 'cuda' | 'cpu'; sunucu: string; modeller: Partial<Record<WhisperModeli, string>>;
  /** NVIDIA arşivinin CUDA sürümü (0.18.2: 12.4.0; eski 11.8 arşivi cublas içermiyordu → GPU hiç çalışmıyordu, eski kurulum geçersiz sayılır). */
  cudaSurum?: string;
  /** NVIDIA arşivi kuruldu ama sunucu "no GPU found" dedi (sürücü eski ya da kart desteklenmiyor): işlemci derlemesi + hızlı model kurulur. */
  gpuCalismadi?: boolean;
}
export interface IndirmeDurumu { yuzde: number; adim: string; hata?: string }

let surec: ChildProcess | null = null;
let taban: string | null = process.env.FUBER_WHISPER_TABAN ?? null;
let calisanModel: WhisperModeli | null = null;
let indirme: IndirmeDurumu | undefined;
let bildir: () => void = () => undefined;
/** Tanı (arayüzün "Ayrıntılar" satırı ve toplantı çipi): sunucunun gerçek donanımı, son hata (sırsız), gecikme ortalaması, süreç çıkışları. */
const tani: { donanim: 'cuda' | 'cpu' | null; sonHata: string; gecikmeMs: number | null; istek: number; hata: number; cikis: number; baslatma: number } = { donanim: null, sonHata: '', gecikmeMs: null, istek: 0, hata: 0, cikis: 0, baslatma: 0 };
let baslatiyor: Promise<string | null> | null = null;
export const whisperBildirici = (f: () => void) => { bildir = f; };

function kurulum(): Kurulum | null {
  try { return JSON.parse(fs.readFileSync(durumDosyasi(), 'utf8')) as Kurulum; } catch { return null; }
}

/** Kurulu çalıştırıcı kullanılabilir mi: NVIDIA arşivi yalnız CUDA 12.4 ise ve GPU gerçekten çalışıyorsa geçerli (11.8 arşivi cublas'sız: sessizce işlemciye düşüyordu). */
const calistiriciGecerli = (k: Kurulum | null): boolean => Boolean(k?.sunucu && fs.existsSync(k.sunucu) && (k.derleme !== 'cuda' || (k.cudaSurum === WHISPER_CUDA_SURUMU && !k.gpuCalismadi)));
/** Bu kurulumda çalışacak model (işlemci derlemesinde büyük model hızlı modele iner; shared/whisper-tani.ts). */
const etkinModel = (k: Kurulum | null): WhisperModeli => etkinWhisperModeli(ayarlar().gunKaydi.whisperModel, k?.derleme);

export function whisperDurumu(): { kurulu: boolean; calisiyor: boolean; model?: string; gpu?: boolean; indirme?: IndirmeDurumu } {
  if (process.env.FUBER_WHISPER_TABAN) return { kurulu: true, calisiyor: true, model: 'test', gpu: false, indirme };
  const k = kurulum();
  const m = etkinModel(k);
  const kurulu = calistiriciGecerli(k) && Boolean(k?.modeller[m] && fs.existsSync(k.modeller[m]!));
  return { kurulu, calisiyor: Boolean(surec && taban), model: calisanModel ?? (kurulu ? m : undefined), gpu: k?.derleme === 'cuda', indirme };
}

export const whisperHazirMi = () => Boolean(process.env.FUBER_WHISPER_TABAN) || whisperDurumu().kurulu;

const bosPort = () => new Promise<number>((coz, red) => {
  const s = net.createServer();
  s.once('error', red);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => coz(p)); });
});

/** Sunucuyu (gerekirse) başlatır; taban adresini döner. TEK SEFERDE bir başlatma: eşzamanlı çağrılar aynı işe katılır (0.18.2: toplantı açılışındaki `whisperBaslat` ile ilk
 *  istek yarışıp birbirinin sürecini öldürüyordu; ikisi de 60 sn bekleyip null dönüyordu). Başlatılamazsa null döner; neden `whisperTani().sonHata`da. */
export function whisperBaslat(): Promise<string | null> {
  if (process.env.FUBER_WHISPER_TABAN) return Promise.resolve(process.env.FUBER_WHISPER_TABAN);
  baslatiyor ??= whisperBaslatIs().finally(() => { baslatiyor = null; });
  return baslatiyor;
}
async function whisperBaslatIs(): Promise<string | null> {
  const k = kurulum();
  const m = etkinModel(k);
  const modelYolu = k?.modeller[m];
  if (!k || !modelYolu || !calistiriciGecerli(k) || !fs.existsSync(modelYolu)) { tani.sonHata = 'model ya da çalıştırıcı yok'; return null; }
  if (surec && taban && calisanModel === m) return taban;
  whisperDurdur();
  tani.baslatma++;
  tani.donanim = null;
  const port = await bosPort();
  const arg = ['-m', asciiYol(modelYolu), '--host', '127.0.0.1', '--port', String(port), '-l', 'auto', '-t', String(Math.max(2, Math.min(8, Math.floor(os.cpus().length / 2))))];
  if (ayarlar().gunKaydi.whisperGpu === 'cpu') arg.push('-ng');
  let log = '';
  let p: ChildProcess;
  try { p = spawn(k.sunucu, arg, { cwd: path.dirname(k.sunucu), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { tani.sonHata = `başlatılamadı: ${(e as Error).message}`.slice(0, 160); return null; }
  surec = p;
  calisanModel = m;
  // Çıktıyı OKU (okunmazsa boru dolar, sunucu asılır) ve yalnız son ~16 KB'ı tut: gerçek donanım ve hata buradan okunur.
  const topla = (d: Buffer) => { log = (log + d.toString('utf8')).slice(-16_384); const don = sunucuDonanimi(log); if (don) tani.donanim = don; };
  p.stdout?.on('data', topla);
  p.stderr?.on('data', topla);
  // 'error' dinleyicisi yoksa (ENOENT, EPERM — antivirüs) işlenmemiş olay ana süreci düşürürdü.
  p.on('error', (e) => { tani.sonHata = `süreç hatası: ${e.message}`.slice(0, 160); if (surec === p) { surec = null; taban = null; calisanModel = null; bildir(); } });
  p.on('exit', (kod) => {
    if (surec === p) { tani.cikis++; const oz = sunucuGunlukOzeti(log); tani.sonHata = `süreç kapandı (kod ${kod ?? '?'})${oz ? `: ${oz}` : ''}${ASCII_DISI.test(modelYolu) && ASCII_DISI.test(asciiYol(modelYolu)) ? ' · model yolunda ASCII dışı harf var' : ''}`.slice(0, 200); surec = null; taban = null; calisanModel = null; bildir(); }
  });
  const adres = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 120; i++) { // model yüklenene dek (büyük modelde ~5-20 sn; işlemcide daha uzun)
    try {
      const r = await fetch(adres, { signal: AbortSignal.timeout(1500) });
      if (r.ok) {
        if (surec !== p) return null;
        // NVIDIA arşivi ama GPU bulunamadı: sessizce işlemcide yavaş çalışmak yerine kurulum geçersiz sayılır (işlemci derlemesi + hızlı model kurulur).
        if (k.derleme === 'cuda' && tani.donanim === 'cpu') {
          tani.sonHata = 'ekran kartı bulunamadı (no GPU found); NVIDIA sürümü işlemciye düştü';
          try { fs.writeFileSync(durumDosyasi(), JSON.stringify({ ...k, gpuCalismadi: true }, null, 2)); } catch { /* yazılamadı: sonraki açılışta yine denenir */ }
          whisperDurdur();
          bildir();
          return null;
        }
        taban = adres; bildir(); return adres;
      }
    } catch { /* henüz değil */ }
    if (surec !== p) return null;
    await new Promise((r) => setTimeout(r, 500));
  }
  const oz = sunucuGunlukOzeti(log);
  tani.sonHata = `sunucu 60 sn içinde hazır olmadı${oz ? `: ${oz}` : ''}`.slice(0, 200);
  whisperDurdur();
  return null;
}

export function whisperDurdur(): void {
  if (surec) { try { surec.kill(); } catch { /* kapalı */ } }
  surec = null; taban = process.env.FUBER_WHISPER_TABAN ?? null; calisanModel = null;
}

/** Dikte için kurulum görünümü (0.13 T10; main/ses.ts → ses/merkez.ts): kurulu mu, seçili model, bu oturumdaki indirme. */
export function whisperKurulumu(): { kurulu: boolean; indirme?: IndirmeDurumu } {
  return { kurulu: whisperHazirMi(), ...(indirme ? { indirme } : {}) };
}

/** Çalıştırıcı CUDA mı? whisperKur ve boyut hesabı AYNI kararı verir (ayar + NVIDIA yoklaması), satırdaki toplam çalışacak yolla uyuşur. */
const cudaMu = async (): Promise<boolean> => {
  const g = ayarlar().gunKaydi;
  // GPU daha önce "no GPU found" dedi: otomatik yolda işlemci derlemesi (kullanıcı ayarı 'cuda' derse yeniden denenir).
  return g.whisperGpu === 'cuda' || (g.whisperGpu === 'otomatik' && !kurulum()?.gpuCalismadi && (await nvidiaVarMi()));
};

/** Şimdi kurulsa inecek GERÇEK toplam (MB): eksik çalıştırıcı arşivi (NVIDIA'da CUDA) + eksik model (shared/dikte-yolu.ts whisperIndirmeMB). */
export async function whisperIndirmeBoyutu(): Promise<number> {
  const cuda = await cudaMu();
  const model = etkinWhisperModeli(ayarlar().gunKaydi.whisperModel, cuda ? 'cuda' : 'cpu');
  const k = kurulum();
  const calistiriciVar = Boolean(k && k.surum === SURUM && k.derleme === (cuda ? 'cuda' : 'cpu') && calistiriciGecerli(k));
  const modelVar = Boolean(k?.modeller[model] && fs.existsSync(k.modeller[model]!));
  return whisperIndirmeMB({ model, cuda, calistiriciVar, modelVar });
}

/** 16 kHz mono WAV → metin. Sözlük ipucu (özel adlar) "prompt" olarak gider; boş döküm/halüsinasyon süzülür. `dil`: verilirse o dil (dikte: ayardaki
 *  dil; kısa konuşmada dili yanlış sezip yanlış metin üretmesin), verilmezse otomatik (gün kaydı: karışık dil). `zamanAsimiMs` (toplantı: kısa; varsayılan 60 sn).
 *  Hata WhisperHatasi'dır (neden: model-yok | baslamadi | gpu-yok | zaman-asimi | cokme); boş metin null'dır. */
export async function whisperCevir(wav: Buffer, ipucu: string, dil?: string, o: { zamanAsimiMs?: number; /** Başlatılamazsa null yerine WhisperHatasi (toplantı: neden çipte görünsün). */ firlat?: boolean } = {}): Promise<string | null> {
  const zamanAsimiMs = o.zamanAsimiMs ?? 60_000;
  const t = taban ?? (await whisperBaslat());
  if (!t && !o.firlat) return null;
  if (!t) {
    const k = kurulum();
    const kurulu = calistiriciGecerli(k) && Boolean(k?.modeller[etkinModel(k)] && fs.existsSync(k!.modeller[etkinModel(k)]!));
    throw new WhisperHatasi(!kurulu ? (k?.gpuCalismadi ? 'gpu-yok' : 'model-yok') : 'baslamadi', tani.sonHata);
  }
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'ses.wav');
  form.append('temperature', '0.0');
  form.append('temperature_inc', '0.2');
  form.append('response_format', 'json');
  form.append('language', dil && /^[a-z]{2,3}$/.test(dil) ? dil : 'auto');
  if (ipucu) form.append('prompt', ipucu.slice(0, 600));
  const bas = Date.now();
  tani.istek++;
  try {
    const r = await fetch(`${t}/inference`, { method: 'POST', body: form, signal: AbortSignal.timeout(zamanAsimiMs) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = (await r.json()) as { text?: string };
    tani.gecikmeMs = gecikmeOrtalamasi(tani.gecikmeMs, Date.now() - bas);
    return halusinasyonuSuz(String(j.text ?? ''));
  } catch (e) {
    tani.hata++;
    const zaman = (e as Error)?.name === 'TimeoutError' || (e as Error)?.name === 'AbortError';
    // Süreç ortada kapandıysa (çökme) bir sonraki istek yeniden başlatır; bu istek nedenini söyler.
    const neden = zaman ? 'zaman-asimi' : surec ? 'bilinmeyen' : 'cokme';
    tani.sonHata = zaman ? `istek ${Math.round(zamanAsimiMs / 1000)} sn içinde dönmedi` : String((e as Error).message).slice(0, 160);
    throw new WhisperHatasi(neden, tani.sonHata);
  }
}

/** Tanı görünümü (toplantı "Ayrıntılar"ı): sırsız, kısa. `donanim`: sunucunun gerçek bulduğu ('cuda' | 'cpu' | null). */
export function whisperTani(): { kurulu: boolean; calisiyor: boolean; model?: string; derleme?: 'cuda' | 'cpu'; donanim: 'cuda' | 'cpu' | null; gecikmeMs: number | null; istek: number; hata: number; cikis: number; sonHata: string } {
  const d = whisperDurumu();
  const k = kurulum();
  return { kurulu: d.kurulu, calisiyor: d.calisiyor, ...(d.model ? { model: d.model } : {}), ...(k?.derleme ? { derleme: k.derleme } : {}), donanim: tani.donanim, gecikmeMs: tani.gecikmeMs, istek: tani.istek, hata: tani.hata, cikis: tani.cikis, sonHata: tani.sonHata };
}

// Whisper sessiz/gürültülü parçada bilinen kalıp cümleleri uydurur ("Altyazı M.K.", "İzlediğiniz için teşekkürler").
const KALIP = /(alt ?yaz[ıi]|izledi[gğ]iniz i[cç]in te[sş]ekk|abone ol|thanks for watching|subtitles by|\[m[uü]zik\]|\[music\]|♪)/i;
export function halusinasyonuSuz(m: string): string | null {
  const t = m.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 2 || KALIP.test(t)) return null;
  if (/^[.,!?…\s-]+$/.test(t)) return null;
  return t;
}

// ── Kurulum (kullanıcı başlatır) ──
/** 0.14.1: yerel beyin kurulumuyla TEK akışta inerken (yerel/kurulum.ts) ilerleme oraya da yansır, durdurma sinyali buraya da gelir. */
let izleyici: ((d: IndirmeDurumu) => void) | null = null;
let kesici: AbortSignal | undefined;
const yay = () => { bildir(); if (indirme) izleyici?.(indirme); };
async function indir(url: string, hedef: string, adim: string, pay: [number, number], beklenenSha?: string): Promise<void> {
  const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Fuber-AI' }, ...(kesici ? { signal: kesici } : {}) });
  if (!r.ok || !r.body) throw new Error(`${adim}: HTTP ${r.status}`);
  const toplam = Number(r.headers.get('content-length') ?? 0);
  const gecici = `${hedef}.indiriliyor`;
  const yaz = fs.createWriteStream(gecici);
  const ozet = createHash('sha256');
  let gelen = 0, son = 0;
  const okuyucu = r.body.getReader();
  // Ortak yazıcı (indirme.ts → akisaYaz): disk dolunca 'drain' beklerken asılı kalmaz; hata olursa yarım dosya silinir.
  try {
    await akisaYaz(okuyucu, yaz, (value) => {
      ozet.update(value);
      gelen += value.length;
      if (toplam && Date.now() - son > 400) { son = Date.now(); indirme = { yuzde: Math.round(pay[0] + (pay[1] - pay[0]) * (gelen / toplam)), adim: `${adim} · ${(gelen / 1048576).toFixed(0)}/${(toplam / 1048576).toFixed(0)} MB` }; yay(); }
    });
  } catch (e) {
    void Promise.resolve(okuyucu.cancel()).catch(() => undefined);
    yaz.destroy();
    fs.rmSync(gecici, { force: true });
    throw (e as { code?: unknown })?.code === 'ENOSPC' ? new Error(`${adim}: Diskte yer kalmadı.`) : e;
  }
  const sha = ozet.digest('hex');
  if (beklenenSha && sha !== beklenenSha.toLowerCase()) { fs.rmSync(gecici, { force: true }); throw new Error(`${adim}: SHA-256 doğrulanamadı (dosya bozuk ya da değiştirilmiş)`); }
  fs.renameSync(gecici, hedef);
}

let sureni: Promise<void> | null = null;
export interface WhisperKurSecenegi {
  /** Bittiğinde sunucu açılsın mı (varsayılan evet; kurulum akışında hayır — ilk dikte açar). */
  baslat?: boolean;
  /** Hata çağırana da fırlatılsın (yerel beyin kurulumu: ilerleme kartı hatayı söyler). Varsayılan: yalnız durum. */
  firlat?: boolean;
  izle?: (d: IndirmeDurumu) => void;
  sinyal?: AbortSignal;
}
/** Kurulum: zaten sürüyorsa AYNI işe katılır (yeni indirme başlamaz). Yarıda kalırsa biten parça (çalıştırıcı) kalır, sonraki deneme kaldığı parçadan sürer. */
export function whisperKur(o: WhisperKurSecenegi = {}): Promise<void> {
  if (!sureni) sureni = whisperKurIs(o).finally(() => { sureni = null; izleyici = null; kesici = undefined; });
  else if (o.izle) izleyici = o.izle;
  return o.firlat ? sureni : sureni.catch(() => undefined);
}
async function whisperKurIs(o: WhisperKurSecenegi): Promise<void> {
  izleyici = o.izle ?? null;
  kesici = o.sinyal;
  const g = ayarlar().gunKaydi;
  try {
    fs.mkdirSync(kok(), { recursive: true });
    indirme = { yuzde: 0, adim: 'Hazırlanıyor' }; yay();
    const cuda = await cudaMu();
    const varlikAdi = cuda ? `whisper-cublas-${WHISPER_CUDA_SURUMU}-bin-x64.zip` : 'whisper-blas-bin-x64.zip';
    const model = etkinWhisperModeli(g.whisperModel, cuda ? 'cuda' : 'cpu');
    let k = kurulum();
    if (!k || k.surum !== SURUM || k.derleme !== (cuda ? 'cuda' : 'cpu') || !calistiriciGecerli(k)) {
      const rel = await (await fetch(`https://api.github.com/repos/ggml-org/whisper.cpp/releases/tags/${SURUM}`, { headers: { accept: 'application/vnd.github+json', 'user-agent': 'Fuber-AI' }, ...(kesici ? { signal: kesici } : {}) })).json() as { assets?: { name: string; browser_download_url: string; digest?: string }[] };
      const v = rel.assets?.find((a) => a.name === varlikAdi);
      if (!v) throw new Error(`whisper.cpp ${SURUM} içinde ${varlikAdi} bulunamadı`);
      const zip = path.join(kok(), varlikAdi);
      await indir(v.browser_download_url, zip, `whisper.cpp ${cuda ? '(NVIDIA CUDA)' : '(işlemci)'}`, [0, cuda ? 30 : 4], v.digest?.replace(/^sha256:/, ''));
      indirme = { yuzde: cuda ? 31 : 5, adim: 'Arşiv açılıyor' }; yay();
      const klasor = path.join(kok(), `${SURUM}-${cuda ? 'cuda' : 'cpu'}`);
      fs.rmSync(klasor, { recursive: true, force: true });
      fs.mkdirSync(klasor, { recursive: true });
      await zipAc(zip, klasor); // Windows bsdtar (PATH'teki GNU tar zip açamaz)
      fs.rmSync(zip, { force: true });
      const bul = (d: string): string | null => {
        for (const x of fs.readdirSync(d, { withFileTypes: true })) {
          const y = path.join(d, x.name);
          if (x.isDirectory()) { const z = bul(y); if (z) return z; } else if (/^(whisper-server|server)\.exe$/i.test(x.name)) return y;
        }
        return null;
      };
      const sunucu = bul(klasor);
      if (!sunucu) throw new Error('Arşivde whisper-server.exe yok');
      k = { surum: SURUM, derleme: cuda ? 'cuda' : 'cpu', sunucu, modeller: k?.modeller ?? {}, ...(cuda ? { cudaSurum: WHISPER_CUDA_SURUMU } : {}), ...(k?.gpuCalismadi && !cuda ? { gpuCalismadi: true } : {}) };
      fs.writeFileSync(durumDosyasi(), JSON.stringify(k, null, 2));
    }
    const dosya = MODEL_DOSYASI[model];
    const modelYolu = path.join(kok(), dosya);
    if (!k.modeller[model] || !fs.existsSync(modelYolu)) {
      const url = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${dosya}`;
      const bas = await fetch(url, { method: 'HEAD', redirect: 'manual', headers: { 'user-agent': 'Fuber-AI' }, ...(kesici ? { signal: kesici } : {}) });
      const sha = (bas.headers.get('x-linked-etag') ?? '').replace(/"/g, '');
      await indir(url, modelYolu, `Model (${model})`, [cuda ? 32 : 6, 99], /^[0-9a-f]{64}$/i.test(sha) ? sha : undefined);
      k.modeller[model] = modelYolu;
      fs.writeFileSync(durumDosyasi(), JSON.stringify(k, null, 2));
    }
    if (o.baslat !== false) {
      indirme = { yuzde: 99, adim: 'Başlatılıyor' }; yay();
      if (!(await whisperBaslat())) throw new Error('whisper-server başlatılamadı');
    }
    indirme = { yuzde: 100, adim: 'Hazır' }; yay();
    setTimeout(() => { if (indirme?.yuzde === 100) { indirme = undefined; bildir(); } }, 8000);
  } catch (e) {
    // Durdurma hata değildir: durum temizlenir (dikte "kurulamadı" demez); sonraki istek baştan değil kaldığı parçadan sürer.
    if (o.sinyal?.aborted || (e as Error)?.name === 'AbortError') { indirme = undefined; bildir(); throw e; }
    indirme = { yuzde: indirme?.yuzde ?? 0, adim: 'Kurulum durdu', hata: (e as Error).message }; yay();
    throw e;
  }
}

export function whisperKaldir(): void {
  whisperDurdur();
  fs.rmSync(kok(), { recursive: true, force: true });
  indirme = undefined;
  bildir();
}
