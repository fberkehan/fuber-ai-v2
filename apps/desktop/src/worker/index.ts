/**
 * Ses işçisi girişi (`utilityProcess`; KURGU §5.2): sürekli VAD, anahtar sözcük sezici ve yerel TTS.
 * `dist/worker/index.js` olarak ayrı demetlenir; ana süreç `runtime.workerPath` ile başlatır.
 *
 * Ses penceresiyle doğrudan MessagePort üzerinden konuşur (mikrofon çerçeveleri gelir, çalınacak ses gider);
 * ana süreçle yalnız olay ve komut alışverişi yapar. Aynı süreçte tek ONNX çalışma zamanı vardır (sherpa).
 */

import type { MessagePortMain } from 'electron';
import sherpa from 'sherpa-onnx-node';
import { ElevenLabs } from './elevenlabs';
import { HostSynth } from './host-synth';
import { WakeSpotter } from './kws';
import { Piper } from './piper';
import type { EchoFrame, PortToWindow, PortToWorker, TtsHostInfo, TtsSettings, WorkerCommand, WorkerConfig, WorkerEvent } from './protocol';
import { Segmenter } from './segmenter';
import { TtsRouter, type SpeakOptions } from './tts-router';

/** Genlik olayı bu kadar çerçevede bir yollanır (2 × 20 ms → saniyede 25). */
const LEVEL_EVERY_FRAMES = 2;
/**
 * Sezicinin akışı, söz olmayan her 2 sn'de bir yenilenir ve son 400 ms yeniden beslenir. Ölçüm (17 Kas 2026):
 * dakikalarca sessizlik/oda gürültüsü dinlemiş akış, aynı sözü taze akışa göre daha seyrek yakalıyor (canlı hatta
 * "Hey Carvis" yarı yarıya kaçarken, aynı ses taze akışta 0,4 eşiğe kadar tetikleniyordu). Yeniden besleme,
 * yenilemenin sözün ilk hecesine denk gelmesi durumunda bağlamın kaybolmamasını sağlar.
 */
const KWS_REFRESH_FRAMES = 100;
const KWS_CONTEXT_FRAMES = 20;

const send = (event: WorkerEvent): void => process.parentPort.postMessage(event);
const log = (level: 'info' | 'warn' | 'error', message: string): void => send({ type: 'log', level, message });

let port: MessagePortMain | null = null;
let segmenter: Segmenter | null = null;
/** Toplantı kipi: bilgisayarın sesi ("Karşı taraf") için ikinci bölütleyici; mikrofonun durumuna hiç dokunmaz. */
let systemSegmenter: Segmenter | null = null;
let systemOn = false;
let spotter: WakeSpotter | null = null;
let piper: Piper | null = null;
let router: TtsRouter | null = null;
/** Ses konağının (ekran kartı motorları) ucu; konak hazır değilken `null`. */
let hostSynth: HostSynth | null = null;
let listening = false;
let wakeEnabled = false;
let frameCount = 0;
let levelSum = 0;
let levelPeak = 0;
let kwsQuietFrames = 0;
const kwsRecent: Float32Array[] = [];
/** `tts.cancel` her çağrıda artar; eski sıranın işleri kendini bununla tanıyıp ses yollamaz. */
let ttsEpoch = 0;
let ttsChain: Promise<void> = Promise.resolve();
const sentenceIndex = new Map<string, number>();

const toWindow = (message: PortToWindow): void => port?.postMessage(message);

/** Son çerçevelerin yankı özeti (söz başladığında "kullanıcı mı yankı mı" sorusu için). */
const ECHO_HISTORY = 13;
const echoRecent: EchoFrame[] = [];
let echoLast: EchoFrame | null = null;
let echoReportIn = 0;
/**
 * Süren sözün kimliği ve "kullanıcı konuşuyor" bildirimleri. Kesin kanıtla (`coarse: false`) bölüt başına bir kez
 * bildirilir. Kaba kanıtla (`coarse: true`) en çok `COARSE_NEAR_MAX` kez, her biri bir öncekinden sonraki TAM bir
 * pencereye (13 çerçeve) dayanarak: ilki oturumda sesi kısar, kısık seste gelen ikincisi susturur.
 */
let liveSegment: { id: number; nearSent: boolean; coarse: boolean; sent: number; framesSince: number; preMic: number | null; duckBlocked?: boolean } | null = null;

