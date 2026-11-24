/**
 * Sohbet ekleri ve dosya araçları için tür, boyut ve sayı kuralları (v1 `shared/ek-kural.ts`ten uyarlandı).
 * Sessiz düşme yok: kural dışı her dosya tek satırlık nedenle reddedilir. Video ve ses eki bu sürümde yok
 * (v1'de video vardı; v2'de video işleme hattı yok, açıkça reddedilir).
 */

export type AttachmentKind = 'document' | 'image';

/** Okunan görsel türleri (bulut beyni bunları doğrudan görür). */
export const IMAGE_MEDIA: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' };
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const MAX_IMAGES = 4;
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024;
/** İleti başına ek (belge + görsel). */
export const MAX_ATTACHMENTS = 6;
/** Bulut beyninde ek başına ve ileti başına modele giden en çok karakter (v1 ile aynı). */
export const CLOUD_ATTACHMENT_CHARS = 40_000;
export const CLOUD_TOTAL_CHARS = 80_000;
/** Yerel modelde (8192 belirteç bağlam) bütün eklerin toplamı. */
export const LOCAL_TOTAL_CHARS = 3_000;
/** İşçide bir belgeden tutulacak en çok karakter (arama ve parça parça okuma için). */
export const PARSE_MAX_CHARS = 3_000_000;

const UNREADABLE_IMAGES = new Set(['heic', 'heif', 'tif', 'tiff', 'raw', 'cr2', 'nef', 'psd', 'bmp', 'svg', 'avif', 'ico']);
const LEGACY_OFFICE: Record<string, string> = { doc: '.docx', xls: '.xlsx', ppt: '.pptx' };
/** Okunabilen belge uzantıları (işçinin `formatOf` listesiyle aynı). */
export const DOCUMENT_EXTENSIONS: readonly string[] = [
  'pdf', 'docx', 'docm', 'xlsx', 'xlsm', 'pptx', 'pptm', 'csv', 'tsv', 'eml', 'txt', 'md', 'markdown', 'log', 'json', 'xml', 'html', 'htm', 'yaml', 'yml', 'ini', 'rtf',
];
/** Düz metin olarak okunan kod dosyaları (v1 ile aynı küme; yalnız okunur, asla çalıştırılmaz). */
export const CODE_EXTENSIONS: readonly string[] = [
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'java', 'kt', 'kts', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'go', 'rs', 'rb', 'php', 'swift', 'm', 'scala',
  'dart', 'lua', 'r', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'psm1', 'bat', 'cmd', 'css', 'scss', 'sass', 'less', 'vue', 'svelte', 'astro', 'gradle', 'toml',
  'proto', 'graphql', 'tf', 'jsonl',
];
const DOCUMENT_SET = new Set([...DOCUMENT_EXTENSIONS, ...CODE_EXTENSIONS]);

/** Dosya seçicinin kabul listesi (Electron iletişim kutusu süzgeci). */
export const PICKER_EXTENSIONS: readonly string[] = [...DOCUMENT_EXTENSIONS, ...CODE_EXTENSIONS, ...Object.keys(IMAGE_MEDIA)];

export function extensionOf(name: string): string {
  const base = String(name ?? '').toLowerCase().trim().split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(dot + 1) : '';
}

/** Görünen ad: modele giden etikete güvenle girer (tırnak, açılı ayraç ve satır sonu yok). */
export function cleanName(name: string): string {
  return String(name ?? '').split(/[\\/]/).pop()!.replace(/[<>"\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 160) || 'ek';
}

export const sizeLabel = (bytes: number): string =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1).replace('.', ',')} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

export type Classification = { kind: AttachmentKind; mediaType?: string } | { error: string };

/** Dosya kabul edilir mi, hangi yoldan; değilse tek satırlık neden. */
export function classifyAttachment(name: string, mime: string, bytes: number): Classification {
  const extension = extensionOf(name);
  const type = String(mime ?? '').toLowerCase();
  const label = cleanName(name);
  if (bytes === 0) return { error: `${label} boş (0 bayt).` };
  const imageType = IMAGE_MEDIA[extension] ?? (Object.values(IMAGE_MEDIA).includes(type) ? type : undefined);
  if (imageType) {
    if (bytes > IMAGE_MAX_BYTES) return { error: `${label} çok büyük (${sizeLabel(bytes)}); görsel en çok ${sizeLabel(IMAGE_MAX_BYTES)} olabilir.` };
    return { kind: 'image', mediaType: imageType };
  }
  if (UNREADABLE_IMAGES.has(extension) || type.startsWith('image/')) {
    return { error: `${label}: bu görsel türü okunmuyor (${extension.toUpperCase() || type}); PNG ya da JPEG olarak kaydedip ekleyin.` };
  }
  const modern = LEGACY_OFFICE[extension];
  if (modern) return { error: `${label}: eski Office biçimi okunmuyor; ${modern} olarak kaydedip ekleyin.` };
  if (DOCUMENT_SET.has(extension)) {
    if (bytes > DOCUMENT_MAX_BYTES) return { error: `${label} çok büyük (${sizeLabel(bytes)}); belge en çok ${sizeLabel(DOCUMENT_MAX_BYTES)} olabilir.` };
    return { kind: 'document' };
  }
  if (type.startsWith('video/') || ['mp4', 'mov', 'webm', 'm4v', 'avi', 'mkv'].includes(extension)) return { error: `${label}: video eki bu sürümde okunmuyor.` };
  if (type.startsWith('audio/') || ['mp3', 'wav', 'm4a', 'ogg', 'flac'].includes(extension)) return { error: `${label}: ses dosyası eklenmiyor.` };
  if (['exe', 'msi', 'vbs', 'lnk', 'scr', 'com', 'dll', 'zip', '7z', 'rar'].includes(extension)) {
    return { error: `${label}: çalıştırılabilir dosya ya da arşiv eklenmez.` };
  }
  return { error: `Bu dosya türü desteklenmiyor: ${extension ? `.${extension}` : label}` };
}

/** Okunabilir belge mi (dosya araçları için: listelemede ve klasör aramasında). */
export const isReadableDocument = (name: string): boolean => DOCUMENT_SET.has(extensionOf(name));

const FORMAT_NAMES: Record<string, string> = {
  pdf: 'PDF', docx: 'Word', docm: 'Word', xlsx: 'Excel', xlsm: 'Excel', csv: 'CSV', tsv: 'CSV', pptx: 'PowerPoint', pptm: 'PowerPoint', eml: 'E-posta',
};
export const formatName = (name: string): string => FORMAT_NAMES[extensionOf(name)] ?? (extensionOf(name).toUpperCase() || 'Belge');
