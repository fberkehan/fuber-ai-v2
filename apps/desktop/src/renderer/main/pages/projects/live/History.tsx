// "Önceki konuşma" (v1'deki "Daha eskisi"nin karşılığı): uygulama içinde sürdürülen bir oturumun canlı dökümü yalnız bu
// çalıştırmadaki olayları taşır. Oturumun daha önceki iletileri oturum dizininden (`projects.sessionMessages`; yalnız metin)
// okunur ve canlı olayların ÜSTÜNDE salt okunur gösterilir. Oturum dizinde yoksa bölüm hiç görünmez.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { relativeDateTime, t } from '@fuber/shared';
import { Button, Spinner } from '@fuber/ui';
import { ClockCounterClockwise } from '@phosphor-icons/react';
import type { SessionMessage } from '../../../../../main/modules/projects/types';
import { fuber } from '../shared';

const PAGE = 30;

interface Loaded {
  /** Dizindeki ilk yüklü iletinin sırası: bundan öncekiler "Önceki N ileti" ile gelir. */
  offset: number;
  /** Canlı oturum başlamadan ÖNCEKİ iletiler (sonrakiler canlı dökümde zaten var). */
  messages: SessionMessage[];
}

export interface HistoryState {
  /** Dökümün üstüne konacak bölüm; oturum dizinde yoksa `null`. */
  node: ReactNode;
  /** İçerik değiştikçe değişir (dökümün kaydırma yerini korumak için). */
  key: string;
}

/**
 * @param sessionId Claude Code oturum kimliği (dizindeki `CodeSession.id`); yoksa bölüm yok.
 * @param before Canlı oturumun başladığı an (epoch ms): bundan sonraki iletiler canlı dökümdedir, burada yinelenmez.
 * @param autoOpen Bölüm kendiliğinden açık gelsin (oturum geçmiş ön izlemesinden sürdürüldü).
 */
export function useHistory(sessionId: string | undefined, before: number, autoOpen: boolean): HistoryState {
  const [available, setAvailable] = useState(false);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [open, setOpen] = useState(autoOpen);
  const [busy, setBusy] = useState(false);

  const fetchPage = useCallback(
    async (offset?: number, limit = PAGE): Promise<Loaded | null> => {
      if (!sessionId) return null;
      const page = await fuber().invoke('projects.sessionMessages', { id: sessionId, limit, ...(offset !== undefined ? { offset } : {}) });
      const earlier = page.messages.filter((message) => {
        const at = message.at ? Date.parse(message.at) : Number.NaN;
        return Number.isNaN(at) || at < before;
      });
      return { offset: page.offset, messages: earlier };
    },
    [sessionId, before],
  );

  // Yoklama: dizinde canlı oturumdan önceye ait ileti var mı. Kanal hata verirse (oturum dizinde yok) bölüm gizlenir.
  useEffect(() => {
    let cancelled = false;
    setAvailable(false);
    setLoaded(null);
    if (!sessionId) return;
    fetchPage()
      .then(async (page) => {
        if (cancelled || !page) return;
        if (page.messages.length === 0) {
          if (page.offset === 0) return;
          // Son sayfanın tamamı canlı oturuma ait: oturumun İLK iletisi de öyleyse (uygulamada başlamış oturum) geçmiş yoktur.
          const first = await fetchPage(0, 1);
          if (cancelled || !first || first.messages.length === 0) return;
        }
        setAvailable(true);
        setLoaded(page);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [sessionId, fetchPage]);

  useEffect(() => {
    if (autoOpen) setOpen(true);
  }, [autoOpen]);

  const loadEarlier = async () => {
    if (!loaded || loaded.offset <= 0 || busy) return;
    setBusy(true);
    try {
      const offset = Math.max(0, loaded.offset - PAGE);
      const page = await fetchPage(offset, loaded.offset - offset);
      if (page) setLoaded({ offset: page.offset, messages: [...page.messages, ...loaded.messages] });
    } catch {
      // Dizin o an okunamadıysa düğme yerinde kalır; yeniden denenebilir.
    } finally {
      setBusy(false);
    }
  };

  const key = `${sessionId ?? ''}:${available}:${open}:${loaded?.offset ?? -1}:${loaded?.messages.length ?? 0}`;
  if (!available || !loaded) return { node: null, key };

  const node = (
    <section data-testid="live-history" data-open={open} aria-label={t('projects.live.history.title')} className="flex flex-col gap-3 border-b border-line pb-3">
      <button
        type="button"
        data-testid="live-history-load"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 self-start rounded-sm px-2 py-1 text-xs text-accent-fg hover:bg-surface-2"
      >
        <ClockCounterClockwise className="size-3.5" aria-hidden />
        {open ? t('projects.live.history.hide') : t('projects.live.history.show')}
      </button>
      {open && (
        <>
          {loaded.offset > 0 && (
            <Button variant="ghost" size="sm" className="self-center" loading={busy} data-testid="live-history-more" onClick={() => void loadEarlier()}>
              {t('projects.page.earlier', { count: loaded.offset })}
            </Button>
          )}
          {busy && loaded.offset <= 0 && <Spinner size={16} />}
          {loaded.messages.length === 0 ? (
            <p className="text-xs text-fg-faint">{t('projects.live.history.older')}</p>
          ) : (
            loaded.messages.map((message) => {
              const isUser = message.role === 'user';
              return (
                <article key={message.seq} data-history-seq={message.seq} data-role={message.role} className={`flex flex-col gap-1 rounded-sm px-3 py-2 ${isUser ? 'bg-surface-2' : ''}`}>
                  <header className="flex items-center gap-2 text-xs">
                    <span className={isUser ? 'font-medium text-fg' : 'font-medium text-accent-fg'}>{isUser ? t('projects.page.you') : t('projects.page.claude')}</span>
                    {message.at && <time className="text-fg-faint">{relativeDateTime(message.at)}</time>}
                  </header>
                  <p className={`text-sm break-words whitespace-pre-wrap ${isUser ? 'text-fg' : 'text-fg-muted'}`} data-selectable>
                    {message.text}
                  </p>
                </article>
              );
            })
          )}
          <p className="text-xs text-fg-faint">{t('projects.live.history.note')}</p>
        </>
      )}
    </section>
  );
  return { node, key };
}
