// Canlı satır ve ana pencerenin canlı çentiği. Ana pencere odaktayken yüzen ada gizlenir ve durumu (dinliyor,
// düşünüyor, konuşuyor, araç çalışıyor, onay bekliyor, bilgisayarı kullanıyor + Durdur/Sustur) bu çentik gösterir: ada
// ile aynı model ve aynı görünüm (`hud/island-model.ts`, `hud/IslandView.tsx`). Odak gidince ada geri gelir, çentik
// boştaki küçük işaretine döner (`hud.owner`).
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { t } from '@fuber/shared';
import { FuberMark, cn, type IslandShellHandle } from '@fuber/ui';
import { IslandView, expandable } from '../../hud/IslandView';
import { HOVER_LINGER_MS } from '../../hud/hover';
import { useIslandModel } from '../../hud/island-model';
import { currentSentence, tailWords, thinkingLine } from '../../shared/live-text';
import type { AssistantLive } from './assistant-live';

export interface LiveText {
  /** İçeriğin kimliği: değişince satır yumuşakça yenilenir. `null`: söylenecek bir şey yok. */
  key: string | null;
  strong?: string;
  dim?: string;
  /** Konuşulan cümle: sözcükler söylendikçe belirir. */
  words?: string[];
  num?: string;
  tone?: 'warning' | 'danger' | 'muted';
}

/** Canlı satırın metni. `idleLast`: boştayken son söylenen cümle soluk gösterilsin mi (Takımyıldız'da evet). */
export function liveText(live: AssistantLive, options: { idleLast: boolean; followup: boolean; maxChars?: number }): LiveText {
  const max = options.maxChars ?? 46;
  switch (live.presence) {
    case 'listening':
      return live.user ? { key: 'heard', strong: tailWords(live.user, max) } : { key: 'listen', strong: t('hud.island.listening') };
    case 'followup':
      return options.followup ? { key: 'follow', dim: t('hud.island.followup') } : { key: null };
    case 'thinking':
      return { key: 'think', strong: thinkingLine(live.toolModule), dim: live.user ? tailWords(live.user, max) : undefined };
    case 'speaking': {
      if (!live.assistant) return { key: 'speak', dim: t('hud.island.speaking') };
      const sentence = currentSentence(live.assistant, 96);
      return { key: `say:${sentence.index}`, words: sentence.text.split(/\s+/) };
    }
    case 'muted':
      return { key: 'mic', strong: t('hud.island.micOff'), tone: 'muted' };
    case 'approval':
      return { key: 'approval', strong: t('nav.live.approval'), tone: 'warning' };
    case 'job': {
      const job = live.jobs[0];
      if (!job) return { key: null };
      return {
        key: `job:${job.id}`,
        strong: job.title,
        dim: live.jobs.length > 1 ? t('nav.live.moreJobs', { count: live.jobs.length - 1 }) : job.step || undefined,
        num: job.progress !== null ? `%${Math.round(Math.min(1, Math.max(0, job.progress)) * 100)}` : undefined,
      };
    }
    case 'error':
      return { key: 'error', strong: t('nav.status.voiceUnavailable'), tone: 'danger' };
    default:
      return options.idleLast && live.lastSaid ? { key: 'last', dim: currentSentence(live.lastSaid, 96).text, tone: 'muted' } : { key: null };
  }
}

function Words({ words }: { words: string[] }) {
  return (
    <>
      {words.map((word, index) => (
        <span key={index} className="live-word">
          {word}{' '}
        </span>
      ))}
    </>
  );
}

/** Satırın içeriği (çentik ve alt yazı aynı parçaları kullanır). */
export function LiveContent({ text }: { text: LiveText }): ReactNode {
  if (text.words) return <Words words={text.words} />;
  return (
    <>
      {text.strong ? (
        <span className={cn('live-strong', text.tone === 'warning' && 'text-warning', text.tone === 'danger' && 'text-danger')}>{text.strong}</span>
      ) : null}
      {text.dim ? <span className="live-dim">{text.dim}</span> : null}
      {text.num ? <span className="live-num">{text.num}</span> : null}
    </>
  );
}

/**
 * Ana pencerenin canlı çentiği: pencerenin üst kenarına kaynaklıdır. Boşta yalnız küçük işaret (tıklanınca dinler);
 * ana pencere adanın sahibiyken (odakta) durumu taşıyacak kadar genişler, imleç üstündeyken hızlı denetimleri açar.
 * Pencere odakta değilken durum yüzen adadadır: çentik boşta kalır (iki yerde birden görünmez).
 */
export function WindowNotch({ owner, onActivate, onWide }: { owner: 'main' | 'island'; onActivate?: () => void; onWide?: (wide: boolean) => void }) {
  const shellRef = useRef<IslandShellHandle>(null);
  const model = useIslandModel(() => shellRef.current?.wake());
  const live = owner === 'main';
  const view = live ? model.view : null;
  const [inside, setInside] = useState(false);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (inside) {
      setHover(true);
      return;
    }
    const timer = setTimeout(() => setHover(false), HOVER_LINGER_MS);
    return () => clearTimeout(timer);
  }, [inside]);
  const wide = useRef(false);
  const shown = { ...model, view, onHover: (on: boolean) => (model.onHover(on), setInside(on)) };
  return (
    <div className="window-notch" data-testid="window-notch" data-owner={owner} data-kind={view?.kind ?? 'idle'}>
      <IslandView
        model={shown}
        variant="window"
        hover={hover && expandable(view)}
        idle={
          <span className="wn-idle" title={t('today.core.talk')}>
            <FuberMark size={15} />
          </span>
        }
        bodyTestId="window-notch-body"
        onActivate={onActivate}
        shellRef={shellRef}
        onTarget={({ width }) => {
          const next = width > 240;
          if (next !== wide.current) {
            wide.current = next;
            onWide?.(next);
          }
        }}
      />
    </div>
  );
}
