// Öz-durum (kendini bilme): asistanın o anki GERÇEK çalışma durumu ve bunun isteme giren kısa metni.
// İlk denemelerde model, sesi ElevenLabs bulutundan gelirken "her şey bu bilgisayarda" dedi: istemde durumu
// anlatan hiçbir şey yoktu, model tahmin etti. Bu dosya durumu tahmin edilemez kılar: metin yalnız servislerin
// bildirdiği değerlerden üretilir; bilinmeyen alan "bilinmiyor" diye yazılır, uydurulmaz.
import { t, type BrainCloudIssue, type BrainStatus, type ControlStatus, type TtsDevice, type TtsEngineId } from '@fuber/shared';
import { buildClusters, deepLabelOf, type SelfCluster, type SelfControls } from './self-catalog';

/** Ses hattının o anki durumu (ses servisinin durum ve tanı yüzünden okunur). */
export interface SelfVoiceState {
  /** Ses hattı kullanıma hazır mı. */
  ready: boolean;
  /** Yazıya çevirme: sağlayıcı ve (yerelse) ekran kartında mı. */
  stt: { provider: 'whisper-local' | 'elevenlabs-scribe'; gpu: boolean | null };
  /**
   * Seslendirme: seçili motor, o an GERÇEKTEN seslendiren motor, o motorun çalıştığı yer (`cuda` / `directml` ekran
   * kartı, `cpu` işlemci, `cloud` bulut; bilinmiyorsa `null`) ve (seçili motor konuşmuyorsa) nedeni.
   */
  tts: { provider: TtsEngineId; active: TtsEngineId; device?: TtsDevice | null; fallbackReason: string | null };
  micMuted: boolean;
  /** Sessiz kip: sesli yanıt yok, yalnız yazı. */
  quiet: boolean;
  /** Yürürlükteki söz kesme kipi. */
  bargeIn: 'voice' | 'wake' | 'off';
  wakePaused: boolean;
  /** Sohbet kipi açık mı (uyandırma sözü gerekmeden konuşma). */
  conversation: boolean;
  /** Toplantı kipi açık mı (iki taraf yazıya dökülüyor; sesli yanıt yok, uyandırma sözü kapalı). Bilinmiyorsa yok. */
  meeting?: boolean;
}

/** Beynin kendisinin bilemediği kısım; ses denetimi modülü çalışma anında sağlar. */
export interface SelfSource {
  voice: SelfVoiceState | null;
  /** Fuber Yönetim bağlantısı. */
  admin: ControlStatus['state'] | null;
  /** Gerçekte kayıtlı kısayollar (konuşma diline çevrilmiş: "Ctrl+Alt+J"); boşsa tuş alınamamış. */
  hotkeys: { talk: string; mute: string } | null;
  /** Bilgisayar izinleri (Ayarlar): fare/klavye ile kullanma ve ekranı/pencereleri okuma. Ayar yoksa `null`. */
  pc?: SelfPcPermissions | null;
  /** Ayar katalogları (yalnız adlar: sesle değişen, Yönetim'in yönettiği, yalnız Ayarlar'dan değişen); öz-tanıma girer. */
  controls?: SelfControls | null;
  /** Süren arka plan işleri (iş servisi: araştırma, yetenek geliştirme…), tek satırlık; okunamadıysa `null`. */
  work?: string[] | null;
}

export interface SelfPcPermissions {
  control: boolean | null;
  read: boolean | null;
}

/** Bir yetenek ailesi ve o an kullanılabilir mi. */
export interface SelfCapability {
  /** Kimlik: `group:<küme>` (bir araç kümesi) ya da `deep:<araç>` (derin beyin isteyen tek iş). */
  id?: string;
  label: string;
  available: boolean;
  /** Kullanılamıyorsa neye bağlı olduğu ("bulut beyni gerekir; şu an yok"). */
  needs: string | null;
}

