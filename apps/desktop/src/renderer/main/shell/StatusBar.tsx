// Başlık şeridi: solda ses ve beyin durumu (sorun varsa Yönetim), sağda tek "Konuş" denetimi. Şerit pencereyi taşır.
import { Binoculars, Cloud, CloudSlash, Cpu, Ear, Microphone, MicrophoneSlash, Pulse, Record, ShieldCheck, ShieldWarning, SpeakerSlash, Stop } from '@phosphor-icons/react';
import { t, type VoiceState } from '@fuber/shared';
import { Badge, KeyHint, StatusPill, Tooltip, cn, type StatusKind } from '@fuber/ui';
import { useShell } from './context';
import { useAuthority } from './authority';
import { acceleratorKeys, attempt, useLive } from './live';
import { stopVoice, voiceBusy } from './voice-stop';

const voicePill: Record<VoiceState, StatusKind> = {
  idle: 'online',
  listening: 'listening',
  followup: 'listening',
  thinking: 'busy',
  speaking: 'listening',
  mic_off: 'muted',
};

/**
 * `compact` (pencerenin çentiği durumu taşırken): ses durumu zaten canlı çentikte yazar; aynı bilgi iki yerde
 * gösterilmez. Ses hapı yalnız hat hazır değilken görünür, beyin ve Yönetim rozetleri simgeye iner (ad ipucunda).
 * Böylece geniş çentik rozetleri örtmez. `dimLeft`: yalnız DAR pencerede, çentik genişken sol öbek geri çekilir.
 * Bütün rozetler aynı düzendedir: simge + ad; sıkışık hâlde ve dar pencerede ad ekran okuyucuya iner, ipucu açıklar.
 */
