import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultSettings,
  defineTool,
  t,
  type ApprovalKind,
  type ApprovalRequest,
  type AuthorityLevel,
  type Bus,
  type BusEvents,
  type Logger,
  type ModuleContext,
  type Paths,
  type PolicyApi,
  type Settings,
  type SettingsApi,
  type StageApi,
  type Store,
  type ToolOrigin,
  type ToolRegistry,
} from '@fuber/shared';
import { z } from 'zod';
import { APPROVAL_CLASS, APPROVAL_KINDS, approvalKindOf, autoApproves, capLevel, planAuthorityChange, routeAuthoritySpeech, shortAsk } from './authority';
import { createBus } from './bus';
import { createStore } from './store';
import { approvalSpeechScope, createTools, interpretApprovalSpeech } from './tools';
import { foldSpeech } from '../voice/text-match';

const lines: string[] = [];
const log: Logger = {
  debug() {},
  info: (message: string) => void lines.push(message),
  warn: (message: string) => void lines.push(message),
  error: (message: string) => void lines.push(`ERROR ${message}`),
  child: () => log,
};

describe('yetki düzeyi: tür sınıfları ve karar', () => {
  const kinds = Object.keys(APPROVAL_CLASS) as ApprovalKind[];

  it('"Her şeyi sor" hiçbir türü sormadan onaylamaz', () => {
    for (const kind of kinds) expect(autoApproves('ask', kind), kind).toBe(false);
  });

  it('"Akıllı": geri alınabilir işler sorulmaz; silme, gönderme, ödeme, komut, süreç, kapatma sorulur', () => {
    for (const kind of ['input', 'window', 'file', 'read', 'watch'] as const) expect(autoApproves('smart', kind), kind).toBe(true);
    for (const kind of ['delete', 'send', 'pay', 'run', 'kill', 'power', 'overwrite', 'download', 'install', 'commit', 'other'] as const) {
      expect(autoApproves('smart', kind), kind).toBe(false);
    }
  });

  it('"Tam yetki": kritikler de sorulmaz; izin açma ve yetki yükseltme HER düzeyde sorulur', () => {
    for (const kind of kinds) {
      const always = kind === 'permission' || kind === 'authority' || kind === 'update';
      expect(autoApproves('full', kind), kind).toBe(!always);
    }
    for (const level of ['ask', 'smart', 'full'] as const) {
      expect(autoApproves(level, 'authority')).toBe(false);
      expect(autoApproves(level, 'permission')).toBe(false);
      // Çekirdek güncellemesini kurma / geri alma (d4-gelistir): Tam yetki'de BİLE sorulur.
      expect(autoApproves(level, 'update')).toBe(false);
      expect(autoApproves(level, approvalKindOf('core_install'))).toBe(false);
      expect(autoApproves(level, approvalKindOf('core_rollback'))).toBe(false);
    }
  });

  it('tür: çağıranın verdiği → araç adından → sınıflanmamış araç kritiktir', () => {
    expect(approvalKindOf('mail_send')).toBe('send');
    expect(approvalKindOf('file_delete')).toBe('delete');
    expect(approvalKindOf('pc_run_command')).toBe('run');
    expect(approvalKindOf('process_kill')).toBe('kill');
    expect(approvalKindOf('system_power')).toBe('power');
    expect(approvalKindOf('file_copy')).toBe('file');
    expect(approvalKindOf('file_write')).toBe('file');
    expect(approvalKindOf('file_write', 'overwrite')).toBe('overwrite');
    expect(approvalKindOf('pc_keys', 'send')).toBe('send');
    expect(approvalKindOf('bilinmeyen_yetenek_araci')).toBe('other');
    expect(approvalKindOf('claude_permission')).toBe('permission');
    // Tablodaki her tür tanımlı bir sınıfa düşer.
    for (const [name, kind] of Object.entries(APPROVAL_KINDS)) expect(APPROVAL_CLASS[kind], name).toBeDefined();
  });

  it('Yönetim sınırı düzeyi aşağı çeker, yukarı çekmez', () => {
    expect(capLevel('full', 'smart')).toBe('smart');
    expect(capLevel('full', 'ask')).toBe('ask');
    expect(capLevel('ask', 'full')).toBe('ask');
    expect(capLevel('smart', 'smart')).toBe('smart');
  });

  it('sesli soru kısadır ve tek sorudur', () => {
    expect(shortAsk('send', '“WhatsApp” penceresinde Enter’a basmak istiyorum; bu bir iletiyi gönderebilir.')).toBe('Göndereyim mi?');
    expect(shortAsk('delete', 'rapor.pdf dosyasını silmek istiyorum.')).toBe('Sileyim mi?');
    expect(shortAsk('pay', 'x')).toBe('Ödemeyi onaylayayım mı?');
    expect(shortAsk('other', 'Notları silmek istiyorum (all).')).toBe('Notları silmek istiyorum (all). Yapayım mı?');
    for (const kind of kinds) expect(shortAsk(kind, 'Özet.').match(/\?/g), kind).toHaveLength(1);
  });
});

