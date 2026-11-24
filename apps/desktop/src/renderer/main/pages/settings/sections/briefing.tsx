// Ayarlar › Brifing ve gündem: Jarvis'in kendiliğinden konuşması (brifing modülü, `briefing.*`) ve haberleri okuduğu
// kaynaklarla takip konuları (gündem modülü, `news.*`). Kutular `kit.tsx`'in yapı taşlarıdır (arama ekrandaki metni bulur).
// Modüllerden biri kapalıysa o modülün kutuları yerine tek satırlık "kapalı" notu çizilir; kanalı çağrılmaz.
import { useEffect, useState } from 'react';
import { ArrowsClockwise, Lightning, Plus, Trash } from '@phosphor-icons/react';
import { formatDay, localTime, relativeTime, t } from '@fuber/shared';
import { Badge, Button, Chip, IconButton, Input, Segmented, Select, Switch, toast } from '@fuber/ui';
import type { BriefingPrefs, BriefingScope, BriefingState, TalkLevel } from '../../../../../main/modules/briefing/types';
import type { NewsSourceView, NewsStatus, NewsTopic } from '../../../../../main/modules/news/types';
import { useShell } from '../../../shell/context';
import { attempt, useLive } from '../../../shell/live';
import { ErrorPanel, SkeletonRows } from '../../../shell/parts';
import { Column, Fact, Facts, Group, SectionGrid, SettingRow } from '../kit';
import { canAddTopic, clampInt, groupSources, isValidRange, isValidTime, shortUrl, splitTopics } from './briefing-logic';

type PrefsPatch = Parameters<typeof savePrefs>[0];

const TALK: readonly TalkLevel[] = ['silent', 'low', 'normal', 'high'];
const SCOPE: ReadonlyArray<keyof BriefingScope> = ['news', 'agenda', 'tasks', 'mail'];
const PER_HOUR = [1, 2, 3, 4, 5, 6];
const NEWS_COUNT = [3, 4, 5, 6, 7, 8, 10];

async function savePrefs(
  patch: Partial<Omit<BriefingPrefs, 'morning' | 'updates' | 'scope'>> & { morning?: Partial<BriefingPrefs['morning']>; updates?: Partial<BriefingPrefs['updates']>; scope?: Partial<BriefingScope> },
  quiet = false,
): Promise<BriefingState | null> {
  const result = await attempt(() => window.fuber.invoke('briefing.setPrefs', { patch }));
  if (result && !quiet) toast.success(t('settings.saved'));
  return result;
}

/** Seçim kutusu seçenekleri: sabit liste, geçerli değer listede yoksa o da eklenir (ana süreç başka bir değer yazdıysa). */
function numberOptions(values: readonly number[], current: number, label: (count: number) => string) {
  const all = values.includes(current) ? values : [...values, current].sort((a, b) => a - b);
  return all.map((value) => ({ value: String(value), label: label(value) }));
}

/** Saat kutusu: `SS:DD`; yalnız geçerli değer bildirilir. */
function TimeInput({ value, disabled, label, onChange, testId }: { value: string; disabled?: boolean; label: string; onChange: (value: string) => void; testId?: string }) {
  return (
    <span className="block w-[104px]">
      <Input type="time" size="sm" value={value} disabled={disabled} onChange={(event) => isValidTime(event.target.value) && onChange(event.target.value)} aria-label={label} data-testid={testId} />
    </span>
  );
}

// ───────────── brifing ─────────────

