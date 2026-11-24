/**
 * Gizli ses penceresi (KURGU §5.2): mikrofon, yankı engelleme ve oynatma tek sayfada yaşar.
 * Denetim ana süreçten `audio.command` olayıyla gelir, durum `audio.report` ile döner;
 * ses örnekleri ses işçisiyle doğrudan MessagePort üzerinden akar.
 *
 * Pencere hiç gösterilmez; sayfadaki iskelet bilgisi yalnız köprünün çalıştığını sınamak içindir
 * (`scripts/e2e/smoke.mjs` her girişte onu arar).
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { PORT_NAMES, type AudioCommand, type AudioReport } from '@fuber/shared';
import '../app.css';
import { SurfaceInfo } from '../shared/SurfaceInfo';
import type { PortToWindow, PortToWorker } from '../../worker/protocol';
import { Capture, type CaptureSnapshot } from './capture';
import { Playback } from './playback';
import { SystemCapture, type SystemSnapshot } from './system-capture';

/** `playback.stop` (IPC) ile işçinin `flush` iletisi arasında yolda kalmış eski ses bu süre boyunca atılır. */
const STALE_AUDIO_WINDOW_MS = 300;

declare global {
  interface Window {
    /**
     * Tanı yüzeyi: Ayarlar › Tanı ve uçtan uca sınamalar ses penceresinin gerçek durumunu buradan okur.
     * `setLoopback(kazanç, gecikme)`: çalınan sesi mikrofon yoluna karıştırır (yankı benzetimi; 0 kapatır). Yalnız sınamada.
     */
    fuberAudio?: {
      snapshot(): AudioSnapshot;
      /** `shape: 'bluetooth'`: doğrusal olmayan, gecikmesi kayan hoparlör (yankı gidericinin yakınsayamadığı cihaz). */
      setLoopback(gain: number, delayMs?: number, cancelledBy?: 'all' | null, shape?: 'linear' | 'bluetooth'): void;
      /** Yankı gidericinin referansını keser / geri bağlar (gidericinin işe yaramadığı cihazın benzetimi). Yalnız sınamada. */
      setReference(on: boolean): void;
      track(): MediaStreamTrack | null;
      /**
       * Toplantı kipi, yalnız sınamada: PCM'i (16 kHz mono) "bilgisayarın sesi" diye çalar; dönen değer süre (ms).
       * Gerçek kipte (Windows loopback) hiçbir şey yapmaz.
       */
      playSystem(samples: number[], sampleRate?: number): number;
      /** Gerçek kipteki bilgisayar sesi izi (sınama: kopmanın benzetimi). */
      systemTrack(): MediaStreamTrack | null;
      /** Yalnız sınamada: "bilgisayarın sesi"ni `gain` kazancıyla mikrofon yoluna karıştırır (hoparlör sızıntısı); 0 kapatır. */
      mixSystemIntoMic(gain: number, delayMs?: number): boolean;
    };
  }
}

export interface AudioSnapshot {
  portAttached: boolean;
  capture: CaptureSnapshot;
  system: SystemSnapshot;
  playback: { playing: boolean; streams: string[]; contextState: string | null };
}

let port: MessagePort | null = null;
let dropAudioUntil = 0;
let lastFlushAt = 0;

const report = (payload: AudioReport): void => {
  void window.fuber.invoke('audio.report', payload).catch(() => {
    // Ana süreç kapanıyor olabilir; rapor kaybı zararsızdır.
  });
};

const toWorker = (message: PortToWorker): void => port?.postMessage(message);

const capture = new Capture((pcm, echo) => toWorker(echo ? { type: 'frame', pcm, echo } : { type: 'frame', pcm }), report);
const playback = new Playback(report, (rms, peak) => toWorker({ type: 'level', rms, peak }));
// Yankı gidericinin referansı: Jarvis'in çaldığı ses (kısma dahil), mikrofonla aynı işleyiciye ikinci giriş olarak gider.
capture.setReference(playback.tap());
// Toplantı kipi: bilgisayarın sesi ayrı akış olarak işçiye gider (mikrofonun çerçevelerine karışmaz).
const system = new SystemCapture((pcm) => toWorker({ type: 'system_frame', pcm }), report);

