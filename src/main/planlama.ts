// ── Hatırlatıcılar, görevler (planlar), öneriler ─────────────────────────────────────────────────────────────
// Hatırlatıcı zamanı ISO (yerel saat diliminden UTC'ye çevrilmiş). Tekrar: yok | gunluk | hafta_ici | haftalik | aylik.
// Zamanı gelen hatırlatıcıyı zamanlayici.ts bildirir; tekrarlıysa bir sonraki zamana kurar (hesap: tekrar.ts).
// Bildirilmiş tek seferlikler 12 saat görünür kalır, sonra listelerden düşer.
import { veritabani, simdi, meta, metaYaz, yerelGun } from './vt.js';
import { yayinla } from './olaylar.js';
import { sonrakiZaman } from './tekrar.js';
import { ayarlar } from './ayarlar.js';
import { hafizaEkle } from './hafiza/depo.js';
import { yapilacakGorunumu } from '../shared/yapilacaklar.js';
import type { Hatirlatici, Gorev, Oneri } from '../shared/tipler.js';

type S = Record<string, unknown>;
const hat = (s: S): Hatirlatici => ({ id: Number(s.id), baslik: String(s.baslik), aciklama: (s.aciklama as string) || undefined, zaman: String(s.zaman), tekrar: String(s.tekrar), durum: String(s.durum), onem: Number(s.onem) });
// `tamamlanma` yalnız dolu satırda yazılır (açık görevin biçimi eskisiyle aynı kalır).
const gor = (s: S): Gorev => ({ id: Number(s.id), baslik: String(s.baslik), aciklama: (s.aciklama as string) || undefined, durum: String(s.durum), sonTarih: (s.son_tarih as string) || undefined, proje: (s.proje as string) || undefined, oncelik: Number(s.oncelik), ...(s.tamamlanma ? { tamamlanma: String(s.tamamlanma) } : {}) });
const one = (s: S): Oneri => ({ id: Number(s.id), tur: s.tur as Oneri['tur'], baslik: String(s.baslik), icerik: String(s.icerik), durum: String(s.durum), olusturma: String(s.olusturma) });

const degisti = (neden: string) => yayinla('kokpit:veri-degisti', { neden });

// ── Hatırlatıcı ──────────────────────────────────────────────────────────────────────────────────────────────
export function hatirlaticiEkle(h: { baslik: string; zaman: string; aciklama?: string; tekrar?: string; onem?: number; kaynak?: string }): Hatirlatici {
  const z = new Date(h.zaman);
  if (Number.isNaN(z.getTime())) throw new Error(`Geçersiz zaman: ${h.zaman}`);
  const r = veritabani()
    .prepare('INSERT INTO hatirlaticilar(baslik, aciklama, zaman, tekrar, onem, kaynak, olusturma, gun) VALUES(?,?,?,?,?,?,?,?)')
    .run(h.baslik.slice(0, 200), h.aciklama ?? null, z.toISOString(), h.tekrar ?? 'yok', h.onem ?? 3, h.kaynak ?? null, simdi(), z.getDate());
  degisti('hatirlatici');
  return hatirlaticiGetir(Number(r.lastInsertRowid))!;
}
export function hatirlaticiGetir(id: number): Hatirlatici | null {
  const s = veritabani().prepare('SELECT * FROM hatirlaticilar WHERE id = ?').get(id) as S | undefined;
  return s ? hat(s) : null;
}
/** Aylık tekrarın asıl günü (yoksa zamanın günü kullanılır). */
const capaGun = (id: number) => Number((veritabani().prepare('SELECT gun FROM hatirlaticilar WHERE id = ?').get(id) as S | undefined)?.gun) || null;

