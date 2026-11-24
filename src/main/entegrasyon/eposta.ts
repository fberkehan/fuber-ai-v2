// ── E-posta (IMAP okuma + SMTP gönderim) ─────────────────────────────────────────────────────────────────────
// Hesaplar ayarlarda (parolalar sır dosyasında, DPAPI ile şifreli). Gelen kutusu düzenli aralıkla eşitlenir; yeni
// iletiler yardımcı modelle ÖNEM puanı (0-5) ve tek cümlelik değerlendirme alır; 4+ olanlar kokpitte "dikkat"
// notu ve masaüstü bildirimi olur. GÖNDERİM her seferinde kullanıcı onayı ister (tam önizleme gösterilir).
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import nodemailer from 'nodemailer';
import { simpleParser } from 'mailparser';
import { randomUUID } from 'node:crypto';
import { ayarlar, ayarlariKaydet, sirOku, sirVar, sirYaz } from '../ayarlar.js';
import { veritabani, simdi } from '../vt.js';
import { aracKaydet, sema, metinKisalt, type Arac } from '../ajan/araclar/kayit.js';
import { yardimciJson } from '../motor/secici.js';
import { tekMotorYolu, yerelBaglamAsimiMi } from '../motor/yerel.js';
import { obekle, yarilayarakDene, yerelGirdiButcesi } from '../../shared/yerel-butce.js';
import { oneriEkle } from '../planlama.js';
import { yayinla } from '../olaylar.js';
import type { EpostaAyari } from '../../shared/tipler.js';
import { epostaGirdisiniKirp, epostaBaglantisiAyni } from '../../shared/eposta-formu.js';

export function epostaHesaplari(): EpostaAyari[] {
  return ayarlar().eposta.filter((e) => e.parolaVar);
}

export const HAZIR_AYARLAR: Record<string, Pick<EpostaAyari, 'imapSunucu' | 'imapPort' | 'smtpSunucu' | 'smtpPort'>> = {
  gmail: { imapSunucu: 'imap.gmail.com', imapPort: 993, smtpSunucu: 'smtp.gmail.com', smtpPort: 465 },
  outlook: { imapSunucu: 'outlook.office365.com', imapPort: 993, smtpSunucu: 'smtp.office365.com', smtpPort: 587 },
  yandex: { imapSunucu: 'imap.yandex.com', imapPort: 993, smtpSunucu: 'smtp.yandex.com', smtpPort: 465 },
};

type HesapGirdisi = Omit<EpostaAyari, 'id' | 'parolaVar'> & { id?: string; parola?: string };

/** Formdan gelen hesabın kimliği: verilmişse o, yoksa aynı adresli kayıt (yeniden denemede ikinci hesap açılmasın). */
function hesapKimligi(h: HesapGirdisi): string | undefined {
  return h.id || ayarlar().eposta.find((x) => x.adres.trim().toLowerCase() === h.adres.trim().toLowerCase())?.id;
}

export function hesapKaydet(girdi: HesapGirdisi): EpostaAyari {
  const h = epostaGirdisiniKirp(girdi); // sunucu adları ve adres boşluklu kaydedilmesin (Görev 20b)
  const id = hesapKimligi(h) || randomUUID();
  const eski = ayarlar().eposta.find((x) => x.id === id);
  ayarlariKaydet((a) => {
    const i = a.eposta.findIndex((x) => x.id === id);
    const kayit: EpostaAyari = { id, ad: h.ad, adres: h.adres, imapSunucu: h.imapSunucu, imapPort: h.imapPort, smtpSunucu: h.smtpSunucu, smtpPort: h.smtpPort, kullanici: h.kullanici || h.adres, guvenli: h.guvenli, parolaVar: false };
    if (i >= 0) a.eposta[i] = kayit; else a.eposta.push(kayit);
  });
  // Düzeltme turu 2: bağlantı (sunucu/port/kullanıcı/güvenli) değişti ve yeni parola verilmediyse kayıtlı parola SİLİNİR — eşitleme ve
  // gönderim onu yeni sunucuya götürmesin.
  if (h.parola) sirYaz(`eposta:${id}`, h.parola);
  else if (eski && !epostaBaglantisiAyni(eski, h)) sirYaz(`eposta:${id}`, null);
  return ayarlar().eposta.find((x) => x.id === id)!;
}

