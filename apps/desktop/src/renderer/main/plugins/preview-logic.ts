// Eklenti önizlemesinin saf mantığı: "ne ekliyor" rozetleri ve ana süreçten gelen hazır Türkçe satırların türe göre sınıflanması.
import type { PluginPreview } from '../../../main/modules/workshop/types';

export type AddKind = 'tools' | 'cards' | 'jobs' | 'watches' | 'pages' | 'settings' | 'voice';
export const ADD_KINDS: readonly AddKind[] = ['tools', 'cards', 'jobs', 'watches', 'pages', 'settings', 'voice'];

export type AddCounts = Partial<Record<AddKind, number>>;

/** Sıfır olanlar düşer; sıra sabittir (araç, kart, iş, takip, sayfa, ayar, sesli komut). */
export function addsBadges(adds: AddCounts | null | undefined): Array<{ kind: AddKind; count: number }> {
  if (!adds) return [];
  return ADD_KINDS.map((kind) => ({ kind, count: adds[kind] ?? 0 })).filter((entry) => entry.count > 0);
}

/** "Ne ekleyecek" satırının türü (anahtar sözcüklerle; tanınmayan satır genel olur). */
export function classifyAdd(line: string): AddKind | 'other' {
  const text = line.toLocaleLowerCase('tr');
  if (/sesli|söyle|komut|kalıp/.test(text)) return 'voice';
  if (/pano|kart/.test(text)) return 'cards';
  if (/takip|izle/.test(text)) return 'watches';
  if (/sayfa|menü/.test(text)) return 'pages';
  if (/ayar/.test(text)) return 'settings';
  if (/zamanlan|her gün|dakikada|saatte|\biş\b|işi|işler|olay/.test(text)) return 'jobs';
  if (/araç/.test(text)) return 'tools';
  return 'other';
}

export type PermissionKind = 'net' | 'files' | 'tools' | 'speak' | 'notify' | 'other';

/**
 * İzin satırının türü. Önce yapılandırılmış alanlara bakılır (satır bir alan adını, klasör kökünü ya da araç adını
 * anıyorsa), sonra anahtar sözcüklere.
 */
export function classifyPermission(line: string, preview?: Pick<PluginPreview, 'hosts' | 'roots' | 'usedTools'> | null): PermissionKind {
  const text = line.toLocaleLowerCase('tr');
  if (preview) {
    if (preview.hosts.some((host) => text.includes(host.toLowerCase()))) return 'net';
    if (preview.roots.some((root) => text.includes(root.toLowerCase()))) return 'files';
    if (preview.usedTools.some((tool) => text.includes(tool.toLowerCase()))) return 'tools';
  }
  if (/internet|alan ad|ağ\b|adres|bağlan/.test(text)) return 'net';
  if (/dosya|klasör|belgeler|masaüstü|indirilenler/.test(text)) return 'files';
  if (/bildirim/.test(text)) return 'notify';
  if (/sesli|sesle|söyle|konuş|duyur|ses\b/.test(text)) return 'speak';
  if (/araç|jarvis/.test(text)) return 'tools';
  return 'other';
}

/** Yerel ağa ya da bu bilgisayara giden alan adı (uyarı rengi): `localhost` ya da IP. */
export const isLocalHost = (host: string) => /^(localhost|\d{1,3}(\.\d{1,3}){3})(:\d+)?$/.test(host);

/** Önizlemede o türün yapılandırılmış değerleri (satırın altında kod etiketi olarak gösterilir). */
export function permissionValues(kind: PermissionKind, preview: Pick<PluginPreview, 'hosts' | 'roots' | 'usedTools'> | null | undefined): string[] {
  if (!preview) return [];
  if (kind === 'net') return preview.hosts;
  if (kind === 'files') return preview.roots;
  if (kind === 'tools') return preview.usedTools;
  return [];
}
