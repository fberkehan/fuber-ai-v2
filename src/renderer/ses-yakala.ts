// ── Konuşma yakalama: ses seviyesi + sessizlikle bitiş (VAD) + yazıya çevirme akışı ─────────────────────────────────────────────
// Kulak (uyandırmadan sonra), ada (elle dinleme) ve sohbetin dikte düğmesi aynı yardımcıları kullanır. Konuşma 0,7 sn sessizlikte
// biter (Görev 21: eskiden 1,1 sn; kural shared/konusma-sonu.ts); 6 sn içinde hiç konuşma olmazsa "boş" (uyanmayla açılan dinlemede 3 sn); en uzun 20 sn.
// Yazıya çevirme (Görev 21, K9): ses konuşma SÜRERKEN 16 kHz PCM parçaları hâlinde ana sürece akar ('ses:dinleme-parca'): ElevenLabs
// Scribe gerçek zamanlı (ara metin canlı gelir, kesin metin konuşma biter bitmez) ya da Whisper (bitince tek seferde). Ana süreç
// 'yok' derse (0.13: hesap yok / Whisper kurulu değil) oturum açılmaz ve çağıran tek satır söyler (dikteYokSatiri); Vosk'a dönülmez.
import { cagir, dinle } from './api.ts';
import { DIKTE_YOK, type DikteSatiri } from '../shared/dikte-yolu.ts';
import { Ornekleyici } from '../shared/pcm.ts';
import { vadAdim, vadBaslat, SESSIZLIK_MS, UYANMA_BOS_MS } from '../shared/konusma-sonu.ts';
import type { YaziyaMotoru } from '../shared/tipler.ts';

export interface YakalamaSonucu { ses: Blob | null; konustu: boolean }

export function seviyeOlcer(baglam: AudioContext, kaynak: MediaStreamAudioSourceNode): () => number {
  const analiz = baglam.createAnalyser();
  analiz.fftSize = 1024;
  kaynak.connect(analiz);
  const tampon = new Float32Array(analiz.fftSize);
  return () => {
    analiz.getFloatTimeDomainData(tampon);
    let t = 0;
    for (let i = 0; i < tampon.length; i++) t += tampon[i] * tampon[i];
    return Math.sqrt(t / tampon.length);
  };
}

/** Konuşmanın sonunu bekler (VAD). `kaydet`: MediaRecorder ile webm de kaydeder (eski yol; yalnız yedek). */
export function konusmaYakala(
  akis: MediaStream,
  seviye: () => number,
  o: { kaydet: boolean; seviyeBildir?: (v: number) => void; durdurucu?: { durdur?: () => void }; sessizlikMs?: number; bosMs?: number; konusmaBasladi?: () => void },
): Promise<YakalamaSonucu> {
  return new Promise((coz) => {
    const kayit = o.kaydet ? new MediaRecorder(akis, { mimeType: 'audio/webm;codecs=opus' }) : null;
    const parcalar: Blob[] = [];
    if (kayit) { kayit.ondataavailable = (e) => e.data.size && parcalar.push(e.data); kayit.start(250); }
    const vad = vadBaslat(performance.now());
    let bitti = false;
    const bitir = () => {
      if (bitti) return;
      bitti = true;
      clearInterval(z);
      if (!kayit) { coz({ ses: null, konustu: vad.konustu }); return; }
      kayit.onstop = () => coz({ ses: vad.konustu ? new Blob(parcalar, { type: 'audio/webm' }) : null, konustu: vad.konustu });
      kayit.stop();
    };
    if (o.durdurucu) o.durdurucu.durdur = bitir;
    let basladi = false;
    const z = setInterval(() => {
      const v = seviye();
      o.seviyeBildir?.(v);
      const k = vadAdim(vad, v, performance.now(), o.sessizlikMs ?? SESSIZLIK_MS, o.bosMs);
      // İlk konuşma duyuldu (bitişle aynı adımda gelebilir): yanlış uyanma ses göndermesin diye çağıran bekletilen örnekleri şimdi bırakır.
      if (vad.konustu && !basladi) { basladi = true; o.konusmaBasladi?.(); }
      if (k !== 'surer') bitir();
    }, 60);
  });
}

export async function blobBase64(b: Blob): Promise<string> {
  const u = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
  return btoa(s);
}

// ── Yazıya çevirme oturumu ──
export interface DinlemeOturumu {
  motor: YaziyaMotoru;
  /** Mikrofon örnekleri (Float32, bağlamın hızında): 16 kHz PCM16'ya indirilir, ~100 ms'lik parçalarla ana sürece gider. */
  besle(ornekler: Float32Array, hz: number): void;
  /** Konuşma bitti: kesin metin (yoksa null). `uyari`: yazıya çevirme düştü (anahtar/bağlantı) — moda uygun tek satır (düzeltme 6). */
  bitir(): Promise<DinlemeSonucu>;
  iptal(): void;
}
export interface DinlemeSonucu { metin: string | null; uyari?: string }

