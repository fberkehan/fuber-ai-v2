/**
 * Tek test sınırı (KURGU §13, §14). Sınamaya özgü ortam değişkenlerini okuyan TEK dosya; başka hiçbir
 * dosya `process.env.FUBER2_*` ya da `ANTHROPIC_API_KEY` okumaz. Davranış gerekiyorsa `testing` nesnesine sorulur.
 *
 * | Değişken                   | Etki                                                                         |
 * |----------------------------|------------------------------------------------------------------------------|
 * | `FUBER2_TEST=1`            | Sınama kipi: pencereler ekrana çıkmaz; aşağıdakiler yalnız bu açıkken geçerli |
 * | `FUBER2_DATA=<klasör>`     | Yalıtılmış veri kökü (sınama kipi dışında da geçerli)                        |
 * | `ANTHROPIC_API_KEY`        | Politikanın `keys.anthropic` alanına konur (gerçek Claude ile sınama)        |
 * | `ELEVENLABS_API_KEY`       | Politikanın `keys.elevenlabs` alanına konur (bulut ses; sahte sunucuyla ya da gerçek servisle) |
 * | `FUBER2_ELEVENLABS_URL`    | ElevenLabs yerine bu adres (yerel sahte sunucu: `scripts/e2e/voice/fake-elevenlabs.mjs`) |
 * | `FUBER2_TTS_GPU=0`         | Ses konağı (ekran kartı seslendirmesi) hiç başlatılmaz: cümleler Piper ile okunur (ekran kartı gerektirmeyen sınamalar) |
 * | `FUBER2_TTS_FAIL=cuda,directml` | Sayılan cihazlar ses konağında açılamamış sayılır (düşüş zinciri sınaması: CUDA → DirectML → Piper) |
 * | `FUBER2_ELEVENLABS_BUDGET` | Bu süreçte buluta gönderilebilecek en çok karakter. Gerçek servise (adres verilmemişken) varsayılan 300: bir sınama geliştiricinin kotasını bitiremez |
 * | `FUBER2_CONTROL_URL=<url>` | Kontrol servisi adresi (`Settings.controlUrl` yerine); yoksa hiçbirine bağlanmaz |
 * | `FUBER2_HOTKEYS=1`         | Genel kısayolları kaydet (sınamada varsayılan: kayıt YOK)                    |
 * | `FUBER2_SINGLE_INSTANCE=0` | Tek örnek kilidini alma                                                      |
 * | `FUBER2_SHOW_HUD=1`        | HUD yüzeyleri (ada, toast, sahne) gerçekten ekrana çıksın (odak çalmadan)    |
 * | `FUBER2_TRAY=1`            | Tepsi simgesini oluştur (sınamada varsayılan: YOK)                           |
 * | `FUBER2_FIRST_RUN=1`       | İlk açılış üretimdeki gibi: kurulum bitmemişse ilk pencere kurulum sihirbazı |
 * | `FUBER2_DENY_MIC=1`        | Mikrofon izni ses penceresine de verilmez (izin reddi sınaması)              |
 * | `FUBER2_FAKE_LAUNCH=1`     | Görünür pencere açan başlatmalar (VS Code, Gezgin, terminal, tarayıcı, uygulama) yapılmaz, kaydedilir |
 * | `FUBER2_CLAUDE_CLI`        | Claude Code CLI'si (konuşan beyin + derin beyin + uygulama içi oturumlar; üçü aynı komutu kullanır). Verilmezse sınamada Claude Code YOK sayılır (bir sınama geliştiricinin abonelik kotasından harcamasın). `real`: bu bilgisayardaki gerçek CLI · `<yol>.mjs`: sahte CLI betiği (`scripts/e2e/lib/fake-claude.mjs`: konuşan beynin kalıcı süreci, başsız koşu ve etkileşimli oturum alt kipi argümandan seçilir) |
 * | `FUBER2_PC_UIA=1`          | Bilgisayar modülünün pencere/sekme okuyucusu (UI Automation yardımcı süreci) sınamada da çalışsın (varsayılan: KAPALI) |
 * | `FUBER2_DOCS_HOME=<klasör>`| Belgeler modülünün Belgeler/Masaüstü/İndirilenler'i bu klasörün altında (gerçek belgelere bakılmaz) |
 * | `FUBER2_JBROWSER_ALLOW=<host:port,…>` | Jarvis'in tarayıcısı bu geri döngü adreslerini açabilir (yerel sahte site); başka iç ağ adresi yine kapalı |
 * | `FUBER2_V1_DATA=<klasör>`  | v1 içe aktarıcısının okuduğu eski Fuber AI veri klasörü (sentetik fikstür). Sınamada verilmezse hiçbir klasör: gerçek v1 verisine bakılmaz |
 * | `FUBER2_SELFDEV=fake[,unhealthy][,health=<sn>]` | Çekirdek geliştirme: `fake` = SAHTE kurucu (hiçbir şey kurmaz, uygulamayı kapatmaz; yapılacak işi `<data>/selfdev/fake-installer.json` dosyasına yazar), `unhealthy` = açılış sağlık denetimi başarısız sayılır, `health=<sn>` = sağlık denetimi gecikmesi |
 * | `FUBER2_CLOSE_ASK=1`       | Ana pencereyi kapatmak (X) "sor" ayarında uygulama içi kapanış diyaloğunu açsın (sınamada varsayılan: eskisi gibi tepsiye iner) |
 * | `FUBER2_JARVIS_LIVE=1`     | JARVIS MODE gerçek kaynaklara (hava, borsa, ağ gecikmesi) sınamada da gitsin (varsayılan: sınamada kaynaklar sessiz, `__fuber2Test.jarvis` ile beslenir) |
 * | `FUBER2_WATCH_LOOPBACK=1`  | İşler modülünün sayfa gözcüsü geri döngüdeki (127.0.0.1, her port) sahte sunucuya bağlanabilsin (SSRF kapısının yalnız sınama istisnası) |
 *
 * Sınama kipinde gerçek fare/klavye girdisi ASLA üretilmez (koşulsuz): bilgisayar modülü kaydeden sürücüyle çalışır,
 * olaylar `__fuber2Test.pcInput` dizisine düşer.
 *
 * Sınama kipinde ayrıca: varlık algısı makinenin o anki haline bakmaz (sabit "uygun"; sınama değiştirir),
 * Windows'la başlama kaydına dokunulmaz ve ana süreçte `globalThis.__fuber2Test` denetim nesnesi açılır
 * (`scripts/e2e` betikleri `electronApp.evaluate` ile kullanır).
 */