function BriefingPrefsGroup({ state, onSaved }: { state: BriefingState; onSaved: () => void }) {
  const shell = useShell();
  const prefs = state.prefs;
  const [range, setRange] = useState(prefs.updates);
  useEffect(() => setRange(prefs.updates), [prefs.updates.from, prefs.updates.to]);
  const rangeOk = isValidRange(range.from, range.to);
  const off = !prefs.enabled;
  const save = async (patch: PrefsPatch, quiet = false) => {
    if (await savePrefs(patch, quiet)) onSaved();
  };
  const setUpdates = (next: BriefingPrefs['updates']) => {
    setRange(next);
    if (isValidRange(next.from, next.to)) void save({ updates: next }, true);
  };

  return (
    <Group tone="lead" title={t('briefingUi.title')} description={t('briefingUi.description', { name: shell.name })} testId="briefing-prefs">
      <SettingRow label={t('briefingUi.enabled')} description={t('briefingUi.enabledHint')}>
        <Switch checked={prefs.enabled} onCheckedChange={(enabled) => void save({ enabled })} aria-label={t('briefingUi.enabled')} data-testid="briefing-enabled" />
      </SettingRow>
      <SettingRow label={t('briefingUi.talk')} description={t(`briefingUi.talk.${prefs.talk}.hint`)}>
        <span className="block w-44" data-testid="briefing-talk" data-value={prefs.talk}>
          <Select<TalkLevel>
            size="sm"
            value={prefs.talk}
            disabled={off}
            onChange={(talk) => void save({ talk })}
            options={TALK.map((level) => ({ value: level, label: t(`briefingUi.talk.${level}`), description: t(`briefingUi.talk.${level}.hint`) }))}
            aria-label={t('briefingUi.talk')}
          />
        </span>
      </SettingRow>
      <SettingRow label={t('briefingUi.morning')} description={t('briefingUi.morningHint')}>
        <TimeInput value={prefs.morning.time} disabled={off || !prefs.morning.enabled} label={t('briefingUi.morningTime')} onChange={(time) => void save({ morning: { time } }, true)} testId="briefing-morning-time" />
        <Switch
          checked={prefs.morning.enabled}
          disabled={off}
          onCheckedChange={(enabled) => void save({ morning: { enabled } })}
          aria-label={t('briefingUi.morning')}
          data-testid="briefing-morning"
        />
      </SettingRow>
      <SettingRow
        label={t('briefingUi.updates')}
        description={t('briefingUi.updatesHint')}
        note={rangeOk ? undefined : t('briefingUi.rangeInvalid')}
        noteTone="warning"
      >
        <TimeInput value={range.from} disabled={off} label={t('briefingUi.updatesFrom')} onChange={(from) => setUpdates({ ...range, from })} testId="briefing-updates-from" />
        <span className="h-px w-3 shrink-0 bg-fg-faint" aria-hidden />
        <TimeInput value={range.to} disabled={off} label={t('briefingUi.updatesTo')} onChange={(to) => setUpdates({ ...range, to })} testId="briefing-updates-to" />
      </SettingRow>
      <SettingRow label={t('briefingUi.maxPerHour')} description={t('briefingUi.maxPerHourHint')}>
        <span className="block w-32">
          <Select<string>
            size="sm"
            value={String(prefs.maxPerHour)}
            disabled={off}
            onChange={(value) => void save({ maxPerHour: clampInt(Number(value), 1, 12) })}
            options={numberOptions(PER_HOUR, prefs.maxPerHour, (count) => t('briefingUi.maxPerHourValue', { count }))}
            aria-label={t('briefingUi.maxPerHour')}
          />
        </span>
      </SettingRow>
      <SettingRow label={t('briefingUi.breaking')} description={t('briefingUi.breakingHint')}>
        <Switch checked={prefs.breaking} disabled={off} onCheckedChange={(breaking) => void save({ breaking })} aria-label={t('briefingUi.breaking')} data-testid="briefing-breaking" />
      </SettingRow>
      <SettingRow label={t('briefingUi.newsCount')} description={t('briefingUi.newsCountHint')}>
        <span className="block w-32">
          <Select<string>
            size="sm"
            value={String(prefs.newsCount)}
            disabled={off || !prefs.scope.news}
            onChange={(value) => void save({ newsCount: clampInt(Number(value), 1, 20) })}
            options={numberOptions(NEWS_COUNT, prefs.newsCount, (count) => t('briefingUi.newsCountValue', { count }))}
            aria-label={t('briefingUi.newsCount')}
          />
        </span>
      </SettingRow>
    </Group>
  );
}

function BriefingScopeGroup({ state, onSaved }: { state: BriefingState; onSaved: () => void }) {
  const { scope, enabled } = state.prefs;
  return (
    <Group title={t('briefingUi.scope.title')} description={t('briefingUi.scope.description')} columns={260} testId="briefing-scope">
      {SCOPE.map((key) => (
        <SettingRow key={key} label={t(`briefingUi.scope.${key}`)} description={t(`briefingUi.scope.${key}Hint`)}>
          <Switch
            checked={scope[key]}
            disabled={!enabled}
            onCheckedChange={(value) => void savePrefs({ scope: { [key]: value } }).then((result) => result && onSaved())}
            aria-label={t(`briefingUi.scope.${key}`)}
            data-testid={`briefing-scope-${key}`}
          />
        </SettingRow>
      ))}
    </Group>
  );
}

