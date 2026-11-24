// Thunderbird'den hesap AYARLARINI içe aktarma: ayrıştırma (prefs.js, profiles.ini), eşleme (güvenlik, OAuth, desteklenmeyen
// türler, bozuk kayıtlar), "zaten ekli" tespiti, içe aktarma ve 127.0.0.1'deki sahte IMAP/SMTP ile bağlantı sınaması.
// Sınama verisi elle yazılmış örnek profildir (`fixtures/thunderbird`); gerçek Thunderbird profili okunmaz.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bus, BusEvents } from '@fuber/shared';
import { createBus } from '../../core/bus';
import { fakePolicy, fakeSettings, fakeVoice, silentLog, tempStore } from '../../core/brain/testkit';
import { startFakeImap, startFakeSmtp, type FakeImap, type FakeSmtp } from './fake-servers';
import { createMailImporter, type MailImporter } from './importer';
import { createMailRepo, MAIL_MIGRATIONS } from './repo';
import type { SecretCipher } from './secrets';
import { createMailService, type MailService } from './service';
import { accountsFromPrefs, listProfiles, parsePrefs, providerOf, scanThunderbird, securityOf, thunderbirdRoots } from './thunderbird';
import { createMailTools } from './tools';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'thunderbird');
const PROFILE = path.join(FIXTURE, 'Profiles', 'k3x9.default');
const fixturePrefs = () => parsePrefs(fs.readFileSync(path.join(PROFILE, 'prefs.js'), 'utf8'));
const tb = (dir: string) => [{ source: 'thunderbird' as const, dir }];

describe('ayrıştırma', () => {
  it('prefs.js: dize (kaçış dizileri, \\u, UTF-8), sayı, boolean; bozuk satır ve yorum atlanır', () => {
    const prefs = parsePrefs(
      [
        '// yorum user_pref("yorum", 1);',
        'user_pref("a.str", "x \\"tırnak\\" \\\\ ters");',
        'user_pref("a.uni", "\\u015eirket");',
        'user_pref("a.raw", "Gülşah");',
        'user_pref("a.num", 993);',
        'user_pref("a.neg", -1);',
        'user_pref("a.bool", true);',
        'user_pref("a.off", false);',
        'user_pref("bozuk", );',
        'user_pref("yarım"',
      ].join('\n'),
    );
    expect(prefs.get('a.str')).toBe('x "tırnak" \\ ters');
    expect(prefs.get('a.uni')).toBe('Şirket');
    expect(prefs.get('a.raw')).toBe('Gülşah');
    expect(prefs.get('a.num')).toBe(993);
    expect(prefs.get('a.neg')).toBe(-1);
    expect(prefs.get('a.bool')).toBe(true);
    expect(prefs.get('a.off')).toBe(false);
    expect(prefs.has('bozuk')).toBe(false);
    expect(prefs.has('yarım')).toBe(false);
    expect(prefs.has('yorum')).toBe(false);
  });

  it('profiles.ini: Install bölümünün varsayılanı önce; göreli yol köke bağlanır', () => {
    const profiles = listProfiles(tb(FIXTURE)[0]!, fs.readFileSync(path.join(FIXTURE, 'profiles.ini'), 'utf8'));
    expect(profiles.map((p) => [p.name, p.isDefault])).toEqual([
      ['default-release', true],
      ['default', false],
    ]);
    expect(profiles[0]!.dir).toBe(PROFILE);
    // Install bölümü yoksa Default=1 olan varsayılandır.
    const legacy = listProfiles(tb('C:\\tb')[0]!, '[Profile0]\nName=a\nPath=Profiles/a\n[Profile1]\nName=b\nPath=Profiles/b\nDefault=1\n');
    expect(legacy.map((p) => [p.name, p.isDefault])).toEqual([
      ['b', true],
      ['a', false],
    ]);
    const absolute = listProfiles(tb('C:\\tb')[0]!, '[Profile0]\nName=x\nIsRelative=0\nPath=D:\\Posta\\x\n');
    expect(absolute[0]!.dir).toBe('D:\\Posta\\x');
  });

  it('güvenlik ve sağlayıcı eşlemesi', () => {
    expect([securityOf(0), securityOf(1), securityOf(2), securityOf(3), securityOf(undefined)]).toEqual(['none', 'starttls', 'starttls', 'tls', 'none']);
    expect(providerOf('imap.gmail.com')).toBe('gmail');
    expect(providerOf('outlook.office365.com')).toBe('outlook');
    expect(providerOf('imap-mail.outlook.com')).toBe('outlook');
    expect(providerOf('mail.ornek.test')).toBe('custom');
  });

  it('kökler: FUBER2_THUNDERBIRD_HOME öncelikli; sınama kipinde değişken yoksa HİÇBİR kök (gerçek profil okunmaz)', () => {
    expect(thunderbirdRoots({ FUBER2_THUNDERBIRD_HOME: 'C:\\ornek', APPDATA: 'C:\\A' }, true)).toEqual([{ source: 'thunderbird', dir: 'C:\\ornek' }]);
    expect(thunderbirdRoots({ APPDATA: 'C:\\A' }, true)).toEqual([]);
    expect(thunderbirdRoots({ APPDATA: 'C:\\A' }, false)).toEqual([
      { source: 'thunderbird', dir: path.join('C:\\A', 'Thunderbird') },
      { source: 'betterbird', dir: path.join('C:\\A', 'Betterbird') },
    ]);
    expect(thunderbirdRoots({}, false)).toEqual([]);
  });
});

