// Yalnız birim sınamaları için: kayıtlı yanıtlarla çalışan sahte `Fetcher` (gerçek ağa hiç gitmez).
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FetchFailedError, type Fetcher, type FetchOptions } from './net';

export const fixture = (name: string): string => fs.readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

export interface FakeRoute {
  /** Adres bu dizgeyi içeriyorsa ya da bu düzenli ifadeye uyuyorsa yanıt verilir. */
  match: string | RegExp;
  status?: number;
  contentType?: string;
  body?: string;
  /** Yanıt bu kadar gecikir (sinyal ve süre sınırı gözetilir). */
  delayMs?: number;
  /** Ağ hatası benzet. */
  fail?: 'network' | 'timeout';
}

export function fakeFetch(routes: FakeRoute[]): Fetcher & { calls: string[] } {
  const calls: string[] = [];
  const fetcher = (async (url: string, options: FetchOptions = {}) => {
    calls.push(url);
    const route = routes.find((candidate) => (typeof candidate.match === 'string' ? url.includes(candidate.match) : candidate.match.test(url)));
    if (!route) throw new FetchFailedError('network', `sahte ağda yol yok: ${url}`);
    if (route.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, route.delayMs);
        options.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new FetchFailedError('aborted', 'iptal edildi'));
        });
      });
    }
    if (route.fail === 'network') throw new FetchFailedError('network', 'bağlantı kurulamadı');
    if (route.fail === 'timeout') throw new FetchFailedError('timeout', 'zaman aşımı');
    const body = Buffer.from(route.body ?? '', 'utf8');
    return { status: route.status ?? 200, url, contentType: route.contentType ?? 'text/html', charset: 'utf-8', body, truncated: false };
  }) as Fetcher & { calls: string[] };
  fetcher.calls = calls;
  return fetcher;
}
