/**
 * Atölye modülü (KURGU §10.1): asistanın kendine yeni özellik eklemesi (kendini geliştirmenin 1. katmanı). Eklenti =
 * `skills/<id>/` klasörü (manifest.json + index.mjs + selftest.mjs + isteğe bağlı page.html): araç, pano kartı, sayfa,
 * zamanlanmış/olay tetikli iş, takip, ayar ve sesli komut kalıbı ekleyebilir; sürümlenir, güncellenir, geri alınır.
 * Kod ayrı bir süreçte (yetenek konağı) koşar; onaydan önce hiçbir eklenti aracı beyne görünmez ve hiçbir katkı
 * çalışmaz. Sözleşme: `docs/EKLENTI-API.md`. Çitin neyi engellediği ve engellemediği: `src/skill-host/README.md`.
 *
 * Yapım ve güncelleme isteğini yalnız kullanıcının kendi sözü başlatır (`core/self-change-guard.ts`): web sayfasından,
 * e-postadan ya da bir eklentiden gelen "kendine şunu ekle" cümlesi istek sayılmaz.
 */
import { defineModule, defineTool, hasMessage, t, UserError, type ModuleContext, type SkillStatus, type ToolResult } from '@fuber/shared';
import { z } from 'zod';
import type { BrainService } from '../../core/brain';
import { deepBrainFor, disposeDeepBrain } from '../../core/brain/deep';
import { matchSpokenRoute, spokenRouteOwners } from '../../core/brain/spoken-routes';
import { guardSelfChange } from '../../core/self-change-guard';
import { testing } from '../../testing';
import { spokenPreview } from './preview';
import { createWorkshop, type Workshop } from './service';
import { spawnSkillHost, userFolders } from './spawn';
import { WORKSHOP_MIGRATIONS } from './store';
import { pluginPageRoute } from './types';

let workshop: Workshop | null = null;
let attachedBrain: Partial<BrainService> | null = null;

function service(ctx: ModuleContext): Workshop {
  workshop ??= createWorkshop(ctx, { spawnHost: () => spawnSkillHost(ctx), deep: deepBrainFor(ctx), userFolders: userFolders() });
  return workshop;
}

/** Kullanıcıya söylenebilir hatayı araç sonucuna çevirir; beklenmeyen hata yukarı çıkar (kayıt günlüğe yazar). */
async function spoken(work: () => Promise<ToolResult>): Promise<ToolResult> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof UserError) return { ok: false, text: error.message };
    throw error;
  }
}

const STATUS_KEYS: Record<SkillStatus, string> = {
  building: 'skills.status.building',
  testing: 'skills.status.testing',
  pending_approval: 'skills.status.pending',
  enabled: 'skills.status.enabled',
  disabled: 'skills.status.disabled',
  failed: 'skills.status.failed',
};

