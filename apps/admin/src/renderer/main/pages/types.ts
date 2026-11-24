export type PageId = 'overview' | 'brain' | 'voice' | 'modules' | 'security';

export interface PageProps {
  /** Başka ekrana geçer; `anchor` verilirse o bölüme kaydırır. */
  go: (page: PageId, anchor?: string) => void;
}