/** Son pencerenin (13 çerçeve) ortalama mikrofon gücü (yankı giderici girişindeki düzey). */
function micPower(): number {
  if (echoRecent.length === 0) return 0;
  return echoRecent.reduce((sum, frame) => sum + frame.mic * frame.mic, 0) / echoRecent.length;
}
/** Bu oranın üstü "kullanıcı konuşuyor" demektir (`main/voice/tuning.ts` › `nearSure` ile aynı). */
const NEAR_SURE = 0.6;
/**
 * Kaba kanıtın eşikleri: ilk bildirim (sesi kısar) `NEAR_COARSE_DUCK` (`tuning.ts` › `nearMaybe`), sonrakiler (kısık
 * seste susturur) `NEAR_COARSE_SURE` (`tuning.ts` › `nearCoarseSure`). Hece aralarında oran düşer: kesintisiz konuşan
 * kullanıcıda bile 260 ms'lik ortalama ~0,6'yı geçmez (benzetim: `echo-canceller.test.ts`); yalnız yankıda ≤ 0,08.
 * Pencerede en az `COARSE_MIN_ACTIVE` çerçeve yankı beklenmeli: cümle başında tek tük çerçeveyle karar verilmez.
 */
const NEAR_COARSE_DUCK = 0.25;
const NEAR_COARSE_SURE = 0.35;
// Üst sınır yalnız kaçak döngüye karşıdır: Bluetooth'ta yankı VAD'ı susturmadığı için bütün yanıt TEK bölüt olabilir.
const COARSE_NEAR_MAX = 200;
const COARSE_MIN_ACTIVE = 8;
const COARSE_MIN_MIC = 3e-4;
/** Bundan zayıf bastırmada (dB) gidericinin kanısı kesin sayılmaz, kaba kanıt kurallarıyla (kıs, sına) işlenir. */
const WEAK_ERLE_DB = 15;
const STRONG_ERLE_HOLD_FRAMES = 250;
/** Yankı özeti sayacı ve gidericinin son güçlü bastırma (yakınsamış, ≥ 15 dB) gösterdiği çerçeve. */
let echoFrames = 0;
let strongErleAt = Number.NEGATIVE_INFINITY;
/** Jarvis konuşmuyorken mikrofonun ortalama gücü (oda gürültüsü; `onEcho`). */
let idleMic = 1e-6;

/**
 * Son ~260 ms'de, Jarvis'in sesi mikrofona ulaşıyorken kullanıcı oranı. `null`: yankı beklenmiyor. `undefined`: ses
 * penceresi yankı özeti göndermiyor. Giderici henüz öğrenmediyse: Jarvis'in sesinin mikrofona ulaştığı (ilinti) ve
 * gecikmesi biliniyorsa kaba kapının oranı döner (`nearCoarse()` true); bilinmiyorsa ısınırken 0 (aday söz kesmez),
 * ısındı ve ilinti bulamadıysa (kulaklık: yankı yok) `null`.
 *
 * Önceden kaba kapının kararı burada atılıp 0 dönülüyordu: süzgeci hiç yakınsamayan cihazda (ölçülen bir Bluetooth
 * hoparlör: 0–3 dB, ilinti 0,93) kullanıcı ne kadar yüksek konuşursa konuşsun söz kesme olamıyordu.
 */
function nearNow(): number | null | undefined {
  if (!echoLast) return undefined;
  let sum = 0;
  let count = 0;
  for (const frame of echoRecent) {
    if (!frame.active) continue;
    sum += frame.near;
    count++;
  }
  if (count === 0) return null;
  // Kaba çerçeveler önce: giderici bir kez yakınsayıp sonra yolunu yitirdiyse (`trained` kalıcıdır, `converged` değil)
  // çerçeveler yine kaba kapıdan gelir ve kesin kanıt sayılmamalıdır (uygulamadaki Bluetooth benzetiminde bu delikten
  // Jarvis ikinci okumada kendi sesiyle sustu).
  if (nearCoarse()) return count >= COARSE_MIN_ACTIVE ? sum / count : 0;
  if (echoLast.trained) return sum / count;
  return echoLast.warm && !echoLast.coupled ? null : 0;
}