export interface SelfState {
  appName: string;
  appVersion: string;
  brain: {
    /** Turları o an yürüten beyin. */
    provider: BrainStatus['provider'];
    reason: BrainStatus['reason'];
    cause: BrainCloudIssue | null;
    /** Yürüten modelin kimliği (yerelde `policy.brain.local.modelId`, bulutta sesli rolün modeli). */
    model: string;
    /** Sesli rolün bulut sağlayıcısının adı ("Anthropic", "OpenRouter", "Claude Code"); bilinmiyorsa yok. */
    cloudName?: string;
    /** Asıl beyin bu bilgisayardaki Claude Code mu (kullanıcının aboneliğiyle; API anahtarı ve dolar harcaması yok). */
    claudeCode?: boolean;
    /** Derin beyin (yetenek geliştirme, araştırma, ekrana bakma) şu an çalışabilir mi; çalışamıyorsa neden. */
    deep: SelfDeepState;
  };
  voice: SelfVoiceState | null;
  admin: ControlStatus['state'] | null;
  hotkeys: { talk: string; mute: string } | null;
  pc?: SelfPcPermissions | null;
  capabilities: SelfCapability[];
  /** Süren işler (iş servisi + modüllerin bildirdikleri: takip işleri); bilinmiyorsa yok ya da `null`. */
  work?: string[] | null;
  /** Yürürlükteki yetki düzeyi (araç kapısı): model "yapayım mı" diye sorup sormayacağını buradan bilir. */
  authority?: 'ask' | 'smart' | 'full';
}

/**
 * Derin beynin durumu. `provider`: işi yürütecek sağlayıcı (Anthropic API ya da bu bilgisayardaki Claude Code);
 * `known: false` durumun henüz yoklanmadığını söyler ("bilinmiyor" yazılır, uydurulmaz).
 */
export interface SelfDeepState {
  ok: boolean;
  reason: string | null;
  provider?: 'anthropic' | 'claude-code' | null;
  known?: boolean;
}

/** `BrainStatus.deep` alanının burada okunan kısmı (alan `d2-kopru` dalında tanımlı; yapısal olarak okunur). */
export interface DeepStatusLike {
  ok: boolean;
  provider?: 'anthropic' | 'claude-code' | null;
  reason?: string | null;
}

/**
 * Öz-durumun derin beyin kısmı. Kaynak `BrainStatus.deep`'tir; alan yoksa (onu doldurmayan eski bir beyin servisi ya da
 * sınama sahtesi) beynin kendi hesabı (`own`) kullanılır. Alan var ama henüz yoklanmamışsa (sağlayıcı da neden de yok)
 * durum "bilinmiyor"dur.
 */
export function deepFromStatus(reported: DeepStatusLike | undefined, own: { ok: boolean; reason: string | null }): SelfDeepState {
  if (!reported) return { ...own, known: true };
  if (reported.ok) return { ok: true, reason: null, provider: reported.provider ?? null, known: true };
  if (!reported.provider && !reported.reason) return { ok: false, reason: null, provider: null, known: false };
  return { ok: false, reason: reported.reason ?? null, provider: reported.provider ?? null, known: true };
}

const DEEP_WORK = 'yetenek geliştirme, araştırma, ekrana bakma';

/** "Derin işler var mı, hangi sağlayıcıyla" satırı. */
function deepLine(deep: SelfDeepState): string {
  if (deep.known === false) return `Derin işler (${DEEP_WORK}): durumu bilinmiyor.`;
  if (!deep.ok) return `Derin işler (${DEEP_WORK}): şu an YOK${deep.reason ? ` (${deep.reason.replace(/\.$/, '')})` : ''}.`;
  if (deep.provider === 'claude-code') return `Derin işler (${DEEP_WORK}): ÇALIŞIYOR; bu bilgisayardaki Claude Code ile yürür.`;
  if (deep.provider === 'anthropic') return `Derin işler (${DEEP_WORK}): ÇALIŞIYOR; Anthropic bulutunda yürür.`;
  return `Derin işler (${DEEP_WORK}): ÇALIŞIYOR.`;
}

/** Bilgisayar izinleri satırı; ikisi de bilinmiyorsa boş. */
function pcLine(pc: SelfPcPermissions | null | undefined): string | null {
  if (!pc || (pc.control === null && pc.read === null)) return null;
  const word = (value: boolean | null) => (value === null ? 'bilinmiyor' : value ? 'AÇIK' : 'KAPALI');
  return `Bilgisayar izinleri: fareyi/klavyeyi kullanma ${word(pc.control)}; ekranı ve pencereleri okuma ${word(pc.read)}. Kapalı olanı yapamazsın; kullanıcı Ayarlar'dan açabilir.`;
}

const CLOUD_CAUSE: Record<BrainCloudIssue, string> = {
  billing: 'bulut hesabında kredi yok',
  auth: 'bulut anahtarı kabul edilmedi',
  network: 'buluta şu an ulaşılamıyor',
  limit: 'Claude aboneliğinin kullanım sınırı doldu',
};

