// Thunderbird'ün (ve aynı biçimdeki Betterbird'ün) YEREL posta klasöründen (indirdiği mbox dosyaları) iletileri PAROLASIZ okur.
// Thunderbird her hesabı eşitlediğinde iletileri profil klasöründe mbox dosyaları olarak saklar ve her eşitlemede dosyaya yazar;
// bu dosyaları OKUMAK parola istemez, Thunderbird kapalıyken de son indirdiği içerik okunur. Burada YALNIZ ileti (mbox) dosyaları
// `fs.readFileSync`/`fs.statSync` ile okunur, profile hiçbir şey yazılmaz, IMAP'a bağlanılmaz. Parola/kimlik deposu (`logins.json`,
// `key4.db`, `cert9.db`, NSS) bu dosya tarafından AÇILMAZ, okunmaz, çözülmez — yalnız mbox dosyaları ve `profiles.ini` okunur.
//
// mbox biçimi: iletiler satır başındaki `From ` zarf satırıyla ayrılır (dosya başı ya da bir satırsonu ardından). mboxrd kaçışı
// gövdede `>From ` yapar; okurken bir `>` geri alınır. Klasör düzeni: `ImapMail/<sunucu>/INBOX`, `Mail/<sunucu>/INBOX`,
// `Mail/Local Folders/...`; mbox dosyalarının uzantısı yoktur, yanlarındaki `.msf` indeks, `.sbd` ise alt klasör dizinidir.
import fs from 'node:fs';
import nodePath from 'node:path';
import { simpleParser } from 'mailparser';
import { toNewMessage } from './transport';
import { listProfiles, parseIni, type ThunderbirdRoot } from './thunderbird';
import type { NewMessage } from './repo';

/** Tek bir mbox dosyasından bir iletinin bu kadarından büyüğü için yalnız başı (başlık + az gövde) alınır. */
const MAX_MESSAGE_BYTES = 4 * 1024 * 1024;
/** `profiles.ini` bundan büyükse okunmaz. */
const MAX_INI_BYTES = 256 * 1024;
/** Artımlı okumada (dosya büyüyünce) tek seferde bu kadar bayt sonrası okunur (çok büyük ek yığınında belleği korur). */
const MAX_DELTA_BYTES = 64 * 1024 * 1024;
/** İlk okumada `From ` ofsetlerini çıkarmak için dosya bu pencere boyutuyla AKITILIR; tüm dosya belleğe alınmaz, gövdeye ayrıştırılmaz. */
const OFFSET_SCAN_WINDOW = 8 * 1024 * 1024;

/**
 * İlk (ve sıkıştırma sonrası sıfırlama) okumasının sınırı: kutu başına EN YENİ bu kadar ileti okunur, en yeniden geriye.
 * Çok büyük bir arşivin (ör. birkaç GB, binlerce ileti) TAMAMI değil; yakın/önemli posta hızla görünsün diye sınırlıdır (hesap başına
 * 2000 ileti budaması ayrıca vardır). Sınama bu sabitleri küçültebilir.
 */
export const INITIAL_MAX_MESSAGES = 200;
/** İlk okumada en yeni bu kadar günden eski iletiler alınmaz (sayı sınırı ya da bu — hangisi önce dolarsa). */
export const INITIAL_MAX_AGE_DAYS = 90;

const FROM_LINE = Buffer.from('From ', 'ascii');

/** Bulunan bir yerel kutu (mbox dosyası). */
export interface LocalMboxRef {
  /** Profil köküne göre göreli yol (imleç anahtarı; `/` ile). */
  relPath: string;
  /** Dosyanın mutlak yolu. */
  file: string;
  /** Hesap: `ImapMail/<bu>/…` ya da `Mail/<bu>/…` üst klasör adı (sunucu adı ya da "Local Folders"). */
  account: string;
  /** Kutu adı: dosya adı (INBOX, Sent, Archive, alt klasör adı…). */
  mailbox: string;
}

/** Bir mbox dosyasının okuma imleci (nerede kaldık). */
export interface MboxCursor {
  size: number;
  mtimeMs: number;
  /** Bu bayt ofsetine kadar okundu; bir sonraki okuma buradan başlar (dosya büyüdüyse yalnız yeni kısım ayrıştırılır). */
  lastOffset: number;
  /** Son ayrıştırılan iletinin Message-ID'si (tanı/izleme için). */
  lastMessageId: string | null;
}