/** Şu anki oran kaba kapıdan mı (süzgeç yakınsamadı, bağlaşım biliniyor): son pencerenin çoğu kaba çerçeve. */
function nearCoarse(): boolean {
  if (!echoLast || !echoLast.coupled) return false;
  // Giderici "yakınsadı" dese de bastırması zayıfsa (< 15 dB) kanısı kesin sayılmaz: Bluetooth benzetiminde süzgeç
  // anlık yakınsadı, oran 0,63 verdi ve Jarvis kendi sesiyle sustu. Doğrusal yankıda bastırma 35–48 dB'dir.
  // Kullanıcı konuşurken anlık bastırma düşer (kalan, onun sesidir); bu yüzden son 5 sn'de güçlü bastırma görüldü mü bakılır.
  if (echoFrames - strongErleAt > STRONG_ERLE_HOLD_FRAMES) return true;
  let coarse = 0;
  let active = 0;
  for (const frame of echoRecent) {
    if (!frame.active) continue;
    active++;
    if (frame.coarse) coarse++;
  }
  return active > 0 && coarse * 2 >= active;
}

function onEcho(echo: EchoFrame): void {
  echoLast = echo;
  // Oda gürültüsü: Jarvis konuşmuyorken mikrofon gücünün yavaş yükselen en küçük değeri (kullanıcının sözü ortalamaya
  // girerse taban yükselir ve kullanıcı bir daha duyulmaz: benzetimde tam bu oldu; en küçük değer izleyicisi sözden etkilenmez).
  if (!echo.active) idleMic = Math.min(echo.mic * echo.mic + 1e-10, idleMic * 1.002 + 1e-10);
  echoFrames++;
  if (echo.active && echo.converged && echo.erleDb >= WEAK_ERLE_DB) strongErleAt = echoFrames;
  echoRecent.push(echo);
  if (echoRecent.length > ECHO_HISTORY) echoRecent.shift();
  if (echo.active && ++echoReportIn >= 50) {
    echoReportIn = 0;
    send({
      type: 'echo',
      converged: echo.converged,
      trained: echo.trained,
      delayMs: echo.delayMs,
      erleDb: echo.erleDb,
      coupled: echo.coupled,
      ...(typeof echo.corr === 'number' ? { corr: echo.corr, corrLagMs: echo.corrLagMs ?? 0 } : {}),
    });
  }
  // Söz sürerken kullanıcı oranı eşiği geçerse (yankıyla başlayan bölüte kullanıcı katıldı ya da ses kısılınca
  // kararsızlık çözüldü) oturuma haber verilir.
  const live = liveSegment;
  if (!live || !segmenter?.active) return;
  live.framesSince++;
  const coarse = nearCoarse();
  if (coarse) {
    // Kaba kanıt: her bildirim bir öncekinden sonraki tam pencereye dayanır (kısık seste ayrıca doğrulansın).
    if (live.sent >= COARSE_NEAR_MAX || live.framesSince < ECHO_HISTORY) return;
    const near = nearNow();
    if (near === undefined || near === null || near < (live.sent === 0 ? NEAR_COARSE_DUCK : NEAR_COARSE_SURE)) return;
    // Kullanıcının sözü mikrofonda belirgin bir düzeydir: oda gürültüsünün 8 katı ve en az 3·10⁻⁴ (−35 dBFS). Cümle başı
    // ve hece aralarındaki kısık seste kaba oran gürültüden yükselebiliyor (uygulamadaki Bluetooth benzetiminde 1·10⁻⁴
    // düzeyinde iki bildirim Jarvis'i susturdu).
    if (micPower() < Math.max(8 * idleMic, COARSE_MIN_MIC)) return;
    if (live.sent > 0) {
      // Kısma sınaması (asıl karar): oturum ilk bildirimde sesi −12 dB kıstı. Yankı da kısılan sesle birlikte düşer
      // (Bluetooth gecikmesi kadar sonra); kullanıcının sesi düşmez. Kısmanın mikrofona ulaştığı andan sonraki tam
      // pencerede mikrofon gücü kısmadan önceki gücün yarısından (−3 dB) çok düştüyse ses yankıdır: susturulmaz.
      // Neden: uygulamadaki Bluetooth benzetiminde (gerçek TTS, tarayıcının kazanç denetimi) bağlaşım kestirimi
      // sessiz hecelerde yetersiz kaldı ve oran tek başına Jarvis'i 3,3 sn'de kendi sesiyle susturdu.
      const lagFrames = Math.round((echoLast?.corrLagMs ?? 400) / 20);
      if (live.framesSince < lagFrames + ECHO_HISTORY) return;
      const post = micPower();
      if (live.preMic === null || post < 0.5 * live.preMic) {
        if (!live.duckBlocked) log('info', `kaba kanıt: bölüt ${live.id}, kısınca mikrofon düştü (${post.toExponential(1)} < ${live.preMic?.toExponential(1) ?? '—'}/2): yankı`);
        live.duckBlocked = true;
        return;
      }
    }
    log('info', `kaba kanıt: bölüt ${live.id}, ${live.sent + 1}. bildirim, oran ${near.toFixed(2)}, mikrofon ${micPower().toExponential(1)} (önce ${live.preMic?.toExponential(1) ?? '—'})`);
    // Her bildirimde kısma öncesi düzey yenilenir (oturum kısma süresi dolunca sesi açar ve sıradaki bildirim yeniden kısar).
    live.preMic = micPower();
    live.sent++;
    live.framesSince = 0;
    live.nearSent = true;
    live.coarse = true;
    send({ type: 'speech_near', segmentId: live.id, coarse: true });
    return;
  }
  if (live.nearSent && !live.coarse) return;
  const near = nearNow();
  if (near === undefined || near === null || near < NEAR_SURE) return;
  log('info', `kesin kanıt: bölüt ${live.id}, oran ${near.toFixed(2)} (öğrendi ${echo.trained}, yakınsadı ${echo.converged})`);
  live.nearSent = true;
  live.coarse = false;
  send({ type: 'speech_near', segmentId: live.id });
}

