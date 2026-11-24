// Ayarlar: solda bölüm gezgini, üstte ayar araması, sağda kutu ızgarası.
//
// Bölümler `SECTIONS` dizisindedir; her biri `sections/<ad>.tsx` içinde `kit.tsx`'in yapı taşlarıyla (`SectionGrid`,
// `Column`, `Group`, `SettingRow`) kurulur. Yeni bir bölüm: dosyayı yazın, diziye bir satır ekleyin. Var olan bir bölüme
// yeni kutu: o bölümün dosyasında bir `Group` ekleyin. Arama ekrandaki metni okur; ayrıca kayıt gerekmez.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowRight, Broadcast, ChatCircleDots, EnvelopeSimple, Gear, Keyboard, MagnifyingGlass, Microphone, Newspaper, Pulse, ShieldCheck, SlidersHorizontal, X } from '@phosphor-icons/react';
import { t, type Settings } from '@fuber/shared';
import { Button, EmptyState, Input, KeyHint, Panel, Skeleton, TabPanel, Workspace, WorkspaceGrid, WorkspaceHeader } from '@fuber/ui';
import { useShell } from '../../shell/context';
import { definePage } from '../page';
import { Column, SectionGrid } from './kit';
import { MailSettings } from './mail';
import { onSettingsTab, takeSettingsTab, type SettingsTab } from './navigate';
import { applySearch, clearSearch, type SearchResult } from './search';
import { BriefingSettings } from './sections/briefing';
import { Connection } from './sections/connection';
import { Diagnostics } from './sections/diagnostics';
import { General } from './sections/general';
import { Hotkeys } from './sections/hotkeys';
import { Privacy } from './sections/privacy';
import { Voice } from './sections/voice';
import './settings.css';

// Eski içe aktarma yolları çalışsın diye yapı taşları buradan da verilir.
export { Column, Group, SectionGrid, SettingRow } from './kit';

// Bölüm kimlikleri sesle gezinmenin sekme kimlikleriyle birebir aynıdır (`navigate.ts` › `SETTINGS_TABS`,
// `main/core/brain/local-commands.ts` › `SPOKEN_PAGES`).
// `briefing` henüz `SETTINGS_TABS`'ta değil (sesle gezinme o listeyi okur); eklenince bu birleşim sadeleşir.
type TabId = SettingsTab | 'briefing';
const TABS_ID = 'settings-tabs';

interface SectionDef {
  id: TabId;
  label: string;
  icon: ReactNode;
  render(settings: Settings): ReactNode;
}

/** Bölümler, gezgindeki sırayla. E-posta ve brifing/gündem modülleri Yönetim'den kapatılınca bölümleri de kalkar. */
function sections(mail: boolean, briefing = true): SectionDef[] {
  return [
    { id: 'general', label: t('settings.tab.general'), icon: <SlidersHorizontal />, render: (settings) => <General settings={settings} /> },
    { id: 'voice', label: t('settings.tab.voice'), icon: <Microphone />, render: (settings) => <Voice settings={settings} /> },
    ...(briefing ? [{ id: 'briefing' as const, label: t('briefingUi.tab'), icon: <Newspaper />, render: () => <BriefingSettings /> }] : []),
    { id: 'hotkeys', label: t('settings.tab.hotkeys'), icon: <Keyboard />, render: (settings) => <Hotkeys settings={settings} /> },
    { id: 'privacy', label: t('settings.tab.privacy'), icon: <ShieldCheck />, render: () => <Privacy /> },
    ...(mail ? [{ id: 'mail' as const, label: t('mail.settings.tab'), icon: <EnvelopeSimple />, render: () => <MailSettings /> }] : []),
    { id: 'connection', label: t('settings.tab.connection'), icon: <Broadcast />, render: () => <Connection /> },
    { id: 'diagnostics', label: t('settings.tab.diagnostics'), icon: <Pulse />, render: () => <Diagnostics /> },
  ];
}