function BriefingStateGroup({ state, onSaved }: { state: BriefingState; onSaved: () => void }) {
  const [running, setRunning] = useState(false);
  const [resetting, setResetting] = useState(false);
  const { adaptive, canSpeak, last } = state;
  const learned = adaptive.factor < 1;

  const runNow = async () => {
    setRunning(true);
    // Yalnız kart güncellenir; ses çalınmaz.
    const result = await attempt(() => window.fuber.invoke('briefing.runNow', { speak: false }));
    setRunning(false);
    if (result) {
      toast.success(t('briefingUi.runNowDone'));
      onSaved();
    }
  };
  const reset = async () => {
    setResetting(true);
    const result = await attempt(() => window.fuber.invoke('briefing.resetAdaptive'));
    setResetting(false);
    if (result) {
      toast.success(t('briefingUi.adaptive.resetDone'));
      onSaved();
    }
  };

  return (
    <Group title={t('briefingUi.state.title')} testId="briefing-state">
      <Facts min={150}>
        <Fact label={t('briefingUi.state.today')} testId="briefing-spoken-today">
          <span className="tabular-nums">{t('briefingUi.state.todayValue', { count: state.spokenToday, limit: state.dailyLimit })}</span>
        </Fact>
        <Fact label={t('briefingUi.state.canSpeak')} testId="briefing-can-speak">
          <span className={canSpeak.ok ? undefined : 'text-fg-muted'}>{canSpeak.ok ? t('briefingUi.state.canSpeakYes') : (canSpeak.reason ?? t('common.no'))}</span>
        </Fact>
        <Fact label={t('briefingUi.state.next')} testId="briefing-next">
          {state.nextMorningAt ? `${formatDay(new Date(state.nextMorningAt))}, ${localTime(state.nextMorningAt)}` : t('briefingUi.state.nextNone')}
        </Fact>
        <Fact label={t('briefingUi.state.last')}>{last ? `${t(`briefingUi.kind.${last.kind}`)}, ${relativeTime(last.at)}` : t('briefingUi.state.lastNone')}</Fact>
      </Facts>
      {learned ? (
        <SettingRow
          layout="stack"
          label={t('briefingUi.adaptive.title')}
          description={
            <>
              {adaptive.note ?? ''} <span className="text-fg-faint">{t('briefingUi.adaptive.counts', { engaged: adaptive.engaged, ignored: adaptive.ignored, declined: adaptive.declined })}</span>
            </>
          }
          testId="briefing-adaptive"
        >
          <Button size="sm" loading={resetting} onClick={() => void reset()} data-testid="briefing-reset-adaptive">
            {t('briefingUi.adaptive.reset')}
          </Button>
        </SettingRow>
      ) : null}
      <SettingRow layout="stack" label={t('briefingUi.runNow')} description={t('briefingUi.runNowHint')}>
        <Button size="sm" icon={<Lightning />} loading={running} disabled={!state.prefs.enabled} onClick={() => void runNow()} data-testid="briefing-run-now">
          {t('briefingUi.runNow')}
        </Button>
      </SettingRow>
    </Group>
  );
}

function BriefingGroups() {
  const state = useLive<BriefingState>(() => window.fuber.invoke('briefing.state'), ['briefing.changed']);
  if (state.state.status === 'loading') {
    return (
      <Group tone="lead" span="full" title={t('briefingUi.title')}>
        <SkeletonRows count={4} />
      </Group>
    );
  }
  if (state.state.status === 'error') {
    return (
      <Column span="full">
        <ErrorPanel message={state.state.message} onRetry={state.reload} />
      </Column>
    );
  }
  const data = state.state.data;
  return (
    <>
      <Column span="main">
        <BriefingPrefsGroup state={data} onSaved={state.reload} />
        <BriefingScopeGroup state={data} onSaved={state.reload} />
      </Column>
      <Column span="side">
        <BriefingStateGroup state={data} onSaved={state.reload} />
      </Column>
    </>
  );
}

// ───────────── gündem kaynakları ─────────────

