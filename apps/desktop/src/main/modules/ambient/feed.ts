// Sürekli döküm beslemesi: ortam dinleme modülünün ses hattına olan TEK bağı. Modül sesi hiç görmez; yalnız yazıya
// çevrilmiş söz bölütlerini alır.
//
// Ses hattıyla sözleşme (çekirdekte: `packages/shared` › `VoiceAmbientEvent`, `VoiceApi.setAmbient`):
//   olay   `voice.ambient`  yük `{ id, text, startedAt, endedAt, durationMs, lang?, languageConfidence?, source: 'mic' }`
//   servis `voice.setAmbient(enabled: boolean)`; `voice.status().ambient: boolean`
// Ses hattının sözü: mikrofon kapalı / duraklatılmış / asistan konuşurken / kendi yankısında olay çıkmaz; uyandırma
// sözlü bölüt tura gider, buraya gelmez; ses diske yazılmaz.
import type { Bus, IsoDateTime, Unsubscribe, VoiceAmbientEvent, VoiceApi } from '@fuber/shared';
import { z } from 'zod';

/**
 * Beslemeden gelen bir söz bölütü. Şema bilinmeyen alanları ATAR: yük yanlışlıkla ses örneği (pcm, wav) taşısa da
 * modüle girmez, depoya yazılamaz.
 */
export const FeedSegmentSchema = z.object({
  id: z.string().min(1).max(120),
  text: z.string(),
  startedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'geçersiz an'),
  endedAt: z.string().refine((value) => !Number.isNaN(Date.parse(value)), 'geçersiz an'),
  durationMs: z.number().nonnegative(),
  lang: z.string().max(12).optional(),
  /** Sesin dökümün diliyle uyuşma olasılığı (0–1); motor vermiyorsa yok. */
  languageConfidence: z.number().min(0).max(1).nullable().optional(),
  source: z.literal('mic'),
});
export type FeedSegment = z.infer<typeof FeedSegmentSchema>;

// Derleme zamanı güvencesi: ses hattının yayınladığı yük bu şemadan geçer (alan adı ya da tipi değişirse burada kırılır).
type Loose<T> = { [K in keyof T]: T[K] extends string ? string : T[K] };
const contractCheck = (event: VoiceAmbientEvent): Loose<FeedSegment> => event;
void contractCheck;

export interface AmbientFeed {
  /** Ses hattı sürekli dökümü destekliyor mu. */
  supported(): boolean;
  /** Destekliyor ve şu an kullanılabilir mi (modeller hazır, ses penceresi ayakta). */
  ready(): boolean;
  /** Dinleme kapısının kararını ses hattına bildirir; kapalıyken ses hattı bölüt üretmez. */
  setEnabled(enabled: boolean): void;
  /** Ham yükü verir; doğrulama alıcıdadır (`FeedSegmentSchema`). */
  subscribe(handler: (segment: unknown) => void): Unsubscribe;
}

/**
 * Gerçek besleme: olay yolundaki `voice.ambient` (ses oturumu yayınlar; politika izni + rıza + bu modülün açma kararı
 * üçü birden varken). `setAmbient` sözleşmede isteğe bağlıdır: ses hattı taslakken (sınama düzenekleri) yoktur ve
 * modül "desteklenmiyor" der.
 */
export function voiceAmbientFeed(bus: Bus, voice: VoiceApi): AmbientFeed {
  return {
    supported: () => typeof voice.setAmbient === 'function',
    ready() {
      return typeof voice.setAmbient === 'function' && voice.status().ready;
    },
    setEnabled(enabled) {
      voice.setAmbient?.(enabled);
    },
    subscribe: (handler) => bus.on('voice.ambient', (event: VoiceAmbientEvent) => handler(event)),
  };
}

// ───────────────────────── sınama sürücüsü ─────────────────────────

/** Dökümden üretilen besleme satırı: `at` başlangıçtan itibaren saniye. */
export interface ScriptLine {
  at: number;
  text: string;
}

/**
 * Düz yazı dökümünü besleme satırlarına çevirir. Satır biçimi `[dd:ss] metin` ya da `dd:ss metin`; zaman damgasız
 * satır bir öncekinden 6 saniye sonra sayılır. Boş satırlar ve `#` ile başlayan açıklamalar atlanır.
 */
export function parseScript(script: string): ScriptLine[] {
  const lines: ScriptLine[] = [];
  let cursor = 0;
  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^\[?(\d{1,3}):(\d{2})\]?\s+(.*)$/.exec(line);
    if (match) cursor = Number(match[1]) * 60 + Number(match[2]);
    else cursor += 6;
    const text = (match ? match[3] : line)?.trim() ?? '';
    if (text) lines.push({ at: cursor, text });
  }
  return lines;
}

/** Besleme satırını sözleşmedeki yüke çevirir; süre metnin uzunluğundan kestirilir (saniyede ~14 harf). */
export function scriptSegment(line: ScriptLine, startAt: Date, index: number): FeedSegment {
  const started = new Date(startAt.getTime() + line.at * 1000);
  const durationMs = Math.max(600, Math.round((line.text.length / 14) * 1000));
  return {
    id: `script-${startAt.getTime()}-${index}`,
    text: line.text,
    startedAt: started.toISOString() as IsoDateTime,
    endedAt: new Date(started.getTime() + durationMs).toISOString() as IsoDateTime,
    durationMs,
    lang: 'tr',
    source: 'mic',
  };
}

/**
 * Sahte besleme: sınamalar ve `scripts/e2e/ambient.mjs` hazır metin bölütlerini bununla verir. Gerçek mikrofon ve ses
 * yoktur. `enabledLog` modülün ses hattına verdiği aç/kapa kararlarını tutar.
 */
export function createScriptFeed(options: { supported?: boolean; ready?: boolean } = {}): AmbientFeed & {
  push(segment: unknown): void;
  enabledLog: boolean[];
  enabled(): boolean;
  setReady(ready: boolean): void;
} {
  const handlers = new Set<(segment: unknown) => void>();
  const enabledLog: boolean[] = [];
  let ready = options.ready ?? true;
  const supported = options.supported ?? true;
  return {
    enabledLog,
    enabled: () => enabledLog.at(-1) ?? false,
    setReady(value) {
      ready = value;
    },
    supported: () => supported,
    ready: () => supported && ready,
    setEnabled(enabled) {
      if (enabledLog.at(-1) !== enabled) enabledLog.push(enabled);
    },
    subscribe(handler) {
      handlers.add(handler);
      return () => void handlers.delete(handler);
    },
    push(segment) {
      for (const handler of [...handlers]) handler(segment);
    },
  };
}
