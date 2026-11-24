/**
 * Yetenek yapımı (`skill_build`): `deep` rolüyle koşan arka plan işi. Model yalnız bu işe özel beş araçla çalışır
 * (taslak klasörüne dosya yaz/oku, doğrula, öz-sınama koştur, bitir) ve web aramasıyla API belgesi bulabilir.
 * Kayıtlı araçların hiçbiri modele verilmez: yetenek yazan model kullanıcının hafızasına, hatırlatıcılarına ya da
 * bilgisayarına dokunamaz.
 *
 * Dürüstlük: yapım ancak dosyalar son bir kez doğrulanıp öz-sınamadan geçerse "hazır" sayılır; aksi halde iş
 * başarısız biter ve ne denendiği, nerede kalındığı kullanıcıya yazılır.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  defineTool,
  newId,
  nowIso,
  t,
  UserError,
  type BrainResponse,
  type Job,
  type JobControl,
  type ModuleContext,
  type ToolDef,
  type ToolOrigin,
} from '@fuber/shared';
import { z } from 'zod';
import type { DeepBrain, DeepTaskEvent } from '../../core/brain/deep/types';
import { MAX_SOURCE_BYTES } from './audit';
import { transition } from './lifecycle';
import { MANIFEST_LIMITS } from './manifest';
import { isSkillFile, PathError, SKILL_FILE_NAMES, skillFilePath } from './paths';
import {
  BUILDER_INSTRUCTIONS,
  buildGoalMessage,
  buildRepairMessage,
  buildUpdateMessage,
  CLI_BUILDER_INSTRUCTIONS,
  NEEDS_CORE_MARKER,
} from './prompt';
import type { ReadSkill, SelftestReport } from './service';
import type { SkillRecord, WorkshopStore } from './store';
import type { BuildPhase, BuildProgress, WorkshopManifest } from './types';

/**
 * Yapımı kimin yürüttüğü. `api`: beynin kendi araç döngüsü (model doğrulamayı ve öz-sınamayı döngü içinde çağırır) ·
 * `deep`: derin beyin köprüsü (Claude Code dosyaları kendi araçlarıyla yazar; doğrulama ve öz-sınama iş bitince burada
 * koşar, tutmazsa bir kez onarım turu açılır).
 */
export type BuildDriver = 'api' | 'deep';

/** Güncelleme yapımı ("şunu da ekle"): kurulu eklentinin dosyalarından başlar; kimlik değişmez, sürüm bir artar. */
export interface UpdateTarget {
  id: string;
  name: string;
  /** Güncellemenin alacağı sürüm numarası. */
  version: number;
  /** Kurulu sürümün klasörü (taslağa kopyalanır; kendisine dokunulmaz). */
  dir: string;
}

export interface BuilderDeps {
  ctx: ModuleContext;
  /** Derin beyin; verilmezse yalnız `api` sürücüsü kullanılabilir. */
  deep?: DeepBrain;
  store: WorkshopStore;
  skillsRoot: string;
  draftsRoot: string;
  readSkill(dir: string, folderId?: string): ReadSkill;
  runSelftest(skillId: string, read: Extract<ReadSkill, { ok: true }>, signal?: AbortSignal): Promise<SelftestReport>;
  newRecord(id: string, patch?: Partial<SkillRecord>): SkillRecord;
  serial<T>(work: () => Promise<T> | T): Promise<T>;
  /** Kullanılamayacak kimlikler (kayıtlı yetenekler ve var olan klasörler). */
  takenIds(): string[];
  setProgress(progress: BuildProgress): void;
  endBuild(draftId: string): void;
  onPromoted(record: SkillRecord, manifest: WorkshopManifest): void;
  /** Onay bekleyen güncellemelerin kökü (`.staged`). */
  stagedRoot: string;
  /** Güncelleme sınandı ve `.staged/<id>/` altına alındı; kullanıcıdan onay istenecek. */
  onStaged(record: SkillRecord, manifest: WorkshopManifest): void;
  /** Yapım bulut hatasıyla bittiyse (anahtar, kredi, ağ) Atölye'nin bulut durumunu günceller. */
  onCloudFailure(reason: string): void;
  deleteDraft(draftId: string): void;
  emit(op: 'created' | 'updated' | 'deleted', id: string): void;
}

