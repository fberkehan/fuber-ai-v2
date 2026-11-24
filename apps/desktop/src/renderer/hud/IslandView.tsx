import { useEffect, useState, type ReactNode, type Ref } from 'react';
import { AppWindow, ChatsCircle, Microphone, MicrophoneSlash, SpeakerSlash, X } from '@phosphor-icons/react';
import { t, type ApprovalRequest, type JobActivity, type MessageKey, type Notification } from '@fuber/shared';
import { Button, IconButton, IslandShell, KeyHint, cn, type IslandShellHandle, type PresenceState } from '@fuber/ui';
import { currentSentence, thinkingLine } from '../shared/live-text';
import type { IslandModel } from './island-model';
import { TailText } from './parts';

export { currentSentence, thinkingLine };
import type { PcActivity } from '../../main/modules/pc/types';

export type VoiceView = 'listening' | 'thinking' | 'speaking' | 'followup';

/** Adanın o an gösterdiği şey. Öncelik sırası `Island.tsx` içindedir. */
export type View =
  | { kind: 'approval'; approval: ApprovalRequest }
  | { kind: 'notice'; notice: Notification }
  /** Yönetim asistanı durdurdu (acil durdurma). */
  | { kind: 'banner'; title: string; body: string }
  | { kind: 'error'; message: string; /** Yanıtı kesilen söz "Yeniden dene" ile yinelenebilir. */ retry?: boolean }
  /** Hata olmayan hat iletisi: kırmızı yok, varlık sakin kalır. */
  | { kind: 'info'; message: string }
  /** Jarvis fareyi/klavyeyi kullanıyor (ya da az önce kesildi): ne yaptığı ve "Durdur". */
  | { kind: 'pc'; activity: PcActivity }
  /** Uyanış: uyandırma sözü duyuldu; gövde üst kenardan doğar, içerik henüz yok. */
  | { kind: 'wake' }
  | { kind: 'voice'; state: VoiceView }
  /**
   * Arka planda yürüyen derin iş (araştırma, yetenek geliştirme, Claude Code): adı, adımı ve yüzdesi (`job.activity`).
   * İş sürdükçe satır kalır; son iş bitince kalkar (bitiş ayrıca bildirim olarak gelir).
   */
  | { kind: 'job'; activity: JobActivity }
  /** Toplantı kaydı (yazı) sürüyor: kip açıkken kalıcı, sakin gösterge. */
  | { kind: 'meeting' }
  | { kind: 'micOff' };

/** Tek satıra sığmayan hata/bilgi iletisi kart olur (kırpılmaz). */
const LONG_MESSAGE_CHARS = 58;

export const presenceOf = (view: View | null): PresenceState => {
  if (!view) return 'idle';
  switch (view.kind) {
    case 'approval':
      return 'approval';
    case 'notice':
      return 'notice';
    case 'banner':
      return 'stopped';
    case 'error':
      return 'error';
    case 'info':
      return 'followup';
    case 'pc':
      return view.activity.active ? 'computer' : 'stopped';
    case 'wake':
      return 'wake';
    case 'voice':
      return view.state;
    case 'job':
      return 'job';
    case 'meeting':
      return 'followup';
    case 'micOff':
      return 'muted';
  }
};

/**
 * İmleç üstüne gelince hızlı denetimlerin açıldığı hâller: seyredilen satırlar. Kartlar (onay, bildirim, yönetim
 * iletisi, uzun ileti) kendi düğmelerini taşır; bilgisayar kullanımında "Durdur" zaten satırdadır; uyanış bir andır.
 */
export const expandable = (view: View | null): boolean => {
  if (!view) return false;
  if (view.kind === 'voice' || view.kind === 'job' || view.kind === 'meeting' || view.kind === 'micOff') return true;
  return (view.kind === 'info' || view.kind === 'error') && view.message.length <= LONG_MESSAGE_CHARS;
};

const isCard = (view: View): boolean =>
  view.kind === 'approval' ||
  view.kind === 'notice' ||
  view.kind === 'banner' ||
  ((view.kind === 'error' || view.kind === 'info') && view.message.length > LONG_MESSAGE_CHARS);

