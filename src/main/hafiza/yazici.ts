// ── Hafıza yazıcı (arka plan) ────────────────────────────────────────────────────────────────────────────────
// Sorulan her şey hafızaya kaydedilir; ama her hafıza sürekli eklenip token harcanmaz, kayıt doğru atıf,
// id, tarih ve kelimeyle bulunur. → Konuşmanın TAMAMI zaten tam metin dizinli saklanır (mesajlar). Bu yazıcı her
// turdan sonra yardımcı modelle (ucuz) kalıcı değeri olan ÖZÜ çıkarır ve hafıza kayıtlarına işler. Yinelenmeyi
// önlemek için ilgili mevcut kayıtlar da verilir: model ekler, günceller ya da geçersizi siler.
import { hafizaAra, hafizaEkle, hafizaGuncelle, hafizaArsivle, hafizaListesi, surumuArsivle, yakinKayitBul, sabitTavaniniUygula } from './depo.js';
import { acikSozler, ozKonusmaMi, modelIddiasiMi, celisirMi, ayniTercihMi, BENZER_ATLA, BENZER_BIRLESTIR } from '../../shared/hafiza-kurali.ts';
import { kaynakBirlestir, kullaniciKaynakliMi } from '../../shared/hafiza-kaynak.js';
import { PROAKTIF_HAFIZA_ISARETI } from '../../shared/ic-talimat.ts';
import { yardimciJson } from '../motor/secici.js';
import { tekMotorYolu, yerelBaglamAsimiMi } from '../motor/yerel.js';
import { yayinla } from '../olaylar.js';
import { yerelGun, veritabani } from '../vt.js';
import { kaynakBelgesiSilindiMi } from '../belge-depo.js';
import type { HafizaTuru } from '../../shared/tipler.js';
import { sabitYol, type SabitYol } from '../../shared/tek-motor.js';
import { yerelGirdiButcesi } from '../../shared/yerel-butce.js';

const SISTEM = `Sen Fuber'in hafıza yazıcısısın. Bir konuşma parçasından kullanıcı hakkında KALICI DEĞERİ OLAN bilgileri çıkarır, hafıza kayıtlarına işlersin.
Kaydet: kullanıcının kim olduğu, işi, ilişkileri (kişiler + rolleri), projeleri ve durumları, kararlar, tarihler/olaylar, tercihler ve çalışma biçimi, kurallar ("bana hep … yap"), önemli sayılar.
KAYDETME: selamlaşma, geçici sorular, Fuber'in kendi önerileri (kullanıcı kabul etmediyse), şifre/anahtar/kart/kimlik numarası, zaten mevcut kayıtta aynen olan bilgi.
Her kayıt TEK BAŞINA anlaşılır olmalı ve tarih içermeli (bugünün tarihini kullan). Türler: kullanici, proje, tercih, kisi, olay, bilgi, kural, gorev.
Göreli zamanları ("yarın", "cuma", "haftaya") çözerken ÖNCE Fuber'in yanıtında yazdığı kesin tarihi esas al (hatırlatıcıyı o tarihe kurmuştur). Yanıtta yoksa "Şimdi"ye göre çöz; gece 00:00–05:00 arasında "yarın" takvimde BUGÜNÜ kasteder. Emin değilsen göreli ifadeyi aynen yaz, tarih uydurma.
Mevcut kayıtla aynı konuysa "guncelle" (id ile, birleştirilmiş tam içerik ver); çelişen/geçersizleşen kayıt için "sil". Yeni bir kayıt eklemek yerine mevcut kaydı güncellemeyi tercih et.
YALNIZ kullanıcının söylediğini kaydet: Fuber'in yaptığı hesaplamalar, tahminleri, yetenekleri ya da kısıtları ("aracım yok", "erişimim yok") kayıt DEĞİLDİR.
JSON: {"islemler":[{"islem":"ekle"|"guncelle"|"sil","id?":number,"tur":"...","baslik":"...","icerik":"...","etiketler":["..."],"onem":1-5,"olay_tarihi?":"ISO"}]}
Kaydedilecek bir şey yoksa {"islemler":[]}.`;

interface Islem { islem: 'ekle' | 'guncelle' | 'sil'; id?: number; tur?: HafizaTuru; baslik?: string; icerik?: string; etiketler?: string[]; onem?: number; sabit?: boolean; olay_tarihi?: string }

