// Fark görünümü (v1 `FarkGorunumu.tsx`): iki numara sütunu, +/− işareti, renkli satır. Uzun fark katlanır.
import { useState } from 'react';
import { t } from '@fuber/shared';
import { cn } from '@fuber/ui';
import type { DiffLine } from './diff';

const SIGN: Record<DiffLine['kind'], string> = { same: ' ', add: '+', del: '−' };

export function DiffView({ lines, limit = 40, className }: { lines: readonly DiffLine[]; limit?: number; className?: string }) {
  const [open, setOpen] = useState(false);
  const shown = open || lines.length <= limit ? lines : lines.slice(0, limit);
  const hidden = lines.length - shown.length;
  const numbered = lines.some((line) => line.oldNo !== undefined || line.newNo !== undefined);
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div className="max-h-[60vh] overflow-auto rounded-sm bg-surface-2 py-1 font-mono text-xs" data-selectable>
        {shown.map((line, index) => (
          <div
            key={index}
            data-diff={line.kind}
            className={cn('flex min-w-max gap-2 px-2', line.kind === 'add' && 'bg-success-soft text-fg', line.kind === 'del' && 'bg-danger-soft text-fg', line.kind === 'same' && 'text-fg-muted')}
          >
            {numbered && (
              <>
                <span className="w-9 shrink-0 text-right text-fg-faint tabular-nums select-none">{line.oldNo ?? ''}</span>
                <span className="w-9 shrink-0 text-right text-fg-faint tabular-nums select-none">{line.newNo ?? ''}</span>
              </>
            )}
            <span aria-hidden className="w-3 shrink-0 select-none">
              {SIGN[line.kind]}
            </span>
            <span className="whitespace-pre">{line.text || ' '}</span>
          </div>
        ))}
      </div>
      {(hidden > 0 || (open && lines.length > limit)) && (
        <button type="button" className="self-start text-xs text-accent-fg hover:underline" onClick={() => setOpen(!open)}>
          {open ? t('projects.live.fold.less') : t('projects.live.fold.more', { n: hidden })}
        </button>
      )}
    </div>
  );
}