function onPortMessage(message: PortToWindow): void {
  switch (message.type) {
    case 'pcm':
      if (performance.now() < dropAudioUntil) return;
      playback.enqueue(message.streamId, message.sampleRate, message.pcm);
      break;
    case 'end':
      // Bitiş iletisi ATILMAZ: eski akışın bitişi zararsızdır (bilinmeyen akış "0 ms çalındı" diye kapanır), ama
      // durdurmadan hemen sonra açılan yeni akışın sesi bu pencerede atıldıysa bitişi de atılırsa oturum o akışın
      // bitişini hiç duymaz ve "konuşuyor"da kalırdı (demo.5).
      playback.end(message.streamId);
      break;
    case 'flush':
      playback.stop();
      dropAudioUntil = 0;
      lastFlushAt = performance.now();
      break;
    case 'earcon':
      playback.earcon(message.kind);
      break;
  }
}

function onCommand(command: AudioCommand): void {
  switch (command.type) {
    case 'capture.start':
      void capture.start(command.deviceId, false, command.echoMode);
      break;
    case 'capture.stop':
      capture.stop();
      break;
    case 'playback.stop':
      playback.stop();
      // İşçinin `flush` iletisi bu komuttan önce vardıysa yolda eski ses kalmamıştır.
      if (performance.now() - lastFlushAt > STALE_AUDIO_WINDOW_MS) {
        dropAudioUntil = performance.now() + STALE_AUDIO_WINDOW_MS;
      }
      break;
    case 'playback.pcm':
      // Gerçek zamanlı motor sesi: işçi portundan değil, doğrudan ana süreçten gelir (hazır PCM).
      if (command.pcm.length > 0) playback.enqueue(command.streamId, command.sampleRate, command.pcm);
      if (command.end) playback.end(command.streamId);
      break;
    case 'output.set':
      playback.setOutput(command.deviceId);
      break;
    case 'playback.duck':
      playback.duck(command.gain, command.rampMs);
      break;
    case 'echo.config':
      capture.setEchoGate(command.gate);
      break;
    case 'system.start':
      void system.start(command.fake === true);
      break;
    case 'system.stop':
      system.stop();
      break;
  }
}

window.addEventListener('message', (event: MessageEvent<{ fuberPort?: string }>) => {
  const next = event.ports[0];
  if (event.data?.fuberPort !== PORT_NAMES.audio || !next) return;
  // İşçi yeniden başladıysa yeni port eskisinin yerini alır.
  port?.close();
  port = next;
  dropAudioUntil = 0;
  next.onmessage = (message: MessageEvent<PortToWindow>) => onPortMessage(message.data);
  report({ type: 'ready' });
});

window.fuber.on('audio.command', onCommand);

window.fuberAudio = {
  snapshot: () => ({ portAttached: port !== null, capture: capture.snapshot(), system: system.snapshot(), playback: playback.snapshot() }),
  setLoopback: (gain, delayMs = 0, cancelledBy = null, shape = 'linear') => capture.setLoopback(gain > 0 ? playback.tap() : null, gain, delayMs, cancelledBy, shape),
  setReference: (on) => capture.setReferenceEnabled(on),
  track: () => capture.debugTrack(),
  playSystem: (samples, sampleRate) => system.play(samples, sampleRate),
  systemTrack: () => system.debugTrack(),
  mixSystemIntoMic(gain, delayMs = 0) {
    const stream = system.fakeStream();
    if (gain > 0 && !stream) return false;
    capture.setLoopback(gain > 0 ? stream : null, gain, delayMs);
    return true;
  },
};

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <SurfaceInfo surface="ses" />
    </StrictMode>,
  );
}