describe('eşleme (örnek profil)', () => {
  const accounts = accountsFromPrefs(fixturePrefs(), {
    source: 'thunderbird',
    name: 'default-release',
    id: 'k3x9.default',
  });
  const by = (key: string) => accounts.find((a) => a.key === `thunderbird:k3x9.default:${key}`)!;

  it('sıra mail.accountmanager.accounts sırasıdır; her hesap listede (seçilemeyenler nedeniyle)', () => {
    expect(accounts.map((a) => a.key.split(':')[2])).toEqual(['account1', 'account2', 'account3', 'account6', 'account5', 'account8', 'account7', 'account9', 'account4']);
    expect(accounts.filter((a) => a.importable).map((a) => a.address)).toEqual(['gulsah@ornek.test', 'kaan@ornek.test', 'birinci@iki.test']);
  });

  it('IMAP + SMTP parolalı hesap: Türkçe ad, küçük harfli adres, SSL/TLS', () => {
    expect(by('account1')).toMatchObject({
      name: 'Şirket Postası – Gülşah',
      address: 'gulsah@ornek.test',
      fullName: 'Gülşah Öztürk',
      provider: 'custom',
      username: 'gulsah@ornek.test',
      imapHost: 'mail.ornek.test',
      imapPort: 993,
      imapSecurity: 'tls',
      smtpHost: 'smtp.ornek.test',
      smtpPort: 465,
      smtpSecurity: 'tls',
      oauth: false,
      importable: true,
      reason: null,
      notes: [],
    });
  });

  it('OAuth2 hesap: "uygulamadan giriş gerekli" işareti, Gmail sağlayıcısı, kaçışlı tırnaklı ad', () => {
    expect(by('account2')).toMatchObject({
      oauth: true,
      provider: 'gmail',
      importable: true,
      fullName: 'Kaan "Deneme" Yılmaz',
      imapHost: 'imap.gmail.com',
    });
  });

  it('iki kimlikli hesap: ilk kimlik; STARTTLS varsayılan portlar (143/587); varsayılan SMTP; uyarılar', () => {
    const account = by('account6');
    expect(account).toMatchObject({
      address: 'birinci@iki.test',
      fullName: 'İki Kimlikli',
      imapHost: 'imap.iki.test',
      imapPort: 143,
      imapSecurity: 'starttls',
      smtpHost: 'smtp.iki.test',
      smtpPort: 587,
      smtpSecurity: 'starttls',
      username: 'birinci',
    });
    expect(account.notes.join(' ')).toMatch(/kullanıcı adı farklı/);
    expect(account.notes.join(' ')).toMatch(/ikinci@iki\.test/);
  });

  it('POP3, yerel klasörler, haber grubu: desteklenmiyor; bozuk/eksik kayıt nedeniyle', () => {
    expect(by('account3')).toMatchObject({ importable: false, type: 'pop3' });
    expect(by('account3').reason).toMatch(/POP3/);
    expect(by('account4').reason).toMatch(/Yerel klasörler/);
    expect(by('account7').reason).toMatch(/Haber grubu/);
    expect(by('account5')).toMatchObject({
      importable: false,
      name: 'Kırık Kayıt',
    });
    expect(by('account5').reason).toMatch(/sunucunun adı yok/);
    expect(by('account8').reason).toMatch(/e-posta adresi yok/);
    expect(by('account9').reason).toMatch(/gelen sunucu bilgisi yok/);
  });

  it('şifresiz Thunderbird ayarı ve 993 dışı SSL portu uyarı alır', () => {
    const prefs = parsePrefs(
      [
        'user_pref("mail.accountmanager.accounts", "a1");',
        'user_pref("mail.account.a1.server", "s1");',
        'user_pref("mail.account.a1.identities", "i1");',
        'user_pref("mail.identity.i1.useremail", "x@y.test");',
        'user_pref("mail.identity.i1.smtpServer", "o1");',
        'user_pref("mail.server.s1.type", "imap");',
        'user_pref("mail.server.s1.hostname", "imap.y.test");',
        'user_pref("mail.server.s1.port", 1993);',
        'user_pref("mail.server.s1.socketType", 3);',
        'user_pref("mail.server.s1.authMethod", 6);',
        'user_pref("mail.outgoingserver.o1.hostname", "smtp.y.test");',
        'user_pref("mail.outgoingserver.o1.port", 25);',
      ].join('\n'),
    );
    const [ntlm] = accountsFromPrefs(prefs, {
      source: 'thunderbird',
      name: 'p',
      id: 'p',
    });
    // NTLM desteklenmez; yeni sürümlerin `mail.outgoingserver.*` adları da okunur.
    expect(ntlm).toMatchObject({
      importable: false,
      smtpHost: 'smtp.y.test',
      smtpPort: 25,
    });
    expect(ntlm!.reason).toMatch(/NTLM/);
    prefs.set('mail.server.s1.authMethod', 3);
    const [ok] = accountsFromPrefs(prefs, {
      source: 'thunderbird',
      name: 'p',
      id: 'p',
    });
    expect(ok!.importable).toBe(true);
    expect(ok!.notes.join(' ')).toMatch(/1993 portunda baştan şifreli/);
    expect(ok!.notes.join(' ')).toMatch(/Giden sunucu Thunderbird’de şifresiz/);
  });
});

