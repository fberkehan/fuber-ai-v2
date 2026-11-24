// Projeler sayfasının ortak parçaları: köprü, vurgulama, zaman biçimi, yığın ikonu.
import { foldForSearch, relativeDateTime, relativeTime, searchTerms, t, type MessageKey } from '@fuber/shared';
import {
  AppWindow,
  Atom,
  Cube,
  DeviceMobile,
  FileCode,
  FolderSimple,
  GitBranch,
  Lightning,
  type Icon,
} from '@phosphor-icons/react';
import type { ReactNode } from 'react';
// Modülün kendi kanal tipleri (`projects.findSessions` vb.) bu içe aktarımla `Api`'ye eklenir.
import type {} from '../../../../main/modules/projects/types';

export const fuber = () => window.fuber;

/** Hata iletisini kullanıcıya gösterilebilir metne çevirir (ana süreç Türkçe ileti yollar). */
export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `[[eşleşme]]` işaretli alıntıyı vurgulu düğümlere çevirir. */
export function Snippet({ text }: { text: string }) {
  const parts = text.split(/(\[\[[\s\S]*?\]\])/g).filter(Boolean);
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('[[') ? (
          <mark key={index} className="rounded-xs bg-accent-soft px-0.5 text-fg">
            {part.slice(2, -2)}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        ),
      )}
    </>
  );
}

const WORD = /[\p{L}\p{N}]+/gu;

/**
 * Asıl metinde sorgu sözcüklerini (önek eşleşmesi, Türkçe katlamayla) vurgular. Katlama uzunluğu korur,
 * bu yüzden katlanmış metindeki konum asıl metinde de geçerlidir.
 */
export function highlight(text: string, query: string): ReactNode {
  const terms = [...new Set(searchTerms(query))].sort((a, b) => b.length - a.length);
  if (terms.length === 0) return text;
  const folded = foldForSearch(text);
  const nodes: ReactNode[] = [];
  let cursor = 0;
  for (const match of folded.matchAll(WORD)) {
    const hit = terms.find((term) => match[0].startsWith(term));
    if (!hit) continue;
    const start = match.index;
    const end = start + hit.length;
    if (start > cursor) nodes.push(text.slice(cursor, start));
    nodes.push(
      <mark key={start} className="rounded-xs bg-accent-soft px-0.5 text-fg">
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor === 0) return text;
  nodes.push(text.slice(cursor));
  return nodes;
}

/** Listelerde kısa göreli zaman ("5 dk önce"); bir haftadan eskiyse gün + saat. */
export function when(iso: string | null | undefined): string {
  if (!iso) return '';
  const age = Date.now() - Date.parse(iso);
  return age < 7 * 86_400_000 ? relativeTime(iso) : relativeDateTime(iso);
}

/**
 * Kullanıcı klasörünü `~` ile kısaltır (`C:/Users/ad/Desktop/x` → `~/Desktop/x`): yol kısalır, ayırt eden kısım öne çıkar.
 * Tam yol ipucunda (title) kalır.
 */
export function tidyPath(path: string): string {
  return path.replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+(?=[\\/]|$)/, '~').replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, '~');
}

/**
 * Yolu kısa gösterir. Proje kökünün altındaysa köke göre göreli yazılır (`Projeler\\atlas-panel`): her satırda aynı
 * biçim, ortak kök yinelenmez. Kök dışındaysa ORTADAN kırpılır: ayırt eden son iki parça hep görünür.
 * Tek aralıklı, 12 px, soluk (yol bir koddur); tam yol ipucunda.
 */
export function MiddlePath({ path, root }: { path: string; root?: string }) {
  const norm = (value: string) => value.replace(/[\\/]+$/, '');
  const base = root ? norm(root) : '';
  if (base && path.toLowerCase().startsWith(`${base.toLowerCase()}\\`)) {
    const rootName = base.split(/[\\/]/).pop() ?? '';
    return (
      <span className="block truncate font-mono text-xs text-fg-faint" data-selectable title={path}>
        {`${rootName}\\${path.slice(base.length + 1)}`}
      </span>
    );
  }
  if (base && path.toLowerCase().startsWith(`${base.toLowerCase()}/`)) {
    const rootName = base.split(/[\\/]/).pop() ?? '';
    return (
      <span className="block truncate font-mono text-xs text-fg-faint" data-selectable title={path}>
        {`${rootName}/${path.slice(base.length + 1)}`}
      </span>
    );
  }
  const shown = tidyPath(path);
  const separator = shown.includes('\\') ? '\\' : '/';
  const segments = shown.split(/[\\/]/);
  const tailCount = Math.min(2, Math.max(1, segments.length - 1));
  const tail = segments.slice(-tailCount).join(separator);
  const head = segments.slice(0, -tailCount).join(separator);
  return (
    <span className="flex min-w-0 font-mono text-xs text-fg-faint" data-selectable title={path}>
      {head && <span className="min-w-0 truncate">{head}</span>}
      <span className="min-w-0 shrink-0 truncate">{head ? `${separator}${tail}` : tail}</span>
    </span>
  );
}

/** Boş durumların sağ bölmesi: Jarvis'e söylenebilecek örnek cümleler (bütün boş durumlarda aynı kurgu). */
export function SayExamples({ title, keys }: { title: string; keys: MessageKey[] }) {
  return (
    <div className="prj-empty-side flex flex-col gap-3 px-7 py-8">
      <h3 className="text-sm font-medium text-fg-muted">{title}</h3>
      <ul className="flex flex-col gap-2">
        {keys.map((key) => (
          <li key={key} className="rounded-sm bg-surface-3 px-3.5 py-2.5 text-base text-fg" data-selectable>
            {t(key)}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Yığına göre ikon: proje satırında bir bakışta ne olduğu anlaşılsın. */
export function stackIcon(stack: string[]): Icon {
  if (stack.includes('flutter') || stack.includes('react-native') || stack.includes('expo')) return DeviceMobile;
  if (stack.includes('electron')) return AppWindow;
  if (stack.includes('next') || stack.includes('astro') || stack.includes('vite')) return Lightning;
  if (stack.includes('react') || stack.includes('vue') || stack.includes('svelte')) return Atom;
  if (stack.includes('python') || stack.includes('go') || stack.includes('rust') || stack.includes('php')) return FileCode;
  if (stack.includes('dotnet') || stack.includes('java')) return Cube;
  if (stack.includes('git')) return GitBranch;
  return FolderSimple;
}

/** Yığın etiketlerinden gösterilecekler ("git" ve genel "node" çerçeveden sonra gelir). */
export function stackLabels(stack: string[]): string[] {
  const order = stack.filter((tag) => tag !== 'git');
  const framework = order.filter((tag) => tag !== 'node');
  return (framework.length ? framework : order).slice(0, 3);
}
