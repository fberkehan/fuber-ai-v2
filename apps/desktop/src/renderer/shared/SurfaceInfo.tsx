import { useEffect, useState } from 'react';
import { DESKTOP_APP_NAME, type AppInfo } from '@fuber/shared';
import { Surface } from '@fuber/ui';

/** İskelet sayfası: yüzeyin adını ve `app.info` yanıtını gösterir; köprünün çalıştığının kanıtıdır. */
export function SurfaceInfo({ surface }: { surface: string }) {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.fuber.invoke('app.info').then(setInfo, (reason: unknown) => setError(String(reason)));
  }, []);

  return (
    <main className="flex h-full flex-col items-start justify-center gap-4 p-8">
      <h1 className="text-3xl" data-testid="surface-title">
        {DESKTOP_APP_NAME} · {surface}
      </h1>
      <Surface level={2} className="max-w-full p-4">
        <pre className="text-sm text-fg-muted" data-selectable data-testid="app-info">
          {error ?? (info ? JSON.stringify(info, null, 2) : '…')}
        </pre>
      </Surface>
    </main>
  );
}