describe('tarama', () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-tb-'));
    fs.cpSync(FIXTURE, home, { recursive: true });
    // Parola dosyaları: tarama bunları AÇMAMALI.
    for (const name of ['logins.json', 'key4.db', 'cert9.db']) fs.writeFileSync(path.join(home, 'Profiles', 'k3x9.default', name), 'GIZLI-PAROLA-IZI');
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it('iki profil: varsayılan önce, aynı adres bir kez; yalnız profiles.ini ve prefs.js okunur; profile yazılmaz', () => {
    const read: string[] = [];
    const before = new Map(walk(home).map((file) => [file, fs.statSync(file).mtimeMs]));
    const scan = scanThunderbird({
      roots: tb(home),
      existing: () => false,
      readFile: (file) => (read.push(path.basename(file)), fs.readFileSync(file, 'utf8')),
    });
    expect(scan.found).toBe(true);
    expect(scan.profiles.map((p) => p.name)).toEqual(['default-release', 'default']);
    expect(scan.accounts.filter((a) => a.address === 'gulsah@ornek.test')).toHaveLength(1);
    expect(scan.accounts.find((a) => a.address === 'gulsah@ornek.test')!.profile).toBe('default-release');
    const archive = scan.accounts.find((a) => a.address === 'arsiv@eski.test')!;
    expect(archive).toMatchObject({
      profile: 'default',
      importable: true,
      imapSecurity: 'none',
    });
    expect(archive.notes).toHaveLength(2);
    expect(new Set(read)).toEqual(new Set(['profiles.ini', 'prefs.js']));
    expect(JSON.stringify(scan)).not.toContain('GIZLI-PAROLA-IZI');
    for (const [file, mtime] of before) expect(fs.statSync(file).mtimeMs, file).toBe(mtime);
    expect(walk(home).length).toBe(before.size);
  });

  it('profil yoksa: found=false ve açıklama', () => {
    const scan = scanThunderbird({
      roots: tb(path.join(home, 'yok')),
      existing: () => false,
    });
    expect(scan).toMatchObject({ found: false, accounts: [], profiles: [] });
    expect(scan.reason).toMatch(/profili bulunamadı/);
  });
});

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]));
}