describe('yetki düzeyi: sesle değiştirme (kalıplar ve plan)', () => {
  const route = (text: string) => routeAuthoritySpeech(foldSpeech(text).replace(/[^\p{L}\p{N}\s]+/gu, ' '));

  it.each([
    ['Tam yetki ver.', { kind: 'level', level: 'full' }],
    ['Sana tam yetki veriyorum', { kind: 'level', level: 'full' }],
    ['Jarvis tam yetkiye geç', { kind: 'level', level: 'full' }],
    ['Tam yetki', { kind: 'level', level: 'full' }],
    ['Bir saatliğine tam yetki ver', { kind: 'grant', minutes: 60 }],
    ['30 dakikalığına tam yetki', { kind: 'grant', minutes: 30 }],
    ['İki saat tam yetki ver', { kind: 'grant', minutes: 120 }],
    ['Bu iş bitene kadar tam yetki', { kind: 'grant', task: true }],
    ['Sormadan devam et', { kind: 'grant', task: true }],
    ['Tam yetkiyi kapat', { kind: 'clear' }],
    ['Tam yetkiyi geri al', { kind: 'clear' }],
    ['Her şeyi sor', { kind: 'level', level: 'ask' }],
    ['Artık her şeyi bana sor', { kind: 'level', level: 'ask' }],
    ['Akıllı yetkiye geç', { kind: 'level', level: 'smart' }],
    ['Yetki düzeyin ne?', { kind: 'status' }],
    ['Tam yetki açık mı?', { kind: 'status' }],
  ] as const)('"%s"', (text, expected) => {
    expect(route(text)).toEqual(expected);
  });

  it.each([
    'Ahmet’e tam yetki verdiğimi söyle ve vekaletnameyi hazırlat lütfen bugün',
    'Yetkili servisi ara',
    'Bana bir şey sor',
    'Akıllı telefonumu bul',
    'Şirkette kimin tam yetkisi var onu araştır bakalım hemen şimdi lütfen',
  ])('yetki komutu değildir: "%s"', (text) => {
    expect(route(text)).toBeNull();
  });

  const state = (level: AuthorityLevel, max: AuthorityLevel = 'full', grant: { scope: 'time' | 'task' } | null = null) => ({
    level: grant ? 'full' : level,
    base: level,
    max,
    grant,
  });

  it('yükseltme bir kez onay ister; düşürme ve kaldırma sorulmaz', () => {
    expect(planAuthorityChange(state('smart'), { kind: 'level', level: 'full' })).toMatchObject({
      action: 'confirm',
      ask: t('authority.ask.raiseFull'),
      apply: { level: 'full', grant: null },
      say: t('authority.say.full'),
    });
    expect(planAuthorityChange(state('ask'), { kind: 'level', level: 'smart' })).toMatchObject({ action: 'confirm', ask: t('authority.ask.raiseSmart') });
    expect(planAuthorityChange(state('full'), { kind: 'level', level: 'ask' })).toMatchObject({ action: 'apply', apply: { level: 'ask' }, say: t('authority.say.ask') });
    expect(planAuthorityChange(state('full'), { kind: 'clear' })).toMatchObject({ action: 'apply', apply: { level: 'smart', grant: null } });
    expect(planAuthorityChange(state('smart', 'full', { scope: 'time' }), { kind: 'clear' })).toMatchObject({ action: 'apply', apply: { level: 'smart', grant: null } });
    expect(planAuthorityChange(state('smart'), { kind: 'level', level: 'smart' })).toMatchObject({ action: 'say' });
  });

  it('süreli ve işe bağlı tam yetki ayarı değiştirmez; yalnız geçici yükseltme verir', () => {
    expect(planAuthorityChange(state('smart'), { kind: 'grant', minutes: 60 })).toMatchObject({
      action: 'confirm',
      apply: { grant: { minutes: 60 } },
      say: t('authority.say.fullTimed', { duration: t('authority.duration.hours', { n: 1 }) }),
    });
    expect(planAuthorityChange(state('smart'), { kind: 'grant', task: true })).toMatchObject({ action: 'confirm', apply: { grant: { task: true } }, say: t('authority.say.fullTask') });
    expect(planAuthorityChange(state('smart'), { kind: 'grant', minutes: 45 })).toMatchObject({ ask: t('authority.ask.raiseFullTimed', { duration: t('authority.duration.minutes', { n: 45 }) }) });
  });

  it('Yönetim sınırı aşılamaz: onay bile sorulmaz, neden söylenir', () => {
    const capped = t('authority.say.capped', { level: t('authority.level.smart') });
    expect(planAuthorityChange(state('smart', 'smart'), { kind: 'level', level: 'full' })).toEqual({ action: 'say', say: capped });
    expect(planAuthorityChange(state('smart', 'smart'), { kind: 'grant', minutes: 60 })).toEqual({ action: 'say', say: capped });
    expect(planAuthorityChange(state('ask', 'ask'), { kind: 'level', level: 'smart' })).toMatchObject({ action: 'say' });
  });
});

