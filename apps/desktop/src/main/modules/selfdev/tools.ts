// Çekirdek geliştirme araçları. Kapılar (hepsi koddur, modelin sözüne bağlı değildir):
//  - `core_develop`: `guardSelfChange` İLK iş (köken ses/yazı/arayüz değilse reddeder; aynı turda dış içerik okunduysa açık
//    onay ister) + geliştirici kipi kapısı. Yalnız işi BAŞLATIR.
//  - `core_install` / `core_rollback`: risk `danger` (kayıt kapısı onay kartı çıkarır) VE `run` içinde AYRICA kendi
//    `requestApproval`'ı (ikinci, bağımsız onay: yetki düzeyi "tam yetki" olsa da atlanamaz). Arayüzdeki "Kur" düğmesi de aynı
//    araçtan geçer (`ctx.tools.run`), bu yüzden aynı onay kartlarını görür.
import { defineTool, t, type ToolContext, type ToolResult } from '@fuber/shared';
import { z } from 'zod';
import { guardSelfChange } from '../../core/self-change-guard';
import type { SelfdevService } from './service';
import type { SelfdevRun } from './types';

/** Modül kurulunca doldurulur (araçlar modül yüklenirken tanımlanır, servis `setup`'ta kurulur). */
export const runtime: { service: SelfdevService | null } = { service: null };

const NOT_READY: ToolResult = { ok: false, text: t('selfdev.tool.notReady') };

function closedGate(): string | null {
  const service = runtime.service;
  if (!service) return t('selfdev.tool.notReady');
  const gate = service.gate();
  return gate.open ? null : t('selfdev.tool.gateClosed', { reason: gate.reason ?? '' });
}

const stageLabel = (run: SelfdevRun): string => t(`selfdev.status.${run.status}` as never);

/** Kurulum onay kartının ve ses sorusunun metni: sürüm + değişen dosya sayısı + sınama sonucu (+ dikkat işaretleri). */
export function installSummary(run: SelfdevRun, running: string): string {
  const passed = run.checks.filter((check) => check.ok).length;
  const lastRound = run.checks.length ? Math.max(...run.checks.map((check) => check.round)) : 0;
  const finalChecks = run.checks.filter((check) => check.round === lastRound);
  const allOk = finalChecks.length > 0 && finalChecks.every((check) => check.ok);
  const parts = [
    t('selfdev.approval.install', { from: running, to: run.version ?? '?', count: run.files.length }),
    allOk ? t('selfdev.approval.checksOk', { names: finalChecks.map((check) => check.name).join(', '), rounds: run.fixRounds }) : t('selfdev.approval.checksUnknown', { passed }),
  ];
  if (run.riskFlags.length) parts.push(t('selfdev.approval.flags', { flags: run.riskFlags.join('; ') }));
  parts.push(t('selfdev.approval.restart'));
  return parts.join(' ');
}

