import {
  ArrowsDownUp,
  Brain,
  CalendarCheck,
  CaretRight,
  Cube,
  Desktop,
  Ear,
  FileText,
  FolderSimple,
  GlobeSimple,
  PuzzlePiece,
  SpeakerHigh,
  SquaresFour,
  Wrench,
  type Icon,
} from '@phosphor-icons/react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { t, type MessageKey, type ModuleInfo, type SkillInfo } from '@fuber/shared';
import { Badge, Button, Dialog, enter, Panel, Skeleton, stagger, toast, useMotionPreset, Workspace, WorkspaceGrid, WorkspaceHeader } from '@fuber/ui';
import type { WorkshopStatus } from '../../../../main/modules/workshop/types';
import { onFocusSkill, takeFocusedSkill } from '../../plugins/skill-focus';
import { UpdateCard } from '../../plugins/UpdateCard';
import { definePage } from '../page';
import { ApprovalBody, ApprovalCard } from './ApprovalCard';
import { BuildCard } from './BuildCard';
import { CodeDialog } from './CodeDialog';
import { Composer } from './Composer';
import { ModuleDetail, moduleDescription, moduleName, moduleState, SkillDetail, type Selection } from './Detail';
import { SkillRow } from './SkillRow';
import { useSkills } from './useSkills';
import './skills.css';

const errorText = (error: unknown) => (error instanceof Error ? error.message : t('common.unknownError'));

function headline(skills: SkillInfo[], building: number, updates: number): string {
  const pending = skills.filter((skill) => skill.status === 'pending_approval').length;
  const enabled = skills.filter((skill) => skill.status === 'enabled').length;
  const parts: string[] = [];
  if (pending > 0) parts.push(t('pluginsUi.header.pending', { count: pending }));
  if (updates > 0) parts.push(t('pluginsUi.header.updates', { count: updates }));
  if (building > 0) parts.push(t('pluginsUi.header.building'));
  if (skills.length === 0 && building === 0) return t('pluginsUi.header.none');
  parts.push(enabled > 0 ? t('pluginsUi.header.enabled', { count: enabled }) : t('pluginsUi.header.noneEnabled'));
  return parts.join(' ');
}

/** Yerleşik yeteneklerin simgeleri (taranabilirlik için; bilinmeyen modül küp alır). */
const MODULE_ICONS: Record<string, Icon> = {
  memory: Brain,
  planner: CalendarCheck,
  documents: FileText,
  pc: Desktop,
  web: GlobeSimple,
  projects: FolderSimple,
  'voice-control': SpeakerHigh,
  ambient: Ear,
  stage: SquaresFour,
  workshop: Wrench,
  'import-v1': ArrowsDownUp,
};

/** Yerleşik yeteneklerin kümeleri: ne işe yaradıklarına göre. Listede olmayan modül "Diğer"e düşer. */
const GROUPS: Array<{ key: MessageKey; ids: string[] }> = [
  { key: 'skills.group.daily', ids: ['memory', 'planner', 'documents'] },
  { key: 'skills.group.computer', ids: ['pc', 'web', 'projects'] },
  { key: 'skills.group.voice', ids: ['voice-control', 'ambient', 'stage'] },
  { key: 'skills.group.system', ids: ['workshop', 'import-v1'] },
];

function groupModules(modules: ModuleInfo[]): Array<{ key: MessageKey; modules: ModuleInfo[] }> {
  const builtin = modules.filter((module) => module.kind === 'builtin');
  const known = new Set(GROUPS.flatMap((group) => group.ids));
  const groups = GROUPS.map((group) => ({
    key: group.key,
    modules: group.ids.map((id) => builtin.find((module) => module.id === id)).filter((module): module is ModuleInfo => module !== undefined),
  }));
  const other = builtin.filter((module) => !known.has(module.id)).sort((a, b) => moduleName(a).localeCompare(moduleName(b), 'tr'));
  return [...groups, { key: 'skills.group.other' as MessageKey, modules: other }].filter((group) => group.modules.length > 0);
}

