// ── Video eki: bu bilgisayarda kare + konuşma yazısı (analiz 11 Kas bulgu 9) ─────────────────────────────────────────────────────────
// Hiçbir sağlayıcı yolu video taşımıyor. Video bu bilgisayarda işlenir, buluta video GİTMEZ:
//  1) Gizli, sesi kapalı, ekranda görünmeyen bir pencere (show:false, setAudioMuted; ayrı bellek içi oturum, fuber://video/) videoyu <video> ile açar; N (VIDEO_KARE_SAYISI) eşit aralıklı
//     kare canvas'tan JPEG olur (en çok 1024 px).
//  2) Yerel Whisper kuruluysa (gunkaydi/whisper.ts; 127.0.0.1) ses WebAudio ile 16 kHz mono PCM'e çözülür, 60 sn'lik parçalarla yazıya dökülür.
//     Kurulu değilse indirme BAŞLATILMAZ: ek metni nedenini söyler.
//  3) Kareler görsel, yazı metin eki olarak sohbete gider. Gizli / "Yalnız bu bilgisayar"da model görsel okumaz: dongu.ts kareleri göndermez ve
//     bunu söyler (yerelEkNotu) — model yalnız yazıyı alır. Bulut hiç kullanılmaz (Whisper yereldir).
// Sınırlar: 200 MB, 10 dk (shared/ek-kural.ts). İlerleme `ilerleme` geri çağrısıyla (ipc.ts 'ek:ilerleme'). Pencere her durumda kapanır.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { BrowserWindow, net, session } from 'electron';
import { ekSinifla, ekMetniKisalt, VIDEO_AZAMI_SN, VIDEO_KARE_SAYISI, EK_METIN_SINIRI, type MetinEki } from '../shared/ek-kural.js';
import { pcmWavParcalari, videoEkMetni } from '../shared/video-ek.js';
import { whisperHazirMi, whisperCevir } from './gunkaydi/whisper.js';
import { videoIsiEkle, videoIsiIptal, VideoIsiDurdu, type VideoIsHatasi } from './video-kuyruk.js';

export interface VideoIlerleme { adim: 'aciliyor' | 'kare' | 'ses' | 'yazi' | 'bitti'; yuzde: number; metin: string }
export type VideoSonucu = (MetinEki & { kareler: { medya: string; veri: string }[]; sureSn: number }) | { hata: string; iptal?: boolean };

