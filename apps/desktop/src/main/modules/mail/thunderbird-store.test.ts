// Thunderbird'ün YEREL klasöründen (mbox dosyaları) PAROLASIZ okuma: klasör tarama (.msf/.sbd ayrımı), mbox ayrıştırma
// (çok iletili, mboxrd `>From ` kaçışı, bozuk/yarım son ileti), artımlı okuma (dosya büyüyünce yalnız yeni ileti),
// tekilleştirme ve servis bütünleşmesi (ilk okuma bildirim üretmez; yeni ileti `mail.received` yayar). Parola dosyalarına
// (`logins.json`, `key4.db`, `cert9.db`) dokunulmadığı doğrulanır. Sınama verisi elle yazılmış örnek profildir.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Bus, BusEvents, NotifyRequest } from '@fuber/shared';
import { createBus } from '../../core/bus';
import { fakePolicy, fakeSettings, fakeVoice, silentLog, tempStore } from '../../core/brain/testkit';
import { createMailRepo, MAIL_MIGRATIONS, type NewMessage } from './repo';
import { createMailService, type MailService } from './service';
import {
  collectMboxes,
  createThunderbirdStore,
  localUid,
  messageOffsets,
  nodeStoreFs,
  parseLocalMessage,
  readMboxDelta,
  scanMessageOffsets,
  unescapeMboxrd,
  type LocalMboxRef,
  type MboxCursor,
  type MboxReadOpts,
  type ParseFn,
  type ThunderbirdStore,
} from './thunderbird-store';

const FIXTURE = path.join(import.meta.dirname, 'fixtures', 'thunderbird');
const tb = (dir: string) => [{ source: 'thunderbird' as const, dir }];
// Örnek profilin iletileri Kasım 2025 tarihli; ilk okuma 90 günlük yaş penceresi kullandığı için gerçek saat (2026) yerine
// fixture çağına yakın sabit bir "şimdi" enjekte edilir ki eski-değil sayılsınlar (sınamalar tarihe bağlı bayatlamadan geçsin).
const FIXED_NOW = Date.parse('2025-11-20T00:00:00Z');
const NOW = () => FIXED_NOW;

/** Fixture profilini geçici bir eve kopyalar; parola dosyalarını da koyar (okunmamaları sınanır). */
function copyHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-tbstore-'));
  fs.cpSync(FIXTURE, home, { recursive: true });
  for (const name of ['logins.json', 'key4.db', 'cert9.db']) fs.writeFileSync(path.join(home, 'Profiles', 'k3x9.default', name), 'GIZLI-PAROLA-IZI');
  return home;
}
const profileDir = (home: string) => path.join(home, 'Profiles', 'k3x9.default');

// ───────────── saf: ofset, kaçış, hash ─────────────

describe('mbox saf ayrıştırma', () => {
  it('messageOffsets: dosya başındaki ve satır başındaki "From " sınırları; gövdedeki ">From " sınır değildir', () => {
    const buf = Buffer.from('From a\nGovde\n>From kacis\nFrom b\nSon\n', 'utf8');
    // İki gerçek sınır (0 ve "From b" satırı); ">From kacis" sınır sayılmaz.
    expect(messageOffsets(buf, 0)).toEqual([0, buf.indexOf('From b')]);
  });

  it('messageOffsets: taban ofset eklenir (artımlı okuma ortasından)', () => {
    const buf = Buffer.from('From x\n', 'utf8');
    expect(messageOffsets(buf, 1000)).toEqual([1000]);
  });

  it('unescapeMboxrd: ">From " → "From ", ">>From " → ">From "; başka satırlar değişmez', () => {
    const body = Buffer.from('normal\n>From kacis\n>>From iki\n> ornek\nson', 'utf8');
    expect(unescapeMboxrd(body).toString('utf8')).toBe('normal\nFrom kacis\n>From iki\n> ornek\nson');
  });

  it('localUid: aynı anahtar → aynı kararlı 53-bit sayı; farklı anahtar → farklı', () => {
    expect(localUid('<a@b>')).toBe(localUid('<a@b>'));
    expect(localUid('<a@b>')).not.toBe(localUid('<c@d>'));
    expect(Number.isSafeInteger(localUid('<a@b>'))).toBe(true);
  });

  it('parseLocalMessage: Message-ID, konu, gönderen; X-Mozilla-Status okundu bayrağı; Message-ID yoksa yapay anahtarla uid', async () => {
    const read = await parseLocalMessage(Buffer.from('X-Mozilla-Status: 0001\nMessage-ID: <x@y>\nFrom: Ali <ali@x.test>\nSubject: Merhaba\n\nGovde', 'utf8'));
    expect(read?.messageId).toBe('<x@y>');
    expect(read?.message).toMatchObject({ subject: 'Merhaba', fromAddress: 'ali@x.test', seen: true, uid: localUid('<x@y>') });

    const unread = await parseLocalMessage(Buffer.from('X-Mozilla-Status: 0000\nFrom: b@x.test\nSubject: S\n\nG', 'utf8'));
    expect(unread?.messageId).toBeNull();
    expect(unread?.message.seen).toBe(false);
    // Message-ID yok: uid gönderen+tarih+konudan türetilir (0/undefined değil).
    expect(typeof unread?.message.uid).toBe('number');
  });
});