/** Bölüm gezgini: dikey sekme listesi (dar kapta yatay şerit). Oklar gezer ve seçer; Home/End uçlara gider. */
function SectionNav({
  items,
  value,
  onChange,
  counts,
  marks,
}: {
  items: SectionDef[];
  value: TabId;
  onChange: (value: TabId) => void;
  /** Arama sürerken bölüm başına eşleşme sayısı. */
  counts: Record<string, number> | null;
  /** Dikkat isteyen bölümler (kaydedilemeyen kısayol gibi). */
  marks: Partial<Record<TabId, boolean>>;
}) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === value);
    const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' || event.key === 'ArrowLeft' ? -1 : 0;
    const next = event.key === 'Home' ? items[0] : event.key === 'End' ? items[items.length - 1] : step ? items[(index + step + items.length) % items.length] : undefined;
    if (!next) return;
    event.preventDefault();
    onChange(next.id);
    event.currentTarget.querySelector<HTMLElement>(`[data-value="${next.id}"]`)?.focus();
  };
  return (
      <div className="st-nav" role="tablist" aria-orientation="vertical" aria-label={t('settings.nav.label')} onKeyDown={onKeyDown} data-testid="settings-nav">
        {items.map((item) => {
          const selected = item.id === value && !counts;
          const count = counts?.[item.id] ?? 0;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              id={`${TABS_ID}-tab-${item.id}`}
              aria-controls={`${TABS_ID}-panel-${item.id}`}
              aria-selected={selected}
              tabIndex={item.id === value ? 0 : -1}
              data-value={item.id}
              data-dim={counts && count === 0 ? '' : undefined}
              onClick={() => onChange(item.id)}
              className="st-nav-item"
            >
              {item.icon}
              <span className="st-nav-label">{item.label}</span>
              {counts && count > 0 ? <span className="st-nav-count">{count}</span> : !counts && marks[item.id] ? <span className="st-nav-mark" aria-hidden /> : null}
            </button>
          );
        })}
      </div>
  );
}

function SectionSkeleton() {
  return (
    <SectionGrid aria-busy aria-label={t('common.loading')}>
      <Panel tone="lead" data-span="lead">
        <Skeleton className="h-4 w-32 rounded-full" />
        <Skeleton className="h-32 w-full" />
      </Panel>
      <Column span="rest">
        <Panel>
          <Skeleton className="h-4 w-24 rounded-full" />
          <Skeleton shape="text" lines={3} />
        </Panel>
        <Panel>
          <Skeleton className="h-4 w-28 rounded-full" />
          <Skeleton shape="text" lines={3} />
        </Panel>
      </Column>
    </SectionGrid>
  );
}

const FOCUSABLE = 'input:not([disabled]), button:not([disabled]), [role=switch]:not([disabled]), [role=combobox], textarea:not([disabled])';

