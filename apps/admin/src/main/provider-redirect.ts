/**
 * Sınamada sağlayıcı çağrılarını (anahtar sınama, model/ses listesi) yerel sahte sunucuya yönelten `fetch`
 * (`FUBER2_PROVIDER_URL`, yalnız sınama kipinde). Gerçek sağlayıcıya hiçbir istek gitmez: `https://openrouter.ai/api/v1/key`
 * → `<sahte>/__host/openrouter.ai/api/v1/key`. Geri döngü adresleri (özel adres olarak verilen sahte sunucu) olduğu gibi kalır.
 */
import type { FetchLike } from '@fuber/control';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

// `fetch` her çağrıda okunur: arayüz sınaması (`ui.e2e.mjs`) ana süreçte `globalThis.fetch`'i senaryoyla değiştirir.
export function redirectProviderFetch(target: string, doFetch: FetchLike = (input, init) => globalThis.fetch(input, init)): FetchLike {
  const base = target.trim().replace(/\/+$/, '');
  return (input, init) => {
    const url = new URL(input);
    if (LOOPBACK.has(url.hostname)) return doFetch(input, init);
    return doFetch(`${base}/__host/${url.host}${url.pathname}${url.search}`, init);
  };
}
