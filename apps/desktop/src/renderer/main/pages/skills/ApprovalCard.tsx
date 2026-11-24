import { Code, Warning } from '@phosphor-icons/react';
import { useState } from 'react';
import { t, type SkillInfo } from '@fuber/shared';
import { Button, Surface } from '@fuber/ui';
import { PreviewColumns } from '../../plugins/PreviewColumns';
import { PermissionList, StatusBadge, ToolList } from './parts';

export interface ApprovalBodyProps {
  skill: SkillInfo;
  hosts: string[];
}

/** Önizleme alınamazsa eski görünüm: istenen izinler ve eklenecek araçlar, yan yana. */
function LegacyBody({ skill, hosts }: ApprovalBodyProps) {
  return (
    <div className="grid gap-x-10 gap-y-6 md:grid-cols-2">
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-medium text-fg-faint">{t('skills.pending.permissions')}</h4>
        <PermissionList permissions={skill.permissions} hosts={hosts} />
      </div>
      <div className="flex flex-col gap-3">
        <h4 className="text-sm font-medium text-fg-faint">{t('skills.pending.tools')}</h4>
        <ToolList tools={skill.tools} />
      </div>
    </div>
  );
}

/** Onay kararının dayandığı bilgi: "Ne ekleyecek" ve "Hangi izinler", iki sütun (`workshop.preview`). */
export function ApprovalBody({ skill, hosts }: ApprovalBodyProps) {
  return <PreviewColumns id={skill.id} fallback={<LegacyBody skill={skill} hosts={hosts} />} />;
}

export interface ApprovalCardProps extends ApprovalBodyProps {
  manual: boolean;
  /** İzinler ve araçlar yandaki ayrıntıda gösteriliyor: kart yalnız kararı taşır. */
  compact?: boolean;
  onDecide(approve: boolean): Promise<void>;
  onShowCode(): void;
}

/** Onay bekleyen yetenek. Sayfanın en üstünde durur ve ekrandaki tek birincil düğmeyi taşır. */
export function ApprovalCard({ skill, hosts, manual, compact, onDecide, onShowCode }: ApprovalCardProps) {
  const [pending, setPending] = useState<'approve' | 'reject' | null>(null);
  const decide = async (approve: boolean) => {
    setPending(approve ? 'approve' : 'reject');
    try {
      await onDecide(approve);
    } finally {
      setPending(null);
    }
  };

  return (
    // Dikkat kartı: ortak dildeki kehribar kıl payı çerçeve ve üstten hafif ışık (kalın kenar çizgisi yok).
    <Surface level={1} radius="md" data-attention="" className="flex flex-col gap-4 p-5" data-testid={`skills-approval-${skill.id}`}>
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 max-w-[68ch] flex-col gap-1">
          <h3 className="text-xl font-semibold tracking-tight text-fg">{skill.name}</h3>
          <p className="text-base text-fg-muted">{skill.description}</p>
        </div>
        <StatusBadge status={skill.status} />
      </div>

      {/* Elle eklenen yetenekte uyarı kartın en okunur satırıdır; "Kodu göster" kararın hemen yanındadır. */}
      {manual ? (
        <p className="flex items-start gap-2 text-sm text-warning">
          <Warning weight="fill" className="mt-0.5 size-4 shrink-0" aria-hidden />
          {t('skills.pending.manual')}
        </p>
      ) : (
        <p className="text-sm text-fg-muted">{t('skills.pending.lead')}</p>
      )}

      {!compact && <ApprovalBody skill={skill} hosts={hosts} />}

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-4">
        {/* Birincil eylem beyaz hap ve solda; olumsuz eylem hemen sağında koyu hap. */}
        <Button
          variant="primary"
          loading={pending === 'approve'}
          disabled={pending === 'reject'}
          onClick={() => void decide(true)}
          data-testid={`skills-approve-${skill.id}`}
        >
          {t('skills.pending.approve')}
        </Button>
        <Button variant="secondary" loading={pending === 'reject'} disabled={pending === 'approve'} onClick={() => void decide(false)}>
          {t('skills.pending.reject')}
        </Button>
        <Button variant="ghost" icon={<Code />} onClick={onShowCode}>
          {t('skills.card.showCode')}
        </Button>
      </div>
    </Surface>
  );
}
