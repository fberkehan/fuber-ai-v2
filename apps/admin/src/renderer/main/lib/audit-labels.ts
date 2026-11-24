/**
 * Denetim kaydının özet satırını okunur kılar. Denetim hizmeti politika değişikliklerini ham alan yollarıyla
 * yazar ("Politika sürüm 12 yayınlandı: brain.claudeCode.use, models.voice.model"); kayıtlar veritabanında
 * öyle durur, bu yüzden çeviri gösterirken yapılır (eski kayıtlar da düzelir). Bilinen yol sözlükteki adını alır
 * (`admin.audit.field.<yol>`), `modules.<kimlik>.enabled` modül adını; bilinmeyen yol olduğu gibi kalır.
 */
import { hasMessage, t, type AuditEntry } from '@fuber/shared';

/** Alan yolu ya da tek sözcüklük üst düzey alan; Türkçe harfler `\w` dışında kaldığından Türkçe sözcükler bölünür ve eşleşmez. */
const TOKEN = /\(kök\)|[A-Za-z][\w-]*(?:\.[\w-]+)*/g;
const MODULE = /^modules\.([\w-]+)\.(enabled|config)(?:\.|$)/;

/**
 * Tek bir politika alan yolunun okunur adı; bilinmiyorsa `null`. Tam yol sözlükte yoksa en az iki parçalı en yakın
 * üst yol denenir (`models.voice.price.input` → "Sesli yanıt fiyatı", `voice.s2s.model` gibi alt alanlar).
 */
export function policyFieldLabel(path: string): string | null {
  const module = MODULE.exec(path);
  if (module && hasMessage(`module.${module[1]}.name`)) {
    return t(module[2] === 'enabled' ? 'admin.audit.module' : 'admin.audit.moduleConfig', { name: t(`module.${module[1]}.name`) });
  }
  const parts = path.split('.');
  for (let length = parts.length; length >= Math.min(2, parts.length); length--) {
    const key = `admin.audit.field.${parts.slice(0, length).join('.')}`;
    if (hasMessage(key)) return t(key);
  }
  return null;
}

/** Özet satırı: yalnız politika kayıtlarında, "yayınlandı:" ile not arasındaki alan listesi çevrilir. */
export function auditSummaryText(entry: Pick<AuditEntry, 'action' | 'summary'>): string {
  if (entry.action !== 'policy.update' && entry.action !== 'policy.rollback') return entry.summary;
  const marker = 'yayınlandı: ';
  const start = entry.summary.indexOf(marker);
  if (start < 0) return entry.summary;
  const from = start + marker.length;
  const noteAt = entry.summary.indexOf(' (not: ', from);
  const to = noteAt < 0 ? entry.summary.length : noteAt;
  const fields = entry.summary.slice(from, to).replace(TOKEN, (token) => policyFieldLabel(token) ?? token);
  return entry.summary.slice(0, from) + fields + entry.summary.slice(to);
}
