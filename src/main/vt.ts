// ── Veritabanı (yerel SQLite, node:sqlite) ───────────────────────────────────────────────────────────────────
// Electron 44'ün Node 24'ünde yerleşik `node:sqlite` + FTS5 var: yerel modül derlemesi yok. Tam metin dizinleri
// İÇERİKSİZ (contentless_delete) — asıl metin tabloda, dizine Türkçe normalize edilmiş kopya girer (hafiza/normal.ts):
// "ı/İ", "ş", "ğ"… sadeleşir, böylece "toplantı" araması "toplantısı"nı bulur.
import { DatabaseSync } from 'node:sqlite';
import { yollar } from './yollar.js';
import { gizliSutunlari } from './gizli-sema.js';

let vt: DatabaseSync | null = null;

const GOCLER: (string | ((v: DatabaseSync) => void))[] = [
  `
  CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);

  CREATE TABLE sohbetler(
    id INTEGER PRIMARY KEY, baslik TEXT NOT NULL DEFAULT 'Yeni sohbet', tur TEXT NOT NULL DEFAULT 'normal',
    ozet TEXT, ozet_son_mesaj INTEGER DEFAULT 0, olusturma TEXT NOT NULL, guncelleme TEXT NOT NULL,
    arsiv INTEGER NOT NULL DEFAULT 0, okunmamis INTEGER NOT NULL DEFAULT 0);

  CREATE TABLE mesajlar(
    id INTEGER PRIMARY KEY, sohbet_id INTEGER NOT NULL REFERENCES sohbetler(id), rol TEXT NOT NULL,
    metin TEXT NOT NULL DEFAULT '', bloklar TEXT NOT NULL DEFAULT '[]', ham TEXT, kaynak TEXT, model TEXT,
    atiflar TEXT, olusturma TEXT NOT NULL);
  CREATE INDEX mesajlar_sohbet ON mesajlar(sohbet_id, id);
  CREATE VIRTUAL TABLE mesaj_ara USING fts5(metin, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');

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

  CREATE TABLE oneriler(
    id INTEGER PRIMARY KEY, tur TEXT NOT NULL, baslik TEXT NOT NULL, icerik TEXT NOT NULL DEFAULT '',
    durum TEXT NOT NULL DEFAULT 'yeni', olusturma TEXT NOT NULL, gecerlilik TEXT);

  CREATE TABLE kokpit(id INTEGER PRIMARY KEY CHECK(id = 1), duzen TEXT NOT NULL, guncelleme TEXT NOT NULL);
  CREATE TABLE ozel_kartlar(id TEXT PRIMARY KEY, baslik TEXT NOT NULL, veri TEXT NOT NULL, oncelik INTEGER NOT NULL DEFAULT 3,
    olusturma TEXT NOT NULL, guncelleme TEXT NOT NULL, bitis TEXT);

  CREATE TABLE belgeler(
    id INTEGER PRIMARY KEY, yol TEXT NOT NULL, ad TEXT NOT NULL, tur TEXT, boyut INTEGER, ozet_hash TEXT UNIQUE,
    ozet TEXT, durum TEXT NOT NULL DEFAULT 'bekliyor', hata TEXT, parca_sayisi INTEGER DEFAULT 0,
    olusturma TEXT NOT NULL, islenme TEXT);
  CREATE TABLE parcalar(id INTEGER PRIMARY KEY, belge_id INTEGER NOT NULL REFERENCES belgeler(id), sira INTEGER NOT NULL, metin TEXT NOT NULL);
  CREATE VIRTUAL TABLE parca_ara USING fts5(metin, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');

  CREATE TABLE epostalar(
    id INTEGER PRIMARY KEY, hesap TEXT NOT NULL, uid INTEGER, mesaj_kimlik TEXT, kimden TEXT, kime TEXT, konu TEXT,
    tarih TEXT, ozet TEXT, govde TEXT, okundu INTEGER NOT NULL DEFAULT 0, onem INTEGER NOT NULL DEFAULT 0,
    degerlendirme TEXT, UNIQUE(hesap, mesaj_kimlik));

  CREATE TABLE wa_mesajlar(
    id INTEGER PRIMARY KEY, jid TEXT NOT NULL, ad TEXT, yon TEXT NOT NULL, metin TEXT NOT NULL, zaman TEXT NOT NULL,
    okundu INTEGER NOT NULL DEFAULT 0, kimlik TEXT UNIQUE);
  CREATE INDEX wa_jid ON wa_mesajlar(jid, zaman);

  CREATE TABLE olay_gunlugu(id INTEGER PRIMARY KEY, tur TEXT NOT NULL, ayrinti TEXT, zaman TEXT NOT NULL);
  CREATE TABLE kullanim(id INTEGER PRIMARY KEY, saglayici TEXT, model TEXT, amac TEXT, giris INTEGER, cikis INTEGER,
    onbellek_okuma INTEGER, onbellek_yazma INTEGER, maliyet REAL, zaman TEXT NOT NULL);
  `,
  // 2: aylık hatırlatıcının asıl günü (31 → Şubat'ta 28'e kırpılır, Mart'ta yine 31; bkz. tekrar.ts).
  `ALTER TABLE hatirlaticilar ADD COLUMN gun INTEGER;`,
  // 3: düşünme motoru — gün boyu döküm, not maddeleri (önemli/önemsiz + silinme tarihi), raporlar, meseleler, eşlikçi.
  `
  CREATE TABLE dokum(id INTEGER PRIMARY KEY, zaman TEXT NOT NULL, gun TEXT NOT NULL, metin TEXT NOT NULL, motor TEXT,
    sure REAL, notlandi INTEGER NOT NULL DEFAULT 0);
  CREATE INDEX dokum_gun ON dokum(gun, id);
  CREATE VIRTUAL TABLE dokum_ara USING fts5(metin, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');

  CREATE TABLE not_maddeleri(id INTEGER PRIMARY KEY, gun TEXT NOT NULL, zaman TEXT NOT NULL, metin TEXT NOT NULL,
    onem TEXT NOT NULL, konu TEXT, kisiler TEXT NOT NULL DEFAULT '[]', eglenceli INTEGER NOT NULL DEFAULT 0,
    satirlar TEXT NOT NULL DEFAULT '', silinme TEXT NOT NULL, olusturma TEXT NOT NULL);
  CREATE INDEX not_maddeleri_gun ON not_maddeleri(gun, id);
  CREATE VIRTUAL TABLE madde_ara USING fts5(metin, konu, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');

  CREATE TABLE raporlar(id INTEGER PRIMARY KEY, tur TEXT NOT NULL, donem TEXT NOT NULL, baslik TEXT NOT NULL,
    ozet TEXT NOT NULL DEFAULT '', yapi TEXT NOT NULL, madde_sayisi INTEGER NOT NULL DEFAULT 0, model TEXT,
    olusturma TEXT NOT NULL, guncelleme TEXT NOT NULL, UNIQUE(tur, donem));
  CREATE VIRTUAL TABLE rapor_ara USING fts5(baslik, icerik, content='', contentless_delete=1, tokenize='unicode61 remove_diacritics 2');

  CREATE TABLE meseleler(id INTEGER PRIMARY KEY, baslik TEXT NOT NULL, ayrinti TEXT, kisi TEXT, ilk_gun TEXT NOT NULL,
    hedef TEXT, durum TEXT NOT NULL DEFAULT 'acik', kapanis TEXT, kaynak TEXT, olusturma TEXT NOT NULL, guncelleme TEXT NOT NULL);

  CREATE TABLE eslikler(id INTEGER PRIMARY KEY, zaman TEXT NOT NULL, tetik TEXT NOT NULL, metin TEXT NOT NULL, tur TEXT NOT NULL,
    kaynaklar TEXT);
  `,
  // 4: kullanım özeti (motor/kullanim.ts) pencereyle okur: "bu ay N yanıt" mesajları, maliyet kullanım kayıtlarını tarar — bütün tablo
  // taranmasın. Yalnız dizin (veri değişmez); IF NOT EXISTS: yeniden çalışması zararsız.
  `
  CREATE INDEX IF NOT EXISTS mesajlar_olusturma ON mesajlar(olusturma);
  CREATE INDEX IF NOT EXISTS kullanim_zaman ON kullanim(zaman);
  `,
  // 5: Gizli bölüm (Görev 21 düzeltme 1-2): Gizli modda yazılan mesajlar ve gün kaydı kayıtları (döküm, not, mesele, rapor, eşlik)
  // işaretlenir; hiçbir bulut bağlamına girmez. Eski kayıtlar 0 (gizli değil) — veri değişmez. PRAGMA denetimli (yeniden çalışabilir).
  gizliSutunlari,
  // 6 (0.11 G9): Görevler — süreli/sürekli işler (main/isler/depo.ts). Plan JSON; durum onay|suruyor|durdu|bitti|hata; zamanlar, sayaçlar,
  // son özet(ler), gözcü izi, görevin sohbeti. Yalnız yeni tablo (eski veri değişmez); IF NOT EXISTS: yeniden çalışması zararsız.
  `
  CREATE TABLE IF NOT EXISTS isler(
    id INTEGER PRIMARY KEY, baslik TEXT NOT NULL, amac TEXT NOT NULL DEFAULT '', durum TEXT NOT NULL, plan TEXT NOT NULL,
    baslangic TEXT, bitis_zamani TEXT, sonraki TEXT, son_kontrol TEXT, adim INTEGER NOT NULL DEFAULT 0, kontrol INTEGER NOT NULL DEFAULT 0,
    son_ozet TEXT, ozetler TEXT NOT NULL DEFAULT '[]', sonuc TEXT, durma_nedeni TEXT, sohbet_id INTEGER NOT NULL, iz TEXT,
    aralik INTEGER NOT NULL DEFAULT 10, basarisiz INTEGER NOT NULL DEFAULT 0, gonderilenler TEXT NOT NULL DEFAULT '[]',
    olusturma TEXT NOT NULL, guncelleme TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS isler_durum ON isler(durum, guncelleme);
  `,
  // 7 (0.13 T4): yanıtı yazan karakterin adı (turun başında kilitlenen kip). Eski iletilerde NULL — arayüz "Fuber" gösterir. PRAGMA denetimli.
  karakterSutunu,
  // 8 (0.14 T30): yanıtı yazan karakterin kipi ('business' | 'developer'; sohbet avatarı). Eski iletilerde NULL — arayüz Fuber işaretini gösterir.
  kipSutunu,
];

