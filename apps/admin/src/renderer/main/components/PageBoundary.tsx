/**
 * Sayfa düzeyinde hata sınırı: bir ekran çizilirken hata verirse yalnız o ekranın yerine sade bir kart
 * çıkar; gezinme rayı, durum şeridi ve öteki ekranlar çalışmaya devam eder. "Yeniden dene" ekranı baştan kurar.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ArrowClockwise, WarningCircle } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { Button, EmptyState, Panel, Workspace } from '@fuber/ui';

interface State {
  error: Error | null;
  attempt: number;
}

export class PageBoundary extends Component<{ children: ReactNode; page: string }, State> {
  override state: State = { error: null, attempt: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Sınamalar `console.error`'u sayfa hatası sayar; ayrıntı geliştirici araçlarında okunur.
    console.error(`Sayfa çizilemedi (${this.props.page}):`, error, info.componentStack);
  }

  override componentDidUpdate(prev: { page: string }): void {
    if (prev.page !== this.props.page && this.state.error) this.setState({ error: null });
  }

  private retry = () => this.setState((s) => ({ error: null, attempt: s.attempt + 1 }));

  override render(): ReactNode {
    if (this.state.error) {
      return (
        <Workspace maxWidth={960} data-testid="page-crash">
          <Panel>
            <EmptyState
              icon={<WarningCircle />}
              title={t('admin2.page.crashTitle')}
              description={
                <>
                  {t('admin2.page.crashBody')}
                  <span className="mt-2 block font-mono text-xs text-fg-faint" data-selectable>
                    {this.state.error.message}
                  </span>
                </>
              }
              actions={
                <Button icon={<ArrowClockwise />} onClick={this.retry} data-testid="page-crash-retry">
                  {t('common.retry')}
                </Button>
              }
            />
          </Panel>
        </Workspace>
      );
    }
    return <div key={this.state.attempt} className="contents">{this.props.children}</div>;
  }
}
