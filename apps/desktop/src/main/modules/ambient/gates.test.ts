// Kapıların tamamı, sahte saatle. Her satır bir koşuldur; kapı kararı modele bırakılmaz.
import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, defaultSettings, mergePolicy, parsePolicy } from '@fuber/shared';
import { hourlyLimit, interjectGate, isQuietNow, listenGate, pauseUntil, SPEECH_SETTLE_MS, type InterjectInput, type ListenInput } from './gates';
import { windowClosed, WINDOW_MAX_AGE_MS, WINDOW_MAX_LINES, WINDOW_SILENCE_MS } from './note-taker';

const NOW = new Date(2026, 10, 16, 14, 0, 0); // Pazartesi 14:00
const HOURS_OFF = { enabled: false, from: '09:00', to: '19:00', days: [1, 2, 3, 4, 5] };

const listen = (patch: Partial<ListenInput> = {}): ListenInput => ({
  now: NOW,
  killSwitch: false,
  allowed: true,
  consentAt: '2026-11-15T09:00:00.000Z',
  prefs: { enabled: true, hours: HOURS_OFF, pauseWhenLocked: true },
  pausedUntil: null,
  micMuted: false,
  quiet: false,
  locked: false,
  feedReady: true,
  ...patch,
});

describe('dinleme kapısı', () => {
  it('hepsi tutuyorsa dinler', () => {
    expect(listenGate(listen())).toBe('ok');
  });

  it.each([
    ['Yönetim acil durdurma', { killSwitch: true }, 'kill_switch'],
    ['Yönetim izni yok', { allowed: false }, 'policy'],
    ['rıza yok', { consentAt: null }, 'no_consent'],
    ['kullanıcı kapatmış', { prefs: { enabled: false, hours: HOURS_OFF, pauseWhenLocked: true } }, 'disabled'],
    ['duraklatılmış', { pausedUntil: new Date(NOW.getTime() + 60_000).toISOString() }, 'paused'],
    ['mikrofon kapalı', { micMuted: true }, 'mic_off'],
    ['sessiz saatler', { quiet: true }, 'quiet_hours'],
    ['dinleme saatleri dışında', { now: new Date(2026, 10, 16, 20, 0), prefs: { enabled: true, hours: { ...HOURS_OFF, enabled: true }, pauseWhenLocked: true } }, 'outside_hours'],
    ['hafta sonu, dinleme günü değil', { now: new Date(2026, 10, 15, 12, 0), prefs: { enabled: true, hours: { ...HOURS_OFF, enabled: true }, pauseWhenLocked: true } }, 'outside_hours'],
    ['ekran kilitli', { locked: true }, 'locked'],
    ['ses hattı döküm vermiyor', { feedReady: false }, 'no_feed'],
  ] as const)('%s → dinlemez', (_name, patch, reason) => {
    expect(listenGate(listen(patch as Partial<ListenInput>))).toBe(reason);
  });

  it('rıza ve izin her şeyden önce gelir: ayar açık olsa da rızasız dinlenmez', () => {
    expect(listenGate(listen({ consentAt: null, prefs: { enabled: true, hours: HOURS_OFF, pauseWhenLocked: false } }))).toBe('no_consent');
    expect(listenGate(listen({ allowed: false, consentAt: null }))).toBe('policy');
  });

  it('süresi dolan duraklatma engel değildir; kilit tercihi kapalıysa kilitliyken de dinler', () => {
    expect(listenGate(listen({ pausedUntil: new Date(NOW.getTime() - 1000).toISOString() }))).toBe('ok');
    expect(listenGate(listen({ locked: true, prefs: { enabled: true, hours: HOURS_OFF, pauseWhenLocked: false } }))).toBe('ok');
  });

  it('"şimdi duraklat": 15 dk, 1 saat, bugün (yerel gün bitimi)', () => {
    expect(Date.parse(pauseUntil('15m', NOW)) - NOW.getTime()).toBe(15 * 60_000);
    expect(Date.parse(pauseUntil('1h', NOW)) - NOW.getTime()).toBe(60 * 60_000);
    expect(new Date(pauseUntil('today', NOW))).toEqual(new Date(2026, 10, 17, 0, 0, 0));
  });

  it('sessiz saat ve rahatsız etme', () => {
    const base = defaultSettings('C:/tmp');
    expect(isQuietNow(base, NOW)).toBe(false);
    expect(isQuietNow({ ...base, dnd: true }, NOW)).toBe(true);
    expect(isQuietNow({ ...base, dnd: true, dndUntil: new Date(NOW.getTime() - 1000).toISOString() }, NOW)).toBe(false);
    expect(isQuietNow({ ...base, quietHours: { enabled: true, from: '23:00', to: '08:00' } }, new Date(2026, 10, 16, 23, 30))).toBe(true);
    expect(isQuietNow({ ...base, quietHours: { enabled: true, from: '23:00', to: '08:00' } }, NOW)).toBe(false);
  });
});

