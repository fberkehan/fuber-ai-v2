import { BellSimple, GlobeSimple, LockSimple, ShieldCheck, Warning } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { t, type MessageKey, type Permission, type Risk, type SkillStatus, type ToolInfo } from '@fuber/shared';
import { Badge, cn, type Tone } from '@fuber/ui';

const STATUS: Record<SkillStatus, { key: MessageKey; tone: Tone }> = {
  building: { key: 'skills.badge.building', tone: 'accent' },
  testing: { key: 'skills.badge.testing', tone: 'accent' },
  pending_approval: { key: 'skills.badge.pending', tone: 'warning' },
  enabled: { key: 'skills.badge.enabled', tone: 'success' },
  disabled: { key: 'skills.badge.disabled', tone: 'neutral' },
  failed: { key: 'skills.badge.failed', tone: 'danger' },
};

export function StatusBadge({ status }: { status: SkillStatus }) {
  const { key, tone } = STATUS[status];
  return (
    <Badge tone={tone} dot>
      {t(key)}
    </Badge>
  );
}

const RISK: Record<Risk, { key: MessageKey; tone: Tone }> = {
  read: { key: 'skills.risk.read', tone: 'neutral' },
  write: { key: 'skills.risk.write', tone: 'neutral' },
  danger: { key: 'skills.risk.danger', tone: 'danger' },
};

/** `localhost` ya da IP ile yazılmış adres: yetenek bu bilgisayara ya da yerel ağa istek atabilir. */
export const isLocalHost = (host: string) => /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/.test(host);

function PermissionRow({ icon, title, tone, children }: { icon: ReactNode; title: string; tone?: 'warning'; children?: ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        className={cn(
          'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-4 [&_svg]:size-4',
          tone === 'warning' ? 'text-warning' : 'text-fg-muted',
        )}
      >
        {icon}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-medium text-fg">{title}</span>
        <div className="text-sm text-fg-muted">{children}</div>
      </div>
    </li>
  );
}

/** Yeteneğin istediği izinler ve gidebileceği adresler; neye erişemeyeceği de açıkça yazılır. */
export function PermissionList({ permissions, hosts }: { permissions: Permission[]; hosts: string[] }) {
  const net = permissions.includes('net');
  const notify = permissions.includes('notify');
  const local = hosts.some(isLocalHost);
  return (
    <ul className="flex flex-col gap-3.5">
      {!net && !notify && (
        <PermissionRow icon={<ShieldCheck />} title={t('skills.permission.none')}>
          {t('skills.permission.none.detail')}
        </PermissionRow>
      )}
      {net && (
        <PermissionRow icon={local ? <Warning /> : <GlobeSimple />} title={t('skills.permission.net')} tone={local ? 'warning' : undefined}>
          <span>{t('skills.permission.net.detail')}</span>
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            {hosts.map((host) => (
              <code key={host} className="rounded-xs bg-surface-4 px-1.5 py-0.5 font-mono text-xs text-fg" data-selectable>
                {host}
              </code>
            ))}
          </span>
          {local && <span className="mt-1.5 block text-warning">{t('skills.permission.net.local')}</span>}
        </PermissionRow>
      )}
      {notify && (
        <PermissionRow icon={<BellSimple />} title={t('skills.permission.notify')}>
          {t('skills.permission.notify.detail')}
        </PermissionRow>
      )}
      <li className="flex items-center gap-3 text-sm text-fg-faint">
        <span className="flex size-7 shrink-0 items-center justify-center [&_svg]:size-4">
          <LockSimple />
        </span>
        {t('skills.permission.always')}
      </li>
    </ul>
  );
}

/** Yeteneğin kayda sokacağı araçlar: ad, risk ve modele giden açıklama. */
export function ToolList({ tools }: { tools: ToolInfo[] }) {
  return (
    <ul className="flex flex-col gap-3.5">
      {tools.map((tool) => (
        <li key={tool.name} className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <code className="font-mono text-xs text-fg" data-selectable>
              {tool.name}
            </code>
            <Badge tone={RISK[tool.risk].tone} size="sm">
              {t(RISK[tool.risk].key)}
            </Badge>
          </div>
          <p className="text-sm text-fg-muted">{tool.description}</p>
        </li>
      ))}
    </ul>
  );
}

/** Kartların alt satırındaki kısa izin özeti. */
export function PermissionSummary({ permissions, hosts }: { permissions: Permission[]; hosts: string[] }) {
  const net = permissions.includes('net');
  const notify = permissions.includes('notify');
  if (!net && !notify) {
    return (
      <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5">
        <ShieldCheck />
        {t('skills.permission.none')}
      </span>
    );
  }
  return (
    <>
      {net && (
        <span className="inline-flex min-w-0 items-center gap-1.5 [&_svg]:size-3.5 [&_svg]:shrink-0">
          <GlobeSimple />
          <span className="truncate font-mono">{hosts.join(', ')}</span>
        </span>
      )}
      {notify && (
        <span className="inline-flex items-center gap-1.5 [&_svg]:size-3.5">
          <BellSimple />
          {t('skills.permission.notify')}
        </span>
      )}
    </>
  );
}
