// Jarvis'in ana penceredeki canlı hâli: ne duydu, ne söylüyor, hangi aracı kullanıyor, ne bekliyor, ne sürüyor.
// Kabuk bir kez toplar; Bugün'ün başındaki varlık ve başlık şeridi okur.
import { useEffect, useRef, useState } from 'react';
import type { ApprovalRequest, Job, VoiceStatus } from '@fuber/shared';
import type { PresenceState } from '@fuber/ui';
import { useEvent } from './live';

export interface AssistantLive {
  /** Varlığın hâli: ses durumu; boştayken bekleyen onay ya da süren iş varsa onlar. */
  presence: PresenceState;
  /** Kullanıcının yazıya dökülen sözü (dinlerken ve düşünürken). */
  user: string;
  /** Jarvis'in o an söylediği. */
  assistant: string;
  /** Son söylenen cümle (boştayken canlı satırda soluk durur). */
  lastSaid: string;
  /** Düşünürken çalışan aracın modülü. */
  toolModule: string | null;
  approvals: ApprovalRequest[];
  /** Süren arka plan işleri (en yenisi başta). */
  jobs: Job[];
}

export function useAssistantLive(voice: VoiceStatus | null): AssistantLive {
  const [text, setText] = useState({ user: '', assistant: '', lastSaid: '' });
  const [toolModule, setToolModule] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const tools = useRef(new Map<string, string>());

  useEffect(() => {
    void window.fuber.invoke('attention.pending').then(
      (pending) => setApprovals(pending.approvals),
      () => {},
    );
    void window.fuber.invoke('jobs.list', { status: 'running', limit: 8 }).then(setJobs, () => {});
  }, []);

  useEvent('voice.state', ({ state, prev }) => {
    setText((current) => {
      // Tur bitince söylenen son cümle kalır; yeni dinleme turu yazıları siler.
      if (state === 'idle' || state === 'mic_off') return { user: '', assistant: '', lastSaid: current.assistant || current.lastSaid };
      if (state === 'listening' && prev !== 'listening') return { user: '', assistant: '', lastSaid: current.assistant || current.lastSaid };
      return current;
    });
    if (state !== 'thinking') {
      tools.current.clear();
      setToolModule(null);
    }
  });
  useEvent('voice.partial', ({ role, text: next }) =>
    setText((current) => (role === 'user' ? { ...current, user: next } : { ...current, assistant: next })),
  );
  useEvent('tool.call', ({ callId, moduleId, phase }) => {
    if (phase === 'start') tools.current.set(callId, moduleId);
    else tools.current.delete(callId);
    setToolModule([...tools.current.values()].at(-1) ?? null);
  });
  useEvent('tool.approval.request', (request) => setApprovals((list) => [...list.filter((item) => item.id !== request.id), request]));
  useEvent('tool.approval.resolve', ({ id }) => setApprovals((list) => list.filter((item) => item.id !== id)));
  useEvent('job.progress', ({ job }) =>
    setJobs((list) => {
      const rest = list.filter((item) => item.id !== job.id);
      return job.status === 'running' ? [job, ...rest] : rest;
    }),
  );

  const state = voice?.state ?? 'idle';
  const presence: PresenceState =
    state === 'mic_off'
      ? 'muted'
      : state !== 'idle'
        ? state
        : approvals.length > 0
          ? 'approval'
          : jobs.length > 0
            ? 'job'
            : voice && !voice.ready && voice.lastError
              ? 'error'
              : 'idle';

  return { presence, ...text, toolModule, approvals, jobs };
}