const BILDIRILMIS_GORUNUR_SAAT = 12;
export function hatirlaticilar(o: { durum?: string; sonraki?: number; limit?: number } = {}): Hatirlatici[] {
  const k: string[] = [];
  const p: (string | number)[] = [];
  const t = Date.now();
  if (o.durum) { k.push('durum = ?'); p.push(o.durum); }
  else {
    // Bildirilmiş tek seferlik hatırlatıcı 12 saat sonra listeden düşer: eskiden sonsuza dek kalıp kokpitin ilk 12'sini
    // dolduruyor, kartı hep "acil" tutuyor, planlayıcıya eksi saat veriyor ve sabah özetine giriyordu.
    k.push("(durum = 'bekliyor' OR (durum = 'gonderildi' AND COALESCE(son_bildirim, zaman) >= ?))");
    p.push(new Date(t - BILDIRILMIS_GORUNUR_SAAT * 3600_000).toISOString());
  }
  // "Önümüzdeki N saat": alt sınır da var (en çok 1 saat geriye; eskiler "bugün" sayılmasın).
  if (o.sonraki) { k.push('zaman >= ? AND zaman <= ?'); p.push(new Date(t - 3600_000).toISOString(), new Date(t + o.sonraki * 3600_000).toISOString()); }
  p.push(o.limit ?? 50);
  // Yaklaşanlar önce (en yakını üstte), bildirilmişler sonda.
  return (veritabani().prepare(`SELECT * FROM hatirlaticilar WHERE ${k.join(' AND ')} ORDER BY (durum != 'bekliyor'), zaman LIMIT ?`).all(...p) as S[]).map(hat);
}
export function hatirlaticiGuncelle(id: number, d: { durum?: string; zaman?: string; baslik?: string; aciklama?: string }): Hatirlatici | null {
  const e = hatirlaticiGetir(id);
  if (!e) return null;
  let zaman = d.zaman ? new Date(d.zaman).toISOString() : e.zaman;
  let durum = d.durum ?? (d.zaman ? 'bekliyor' : e.durum);
  let gun = d.zaman ? new Date(zaman).getDate() : capaGun(id);
  // Tekrarlayan hatırlatıcıda "tamam" seriyi bitirmez: bu seferlik geçer, sonraki zamana kurulur ("iptal" bitirir).
  if (durum === 'tamam' && e.tekrar !== 'yok') {
    const sonraki = sonrakiZaman(zaman, e.tekrar, gun);
    if (sonraki) { zaman = sonraki; durum = 'bekliyor'; }
  }
  gun ??= new Date(zaman).getDate();
  veritabani().prepare('UPDATE hatirlaticilar SET durum=?, zaman=?, baslik=?, aciklama=?, gun=? WHERE id=?').run(durum, zaman, d.baslik ?? e.baslik, d.aciklama ?? e.aciklama ?? null, gun, id);
  degisti('hatirlatici');
  return hatirlaticiGetir(id);
}
export function zamaniGelenler(): Hatirlatici[] {
  return (veritabani().prepare("SELECT * FROM hatirlaticilar WHERE durum = 'bekliyor' AND zaman <= ? ORDER BY zaman").all(simdi()) as S[]).map(hat);
}
export { sonrakiZaman };
export function hatirlaticiTetiklendi(h: Hatirlatici): void {
  const sonraki = sonrakiZaman(h.zaman, h.tekrar, capaGun(h.id));
  if (sonraki) veritabani().prepare("UPDATE hatirlaticilar SET zaman = ?, son_bildirim = ?, durum = 'bekliyor' WHERE id = ?").run(sonraki, simdi(), h.id);
  else veritabani().prepare("UPDATE hatirlaticilar SET durum = 'gonderildi', son_bildirim = ? WHERE id = ?").run(simdi(), h.id);
  degisti('hatirlatici');
}

// ── Görev (plan) ─────────────────────────────────────────────────────────────────────────────────────────────
export function gorevEkle(g: { baslik: string; aciklama?: string; sonTarih?: string; proje?: string; oncelik?: number }): Gorev {
  const r = veritabani()
    .prepare('INSERT INTO gorevler(baslik, aciklama, son_tarih, proje, oncelik, olusturma) VALUES(?,?,?,?,?,?)')
    .run(g.baslik.slice(0, 200), g.aciklama ?? null, g.sonTarih ? new Date(g.sonTarih).toISOString() : null, g.proje ?? null, g.oncelik ?? 3, simdi());
  degisti('gorev');
  return gor(veritabani().prepare('SELECT * FROM gorevler WHERE id = ?').get(Number(r.lastInsertRowid)) as S);
}
export function gorevler(o: { durum?: string; proje?: string; limit?: number } = {}): Gorev[] {
  const k = ['durum = ?'];
  const p: (string | number)[] = [o.durum ?? 'acik'];
  if (o.proje) { k.push('proje = ?'); p.push(o.proje); }
  p.push(o.limit ?? 50);
  return (veritabani().prepare(`SELECT * FROM gorevler WHERE ${k.join(' AND ')} ORDER BY oncelik DESC, COALESCE(son_tarih, '9999') LIMIT ?`).all(...p) as S[]).map(gor);
}
/** Yerel gece yarısı (günün başlangıcı): "bugün tamamlananlar" ve geri alma penceresi bununla ölçülür (UTC değil). */
const yerelGunBasi = (d: Date): Date => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/**
 * Yapılacak işaretlenince silinmez (0.11 G4): durum "tamam" olur, kartta üstü çizili kalır. İşareti kaldırmak (durum "acik") YALNIZ aynı
 * yerel gün içinde geçerlidir: ertesi gün dünün tamamlananları hafızaya "Tamamlananlar" olarak yazılır (gunDonumu), sonradan açmak o kaydı
 * yalana çıkarırdı — istek yok sayılır (durum dışındaki düzeltmeler uygulanır). Tamamlanma anında Gizli mod açıksa madde `gizli` işaretlenir
 * ve hafızaya girmez; sonradan Gizli dışında yeniden işaretlenirse işaret yeniden belirlenir.
 */
