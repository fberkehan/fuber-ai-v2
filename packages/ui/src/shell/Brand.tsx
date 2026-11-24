import { motion } from 'motion/react';
import { cn } from '../cn';

/**
 * Projenin işareti: dört kollu, kolları içe kıvrık bir yıldız ve ona kıl payı bir çizgiyle bağlı küçük bir eş yıldız
 * (iki yıldızlık bir takımyıldız). Özgün çizimdir; koyu zeminde beyaz, tek renk. 24 birimlik ızgarada çizilir ve her
 * boyda keskin kalır (yalnız düz yol ve daire).
 */
export function FuberMark({ size = 24, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={cn('ui-brand-mark shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-testid="brand-mark"
    >
      {/* Bağ: ana yıldızın kolundan eş yıldıza. */}
      <path d="M13.9 9.1 L18.2 5.8" stroke="currentColor" strokeOpacity="0.5" strokeWidth="1" strokeLinecap="round" />
      {/* Ana yıldız. */}
      <path d="M10 3.5 C10.5 9.4 11.6 10.5 17.5 12 C11.6 13.5 10.5 14.6 10 20.5 C9.5 14.6 8.4 13.5 2.5 12 C8.4 10.5 9.5 9.4 10 3.5 Z" fill="currentColor" />
      {/* Eş yıldız ve uzak bir toz tanesi. */}
      <circle cx="19.6" cy="4.7" r="1.75" fill="currentColor" />
      <circle cx="19.4" cy="18.6" r="1" fill="currentColor" fillOpacity="0.55" />
    </svg>
  );
}

export interface FuberLogoProps {
  /** Ürün adı, "FUBER" yazısının yanında ince ağırlıkla: "AI", "Yönetim". */
  product: string;
  /** İkincil satır (asistanın adı ya da kısa durum); yoksa tek satır. */
  caption?: string;
  /** Daraltılmış ray: yalnız işaret. */
  collapsed?: boolean;
  className?: string;
}

/**
 * Logotip: işaret + beyaz "FUBER" yazısı (Inter 900, açık aralık; başlıktaki çentikle aynı yazı biçimi) + ürün adı.
 * Daraltılınca yalnız işaret kalır; yazı yumuşakça söner (yer kaymaz).
 */
export function FuberLogo({ product, caption, collapsed = false, className }: FuberLogoProps) {
  return (
    <span className={cn('ui-logo flex min-w-0 items-center gap-2.5', className)} data-testid="brand-logo" data-collapsed={collapsed || undefined}>
      <span className="grid size-7 shrink-0 place-items-center">
        <FuberMark size={24} />
      </span>
      <motion.span
        className="flex min-w-0 flex-col justify-center"
        initial={false}
        animate={{ opacity: collapsed ? 0 : 1 }}
        transition={{ duration: collapsed ? 0.08 : 0.18, delay: collapsed ? 0 : 0.06 }}
        aria-hidden={collapsed || undefined}
      >
        <span className="ui-logo-word whitespace-nowrap">
          FUBER<span className="ui-logo-product">{product}</span>
        </span>
        {caption ? (
          <span className="ui-logo-caption truncate" data-testid="brand-caption">
            {caption}
          </span>
        ) : null}
      </motion.span>
    </span>
  );
}