/** Asıl beyin Claude Code iken kullanılamama nedeni. */
const CLAUDE_CODE_CAUSE: Record<BrainCloudIssue, string> = {
  billing: 'Claude aboneliğinde ödeme sorunu var',
  auth: 'bu bilgisayardaki Claude Code’da oturum açık değil',
  network: 'bu bilgisayardaki Claude Code’a şu an ulaşılamıyor',
  limit: 'Claude aboneliğinin kullanım sınırı doldu; sınır açılınca kendiliğinden Claude’a dönersin',
};

/** Bulut beyninin kullanılamama nedeni; sağlayıcının adı biliniyorsa onunla ("OpenRouter hesabında kredi yok"). */
function cloudCause(brain: SelfState['brain']): string {
  const cause = brain.cause ?? 'network';
  if (brain.claudeCode) return CLAUDE_CODE_CAUSE[cause];
  const name = brain.cloudName;
  if (!name || name === 'Anthropic') return CLOUD_CAUSE[cause];
  return cause === 'billing' ? `${name} hesabında kredi yok` : cause === 'auth' ? `${name} anahtarı kabul edilmedi` : `${name} sağlayıcısına şu an ulaşılamıyor`;
}

function brainLine(state: SelfState): string {
  const { brain } = state;
  if (brain.provider === 'cloud' && brain.claudeCode) {
    // Kullanıcı sorusu: "hâlâ yerelde aptal bir model mi kullanıyoruz?" Yanıt tahmin edilmez, buradan okunur.
    return `Beynin: CLAUDE ile çalışıyor (bu bilgisayardaki Claude Code üzerinden, kullanıcının Claude aboneliğiyle; model ${brain.model}). Yanıtlar Anthropic bulutunda üretilir, internet üzerinden; ayrı bir API anahtarı ya da dolar harcaması yok. Sorulursa "Claude ile çalışıyorum; bu bilgisayardaki Claude Code üzerinden, aboneliğinizle" de.`;
  }
  if (brain.provider === 'cloud') return `Beynin: bulutta çalışıyor (${brain.cloudName ?? 'Anthropic'}, ${brain.model}); internet üzerinden.`;
  if (brain.provider === 'none') {
    const why =
      brain.reason === 'kill_switch'
        ? 'Fuber Yönetim durdurdu'
        : brain.reason === 'update_required'
          ? 'güncelleme gerekiyor'
          : brain.reason === 'private'
            ? 'Gizli kip açık: buluta bir şey gönderilmiyor ve yerel model hazır değil'
            : 'bulut yok, yerel model hazır değil';
    return `Beynin: şu an çalışan bir beyin yok (${why}).`;
  }
  const why =
    brain.reason === 'policy_local'
      ? 'Fuber Yönetim’de yerel model seçili'
      : brain.reason === 'private'
        ? 'GİZLİ KİP açık (kullanıcı Ayarlar’dan açtı); buluta hiçbir şey gönderilmiyor'
        : brain.reason === 'no_key'
          ? brain.claudeCode
            ? 'Claude Code bu bilgisayarda kurulu değil ya da henüz hazır değil'
            : brain.cloudName && brain.cloudName !== 'Anthropic'
              ? `${brain.cloudName} anahtarı tanımlı değil`
              : 'bulut anahtarı tanımlı değil'
        : cloudCause(brain);
  return `Beynin: BU BİLGİSAYARDA, ekran kartında çalışan yerel model (${brain.model}). Neden bulut değil: ${why}.`;
}

function sttLine(voice: SelfVoiceState): string {
  if (voice.stt.provider === 'elevenlabs-scribe') return 'Yazıya çevirme (kullanıcıyı duyma): ElevenLabs bulutunda.';
  const where = voice.stt.gpu === true ? 'ekran kartında' : voice.stt.gpu === false ? 'işlemcide' : 'yerelde';
  return `Yazıya çevirme (kullanıcıyı duyma): bu bilgisayarda, ${where} (Whisper).`;
}

const TTS_FALLBACK: Record<string, string> = {
  no_key: 'ElevenLabs anahtarı yok',
  quota: 'ElevenLabs kotası doldu',
  auth: 'ElevenLabs anahtarı kabul edilmedi',
  unauthorized: 'ElevenLabs anahtarı kabul edilmedi',
  network: 'ElevenLabs’e ulaşılamıyor',
  gpu_failed: 'ekran kartında başlatılamadı',
  gpu_starting: 'ekran kartına hâlâ yükleniyor',
};

const TTS_ENGINE_NAME: Record<TtsEngineId, string> = {
  supertonic: 'Supertonic 3',
  'ema-lightning': 'EMA Lightning',
  'piper-local': 'Piper',
  elevenlabs: 'ElevenLabs',
};

