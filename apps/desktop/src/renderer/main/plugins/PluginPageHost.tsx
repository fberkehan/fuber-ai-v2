// Eklenti sayfası: yan menüden açılan, güvenli kutuda çalışan mini uygulama.
//
// Güvenlik düzeni (HUD'daki `MiniApp.tsx` ile aynı): çerçeve `sandbox="allow-scripts"` (allow-same-origin YOK), köken
// opaktır; üst pencereye, `window.fuber`'a ve depolamaya erişemez. Çerçeve `src` ile KOŞUCU belgeyi (`sandbox-runner.html`)
// yükler; koşucu hazır olunca üst pencereye `{ fuberStage: 'ready' }` yollar, biz de `plugins.page`'in döndürdüğü tam
// belgeyi `postMessage({ html })` ile veririz. (srcdoc/blob/data çerçeveleri üst sayfanın politikasını devralıp satır içi
// betiği engeller; koşucunun kendi politikası vardır.) Sayfanın `window.fuber` köprüsü `{ fuberPlugin: 1, id, op, ... }`
// iletileri yollar; yalnız bu çerçeveden gelenler kabul edilir, hız sınırlıdır ve yanıt aynı `id` ile döner.
import { ArrowClockwise, GearSix, LockSimple, PuzzlePiece } from '@phosphor-icons/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { t } from '@fuber/shared';
import { Button, Dialog, IconButton, Skeleton } from '@fuber/ui';
import runnerUrl from '../../hud/sandbox-runner.html?url';
import { pluginPageRoute } from '../../../main/modules/workshop/types';
import { useShell } from '../shell/context';
import { useLive } from '../shell/live';
import { ErrorPanel } from '../shell/parts';
import { answerFrameRequest, createRateLimiter, frameError, isFrameRequest, type FrameBackend } from './frame-protocol';
import { PluginSettings } from './PluginSettings';
import { focusSkill } from './skill-focus';
import './plugins.css';

/** Koşucu belge bu sürede "hazır" demezse kutu yüklenemedi sayılır. */
const READY_TIMEOUT_MS = 6000;

const backend: FrameBackend = {
  pageCall: (req) => window.fuber.invoke('plugins.pageCall', req),
  pageStorage: (req) => window.fuber.invoke('plugins.pageStorage', req),
  settings: (req) => window.fuber.invoke('plugins.settings', req),
};

interface PageDoc {
  title: string;
  skillName: string;
  html: string;
}

/** Güvenli kutu çerçevesi + köprü. `html` değişince çerçeve baştan kurulur (`key`). */
function SandboxFrame({ skillId, pageId, title, html, onLoaded, onFailed }: { skillId: string; pageId: string; title: string; html: string; onLoaded(): void; onFailed(): void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const callbacks = useRef({ onLoaded, onFailed });
  callbacks.current = { onLoaded, onFailed };

  useEffect(() => {
    let delivered = false;
    const limit = createRateLimiter();
    const timer = setTimeout(() => {
      if (!delivered) callbacks.current.onFailed();
    }, READY_TIMEOUT_MS);

    const onMessage = (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      // Yalnız BU çerçeveden gelen iletiler (köken opak "null" olduğundan kaynak pencere denetlenir).
      if (!target || event.source !== target) return;
      const data: unknown = event.data;

      if (typeof data === 'object' && data !== null && (data as { fuberStage?: unknown }).fuberStage === 'ready') {
        if (delivered) return;
        delivered = true;
        clearTimeout(timer);
        target.postMessage({ html }, '*');
        requestAnimationFrame(() => callbacks.current.onLoaded());
        return;
      }

      const id = typeof data === 'object' && data !== null ? (data as { id?: unknown; fuberPlugin?: unknown }) : null;
      if (!id || id.fuberPlugin !== 1 || typeof id.id !== 'number') return;
      if (!isFrameRequest(data)) {
        target.postMessage(frameError(id.id, t('pluginsUi.frame.invalid')), '*');
        return;
      }
      if (!limit()) {
        target.postMessage(frameError(data.id, t('pluginsUi.frame.rateLimited')), '*');
        return;
      }
      void answerFrameRequest(skillId, pageId, data, backend).then((reply) => {
        // Çerçeve bu arada yenilendiyse (başka pencere) eski yanıt yeni belgeye verilmez.
        if (frame.current?.contentWindow === target) target.postMessage(reply, '*');
      });
    };
    window.addEventListener('message', onMessage);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
    };
  }, [skillId, pageId, html]);

  return (
    <iframe
      ref={frame}
      title={title}
      src={runnerUrl}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      allow=""
      className="plg-frame"
      data-testid="plugin-frame"
    />
  );
}