function SettingsPage() {
  const shell = useShell();
  // Sesle gezinme ("e-posta ayarlarını aç", `app_navigate`) istenen bölümü açar; sayfa açılmadan önce gelen istek de alınır.
  const [tab, setTab] = useState<TabId>(() => takeSettingsTab() ?? 'general');
  const [query, setQuery] = useState('');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [active, setActive] = useState(-1);
  const sectionsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Aramadan seçilen ayar: arama kapanınca bölümünde görünür kılınır ve denetimine odaklanılır. */
  const pending = useRef<HTMLElement | null>(null);
  const settings = shell.settings;
  const items = sections(shell.moduleEnabled('mail'), shell.moduleEnabled('briefing') || shell.moduleEnabled('news'));
  const searching = query.trim().length > 0;

  // Süzme ve vurgu: sorgu değişince ve arama sürerken içerik değişince (geç yüklenen bölüm) yeniden uygulanır.
  useLayoutEffect(() => {
    const root = sectionsRef.current;
    if (!root) return;
    if (!searching) {
      clearSearch(root);
      setResult(null);
      setActive(-1);
      return;
    }
    let frame = 0;
    const run = () => {
      frame = 0;
      const next = applySearch(root, query);
      setResult((previous) =>
        previous && previous.total === next.total && previous.hits.length === next.hits.length && previous.hits.every((hit, index) => hit === next.hits[index]) ? previous : next,
      );
    };
    run();
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(run);
    });
    observer.observe(root, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [query, searching]);

  // Sorgu değişince ilk sonuç etkin olur; klavyeyle üstünde durulan sonuç işaretlenir (klavye eylemi: hareket yok).
  useEffect(() => setActive(searching ? 0 : -1), [query, searching]);
  useEffect(() => {
    const hit = result?.hits[active] ?? null;
    hit?.setAttribute('data-st-active', '');
    return () => hit?.removeAttribute('data-st-active');
  }, [result, active]);

  // Arama kapanınca seçilen ayara gidilir.
  useEffect(() => {
    if (searching) return;
    const target = pending.current;
    pending.current = null;
    if (!target?.isConnected) return;
    target.scrollIntoView({ block: 'center' });
    const control = target.matches(FOCUSABLE) ? target : target.querySelector<HTMLElement>(FOCUSABLE);
    control?.focus({ preventScroll: true });
    target.setAttribute('data-st-active', '');
    const timer = window.setTimeout(() => target.removeAttribute('data-st-active'), 1600);
    return () => {
      window.clearTimeout(timer);
      target.removeAttribute('data-st-active');
    };
  }, [searching, tab]);

  // Ctrl+F ve "/" aramaya odaklanır (yazı alanındayken "/" yazı olarak kalır).
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable=true]');
      const find = event.ctrlKey && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f';
      if (!find && !(event.key === '/' && !typing && !event.ctrlKey && !event.altKey && !event.metaKey)) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const go = useCallback((next: TabId) => {
    setQuery('');
    setTab(next);
  }, []);
  useEffect(() => onSettingsTab(go), [go]);
  // Seçili bölüm kalktıysa (modül kapandı) Genel'e dönülür; boş sayfa kalmaz.
  const current = items.some((item) => item.id === tab) ? tab : 'general';

  const open = (hit: HTMLElement | undefined) => {
    if (!hit) return;
    const section = hit.closest('[data-st-section]')?.getAttribute('data-st-section') as TabId | null;
    pending.current = hit;
    if (section) setTab(section);
    setQuery('');
  };

  const onSearchKey = (event: KeyboardEvent<HTMLInputElement>) => {
    const hits = result?.hits ?? [];
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (!searching || hits.length === 0) return;
      event.preventDefault();
      const next = Math.min(hits.length - 1, Math.max(0, active + (event.key === 'ArrowDown' ? 1 : -1)));
      setActive(next);
      hits[next]?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      if (!searching) return;
      event.preventDefault();
      open(hits[Math.max(0, active)]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (query) setQuery('');
      else event.currentTarget.blur();
    }
  };

  const control = shell.status?.control;
  const status = !control || control.state === 'approved' ? t('settings.status.loading') : t('settings.status.local');
  const marks: Partial<Record<TabId, boolean>> = { hotkeys: shell.hotkeys.some((hotkey) => !hotkey.registered) };

  return (
    <div className="min-h-full" data-testid="settings-page" data-searching={searching ? '' : undefined}>
      <Workspace>
        <WorkspaceHeader
          title={t('nav.settings')}
          status={status}
          actions={
            <div className="st-search" role="search">
              <Input
                ref={inputRef}
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={onSearchKey}
                placeholder={t('settings.search.placeholder')}
                aria-label={t('settings.search.placeholder')}
                aria-controls="settings-sections"
                autoComplete="off"
                spellCheck={false}
                leading={<MagnifyingGlass />}
                trailing={
                  query ? (
                    <button type="button" className="st-search-clear" aria-label={t('settings.search.clear')} onClick={() => (setQuery(''), inputRef.current?.focus())} data-testid="settings-search-clear">
                      <X weight="bold" className="size-3.5!" />
                    </button>
                  ) : (
                    <KeyHint keys={['Ctrl', 'F']} size="sm" />
                  )
                }
                data-testid="settings-search"
              />
            </div>
          }
        />
        <WorkspaceGrid aside={<SectionNav items={items} value={current} onChange={go} counts={searching ? (result?.bySection ?? {}) : null} marks={marks} />} asideSide="start" asideWidth={212} asideFirstWhenStacked>
          <div className="st-body" data-searching={searching ? '' : undefined}>
            {searching && (
              <div className="st-result-head" role="status" data-testid="settings-search-status" data-count={result?.total ?? 0}>
                <span>{t('settings.search.summary', { query: query.trim(), count: result?.total ?? 0 })}</span>
                {(result?.total ?? 0) > 0 && <span>{t('settings.search.hint')}</span>}
              </div>
            )}
            <div ref={sectionsRef} id="settings-sections" className="flex min-w-0 flex-col gap-7">
              {items.map((item) => {
                const shown = searching || current === item.id;
                return (
                  <TabPanel key={item.id} tabsId={TABS_ID} value={item.id} hidden={!shown} className="outline-none" data-testid={`settings-${item.id}`} data-st-section={item.id}>
                    {searching && (
                      <h2 className="st-section-title">
                        <button type="button" onClick={() => go(item.id)} aria-label={t('settings.search.open', { section: item.label })}>
                          {item.label}
                          <ArrowRight weight="bold" aria-hidden />
                        </button>
                      </h2>
                    )}
                    {shown && (settings === null ? <SectionSkeleton /> : item.render(settings))}
                  </TabPanel>
                );
              })}
            </div>
            {searching && result?.total === 0 && (
              <Panel tone="quiet" data-testid="settings-search-empty">
                <EmptyState
                  size="sm"
                  icon={<MagnifyingGlass />}
                  title={t('settings.search.emptyTitle', { query: query.trim() })}
                  description={t('settings.search.emptyBody')}
                  actions={
                    <Button size="sm" onClick={() => (setQuery(''), inputRef.current?.focus())}>
                      {t('settings.search.clear')}
                    </Button>
                  }
                />
              </Panel>
            )}
          </div>
        </WorkspaceGrid>
      </Workspace>
    </div>
  );
}

export default definePage({
  id: 'settings',
  titleKey: 'nav.settings',
  icon: Gear,
  order: 1000,
  footer: true,
  Component: SettingsPage,
});