/** Ses ekran kartında mı üretiliyor ("sesim ekran kartında üretiliyor" yalnız bu durumda doğrudur). */
const ttsOnGpu = (voice: SelfVoiceState): boolean => voice.tts.device === 'cuda' || voice.tts.device === 'directml';

/** Etkin motorun nerede çalıştığı, açık sözlerle. Cihaz bilinmiyorsa yalnız "bu bilgisayarda" denir, tahmin edilmez. */
function ttsWhere(voice: SelfVoiceState): string {
  const name = TTS_ENGINE_NAME[voice.tts.active];
  if (voice.tts.device === 'cuda') return `BU BİLGİSAYARIN EKRAN KARTINDA üretiliyor (${name}, CUDA)`;
  if (voice.tts.device === 'directml') return `BU BİLGİSAYARIN EKRAN KARTINDA üretiliyor (${name}, DirectML)`;
  if (voice.tts.device === 'cpu') return `bu bilgisayarın İŞLEMCİSİNDE üretiliyor (${name}); ekran kartında DEĞİL`;
  return 'bu bilgisayarda üretiliyor (yerel ses motoru)';
}

function ttsLine(voice: SelfVoiceState): string {
  if (voice.tts.active === 'elevenlabs') {
    return 'SESİN: ElevenLabs BULUTUNDAN geliyor; bu bilgisayarda ya da ekran kartında ÜRETİLMİYOR.';
  }
  const where = ttsWhere(voice);
  if (voice.tts.provider === voice.tts.active) return `SESİN: ${where}; bulut kullanılmıyor.`;
  // Seçili motor konuşmuyor: neyin seçili olduğu ve neden konuşmadığı da söylenir.
  const wanted = TTS_ENGINE_NAME[voice.tts.provider];
  if (voice.tts.provider === 'elevenlabs') {
    const why = voice.tts.fallbackReason ? (TTS_FALLBACK[voice.tts.fallbackReason] ?? 'bulut ses şu an kullanılamıyor') : 'bulut ses şu an kullanılamıyor';
    return `SESİN: şu an ${where}; seçili ses ElevenLabs bulutu ama ${why}.`;
  }
  const why = voice.tts.fallbackReason ? (TTS_FALLBACK[voice.tts.fallbackReason] ?? 'şu an kullanılamıyor') : 'şu an kullanılamıyor';
  return `SESİN: şu an ${where}; seçili ses ${wanted} (ekran kartı) ama ${why}.`;
}

function micLine(state: SelfState): string {
  const voice = state.voice!;
  const parts = [voice.micMuted ? 'Mikrofon KAPALI' : 'Mikrofon açık'];
  if (voice.quiet) parts.push('sessiz kip açık (sesli yanıt vermiyorsun, yalnız yazı)');
  if (voice.wakePaused) parts.push('uyandırma sözü duraklatılmış');
  if (voice.conversation) parts.push('sohbet kipi açık');
  if (voice.meeting) parts.push('TOPLANTI KİPİ açık (konuşulanlar yazıya dökülüyor; sesli yanıt vermiyorsun, uyandırma sözü kapalı, yalnız kısayolla çağrılırsın)');
  parts.push(
    voice.bargeIn === 'voice'
      ? 'kullanıcı konuşarak sözünü kesebilir'
      : voice.bargeIn === 'wake'
        ? 'sözün yalnız uyandırma sözüyle ya da "dur" denince kesilir'
        : 'söz kesme kapalı',
  );
  return `${parts.join('; ')}.`;
}

const ADMIN_TEXT: Record<ControlStatus['state'], string> = {
  approved: 'bağlı',
  pending: 'onay bekliyor',
  unregistered: 'bağlı değil',
  revoked: 'yetki kaldırılmış',
  offline: 'şu an ulaşılamıyor (son bilinen ayarlarla çalışıyorsun)',
};

/** Süren işler satırı; bilinmiyorsa "bilinmiyor", yoksa "yok". */
function workLine(work: string[] | null | undefined): string {
  if (work === null || work === undefined) return 'Süren arka plan ve takip işleri: bilinmiyor (watch_list okur).';
  if (work.length === 0) return 'Süren arka plan ve takip işi yok.';
  const shown = work.slice(0, 6);
  return `Süren işler (${work.length}): ${shown.join('; ')}${work.length > shown.length ? '; …' : ''}.`;
}