function SourceRow({ source, onToggle, onRemove }: { source: NewsSourceView; onToggle: (enabled: boolean) => void; onRemove: () => void }) {
  const detail = source.lastOkAt ? t('newsUi.sources.lastOk', { when: relativeTime(source.lastOkAt) }) : t('newsUi.sources.never');
  return (
    <div className="st-row" data-st-row="" data-testid="news-source-row" data-id={source.id} data-enabled={source.enabled || undefined}>
      <div className="flex min-w-0 flex-1 basis-56 flex-col gap-0.5">
        <span className="st-row-label flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate">{source.name}</span>
          {source.lastError ? (
            <Badge size="sm" tone="warning" dot>
              {t('newsUi.sources.error')}
            </Badge>
          ) : null}
          {!source.builtin ? (
            <Badge size="sm" tone="neutral">
              {t('newsUi.sources.mine')}
            </Badge>
          ) : null}
        </span>
        <span className="truncate font-mono text-xs text-fg-faint" title={source.url}>
          {shortUrl(source.url)}
        </span>
        <span className="truncate text-xs text-fg-muted">
          {t('newsUi.sources.items', { count: source.itemCount })} · {detail}
        </span>
        {source.lastError ? <span className="line-clamp-2 text-xs text-warning">{source.lastError}</span> : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        {!source.builtin ? <IconButton icon={<Trash />} label={t('newsUi.sources.remove', { name: source.name })} size="sm" onClick={onRemove} data-testid="news-source-remove" /> : null}
        <Switch checked={source.enabled} onCheckedChange={onToggle} aria-label={t('newsUi.sources.toggle', { name: source.name })} data-testid="news-source-toggle" />
      </div>
    </div>
  );
}

function statusLine(status: NewsStatus | null): string {
  if (!status) return '';
  const parts = [t('newsUi.status', { enabled: status.enabled, stories: status.stories, unread: status.unread })];
  parts.push(status.lastRefreshAt ? t('newsUi.status.last', { when: relativeTime(status.lastRefreshAt) }) : t('newsUi.status.never'));
  return parts.join(' ');
}

function NewsSourcesGroup() {
  const sources = useLive<NewsSourceView[]>(() => window.fuber.invoke('news.sources'), ['news.changed']);
  const status = useLive<NewsStatus>(() => window.fuber.invoke('news.status'), ['news.changed']);
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const reload = () => {
    sources.reload();
    status.reload();
  };

  const add = async () => {
    const text = query.trim();
    if (!text || adding) return;
    setAdding(true);
    const result = await attempt(() => window.fuber.invoke('news.addSource', { query: text }));
    setAdding(false);
    if (!result) return;
    if (result.ok) {
      toast.success(result.message);
      setQuery('');
      reload();
    } else toast.warning(result.message);
  };
  const refresh = async () => {
    setRefreshing(true);
    const result = await attempt(() => window.fuber.invoke('news.refresh'));
    setRefreshing(false);
    if (result) {
      toast.success(t('newsUi.refreshDone'));
      reload();
    }
  };
  const toggle = async (source: NewsSourceView, enabled: boolean) => {
    if (await attempt(() => window.fuber.invoke('news.toggleSource', { id: source.id, enabled }))) reload();
  };
  const remove = async (source: NewsSourceView) => {
    if (await attempt(() => window.fuber.invoke('news.removeSource', { id: source.id }))) {
      toast.success(t('newsUi.sources.removed'));
      reload();
    }
  };

  const list = sources.data ?? [];
  const groups = groupSources(list);
  const failing = status.data?.failing ?? 0;

  return (
    <Group
      span="main"
      title={t('newsUi.sources.title')}
      description={t('newsUi.sources.description')}
      testId="news-sources"
      action={
        <Button size="sm" variant="ghost" icon={<ArrowsClockwise />} loading={refreshing} onClick={() => void refresh()} data-testid="news-refresh">
          {t('newsUi.refresh')}
        </Button>
      }
    >
      <div className="flex flex-col gap-2 pb-2" data-st-row="">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void add();
          }}
        >
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('newsUi.add.placeholder')}
            aria-label={t('newsUi.add.label')}
            spellCheck={false}
            autoComplete="off"
            frameClassName="min-w-0 flex-1 basis-64"
            data-testid="news-source-add-input"
          />
          <Button type="submit" icon={<Plus />} loading={adding} disabled={!query.trim()} data-testid="news-source-add">
            {adding ? t('newsUi.add.busy') : t('newsUi.add.submit')}
          </Button>
        </form>
        <p className="text-sm text-fg-muted" role="status" data-testid="news-status">
          {statusLine(status.data)}
          {failing > 0 ? <span className="text-warning"> {t('newsUi.status.failing', { count: failing })}</span> : null}
        </p>
      </div>
      {sources.state.status === 'loading' ? (
        <SkeletonRows count={4} />
      ) : sources.state.status === 'error' ? (
        <ErrorPanel message={sources.state.message} onRetry={sources.reload} />
      ) : groups.length === 0 ? (
        <p className="text-sm text-fg-muted" data-st-row="">
          {t('newsUi.sources.empty')}
        </p>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-x-8 gap-y-5">
          {groups.map((group) => (
            <section key={group.category} className="flex min-w-0 flex-col" data-testid={`news-category-${group.category}`}>
              <h3 className="flex items-baseline gap-2 border-b border-line pb-1.5 text-sm font-semibold text-fg-muted">
                {t(`newsUi.cat.${group.category}`)}
                <span className="text-xs font-medium text-fg-faint tabular-nums">{t('newsUi.sources.groupCount', { enabled: group.enabled, total: group.sources.length })}</span>
              </h3>
              {group.sources.map((source) => (
                <SourceRow key={source.id} source={source} onToggle={(enabled) => void toggle(source, enabled)} onRemove={() => void remove(source)} />
              ))}
            </section>
          ))}
        </div>
      )}
    </Group>
  );
}