import {
  nowIso,
  type Bus,
  type Policy,
  type PolicyApi,
  type PresenceApi,
  type PresenceState,
  type Settings,
  type SettingsApi,
} from '@fuber/shared';

const enabled = process.env.FUBER2_TEST === '1';
const read = (name: string): string | null => (enabled ? process.env[name]?.trim() || null : null);

// Anahtarlar bu dosyanın dışına yalnız politika içinde çıkar; günlüğe ve `testing` nesnesine yazılmaz.
const anthropicKey = read('ANTHROPIC_API_KEY');
const elevenLabsKey = read('ELEVENLABS_API_KEY');
const elevenLabsUrl = read('FUBER2_ELEVENLABS_URL');
/** Gerçek servise giden sınamada üst sınır her zaman vardır. */
const REAL_ELEVENLABS_DEFAULT_BUDGET = 300;
const elevenLabsBudget = ((): number | undefined => {
  const given = Number.parseInt(read('FUBER2_ELEVENLABS_BUDGET') ?? '', 10);
  if (Number.isInteger(given) && given >= 0) return given;
  return elevenLabsKey && !elevenLabsUrl ? REAL_ELEVENLABS_DEFAULT_BUDGET : undefined;
})();
// Adres verilmediyse sınama hiçbir kontrol servisine bağlanmaz: varsayılan porttaki gerçek Fuber Yönetim'e
// sınama cihazı kaydolmasın diye kapalı bir porta (discard, 9) bakar ve çevrimdışı kalır.
const controlUrl = read('FUBER2_CONTROL_URL') ?? (enabled ? 'http://127.0.0.1:9' : null);

/**
 * Claude Code komutu (konuşan beyin, derin beyin ve uygulama içi oturumlar). Üretimde `auto` (bilinen yerlerde aranır). Sınamada (uçtan uca ve birim) varsayılan
 * `null`: gerçek CLI yalnız açıkça `FUBER2_CLAUDE_CLI=real` denince kullanılır. Betik yolu verilirse o betik, bu sürecin
 * çalıştırıcısıyla (Electron'da `ELECTRON_RUN_AS_NODE`) koşturulur.
 */
export type ClaudeCliChoice = 'auto' | null | { command: string; prefixArgs: string[]; env?: Record<string, string> };
const claudeCli = ((): ClaudeCliChoice => {
  const underVitest = process.env.VITEST === 'true';
  if (!enabled && !underVitest) return 'auto';
  const given = process.env.FUBER2_CLAUDE_CLI?.trim();
  if (!given) return null;
  if (given === 'real') return 'auto';
  if (/\.(mjs|js|cjs)$/i.test(given)) {
    return { command: process.execPath, prefixArgs: [given], ...(process.versions.electron ? { env: { ELECTRON_RUN_AS_NODE: '1' } } : {}) };
  }
  return { command: given, prefixArgs: [] };
})();