export const selfdevTools = [
  defineTool({
    name: 'core_develop',
    group: 'workshop',
    risk: 'write',
    description:
      'Kullanıcı senden KENDİNE (uygulamanın kendisine) eklentiyle yapılamayan DERİN bir değişiklik istediğinde kullan: arayüz kabuğu, ses hattı, beyin, yerleşik modüllerin davranışı, yeni çekirdek servis… ' +
      'Kaynak kodunu ayrı bir dalda Claude Code ile değiştirir, sınar, kurulum paketini üretir ve kurmak için onay ister. Basit yeni yetenek, kart, sayfa ya da zamanlanmış iş için BUNU DEĞİL skill_build kullan. ' +
      'Örnekler: "kendine şöyle bir özellik geliştir", "kendini güncelle: ses hattına X ekle", "ana pencereye yeni bir bölüm ekle". ' +
      'Yalnız işi BAŞLATIR (dakikalar sürer); "güncelledim" ya da "geliştirdim" DEME, "başladım, plan hazır olunca söylerim" de. `reason`: neden eklenti yetmez (kullanıcıya söylenir).',
    input: z.object({
      request: z.string().min(8).max(4000).describe('Kullanıcının isteği, kendi sözleriyle, eksiksiz'),
      reason: z.string().min(3).max(600).describe('Neden eklentiyle yapılamadığı, bir iki cümle'),
    }),
    refuse: () => closedGate(),
    approvalText: ({ request }) => t('selfdev.approval.develop', { request: request.slice(0, 160) }),
    async run({ request, reason }, ctx: ToolContext): Promise<ToolResult> {
      // KAPI İLK İŞ: dış içerikten gelen "kendini güncelle" istek sayılmaz.
      const guard = await guardSelfChange(ctx, { toolName: 'core_develop', moduleId: 'selfdev', summary: t('selfdev.guard.develop', { request: request.slice(0, 160) }), input: { request, reason } });
      if (!guard.ok) return { ok: false, text: guard.reason };
      const closed = closedGate();
      if (closed) return { ok: false, text: closed };
      const service = runtime.service;
      if (!service) return NOT_READY;
      const outcome = service.engine.start({ request, reason, origin: ctx.origin.channel });
      if (!outcome.ok) return { ok: false, text: outcome.text };
      return { ok: true, text: outcome.text, data: { runId: outcome.run?.id ?? null } };
    },
  }),

  defineTool({
    name: 'core_status',
    group: 'workshop',
    risk: 'read',
    description:
      'Çekirdek geliştirmenin durumunu söyler: geliştirici kipi açık mı, süren koşu hangi aşamada, hazır bir güncelleme var mı, kurulu ve önceki sürüm. ' +
      'Örnekler: "güncelleme ne durumda?", "kendini geliştirme nasıl gidiyor?", "hazır bir güncelleme var mı?", "hangi sürümdeyim?".',
    input: z.object({}),
    async run(_input, _ctx): Promise<ToolResult> {
      const service = runtime.service;
      if (!service) return NOT_READY;
      const status = service.status();
      const lines: string[] = [];
      lines.push(status.gate.open ? t('selfdev.tool.gateOpen') : t('selfdev.tool.gateClosed', { reason: status.gate.reason ?? '' }));
      if (status.active) lines.push(t('selfdev.tool.active', { stage: stageLabel(status.active), request: status.active.request.slice(0, 120) }));
      if (status.ready) lines.push(t('selfdev.tool.ready', { version: status.ready.version ?? '?', count: status.ready.files.length, summary: status.ready.planSummary ?? '' }));
      if (status.pending) lines.push(t('selfdev.tool.pending', { version: status.pending.toVersion }));
      if (status.healthFailed) lines.push(t('selfdev.tool.healthFailed', { reason: status.healthFailed.reason }));
      lines.push(t('selfdev.tool.versions', { current: status.versions.current, previous: status.versions.previous ?? t('selfdev.tool.none') }));
      const last = service.store.listRuns(3).filter((run) => run.id !== status.active?.id && run.id !== status.ready?.id);
      for (const run of last.slice(0, 2)) lines.push(t('selfdev.tool.last', { stage: stageLabel(run), request: run.request.slice(0, 80) }));
      return { ok: true, text: lines.join('\n'), data: { gate: status.gate.open, active: status.active?.id ?? null, ready: status.ready?.id ?? null, current: status.versions.current } };
    },
  }),

  defineTool({
    name: 'core_install',
    group: 'workshop',
    risk: 'danger',
    description:
      'Hazır olan çekirdek güncellemesini KURAR ve uygulamayı yeniden başlatır. HER ZAMAN kullanıcının açık onayını ister (onay kartı + "onaylıyorum"). Yalnız kullanıcı kurmayı AÇIKÇA isteyince çağır. ' +
      'Örnekler: "kur", "güncellemeyi kur", "hazır olan güncellemeyi yükle", "evet kur". Kurulum sırasında uygulama kapanıp yeni sürümle açılır; sağlıksızsa önceki sürüme dönmek önerilir.',
    input: z.object({ run: z.string().min(8).max(40).optional().describe('Koşu kimliği; verilmezse hazır olan güncelleme') }),
    approvalText: () => {
      const run = runtime.service?.engine.readyRun();
      return run ? installSummary(run, runtime.service!.runningVersion()) : t('selfdev.approval.installGeneric');
    },
    refuse: () => closedGate() ?? (runtime.service?.engine.readyRun() ? null : t('selfdev.install.notReady')),
    async run({ run: runId }, ctx: ToolContext): Promise<ToolResult> {
      const guard = await guardSelfChange(ctx, { toolName: 'core_install', moduleId: 'selfdev', summary: t('selfdev.guard.install') });
      if (!guard.ok) return { ok: false, text: guard.reason };
      const closed = closedGate();
      if (closed) return { ok: false, text: closed };
      const service = runtime.service;
      if (!service) return NOT_READY;
      const ready = service.engine.readyRun(runId);
      if (!ready) return { ok: false, text: t('selfdev.install.notReady') };
      const available = service.status().install;
      if (!available.ok) return { ok: false, text: t('selfdev.install.unavailable', { reason: available.reason ?? '' }) };
      // İKİNCİ, BAĞIMSIZ ONAY: kayıt kapısının onayından ayrı; bunu atlatan yol yoktur.
      const decision = await ctx.tools.requestApproval({
        toolName: 'core_install',
        moduleId: 'selfdev',
        summary: installSummary(ready, service.runningVersion()),
        input: { run: ready.id, version: ready.version ?? '' },
        origin: ctx.origin,
      });
      if (decision !== 'approved') return { ok: false, text: decision === 'denied' ? t('selfdev.install.denied') : t('selfdev.install.noAnswer') };
      const outcome = await service.engine.install(ready.id);
      return { ok: outcome.ok, text: outcome.text };
    },
  }),

  defineTool({
    name: 'core_rollback',
    group: 'workshop',
    risk: 'danger',
    description:
      'Önceki sürüme DÖNER (kurulu çekirdek güncellemesini geri alır) ve uygulamayı yeniden başlatır. HER ZAMAN kullanıcının açık onayını ister. ' +
      'Örnekler: "önceki sürüme dön", "güncellemeyi geri al", "eski haline dön", "yeni sürüm bozuk, geri al".',
    input: z.object({}),
    approvalText: () => {
      const target = runtime.service?.engine.rollbackTarget();
      return target ? t('selfdev.approval.rollback', { from: runtime.service!.runningVersion(), to: target.version }) : t('selfdev.approval.rollbackGeneric');
    },
    refuse: () => (runtime.service?.engine.rollbackTarget() ? null : t('selfdev.rollback.none')),
    async run(_input, ctx: ToolContext): Promise<ToolResult> {
      const guard = await guardSelfChange(ctx, { toolName: 'core_rollback', moduleId: 'selfdev', summary: t('selfdev.guard.rollback') });
      if (!guard.ok) return { ok: false, text: guard.reason };
      const service = runtime.service;
      if (!service) return NOT_READY;
      const target = service.engine.rollbackTarget();
      if (!target) return { ok: false, text: t('selfdev.rollback.none') };
      const available = service.status().install;
      if (!available.ok) return { ok: false, text: t('selfdev.rollback.unavailable', { reason: available.reason ?? '' }) };
      const decision = await ctx.tools.requestApproval({
        toolName: 'core_rollback',
        moduleId: 'selfdev',
        summary: t('selfdev.approval.rollback', { from: service.runningVersion(), to: target.version }) + ' ' + t('selfdev.approval.restart'),
        input: { to: target.version },
        origin: ctx.origin,
      });
      if (decision !== 'approved') return { ok: false, text: decision === 'denied' ? t('selfdev.rollback.denied') : t('selfdev.rollback.noAnswer') };
      const outcome = await service.engine.rollback();
      return { ok: outcome.ok, text: outcome.text };
    },
  }),

  defineTool({
    name: 'core_cancel',
    group: 'workshop',
    risk: 'write',
    description:
      'Süren çekirdek geliştirme koşusunu durdurur; hazır ama kurulmamış bir güncelleme varsa onu bırakır (kurulmaz). Hiçbir şey kurulmuş olmaz. ' +
      'Örnekler: "vazgeç", "geliştirmeyi durdur", "güncellemeyi bırak", "iptal et".',
    input: z.object({}),
    async run(_input, _ctx): Promise<ToolResult> {
      const service = runtime.service;
      if (!service) return NOT_READY;
      const outcome = await service.engine.cancel();
      return { ok: outcome.ok, text: outcome.text };
    },
  }),
];
