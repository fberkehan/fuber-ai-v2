// SENTETİK v1 veritabanı (sınama fikstürü). Şema v1 `src/main/vt.ts` göçlerinin ilgili parçalarıyla birebir:
// göç 1 (meta, hafizalar + FTS, hatirlaticilar, gorevler), göç 2 (`hatirlaticilar.gun`), göç 3 (meseleler),
// göç 5 (`gizli` sütunları; v1'de hafizalar ve hatirlaticilar bunu taşımaz). İçerik uydurmadır; gerçek bir kullanıcının
// verisiyle ilgisi yoktur. Yalnız Node yerleşikleri: uçtan uca betik de (`node`, tip ayıklamayla) kullanır.
//
// v1 çalışıyormuş gibi: yazar bağlantı açık kalır ve otomatik WAL işleme kapalıdır, yani son satırlar yalnız
// `fuber.db-wal` içindedir (aktarıcı onları da görmeli).
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const V1_DDL = `
  CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE hafizalar(
    id INTEGER PRIMARY KEY, tur TEXT NOT NULL, baslik TEXT NOT NULL, icerik TEXT NOT NULL,
    etiketler TEXT NOT NULL DEFAULT '[]', onem INTEGER NOT NULL DEFAULT 3, sabit INTEGER NOT NULL DEFAULT 0,
    kaynak TEXT NOT NULL DEFAULT '', olay_tarihi TEXT, olusturma TEXT NOT NULL, guncelleme TEXT NOT NULL,
    son_erisim TEXT, erisim_sayisi INTEGER NOT NULL DEFAULT 0, silindi INTEGER NOT NULL DEFAULT 0);
  CREATE VIRTUAL TABLE hafiza_ara USING fts5(baslik, icerik, etiketler, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');
  CREATE TABLE hatirlaticilar(
    id INTEGER PRIMARY KEY, baslik TEXT NOT NULL, aciklama TEXT, zaman TEXT NOT NULL, tekrar TEXT NOT NULL DEFAULT 'yok',
    durum TEXT NOT NULL DEFAULT 'bekliyor', onem INTEGER NOT NULL DEFAULT 3, kaynak TEXT, olusturma TEXT NOT NULL,
    son_bildirim TEXT);
  CREATE TABLE gorevler(
    id INTEGER PRIMARY KEY, baslik TEXT NOT NULL, aciklama TEXT, durum TEXT NOT NULL DEFAULT 'acik', son_tarih TEXT,
    proje TEXT, oncelik INTEGER NOT NULL DEFAULT 3, olusturma TEXT NOT NULL, tamamlanma TEXT);
  ALTER TABLE hatirlaticilar ADD COLUMN gun INTEGER;
  CREATE TABLE meseleler(id INTEGER PRIMARY KEY, baslik TEXT NOT NULL, ayrinti TEXT, kisi TEXT, ilk_gun TEXT NOT NULL,
    hedef TEXT, durum TEXT NOT NULL DEFAULT 'acik', kapanis TEXT, kaynak TEXT, olusturma TEXT NOT NULL, guncelleme TEXT NOT NULL);
  ALTER TABLE meseleler ADD COLUMN gizli INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE gorevler ADD COLUMN gizli INTEGER NOT NULL DEFAULT 0;
  INSERT INTO meta(k, v) VALUES('surum', '8');
`;

export interface FixtureOptions {
  /** "Şimdi": gelecek/geçmiş hatırlatıcılar buna göre kurulur. */
  now: Date;
  /** Tabloları eksik ya da eski biçimli kurmak için (şema uyumsuzluğu sınaması). */
  variant?: 'full' | 'old';
}

export interface V1Fixture {
  dir: string;
  db: string;
  /** Yazarı kapatır (WAL ana dosyaya işlenir). */
  close(): void;
  /** v1 "çalışırken" bir satır daha ekler (yalnız WAL'a gider). */
  addMemory(title: string, body: string): void;
}

const LONG_TURKISH = 'Çağrı Öztürk’ün şirketinde ığdır, şişli, güneş, İSTANBUL, IŞIK, ÖĞÜT, çiçek. '.repeat(70);