export interface StoreFs {
  /** Dizin girdileri (tür bilgisiyle). Dizin yoksa boş dizi. */
  readdir(dir: string): Array<{ name: string; isFile: boolean; isDirectory: boolean }>;
  /** Dosya bilgisi; yoksa ya da dizinse null. */
  stat(file: string): { size: number; mtimeMs: number } | null;
  /** `[start, end)` bayt aralığını okur. */
  readRange(file: string, start: number, end: number): Buffer;
  /** Küçük metin dosyası (profiles.ini). */
  readText(file: string, max: number): string | null;
}

/** Gerçek dosya sistemi (yalnız okuma). */
export const nodeStoreFs: StoreFs = {
  readdir(dir) {
    try {
      return fs.readdirSync(dir, { withFileTypes: true }).map((entry) => ({ name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() }));
    } catch {
      return [];
    }
  },
  stat(file) {
    try {
      const stat = fs.statSync(file);
      return stat.isFile() ? { size: stat.size, mtimeMs: stat.mtimeMs } : null;
    } catch {
      return null;
    }
  },
  readRange(file, start, end) {
    const length = Math.max(0, end - start);
    const buffer = Buffer.alloc(length);
    if (length === 0) return buffer;
    const handle = fs.openSync(file, 'r');
    try {
      const read = fs.readSync(handle, buffer, 0, length, start);
      return read === length ? buffer : buffer.subarray(0, read);
    } finally {
      fs.closeSync(handle);
    }
  },
  readText(file, max) {
    try {
      const stat = fs.statSync(file);
      if (!stat.isFile() || stat.size > max) return null;
      return fs.readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  },
};

// ───────────── profil ve klasör tarama ─────────────

/** mbox dosyalarının arandığı üst klasörler (profil kökünde). */
export const MAIL_DIRS = ['ImapMail', 'Mail'] as const;

const isMboxFile = (name: string) => nodePath.extname(name) === '' && !name.startsWith('.');

/** Köklerdeki varsayılan profilin dizini (varsayılan önce). Doğrudan bir profil dizini verilmişse (profiles.ini yok) onu kullanır. */
export function resolveProfileDirs(roots: ThunderbirdRoot[], fsx: StoreFs): Array<{ name: string; dir: string }> {
  const out: Array<{ name: string; dir: string }> = [];
  for (const root of roots) {
    const ini = fsx.readText(nodePath.join(root.dir, 'profiles.ini'), MAX_INI_BYTES);
    if (ini !== null) {
      for (const profile of listProfiles(root, ini)) out.push({ name: profile.name, dir: profile.dir });
      continue;
    }
    // profiles.ini yok: kök zaten bir profil klasörü olabilir (içinde ImapMail/Mail varsa).
    if (MAIL_DIRS.some((name) => fsx.readdir(nodePath.join(root.dir, name)).length > 0)) out.push({ name: nodePath.basename(root.dir), dir: root.dir });
  }
  return out;
}

/** Bir profil dizinindeki bütün mbox dosyaları: `ImapMail/*`, `Mail/*`; `.sbd` dizinlerine inilir; `.msf`/`.dat`/… atlanır. */
export function collectMboxes(profileDir: string, fsx: StoreFs): LocalMboxRef[] {
  const out: LocalMboxRef[] = [];
  const rel = (file: string) => nodePath.relative(profileDir, file).split(nodePath.sep).join('/');
  const walk = (dir: string, account: string) => {
    for (const entry of fsx.readdir(dir)) {
      const full = nodePath.join(dir, entry.name);
      if (entry.isFile) {
        // mbox dosyaları uzantısızdır; `.msf` (indeks), `.dat`, `.json`, `.sqlite`… atlanır.
        if (isMboxFile(entry.name)) out.push({ relPath: rel(full), file: full, account, mailbox: entry.name });
      } else if (entry.isDirectory && entry.name.toLowerCase().endsWith('.sbd')) {
        walk(full, account); // alt klasör dizini: in
      }
    }
  };
  for (const rootName of MAIL_DIRS) {
    const rootDir = nodePath.join(profileDir, rootName);
    for (const entry of fsx.readdir(rootDir)) {
      if (entry.isDirectory) walk(nodePath.join(rootDir, entry.name), entry.name);
    }
  }
  // Kararlı sıra (sınama ve imleç tutarlılığı için).
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath));
}

