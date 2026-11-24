import { CONTROL_DEFAULT_URL, DEFAULT_HOTKEYS } from './constants';
import type { Settings } from './entities';

/**
 * Seçenekli ayar alanlarının geçerli değerleri: ayarların çalışma anındaki şeması (`Settings` yalnız derleme anında
 * bilinir). Sesle ayar (`settings_set` aracı) bir seçenekli alana yalnız buradaki değerlerden birini yazar; burada
 * olmayan seçenekli alan sesle değiştirilemez. YENİ bir seçenekli alan ekleyen görev (görünüm, ses motoru, ses…)
 * değerlerini buraya da ekler; açık/kapalı (boolean) alanlar için gerekmez.
 */
export const SETTING_CHOICES: Readonly<Partial<Record<keyof Settings, readonly string[]>>> = {
  privacyMode: ['cloud', 'private'],
  uiLanguage: ['tr', 'en'],
  reducedMotion: ['system', 'on', 'off'],
  islandDisplay: ['cursor', 'primary'],
  authorityLevel: ['ask', 'smart', 'full'],
};

/**
 * Dinleme süresinin kademeleri (saniye): kısa, normal, uzun, çok uzun. Sol paneldeki Hızlı kontrol bunları sunar; sesle
 * "dinleme süreni uzat / kısalt" bir kademe ilerler ya da geriler. Cihaz ayarı (`Settings.followUpSeconds`) yalnız bu
 * değerlerle sınırlı değildir (sesle "15 saniye" de denebilir); sınır `FOLLOW_UP_MAX_SECONDS`.
 */
export const FOLLOW_UP_STEPS = [5, 10, 20, 40] as const;
/** Politika şemasıyla aynı üst sınır (`voice.followUpSeconds` en çok 120). */
export const FOLLOW_UP_MAX_SECONDS = 120;

/** Yürürlükteki dinleme süresi (sn): bu cihazın ayarı varsa o, yoksa Fuber Yönetim'in değeri. 0–120 arasına sıkıştırılır. */
export function effectiveFollowUpSeconds(settings: Pick<Settings, 'followUpSeconds'>, policy: { voice: { followUpSeconds: number } }): number {
  const own = settings.followUpSeconds;
  const value = typeof own === 'number' && Number.isFinite(own) ? own : policy.voice.followUpSeconds;
  return Math.max(0, Math.min(FOLLOW_UP_MAX_SECONDS, value));
}

/**
 * Kaldırılmış ayar alanları: eski kayıtta bulunursa okunurken atılır (kullanıcı sorunsuz yeni sürüme geçer).
 * `appearance`: demo.5'e dek "Takımyıldız / Çentik" seçimi; artık tek görünüm vardır.
 */
export const RETIRED_SETTING_KEYS = ['appearance'] as const;

/**
 * İlk açılıştaki yerel ayarlar. `projectsRoot` işletim sistemine bağlı olduğu için dışarıdan verilir
 * (varsayılan: `~/Projects`). Kayıtlı ayar okunurken eksik alanlar bununla tamamlanır.
 */
export function defaultSettings(projectsRoot: string): Settings {
  return {
    launchAtLogin: false,
    inputDeviceId: null,
    outputDeviceId: null,
    hotkeys: { ...DEFAULT_HOTKEYS },
    quietHours: { enabled: false, from: '23:00', to: '08:00' },
    dnd: false,
    dndUntil: null,
    spokenNotifications: { level: 'high', mutedModules: [] },
    privacyMode: 'cloud',
    uiLanguage: 'tr',
    reducedMotion: 'system',
    islandDisplay: 'cursor',
    projectsRoot,
    controlUrl: CONTROL_DEFAULT_URL,
    ambientConsentAt: null,
    userName: null,
    userAddress: null,
    setupCompletedAt: null,
    disabledModules: [],
    pcControlAllowed: true,
    pcReadAllowed: true,
    ttsEngine: null,
    ttsVoices: {},
    jbrowserAllowed: true,
    authorityLevel: 'smart',
    spokenProgress: true,
    followUpSeconds: null,
    developerMode: false,
    developerRepoPath: null,
  };
}
