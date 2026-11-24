// Sahibi: T2. Ses denetimi araçları (KURGU §5.4): model "sus", "mikrofonu kapat" isteklerini bununla yerine getirir.
// Öz-durum da buradadır: ses hattının gerçek durumu (yazıya çevirme ve ses nereden geliyor, mikrofon) beyne bu modül
// bildirir ve `self_status` aracı ayrıntılı durumu donanımla birlikte okur.
import { defineModule, defineTool, t, type ModuleContext, type Settings, type VoiceApi } from '@fuber/shared';
import { z } from 'zod';
import { planAuthorityChange, type AuthorityRequest } from '../../core/authority';
import type { BrainService } from '../../core/brain';
import { findSpokenPage, PC_SELFTEST_SPOKEN, SPOKEN_PAGES, SPOKEN_TESTS } from '../../core/brain/local-commands';
import { describeSelf, type SelfSource, type SelfVoiceState } from '../../core/brain/self';
import type { VoiceService } from '../../voice/index';
import { describeHardware, readHardware, type HardwareInfo } from './hardware';
import { describeSetting, listSpokenSettings, planSet, resolveSetting } from '../../core/brain/local-settings';
import { endConversationAfterTurn } from './end-conversation';
import { resetSpokenTests, startSpokenTest } from './spoken-tests';

/** Electron hızlandırıcısı konuşma diline çevrilir: "Control+Alt+M" → "Ctrl+Alt+M". Boşsa hiçbir tuş alınamamıştır. */
const spokenKey = (accelerator: string) => accelerator.replace(/CommandOrControl|Control/g, 'Ctrl');

/**
 * Kullanıcıya söylenecek açma yolu. Ayardaki değer GERÇEKTE kayıtlı kısayoldur (`core/hotkeys.ts` yedeğe düştüyse
 * onu yazar); boşsa hiçbir tuş alınamamıştır ve tepsi simgesi söylenir.
 */
function hotkeyText(ctx: ModuleContext, id: 'mute' | 'talk'): string {
  const accelerator = spokenKey(ctx.settings.get().hotkeys[id]);
  return accelerator ? `${accelerator} kısayolu` : 'tepsi simgesi';
}

/**
 * Ses hattının o anki GERÇEK durumu: durum yüzünden (mikrofon, sessiz kip, söz kesme) ve tanı yüzünden (yazıya
 * çevirme motoru, o an seslendiren motor). Tanı okunamıyorsa `null` döner; beyin "bilinmiyor" der, tahmin etmez.
 */
export function readVoiceState(voice: VoiceApi, sttProvider: SelfVoiceState['stt']['provider']): SelfVoiceState | null {
  const report = (voice as Partial<VoiceService>).diagnosticsReport?.();
  if (!report) return null;
  const status = voice.status();
  const { stt, tts } = report.engines;
  return {
    ready: status.ready,
    stt: { provider: sttProvider, gpu: stt.gpu },
    tts: {
      provider: tts.provider,
      active: tts.active,
      // Cihaz yalnız biliniyorsa yazılır (bilinmiyorsa öz-durum "bu bilgisayarda" der, yer uydurmaz).
      ...(tts.device ? { device: tts.device } : {}),
      // Seçili motor konuşmuyorsa nedeni: buluttan düşüş kodu ya da ekran kartı motorunun açılamama nedeni.
      fallbackReason: tts.active === tts.provider ? null : (tts.fallback?.reason ?? (tts.host?.phase === 'failed' ? 'gpu_failed' : tts.host?.phase === 'starting' ? 'gpu_starting' : null)),
    },
    micMuted: status.micMuted,
    quiet: status.quiet,
    bargeIn: report.bargeIn.effective,
    wakePaused: status.wakePausedUntil !== null && Date.parse(status.wakePausedUntil) > Date.now(),
    conversation: status.conversation,
    ...(status.meeting ? { meeting: status.meeting.on } : {}),
  };
}