export interface Builder {
  /** `update` verilirse yeni eklenti değil, kurulu eklentinin güncellemesi yapılır. */
  start(goal: string, origin: ToolOrigin, driver?: BuildDriver, update?: UpdateTarget): Job;
  /** İş sırada beklerken iptal edildiyse (hiç koşmadıysa) taslağı ve kaydını kaldırır. */
  abandon(draftId: string): Promise<void>;
}

export const BUILD_LIMITS = {
  minGoalChars: 8,
  maxGoalChars: 2000,
  /** Aynı anda süren yapım. */
  maxConcurrent: 2,
  /** Modelin okuyup gördüğü öz-sınama çıktısı (karakter). */
  maxLogChars: 6000,
  /** Köprü sürücüsünde ilk yazımın ve onarım turunun süre sınırı (saniye). */
  deepSeconds: 480,
  repairSeconds: 300,
} as const;

/** Bir yeteneğin zorunlu dosyaları (README isteğe bağlı). */
const REQUIRED_FILES = ['manifest.json', 'index.mjs', 'selftest.mjs'] as const;

const PROGRESS: Record<BuildPhase, number> = { planning: 0.1, writing: 0.4, testing: 0.7, approval: 1 };

const fileLimit = (name: string) => (name === 'manifest.json' ? MANIFEST_LIMITS.maxBytes : MAX_SOURCE_BYTES);

const tail = (text: string, max: number) => (text.length > max ? `…${text.slice(-max)}` : text);