describe('sözlü onay: doğrudan sorulan soruda gündelik sözler, "sormadan devam et"', () => {
  it('kimliği bilinmeyen onayda dar kural sürer; doğrudan sorulanda "tamam", "yap", "olur", "gönder" onaydır', () => {
    for (const word of ['tamam', 'yap', 'olur', 'gönder', 'tamam gönder', 'tamam yap', 'devam et']) {
      expect(interpretApprovalSpeech(word), word).toBe('unclear');
      expect(interpretApprovalSpeech(word, { asked: true }), word).toBe('approved');
    }
    for (const word of ['evet', 'onaylıyorum', 'onayla']) expect(interpretApprovalSpeech(word), word).toBe('approved');
  });

  it('ret her iki kipte de önce gelir', () => {
    for (const word of ['hayır', 'vazgeç', 'tamam vazgeç', 'yapma', 'iptal et', 'gönderme', 'bekle', 'gerek yok']) {
      expect(interpretApprovalSpeech(word, { asked: true }), word).toBe('denied');
    }
    expect(interpretApprovalSpeech('gönderme')).toBe('unclear');
  });

  it('uzun ve belirsiz söz doğrudan sorulan soruda da onay değildir', () => {
    for (const word of ['tamam ama önce bir şey soracağım sana', 'hmm', 'bir dakika', 'Ahmet kim', 'tamam mı']) {
      expect(interpretApprovalSpeech(word, { asked: true }), word).toBe('unclear');
    }
  });

  it('"sormadan devam et" / "bu iş boyunca sorma" / "hepsine evet": onay + iş boyunca', () => {
    for (const word of ['sormadan devam et', 'bu iş boyunca sorma', 'hepsine evet', 'bir daha sorma', 'evet sormadan yap']) {
      expect(approvalSpeechScope(word), word).toBe('task');
      expect(interpretApprovalSpeech(word, { asked: true }), word).toBe('approved');
    }
    for (const word of ['evet', 'tamam', 'bana sor', 'her seferinde sor']) expect(approvalSpeechScope(word), word).toBeNull();
  });
});