/** Dikte yolu yok ve söz gerçekten istendi: kullanıcıya söylenecek tek satır (elle başlatılan diktede yerel kipte Whisper kurulumu başlar, boyut satırda; bulutta hiçbir şey
 *  inmez). `uyandirma`: söz "Hey Fuber"den geldi: yalnız tek satır, indirme başlamaz. Konuşma duyulmadıysa çağrılmaz. Ana süreç yanıt vermezse bile sessiz kalınmaz. */
export const dikteYokSatiri = (o?: { uyandirma?: boolean }): Promise<DikteSatiri> => cagir<DikteSatiri>('ses:dikte-yok', o).catch(() => ({ satir: DIKTE_YOK }));
/** "Yeniden dene" (İş kipi, düşmüş yerel kurulum): kurulum bir kez daha başlar, yeni satır döner. */
export const dikteYeniden = (): Promise<DikteSatiri> => cagir<DikteSatiri>('ses:dikte-yeniden').catch(() => ({ satir: DIKTE_YOK }));

/** Ana süreçte yazıya çevirme oturumu açar; yol yoksa ('yok') null döner: çağıran `dikteYokSatiri`ni söyler (Vosk'a dönülmez). `kismi`: canlı ara metin. */
export async function dinlemeAc(kismi?: (metin: string) => void): Promise<DinlemeOturumu | null> {
  const r = await cagir<{ id: string; motor: YaziyaMotoru }>('ses:dinleme-baslat');
  if (r.motor === 'yok') return null;
  const kapat = kismi ? dinle('ses:dinleme', (v: { id: string; tur: string; metin?: string }) => { if (v.id === r.id && v.tur === 'kismi' && v.metin) kismi(v.metin); }) : () => undefined;
  let bekleyen: Uint8Array[] = [];
  let boy = 0;
  let bitti = false;
  /** Oturum boyunca TEK örnekleyici: süzgeç ve evre parçalar arasında sürer (shared/pcm.ts; düzeltme 7). */
  let ornekleyici: Ornekleyici | null = null;
  const gonder = () => {
    if (!boy) return;
    const p = new Uint8Array(boy);
    let o = 0;
    for (const x of bekleyen) { p.set(x, o); o += x.length; }
    bekleyen = []; boy = 0;
    void cagir('ses:dinleme-parca', r.id, p).catch(() => undefined);
  };
  return {
    motor: r.motor,
    besle(ornekler, hz) {
      if (bitti) return;
      if (!ornekleyici || ornekleyici.girisHz !== hz) ornekleyici = new Ornekleyici(hz, 16000);
      const p = ornekleyici.donustur(ornekler);
      bekleyen.push(p); boy += p.length;
      if (boy >= 3200) gonder(); // ≈ 100 ms
    },
    async bitir() {
      if (bitti) return { metin: null };
      bitti = true;
      gonder();
      try {
        const s = await cagir<DinlemeSonucu | null>('ses:dinleme-bitir', r.id);
        return { metin: s?.metin ?? null, ...(s?.uyari ? { uyari: s.uyari } : {}) };
      } finally { kapat(); }
    },
    iptal() { if (bitti) return; bitti = true; kapat(); void cagir('ses:dinleme-iptal', r.id).catch(() => undefined); },
  };
}

/** Mikrofon akışından örnek akıtır (kendi AudioContext'i olan pencereler: ada, sohbet). Durdurma işlevi döner. */
export function ornekAkit(baglam: AudioContext, kaynak: MediaStreamAudioSourceNode, f: (o: Float32Array, hz: number) => void): () => void {
  const islem = baglam.createScriptProcessor(2048, 1, 1);
  islem.onaudioprocess = (e) => f(new Float32Array(e.inputBuffer.getChannelData(0)), baglam.sampleRate);
  const sessiz = baglam.createGain();
  sessiz.gain.value = 0;
  kaynak.connect(islem);
  islem.connect(sessiz);
  sessiz.connect(baglam.destination);
  return () => { try { islem.disconnect(); sessiz.disconnect(); kaynak.disconnect(islem); } catch { /* bağlı değil */ } islem.onaudioprocess = null; };
}

/** Kulağın soru dinlemesi: uyanmayla açıldıysa konuşma gelmezse 3 sn'de biter (yanlış uyanma çabuk söner), elle açıldıysa varsayılan süre. */
export function soruBekle(akis: MediaStream, seviye: () => number, uyandirmayla: boolean, seviyeBildir: (v: number) => void, konusmaBasladi?: () => void): Promise<YakalamaSonucu> {
  return konusmaYakala(akis, seviye, { kaydet: false, seviyeBildir, konusmaBasladi, ...(uyandirmayla ? { bosMs: UYANMA_BOS_MS } : {}) });
}
