import { ArrowClockwise, Code, DotsThree, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { t, type SkillInfo } from '@fuber/shared';
import { Badge, Button, IconButton, Menu, Spinner, Switch } from '@fuber/ui';
import { ADD_ICONS, ADD_LABELS } from '../../plugins/PreviewColumns';
import { addsBadges, type AddCounts } from '../../plugins/preview-logic';
import { PermissionSummary, StatusBadge } from './parts';

export interface SkillRowProps {
  skill: SkillInfo;
  hosts: string[];
  /** Kullanıcı bu içeriği onaylamış mı (reddedilen yetenek kapalı görünür ama anahtarla açılamaz). */
  approved: boolean;
  manual: boolean;
  draft: boolean;
  onToggle(enabled: boolean): Promise<void>;
  onRetry(): Promise<void>;
  onReview(): void;
  onShowCode(): void;
  onRemove(): void;
  /** Satır seçili: ayrıntısı bağlam sütununda açık. */
  selected?: boolean;
  onSelect?(): void;
  /** Ayrıntı yanda açıkken satır yalnız adı, durumu ve anahtarı taşır (açıklama ve izinler ayrıntıdadır). */
  compact?: boolean;
  /** Onay bekleyen güncellemenin sürümü (belirgin rozet). */
  updateVersion?: number;
  /** Ne eklediğinin sayıları; sıfır olanlar gösterilmez. */
  adds?: AddCounts;
}

/** Kullanıcının geliştirdiği bir yetenek: ad, durum, izin özeti, aç/kapat, kod, kaldır. */
export function SkillRow({ skill, hosts, approved, manual, draft, onToggle, onRetry, onReview, onShowCode, onRemove, selected, onSelect, compact, updateVersion, adds }: SkillRowProps) {
  const [busy, setBusy] = useState(false);
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } finally {
      setBusy(false);
    }
  };
  const toggleable = approved && (skill.status === 'enabled' || skill.status === 'disabled');
  const failed = skill.status === 'failed';
  const working = skill.status === 'testing' || skill.status === 'building';

  return (
    <div className={compact ? 'skl-own flex flex-col gap-2.5 px-3 py-2.5' : 'skl-own flex flex-col gap-3 px-3 py-3'} data-selected={selected || undefined} data-testid={`skills-row-${skill.id}`}>
      <div className="flex items-start gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h3 className="text-base font-medium text-fg">
              {onSelect ? (
                <button
                  type="button"
                  onClick={onSelect}
                  aria-pressed={selected ?? false}
                  className="cursor-pointer rounded-xs text-left outline-offset-2 transition-colors duration-(--duration-fast) hover:text-accent-fg"
                  data-testid={`skills-select-${skill.id}`}
                >
                  {skill.name}
                </button>
              ) : (
                skill.name
              )}
            </h3>
            <StatusBadge status={skill.status} />
            <span className="font-mono text-xs text-fg-faint tabular-nums" data-testid={`skills-version-${skill.id}`}>{`v${skill.version}`}</span>
            {updateVersion !== undefined && (
              <Badge tone="accent" size="sm" data-testid={`plugin-update-badge-${skill.id}`}>
                {t('pluginsUi.row.updateReady', { version: updateVersion })}
              </Badge>
            )}
            {!approved && skill.status === 'disabled' && <span className="text-xs text-fg-faint">{t('skills.card.unapproved')}</span>}
            {draft && <span className="text-xs text-fg-faint">{t('skills.card.draft')}</span>}
            {manual && !draft && <span className="text-xs text-fg-faint">{t('skills.card.manual')}</span>}
          </div>
          {skill.description && <p className="max-w-[72ch] text-sm text-fg-muted">{skill.description}</p>}
          {addsBadges(adds).length > 0 && (
            <ul className="plg-adds mt-1" aria-label={t('pluginsUi.row.adds')} data-testid={`plugin-adds-badges-${skill.id}`}>
              {addsBadges(adds).map(({ kind, count }) => {
                const Icon = ADD_ICONS[kind];
                return (
                  <li key={kind} className="plg-add" data-kind={kind}>
                    <Icon aria-hidden />
                    {t(`${ADD_LABELS[kind]}.count`, { count })}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {working && <Spinner size={16} label={t('skills.badge.testing')} className="mr-2" />}
          {toggleable && (
            <Switch
              checked={skill.status === 'enabled'}
              disabled={busy}
              onCheckedChange={(next) => void run(() => onToggle(next))}
              aria-label={t('skills.card.toggle', { name: skill.name })}
              className="mr-2"
              data-testid={`skills-toggle-${skill.id}`}
            />
          )}
          {!approved && skill.status === 'disabled' && (
            <Button size="sm" variant="secondary" onClick={onReview} className="mr-1">
              {t('skills.card.approve')}
            </Button>
          )}
          {failed && !draft && (
            <Button size="sm" variant="secondary" icon={<ArrowClockwise />} loading={busy} onClick={() => void run(onRetry)} className="mr-1">
              {t('skills.card.retry')}
            </Button>
          )}
          {/* Seyrek ve yıkıcı eylemler menüde: satırda sürekli açık çöp kutusu durmaz. */}
          <Menu
            placement="bottom-end"
            label={t('skills.card.more')}
            trigger={<IconButton icon={<DotsThree weight="bold" />} label={t('skills.card.more')} size="sm" tooltip={false} data-testid={`skills-more-${skill.id}`} />}
            items={[
              { id: 'code', label: t('skills.card.showCode'), icon: <Code />, onSelect: onShowCode },
              { type: 'separator', id: 'sep' },
              { id: 'remove', label: t('skills.card.remove'), icon: <Trash />, danger: true, onSelect: onRemove },
            ]}
          />
        </div>
      </div>

      {failed && skill.lastError && (
        <pre
          className="max-h-32 overflow-auto rounded-sm bg-danger-soft px-3 py-2.5 font-sans text-sm whitespace-pre-wrap text-fg"
          data-selectable
        >
          {skill.lastError}
        </pre>
      )}

      {!compact && !failed && skill.tools.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-fg-faint">
          <PermissionSummary permissions={skill.permissions} hosts={hosts} />
          <span className="tabular-nums">{t('skills.card.tools', { count: skill.tools.length })}</span>
        </div>
      )}
    </div>
  );
}
