import { createContext, useContext, useId, type ReactNode } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { cn } from '../cn';

interface FieldContextValue {
  id: string;
  describedBy?: string;
  invalid: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Input, Textarea, Select ve Switch bunu okur: kimlik, açıklama bağı ve hata hâli kendiliğinden gelir. */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

export interface FieldProps {
  label: ReactNode;
  /** Etiketin altında kısa yardım metni. */
  hint?: ReactNode;
  /** Hata metni: verilince alan kırmızı çerçeve alır ve `aria-invalid` olur. */
  error?: ReactNode;
  /** Etiketin sağında (ör. "İsteğe bağlı" ya da sayaç). */
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Form satırı: etiket + denetim + yardım/hata. Etiket her zaman görünür; yer tutucu etiket yerine geçmez. */
export function Field({ label, hint, error, aside, className, children }: FieldProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined;
  return (
    <FieldContext.Provider value={{ id, describedBy, invalid: !!error }}>
      <div className={cn('flex flex-col gap-2', className)}>
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor={id} className="text-sm font-medium text-fg">
            {label}
          </label>
          {aside && <span className="text-xs text-fg-faint">{aside}</span>}
        </div>
        {children}
        {error ? (
          <p id={errorId} className="flex items-center gap-1.5 text-sm text-danger">
            <WarningCircle aria-hidden className="size-4 shrink-0" weight="fill" />
            {error}
          </p>
        ) : hint ? (
          <p id={hintId} className="text-sm text-fg-faint">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