export function gorevGuncelle(id: number, d: { durum?: string; baslik?: string; aciklama?: string; sonTarih?: string; oncelik?: number }): Gorev | null {
  const e = veritabani().prepare('SELECT * FROM gorevler WHERE id = ?').get(id) as S | undefined;
  if (!e) return null;
  const g = gor(e);
  let durum = d.durum ?? g.durum;
  const onceki = (e.tamamlanma as string | null) ?? null;
  if (g.durum === 'tamam' && durum === 'acik' && !(onceki && onceki >= yerelGunBasi(new Date()).toISOString())) durum = g.durum;
  // Tamamlanma yalnız durum DEĞİŞİNCE yazılır/silinir (başlık düzeltmek tamamlanma tarihini silmesin).
  const degisen = durum !== g.durum;
  const tamamlanma = !degisen ? onceki : durum === 'tamam' ? simdi() : null;
  const gizli = !degisen ? Number(e.gizli ?? 0) : durum === 'tamam' && ayarlar().yerel.gizliMod === true ? 1 : 0;
  veritabani()
    .prepare('UPDATE gorevler SET durum=?, baslik=?, aciklama=?, son_tarih=?, oncelik=?, tamamlanma=?, gizli=? WHERE id=?')
    .run(durum, d.baslik ?? g.baslik, d.aciklama ?? g.aciklama ?? null, d.sonTarih ? new Date(d.sonTarih).toISOString() : g.sonTarih ?? null, d.oncelik ?? g.oncelik, tamamlanma, gizli, id);
  // 0.14 T26: saatli yapılacağın hatırlatıcısı iş bitince boşuna çalmasın (yalnız `yapilacak:<id>` kaynaklı, hâlâ bekleyen). Geri alınca yeniden kurulmaz.
  if (degisen && durum === 'tamam' && veritabani().prepare("UPDATE hatirlaticilar SET durum = 'iptal' WHERE kaynak = ? AND durum = 'bekliyor'").run(`yapilacak:${id}`).changes) degisti('hatirlatici');
  degisti('gorev');
  return gor(veritabani().prepare('SELECT * FROM gorevler WHERE id = ?').get(id) as S);
}

/**
 * Çentik panelinin Yapılacaklar sayfasından yeni madde (0.14 T26): `gorevler` tablosuna yazılır (kokpit kartı ve ajan araçlarıyla aynı kayıt). `saat` ("SS:DD", yerel)
 * verilirse bugünün o saatine (geçmişse ertesi güne) bir hatırlatıcı da kurulur — zamanı gelince mevcut hatırlatıcı hattı (zamanlayıcı → bildirim ve çentik)
 * çalar; görevin son tarihi aynı an olur. Hatırlatıcının `kaynak`ı `yapilacak:<görev>`: madde işaretlenince hatırlatıcı iptal edilir (gorevGuncelle).
 */
export function yapilacakEkle(g: { baslik: string; saat?: string | null }, an: Date = new Date()): { gorev: Gorev; hatirlatici: Hatirlatici | null } {
  if (!g.saat) return { gorev: gorevEkle({ baslik: g.baslik }), hatirlatici: null };
  const [s, d] = g.saat.split(':').map(Number);
  const zaman = new Date(an.getFullYear(), an.getMonth(), an.getDate(), s, d, 0, 0);
  if (zaman.getTime() <= an.getTime()) zaman.setDate(zaman.getDate() + 1);
  const gorev = gorevEkle({ baslik: g.baslik, sonTarih: zaman.toISOString() });
  return { gorev, hatirlatici: hatirlaticiEkle({ baslik: g.baslik, zaman: zaman.toISOString(), kaynak: `yapilacak:${gorev.id}` }) };
}

