import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, type Variants } from 'motion/react';
import { Brain, House, Microphone, ShieldCheck, SquaresFour } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { AppShell, FuberLogo, NavRail, Toaster, fade, spring, useReducedMotion, type NavItem } from '@fuber/ui';
import { ServiceDown } from '../components/layout';
import { PageBoundary } from '../components/PageBoundary';
import { SaveBar } from './SaveBar';
import { BrainPage } from '../pages/BrainPage';
import { ModulesPage } from '../pages/ModulesPage';
import { OverviewPage } from '../pages/OverviewPage';
import { SecurityPage } from '../pages/SecurityPage';
import { VoicePage } from '../pages/VoicePage';
import type { PageId, PageProps } from '../pages/types';
import { useLive } from './live-store';
import { usePolicy } from './policy-store';
import { StatusStrip } from './StatusStrip';

const PAGES: Record<PageId, (props: PageProps) => React.JSX.Element> = {
  overview: OverviewPage,
  brain: BrainPage,
  voice: VoicePage,
  modules: ModulesPage,
  security: SecurityPage,
};
const ORDER: PageId[] = ['overview', 'brain', 'voice', 'modules', 'security'];

/** Kayma payı (px): menüde aşağı gidilince yeni ekran aşağıdan, yukarı gidilince yukarıdan gelir. */
const SHIFT = 24;

/**
 * Yönlü sayfa geçişi (v1 Yönetim): yön, menü sırasındaki ilerleyişten. Klavyeyle geçişte (Ctrl+1…5) ve azaltılmış
 * harekette kayma yoktur, yalnız saydamlık değişir. Çıkış girişten kısadır.
 */
function pageVariants(reduced: boolean): Variants {
  return {
    initial: (dir: number) => (reduced || dir === 0 ? { opacity: 0 } : { opacity: 0, transform: `translateY(${dir * SHIFT}px)` }),
    animate: { opacity: 1, transform: 'translateY(0px)', transition: reduced ? fade : spring.smooth },
    exit: (dir: number) =>
      reduced || dir === 0 ? { opacity: 0, transition: { duration: 0.1 } } : { opacity: 0, transform: `translateY(${-dir * (SHIFT / 2)}px)`, transition: { duration: 0.12, ease: [0.23, 1, 0.32, 1] } },
  };
}