export function createBuilder(deps: BuilderDeps): Builder {
  const { ctx, store } = deps;
  const log = ctx.log.child('yapım');
  const running = new Set<string>();
  /** İşi gerçekten koşmaya başlayan yapımlar (sırada beklerken iptal edilen yapım hiç başlamaz). */
  const started = new Set<string>();

  /** İptal: taslak iz bırakmadan kalkar. İş servisi durumu "iptal edildi" yazar. */
  const discardDraft = (draftId: string) =>
    deps.serial(() => {
      deps.deleteDraft(draftId);
      store.delete(draftId);
      deps.emit('deleted', draftId);
    });

  /** Başarısız yapımı kaydeder ve kullanıcıya bildirir; neden, yazılan dosyalar ve son sorun olduğu gibi gider. Hep fırlatır. */
  const failBuild = async (draftId: string, control: JobControl, reason: string, written: Set<string>, lastProblem: string | null): Promise<never> => {
    const parts = [t('skills.build.failed', { reason })];
    if (written.size > 0) parts.push(t('skills.build.failed.written', { files: [...written].join(', ') }));
    if (lastProblem) parts.push(t('skills.build.failed.lastProblem', { problem: tail(lastProblem, 600) }));
    const message = parts.join(' ');

    await deps.serial(() => {
      const record = store.get(draftId);
      if (!record) return;
      if (written.size === 0) {
        // Hiçbir şey yazılmadıysa gösterilecek bir taslak da yoktur.
        deps.deleteDraft(draftId);
        store.delete(draftId);
        deps.emit('deleted', draftId);
        return;
      }
      store.save({ ...record, status: 'failed', lastError: message });
      deps.emit('updated', draftId);
    });
    try {
      ctx.attention.notify({
        moduleId: 'workshop',
        title: t('skills.notify.failed.title'),
        body: tail(message, 500),
        priority: 'normal',
        dedupeKey: `workshop.build.${control.id}`,
      });
    } catch (error) {
      log.warn('bildirim gönderilemedi', error);
    }
    throw new Error(message);
  };

  /** Taslak klasöründe yetenek dosyaları dışında kalan her şeyi siler (modelin bıraktığı notlar, alt klasörler). */
  const sweepExtras = async (draftDir: string): Promise<void> => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(draftDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isFile() && isSkillFile(entry.name)) continue;
      // `fs.rmSync` Türkçe harfli yolda sessizce silmiyor (TUZAKLAR §7).
      await fs.promises.rm(path.join(draftDir, entry.name), { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
    }
  };

  /**
   * Köprü sürücüsü: derin beyin dosyaları taslak klasörüne yazar; bitince burada doğrulanır ve öz-sınanır. Tutmazsa
   * sorun listesiyle BİR onarım turu açılır; yine tutmazsa iş dürüst bir hatayla biter. Modelin "geçti" demesi sayılmaz.
   */
  /**
   * Model "bu eklentiyle yapılamaz, çekirdek değişikliği gerekir" dediyse (ilk satırı işaretle başlar) nedenini döndürür.
   * İstek kullanıcının kendisinden geldiyse çekirdek geliştirme katmanına haber verilir (`selfdev.escalate`).
   */
  const needsCore = (text: string, goal: string, origin: ToolOrigin): string | null => {
    const index = text.indexOf(NEEDS_CORE_MARKER);
    if (index === -1) return null;
    const reason = text.slice(index + NEEDS_CORE_MARKER.length).replace(/\s+/g, ' ').trim().slice(0, 600) || t('plugins.escalate.noReason');
    if (origin.channel === 'voice' || origin.channel === 'chat' || origin.channel === 'ui') {
      try {
        ctx.bus.emit('selfdev.escalate', { request: goal, reason, origin });
      } catch (error) {
        log.warn('çekirdek geliştirmeye haber verilemedi', error);
      }
    }
    return reason;
  };

  const runWithDeep = async (draftId: string, goal: string, control: JobControl, origin: ToolOrigin, update?: UpdateTarget): Promise<string> => {
    const deep = deps.deep;
    if (!deep) throw new Error(t('skills.build.needsCloud'));
    const draftDir = path.join(deps.draftsRoot, draftId);
    const written = new Set<string>();
    const startedAt = nowIso();
    const setPhase = (next: BuildPhase, step: string) => {
      deps.setProgress({ skillId: draftId, jobId: control.id, goal, phase: next, step, startedAt });
      control.update({ step, progress: PROGRESS[next] });
    };
    let phase: BuildPhase = 'planning';
    const onEvent = (event: DeepTaskEvent) => {
      if (event.type !== 'tool' || event.phase !== 'start') return;
      if (/^(Write|Edit|deep_write_file)$/.test(event.name) && event.detail) {
        written.add(path.basename(event.detail));
        phase = 'writing';
        setPhase('writing', t('skills.build.step.writing', { file: path.basename(event.detail) }));
      } else if (/^(WebSearch|WebFetch|web)$/.test(event.name)) {
        setPhase(phase, t('skills.build.step.research'));
      }
    };

    // Kayıt, işin kimliğini yazsın diye çağıranın bir adım ilerlemesine izin verilir.
    await Promise.resolve();
    started.add(draftId);
    setPhase('planning', t('skills.build.step.planning'));

    try {
      let lastProblem: string | null = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const repair = attempt > 0;
        if (repair) setPhase('writing', t('skills.build.step.repairing'));
        const taken = deps.takenIds().filter((id) => id !== draftId);
        const result = await deep.runTask({
          kind: repair ? 'skill_repair' : update ? 'skill_update' : 'skill_build',
          system: CLI_BUILDER_INSTRUCTIONS,
          prompt: repair
            ? buildRepairMessage(goal, lastProblem ?? '', update ? [] : taken)
            : update
              ? buildUpdateMessage(goal, update)
              : buildGoalMessage(goal, taken),
          workDir: draftDir,
          allowedTools: ['read', 'write', 'web'],
          maxSeconds: repair ? BUILD_LIMITS.repairSeconds : BUILD_LIMITS.deepSeconds,
          onEvent,
          signal: control.signal,
        });
        if (control.signal.aborted || result.stop === 'aborted') {
          await discardDraft(draftId);
          throw new Error(t('tool.error.aborted'));
        }
        await sweepExtras(draftDir);
        const present = REQUIRED_FILES.filter((name) => fs.existsSync(path.join(draftDir, name)));
        for (const name of present) written.add(name);
        for (const name of [...written]) if (!fs.existsSync(path.join(draftDir, name))) written.delete(name);
        if (!result.ok) return await failBuild(draftId, control, result.error ?? t('brain.error.unknown'), update ? new Set() : written, lastProblem);
        // Model eklentiyle yapılamayacağını söylediyse (yeni yapımda dosya yazmadan, güncellemede dosyalara dokunmadan durur).
        const core = attempt === 0 ? needsCore(result.text, goal, origin) : null;
        if (core) return await failBuild(draftId, control, t('plugins.escalate.reason', { reason: core }), new Set(), null);
        if (present.length === 0) {
          // Model dosya yazmadan durdu: "bu yüzeyle yapılamaz" açıklaması kullanıcıya olduğu gibi gider.
          return await failBuild(draftId, control, result.text.trim() ? tail(result.text.trim(), 800) : t('skills.build.failed.noFinish'), written, lastProblem);
        }

        setPhase('testing', t(repair ? 'skills.build.step.finishing' : 'skills.build.step.testing'));
        const summary = result.text.replace(/\s+/g, ' ').trim().slice(0, 600);
        const outcome = await promote(draftId, draftDir, goal, control, summary || null, update);
        if (control.signal.aborted) {
          await discardDraft(draftId);
          throw new Error(t('tool.error.aborted'));
        }
        if (outcome.ok) {
          setPhase('approval', t('skills.build.step.approval'));
          log.info(`${outcome.record.id}: köprüyle ${update ? 'güncellendi' : 'yapıldı'} (${result.provider ?? '?'}, ${repair ? 'onarım turundan sonra' : 'ilk denemede'})`);
          return update ? t('plugins.update.done', { name: outcome.record.name, version: update.version }) : t('skills.build.done', { name: outcome.record.name });
        }
        lastProblem = outcome.problem;
        log.info(`yapım ${repair ? 'onarım turunda da' : 'ilk denemede'} geçmedi: ${tail(outcome.problem, 200)}`);
      }
      // Güncellemede taslak kurulu sürümün kopyasından başladığı için "yazılan dosya" bilgisi yanıltır; taslak kalmaz.
      return await failBuild(draftId, control, t('skills.build.failed.repair'), update ? new Set() : written, lastProblem);
    } finally {
      deps.endBuild(draftId);
      running.delete(draftId);
    }
  };

  const run = async (draftId: string, goal: string, control: JobControl, update?: UpdateTarget): Promise<string> => {
    const draftDir = path.join(deps.draftsRoot, draftId);
    const written = new Set<string>();
    let lastProblem: string | null = null;
    let finished: { id: string; name: string } | null = null;
    const startedAt = nowIso();

    const setPhase = (next: BuildPhase, step: string) => {
      deps.setProgress({ skillId: draftId, jobId: control.id, goal, phase: next, step, startedAt });
      control.update({ step, progress: PROGRESS[next] });
    };

    const inDraft = <T>(file: string, work: (target: string) => T): T | { error: string } => {
      try {
        return work(skillFilePath(draftDir, file));
      } catch (error) {
        if (error instanceof PathError) return { error: error.message };
        throw error;
      }
    };

    /** Şema + statik denetim + kimlik çakışması + (geçerse) geçici konakta yükleme ve öz-sınama. */
    const check = async (withSelftest: boolean): Promise<{ ok: true; read: Extract<ReadSkill, { ok: true }>; report: SelftestReport | null } | { ok: false; problems: string[] }> => {
      const read = deps.readSkill(draftDir);
      const problems = read.ok ? [] : [...read.issues];
      const id = read.manifest?.id;
      if (update) {
        if (id && id !== update.id) problems.push(`manifest.json › id: güncellemede kimlik değişemez; "${update.id}" olarak kalmalı.`);
      } else if (id && deps.takenIds().includes(id)) {
        problems.push(`manifest.json › id: "${id}" kullanımda; başka bir kimlik seç.`);
      }
      if (!read.ok || problems.length > 0) return { ok: false, problems };
      if (!withSelftest) return { ok: true, read, report: null };
      const report = await deps.runSelftest(draftId, read, control.signal);
      return { ok: true, read, report };
    };

    const tools: ToolDef[] = [
      defineTool({
        name: 'ws_write_file',
        description:
          `Eklentinin bir dosyasını yazar (varsa üstüne yazar). Yalnız şu adlar: ${SKILL_FILE_NAMES}. ` +
          'Dosyanın TAM içeriğini ver; parça ya da fark kabul edilmez.',
        input: z.object({
          path: z.string().describe('Dosya adı: manifest.json, index.mjs, selftest.mjs, README.md ya da page.html'),
          content: z.string().describe('Dosyanın tam içeriği'),
        }),
        risk: 'write',
        async run({ path: file, content }) {
          if (Buffer.byteLength(content, 'utf8') > fileLimit(file)) {
            return { ok: false, text: `${file} çok büyük (en çok ${Math.round(fileLimit(file) / 1000)} KB).` };
          }
          const result = inDraft(file, (target) => {
            fs.mkdirSync(draftDir, { recursive: true });
            fs.writeFileSync(target, content, 'utf8');
            return true;
          });
          if (typeof result === 'object') return { ok: false, text: result.error };
          written.add(file);
          setPhase('writing', t('skills.build.step.writing', { file }));
          return { ok: true, text: `${file} yazıldı (${Buffer.byteLength(content, 'utf8')} bayt).` };
        },
      }),
      defineTool({
        name: 'ws_read_file',
        description: 'Yetenek klasöründeki bir dosyanın şu anki içeriğini döndürür.',
        input: z.object({ path: z.string().describe('Dosya adı') }),
        risk: 'read',
        async run({ path: file }) {
          const result = inDraft(file, (target) => (fs.existsSync(target) ? fs.readFileSync(target, 'utf8') : null));
          if (result !== null && typeof result === 'object') return { ok: false, text: result.error };
          if (result === null) return { ok: false, text: `${file} henüz yazılmadı.` };
          return { ok: true, text: result };
        },
      }),
      defineTool({
        name: 'ws_validate',
        description:
          'Yazılan dosyaları çalıştırmadan denetler: manifest şeması, araç adları, izinler ve kaynak koddaki yasak kalıplar. ' +
          'Sorunları dosya ve satır numarasıyla listeler.',
        input: z.object({}),
        risk: 'read',
        async run() {
          setPhase('testing', t('skills.build.step.validating'));
          const result = await check(false);
          if (!result.ok) {
            lastProblem = result.problems.join('\n');
            return { ok: false, text: `Doğrulama ${result.problems.length} sorun buldu:\n- ${result.problems.join('\n- ')}` };
          }
          lastProblem = null;
          return { ok: true, text: 'Doğrulama temiz. Şimdi ws_run_selftest ile öz-sınamayı koştur.' };
        },
      }),
      defineTool({
        name: 'ws_run_selftest',
        description:
          'Dosyaları doğrular, yeteneği ayrı bir süreçte yükler ve selftest.mjs dosyasını koşturur (ağ istekleri gerçektir; ' +
          'bildirim, kart ve hatırlatıcı gerçekte üretilmez). Sonucu ve ctx.log / console çıktısını döndürür. En çok 60 saniye sürer.',
        input: z.object({}),
        risk: 'read',
        async run() {
          setPhase('testing', t('skills.build.step.testing'));
          const result = await check(true);
          if (!result.ok) {
            lastProblem = result.problems.join('\n');
            return { ok: false, text: `Öz-sınama koşmadı; önce doğrulama sorunları giderilmeli:\n- ${result.problems.join('\n- ')}` };
          }
          const report = result.report!;
          const output = tail(report.log, BUILD_LIMITS.maxLogChars);
          if (!report.ok) {
            lastProblem = t('skills.error.selftest', { detail: report.error ?? '' });
            return { ok: false, text: `Öz-sınama GEÇMEDİ: ${report.error ?? 'bilinmeyen neden'}\n\nÇıktı:\n${output}` };
          }
          lastProblem = null;
          return { ok: true, text: `Öz-sınama geçti.\n\nÇıktı:\n${output}\n\nHer şey tamamsa ws_finish çağır.` };
        },
      }),
      defineTool({
        name: 'ws_finish',
        description:
          'Yeteneği teslim eder: dosyalar son kez doğrulanır ve öz-sınama yeniden koşar; geçerse yetenek kullanıcının onayına sunulur. ' +
          'Geçmezse nedenini döndürür; düzeltip yeniden çağırabilirsin.',
        input: z.object({
          summary: z.string().min(10).max(600).describe('Kullanıcıya gösterilecek bir iki cümlelik Türkçe özet: yetenek ne yapıyor, veri nereden geliyor'),
        }),
        risk: 'write',
        async run({ summary }) {
          if (finished) return { ok: true, text: 'Yetenek zaten teslim edildi.' };
          setPhase('testing', t('skills.build.step.finishing'));
          const outcome = await promote(draftId, draftDir, goal, control, summary, update);
          if (!outcome.ok) {
            lastProblem = outcome.problem;
            return { ok: false, text: `Teslim edilemedi:\n${outcome.problem}` };
          }
          finished = { id: outcome.record.id, name: outcome.record.name };
          lastProblem = null;
          setPhase('approval', t('skills.build.step.approval'));
          return {
            ok: true,
            text: `"${outcome.record.name}" yeteneği kaydedildi ve kullanıcının onayına sunuldu. Başka araç çağırma; tek cümlelik bir kapanış yaz.`,
          };
        },
      }),
    ];

    // Kayıt, işin kimliğini yazsın diye çağıranın bir adım ilerlemesine izin verilir.
    await Promise.resolve();
    started.add(draftId);
    setPhase('planning', t('skills.build.step.planning'));

    let response: BrainResponse;
    try {
      response = await ctx.brain.runTask({
        goal: update
          ? buildUpdateMessage(goal, update)
          : buildGoalMessage(
              goal,
              deps.takenIds().filter((id) => id !== draftId),
            ),
        instructions: BUILDER_INSTRUCTIONS,
        // Yetenek yazan model yalnız kendi beş aracını ve web aramasını görür.
        tools: 'none',
        extraTools: { context: ctx, tools },
        serverTools: ['web_search', 'web_fetch'],
        // Kişilik ve hafıza kuyruğu eklenmez: kullanıcının kişisel bilgisi yapım bağlamına (ve web aramalarına) girmez.
        persona: false,
        origin: { channel: 'job', jobId: control.id, speakerVerified: null },
        signal: control.signal,
      });
    } finally {
      deps.endBuild(draftId);
      running.delete(draftId);
    }

    if (finished) {
      const done: { id: string; name: string } = finished;
      return update ? t('plugins.update.done', { name: done.name, version: update.version }) : t('skills.build.done', { name: done.name });
    }

    if (control.signal.aborted || response.stopReason === 'aborted') {
      await discardDraft(draftId);
      throw new Error(t('tool.error.aborted'));
    }

    // Model bitirmeden durdu: neden durduğu, ne yazıldığı ve son sorun olduğu gibi kullanıcıya gider.
    const cloudFailure = response.stopReason === 'no_key' || response.stopReason === 'error' || response.stopReason === 'budget' || response.stopReason === 'kill_switch';
    let reason: string;
    if (cloudFailure) {
      reason = `${t('skills.build.needsCloud')} ${response.error ?? ''}`.trim();
      if (response.toolCalls.length === 0) deps.onCloudFailure(response.error ?? t('brain.error.unknown'));
    } else if (response.stopReason === 'refusal') {
      reason = t('skills.build.failed.refusal');
    } else if (response.stopReason === 'max_steps' || response.stopReason === 'max_tokens') {
      reason = t('skills.build.failed.maxSteps');
    } else {
      reason = response.text.trim() ? tail(response.text.trim(), 800) : t('skills.build.failed.noFinish');
    }
    return failBuild(draftId, control, reason, update ? new Set() : written, lastProblem);
  };

  /** Taslağı son kez doğrular ve sınar; geçerse `skills/<id>/` altına taşır ve onay bekleyen kayıt açar. */
  const promote = async (
    draftId: string,
    draftDir: string,
    goal: string,
    control: JobControl,
    /** Kullanıcıya gösterilecek özet; `null` ise manifestteki açıklama kullanılır. */
    summary: string | null,
    update?: UpdateTarget,
  ): Promise<{ ok: true; record: SkillRecord } | { ok: false; problem: string }> => {
    const first = deps.readSkill(draftDir);
    if (!first.ok) return { ok: false, problem: first.issues.join('\n') };
    const id = first.manifest.id;
    if (update) {
      if (id !== update.id) return { ok: false, problem: `manifest.json › id: güncellemede kimlik değişemez; "${update.id}" olarak kalmalı.` };
    } else if (deps.takenIds().includes(id)) {
      return { ok: false, problem: `manifest.json › id: "${id}" kullanımda; başka bir kimlik seç.` };
    }

    // Köken, sürüm ve tarih modelin beyanına bırakılmaz.
    const manifest: WorkshopManifest = { ...first.manifest, version: update ? update.version : 1, createdBy: 'workshop', createdAt: nowIso() };
    fs.writeFileSync(skillFilePath(draftDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    const read = deps.readSkill(draftDir);
    if (!read.ok) return { ok: false, problem: read.issues.join('\n') };

    const report = await deps.runSelftest(draftId, read, control.signal);
    if (!report.ok) return { ok: false, problem: `Öz-sınama geçmedi: ${report.error ?? ''}\n${tail(report.log, 2000)}` };

    if (update) {
      // Güncelleme kurulu sürümün yerine GEÇMEZ: `.staged/<id>/` altında kullanıcının onayını bekler; eski sürüm çalışır.
      return deps.serial(async () => {
        const current = store.get(id);
        if (!current || current.draft) return { ok: false as const, problem: `"${id}" artık kurulu değil; güncelleme uygulanamaz.` };
        if (current.build + 1 !== update.version) return { ok: false as const, problem: 'Eklenti bu sırada değişti; güncellemeyi yeniden isteyin.' };
        const again = deps.readSkill(draftDir);
        if (!again.ok || again.hash !== read.hash) return { ok: false as const, problem: 'Dosyalar öz-sınamadan sonra değişti; yeniden ws_finish çağır.' };
        const target = path.join(deps.stagedRoot, id);
        await fs.promises.rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }).catch(() => {});
        fs.mkdirSync(deps.stagedRoot, { recursive: true });
        fs.renameSync(draftDir, target);
        const record = store.save({
          ...current,
          stagedHash: read.hash,
          stagedNote: goal,
          jobId: control.id,
          selftestLog: `${report.log}\n${t('skills.build.summaryLine', { summary: summary ?? manifest.description })}`,
        });
        store.delete(draftId);
        deps.emit('deleted', draftId);
        deps.onStaged(record, manifest);
        log.info(`${id} güncellemesi hazır (sürüm ${update.version}); onay bekliyor`);
        return { ok: true as const, record };
      });
    }

    return deps.serial(() => {
      const target = path.join(deps.skillsRoot, id);
      if (fs.existsSync(target) || store.get(id)) return { ok: false as const, problem: `"${id}" kimliği bu sırada kullanıldı; başka bir kimlik seç.` };
      // Sınanan içerik ile taşınan içerik aynı olmalı.
      const again = deps.readSkill(draftDir);
      if (!again.ok || again.hash !== read.hash) return { ok: false as const, problem: 'Dosyalar öz-sınamadan sonra değişti; yeniden ws_finish çağır.' };
      fs.renameSync(draftDir, target);

      const base = deps.newRecord(id, {
        name: manifest.name,
        description: manifest.description,
        createdBy: 'workshop',
        jobId: control.id,
        goal,
        contentHash: read.hash,
        selftestLog: `${report.log}\n${t('skills.build.summaryLine', { summary: summary ?? manifest.description })}`,
      });
      const testing = transition(base, { type: 'test_started' });
      const passed = testing.ok ? transition(testing.state, { type: 'test_passed', hash: read.hash }) : testing;
      if (!passed.ok) return { ok: false as const, problem: 'Yetenek durumu güncellenemedi.' };
      const record = store.save({ ...base, ...passed.state });
      store.delete(draftId);
      deps.emit('deleted', draftId);
      deps.onPromoted(record, manifest);
      log.info(`${id} yapıldı; onay bekliyor`);
      return { ok: true as const, record };
    });
  };

  return {
    start(goal, origin, driver = 'api', update) {
      const text = goal.trim();
      if (text.length < BUILD_LIMITS.minGoalChars) throw new UserError(t('skills.build.goalTooShort'));
      if (text.length > BUILD_LIMITS.maxGoalChars) throw new UserError(t('skills.build.goalTooLong'));
      if (running.size >= BUILD_LIMITS.maxConcurrent) throw new UserError(t('skills.build.tooMany'));

      const draftId = `taslak_${newId().slice(-8).toLowerCase()}`;
      const draftDir = path.join(deps.draftsRoot, draftId);
      fs.mkdirSync(draftDir, { recursive: true });
      if (update) {
        // Güncelleme kurulu sürümün dosyalarının KOPYASI üzerinde yapılır; kurulu klasöre dokunulmaz.
        for (const entry of fs.readdirSync(update.dir, { withFileTypes: true })) {
          if (entry.isFile() && isSkillFile(entry.name)) fs.copyFileSync(path.join(update.dir, entry.name), path.join(draftDir, entry.name));
        }
      }
      const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
      store.save(
        deps.newRecord(draftId, {
          name: update ? t('plugins.update.draftName', { name: update.name }) : short,
          description: text,
          status: 'building',
          draft: true,
          createdBy: 'workshop',
          goal: text,
        }),
      );
      running.add(draftId);
      log.info(`${update ? `güncelleme (${update.id})` : 'yapım'} başladı (${origin.channel}): ${short}`);
      const job = ctx.jobs.start({
        kind: 'workshop.skill_build',
        moduleId: 'workshop',
        title: update ? t('plugins.update.title', { name: update.name }) : t('skills.build.title', { goal: short }),
        run: (control) => (driver === 'deep' ? runWithDeep(draftId, text, control, origin, update) : run(draftId, text, control, update)),
      });
      const record = store.get(draftId);
      if (record) store.save({ ...record, jobId: job.id });
      deps.setProgress({ skillId: draftId, jobId: job.id, goal: text, phase: 'planning', step: t('skills.build.step.queued'), startedAt: nowIso() });
      deps.emit('created', draftId);
      return job;
    },

    abandon(draftId) {
      return deps.serial(() => {
        if (started.has(draftId) || !running.delete(draftId)) return;
        deps.endBuild(draftId);
        deps.deleteDraft(draftId);
        store.delete(draftId);
        deps.emit('deleted', draftId);
      });
    },
  };
}
