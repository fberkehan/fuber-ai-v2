// Ana pencere kabuğu (KURGU §12): sol ray (logotip) · başlık şeridi (canlı çentik) · sayfa · kapılar · tek Toaster.
// Tek görünüm: yıldızlı sahne. Pencere odaktayken yüzen ada gizlenir ve durumu çentik gösterir (`hud.owner`).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MotionConfig, motion } from 'motion/react';
import { capitalizeWords } from './text';
import {
  t,
  type AppInfo,
  type AppStatus,
  type HotkeyStatus,
  type ModuleInfo,
  type Policy,
  type Settings,
  type VoiceState,
  type VoiceStatus,
} from '@fuber/shared';
import {
  AppShell,
  FuberLogo,
  NavRail,
  Starfield,
  Toaster,
  spring,
  useReducedMotion,
  type CoreState,
  type NavItem,
} from '@fuber/ui';
import { useAssistantLive } from './assistant-live';
import { pages } from '../pages/registry';
import { ShellContext, type BrainMode, type Shell } from './context';
import { KillSwitchGate, UpdateGate } from './Gates';
import { attempt, useEvent } from './live';
import { escStopsVoice, stopVoice } from './voice-stop';
import { Lifecycle } from './Lifecycle';
import { WindowNotch } from './LiveLine';
import { parsePluginPageRoute } from '../../../main/modules/workshop/types';
import { PluginIcon } from '../plugins/PluginIcon';
import { PluginPageHost } from '../plugins/PluginPageHost';
import { usePluginPages } from '../plugins/usePluginPages';
import { PageBoundary } from './PageBoundary';
import { QuickControls } from './QuickControls';
import { Splash } from './Splash';
import { StatusBar } from './StatusBar';

const RAIL_KEY = 'fuber.rail.collapsed';

const coreOf = (voice: VoiceStatus | null): CoreState => {
  if (!voice) return 'idle';
  const map: Record<VoiceState, CoreState> = {
    idle: 'idle',
    listening: 'listening',
    followup: 'listening',
    thinking: 'thinking',
    speaking: 'speaking',
    mic_off: 'muted',
  };
  return map[voice.state];
};

const readCollapsed = () => {
  try {
    return localStorage.getItem(RAIL_KEY) === '1';
  } catch {
    return false;
  }
};