export interface SelfBlockOptions {
  /**
   * Zengin yol (Claude Code, bulut): araç kümeleri sabit sistem istemindeki öz-tanımdadır (`self-catalog.ts`); burada
   * yalnız o an ÇALIŞMAYANLAR ve süren işler yazılır. Yerel modelde (varsayılan) blok sistem istemindedir ve önbellekten
   * okunur: yapabildikleri tek satırda yazılır, süren işler yazılmaz (değiştikçe öneki bozardı; sorulunca ipucu verir).
   */
  rich?: boolean;
}

/**
 * İsteme giren kısa blok. Kural cümlesi blokla birlikte gelir: model kendisi hakkında yalnız buradakini söyler.
 * Küçük tutulur (bağlam bütçesi): satır başına tek olgu.
 */
export function renderSelfBlock(state: SelfState, options: SelfBlockOptions = {}): string {
  const lines = [
    '## ŞU ANKİ DURUMUN',
    'Kendin hakkında yalnız bunları söyle; burada yazmayan bir şey sorulursa "bunu bilmiyorum" de. Kullanıcı aykırı bir şey söylerse onaylama, kibarca düzelt.',
  ];
  const summary = summaryLine(state);
  if (summary) lines.push(`- ${summary}`);
  lines.push(`- ${brainLine(state)}`);
  if (state.voice) {
    lines.push(`- ${sttLine(state.voice)}`, `- ${ttsLine(state.voice)}`, `- ${micLine(state)}`);
    if (!state.voice.ready) lines.push('- Ses hattı şu an hazır değil.');
  } else {
    lines.push('- Ses hattının durumu (yazıya çevirme, seslendirme, mikrofon): bilinmiyor.');
  }
  const able = state.capabilities.filter((item) => item.available).map((item) => item.label);
  const blocked = state.capabilities.filter((item) => !item.available);
  if (able.length && !options.rich) lines.push(`- Şu an yapabildiklerin: ${able.join(', ')}.`);
  if (blocked.length) {
    // "Yapamam" değil "şu an yapamıyorum, şuna bağlı": kullanıcının sorusuna ("kendine özellik ekleyebiliyor musun?")
    // model "ekleyemem" demişti; oysa yetenek var, bulut beyni bekliyor.
    // Soru geldiğinde nasıl yanıtlanacağı sorunun yanına ayrıca konur (`selfHints`); blok kısa kalır.
    const needs = blocked[0]!.needs ?? 'şu an kapalı';
    lines.push(`- Sende VAR ama şu an ÇALIŞMAYANLAR (${needs}): ${blocked.map((item) => item.label).join(', ')}.`);
  }
  // Derin beynin sağlayıcısı biliniyorsa (ya da durumu bilinmiyorsa) ayrı satırda söylenir.
  if (state.brain.deep.provider !== undefined || state.brain.deep.known === false) lines.push(`- ${deepLine(state.brain.deep)}`);
  const pc = pcLine(state.pc);
  if (pc) lines.push(`- ${pc}`);
  if (options.rich) lines.push(`- ${workLine(state.work)}`);
  // Yetki düzeyi: model izin sorusunu KENDİ sormaz; gereken yerde araç kapısı sorar (aynı şey iki kez sorulmasın).
  if (state.authority) lines.push(`- ${t(options.rich ? `authority.self.${state.authority}` : `authority.selfShort.${state.authority}`)}`);
  if (state.admin) lines.push(`- Fuber Yönetim: ${ADMIN_TEXT[state.admin]}.`);
  lines.push(`- Sürüm: ${state.appName} ${state.appVersion}. Donanımı (ekran kartı, işlemci, RAM) self_status aracı okur; tahmin etme.`);
  return lines.join('\n');
}