/** Süren arka plan işleri (iş servisi), tek satırlık: "Araştırma: … (koşuyor, %40)". Okunamazsa `null`. */
export function readWork(jobs: Pick<ModuleContext['jobs'], 'list'> | undefined): string[] | null {
  if (!jobs) return null;
  try {
    const running = [...jobs.list({ status: 'running', limit: 10 }), ...jobs.list({ status: 'queued', limit: 10 })];
    return running.map((job) => {
      const state = job.status === 'queued' ? 'sırada' : job.progress !== null ? `koşuyor, %${Math.round(job.progress * 100)}` : 'koşuyor';
      return `${job.title} (${state}${job.step && job.status === 'running' ? `: ${job.step.replace(/\.$/, '')}` : ''})`;
    });
  } catch {
    return null;
  }
}

/** Ayar katalogları (yalnız adlar); öz-tanıma girer. Değerler burada yoktur (değişkendir). */
function readControls(ctx: Pick<ModuleContext, 'policy' | 'settings'>): SelfSource['controls'] {
  try {
    const list = listSpokenSettings(ctx.settings.get() as unknown as Record<string, unknown>, ctx.policy.get());
    return { spoken: list.available.map((item) => item.label), managed: list.managed, localOnly: list.localOnly };
  } catch {
    return null;
  }
}

/** Beynin kendisinin bilemediği öz-durum parçaları. Her okuma o anki değeri verir; önbelleklenmez. */
export function collectSelfSource(ctx: Pick<ModuleContext, 'voice' | 'policy' | 'settings' | 'log'> & Partial<Pick<ModuleContext, 'jobs'>>): SelfSource {
  let voice: SelfVoiceState | null = null;
  try {
    voice = readVoiceState(ctx.voice, ctx.policy.get().voice.stt.provider);
  } catch (error) {
    ctx.log.debug(`ses durumu okunamadı: ${error instanceof Error ? error.message : String(error)}`);
  }
  let admin: SelfSource['admin'] = null;
  try {
    admin = ctx.policy.status().state;
  } catch {
    // Kontrol bağlantısının durumu okunamadıysa "bilinmiyor" kalır.
  }
  const settings = ctx.settings.get();
  const hotkeys = settings.hotkeys;
  // Bilgisayar izinleri (pc modülünün ayarları). Ayar bu sürümde yoksa satır hiç yazılmaz.
  const permissions = settings as { pcControlAllowed?: boolean; pcReadAllowed?: boolean };
  const known = typeof permissions.pcControlAllowed === 'boolean' || typeof permissions.pcReadAllowed === 'boolean';
  return {
    voice,
    admin,
    hotkeys: { talk: spokenKey(hotkeys.talk), mute: spokenKey(hotkeys.mute) },
    pc: known ? { control: permissions.pcControlAllowed ?? null, read: permissions.pcReadAllowed ?? null } : null,
    controls: readControls(ctx),
    work: readWork(ctx.jobs),
  };
}

/** Modül açık mı: kullanıcı kapatmadıysa ve politika izin veriyorsa. Okunamazsa açık sayılır (sayfa yoksa kabuk ilk sayfaya düşer). */
function moduleOpen(ctx: Pick<ModuleContext, 'settings' | 'policy'>, moduleId: string): boolean {
  try {
    return !ctx.settings.get().disabledModules.includes(moduleId) && ctx.policy.moduleAllowed(moduleId);
  } catch {
    return true;
  }
}

/** Sesle açılabilen sayfaların (modülü açık olanların) adları, sekmeler hariç. */
function openPageLabels(ctx: Pick<ModuleContext, 'settings' | 'policy'>): string[] {
  return [...new Set(SPOKEN_PAGES.filter((item) => !item.tab && (!item.moduleId || moduleOpen(ctx, item.moduleId))).map((item) => item.label))];
}

