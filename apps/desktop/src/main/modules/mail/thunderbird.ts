// Thunderbird (ve aynı biçimdeki Betterbird) profillerinden e-posta hesap AYARLARINI okur: sunucu, port, güvenlik, kullanıcı
// adı, ad ve adres. Yalnız iki düz metin dosyası açılır: kökteki `profiles.ini` ve profil klasöründeki `prefs.js`. Kayıtlı
// parolalar ve belirteçler (`logins.json`, `key4.db`, `cert9.db` …) kapsam DIŞIDIR: bu dosya onları açmaz, okumaz, kopyalamaz.
// Profile hiçbir şey yazılmaz (yalnız `fs.readFileSync`).
//
// Kök: `FUBER2_THUNDERBIRD_HOME` (sınama ve geliştirme) ya da `%APPDATA%\Thunderbird` + `%APPDATA%\Betterbird`. Sınama kipinde
// değişken yoksa hiçbir kök okunmaz (geliştiricinin gerçek profiline dokunulmaz).
import fs from 'node:fs';
import nodePath from 'node:path';
import { t } from '@fuber/shared';
import { MAIL_ADDRESS_PATTERN } from './form';
import { MAIL_PRESETS, transportSecurity } from './presets';
import type { ImportSecurity, MailImportCandidate, MailImportScan, MailProviderId } from './types';

export type PrefValue = string | number | boolean;
export type Source = 'thunderbird' | 'betterbird';
export interface ThunderbirdRoot {
  source: Source;
  dir: string;
}

/** `prefs.js` bundan büyükse okunmaz (bozuk ya da yanlış dosya). */
const MAX_PREFS_BYTES = 20 * 1024 * 1024;
const MAX_INI_BYTES = 256 * 1024;

// ───────────── kökler ve profiller ─────────────

/** Okunacak kökler. `testing`: sınama kipinde değişken yoksa boş liste. */
export function thunderbirdRoots(env: NodeJS.ProcessEnv, testing: boolean): ThunderbirdRoot[] {
  const override = env.FUBER2_THUNDERBIRD_HOME?.trim();
  if (override) return [{ source: 'thunderbird', dir: override }];
  if (testing) return [];
  const appData = env.APPDATA?.trim();
  if (!appData) return [];
  return [
    { source: 'thunderbird', dir: nodePath.join(appData, 'Thunderbird') },
    { source: 'betterbird', dir: nodePath.join(appData, 'Betterbird') },
  ];
}

/** Basit INI ayrıştırıcı: `[Bölüm]` ve `anahtar=değer` (yorum `;`/`#`). */
export function parseIni(text: string): Array<{ section: string; values: Record<string, string> }> {
  const sections: Array<{ section: string; values: Record<string, string> }> = [];
  let current: { section: string; values: Record<string, string> } | null = null;
  for (const rawLine of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const header = /^\[(.+)\]$/.exec(line);
    if (header) {
      current = { section: header[1]!.trim(), values: {} };
      sections.push(current);
      continue;
    }
    const eq = line.indexOf('=');
    if (eq > 0 && current) current.values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return sections;
}

export interface ProfileRef {
  source: Source;
  name: string;
  /** Profil klasörü (mutlak). */
  dir: string;
  /** Profil klasörünün adı (anahtarın parçası). */
  id: string;
  isDefault: boolean;
}

/** `profiles.ini` → profiller; varsayılan (Install bölümünün `Default`ı, yoksa `Default=1`) önce. */
export function listProfiles(root: ThunderbirdRoot, iniText: string): ProfileRef[] {
  const sections = parseIni(iniText);
  const installDefaults = new Set(sections.filter((s) => /^Install/i.test(s.section) && s.values.Default).map((s) => normalizeRel(s.values.Default!)));
  const profiles: Array<ProfileRef & { rank: number }> = [];
  for (const { section, values } of sections) {
    if (!/^Profile\d+$/i.test(section) || !values.Path) continue;
    const relative = values.IsRelative !== '0';
    const dir = relative ? nodePath.join(root.dir, ...values.Path.split(/[\\/]+/)) : values.Path;
    const installed = installDefaults.has(normalizeRel(values.Path));
    const flagged = values.Default === '1';
    profiles.push({
      source: root.source,
      name: values.Name || nodePath.basename(dir),
      dir,
      id: nodePath.basename(dir),
      isDefault: installed || (installDefaults.size === 0 && flagged),
      rank: installed ? 0 : flagged ? 1 : 2,
    });
  }
  return profiles.sort((a, b) => a.rank - b.rank).map(({ rank: _rank, ...profile }) => profile);
}

const normalizeRel = (value: string) => value.replace(/[\\/]+/g, '/').toLowerCase();

// ───────────── prefs.js ─────────────

const PREF_LINE = /^\s*user_pref\(\s*"((?:[^"\\]|\\.)*)"\s*,\s*("(?:[^"\\]|\\.)*"|-?\d+|true|false)\s*\)\s*;/;

