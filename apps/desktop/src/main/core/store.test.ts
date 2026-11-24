import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { foldForSearch, FTS_TOKENIZER, ftsQuery, type Logger, type Paths, type Store } from '@fuber/shared';
import { createFtsIndex, createStore, ftsTableSql, storeRecovery, tablePrefix } from './store';

const log: Logger = { debug() {}, info() {}, warn() {}, error() {}, child: () => log };

let dir: string;
let store: Store;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fuber2-store-'));
  store = createStore({ paths: { db: path.join(dir, 'test.db') } as Paths, log });
});

afterEach(() => {
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('createStore', () => {
  it('göçleri sırayla ve yalnız bir kez uygular', () => {
    const migrations = [
      { id: 2, name: 'sütun', up: 'ALTER TABLE planner_todos ADD COLUMN done INTEGER NOT NULL DEFAULT 0' },
      { id: 1, name: 'tablo', up: 'CREATE TABLE planner_todos (id TEXT PRIMARY KEY, text TEXT NOT NULL)' },
    ];
    store.migrate('planner', migrations);
    store.migrate('planner', migrations);
    const db = store.scoped('planner');
    expect(db.prefix).toBe('planner_');
    expect(db.run('INSERT INTO planner_todos (id, text) VALUES (?, ?)', ['a', 'süt al']).changes).toBe(1);
    expect(db.get<{ text: string; done: number }>('SELECT text, done FROM planner_todos WHERE id = :id', { id: 'a' })).toEqual({
      text: 'süt al',
      done: 0,
    });
    expect(db.all('SELECT id FROM planner_todos')).toHaveLength(1);
  });

  it('işlem hata verirse geri alır; iç içe işlem dıştakini bozmaz', () => {
    const db = store.scoped('demo');
    db.exec('CREATE TABLE demo_items (n INTEGER)');
    expect(() =>
      db.transaction(() => {
        db.run('INSERT INTO demo_items VALUES (1)');
        throw new Error('vazgeç');
      }),
    ).toThrow('vazgeç');
    expect(db.all('SELECT n FROM demo_items')).toHaveLength(0);

    db.transaction(() => {
      db.run('INSERT INTO demo_items VALUES (1)');
      try {
        db.transaction(() => {
          db.run('INSERT INTO demo_items VALUES (2)');
          throw new Error('içteki');
        });
      } catch {
        // içteki geri alındı, dıştaki sürüyor
      }
      db.run('INSERT INTO demo_items VALUES (3)');
    });
    expect(db.all<{ n: number }>('SELECT n FROM demo_items ORDER BY n').map((row) => row.n)).toEqual([1, 3]);
  });

  it('anahtar-değer deposu kapsamlara ayrılır', () => {
    store.kv('a').set('k', { n: 1, list: ['x'] });
    store.kv('b').set('k', 'başka');
    expect(store.kv('a').get('k')).toEqual({ n: 1, list: ['x'] });
    expect(store.kv('b').get('k')).toBe('başka');
    store.kv('a').delete('k');
    expect(store.kv('a').get('k')).toBeUndefined();
  });

  it('FTS5 katlama kalıbı Türkçe aramada çalışır', () => {
    const db = store.scoped('memory');
    db.exec(`CREATE VIRTUAL TABLE memory_fts USING fts5(norm, tokenize = "${FTS_TOKENIZER}")`);
    const docs = ['Yarın saat onda KDV beyannamesini hatırlat', 'İstanbul Şişli ofisi', 'IŞIK Holding görüşmesi'];
    docs.forEach((doc, index) => db.run('INSERT INTO memory_fts (rowid, norm) VALUES (?, ?)', [index + 1, foldForSearch(doc)]));
    const search = (text: string) =>
      db.all<{ rowid: number }>('SELECT rowid FROM memory_fts WHERE memory_fts MATCH ?', [ftsQuery(text)]).map((r) => r.rowid);
    expect(search('beyanname')).toEqual([1]);
    expect(search('istanbul')).toEqual([2]);
    expect(search('ışık')).toEqual([3]);
  });

  it('kapsam adından tablo öneki türetir', () => {
    expect(tablePrefix('voice-control')).toBe('voice_control_');
  });

  it('geçersiz ya da yinelenen göç numarasını reddeder', () => {
    expect(() => store.migrate('x', [{ id: 0, name: 'sıfır', up: 'SELECT 1' }])).toThrow('geçersiz göç numarası');
    expect(() =>
      store.migrate('x', [
        { id: 1, name: 'a', up: 'CREATE TABLE x_a (n INTEGER)' },
        { id: 1, name: 'b', up: 'CREATE TABLE x_b (n INTEGER)' },
      ]),
    ).toThrow('geçersiz göç numarası');
  });

  it('hata veren göç geri alınır ve kayda geçmez; düzeltilince uygulanır', () => {
    const broken = { id: 1, name: 'bozuk', up: 'CREATE TABLE y_a (n INTEGER); INSERT INTO yok_tablo VALUES (1)' };
    expect(() => store.migrate('y', [broken])).toThrow();
    expect(store.scoped('y').all("SELECT name FROM sqlite_master WHERE name = 'y_a'")).toHaveLength(0);
    store.migrate('y', [{ id: 1, name: 'düzgün', up: 'CREATE TABLE y_a (n INTEGER)' }]);
    expect(store.scoped('y').all("SELECT name FROM sqlite_master WHERE name = 'y_a'")).toHaveLength(1);
  });

  it('işlev biçimli göç kapsamlı veritabanını alır', () => {
    store.migrate('voice-control', [
      {
        id: 1,
        name: 'işlev',
        up: (db) => {
          db.exec(`CREATE TABLE ${db.prefix}state (k TEXT PRIMARY KEY, v TEXT)`);
          db.run(`INSERT INTO ${db.prefix}state VALUES (?, ?)`, ['a', 'b']);
        },
      },
    ]);
    expect(store.scoped('voice-control').get('SELECT v FROM voice_control_state WHERE k = ?', ['a'])).toEqual({ v: 'b' });
  });

  it('kapanış yinelenebilir ve WAL dosyasını ana dosyaya işler', () => {
    store.scoped('z').exec('CREATE TABLE z_a (n INTEGER); INSERT INTO z_a VALUES (1)');
    store.close();
    store.close();
    const wal = `${store.path}-wal`;
    expect(!fs.existsSync(wal) || fs.statSync(wal).size === 0).toBe(true);
    const reopened = createStore({ paths: { db: store.path } as Paths, log });
    expect(reopened.scoped('z').get('SELECT n FROM z_a')).toEqual({ n: 1 });
    expect(storeRecovery(reopened)).toBeNull();
    reopened.close();
  });
});

describe('FTS5 yardımcıları', () => {
  const docs = {
    kdv: 'Yarın saat onda KDV beyannamesini hatırlat',
    ofis: 'İstanbul Şişli ofisi için kira sözleşmesi',
    isik: 'IŞIK Holding görüşmesi ÇARŞAMBA günü',
  };
  const refs = (hits: Array<{ ref: string }>) => hits.map((hit) => hit.ref);

  it('Türkçe büyük/küçük harf, aksansız yazım ve önek sorgusu sonuç verir', () => {
    const index = createFtsIndex(store.scoped('memory'), 'items');
    expect(index.table).toBe('memory_items_fts');
    for (const [ref, text] of Object.entries(docs)) index.put(ref, text);

    expect(refs(index.search('beyanname'))).toEqual(['kdv']);
    expect(refs(index.search('BEYAN'))).toEqual(['kdv']);
    expect(refs(index.search('istanbul'))).toEqual(['ofis']);
    expect(refs(index.search('ISTANBUL'))).toEqual(['ofis']);
    expect(refs(index.search('İSTANBUL'))).toEqual(['ofis']);
    expect(refs(index.search('sisli'))).toEqual(['ofis']);
    expect(refs(index.search('ışık'))).toEqual(['isik']);
    expect(refs(index.search('isik hol'))).toEqual(['isik']);
    expect(refs(index.search('çarşamba'))).toEqual(['isik']);
    expect(refs(index.search('carsamba'))).toEqual(['isik']);
    // Yalnız son sözcük önektir: ilk sözcük tam eşleşmelidir.
    expect(refs(index.search('beyan kdv'))).toEqual([]);
    expect(refs(index.search('kdv beyan'))).toEqual(['kdv']);
    expect(refs(index.search('istanbul kdv'))).toEqual([]);
    expect(refs(index.search('istanbul kdv', { any: true })).sort()).toEqual(['kdv', 'ofis']);
  });

  it('sorgu sözdizimi enjekte edilemez; aranabilir sözcük yoksa boş döner', () => {
    const index = createFtsIndex(store.scoped('memory'), 'items');
    index.put('kdv', docs.kdv);
    expect(index.search('"" ** ()')).toEqual([]);
    expect(index.search('   ')).toEqual([]);
    expect(refs(index.search('kdv" OR norm:"x'))).toEqual([]);
    expect(refs(index.search('NEAR(kdv)'))).toEqual([]);
  });

  it('aynı kayıt yeniden yazılınca eskisi dizinden çıkar; silinen bulunmaz', () => {
    const index = createFtsIndex(store.scoped('memory'), 'items');
    index.put('a', 'elma armut');
    index.put('a', 'kiraz');
    expect(index.search('elma')).toEqual([]);
    expect(refs(index.search('kiraz'))).toEqual(['a']);
    index.remove('a');
    expect(index.search('kiraz')).toEqual([]);
    // Yeniden açmak var olan dizini korur.
    index.put('b', 'vişne');
    expect(refs(createFtsIndex(store.scoped('memory'), 'items').search('visne'))).toEqual(['b']);
  });

  it('tablo adı sütun adıyla çakışamaz', () => {
    expect(() => ftsTableSql('norm')).toThrow('geçersiz FTS tablo adı');
    expect(ftsTableSql('planner_notes_fts')).toContain('fts5(norm, ref UNINDEXED');
  });
});

describe('bozuk veritabanı', () => {
  const errors: string[] = [];
  const loud: Logger = { ...log, error: (message) => void errors.push(message), child: () => loud };
  const backups = () => fs.readdirSync(dir).filter((name) => name.includes('.bozuk-'));

  it('veritabanı olmayan dosyayı yedekler ve temiz açar', () => {
    const file = path.join(dir, 'cop.db');
    fs.writeFileSync(file, Buffer.from('bu bir sqlite dosyası değil '.repeat(400)));
    const opened = createStore({ paths: { db: file } as Paths, log: loud });
    const recovery = storeRecovery(opened);
    expect(recovery).not.toBeNull();
    expect(fs.existsSync(recovery!.backupPath)).toBe(true);
    expect(path.basename(recovery!.backupPath)).toMatch(/^cop[.]db[.]bozuk-[0-9]{8}-[0-9]{6}$/);
    expect(fs.readFileSync(recovery!.backupPath).toString()).toContain('sqlite dosyası değil');
    expect(errors.some((message) => message.includes('veritabanı bozuk'))).toBe(true);
    opened.kv('a').set('k', 1);
    expect(opened.kv('a').get('k')).toBe(1);
    opened.close();
  });

  it('sayfaları ezilmiş dosyada bütünlük denetimi kırılır; yedeklenir ve temiz açılır', () => {
    const file = path.join(dir, 'ezik.db');
    const first = createStore({ paths: { db: file } as Paths, log });
    const db = first.scoped('big');
    db.exec('CREATE TABLE big_rows (id INTEGER PRIMARY KEY, body TEXT)');
    db.transaction(() => {
      for (let i = 0; i < 400; i++) db.run('INSERT INTO big_rows (body) VALUES (?)', ['x'.repeat(900) + i]);
    });
    first.close();

    // Başlık sağlam kalır (dosya "açılır"), veri sayfaları ezilir.
    const bytes = fs.readFileSync(file);
    bytes.fill(0xab, 4096, bytes.length - 4096);
    fs.writeFileSync(file, bytes);

    const opened = createStore({ paths: { db: file } as Paths, log: loud });
    expect(storeRecovery(opened)).not.toBeNull();
    expect(backups().some((name) => name.startsWith('ezik.db.bozuk-'))).toBe(true);
    expect(opened.scoped('big').all("SELECT name FROM sqlite_master WHERE name = 'big_rows'")).toHaveLength(0);
    opened.close();
  });

  it('sağlam dosyaya dokunmaz', () => {
    store.kv('a').set('k', 'v');
    store.close();
    const reopened = createStore({ paths: { db: store.path } as Paths, log: loud });
    expect(storeRecovery(reopened)).toBeNull();
    expect(reopened.kv('a').get('k')).toBe('v');
    expect(backups()).toHaveLength(0);
    reopened.close();
  });
});