const fold = (text: string): string =>
  text
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüâîû]/g, (ch) => ({ ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', â: 'a', î: 'i', û: 'u' })[ch] ?? ch);

/**
 * Kullanıcının sözü asistanın kendisiyle ilgiliyse, öz-durumun O SORUYA yanıt olan satırları. Blok sistem istemindedir
 * ama küçük model uzaktaki satırı soruyla eşleştiremiyor (ölçüm: "kendine özellik ekleyebiliyor musun" sorusuna blokta
 * yanıtı yazdığı halde 3 denemenin 3'ünde "ekleyemem" dedi); ilgili satır sorunun hemen yanına, bağlam bloğuna da konur.
 */
export function selfHints(state: SelfState, userText: string): string[] {
  const text = fold(userText);
  const hints: string[] = [];
  const aboutWhere = /yerel|bulut|internet|cevrimdisi|offline|ekran kart|bilgisayarimda|nerede calis|nereden/.test(text);
  if (aboutWhere) {
    const summary = summaryLine(state);
    if (summary) {
      // Yanıtın nasıl BAŞLAYACAĞI da verilir: model doğru ayrıntıyı "Doğru, tamamen yerelde…" diye açıyordu.
      const mixed = summary.includes('DEĞİLSİN');
      hints.push(
        `${summary.replace(/^Özet: /, '')}${mixed ? ' Kullanıcı "tamamen yerelde misin", "bulut yok, değil mi" derse "Doğru" deme; "Hayır, tamamen değil" diye başla ve neyin nerede olduğunu söyle.' : ''}`,
      );
    }
  }
  if (state.voice && /\bses|konusma(n| )|tts/.test(text) && (aboutWhere || /uret|hangi ses|sesin ne|ses motor/.test(text))) hints.push(ttsLine(state.voice));
  // "Nerede çalışıyorsun" sorusuyla aynı sözde geçen "yeteneklerini geliştireceğim" bir yetenek sorusu değildir: iki
  // ipucu birlikte verilince model karıştırdı ("Doğru değil; bulut beynim bağlı değil, yalnız yerelde çalışıyorum").
  const asksAbility = /ekleyebil|gelistirebil|ogrenebil|kendi kendine|kendini gelistir|yapabilir hale|yapabilecek hale/.test(text);
  if (aboutWhere && hints.length > 0 ? asksAbility : /ozelli[kg]|yetene[kg]|eklenti|gelistir|kendi kendine|ekleyebil|ogrenebil|kendini|yapabilir hale|yapabilecek hale/.test(text)) {
    const blocked = state.capabilities.filter((item) => !item.available);
    const build = state.capabilities.find((item) => item.id === 'deep:skill_build' || (item.id === undefined && item.label.includes('Atölye')));
    if (build?.available) {
      const how = state.brain.deep.provider === 'claude-code' ? ' (bu bilgisayardaki Claude Code ile)' : '';
      hints.push(`Kendine yeni yetenek ya da özellik geliştirebilirsin${how} (Atölye): kullanıcı ne istediğini söylerse skill_build ile başlatırsın; arka planda geliştirilir, onayına sunulur.`);
    } else if (build && state.brain.deep.known === false) {
      hints.push('Yeni yetenek ya da özellik geliştirme yeteneğin (Atölye) VAR; onu çalıştıran derin beynin durumu henüz bilinmiyor. "Ekleyemem" deme; istenirse skill_build ile dene, sonucu söyle.');
    } else if (build) {
      // Derin beynin sağlayıcısı biliniyorsa (köprü dalı) neden de söylenir; yoksa "bulut beyni" denir.
      const detailed = state.brain.deep.provider !== undefined;
      const why = detailed && state.brain.deep.reason ? ` (${state.brain.deep.reason.replace(/\.$/, '')})` : '';
      const who = detailed ? 'onu çalıştıran derin beynim şu an bağlı değil' : 'bulut beynim bağlı değil';
      hints.push(`Yeni yetenek ya da özellik geliştirme yeteneğin (Atölye) VAR ama ${build.needs ?? 'şu an kapalı'}${why}. "Ekleyemem" deme; "bu yeteneğim var ama ${who}, o gelince yapabilirim" de.`);
    } else if (blocked.length === 0) hints.push('Yeni yetenek geliştirme (Atölye) bu kurulumda kapalı.');
  }
  if (/ekran kart|donanim|islemci|\bram\b|bellek|bilgisayarimin ozellik/.test(text) && /gor|bil|ne\b|hangi|kac|marka|model|soyle|oku/.test(text)) {
    hints.push('Donanımı self_status aracıyla okuyabilirsin: çağır ve sonucu söyle.');
  }
  // Süren işler yerel blokta yazılmaz (sistem istemi önbellekte kalsın); sorulunca sorunun yanına konur.
  if (/\bis(ler)?(im|imiz)? (ne durumda|neler)|ne (isler|is) (var|suruyor|calisiyor)|arka planda ne|neleri takip|takip ettigin|suren is/.test(text)) {
    hints.push(workLine(state.work));
  }
  return hints.map((hint) => `Kendin hakkında: ${hint}`);
}

/**
 * "Tamamen yerelde misin / bulut var mı" sorusunun hazır yanıtı. Ayrı satırlardaki olguları (beyin yerelde, ses
 * bulutta) küçük model birleştiremedi ve "tamamen yerelde çalışıyorum" dedi; birleşik cümle koddan gelir.
 */
function summaryLine(state: SelfState): string | null {
  if (state.brain.provider === 'none' || !state.voice) return null;
  const cloud: string[] = [];
  const local: string[] = [];
  (state.brain.provider === 'cloud' ? cloud : local).push('beynin');
  (state.voice.stt.provider === 'elevenlabs-scribe' ? cloud : local).push('yazıya çevirme');
  (state.voice.tts.active === 'elevenlabs' ? cloud : local).push('sesin');
  if (cloud.length === 0) return 'Özet: şu an TAMAMEN bu bilgisayarda çalışıyorsun; buluta hiçbir şey gitmiyor.';
  if (local.length === 0) return 'Özet: şu an beynin, yazıya çevirme ve sesin BULUTTA; bu bilgisayarda yalnız uygulama çalışıyor.';
  return `Özet: TAMAMEN yerelde DEĞİLSİN. Bu bilgisayarda: ${local.join(', ')}. BULUTTA: ${cloud.join(', ')}.`;
}

/** `self_status` aracının modele döndürdüğü ayrıntılı metin (blok + kısayollar). Donanımı araç ekler. */
export function describeSelf(state: SelfState): string {
  const lines = [brainLine(state)];
  lines.push(
    state.brain.deep.provider !== undefined || state.brain.deep.known === false
      ? deepLine(state.brain.deep)
      : state.brain.deep.ok
        ? 'Derin beyin (yetenek geliştirme, araştırma, ekrana bakma): kullanılabilir.'
        : `Derin beyin (yetenek geliştirme, araştırma, ekrana bakma): şu an kullanılamıyor (${state.brain.deep.reason ?? 'bulut beyni yok'}).`,
  );
  if (state.voice) {
    lines.push(sttLine(state.voice), ttsLine(state.voice), micLine(state));
    if (!state.voice.ready) lines.push('Ses hattı şu an hazır değil.');
  } else {
    lines.push('Ses hattının durumu bilinmiyor.');
  }
  if (state.hotkeys) {
    const keys = [state.hotkeys.talk ? `konuş ${state.hotkeys.talk}` : '', state.hotkeys.mute ? `mikrofon aç/kapat ${state.hotkeys.mute}` : ''].filter(Boolean);
    if (keys.length) lines.push(`Kısayollar: ${keys.join(', ')}.`);
  }
  for (const item of state.capabilities) {
    lines.push(item.available ? `Yapabilir: ${item.label}.` : `Yapamaz: ${item.label} (${item.needs ?? 'şu an kapalı'}).`);
  }
  const pc = pcLine(state.pc);
  if (pc) lines.push(pc);
  lines.push(workLine(state.work));
  if (state.admin) lines.push(`Fuber Yönetim: ${ADMIN_TEXT[state.admin]}.`);
  lines.push(`Sürüm: ${state.appName} ${state.appVersion}.`);
  return lines.join('\n');
}

/**
 * Yetenekler KAYITTAN üretilir (eski elle yazılmış aile listesinin yerine): kayıtlı her araç kümesine düşer
 * (`self-catalog.ts` › `buildClusters`); her küme bir yetenektir. Derin beyin isteyen araçlar (`LOCAL_NEEDS_DEEP`:
 * yetenek geliştirme, araştırma, ekrana bakma) ayrıca, kendi adlarıyla anılır: o an çalışmayabilirler. Modülü kapalı
 * aracın kaydı yoktur; kümesi de yeteneği de düşer.
 */
export interface CapabilityInput {
  /** Kayıttan kümeler (`buildClusters`). Verilmezse `registered` adlarından kurulur. */
  clusters?: readonly SelfCluster[];
  /** Kayıtlı (modülü açık) araç adları; `clusters` yoksa kullanılır. */
  registered?: ReadonlySet<string>;
  /** Turları yürüten beyin yerel model mi. */
  local: boolean;
  /** Yerel modelin çağırabildiği araç adları için sınama. */
  localCallable(name: string): boolean;
  /** Derin beyin çalışabilir mi. */
  deepOk: boolean;
  /** Derin beyin yokken yeteneğin neye bağlı olduğu; verilmezse "bulut beyni gerekir; şu an yok". */
  deepNeeds?: string;
  /** Kümelere girmeyen ek yetenekler. */
  extra?: SelfCapability[];
}

const NEEDS_CLOUD = 'bulut beyni gerekir; şu an yok';

export function listCapabilities(input: CapabilityInput): SelfCapability[] {
  const clusters = input.clusters ?? buildClusters([...(input.registered ?? [])].map((name) => ({ name, moduleId: '', risk: 'read' as const })));
  const out: SelfCapability[] = [];
  const deep: SelfCapability[] = [];
  for (const cluster of clusters) {
    const plain = cluster.tools.filter((name) => !cluster.deep.includes(name));
    if (plain.length) {
      const blocked = input.local && !plain.some((name) => input.localCallable(name));
      out.push({ id: `group:${cluster.id}`, label: cluster.label, available: !blocked, needs: blocked ? NEEDS_CLOUD : null });
    }
    for (const name of cluster.deep) {
      deep.push({ id: `deep:${name}`, label: deepLabelOf(name), available: input.deepOk, needs: input.deepOk ? null : (input.deepNeeds ?? NEEDS_CLOUD) });
    }
  }
  return [...out, ...deep, ...(input.extra ?? [])];
}

/**
 * Yanıt cümlesi, bilinen duruma AYKIRI bir şey söylüyorsa düzeltilmiş cümle; aykırı değilse `null`. İstemdeki blok ve
 * ipucu çoğu kez yeter (ölçüm: 3 denemede 3), ama küçük model kimi koşuda yine "Doğru, tamamen yerelde çalışıyorum"
 * dedi; en önemli şikâyet buydu. Yalnız iki ölçülmüş yanlış düzeltilir: (1) her şey yerelde değilken
 * "tamamen yerelde çalışıyorum"; (2) ses buluttan gelirken "sesim bu bilgisayarda / ekran kartında üretiliyor".
 */
export function correctSelfClaim(state: SelfState, sentence: string): string | null {
  if (!state.voice) return null;
  const text = fold(sentence);
  if (/\?\s*$/.test(sentence.trim())) return null;
  const summary = summaryLine(state);
  const mixed = !!summary && summary.includes('DEĞİLSİN');
  const allCloud = !!summary && summary.includes('BULUTTA; bu bilgisayarda yalnız');
  if ((mixed || allCloud) && /tamamen (yerel|bu bilgisayar|cevrimdisi)|hicbir bulut (yok|kullan)|bulut (baglantisi )?yok\b/.test(text) && !/degil|yanlis|hayir/.test(text)) {
    const cloud = [state.brain.provider === 'cloud' ? 'beynim' : '', state.voice.stt.provider === 'elevenlabs-scribe' ? 'yazıya çevirme' : '', state.voice.tts.active === 'elevenlabs' ? 'sesim' : ''].filter(Boolean);
    return `Hayır, tamamen yerelde değilim: ${cloud.join(', ')} bulutta.`;
  }
  if (
    state.voice.tts.active === 'elevenlabs' &&
    /\bses/.test(text) &&
    /(ekran kart|bu bilgisayar|bilgisayarinizda|bilgisayarinda|yerel)/.test(text) &&
    /(uretiliyor|uretiyorum|uretilir|uretmekteyim)/.test(text) &&
    !/(uretilmiyor|uretmiyorum|degil|elevenlabs|bulut)/.test(text)
  ) {
    return 'Sesim ElevenLabs bulutundan geliyor; bu bilgisayarda üretilmiyor.';
  }
  // (3) Ses yerelde ama İŞLEMCİDE üretilirken (Piper'a düşüldü) "ekran kartında üretiliyor" demek de yanlıştır.
  if (
    state.voice.tts.active !== 'elevenlabs' &&
    state.voice.tts.device === 'cpu' &&
    /\bses/.test(text) &&
    /ekran kart/.test(text) &&
    /(uretiliyor|uretiyorum|uretilir|uretmekteyim)/.test(text) &&
    !/(uretilmiyor|uretmiyorum|degil|islemci)/.test(text)
  ) {
    return `Sesim şu an ekran kartında değil, bu bilgisayarın işlemcisinde üretiliyor (${TTS_ENGINE_NAME[state.voice.tts.active]}).`;
  }
  // (4) Ses ekran kartında üretilirken "buluttan geliyor / ElevenLabs" demek de yanlıştır (eski alışkanlık).
  if (
    ttsOnGpu(state.voice) &&
    /\bses/.test(text) &&
    /(elevenlabs|buluttan gel|bulutta uret)/.test(text) &&
    !/(degil|gelmiyor|uretilmiyor|kullanmiyor|gitmiyor)/.test(text)
  ) {
    return 'Sesim buluttan gelmiyor; bu bilgisayarın ekran kartında üretiliyor.';
  }
  return null;
}
