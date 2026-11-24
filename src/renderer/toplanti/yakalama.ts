// ── Toplantı modu: ses yakalama (12 Kas 2026) ──────────────────────────────────────────────────────────────────────────────────────────────
// İki akış AYRI yakalanır, konuşan etiketi akıştan gelir:
//  · "Karşı taraf" = bilgisayarın sesi: getDisplayMedia (ana süreç Windows loopback verir: main/toplanti.ts toplantiEkranSesiKur); görüntü izi hemen durur.
//  · "Siz" = mikrofon: getUserMedia (yankı giderme açık).
// Her akış → MediaStreamSource → AudioWorklet (yakalama-islemci.js; 2048'lik bloklar) → bağlantı noktası işçiye devredilir (yakalama-isci.ts: 16 kHz + VAD).
// Ses çıkışı YOK: bağlam çıkış aygıtsız açılır (sinkId 'none'); desteklenmezse çıkış sıfır kazançtan geçer. Durdur: izler kapanır, işçi süren konuşmaları
// son parçalarıyla bitirir ("kapandı"), bağlam kapanır, işçi sonlanır. Önizlemede (FUBER_DEMO) bilgisayarın sesi yerine Chromium'un sahte aygıtı kullanılır.
import type { KesiciOlayi } from '../../shared/toplanti-vad';
import type { Konusan } from '../../shared/toplanti';
import type { HamKaynakHatasi } from '../../shared/toplanti-kaynak';
// İşlemci ayrı dosya olarak yayımlanır (veri adresine gömülmez: CSP script-src 'self' veri adresinden AudioWorklet modülünü yüklemez).
import islemciAdresi from './yakalama-islemci.js?worker&url';

export type YakalamaOlayi = KesiciOlayi & { konusan: Konusan };
export type KaynakHali = 'acik' | 'yok' | 'kesildi';
export interface Yakalama {
  kaynaklar: Record<Konusan, KaynakHali>;
  /** Açılamayan kaynağın GERÇEK hatası (ad + ileti; yalnız günlük ve neden eşlemesi için — kullanıcıya gösterilmez). Açılınca silinir. */
  hatalar: Partial<Record<Konusan, HamKaynakHatasi>>;
  /** Süren konuşmalar son parçalarıyla kapanır; bitince (ya da en çok 2 sn sonra) çözülür. */
  durdur(): Promise<void>;
  /** Kesilen kaynağı yeniden açar (bilgisayarın sesi: çıkış aygıtı değişti, paylaşım düştü; mikrofon: çıkarıldı). Açılamazsa false. */
  yenile(k: Konusan): Promise<boolean>;
  /** YALNIZ önizleme denemesi: kaynağı kes (izler durur, "ended" gelir); `engel`: sonraki bu kadar yenileme başarısız olur. */
  kaynagiKes(k: Konusan, engel?: number): void;
}
export interface YakalamaSecenekleri {
  olay(o: YakalamaOlayi): void;
  /** Bir kaynak kendiliğinden bitti (kullanıcı paylaşımı kapattı, mikrofon çıkarıldı). */
  kaynakBitti(k: Konusan): void;
  /** Önizleme: bilgisayarın sesi yerine sahte aygıt; "Siz" aynı sesin gecikmeli kopyası (sıra sıra konuşur). */
  sahteSes?: boolean;
  /** Bir kaynak açılamadı (başlarken ya da yenilerken): ham hata — denetçi ana sürecin günlüğüne yazar. */
  kaynakHatasi?(k: Konusan, h: HamKaynakHatasi): void;
}

async function sistemSesi(sahte: boolean): Promise<MediaStream> {
  if (sahte) return navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const a = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: { width: 1, height: 1, frameRate: 1 } });
  // 12 Kas 0.17.2 ölçümü (Electron 44, Windows 11, gerçek loopback): görüntü izini durdurmak ses izini ÖLDÜRMEZ (ses izi 'live' kalır, enerji akar). Yine de görüntü
  // izi akıştan çıkarılır; ses izinin kendiliğinden bitmesi (çıkış aygıtı değişti) denetçide yenilenir.
  for (const t of a.getVideoTracks()) { t.stop(); a.removeTrack(t); }
  if (!a.getAudioTracks().length) { for (const t of a.getTracks()) t.stop(); throw Object.assign(new Error('Paylaşımda ses izi yok'), { name: 'NoAudioTrack' }); }
  return a;
}
const hamHata = (e: unknown): HamKaynakHatasi => ({ ad: String((e as Error)?.name ?? 'Error'), ileti: String((e as Error)?.message ?? e).slice(0, 300) });
const mikrofonAl = (): Promise<MediaStream> => navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });

