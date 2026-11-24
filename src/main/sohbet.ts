// ── Sohbet deposu ────────────────────────────────────────────────────────────────────────────────────────────
// Mesajlar sağlayıcıdan bağımsız bloklarla saklanır (motor/tipler.ts Blok). Araç sonuçları ayrı "user" mesajı
// olarak durur (API sözleşmesi), arayüzde ise ait oldukları araç kartının içine birleştirilir.
// "Ana" sohbet (tur='ana') her zaman vardır: Fuber'in kendiliğinden yazdığı mesajlar (sabah özeti, hatırlatıcı,
// merak sorusu) oraya düşer; kokpitteki sohbet paneli varsayılan olarak onu gösterir.
import { veritabani, simdi } from './vt.js';
import { mesajDizinle } from './hafiza/depo.js';
import { aracBul } from './ajan/araclar/kayit.js';
import { kullaniciYazdiMi, mesajlaArsivdenCikar } from './sohbet-temizlik.js';
import type { Blok } from './motor/tipler.js';
import { ayarlar } from './ayarlar.js';
import { aracKartiOzeti } from '../shared/is-dili.js';
import { bloklardaYolGuncelle, ccOturumYolu } from '../shared/cc-olay.js';
import { onizlemeDisiMi, gorunumYerleri, sinirSayisiniGizle } from '../shared/sohbet-gorunum.js';
import { aracCagrisiKarti, kartDuzMetin } from '../shared/kart.js';
import { sonucKisaltildiMi } from './ajan/zincir.js';
import type { GorunenBlok, GorunenMesaj, Atif, SohbetOzet } from '../shared/tipler.js';
import { kipTemizle, type KipKimligi } from '../shared/karakterler.js';
import { ekleriAyikla } from '../shared/ek-kural.js';

type S = Record<string, unknown>;

export function anaSohbet(): number {
  const vt = veritabani();
  const s = vt.prepare("SELECT id FROM sohbetler WHERE tur = 'ana' AND arsiv = 0 ORDER BY id LIMIT 1").get() as S | undefined;
  if (s) return Number(s.id);
  const z = simdi();
  return Number(vt.prepare("INSERT INTO sohbetler(baslik, tur, olusturma, guncelleme) VALUES('Fuber', 'ana', ?, ?)").run(z, z).lastInsertRowid);
}

/** `tur` 'gorev' (0.11 G9): Görev'in kendi sohbeti (main/isler/zamanlayici.ts açar; başlık "Görev · <başlık>", yapay zekâ başlık koymaz). */
export function sohbetOlustur(baslik = 'Yeni sohbet', tur: 'normal' | 'asistan' | 'gorev' = 'normal'): number {
  const z = simdi();
  return Number(veritabani().prepare('INSERT INTO sohbetler(baslik, tur, olusturma, guncelleme) VALUES(?, ?, ?, ?)').run(baslik, tur, z, z).lastInsertRowid);
}

export function sohbetBilgisi(id: number): { id: number; baslik: string; tur: string; ozet: string | null; ozetSonMesaj: number } | null {
  const s = veritabani().prepare('SELECT * FROM sohbetler WHERE id = ?').get(id) as S | undefined;
  return s ? { id, baslik: String(s.baslik), tur: String(s.tur), ozet: (s.ozet as string) ?? null, ozetSonMesaj: Number(s.ozet_son_mesaj ?? 0) } : null;
}