const sourceKey: Record<string, MessageKey> = {
  planner: 'hud.island.source.planner',
  projects: 'hud.island.source.projects',
  memory: 'hud.island.source.memory',
  web: 'hud.island.source.web',
  workshop: 'hud.island.source.skills',
  skills: 'hud.island.source.skills',
};

interface IslandViewProps {
  /** `island`: yüzen ada. `window`: ana pencerenin çentiği (boşta da durur; "ana pencereyi aç" denetimi yoktur). */
  variant: 'island' | 'window';
  /** Boşta (gösterilecek durum yokken) çentikte duran içerik: yalnız ana pencere çentiğinde. */
  idle?: ReactNode;
  bodyTestId?: string;
  /** Boştaki çentiğe tıklandı (ana pencere: dinlemeye geçer). */
  onActivate?(): void;
  view: View | null;
  /** Kullanıcının yazıya dökülen sözü ve Jarvis'in söylediği. */
  user: string;
  assistant: string;
  assistantName: string;
  /** Sohbet kipi: dinleme satırında "Bitir". */
  conversation: boolean;
  /** Düşünürken çalışan aracın modülü; yoksa `null`. */
  toolModule: string | null;
  /** Süren sesli turun canlı adımı (`voice.activity`): "“WhatsApp” açılıyor"; yoksa `toolModule` satırı. */
  step?: string | null;
  /** Yürürlükteki yetki Tam yetki: ses görünümlerinde ve bilgisayar kullanımında küçük kalıcı etiket. */
  fullAuthority?: boolean;
  muteKeys: string[];
  panicKeys: string[];
  getLevel: () => number;
  /** Bildirimin kalan süresi (0..1). */
  noticeLeft: number;
  /** İmleç gövdenin üstünde ve hâl uygun: satır genişler, hızlı denetimler görünür. */
  hover?: boolean;
  micMuted?: boolean;
  shellRef?: Ref<IslandShellHandle>;
  onTarget?: (size: { width: number; height: number }) => void;
  /** Pencere bu hedef ölçüyü taşıyacak kadar büyüdü mü (gövde büyümeden önce sorulur). */
  fits?: (size: { width: number; height: number }) => boolean;
  onResolve(id: string, approve: boolean, scope?: 'task'): void;
  onRetry?(): void;
  onAct(id: string, actionId: string): void;
  onDismiss(id: string): void;
  onEndConversation(): void;
  onToggleMic?(): void;
  onStopSpeaking?(): void;
  onStartConversation?(): void;
  onOpenMain?(): void;
  onStopPc(): void;
  onHover?(inside: boolean): void;
}

export interface IslandViewOuterProps {
  model: IslandModel;
  variant?: 'island' | 'window';
  /** İmleç gövdenin üstünde ve hâl uygun: satır genişler, hızlı denetimler görünür. */
  hover: boolean;
  idle?: ReactNode;
  bodyTestId?: string;
  onActivate?(): void;
  shellRef?: Ref<IslandShellHandle>;
  onTarget?: (size: { width: number; height: number }) => void;
  fits?: (size: { width: number; height: number }) => boolean;
}

/**
 * Adanın görünümü: modelden (`island-model.ts`) hangi hâlde ne yazdığı ve gövdenin hangi biçimi aldığı. Yüzen ada ve
 * ana pencerenin çentiği aynı görünümü kullanır; olaylar modelde, pencere ve imleç `Island.tsx`'te / çentikte.
 */