/**
 * Düzeltme turu 2: genel ayar kaydında (`ayarlar:kaydet`) bir hesabın bağlantısı değiştiyse kayıtlı parolası silinir — parola yalnız
 * kaydedildiği sunucuya gider (yeni sunucu için yeniden yazılır). Silinen hesap kimlikleri döner.
 */
export function degisenBaglantilarinParolasiniSil(once: readonly EpostaAyari[], sonra: readonly EpostaAyari[]): string[] {
  const silinen: string[] = [];
  for (const e of once) {
    const y = sonra.find((x) => x.id === e.id);
    if (y && !epostaBaglantisiAyni(e, y) && sirVar(`eposta:${e.id}`)) { sirYaz(`eposta:${e.id}`, null); silinen.push(e.id); }
  }
  return silinen;
}

export function hesapSil(id: string): void {
  ayarlariKaydet((a) => { a.eposta = a.eposta.filter((x) => x.id !== id); });
  sirYaz(`eposta:${id}`, null);
}

const parolasi = (h: EpostaAyari) => sirOku(`eposta:${h.id}`) ?? '';

function imap(h: EpostaAyari, parola = parolasi(h)): ImapFlow {
  const c = new ImapFlow({ host: h.imapSunucu, port: h.imapPort, secure: h.imapPort === 993, auth: { user: h.kullanici || h.adres, pass: parola }, logger: false, emitLogs: false });
  // Dinleyicisi olmayan 'error' olayı (soket koptu, zaman aşımı) ana süreci düşürür; komut hataları zaten ayrıca yakalanıyor.
  c.on('error', (e: Error) => console.error('[eposta]', h.adres, e.message));
  return c;
}

/** Oturumu her durumda kapat: bağlıysa LOGOUT, değilse soket kapatılır (bağlantı sızmasın). */
async function cikis(c: ImapFlow): Promise<void> {
  try { if (c.usable) await c.logout(); } catch { /* sunucu zaten kapattı */ }
  try { c.close(); } catch { /* kapalı */ }
}

export async function hesapSina(h: EpostaAyari, parola = parolasi(h)): Promise<{ imap: boolean; smtp: boolean; hata?: string }> {
  const sonuc = { imap: false, smtp: false, hata: undefined as string | undefined };
  const c = imap(h, parola);
  try { await c.connect(); sonuc.imap = true; } catch (e) { sonuc.hata = `IMAP: ${(e as Error).message}`; } finally { await cikis(c); }
  try { await smtp(h, parola).verify(); sonuc.smtp = true; } catch (e) { sonuc.hata = `${sonuc.hata ? `${sonuc.hata}; ` : ''}SMTP: ${(e as Error).message}`; }
  return sonuc;
}

/** Kaydetmeden sınar: formdaki parola ile; parola boşsa kayıtlı olan YALNIZ bağlantı kaydedildiği gibiyse (düzeltme turu 2: aksi hâlde
 *  hiçbir yere bağlanmaz — kayıtlı parola başka sunucuya, TLS'siz porta gitmez). Okuma geçmeyen hesap kaydedilmesin diye. */
export async function hesapDene(girdi: HesapGirdisi): Promise<{ imap: boolean; smtp: boolean; hata?: string }> {
  const h = epostaGirdisiniKirp(girdi);
  const id = hesapKimligi(h) ?? '';
  const kayitli = id ? ayarlar().eposta.find((x) => x.id === id) : undefined;
  if (!h.parola && kayitli && !epostaBaglantisiAyni(kayitli, h)) {
    return { imap: false, smtp: false, hata: 'Sunucu bilgileri değişti; kayıtlı parola yeni sunucuya gönderilmez. Parolayı yeniden yaz.' };
  }
  const parola = h.parola || (kayitli ? sirOku(`eposta:${id}`) : undefined) || '';
  const gecici: EpostaAyari = { id, ad: h.ad, adres: h.adres, imapSunucu: h.imapSunucu, imapPort: h.imapPort, smtpSunucu: h.smtpSunucu, smtpPort: h.smtpPort, kullanici: h.kullanici || h.adres, guvenli: h.guvenli, parolaVar: Boolean(parola) };
  return hesapSina(gecici, parola);
}

function smtp(h: EpostaAyari, parola = parolasi(h)) {
  return nodemailer.createTransport({ host: h.smtpSunucu, port: h.smtpPort, secure: h.smtpPort === 465, auth: { user: h.kullanici || h.adres, pass: parola } });
}

