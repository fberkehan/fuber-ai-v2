/**
 * Adanın modeli: olaylardan "şu an ne gösterilir" kararını ve eylemleri üretir. İki yüzey aynı modeli kullanır:
 * yüzen ada (`Island.tsx`, kendi penceresinde) ve ana pencerenin canlı çentiği (`main/shell/LiveLine.tsx`). Hangisinin
 * görüneceğine ana süreç karar verir (`hud.owner`); model ikisinde de her an günceldir, böylece sahip değişirken
 * onay kartı gibi etkileşim gerektiren içerik kaybolmaz ve geçişte boş kare kalmaz.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { t, type ApprovalRequest, type JobActivity, type Notification, type Settings, type VoiceState, type VoiceStatus } from '@fuber/shared';
import { usePausableTimer } from './envelope';
import type { View } from './IslandView';
import { acceleratorKeys } from './parts';
import type { PcActivity } from '../../main/modules/pc/types';
import { eventually, quiet, useEvent } from './use-hud';

/** Eylemsiz bildirim adada bu kadar kalır; eylemli olan kullanıcı karar verebilsin diye daha uzun. */
const NOTICE_MS = 10_000;
const NOTICE_WITH_ACTIONS_MS = 30_000;
const BANNER_MS = 8_000;
const MIC_OFF_FLASH_MS = 4_000;
const ERROR_MS = 5_000;
/** Bilgi satırı (bulut ses yerine yerel ses gibi) biraz daha uzun kalır: okunacak bir cümledir, hata değil. */
const INFO_MS = 7_000;
/** "Kontrol sizde; durdum" / "Durduruldu" satırı bu kadar kalır. */
const PC_INTERRUPTED_MS = 4_000;
/** Uyanış: gövde üst kenardan damla gibi doğar, sonra dinleme satırına açılır. */
const WAKE_MS = 460;

export interface IslandModel {
  view: View | null;
  user: string;
  assistant: string;
  assistantName: string;
  conversation: boolean;
  toolModule: string | null;
  step: string | null;
  fullAuthority: boolean;
  muteKeys: string[];
  panicKeys: string[];
  micMuted: boolean;
  noticeLeft: number;
  motionSetting: Settings['reducedMotion'];
  getLevel: () => number;
  /** İmleç gövdenin üstünde: bildirimin süresi durur. */
  onHover(inside: boolean): void;
  resolve(id: string, approve: boolean, scope?: 'task'): void;
  retry(): void;
  act(id: string, actionId: string): void;
  dismiss(id: string): void;
  endConversation(): void;
  toggleMic(): void;
  stopSpeaking(): void;
  startConversation(): void;
  openMain(): void;
  stopPc(): void;
}

/**
 * Öncelik: onay > bildirim > yönetim iletisi > ses hatası > bilgisayar kullanımı > ses durumu > arka plan işi >
 * toplantı kaydı > "mikrofon kapalı" bilgisi. `wake`: genlik ya da bilgisayar eylemi geldi, kare döngüsü uyansın.
 */