/** `FUBER2_SELFDEV`: virgülle ayrılmış anahtarlar (`fake`, `unhealthy`, `health=<sn>`). */
const selfdevOptions = ((): { fake: boolean; unhealthy: boolean; healthDelaySeconds: number | null } => {
  const parts = (read('FUBER2_SELFDEV') ?? '').split(',').map((item) => item.trim());
  const delay = parts.find((item) => item.startsWith('health='));
  const seconds = delay ? Number.parseInt(delay.slice(7), 10) : NaN;
  return { fake: parts.includes('fake'), unhealthy: parts.includes('unhealthy'), healthDelaySeconds: Number.isInteger(seconds) && seconds >= 0 ? seconds : null };
})();

const ttsFailDevices = (list: string): Array<'cuda' | 'directml' | 'cpu'> =>
  list
    .split(',')
    .map((item) => item.trim())
    .filter((item): item is 'cuda' | 'directml' | 'cpu' => item === 'cuda' || item === 'directml' || item === 'cpu');

/** Sınama betiklerinin ana süreçte ulaştığı denetim nesnesi. Sınama kipi dışında hiç oluşmaz. */
const hooks: Record<string, unknown> = {};
if (enabled) (globalThis as { __fuber2Test?: Record<string, unknown> }).__fuber2Test = hooks;

/** Sahte başlatıcının kaydettiği bir başlatma (`__fuber2Test.launches`). */
export interface FakeLaunchRecord {
  kind: 'spawn' | 'openPath' | 'openExternal';
  /** Çalıştırılacak dosya, açılacak yol ya da adres. */
  target: string;
  args: string[];
  cwd: string | null;
  at: string;
}
const launches: FakeLaunchRecord[] = [];
const fakeLaunch = enabled && process.env.FUBER2_FAKE_LAUNCH === '1';
if (fakeLaunch) hooks.launches = launches;
const recordLaunch = (kind: FakeLaunchRecord['kind'], target: string, args: string[] = [], cwd: string | null = null): void => {
  launches.push({ kind, target, args, cwd, at: nowIso() });
};

/** Bilgisayar modülünün sınamada ÜRETMEDİĞİ, yalnız kaydettiği girdi olayları (`__fuber2Test.pcInput`). */
const pcInput: unknown[] = [];
if (enabled) hooks.pcInput = pcInput;

/** `target`'ı sarar: `get()` sonucu `overlay`'den geçer, diğer her şey olduğu gibi kalır. */
function overlayGet<T extends { get(): V }, V>(target: T, overlay: (value: V) => V): T {
  return new Proxy(target, {
    get(inner, prop) {
      if (prop === 'get') return () => overlay(inner.get());
      const value: unknown = Reflect.get(inner, prop, inner);
      return typeof value === 'function' ? value.bind(inner) : value;
    },
  });
}