export function StatusBar({ compact = false, dimLeft = false }: { compact?: boolean; dimLeft?: boolean }) {
  const shell = useShell();
  const { voice, status, brain, brainStatus, hotkeys, live } = shell;
  const state = voice?.state ?? 'idle';
  // "Hazırlanıyor" yalnız boştayken: hat bir durumdaysa (dinliyor, düşünüyor…) o durum gösterilir.
  const notReady = voice !== null && !voice.ready && state === 'idle';
  const kind: StatusKind = notReady ? 'offline' : voicePill[state];
  // Hat bir hata yüzünden hazır değilse (mikrofon izni, aygıt yok) "hazırlanıyor" yanıltır: "kullanılamıyor" denir.
  const failed = notReady && !!voice?.lastError;
  // Sohbet kipinde durum uzun süre "dinliyor" kalır; neden öyle olduğu adıyla söylenir.
  const conversation = !!voice?.conversation && (state === 'listening' || state === 'followup');
  const voiceLabel = failed
    ? t('nav.status.voiceUnavailable')
    : notReady
      ? t('nav.status.voiceNotReady')
      : conversation
        ? t('nav.status.voiceConversation')
        : t(`nav.status.voice.${state}`);
  const control = status?.control;
  const connected = control?.state === 'approved';
  const talk = hotkeys.find((hotkey) => hotkey.id === 'talk');
  const muteKey = hotkeys.find((hotkey) => hotkey.id === 'mute');
  const muted = voice?.micMuted ?? state === 'mic_off';
  // Ortam dinleme sürerken kalıcı gösterge (tepsi ipucuyla aynı kural: kip açık, hat hazır, mikrofon açık).
  const ambient = voice?.ambient === true && voice.ready && !muted && state !== 'mic_off';
  // Asıl beyin bu bilgisayardaki Claude Code mu (abonelik): rozet "Claude" der; düşükse nedeni söylenir.
  const viaClaude = brainStatus?.cloud?.provider === 'claude-code';
  const claudeReset = brainStatus?.claudeCode?.resetsAt ? new Date(brainStatus.claudeCode.resetsAt).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : null;
  const claudeLocalHint =
    brainStatus?.cause === 'limit'
      ? claudeReset
        ? t('ccbrain.badge.localLimitUntil', { time: claudeReset })
        : t('ccbrain.badge.localLimit')
      : brainStatus?.cause === 'auth'
        ? t('ccbrain.badge.localAuth')
        : brainStatus?.cause === 'network'
          ? t('ccbrain.badge.localError')
          : null;
  // Bulut sağlayıcısının adı (Anthropic, özel uç): rozet ve nedenler onu adıyla söyler.
  const cloudName = !viaClaude ? (brainStatus?.cloud?.name ?? null) : null;
  const cloudModel = brainStatus?.cloud?.model ?? null;
  const brainHint =
    brain === 'none'
      ? (brainStatus?.message ?? t('nav.status.brainNoneHint'))
      : brain === 'cloud'
        ? viaClaude
          ? t('ccbrain.badge.hint')
          : cloudName
            ? cloudModel
              ? t('nav.status.brainCloudNamedHint', { name: cloudName, model: cloudModel })
              : t('nav.status.brainCloudNamedNoModelHint', { name: cloudName })
            : t('nav.status.brainCloudHint')
        : viaClaude && claudeLocalHint
          ? claudeLocalHint
          : brainStatus?.reason === 'private'
            ? t('nav.status.brainPrivateHint')
            : brainStatus?.reason === 'no_key'
              ? t('nav.status.brainLocalNoKeyHint')
              : brainStatus?.cause === 'billing'
                ? cloudName
                  ? t('nav.status.brainLocalBillingNamedHint', { name: cloudName })
                  : t('nav.status.brainLocalBillingHint')
                : brainStatus?.cause === 'auth'
                  ? cloudName
                    ? t('nav.status.brainLocalAuthNamedHint', { name: cloudName })
                    : t('nav.status.brainLocalAuthHint')
                  : brainStatus?.cause === 'network' && cloudName
                    ? t('nav.status.brainLocalNetworkNamedHint', { name: cloudName })
                    : brainStatus?.reason === 'policy_local'
                      ? t('nav.status.brainLocalPolicyHint')
                      : t('nav.status.brainLocalHint');
  // Gizli kip: yerel modelin neden yürüttüğü adıyla yazar ("Bu bilgisayar" değil "Gizli kip").
  const privateMode = brain === 'local' && brainStatus?.reason === 'private';
  const brainLabel = privateMode
    ? t('nav.status.brainPrivate')
    : brain === 'local'
      ? t('nav.status.brainLocal')
      : brain === 'none'
        ? t('nav.status.brainNone')
        : viaClaude
          ? t('ccbrain.badge')
          : (cloudName ?? t('nav.status.brainCloud'));
  const meeting = voice?.meeting?.on === true;
  // Tam yetki açıkken kalıcı etiket; tıklayınca Ayarlar (Genel: yetki düzeyi).
  const fullAuthority = useAuthority().state?.level === 'full';
  // Süren takip işleri (İşler sayfası): sayısı rozette, adları ipucunda. Modül kapalıysa okunmaz.
  const watchOn = shell.moduleEnabled('watch');
  const watch = useLive(() => (watchOn ? window.fuber.invoke('watch.list', { limit: 100 }) : Promise.resolve([])), ['watch.changed'], [watchOn]);
  const watching = (watch.data ?? []).filter((job) => job.status === 'running');
  const label = (text: string, narrow = 'max-[1320px]:sr-only') => <span className={cn(narrow, compact && 'sr-only')}>{text}</span>;
  const jobs = live.jobs;
  const talkDisabled = muted || !!status?.killSwitch.active;
  const busy = voiceBusy(state);

  return (
    <div className="flex h-12 shrink-0 items-center gap-2 pr-1 pl-2" data-testid="status-bar">
      <div
        className={cn(
          'flex min-w-0 items-center gap-2 transition-opacity duration-(--duration-fast) ease-out',
          dimLeft && 'max-[1320px]:pointer-events-none max-[1320px]:opacity-0',
        )}
        data-compact={compact ? '' : undefined}
      >
        <Tooltip content={voice?.notReadyReason ?? (conversation ? t('nav.status.voiceConversationHint') : (voice?.lastError ?? voiceLabel))} placement="bottom">
          <StatusPill
            status={kind}
            label={voiceLabel}
            data-testid="status-voice"
            data-state={state}
            data-conversation={conversation ? '' : undefined}
            data-ready={voice ? String(voice.ready) : undefined}
            tabIndex={compact && !notReady ? -1 : 0}
            className={cn(compact && !notReady && 'sr-only')}
          />
        </Tooltip>
        {ambient ? (
          <Tooltip content={t('nav.status.ambientHint')} placement="bottom">
            <Badge tone="accent" icon={<Ear weight="bold" />} data-testid="status-ambient" tabIndex={0} className="h-7 px-3 text-sm">
              {label(t('nav.status.ambient'))}
            </Badge>
          </Tooltip>
        ) : null}
        {meeting ? (
          // Toplantı kaydı sürerken kalıcı gösterge; tıklayınca Toplantı sayfası.
          <Tooltip content={`${t('meeting.recording')}. ${t('meeting.recordingNote')}`} placement="bottom">
            <Badge
              tone="danger"
              icon={<Record weight="fill" />}
              data-testid="status-meeting"
              tabIndex={0}
              role="button"
              className="ui-no-drag h-7 cursor-pointer px-3 text-sm"
              onClick={() => shell.navigate('meeting')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  shell.navigate('meeting');
                }
              }}
            >
              {label(t('nav.status.meeting'))}
            </Badge>
          </Tooltip>
        ) : null}
        {/* Beyin nerede çalışıyor: tek, nötr hap; ayrıntı üstüne gelince. Yalnız "beyin yok" dikkat ister. */}
        <Tooltip content={brainHint} placement="bottom">
          <Badge
            tone={brain === 'none' ? 'warning' : 'neutral'}
            icon={privateMode ? <ShieldCheck weight="bold" /> : brain === 'local' ? <Cpu weight="bold" /> : brain === 'none' ? <CloudSlash weight="bold" /> : <Cloud weight="bold" />}
            data-testid="status-brain"
            data-brain={brain}
            data-reason={brainStatus?.reason}
            data-cause={brainStatus?.cause ?? undefined}
            data-via={brainStatus?.cloud?.provider ?? undefined}
            tabIndex={0}
            className="h-7 px-3 text-sm"
          >
            {/* Dar pencerede yalnız simge kalır (çentiğe yer açılır); ad ipucunda ve ekran okuyucuda durur. */}
            {label(brainLabel)}
          </Badge>
        </Tooltip>
        {fullAuthority ? (
          <Tooltip content={t('authority.badge.fullHint')} placement="bottom">
            <Badge
              tone="warning"
              icon={<ShieldWarning weight="bold" />}
              data-testid="shell-authority"
              tabIndex={0}
              role="button"
              className="ui-no-drag h-7 cursor-pointer px-3 text-sm"
              onClick={() => shell.navigate('settings')}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  shell.navigate('settings');
                }
              }}
            >
              {label(t('authority.badge.full'))}
            </Badge>
          </Tooltip>
        ) : null}
        {/* Yönetim bağlıyken söylenecek bir şey yok: hap yalnız bağlantı yokken görünür (ekran okuyucu her zaman okur). */}
        {connected ? (
          <span className="sr-only" role="status" data-testid="status-control" data-state={control?.state ?? 'unknown'}>
            {t('nav.status.adminOnline')}
          </span>
        ) : (
          // "Yönetim kapalı" internet kesik sanılmasın: ipucu önce bunu söyler, ayrıntı (son hata / durum) sonra gelir.
          <Tooltip content={`${t('nav.status.adminOfflineHint')} ${control?.lastError ?? (control ? t(`control.state.${control.state}`) : t('common.loading'))}`} placement="bottom">
            <StatusPill
              status="offline"
              label={<span className={cn('max-[1180px]:sr-only', compact && 'sr-only')}>{t('nav.status.adminOffline')}</span>}
              data-testid="status-control"
              data-state={control?.state ?? 'unknown'}
              tabIndex={0}
            />
          </Tooltip>
        )}
      </div>
      <div className="min-w-4 flex-1" />
      {/* Çentik durumu taşırken süren işi o gösterir; aynı bilgi şeritte yinelenmez. */}
      {jobs.length > 0 && !compact ? (
        <Tooltip content={jobs.map((job) => job.title).join(', ')} placement="bottom">
          <Badge tone="accent" icon={<Pulse weight="bold" />} data-testid="status-jobs" tabIndex={0} className="h-7 px-3 text-sm max-[1100px]:hidden">
            {label(t('nav.status.jobs', { count: jobs.length }))}
          </Badge>
        </Tooltip>
      ) : null}
      {watching.length > 0 ? (
        <Tooltip content={`${t('nav.status.watchHint')}: ${watching.map((job) => job.title).join(', ')}`} placement="bottom">
          <Badge
            tone="neutral"
            icon={<Binoculars weight="bold" />}
            data-testid="status-watch"
            data-count={watching.length}
            tabIndex={0}
            role="button"
            className="ui-no-drag h-7 cursor-pointer px-3 text-sm max-[1100px]:hidden"
            onClick={() => shell.navigate('watch')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                shell.navigate('watch');
              }
            }}
          >
            {label(t('nav.status.watch', { count: watching.length }))}
          </Badge>
        </Tooltip>
      ) : null}
      {/* Tek denetim: solda mikrofonu aç/kapat, sağda konuşmayı başlat. İki ayrı mikrofon simgesi yan yana durmaz. */}
      <div
        className={cn(
          'ui-no-drag flex h-9 shrink-0 items-center rounded-full bg-secondary shadow-[inset_0_0_0_1px_var(--color-line)]',
          muted && 'bg-danger-soft shadow-none',
        )}
        data-testid="talk-control"
      >
        <Tooltip content={muted ? t('voice.action.unmute') : t('voice.action.mute')} shortcut={muteKey ? acceleratorKeys(muteKey.accelerator) : undefined} placement="bottom">
          <button
            type="button"
            aria-label={muted ? t('voice.action.unmute') : t('voice.action.mute')}
            aria-pressed={muted}
            onClick={() => void attempt(() => window.fuber.invoke('voice.mute', { muted: !muted }))}
            data-testid="mic-toggle"
            className={cn(
              'flex size-9 cursor-pointer items-center justify-center rounded-full outline-offset-[-2px] transition-[background-color,color,transform] duration-(--duration-fast) ease-out active:scale-[0.94] [&_svg]:size-4.5',
              muted ? 'text-danger hover:bg-danger/20' : 'text-fg-muted hover:bg-secondary-hover hover:text-fg',
            )}
          >
            {muted ? <MicrophoneSlash weight="fill" /> : <Microphone weight="fill" />}
          </button>
        </Tooltip>
        <span aria-hidden className={cn('h-4 w-px', muted ? 'bg-danger/30' : 'bg-line-strong')} />
        {busy ? (
          // Asistan konuşuyor ya da çalışıyor: aynı yerde belirgin "Sustur / Durdur" (Esc de aynı işi görür).
          <Tooltip content={t('voice.action.stopHint')} shortcut={['Esc']} placement="bottom">
            <button
              type="button"
              onClick={stopVoice}
              data-testid="talk-stop"
              data-state={state}
              className={cn(
                'flex h-9 cursor-pointer items-center gap-2 rounded-full pr-3 pl-3 text-sm font-semibold outline-offset-[-2px]',
                'bg-danger text-white transition-[background-color,transform] duration-(--duration-fast) ease-out hover:bg-danger/90 active:scale-[0.97] [&_svg]:size-4',
              )}
            >
              {state === 'speaking' ? <SpeakerSlash weight="fill" /> : <Stop weight="fill" />}
              {state === 'speaking' ? t('voice.action.stop') : t('turn.stop')}
            </button>
          </Tooltip>
        ) : (
          <button
            type="button"
            disabled={talkDisabled}
            onClick={() => void attempt(() => window.fuber.invoke('voice.listen'))}
            data-testid="talk"
            className={cn(
              'flex h-9 cursor-pointer items-center gap-2 rounded-full pr-2.5 pl-3 text-sm font-medium outline-offset-[-2px]',
              'transition-[background-color,color,transform] duration-(--duration-fast) ease-out active:scale-[0.97]',
              'disabled:cursor-default disabled:active:scale-100',
              muted ? 'text-danger' : 'text-fg hover:bg-secondary-hover disabled:text-fg-faint',
            )}
          >
            {muted ? t('nav.status.voice.mic_off') : t('voice.action.listen')}
            {talk && !muted ? <KeyHint keys={acceleratorKeys(talk.accelerator)} size="sm" /> : null}
          </button>
        )}
      </div>
    </div>
  );
}