/**
 * Yerel bugünün başından beri tamamlananlar, tamamlanma sırasıyla (eskiden yeniye). `limit` en SON tamamlananları tutar. Önceki günlerin
 * tamamlananı burada yoktur: dün gece yarısından sonra hafızada "Tamamlananlar · <gün>" kaydı olur (gunDonumu). `gizliHaric`: Gizli açıkken
 * tamamlananlar çıkar — bulut yapay zekâya giden yollar (gorev_listele) bunu ister; yerel arayüz hepsini görür.
 */
export function bugunTamamlananlar(an: Date, o: { proje?: string; limit?: number; gizliHaric?: boolean } = {}): Gorev[] {
  const k = ["durum = 'tamam'", 'tamamlanma >= ?'];
  const p: (string | number)[] = [yerelGunBasi(an).toISOString()];
  if (o.proje) { k.push('proje = ?'); p.push(o.proje); }
  if (o.gizliHaric) k.push('COALESCE(gizli, 0) = 0');
  p.push(o.limit ?? 50);
  return (veritabani().prepare(`SELECT * FROM (SELECT * FROM gorevler WHERE ${k.join(' AND ')} ORDER BY tamamlanma DESC, id DESC LIMIT ?) ORDER BY tamamlanma, id`).all(...p) as S[]).map(gor);
}

/**
 * Kokpit "Yapılacaklar" kartının listesi: önce açıklar (öncelik, son tarih), sonra yerel bugünün başından beri tamamlananlar
 * (tamamlanma artan). `limit` toplamdır: sığmayınca işaretlilere en az yarısı ayrılır (shared/yapilacaklar.ts yapilacakGorunumu) —
 * işaretlenen madde, açık iş çok diye kaybolmaz.
 */
export function kokpitYapilacaklari(an: Date, limit = 12): Gorev[] {
  const yer = Math.max(0, Math.floor(limit));
  return yapilacakGorunumu([...gorevler({ limit: yer }), ...bugunTamamlananlar(an, { limit: yer })], yer).gorunen;
}

// ── Gün dönümü: dünün tamamlananları → günde TEK hafıza kaydı ────────────────────────────────────────────────
const GUN_DONUMU_GERI = 14; // uygulama haftalarca kapalı kalsa da en çok son iki haftanın günleri yazılır
/** Özelliğin ilk çalıştığı yerel gün (YYYY-AA-GG): 0.10'dan kalan tamamlananlar bu günden önce olduğu için hafızaya yazılmaz. */
const BASLANGIC_ANAHTARI = 'yapildi-baslangic';
const AY_ADI = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
/** "2026-10-27" → "27 Eki". */
const gunEtiketi = (gun: string) => `${Number(gun.slice(8, 10))} ${AY_ADI[Number(gun.slice(5, 7)) - 1]}`;

/**
 * Yerel gece yarısından sonraki ilk tikte (ya da açılışta) çağrılır: bugünden ÖNCE tamamlanıp henüz yazılmamış her gün için tek hafıza
 * kaydı — tur `olay`, başlık "Tamamlananlar · 27 Eki", gövde "- <başlık>" satırları (tamamlanma sırasıyla), etiket `yapildi`. Madde
 * başına kayıt yok: hafıza şişmez, işaret aç/kapat titremesi kayıt bırakmaz; kayıt gün bitince yazıldığı için aynı gün geri alma serbesttir.
 * Meta `yapildi-kaydi:<YYYY-AA-GG>` günü işlenmiş sayar (ikinci çağrı yazmaz). Gizli açıkken tamamlanan madde kayda girmez (hafıza bulut
 * bağlamına girer); bir günün hepsi Gizli ise kayıt yazılmaz ama gün işlenmiş sayılır. Dönen `gun`: yazılan son gün.
 * İLK ÇALIŞMADA GEÇMİŞ DOLDURULMAZ: ilk çağrı başlangıç gününü (yerel bugün) yazar ve ondan önceki günler hiçbir zaman kayda geçmez —
 * yükseltilen profildeki 0.10 tamamlananları "Son öğrendiklerim"i ve bulut bağlamını doldurmasın. Başlangıç günündekiler ertesi gün yazılır.
 */