const T = NOW.getTime();
const NORMAL = { mode: 'normal', fullscreen: false, meeting: false, cameraInUse: false, micInUseByOther: false } as const;
const interject = (patch: Partial<InterjectInput> = {}): InterjectInput => ({
  now: T,
  listening: true,
  mode: 'on',
  brain: 'local',
  companion: true,
  presence: NORMAL,
  quiet: false,
  maxPerHour: 3,
  hushedToday: false,
  countLastHour: 0,
  consultsLastHour: 0,
  lastInterjectionAt: null,
  minGapSeconds: 180,
  voiceState: 'idle',
  lastSpeechEndedAt: T - 5000,
  evaluating: false,
  ...patch,
});

describe('araya girme kapısı', () => {
  it('hepsi tutuyorsa açık', () => {
    expect(interjectGate(interject())).toBe('ok');
  });

  it.each([
    ['dinleme kapalı', { listening: false }, 'not_listening'],
    ['politika: kapalı', { mode: 'off' }, 'policy_off'],
    ['politika: yalnız bulut, beyin yerelde', { mode: 'cloud-only', brain: 'local' }, 'needs_cloud'],
    ['politika: yalnız bulut, beyin yok', { mode: 'cloud-only', brain: 'none' }, 'needs_cloud'],
    ['politika: açık ama beyin yok', { mode: 'on', brain: 'none' }, 'needs_cloud'],
    ['kullanıcı eşlikçiyi kapatmış', { companion: false }, 'user_off'],
    ['tam ekran', { presence: { ...NORMAL, fullscreen: true } }, 'fullscreen'],
    ['tam ekran (özet kip)', { presence: { ...NORMAL, mode: 'fullscreen' } }, 'fullscreen'],
    ['toplantı', { presence: { ...NORMAL, meeting: true } }, 'meeting'],
    ['mikrofonu başka uygulama kullanıyor', { presence: { ...NORMAL, micInUseByOther: true } }, 'meeting'],
    ['kamera açık', { presence: { ...NORMAL, cameraInUse: true } }, 'meeting'],
    ['toplantı (özet kip)', { presence: { ...NORMAL, mode: 'meeting' } }, 'meeting'],
    ['sessiz saatler', { quiet: true }, 'quiet_hours'],
    ['rahatsız etme (varlık)', { presence: { ...NORMAL, mode: 'quiet' } }, 'quiet_hours'],
    ['saatlik sınır doldu', { countLastHour: 3 }, 'hourly_limit'],
    ['saatlik sınır sıfır', { maxPerHour: 0 }, 'hourly_limit'],
    // Bulut kotası: "değmez" yanıtı da sayılır; saatte en çok politika değeri kadar danışılır.
    ['saatlik danışma sınırı doldu', { consultsLastHour: 3 }, 'hourly_limit'],
    ['"sus" denen gün danışma sınırı yarıda', { consultsLastHour: 1, hushedToday: true }, 'hourly_limit'],
    ['son araya girmeden 3 dk geçmedi', { lastInterjectionAt: T - 179_000 }, 'min_gap'],
    ['sesli tur sürüyor: dinliyor', { voiceState: 'listening' }, 'user_speaking'],
    ['sesli tur sürüyor: düşünüyor', { voiceState: 'thinking' }, 'user_speaking'],
    ['asistan konuşuyor', { voiceState: 'speaking' }, 'user_speaking'],
    ['takip penceresi', { voiceState: 'followup' }, 'user_speaking'],
    ['kullanıcı az önce konuştu', { lastSpeechEndedAt: T - (SPEECH_SETTLE_MS - 1) }, 'user_speaking'],
    ['önceki değerlendirme sürüyor', { evaluating: true }, 'busy'],
  ] as const)('%s → girmez', (_name, patch, reason) => {
    expect(interjectGate(interject(patch as Partial<InterjectInput>))).toBe(reason);
  });

  it('yalnız bulut kipinde bulut beyni çalışıyorsa açık', () => {
    expect(interjectGate(interject({ mode: 'cloud-only', brain: 'cloud' }))).toBe('ok');
  });

  it('toplantı ve tam ekran saatlik sınırdan ve aralıktan önce gelir (sıra)', () => {
    expect(interjectGate(interject({ presence: { ...NORMAL, meeting: true }, countLastHour: 9, lastInterjectionAt: T - 1000 }))).toBe('meeting');
    expect(interjectGate(interject({ presence: { ...NORMAL, fullscreen: true, meeting: true } }))).toBe('fullscreen');
  });

  it('sınırlar: saatte en çok N, tam aralıkta açılır, sessizlik dolunca açılır', () => {
    expect(interjectGate(interject({ countLastHour: 2 }))).toBe('ok');
    expect(interjectGate(interject({ consultsLastHour: 2 }))).toBe('ok');
    expect(interjectGate(interject({ lastInterjectionAt: T - 180_000 }))).toBe('ok');
    expect(interjectGate(interject({ lastSpeechEndedAt: T - SPEECH_SETTLE_MS }))).toBe('ok');
    expect(interjectGate(interject({ minGapSeconds: 0, lastInterjectionAt: T }))).toBe('ok');
  });

  it('kullanıcı "sus" dediyse o gün sınır yarıya iner', () => {
    expect(hourlyLimit(3, false)).toBe(3);
    expect(hourlyLimit(3, true)).toBe(1);
    expect(hourlyLimit(1, true)).toBe(0);
    expect(interjectGate(interject({ hushedToday: true, countLastHour: 1 }))).toBe('hourly_limit');
    expect(interjectGate(interject({ hushedToday: true, countLastHour: 0 }))).toBe('ok');
    expect(interjectGate(interject({ hushedToday: true, maxPerHour: 1 }))).toBe('hourly_limit');
  });
});