export function IslandView({ model, variant = 'island', hover, idle, bodyTestId, onActivate, shellRef, onTarget, fits }: IslandViewOuterProps) {
  return (
    <IslandBody
      variant={variant}
      idle={idle}
      bodyTestId={bodyTestId}
      onActivate={onActivate}
      view={model.view}
      user={model.user}
      assistant={model.assistant}
      assistantName={model.assistantName}
      conversation={model.conversation}
      toolModule={model.toolModule}
      step={model.step}
      fullAuthority={model.fullAuthority}
      muteKeys={model.muteKeys}
      panicKeys={model.panicKeys}
      getLevel={model.getLevel}
      noticeLeft={model.noticeLeft}
      hover={hover}
      micMuted={model.micMuted}
      shellRef={shellRef}
      onTarget={onTarget}
      fits={fits}
      onResolve={model.resolve}
      onRetry={model.retry}
      onAct={model.act}
      onDismiss={model.dismiss}
      onEndConversation={model.endConversation}
      onToggleMic={model.toggleMic}
      onStopSpeaking={model.stopSpeaking}
      onStartConversation={model.startConversation}
      onOpenMain={variant === 'island' ? model.openMain : undefined}
      onStopPc={model.stopPc}
      onHover={model.onHover}
    />
  );
}

function IslandBody(props: IslandViewProps) {
  const { view, variant } = props;
  const state = presenceOf(view);
  const card = view ? isCard(view) : false;
  const base = content(props);
  // Üstüne gelince: aynı içerik (anahtar değişmez, yeniden belirmez) + yanında hızlı denetimler; gövde yayla genişler.
  // İçerik HER ZAMAN aynı kabın içindedir (denetimler açılıp kapanırken yeniden takılmaz: konuşurken imleç gelince
  // söylenen cümle baştan oynamaz). Denetimler kapanırken kısa bir an sönerek kalır; gövde o sırada daralır.
  const canExpand = expandable(view);
  const open = !!props.hover && canExpand;
  const controlsShown = useLinger(open, 150);
  const idle = !view && props.idle ? props.idle : null;
  const key = idle ? 'idle' : controlsShown && base.key === null ? 'controls' : base.key;
  const node =
    canExpand && (base.node || controlsShown) ? (
      <div className="hud-hover" data-open={open ? '' : undefined} data-bare={base.node ? undefined : ''} data-testid={controlsShown ? 'island-hover' : undefined}>
        {base.node}
        {controlsShown ? <Controls {...props} leaving={!open} /> : null}
      </div>
    ) : (
      base.node
    );
  const approvalLeft = useApprovalLeft(view?.kind === 'approval' ? view.approval : null);
  const progress =
    view?.kind === 'approval'
      ? approvalLeft.fraction
      : view?.kind === 'notice'
        ? props.noticeLeft
        : view?.kind === 'job'
          ? (view.activity.current?.progress ?? 0)
          : 1;

  return (
    <IslandShell
      ref={props.shellRef}
      variant={variant}
      state={state}
      getLevel={props.getLevel}
      progress={progress}
      contentKey={key}
      card={card}
      onTarget={props.onTarget}
      fits={props.fits}
      label={props.assistantName}
      bodyTestId={props.bodyTestId ?? 'island-pill'}
      bodyProps={{
        'data-kind': view?.kind ?? (idle ? 'idle' : undefined),
        onMouseEnter: () => props.onHover?.(true),
        onMouseLeave: () => props.onHover?.(false),
        onClick: idle ? props.onActivate : undefined,
      }}
    >
      {view?.kind === 'approval' ? (
        <ApprovalCard approval={view.approval} seconds={approvalLeft.seconds} onResolve={props.onResolve} />
      ) : idle ? (
        idle
      ) : (
        node
      )}
    </IslandShell>
  );
}

/** Onayın kalan süresi: saniye (yazı) ve oran (ışık). Çeyrek saniyede bir güncellenir; ışık arada yayla akar. */
function useApprovalLeft(approval: ApprovalRequest | null): { seconds: number; fraction: number } {
  const expires = approval ? Date.parse(approval.expiresAt) : 0;
  const total = approval ? Math.max(1000, expires - Date.parse(approval.requestedAt)) : 1;
  const [left, setLeft] = useState(() => (approval ? Math.max(0, expires - Date.now()) : 0));
  useEffect(() => {
    if (!approval) return;
    setLeft(Math.max(0, expires - Date.now()));
    const tick = setInterval(() => setLeft(Math.max(0, expires - Date.now())), 250);
    return () => clearInterval(tick);
  }, [approval?.id, expires]);
  return { seconds: Math.ceil(left / 1000), fraction: Math.min(1, left / total) };
}