/** Gizli pencerede çalışan kod (sayfa yalnız bu kodu çalıştırır; ağ yok, ses kapalı). Sonucu: süre, boyut, kareler (base64 JPEG), PCM (base64). */
const SAYFA_KODU = `(async (url, N, azamiSn, sesIste) => {
  const bildir = (x) => console.log('FUBER_VIDEO ' + JSON.stringify(x));
  const v = document.createElement('video');
  v.muted = true; v.preload = 'auto'; v.playsInline = true; v.src = url;
  await new Promise((ok, no) => {
    const z = setTimeout(() => no(new Error('Video 30 sn içinde açılamadı.')), 30000);
    v.onloadedmetadata = () => { clearTimeout(z); ok(); };
    v.onerror = () => { clearTimeout(z); no(new Error('Video çözülemedi (kodek desteklenmiyor olabilir).')); };
  });
  let sure = v.duration;
  if (!Number.isFinite(sure)) { // WebM bazen süreyi sonradan bildirir
    v.currentTime = 1e9;
    await new Promise((ok) => { v.onseeked = ok; setTimeout(ok, 5000); });
    sure = v.duration;
  }
  if (!Number.isFinite(sure) || sure <= 0) throw new Error('Videonun süresi okunamadı.');
  if (sure > azamiSn + 0.5) return { uzun: true, sure };
  const g = v.videoWidth || 0, y = v.videoHeight || 0;
  const kareler = [];
  if (g && y) {
    const k = Math.min(1, 1024 / Math.max(g, y));
    const c = document.createElement('canvas'); c.width = Math.round(g * k); c.height = Math.round(y * k);
    const ctx = c.getContext('2d');
    for (let i = 0; i < N; i++) {
      const t = Math.min(sure - 0.05, sure * (i + 0.5) / N);
      await new Promise((ok) => { v.onseeked = () => ok(); v.currentTime = Math.max(0, t); setTimeout(ok, 8000); });
      ctx.drawImage(v, 0, 0, c.width, c.height);
      kareler.push({ t, veri: c.toDataURL('image/jpeg', 0.82).split(',')[1] });
      bildir({ adim: 'kare', i: i + 1, n: N });
    }
  }
  let ses = null, sesHata = '', sesKesildi = 0;
  if (sesIste) {
    bildir({ adim: 'ses' });
    try {
      const veri = await (await fetch(url)).arrayBuffer();
      const cozulen = await new OfflineAudioContext(1, 16000, 16000).decodeAudioData(veri);
      // İnceleme I2: render en çok azamiSn (10 dk); daha uzun ses (başlıktaki süreden uzun olabilir) kesilir ve bildirilir.
      if (cozulen.duration > azamiSn + 1) sesKesildi = cozulen.duration;
      const n = Math.max(1, Math.ceil(Math.min(cozulen.duration, azamiSn) * 16000));
      const off = new OfflineAudioContext(1, n, 16000);
      const kaynak = off.createBufferSource(); kaynak.buffer = cozulen; kaynak.connect(off.destination); kaynak.start();
      const f = (await off.startRendering()).getChannelData(0);
      const i16 = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
      ses = await new Promise((ok) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(',')[1] || ''); r.readAsDataURL(new Blob([i16.buffer])); });
    } catch (e) { sesHata = 'Videoda ses yok ya da ses çözülemedi.'; }
  }
  return { sure, g, y, kareler, ses, sesHata, sesKesildi };
})`;

/** İnceleme I2: işin üst süresi (pencere, kareler, ses çözme ve yazıya dökme dahil); dolunca pencere yok edilir. */
export const VIDEO_TOPLAM_SURE_MS = 5 * 60_000;
const DURUS_METNI: Record<VideoIsHatasi, string> = {
  iptal: 'vazgeçildi.',
  zaman: `işlenmesi ${VIDEO_TOPLAM_SURE_MS / 60_000} dakikayı aştı; daha kısa bir video dene.`,
  coktu: 'işlenirken video çözücüsü çöktü (bellek ya da bozuk dosya).',
  yanitsiz: 'video çözücüsü yanıt vermedi.',
};

/** Çip kaldırıldı (ipc.ts 'ek:video-iptal'): sıradaysa başlamaz, çalışıyorsa gizli pencere kapanır. */
export const videoIptal = (kimlik: unknown): boolean => videoIsiIptal(kimlik);

/**
 * Videoyu bu bilgisayarda işler. `yol` preload'dan (gerçek seçilen/bırakılan dosya). İnceleme I2: işler SIRAYLA (ortak gizli oturumun fuber://
 * işleyicisi bir işten ötekine geçmez), üst süreli, iptal edilebilir; render çöküşü ya da yanıtsız pencere işi hemen bitirir; pencere her yolda kapanır.
 */
export async function videoHazirla(yol: unknown, ilerleme: (i: VideoIlerleme) => void = () => undefined, o: { kimlik?: string; sureMs?: number } = {}): Promise<VideoSonucu> {
  if (typeof yol !== 'string' || !path.isAbsolute(yol)) return { hata: 'Videonun yolu okunamadı; dosyayı yeniden seç.' };
  const ad = path.basename(yol);
  let st: fs.Stats;
  try { st = fs.statSync(yol); } catch { return { hata: `${ad} bulunamadı.` }; }
  const k = ekSinifla(ad, '', st.size);
  if ('hata' in k) return { hata: k.hata };
  if (k.tur !== 'video') return { hata: `${ad} video değil.` };
  const r = await videoIsiEkle(o.kimlik || randomUUID(), {
    sureMs: o.sureMs ?? VIDEO_TOPLAM_SURE_MS,
    sirada: () => ilerleme({ adim: 'aciliyor', yuzde: 1, metin: 'Sırada: önceki video işleniyor…' }),
    calistir: (b) => videoIsle(yol, ad, ilerleme, b),
  });
  if (r instanceof VideoIsiDurdu) return { hata: `${ad} ${DURUS_METNI[r.neden]}`, ...(r.neden === 'iptal' ? { iptal: true } : {}) };
  return r;
}