export function sohbetListesi(o: { arsiv?: boolean; limit?: number } = {}): SohbetOzet[] {
  const vt = veritabani();
  // G1 (F2): önizleme sohbetin görünümüyle AYNI kuraldan geçer (shared/sohbet-gorunum.ts onizlemeDisiMi): proaktif tur başarısız ya da
  // durdurulmuşsa son kayıt iç talimattır — önizleme bir önceki görünür mesajdır (yoksa boş). Sondan başa, ilk görünürde durur. 0.12 cila:
  // yerel hazırlanırken düşen sakin not da atlanır (gerçek son ileti görünür).
  const sondan = vt.prepare("SELECT rol, kaynak, metin FROM mesajlar WHERE sohbet_id = ? AND metin != '' ORDER BY id DESC");
  const onizleme = (id: number): string | undefined => {
    for (const m of sondan.iterate(id) as Iterable<S>) if (!onizlemeDisiMi({ rol: String(m.rol), kaynak: (m.kaynak as string | null) ?? null })) return sinirSayisiniGizle(String(m.metin)).slice(0, 160); // iş izi işi (11 Kas): önizlemede de iç sınır sayısı yok
    return undefined;
  };
  return (vt
    .prepare(`SELECT s.id, s.baslik, s.tur, s.guncelleme, s.okunmamis FROM sohbetler s WHERE s.arsiv = ? ORDER BY (s.tur = 'ana') DESC, s.guncelleme DESC LIMIT ?`)
    .all(o.arsiv ? 1 : 0, o.limit ?? 100) as S[]).map((s) => ({ id: Number(s.id), baslik: String(s.baslik), tur: s.tur as SohbetOzet['tur'], guncelleme: String(s.guncelleme), sonMesaj: onizleme(Number(s.id)), okunmamis: Number(s.okunmamis) }));
}

export function sohbetBaslikYaz(id: number, baslik: string): void {
  veritabani().prepare('UPDATE sohbetler SET baslik = ? WHERE id = ?').run(baslik.slice(0, 80), id);
}
export function sohbetArsivle(id: number): void {
  veritabani().prepare("UPDATE sohbetler SET arsiv = 1 WHERE id = ? AND tur != 'ana'").run(id);
}
export function sohbetOzetYaz(id: number, ozet: string, sonMesaj: number): void {
  veritabani().prepare('UPDATE sohbetler SET ozet = ?, ozet_son_mesaj = ? WHERE id = ?').run(ozet, sonMesaj, id);
}
export function okunduIsaretle(id: number): void {
  veritabani().prepare('UPDATE sohbetler SET okunmamis = 0 WHERE id = ?').run(id);
}

/** Mesajın düz metni (arama dizini, sohbet özeti, liste önizlemesi): metin blokları + yapay zekânın kartları (0.11 G6: kartın düz metni, kayıttaki
 *  `kart_goster` çağrısının girdisinden — görünüm de aynı kuraldan kart bloğunu çıkarır). */
export function kayitMetni(bloklar: Blok[]): string {
  const parcalar: string[] = [];
  for (const b of bloklar) {
    if (b.tur === 'metin') parcalar.push(b.metin);
    else if (b.tur === 'arac_cagri') { const k = aracCagrisiKarti(b.ad, b.girdi); if (k) parcalar.push(kartDuzMetin(k)); }
  }
  return parcalar.join('\n').trim();
}

/** `gizli`: Gizli modda yazıldı (Görev 21 düzeltme 1) — bulut bağlamına (geçmiş, özet, arama, hafıza) girmez. */
export interface KayitliMesaj { id: number; rol: 'user' | 'assistant' | 'not'; bloklar: Blok[]; metin: string; kaynak?: string; model?: string; atiflar?: Atif[]; zaman: string; gizli?: boolean; karakter?: string; kip?: KipKimligi }

function mesajSatiri(s: S): KayitliMesaj {
  return {
    id: Number(s.id), rol: s.rol as KayitliMesaj['rol'], bloklar: JSON.parse(String(s.bloklar || '[]')), metin: String(s.metin ?? ''),
    kaynak: (s.kaynak as string) || undefined, model: (s.model as string) || undefined, atiflar: s.atiflar ? JSON.parse(String(s.atiflar)) : undefined, zaman: String(s.olusturma),
    ...(Number(s.gizli ?? 0) === 1 ? { gizli: true } : {}),
    ...(s.karakter ? { karakter: String(s.karakter) } : {}),
    ...(kipTemizle(s.kip) ? { kip: kipTemizle(s.kip) } : {}),
  };
}