/** Tam yetki etiketi: küçük, kalıcı; açıklaması ipucunda. */
function AuthorityTag({ on }: { on?: boolean }) {
  if (!on) return null;
  return (
    <span className="hud-num" data-testid="island-authority" title={t('authority.badge.fullHint')}>
      {t('authority.badge.full')}
    </span>
  );
}

function RetryButton({ onRetry }: { onRetry?(): void }) {
  if (!onRetry) return null;
  return (
    <button type="button" className="hud-mini" onClick={onRetry} data-testid="island-retry">
      {t('turn.retry')}
    </button>
  );
}

function content(props: IslandViewProps): { key: string | null; node: ReactNode } {
  const { view } = props;
  if (!view || view.kind === 'wake') return { key: null, node: null };
  const c = props.conversation ? '|c' : '';
  const tag = <AuthorityTag on={props.fullAuthority} />;
  const retry = view.kind === 'error' && view.retry ? props.onRetry : undefined;

  if (view.kind === 'approval') return { key: `approval:${view.approval.id}`, node: null };

  if (view.kind === 'notice') {
    return { key: `notice:${view.notice.id}`, node: <NoticeCard notice={view.notice} onAct={props.onAct} onDismiss={props.onDismiss} /> };
  }

  if (view.kind === 'banner') {
    return {
      key: 'banner',
      node: (
        <section className="hud-card" data-testid="island-banner" role="status">
          <div className="hud-card-head">
            <span>{t('hud.island.source.admin')}</span>
          </div>
          <p className="hud-card-title hud-card-title-sm">{view.title}</p>
          <p className="hud-card-sub">{view.body}</p>
        </section>
      ),
    };
  }

  if (view.kind === 'error' || view.kind === 'info') {
    if (view.message.length > LONG_MESSAGE_CHARS) {
      return {
        key: `${view.kind}-card:${view.message}`,
        node: (
          <section className="hud-card hud-card-slim" data-testid="island-message-card" data-state={view.kind} role={view.kind === 'error' ? 'alert' : 'status'}>
            <p className={cn('hud-message line-clamp-3', view.kind === 'error' && 'hud-bad-lead')} data-testid="island-message" title={view.message}>
              {view.message}
            </p>
            {retry ? (
              <div className="hud-card-actions">
                <RetryButton onRetry={retry} />
              </div>
            ) : null}
          </section>
        ),
      };
    }
    return {
      key: `${view.kind}:${view.message}`,
      node: (
        <Line state={view.kind} trailing={!!retry}>
          <span className={cn('hud-strong', view.kind === 'error' && 'text-danger')} data-testid="island-message" title={view.message}>
            {view.message}
          </span>
          <RetryButton onRetry={retry} />
        </Line>
      ),
    };
  }

  if (view.kind === 'pc') {
    const { activity } = view;
    if (!activity.active) {
      return {
        key: 'pc-stopped',
        node: (
          <Line state="pc">
            <span className="hud-strong" data-testid="island-pc" data-interrupted={activity.interrupted ?? undefined}>
              {t(activity.interrupted === 'user' ? 'pc.status.interrupted.user' : 'pc.status.interrupted.panic')}
            </span>
          </Line>
        ),
      };
    }
    return {
      key: 'pc',
      node: (
        <Line state="pc" trailing>
          <span className="flex min-w-0 items-center gap-2.5" data-testid="island-pc" data-action={activity.action ?? undefined}>
            <span className="hud-strong">{t('pc.status.using')}</span>
            {tag}
            {/* Adım sabit genişlikte: adım değişirken ada genişleyip daralmaz. */}
            {/* Adım metni (d4): bilgisayar modülü ne yaptığını kendi söyler ("3/6 · “Ara” alanına yazıyorum"); yoksa eylem + uygulama. */}
            <span className="hud-dim hud-step" key={`${activity.action ?? ''}|${activity.app ?? ''}|${activity.step ?? ''}`} data-testid="island-pc-step">
              {activity.step
                ? `${activity.progress ? `${activity.progress.index}/${activity.progress.total} · ` : ''}${activity.step}`
                : [activity.action ? t(`pc.status.${activity.action}`) : null, activity.app].filter(Boolean).join(', ')}
            </span>
          </span>
          <button type="button" className="hud-mini" data-primary="" aria-label={t('pc.status.stopLabel')} onClick={props.onStopPc} data-testid="island-pc-stop">
            {t('pc.status.stop')}
            {props.panicKeys.length > 0 ? <KeyHint keys={props.panicKeys} size="sm" className="hud-mini-keys" /> : null}
          </button>
        </Line>
      ),
    };
  }

  if (view.kind === 'job' && view.activity.current) {
    // İş adı · adım · yüzde (ölçülemiyorsa yüzde yok) · birden çok işte "+N iş". Anahtar işe bağlı: adım değişirken
    // satır yeniden belirmez, yalnız adım metni değişir.
    const job = view.activity.current;
    const others = view.activity.running + view.activity.queued - 1;
    const percent = job.progress === null ? null : Math.round(Math.min(1, Math.max(0, job.progress)) * 100);
    const step = job.status === 'queued' ? t('hud.island.jobQueued') : job.step;
    return {
      key: `job:${job.id}`,
      node: (
        <Line state="job">
          <span
            className="flex min-w-0 items-center gap-2.5"
            data-testid="island-job"
            data-job={job.id}
            data-status={job.status}
            data-progress={percent ?? 'indeterminate'}
            role="status"
          >
            <span className="hud-strong hud-ellip hud-ellip-short" title={job.title}>
              {job.title}
            </span>
            {step ? (
              <span className="hud-dim hud-ellip hud-ellip-short" title={step} data-testid="island-job-step">
                {step}
              </span>
            ) : null}
            {percent !== null && job.status === 'running' ? <span className="hud-num">{t('hud.island.jobPercent', { n: percent })}</span> : null}
            {others > 0 ? (
              <span className="hud-num" data-testid="island-job-more">
                {t('hud.island.jobMore', { n: others })}
              </span>
            ) : null}
          </span>
        </Line>
      ),
    };
  }

  if (view.kind === 'job') return { key: null, node: null };

  if (view.kind === 'meeting') {
    return {
      key: 'meeting',
      node: (
        <Line state="meeting">
          <span className="hud-rec" aria-hidden />
          <span className="hud-strong" data-testid="island-meeting">
            {t('hud.island.meeting')}
          </span>
        </Line>
      ),
    };
  }

  if (view.kind === 'micOff') {
    return {
      key: 'mic',
      node: (
        <Line state="micOff">
          <span className="hud-strong">{t('hud.island.micOff')}</span>
          {props.muteKeys.length > 0 ? (
            <>
              <KeyHint keys={props.muteKeys} size="sm" />
              <span className="hud-dim">{t('hud.island.micOffHint')}</span>
            </>
          ) : null}
        </Line>
      ),
    };
  }

  const end = props.conversation ? (
    <>
      <span className="hud-sep" aria-hidden />
      <Button
        size="sm"
        variant="ghost"
        className="hud-ghost"
        aria-label={t('hud.island.endConversationLabel')}
        onClick={props.onEndConversation}
        data-testid="island-end-conversation"
      >
        {t('hud.island.endConversation')}
      </Button>
    </>
  ) : null;

  if (view.state === 'listening') {
    return props.user
      ? {
          key: `heard${c}`,
          node: (
            <Line state="listening" trailing={!!end}>
              <TailText text={props.user} className="hud-tail-box" testId="island-transcript" />
              {tag}
              {end}
            </Line>
          ),
        }
      : {
          key: `listen${c}`,
          node: (
            <Line state="listening" trailing={!!end}>
              <span className="hud-strong">{t('hud.island.listening')}</span>
              {tag}
              {end}
            </Line>
          ),
        };
  }

  if (view.state === 'thinking') {
    return {
      key: `think${c}`,
      node: (
        <Line state="thinking" trailing={!!end}>
          <span className="hud-strong" data-testid="island-step">
            {props.step ?? thinkingLine(props.toolModule)}
          </span>
          {tag}
          {props.user ? (
            <span className="hud-dim hud-ellip" title={props.user}>
              {props.user}
            </span>
          ) : null}
          {end}
        </Line>
      ),
    };
  }

  if (view.state === 'speaking') {
    if (!props.assistant) {
      return {
        key: 'speak',
        node: (
          <Line state="speaking">
            <span className="hud-strong">{props.assistantName}</span>
            {tag}
          </Line>
        ),
      };
    }
    const sentence = currentSentence(props.assistant);
    return {
      key: `say:${sentence.index}`,
      node: (
        <section className="hud-say" data-testid="island-voice" data-state="speaking" aria-live="polite">
          <p data-testid="island-saying" title={props.assistant}>
            {sentence.text.split(/\s+/).map((word, index) => (
              // Sözcükler söylendikçe belirir; cümle yerini baştan almaz, satır kıpırdamaz.
              <span key={index} className="hud-word">
                {word}{' '}
              </span>
            ))}
          </p>
          {tag}
        </section>
      ),
    };
  }

  // Takip dinlemesi: sakin bir satır.
  return {
    key: 'follow',
    node: (
      <Line state="followup">
        <span className="hud-dim">{t('hud.island.followup')}</span>
        {tag}
      </Line>
    ),
  };
}