export function App() {
  const [page, setPageState] = useState<PageId>('overview');
  const [direction, setDirection] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [anchor, setAnchor] = useState<{ id: string; seq: number } | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  const policy = usePolicy();
  const { service, devices } = useLive();
  const reduced = useReducedMotion() ?? false;
  const [restarting, setRestarting] = useState(false);

  const pageRef = useRef(page);
  pageRef.current = page;
  /** `keyboard`: kısayolla geçiş; yönsüz (klavye eylemi canlandırılmaz). */
  const setPage = useCallback((next: PageId, keyboard = false) => {
    const from = ORDER.indexOf(pageRef.current);
    const to = ORDER.indexOf(next);
    setDirection(keyboard ? 0 : Math.sign(to - from));
    setPageState(next);
  }, []);

  const go = useCallback(
    (next: PageId, target?: string) => {
      setPage(next);
      if (target) setAnchor({ id: target, seq: Date.now() });
    },
    [setPage],
  );

  // Sayfa değişince içerik başa döner; çapa verilmişse yeni sayfa çizildikten sonra oraya kayılır.
  useEffect(() => {
    contentRef.current?.closest('main')?.scrollTo({ top: 0 });
  }, [page]);
  useEffect(() => {
    if (!anchor) return;
    const timer = window.setTimeout(() => document.getElementById(anchor.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 360);
    return () => window.clearTimeout(timer);
  }, [anchor]);

  // Ctrl+S kaydeder, Ctrl+1…5 ekran değiştirir (menü sırasıyla; Genel bakış 1).
  const save = policy.save;
  const canSave = policy.paths.length > 0 && Object.keys(policy.invalid).length === 0;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (canSave) void save();
      } else if (/^[1-5]$/.test(event.key)) {
        event.preventDefault();
        setPage(ORDER[Number(event.key) - 1] ?? 'overview', true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save, canSave, setPage]);

  const pending = (devices.data ?? []).filter((d) => d.status === 'pending').length;
  const items: NavItem<PageId>[] = [
    { value: 'overview', label: t('admin.nav.overview'), icon: <House />, activeIcon: <House weight="fill" /> },
    { value: 'brain', label: t('admin.nav.brain'), icon: <Brain />, activeIcon: <Brain weight="fill" /> },
    { value: 'voice', label: t('admin.nav.voice'), icon: <Microphone />, activeIcon: <Microphone weight="fill" /> },
    { value: 'modules', label: t('admin.nav.modules'), icon: <SquaresFour />, activeIcon: <SquaresFour weight="fill" /> },
    { value: 'security', label: t('admin.nav.security'), icon: <ShieldCheck />, activeIcon: <ShieldCheck weight="fill" />, badge: pending },
  ];

  const Current = PAGES[page];
  const down = !policy.base && !!policy.error;

  return (
    <>
      <AppShell
        rail={
          <NavRail
            items={items}
            value={page}
            onChange={(next) => setPage(next)}
            collapsed={collapsed}
            onCollapsedChange={setCollapsed}
            header={<FuberLogo product={t('admin.app.brandProduct')} collapsed={collapsed} />}
            aria-label={t('admin.nav.label')}
            collapseLabel={t('admin.nav.collapse')}
            expandLabel={t('admin.nav.expand')}
          />
        }
        topbar={<StatusStrip go={go} />}
      >
        <div ref={contentRef} className="flex min-h-full flex-col" data-testid="content" data-page={page}>
          {down ? (
            <ServiceDown
              message={policy.error ?? ''}
              restarting={restarting}
              onRetry={() => void policy.reload()}
              onRestart={async () => {
                setRestarting(true);
                try {
                  service.setData(await window.fuber.invoke('service.restart'));
                  await policy.reload();
                } catch {
                  // Hata metni ServiceDown'da kalır; yeniden deneme düğmesi açık.
                } finally {
                  setRestarting(false);
                }
              }}
            />
          ) : (
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              <motion.div key={page} custom={direction} variants={pageVariants(reduced)} initial="initial" animate="animate" exit="exit" className="flex-1">
                <PageBoundary page={page}>
                  <CrashProbe page={page} />
                  <Current go={go} />
                </PageBoundary>
              </motion.div>
            </AnimatePresence>
          )}
          <SaveBar />
        </div>
      </AppShell>
      <Toaster label={t('admin.app.notifications')} closeLabel={t('common.close')} />
      <AppInfoProbe />
    </>
  );
}

/**
 * Uçtan uca sınamanın hata sınırını denemesi için: `window.__fuberCrashPage = 'modules'` verilirse o ekran
 * çizilirken hata fırlatır (`apps/admin/e2e/ui.e2e.mjs`). Değişken yokken hiçbir şey yapmaz.
 */
function CrashProbe({ page }: { page: PageId }) {
  if ((window as { __fuberCrashPage?: string }).__fuberCrashPage === page) {
    throw new Error(`Sınama: ${page} ekranı bilerek düşürüldü`);
  }
  return null;
}

/**
 * Duman sınamaları (`scripts/e2e/smoke.mjs`, `packaged-smoke.mjs`) köprünün çalıştığını bu öğedeki
 * `app.info` JSON'undan okur. Görünmez ve ekran okuyucudan gizlidir.
 */
function AppInfoProbe() {
  const [info, setInfo] = useState('');
  useEffect(() => {
    window.fuber.invoke('app.info').then(
      (value) => setInfo(JSON.stringify(value, null, 2)),
      () => {},
    );
  }, []);
  return (
    <pre aria-hidden className="sr-only" data-testid="app-info">
      {info}
    </pre>
  );
}