export function App() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [voice, setVoice] = useState<VoiceStatus | null>(null);
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [modules, setModules] = useState<ModuleInfo[] | null>(null);
  const [hotkeys, setHotkeys] = useState<HotkeyStatus[]>([]);
  const [page, setPage] = useState('today');
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const level = useRef(0);
  const reduce = useReducedMotion();
  const [notchWide, setNotchWide] = useState(false);
  const live = useAssistantLive(voice);
  // Adanın sahibi: ana pencere odaktayken `main` (durum çentikte), değilse `island` (yüzen ada).
  const [hudOwner, setHudOwner] = useState<'main' | 'island'>('island');
  useEvent('hud.owner', ({ owner }) => setHudOwner(owner));

  const refreshStatus = useCallback(() => {
    void window.fuber.invoke('app.status').then(
      (next) => {
        setStatus(next);
        setVoice(next.voice);
        setHotkeys(next.hotkeys);
      },
      () => {},
    );
  }, []);
  const refreshPolicy = useCallback(() => void window.fuber.invoke('settings.policy').then(setPolicy, () => {}), []);
  const refreshModules = useCallback(() => void window.fuber.invoke('modules.list').then(setModules, () => setModules([])), []);

  useEffect(() => {
    void window.fuber.invoke('app.info').then(setInfo, () => {});
    void window.fuber.invoke('settings.get').then(setSettings, () => {});
    refreshStatus();
    refreshPolicy();
    refreshModules();
  }, [refreshStatus, refreshPolicy, refreshModules]);

  useEvent('voice.state', ({ state }) => setVoice((current) => (current ? { ...current, state } : current)));
  useEvent('voice.status', (next) => setVoice(next));
  useEvent('voice.level', ({ source, rms }) => {
    const state = voice?.state;
    // Dinlerken mikrofon, konuşurken hoparlör; Öz yalnız o anki kaynağa tepki verir.
    if ((source === 'mic' && state !== 'speaking') || (source === 'speaker' && state === 'speaking')) level.current = rms;
  });
  useEvent('policy.changed', () => {
    refreshPolicy();
    refreshStatus();
  });
  useEvent('control.status', (control) => setStatus((current) => (current ? { ...current, control } : current)));
  useEvent('settings.changed', ({ settings: next }) => {
    setSettings(next);
    refreshStatus();
  });
  useEvent('module.changed', () => refreshModules());
  // Beyin nerede çalışıyor: tek kaynak ana süreçtir (`app.status.brain` + `brain.status` olayı).
  useEvent('brain.status', (brain) => setStatus((current) => (current ? { ...current, brain } : current)));
  useEvent('usage.recorded', ({ today }) => {
    setStatus((current) =>
      current ? { ...current, budget: { spentUsd: today.costUsd, limitUsd: today.budgetUsd, over: today.overBudget } } : current,
    );
  });
  useEvent('app.navigate', ({ page: next }) => setPage(next));
  // JARVIS MODE rayda görünmez; yalnız sesle açılır (`jarvis_mode` aracı). Kapanışı sayfanın kendisi yönetir (çıkış animasyonu).
  useEvent('jarvis.mode', ({ on }) => {
    if (on) setPage('jarvis');
  });

  const moduleEnabled = useCallback(
    (id: string) => (modules === null ? true : modules.some((module) => module.id === id && module.enabled)),
    [modules],
  );

  const visible = useMemo(
    () => pages.filter((def) => !def.moduleId || (modules !== null && moduleEnabled(def.moduleId))),
    [modules, moduleEnabled],
  );
  const main = visible.filter((def) => !def.footer && !def.hidden);
  const footer = visible.filter((def) => def.footer && !def.hidden);
  const ordered = [...main, ...footer];
  const current = visible.find((def) => def.id === page) ?? ordered[0];

  const navigate = useCallback((next: string) => setPage(next), []);

  // Eklenti sayfaları: etkin eklentilerin yan menü öğeleri (Atölye modülü kapalıyken görünmez). Gezinme kimliği
  // `plugin:<eklenti>:<sayfa>`; yerleşik sayfaların ardından, Ayarlar'dan önce dizilir ve Ctrl+N sırasına girmez.
  const pluginPages = usePluginPages(modules !== null && moduleEnabled('workshop'));
  const pluginRoute = parsePluginPageRoute(page);
  const pluginPage = pluginRoute ? pluginPages.find((entry) => entry.skillId === pluginRoute.skillId && entry.pageId === pluginRoute.pageId) : undefined;
  const pluginIndex = pluginPage ? pluginPages.indexOf(pluginPage) : -1;
  // Açık eklenti sayfası kalktıysa (eklenti kapandı, kaldırıldı) Bugün'e dönülür. Yeni etkinleşen sayfaya gidilirken
  // liste henüz gelmemiş olabilir: karar için listeyi bir kez daha okuruz.
  useEffect(() => {
    if (!pluginRoute || pluginPage) return;
    let alive = true;
    void window.fuber.invoke('plugins.pages').then(
      (list) => {
        if (alive && !list.some((entry) => entry.skillId === pluginRoute.skillId && entry.pageId === pluginRoute.pageId)) setPage('today');
      },
      () => alive && setPage('today'),
    );
    return () => {
      alive = false;
    };
  }, [pluginRoute?.skillId, pluginRoute?.pageId, pluginPage]);

  // Sayfa geçişi ray sırasına göre yön alır: aşağıdaki sayfaya geçerken içerik aşağıdan, yukarıdakine geçerken yukarıdan.
  const pageIndex = pluginPage ? main.length + pluginIndex : Math.max(0, ordered.findIndex((def) => def.id === current?.id));
  const previousIndex = useRef(pageIndex);
  const direction = pageIndex >= previousIndex.current ? 1 : -1;
  // Klavyeyle (Ctrl+rakam) gelinen sayfa canlandırılmaz: sık yinelenen klavye eylemi beklemesiz olmalı.
  const viaKey = useRef(false);
  const instant = viaKey.current;
  useEffect(() => {
    previousIndex.current = pageIndex;
    viaKey.current = false;
  }, [pageIndex]);

  // Ctrl+1…9 ve Ctrl+0 (onuncu): sayfalar ray sırasıyla. Klavye eylemi: sayfa geçişi canlandırılmaz (`viaKey`).
  // demo.3'te ray on sayfaya çıktı (Toplantı, İşler): sekizle sınırlı kısayol Yetenekler ve Ayarlar'a ulaşamıyordu.
  const orderedIds = ordered.map((def) => def.id).join(',');
  useEffect(() => {
    const ids = orderedIds.split(',');
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.shiftKey || event.metaKey) return;
      if (!/^[0-9]$/.test(event.key)) return;
      const index = event.key === '0' ? 9 : Number(event.key) - 1;
      const id = ids[index];
      if (!id) return;
      event.preventDefault();
      viaKey.current = true;
      setPage(id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [orderedIds]);

  // Esc (demo.5): açık çekmece / iletişim kutusu yoksa ve asistan konuşuyor ya da çalışıyorsa susturur. Kabarcık
  // evresinde dinlenir: çekmecenin ve kutuların kendi Esc dinleyicileri önce çalışır.
  const voiceState = voice?.state ?? null;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!escStopsVoice(event, voiceState)) return;
      event.preventDefault();
      stopVoice();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [voiceState]);

  const name = policy?.persona.name ?? 'Jarvis';
  const address = settings?.userAddress?.trim() || policy?.persona.address || '';
  const wakePhrase = capitalizeWords(policy?.persona.wakePhrases[0] ?? `hey ${name}`);
  const brainStatus = status?.brain ?? null;
  const brain: BrainMode = brainStatus?.provider ?? 'cloud';
  const core = coreOf(voice);

  const shell: Shell = {
    navigate,
    page: pluginPage ? page : (current?.id ?? 'today'),
    info,
    status,
    voice,
    core,
    presence: live.presence,
    live,
    hudOwner,
    level,
    policy,
    settings,
    modules,
    hotkeys,
    brain,
    brainStatus,
    name,
    address,
    wakePhrase,
    moduleEnabled,
  };

  const toItem = (def: (typeof pages)[number]): NavItem => {
    const Icon = def.icon;
    const index = ordered.indexOf(def);
    return {
      value: def.id,
      label: t(def.titleKey),
      icon: <Icon />,
      activeIcon: <Icon weight="fill" />,
      // Ctrl+1…9, onuncu Ctrl+0: ray sırasıyla; üstüne gelince satırın sağında görünür.
      shortcut: index >= 0 && index < 10 ? ['Ctrl', String((index + 1) % 10)] : undefined,
    };
  };

  const pluginItems: NavItem[] = pluginPages.map((entry) => {
    const route = `plugin:${entry.skillId}:${entry.pageId}`;
    const mark = (weight?: 'fill') => (
      <span className="flex" data-testid={`plugin-nav-${entry.skillId}-${entry.pageId}`}>
        <PluginIcon name={entry.icon} weight={weight} />
      </span>
    );
    return { value: route, label: entry.title, icon: mark(), activeIcon: mark('fill') };
  });

  const gate = status?.killSwitch.active ? 'kill' : status?.updateRequired ? 'update' : null;
  const Page = current?.Component;

  const reducedMotion = settings?.reducedMotion === 'on' ? 'always' : settings?.reducedMotion === 'off' ? 'never' : 'user';

  return (
    <MotionConfig reducedMotion={reducedMotion}>
    <ShellContext.Provider value={shell}>
      {/* Duman sınaması bu düğümü okur (scripts/e2e/smoke.mjs); görünmez ama çizilir (mono yazı tipi açılışta yüklensin). */}
      <pre aria-hidden className="sr-only" data-testid="app-info">
        {info ? JSON.stringify(info, null, 2) : ''}
      </pre>
      {gate === 'kill' ? (
        <KillSwitchGate name={name} message={status?.killSwitch.message ?? null} />
      ) : gate === 'update' ? (
        <UpdateGate policy={policy} />
      ) : (
        <AppShell
          data-testid="shell"
          data-page={pluginPage ? page : current?.id}
          data-hud-owner={hudOwner}
          frameless
          backdrop={<Starfield shift={pageIndex} />}
          notch={<WindowNotch owner={hudOwner} onWide={setNotchWide} onActivate={() => void attempt(() => window.fuber.invoke('voice.listen'))} />}
          rail={
            <NavRail
              items={[...main.map(toItem), ...pluginItems]}
              footerItems={footer.map(toItem)}
              // d10: mikrofon, dinlemeyi duraklat, sessiz kip, ortam dinleme, sustur ve dinleme süresi: Ayarlar'a girmeden.
              extra={<QuickControls collapsed={collapsed} />}
              value={pluginPage ? page : (current?.id ?? 'today')}
              onChange={navigate}
              collapsed={collapsed}
              onCollapsedChange={(next) => {
                setCollapsed(next);
                try {
                  localStorage.setItem(RAIL_KEY, next ? '1' : '0');
                } catch {
                  // Tercih saklanamazsa yalnız bu oturumda geçerli kalır.
                }
              }}
              draggableHeader
              // Logotip: FUBER yazısı + yıldız işareti; asistanın adı küçük ikincil satırdadır. Daraltılınca yalnız işaret.
              header={<FuberLogo product={t('nav.brandProduct')} caption={name} collapsed={collapsed} />}
              aria-label={t('nav.label')}
              collapseLabel={t('nav.collapse')}
              expandLabel={t('nav.expand')}
            />
          }
          topbar={<StatusBar compact={notchWide} dimLeft={notchWide} />}
        >
          {pluginPage ? (
            <motion.div
              key={page}
              initial={reduce ? { opacity: 0 } : { opacity: 0, transform: `translateY(${direction * 12}px)` }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0px)' }}
              transition={reduce ? { duration: 0.18 } : spring.smooth}
              className="h-full"
              data-testid="page-plugin"
              data-plugin-route={page}
            >
              <PageBoundary page={page}>
                <PluginPageHost key={page} skillId={pluginPage.skillId} pageId={pluginPage.pageId} />
              </PageBoundary>
            </motion.div>
          ) : (
            Page && (
            <motion.div
              key={current.id}
              initial={instant ? false : reduce ? { opacity: 0 } : { opacity: 0, transform: `translateY(${direction * 12}px)` }}
              animate={reduce ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0px)' }}
              transition={reduce ? { duration: 0.18 } : spring.smooth}
              className="h-full"
              data-testid={`page-${current.id}`}
            >
              <PageBoundary page={current.id}>
                <Page />
              </PageBoundary>
            </motion.div>
            )
          )}
        </AppShell>
      )}
      <Toaster label={t('nav.toasts')} closeLabel={t('common.close')} />
      {/* Kapanış diyaloğu, veda, açılış çanı, tekrar hoş geldiniz ve yenilikler. */}
      <Lifecycle />
      {/* Açılış örtüsü: süreç başına bir kez. Sınama kipinde oynamaz (görüntüler ve tıklamalar beklemesin). */}
      {info ? <Splash enabled={!info.testMode || new URLSearchParams(window.location.search).has('splash')} /> : null}
    </ShellContext.Provider>
    </MotionConfig>
  );
}
