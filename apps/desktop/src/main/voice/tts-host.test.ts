import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import type { Logger, TtsDevice, TtsHostEngineId } from '@fuber/shared';
import type { TtsHostCommand, TtsHostEvent } from '../../tts-host/protocol';
import { TtsHost, type HostChild, type HostState } from './tts-host';

type Port = { id: string };

/** Sahte ses konağı süreci: sınama `emit` ile olay yollar, `exit` ile kapatır. */
class FakeChild implements HostChild<Port> {
  sent: Array<{ message: TtsHostCommand; ports?: Port[] }> = [];
  killed = false;
  private onMessageListener: (event: TtsHostEvent) => void = () => {};
  private onExitListener: (code: number | null) => void = () => {};
  postMessage(message: TtsHostCommand, ports?: Port[]): void {
    this.sent.push({ message, ports });
  }
  onMessage(listener: (event: TtsHostEvent) => void): void {
    this.onMessageListener = listener;
  }
  onExit(listener: (code: number | null) => void): void {
    this.onExitListener = listener;
  }
  kill(): void {
    this.killed = true;
  }
  emit(event: TtsHostEvent): void {
    this.onMessageListener(event);
  }
  exit(code: number | null): void {
    this.onExitListener(code);
  }
  get config() {
    const init = this.sent.find((item) => item.message.type === 'init')?.message;
    return init?.type === 'init' ? init.config : null;
  }
  ready(device: TtsDevice, engine: TtsHostEngineId = 'supertonic', voice = 'M4'): void {
    this.emit({ type: 'ready', engine, voice, device, runtime: '1.32.0', sampleRate: engine === 'supertonic' ? 44_100 : 48_000, loadMs: 900, warmMs: 800 });
  }
}

const silent: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => silent } as unknown as Logger;

