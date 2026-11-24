import clsx, { type ClassValue } from 'clsx';

/** Koşullu sınıf birleştirme. */
export function cn(...values: ClassValue[]): string {
  return clsx(values);
}
