// Açılış sağlık denetimi. Kurulumdan önce `pending-update.json` yazılır (koşu, eski/yeni sürüm, deneme sayısı). Yeni sürüm
// açılınca modül bunu okur; modüller yüklenip ana servisler ayağa kalktıktan N sn sonra sağlık denetimini koşar, `health.json`
// yazar (kurucu betik bunu bekler) ve koşuyu `installed` yapar. Başarısızsa ya da açılış iki kez sağlık işareti yazamadan
// bittiyse (çöküp yeniden açılma) GERİ ALMA ÖNERİLİR (kendiliğinden geri alınmaz: o da açık onaylıdır).
// Bu dosya SAFTIR (disk/servis yok): kararlar ve yoklama sonuçlarının yorumu; kablolama `index.ts`'tedir.
import type { PendingUpdate } from './types';

/** Açılışta ne yapılmalı. */
export type StartupDecision =
  /** Bekleyen güncelleme yok. */
  | { action: 'none' }
  /** Beklenen sürüm çalışıyor: gecikmeden sonra sağlık denetimini koş. */
  | { action: 'verify'; pending: PendingUpdate }
  /** Beklenen sürüm değil, eski sürüm açıldı: kurulum hiç tutmadı (kurucu başarısız, kullanıcı eski kısayoldan açtı). */
  | { action: 'install-missed'; pending: PendingUpdate }
  /** Açılış art arda sağlık işareti yazamadan bitti: yeni sürüm çöküyor olabilir. Geri almayı öner. */
  | { action: 'recommend-rollback'; pending: PendingUpdate; reason: string };

/** Sağlık işareti yazamadan biten açılış sayısı bu değere ulaşınca geri alma önerilir. */
export const MAX_SILENT_STARTS = 2;

/**
 * Açılış kararı. `pending.attempts` bu açılış SAYILMADAN, önceki açılışların sağlık işareti yazamadan bittiği sayıdır.
 * Dönen `pending` deneme sayısı artırılmış halde değil; artırmak çağıranın işidir.
 */
export function decideStartup(pending: PendingUpdate | null, runningVersion: string): StartupDecision {
  if (!pending) return { action: 'none' };
  if (runningVersion !== pending.toVersion) return { action: 'install-missed', pending };
  if (pending.attempts >= MAX_SILENT_STARTS) {
    return { action: 'recommend-rollback', pending, reason: `yeni sürüm ${pending.attempts} kez açılıp sağlık işareti yazamadan kapandı` };
  }
  return { action: 'verify', pending };
}

/** Bir yoklamanın sonucu. */
export interface Probe {
  name: string;
  ok: boolean;
  detail?: string;
}

/** Sağlık yoklamaları için gereken, servislerden okunan değerler (kablolama toplar; bu işlev yalnız yorumlar). */
export interface HealthFacts {
  /** Veritabanı sorgusu yanıt verdi mi. */
  dbOpen: boolean;
  /** Ayarlar okunabildi mi. */
  settingsReadable: boolean;
  /** Beyin durumu okunabildi mi (fırlatmadı). */
  brainStatusReadable: boolean;
  /** Kayıtlı araçların bulunduğu ayrı modül sayısı. */
  toolModules: number;
  /** Modül yükleme hatası bildirildi mi (bilinmiyorsa `false`). */
  moduleLoadErrors: number;
}

/** Yeni sürümün "açıldı ve temel servisleri ayakta" sayılması için en az araç modülü sayısı. */
export const MIN_TOOL_MODULES = 3;

export function evaluateHealth(facts: HealthFacts): { ok: boolean; probes: Probe[] } {
  const probes: Probe[] = [
    { name: 'veritabanı', ok: facts.dbOpen },
    { name: 'ayarlar', ok: facts.settingsReadable },
    { name: 'beyin durumu', ok: facts.brainStatusReadable },
    { name: 'modüller', ok: facts.toolModules >= MIN_TOOL_MODULES, detail: `${facts.toolModules} modülün aracı kayıtlı` },
    { name: 'modül yükleme', ok: facts.moduleLoadErrors === 0, detail: facts.moduleLoadErrors ? `${facts.moduleLoadErrors} hata` : undefined },
  ];
  return { ok: probes.every((probe) => probe.ok), probes };
}

/** Başarısız yoklamaların tek cümlelik özeti. */
export const failureReason = (probes: Probe[]): string =>
  probes
    .filter((probe) => !probe.ok)
    .map((probe) => (probe.detail ? `${probe.name} (${probe.detail})` : probe.name))
    .join(', ') || 'bilinmeyen neden';

/** `health.json` içeriği (kurucu betik okur). */
export interface HealthMark {
  version: string;
  runId: string;
  ok: boolean;
  at: string;
  reason: string | null;
}