async function videoIsle(yol: string, ad: string, ilerleme: (i: VideoIlerleme) => void, b: { durdu: () => boolean; dus: (n: 'coktu' | 'yanitsiz') => void; temizlemeyeKaydet: (f: () => void) => void }): Promise<VideoSonucu> {
  const sesIste = whisperHazirMi();
  ilerleme({ adim: 'aciliyor', yuzde: 2, metin: 'Video açılıyor…' });
  // Pencere dosyaları file:// ile AÇMAZ (sigorta: grantFileProtocolExtraPrivileges kapalı). Bu işe ayrılmış bellek içi oturumda `fuber://video/`
  // yalnız iki şey verir: boş sayfa ve bu çağrının belirteciyle bu video (başka yol 404). Sayfa ve video aynı kökenden: kare canvas'a kirlenmeden
  // çizilir, web güvenliği AÇIK kalır. Ağ isteği yok (yalnız fuber: ve data:/blob:), gezinme ve yeni pencere kapalı, ses kapalı, pencere görünmez.
  // İşler sırayla çalıştığı için oturumun tek işleyicisi her an tek işe aittir.
  const belirtec = randomUUID();
  const oturum = session.fromPartition('fuber-video-isle');
  try { oturum.protocol.unhandle('fuber'); } catch { /* ilk kez */ }
  oturum.protocol.handle('fuber', (istek) => {
    const u = new URL(istek.url);
    if (u.host !== 'video') return new Response('yok', { status: 404 });
    if (u.pathname === '/sayfa.html') return new Response('<!doctype html><meta charset="utf-8"><title>Fuber video</title><body></body>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    if (u.pathname === `/${belirtec}`) return net.fetch(pathToFileURL(yol).toString(), { headers: istek.headers });
    return new Response('yok', { status: 404 });
  });
  oturum.webRequest.onBeforeRequest((d, cb) => cb({ cancel: !/^(fuber|data|blob|devtools):/i.test(d.url) }));
  const w = new BrowserWindow({
    show: false, width: 320, height: 240, skipTaskbar: true, focusable: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, session: oturum, spellcheck: false },
  });
  // Her yolda (bitti, hata, iptal, üst süre, çöküş) pencere yok edilir ve işleyici kalkar (video-kuyruk.ts temizlik).
  b.temizlemeyeKaydet(() => { kapatiyoruz = true; try { if (!w.isDestroyed()) w.destroy(); } catch { /* kapalı */ } try { oturum.protocol.unhandle('fuber'); } catch { /* kapalı */ } });
  let kapatiyoruz = false; // bilerek yok edilen pencerenin "gitti" olayı çöküş sayılmaz
  w.webContents.on('render-process-gone', () => { if (!kapatiyoruz) b.dus('coktu'); });
  w.on('unresponsive', () => { if (!kapatiyoruz) b.dus('yanitsiz'); });
  w.webContents.setAudioMuted(true);
  w.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  w.webContents.on('will-navigate', (e) => e.preventDefault());
  const N = VIDEO_KARE_SAYISI;
  w.webContents.on('console-message', (e: unknown) => {
    const m = String((e as { message?: string }).message ?? '');
    if (!m.startsWith('FUBER_VIDEO ')) return;
    try {
      const x = JSON.parse(m.slice(12)) as { adim: string; i?: number; n?: number };
      if (x.adim === 'kare') ilerleme({ adim: 'kare', yuzde: Math.round(5 + 45 * (x.i ?? 0) / (x.n ?? N)), metin: `Kareler çıkarılıyor (${x.i}/${x.n})…` });
      else if (x.adim === 'ses') ilerleme({ adim: 'ses', yuzde: 55, metin: 'Ses çözülüyor…' });
    } catch { /* yok say */ }
  });
  try {
    await w.loadURL('fuber://video/sayfa.html');
    const r = await w.webContents.executeJavaScript(`${SAYFA_KODU}(${JSON.stringify(`fuber://video/${belirtec}`)}, ${N}, ${VIDEO_AZAMI_SN}, ${sesIste})`, true) as
      { uzun?: boolean; sure: number; g?: number; y?: number; kareler?: { t: number; veri: string }[]; ses?: string | null; sesHata?: string; sesKesildi?: number };
    kapatiyoruz = true;
    try { if (!w.isDestroyed()) w.destroy(); } catch { /* kapalı */ } // kareler ve ses alındı: pencereye artık gerek yok (Whisper beklenirken açık kalmasın)
    if (r.uzun) return { hata: `${ad} çok uzun (${Math.round(r.sure / 60)} dk); video en çok ${VIDEO_AZAMI_SN / 60} dakika olabilir.` };
    const kareler = (r.kareler ?? []).filter((x) => x.veri);
    let yazi: { bas: number; metin: string }[] | null = null;
    let sesNotu: string | undefined;
    if (!sesIste) sesNotu = 'bu bilgisayarda yerel Whisper kurulu değil (Ayarlar → Ses); videonun sesi yazıya dökülmedi.';
    else if (!r.ses) sesNotu = r.sesHata || 'videoda ses bulunamadı.';
    else {
      // İnceleme I2: sesin uzunluğu da sınırlı — sayfada çözülen ses en çok VIDEO_AZAMI_SN'de kesilir, burada bir kez daha.
      const parcalar = pcmWavParcalari(Buffer.from(r.ses, 'base64'), { azamiSn: VIDEO_AZAMI_SN });
      yazi = [];
      for (const [i, p] of parcalar.entries()) {
        if (b.durdu()) break;
        ilerleme({ adim: 'yazi', yuzde: Math.round(60 + 38 * i / Math.max(1, parcalar.length)), metin: `Konuşma yazıya dökülüyor (${i + 1}/${parcalar.length})…` });
        try { const m = await whisperCevir(p.wav, ''); if (m) yazi.push({ bas: p.bas, metin: m }); } catch (e) { sesNotu = `yazıya dökme yarıda kaldı: ${String((e as Error)?.message ?? e).slice(0, 80)}`; break; }
      }
      if (r.sesKesildi) sesNotu = `ses ${Math.round(r.sesKesildi / 60)} dakika sürüyordu; yalnız ilk ${VIDEO_AZAMI_SN / 60} dakikası yazıya döküldü.`;
      if (!yazi.length) { yazi = null; sesNotu ??= 'videoda anlaşılır konuşma bulunamadı.'; }
    }
    if (!kareler.length && !yazi) return { hata: `${ad} işlenemedi: kare de ses de okunamadı.` };
    const metin = ekMetniKisalt(videoEkMetni({ ad, sureSn: r.sure, genislik: r.g, yukseklik: r.y, kareZamanlari: kareler.map((x) => x.t), yazi, sesNotu }), EK_METIN_SINIRI);
    ilerleme({ adim: 'bitti', yuzde: 100, metin: 'Video hazır.' });
    return { ad, tur: 'video', metin: metin.metin, ...(metin.kisaltildi ? { kisaltildi: true } : {}), kareSayisi: kareler.length, sureSn: r.sure, kareler: kareler.map((x) => ({ medya: 'image/jpeg', veri: x.veri })) };
  } catch (e) {
    if (b.durdu()) throw e; // üst süre / iptal / çöküş: kuyruk kendi metniyle bitirir
    return { hata: `${ad} işlenemedi: ${String((e as Error)?.message ?? e).replace(/^Error invoking remote method[^:]*:\s*/, '').slice(0, 160)}` };
  }
}
