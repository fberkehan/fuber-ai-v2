// Thunderbird'den hesap ayarlarını içe aktarma: tarama (`thunderbird.ts`) + hesap başına ekleme ve sınama (`service.ts` ›
// `importAccount`). Arayüzden gelen istek yalnız ANAHTAR ve (varsa) parola taşır; sunucu bilgisi her seferinde profilden
// yeniden okunur (arayüz sunucu adı dayatamaz). Yanıtta ve günlükte yalnız hesap adı, adres ve sunucu bilgisi; parola asla.
import { t, type Logger } from '@fuber/shared';
import type { MailService } from './service';
import { scanThunderbird, type ThunderbirdRoot } from './thunderbird';
import type { MailImportCandidate, MailImportResult, MailImportScan } from './types';

export interface ImporterDeps {
  service: () => MailService;
  roots: () => ThunderbirdRoot[];
  log: Logger;
  readFile?: (file: string) => string;
}

export function createMailImporter(deps: ImporterDeps) {
  const existing = (candidate: MailImportCandidate): boolean => {
    const service = deps.service();
    if (service.repo.accountByAddress(candidate.address)) return true;
    const host = candidate.imapHost.toLowerCase();
    const user = candidate.username.toLowerCase();
    return service.repo.accounts().some((row) => row.imap_host.toLowerCase() === host && row.username.toLowerCase() === user);
  };

  function scan(): MailImportScan {
    const result = scanThunderbird({
      roots: deps.roots(),
      existing,
      ...(deps.readFile ? { readFile: deps.readFile } : {}),
    });
    deps.log.info('thunderbird taraması', {
      profiles: result.profiles.length,
      accounts: result.accounts.length,
      importable: result.accounts.filter((a) => a.importable).length,
    });
    return result;
  }

  async function importAccounts(items: Array<{ key: string; password?: string | undefined }>): Promise<MailImportResult[]> {
    const fresh = scan();
    const byKey = new Map(fresh.accounts.map((candidate) => [candidate.key, candidate]));
    const results: MailImportResult[] = [];
    const done = new Set<string>();
    for (const item of items) {
      if (done.has(item.key)) continue;
      done.add(item.key);
      const candidate = byKey.get(item.key);
      if (!candidate || !candidate.importable) {
        results.push({
          key: item.key,
          address: candidate?.address ?? '',
          status: 'notFound',
          text: candidate?.reason ?? t('mail.import.status.notFound'),
          accountId: null,
        });
        continue;
      }
      // Aynı istekte az önce eklenen hesap da sayılır (aynı sunucu + kullanıcı adı iki kez eklenmez).
      if (candidate.existing || existing(candidate)) {
        results.push({
          key: item.key,
          address: candidate.address,
          status: 'exists',
          text: t('mail.import.status.exists'),
          accountId: null,
        });
        continue;
      }
      const outcome = await deps.service().importAccount(
        {
          provider: candidate.provider,
          label: candidate.fullName || candidate.address,
          address: candidate.address,
          username: candidate.username,
          ...(item.password ? { password: item.password } : {}),
          imapHost: candidate.imapHost,
          imapPort: candidate.imapPort,
          smtpHost: candidate.smtpHost,
          smtpPort: candidate.smtpPort,
        },
        { oauth: candidate.oauth },
      );
      results.push({ key: item.key, address: candidate.address, ...outcome });
    }
    deps.log.info('thunderbird içe aktarma', {
      requested: items.length,
      saved: results.filter((r) => r.accountId).length,
    });
    return results;
  }

  return { scan, importAccounts };
}

export type MailImporter = ReturnType<typeof createMailImporter>;