// ───────────── mbox ayrıştırma ─────────────

const atFromLine = (buf: Buffer, i: number) => i + FROM_LINE.length <= buf.length && buf.subarray(i, i + FROM_LINE.length).equals(FROM_LINE);

/**
 * `buf` içindeki ileti sınırlarının MUTLAK ofsetleri (dosya başındaki `base` eklenmiş). Bir sınır: `buf` başı ya da bir `\n`
 * ardından başlayan `From ` satırı. mboxrd gövde `From ` satırlarını `>` ile kaçırdığı için satır başı `From ` güvenilir sınırdır.
 */
export function messageOffsets(buf: Buffer, base: number): number[] {
  const offsets: number[] = [];
  if (atFromLine(buf, 0)) offsets.push(base);
  for (let i = 0; i < buf.length; i++) {
    if (buf[i] === 0x0a && atFromLine(buf, i + 1)) offsets.push(base + i + 1);
  }
  return offsets;
}

/**
 * Bütün dosyadaki ileti sınırlarının MUTLAK ofsetleri (artan). Dosyayı `windowBytes`'lık pencerelerle AKITARAK okur: her an
 * yalnız bir pencere bellekte durur ve HİÇBİR gövde `simpleParser`'a verilmez — yalnız satır başı `From ` dizileri sayılır.
 * Böylece 3 GB'lık bir kutunun ofsetlerini çıkarmak ucuzdur; sonra yalnız istenen (en yeni) iletiler ayrıştırılır.
 */
export function scanMessageOffsets(file: string, size: number, fsx: StoreFs, windowBytes: number = OFFSET_SCAN_WINDOW): number[] {
  const offsets: number[] = [];
  if (size <= 0) return offsets;
  const window = Math.max(FROM_LINE.length + 1, windowBytes);
  // Dosya başı bir sınırsa ekle.
  if (atFromLine(fsx.readRange(file, 0, Math.min(size, FROM_LINE.length)), 0)) offsets.push(0);
  let start = 0;
  while (start < size) {
    const end = Math.min(size, start + window);
    // `From ` sınırı pencere sonunu aşabilir: onay için biraz fazla oku; ama sınır OFSETİNİ yalnız [start, end) içindeki `\n` için say.
    const buf = fsx.readRange(file, start, Math.min(size, end + FROM_LINE.length));
    const limit = end - start;
    for (let i = 0; i < limit; i++) {
      if (buf[i] === 0x0a && atFromLine(buf, i + 1)) offsets.push(start + i + 1);
    }
    start = end;
  }
  return offsets;
}

/** Ham gövdeyi `NewMessage`'a çeviren işlev (varsayılan `parseLocalMessage`; sınamada kaç ileti ayrıştırıldığını saymak için enjekte edilir). */
export type ParseFn = (rawBody: Buffer) => Promise<{ message: NewMessage; messageId: string | null } | null>;

/** İlk/sıfırlama okumasının ayarları (sınamada sınır küçültülür, saat sabitlenir, ayrıştırıcı sayılır). */
export interface MboxReadOpts {
  /** Kutu başına en çok ileti (en yeniden geriye). Varsayılan `INITIAL_MAX_MESSAGES`. */
  maxMessages?: number;
  /** En yeni gün penceresi; bundan eski ileti alınmaz. Varsayılan `INITIAL_MAX_AGE_DAYS`. */
  maxAgeDays?: number;
  /** Şimdiki an (yaş penceresi için), ms. Varsayılan `Date.now`. */
  now?: () => number;
  /** Ayrıştırıcı (sınama sayımı için). Varsayılan `parseLocalMessage`. */
  parse?: ParseFn;
}