/**
 * Yerleşik yetenekler: kümelere ayrılmış, taranabilir dizin. Salt okunurdur (açık ya da kapalı olması Fuber
 * Yönetim'den gelir); satıra basınca ayrıntısı bağlam sütununda açılır.
 */
function BuiltinIndex({ modules, selected, onSelect }: { modules: ModuleInfo[]; selected: Selection | null; onSelect: (id: string) => void }) {
  const groups = groupModules(modules);
  const count = groups.reduce((sum, group) => sum + group.modules.length, 0);
  if (count === 0) return null;
  const on = groups.reduce((sum, group) => sum + group.modules.filter((module) => module.enabled).length, 0);
  return (
    <Panel
      padding="none"
      title={t('skills.builtin.title')}
      count={count}
      action={<span className="text-sm text-fg-muted tabular-nums">{t('skills.builtin.summary', { on, total: count })}</span>}
      className="skl-index"
      data-testid="skills-builtin"
    >
      <p className="px-5 pt-1 text-sm text-fg-muted">{t('skills.builtin.description')}</p>
      {/* Kümeler yan yana sütunlardır; satır yalnız simge ve addır (açıklama ve araçlar seçince ayrıntıda). */}
      <div className="skl-groups">
        {groups.map((group) => (
          <section key={group.key} className="flex min-w-0 flex-col gap-1" aria-label={t(group.key)}>
            <h3 className="flex items-baseline gap-2 px-2 pb-0.5 text-sm font-semibold text-fg">
              {t(group.key)}
              <span className="text-xs font-medium text-fg-faint tabular-nums">{group.modules.length}</span>
            </h3>
            <ul className="flex flex-col">
              {group.modules.map((module) => {
                const state = moduleState(module);
                const active = selected?.kind === 'module' && selected.id === module.id;
                const Icon = MODULE_ICONS[module.id] ?? Cube;
                return (
                  <li key={module.id} className="min-w-0">
                    <button
                      type="button"
                      className="skl-row outline-offset-[-2px]"
                      aria-pressed={active}
                      title={moduleDescription(module)}
                      onClick={() => onSelect(module.id)}
                      data-testid={`skills-module-${module.id}`}
                      data-state={state}
                    >
                      <Icon className={state === 'on' ? 'size-4.5 shrink-0 text-fg-muted' : 'size-4.5 shrink-0 text-fg-faint'} aria-hidden />
                      <span className={state === 'on' ? 'min-w-0 flex-1 text-base text-fg' : 'min-w-0 flex-1 text-base text-fg-faint'}>{moduleName(module)}</span>
                      {/* Durum yalnız istisnada yazar: açık olanlar başlıktaki sayıda toplanır. */}
                      {state !== 'on' && (
                        <Badge size="sm" tone={state === 'blocked' ? 'warning' : 'neutral'}>
                          {t(`skills.builtin.${state}`)}
                        </Badge>
                      )}
                      <CaretRight weight="bold" className="skl-row-caret size-3 shrink-0 text-fg-faint" aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </Panel>
  );
}

/** Sayfanın kabı bağlam sütununu yan yana gösterecek kadar geniş mi (workspace.css ile aynı eşik: 1040 px). */
function useWide(ref: React.RefObject<HTMLElement | null>): boolean {
  const [wide, setWide] = useState(true);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setWide(element.clientWidth >= 1040);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return wide;
}

function SkillsPage() {
  const data = useSkills();
  const { skills, status } = data;
  const [codeFor, setCodeFor] = useState<string | null>(null);
  const [removing, setRemoving] = useState<SkillInfo | null>(null);
  const [reviewing, setReviewing] = useState<SkillInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [picked, setPicked] = useState<Selection | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const goalRef = useRef<HTMLTextAreaElement | null>(null);
  const wide = useWide(rootRef);
  const item = useMotionPreset(enter.fadeUp);

  const meta = (id: string): WorkshopStatus['skills'][string] => status?.skills[id] ?? { approved: false, hosts: [], createdBy: 'manual', draft: false };
  const builds = status?.builds ?? [];
  const pending = skills.filter((skill) => skill.status === 'pending_approval');
  // Yapımı süren yeni eklenti listede görünmez (BuildCard'dadır); güncellenen eklenti ise eski sürümüyle çalışmayı sürdürür.
  const own = skills.filter(
    (skill) => skill.status !== 'pending_approval' && !(builds.some((build) => build.skillId === skill.id) && (skill.status === 'building' || skill.status === 'testing')),
  );
  const updating = (id: string) => builds.some((build) => build.skillId === id);
  const withUpdate = own.filter((skill) => meta(skill.id).update !== undefined);
  const nameOf = (id: string | null) => skills.find((skill) => skill.id === id)?.name ?? '';
  const builtin = groupModules(data.modules).flatMap((group) => group.modules);

  // Seçim: kullanıcı seçmediyse (ya da seçtiği kalktıysa) ilk kendi yeteneği, o da yoksa ilk yerleşik yetenek.
  // Onay bekleyen varsa önce o: kararın dayandığı izinler ve araçlar yanda durur.
  const pickedSkill = picked?.kind === 'skill' ? [...pending, ...own].find((skill) => skill.id === picked.id) : undefined;
  // "Eklenti ayrıntısı" (başka sayfadan): istenen eklenti seçilir.
  useEffect(() => {
    const first = takeFocusedSkill();
    if (first) setPicked({ kind: 'skill', id: first });
    return onFocusSkill((id) => setPicked({ kind: 'skill', id }));
  }, []);
  const pickedModule = picked?.kind === 'module' ? builtin.find((module) => module.id === picked.id) : undefined;
  const shownSkill = pickedSkill ?? (pickedModule ? undefined : (pending[0] ?? withUpdate[0] ?? own[0]));
  const shownModule = pickedModule ?? (shownSkill ? undefined : builtin[0]);
  const selection: Selection | null = shownSkill ? { kind: 'skill', id: shownSkill.id } : shownModule ? { kind: 'module', id: shownModule.id } : null;
  const select = (next: Selection) => {
    setPicked(next);
    // Dar kapta bağlam sütunu yoktur: ayrıntı diyalogda açılır.
    if (!wide) setDetailOpen(true);
  };
  useEffect(() => {
    if (wide) setDetailOpen(false);
  }, [wide]);

  /** IPC çağrısını yürütür; hata kullanıcıya kısa bir bildirimle gösterilir, liste her durumda tazelenir. */
  const act = async (work: () => Promise<unknown>, done?: string) => {
    try {
      await work();
      if (done) toast.success(done);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      data.refresh();
    }
  };

  const decide = (skill: SkillInfo, approve: boolean) =>
    act(
      () => window.fuber.invoke('skills.approve', { id: skill.id, approve }),
      t(approve ? 'skills.toast.approved' : 'skills.toast.rejected', { name: skill.name }),
    );

  const decideUpdate = (skill: SkillInfo, approve: boolean) =>
    act(
      () => window.fuber.invoke('workshop.approveUpdate', { id: skill.id, approve }),
      t(approve ? 'pluginsUi.toast.updateApplied' : 'pluginsUi.toast.updateDiscarded', { name: skill.name }),
    );

  const build = async (goal: string) => {
    // Hata Composer'da, alanın hemen altında gösterilir (fırlatılır).
    await window.fuber.invoke('skills.build', { goal });
    toast.success(t('skills.new.started'));
    data.refresh();
  };

  const remove = async () => {
    const target = removing;
    if (!target) return;
    setBusy(target.id);
    await act(() => window.fuber.invoke('skills.remove', { id: target.id }), t('skills.toast.removed', { name: target.name }));
    setBusy(null);
    setRemoving(null);
  };

  const renderDetail = (bare: boolean) =>
    shownSkill ? (
      <SkillDetail
        key={shownSkill.id}
        skill={shownSkill}
        hosts={meta(shownSkill.id).hosts}
        meta={meta(shownSkill.id)}
        updating={updating(shownSkill.id)}
        updateBlocked={status?.cloud && !status.cloud.ok ? t('skills.new.cloudDown') : null}
        onShowCode={() => setCodeFor(shownSkill.id)}
        onToggle={(enabled) => act(() => window.fuber.invoke('skills.setEnabled', { id: shownSkill.id, enabled }))}
        onRemove={() => setRemoving(shownSkill)}
        bare={bare}
      />
    ) : shownModule ? (
      <ModuleDetail module={shownModule} bare={bare} />
    ) : null;
  const detail = renderDetail(false);

  return (
    <Workspace ref={rootRef} data-testid="skills-page">
      <WorkspaceHeader title={t('pluginsUi.title')} status={data.loading ? ' ' : headline(skills, builds.length, withUpdate.length)} />

      <WorkspaceGrid
        asideWidth={380}
        aside={
          wide &&
          (data.loading && !detail ? (
            <Panel>
              <Skeleton className="h-6 w-40" />
              <Skeleton shape="text" lines={3} />
              <Skeleton shape="text" lines={4} />
            </Panel>
          ) : detail ? (
            <Panel className="skl-detail-scroll ui-scroll" data-testid="skills-aside">
              {detail}
            </Panel>
          ) : null)
        }
      >
        <div className="skl-main">
        <div className="skl-col">
        {data.error && (
          <Panel padding="sm" className="flex-row items-center justify-between gap-4">
            <p className="text-sm text-danger">
              {t('skills.load.error')} <span className="text-fg-muted">{data.error}</span>
            </p>
            <Button size="sm" onClick={data.refresh}>
              {t('common.retry')}
            </Button>
          </Panel>
        )}

        <AnimatePresence initial={false}>
          {pending.length + withUpdate.length > 0 && (
            <motion.div key="pending" {...item}>
              <Panel tone="quiet" title={t('skills.pending.title')} count={pending.length + withUpdate.length}>
                <div className="flex flex-col gap-4">
                  {withUpdate.map((skill) => (
                    <UpdateCard
                      key={`update-${skill.id}`}
                      skill={skill}
                      update={meta(skill.id).update!}
                      compact={wide && selection?.kind === 'skill' && selection.id === skill.id}
                      onDecide={(approve) => decideUpdate(skill, approve)}
                      onShowCode={() => setCodeFor(skill.id)}
                    />
                  ))}
                  {pending.map((skill) => (
                    <ApprovalCard
                      key={skill.id}
                      skill={skill}
                      hosts={meta(skill.id).hosts}
                      manual={meta(skill.id).createdBy === 'manual'}
                      compact={wide && selection?.kind === 'skill' && selection.id === skill.id}
                      onDecide={(approve) => decide(skill, approve)}
                      onShowCode={() => setCodeFor(skill.id)}
                    />
                  ))}
                </div>
              </Panel>
            </motion.div>
          )}
        </AnimatePresence>

        <Composer cloud={status?.cloud ?? null} probing={data.probing} quiet={pending.length > 0} onBuild={build} onRetryCloud={data.probeCloud} inputRef={goalRef} />

        <AnimatePresence initial={false}>
          {builds.length > 0 && (
            <motion.div key="builds" {...item}>
              <Panel tone="quiet" title={t('skills.building.title')} count={builds.length}>
                <div className="flex flex-col gap-4">
                  {builds.map((progress) => (
                    <BuildCard
                      key={progress.skillId}
                      build={progress}
                      cancelling={busy === progress.skillId}
                      onCancel={() => {
                        setBusy(progress.skillId);
                        void act(() => window.fuber.invoke('workshop.cancelBuild', { id: progress.skillId }), t('skills.building.cancelled')).finally(
                          () => setBusy(null),
                        );
                      }}
                    />
                  ))}
                </div>
              </Panel>
            </motion.div>
          )}
        </AnimatePresence>

        {data.loading ? (
          <Panel title={t('pluginsUi.own.title')}>
            <Skeleton shape="text" lines={2} />
            <Skeleton shape="text" lines={2} />
          </Panel>
        ) : own.length > 0 ? (
          <Panel padding="none" title={t('pluginsUi.own.title')} count={own.length} data-testid="skills-own">
            <ul className="flex flex-col gap-0.5 p-2 pt-1.5">
              <AnimatePresence initial={false}>
                {own.map((skill, index) => (
                  <motion.li key={skill.id} {...item} transition={stagger(index)}>
                    <SkillRow
                      skill={skill}
                      hosts={meta(skill.id).hosts}
                      approved={meta(skill.id).approved}
                      manual={meta(skill.id).createdBy === 'manual'}
                      draft={meta(skill.id).draft}
                      updateVersion={meta(skill.id).update?.version}
                      adds={meta(skill.id).adds}
                      selected={wide && selection?.kind === 'skill' && selection.id === skill.id}
                      compact={wide}
                      onSelect={() => select({ kind: 'skill', id: skill.id })}
                      onToggle={(enabled) => act(() => window.fuber.invoke('skills.setEnabled', { id: skill.id, enabled }))}
                      onRetry={() =>
                        act(() => window.fuber.invoke('skills.setEnabled', { id: skill.id, enabled: true }), t('skills.toast.retesting', { name: skill.name }))
                      }
                      onReview={() => setReviewing(skill)}
                      onShowCode={() => setCodeFor(skill.id)}
                      onRemove={() => setRemoving(skill)}
                    />
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          </Panel>
        ) : (
          pending.length === 0 &&
          builds.length === 0 && (
            <Panel title={t('pluginsUi.own.title')} data-testid="skills-own-empty">
              <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
                <div className="flex max-w-[64ch] flex-col gap-0.5">
                  <p className="text-base text-fg">{t('pluginsUi.own.empty.title')}</p>
                  <p className="text-sm text-fg-muted">{t('pluginsUi.own.empty.description')}</p>
                </div>
                <Button size="sm" onClick={() => goalRef.current?.focus()} data-testid="skills-own-start">
                  {t('pluginsUi.own.empty.action')}
                </Button>
              </div>
            </Panel>
          )
        )}

        </div>
        <BuiltinIndex modules={data.modules} selected={wide ? selection : null} onSelect={(id) => select({ kind: 'module', id })} />
        </div>
      </WorkspaceGrid>

      <Dialog
        open={detailOpen && !wide && detail !== null}
        onOpenChange={(open) => !open && setDetailOpen(false)}
        title={shownSkill ? shownSkill.name : shownModule ? moduleName(shownModule) : t('skills.detail.title')}
        size="md"
        closeLabel={t('common.close')}
      >
        {renderDetail(true)}
      </Dialog>

      <CodeDialog skillId={codeFor} name={nameOf(codeFor)} onClose={() => setCodeFor(null)} />

      <Dialog
        open={reviewing !== null}
        onOpenChange={(open) => !open && setReviewing(null)}
        title={reviewing?.name ?? ''}
        description={reviewing?.description}
        size="lg"
        closeLabel={t('common.close')}
        footer={
          <>
            <Button
              variant="primary"
              onClick={() => {
                const target = reviewing;
                setReviewing(null);
                if (target) void decide(target, true);
              }}
            >
              {t('skills.pending.approve')}
            </Button>
            <Button variant="secondary" onClick={() => setReviewing(null)}>
              {t('common.cancel')}
            </Button>
          </>
        }
      >
        {reviewing && <ApprovalBody skill={reviewing} hosts={meta(reviewing.id).hosts} />}
      </Dialog>

      <Dialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        role="alertdialog"
        size="sm"
        title={t('skills.remove.title', { name: removing?.name ?? '' })}
        description={t('skills.remove.body')}
        initialFocusRef={cancelRef}
        closeLabel={t('common.close')}
        footer={
          <>
            <Button variant="danger" loading={busy === removing?.id} onClick={() => void remove()}>
              {t('skills.remove.confirm')}
            </Button>
            <Button ref={cancelRef} variant="secondary" onClick={() => setRemoving(null)}>
              {t('common.cancel')}
            </Button>
          </>
        }
      />
    </Workspace>
  );
}

export default definePage({
  id: 'skills',
  titleKey: 'nav.skills',
  icon: PuzzlePiece,
  order: 70,
  moduleId: 'workshop',
  Component: SkillsPage,
});