function unescapeJs(body: string): string {
  return body.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (_match, code: string) => {
    if (code.length > 1 && (code[0] === 'u' || code[0] === 'x')) return String.fromCharCode(parseInt(code.slice(1), 16));
    return code === 'n' ? '\n' : code === 'r' ? '\r' : code === 't' ? '\t' : code;
  });
}

/** `user_pref("anahtar", değer);` satırları → anahtar/değer. Tanınmayan satırlar (yorum, bozuk) atlanır. */
export function parsePrefs(text: string): Map<string, PrefValue> {
  const prefs = new Map<string, PrefValue>();
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const match = PREF_LINE.exec(line);
    if (!match) continue;
    const key = unescapeJs(match[1]!);
    const raw = match[2]!;
    const value: PrefValue = raw === 'true' ? true : raw === 'false' ? false : raw.startsWith('"') ? unescapeJs(raw.slice(1, -1)) : Number(raw);
    prefs.set(key, value);
  }
  return prefs;
}

// ───────────── hesaplar ─────────────

/** Thunderbird güvenlik değeri → bu modülün terimi. 1 (eski "STARTTLS dene") STARTTLS sayılır. */
export function securityOf(value: PrefValue | undefined): ImportSecurity {
  const n = Number(value ?? 0);
  return n === 3 ? 'tls' : n === 1 || n === 2 ? 'starttls' : 'none';
}

/** `authMethod`: 10 OAuth2 · 5 GSSAPI (Kerberos) · 6 NTLM · 7 TLS sertifikası (desteklenmeyen üçü). */
const AUTH_OAUTH2 = 10;
const AUTH_UNSUPPORTED = new Set([5, 6, 7]);

const OUTLOOK_HOSTS = /(^|\.)(office365\.com|outlook\.com|hotmail\.com|live\.com)$/;
const GMAIL_HOSTS = /(^|\.)(gmail\.com|googlemail\.com)$/;

export function providerOf(imapHost: string): MailProviderId {
  const host = imapHost.trim().toLowerCase();
  const preset = MAIL_PRESETS.find((item) => item.id !== 'custom' && item.imapHost === host);
  if (preset) return preset.id;
  if (GMAIL_HOSTS.test(host)) return 'gmail';
  if (OUTLOOK_HOSTS.test(host)) return 'outlook';
  return 'custom';
}

const csv = (value: PrefValue | undefined) =>
  typeof value === 'string'
    ? value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
    : [];

const str = (value: PrefValue | undefined) => (typeof value === 'string' ? value.trim() : '');
const num = (value: PrefValue | undefined) => (typeof value === 'number' && Number.isInteger(value) ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : 0);
const validPort = (port: number) => port > 0 && port < 65536;

const UNSUPPORTED_TYPE: Record<string, string> = {
  pop3: 'mail.import.reason.pop3',
  none: 'mail.import.reason.local',
  nntp: 'mail.import.reason.news',
  rss: 'mail.import.reason.rss',
  im: 'mail.import.reason.chat',
};