// ───────────── klasör tarama ─────────────

describe('klasör tarama (örnek profil)', () => {
  let home: string;
  beforeEach(() => {
    home = copyHome();
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it('ImapMail altındaki mbox dosyaları; .sbd dizinine inilir; .msf/.dat atlanır', () => {
    const boxes = collectMboxes(profileDir(home), nodeStoreFs);
    const names = boxes.map((box) => box.mailbox).sort();
    expect(names).toEqual(['INBOX', 'Projeler']);
    expect(boxes.every((box) => box.account === 'mail.ornek.test')).toBe(true);
    // İndeks/durum dosyaları mbox sayılmaz.
    expect(names).not.toContain('INBOX.msf');
    expect(names).not.toContain('popstate.dat');
    // Alt klasör .sbd dizininden bulunur.
    expect(boxes.find((box) => box.mailbox === 'Projeler')!.relPath).toMatch(/INBOX\.sbd\/Projeler$/);
  });

  it('store.scan: varsayılan profil, bulunan kutular; parola dosyaları taramada açılmaz', () => {
    const store = createThunderbirdStore({ roots: () => tb(home) });
    const scan = store.scan();
    expect(scan.found).toBe(true);
    expect(scan.profile).toBe('default-release');
    expect(scan.boxes.map((box) => box.mailbox).sort()).toEqual(['INBOX', 'Projeler']);
    // Tarama yalnız mbox + profiles.ini okur; parola dosyalarının içeriği hiçbir yere sızmaz.
    expect(JSON.stringify(scan)).not.toContain('GIZLI-PAROLA-IZI');
  });
});

// ───────────── mbox okuma ve artımlı güncelleme ─────────────

async function readAll(ref: LocalMboxRef, cursor: MboxCursor | null, opts: MboxReadOpts = {}) {
  return readMboxDelta(ref, cursor, nodeStoreFs, { now: NOW, ...opts });
}

describe('mbox okuma ve artımlı güncelleme', () => {
  let home: string;
  let inbox: LocalMboxRef;
  beforeEach(() => {
    home = copyHome();
    inbox = collectMboxes(profileDir(home), nodeStoreFs).find((box) => box.mailbox === 'INBOX')!;
  });
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

  it('ilk okuma: üç ileti; mboxrd kaçışı çözülür; okundu/okunmadı bayrağı', async () => {
    const result = await readAll(inbox, null);
    expect(result.messages.map((m) => m.messageId)).toEqual(['<a1-toplanti@ornek.test>', '<b2-fatura@ornek.test>', '<c3-selam@ornek.test>']);
    // Gövdedeki ">From ..." satırı "From ..." olarak çözülmüş olmalı.
    expect(result.messages[0]!.body).toContain('From burada govdede');
    expect(result.messages[0]!.body).not.toContain('>From burada');
    // X-Mozilla-Status: okunanlar seen=true, sonuncusu okunmamış.
    expect(result.messages.map((m) => m.seen)).toEqual([true, true, false]);
    expect(result.cursor.lastOffset).toBe(fs.statSync(inbox.file).size);
  });

  it('değişmeyen dosya: ikinci okuma hiç ileti getirmez', async () => {
    const first = await readAll(inbox, null);
    const second = await readAll(inbox, first.cursor);
    expect(second.messages).toHaveLength(0);
    expect(second.changed).toBe(false);
  });

  it('dosya büyüdü: yalnız yeni ileti ayrıştırılır (tüm dosya değil)', async () => {
    const first = await readAll(inbox, null);
    const added =
      'From - Thu Nov 13 09:00:00 2025\nX-Mozilla-Status: 0000\nMessage-ID: <e5-yeni@ornek.test>\nFrom: Yeni <yeni@ornek.test>\nSubject: Yeni ileti\n\nArtimli okuma testi.\n';
    fs.appendFileSync(inbox.file, added);
    const second = await readAll(inbox, first.cursor);
    expect(second.messages.map((m) => m.messageId)).toEqual(['<e5-yeni@ornek.test>']);
    expect(second.changed).toBe(true);
  });

  it('dosya küçüldü (sıkıştırma): baştan okunur (reset) ve yineleme imleç değil tekilleştirmeyle engellenir', async () => {
    const first = await readAll(inbox, null);
    // İmleç dosya sonunda; dosyayı KISALT (sıkıştırma taklidi).
    const shrunk = fs.readFileSync(inbox.file).subarray(0, 400);
    fs.writeFileSync(inbox.file, shrunk);
    const second = await readAll(inbox, first.cursor);
    expect(second.reset).toBe(true);
    // Baştan okundu: en az ilk ileti yeniden geldi (DB tekilleştirmesi yinelemeyi eler).
    expect(second.messages[0]!.messageId).toBe('<a1-toplanti@ornek.test>');
  });

  it('bozuk/yarım son ileti: çökmez; önceki tam iletiler okunur', async () => {
    const half = Buffer.concat([fs.readFileSync(inbox.file), Buffer.from('From - Fri Nov 14 00:00:00 2025\nyarim-basliksiz-govde-yok', 'utf8')]);
    const tmp = path.join(home, 'yarim-inbox');
    fs.writeFileSync(tmp, half);
    const ref: LocalMboxRef = { ...inbox, file: tmp };
    const result = await readAll(ref, null);
    // İlk üç tam ileti gelir; yarım son ileti ya atlanır ya da başlıksız olarak sorunsuz işlenir (çökme yok).
    expect(result.messages.map((m) => m.messageId).slice(0, 3)).toEqual(['<a1-toplanti@ornek.test>', '<b2-fatura@ornek.test>', '<c3-selam@ornek.test>']);
  });
});

// ───────────── en-yeni-önce ilk okuma + sınır + ofset taraması ─────────────

/** Tarihleri gün gün artan (en eski baştan, mbox gibi) çok iletili mbox dosyası üretir. */
function bigMboxFile(count: number): { file: string; ids: string[]; dates: number[]; cleanup: () => void } {
  const base = Date.parse('2026-06-01T00:00:00Z');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-bigmbox-'));
  const file = path.join(dir, 'INBOX');
  const ids: string[] = [];
  const dates: number[] = [];
  let text = '';
  for (let n = 0; n < count; n++) {
    const ms = base + n * 86_400_000;
    const id = `<m${String(n).padStart(2, '0')}@t.test>`;
    ids.push(id);
    dates.push(ms);
    text += `From - gonderi ${n}\nX-Mozilla-Status: 0001\nMessage-ID: ${id}\nFrom: S${n} <s${n}@t.test>\nDate: ${new Date(ms).toUTCString()}\nSubject: Ileti ${n}\n\nGovde ${n}\n`;
  }
  fs.writeFileSync(file, text);
  return { file, ids, dates, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}
const bigRef = (file: string): LocalMboxRef => ({ relPath: 'ImapMail/a/INBOX', file, account: 'a', mailbox: 'INBOX' });

describe('ilk okuma: en yeni önce, sınırlı, ucuz ofset taraması', () => {
  it('scanMessageOffsets: pencere sınırlarını aşan "From " sınırları doğru bulunur (akıtarak; tüm dosya belleğe alınmaz)', () => {
    const { file, cleanup } = bigMboxFile(8);
    try {
      const size = fs.statSync(file).size;
      const whole = fs.readFileSync(file);
      const expected = messageOffsets(whole, 0);
      expect(expected).toHaveLength(8);
      // Minik pencere → çok pencereye bölünür; sınırlar yine tam (pencere sonunu aşan "From " kaçmaz).
      expect(scanMessageOffsets(file, size, nodeStoreFs, 16)).toEqual(expected);
      // Varsayılan (tek) pencere ile de aynı.
      expect(scanMessageOffsets(file, size, nodeStoreFs)).toEqual(expected);
      expect(scanMessageOffsets(file, 0, nodeStoreFs)).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it('sayı sınırı: yalnız en yeni K ileti okunur, eskiler atlanır; ofset taraması tüm dosyayı gövdeye AYRIŞTIRMAZ', async () => {
    const { file, ids, cleanup } = bigMboxFile(12);
    try {
      let parseCalls = 0;
      const parse: ParseFn = (raw) => (parseCalls++, parseLocalMessage(raw));
      const res = await readMboxDelta(bigRef(file), null, nodeStoreFs, { maxMessages: 3, maxAgeDays: 100_000, now: () => Date.parse('2026-07-01T00:00:00Z'), parse });
      // En yeni 3, kronolojik (en eski seçilen önce); eski 9 atlandı.
      expect(res.messages.map((m) => m.messageId)).toEqual(ids.slice(-3));
      // Yalnız son 3 ileti ayrıştırıldı — 12 değil (ofset taraması gövdeye inmez).
      expect(parseCalls).toBe(3);
      // İmleç dosya sonunda: sonraki okuma yalnız yeni eklenen kısmı görür (eski kısım bir daha okunmaz).
      expect(res.cursor.lastOffset).toBe(fs.statSync(file).size);
      expect(res.changed).toBe(true);
    } finally {
      cleanup();
    }
  });

  it('yaş sınırı: penceresinden eski iletiler atlanır (sayı sınırı dolmadan)', async () => {
    const { file, ids, cleanup } = bigMboxFile(12);
    try {
      const now = Date.parse('2026-06-01T00:00:00Z') + 12 * 86_400_000; // base + 12 gün
      // cutoff = now - 5 gün = base + 7 gün → yalnız n=7..11 (5 ileti) pencere içinde.
      const res = await readMboxDelta(bigRef(file), null, nodeStoreFs, { maxMessages: 100, maxAgeDays: 5, now: () => now });
      expect(res.messages.map((m) => m.messageId)).toEqual(ids.slice(7));
    } finally {
      cleanup();
    }
  });

  it('dosya büyüdü: ilk sınırlı okumadan sonra yalnız yeni eklenen ileti gelir (eski kısım yeniden okunmaz)', async () => {
    const { file, cleanup } = bigMboxFile(12);
    try {
      const first = await readMboxDelta(bigRef(file), null, nodeStoreFs, { maxMessages: 2, maxAgeDays: 100_000, now: () => Date.parse('2026-07-01T00:00:00Z') });
      expect(first.messages).toHaveLength(2); // en yeni 2
      const newMs = new Date(Date.parse('2026-07-02T00:00:00Z')).toUTCString();
      fs.appendFileSync(file, `From - yeni\nX-Mozilla-Status: 0000\nMessage-ID: <yeni-ek@t.test>\nFrom: Z <z@t.test>\nDate: ${newMs}\nSubject: Yeni ek\n\nEklendi\n`);
      const second = await readMboxDelta(bigRef(file), first.cursor, nodeStoreFs, { maxMessages: 2, maxAgeDays: 100_000, now: () => Date.parse('2026-07-03T00:00:00Z') });
      // Artımlı: yalnız eklenen ileti (sınır/yaş uygulanmaz); eski 10 yeniden gelmez.
      expect(second.messages.map((m) => m.messageId)).toEqual(['<yeni-ek@t.test>']);
      expect(second.reset).toBe(false);
    } finally {
      cleanup();
    }
  });
});

// ───────────── servis bütünleşmesi ─────────────

interface Kit {
  env: ReturnType<typeof tempStore>;
  home: string;
  bus: Bus;
  events: Array<{ type: keyof BusEvents; payload: unknown }>;
  notes: NotifyRequest[];
  service: MailService;
}
let kit: Kit;

function makeKit(home: string): Kit {
  const env = tempStore();
  env.store.migrate('mail', MAIL_MIGRATIONS);
  const bus = createBus({ log: silentLog });
  const events: Kit['events'] = [];
  bus.onAny((type, payload) => void events.push({ type, payload }));
  const notes: NotifyRequest[] = [];
  const service = createMailService({
    repo: createMailRepo(env.store.scoped('mail')),
    cipher: null,
    bus,
    attention: { notify: (request) => (notes.push(request), { id: 'n' }) as never },
    brain: { availability: () => ({ ok: false, reason: 'yok' }), extract: async () => null },
    policy: fakePolicy(),
    voice: fakeVoice(),
    settings: fakeSettings(bus, {}),
    log: silentLog,
    downloadsDir: () => home,
    localStore: createThunderbirdStore({ roots: () => tb(home), now: NOW }),
    timers: { set: () => null, clear: () => undefined },
  });
  return { env, home, bus, events, notes, service };
}

describe('servis: yerel Thunderbird kaynağı', () => {
  beforeEach(() => {
    kit = makeKit(copyHome());
  });
  afterEach(async () => {
    kit.service.stop();
    await kit.service.idle();
    kit.env.close();
    fs.rmSync(kit.home, { recursive: true, force: true });
  });

  it('açınca: parolasız okur; ilk okuma bildirim ÜRETMEZ ve mail.received yaymaz; tekrar okuma yineleme eklemez', async () => {
    const status = await kit.service.setLocalEnabled(true);
    expect(status.enabled).toBe(true);
    expect(status.found).toBe(true);
    expect(status.messageCount).toBe(4); // 3 INBOX + 1 Projeler

    const rows = kit.service.repo.accounts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.kind).toBe('thunderbird');
    expect(rows[0]!.secret).toBeNull(); // parola yok

    // İlk okuma: geçmiş "yeni" sanılmaz.
    expect(kit.notes).toHaveLength(0);
    expect(kit.events.filter((e) => e.type === 'mail.received')).toHaveLength(0);

    // Okunmamış bayrağı korunur (c3 okunmamış).
    const list = kit.service.list({ limit: 50 });
    expect(list.filter((m) => m.seen === 0).map((m) => m.message_id)).toContain('<c3-selam@ornek.test>');

    // İkinci okuma: tekilleştirme → yeni ileti yok.
    const added = await kit.service.syncLocal();
    expect(added).toBe(0);
    expect(kit.service.repo.accounts()[0]!); // hâlâ tek hesap
    expect(kit.service.list({ limit: 50 })).toHaveLength(4);
  });

  it('yeni ileti (dosya büyüdü): eklenir, mail.received yayılır (geçmiş değil, gerçek yeni)', async () => {
    await kit.service.setLocalEnabled(true);
    const before = kit.events.length;
    const inbox = collectMboxes(profileDir(kit.home), nodeStoreFs).find((b) => b.mailbox === 'INBOX')!;
    fs.appendFileSync(
      inbox.file,
      'From - Thu Nov 13 09:00:00 2025\nX-Mozilla-Status: 0000\nMessage-ID: <yeni-gercek@ornek.test>\nFrom: Deniz <deniz@ornek.test>\nSubject: Yeni gercek ileti\n\nMerhaba, bu gercekten yeni.\n',
    );
    const added = await kit.service.syncLocal();
    expect(added).toBe(1);
    const received = kit.events.slice(before).filter((e) => e.type === 'mail.received');
    expect(received).toHaveLength(1);
    expect((received[0]!.payload as { messages: Array<{ subject: string }> }).messages[0]!.subject).toBe('Yeni gercek ileti');
    expect(kit.service.localStatus().messageCount).toBe(5);
  });

  it('kapatınca: hesap, iletiler ve imleçler silinir', async () => {
    await kit.service.setLocalEnabled(true);
    expect(kit.service.repo.accounts()).toHaveLength(1);
    const status = await kit.service.setLocalEnabled(false);
    expect(status.enabled).toBe(false);
    expect(kit.service.repo.accounts()).toHaveLength(0);
    expect(kit.service.repo.localCursor('ImapMail/mail.ornek.test/INBOX')).toBeUndefined();
    expect(kit.service.list({ limit: 50 })).toHaveLength(0);
  });

  it('açınca "reading" biter ve son okuma stats görünür (ilerleme)', async () => {
    const status = await kit.service.setLocalEnabled(true);
    // Küçük profil tek turda biter: reading false, sayı görünür.
    expect(status.reading).toBe(false);
    expect(status.messageCount).toBe(4);
  });
});

// ───────────── çok kutu: backfill dayanıklılığı, tur sınırı, ilerleme (sahte depo) ─────────────

describe('servis: çok kutu backfill (sahte depo)', () => {
  const NOW_ISO = new Date(FIXED_NOW).toISOString();
  const msg = (uid: number, id: string): NewMessage => ({
    uid,
    messageId: id,
    fromName: 'S',
    fromAddress: 's@t.test',
    replyTo: null,
    to: 'me@t.test',
    cc: '',
    subject: 'S',
    date: NOW_ISO,
    body: 'b',
    truncated: false,
    seen: false,
    bulk: false,
    attachments: [],
    refs: null,
  });
  /** İlk okumada tek ileti veren, sonra değişmeyen bir kutu sonucu. */
  const firstRead = (mailbox: string, uid: number) => ({
    messages: [msg(uid, `<${mailbox}@t.test>`)],
    cursor: { size: 10, mtimeMs: 1, lastOffset: 10, lastMessageId: `<${mailbox}@t.test>` },
    reset: false,
    changed: true,
  });
  function serviceWith(store: ThunderbirdStore) {
    const env = tempStore();
    env.store.migrate('mail', MAIL_MIGRATIONS);
    const bus = createBus({ log: silentLog });
    const service = createMailService({
      repo: createMailRepo(env.store.scoped('mail')),
      cipher: null,
      bus,
      attention: { notify: () => ({ id: 'n' }) as never },
      brain: { availability: () => ({ ok: false, reason: 'yok' }), extract: async () => null },
      policy: fakePolicy(),
      voice: fakeVoice(),
      settings: fakeSettings(bus, {}),
      log: silentLog,
      downloadsDir: () => '.',
      localStore: store,
      timers: { set: () => null, clear: () => undefined },
    });
    return { env, service };
  }

  it('bir kutu okunamazsa diğerleri yine okunur; backfill sonsuz dönmez (reading biter)', async () => {
    let uid = 0;
    const boxes = [
      { relPath: 'ImapMail/a/INBOX', file: 'i', account: 'a', mailbox: 'INBOX' },
      { relPath: 'ImapMail/a/Bozuk', file: 'b', account: 'a', mailbox: 'Bozuk' },
      { relPath: 'ImapMail/a/Sent', file: 's', account: 'a', mailbox: 'Sent' },
    ];
    const store: ThunderbirdStore = {
      scan: () => ({ found: true, profile: 'p', profileDir: '/p', boxes }),
      readBox: async (ref, cursor) => {
        if (ref.mailbox === 'Bozuk') throw new Error('bozuk kutu');
        if (cursor) return { messages: [], cursor, reset: false, changed: false };
        return firstRead(ref.mailbox, ++uid);
      },
    };
    const { env, service } = serviceWith(store);
    try {
      const status = await service.setLocalEnabled(true);
      expect(status.messageCount).toBe(2); // INBOX + Sent; Bozuk atlandı
      expect(status.reading).toBe(false); // bozuk kutu backfill'i tıkamaz
    } finally {
      service.stop();
      await service.idle();
      env.close();
    }
  });

  it('çok kutu tek turda bitmez: tur sınırı var, turlar arka arkaya hepsini tamamlar, "reading" sonunda kapanır', async () => {
    const boxes = Array.from({ length: 7 }, (_, i) => ({ relPath: `ImapMail/a/B${i}`, file: `f${i}`, account: 'a', mailbox: i === 0 ? 'INBOX' : `B${i}` }));
    let uid = 0;
    const store: ThunderbirdStore = {
      scan: () => ({ found: true, profile: 'p', profileDir: '/p', boxes }),
      readBox: async (ref, cursor) => (cursor ? { messages: [], cursor, reset: false, changed: false } : firstRead(ref.mailbox, ++uid)),
    };
    const { env, service } = serviceWith(store);
    try {
      const status = await service.setLocalEnabled(true);
      expect(status.messageCount).toBe(7); // 7 kutu > tur sınırı; backfill döngüsü hepsini okudu
      expect(status.reading).toBe(false);
    } finally {
      service.stop();
      await service.idle();
      env.close();
    }
  });
});