const TURLER = new Set(['kullanici', 'proje', 'tercih', 'kisi', 'olay', 'bilgi', 'kural', 'gorev']);
/** 0.12 cila düzeltme turu 1 (I-1): yerel yolda yanıt payı (token) — yuvaya (≈ 4096) sistem istemiyle birlikte sığsın. */
const YEREL_CIKIS = 1200;

/** Yerel yolda girdinin üç parçasına (ilgili kayıtlar · kullanıcı · Fuber) düşen karakter; bulutta sınır yok (bugünkü kesimler). */
export function yazimSinirlari(yerel: boolean): { ilgili: number; kullanici: number; asistan: number; cikis: number } {
  if (!yerel) return { ilgili: Infinity, kullanici: 6000, asistan: 4000, cikis: 2500 };
  const butce = yerelGirdiButcesi(SISTEM, YEREL_CIKIS) - 300; // tarih satırları ve başlıklar
  return { ilgili: Math.floor(butce * 0.3), kullanici: Math.floor(butce * 0.4), asistan: Math.floor(butce * 0.3), cikis: YEREL_CIKIS };
}
let kuyruk: Promise<void> = Promise.resolve();

/** `sabit`: parçayı üreten turun yolu (ajan/dongu.ts; başlık ve özet işleriyle aynı) — son bütün dal incelemesi K-5: yalnız-yerel turunun
 *  ertelenen hafıza işi, bekleme süresinde Fuber seçilse de buluta gitmez (yerel sunucu kapandıysa iş atlanır); bulutta başlayan turunki arada
 *  yerele geçildiyse yapılmaz (shared/tek-motor.ts sabitYol). Turdan bağımsız yazımlar (içe aktarma, kurulum) bugünkü yolu kullanır. */
export function hafizaYaz(parca: { kullanici: string; asistan: string; kaynak: string }, sabit?: SabitYol): void {
  // H5 tur 2: kapı tek kuraldır (yol). "Yalnız bu bilgisayar" seçili ve bulut motoru yokken (hesap onay bekliyor) yol 'yerel'dir — hafıza
  // da yerelde yazılır (eskiden "hazır bulut motoru" kapısı yüzünden sessizce atlanıyordu; hesap aktifken aynı iş yerelde yapılıyordu).
  if (tekMotorYolu() === 'yok') return;
  // 11 Kas analizi #7: kullanıcının hiçbir şey yazmadığı (kendiliğinden) tur yazıcıya gitmez — ajan/dongu.ts zaten çağırmaz; bu ikinci kapı.
  if (parca.kullanici.trim() === PROAKTIF_HAFIZA_ISARETI) return;
  if ((parca.kullanici + parca.asistan).trim().length < 24) return;
  // Düzeltme turu 2 (yeniden inceleme N-5): hata yutulmaz — günlüğe yazılır (kuyruk sürer).
  kuyruk = kuyruk.then(() => isle(parca, sabit)).catch((e) => { console.warn('[hafıza] yazılamadı:', (e as Error)?.message ?? e); });
}

/** Değişiklik sayacı (yayın için). */
interface Sayac { n: number }

/**
 * 11 Kas analizi #2–#4: kullanıcının AÇIK sözleri kural tabanlı yazılır (modelden geçmez; shared/hafiza-kurali.ts acikSozler). Tercih ÇEKİRDEĞE
 * girer (sabit) ve aynı konudaki eski tercihin yerini alır (yeni söz kazanır; eski sürüm arşivde). Olgu ("aklında olsun") olağan kayıttır.
 * Kaynak "kullanici": bağlamda "(sen söyledin)" görünür, model onu onaysız silemez/değiştiremez.
 */
