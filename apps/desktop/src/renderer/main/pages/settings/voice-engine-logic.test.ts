import { describe, expect, it } from 'vitest';
import type { TtsEngineStatus, TtsEnginesReport } from '@fuber/shared';
import { activeLine, engineStatusView, nextVoices, pendingNote, reportInFlux, ttsDiagView, type TtsDiag } from './voice-engine-logic';

const engine = (over: Partial<TtsEngineStatus>): TtsEngineStatus => ({
  id: 'supertonic',
  label: 'Supertonic 3',
  hint: 'Yerel, ekran kartı',
  available: true,
  reason: null,
  files: 'ready',
  progress: null,
  device: 'cuda',
  running: false,
  voices: [{ id: 'M4', label: 'Erkek 4 · tok' }],
  voice: 'M4',
  previewable: true,
  state: 'ready',
  bytes: { received: 400 * 1024 * 1024, total: 400 * 1024 * 1024 },
  canPrepare: false,
  ...over,
});

const tts = (over: Partial<TtsDiag>): TtsDiag => ({
  provider: 'supertonic',
  source: 'policy',
  active: 'supertonic',
  device: 'cuda',
  voice: 'M4',
  local: true,
  host: null,
  voiceId: 'M4',
  model: null,
  hasKey: false,
  fallback: null,
  charsBilled: 0,
  ...over,
});

describe('motor durumu', () => {
  it('hazır, konuşuyor, kullanılamıyor', () => {
    expect(engineStatusView(engine({}))).toMatchObject({ kind: 'ready', label: 'Hazır', action: null, progress: null, size: null });
    expect(engineStatusView(engine({ running: true, state: 'speaking' }))).toMatchObject({ kind: 'speaking', label: 'Konuşuyor', tone: 'success' });
    const bad = engineStatusView(engine({ available: false, reason: 'ElevenLabs anahtarı yok.', files: 'none', state: 'unavailable', bytes: null }));
    expect(bad).toMatchObject({ kind: 'unavailable', detail: 'ElevenLabs anahtarı yok.', action: null });
  });

  it('iniyor: yüzde rozette, çubuk ve boyut var, eylem "durdur"; doğrulanıyor ve yükleniyor ayrı rozet', () => {
    const mb = 1024 * 1024;
    const down = engineStatusView(engine({ available: false, files: 'preparing', progress: 0.4, reason: 'Dosyaları iniyor: %40.', state: 'downloading', bytes: { received: 13.2 * mb, total: 33 * mb } }));
    expect(down).toMatchObject({ kind: 'downloading', label: 'İniyor %40', progress: 0.4, size: '13 / 33 MB', action: 'cancel', detail: null });
    expect(engineStatusView(engine({ available: false, files: 'preparing', state: 'verifying', progress: 1 }))).toMatchObject({ kind: 'verifying', label: 'Doğrulanıyor', action: null });
    expect(engineStatusView(engine({ state: 'loading', reason: 'Ekran kartına yükleniyor…' }))).toMatchObject({ kind: 'loading', label: 'Yükleniyor', detail: 'Ekran kartına yükleniyor…' });
  });

  it('indirilmedi: boyut ve "indir"; hazırlanamadı: neden ve "yeniden dene"', () => {
    const mb = 1024 * 1024;
    const missing = engineStatusView(engine({ available: false, files: 'missing', reason: 'yok', state: 'missing', canPrepare: true, bytes: { received: 0, total: 33 * mb } }));
    expect(missing).toMatchObject({ kind: 'missing', label: 'İndirilmedi', size: '33 MB', action: 'download' });
    const failed = engineStatusView(engine({ available: false, files: 'missing', reason: 'Dosyaları indirilemedi: sunucu 500', state: 'failed', canPrepare: true }));
    expect(failed).toMatchObject({ kind: 'failed', label: 'Hazırlanamadı', detail: 'Dosyaları indirilemedi: sunucu 500', action: 'retry', tone: 'danger' });
    // Hazırlanamıyorsa (ör. ekran kartı sesi sınamada kapalı) eylem sunulmaz.
    expect(engineStatusView(engine({ state: 'failed', canPrepare: false })).action).toBeNull();
  });
});