/** Bir ileti parçasını (zarf `From ` satırı + gövde) `NewMessage`'a çevirir: zarf satırı atılır, mboxrd çözülür, baş MAX_MESSAGE_BYTES ayrıştırılır. */
async function parseChunk(chunk: Buffer, parse: ParseFn): Promise<{ message: NewMessage; messageId: string | null } | null> {
  const nl = chunk.indexOf(0x0a);
  if (nl === -1) return null; // zarf satırı bitmemiş (yarım yazım): atla
  const body = unescapeMboxrd(chunk.subarray(nl + 1));
  return parse(body.subarray(0, MAX_MESSAGE_BYTES));
}

/** Dosyada [absStart, absEnd) aralığındaki tek iletiyi okuyup ayrıştırır; okuma MAX_MESSAGE_BYTES ile sınırlı (dev ek tüm belleği almaz). */
async function parseRange(file: string, absStart: number, absEnd: number, fsx: StoreFs, parse: ParseFn): Promise<{ message: NewMessage; messageId: string | null } | null> {
  const span = absEnd - absStart;
  // Zarf satırı + gövdenin başı yeter; MAX_MESSAGE_BYTES üstü zaten kırpılır.
  const readLen = Math.min(span, MAX_MESSAGE_BYTES + 8 * 1024);
  return parseChunk(fsx.readRange(file, absStart, absStart + readLen), parse);
}

/** mboxrd kaçışını geri alır: satır başındaki `>+From ` dizisinden bir `>` düşürülür (`>From ` → `From `, `>>From ` → `>From `). */
export function unescapeMboxrd(body: Buffer): Buffer {
  const parts: Buffer[] = [];
  let i = 0;
  while (i < body.length) {
    let nl = body.indexOf(0x0a, i);
    if (nl === -1) nl = body.length - 1; // son satır (satırsonsuz)
    const end = nl + 1;
    // Satır başı: bir ya da çok `>` ardından `From `.
    if (body[i] === 0x3e) {
      let k = i;
      while (body[k] === 0x3e) k++;
      if (atFromLine(body, k)) {
        parts.push(body.subarray(i + 1, end)); // bir `>` at
        i = end;
        continue;
      }
    }
    parts.push(body.subarray(i, end));
    i = end;
  }
  return parts.length === 1 ? parts[0]! : Buffer.concat(parts);
}

const FOLD = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Message-ID yoksa kararlı yapay anahtar (gönderen + tarih + konu): aynı ileti iki kez eklenmesin diye tekilleştirmeye yarar. */
function syntheticKey(parsed: Awaited<ReturnType<typeof simpleParser>>): string {
  const from = Array.isArray(parsed.from) ? parsed.from[0] : parsed.from;
  const fromText = from?.text ?? '';
  const date = parsed.date instanceof Date && !Number.isNaN(parsed.date.getTime()) ? parsed.date.toISOString() : '';
  return `${FOLD(fromText)}|${date}|${FOLD(parsed.subject ?? '')}`;
}

/** Kararlı 53-bit sayı (FNV-1a 64-bit düşük 53 biti). Yerel iletinin `(account_id, uid)` tekilleştirme anahtarı olur. */
export function localUid(key: string): number {
  let hash = 0xcbf29ce484222325n;
  for (const byte of Buffer.from(key, 'utf8')) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return Number(hash & 0x1fffffffffffffn);
}

/** Thunderbird'ün `X-Mozilla-Status` başlığından okundu bayrağı (0x0001 = okundu). Başlık yoksa okunmamış sayılır. */
function seenOf(parsed: Awaited<ReturnType<typeof simpleParser>>): boolean {
  const raw = parsed.headers.get('x-mozilla-status');
  const value = typeof raw === 'string' ? raw : raw != null ? String(raw) : '';
  const flags = parseInt(value.trim(), 16);
  return Number.isNaN(flags) ? false : (flags & 0x0001) !== 0;
}

/** Tek bir ham ileti (zarf satırı atılmış, mboxrd çözülmüş gövde) → `NewMessage`. Ayrıştırılamazsa null. */
export async function parseLocalMessage(rawBody: Buffer): Promise<{ message: NewMessage; messageId: string | null } | null> {
  try {
    const parsed = await simpleParser(rawBody, { skipImageLinks: true, skipTextToHtml: true });
    const messageId = parsed.messageId?.trim() || null;
    const uid = localUid(messageId || syntheticKey(parsed));
    const truncated = rawBody.length >= MAX_MESSAGE_BYTES;
    return { message: toNewMessage(uid, parsed, seenOf(parsed), truncated), messageId };
  } catch {
    return null;
  }
}

