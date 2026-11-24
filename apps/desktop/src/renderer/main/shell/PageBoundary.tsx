// Sayfa hata sınırı: bir sayfanın çizim hatası kabuğu (ray, durum satırı, kapılar) düşürmez.
import { Component, type ReactNode } from 'react';
import { WarningCircle } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { Button, EmptyState } from '@fuber/ui';

interface Props {
  children: ReactNode;
  page: string;
}

export class PageBoundary extends Component<Props, { error: Error | null }> {
  override state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidUpdate(previous: Props) {
    if (previous.page !== this.props.page && this.state.error) this.setState({ error: null });
  }

  override componentDidCatch(error: Error) {
    // Sınama ve günlük için konsola yazılır (sayfa hatası olarak görünür).
    console.error(`sayfa çizilemedi (${this.props.page}):`, error);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="flex h-full items-center justify-center p-10" data-testid="page-crash">
        <EmptyState
          icon={<WarningCircle />}
          title={t('nav.pageCrash.title')}
          description={t('nav.pageCrash.body', { detail: this.state.error.message })}
          actions={<Button onClick={() => this.setState({ error: null })}>{t('common.retry')}</Button>}
        />
      </div>
    );
  }
}