const joinTr = (items: readonly string[]): string => (items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} ve ${items.at(-1)}`);

/**
 * "Sesle ne yapabilirim" yanıtı: sesle değişen ayarlar (şu anki değerleriyle), sınamalar, sayfalar ve sesle DEĞİŞMEYENLER
 * (kim yönetiyor). Liste koddan gelir: model saymaz, uydurmaz. `topic` verilirse yalnız o bölüm ve söylenecek hazır
 * cümle döner (sesli yanıt kısa kalsın); `name` verilirse tek ayarın değeri.
 */
export function describeSpokenControls(
  ctx: Pick<ModuleContext, 'settings' | 'policy'>,
  options: { topic?: 'ayarlar' | 'sinamalar' | 'sayfalar'; name?: string } = {},
): string {
  const settings = ctx.settings.get() as unknown as Record<string, unknown>;
  const policy = ctx.policy.get();
  if (options.name) {
    const resolved = resolveSetting(options.name, settings);
    if (resolved.kind !== 'unknown') return `${describeSetting(resolved, settings, policy)} Kullanıcıya yalnız bunu, tek cümleyle söyle.`;
  }
  const list = listSpokenSettings(settings, policy);
  // Fare ve klavye sınaması bilgisayar modülünündür: yalnız bilgisayarı kullanma izni açıkken (aracı kayıtlıyken) sayılır.
  const pcSelftest = settings.pcControlAllowed === true && !(Array.isArray(settings.disabledModules) && settings.disabledModules.includes('pc'));
  const spokenTests = [...SPOKEN_TESTS.map((test) => ({ label: test.label, about: test.about })), ...(pcSelftest ? [{ label: PC_SELFTEST_SPOKEN.label, about: PC_SELFTEST_SPOKEN.about }] : [])];
  const tests = spokenTests.map((test) => test.label);
  const pages = openPageLabels(ctx);
  const settingNames = list.available.map((item) => item.label);
  const lines: string[] = [];
  if (!options.topic || options.topic === 'ayarlar') {
    lines.push(`Sesle değişen ayarlar (şu anki değer): ${list.available.map((item) => `${item.label}: ${item.value}`).join('; ')}.`);
    if (list.absent.length) lines.push(`Bu sürümde henüz olmayanlar: ${list.absent.join(', ')}.`);
    lines.push(`Fuber Yönetim’den yönetilenler (sesle değişmez): ${list.managed.join(', ')}.`);
    lines.push(`Sesle değişmeyen yerel ayarlar (Ayarlar sayfasından): ${list.localOnly.join(', ')}.`);
  }
  if (!options.topic || options.topic === 'sinamalar') {
    lines.push(`Sesle başlatılan sınamalar: ${spokenTests.map((test) => `${test.label} (${test.about})`).join('; ')}.`);
  }
  if (!options.topic || options.topic === 'sayfalar') lines.push(`Sesle açılan sayfalar: ${pages.join(', ')}; Ayarlar’ın sekmeleri de açılır.`);
  // Söylenecek cümle hazır verilir: liste uzun, sesli yanıt kısa olmalı.
  if (options.topic === 'sinamalar') {
    lines.push(`Kullanıcıya yalnız şunu söyle: "${capitalizeTr(joinTr(tests))} var; hangisini başlatayım?"`);
  } else if (options.topic === 'sayfalar') {
    lines.push(`Kullanıcıya yalnız şunu söyle: "${joinTr(pages)} sayfalarını açabilirim."`);
  } else if (options.topic === 'ayarlar') {
    lines.push(
      `Kullanıcıya yalnız şunu söyle: "Sesle şunları değiştirebilirsiniz: ${joinTr(settingNames.slice(0, 6))}${settingNames.length > 6 ? ' ve birkaç ayar daha' : ''}. Ses sınamalarını da başlatabilirim."`,
    );
  } else {
    lines.push('Kullanıcıya yalnız sorduğunu, bir iki cümleyle söyle; listeyi baştan sona okuma.');
  }
  return lines.join('\n');
}

const capitalizeTr = (text: string) => (text ? text[0]!.toLocaleUpperCase('tr') + text.slice(1) : text);

/** Donanım dakikada bir değişmez; boş bellek değişir. Kısa süre önbelleklenir (art arda sorularda yeniden ölçülmesin). */
const HARDWARE_TTL_MS = 15_000;
let hardwareCache: { at: number; info: HardwareInfo } | null = null;
let attachedBrain: Partial<BrainService> | null = null;

async function hardware(): Promise<HardwareInfo> {
  if (hardwareCache && Date.now() - hardwareCache.at < HARDWARE_TTL_MS) return hardwareCache.info;
  const info = await readHardware();
  hardwareCache = { at: Date.now(), info };
  return info;
}

export default defineModule({
  id: 'voice-control',
  version: '1.1.0',
  nameKey: 'module.voice-control.name',
  descriptionKey: 'module.voice-control.description',
  permissions: ['mic'],

  tools: [
    defineTool({
      name: 'voice_stop_speaking',
      group: 'core',
      description: 'Konuşmayı hemen keser. Kullanıcı "sus", "dur", "yeter", "tamam kes" dediğinde kullan; ardından bir şey söyleme.',
      input: z.object({}),
      risk: 'read',
      async run(_input, ctx) {
        ctx.voice.stopSpeaking();
        return { ok: true, text: 'Konuşma kesildi. Yanıt verme; en fazla "Tamam." de.' };
      },
    }),
    defineTool({
      name: 'voice_mute_mic',
      group: 'core',
      description:
        'Mikrofonu gerçekten kapatır (dinleme tamamen durur). "Mikrofonu kapat", "beni dinleme", "dinlemeyi bırak" denince kullan. ' +
        'Süre söylendiyse minutes ver; o süre sonunda kendiliğinden açılır. Yalnız "sesi kapat" ya da "sesli modu kapat" denirse ' +
        'hangisinin istendiği belirsizdir: araç çağırmadan "Dinlemeyi mi kapatayım, sesli yanıtı mı?" diye sor.',
      input: z.object({ minutes: z.number().int().min(1).max(24 * 60).optional() }),
      risk: 'read',
      async run({ minutes }, ctx) {
        ctx.voice.muteMic(minutes ? { minutes } : {});
        const status = ctx.voice.status();
        if (!status.micMuted) return { ok: false, text: 'Mikrofon kapatılamadı.' };
        const key = hotkeyText(ctx, 'mute');
        return {
          ok: true,
          text: minutes
            ? // Söylenecek cümle hazır verilir: küçük model yönergeyi ("kapattın, … açabilir") aynen okuyordu.
              `Mikrofon ${minutes} dakikalığına kapatıldı. Kullanıcıya yalnız şunu söyle: "Mikrofonu ${minutes} dakikalığına kapattım; daha önce açmak isterseniz ${key} ile açarsınız."`
            : `Mikrofon kapatıldı. Kullanıcıya yalnız şunu söyle: "Mikrofonu kapattım; ${key} ile açarsınız."`,
        };
      },
    }),
    defineTool({
      name: 'voice_end_conversation',
      group: 'voice',
      description:
        'Sesli sohbeti BİTİRİR: sohbet kipi ve takip dinlemesi kapanır; mikrofon AÇIK kalır, uyandırma sözü dinlenmeye devam eder. ' +
        'Kullanıcı vedalaştığında ("güle güle", "bay bay", "görüşürüz", "iyi geceler", "sonra konuşuruz") kullan; mikrofonu kapatma, ' +
        'dinlemeyi duraklatma. Ardından yalnız kısa bir veda söyle.',
      input: z.object({}),
      risk: 'read',
      async run(_input, ctx) {
        // Bitirme tur bittikten sonra yapılır: veda cümlesi yarıda kesilmesin.
        endConversationAfterTurn(ctx);
        return { ok: true, text: 'Sohbet bitiyor; uyandırma sözü dinlenmeye devam ediyor. Kullanıcıya yalnız kısa bir veda söyle: "Görüşürüz efendim."' };
      },
    }),
    defineTool({
      name: 'voice_pause_listening',
      group: 'voice',
      description:
        'Uyandırma sözünü bir süre yok sayar; mikrofon açık kalır, kısayol ve ada çalışır. "Yarım saat beni dinleme ama mikrofon açık kalsın" gibi isteklerde kullan.',
      input: z.object({ minutes: z.number().int().min(1).max(24 * 60) }),
      risk: 'read',
      async run({ minutes }, ctx) {
        ctx.voice.pauseWake(minutes);
        const key = hotkeyText(ctx, 'talk');
        return { ok: true, text: `Uyandırma sözü ${minutes} dakika dinlenmeyecek. O sürede ${key} ile konuşulabilir.` };
      },
    }),
    defineTool({
      name: 'voice_set_quiet',
      group: 'core',
      description:
        'Sessiz kip: açıkken Jarvis sesli konuşmaz, yanıtlar ve bildirimler yalnız yazıyla gelir. "Sesli yanıt verme", "sesli konuşma, ' +
        'yazıyla söyle", "sessiz ol" denince on, "artık konuşabilirsin" denince off.',
      input: z.object({ on: z.boolean() }),
      risk: 'read',
      async run({ on }, ctx) {
        ctx.voice.setQuiet(on);
        return {
          ok: true,
          text: on
            ? 'Sessiz kip açıldı. Kullanıcıya yalnız şunu söyle: "Bundan sonra yalnız yazıyla yanıt vereceğim; yeniden sesli konuşmam için artık konuşabilirsin demeniz yeter."'
            : 'Sessiz kip kapandı. Kullanıcıya yalnız şunu söyle: "Yeniden sesli yanıt veriyorum."',
        };
      },
    }),
    defineTool({
      name: 'voice_status',
      group: 'voice',
      description: 'Mikrofonun, sessiz kipin ve dinlemenin şu anki durumunu verir. "Mikrofon açık mı", "sessiz kip açık mı" sorularında kullan.',
      input: z.object({}),
      risk: 'read',
      async run(_input, ctx) {
        const status = ctx.voice.status();
        return {
          ok: true,
          text: [
            status.micMuted ? 'Mikrofon kapalı.' : 'Mikrofon açık.',
            status.quiet ? 'Sessiz kip açık.' : 'Sessiz kip kapalı.',
            status.wakePausedUntil ? `Uyandırma sözü ${status.wakePausedUntil} anına kadar duraklatıldı.` : '',
            status.ready ? '' : `Ses hattı hazır değil: ${status.notReadyReason ?? 'bilinmiyor'}.`,
          ]
            .filter(Boolean)
            .join(' '),
          data: status,
        };
      },
    }),
    defineTool({
      name: 'self_status',
      group: 'core',
      description:
        'Asistanın o anki GERÇEK çalışma durumunu ve bu bilgisayarın donanımını okur: hangi beyinle ve nerede çalışıyor (bu bilgisayar / ' +
        'bulut, neden), yazıya çevirme ve ses nereden geliyor, mikrofon, hangi yetenekler kullanılabilir, süren işler, sürüm; ekran kartının adı ve ' +
        'belleği, işlemci, RAM. Kullanıcı senin nasıl ve nerede çalıştığını, neler yapabildiğini ya da bilgisayarının donanımını ("ekran kartımı görebiliyor ' +
        'musun") sorarsa ve yanıt istemde yoksa kullan; tahmin etme. Salt okunurdur.',
      input: z.object({}),
      risk: 'read',
      async run(_input, ctx) {
        const brain = ctx.brain as Partial<BrainService>;
        const lines: string[] = [];
        try {
          const state = brain.selfState?.();
          lines.push(state ? describeSelf(state) : 'Çalışma durumu şu an okunamadı.');
          // Öz-tanım (sayfalar, modüller, araç kümeleri, değiştirilebilenler) istemdekiyle AYNI kaynaktan. Yerel modelin
          // bağlamı küçüktür (8192): orada yetenekler yukarıdaki "Yapabilir" satırlarıyla yeter, uzun metin eklenmez.
          if (state && state.brain.provider !== 'local') {
            const knowledge = brain.selfKnowledge?.();
            if (knowledge) lines.push(knowledge);
          }
        } catch {
          lines.push('Çalışma durumu şu an okunamadı.');
        }
        try {
          lines.push(describeHardware(await hardware()));
        } catch (error) {
          ctx.log.warn('donanım okunamadı', error);
          lines.push('Bu bilgisayarın donanımı şu an okunamadı.');
        }
        lines.push('Yalnız sorulanı, bir iki cümleyle söyle; burada yazmayanı ekleme.');
        // Yapılandırılmış veri eklenmez: metin yeter, modele giden sonuç küçük kalır (bağlam bütçesi).
        return { ok: true, text: lines.join('\n') };
      },
    }),
    // ── "Her şeyi konuşarak": sesle ayar, sınama başlatma ve gezinme (küme `settings`; yalnız söz işaret ederse sunulur). ──
    defineTool({
      name: 'settings_list',
      group: 'settings',
      description:
        'Bu bilgisayarda SESLE okunup değiştirilebilen ayarları şu anki değerleriyle, sesle başlatılabilen ses sınamalarını ve açılabilen ' +
        'sayfaları listeler; hangi ayarın Fuber Yönetim’den yönetildiğini (sesle değişmez) de söyler. "Neleri ayarlayabilirim", "hangi ' +
        'sınamalar var", "sessiz saatler açık mı", "bana nasıl hitap ediyorsun" gibi sorularda kullan; tahmin etme. Salt okunurdur.',
      input: z.object({
        topic: z.enum(['ayarlar', 'sinamalar', 'sayfalar']).optional().describe('Yalnız biri sorulduysa: ayarlar, sinamalar ya da sayfalar'),
        name: z.string().optional().describe('Tek bir ayar sorulduysa adı: "sessiz saatler", "hitap"'),
      }),
      risk: 'read',
      async run({ topic, name }, ctx) {
        return { ok: true, text: describeSpokenControls(ctx, { ...(topic ? { topic } : {}), ...(name ? { name } : {}) }) };
      },
    }),
    defineTool({
      name: 'settings_set',
      group: 'settings',
      description:
        'Bu bilgisayardaki bir ayarı değiştirir: Windows’la başlatma, sessiz saatler, rahatsız etme kipi, bildirim sesi, hitap, kullanıcının ' +
        'adı, bilgisayarı kullanma izni, ekranı okuma izni, asistanın kendi tarayıcısını kullanma izni, görünüm, ses motoru, ses, hareket, ' +
        'adanın çıkacağı ekran, dinleme süresi (yanıttan sonra sözü bekleme; "dinleme süreni uzat / kısalt", "20 saniye"). Bir izni AÇMAK ' +
        'kullanıcı onayı ister (kapatmak istemez). Fuber Yönetim’den yönetilen ayarlar (uyandırma sözü, asistanın adı, model, söz kesme ' +
        'kipi, anahtarlar, modüller) sesle değişmez: araç bunu ve nereden değişeceğini söyler, sen de kullanıcıya aynen aktar. Ayarın ' +
        'değiştiğini ancak bu araç başarılı dönerse söyle.',
      input: z.object({
        name: z
          .string()
          .min(1)
          .describe(
            'Ayarın adı: windowsla_basla, sessiz_saatler, rahatsiz_etme, bildirim_sesi, hitap, ad, bilgisayar_kullanma_izni, ekran_okuma_izni, tarayici_izni, gorunum, ses_motoru, ses, hareket, ada_ekrani, dinleme_suresi',
          ),
        value: z
          .union([z.string(), z.boolean(), z.number()])
          .describe('Yeni değer: "aç" ya da "kapat"; sessiz saatlerde aralık "23:00-07:00"; hitapta sözcük; görünümde "takımyıldız" ya da "çentik"; ses motorunda "piper", "supertonic"; seste "erkek 5"'),
      }),
      risk: 'write',
      async run({ name, value }, ctx) {
        const before = ctx.settings.get() as unknown as Record<string, unknown>;
        const plan = planSet(name, value, before, ctx.policy.get());
        if (!plan.ok) return { ok: false, text: plan.text };
        if (plan.approval) {
          // İzin AÇMA her zaman kullanıcının açık onayını ister (ada kartı ya da sesle "onaylıyorum").
          const decision = await ctx.tools.requestApproval({
            toolName: 'settings_set',
            moduleId: ctx.moduleId,
            summary: plan.approval,
            input: { name, value },
            origin: ctx.origin,
          });
          if (decision !== 'approved') return { ok: false, text: decision === 'expired' ? t('tool.error.expired') : t('tool.error.denied') };
        }
        if (Object.keys(plan.patch).length > 0) ctx.settings.update(plan.patch as Partial<Settings>);
        return { ok: true, text: `${plan.unchanged ? 'Değişiklik gerekmedi.' : 'Ayar değişti.'} Kullanıcıya yalnız şunu söyle: "${plan.say}"` };
      },
    }),
    defineTool({
      name: 'authority_set',
      description:
        'Yetki düzeyini değiştirir ya da okur: "ask" (her şeyi sor), "smart" (geri alınabilir işleri sormadan yap; silme, gönderme, ' +
        'ödeme, komut için sor), "full" (tam yetki: hiçbir şey sorma). "Tam yetki ver", "bir saatliğine tam yetki", "bu iş bitene ' +
        'kadar sormadan devam et", "her şeyi sor", "tam yetkiyi kapat", "yetki düzeyin ne" denince kullan. Yükseltme kullanıcıdan ' +
        'bir kez onay ister (kapı sorar; sen ayrıca sorma). Kullanıcı açıkça istemeden ASLA çağırma.',
      input: z.object({
        level: z.enum(['ask', 'smart', 'full', 'status']).describe('ask, smart, full; yalnız okumak için status'),
        minutes: z.number().int().min(1).max(720).optional().describe('Süreli tam yetki: dakika ("bir saatliğine" = 60)'),
        task: z.boolean().optional().describe('Yalnız bu iş bitene kadar tam yetki'),
        clear: z.boolean().optional().describe('Tam yetkiyi / geçici yükseltmeyi kaldır'),
      }),
      risk: 'write',
      async run({ level, minutes, task, clear }, ctx) {
        const request: AuthorityRequest = clear
          ? { kind: 'clear' }
          : level === 'status'
            ? { kind: 'status' }
            : level === 'full' && minutes
              ? { kind: 'grant', minutes }
              : level === 'full' && task
                ? { kind: 'grant', task: true }
                : { kind: 'level', level };
        const plan = planAuthorityChange(ctx.tools.authority(), request);
        if (plan.action === 'confirm') {
          const decision = await ctx.tools.requestApproval({
            toolName: 'authority_set',
            moduleId: ctx.moduleId,
            summary: plan.summary,
            ask: plan.ask,
            kind: 'authority',
            input: { level, ...(minutes ? { minutes } : {}), ...(task ? { task } : {}) },
            origin: ctx.origin,
          });
          if (decision !== 'approved') return { ok: false, text: `Yetki düzeyi değişmedi. Kullanıcıya yalnız şunu söyle: "${t('authority.say.denied')}"` };
        }
        if (plan.action !== 'say') {
          if (plan.apply.grant !== undefined) ctx.tools.grantAuthority(plan.apply.grant);
          if (plan.apply.level !== undefined) ctx.settings.update({ authorityLevel: plan.apply.level });
        }
        return { ok: true, text: `Kullanıcıya yalnız şunu söyle: "${plan.say}"` };
      },
    }),
    defineTool({
      name: 'voice_test_start',
      group: 'settings',
      description:
        'Bir ses sınamasını başlatır: söz kesme sınaması (barge_in), yankı sınaması (echo), uyandırma alıştırması (wake_training), ' +
        'mikrofon sınaması (mic). "Söz kesme sınamasını başlat", "yankıyı sına", "uyandırmayı alıştır", "mikrofonumu sına" denince kullan. ' +
        'Sınama bu yanıt söylendikten sonra başlar ve sonucu ayrıca söylenir; "başlattım" de, sonucu uydurma.',
      input: z.object({ test: z.enum(['barge_in', 'echo', 'wake_training', 'mic']).describe('barge_in, echo, wake_training ya da mic') }),
      risk: 'write',
      async run({ test }, ctx) {
        return startSpokenTest(test, ctx).result;
      },
    }),
    defineTool({
      name: 'app_navigate',
      group: 'settings',
      description:
        'Asistanın ANA PENCERESİNİ istenen sayfada açar: Bugün, Sohbet, Hafıza, Planlar, Projeler, İşler, Toplantı, Yetenekler, Ayarlar ve ' +
        'Ayarlar’ın sekmeleri (ses, kısayollar, gizlilik, e-posta, bağlantı, tanı). "Ayarları aç", "projeler sayfasını aç", "son sohbeti göster", ' +
        '"ses ayarlarına git" gibi isteklerde kullan. Windows uygulaması, dosya ya da web sitesi açmak için DEĞİLDİR.',
      input: z.object({
        page: z
          .string()
          .min(1)
          .describe('Sayfa: today, chat, memory, planner, projects, watch, meeting, skills, settings, settings/voice, settings/hotkeys, settings/privacy, settings/mail, settings/connection, settings/diagnostics'),
      }),
      risk: 'read',
      async run({ page }, ctx) {
        const target = findSpokenPage(page);
        if (!target) {
          return { ok: false, text: `“${page}” adında bir sayfa yok. Açılabilen sayfalar: ${[...new Set(SPOKEN_PAGES.filter((item) => !item.tab).map((item) => item.label))].join(', ')}.` };
        }
        if (target.moduleId && !moduleOpen(ctx, target.moduleId)) {
          return { ok: false, text: `${target.label} sayfası şu an yok: modülü kapalı. Kullanıcıya bunu söyle.` };
        }
        ctx.bus.emit('app.navigate', { page: target.page, ...(target.tab ? { params: { tab: target.tab } } : {}) });
        return { ok: true, text: `Ana pencere ${target.label} sayfasında açıldı. Kullanıcıya yalnız şunu söyle: "${target.label} sayfasını açtım."` };
      },
    }),
  ],

  setup(ctx) {
    // Beyin ses servisinden önce kurulur ve onu tanımaz; ses hattının durumunu her turda buradan sorar.
    // Beyin kurulamamışsa (yer tutucu) bağlama atlanır; ses araçları yine çalışır.
    const brain = ctx.brain as Partial<BrainService>;
    try {
      brain.attachSelfState?.(() => collectSelfSource(ctx));
      attachedBrain = brain;
    } catch (error) {
      ctx.log.debug(`öz-durum kaynağı bağlanamadı: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  teardown() {
    try {
      attachedBrain?.attachSelfState?.(null);
    } catch {
      // Beyin yer tutucusu: bağlanan bir şey yoktu.
    }
    attachedBrain = null;
    hardwareCache = null;
    resetSpokenTests();
  },
});