function onFrame(pcm: Int16Array): void {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) {
    const value = Math.abs(pcm[i] ?? 0) / 32768;
    sum += value * value;
    if (value > peak) peak = value;
  }
  levelSum += sum / Math.max(1, pcm.length);
  levelPeak = Math.max(levelPeak, peak);
  if (++frameCount % LEVEL_EVERY_FRAMES === 0) {
    send({ type: 'level', source: 'mic', rms: Math.sqrt(levelSum / LEVEL_EVERY_FRAMES), peak: levelPeak });
    levelSum = 0;
    levelPeak = 0;
  }

  if (!listening) return;
  segmenter?.accept(pcm);
  if (wakeEnabled && spotter) {
    const float = new Float32Array(pcm.length);
    for (let i = 0; i < pcm.length; i++) float[i] = (pcm[i] ?? 0) / 32768;
    if (segmenter?.active) kwsQuietFrames = 0;
    else if (++kwsQuietFrames >= KWS_REFRESH_FRAMES) {
      kwsQuietFrames = 0;
      spotter.reset();
      for (const frame of kwsRecent) spotter.accept(frame);
    }
    kwsRecent.push(float);
    if (kwsRecent.length > KWS_CONTEXT_FRAMES) kwsRecent.shift();
    const hit = spotter.accept(float);
    if (hit) send({ type: 'wake', phrase: hit.phrase, score: hit.score });
  }
}

function attachPort(next: MessagePortMain): void {
  port?.close();
  port = next;
  next.on('message', (event) => {
    const message = event.data as PortToWorker;
    if (message.type === 'frame') {
      const pcm = message.pcm;
      // Yapısal kopya Int16Array'i korur; yine de ham tampon gelirse sarılır.
      if (message.echo) onEcho(message.echo);
      onFrame(pcm instanceof Int16Array ? pcm : new Int16Array(pcm as ArrayBuffer));
    } else if (message.type === 'system_frame') {
      if (!systemOn) return;
      const pcm = message.pcm;
      systemSegmenter?.accept(pcm instanceof Int16Array ? pcm : new Int16Array(pcm as ArrayBuffer));
    } else if (message.type === 'level') {
      send({ type: 'level', source: 'speaker', rms: message.rms, peak: message.peak });
    }
  });
  next.start();
}

