// Sahibi: T2. Sahne: Jarvis'in gösterdiği kartlar ve mini uygulamalar. Gösterimi HUD yapar; bu servis listeyi tutar.
import { newId, nowIso, type Id, type ServiceDeps, type StageApi, type StageApp, type StageItem } from '@fuber/shared';

/** Mini uygulama sınırları: kum havuzlu çerçeve küçük ve kendi kendine yetmeli. */
export const STAGE_APP_LIMITS = {
  maxHtmlBytes: 200_000,
  width: { min: 160, max: 1200, default: 380 },
  height: { min: 120, max: 900, default: 280 },
} as const;

/** SVG/XML ad alanı bildirimleri ağ isteği değildir; dış kaynak denetiminde sayılmaz. */
const NAMESPACE_URL = /https?:\/\/www\.w3\.org\/[^\s"'<>)]*/gi;
const REMOTE_URL = /\b(?:https?|wss?|ftp):\/\//i;
const PROTOCOL_RELATIVE = /(?:\bsrc|\bhref|\baction|url\()\s*=?\s*["']?\s*\/\//i;

/**
 * Mini uygulamayı doğrular; sorun varsa Türkçe neden döndürür. Dış adres içeren belge reddedilir:
 * sahne çerçevesinde ağ yoktur, dış kaynaklı uygulama orada boş görünür ve veri sızdırma yolu açar.
 */
export function validateStageApp(app: StageApp): string | null {
  if (!app.title.trim()) return 'Mini uygulamanın başlığı boş.';
  const bytes = Buffer.byteLength(app.html, 'utf8');
  if (bytes === 0) return 'Mini uygulamanın HTML içeriği boş.';
  if (bytes > STAGE_APP_LIMITS.maxHtmlBytes) {
    return `Mini uygulama çok büyük (${Math.round(bytes / 1000)} KB); en çok ${STAGE_APP_LIMITS.maxHtmlBytes / 1000} KB olabilir.`;
  }
  const withoutNamespaces = app.html.replace(NAMESPACE_URL, '');
  if (REMOTE_URL.test(withoutNamespaces) || PROTOCOL_RELATIVE.test(withoutNamespaces)) {
    return 'Mini uygulama dış bir adres içeriyor. Sahnede ağ yok: bütün betik, stil ve görseller belgenin içinde olmalı.';
  }
  return null;
}

const clamp = (value: number, range: { min: number; max: number }) => Math.round(Math.min(range.max, Math.max(range.min, value)));

/** Parça HTML'i tam belgeye çevirir ve boyutları sınırlar. */
export function normalizeStageApp(app: StageApp): StageApp {
  const html = /<html[\s>]/i.test(app.html)
    ? app.html
    : `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>${app.title.replace(/[<&>]/g, '')}</title></head><body>${app.html}</body></html>`;
  return {
    title: app.title.trim(),
    html,
    width: clamp(app.width || STAGE_APP_LIMITS.width.default, STAGE_APP_LIMITS.width),
    height: clamp(app.height || STAGE_APP_LIMITS.height.default, STAGE_APP_LIMITS.height),
  };
}

export function createStage(deps: ServiceDeps['stage']): StageApi {
  const items = new Map<Id, StageItem>();
  const timers = new Map<Id, ReturnType<typeof setTimeout>>();

  const add = (item: StageItem): StageItem => {
    items.set(item.id, item);
    deps.bus.emit('stage.show', { item });
    return item;
  };

  const close = (id?: Id) => {
    if (id === undefined) {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      items.clear();
      deps.bus.emit('stage.close', { id: null });
      return;
    }
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
    if (items.delete(id)) deps.bus.emit('stage.close', { id });
  };

  return {
    showCard(moduleId, card) {
      const item = add({ id: newId(), kind: 'card', card, moduleId, createdAt: nowIso() });
      if (card.ttlSeconds && card.ttlSeconds > 0) {
        timers.set(
          item.id,
          setTimeout(() => close(item.id), card.ttlSeconds * 1000),
        );
      }
      return item;
    },
    showApp(moduleId, app) {
      const problem = validateStageApp(app);
      if (problem) throw new Error(problem);
      return add({ id: newId(), kind: 'app', app: normalizeStageApp(app), moduleId, createdAt: nowIso() });
    },
    close,
    items: () => [...items.values()],
  };
}
