// Hafıza › "Beni nasıl tanıyorsun": Jarvis'in kullanıcıyı NASIL tanıdığı (profil katmanı, `memory.profile.*`).
// Birincil kutu: insan diliyle özet, en üstte davranış kuralları, ardından kategorili bilgiler (her satır düzeltilir,
// silinir). Bağlam sütunu: kısa sayılar, tanışma anahtarı, katlı "Değişenler". Profil boşken sıcak bir açıklama + "Ekle".
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Gavel, LockSimple, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { formatDay, relativeTime, t } from '@fuber/shared';
import { Button, Dialog, Field, IconButton, Panel, Select, Skeleton, Switch, Textarea, WorkspaceGrid, cn, enter, toast, useMotionPreset } from '@fuber/ui';
import type { ProfileCategory, ProfileGroup, ProfileItem, ProfileOverview } from '../../../../../main/modules/memory/profile/types';
import { useShell } from '../../../shell/context';
import { attempt, useLive } from '../../../shell/live';
import { ConfirmDialog, ErrorPanel } from '../../../shell/parts';
import { capitalize, formatPercent } from '../../../shell/text';
import { ContextCard, ContextSection, Disclosure, Fact } from '../page-parts';
import { canSaveProfileText, confidenceLevel, itemTime, orderProfileGroups, PROFILE_ORDER, PROFILE_TEXT_MAX, type ConfidenceLevel } from './logic';

interface Draft {
  id: string | null;
  category: ProfileCategory;
  text: string;
}

const categoryLabel = (category: ProfileCategory): string => t(`profileUi.cat.${category}`);

// ───────────── güven işareti ─────────────

/** Üç noktalı güven işareti: dolu nokta sayısı kademedir. Yüzde ipucunda ve ekran okuyucu adında. */
function ConfidenceDots({ value }: { value: number }) {
  const level: ConfidenceLevel = confidenceLevel(value);
  const label = `${t(`profileUi.confidence.${level}`)}, ${t('profileUi.confidence', { value: formatPercent(value) })}`;
  return (
    <span className="flex items-center gap-[3px]" role="img" aria-label={label} title={label} data-level={level}>
      {[1, 2, 3].map((dot) => (
        <span key={dot} className={cn('size-[4px] rounded-full', dot <= level ? 'bg-fg-muted' : 'bg-surface-5')} />
      ))}
    </span>
  );
}

// ───────────── kayıt satırı ─────────────

function ProfileRow({ item, onEdit, onRemove }: { item: ProfileItem; onEdit: () => void; onRemove: () => void }) {
  const preset = useMotionPreset(enter.fade);
  const at = itemTime(item);
  const meta = [t(`profileUi.origin.${item.origin}`), t('profileUi.confidence', { value: formatPercent(item.confidence) })];
  if (item.confirmations > 1) meta.push(t('profileUi.confirmations', { count: item.confirmations }));
  return (
    <motion.li {...preset} exit={{ opacity: 0 }} data-testid="profile-item" data-id={item.id} data-category={item.category} data-locked={item.locked || undefined}>
      <div className="mem-row">
        <span className="mem-row-kind">
          <ConfidenceDots value={item.confidence} />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="mem-row-text text-fg" data-selectable>
            {item.text}
          </p>
          <p className="truncate text-xs text-fg-faint">{meta.join(' · ')}</p>
          {item.previousText ? (
            <p className="line-clamp-1 text-xs text-fg-faint" title={item.previousText} data-selectable>
              {t('profileUi.previous', { text: item.previousText })}
            </p>
          ) : null}
        </div>
        <div className="mem-row-side" data-actions="">
          <span className="mem-row-info">
            <span className="mem-row-state">
              {item.locked ? (
                <span className="flex text-fg-muted" title={t('profileUi.locked')}>
                  <LockSimple weight="bold" className="size-3.5" aria-label={t('profileUi.locked')} />
                </span>
              ) : null}
            </span>
            <time className="mem-row-time" dateTime={at} title={formatDay(new Date(at))}>
              {capitalize(relativeTime(at))}
            </time>
          </span>
          <span className="mem-row-actions">
            <IconButton icon={<PencilSimple />} label={t('profileUi.editLabel', { text: item.text })} size="sm" onClick={onEdit} data-testid="profile-edit" />
            <IconButton icon={<Trash />} label={t('profileUi.removeLabel', { text: item.text })} size="sm" onClick={onRemove} data-testid="profile-remove" />
          </span>
        </div>
      </div>
    </motion.li>
  );
}