/** `dir` içine `fuber.db` (+ `-wal`, `-shm`) kurar. */
export function createV1Fixture(dir: string, options: FixtureOptions): V1Fixture {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'fuber.db');
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;');
  const now = options.now.getTime();
  const iso = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const DAY = 86_400_000;

  if (options.variant === 'old') {
    // Göç 3'ten önceki bir v1: meseleler yok; hafizalar'da `silindi` sütunu yok (uyumsuz).
    db.exec(`
      CREATE TABLE meta(k TEXT PRIMARY KEY, v TEXT);
      CREATE TABLE hafizalar(id INTEGER PRIMARY KEY, tur TEXT NOT NULL, baslik TEXT NOT NULL, icerik TEXT NOT NULL,
        etiketler TEXT NOT NULL DEFAULT '[]', onem INTEGER NOT NULL DEFAULT 3, sabit INTEGER NOT NULL DEFAULT 0,
        kaynak TEXT NOT NULL DEFAULT '', olay_tarihi TEXT, olusturma TEXT NOT NULL, guncelleme TEXT NOT NULL);
      CREATE TABLE hatirlaticilar(id INTEGER PRIMARY KEY, baslik TEXT NOT NULL, aciklama TEXT, zaman TEXT NOT NULL,
        tekrar TEXT NOT NULL DEFAULT 'yok', durum TEXT NOT NULL DEFAULT 'bekliyor', onem INTEGER NOT NULL DEFAULT 3,
        kaynak TEXT, olusturma TEXT NOT NULL, son_bildirim TEXT);
      CREATE TABLE gorevler(id INTEGER PRIMARY KEY, baslik TEXT NOT NULL, aciklama TEXT, durum TEXT NOT NULL DEFAULT 'acik',
        son_tarih TEXT, proje TEXT, oncelik INTEGER NOT NULL DEFAULT 3, olusturma TEXT NOT NULL, tamamlanma TEXT);
      INSERT INTO meta(k, v) VALUES('surum', '2');
    `);
    db.prepare("INSERT INTO hafizalar(tur, baslik, icerik, olusturma, guncelleme) VALUES('bilgi', 'Eski kayıt', 'Görünmemeli', ?, ?)").run(iso(-DAY), iso(-DAY));
    db.prepare("INSERT INTO hatirlaticilar(baslik, zaman, olusturma) VALUES('Eski sürüm hatırlatıcısı', ?, ?)").run(iso(DAY), iso(-DAY));
    db.prepare("INSERT INTO gorevler(baslik, olusturma) VALUES('Eski sürüm yapılacağı', ?)").run(iso(-DAY));
  } else {
    db.exec(V1_DDL);
    const memory = db.prepare(
      `INSERT INTO hafizalar(tur, baslik, icerik, etiketler, onem, sabit, kaynak, olay_tarihi, olusturma, guncelleme, silindi)
       VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const created = '2026-09-03T08:15:00.000Z';
    // 1–5: aktarılacak olağan kayıtlar
    memory.run('kullanici', 'Kullanıcının adı', 'Adı Çağrı Öztürk; ona “efendim” diye hitap edilir.', '["kimlik"]', 5, 1, 'kurulum', null, created, created, 0);
    memory.run('tercih', 'Rapor biçimi', 'Raporları madde madde ve kısa ister.', '[]', 4, 0, 'kullanici, sohbet:3', null, created, created, 0);
    memory.run('kisi', 'Ayşe Yılmaz', 'Muhasebeci; KDV beyannamelerini o hazırlar.', '["muhasebe"]', 3, 0, 'sohbet:7', null, created, created, 0);
    memory.run('proje', 'KİLİM', LONG_TURKISH, '[]', 3, 0, 'belge:12', null, created, created, 0);
    memory.run('olay', 'Toplantı', 'Kocaeli’deki müşteriyle görüşüldü, teklif istendi.', '[]', 2, 0, 'gunkaydi:2026-10-12', '2026-10-12T09:00:00.000Z', created, created, 0);
    // 6: sır gibi görünüyor
    memory.run('bilgi', 'Sunucu', 'Yönetim paneli şifre: Kedi1234!', '[]', 3, 0, '', null, created, created, 0);
    // 7: bozuk (boş)
    memory.run('bilgi', '', '   ', '[]', 3, 0, '', null, created, created, 0);
    // 8–9: silinmiş ve arşivlenmiş
    memory.run('bilgi', 'Silinmiş', 'Kullanıcı sildi.', '[]', 3, 0, '', null, created, created, 1);
    memory.run('bilgi', 'Arşiv', 'Budamada arşive gitti.', '[]', 1, 0, '', null, created, created, 2);
    // 10: söz → commitment
    memory.run('gorev', 'Söz', 'Cuma günü Ali’ye sözleşmeyi gönderecek.', '[]', 4, 0, 'sohbet:9', null, created, created, 0);
    // 11: bozuk etiket JSON'u (kayıt yine aktarılır)
    memory.run('kural', 'Arama saati', 'Sabah dokuzdan önce arama yapılmaz.', '[bozuk', 3, 1, 'kullanici', null, created, created, 0);
    // 12: 2 ile aynı içerik (kopya)
    memory.run('tercih', 'Rapor biçimi', 'Raporları madde madde ve kısa ister.', '[]', 4, 0, 'sohbet:30', null, created, created, 0);
    // 13: anahtar
    memory.run('bilgi', 'API', 'Anahtar sk-' + 'ant-api03-AbCdEfGhIjKlMnOpQrStUvWx', '[]', 3, 0, '', null, created, created, 0);
    // 14: tarihi bozuk (kayıt yine aktarılır, öğrenilme anı bilinmez)
    memory.run('olay', 'Tarihsiz anı', 'Bir gün İzmir’e gidildi.', '[]', 3, 0, '', null, 'bozuk-tarih', 'bozuk-tarih', 0);

    const reminder = db.prepare(
      'INSERT INTO hatirlaticilar(baslik, aciklama, zaman, tekrar, durum, onem, kaynak, olusturma, gun) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    reminder.run('KDV beyannamesini ver', 'Ayşe Hanım’a sor', iso(2 * DAY), 'yok', 'bekliyor', 4, null, created, null);
    reminder.run('Eski toplantı', null, iso(-3 * DAY), 'yok', 'gonderildi', 3, null, created, null);
    reminder.run('İlaç', null, iso(-5 * DAY), 'gunluk', 'bekliyor', 3, null, created, null);
    // Aylık, asıl gün 31; v1 zamanı kırpılmış 28 Şubat'ta duruyor.
    reminder.run('Kira', 'Ev sahibine', '2026-02-28T07:00:00.000Z', 'aylik', 'bekliyor', 5, null, created, 31);
    reminder.run('Haftalık rapor', null, iso(DAY), 'hafta_ici', 'bekliyor', 2, null, created, null);
    reminder.run('İki haftada bir', null, iso(DAY), 'iki_haftada', 'bekliyor', 3, null, created, null);
    reminder.run('Kaçan hatırlatıcı', null, iso(-DAY), 'yok', 'bekliyor', 3, null, created, null);
    reminder.run('İptal edilen', null, iso(3 * DAY), 'yok', 'iptal', 3, null, created, null);
    reminder.run('Bozuk zaman', null, 'yarın sabah', 'yok', 'bekliyor', 3, null, created, null);
    reminder.run('Banka', 'kart şifresi 445566', iso(4 * DAY), 'yok', 'bekliyor', 3, null, created, null);
    reminder.run('Haftalık spor', null, iso(-2 * DAY), 'haftalik', 'bekliyor', 3, null, created, null);

    const todo = db.prepare(
      'INSERT INTO gorevler(baslik, aciklama, durum, son_tarih, proje, oncelik, olusturma, tamamlanma, gizli) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    todo.run('Faturaları öde', null, 'acik', iso(DAY), 'Fuber', 4, created, null, 0);
    todo.run(`Uzun başlık ${'ğüşiöç '.repeat(60)}`, 'Ayrıntı', 'acik', null, null, 3, created, null, 0);
    todo.run('Eski iş', null, 'tamam', null, null, 3, created, '2026-11-01T10:00:00.000Z', 0);
    todo.run('Gizli iş', null, 'acik', null, null, 3, created, null, 1);
    todo.run('', null, 'acik', null, null, 3, created, null, 0);
    todo.run('Çağrı’yı ara', 'Sözleşme için', 'acik', null, null, 1, created, null, 0);

    const issue = db.prepare(
      'INSERT INTO meseleler(baslik, ayrinti, kisi, ilk_gun, hedef, durum, kaynak, olusturma, guncelleme, gizli) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    );
    issue.run('Ali sözleşmeyi gönderecek', 'İmzalı nüsha bekleniyor', 'Ali', '2026-11-10', '2026-11-20', 'acik', 'gunkaydi:2026-11-10', created, created, 0);
    issue.run('Teklif döndü', null, 'Mehmet', '2026-11-01', null, 'kapandi', null, created, created, 0);
    issue.run('Gizli mesele', null, null, '2026-11-02', null, 'acik', null, created, created, 1);
    issue.run('Şirket kaydı', 'portal parola: abc123', null, '2026-11-03', null, 'acik', null, created, created, 0);
  }

  return {
    dir,
    db: file,
    close() {
      db.close();
    },
    addMemory(title, body) {
      const at = new Date().toISOString();
      db.prepare("INSERT INTO hafizalar(tur, baslik, icerik, olusturma, guncelleme) VALUES('bilgi', ?, ?, ?, ?)").run(title, body, at, at);
    },
  };
}