describe('seçili görünen = konuşan değilse arayüz bunu söyler', () => {
  const ema = (over: Partial<TtsEngineStatus>): TtsEngineStatus => engine({ id: 'ema-lightning', label: 'EMA Lightning', voices: [{ id: 'ema', label: 'EMA' }], voice: 'ema', ...over });
  const report = (selected: TtsEngineStatus, over: Partial<TtsEnginesReport> = {}): TtsEnginesReport => ({
    selected: 'ema-lightning',
    source: 'device',
    policy: 'supertonic',
    active: 'supertonic',
    activeDevice: 'cuda',
    note: selected.reason,
    engines: [engine({ running: true, state: 'speaking' }), selected],
    ...over,
  });

  it('iniyor / yükleniyor: "hazır olunca geçilir; o zamana dek X konuşuyor"', () => {
    for (const state of ['downloading', 'verifying', 'loading'] as const) {
      const value = report(ema({ state, available: false }));
      expect(pendingNote(value)).toBe('EMA Lightning hazır olunca kendiliğinden ona geçilir; o zamana dek Supertonic 3 konuşuyor.');
      expect(reportInFlux(value)).toBe(true);
    }
  });

  it('indirilmedi ve hazırlanamadı: neden yazar', () => {
    expect(pendingNote(report(ema({ state: 'missing', available: false })))).toBe('EMA Lightning bu bilgisayarda yok; indirilene dek Supertonic 3 konuşuyor.');
    expect(pendingNote(report(ema({ state: 'failed', available: false, reason: 'Ekran kartına yüklenemedi: bozuk model' })))).toBe(
      'EMA Lightning şu an konuşamıyor; Supertonic 3 konuşuyor. Ekran kartına yüklenemedi: bozuk model',
    );
  });

  it('seçili motor konuşuyorsa not yok ve sık yenileme durur', () => {
    const value = report(ema({ state: 'speaking', running: true }), { active: 'ema-lightning', engines: [engine({}), ema({ state: 'speaking', running: true })], note: null });
    expect(pendingNote(value)).toBeNull();
    expect(reportInFlux(value)).toBe(false);
  });
});

describe('şu an konuşan', () => {
  const report: TtsEnginesReport = {
    selected: 'supertonic',
    source: 'policy',
    policy: 'supertonic',
    active: 'supertonic',
    activeDevice: 'cuda',
    note: null,
    engines: [engine({})],
  };
  it('motor, ses ve cihaz', () => expect(activeLine(report)).toBe('Supertonic 3 · Erkek 4 · tok · Ekran kartı (CUDA)'));
  it('cihaz yoksa yalnız motor', () => expect(activeLine({ ...report, activeDevice: null })).toBe('Supertonic 3'));
});

describe('Tanı satırı', () => {
  it('ekran kartı', () => {
    const view = ttsDiagView(tts({}));
    expect(view).toMatchObject({ kind: 'gpu', device: 'cuda' });
    expect(view.body).toContain('Erkek 4');
  });
  it('işlemci (Piper)', () => expect(ttsDiagView(tts({ provider: 'piper-local', active: 'piper-local', device: 'cpu', voice: 'dfki' })).kind).toBe('cpu'));
  it('bulut', () => expect(ttsDiagView(tts({ provider: 'elevenlabs', active: 'elevenlabs', device: 'cloud', voice: null })).kind).toBe('cloud'));
  it('hiçbiri', () => expect(ttsDiagView(tts({ active: 'piper-local', device: null, local: false })).kind).toBe('none'));
  it('ekran kartı düşüşünde nedeni gösterir', () => {
    const view = ttsDiagView(
      tts({
        active: 'piper-local',
        device: 'cpu',
        host: { engine: 'supertonic', phase: 'failed', device: null, reason: 'Ekran kartında başlatılamadı.', attempts: [{ device: 'cuda', error: 'oops' }], loadMs: null, warmMs: null, restarts: 0 },
      }),
    );
    expect(view.hostPhase).toBe('failed');
    expect(view.body).toContain('Seçili motor Supertonic 3');
    expect(view.body).toContain('Ekran kartında başlatılamadı.');
    expect(view.body).not.toContain('oops');
  });
  it('neden boşsa denemeler tek tek yazılır', () => {
    const view = ttsDiagView(
      tts({ active: 'piper-local', device: 'cpu', host: { engine: 'supertonic', phase: 'failed', device: null, reason: null, attempts: [{ device: 'cuda', error: 'oops' }], loadMs: null, warmMs: null, restarts: 0 } }),
    );
    expect(view.body).toContain('Ekran kartı (CUDA) denendi: oops.');
  });
  it('bulut düşüşünde fallback mesajı', () => {
    const view = ttsDiagView(tts({ provider: 'elevenlabs', active: 'piper-local', device: 'cpu', fallback: { reason: 'quota', message: 'Kota doldu.', until: null } }));
    expect(view.body).toContain('Kota doldu.');
  });
});

describe('ses seçimi', () => {
  it('öteki motorların sesi korunur', () => expect(nextVoices({ 'piper-local': 'dfki' }, 'supertonic', 'M5')).toEqual({ 'piper-local': 'dfki', supertonic: 'M5' }));
});
