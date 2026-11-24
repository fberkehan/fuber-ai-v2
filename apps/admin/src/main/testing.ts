/**
 * Yönetim uygulamasının tek test sınırı: sınamaya özgü ortam değişkenleri yalnız bu dosyada okunur.
 *
 * | Değişken                     | Etki                                                                    |
 * |------------------------------|-------------------------------------------------------------------------|
 * | `FUBER2_TEST=1`              | Sınama kipi: pencere ekrana çıkmaz, sisteme kayıt yazılmaz; aşağıdakiler yalnız bu açıkken geçerli |
 * | `FUBER2_DATA=<klasör>`       | Yalıtılmış veri kökü (sınama kipi dışında da geçerli)                    |
 * | `FUBER2_CONTROL_PORT=<port>` | Kontrol servisinin dinleyeceği port (`CONTROL_PORT` yerine; `0` = boş port) |
 * | `FUBER2_SINGLE_INSTANCE=0`   | Tek örnek kilidini alma                                                 |
 * | `FUBER2_V1_DATA=<klasör>`    | v1 veri klasörünün yerine geçen klasör (sentetik fikstür)               |
 * | `FUBER2_PROVIDER_URL=<adres>`| Sağlayıcı çağrıları (sınama, listeler) bu sahte sunucuya (`provider-redirect.ts`) |
 */

const enabled = process.env.FUBER2_TEST === '1';

function readPort(): number | null {
  if (!enabled) return null;
  const raw = process.env.FUBER2_CONTROL_PORT?.trim();
  if (!raw) return null;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 0 && port <= 65535 ? port : null;
}

export const testing = {
  /** Uçtan uca sınama koşusu. Pencereler ekrana çıkmaz, odak çalmaz, Windows açılış kaydı yazılmaz. */
  enabled,
  /** Yalıtılmış veri kökü; verilmişse `%APPDATA%\Fuber Yönetim 2` yerine bu kullanılır. */
  dataDir: process.env.FUBER2_DATA?.trim() || null,
  /** Sınamada kontrol servisinin portu; verilmediyse `null` (varsayılan port kullanılır). */
  controlPort: readPort(),
  /** Tek örnek kilidi alınsın mı. Kilit veri köküne bağlıdır; ayrı `FUBER2_DATA` zaten ayrı kilittir. */
  singleInstanceLock: !(enabled && process.env.FUBER2_SINGLE_INSTANCE === '0'),
  /**
   * v1 veri klasörünün yerine geçen klasör. Sınama kipinde verilmezse `null`: v1 aktarımı hiç klasör
   * bulamaz, sınamalar gerçek v1 deposunu asla okumaz. Sınama dışında `undefined` (gerçek yol kullanılır).
   */
  v1DataDir: enabled ? process.env.FUBER2_V1_DATA?.trim() || null : undefined,
  /**
   * `FUBER2_PROVIDER_URL=<adres>`: sağlayıcı çağrıları (anahtar sınama, model/ses listesi) bu yerel sahte sunucuya gider
   * (`provider-redirect.ts`); sınama gerçek sağlayıcıya istek atmaz. Yalnız sınama kipinde.
   */
  providerUrl: enabled ? process.env.FUBER2_PROVIDER_URL?.trim() || null : null,
} as const;