export const testing = {
  /** Uçtan uca sınama koşusu. Pencereler ekrana çıkmaz, odak çalmaz. */
  enabled,
  /** Yalıtılmış veri kökü; verilmişse `%APPDATA%\Fuber AI 2` yerine bu kullanılır. */
  dataDir: process.env.FUBER2_DATA?.trim() || null,
  /** Tek örnek kilidi alınsın mı. Kilit veri köküne bağlıdır; ayrı `FUBER2_DATA` zaten ayrı kilittir. */
  singleInstanceLock: !(enabled && process.env.FUBER2_SINGLE_INSTANCE === '0'),
  /** Genel kısayollar kaydedilsin mi. Sınamada kapalı: v1 ve paralel sınamalar aynı tuşları tutabilir. */
  hotkeys: !enabled || process.env.FUBER2_HOTKEYS === '1',
  /** Sınamada kullanılan kontrol servisi adresi; sınama kipi dışında `null`. */
  controlUrl,
  /** Sınamada HUD yüzeyleri gerçekten gösterilsin mi (odak ve tıklama ölçümleri gerçek pencere ister). */
  showHud: enabled && process.env.FUBER2_SHOW_HUD === '1',
  /** Tepsi simgesi oluşturulsun mu. Sınamada kapalı: her koşu görev çubuğuna simge bırakmasın. */
  tray: !enabled || process.env.FUBER2_TRAY === '1',
  /**
   * Sınamada ilk pencere üretimdeki kurala göre mi seçilsin (kurulum bitmemişse sihirbaz). Varsayılan: sınama
   * doğrudan ana pencereyle açılır; kurulum akışını sınayan betik bunu açar.
   */
  firstRunSetup: enabled && process.env.FUBER2_FIRST_RUN === '1',
  /** Mikrofon izni reddedilsin mi (izin reddi yolunun sınaması: uygulama yazıyla çalışmayı sürdürmeli). */
  denyMic: enabled && process.env.FUBER2_DENY_MIC === '1',
  /**
   * Toplantı sınamasında bilgisayar sesi GERÇEK Windows loopback'ten alınsın mı (`FUBER2_REAL_LOOPBACK=1`). Yalnız
   * yakalamadır: hoparlöre hiçbir şey çalınmaz; akışın açıldığını, izin zincirini ve örnek hızını kanıtlar. Kapalıyken
   * sınama kipi `getDisplayMedia` çağırmaz (betik sesi kullanılır).
   */
  realLoopback: enabled && process.env.FUBER2_REAL_LOOPBACK === '1',
  /**
   * Sahte başlatıcı açık mı. Açıkken bir şey açan modüller (projeler, bilgisayar) gerçek süreç başlatmaz ve kabuğa
   * gitmez; aşağıdaki sahteleri kullanır. Gece sınamaları geliştiricinin ekranında pencere bırakmasın diye.
   */
  fakeLaunch,
  /**
   * v1 veri klasörünün yerine geçen klasör: sınamada `FUBER2_V1_DATA` ya da `null` (klasör yok sayılır);
   * sınama dışında `undefined` (gerçek `%APPDATA%\Fuber AI` kullanılır).
   */
  v1DataDir: enabled ? process.env.FUBER2_V1_DATA?.trim() || null : undefined,
  /** `child_process.spawn` yerine: süreci başlatmaz, kaydeder; "ayakta kalan süreç" gibi davranan bir nesne döner. */
  fakeSpawn(file: string, args: readonly string[], options: { cwd?: string | URL }): import('node:child_process').ChildProcess {
    recordLaunch('spawn', file, [...args], options.cwd ? String(options.cwd) : null);
    const noop = () => child;
    const child = { pid: 0, stderr: null, exitCode: null, on: noop, once: noop, off: noop, unref() {}, kill: () => true } as unknown as import('node:child_process').ChildProcess;
    return child;
  },
  /** `shell.openPath` / `shell.openExternal` yerine: açmaz, kaydeder. */
  fakeShell: {
    async openPath(target: string): Promise<string> {
      recordLaunch('openPath', target);
      return '';
    },
    async openExternal(url: string): Promise<void> {
      recordLaunch('openExternal', url);
    },
  },
  /** Claude Code komutu: derin beyin ve oturum yönetimi aynısını kullanır (yukarıdaki kural). */
  claudeCli,
  /**
   * Fare/klavye girdisi sahte mi. Sınamada HER ZAMAN: bir sınama geliştiricinin ekranına tuş basamaz, imleci oynatamaz,
   * pencere kapatamaz. Bilgisayar modülü olayları `recordInput` ile buraya bırakır.
   */
  fakeInput: enabled,
  recordInput(event: unknown): void {
    pcInput.push(event);
  },
  /**
   * Pencere/sekme okuyucusu (UI Automation yardımcı süreci) başlatılsın mı. Sınamada varsayılan kapalı: her koşu bir
   * PowerShell süreci açmasın ve geliştiricinin açık pencere başlıkları sınama çıktısına karışmasın.
   */
  pcUia: !enabled || process.env.FUBER2_PC_UIA === '1',
  /**
   * Belgeler modülünün "ev" klasörü (`FUBER2_DOCS_HOME`): Belgeler, Masaüstü ve İndirilenler bunun altında aranır.
   * Sınamada verilmezse veri kökünün altındaki boş bir klasördür: sınama geliştiricinin gerçek belgelerine HİÇ bakmaz.
   */
  documentsHome: read('FUBER2_DOCS_HOME'),
  /**
   * Projeler modülünün ev klasörü (`FUBER2_PROJECTS_HOME`): `~/.claude` (Claude Code oturumları) ve proje kökleri bunun
   * altında aranır. `launch.mjs` betik `USERPROFILE` vermediyse bunu veri kökünde boş bir klasöre kurar: sınama geliştiricinin
   * GERÇEK oturum başlıklarını okumaz, görüntüye de koymaz.
   */
  projectsHome: read('FUBER2_PROJECTS_HOME'),
  /** Pencerenin X'i "sor" ayarında kapanış diyaloğunu açsın mı. Sınamada varsayılan kapalı: eski betikler gizlenme bekler. */
  closeAsk: enabled && process.env.FUBER2_CLOSE_ASK === '1',
  /** İşler modülünün sayfa gözcüsü geri döngü adresine (sahte sınama sunucusu) bağlanabilir mi. Yalnız sınamada. */
  watchLoopback: enabled && process.env.FUBER2_WATCH_LOOPBACK === '1',
  /** JARVIS MODE kaynakları sınamada da gerçek ağa/sisteme gitsin mi (ekran görüntüsü kanıtı için). */
  jarvisLive: enabled && process.env.FUBER2_JARVIS_LIVE === '1',
  /**
   * Jarvis'in tarayıcısının sınamada açabildiği geri döngü adresleri (`host:port`; yerel sahte site). Sınama dışında HER ZAMAN
   * boş: üretimde iç ağ ve bu bilgisayar açılmaz.
   */
  jbrowserAllow: (read('FUBER2_JBROWSER_ALLOW') ?? '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => /^(127\.0\.0\.1|localhost|\[::1\]|::1):\d{1,5}$/.test(item)) as readonly string[],
  /** Çekirdek geliştirme sınaması (`FUBER2_SELFDEV`; yalnız sınama kipinde). */
  selfdev: selfdevOptions,
  /** İşletim sistemine kalıcı kayıt (Windows'la başlama) yazılabilir mi. Sınamada ASLA. */
  systemIntegration: !enabled,

  /** Politikayı sarar: sınamada ortamdaki anahtarlar `keys.anthropic` / `keys.elevenlabs` olarak görünür. */
  wrapPolicy<T extends PolicyApi>(policy: T): T {
    if (!anthropicKey && !elevenLabsKey) return policy;
    return overlayGet<T, Policy>(policy, (value) => ({
      ...value,
      keys: {
        ...value.keys,
        ...(anthropicKey ? { anthropic: anthropicKey } : {}),
        ...(elevenLabsKey ? { elevenlabs: elevenLabsKey } : {}),
      },
    }));
  },

  /**
   * Ses servisinin sınama seçenekleri: sahte ElevenLabs adresi ve karakter üst sınırı, ses konağının kapatılması ve
   * açılamamış sayılacak cihazlar. Sınama dışında boştur.
   */
  voiceOptions: {
    ...(elevenLabsUrl ? { elevenLabsBaseUrl: elevenLabsUrl } : {}),
    ...(elevenLabsBudget !== undefined ? { elevenLabsCharBudget: elevenLabsBudget } : {}),
    ...(read('FUBER2_TTS_GPU') === '0' ? { gpuTts: false } : {}),
    ...(read('FUBER2_TTS_FAIL') ? { ttsFailDevices: ttsFailDevices(read('FUBER2_TTS_FAIL') ?? '') } : {}),
  } as { elevenLabsBaseUrl?: string; elevenLabsCharBudget?: number; gpuTts?: boolean; ttsFailDevices?: Array<'cuda' | 'directml' | 'cpu'> },

  /** Ayarları sarar: sınamada kontrol servisi adresi ortamdan gelir. */
  wrapSettings(settings: SettingsApi): SettingsApi {
    if (!controlUrl) return settings;
    return overlayGet<SettingsApi, Settings>(settings, (value) => ({ ...value, controlUrl }));
  },

  /**
   * Varlık algısını sarar: sınamada sonuç makinenin o anki haline (kilitli ekran, tam ekran video, açık toplantı)
   * bağlı olmasın diye durum sabit "uygun"dur ve yalnız `__fuber2Test.setPresence(yama)` ile değişir.
   * Gerçek ölçüm `__fuber2Test.realPresence` üzerinden istenince alınır.
   */
  wrapPresence(presence: PresenceApi, bus: Bus): PresenceApi {
    if (!enabled) return presence;
    const normal = (): PresenceState => ({
      mode: 'normal',
      fullscreen: false,
      meeting: false,
      cameraInUse: false,
      micInUseByOther: false,
      quiet: false,
      idleSeconds: 0,
      since: nowIso(),
    });
    let forced = normal();
    hooks.setPresence = (patch: Partial<PresenceState> | null) => {
      forced = { ...normal(), ...patch };
      bus.emit('presence.changed', forced);
      return forced;
    };
    hooks.realPresence = presence;
    return { start() {}, stop() {}, get: () => forced, refresh: () => forced };
  },

  /** Sınama betiklerine ana süreç nesnelerini açar (`globalThis.__fuber2Test`). Sınama kipi dışında hiçbir şey yapmaz. */
  expose(values: Record<string, unknown>): void {
    if (enabled) Object.assign(hooks, values);
  },
} as const;