/**
 * Bir profilin `prefs.js` değerlerinden hesap listesi (saf). Hesap sırası `mail.accountmanager.accounts` sırasıdır.
 * IMAP dışındaki hesaplar ve bozuk/eksik kayıtlar listede kalır ama seçilemez (`importable: false`, `reason`).
 */
export function accountsFromPrefs(prefs: Map<string, PrefValue>, profile: Pick<ProfileRef, 'source' | 'name' | 'id'>): MailImportCandidate[] {
  const get = (key: string) => prefs.get(key);
  const out: MailImportCandidate[] = [];
  for (const accountId of csv(get('mail.accountmanager.accounts'))) {
    const serverId = str(get(`mail.account.${accountId}.server`));
    const identityIds = csv(get(`mail.account.${accountId}.identities`));
    const identityId = identityIds[0] ?? '';
    const srv = (field: string) => get(`mail.server.${serverId}.${field}`);
    const idt = (id: string, field: string) => get(`mail.identity.${id}.${field}`);
    const type = serverId ? str(srv('type')) : '';
    const address = identityId ? str(idt(identityId, 'useremail')).toLowerCase() : '';
    const candidate: MailImportCandidate = {
      key: `${profile.source}:${profile.id}:${accountId}`,
      source: profile.source,
      profile: profile.name,
      name: (serverId && str(srv('name'))) || address || accountId,
      address,
      fullName: identityId ? str(idt(identityId, 'fullName')) : '',
      type: type || 'unknown',
      provider: 'custom',
      username: '',
      imapHost: '',
      imapPort: 0,
      imapSecurity: 'none',
      smtpHost: '',
      smtpPort: 0,
      smtpSecurity: 'none',
      oauth: false,
      importable: false,
      reason: null,
      notes: [],
      existing: false,
    };
    out.push(candidate);
    const reject = (key: string) => {
      candidate.reason = t(key);
      return candidate;
    };
    if (!serverId) {
      reject('mail.import.reason.noServer');
      continue;
    }
    if (!type) {
      reject('mail.import.reason.noServer');
      continue;
    }
    if (type !== 'imap') {
      reject(UNSUPPORTED_TYPE[type] ?? 'mail.import.reason.otherType');
      continue;
    }

    // Gelen (IMAP). Thunderbird sunucu adı değişince eskisini `hostname`da, yenisini `realhostname`de tutar.
    const imapHost = (str(srv('realhostname')) || str(srv('hostname'))).toLowerCase();
    const imapSecurity = securityOf(srv('socketType'));
    const imapPort = num(srv('port')) || (imapSecurity === 'tls' ? 993 : 143);
    const imapAuth = num(srv('authMethod')) || 3;
    candidate.imapHost = imapHost;
    candidate.imapPort = imapPort;
    candidate.imapSecurity = imapSecurity;
    candidate.provider = imapHost ? providerOf(imapHost) : 'custom';
    if (!imapHost) {
      reject('mail.import.reason.noHost');
      continue;
    }
    if (!validPort(imapPort)) {
      reject('mail.import.reason.badPort');
      continue;
    }
    if (!identityId) {
      reject('mail.import.reason.noIdentity');
      continue;
    }
    if (!address) {
      reject('mail.import.reason.noAddress');
      continue;
    }
    if (!MAIL_ADDRESS_PATTERN.test(address)) {
      reject('mail.import.reason.badAddress');
      continue;
    }
    candidate.username = str(srv('realuserName')) || str(srv('userName')) || address;

    // Giden (SMTP): kimliğin sunucusu, yoksa varsayılan. Yeni Thunderbird sürümleri `mail.outgoingserver.*` de yazabilir.
    const smtpId = str(idt(identityId, 'smtpServer')) || str(get('mail.smtp.defaultserver')) || str(get('mail.outgoingserver.defaultserver'));
    const smtp = (field: string) => get(`mail.smtpserver.${smtpId}.${field}`) ?? get(`mail.outgoingserver.${smtpId}.${field}`);
    const smtpHost = smtpId ? str(smtp('hostname')).toLowerCase() : '';
    const smtpSecurity = securityOf(smtp('try_ssl'));
    const smtpPort = num(smtp('port')) || (smtpSecurity === 'tls' ? 465 : 587);
    const smtpAuth = num(smtp('authMethod')) || 3;
    candidate.smtpHost = smtpHost;
    candidate.smtpPort = smtpPort;
    candidate.smtpSecurity = smtpSecurity;
    if (!smtpHost) {
      reject('mail.import.reason.noSmtp');
      continue;
    }
    if (!validPort(smtpPort)) {
      reject('mail.import.reason.badPort');
      continue;
    }
    if (AUTH_UNSUPPORTED.has(imapAuth) || AUTH_UNSUPPORTED.has(smtpAuth)) {
      reject('mail.import.reason.auth');
      continue;
    }
    candidate.oauth = imapAuth === AUTH_OAUTH2 || smtpAuth === AUTH_OAUTH2;
    candidate.importable = true;

    // Uyarılar: bu modül güvenliği porttan seçer (`presets.ts` › `transportSecurity`); Thunderbird'ünkiyle farkı yazılır.
    for (const [kind, host, port, security] of [
      ['imap', imapHost, imapPort, imapSecurity],
      ['smtp', smtpHost, smtpPort, smtpSecurity],
    ] as const) {
      const ours = transportSecurity(host, port, kind);
      const label = kind === 'imap' ? t('mail.import.incoming') : t('mail.import.outgoing');
      if (security === 'none' && ours !== 'plain') candidate.notes.push(t('mail.import.note.plain', { which: label }));
      else if (security === 'tls' && ours === 'starttls') candidate.notes.push(t('mail.import.note.tlsPort', { which: label, port }));
    }
    const smtpUser = str(smtp('username'));
    if (smtpUser && smtpUser.toLowerCase() !== candidate.username.toLowerCase()) candidate.notes.push(t('mail.import.note.smtpUser'));
    const extra = identityIds
      .slice(1)
      .map((id) => str(idt(id, 'useremail')).toLowerCase())
      .filter((value) => value && value !== address);
    if (extra.length) candidate.notes.push(t('mail.import.note.identities', { list: extra.join(', ') }));
  }
  return out;
}

