// Geliştirici kipi kapısı: çekirdek kendini geliştirme YALNIZ üç koşul birlikte sağlanırsa çalışır:
//   1. Yönetim politikası izin verir (`Policy.developer.enabled`, varsayılan kapalı; modül de açık olmalı),
//   2. kullanıcı bu cihazda kipi açmıştır (`Settings.developerMode`, varsayılan kapalı),
//   3. `Settings.developerRepoPath` geçerli bir Fuber AI 2 kaynak deposunu gösterir.
// Depo doğrulaması eşzamanlı ve yan etkisizdir: hiçbir şey yazmaz.
import fs from 'node:fs';
import path from 'node:path';
import { t } from '@fuber/shared';
import { z } from 'zod';
import type { GateState } from './types';

/** Kaynak deposunun kök `package.json` adı (bu depo: github.com/fberkehan/orion). */
export const REPO_PACKAGE_NAME = 'fuber-ai-v2';

export type RepoCheck = { ok: true; root: string } | { ok: false; reason: string };

const fold = (value: string): string => (process.platform === 'win32' ? value.toLowerCase() : value);

/** `child` (bağlantılar çözülmüş) `parent`'ın içinde mi. */
function isInside(parent: string, child: string): boolean {
  const a = fold(path.resolve(parent));
  const b = fold(path.resolve(child));
  return b === a || b.startsWith(a.endsWith(path.sep) ? a : a + path.sep);
}

/**
 * Yol geçerli bir kaynak deposu mu: mutlak, var, klasör, `.git` var (klasör ya da worktree dosyası), kök `package.json` adı
 * `REPO_PACKAGE_NAME`. `forbidden`: içinde olunmaması gereken klasörler (veri kökü).
 */
export function validateRepo(repoPath: string | null | undefined, forbidden: string[] = []): RepoCheck {
  if (!repoPath || !repoPath.trim()) return { ok: false, reason: t('selfdev.gate.noRepo') };
  if (!path.isAbsolute(repoPath)) return { ok: false, reason: t('selfdev.gate.notAbsolute') };
  let root: string;
  try {
    root = fs.realpathSync.native(repoPath);
    if (!fs.statSync(root).isDirectory()) return { ok: false, reason: t('selfdev.gate.notFolder') };
  } catch {
    return { ok: false, reason: t('selfdev.gate.missing') };
  }
  for (const bad of forbidden) {
    if (bad && isInside(bad, root)) return { ok: false, reason: t('selfdev.gate.forbidden') };
  }
  if (!fs.existsSync(path.join(root, '.git'))) return { ok: false, reason: t('selfdev.gate.noGit') };
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { name?: unknown };
    if (parsed.name !== REPO_PACKAGE_NAME) return { ok: false, reason: t('selfdev.gate.wrongRepo', { name: String(parsed.name ?? '') }) };
  } catch {
    return { ok: false, reason: t('selfdev.gate.noPackage') };
  }
  return { ok: true, root };
}

export interface GateInput {
  /** `Policy.developer.enabled`. */
  policyEnabled: boolean;
  /** Modül politikaca açık mı (`policy.moduleAllowed('selfdev')`). */
  moduleAllowed: boolean;
  /** `Settings.developerMode`. */
  settingEnabled: boolean;
  /** `Settings.developerRepoPath`. */
  repoPath: string | null;
  /** İçinde depo olamayacak klasörler. */
  forbidden?: string[];
}

/** Kapıyı değerlendirir. Kapalıysa neden Türkçe söylenir (araçlar ve sayfa aynı cümleyi kullanır). */
export function evaluateGate(input: GateInput): GateState {
  const policy = input.policyEnabled && input.moduleAllowed;
  const repo = input.settingEnabled ? validateRepo(input.repoPath, input.forbidden) : null;
  const base = {
    policy,
    setting: input.settingEnabled,
    repoPath: input.repoPath,
    repoOk: repo?.ok === true,
  };
  if (!policy) return { ...base, open: false, reason: t('selfdev.gate.policyOff') };
  if (!input.settingEnabled) return { ...base, open: false, reason: t('selfdev.gate.settingOff') };
  if (repo && !repo.ok) return { ...base, open: false, reason: repo.reason };
  return { ...base, open: true, reason: null };
}

// ───────────────────────── yapılandırma (Policy.modules.selfdev.config) ─────────────────────────

const ScriptName = z.string().regex(/^[A-Za-z0-9:_.-]{1,60}$/);
const E2eScript = z.string().regex(/^scripts\/[A-Za-z0-9_./-]{1,100}\.mjs$/);

export const SelfdevConfigSchema = z.object({
  /** Her çalışmada koşan npm betikleri (sırayla; ilk başarısızda durulur). */
  verify: z.array(ScriptName).max(8).default(['typecheck', 'test']),
  /** Yapılandırılmışsa koşan uçtan uca betikler (`node scripts/e2e/...`; önce `npm run build`). */
  e2e: z.array(E2eScript).max(6).default([]),
  /** Kurulum paketini üreten npm betiği. */
  packager: ScriptName.default('dist:desktop'),
  /** Worktree'de `npm ci` koşsun mu (sahte depoda kapatılabilir). */
  install: z.boolean().default(true),
  /** Düzeltme turu üst sınırı (kullanıcı kuralı: en çok 2; yapılandırmayla en çok 3). */
  maxFixRounds: z.number().int().min(0).max(3).default(2),
  /** Worktree'nin tabanı: dal adı; verilmezse deponun o anki HEAD'i. */
  baseBranch: z.string().regex(/^[A-Za-z0-9._/-]{1,100}$/).nullable().default(null),
  /** Yeni sürüm açıldıktan kaç saniye sonra sağlık denetimi koşar. */
  healthDelaySeconds: z.number().int().min(0).max(300).default(20),
  /** Adım zaman aşımları (dakika). */
  planMinutes: z.number().int().min(1).max(60).default(15),
  implementMinutes: z.number().int().min(1).max(180).default(60),
  commandMinutes: z.number().int().min(1).max(60).default(20),
  packageMinutes: z.number().int().min(1).max(60).default(20),
});
export type SelfdevConfig = z.infer<typeof SelfdevConfigSchema>;

/** Politikadaki serbest yapılandırmayı doğrular; geçersiz alan varsayılana düşer (kapı kapanmaz). */
export function parseConfig(raw: Record<string, unknown> | undefined): SelfdevConfig {
  const parsed = SelfdevConfigSchema.safeParse(raw ?? {});
  if (parsed.success) return parsed.data;
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw ?? {})) {
    const field = SelfdevConfigSchema.shape[key as keyof typeof SelfdevConfigSchema.shape];
    if (field && field.safeParse(value).success) clean[key] = value;
  }
  return SelfdevConfigSchema.parse(clean);
}
