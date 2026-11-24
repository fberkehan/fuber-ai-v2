import { useEffect, useRef } from 'react';
import type { StageApp } from '@fuber/shared';
import runnerUrl from './sandbox-runner.html?url';

/** Sahnede gösterilen boyut sınırları (CSS piksel). Daha büyük istenen uygulama kendi içinde kayar. */
export const MINI_APP_BOUNDS = { width: { min: 240, max: 560 }, height: { min: 120, max: 560 } } as const;
/** Sahnenin kabul ettiği en büyük belge (ana süreçteki doğrulamayla aynı tavan). */
export const MINI_APP_MAX_BYTES = 200_000;

/** Mini uygulama belgesinin başına yazılan politika: ağ yok, yalnız satır içi betik/stil ve gömülü görüntü. */
export const MINI_APP_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; media-src data:; form-action 'none'; base-uri 'none'";

const BASE_STYLE =
  ':root{color-scheme:dark}html,body{margin:0;background:#000;color:#f5f5f7;' +
  'font:13px/1.5 "Segoe UI Variable","Segoe UI",system-ui,sans-serif}';

const clamp = (value: number, range: { min: number; max: number }) => Math.round(Math.min(range.max, Math.max(range.min, value || range.min)));

export function miniAppSize(app: StageApp) {
  return { width: clamp(app.width, MINI_APP_BOUNDS.width), height: clamp(app.height, MINI_APP_BOUNDS.height) };
}

/**
 * Kum havuzlu mini uygulama çerçevesi. `sandbox="allow-scripts"` (same-origin YOK): köken opaktır, üst pencereye,
 * `window.fuber` köprüsüne ve depolamaya erişemez; üst pencereyi yönlendiremez. Ağ, koşucu belgenin ve mini
 * uygulamanın başına yazılan içerik politikasıyla kapalıdır. Belge çerçeveye ileti olarak verilir.
 */
export function MiniAppFrame({ app, title }: { app: StageApp; title: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const size = miniAppSize(app);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (!target || event.source !== target || event.data?.fuberStage !== 'ready') return;
      const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${MINI_APP_CSP}"><style>${BASE_STYLE}</style>${app.html}`;
      target.postMessage({ html }, '*');
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [app.html]);

  return (
    <iframe
      ref={frame}
      key={app.html}
      title={title}
      src={runnerUrl}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      allow=""
      className="stage-frame"
      data-testid="stage-app-frame"
      width={size.width}
      height={size.height}
      style={{ width: size.width, height: size.height }}
    />
  );
}