// ───────────── içe aktarma: sahte sunucularla ─────────────

const PASSWORD = 'Ice-Aktar_9vQ3mZ';
const USER = 'gulsah@ornek.test';

const fakeCipher: SecretCipher = {
  available: () => true,
  encrypt: (plain) => `enc:${Buffer.from([...plain].reverse().join(''), 'utf8').toString('base64')}`,
  decrypt: (encoded) => [...Buffer.from(encoded.slice(4), 'base64').toString('utf8')].reverse().join(''),
};

/** Kapalı bir port (sunucuya ulaşılamadı sınaması). */
async function closedPort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

/** Sahte sunuculara bakan örnek profil (geri döngü: şifresiz bağlantıya yalnız burada izin var). */
function writeProfile(home: string, ports: { imap: number; smtp: number; dead: number }) {
  const dir = path.join(home, 'Profiles', 'p1.default-release');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(home, 'profiles.ini'), '[Profile0]\nName=default-release\nIsRelative=1\nPath=Profiles/p1.default-release\nDefault=1\n');
  const account = (n: number, address: string, imapPort: number, auth = 3, type = 'imap') =>
    [
      `user_pref("mail.account.account${n}.server", "server${n}");`,
      `user_pref("mail.account.account${n}.identities", "id${n}");`,
      `user_pref("mail.identity.id${n}.useremail", "${address}");`,
      `user_pref("mail.identity.id${n}.fullName", "Hesap ${n}");`,
      `user_pref("mail.identity.id${n}.smtpServer", "smtp1");`,
      `user_pref("mail.server.server${n}.type", "${type}");`,
      `user_pref("mail.server.server${n}.hostname", "127.0.0.1");`,
      `user_pref("mail.server.server${n}.port", ${imapPort});`,
      `user_pref("mail.server.server${n}.socketType", 0);`,
      `user_pref("mail.server.server${n}.userName", "${address}");`,
      `user_pref("mail.server.server${n}.authMethod", ${auth});`,
    ].join('\n');
  fs.writeFileSync(
    path.join(dir, 'prefs.js'),
    [
      'user_pref("mail.accountmanager.accounts", "account1,account2,account3,account4,account5");',
      account(1, USER, ports.imap),
      account(2, 'yanlis@ornek.test', ports.imap),
      account(3, 'oauth@ornek.test', ports.imap, 10),
      account(4, 'ulasilamaz@ornek.test', ports.dead),
      account(5, 'pop@ornek.test', ports.imap, 3, 'pop3'),
      'user_pref("mail.smtpserver.smtp1.hostname", "127.0.0.1");',
      `user_pref("mail.smtpserver.smtp1.port", ${ports.smtp});`,
    ].join('\n'),
  );
}

interface Kit {
  imap: FakeImap;
  smtp: FakeSmtp;
  env: ReturnType<typeof tempStore>;
  home: string;
  bus: Bus;
  events: Array<{ type: keyof BusEvents; payload: unknown }>;
  logs: string[];
  service: MailService;
  importer: MailImporter;
  key: (n: number) => string;
}
let kit: Kit;