/**
 * İLK okuma (ya da sıkıştırma sonrası sıfırlama): kutuda EN YENİ sınırlı küme. Tüm `From ` ofsetleri AKITILARAK çıkarılır
 * (gövde ayrıştırılmaz), sonra yalnız SON K ileti en yeniden geriye ayrıştırılır; `maxAgeDays`'ten eski olanlar atlanır.
 * İmleç dosya SONUNA konur: sonraki okuma yalnız yeni eklenen kısmı görür (eski 3 GB bir daha okunmaz). Eski (sınır dışı)
 * iletiler kasıtlı olarak atlanır — amaç yakın postanın hızla görünmesi.
 */
async function readInitialNewest(ref: LocalMboxRef, stat: { size: number; mtimeMs: number }, fsx: StoreFs, opts: MboxReadOpts, reset: boolean): Promise<{ messages: NewMessage[]; cursor: MboxCursor; reset: boolean; changed: boolean }> {
  const parse = opts.parse ?? parseLocalMessage;
  const maxMessages = Math.max(1, opts.maxMessages ?? INITIAL_MAX_MESSAGES);
  const maxAgeDays = opts.maxAgeDays ?? INITIAL_MAX_AGE_DAYS;
  const cutoffMs = (opts.now ?? Date.now)() - maxAgeDays * 86_400_000;
  // İmleç her durumda dosya sonuna gider (okunan iletilerin seçimi ne olursa olsun, eski kısım bir daha taranmaz).
  const cursorBase = { size: stat.size, mtimeMs: stat.mtimeMs, lastOffset: stat.size };

  const offsets = scanMessageOffsets(ref.file, stat.size, fsx);
  if (offsets.length === 0) return { messages: [], cursor: { ...cursorBase, lastMessageId: null }, reset, changed: true };

  // En yeniden geriye: en çok `maxMessages` iletiye bak; yaş penceresi dışındakileri atla (mbox kabaca kronolojiktir).
  const floor = Math.max(0, offsets.length - maxMessages);
  const picked: NewMessage[] = [];
  let newestMessageId: string | null = null;
  for (let n = offsets.length - 1; n >= floor; n--) {
    const absEnd = n + 1 < offsets.length ? offsets[n + 1]! : stat.size;
    const parsed = await parseRange(ref.file, offsets[n]!, absEnd, fsx, parse);
    if (!parsed) continue;
    if (Date.parse(parsed.message.date) < cutoffMs) continue; // yaş penceresi dışında (eski): alma
    if (newestMessageId === null && parsed.messageId) newestMessageId = parsed.messageId;
    picked.push(parsed.message);
  }
  picked.reverse(); // kronolojik (en eski seçilen önce)
  return { messages: picked, cursor: { ...cursorBase, lastMessageId: newestMessageId }, reset, changed: true };
}

/** ARTIMLI okuma: imleçten sonrasını (yeni eklenen iletiler) okur; tur başına en çok `MAX_DELTA_BYTES` (dev yığın belleği korur). */
async function readAppended(ref: LocalMboxRef, stat: { size: number; mtimeMs: number }, cursor: MboxCursor, fsx: StoreFs, parse: ParseFn): Promise<{ messages: NewMessage[]; cursor: MboxCursor; reset: boolean; changed: boolean }> {
  const start = cursor.lastOffset;
  const readEnd = Math.min(stat.size, start + MAX_DELTA_BYTES);
  const buf = fsx.readRange(ref.file, start, readEnd);
  const offsets = messageOffsets(buf, start);
  const messages: NewMessage[] = [];
  let lastMessageId = cursor.lastMessageId;
  for (let n = 0; n < offsets.length; n++) {
    const absStart = offsets[n]!;
    const absEnd = n + 1 < offsets.length ? offsets[n + 1]! : readEnd;
    const parsed = await parseChunk(buf.subarray(absStart - start, absEnd - start), parse);
    if (!parsed) continue;
    messages.push(parsed.message);
    if (parsed.messageId) lastMessageId = parsed.messageId;
  }
  // İmleç okunan son bayta ilerler; sonraki okuma oradan devam eder (eklenen iletiler yeni `From ` ile başlar).
  return { messages, cursor: { size: stat.size, mtimeMs: stat.mtimeMs, lastOffset: readEnd, lastMessageId }, reset: false, changed: true };
}