/** Sohbetin son konuşma mesajı (kullanıcı ya da Fuber) Gizli bölüm müydü? Hiç mesaj yoksa null. */
export function sonGizliDurumu(sohbetId: number): boolean | null {
  const s = veritabani().prepare("SELECT gizli FROM mesajlar WHERE sohbet_id = ? AND rol IN ('user','assistant') ORDER BY id DESC LIMIT 1").get(sohbetId) as S | undefined;
  return s ? Number(s.gizli) === 1 : null;
}

/** `gizli` verilmezse bugünkü Gizli mod (Gizli modda yazılan her mesaj işaretlenir: tur dışı yazanlar — hatırlatıcı, eşlikçi — dahil). */
export function mesajEkle(sohbetId: number, m: { rol: KayitliMesaj['rol']; bloklar: Blok[]; kaynak?: string; model?: string; atiflar?: Atif[]; okunmamis?: boolean; gizli?: boolean; karakter?: string; kip?: KipKimligi }): KayitliMesaj {
  const vt = veritabani();
  const metin = kayitMetni(m.bloklar);
  // Görseller veritabanını şişirmesin: büyük base64 görseller küçük yer tutucuya iner (ekran görüntüleri tekrar alınabilir).
  const saklanan = m.bloklar.map((b) => {
    if (b.tur === 'gorsel' && b.veri.length > 1_500_000) return { tur: 'metin', metin: '[büyük görsel]' } as Blok;
    if (b.tur === 'arac_sonuc' && b.gorseller?.length) return { ...b, gorseller: b.gorseller.map((g) => (g.veri.length > 400_000 ? { medya: g.medya, veri: '' } : g)) };
    return b;
  });
  const z = simdi();
  const gizli = m.gizli ?? ayarlar().yerel?.gizliMod === true;
  const kip = kipTemizle(m.kip); // kayıt ve dönen nesne aynı (temizlenmiş) değeri taşır

  const r = vt
    .prepare('INSERT INTO mesajlar(sohbet_id, rol, metin, bloklar, kaynak, model, atiflar, olusturma, gizli, karakter, kip) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .run(sohbetId, m.rol, metin, JSON.stringify(saklanan), m.kaynak ?? null, m.model ?? null, m.atiflar?.length ? JSON.stringify(m.atiflar) : null, z, gizli ? 1 : 0, m.karakter ?? null, kip ?? null);
  const id = Number(r.lastInsertRowid);
  vt.prepare(`UPDATE sohbetler SET guncelleme = ?${m.okunmamis ? ', okunmamis = okunmamis + 1' : ''} WHERE id = ?`).run(z, sohbetId);
  // Açılışta boş diye arşive kalkmış sohbete (telefonda açık kalmış) KULLANICI yazarsa listeye döner (Görev 20b); araç sonucu
  // (rol 'user', kaynak 'arac') ya da proaktif tetik geri getirmez.
  if (kullaniciYazdiMi(m.rol, m.kaynak)) mesajlaArsivdenCikar(vt, sohbetId);
  // Gizli bölüm arama dizinine girmez: başka sohbetin bulut bağlamına ("ilgili geçmiş") ya da hafiza_ara'ya düşmesin.
  if (m.rol !== 'not' && !gizli) mesajDizinle(id, metin);
  return { id, rol: m.rol, bloklar: saklanan, metin, kaynak: m.kaynak, model: m.model, atiflar: m.atiflar, zaman: z, ...(gizli ? { gizli: true } : {}), ...(m.karakter ? { karakter: m.karakter } : {}), ...(kip ? { kip } : {}) };
}

/** G1 (F2): kendiliğinden turun iç talimatı yankılayan yanıtı kayıttan kalkar — mesajlar, arama dizini (hafiza_ara, "ilgili geçmiş") ve
 *  `okunmamisDus` kadar okunmamış sayısı. Tetiğin kendisi (rol 'not', kaynak 'proaktif') verilmez: modelin bağlamı için kalır. */
export function mesajlariSil(sohbetId: number, idler: readonly number[], okunmamisDus = 0): void {
  if (!idler.length) return;
  const vt = veritabani();
  const yer = idler.map(() => '?').join(',');
  vt.prepare(`DELETE FROM mesaj_ara WHERE rowid IN (${yer})`).run(...idler);
  vt.prepare(`DELETE FROM mesajlar WHERE sohbet_id = ? AND id IN (${yer})`).run(sohbetId, ...idler);
  if (okunmamisDus > 0) vt.prepare('UPDATE sohbetler SET okunmamis = MAX(0, okunmamis - ?) WHERE id = ?').run(okunmamisDus, sohbetId);
}

/** Görev 28 düzeltme 3: sohbetteki claude_code_gorev kartının "Oturumu aç" yolunu Claude Code kimliğiyle tamamlar (değişen mesaj sayısı). */
export function ccKartYolunuGuncelle(sohbetId: number, oturum: string, kimlik: string): number {
  const vt = veritabani();
  const satirlar = vt.prepare('SELECT id, bloklar FROM mesajlar WHERE sohbet_id = ? AND instr(bloklar, ?) > 0 ORDER BY id DESC LIMIT 20').all(sohbetId, ccOturumYolu(oturum)) as S[];
  let n = 0;
  for (const s of satirlar) {
    const yeni = bloklardaYolGuncelle(JSON.parse(String(s.bloklar || '[]')) as Blok[], oturum, kimlik);
    if (!yeni) continue;
    vt.prepare('UPDATE mesajlar SET bloklar = ? WHERE id = ?').run(JSON.stringify(yeni), Number(s.id));
    n++;
  }
  return n;
}

/** 0.14 T13 düzeltme turu 1: `oncesi` kimliğinden önceki kullanıcı sözleri ve kendiliğinden turların tetikleri (araç sonucu değil), YENİDEN ESKİYE —
 *  "Devam et" zincirinin asıl isteğini bulmak için (ajan/zincir.ts asilIstekBul). Sohbet özetinin sınırına bakmaz: özetlenmiş söz de bulunur. */
export function kullaniciSozleri(sohbetId: number, oncesi: number, limit = 50): KayitliMesaj[] {
  return (veritabani()
    .prepare("SELECT * FROM mesajlar WHERE sohbet_id = ? AND id < ? AND ((rol = 'user' AND (kaynak IS NULL OR kaynak != 'arac')) OR (rol = 'not' AND kaynak = 'proaktif')) ORDER BY id DESC LIMIT ?")
    .all(sohbetId, oncesi, limit) as S[]).map(mesajSatiri);
}

export function mesajlar(sohbetId: number, o: { sonrasi?: number; limit?: number } = {}): KayitliMesaj[] {
  const satirlar = veritabani()
    .prepare('SELECT * FROM (SELECT * FROM mesajlar WHERE sohbet_id = ? AND id > ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC')
    .all(sohbetId, o.sonrasi ?? 0, o.limit ?? 400) as S[];
  return satirlar.map(mesajSatiri);
}

// ── Arayüz görünümü ──────────────────────────────────────────────────────────────────────────────────────────
export function aracEtiketi(ad: string, girdi: Record<string, unknown>): string {
  try {
    const a = aracBul(ad);
    if (a) return a.etiket(girdi);
  } catch { /* ham ada düş */ }
  // MCP araçları kayıt defterinde değil (bağlantı kapanınca düşer): "mcp__Sunucu_adi__arac_adi" → "Sunucu adı · arac adı"
  const m = /^mcpg?__(.+?)__(.+)$/.exec(ad); // 0.14 T16: Developer sunucusu öneki mcpg__
  return m ? `${m[1].replace(/_/g, ' ')} · ${m[2].replace(/_/g, ' ')}` : ad;
}

export function gorunume(liste: KayitliMesaj[]): GorunenMesaj[] {
  const mod = ayarlar().mod;
  const sonuclar = new Map<string, Extract<Blok, { tur: 'arac_sonuc' }>>();
  for (const m of liste) for (const b of m.bloklar) if (b.tur === 'arac_sonuc') sonuclar.set(b.id, b);
  const out: GorunenMesaj[] = [];
  // Görev 26 (shared/sohbet-gorunum.ts): araç sonuçları kartına birleşir, kendiliğinden turun iç talimatı görünmez; Fuber balonları
  // YALNIZ aynı turun araç döngüsünde birleşir (Claude Code özeti, eşlikçi, rapor, sabah özeti kendi balonunda).
  const yerler = gorunumYerleri(liste.map((m) => ({ rol: m.rol, kaynak: m.kaynak, aracSonucu: m.bloklar.every((b) => b.tur === 'arac_sonuc') })));
  for (const [i, m] of liste.entries()) {
    if (yerler[i] === 'atla') continue;

    const bloklar: GorunenBlok[] = [];
    for (const b of m.bloklar) {
      if (b.tur === 'metin') {
        // İş izi işi (11 Kas, bulgu 7): eski notlardaki iç sınır sayısı ("Adım sınırına geldim (100)") görünümde insan diline çevrilir.
        const metin = m.rol === 'user' ? b.metin.replace(/<baglam>[\s\S]*?<\/baglam>\s*/g, '').trim() : sinirSayisiniGizle(b.metin);
        // Analiz 11 Kas bulgu 8: kullanıcının belge/video eki balonda çip olur (belgenin metni balonu doldurmaz).
        const a = m.rol === 'user' ? ekleriAyikla(metin) : { metin, ekler: [] };
        if (a.metin) bloklar.push({ tur: 'metin', metin: a.metin });
        for (const e of a.ekler) bloklar.push({ tur: 'ek', ad: e.ad, turu: e.tur });
      } else if (b.tur === 'gorsel') bloklar.push({ tur: 'gorsel', medya: b.medya, veri: b.veri });
      else if (b.tur === 'arac_cagri') {
        const s = sonuclar.get(b.id);
        const g0 = s?.gorseller?.find((g) => g.veri);
        const durum = !s ? 'hata' : s.hata ? (/reddedildi|onay verilmedi/i.test(s.icerik) ? 'reddedildi' : 'hata') : 'tamam';
        // 0.11 G6: başarılı `kart_goster` çağrısı araç satırı değil KART'tır (shared/kart.ts); geçersiz/başarısız olan "hata" satırı kalır.
        const kart = durum === 'tamam' ? aracCagrisiKarti(b.ad, b.girdi) : null;
        if (kart) { bloklar.push({ tur: 'kart', kart }); continue; }
        bloklar.push({
          tur: 'arac', id: b.id, ad: b.ad, etiket: aracEtiketi(b.ad, b.girdi), girdi: b.girdi, durum,
          // B7: İş modunda başarısız/reddedilen adımın ham hatası kartta görünmez (canlı kartla aynı kural). 0.14 T13: modele kısaltılmış giden sonuç
          // kartta da söylenir (canlı kartla aynı ek; sessiz kesme yok).
          ozet: aracKartiOzeti(durum, s ? `${s.icerik.slice(0, 300)}${durum === 'tamam' && sonucKisaltildiMi(s.icerik) ? ' · sonuç kısaltıldı' : ''}` : 'Yanıt alınamadı', mod),
          gorsel: g0 ? `data:${g0.medya};base64,${g0.veri}` : undefined,
          ...(s?.yol ? { yol: s.yol } : {}),
        });
      }
    }
    if (!bloklar.length) continue;
    // Aynı turun araç döngüsündeki asistan mesajları tek balonda birleşir.
    const onceki = out[out.length - 1];
    if (yerler[i] === 'devam' && onceki && onceki.rol === 'assistant' && m.rol === 'assistant') { onceki.bloklar.push(...bloklar); onceki.atiflar = m.atiflar ?? onceki.atiflar; onceki.id = m.id; continue; }
    out.push({ id: m.id, rol: m.rol, bloklar, zaman: m.zaman, kaynak: m.kaynak, model: m.model, atiflar: m.atiflar, ...(m.karakter ? { karakter: m.karakter } : {}), ...(m.kip ? { kip: m.kip } : {}) });
  }
  return out;
}

export function gorunenMesajlar(sohbetId: number, limit = 300): GorunenMesaj[] {
  return gorunume(mesajlar(sohbetId, { limit }));
}