describe('içe aktarma (sahte IMAP/SMTP)', () => {
  beforeEach(async () => {
    const imap = await startFakeImap({ user: USER, password: PASSWORD });
    const smtp = await startFakeSmtp({ user: USER, password: PASSWORD });
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-tb-imp-'));
    writeProfile(home, {
      imap: imap.port,
      smtp: smtp.port,
      dead: await closedPort(),
    });
    const env = tempStore();
    env.store.migrate('mail', MAIL_MIGRATIONS);
    const bus = createBus({ log: silentLog });
    const events: Kit['events'] = [];
    bus.onAny((type, payload) => void events.push({ type, payload }));
    const logs: string[] = [];
    const log = {
      ...silentLog,
      info: (message: string, data?: unknown) => void logs.push(`${message} ${JSON.stringify(data ?? {})}`),
      warn: (message: string, data?: unknown) => void logs.push(`${message} ${JSON.stringify(data ?? {})}`),
    };
    const service = createMailService({
      repo: createMailRepo(env.store.scoped('mail')),
      cipher: fakeCipher,
      bus,
      attention: { notify: () => ({ id: 'n' }) as never },
      brain: {
        availability: () => ({ ok: false, reason: 'yok' }),
        extract: async () => null,
      },
      policy: fakePolicy(),
      voice: fakeVoice(),
      settings: fakeSettings(bus, {}),
      log: log as never,
      downloadsDir: () => home,
      timers: { set: () => null, clear: () => undefined },
    });
    const importer = createMailImporter({
      service: () => service,
      roots: () => tb(home),
      log: log as never,
    });
    kit = {
      imap,
      smtp,
      env,
      home,
      bus,
      events,
      logs,
      service,
      importer,
      key: (n) => `thunderbird:p1.default-release:account${n}`,
    };
  });

  afterEach(async () => {
    kit.service.stop();
    await kit.service.idle();
    await kit.imap.close();
    await kit.smtp.close();
    kit.env.close();
    fs.rmSync(kit.home, { recursive: true, force: true });
  });

  it('hesap başına sonuç: bağlandı / parola yanlış / giriş gerekli / ulaşılamadı / parola bekliyor / desteklenmiyor', async () => {
    const results = await kit.importer.importAccounts([
      { key: kit.key(1), password: PASSWORD },
      { key: kit.key(2), password: 'yanlis-parola' },
      { key: kit.key(3) },
      { key: kit.key(4), password: PASSWORD },
      { key: kit.key(5) },
      { key: 'thunderbird:yok:account1' },
    ]);
    const status = Object.fromEntries(results.map((r) => [r.key.split(':')[2] === 'account1' && r.key.includes('yok') ? 'yok' : r.key.split(':')[2], r.status]));
    expect(status).toEqual({
      account1: 'connected',
      account2: 'wrongPassword',
      account3: 'loginRequired',
      account4: 'unreachable',
      account5: 'notFound',
      yok: 'notFound',
    });
    expect(results.find((r) => r.key === kit.key(5))!.text).toMatch(/POP3/);

    const rows = kit.service.repo.accounts();
    expect(rows.map((r) => [r.address, Boolean(r.secret)]).sort()).toEqual([
      ['gulsah@ornek.test', true],
      ['oauth@ornek.test', false],
      ['ulasilamaz@ornek.test', false],
      ['yanlis@ornek.test', false],
    ]);
    const saved = rows.find((r) => r.address === USER)!;
    expect(saved).toMatchObject({
      label: 'Hesap 1',
      username: USER,
      imap_host: '127.0.0.1',
      imap_port: kit.imap.port,
      smtp_port: kit.smtp.port,
      provider: 'custom',
    });
    expect(saved.secret).toMatch(/^enc:/);
    // Parolasız hesap "parola bekliyor" görünür ve eşitlemeye katılmaz.
    const views = kit.service.accounts();
    expect(
      views
        .filter((v) => !v.hasPassword)
        .map((v) => v.address)
        .sort(),
    ).toEqual(['oauth@ornek.test', 'ulasilamaz@ornek.test', 'yanlis@ornek.test']);

    // Gizlilik: parola sonuçta, olaylarda, günlükte ve veritabanı dosyalarında düz metin yok.
    for (const text of [JSON.stringify(results), JSON.stringify(kit.events), kit.logs.join('\n')]) {
      expect(text).not.toContain(PASSWORD);
      expect(text).not.toContain('yanlis-parola');
    }
    await kit.service.idle();
    for (const file of fs.readdirSync(kit.env.dir)) expect(fs.readFileSync(path.join(kit.env.dir, file)).includes(PASSWORD), file).toBe(false);
  });

  it('"zaten ekli": taramada işaretlenir, ikinci içe aktarmada dokunulmaz; sunucu + kullanıcı adı eşleşmesi de sayılır', async () => {
    await kit.importer.importAccounts([{ key: kit.key(1) }]);
    expect(kit.service.repo.accountByAddress(USER)!.secret).toBeNull();
    const scan = kit.importer.scan();
    const flags = Object.fromEntries(scan.accounts.map((a) => [a.address, a.existing]));
    // account1 eklendi; aynı sunucu ve kullanıcı adıyla gelen öteki IMAP hesapları da "zaten ekli" sayılır.
    expect(flags[USER]).toBe(true);
    expect(flags['yanlis@ornek.test']).toBe(false);
    expect(flags['pop@ornek.test']).toBe(false);
    // Adres farklı ama aynı sunucu + kullanıcı adı: zaten ekli.
    kit.service.repo.upsertAccount({
      provider: 'custom',
      label: 'x',
      address: 'baska@ornek.test',
      username: 'oauth@ornek.test',
      imapHost: '127.0.0.1',
      imapPort: 1,
      smtpHost: '127.0.0.1',
      smtpPort: 1,
      secret: null,
    });
    expect(kit.importer.scan().accounts.find((a) => a.address === 'oauth@ornek.test')!.existing).toBe(true);
    expect((await kit.importer.importAccounts([{ key: kit.key(3) }]))[0]!.status).toBe('exists');
    const again = await kit.importer.importAccounts([{ key: kit.key(1), password: PASSWORD }]);
    expect(again[0]).toMatchObject({ status: 'exists', accountId: null });
    // Parola, var olan hesap formu yoluyla (mail.saveAccount) girilir.
    const saved = await kit.service.save({
      provider: 'custom',
      address: USER,
      password: PASSWORD,
      imapHost: '127.0.0.1',
      imapPort: kit.imap.port,
      smtpHost: '127.0.0.1',
      smtpPort: kit.smtp.port,
    });
    expect(saved.saved).toBe(true);
    expect(kit.service.accounts()[0]!.hasPassword).toBe(true);
  });

  it('araç mail_import_thunderbird: sayar, içe aktarma penceresini açar (parola istemez)', async () => {
    const navigations: unknown[] = [];
    const tools = createMailTools(
      () => kit.service,
      () => ({
        scan: () => kit.importer.scan(),
        openDialog: () =>
          navigations.push({
            page: 'settings',
            params: { tab: 'mail', mailImport: 'thunderbird' },
          }),
      }),
    );
    const tool = tools.find((def) => def.name === 'mail_import_thunderbird')!;
    expect(tool.risk).toBe('write');
    const ctx = {
      report: () => undefined,
      signal: new AbortController().signal,
      origin: { kind: 'voice' },
    } as never;
    const result = await tool.run({}, ctx);
    expect(result.ok).toBe(true);
    expect(result.text).toMatch(/4 hesap buldum/);
    expect(result.text).toMatch(/SESLE İSTEME/);
    expect(result.data).toMatchObject({ found: 5, importable: 4, new: 4 });
    expect(navigations).toHaveLength(1);

    const none = createMailTools(
      () => kit.service,
      () => ({
        scan: () => scanThunderbird({ roots: [], existing: () => false }),
        openDialog: () => navigations.push('x'),
      }),
    ).find((def) => def.name === 'mail_import_thunderbird')!;
    const missing = await none.run({}, ctx);
    expect(missing.ok).toBe(false);
    expect(missing.text).toMatch(/profili bulamadım/);
    expect(navigations).toHaveLength(1);
  });
});