/**
 * Bir mbox'ı okur. İLK okuma (`cursor` null) ya da sıkıştırma sonrası SIFIRLAMA (dosya küçüldü): en YENİ sınırlı küme
 * (`readInitialNewest`). Dosya büyüdü: yalnız yeni eklenen kısım (`readAppended`). Değişmediyse (boyut + mtime aynı) hiç okunmaz.
 * Tekilleştirme (DB'de `account_id, uid`) sıfırlamada yinelenenleri eler.
 */
export async function readMboxDelta(ref: LocalMboxRef, cursor: MboxCursor | null, fsx: StoreFs, opts: MboxReadOpts = {}): Promise<{ messages: NewMessage[]; cursor: MboxCursor; reset: boolean; changed: boolean }> {
  const stat = fsx.stat(ref.file);
  if (!stat) return { messages: [], cursor: cursor ?? { size: 0, mtimeMs: 0, lastOffset: 0, lastMessageId: null }, reset: false, changed: false };

  if (cursor) {
    if (stat.size < cursor.lastOffset) return readInitialNewest(ref, stat, fsx, opts, true); // dosya küçüldü: baştan (en yeni sınırlı)
    if (stat.size === cursor.size && stat.mtimeMs === cursor.mtimeMs) return { messages: [], cursor, reset: false, changed: false }; // değişmedi
    return readAppended(ref, stat, cursor, fsx, opts.parse ?? parseLocalMessage); // büyüdü: yalnız yeni kısım
  }
  return readInitialNewest(ref, stat, fsx, opts, false); // ilk okuma: en yeni sınırlı küme
}

// ───────────── tarama arayüzü (servise) ─────────────

export interface LocalScanResult {
  /** Profil ve en az bir mail klasörü bulundu. */
  found: boolean;
  /** Kullanılan profil adı (varsayılan); bulunamazsa null. */
  profile: string | null;
  /** Profil kökü (fs.watch için). */
  profileDir: string | null;
  boxes: LocalMboxRef[];
}

export interface ThunderbirdStore {
  /** Köklerden varsayılan profili bulup mbox listesini çıkarır (yalnız okuma). */
  scan(): LocalScanResult;
  /** Bir mbox'ı imleçten sonrasını okur. */
  readBox(ref: LocalMboxRef, cursor: MboxCursor | null): Promise<{ messages: NewMessage[]; cursor: MboxCursor; reset: boolean; changed: boolean }>;
}

export interface StoreDeps {
  /** Okunacak kökler (`thunderbird.ts` › `thunderbirdRoots`; sınamada sahte kök). */
  roots(): ThunderbirdRoot[];
  fs?: StoreFs;
  /** Şimdiki an (ilk okumanın yaş penceresi için), ms. Varsayılan `Date.now`. */
  now?: () => number;
  /** İlk okuma sınırı (sınamada küçültülür; üretimde varsayılan sabitler). */
  initial?: { maxMessages?: number; maxAgeDays?: number };
}

export function createThunderbirdStore(deps: StoreDeps): ThunderbirdStore {
  const fsx = deps.fs ?? nodeStoreFs;
  const readOpts: MboxReadOpts = { now: deps.now, maxMessages: deps.initial?.maxMessages, maxAgeDays: deps.initial?.maxAgeDays };
  return {
    scan(): LocalScanResult {
      for (const profile of resolveProfileDirs(deps.roots(), fsx)) {
        const boxes = collectMboxes(profile.dir, fsx);
        if (boxes.length) return { found: true, profile: profile.name, profileDir: profile.dir, boxes };
      }
      return { found: false, profile: null, profileDir: null, boxes: [] };
    },
    readBox: (ref, cursor) => readMboxDelta(ref, cursor, fsx, readOpts),
  };
}