function setup(options: { runtimes?: TtsDevice[]; engines?: TtsHostEngineId[]; failDevices?: TtsDevice[] } = {}) {
  const runtimes = new Set<TtsDevice>(options.runtimes ?? ['cuda', 'directml']);
  const engines = new Set<TtsHostEngineId>(options.engines ?? ['supertonic', 'ema-lightning']);
  const children: FakeChild[] = [];
  const states: HostState[] = [];
  const ports: Array<{ port: Port; engine: string; device: string; voice: string }> = [];
  const selectFailures: Array<{ engine: string; voice: string; message: string }> = [];
  let channels = 0;
  const host = new TtsHost<Port>({
    log: silent,
    runtimeDir: (device) => (device === 'cpu' ? (runtimes.has('directml') ? 'C:/m/dml' : runtimes.has('cuda') ? 'C:/m/cuda' : null) : runtimes.has(device) ? `C:/m/${device}` : null),
    engineDir: (engine) => (engines.has(engine) ? `C:/m/${engine}` : null),
    sentenceSilence: 0.15,
    failDevices: options.failDevices,
    spawn: () => {
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    channel: () => {
      channels++;
      return { host: { id: `h${channels}` }, worker: { id: `w${channels}` } };
    },
    onPort: (port, info) => ports.push({ port, engine: info.engine, device: info.device, voice: info.voice }),
    onState: (state) => states.push(state),
    onSelectFailed: (want, message) => selectFailures.push({ ...want, message }),
    startTimeoutMs: 1000,
    backoffMs: [10, 20, 40],
  });
  return { host, children, states, ports, runtimes, engines, selectFailures, last: () => children[children.length - 1]! };
}

beforeEach(() => void vi.useFakeTimers());
afterEach(() => void vi.useRealTimers());

describe('ses konağı: düşüş zinciri', () => {
  it('CUDA ile açılır: yapılandırma, port teslimi, durum', () => {
    const h = setup();
    h.host.request({ engine: 'supertonic', voice: 'M4' });
    expect(h.host.state()).toMatchObject({ phase: 'starting', device: 'cuda', engine: 'supertonic' });
    const child = h.last();
    child.emit({ type: 'hello' });
    expect(child.config).toMatchObject({
      device: 'cuda',
      runtimeDir: 'C:/m/cuda',
      primary: { engine: 'supertonic', voice: 'M4' },
      sentenceSilence: 0.15,
      engines: { supertonic: { dir: 'C:/m/supertonic' }, 'ema-lightning': { dir: 'C:/m/ema-lightning' } },
    });
    expect(child.sent[0]!.ports).toEqual([{ id: 'h1' }]);
    expect(h.ports).toEqual([]);
    child.ready('cuda');
    expect(h.host.state()).toMatchObject({ phase: 'ready', device: 'cuda', sampleRate: 44_100, runtime: '1.32.0', loadMs: 900, warmMs: 800, attempts: [], restarts: 0 });
    expect(h.ports).toEqual([{ port: { id: 'w1' }, engine: 'supertonic', device: 'cuda', voice: 'M4' }]);
    expect(h.host.info()).toEqual({ engine: 'supertonic', voice: 'M4', device: 'cuda', sampleRate: 44_100 });
  });

  it('CUDA açılamazsa DirectML denenir; neden kaydedilir', () => {
    const h = setup();
    h.host.request({ engine: 'supertonic', voice: 'M4' });
    const cuda = h.last();
    cuda.emit({ type: 'hello' });
    cuda.emit({ type: 'failed', stage: 'model', message: 'CUDA failure 100: no CUDA-capable device' });
    expect(cuda.killed).toBe(true);
    expect(h.children.length).toBe(2);
    const dml = h.last();
    dml.emit({ type: 'hello' });
    expect(dml.config).toMatchObject({ device: 'directml', runtimeDir: 'C:/m/directml' });
    dml.ready('directml');
    expect(h.host.state()).toMatchObject({ phase: 'ready', device: 'directml', attempts: [{ device: 'cuda', error: 'CUDA failure 100: no CUDA-capable device' }] });
    expect(h.ports).toEqual([{ port: { id: 'w2' }, engine: 'supertonic', device: 'directml', voice: 'M4' }]);
  });

  it('hiçbir cihazda açılamazsa "failed": bütün denemeler ve nedenleri durur, port verilmez', () => {
    const h = setup();
    h.host.request({ engine: 'supertonic', voice: 'M4' });
    h.last().emit({ type: 'failed', stage: 'runtime', message: 'LoadLibrary 126' });
    // İkinci deneme hazır olmadan kapanır.
    h.last().exit(3221225477);
    const state = h.host.state();
    expect(state.phase).toBe('failed');
    expect(state.attempts).toEqual([
      { device: 'cuda', error: 'LoadLibrary 126' },
      { device: 'directml', error: 'hazır olmadan kapandı (kod 3221225477)' },
    ]);
    expect(state.reason).toContain('cuda: LoadLibrary 126');
    expect(state.missingFiles).toBe(false);
    expect(h.ports).toEqual([]);
    expect(h.host.info()).toBeNull();
    // Aynı istek yinelenince döngüye girilmez.
    h.host.request({ engine: 'supertonic', voice: 'M4' });
    expect(h.children.length).toBe(2);
  });

  it('süre dolarsa deneme başarısız sayılır ve süreç kapatılır', () => {
    const h = setup({ runtimes: ['cuda'] });
    h.host.request({ engine: 'supertonic', voice: 'M4' });
    const child = h.last();
    child.emit({ type: 'hello' });
    vi.advanceTimersByTime(1001);
    expect(child.killed).toBe(true);
    expect(h.host.state()).toMatchObject({ phase: 'failed', attempts: [{ device: 'cuda', error: 'zaman aşımı' }] });
  });

  it('EMA Lightning işlemciye kadar iner (CUDA → DirectML → işlemci); Supertonic inmez', () => {
    const h = setup();
    h.host.request({ engine: 'ema-lightning', voice: 'ema' });
    h.last().emit({ type: 'failed', stage: 'runtime', message: 'x' });
    h.last().emit({ type: 'failed', stage: 'runtime', message: 'y' });
    const cpu = h.last();
    cpu.emit({ type: 'hello' });
    expect(cpu.config).toMatchObject({ device: 'cpu', runtimeDir: 'C:/m/dml' });
    cpu.ready('cpu', 'ema-lightning', 'ema');
    expect(h.host.state()).toMatchObject({ phase: 'ready', device: 'cpu', engine: 'ema-lightning' });
    expect(h.children.length).toBe(3);
  });

  it('dosyalar hazır değilse süreç başlatılmaz; dosyalar gelince `retry` baştan dener', () => {
    const h = setup({ engines: [] });
    h.host.request({ engine: 'supertonic', voice: 'M4' });
    expect(h.children.length).toBe(0);
    expect(h.host.state()).toMatchObject({ phase: 'failed', missingFiles: true, reason: 'model dosyaları hazır değil' });
    h.engines.add('supertonic');
    h.host.retry();
    expect(h.children.length).toBe(1);
    expect(h.host.state().phase).toBe('starting');

    // Çalışma zamanı yok: yine süreç yok.
    const none = setup({ runtimes: [] });
    none.host.request({ engine: 'supertonic', voice: 'M4' });
    expect(none.children.length).toBe(0);
    expect(none.host.state()).toMatchObject({ phase: 'failed', missingFiles: true });
    // Yalnız DirectML çalışma zamanı varsa zincir oradan başlar.
    const dmlOnly = setup({ runtimes: ['directml'] });
    dmlOnly.host.request({ engine: 'supertonic', voice: 'M4' });
    dmlOnly.last().emit({ type: 'hello' });
    expect(dmlOnly.last().config?.device).toBe('directml');
  });

  it('sınama: açılamamış sayılacak cihazlar konağa bildirilir', () => {
    const h = setup({ failDevices: ['cuda'] });
    h.host.request({ engine: 'supertonic', voice: 'M4' });
    h.last().emit({ type: 'hello' });
    expect(h.last().config?.failDevices).toEqual(['cuda']);
  });
});

describe('ses konağı: yaşam döngüsü', () => {
  const start = (h: ReturnType<typeof setup>) => {
    h.host.request({ engine: 'supertonic', voice: 'M4' });
    h.last().emit({ type: 'hello' });
    h.last().ready('cuda');
  };

  it('hazırken çökerse aynı cihazla yeniden başlar; yeni port verilir', () => {
    const h = setup();
    start(h);
    vi.advanceTimersByTime(120_000);
    h.last().exit(1);
    expect(h.host.state()).toMatchObject({ phase: 'starting', restarts: 1 });
    expect(h.host.info()).toBeNull();
    vi.advanceTimersByTime(15);
    expect(h.children.length).toBe(2);
    h.last().emit({ type: 'hello' });
    expect(h.last().config?.device).toBe('cuda');
    h.last().ready('cuda');
    expect(h.host.state()).toMatchObject({ phase: 'ready', device: 'cuda', restarts: 1 });
    expect(h.ports.map((item) => item.port.id)).toEqual(['w1', 'w2']);
  });

  it('kısa sürede iki kez çökerse o cihaz bırakılır ve zincirde alta inilir', () => {
    const h = setup();
    start(h);
    h.last().exit(1);
    // İlk çökme 'kısa sürede' sayılır: ikinci bekleme basamağı (20 ms).
    vi.advanceTimersByTime(25);
    expect(h.children.length).toBe(2);
    h.last().emit({ type: 'hello' });
    h.last().ready('cuda');
    h.last().exit(1);
    vi.advanceTimersByTime(50);
    h.last().emit({ type: 'hello' });
    expect(h.last().config?.device).toBe('directml');
    expect(h.host.state().attempts).toEqual([{ device: 'cuda', error: 'art arda çöktü (kapandı (kod 1))' }]);
  });

  it('ses işçisi "yanıt vermedi" derse süreç kapatılıp yeniden başlatılır', () => {
    const h = setup();
    start(h);
    const first = h.last();
    h.host.reportFailure('ses konağı yanıt vermedi');
    expect(first.killed).toBe(true);
    expect(h.host.state().phase).toBe('starting');
    vi.advanceTimersByTime(50);
    expect(h.children.length).toBe(2);
  });

  it('motor ya da ses değişince süreç yeniden başlamaz: `select` gider, `selected` ile durum güncellenir', () => {
    const h = setup();
    start(h);
    h.host.request({ engine: 'supertonic', voice: 'F1' });
    expect(h.children.length).toBe(1);
    expect(h.last().sent.at(-1)!.message).toEqual({ type: 'select', engine: 'supertonic', voice: 'F1' });
    // Yeni ses yüklenene dek eski ses bilgisi geçerlidir.
    expect(h.host.info()?.voice).toBe('M4');
    h.last().emit({ type: 'selected', engine: 'supertonic', voice: 'F1', sampleRate: 44_100, loadMs: 0, warmMs: 300 });
    expect(h.host.info()).toEqual({ engine: 'supertonic', voice: 'F1', device: 'cuda', sampleRate: 44_100 });
    h.host.request({ engine: 'ema-lightning', voice: 'ema' });
    h.last().emit({ type: 'selected', engine: 'ema-lightning', voice: 'ema', sampleRate: 48_000, loadMs: 400, warmMs: 200 });
    expect(h.host.info()).toEqual({ engine: 'ema-lightning', voice: 'ema', device: 'cuda', sampleRate: 48_000 });
    expect(h.children.length).toBe(1);
  });

  it('öbür motor yüklenemezse çalışan motor konuşmayı sürdürür; istek ona geri alınır', () => {
    const h = setup();
    start(h);
    h.host.request({ engine: 'ema-lightning', voice: 'ema' });
    h.last().emit({ type: 'failed', stage: 'select', message: 'model okunamadı' });
    expect(h.host.state()).toMatchObject({ phase: 'ready', engine: 'supertonic' });
    expect(h.last().killed).toBe(false);
    // Sessizce yutulmaz: çağırana hangi motorun neden yüklenemediği bildirilir (arayüz "seçildi" demesin).
    expect(h.selectFailures).toEqual([{ engine: 'ema-lightning', voice: 'ema', message: 'model okunamadı' }]);
    // Aynı (çalışan) motor yeniden istenirse yeni bir şey yapılmaz.
    h.host.request({ engine: 'supertonic', voice: 'M4' });
    expect(h.last().sent.filter((item) => item.message.type === 'select').length).toBe(1);
    // "Yeniden dene": aynı motor yeniden istenince konağa yeniden sorulur ve bu kez geçilir.
    h.host.request({ engine: 'ema-lightning', voice: 'ema' });
    expect(h.last().sent.filter((item) => item.message.type === 'select').length).toBe(2);
    h.last().emit({ type: 'selected', engine: 'ema-lightning', voice: 'ema', sampleRate: 48_000, loadMs: 400, warmMs: 200 });
    expect(h.host.info()).toMatchObject({ engine: 'ema-lightning' });
    expect(h.children.length).toBe(1);
  });

  // demo.3 hatası: konak, EMA'nın dosyaları yerleşmeden birkaç ms ÖNCE başladı; motor tablosu o anda
  // donduğu için EMA sonradan hiç seçilemedi ("motorun model dosyaları bu bilgisayarda hazır değil").
  it('konak başladıktan SONRA hazır olan motor seçilebilir: klasörü seçimden önce konağa bildirilir', () => {
    const h = setup({ engines: ['supertonic'] });
    start(h);
    expect(h.last().config?.engines).toEqual({ supertonic: { dir: 'C:/m/supertonic' } });
    // Dosyalar geldi (indirme bitti / açılışta yerleştirme tamamlandı).
    h.engines.add('ema-lightning');
    h.host.retry();
    expect(h.last().sent.at(-1)?.message).toEqual({ type: 'engines', engines: { supertonic: { dir: 'C:/m/supertonic' }, 'ema-lightning': { dir: 'C:/m/ema-lightning' } } });
    h.host.request({ engine: 'ema-lightning', voice: 'ema' });
    const tail = h.last().sent.slice(-2).map((item) => item.message);
    expect(tail[0]).toMatchObject({ type: 'engines', engines: { 'ema-lightning': { dir: 'C:/m/ema-lightning' } } });
    expect(tail[1]).toEqual({ type: 'select', engine: 'ema-lightning', voice: 'ema' });
    h.last().emit({ type: 'selected', engine: 'ema-lightning', voice: 'ema', sampleRate: 48_000, loadMs: 400, warmMs: 200 });
    expect(h.host.info()).toMatchObject({ engine: 'ema-lightning', device: 'cuda' });
    expect(h.children.length).toBe(1);
    expect(h.selectFailures).toEqual([]);
  });

  it('dosyası olmayan motor çalışan konağa hiç sorulmaz: eski motor sürer, konak yeniden başlamaz, neden bildirilir', () => {
    const h = setup({ engines: ['supertonic'] });
    start(h);
    const sentBefore = h.last().sent.length;
    h.host.request({ engine: 'ema-lightning', voice: 'ema' });
    expect(h.last().sent.length).toBe(sentBefore);
    expect(h.host.info()).toMatchObject({ engine: 'supertonic', voice: 'M4' });
    expect(h.host.state()).toMatchObject({ phase: 'ready', restarts: 0 });
    expect(h.last().killed).toBe(false);
    expect(h.children.length).toBe(1);
    expect(h.selectFailures).toEqual([{ engine: 'ema-lightning', voice: 'ema', message: 'model dosyaları hazır değil' }]);
    // Konak çökerse yine ÇALIŞAN motorla (Supertonic) ayağa kalkar; dosyası olmayan motoru açmaya çalışmaz.
    h.last().exit(1);
    vi.advanceTimersByTime(25);
    h.last().emit({ type: 'hello' });
    expect(h.last().config?.primary).toEqual({ engine: 'supertonic', voice: 'M4' });
    // Dosyalar gelince aynı istek bu kez konağa gider.
    h.last().ready('cuda');
    h.engines.add('ema-lightning');
    h.host.request({ engine: 'ema-lightning', voice: 'ema' });
    expect(h.last().sent.at(-1)?.message).toEqual({ type: 'select', engine: 'ema-lightning', voice: 'ema' });
  });

  it('ses işçisi yeniden başlayınca çalışan konağa yeni kanal açılır', () => {
    const h = setup();
    start(h);
    h.host.renewPort();
    expect(h.last().sent.at(-1)).toEqual({ message: { type: 'port' }, ports: [{ id: 'h2' }] });
    expect(h.ports.at(-1)).toMatchObject({ port: { id: 'w2' }, device: 'cuda' });
    // Konak hazır değilken kanal açılmaz.
    const cold = setup();
    cold.host.renewPort();
    expect(cold.ports).toEqual([]);
  });

  it('istek kaldırılınca ve kapanışta süreç kapatılır; kapanıştan sonra yeni istek yok sayılır', () => {
    const h = setup();
    start(h);
    const child = h.last();
    h.host.request(null);
    expect(child.sent.at(-1)!.message).toEqual({ type: 'shutdown' });
    expect(h.host.state()).toMatchObject({ phase: 'off', engine: null });
    vi.advanceTimersByTime(600);
    expect(child.killed).toBe(true);
    // Kapatılan sürecin geç gelen olayları durumu bozmaz.
    child.ready('cuda');
    child.exit(0);
    expect(h.host.state().phase).toBe('off');
    h.host.stop();
    h.host.request({ engine: 'supertonic', voice: 'M4' });
    expect(h.children.length).toBe(1);
  });

  it('`restart` zinciri baştan kurar (CUDA çalışma zamanı sonradan indi)', () => {
    const h = setup({ runtimes: ['directml'] });
    h.host.request({ engine: 'supertonic', voice: 'M4' });
    h.last().emit({ type: 'hello' });
    h.last().ready('directml');
    h.runtimes.add('cuda');
    const old = h.last();
    h.host.restart();
    expect(old.killed).toBe(true);
    h.last().emit({ type: 'hello' });
    expect(h.last().config?.device).toBe('cuda');
  });
});

// Görülen belirti: "ses modelleri kayıyor, sonra geri gelmiyor". Kök neden: geçici ekran belleği sıkışması (yerel
// beyin yüklendi) konağı zincirde alta (işlemciye) itiyor ve kalıcı orada kalıyor. Düzeltme: kanıtlı üst cihaza, bellek
// boşalınca, kullanıcının SEÇTİĞİ motor ve sesle geri dön.
describe('ses konağı: seçilen cihaza geri dönüş', () => {
  const start = (h: ReturnType<typeof setup>) => {
    h.host.request({ engine: 'supertonic', voice: 'M4' });
    h.last().emit({ type: 'hello' });
    h.last().ready('cuda');
  };
  /** CUDA'da hazırken iki kez kısa sürede çöküp DirectML'e inmesini sağlar (geçici sıkışma benzetimi). */
  const dropToDirectml = (h: ReturnType<typeof setup>) => {
    h.last().exit(1);
    vi.advanceTimersByTime(25);
    h.last().emit({ type: 'hello' });
    h.last().ready('cuda');
    h.last().exit(1);
    vi.advanceTimersByTime(50);
    h.last().emit({ type: 'hello' });
    h.last().ready('directml');
  };

  it('geçici sıkışma işlemciye/alt cihaza itti → bellek boşalınca seçilen cihaza (CUDA) döner', () => {
    const h = setup();
    start(h);
    dropToDirectml(h);
    expect(h.host.state()).toMatchObject({ phase: 'ready', device: 'directml', engine: 'supertonic', voice: 'M4' });
    const count = h.children.length;
    // Hemen değil (açıp kapama savaşı olmasın); bir dakika sonra geri dönüş denenir, zincir baştan (CUDA) kurulur.
    vi.advanceTimersByTime(59_000);
    expect(h.children.length).toBe(count);
    vi.advanceTimersByTime(1_000);
    expect(h.children.length).toBe(count + 1);
    const climb = h.last();
    climb.emit({ type: 'hello' });
    expect(climb.config?.device).toBe('cuda');
    expect(climb.config?.primary).toEqual({ engine: 'supertonic', voice: 'M4' });
    climb.ready('cuda');
    // Seçilen cihaza, seçilen motor ve sesle dönüldü.
    expect(h.host.state()).toMatchObject({ phase: 'ready', device: 'cuda', engine: 'supertonic', voice: 'M4' });
    expect(h.host.info()).toMatchObject({ engine: 'supertonic', voice: 'M4', device: 'cuda' });
    // En üstte: artık geri dönüş zamanlanmaz.
    const settled = h.children.length;
    vi.advanceTimersByTime(60 * 60_000);
    expect(h.children.length).toBe(settled);
  });

  it('üst cihaz hiç açılamadıysa (donanım yok) geri dönüş denenmez: boşuna süreç açılmaz', () => {
    const h = setup();
    h.host.request({ engine: 'supertonic', voice: 'M4' });
    h.last().emit({ type: 'hello' });
    h.last().emit({ type: 'failed', stage: 'model', message: 'no CUDA-capable device' });
    const dml = h.last();
    dml.emit({ type: 'hello' });
    dml.ready('directml');
    const count = h.children.length;
    vi.advanceTimersByTime(60 * 60_000);
    // CUDA hiç HAZIR olmadı (kanıtlı değil): geri dönülmez.
    expect(h.children.length).toBe(count);
    expect(h.host.state()).toMatchObject({ phase: 'ready', device: 'directml' });
  });

  it('geri dönüş yine başarısızsa bekleme uzar (ekran kartı hâlâ doluysa savaşa girilmez)', () => {
    const h = setup();
    start(h);
    dropToDirectml(h);
    let count = h.children.length;
    // İlk geri dönüş denemesi 1 dk sonra.
    vi.advanceTimersByTime(60_000);
    expect(h.children.length).toBe(count + 1);
    const climb = h.last();
    climb.emit({ type: 'hello' });
    climb.emit({ type: 'failed', stage: 'model', message: 'CUDA out of memory' });
    // CUDA yine dolu: DirectML'e geri düşer.
    const dml = h.last();
    dml.emit({ type: 'hello' });
    dml.ready('directml');
    expect(h.host.state()).toMatchObject({ phase: 'ready', device: 'directml' });
    count = h.children.length;
    // Sonraki geri dönüş artık 1 dk'da DEĞİL (bekleme uzadı); 5 dk sonra.
    vi.advanceTimersByTime(60_000);
    expect(h.children.length).toBe(count);
    vi.advanceTimersByTime(4 * 60_000);
    expect(h.children.length).toBe(count + 1);
  });

  it('istek kaldırılınca bekleyen geri dönüş iptal olur', () => {
    const h = setup();
    start(h);
    dropToDirectml(h);
    const count = h.children.length;
    const running = h.last();
    h.host.request(null);
    vi.advanceTimersByTime(60 * 60_000);
    // Kapatıldı: çalışan süreç sonlandırıldı ve geri dönüş süreci açılmadı.
    expect(running.killed).toBe(true);
    expect(h.children.length).toBe(count);
    expect(h.host.state()).toMatchObject({ phase: 'off' });
  });
});
