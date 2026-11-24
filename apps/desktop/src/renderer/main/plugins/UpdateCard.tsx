import { ArrowFatLineUp } from '@phosphor-icons/react';
import { useState } from 'react';
import { t, type SkillInfo } from '@fuber/shared';
import { Button, Skeleton, Surface } from '@fuber/ui';
import { ChangesBlock, PreviewBody, usePreview } from './PreviewColumns';

export interface UpdateCardProps {
  skill: SkillInfo;
  update: { version: number; note: string | null };
  /** Yan bölmede ayrıntı açıkken kart yalnız kararı taşır (farklar yine görünür; iki sütun ayrıntıdadır). */
  compact?: boolean;
  onDecide(approve: boolean): Promise<void>;
  onShowCode(): void;
}

/**
 * Onay bekleyen güncelleme: farklar (yeni izinler ve katkılar vurgulu), ne ekleyecek, hangi izinler. Eski sürüm
 * karar verilene dek çalışmayı sürdürür; bu da kartta açıkça yazılır.
 */
export function UpdateCard({ skill, update, compact, onDecide, onShowCode }: UpdateCardProps) {
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const { data, state } = usePreview(skill.id, true);

  const decide = async (approve: boolean) => {
    setPending(approve ? 'approve' : 'reject');
    try {
      await onDecide(approve);
    } finally {
      setPending(null);
    }
  };

  return (
    <Surface level={1} radius="md" data-attention="" className="flex flex-col gap-4 p-5" data-testid="plugin-update-card" data-skill={skill.id}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 max-w-[68ch] flex-col gap-1">
          <h3 className="flex items-center gap-2.5 text-xl font-semibold tracking-tight text-fg">
            <ArrowFatLineUp weight="fill" className="size-5 shrink-0 text-accent-fg" aria-hidden />
            {t('pluginsUi.update.ready', { version: update.version })}
          </h3>
          <p className="text-base text-fg">
            {skill.name}
            {update.note ? <span className="text-fg-muted">{`: ${update.note}`}</span> : null}
          </p>
        </div>
      </div>
      <p className="text-sm text-fg-muted">{t('pluginsUi.update.oldKeepsRunning', { version: skill.version })}</p>

      {data && <ChangesBlock preview={data} />}
      {!compact &&
        (data ? <PreviewBody preview={data} /> : state.status === 'loading' ? <Skeleton shape="text" lines={3} /> : null)}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        <Button variant="primary" loading={pending === 'approve'} disabled={pending === 'reject'} onClick={() => void decide(true)} data-testid="plugin-update-approve">
          {t('pluginsUi.update.apply')}
        </Button>
        <Button variant="secondary" loading={pending === 'reject'} disabled={pending === 'approve'} onClick={() => void decide(false)} data-testid="plugin-update-reject">
          {t('pluginsUi.update.discard')}
        </Button>
        <Button variant="ghost" onClick={onShowCode}>
          {t('skills.card.showCode')}
        </Button>
      </div>
    </Surface>
  );
}