function init(config: WorkerConfig): void {
  // Model yolları göreli verilir; kullanıcı klasöründe Türkçe harf olsa da yerel kitaplıklar ASCII yol görür.
  process.chdir(config.modelsDir);
  const warnings: string[] = [];

  // Söz başlangıcı, yankı gidericinin o andaki kanısıyla birlikte bildirilir.
  segmenter = new Segmenter(sherpa, config, (event) => {
    if (event.type === 'speech_end' || event.type === 'speech_cut') liveSegment = null;
    if (event.type !== 'speech_start') return send(event);
    const measured = nearNow();
    const coarse = measured !== undefined && measured !== null && nearCoarse();
    // Kaba kanıtta kısık ses (gürültü düzeyi) aday sayılmaz: oturum sesi boşuna kısmasın.
    const near = coarse && micPower() < Math.max(8 * idleMic, COARSE_MIN_MIC) ? 0 : measured;
    // Kaba kanıtta söz başındaki aday (oturum sesi kısar) ilk bildirim sayılır; susturmak için yeni pencere gerekir.
    const sure = near === null || (near !== undefined && near >= (coarse ? NEAR_COARSE_DUCK : NEAR_SURE));
    liveSegment = { id: event.segmentId, nearSent: sure, coarse, sent: coarse && sure ? 1 : 0, framesSince: 0, preMic: coarse && sure ? micPower() : null };
    send(near === undefined ? event : { ...event, near, ...(coarse ? { coarse: true } : {}) });
  });

  // Bilgisayarın sesi temizdir (gürültü bastırma ve yankı yok): sözler arası kısa duraksamada da bölünür ki satır erken
  // yazılsın. Yalnız söz başı ve bölüt sonu bildirilir; kısa söz izleyici ve kesme bu akışta yoktur.
  const systemVad = config.systemVad ?? { minSilenceMs: config.vad.minSilenceMs, maxSpeechSeconds: config.vad.maxSpeechSeconds };
  systemSegmenter = new Segmenter(sherpa, { ...config, vad: { ...config.vad, ...systemVad } }, (event) => {
    if (event.type === 'speech_start') send({ type: 'system_start' });
    else if (event.type === 'speech_end') send({ type: 'system_speech', pcm: event.pcm, durationMs: event.durationMs });
  });

  if (config.kws) {
    try {
      spotter = new WakeSpotter(sherpa, config.kws);
      if (spotter.skipped.length > 0) warnings.push(`sezici şu sözleri yazamadı: ${spotter.skipped.join(', ')}`);
    } catch (error) {
      spotter = null;
      warnings.push(`anahtar sözcük sezici açılamadı: ${(error as Error).message}`);
    }
  }

  if (config.piper) {
    try {
      piper = new Piper(config.piper, log);
    } catch (error) {
      piper = null;
      warnings.push(`yerel ses açılamadı: ${(error as Error).message}`);
    }
  }

  router = new TtsRouter({
    local: piper,
    log,
    onFallback: (info) => send({ type: 'tts.fallback', ...info }),
    onRecovered: () => send({ type: 'tts.recovered' }),
    onHostFailure: (message, kind) => send({ type: 'tts.hostFailed', message, ...(kind ? { kind } : {}) }),
  });
  configureTts(config.tts);

  send({ type: 'ready', kws: spotter !== null, tts: router.available(), piper: piper !== null, warnings });
}

/** Seçili motoru, bulut sağlayıcıyı (ElevenLabs) ve ses konağının yüklü motorunu yönlendiriciye bildirir. */
let cloudKey = '';
function configureTts(settings: TtsSettings): void {
  if (!router) return;
  router.setEngine(settings.engine);
  // Bulut ayarı ve "bulut seçili mi" değişmediyse bağlantı ve bekleme süresi korunur (konak durumu değişti diye
  // sıfırlanmasın). Ana süreç de geri düşme kaydını aynı koşulda siler (`main/voice/index.ts` › `refreshTts`).
  const nextKey = JSON.stringify([settings.engine === 'elevenlabs', settings.elevenlabs]);
  if (nextKey !== cloudKey) {
    cloudKey = nextKey;
    router.setCloud(settings.elevenlabs ? new ElevenLabs(settings.elevenlabs) : null, settings.elevenlabs?.model ?? '');
  }
  router.setLanguage(settings.language ?? 'tr');
  if (hostSynth && settings.host) hostSynth.info = settings.host;
  router.setHost(settings.host && hostSynth?.usable ? hostSynth : null);
}

/** Ses konağının portu geldi (ya da bırakıldı). */
function attachHost(next: MessagePortMain | null, info: TtsHostInfo | null): void {
  hostSynth?.close();
  hostSynth = next && info ? new HostSynth(next, info) : null;
  router?.setHost(hostSynth);
}