export function gunDonumu(an: Date): { yazildi: boolean; gun?: string } {
  const sinir = yerelGunBasi(an);
  const alt = new Date(sinir);
  alt.setDate(alt.getDate() - GUN_DONUMU_GERI);
  let basla = meta(BASLANGIC_ANAHTARI);
  if (!basla) { basla = yerelGun(an); metaYaz(BASLANGIC_ANAHTARI, basla); }
  // Yerel gün başı: 'YYYY-AA-GG' parçalanır (new Date('YYYY-AA-GG') UTC gece yarısı okur, Türkiye'de bir gün kayar).
  const [by, bm, bd] = basla.split('-').map(Number);
  const ilk = new Date(by, bm - 1, bd);
  if (ilk > alt) alt.setTime(ilk.getTime());
  const vt = veritabani();
  const satirlar = vt.prepare("SELECT baslik, tamamlanma, gizli FROM gorevler WHERE durum = 'tamam' AND tamamlanma >= ? AND tamamlanma < ? ORDER BY tamamlanma, id")
    .all(alt.toISOString(), sinir.toISOString()) as S[];
  const gunler = new Map<string, S[]>();
  for (const s of satirlar) {
    const gun = yerelGun(String(s.tamamlanma));
    const l = gunler.get(gun);
    if (l) l.push(s); else gunler.set(gun, [s]);
  }
  let son: string | undefined;
  let islenen = false;
  for (const [gun, l] of gunler) {
    const anahtar = `yapildi-kaydi:${gun}`;
    if (meta(anahtar)) continue;
    const acik = l.filter((s) => Number(s.gizli ?? 0) !== 1);
    // Kayıt ve gün anahtarı birlikte yazılır ya da hiç (araya giren hata ikinci bir kayda yol açmasın).
    vt.exec('SAVEPOINT yapildi');
    try {
      if (acik.length) {
        const satir = acik.map((s) => `- ${String(s.baslik).replace(/\s+/g, ' ').trim()}`);
        const icerik: string[] = [];
        let uzunluk = 0;
        for (const x of satir) {
          if (uzunluk + x.length + 1 > 3900) { icerik.push(`- … ve ${satir.length - icerik.length} madde daha`); break; }
          icerik.push(x);
          uzunluk += x.length + 1;
        }
        const [y, a, g] = gun.split('-').map(Number);
        hafizaEkle({ tur: 'olay', baslik: `Tamamlananlar · ${gunEtiketi(gun)}`, icerik: icerik.join('\n'), etiketler: ['yapildi'], onem: 2, kaynak: `yapilacaklar:${gun}`, olayTarihi: new Date(y, a - 1, g, 12).toISOString() });
      }
      metaYaz(anahtar, new Date().toISOString());
      vt.exec('RELEASE yapildi');
    } catch (e) {
      vt.exec('ROLLBACK TO yapildi');
      vt.exec('RELEASE yapildi');
      throw e;
    }
    islenen = true;
    if (acik.length) son = gun;
  }
  if (islenen) degisti('gorev'); // dünün işaretlileri karttan kalktı: açık pencereler tazelensin
  return son ? { yazildi: true, gun: son } : { yazildi: false };
}

// ── Öneri / dikkat ───────────────────────────────────────────────────────────────────────────────────────────
export function oneriEkle(o: { tur: Oneri['tur']; baslik: string; icerik?: string; gecerlilikSaat?: number }): Oneri {
  const vt = veritabani();
  // Aynı başlıklı açık öneri varsa yinelenmez.
  const var_ = vt.prepare("SELECT * FROM oneriler WHERE baslik = ? AND durum != 'kapatildi'").get(o.baslik) as S | undefined;
  if (var_) return one(var_);
  const r = vt
    .prepare('INSERT INTO oneriler(tur, baslik, icerik, olusturma, gecerlilik) VALUES(?,?,?,?,?)')
    .run(o.tur, o.baslik.slice(0, 160), (o.icerik ?? '').slice(0, 1200), simdi(), o.gecerlilikSaat ? new Date(Date.now() + o.gecerlilikSaat * 3600_000).toISOString() : null);
  degisti('oneri');
  return one(vt.prepare('SELECT * FROM oneriler WHERE id = ?').get(Number(r.lastInsertRowid)) as S);
}
export function oneriler(limit = 12): Oneri[] {
  return (veritabani()
    .prepare("SELECT * FROM oneriler WHERE durum != 'kapatildi' AND (gecerlilik IS NULL OR gecerlilik > ?) ORDER BY id DESC LIMIT ?")
    .all(simdi(), limit) as S[]).map(one);
}
export function oneriKapat(id: number): void {
  veritabani().prepare("UPDATE oneriler SET durum = 'kapatildi' WHERE id = ?").run(id);
  degisti('oneri');
}