export function acikSozleriYaz(kullanici: string, kaynak: string, s: Sayac = { n: 0 }): Sayac {
  for (const soz of acikSozler(kullanici)) {
    const kaynakTam = kaynakBirlestir('kullanici', kaynak);
    const yakin = yakinKayitBul(soz, soz.sabit ? { sabit: true } : {});
    if (yakin && yakin.benzerlik >= BENZER_ATLA) { hafizaGuncelle(yakin.kayit.id, { kaynak: kaynakTam }); continue; }
    // Aynı konudaki eski söz: yakın kayıt ya da (tercihte) aynı konulu herhangi bir çekirdek tercihi ("5 madde" → "3 madde").
    const eskiTercih = soz.tur === 'tercih' ? hafizaListesi({ sabit: true, limit: 50 }).find((h) => h.tur === 'tercih' && ayniTercihMi(h, soz)) : undefined;
    const hedef = eskiTercih ?? (yakin && (yakin.benzerlik >= (soz.sabit ? 0.6 : BENZER_BIRLESTIR) || celisirMi(yakin.kayit, soz)) ? yakin.kayit : undefined);
    if (hedef) {
      surumuArsivle(hedef);
      hafizaGuncelle(hedef.id, { tur: soz.tur, baslik: soz.baslik, icerik: soz.icerik, onem: soz.onem, sabit: soz.sabit || hedef.sabit, kaynak: kaynakTam });
    } else {
      hafizaEkle({ tur: soz.tur, baslik: soz.baslik, icerik: soz.icerik, onem: soz.onem, sabit: soz.sabit, kaynak: kaynakTam, etiketler: soz.sabit ? ['tercih'] : [] });
    }
    s.n++;
  }
  if (s.n) sabitTavaniniUygula();
  return s;
}

/** Model önerisinin kod denetimi (11 Kas analizi #1–#3, #12): öz-konuşma ve modelin kendi sayı iddiası reddedilir; `sabit` yok sayılır (çekirdek
 *  yalnız kullanıcının açık sözünden); yakın kopya eklenmez — mevcut kayıt güncellenir (yeni söz kazanır, eski sürüm arşivde); kullanıcıdan gelen
 *  kayda model dokunmaz. */
function modelEklemesi(i: Islem, parca: { kullanici: string; kaynak: string }, s: Sayac): void {
  const yeni = { tur: i.tur as HafizaTuru, baslik: String(i.baslik), icerik: String(i.icerik) };
  if (ozKonusmaMi(`${yeni.baslik}: ${yeni.icerik}`) || modelIddiasiMi(yeni.icerik, parca.kullanici)) return;
  const yakin = yakinKayitBul(yeni);
  if (yakin && yakin.benzerlik >= BENZER_ATLA) return;
  if (yakin && (yakin.benzerlik >= BENZER_BIRLESTIR || celisirMi(yakin.kayit, yeni))) {
    if (kullaniciKaynakliMi(yakin.kayit.kaynak)) return; // kullanıcının kendi sözü modelin özetiyle ezilmez
    surumuArsivle(yakin.kayit);
    hafizaGuncelle(yakin.kayit.id, { baslik: yeni.baslik, icerik: yeni.icerik, etiketler: i.etiketler, onem: i.onem, olayTarihi: i.olay_tarihi, kaynak: parca.kaynak });
  } else {
    hafizaEkle({ ...yeni, etiketler: i.etiketler, onem: i.onem, sabit: false, kaynak: parca.kaynak, olayTarihi: i.olay_tarihi });
  }
  s.n++;
}