/** `on` kapandıktan sonra `ms` boyunca doğru kalır (çıkış geçişine yer açar). */
function useLinger(on: boolean, ms: number): boolean {
  const [shown, setShown] = useState(on);
  useEffect(() => {
    if (on) {
      setShown(true);
      return;
    }
    const timer = setTimeout(() => setShown(false), ms);
    return () => clearTimeout(timer);
  }, [on, ms]);
  return on || shown;
}

/** Hızlı denetimler: mikrofon, (konuşurken) sustur, (iş sürerken) durdur, sohbet kipi, ana pencere. Yalnız imleç adanın üstündeyken. */
function Controls(props: IslandViewProps & { leaving?: boolean }) {
  const { view } = props;
  const speaking = view?.kind === 'voice' && view.state === 'speaking';
  // İş sürerken (düşünüyor, araç çalışıyor): süren işi durdurur; sohbet açık kalır (`voice.stop`).
  const working = view?.kind === 'voice' && view.state === 'thinking';
  // Toplantı kipinde Jarvis sesli konuşmaz: sohbet kipi önerilmez.
  const canConverse = view?.kind !== 'micOff' && view?.kind !== 'meeting' && !props.conversation && !props.micMuted;
  return (
    <div
      className="hud-controls"
      data-leaving={props.leaving ? '' : undefined}
      data-testid={props.leaving ? undefined : 'island-controls'}
      role="toolbar"
      aria-label={t('hud.controls.label')}
    >
      <button
        type="button"
        className="hud-ctl"
        data-on={props.micMuted ? '' : undefined}
        aria-pressed={!!props.micMuted}
        aria-label={t(props.micMuted ? 'hud.controls.micOn' : 'hud.controls.micOff')}
        title={t(props.micMuted ? 'hud.controls.micOn' : 'hud.controls.micOff')}
        onClick={props.onToggleMic}
        data-testid="island-ctl-mic"
      >
        {props.micMuted ? <MicrophoneSlash weight="fill" /> : <Microphone />}
      </button>
      {speaking ? (
        <button type="button" className="hud-ctl" aria-label={t('hud.controls.stop')} title={t('hud.controls.stop')} onClick={props.onStopSpeaking} data-testid="island-ctl-stop">
          <SpeakerSlash />
        </button>
      ) : null}
      {working ? (
        <button type="button" className="hud-ctl" aria-label={t('turn.stop')} title={t('turn.stop')} onClick={props.onStopSpeaking} data-testid="island-ctl-stop-work">
          <X />
        </button>
      ) : null}
      {canConverse ? (
        <button
          type="button"
          className="hud-ctl"
          aria-label={t('hud.controls.conversation')}
          title={t('hud.controls.conversation')}
          onClick={props.onStartConversation}
          data-testid="island-ctl-conversation"
        >
          <ChatsCircle />
        </button>
      ) : null}
      {props.onOpenMain ? (
        <button type="button" className="hud-ctl" aria-label={t('hud.controls.open')} title={t('hud.controls.open')} onClick={props.onOpenMain} data-testid="island-ctl-open">
          <AppWindow />
        </button>
      ) : null}
    </div>
  );
}