/** `mesajlar.karakter` yoksa ekler (tekrar çalışması zararsız). */
function karakterSutunu(v: DatabaseSync): void {
  const sutunlar = v.prepare('PRAGMA table_info(mesajlar)').all() as { name: string }[];
  if (sutunlar.length && !sutunlar.some((s) => s.name === 'karakter')) v.exec('ALTER TABLE mesajlar ADD COLUMN karakter TEXT;');
}

/** `mesajlar.kip` yoksa ekler (tekrar çalışması zararsız; tablo yoksa atlanır). */
export function kipSutunu(v: DatabaseSync): void {
  const sutunlar = v.prepare('PRAGMA table_info(mesajlar)').all() as { name: string }[];
  if (sutunlar.length && !sutunlar.some((s) => s.name === 'kip')) v.exec('ALTER TABLE mesajlar ADD COLUMN kip TEXT;');
}

export function veritabani(): DatabaseSync {
  if (vt) return vt;
  vt = new DatabaseSync(yollar.veritabani());
  vt.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 4000;');
  vt.exec('CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT)');
  const surum = Number((vt.prepare("SELECT v FROM meta WHERE k = 'surum'").get() as { v?: string } | undefined)?.v ?? 0);
  for (let i = surum; i < GOCLER.length; i++) {
    vt.exec('BEGIN');
    try {
      const g = GOCLER[i];
      if (typeof g === 'string') vt.exec(g); else void g(vt);
      vt.prepare("INSERT INTO meta(k, v) VALUES('surum', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(String(i + 1));
      vt.exec('COMMIT');
    } catch (e) {
      vt.exec('ROLLBACK');
      throw e;
    }
  }
  kipSutunu(vt); // savunma: numaralı göç başka bir dalda başka işe gitmiş olsa da (idempotent)
  karakterSutunu(vt); // savunma: numaralı göç başka bir dalda başka işe gitmiş olsa da (idempotent)
  gizliSutunlari(vt); // savunma: numaralı göç başka bir dalda başka işe gitmiş olsa da (idempotent)
  return vt;
}

export const simdi = () => new Date().toISOString();
/** Kullanıcının saat dilimine göre YYYY-AA-GG (UTC değil: Türkiye'de gece 00-03 arası UTC günü bir gün geride kalır). */
export const yerelGun = (d: Date | string = new Date()) => new Date(d).toLocaleDateString('sv-SE');

export function meta(k: string): string | undefined {
  return (veritabani().prepare('SELECT v FROM meta WHERE k = ?').get(k) as { v?: string } | undefined)?.v;
}
export function metaYaz(k: string, v: string): void {
  veritabani().prepare('INSERT INTO meta(k, v) VALUES(?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v').run(k, v);
}
export function metaSil(k: string): void {
  veritabani().prepare('DELETE FROM meta WHERE k = ?').run(k);
}

export function olayKaydet(tur: string, ayrinti: unknown): void {
  veritabani().prepare('INSERT INTO olay_gunlugu(tur, ayrinti, zaman) VALUES(?, ?, ?)').run(tur, JSON.stringify(ayrinti), simdi());
}
