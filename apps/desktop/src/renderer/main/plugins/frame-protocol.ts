// Eklenti sayfası ↔ kabuk köprüsünün saf mantığı: ileti doğrulama, istek sınırlayıcı ve isteğin yanıta çevrilmesi.
// Sayfa güvenli kutuda (opak kökenli çerçeve) koşar; bu dosya o çerçeveden gelen her şeyi GÜVENİLMEZ sayar.
import { t, type JsonValue } from '@fuber/shared';
import type { PluginFrameReply, PluginFrameRequest, PluginSettingValue } from '../../../main/modules/workshop/types';

/** Saniyede en çok bu kadar istek; fazlası hata yanıtı alır. */
export const FRAME_RATE_LIMIT = 20;
export const FRAME_RATE_WINDOW_MS = 1000;
/** Tek isteğin JSON boyutu tavanı (karakter): sayfa ana süreci büyük yüklerle boğamasın. */
export const FRAME_MAX_PAYLOAD = 256_000;

const OPS = ['call', 'storage.get', 'storage.set', 'storage.delete', 'settings.get'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const isKey = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 200;

function withinSize(value: unknown): boolean {
  try {
    const text = JSON.stringify(value);
    return text === undefined || text.length <= FRAME_MAX_PAYLOAD;
  } catch {
    // Döngüsel yapı ya da serileştirilemeyen değer.
    return false;
  }
}

/** Çerçeveden gelen `data` gerçekten bir `PluginFrameRequest` mi (biçim, alan türleri, boyut). */
export function isFrameRequest(data: unknown): data is PluginFrameRequest {
  if (!isRecord(data) || data.fuberPlugin !== 1) return false;
  if (typeof data.id !== 'number' || !Number.isSafeInteger(data.id)) return false;
  const op = data.op;
  if (typeof op !== 'string' || !(OPS as readonly string[]).includes(op)) return false;
  switch (op) {
    case 'call':
      return typeof data.tool === 'string' && data.tool.length > 0 && data.tool.length <= 120 && withinSize(data.input);
    case 'storage.set':
      return isKey(data.key) && 'value' in data && withinSize(data.value);
    default:
      return isKey(data.key);
  }
}

/** Kayan pencereli sınırlayıcı: `true` = istek geçebilir. `now` sınama için verilebilir. */
export function createRateLimiter(limit = FRAME_RATE_LIMIT, windowMs = FRAME_RATE_WINDOW_MS, now: () => number = Date.now): () => boolean {
  const stamps: number[] = [];
  return () => {
    const current = now();
    while (stamps.length > 0 && current - stamps[0]! >= windowMs) stamps.shift();
    if (stamps.length >= limit) return false;
    stamps.push(current);
    return true;
  };
}

/** Köprünün ihtiyaç duyduğu üç IPC çağrısı; sınamada sahte verilir. */
export interface FrameBackend {
  pageCall(req: { skillId: string; pageId: string; tool: string; input: unknown }): Promise<{ ok: boolean; text: string; data?: unknown }>;
  pageStorage(req: { skillId: string; op: 'get' | 'set' | 'delete'; key: string; value?: JsonValue }): Promise<{ found: boolean; value: JsonValue }>;
  settings(req: { skillId: string }): Promise<PluginSettingValue[]>;
}

const ok = (id: number, value: unknown): PluginFrameReply => ({ fuberPlugin: 1, id, ok: true, value });
const fail = (id: number, error: string): PluginFrameReply => ({ fuberPlugin: 1, id, ok: false, error });

export const frameError = fail;

const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

/**
 * İsteği IPC çağrısına çevirir ve yanıtı üretir; hata fırlatmaz (sayfa her durumda bir yanıt alır).
 * Yanıt değerleri:
 * - `call`: başarıda `{ text, data }`; araç başarısızsa `ok: false` ve `error` = aracın metni.
 * - `storage.get`: kayıtlı değer, yoksa `null` · `storage.set` / `storage.delete`: `true`.
 * - `settings.get`: ayarın o anki değeri, bilinmeyen anahtarda `null`.
 */
export async function answerFrameRequest(skillId: string, pageId: string, request: PluginFrameRequest, backend: FrameBackend): Promise<PluginFrameReply> {
  try {
    switch (request.op) {
      case 'call': {
        const result = await backend.pageCall({ skillId, pageId, tool: request.tool, input: request.input });
        return result.ok ? ok(request.id, { text: result.text, data: result.data ?? null }) : fail(request.id, result.text || t('pluginsUi.frame.toolFailed'));
      }
      case 'storage.get': {
        const result = await backend.pageStorage({ skillId, op: 'get', key: request.key });
        return ok(request.id, result.found ? result.value : null);
      }
      case 'storage.set':
        await backend.pageStorage({ skillId, op: 'set', key: request.key, value: request.value });
        return ok(request.id, true);
      case 'storage.delete':
        await backend.pageStorage({ skillId, op: 'delete', key: request.key });
        return ok(request.id, true);
      case 'settings.get': {
        const values = await backend.settings({ skillId });
        return ok(request.id, values.find((setting) => setting.key === request.key)?.value ?? null);
      }
    }
  } catch (error) {
    return fail(request.id, message(error));
  }
}