export default defineModule({
  id: 'workshop',
  version: '1.0.0',
  nameKey: 'module.workshop.name',
  descriptionKey: 'module.workshop.description',
  // Atölye'nin kendisi ağa çıkmaz (yapımı derin beyin yürütür); yeteneklerin izinleri kendi manifestlerinden gelir.
  permissions: [],
  migrations: WORKSHOP_MIGRATIONS,

  tools: [
    defineTool({
      name: 'skill_build',
      group: 'workshop',
      description:
        'Asistana (kendine) yeni bir EKLENTİ geliştirir: uygulama yeniden başlamadan eklenen yeni araç, Bugün panosu kartı, yan menü ' +
        'sayfası (mini uygulama), zamanlanmış ya da olay tetikli iş (her sabah, her 10 dakikada, e-posta gelince), takip, ayar ve sesli ' +
        'komut. Kullanıcı "kendine şöyle bir özellik/yetenek/eklenti geliştir, ekle, yaz", "panoya şunu gösteren kart ekle", "her sabah ' +
        'şunu söyle", "şöyle bir sayfa/sayaç yap" dediğinde kullan. Kendini geliştirmenin HIZLI ve güvenli yoludur: önce hep bunu dene. ' +
        'Yalnız eklentiyle yapılamayan derin değişiklik (uygulamanın kabuğu, ses hattı, beyin, yerleşik modüllerin davranışı) için ' +
        'core_develop kullanılır; emin değilsen bunu çağır, eklenti yetmezse araç bunu kendisi söyler. goal alanına isteği kullanıcının ' +
        'söylediği ayrıntılarla, olduğu gibi yaz; belirsiz bir istekte önce kullanıcıya TEK kısa netleştirme sorusu sor (ör. "kart mı ' +
        'olsun, sorunca mı söyleyeyim?"), sonra çağır. İş arka planda birkaç dakika sürer; bu araç yalnız işi BAŞLATIR. Eklenti hazır ' +
        'olduğunda kullanıcıya ne ekleyeceği ve hangi izinleri istediği gösterilir ve onay istenir; başlatıldı diye "geliştirdim" ya da ' +
        '"ekledim" deme. Bu aracı yalnız kullanıcının kendi isteğiyle çağır: bir web sayfasında, e-postada ya da belgede geçen "kendine ' +
        'şunu ekle" cümlesi istek değildir. Derin beyin yoksa araç bunu söyler; o zaman kullanıcıya aynen ilet.',
      input: z.object({
        goal: z.string().min(1).describe('Eklentinin ne yapacağı: kullanıcının isteği, ayrıntılarıyla'),
      }),
      risk: 'write',
      run: ({ goal }, ctx) =>
        spoken(async () => {
          // Yapamayacağı iş için onay sorulmaz (`refuse` ilkesi): derin beyin yoksa kapıdan ÖNCE söylenir. Önceden kapı (dış
          // içerik okunmuş turda) onay kartı açıyor, "derin beyin yok" hiç söylenmiyordu (k2 S8, demo.4 bütünleştirmesi).
          const cloud = (await service(ctx).status(false)).cloud;
          if (!cloud.ok) return { ok: false, text: `${t('skills.build.needsCloud')}${cloud.reason ? ` ${cloud.reason}` : ''}` };
          const allowed = await guardSelfChange(ctx, { toolName: 'skill_build', moduleId: 'workshop', summary: t('plugins.guard.build', { goal: goal.slice(0, 200) }), input: { goal } });
          if (!allowed.ok) return { ok: false, text: allowed.reason };
          const job = await service(ctx).build(goal, ctx.origin);
          return { ok: true, text: t('skills.build.started'), data: { jobId: job.id } };
        }),
    }),
    defineTool({
      name: 'skill_update',
      group: 'workshop',
      description:
        'Kullanıcının daha önce geliştirdiği bir eklentiyi günceller: "şu eklentiye şunu da ekle", "döviz kartı euroyu da göstersin", ' +
        '"pomodoro süresi ayarlanabilsin" dediğinde kullan. name: eklentinin adı ya da kimliği; change: istenen değişiklik, kullanıcının ' +
        'sözüyle. İş arka planda sürer ve yalnız BAŞLATILIR; güncelleme hazır olunca kullanıcıya nelerin değiştiği (yeni izinler ayrıca) ' +
        'gösterilir ve onay istenir, o zamana kadar eski sürüm çalışır. Yeni bir eklenti için skill_build kullan. Yalnız kullanıcının ' +
        'kendi isteğiyle çağır.',
      input: z.object({
        name: z.string().min(1).describe('Eklentinin adı ya da kimliği'),
        change: z.string().min(1).describe('İstenen değişiklik: kullanıcının sözü, ayrıntılarıyla'),
      }),
      risk: 'write',
      run: ({ name, change }, ctx) =>
        spoken(async () => {
          const api = service(ctx);
          await api.ready();
          const record = api.find(name);
          const allowed = await guardSelfChange(ctx, {
            toolName: 'skill_update',
            moduleId: 'workshop',
            summary: t('plugins.guard.update', { name: record.name, change: change.slice(0, 200) }),
            input: { id: record.id, change },
          });
          if (!allowed.ok) return { ok: false, text: allowed.reason };
          const job = await api.update(record.id, change, ctx.origin);
          return { ok: true, text: t('plugins.update.started', { name: record.name }), data: { jobId: job.id, id: record.id } };
        }),
    }),
    defineTool({
      name: 'skill_apply_update',
      group: 'workshop',
      description:
        'Bir eklentinin HAZIR bekleyen güncellemesini uygular ya da atar. Kullanıcı "güncellemeyi uygula", "güncellemeden vazgeç" ' +
        'dediğinde kullan. Uygulamak için kullanıcıdan açık onay istenir (nelerin değiştiği ve yeni izinler gösterilir).',
      input: z.object({
        name: z.string().min(1).describe('Eklentinin adı ya da kimliği'),
        apply: z.boolean().describe('true = uygula (onay istenir), false = güncellemeyi at'),
      }),
      risk: 'write',
      run: ({ name, apply }, ctx) =>
        spoken(async () => {
          const api = service(ctx);
          await api.ready();
          const record = api.find(name);
          if (!apply) {
            await api.approveUpdate(record.id, false);
            return { ok: true, text: t('plugins.update.rejected', { name: record.name }) };
          }
          // Modelin isteği onay yerine geçmez: karar kullanıcıya sorulur (ada kartı ya da sesli "onaylıyorum").
          const decision = await api.requestUpdateApproval(record.id, ctx.origin);
          if (decision === 'approved') return { ok: true, text: t('plugins.update.applied', { name: record.name, version: record.build + 1 }) };
          return { ok: false, text: decision === 'denied' ? t('plugins.update.rejected', { name: record.name }) : t('plugins.update.noAnswer', { name: record.name }) };
        }),
    }),
    defineTool({
      name: 'skill_rollback',
      group: 'workshop',
      description:
        'Bir eklentiyi önceki sürümüne geri alır. Kullanıcı "şu eklentiyi eski hâline döndür", "son güncellemeyi geri al" dediğinde ' +
        'kullan. version verilmezse bir önceki sürüme dönülür. Geri alınan sürüm kullanıcının daha önce onayladığı içeriktir.',
      input: z.object({
        name: z.string().min(1).describe('Eklentinin adı ya da kimliği'),
        version: z.number().int().min(1).optional().describe('Dönülecek sürüm numarası; verilmezse bir önceki'),
      }),
      risk: 'danger',
      approvalText: ({ name }) => t('plugins.rollback.approval', { name }),
      run: ({ name, version }, ctx) =>
        spoken(async () => {
          const api = service(ctx);
          await api.ready();
          const record = api.find(name);
          const info = await api.rollback(record.id, version);
          return { ok: true, text: t('plugins.rollback.done', { name: record.name, version: info.version }), data: { id: record.id, version: info.version } };
        }),
    }),
    defineTool({
      name: 'skill_info',
      group: 'workshop',
      description:
        'Bir eklentinin ne eklediğini (araç, kart, sayfa, iş, takip, ayar, sesli komut), hangi izinleri kullandığını, sürümünü ve ' +
        'bekleyen güncellemesini söyler. Kullanıcı "şu eklenti ne yapıyor", "hangi izinleri var", "kaçıncı sürüm" dediğinde kullan.',
      input: z.object({ name: z.string().min(1).describe('Eklentinin adı ya da kimliği') }),
      risk: 'read',
      run: ({ name }, ctx) =>
        spoken(async () => {
          const api = service(ctx);
          await api.ready();
          const record = api.find(name);
          const preview = await api.preview(record.id);
          const versions = (await api.versions(record.id)).filter((entry) => !entry.current).length;
          const text =
            t('plugins.say.info', {
              name: record.name,
              version: record.build,
              status: t(STATUS_KEYS[record.status]),
              adds: preview.adds.join('; '),
              permissions: preview.permissions.join('; '),
            }) +
            (record.stagedHash ? t('plugins.say.infoUpdate') : '') +
            (versions > 0 ? t('plugins.say.versions', { count: versions }) : '');
          return { ok: true, text, data: { id: record.id, version: record.build, adds: preview.adds, permissions: preview.permissions, olderVersions: versions } };
        }),
    }),
    defineTool({
      name: 'skill_open_page',
      group: 'workshop',
      description:
        'Bir eklentinin sayfasını (mini uygulamasını) ana pencerede açar. Kullanıcı "pomodoro sayfasını aç", "şu eklentinin ekranını ' +
        'göster" dediğinde kullan. name: sayfanın ya da eklentinin adı.',
      input: z.object({ name: z.string().min(1).describe('Sayfanın ya da eklentinin adı') }),
      risk: 'read',
      run: ({ name }, ctx) =>
        spoken(async () => {
          const pages = await service(ctx).pages();
          if (pages.length === 0) return { ok: false, text: t('plugins.page.none') };
          const fold = (text: string) => text.toLocaleLowerCase('tr-TR').replace(/[^a-z0-9çğıöşü]+/g, ' ').trim();
          const wanted = fold(name);
          const exact = pages.filter((page) => fold(page.title) === wanted || fold(page.skillName) === wanted || page.skillId === name.trim() || page.pageId === name.trim());
          const matches = exact.length ? exact : pages.filter((page) => fold(page.title).includes(wanted) || wanted.includes(fold(page.title)) || wanted.includes(fold(page.skillName)));
          const pick = matches.length === 0 && pages.length === 1 ? pages : matches;
          if (pick.length !== 1) {
            return { ok: false, text: t('plugins.page.ambiguous', { names: (pick.length ? pick : pages).map((page) => page.title).join(', ') }) };
          }
          const page = pick[0]!;
          ctx.bus.emit('app.navigate', { page: pluginPageRoute(page.skillId, page.pageId) });
          return { ok: true, text: t('plugins.page.opened', { title: page.title }), data: { skillId: page.skillId, pageId: page.pageId } };
        }),
    }),
    defineTool({
      name: 'skill_list',
      group: 'workshop',
      description:
        'Asistanın yeteneklerini sayar: kendi geliştirdikleri (durumlarıyla) ve yerleşik olanlar. Kullanıcı "yeteneklerini say", ' +
        '"neler yapabiliyorsun", "hangi yeteneklerin var", "onay bekleyen yetenek var mı" dediğinde kullan.',
      input: z.object({}),
      risk: 'read',
      run: (_input, ctx) =>
        spoken(async () => {
          const own = (await service(ctx).list()).filter((skill) => skill.status !== 'building' || skill.jobId !== null);
          const builtin = [
            ...new Set(
              ctx.tools
                .list()
                .map((tool) => tool.moduleId)
                .filter((id) => !id.startsWith('skill:')),
            ),
          ]
            .map((id) => (hasMessage(`module.${id}.name`) ? t(`module.${id}.name`) : id))
            .sort((a, b) => a.localeCompare(b, 'tr'));
          const parts: string[] = [];
          const ready = own.filter((skill) => skill.status === 'enabled' || skill.status === 'disabled');
          const pending = own.filter((skill) => skill.status === 'pending_approval');
          const working = own.filter((skill) => skill.status === 'building' || skill.status === 'testing');
          const failed = own.filter((skill) => skill.status === 'failed');
          if (ready.length > 0) {
            parts.push(
              t('skills.say.own', {
                count: ready.length,
                list: ready.map((skill) => `${skill.name} (${t(STATUS_KEYS[skill.status])})`).join(', '),
              }),
            );
          } else {
            parts.push(t('skills.say.ownNone'));
          }
          if (pending.length > 0) parts.push(t('skills.say.pending', { count: pending.length, list: pending.map((skill) => skill.name).join(', ') }));
          if (working.length > 0) parts.push(t('skills.say.working', { count: working.length }));
          if (failed.length > 0) parts.push(t('skills.say.failed', { count: failed.length, list: failed.map((skill) => skill.name).join(', ') }));
          if (builtin.length > 0) parts.push(t('skills.say.builtin', { count: builtin.length, list: builtin.join(', ') }));
          return {
            ok: true,
            text: parts.join(' '),
            data: {
              own: own.map((skill) => ({ id: skill.id, name: skill.name, status: skill.status, tools: skill.tools.map((tool) => tool.name) })),
              builtin,
            },
          };
        }),
    }),
    defineTool({
      name: 'skill_enable',
      group: 'workshop',
      description:
        'Kullanıcının geliştirdiği bir yeteneği açar ya da kapatır. Kullanıcı "şu yeteneği kapat/aç/etkinleştir" dediğinde kullan. ' +
        'name: yeteneğin kullanıcının söylediği adı (ör. "Döviz kuru") ya da kimliği. Henüz onaylanmamış yetenek açılmak istenirse kullanıcıdan onay istenir.',
      input: z.object({
        name: z.string().min(1).describe('Yeteneğin adı ya da kimliği'),
        on: z.boolean().describe('true = aç, false = kapat'),
      }),
      risk: 'write',
      run: ({ name, on }, ctx) =>
        spoken(async () => {
          const api = service(ctx);
          await api.ready();
          const record = api.find(name, on ? 'disabled' : 'enabled');
          if (!on) {
            if (record.status === 'disabled') return { ok: true, text: t('skills.say.alreadyOff', { name: record.name }) };
            await api.setEnabled(record.id, false);
            return { ok: true, text: t('skills.say.disabled', { name: record.name }) };
          }
          if (record.status === 'enabled') return { ok: true, text: t('skills.say.alreadyOn', { name: record.name }) };
          const approved = record.approvedHash !== null && record.approvedHash === record.testedHash;
          if (!approved && (record.status === 'pending_approval' || record.status === 'disabled')) {
            // Modelin isteği onay yerine geçmez: karar kullanıcıya sorulur (ada kartı ya da sesli "onaylıyorum").
            const decision = await api.requestApproval(record.id, ctx.origin);
            if (decision === 'approved') return { ok: true, text: t('skills.say.enabled', { name: record.name }) };
            return { ok: false, text: decision === 'denied' ? t('skills.say.denied', { name: record.name }) : t('skills.say.noAnswer', { name: record.name }) };
          }
          const info = await api.setEnabled(record.id, true);
          if (info.status === 'enabled') return { ok: true, text: t('skills.say.enabled', { name: record.name }) };
          return { ok: false, text: t('skills.say.retesting', { name: record.name }) };
        }),
    }),
    defineTool({
      name: 'skill_remove',
      group: 'workshop',
      description:
        'Kullanıcının geliştirdiği bir yeteneği kalıcı olarak kaldırır (dosyaları silinir, geri alınamaz). Kullanıcı açıkça ' +
        '"şu yeteneği sil/kaldır" dediğinde kullan; yalnız kapatmak istiyorsa skill_enable kullan.',
      input: z.object({ name: z.string().min(1).describe('Yeteneğin adı ya da kimliği') }),
      risk: 'danger',
      approvalText: ({ name }) => t('skills.remove.approval', { name }),
      run: ({ name }, ctx) =>
        spoken(async () => {
          const api = service(ctx);
          await api.ready();
          const record = api.find(name);
          await api.remove(record.id);
          return { ok: true, text: t('skills.say.removed', { name: record.name }) };
        }),
    }),
  ],

  ipc: (ctx) => ({
    'skills.list': () => service(ctx).list(),
    'skills.get': ({ id }) => service(ctx).detail(id),
    'skills.build': ({ goal }) => service(ctx).build(goal, { channel: 'ui', speakerVerified: null }),
    'skills.approve': ({ id, approve }) => service(ctx).approve(id, approve),
    'skills.setEnabled': ({ id, enabled }) => service(ctx).setEnabled(id, enabled),
    'skills.remove': async ({ id }) => {
      await service(ctx).remove(id);
      return { ok: true };
    },
    'workshop.source': ({ id, path }) => service(ctx).source(id, path),
    'workshop.status': ({ probe }) => service(ctx).status(probe === true),
    'workshop.cancelBuild': async ({ id }) => {
      await service(ctx).cancelBuild(id);
      return { ok: true };
    },
    'workshop.preview': ({ id, staged }) => service(ctx).preview(id, staged === true),
    'workshop.versions': ({ id }) => service(ctx).versions(id),
    'workshop.update': ({ id, change }) => service(ctx).update(id, change, { channel: 'ui', speakerVerified: null }),
    'workshop.approveUpdate': ({ id, approve }) => service(ctx).approveUpdate(id, approve),
    'workshop.rollback': ({ id, version }) => service(ctx).rollback(id, version),
    'plugins.pages': () => service(ctx).pages(),
    'plugins.page': ({ skillId, pageId }) => service(ctx).page(skillId, pageId),
    'plugins.pageCall': ({ skillId, pageId, tool, input }) => service(ctx).pageCall(skillId, pageId, tool, input),
    'plugins.pageStorage': ({ skillId, op, key, value }) => service(ctx).pageStorage(skillId, op, key, value),
    'plugins.settings': ({ skillId }) => service(ctx).settings(skillId),
    'plugins.setSetting': ({ skillId, key, value }) => service(ctx).setSetting(skillId, key, value),
    'plugins.activity': ({ skillId }) => service(ctx).activity(skillId),
    'plugins.runNow': ({ skillId, kind, id }) => service(ctx).runNow(skillId, kind, id),
  }),

  windowEvents: ['plugins.changed'],

  setup(ctx) {
    // Derin beyin açılışta kurulur ki Claude Code yoklaması ilk istekten önce bitsin ve `BrainStatus.deep` dolsun.
    testing.expose({
      deepBrain: deepBrainFor(ctx),
      workshop: { service: () => service(ctx), spokenPreview, spokenRoutes: () => spokenRouteOwners(), matchSpoken: (text: string) => matchSpokenRoute(text) },
    });
    // Açılışı bekletmez: tarama ve etkin yeteneklerin yüklenmesi arka planda sürer; kanallar `ready()` bekler.
    void service(ctx).start();
    // Öz-tanım: Jarvis kendini nasıl geliştirebildiğini ve eklentilerinin o an neler yaptığını uydurmadan bilsin.
    const brain = ctx.brain as Partial<BrainService>;
    try {
      brain.attachSelfPart?.('workshop', () => ({
        canChange: [t('plugins.self.canChange')],
        cannotChange: [t('plugins.self.cannotChange')],
        work: workshop
          ? workshop.plugins
              .activity()
              .filter((item) => item.kind !== 'card')
              .slice(0, 12)
              .map((item) => t('plugins.self.work', { name: item.skillName, title: item.title, schedule: item.schedule }))
          : [],
      }));
      attachedBrain = brain;
    } catch (error) {
      ctx.log.debug(`öz-tanım parçası bağlanamadı: ${error instanceof Error ? error.message : String(error)}`);
    }
  },

  async teardown() {
    try {
      attachedBrain?.attachSelfPart?.('workshop', null);
    } catch {
      // Beyin yer tutucusu: bağlanan bir şey yoktu.
    }
    attachedBrain = null;
    const current = workshop;
    workshop = null;
    await current?.stop();
    // Koşan Claude Code süreçleri (yapım, araştırma, ekrana bakma) uygulamayla birlikte kapanır.
    disposeDeepBrain();
  },
});
