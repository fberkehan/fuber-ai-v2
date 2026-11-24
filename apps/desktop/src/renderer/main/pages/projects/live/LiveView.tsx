// Canlı oturum görünümü (v1 Claude Code penceresinin orta ve sağ sütunu): başlık (durum, durdur, kapat/unut, terminal), döküm,
// bekleyen izin kartları, yazma kutusu (kip/model/efor seçimiyle) ve sağda denetçi.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useMemo } from 'react';
import { t } from '@fuber/shared';
import { Badge, Button, EmptyState, IconButton, Menu, Skeleton, toast } from '@fuber/ui';
import { ArrowLeft, ArrowsSplit, ChatsCircle, DotsThree, FolderOpen, GearSix, Plus, Robot, SidebarSimple, TerminalWindow, Trash, WarningCircle, X } from '@phosphor-icons/react';
import type { EffortLevel, LiveImage, LiveOpResult, LivePermissionAnswer, LiveSessionSummary, PermissionMode } from '../../../../../main/modules/projects/claude/types';
import { errorText, fuber } from '../shared';
import { clearDraft, Composer } from './Composer';
import { effortOptions, modeOptions, modelOptions, PickSelect } from './controls';
import { formatClock, isBusy } from './format';
import { useHistory } from './History';
import { Inspector } from './Inspector';
import { StatusBadge } from './LiveList';
import { PermissionCard } from './PermissionCard';
import { liveStore, useLiveEnvironment, useLoadedSession } from './store';
import { Transcript } from './Transcript';

/** Ayrıntı alanı bundan darsa denetçi kapalı başlar. */
const INSPECTOR_MIN_WIDTH = 1100;

/** İşlem sonucu başarısızsa ana süreçten gelen hazır Türkçe iletiyi gösterir. */
async function run(action: () => Promise<LiveOpResult>): Promise<LiveOpResult> {
  try {
    const result = await action();
    if (!result.ok && result.error) toast.error(result.error);
    // Bir sonraki turda geçerli olacak değişiklik (ör. canlıda uygulanamayan efor) bilgi olarak söylenir.
    else if (result.ok && result.code === 'next_turn') toast.info(result.error ?? t('projects.live.nextTurn'));
    return result;
  } catch (cause) {
    const error = errorText(cause);
    toast.error(error);
    return { ok: false, error };
  }
}

/**
 * Ana sürece hangi oturumun ŞU AN ekranda olduğunu bildirir (pencere odakta ve görünürken): izlenen oturumun "bitti"
 * bildirimi adada/sesle verilmez. Odak ya da görünürlük kaybında ve görünüm kapanınca `null` yollanır.
 */
function useWatch(id: string, active: boolean): void {
  useEffect(() => {
    let last: string | null | undefined;
    const report = () => {
      const watching = active && document.visibilityState === 'visible' && document.hasFocus() ? id : null;
      if (watching === last) return;
      last = watching;
      void fuber().invoke('projects.claudeWatch', { id: watching }).catch(() => {});
    };
    report();
    window.addEventListener('focus', report);
    window.addEventListener('blur', report);
    document.addEventListener('visibilitychange', report);
    return () => {
      window.removeEventListener('focus', report);
      window.removeEventListener('blur', report);
      document.removeEventListener('visibilitychange', report);
      if (last) void fuber().invoke('projects.claudeWatch', { id: null }).catch(() => {});
    };
  }, [id, active]);
}