export function useIslandModel(wake: () => void): IslandModel {
  const [motionSetting, setMotionSetting] = useState<Settings['reducedMotion']>('system');
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [notice, setNotice] = useState<Notification | null>(null);
  const [banner, setBanner] = useState<{ title: string; body: string } | null>(null);
  const [error, setError] = useState<{ message: string; at: number; info: boolean; retry: boolean } | null>(null);
  const [voice, setVoice] = useState<{ state: VoiceState; user: string; assistant: string }>({ state: 'idle', user: '', assistant: '' });
  const [status, setStatus] = useState<Pick<VoiceStatus, 'conversation' | 'micMuted'> & { meeting: boolean }>({
    conversation: false,
    micMuted: false,
    meeting: false,
  });
  const [micOffFlash, setMicOffFlash] = useState(false);
  const [waking, setWaking] = useState(false);
  const [pc, setPc] = useState<PcActivity | null>(null);
  const [jobs, setJobs] = useState<JobActivity | null>(null);
  const [toolModule, setToolModule] = useState<string | null>(null);
  const [step, setStep] = useState<string | null>(null);
  const [fullAuthority, setFullAuthority] = useState(false);
  const [muteKeys, setMuteKeys] = useState<string[]>(['Ctrl', 'Alt', 'M']);
  const [panicKeys, setPanicKeys] = useState<string[]>(['Ctrl', 'Alt', 'Q']);
  const [assistantName, setAssistantName] = useState('Jarvis');
  const wakeRef = useRef(wake);
  wakeRef.current = wake;

  // Genlik React çizimi olmadan varlığa akar (her karede okunur).
  const level = useRef({ mic: 0, speaker: 0 });
  const voiceState = useRef<VoiceState>('idle');
  voiceState.current = voice.state;
  const tools = useRef(new Map<string, string>());
  /** Bilgisayar kullanımında son eylemin anı (varlığın vuruşu için). */
  const pcBeat = useRef({ active: false, at: 0 });

  const applyHotkeys = (hotkeys: { mute?: string; panic?: string }) => {
    if (hotkeys.mute !== undefined) setMuteKeys(hotkeys.mute ? acceleratorKeys(hotkeys.mute) : []);
    if (hotkeys.panic !== undefined) setPanicKeys(hotkeys.panic ? acceleratorKeys(hotkeys.panic) : []);
  };

  useEffect(() => {
    let mounted = true;
    const alive = () => mounted;
    // Ada sayfası açılışta önceden yüklenir: kanallar bağlanana kadar okuma yinelenir.
    void eventually(() => window.fuber.invoke('settings.get'), alive).then((settings) => {
      if (settings && mounted) setMotionSetting(settings.reducedMotion);
    });
    void eventually(() => window.fuber.invoke('attention.pending'), alive).then((pending) => {
      if (!pending || !mounted) return;
      setApprovals(pending.approvals);
      const shown = pending.notifications.find((item) => item.status === 'shown' && (item.channel === 'voice' || item.channel === 'island'));
      if (shown) setNotice(shown);
    });
    void eventually(() => window.fuber.invoke('voice.status'), alive).then((current) => {
      if (!current || !mounted) return;
      setVoice((previous) => ({ ...previous, state: current.state }));
      setStatus({ conversation: current.conversation, micMuted: current.micMuted, meeting: current.meeting?.on === true });
    });
    // Ada açılmadan önce başlamış derin iş de görünsün.
    void eventually(() => window.fuber.invoke('jobs.activity'), alive).then((activity) => {
      if (activity?.current && mounted) setJobs(activity);
    });
    void eventually(() => window.fuber.invoke('settings.hotkeys'), alive).then((hotkeys) => {
      if (!hotkeys || !mounted) return;
      applyHotkeys({
        mute: hotkeys.find((hotkey) => hotkey.id === 'mute')?.accelerator,
        panic: hotkeys.find((hotkey) => hotkey.id === 'panic')?.accelerator,
      });
    });
    void eventually(() => window.fuber.invoke('authority.get'), alive).then((authority) => {
      if (authority && mounted) setFullAuthority(authority.level === 'full');
    });
    void eventually(() => window.fuber.invoke('settings.policy'), alive).then((policy) => {
      if (policy && mounted) setAssistantName(policy.persona.name);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEvent('tool.approval.request', (request) => setApprovals((list) => [...list.filter((item) => item.id !== request.id), request]));
  useEvent('tool.approval.resolve', ({ id }) => setApprovals((list) => list.filter((item) => item.id !== id)));
  useEvent('attention.notify', ({ notification, channel }) => {
    if (channel === 'voice' || channel === 'island') setNotice(notification);
  });
  useEvent('attention.dismiss', ({ id }) => setNotice((current) => (current?.id === id ? null : current)));
  useEvent('voice.state', ({ state, prev }) => {
    setVoice((current) => {
      if (state === 'idle' || state === 'mic_off') return { state, user: '', assistant: '' };
      // Yeni bir dinleme turu eski yazıyı siler; düşünürken ve konuşurken kullanıcının sözü kalır.
      if (state === 'listening' && prev !== 'listening') return { state, user: '', assistant: '' };
      return { ...current, state };
    });
    if (state === 'mic_off') setMicOffFlash(true);
    // Uyanış yalnız boştan dinlemeye geçerken oynar (takipten dönen dinleme zaten ekrandadır).
    if (state === 'listening' && (prev === 'idle' || prev === 'mic_off')) setWaking(true);
    if (state !== 'thinking') {
      tools.current.clear();
      setToolModule(null);
      setStep(null);
    }
    if (state !== 'speaking') level.current.speaker = 0;
    if (state !== 'listening' && state !== 'followup') level.current.mic = 0;
    wakeRef.current();
  });
  useEvent('voice.status', (current) =>
    setStatus({ conversation: current.conversation, micMuted: current.micMuted, meeting: current.meeting?.on === true }),
  );
  useEvent('voice.partial', ({ role, text }) =>
    setVoice((current) => (role === 'user' ? { ...current, user: text } : { ...current, assistant: text })),
  );
  // Düşünürken süren araç adımı: "Planlara bakıyorum". Birden çok araç sürüyorsa en son başlayan gösterilir.
  useEvent('tool.call', ({ callId, moduleId, phase }) => {
    if (phase === 'start') tools.current.set(callId, moduleId);
    else tools.current.delete(callId);
    setToolModule([...tools.current.values()].at(-1) ?? null);
  });
  // Bilgisayar kullanımı: sürerken satır kalır; kesildiyse nedeni kısa süre gösterilir; olağan bitişte hemen kalkar.
  useEvent('pc.activity', (activity) => {
    setPc(activity.active || activity.interrupted ? activity : null);
    // Her eylem (tıklama, yazma, pencere değiştirme) varlığa bir vuruş verir (döngü değil; olay gelmezse sakinleşir).
    pcBeat.current = { active: activity.active, at: performance.now() };
    wakeRef.current();
  });
  // Derin işin ilerlemesi: iş sürdükçe satır kalır; son iş bitince kalkar (bitişi bildirim olarak ayrıca gelir).
  useEvent('job.activity', (activity) => setJobs(activity.current ? activity : null));
  // Süren sesli turun canlı adımı ("“WhatsApp” açılıyor"); tur bitince `step: null`.
  useEvent('voice.activity', ({ step: current }) => setStep(current));
  useEvent('authority.changed', ({ level: current }) => setFullAuthority(current === 'full'));
  useEvent('voice.error', ({ message, level: severity, retry }) => setError({ message, at: Date.now(), info: severity === 'info', retry: retry === true && severity !== 'info' }));
  useEvent('voice.level', ({ source, rms }) => {
    level.current[source] = rms;
    wakeRef.current();
  });
  useEvent('policy.changed', ({ changedKeys }) => {
    if (changedKeys.includes('persona')) {
      void quiet(window.fuber.invoke('settings.policy')).then((policy) => policy && setAssistantName(policy.persona.name));
    }
    if (!changedKeys.includes('killSwitch')) return;
    void quiet(window.fuber.invoke('app.status')).then((current) => {
      if (current?.killSwitch.active) {
        setBanner({ title: t('app.killSwitch.title'), body: current.killSwitch.message ?? t('app.killSwitch.body') });
      } else {
        setBanner(null);
      }
    });
  });
  useEvent('settings.changed', ({ settings, changedKeys }) => {
    if (changedKeys.includes('hotkeys')) applyHotkeys(settings.hotkeys);
    if (changedKeys.includes('reducedMotion')) setMotionSetting(settings.reducedMotion);
  });

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), BANNER_MS);
    return () => clearTimeout(timer);
  }, [banner]);
  useEffect(() => {
    if (!micOffFlash) return;
    const timer = setTimeout(() => setMicOffFlash(false), MIC_OFF_FLASH_MS);
    return () => clearTimeout(timer);
  }, [micOffFlash]);
  useEffect(() => {
    if (!waking) return;
    const timer = setTimeout(() => setWaking(false), WAKE_MS);
    return () => clearTimeout(timer);
  }, [waking]);
  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(() => setError(null), error.info || error.retry ? INFO_MS : ERROR_MS);
    return () => clearTimeout(timer);
  }, [error]);
  useEffect(() => {
    if (!pc || pc.active) return;
    const timer = setTimeout(() => setPc(null), PC_INTERRUPTED_MS);
    return () => clearTimeout(timer);
  }, [pc]);

  const noticeMs = notice && notice.actions.length > 0 ? NOTICE_WITH_ACTIONS_MS : NOTICE_MS;
  const noticeActive = notice !== null && approvals.length === 0;
  const noticeTimer = usePausableTimer(noticeActive, noticeMs, () => setNotice(null), notice?.id);
  // Bildirimin kalan süresi (ışık bunu gösterir): çeyrek saniyede bir; üstüne gelince durur.
  const [noticeLeft, setNoticeLeft] = useState(1);
  const noticeClock = useRef({ left: noticeMs, paused: false });
  useEffect(() => {
    if (!noticeActive) return;
    noticeClock.current = { left: noticeMs, paused: false };
    setNoticeLeft(1);
    const tick = setInterval(() => {
      const clock = noticeClock.current;
      if (clock.paused) return;
      clock.left = Math.max(0, clock.left - 250);
      setNoticeLeft(clock.left / noticeMs);
    }, 250);
    return () => clearInterval(tick);
  }, [noticeActive, notice?.id, noticeMs]);

  const view = useMemo<View | null>(() => {
    const approval = approvals[0];
    if (approval) return { kind: 'approval', approval };
    if (notice) return { kind: 'notice', notice };
    if (banner) return { kind: 'banner', ...banner };
    if (error) return error.info ? { kind: 'info', message: error.message } : { kind: 'error', message: error.message, retry: error.retry };
    if (pc) return { kind: 'pc', activity: pc };
    if (voice.state === 'listening' || voice.state === 'thinking' || voice.state === 'speaking' || voice.state === 'followup') {
      if (waking && voice.state === 'listening' && !voice.user) return { kind: 'wake' };
      return { kind: 'voice', state: voice.state };
    }
    if (jobs?.current) return { kind: 'job', activity: jobs };
    if (voice.state === 'mic_off' && micOffFlash) return { kind: 'micOff' };
    if (status.meeting) return { kind: 'meeting' };
    return null;
  }, [approvals, notice, banner, error, pc, voice.state, voice.user, waking, jobs, micOffFlash, status.meeting]);

  const getLevel = useCallback(() => {
    const beat = pcBeat.current;
    if (beat.active) return 0.5 * Math.exp(-(performance.now() - beat.at) / 260);
    const state = voiceState.current;
    return state === 'speaking' ? level.current.speaker : state === 'listening' || state === 'followup' ? level.current.mic : 0;
  }, []);

  return {
    view,
    user: voice.user,
    assistant: voice.assistant,
    assistantName,
    conversation: status.conversation && view?.kind === 'voice',
    toolModule,
    step,
    fullAuthority,
    muteKeys,
    panicKeys,
    micMuted: status.micMuted,
    noticeLeft,
    motionSetting,
    getLevel,
    onHover: (inside) => {
      noticeClock.current.paused = inside;
      if (inside) noticeTimer.pause();
      else noticeTimer.resume();
    },
    resolve: (id, approve, scope) => {
      setApprovals((list) => list.filter((item) => item.id !== id));
      void quiet(window.fuber.invoke('attention.resolveApproval', scope ? { id, approve, scope } : { id, approve }));
    },
    // "Yeniden dene": hata kapanır, söz yinelenir (yinelenecek söz yoksa ana süreç hata fırlatır; `quiet` yutar).
    retry: () => {
      setError(null);
      void quiet(window.fuber.invoke('voice.retry'));
    },
    act: (id, actionId) => {
      setNotice(null);
      void quiet(window.fuber.invoke('attention.act', { id, actionId }));
    },
    // Kartın ✕'i: kart kapanır VE konuşma susar (duyuru dahil); hat boşa döner, çentik kalmaz (d10, `attention.hush`).
    dismiss: (id) => {
      setNotice(null);
      void quiet(window.fuber.invoke('attention.hush', { id }));
    },
    endConversation: () => void quiet(window.fuber.invoke('voice.endConversation')),
    toggleMic: () => void quiet(window.fuber.invoke('voice.mute', { muted: !status.micMuted })),
    stopSpeaking: () => void quiet(window.fuber.invoke('voice.stop')),
    startConversation: () => void quiet(window.fuber.invoke('voice.startConversation')),
    openMain: () => void quiet(window.fuber.invoke('app.openMain', {})),
    stopPc: () => void quiet(window.fuber.invoke('pc.stop')),
  };
}