function speak(streamId: string, text: string, options: SpeakOptions): void {
  const epoch = ttsEpoch;
  const index = sentenceIndex.get(streamId) ?? 0;
  sentenceIndex.set(streamId, index + 1);
  const requestedAt = performance.now();
  ttsChain = ttsChain.then(async () => {
    if (epoch !== ttsEpoch) return;
    if (!router?.available()) {
      send({ type: 'tts.error', streamId, message: 'ses motoru kullanılamıyor' });
      return;
    }
    let squares = 0;
    let firstChunkMs: number | null = null;
    try {
      const result = await router.speak(
        text,
        (chunk) => {
          if (epoch !== ttsEpoch) return;
          if (firstChunkMs === null) firstChunkMs = Math.round(performance.now() - requestedAt);
          for (let i = 0; i < chunk.pcm.length; i++) {
            const value = (chunk.pcm[i] ?? 0) / 32768;
            squares += value * value;
          }
          toWindow({ type: 'pcm', streamId, sampleRate: chunk.sampleRate, pcm: chunk.pcm });
        },
        options,
      );
      // Bulut cümleyi faturaladıysa (yarıda kesilse de) kullanım kaydına düşer.
      if (result.chars > 0) {
        send({
          type: 'tts.usage',
          engine: result.engine,
          chars: result.chars,
          audioMs: Math.round((result.samples * 1000) / result.sampleRate),
          durationMs: Math.round(performance.now() - requestedAt),
        });
      }
      if (epoch !== ttsEpoch) return;
      send({
        type: 'tts.sentence',
        streamId,
        index,
        audioMs: Math.round((result.samples * 1000) / result.sampleRate),
        firstChunkMs: firstChunkMs ?? 0,
        synthFirstChunkMs: result.firstChunkMs,
        rms: result.samples > 0 ? Math.sqrt(squares / result.samples) : 0,
        engine: result.engine,
        device: result.device,
        chars: result.chars,
        fallback: result.fallback,
      });
    } catch (error) {
      if (epoch === ttsEpoch) send({ type: 'tts.error', streamId, message: (error as Error).message });
    }
  });
}

function handle(command: WorkerCommand, ports: MessagePortMain[]): void {
  switch (command.type) {
    case 'init':
      if (ports[0]) attachPort(ports[0]);
      init(command.config);
      break;
    case 'port':
      if (ports[0]) attachPort(ports[0]);
      break;
    case 'listen':
      if (command.on !== listening) {
        listening = command.on;
        segmenter?.reset();
        spotter?.reset();
      }
      break;
    case 'wake':
      if (command.on && !wakeEnabled) spotter?.reset();
      wakeEnabled = command.on;
      break;
    case 'watch':
      segmenter?.setWatch(command.on);
      break;
    case 'cut':
      segmenter?.cut();
      break;
    case 'system':
      if (command.on !== systemOn) {
        systemOn = command.on;
        systemSegmenter?.reset();
      }
      break;
    case 'tts.speak':
      speak(command.streamId, command.text, { forceLocal: command.local === true, engine: command.engine, voice: command.voice });
      break;
    case 'tts.port':
      attachHost(ports[0] ?? null, command.host);
      break;
    case 'tts.config':
      configureTts(command.settings);
      break;
    case 'tts.prewarm':
      router?.prewarm();
      break;
    case 'kws.update':
      spotter?.setTuning({ threshold: command.threshold, boost: command.boost, paths: command.paths });
      break;
    case 'kws.probe': {
      const pcm = command.pcm instanceof Int16Array ? command.pcm : new Int16Array(command.pcm as ArrayBuffer);
      const result = spotter?.probe(pcm) ?? null;
      send({ type: 'kws.probe.result', id: command.id, score: result?.score ?? null, phrase: result?.phrase ?? null, profiles: result?.profiles ?? [] });
      break;
    }
    case 'kws.probe.end':
      spotter?.endProbe();
      break;
    case 'tts.end': {
      const epoch = ttsEpoch;
      const { streamId } = command;
      ttsChain = ttsChain.then(() => {
        sentenceIndex.delete(streamId);
        if (epoch === ttsEpoch) toWindow({ type: 'end', streamId });
      });
      break;
    }
    case 'tts.cancel':
      ttsEpoch++;
      sentenceIndex.clear();
      router?.cancel();
      toWindow({ type: 'flush' });
      break;
    case 'earcon':
      toWindow({ type: 'earcon', kind: command.kind });
      break;
    case 'shutdown':
      hostSynth?.close();
      router?.stop();
      piper?.stop();
      process.exit(0);
  }
}

process.parentPort.on('message', (event) => {
  try {
    handle(event.data as WorkerCommand, event.ports);
  } catch (error) {
    send({ type: 'fatal', message: (error as Error).message });
  }
});

send({ type: 'hello' });