export function LiveView({
  summary,
  active,
  onForgotten,
  onOpen,
  onBack,
  standalone,
  historyOpen = false,
}: {
  summary: LiveSessionSummary;
  active: boolean;
  onForgotten(): void;
  /** "Önceki konuşma" bölümü açık gelsin (oturum geçmiş ön izlemesinden sürdürüldü). */
  historyOpen?: boolean;
  /** Bu görünümden başka bir canlı oturum açıldı (çatal): sayfa onu seçer. */
  onOpen?(id: string): void;
  /** Dar kapta canlı oturum listesi gizlenir; bu düğme oturumlara döndürür. */
  onBack?(): void;
  /** Liste sütunu yokken (tek canlı oturum): dönüş düğmesi hep görünür, "yeni oturum" ve ayarlar başlığa taşınır. */
  standalone?: { onNew(): void; onSettings(): void };
}) {
  const id = summary.id;
  const loaded = useLoadedSession(id);
  const environment = useLiveEnvironment();
  // Denetçi: geniş alanda açık, dar alanda (ayrıntı alanı < 1100 px) kapalı başlar; kullanıcı seçince seçimi geçerli olur.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [wide, setWide] = useState(false);
  const [inspectorChoice, setInspectorChoice] = useState<boolean | null>(null);
  const inspector = inspectorChoice ?? wide;
  useLayoutEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const measure = () => setWide(element.clientWidth >= INSPECTOR_MIN_WIDTH);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [opening, setOpening] = useState(false);
  useWatch(id, active);
  const history = useHistory(summary.sessionId, summary.createdAt, historyOpen);

  // Yüklenene dek özet gösterilir; yüklendikten sonra ayrıntı özetle birlikte güncel kalır.
  const detail = loaded?.detail ?? null;
  const session: LiveSessionSummary = detail ?? summary;
  const busy = isBusy(session.status);
  const fullAccess = environment?.config.fullAccess ?? false;

  const send = useCallback((text: string, images: LiveImage[]) => fuber().invoke('projects.claudeSend', { id, text, ...(images.length ? { images } : {}) }), [id]);
  const stop = useCallback(() => void run(() => fuber().invoke('projects.claudeInterrupt', { id })), [id]);
  const searchFiles = useCallback((query: string) => fuber().invoke('projects.claudeFiles', { id, query }).then((result) => result.files), [id]);
  const answer = useCallback(
    (requestId: string) => (payload: LivePermissionAnswer) => fuber().invoke('projects.claudePermission', { id, requestId, answer: payload }),
    [id],
  );
  const removeQueued = useCallback(
    (messageId: string) =>
      void run(() => fuber().invoke('projects.claudeRemoveQueued', { id, messageId })).then(() => liveStore.refreshMeta(id)),
    [id],
  );

  // Esc: yazma kutusu dışındayken de süren turu durdurur (açık bir diyalog ya da öneri listesi yoksa).
  useEffect(() => {
    if (!active || !busy) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('[role="dialog"],[role="alertdialog"],[role="listbox"],textarea,input,select')) return;
      stop();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, busy, stop]);

  const openInTerminal = async () => {
    if (!session.sessionId) return;
    setOpening(true);
    try {
      const result = await fuber().invoke('projects.openSession', { id: session.sessionId });
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    } catch (cause) {
      toast.error(errorText(cause));
    } finally {
      setOpening(false);
    }
  };

  const openFolder = async () => {
    if (!session.projectId) return;
    try {
      const result = await fuber().invoke('projects.open', { id: session.projectId, target: 'explorer' });
      if (!result.ok) toast.error(result.message);
    } catch (cause) {
      toast.error(errorText(cause));
    }
  };

  /** Çatalla: oturumun kopyası yeni bir kimlikle sürer; asıl oturuma dokunulmaz. */
  const fork = async () => {
    if (!session.sessionId) return;
    try {
      const result = await fuber().invoke('projects.claudeStart', { resume: session.sessionId, cwd: session.cwd, fork: true });
      if (result.ok && result.session) {
        liveStore.upsert(result.session);
        onOpen?.(result.session.id);
      } else if (result.error) toast.error(result.error);
    } catch (cause) {
      toast.error(errorText(cause));
    }
  };

  const close = () => void run(() => fuber().invoke('projects.claudeClose', { id }));
  const forget = () =>
    void run(() => fuber().invoke('projects.claudeForget', { id })).then((result) => {
      if (!result.ok) return;
      clearDraft(id);
      liveStore.unload(id);
      onForgotten();
    });

  const items = loaded ? loaded.model.list() : [];
  const permissions = detail?.permissions ?? [];
  const waitingKey = permissions.map((request) => request.toolUseId ?? '').join(' ');
  const waitingTools = useMemo(() => new Set(waitingKey.split(' ').filter(Boolean)), [waitingKey]);

  const inspectorShown = inspector && detail !== null;

  return (
    <div
      ref={rootRef}
      data-testid="live-view"
      data-session={id}
      data-cli-session={session.sessionId}
      data-status={session.status}
      data-inspector={inspectorShown}
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
    >
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 flex-col gap-2 border-b border-line px-5 py-3.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
            {standalone ? (
              <Button size="sm" variant="ghost" icon={<ArrowLeft />} className="-ml-2" data-testid="live-back" onClick={onBack}>
                {t('projects.live.back')}
              </Button>
            ) : (
              onBack && <IconButton size="sm" className="ses-back -ml-2" label={t('projects.live.back')} icon={<ArrowLeft />} onClick={onBack} />
            )}
            <div className="flex min-w-0 flex-1 basis-40 items-center gap-2.5">
              <h2 className="min-w-0 truncate text-lg font-semibold tracking-tight text-fg" data-selectable>
                {session.title}
              </h2>
              <StatusBadge session={session} size="md" testId="live-status" />
            </div>
            {/* Görünür eylemler: terminal, oturumu kapat, denetçi. Seyrek ve yıkıcı olanlar (çatalla, klasör, listeden kaldır) menüde. */}
            <div className="flex shrink-0 flex-wrap items-center gap-1">
              {/* Tur sürerken aynı oturum terminalde açılmaz (iki süreç aynı dökümü yazardı). */}
              {session.sessionId && (
                <IconButton size="sm" label={t('projects.page.openInTerminal')} icon={<TerminalWindow />} loading={opening} disabled={busy} onClick={() => void openInTerminal()} />
              )}
              <Menu
                placement="bottom-end"
                label={t('projects.page.more')}
                trigger={<IconButton size="sm" label={t('projects.page.more')} icon={<DotsThree weight="bold" />} tooltip={false} data-testid="live-more" />}
                items={[
                  ...(standalone
                    ? [
                        { id: 'new', label: t('projects.live.new.button'), icon: <Plus />, onSelect: standalone.onNew },
                        { id: 'settings', label: t('projects.live.settings.title'), icon: <GearSix />, onSelect: standalone.onSettings },
                        { type: 'separator' as const, id: 'sep-session' },
                      ]
                    : []),
                  ...(session.projectId ? [{ id: 'folder', label: t('projects.page.openIn.explorer'), icon: <FolderOpen />, onSelect: () => void openFolder() }] : []),
                  ...(session.sessionId ? [{ id: 'fork', label: t('projects.live.fork'), icon: <ArrowsSplit />, onSelect: () => void fork() }] : []),
                  ...(session.status !== 'closed' ? [{ id: 'close', label: t('projects.live.close'), icon: <X />, onSelect: close }] : []),
                  { type: 'separator' as const, id: 'sep' },
                  { id: 'forget', label: t('projects.live.forget'), icon: <Trash />, danger: true, onSelect: forget },
                ]}
              />
              <IconButton
                size="sm"
                label={t('projects.live.inspector.toggle')}
                icon={<SidebarSimple />}
                pressed={inspector}
                data-testid="live-inspector-toggle"
                onClick={() => setInspectorChoice(!inspector)}
              />
            </div>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted">
            <Badge size="sm">{session.projectName}</Badge>
            {session.source === 'assistant' && (
              <Badge size="sm" icon={<Robot />}>
                {t('projects.live.source.assistant')}
              </Badge>
            )}
            {/* Durum başlıkta bir kez yazar (rozet); izin sayısı yalnız birden çoksa ayrıca gösterilir. */}
            {session.pendingPermissions > 1 && (
              <Badge size="sm" tone="warning">
                {t('projects.live.list.permissions', { n: session.pendingPermissions })}
              </Badge>
            )}
            {session.background > 0 && <Badge size="sm">{t('projects.live.list.background', { n: session.background })}</Badge>}
            {session.changedFiles > 0 &&
              (inspectorShown ? (
                <span className="text-fg-faint tabular-nums">{t('projects.live.changedFiles', { n: session.changedFiles })}</span>
              ) : (
                // Denetçi kapalıyken değişen dosya sayısı burada durur; tıklayınca denetçi açılır.
                <button
                  type="button"
                  data-testid="live-changed-files"
                  data-count={session.changedFiles}
                  onClick={() => setInspectorChoice(true)}
                  className="cursor-pointer text-fg-muted tabular-nums underline decoration-line-strong underline-offset-3 hover:text-fg"
                >
                  {t('projects.live.changedFiles', { n: session.changedFiles })}
                </button>
              ))}
            {session.untrusted && (
              <Badge size="sm" tone="warning">
                {t('projects.live.untrustedBadge')}
              </Badge>
            )}
          </div>
          {(session.status === 'error' || session.status === 'limit') && (session.error || session.limitResetsAt) && (
            <p role="alert" data-testid="live-error" className="flex items-start gap-2 text-sm text-danger">
              <WarningCircle weight="fill" className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span data-selectable>
                {session.error ?? t('projects.live.limit.reached')}
                {session.status === 'limit' && session.limitResetsAt ? ` ${t('projects.live.limit.resets', { when: formatClock(session.limitResetsAt) })}` : ''}
              </span>
            </p>
          )}
        </header>

        {!loaded ? (
          <div data-testid="live-transcript" className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden px-5 py-4">
            <Skeleton shape="text" lines={3} />
            <Skeleton className="h-20" />
          </div>
        ) : (
          <Transcript
            items={items}
            version={loaded.model.version}
            cwd={session.cwd}
            sessionId={id}
            header={history.node}
            headerKey={history.key}
            waiting={waitingTools}
            empty={<EmptyState size="sm" icon={<ChatsCircle />} title={t('projects.live.emptyTitle')} description={t('projects.live.emptyBody')} />}
          />
        )}

        {permissions.length > 0 && (
          <div className="flex max-h-[45%] shrink-0 flex-col gap-2 overflow-y-auto border-t border-line px-5 py-3" data-testid="live-permissions" aria-live="polite">
            {permissions.map((request) => (
              <PermissionCard key={request.requestId} request={request} cwd={session.cwd} onAnswer={answer(request.requestId)} />
            ))}
          </div>
        )}

        <Composer
          draftKey={id}
          compact
          column
          busy={busy}
          onSend={send}
          onStop={stop}
          commands={detail?.commands ?? []}
          searchFiles={searchFiles}
          queue={detail?.queue ?? []}
          onRemoveQueued={removeQueued}
          {...(session.status === 'closed' || session.status === 'error' || session.status === 'limit' ? { placeholder: t('projects.live.composer.placeholderResume') } : {})}
          footer={
            <>
              <PickSelect
                data-testid="live-mode"
                aria-label={t('projects.live.mode.label')}
                className="min-w-0 flex-1"
                value={session.mode}
                onChange={(event) => void run(() => fuber().invoke('projects.claudeSetMode', { id, mode: event.target.value as PermissionMode }))}
                options={modeOptions(fullAccess, session.mode)}
              />
              <PickSelect
                data-testid="live-model"
                aria-label={t('projects.live.model.label')}
                className="min-w-0 flex-1"
                value={session.model ?? ''}
                onChange={(event) => void run(() => fuber().invoke('projects.claudeSetModel', { id, model: event.target.value || null }))}
                options={modelOptions(environment?.models ?? [], session.model)}
              />
              <PickSelect
                data-testid="live-effort"
                aria-label={t('projects.live.effort.label')}
                className="min-w-0 flex-1"
                value={session.effort ?? ''}
                onChange={(event) => void run(() => fuber().invoke('projects.claudeSetEffort', { id, effort: (event.target.value || null) as EffortLevel | null }))}
                options={effortOptions()}
              />
            </>
          }
        />
      </div>
      {inspectorShown && detail && <Inspector detail={detail} />}
    </div>
  );
}