describe('araç kapısı: üç düzey, tek karar yeri', () => {
  let dir: string;
  let store: Store;
  let bus: Bus;
  let tools: ToolRegistry;
  let settings: Settings;
  let requests: ApprovalRequest[];
  let autos: Array<BusEvents['tool.approval.auto']>;
  let ran: string[];
  let max: AuthorityLevel | undefined;
  const origin: ToolOrigin = { channel: 'voice', speakerVerified: null };
  // Aracın kendi içinden onay isteyebilmesi için bağlam kaydı taşır (çağrı anında okunur).
  const ctx = {
    moduleId: 'pc',
    get tools() {
      return tools;
    },
  } as ModuleContext;

  beforeEach(() => {
    lines.length = 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-authority-'));
    store = createStore({ paths: { db: path.join(dir, 'test.db') } as Paths, log });
    bus = createBus({ log });
    requests = [];
    autos = [];
    ran = [];
    max = undefined;
    bus.on('tool.approval.request', (request) => void requests.push(request));
    bus.on('tool.approval.auto', (event) => void autos.push(event));
    settings = defaultSettings('C:/x');
    const settingsApi: SettingsApi = {
      get: () => settings,
      update: (patch) => {
        settings = { ...settings, ...patch };
        bus.emit('settings.changed', { settings, changedKeys: Object.keys(patch) as Array<keyof Settings> });
        return settings;
      },
    };
    const policy = {
      killSwitchActive: () => false,
      updateRequired: () => false,
      networkAllowed: () => true,
      moduleAllowed: () => true,
      get: () => ({ limits: { dailyBudgetUsd: 10, maxAgentSteps: 40, ...(max ? { maxAuthority: max } : {}) } }),
    } as unknown as PolicyApi;
    tools = createTools({ store, policy, settings: settingsApi, stage: { showCard: () => ({ id: 's' }) } as unknown as StageApi, bus, log });
    tools.register(ctx, [
      defineTool({
        name: 'file_delete',
        description: 'Dosyayı siler.',
        input: z.object({ path: z.string() }),
        risk: 'danger',
        approvalText: ({ path: target }) => `“${target}” dosyasını silmek istiyorum.`,
        // Hiçbir düzeyde çalışmayacak girdi: korunan yol (parola kasası, sistem klasörü).
        refuse: ({ path: target }) => (/parolalar|windows/i.test(target) ? 'Bu yol korunuyor; silinmez.' : null),
        async run({ path: target }) {
          ran.push(`delete:${target}`);
          return { ok: true, text: 'silindi' };
        },
      }),
      defineTool({
        name: 'mail_send',
        description: 'E-posta gönderir.',
        input: z.object({ to: z.string() }),
        risk: 'danger',
        approvalText: ({ to }) => `${to} adresine e-posta göndermek istiyorum.`,
        async run({ to }) {
          ran.push(`send:${to}`);
          return { ok: true, text: 'gönderildi' };
        },
      }),
      defineTool({
        name: 'pc_keys',
        description: 'Tuşa basar.',
        input: z.object({ keys: z.string(), window: z.string().optional() }),
        risk: 'write',
        // Parola alanı ve banka penceresi yasağı onaydan ÖNCE ve düzeyden bağımsızdır.
        refuse: ({ window }) => (window && /banka|ziraat|parola/i.test(window) ? 'Banka ve parola pencerelerine dokunmam.' : null),
        async run({ keys, window }, call) {
          // Aracın kendi içinden istediği onay: Enter mesajlaşma penceresinde "gönder" demektir.
          const kind: ApprovalKind = keys === 'enter' && window === 'WhatsApp' ? 'send' : 'input';
          const decision = await call.tools.requestApproval({ toolName: 'pc_keys', moduleId: 'pc', summary: `${window ?? 'pencere'}: ${keys}`, input: { keys }, origin: call.origin, kind });
          if (decision !== 'approved') return { ok: false, text: 'reddedildi' };
          ran.push(`keys:${keys}`);
          return { ok: true, text: 'basıldı' };
        },
      }),
    ]);
  });

  afterEach(() => {
    tools.cancelAll();
    store.close?.();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  /** Aracı çalıştırır; onay istenirse `answer` ile yanıtlar. */
  const run = async (name: string, input: unknown, answer: 'approved' | 'denied' = 'approved', signal?: AbortSignal) => {
    const before = requests.length;
    let settled = false;
    const pending = tools.run(name, input, { origin, ...(signal ? { signal } : {}) }).finally(() => {
      settled = true;
    });
    // Ya onay istenir ya da araç sorulmadan biter.
    await vi.waitFor(() => {
      if (requests.length === before && !settled) throw new Error('bekleniyor');
    });
    const asked = requests.length > before;
    if (asked) tools.resolveApproval(requests.at(-1)!.id, answer, 'ui');
    return { result: await pending, asked };
  };

  it('ayar varsayılanı "Akıllı"dır', () => {
    expect(settings.authorityLevel).toBe('smart');
    expect(tools.authority()).toEqual({ level: 'smart', base: 'smart', max: 'full', grant: null });
  });

  it('"Her şeyi sor": tuş da silme de sorulur', async () => {
    settings.authorityLevel = 'ask';
    expect((await run('pc_keys', { keys: 'tab' })).asked).toBe(true);
    expect((await run('file_delete', { path: 'C:/x/rapor.pdf' })).asked).toBe(true);
    expect(autos).toEqual([]);
  });

  it('"Akıllı": tuş sorulmaz ve günlüğe auto-approved(smart) yazılır; gönderme ve silme sorulur', async () => {
    const key = await run('pc_keys', { keys: 'tab', window: 'Not Defteri' });
    expect(key).toMatchObject({ asked: false, result: { ok: true } });
    expect(lines).toContain('pc_keys: auto-approved(smart) [input]');
    expect(autos).toMatchObject([{ toolName: 'pc_keys', kind: 'input', level: 'smart', origin }]);

    const enter = await run('pc_keys', { keys: 'enter', window: 'WhatsApp' });
    expect(enter.asked).toBe(true);
    expect(requests.at(-1)).toMatchObject({ kind: 'send', ask: 'Göndereyim mi?' });

    const remove = await run('file_delete', { path: 'C:/x/rapor.pdf' });
    expect(remove.asked).toBe(true);
    expect(requests.at(-1)).toMatchObject({ kind: 'delete', ask: 'Sileyim mi?' });
    expect((await run('mail_send', { to: 'ahmet@x.com' })).asked).toBe(true);
    expect(ran).toEqual(['keys:tab', 'keys:enter', 'delete:C:/x/rapor.pdf', 'send:ahmet@x.com']);
  });

  it('"Tam yetki": hiçbir şey sorulmaz, her otomatik onay günlüğe yazılır; YASAKLAR yine çalışır', async () => {
    settings.authorityLevel = 'full';
    expect((await run('pc_keys', { keys: 'enter', window: 'WhatsApp' })).asked).toBe(false);
    expect((await run('file_delete', { path: 'C:/x/rapor.pdf' })).asked).toBe(false);
    expect((await run('mail_send', { to: 'ahmet@x.com' })).asked).toBe(false);
    expect(requests).toEqual([]);
    expect(lines.filter((line) => line.includes('auto-approved(full)'))).toEqual([
      'pc_keys: auto-approved(full) [send]',
      'file_delete: auto-approved(full) [delete]',
      'mail_send: auto-approved(full) [send]',
    ]);
    expect(tools.recentCalls(1)[0]).toMatchObject({ name: 'mail_send', approval: 'approved', ok: true });

    // Ret denetimi onaydan önce ve düzeyden bağımsızdır: banka penceresi, korunan yol.
    const bank = await tools.run('pc_keys', { keys: 'enter', window: 'Ziraat Bankası - İnternet Şubesi' }, { origin });
    expect(bank).toEqual({ ok: false, text: 'Banka ve parola pencerelerine dokunmam.' });
    const vault = await tools.run('file_delete', { path: 'C:/Users/x/parolalar.kdbx' }, { origin });
    expect(vault).toEqual({ ok: false, text: 'Bu yol korunuyor; silinmez.' });
    expect(ran).not.toContain('delete:C:/Users/x/parolalar.kdbx');
  });

  it('yetki arka plan işine ve kullanıcı yeteneğine geçmez: Tam yetki’de de sorulur', async () => {
    settings.authorityLevel = 'full';
    for (const channel of ['job', 'skill'] as const) {
      const before = requests.length;
      const pending = tools.run('file_delete', { path: `C:/x/${channel}.txt` }, { origin: { channel, speakerVerified: null } });
      await vi.waitFor(() => expect(requests.length).toBe(before + 1));
      tools.resolveApproval(requests.at(-1)!.id, 'denied', 'ui');
      expect((await pending).ok).toBe(false);
    }
    expect(autos).toEqual([]);
    expect(ran).toEqual([]);
  });

  it('"Tam yetki"de de izin açma ve yetki yükseltme sorulur; acil durdurma her şeyi keser', async () => {
    settings.authorityLevel = 'full';
    const raise = tools.requestApproval({ toolName: 'authority_set', moduleId: 'voice-control', summary: 'Tam yetki', input: {}, origin, kind: 'authority' });
    const permission = tools.requestApproval({ toolName: 'settings_set', moduleId: 'voice-control', summary: 'İzin', input: {}, origin });
    expect(requests.map((request) => request.kind)).toEqual(['authority', 'permission']);
    tools.cancelAll();
    expect(await raise).toBe('denied');
    expect(await permission).toBe('denied');
  });

  it('Yönetim sınırı: "en çok Akıllı" iken Tam yetki ayarı ve geçici yükseltme etkisizdir', async () => {
    settings.authorityLevel = 'full';
    max = 'smart';
    expect(tools.authority()).toMatchObject({ level: 'smart', base: 'full', max: 'smart' });
    expect(tools.grantAuthority({ minutes: 60 })).toBe(false);
    expect((await run('file_delete', { path: 'C:/x/a.txt' })).asked).toBe(true);
    max = 'ask';
    expect((await run('pc_keys', { keys: 'tab' })).asked).toBe(true);
  });

  it('süreli Tam yetki süresi dolunca kendiliğinden biter; işe bağlı yetki iş bitince kalkar', async () => {
    vi.useFakeTimers();
    try {
      const changes: AuthorityLevel[] = [];
      bus.on('authority.changed', (state) => void changes.push(state.level));
      expect(tools.grantAuthority({ minutes: 60 })).toBe(true);
      expect(tools.authority()).toMatchObject({ level: 'full', base: 'smart', grant: { scope: 'time' } });
      await vi.advanceTimersByTimeAsync(59 * 60_000);
      expect(tools.authority().level).toBe('full');
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(tools.authority()).toMatchObject({ level: 'smart', grant: null });

      tools.grantAuthority({ task: true });
      expect(tools.authority()).toMatchObject({ level: 'full', grant: { scope: 'task' } });
      tools.endTask();
      expect(tools.authority()).toMatchObject({ level: 'smart', grant: null });
      // Süreli yetki iş bitince KALKMAZ.
      tools.grantAuthority({ minutes: 10 });
      tools.endTask();
      expect(tools.authority().level).toBe('full');
      tools.grantAuthority(null);
      expect(changes).toEqual(['full', 'smart', 'full', 'smart', 'full', 'smart']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('acil durdurma geçici Tam yetkiyi de kaldırır', () => {
    tools.grantAuthority({ task: true });
    bus.emit('app.panic', { at: new Date().toISOString(), source: 'hotkey' } as BusEvents['app.panic']);
    expect(tools.authority()).toMatchObject({ level: 'smart', grant: null });
  });

  it('"Bu iş boyunca sorma": kartla ya da sözle onay, kalan adımları sormadan yürütür', async () => {
    const first = tools.run('mail_send', { to: 'a@x.com' }, { origin });
    await vi.waitFor(() => expect(requests).toHaveLength(1));
    tools.resolveApproval(requests[0]!.id, 'approved', 'ui', { scope: 'task' });
    expect((await first).ok).toBe(true);
    expect(tools.authority()).toMatchObject({ level: 'full', grant: { scope: 'task' } });
    expect((await run('file_delete', { path: 'C:/x/b.txt' })).asked).toBe(false);
    tools.endTask();

    const second = tools.run('mail_send', { to: 'b@x.com' }, { origin });
    await vi.waitFor(() => expect(requests).toHaveLength(2));
    expect(tools.resolveApprovalFromSpeech('sormadan devam et', { approvalId: requests[1]!.id, asked: true })).toBe('approved');
    expect((await second).ok).toBe(true);
    expect(tools.authority().grant).toMatchObject({ scope: 'task' });
  });

  it('yetki yükseltme onayı "bu iş boyunca" ile genişletilemez', async () => {
    const raise = tools.requestApproval({ toolName: 'authority_set', moduleId: 'voice-control', summary: 'Akıllı', input: {}, origin, kind: 'authority' });
    tools.resolveApproval(requests[0]!.id, 'approved', 'ui', { scope: 'task' });
    expect(await raise).toBe('approved');
    expect(tools.authority().grant).toBeNull();
  });

  it('aynı şey iki kez sorulmaz: aynı turda reddedilen iş yeniden istenirse sorulmadan reddedilir; yeni turda yeniden sorulur', async () => {
    const turn = new AbortController();
    const denied = await run('mail_send', { to: 'a@x.com' }, 'denied', turn.signal);
    expect(denied).toMatchObject({ asked: true, result: { ok: false, text: t('tool.error.denied') } });
    const again = await tools.run('mail_send', { to: 'a@x.com' }, { origin, signal: turn.signal });
    expect(again).toEqual({ ok: false, text: t('tool.error.denied') });
    expect(requests).toHaveLength(1);
    expect(lines).toContain('mail_send: bu turda reddedildi; yeniden sorulmadı');
    // Başka bir alıcı başka bir iştir; yeni turda (kullanıcı yeniden istedi) aynı iş yeniden sorulur.
    expect((await run('mail_send', { to: 'b@x.com' }, 'approved', turn.signal)).asked).toBe(true);
    expect((await run('mail_send', { to: 'a@x.com' }, 'approved', new AbortController().signal)).asked).toBe(true);
  });

  it('iptal edilen araç günlüğe ERROR düşürmez', async () => {
    tools.register({ moduleId: 'web' } as ModuleContext, [
      defineTool({
        name: 'web_read',
        description: 'Sayfa okur.',
        input: z.object({ url: z.string() }),
        risk: 'read',
        run: (_input, call) =>
          new Promise((_resolve, reject) => {
            call.signal.addEventListener('abort', () => setTimeout(() => reject(new Error('iptal edildi')), 0));
          }),
      }),
    ]);
    const turn = new AbortController();
    const pending = tools.run('web_read', { url: 'https://example.com' }, { origin, signal: turn.signal });
    await new Promise((resolve) => setTimeout(resolve, 5));
    turn.abort();
    expect(await pending).toEqual({ ok: false, text: t('tool.error.aborted') });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(lines.filter((line) => line.startsWith('ERROR'))).toEqual([]);
    expect(lines).toContain('web_read iptal edildi');
  });
});