// ── Eşitleme ─────────────────────────────────────────────────────────────────────────────────────────────────
let esitleniyor = false;
export async function esitle(adet = 30): Promise<number> {
  if (esitleniyor) return 0;
  esitleniyor = true;
  let yeniToplam = 0;
  try {
    for (const h of epostaHesaplari()) {
      const c = imap(h);
      const yeniler: { id: number; kimden: string; konu: string; ozet: string }[] = [];
      try {
        await c.connect();
        const kilit = await c.getMailboxLock('INBOX');
        try {
          const toplam = typeof c.mailbox === 'object' && c.mailbox ? c.mailbox.exists : 0;
          if (toplam) {
            const bas = Math.max(1, toplam - adet + 1);
            const vt = veritabani();
            // 1) Yalnız zarf/bayrak/uid: eskiden son 30 iletinin TAM gövdesi her 5 dk'da yeniden iniyordu.
            const yeniUid: { uid: number; kimlik: string; zarf: FetchMessageObject['envelope']; okundu: number }[] = [];
            for await (const m of c.fetch(`${bas}:*`, { envelope: true, flags: true, uid: true })) {
              const kimlik = m.envelope?.messageId ?? `uid-${m.uid}`;
              const var_ = vt.prepare('SELECT id, okundu FROM epostalar WHERE hesap = ? AND mesaj_kimlik = ?').get(h.id, kimlik) as { id: number; okundu: number } | undefined;
              const okundu = m.flags?.has('\\Seen') ? 1 : 0;
              if (var_) { if (var_.okundu !== okundu) vt.prepare('UPDATE epostalar SET okundu = ? WHERE id = ?').run(okundu, var_.id); continue; }
              yeniUid.push({ uid: m.uid, kimlik, zarf: m.envelope, okundu });
            }
            // 2) Gövde yalnız veritabanında olmayanlar için (ilk döngü bittikten sonra: ImapFlow'da fetch sürerken başka komut kilitlenir).
            const kaynaklar = new Map<number, Buffer>();
            if (yeniUid.length) {
              for await (const m of c.fetch(yeniUid.map((x) => x.uid).join(','), { uid: true, source: true }, { uid: true })) if (m.source) kaynaklar.set(m.uid, m.source);
            }
            for (const { uid, kimlik, zarf, okundu } of yeniUid) {
              let govde = '';
              const kaynak = kaynaklar.get(uid);
              if (kaynak) { try { const p = await simpleParser(kaynak); govde = (p.text || (p.html ? String(p.html).replace(/<[^>]+>/g, ' ') : '')).replace(/\s+\n/g, '\n').slice(0, 20000); } catch { /* gövde okunamadı */ } }
              const kimden = zarf?.from?.map((f) => (f.name ? `${f.name} <${f.address}>` : f.address)).join(', ') ?? '';
              const kime = zarf?.to?.map((f) => f.address).join(', ') ?? '';
              const konu = zarf?.subject ?? '(konusuz)';
              const r = vt
                .prepare('INSERT OR IGNORE INTO epostalar(hesap, uid, mesaj_kimlik, kimden, kime, konu, tarih, ozet, govde, okundu) VALUES(?,?,?,?,?,?,?,?,?,?)')
                .run(h.id, uid, kimlik, kimden, kime, konu, new Date(zarf?.date ?? Date.now()).toISOString(), govde.slice(0, 280).replace(/\s+/g, ' '), govde, okundu);
              if (Number(r.changes)) { yeniToplam++; if (!okundu) yeniler.push({ id: Number(r.lastInsertRowid), kimden, konu, ozet: govde.slice(0, 1200) }); }
            }
          }
        } finally { kilit.release(); }
      } catch (e) {
        yayinla('eposta:hata', { hesap: h.adres, mesaj: (e as Error).message });
      } finally {
        // Her yolda (boş kutu dahil) çıkış: eskiden `continue` LOGOUT'u atlıyor, bağlantı açık kalıyordu.
        await cikis(c);
      }
      // Önem puanlaması (yardımcı model) IMAP bağlantısı kapandıktan sonra.
      if (yeniler.length) await onemDegerlendir(yeniler).catch(() => undefined);
    }
  } finally {
    esitleniyor = false;
  }
  if (yeniToplam) yayinla('kokpit:veri-degisti', { neden: 'eposta' });
  return yeniToplam;
}