// ───────────── tarama ─────────────

export interface ScanDeps {
  roots: ThunderbirdRoot[];
  /** Bu adres (ya da sunucu + kullanıcı adı) uygulamada zaten ekli mi. */
  existing: (candidate: MailImportCandidate) => boolean;
  /** Sınamada okuma gözlemi için; varsayılan `fs.readFileSync`. */
  readFile?: (file: string) => string;
}

function readSmall(file: string, max: number, read: (file: string) => string): string | null {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > max) return null;
    return read(file);
  } catch {
    return null;
  }
}

/** Bütün köklerdeki profilleri okur; varsayılan profil önce, aynı adres ikinci kez listelenmez. */
export function scanThunderbird(deps: ScanDeps): MailImportScan {
  const read = deps.readFile ?? ((file: string) => fs.readFileSync(file, 'utf8'));
  const profiles: MailImportScan['profiles'] = [];
  const accounts: MailImportCandidate[] = [];
  const seen = new Set<string>();
  for (const root of deps.roots) {
    const ini = readSmall(nodePath.join(root.dir, 'profiles.ini'), MAX_INI_BYTES, read);
    if (ini === null) continue;
    for (const profile of listProfiles(root, ini)) {
      // Profil klasöründen YALNIZ prefs.js okunur.
      const text = readSmall(nodePath.join(profile.dir, 'prefs.js'), MAX_PREFS_BYTES, read);
      if (text === null) continue;
      profiles.push({
        source: profile.source,
        name: profile.name,
        isDefault: profile.isDefault,
      });
      for (const candidate of accountsFromPrefs(parsePrefs(text), profile)) {
        const dedupe = candidate.address ? `addr:${candidate.address}` : `key:${candidate.key}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        candidate.existing = candidate.importable && deps.existing(candidate);
        accounts.push(candidate);
      }
    }
  }
  const found = profiles.length > 0;
  return {
    found,
    reason: found ? null : t('mail.import.noProfile'),
    profiles,
    accounts,
  };
}