function GroupSection({ group, title, hint, onEdit, onRemove }: { group: ProfileGroup; title: string; hint?: string; onEdit: (item: ProfileItem) => void; onRemove: (item: ProfileItem) => void }) {
  return (
    <section className="mem-group" data-testid={`profile-group-${group.category}`}>
      <h2 className="mem-group-title">
        {title}
        <span>{group.items.length}</span>
      </h2>
      {hint ? <p className="mx-3 pb-1 text-sm text-fg-muted">{hint}</p> : null}
      <ul className="flex flex-col">
        <AnimatePresence initial={false}>
          {group.items.map((item) => (
            <ProfileRow key={item.id} item={item} onEdit={() => onEdit(item)} onRemove={() => onRemove(item)} />
          ))}
        </AnimatePresence>
      </ul>
    </section>
  );
}

// ───────────── ekle / düzelt ─────────────

function ProfileDialog({ draft, onClose }: { draft: Draft | null; onClose: () => void }) {
  const [value, setValue] = useState<Draft | null>(draft);
  const [busy, setBusy] = useState(false);
  useEffect(() => setValue(draft), [draft]);
  const current = value ?? draft;
  const valid = current ? canSaveProfileText(current.text) : false;
  const save = async () => {
    if (!current || !valid) return;
    setBusy(true);
    const body = { category: current.category, text: current.text.trim(), ...(current.id ? { id: current.id } : {}) };
    const result = await attempt(() => window.fuber.invoke('memory.profile.save', body));
    setBusy(false);
    if (!result) return;
    toast.success(current.id ? t('profileUi.toast.updated') : t('profileUi.toast.saved'));
    onClose();
  };
  return (
    <Dialog
      open={draft !== null}
      onOpenChange={(open) => !open && !busy && onClose()}
      title={draft?.id ? t('profileUi.dialog.editTitle') : t('profileUi.dialog.addTitle')}
      description={t('profileUi.dialog.description')}
      closeLabel={t('common.close')}
      footer={
        <>
          <Button variant="primary" loading={busy} disabled={!valid} onClick={() => void save()} data-testid="profile-save">
            {t('common.save')}
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
        </>
      }
    >
      {current && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <Field label={t('profileUi.dialog.category')}>
            <Select<ProfileCategory>
              value={current.category}
              onChange={(category) => setValue({ ...current, category })}
              options={PROFILE_ORDER.map((category) => ({ value: category, label: categoryLabel(category), description: t(`profileUi.catHint.${category}`) }))}
              aria-label={t('profileUi.dialog.category')}
            />
          </Field>
          <Field label={t('profileUi.dialog.text')} hint={t('profileUi.dialog.textHint')}>
            <Textarea
              value={current.text}
              minRows={2}
              maxLength={PROFILE_TEXT_MAX}
              placeholder={t('profileUi.dialog.textPlaceholder')}
              onChange={(event) => setValue({ ...current, text: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void save();
                }
              }}
              autoFocus
              data-testid="profile-input-text"
            />
          </Field>
        </form>
      )}
    </Dialog>
  );
}

// ───────────── bağlam sütunu ─────────────