export async function yakalamaBaslat(o: YakalamaSecenekleri): Promise<Yakalama> {
  let baglam: AudioContext;
  try { baglam = new AudioContext({ sinkId: { type: 'none' } } as AudioContextOptions); } catch { baglam = new AudioContext(); }
  await baglam.audioWorklet.addModule(islemciAdresi);
  const isci = new Worker(new URL('./yakalama-isci.ts', import.meta.url), { type: 'module' });
  let bittiCoz: (() => void) | null = null;
  isci.onmessage = (e: MessageEvent<YakalamaOlayi | { tur: 'kapandi' }>) => {
    if (e.data.tur === 'kapandi') { bittiCoz?.(); return; } // işçinin kapanış iletisi (VAD'ın 'bitti' olayı ayrıdır: konusan taşır)
    o.olay(e.data as YakalamaOlayi);
  };
  const akislar: MediaStream[] = [];
  const dugumler: AudioWorkletNode[] = [];
  const guncel: Partial<Record<Konusan, { akis: MediaStream; dugum: AudioWorkletNode }>> = {};
  let yenilemeEngeli = 0;
  const sessiz = baglam.createGain();
  sessiz.gain.value = 0;
  sessiz.connect(baglam.destination);
  const kaynaklar: Record<Konusan, KaynakHali> = { karsi: 'yok', siz: 'yok' };
  const hatalar: Partial<Record<Konusan, HamKaynakHatasi>> = {};
  const hataYaz = (k: Konusan, e: unknown): null => {
    const h = hamHata(e);
    hatalar[k] = h;
    console.warn(`[toplantı] ${k === 'karsi' ? 'bilgisayarın sesi' : 'mikrofon'} açılamadı: ${h.ad}: ${h.ileti}`);
    try { o.kaynakHatasi?.(k, h); } catch { /* günlük en iyi çaba */ }
    return null;
  };

  const bagla = (konusan: Konusan, akis: MediaStream, gecikme = 0) => {
    akislar.push(akis);
    let kaynak: AudioNode = baglam.createMediaStreamSource(akis);
    if (gecikme > 0) { const d = baglam.createDelay(gecikme + 1); d.delayTime.value = gecikme; kaynak.connect(d); kaynak = d; }
    const dugum = new AudioWorkletNode(baglam, 'toplanti-yakalama', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' });
    kaynak.connect(dugum);
    dugum.connect(sessiz);
    dugumler.push(dugum);
    // Aynı konuşan için yenilemede eski düğüm bırakılır (kesilen kaynağın boş blokları işçiye akmasın).
    const eski = guncel[konusan]?.dugum;
    if (eski && eski !== dugum) { try { eski.port.postMessage({ tur: 'dur' }); } catch { /* devredildi */ } eski.disconnect(); }
    guncel[konusan] = { akis, dugum };
    try { isci.postMessage({ tur: 'baglan', konusan, port: dugum.port, hz: baglam.sampleRate }, [dugum.port]); }
    catch {
      // Bağlantı noktası devredilemedi: bloklar ana iş parçacığından aktarılır (yine kopyasız).
      dugum.port.onmessage = (e: MessageEvent<Float32Array>) => isci.postMessage({ tur: 'ornek', konusan, ornek: e.data, hz: baglam.sampleRate }, [e.data.buffer]);
    }
    kaynaklar[konusan] = 'acik';
    for (const t of akis.getAudioTracks()) t.addEventListener('ended', () => {
      // Yalnız GÜNCEL akışın bitişi sayılır (yenilenen kaynağın eski izi kapanırken uyarı çıkmaz).
      if (guncel[konusan]?.akis === akis && kaynaklar[konusan] === 'acik') { kaynaklar[konusan] = 'kesildi'; o.kaynakBitti(konusan); }
    });
  };

  try {
    // İki kaynak BİRBİRİNDEN bağımsız açılır: biri düşerse öbürüyle sürülür; her birinin gerçek hatası `hatalar`da (ve günlükte) kalır.
    const s = await sistemSesi(o.sahteSes === true).catch((e: unknown) => hataYaz('karsi', e));
    if (s) bagla('karsi', s);
    const m = o.sahteSes
      ? (s ? new MediaStream(s.getAudioTracks().map((t) => t.clone())) : null)
      : await mikrofonAl().catch((e: unknown) => hataYaz('siz', e));
    if (m) bagla('siz', m, o.sahteSes ? 1.9 : 0);
    await baglam.resume().catch(() => undefined);
  } catch (e) {
    for (const a of akislar) for (const t of a.getTracks()) t.stop();
    isci.terminate();
    void baglam.close().catch(() => undefined);
    throw e;
  }

  let durdu = false;
  return {
    kaynaklar,
    hatalar,
    async yenile(k) {
      if (durdu) return false;
      if (yenilemeEngeli > 0) { yenilemeEngeli--; hatalar[k] = { ad: 'NotReadableError', ileti: 'önizleme: yenileme engellendi' }; return false; }
      const s = k === 'karsi' ? await sistemSesi(o.sahteSes === true).catch((e: unknown) => hataYaz(k, e)) : await mikrofonAl().catch((e: unknown) => hataYaz(k, e));
      if (!s || durdu) { if (s) for (const t of s.getTracks()) t.stop(); return false; }
      const eskiAkis = guncel[k]?.akis;
      bagla(k, s, k === 'siz' && o.sahteSes ? 1.9 : 0);
      delete hatalar[k];
      if (eskiAkis) for (const t of eskiAkis.getTracks()) t.stop();
      await baglam.resume().catch(() => undefined);
      return true;
    },
    kaynagiKes(k, engel = 0) {
      yenilemeEngeli = engel;
      const g = guncel[k];
      if (!g) return;
      for (const t of g.akis.getAudioTracks()) { t.stop(); t.dispatchEvent(new Event('ended')); }
    },
    async durdur() {
      if (durdu) return;
      durdu = true;
      for (const a of akislar) for (const t of a.getTracks()) t.stop();
      for (const d of dugumler) { try { d.port.postMessage({ tur: 'dur' }); } catch { /* devredildi */ } d.disconnect(); }
      const bitti = new Promise<void>((c) => { bittiCoz = c; });
      isci.postMessage({ tur: 'bitir' });
      let saat: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([bitti, new Promise<void>((c) => { saat = setTimeout(c, 2000); })]);
      clearTimeout(saat);
      isci.terminate();
      await baglam.close().catch(() => undefined);
    },
  };
}