const ONEM_SISTEMI = 'Kullanıcının gelen e-postalarını önem açısından puanla (0 = reklam/bülten, 3 = normal, 4 = yanıt/aksiyon bekleyen, 5 = acil: ödeme, hukuki, müşteri şikayeti, son tarih, yakın kişi). Her biri için tek cümlelik Türkçe neden yaz. JSON: {"sonuclar":[{"id":1,"onem":0-5,"neden":"…"}]}';
/** 0.12 cila düzeltme turu 1 (I-1): yerel yolda öbek ve özet sınırı — yerel sunucunun yuvasına (≈ 4096 token) sığsın (shared/yerel-butce.ts). */
const YEREL_ONEM = { obek: 5, ozet: 400, cikis: 800 } as const;

async function onemDegerlendir(liste: { id: number; kimden: string; konu: string; ozet: string }[]): Promise<void> {
  // 0.12 cila: kapı tek kuraldır (yol) — "Yalnız bu bilgisayar"/Gizli'de bulut motoru yokken de yerel hazırsa puanlama yerelde (tek
  // seçici: motor/secici.ts). Gelen kutusunun eşitlenmesi (IMAP, kullanıcının kendi bağlantısı) bu kapıdan bağımsızdır.
  const yol = tekMotorYolu();
  if (yol === 'yok') return;
  const ilk = liste.slice(0, 20);
  // Düzeltme turu 1 (I-1): yerelde 20 ileti × 1.200 karakter yuvaya sığmıyordu (sunucu reddediyor, hata yutuluyordu): kısa özetle küçük öbekler.
  const obekler = yol === 'yerel'
    ? obekle(ilk.map((e) => ({ ...e, ozet: e.ozet.slice(0, YEREL_ONEM.ozet) })), YEREL_ONEM.obek, yerelGirdiButcesi(ONEM_SISTEMI, YEREL_ONEM.cikis))
    : [ilk];
  const vt = veritabani();
  const puanla = async (obek: typeof ilk): Promise<void> => {
    const j = await yardimciJson<{ sonuclar?: { id: number; onem: number; neden: string }[] }>(ONEM_SISTEMI, JSON.stringify(obek), 'eposta-onem', yol === 'yerel' ? YEREL_ONEM.cikis : 2000);
    for (const s of j?.sonuclar ?? []) {
      const e = obek.find((x) => x.id === s.id);
      if (!e) continue;
      vt.prepare('UPDATE epostalar SET onem = ?, degerlendirme = ? WHERE id = ?').run(Math.max(0, Math.min(5, Math.round(s.onem))), s.neden, s.id);
      if (s.onem >= 4) {
        oneriEkle({ tur: 'dikkat', baslik: `E-posta: ${metinKisalt(e.konu, 70)}`, icerik: `${e.kimden} — ${s.neden}`, gecerlilikSaat: 48 });
        yayinla('bildirim', { baslik: `Önemli e-posta: ${metinKisalt(e.konu, 60)}`, metin: s.neden });
      }
    }
  };
  // Düzeltme turu 2 (a): yerel bağlam aşımında öbek ikiye bölünüp bir kez yeniden denenir; hata yutulmaz (günlükte), sonraki öbekler sürer.
  for (const obek of obekler) {
    await yarilayarakDene(obek, puanla, {
      kisalt: (e) => ({ ...e, ozet: e.ozet.slice(0, Math.ceil(e.ozet.length / 2)) }),
      asimMi: yerelBaglamAsimiMi,
      uyar: (n, e) => console.warn(`[e-posta] ${n} ileti puanlanamadı: ${(e as Error)?.message ?? e}`),
    });
  }
}

export async function gonder(hesapId: string | undefined, ileti: { kime: string; konu: string; govde: string; cc?: string }): Promise<string> {
  const h = epostaHesaplari().find((x) => x.id === hesapId) ?? epostaHesaplari()[0];
  if (!h) throw new Error('Gönderim için kayıtlı e-posta hesabı yok.');
  const r = await smtp(h).sendMail({ from: `${ayarlar().kullaniciAdi || h.ad} <${h.adres}>`, to: ileti.kime, cc: ileti.cc, subject: ileti.konu, text: ileti.govde });
  return r.messageId;
}