function ProfileAside({ overview }: { overview: ProfileOverview }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const intro = overview.intro;
  const toggleIntro = async (enabled: boolean) => {
    setBusy(true);
    const result = await attempt(() => window.fuber.invoke('memory.profile.setIntro', { enabled }));
    setBusy(false);
    if (result) toast.success(enabled ? t('profileUi.intro.on') : t('profileUi.intro.off'));
  };
  const since = overview.since ? `${formatDay(new Date(overview.since))}, ${relativeTime(overview.since)}` : t('profileUi.facts.sinceNone');
  return (
    <ContextCard data-testid="profile-aside">
      <ContextSection title={t('profileUi.facts.title')}>
        <dl className="flex flex-col gap-2">
          <Fact label={t('profileUi.facts.total')}>{t('profileUi.facts.totalValue', { count: overview.total })}</Fact>
          <Fact label={t('profileUi.facts.rules')}>{t('profileUi.facts.rulesValue', { count: overview.rules })}</Fact>
          <Fact label={t('profileUi.facts.since')}>{since}</Fact>
        </dl>
        {overview.total > 0 ? (
          <p className="pt-3 text-sm text-fg-muted" data-testid="profile-prompt-size">
            {t('profileUi.facts.prompt', { count: overview.promptChars.rich.toLocaleString('tr-TR') })}{' '}
            {overview.promptChars.compact > 0 && overview.promptChars.compact !== overview.promptChars.rich ? (
              <span className="text-fg-faint">{t('profileUi.facts.promptCompact', { count: overview.promptChars.compact.toLocaleString('tr-TR') })}</span>
            ) : null}
          </p>
        ) : null}
      </ContextSection>
      <ContextSection title={t('profileUi.intro.title')}>
        <div className="flex flex-col gap-3">
          <Switch
            checked={intro.enabled}
            disabled={busy}
            onCheckedChange={(enabled) => void toggleIntro(enabled)}
            label={t('profileUi.intro.switch')}
            description={t('profileUi.intro.hint')}
            data-testid="profile-intro-switch"
          />
          {intro.enabled && intro.missing.length > 0 ? (
            <p className="text-sm text-fg-muted" data-testid="profile-intro-missing">
              {t('profileUi.intro.missing', { list: intro.missing.join(', ') })}
            </p>
          ) : null}
          {intro.asked > 0 ? <p className="text-xs text-fg-faint">{t('profileUi.intro.progress', { asked: intro.asked, answered: intro.answered })}</p> : null}
        </div>
      </ContextSection>
      <section className="ctx-section">
        <Disclosure
          title={t('profileUi.history.title')}
          count={overview.history.length}
          hint={historyOpen ? t('profileUi.history.hint') : undefined}
          open={historyOpen}
          onToggle={() => setHistoryOpen((open) => !open)}
          data-testid="profile-history"
          toggleTestId="profile-history-toggle"
        >
          {overview.history.length === 0 ? (
            <p className="text-sm text-fg-faint">{t('profileUi.history.empty')}</p>
          ) : (
            <ul className="flex flex-col gap-3 pt-1">
              {overview.history.map((entry) => (
                <li key={entry.id} className="flex min-w-0 flex-col gap-0.5" data-testid="profile-history-item">
                  <span className="text-xs text-fg-faint">
                    {categoryLabel(entry.category)} · <time dateTime={entry.at}>{capitalize(relativeTime(entry.at))}</time>
                  </span>
                  <span className="text-sm text-fg-faint line-through" data-selectable>
                    {entry.text}
                  </span>
                  <span className="text-sm text-fg" data-selectable>
                    {entry.replacedBy}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Disclosure>
      </section>
    </ContextCard>
  );
}

// ───────────── görünüm ─────────────

function ProfileSkeleton() {
  return (
    <Panel tone="lead" data-testid="profile-view" aria-busy aria-label={t('common.loading')}>
      <Skeleton className="h-5 w-56 rounded-full" />
      <Skeleton shape="text" lines={3} />
      <div className="flex flex-col gap-3 pt-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-3.5 w-10/12 rounded-full" />
        ))}
      </div>
    </Panel>
  );
}

export function ProfileView() {
  const shell = useShell();
  const preset = useMotionPreset(enter.fadeUp);
  const profile = useLive<ProfileOverview>(() => window.fuber.invoke('memory.profile.get'), ['memory.profile.changed']);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<ProfileItem | null>(null);

  if (profile.state.status === 'loading') {
    return (
      <WorkspaceGrid asideWidth={348}>
        <ProfileSkeleton />
      </WorkspaceGrid>
    );
  }
  if (profile.state.status === 'error') {
    return (
      <div data-testid="profile-view">
        <ErrorPanel message={profile.state.message} onRetry={profile.reload} />
      </div>
    );
  }

  const overview = profile.state.data;
  const { rules, others } = orderProfileGroups(overview.groups);
  const empty = rules === null && others.length === 0;
  const addNew = () => setDraft({ id: null, category: 'preference', text: '' });
  const edit = (item: ProfileItem) => setDraft({ id: item.id, category: item.category, text: item.text });
  const addButton = (
    <Button variant="primary" size="sm" icon={<Plus weight="bold" />} onClick={addNew} aria-label={t('profileUi.addLabel')} data-testid="profile-add">
      {t('profileUi.add')}
    </Button>
  );

  return (
    <motion.div {...preset}>
      <WorkspaceGrid asideWidth={348} aside={<ProfileAside overview={overview} />}>
        <Panel tone="lead" padding="none" data-testid="profile-view" data-empty={empty || undefined}>
          <div className="flex flex-col gap-3 border-b border-line px-5 py-5">
            <div className="flex items-start justify-between gap-4">
              <h2 className="min-w-0 text-xl text-fg">{empty ? t('profileUi.empty.title') : t('profileUi.title', { name: shell.name })}</h2>
              <div className="shrink-0">{addButton}</div>
            </div>
            {empty ? (
              <div className="flex flex-col gap-2" data-testid="profile-empty">
                <p className="max-w-[64ch] text-base text-fg-muted">{t('profileUi.empty.body')}</p>
                <p className="max-w-[64ch] text-sm text-fg-faint">{t('profileUi.empty.example')}</p>
              </div>
            ) : (
              <p className="max-w-[72ch] text-base whitespace-pre-line text-fg" data-selectable data-testid="profile-summary">
                {overview.summary}
              </p>
            )}
          </div>

          {rules ? (
            <div className="px-2 pb-1">
              <div className="flex items-start gap-2.5 px-3 pt-4 text-accent-fg">
                <Gavel weight="bold" className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="flex min-w-0 flex-col">
                  <h2 className="text-sm font-semibold text-fg">
                    {t('profileUi.rules.title')} <span className="ml-1 text-xs font-medium text-fg-faint tabular-nums">{rules.items.length}</span>
                  </h2>
                  <p className="text-sm text-fg-muted">{t('profileUi.rules.hint')}</p>
                </div>
              </div>
              <ul className="flex flex-col pt-1 pb-2" data-testid="profile-group-rule">
                <AnimatePresence initial={false}>
                  {rules.items.map((item) => (
                    <ProfileRow key={item.id} item={item} onEdit={() => edit(item)} onRemove={() => setRemoving(item)} />
                  ))}
                </AnimatePresence>
              </ul>
            </div>
          ) : null}

          {others.length > 0 ? (
            <div className={cn('mem-flow', rules && 'border-t border-line')}>
              {others.map((group) => (
                <GroupSection key={group.category} group={group} title={categoryLabel(group.category)} onEdit={edit} onRemove={setRemoving} />
              ))}
            </div>
          ) : null}
        </Panel>
      </WorkspaceGrid>

      <ProfileDialog draft={draft} onClose={() => setDraft(null)} />
      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(open) => !open && setRemoving(null)}
        title={t('profileUi.removeTitle')}
        body={t('profileUi.removeBody', { name: shell.name })}
        confirmLabel={t('profileUi.remove')}
        onConfirm={async () => {
          if (!removing) return;
          const ok = await attempt(() => window.fuber.invoke('memory.profile.remove', { id: removing.id }));
          if (ok) toast.success(t('profileUi.toast.removed'));
        }}
      >
        {removing && (
          <p className="rounded-sm border border-line bg-surface-1 px-4 py-3 text-sm text-fg" data-selectable>
            {removing.text}
          </p>
        )}
      </ConfirmDialog>
    </motion.div>
  );
}