async function isle(parca: { kullanici: string; asistan: string; kaynak: string }, sabit?: SabitYol): Promise<void> {
  // Kaynağı bu arada silinen bir belgeyse (Hafıza → Belgeler) iş bırakılır: silinen belgeden kayıt düşmesin (Görev 20b). Model
  // çağrısından ÖNCE ve SONRA sorulur; sonrasındaki yazımlar eşzamanlıdır (araya silme giremez).
  if (kaynakBelgesiSilindiMi(veritabani(), parca.kaynak)) return;
  const s: Sayac = { n: 0 };
  // Açık sözler önce ve modelden bağımsız (yerelde de, bulutta da).
  acikSozleriYaz(parca.kullanici, parca.kaynak, s);
  // 11 Kas analizi #3: yerel yolda MODEL YAZICISI YOK — küçük model kendi yanlış cevaplarını, uydurmalarını ve "aracım yok" cümlelerini olgu diye
  // kaydediyordu; döngü kendini besliyordu. Yerelde yalnız kural tabanlı açık sözler yazılır; geri kalanı ham konuşma araması zaten bulur.
  if (sabitYol(sabit, tekMotorYolu()) === 'yerel') {
    if (s.n) yayinla('hafiza:degisti', { adet: s.n });
    return;
  }
  // Düzeltme turu 1 (I-1): yerel yolda girdi yerel sunucunun yuvasına sığacak kadar (6.000 + 4.000 karakter + kayıtlar + sistem istemi
  // ≈ 5.000 token sığmıyordu; sunucu reddediyor, hafıza hiç yazılmıyordu). İlgili kayıtlar bütün hâlde eklenir, sığmayan alınmaz (model
  // görmediği kaydı güncelleyemez/silemez: aşağıdaki denetim yalnız gösterilenlere bakar).
  // Sınır, çağrının GERÇEKTEN gideceği yola göre (K-5: turun sabit yolu; turdan bağımsız yazımlarda bugünkü yol).
  const sinir = yazimSinirlari(sabitYol(sabit, tekMotorYolu()) === 'yerel');
  const adaylar = hafizaAra({ sorgu: `${parca.kullanici} ${parca.asistan.slice(0, 600)}`, limit: 10 });
  /** Girdi ve modelin görebildiği kayıtlar; `oran` < 1: bağlam aşımından sonra yarıya indirilmiş hâl (düzeltme turu 2, a). */
  const kur = (oran: number) => {
    const ilgili: typeof adaylar = [];
    let ilgiliUzunluk = 0;
    for (const h of adaylar) {
      const satir = `[${h.id}] (${h.tur}${h.sabit ? ', sabit' : ''}) ${h.baslik}: ${h.icerik}`;
      if (ilgiliUzunluk + satir.length + 1 > sinir.ilgili * oran) break;
      ilgili.push(h);
      ilgiliUzunluk += satir.length + 1;
    }
    const d = new Date();
    const girdi = `Bugün: ${yerelGun(d)} · Şimdi: ${d.toLocaleString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
İlgili mevcut kayıtlar:
${ilgili.map((h) => `[${h.id}] (${h.tur}${h.sabit ? ', sabit' : ''}) ${h.baslik}: ${h.icerik}`).join('\n') || '(yok)'}

KONUŞMA PARÇASI
Kullanıcı: ${parca.kullanici.slice(0, Math.floor(sinir.kullanici * oran))}
Fuber: ${parca.asistan.slice(0, Math.floor(sinir.asistan * oran))}`;
    return { ilgili, girdi };
  };
  let { ilgili, girdi } = kur(1);
  let j: { islemler?: Islem[] } | null;
  try {
    j = await yardimciJson<{ islemler?: Islem[] }>(SISTEM, girdi, 'hafiza-yazici', sinir.cikis, sabit);
  } catch (e) {
    // Düzeltme turu 2 (a): yerel bağlam aşımında girdi yarıya indirilip BİR kez yeniden denenir (reddedilen istek sunucuda bedavadır).
    if (!yerelBaglamAsimiMi(e)) throw e;
    ({ ilgili, girdi } = kur(0.5));
    j = await yardimciJson<{ islemler?: Islem[] }>(SISTEM, girdi, 'hafiza-yazici', sinir.cikis, sabit);
  }
  if (kaynakBelgesiSilindiMi(veritabani(), parca.kaynak)) return;
  for (const i of j?.islemler ?? []) {
    try {
      if (i.islem === 'ekle' && i.baslik && i.icerik && TURLER.has(String(i.tur))) {
        modelEklemesi(i, parca, s);
      } else if (i.islem === 'guncelle' && i.id && ilgili.some((h) => h.id === i.id && !kullaniciKaynakliMi(h.kaynak))) {
        // `sabit` modelden alınmaz (kaydın bugünkü hâli kalır); yeni içerik de öz-konuşma/iddia süzgecinden geçer; eski sürüm arşivde.
        if (i.icerik && (ozKonusmaMi(`${i.baslik ?? ''}: ${i.icerik}`) || modelIddiasiMi(i.icerik, parca.kullanici))) continue;
        const eski = ilgili.find((h) => h.id === i.id)!;
        if (i.icerik && i.icerik !== eski.icerik) surumuArsivle(eski);
        hafizaGuncelle(i.id, { baslik: i.baslik, icerik: i.icerik, etiketler: i.etiketler, onem: i.onem, tur: TURLER.has(String(i.tur)) ? (i.tur as HafizaTuru) : undefined, kaynak: parca.kaynak });
        s.n++;
      } else if (i.islem === 'sil' && i.id && ilgili.some((h) => h.id === i.id && !h.sabit && !kullaniciKaynakliMi(h.kaynak))) {
        // Silmek yerine arşiv: modelin yanlış silmesi geri alınabilir kalır.
        if (hafizaArsivle(i.id)) s.n++;
      }
    } catch { /* tek kayıt hatası diğerlerini durdurmaz */ }
  }
  if (s.n) yayinla('hafiza:degisti', { adet: s.n });
}

/** Bekleyen yazımların bitmesini bekle (testler ve kapanış). */
export function hafizaYaziminiBekle(): Promise<void> { return kuyruk; }
