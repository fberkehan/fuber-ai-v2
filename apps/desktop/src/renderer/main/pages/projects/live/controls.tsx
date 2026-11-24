// Canlı oturum görünümünün küçük ortak parçaları.
import { useState, type ComponentPropsWithRef, type ReactNode } from 'react';
import { t } from '@fuber/shared';
import { cn, controlFrame } from '@fuber/ui';
import { CaretDown } from '@phosphor-icons/react';
import type { LiveModel, PermissionMode } from '../../../../../main/modules/projects/claude/types';
import { EFFORTS, foldLines, modeLabel, MODES } from './format';

export interface PickOption {
  value: string;
  label: string;
  disabled?: boolean;
}

/**
 * Yerel `<select>`: kip, model ve proje seçimi klavyeyle ve uçtan uca sınamada doğrudan değer atanarak sürülebilsin diye
 * (tasarım sistemindeki `Select` değer atanabilir bir öğe değildir). Çerçeve tasarım sistemininkiyle aynıdır.
 */
export function PickSelect({
  options,
  size = 'sm',
  className,
  ...rest
}: Omit<ComponentPropsWithRef<'select'>, 'size'> & { options: PickOption[]; size?: 'sm' | 'md' }) {
  return (
    <span className={cn('relative inline-flex min-w-0 items-center', controlFrame, size === 'sm' ? 'h-8 text-sm' : 'h-10 text-base', className)}>
      <select
        className="h-full w-full min-w-0 cursor-pointer appearance-none truncate bg-transparent pr-7 pl-2.5 text-inherit outline-none disabled:cursor-default"
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} disabled={option.disabled} className="bg-surface-3 text-fg">
            {option.label}
          </option>
        ))}
      </select>
      <CaretDown aria-hidden weight="bold" className="pointer-events-none absolute right-2.5 size-3 text-fg-faint" />
    </span>
  );
}

/** Kip seçenekleri: "Tam yetki" yalnız ayarı açıkken seçilebilir (o an seçiliyse listede görünür kalır). */
export function modeOptions(fullAccess: boolean, current?: PermissionMode): PickOption[] {
  return MODES.map((mode) => ({
    value: mode,
    label: mode === 'bypassPermissions' && !fullAccess ? t('projects.live.mode.fullAccessOff') : modeLabel(mode),
    disabled: mode === 'bypassPermissions' && !fullAccess && current !== mode,
  }));
}

/** Model seçenekleri: boş değer = Claude Code'un varsayılanı. Listede olmayan seçili model de görünür. */
export function modelOptions(models: readonly LiveModel[], current?: string): PickOption[] {
  const options: PickOption[] = [{ value: '', label: t('projects.live.model.default') }];
  for (const model of models) if (model.value && model.value !== 'default') options.push({ value: model.value, label: model.label || model.value });
  if (current && !options.some((option) => option.value === current)) options.push({ value: current, label: current });
  return options;
}

export function effortOptions(): PickOption[] {
  return [{ value: '', label: t('projects.live.effort.default') }, ...EFFORTS.map((effort) => ({ value: effort, label: t(`projects.live.effort.${effort}`) }))];
}

/** Uzun çıktı: ilk satırlar görünür, kalanı "tamamını göster" ile açılır. */
export function FoldedText({ text, limit = 12, tone = 'normal', className }: { text: string; limit?: number; tone?: 'normal' | 'error'; className?: string }) {
  const [open, setOpen] = useState(false);
  const folded = foldLines(text, limit, open);
  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <pre
        data-selectable
        className={cn('max-h-[60vh] overflow-auto rounded-sm bg-surface-2 px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap', tone === 'error' ? 'text-danger' : 'text-fg-muted')}
      >
        {folded.shown}
      </pre>
      {(folded.hidden > 0 || (open && folded.total > limit)) && (
        <button type="button" className="self-start text-xs text-accent-fg hover:underline" onClick={() => setOpen(!open)}>
          {open ? t('projects.live.fold.less') : t('projects.live.fold.more', { n: folded.hidden })}
        </button>
      )}
    </div>
  );
}

export function SectionTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <h3 className="text-sm font-medium text-fg-muted">{children}</h3>
      {aside && <span className="ml-auto flex items-center gap-1">{aside}</span>}
    </div>
  );
}