describe('dönem kapanışı', () => {
  const at = (minutesAgo: number, text = 'bir şeyler konuşuldu') => {
    const started = new Date(NOW.getTime() - minutesAgo * 60_000);
    return { text, startedAt: started.toISOString(), endedAt: new Date(started.getTime() + 2000).toISOString() };
  };

  it('bekleyen yoksa ya da konuşma sürüyorsa kapanmaz', () => {
    expect(windowClosed([], NOW)).toBe(false);
    expect(windowClosed([at(2), at(1)], NOW)).toBe(false);
  });

  it('sessizlik, satır sayısı, harf sayısı ya da yaş dönemi kapatır', () => {
    expect(windowClosed([at(6), at(WINDOW_SILENCE_MS / 60_000 + 0.1)], NOW)).toBe(true);
    expect(windowClosed(Array.from({ length: WINDOW_MAX_LINES }, () => at(0.5)), NOW)).toBe(true);
    expect(windowClosed([at(0.5, 'a'.repeat(1000)), at(0.2, 'b'.repeat(900))], NOW)).toBe(true);
    expect(windowClosed([at(WINDOW_MAX_AGE_MS / 60_000 + 0.5), at(0.2)], NOW)).toBe(true);
  });
});

describe('politika alanları', () => {
  it('varsayılan: Yönetim izni kapalı, modül kapalı, ham döküm 7 gün, araya girme yalnız bulut beyninde', () => {
    expect(DEFAULT_POLICY.ambient).toEqual({ allowed: false, maxInterjectionsPerHour: 3, minGapSeconds: 180, retentionDays: 7, interjections: 'cloud-only' });
    expect(DEFAULT_POLICY.modules.ambient?.enabled).toBe(false);
    expect(defaultSettings('C:/tmp').ambientConsentAt).toBeNull();
  });

  it('eski sürümün yazdığı politika (yeni alanlar yok) varsayılanlarla açılır', () => {
    const old = { ...DEFAULT_POLICY, ambient: { allowed: true, maxInterjectionsPerHour: 2, minGapSeconds: 60 } };
    expect(parsePolicy(old)?.ambient).toEqual({ allowed: true, maxInterjectionsPerHour: 2, minGapSeconds: 60, retentionDays: 7, interjections: 'cloud-only' });
  });

  it('ham döküm süresi Yönetim’den de 7 günün üstüne çıkarılamaz; kısaltılabilir ve araya girme kapatılabilir', () => {
    expect(() => mergePolicy(DEFAULT_POLICY, { ambient: { retentionDays: 8 } })).toThrow();
    expect(() => mergePolicy(DEFAULT_POLICY, { ambient: { retentionDays: 0 } })).toThrow();
    expect(mergePolicy(DEFAULT_POLICY, { ambient: { retentionDays: 3, interjections: 'off' } }).ambient).toMatchObject({ retentionDays: 3, interjections: 'off' });
  });
});