// ───────────── takip konuları ─────────────

function TopicChips({ topics, onRemove }: { topics: NewsTopic[]; onRemove: (topic: NewsTopic) => void }) {
  if (topics.length === 0) return <p className="text-sm text-fg-faint">{t('newsUi.topics.none')}</p>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {topics.map((topic) => (
        <Chip
          key={topic.id}
          onRemove={() => onRemove(topic)}
          removeLabel={t('newsUi.topics.remove', { text: topic.text })}
          title={topic.origin === 'profile' ? t('newsUi.topics.fromProfile') : undefined}
          data-testid="news-topic-chip"
          data-mode={topic.mode}
        >
          {topic.text}
        </Chip>
      ))}
    </div>
  );
}

function NewsTopicsGroup() {
  const topics = useLive<NewsTopic[]>(() => window.fuber.invoke('news.topics'), ['news.changed']);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<'follow' | 'mute'>('follow');
  const [busy, setBusy] = useState(false);
  const list = topics.data ?? [];
  const { follow, mute } = splitTopics(list);

  const set = async (topic: string, next: 'follow' | 'mute' | 'remove') => {
    setBusy(true);
    const result = await attempt(() => window.fuber.invoke('news.setTopic', { text: topic, mode: next }));
    setBusy(false);
    if (result) topics.reload();
    return result !== null;
  };
  const add = async () => {
    const value = text.trim();
    if (!value) return;
    if (!canAddTopic(value, list)) {
      toast.warning(t('newsUi.topics.duplicate'));
      return;
    }
    if (await set(value, mode)) setText('');
  };

  return (
    <Group title={t('newsUi.topics.title')} description={t('newsUi.topics.description')} testId="news-topics">
      {topics.state.status === 'loading' ? (
        <SkeletonRows count={2} />
      ) : topics.state.status === 'error' ? (
        <ErrorPanel message={topics.state.message} onRetry={topics.reload} />
      ) : (
        <>
          <div className="flex flex-col gap-2 py-2" data-st-row="">
            <span className="text-sm font-medium text-fg">{t('newsUi.topics.follow')}</span>
            <TopicChips topics={follow} onRemove={(topic) => void set(topic.text, 'remove')} />
          </div>
          <div className="flex flex-col gap-2 py-2" data-st-row="">
            <span className="text-sm font-medium text-fg">{t('newsUi.topics.mute')}</span>
            <TopicChips topics={mute} onRemove={(topic) => void set(topic.text, 'remove')} />
          </div>
        </>
      )}
      <form
        className="flex flex-col gap-2 pt-2"
        data-st-row=""
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <Input value={text} onChange={(event) => setText(event.target.value)} placeholder={t('newsUi.topics.placeholder')} aria-label={t('newsUi.topics.label')} maxLength={60} data-testid="news-topic-input" />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented<'follow' | 'mute'>
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'follow', label: t('newsUi.topics.modeFollow') },
              { value: 'mute', label: t('newsUi.topics.modeMute') },
            ]}
            aria-label={t('newsUi.topics.mode')}
            data-testid="news-topic-mode"
          />
          <Button type="submit" size="sm" icon={<Plus />} loading={busy} disabled={!text.trim()} data-testid="news-topic-add">
            {t('newsUi.topics.add')}
          </Button>
        </div>
      </form>
    </Group>
  );
}

// ───────────── bölüm ─────────────

function ModuleOff({ title, text }: { title: string; text: string }) {
  return (
    <Group span="full" tone="quiet" title={title}>
      <p className="text-sm text-fg-muted" data-st-row="">
        {text}
      </p>
    </Group>
  );
}

export function BriefingSettings() {
  const shell = useShell();
  const briefing = shell.moduleEnabled('briefing');
  const news = shell.moduleEnabled('news');
  return (
    <SectionGrid data-testid="settings-briefing-section">
      {briefing ? <BriefingGroups /> : <ModuleOff title={t('briefingUi.title')} text={t('briefingUi.moduleOff')} />}
      {news ? (
        <>
          <NewsSourcesGroup />
          <Column span="side">
            <NewsTopicsGroup />
          </Column>
        </>
      ) : (
        <ModuleOff title={t('newsUi.sources.title')} text={t('newsUi.moduleOff')} />
      )}
    </SectionGrid>
  );
}