function Line({ state, trailing, children }: { state: string; trailing?: boolean; children: ReactNode }) {
  return (
    <section className="hud-line" data-testid="island-voice" data-state={state} data-trailing={trailing ? '' : undefined} aria-live="polite">
      {children}
    </section>
  );
}

function NoticeCard(props: { notice: Notification; onAct(id: string, actionId: string): void; onDismiss(id: string): void }) {
  const { notice } = props;
  const urgent = notice.priority === 'urgent';
  // Birincil eylem solda, okuma yönünde ilk; ikincisi hemen sağında.
  const actions = [...notice.actions].sort((a, b) => Number(b.kind === 'primary') - Number(a.kind === 'primary')).slice(0, 2);
  const hasPrimary = actions.some((action) => action.kind === 'primary');
  return (
    <section className="hud-card" data-testid="island-notice" role="status">
      <div className={cn('hud-card-head', urgent && 'text-danger')}>
        <span>{t(sourceKey[notice.moduleId] ?? 'hud.island.notice')}</span>
        <span className="grow" />
        <IconButton
          size="sm"
          icon={<X weight="bold" />}
          label={t('common.close')}
          tooltip={false}
          className="hud-x"
          onClick={() => props.onDismiss(notice.id)}
        />
      </div>
      <p className="hud-card-title" title={notice.title}>
        {notice.title}
      </p>
      {notice.body ? (
        <p className="hud-card-sub line-clamp-2" title={notice.body}>
          {notice.body}
        </p>
      ) : null}
      {actions.length > 0 ? (
        <div className="hud-card-actions">
          {actions.map((action, index) => (
            <Button
              key={action.id}
              size="sm"
              variant={action.kind === 'danger' ? 'danger' : action.kind === 'primary' || (!hasPrimary && index === 0) ? 'primary' : 'secondary'}
              onClick={() => props.onAct(notice.id, action.id)}
            >
              {action.label}
            </Button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ApprovalCard(props: { approval: ApprovalRequest; seconds: number; onResolve(id: string, approve: boolean, scope?: 'task'): void }) {
  const { approval } = props;
  // Yetki yükseltme ve izin onaylarında "Bu iş boyunca sorma" olmaz (yetkiyi onayla yükseltmek ayrı bir karar).
  const canTask = approval.kind !== 'authority' && approval.kind !== 'permission';
  return (
    <section className="hud-card" data-testid="island-approval" role="alertdialog" aria-label={t('approval.title')}>
      <div className="hud-card-head text-warning">
        <span>{t('approval.title')}</span>
        <span className="grow" />
        <span className="hud-num" data-testid="island-approval-left">
          {t('hud.island.secondsLeft', { n: props.seconds })}
        </span>
      </div>
      <p className="hud-card-title hud-card-title-sm line-clamp-3">{approval.summary}</p>
      <p className="hud-card-sub">{t('authority.card.hint')}</p>
      {/* Birincil eylem beyaz hap ve solda; yıkıcı işte de beyaz kalır, riski kartın cümlesi söyler. */}
      <div className="hud-card-actions">
        <Button size="sm" variant="primary" onClick={() => props.onResolve(approval.id, true)} data-testid="island-approve">
          {t('common.approve')}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => props.onResolve(approval.id, false)} data-testid="island-deny">
          {t('common.deny')}
        </Button>
        {canTask ? (
          <Button size="sm" variant="ghost" onClick={() => props.onResolve(approval.id, true, 'task')} data-testid="island-approve-task">
            {t('authority.card.task')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
