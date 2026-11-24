// Değişen dosyalardan "kurulum onayında kullanıcıya ayrıca söylenmesi gereken" işaretler. Engellemez: Claude'un yazdığı bir
// değişiklik güvenlik kapısına, bağımlılıklara ya da paketleme ayarına dokunduysa kullanıcı bunu onay kartında görür.

const PROTECTED: ReadonlyArray<{ test: RegExp; label: string }> = [
  { test: /^apps\/desktop\/src\/main\/core\/self-change-guard(\.test)?\.ts$/, label: 'kendini değiştirme kapısı' },
  { test: /^apps\/desktop\/src\/main\/core\/tools(\.test)?\.ts$/, label: 'araç ve onay kapısı' },
  { test: /^apps\/desktop\/src\/main\/modules\/selfdev\//, label: 'çekirdek geliştirme motoru' },
  { test: /^packages\/shared\/src\/policy(\.test)?\.ts$/, label: 'politika şeması' },
  { test: /^apps\/desktop\/src\/main\/core\/policy(-admin|-client)?(\.test)?\.ts$/, label: 'politika servisi' },
];
const DEPENDENCY = /(^|\/)package(-lock)?\.json$/;
const PACKAGING = /^(apps\/desktop\/electron-builder\.yml|scripts\/(build|dev|postinstall)[^/]*\.mjs|scripts\/lib\/apps\.mjs)$/;

export function riskFlags(files: string[]): string[] {
  const flags = new Set<string>();
  for (const file of files) {
    for (const item of PROTECTED) if (item.test.test(file)) flags.add(`güvenlik: ${item.label} değişti (${file})`);
    if (DEPENDENCY.test(file)) flags.add(`bağımlılık dosyası değişti (${file})`);
    if (PACKAGING.test(file)) flags.add(`derleme/paketleme ayarı değişti (${file})`);
  }
  return [...flags];
}