// ── Araçlar ──────────────────────────────────────────────────────────────────────────────────────────────────
const araclar: Arac[] = [
  {
    grup: 'eposta', risk: 'serbest',
    etiket: (g) => (g.ara ? `E-postalarda arıyor: “${metinKisalt(String(g.ara), 40)}”` : 'Gelen kutusuna bakıyor'),
    tanim: {
      ad: 'eposta_listele',
      aciklama: 'Gelen kutusundaki son e-postaları listeler (önce sunucuyla eşitler). Kimden/konu/özet/önem verir; tam metin için eposta_oku.',
      sema: sema({ ara: { type: 'string', description: 'Kimden ya da konuda geçen kelime' }, okunmamis: { type: 'boolean' }, limit: { type: 'integer' } }),
    },
    async calistir(g) {
      await esitle().catch(() => 0);
      const k: string[] = ['1=1'];
      const p: (string | number)[] = [];
      if (g.okunmamis) k.push('okundu = 0');
      if (g.ara) { k.push('(kimden LIKE ? OR konu LIKE ? OR ozet LIKE ?)'); const a = `%${g.ara}%`; p.push(a, a, a); }
      p.push(Math.min(Number(g.limit ?? 15), 40));
      const l = veritabani().prepare(`SELECT id, kimden, konu, tarih, ozet, okundu, onem, degerlendirme FROM epostalar WHERE ${k.join(' AND ')} ORDER BY tarih DESC LIMIT ?`).all(...p) as Record<string, unknown>[];
      return {
        icerik: l.length ? l.map((e) => `#${e.id} ${e.okundu ? '' : '● '}[önem ${e.onem}] ${new Date(String(e.tarih)).toLocaleString('tr-TR')} — ${e.kimden}\n  Konu: ${e.konu}\n  ${e.degerlendirme ? `(${e.degerlendirme}) ` : ''}${e.ozet}`).join('\n') : 'E-posta yok.',
        ozet: `${l.length} e-posta`,
      };
    },
  },
  {
    grup: 'eposta', risk: 'serbest',
    etiket: (g) => `E-postayı okuyor #${g.id}`,
    tanim: { ad: 'eposta_oku', aciklama: 'Bir e-postanın tam metnini getirir.', sema: sema({ id: { type: 'integer' } }, ['id']) },
    async calistir(g) {
      const e = veritabani().prepare('SELECT * FROM epostalar WHERE id = ?').get(Number(g.id)) as Record<string, unknown> | undefined;
      if (!e) return { icerik: 'Bulunamadı', hata: true };
      return { icerik: `Kimden: ${e.kimden}\nKime: ${e.kime}\nTarih: ${e.tarih}\nKonu: ${e.konu}\n\n${e.govde}`, ozet: String(e.konu).slice(0, 80) };
    },
  },
  {
    grup: 'eposta', risk: 'onay',
    etiket: (g) => `E-posta gönderecek: ${g.kime} · ${metinKisalt(String(g.konu ?? ''), 40)}`,
    tanim: {
      ad: 'eposta_gonder',
      aciklama: 'E-posta gönderir. Kullanıcıya tam önizleme gösterilir ve ONAYI alınır; onaylanmazsa gönderilmez. Metni kullanıcının ağzından, onun üslubuyla yaz.',
      sema: sema({ kime: { type: 'string' }, konu: { type: 'string' }, govde: { type: 'string' }, cc: { type: 'string' }, hesap: { type: 'string', description: 'Gönderen hesap adresi (boş = ilk hesap)' } }, ['kime', 'konu', 'govde']),
    },
    async calistir(g, b) {
      const hesap = epostaHesaplari().find((h) => h.adres === g.hesap) ?? epostaHesaplari()[0];
      const karar = await b.onay({
        baslik: 'E-posta gönderilsin mi?',
        aciklama: `${hesap?.adres ?? '?'} → ${g.kime}${g.cc ? ` (cc ${g.cc})` : ''}`,
        onizleme: `Konu: ${g.konu}\n\n${g.govde}`,
        tehlike: 'orta',
      });
      if (karar === 'reddet') return { icerik: 'Kullanıcı onay vermedi; e-posta gönderilmedi (reddedildi).', hata: true, ozet: 'reddedildi' };
      const id = await gonder(hesap?.id, { kime: String(g.kime), konu: String(g.konu), govde: String(g.govde), cc: g.cc as string });
      return { icerik: `Gönderildi (${id}).`, ozet: 'gönderildi' };
    },
  },
];

export function epostaAraclariniKaydet(): void { aracKaydet(...araclar); }
/** Test kancası: `onemDegerlendir` (tests/yalniz-yerel-ozellikler.test.ts — IMAP'siz önem puanlaması). */
export const _test = { simdi, onemDegerlendir };
