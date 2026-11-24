import type { PageDef } from './page';

// Klasörden keşif: `pages/<id>/index.tsx`. Alt çizgiyle başlayan klasörler (örnekler) atlanır.
const found = import.meta.glob<{ default: PageDef }>(['./*/index.tsx', '!./_*/index.tsx'], { eager: true });

/** Bütün sayfalar, ray sırasıyla. Modülü kapalı olanları süzmek kabuğun işidir (`modules.list`). */
export const pages: PageDef[] = Object.values(found)
  .map((module) => module.default)
  .sort((a, b) => a.order - b.order);