export function PluginPageHost({ skillId, pageId }: { skillId: string; pageId: string }) {
  const { navigate } = useShell();
  const [nonce, setNonce] = useState(0);
  const [frameState, setFrameState] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [hasSettings, setHasSettings] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const htmlRef = useRef<string | null>(null);
  htmlRef.current = html;

  const { state, reload, data } = useLive<PageDoc>(() => window.fuber.invoke('plugins.page', { skillId, pageId }), [], [skillId, pageId, nonce]);

  // Belge ilk gelişte alınır; eklenti güncellenince (`skills.changed`) içerik gerçekten değiştiyse çerçeve yenilenir.
  useEffect(() => {
    if (data && htmlRef.current === null) setHtml(data.html);
  }, [data]);
  useEffect(() => {
    setHtml(null);
    setFrameState('loading');
  }, [skillId, pageId, nonce]);
  useEffect(() => {
    let alive = true;
    const off = window.fuber.on('skills.changed', () => {
      window.fuber.invoke('plugins.page', { skillId, pageId }).then(
        (next) => {
          if (!alive || htmlRef.current === null || htmlRef.current === next.html) return;
          setHtml(next.html);
          setRev((n) => n + 1);
          setFrameState('loading');
        },
        () => {},
      );
    });
    return () => {
      alive = false;
      off();
    };
  }, [skillId, pageId]);

  // Ayarı olan eklentide başlıkta ayar düğmesi görünür.
  useEffect(() => {
    let alive = true;
    const read = () =>
      window.fuber.invoke('plugins.settings', { skillId }).then(
        (list) => alive && setHasSettings(Array.isArray(list) && list.length > 0),
        () => {},
      );
    void read();
    const off = window.fuber.on('plugins.changed', () => void read());
    return () => {
      alive = false;
      off();
    };
  }, [skillId]);

  const refresh = useCallback(() => {
    setNonce((n) => n + 1);
  }, []);

  const title = data?.title ?? '';
  const skillName = data?.skillName ?? '';
  const failed = state.status === 'error' ? state.message : frameState === 'failed' ? t('pluginsUi.page.frameFailed') : null;

  return (
    <div className="plg-host" data-testid="plugin-page" data-skill={skillId} data-page={pageId} data-route={pluginPageRoute(skillId, pageId)}>
      <header className="plg-head" data-testid="plugin-page-header">
        <span className="plg-head-icon" aria-hidden>
          <PuzzlePiece weight="fill" />
        </span>
        <div className="plg-head-text">
          <h1 className="plg-head-title">{title || <Skeleton className="h-5 w-40" />}</h1>
          {skillName && <p className="plg-head-sub">{skillName}</p>}
        </div>
        <p className="plg-head-safe" title={t('pluginsUi.page.sandboxHint')} data-testid="plugin-page-sandbox">
          <LockSimple weight="fill" aria-hidden />
          {t('pluginsUi.page.sandbox')}
        </p>
        <div className="plg-head-actions">
          <IconButton icon={<ArrowClockwise />} label={t('pluginsUi.page.refresh')} size="sm" variant="ghost" onClick={refresh} data-testid="plugin-page-refresh" />
          {hasSettings && (
            <IconButton icon={<GearSix />} label={t('pluginsUi.page.settings')} size="sm" variant="ghost" onClick={() => setSettingsOpen(true)} data-testid="plugin-page-settings" />
          )}
          <Button size="sm" variant="secondary" onClick={() => {
              focusSkill(skillId);
              navigate('skills');
            }} data-testid="plugin-page-detail" data-skill={skillId}>
            {t('pluginsUi.page.detail')}
          </Button>
        </div>
      </header>

      <div className="plg-stage">
        {failed ? (
          <ErrorPanel title={t('pluginsUi.page.errorTitle')} message={failed} onRetry={refresh} />
        ) : (
          <>
            {html !== null && <SandboxFrame key={`${nonce}:${rev}:${skillId}:${pageId}`} skillId={skillId} pageId={pageId} title={title || skillName} html={html} onLoaded={() => setFrameState('ready')} onFailed={() => setFrameState('failed')} />}
            {frameState === 'loading' && (
              <div className="plg-skeleton" aria-busy aria-label={t('common.loading')}>
                <Skeleton className="h-7 w-56" />
                <Skeleton shape="text" lines={3} />
                <Skeleton className="h-40 w-full" />
              </div>
            )}
          </>
        )}
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen} title={t('pluginsUi.settings.dialogTitle', { name: skillName })} size="md" closeLabel={t('common.close')}>
        <PluginSettings skillId={skillId} />
      </Dialog>
    </div>
  );
}

