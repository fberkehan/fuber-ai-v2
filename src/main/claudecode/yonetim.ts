// ── Claude Code yöneticisinin uygulama bağlantısı (Electron tarafı): tek örnek, olay yayını, ada/sohbet bildirimleri, kapanış ─────────
// Motor Electron'dan bağımsızdır (oturum-yoneticisi.ts); burada kancaları bağlanır:
//  • Her olay 'claudecode:olay' ile pencerelere (telefona GİTMEZ: kopru-protokol.ts TELEFONA_GITMEZ).
//  • İzin bekleyince ve iş bitince/çökünce ada bildirir — Fuber'in öteki bildirimleriyle AYNI yol (adaGonder 'asistan:bildir'; uygulama
//    öndeyse tost; tıklayınca o oturum). 0.13: izin isteği onay gibi adayı açar (ada kapalıysa Windows bildirimi), iş bitti/durdu haberi Fuber'in sessiz mesajıdır
//    (nokta). "Rahatsız etme" iş bitti bildirimini susturur, izin isteğini susturmaz (onay gibi kullanıcı beklenir).
//  • Sohbetten verilen iş bitince, zorla durdurulunca ya da çökünce o sohbete BİR KEZ kısa özet (değişen dosya sayısı, son yanıtın ilk
//    cümlesi); sohbet o an yanıt yazıyorsa tur bitince (geçmiş araç sırası bozulmasın).
//  • "Tam yetki" kapanınca Tam yetki modundaki oturumlar Düzenlemelere izin ver'e iner. Uygulama kapanırken hepsi temiz kapanır.
//  • Bilinen proje klasörleri (oturum geçmişi, açık oturum, bu çalıştırmada seçilen klasör): CLAUDE.md, "Klasörü aç", "@" önerisi ve
//    TELEFONDAN oturum açma yalnız bunlarda (Ruling CA).
import { app } from 'electron';
import { chromeEklentisiKurulu } from '../chrome-baglanti.js';
import path from 'node:path';
import { CcYonetici } from './oturum-yoneticisi.js';
import { KlasorGuvenDeposu, varsayilanKlasorSinirlari } from './klasor-guveni.js';
import { yollar } from '../yollar.js';
import { jsonOku, jsonYaz } from '../json-dosya.js';
import { ccKomutu, etkinAjanMetni } from './yurutucu.js';
import { baskaYerdeAcik, bilinenProjeKlasoru } from './dokum.js';
import { ccTara, claudeDizini } from './indeks.js';
import { ayarlar, ayarDinle } from '../ayarlar.js';
import { yayinla, sohbetOlayi } from '../olaylar.js';
import { adaGonder, adaAnaOndeMi } from '../ada.js';
import { rahatsizEtmeMi } from '../zamanlayici.js';
import { mesajEkle, gorunume, ccKartYolunuGuncelle } from '../sohbet.js';
import { mesgulMu } from '../ajan/dongu.js';
import { sinyal } from '../beyin.js';
import { ccBitisOzeti, ccBitisBildirimi, ccOturumBaglantisi, ccOturumYolu, kisalt } from '../../shared/cc-olay.js';

let ornek: CcYonetici | null = null;
let kapandi = false;

/** Klasör güveni kararları (son dalga B, I1): Fuber'in veri klasöründe; yalnız masadaki 'claudecode:klasor-guveni' yazar (UZAKTAN_KAPALI). */
let guvenDeposu: KlasorGuvenDeposu | null = null;
export const ccGuvenDeposu = () => (guvenDeposu ??= new KlasorGuvenDeposu(() => path.join(yollar.veri(), 'claude-klasor-guveni.json')));

/** Model listesinin kalıcı kaydı (0.13 T12): oturumdan gelen son liste Fuber'in veri klasöründe; taslakta oturum açılmadan gösterilir. */
const modellerDosyasi = () => path.join(yollar.veri(), 'claude-modeller.json');

/** Bu çalıştırmada klasör seçiciyle seçilen ya da BAŞARIYLA oturum başlatılan proje klasörleri (henüz geçmişi olmayan projeler). */
export const ccSecilenKlasorler = new Set<string>();

/** Bilinen proje kökü mü (değilse fırlatır): oturum geçmişi + açık oturumlar + seçilen klasörler. */
export async function ccProjeKlasoru(cwd: unknown): Promise<string> {
  const bilinen = [...(await ccTara()).map((o) => o.cwd), ...ccYonetici().cwdler(), ...ccSecilenKlasorler];
  return bilinenProjeKlasoru(cwd, bilinen);
}

/** Ada / tost / Windows bildirimi; `yol` tıklanınca açılacak sayfa: 'claude#cc-<oturum>' (ana:git çapası; sayfa oturumu seçer —
 *  'claude/<id>' biçimi sohbet seçimine sayı olarak gittiği için kullanılmaz). */
export const ccYolu = (oturum: string, kimlik?: string | null) => ccOturumYolu(oturum, kimlik);
function ccBildir(baslik: string, metin: string, o: { id: string; kimlik?: string | null }, izin = false): void {
  // 0.13: izin isteği karar bekler, onay isteği gibi adayı açar (`acil`; yanıtlandıysa kuyruktan bayat inmez). Bitti/durdu haberleri Fuber'in sessiz mesajıdır: nokta.
  adaGonder('asistan:bildir', { tur: 'mesaj', baslik, metin: kisalt(metin, 600), yol: ccYolu(o.id, o.kimlik), ...(izin ? { acil: true } : {}) }, izin ? 'onay' : 'fuber', izin ? { gecerli: () => (ccYonetici().ozetAl(o.id)?.bekleyenIzin ?? 0) > 0 } : {});
}

function sohbeteYaz(sohbetId: number, metin: string): void {
  const yaz = () => {
    try {
      const m = mesajEkle(sohbetId, { rol: 'assistant', bloklar: [{ tur: 'metin', metin }], kaynak: 'claudecode', okunmamis: true });
      sohbetOlayi({ tur: 'yeni_mesaj', sohbetId, mesaj: gorunume([m])[0] });
    } catch (e) { console.warn('[claude-code] sohbete özet yazılamadı:', (e as Error).message); }
  };
  if (!mesgulMu(sohbetId)) { yaz(); return; }
  const bas = Date.now();
  const z = setInterval(() => { if (!mesgulMu(sohbetId) || Date.now() - bas > 10 * 60_000) { clearInterval(z); yaz(); } }, 2000);
  z.unref?.();
}

export function ccYonetici(): CcYonetici {
  if (ornek) return ornek;
  const y = new CcYonetici({
    komut: ccKomutu,
    ayar: () => { const a = ayarlar().claudeCode; return { tamYetki: a.tamYetki, varsayilanMod: a.varsayilanMod, chrome: a.chrome }; },
    chromeKurulu: chromeEklentisiKurulu,
    olay: (z) => yayinla('claudecode:olay', z),
    izinBekliyor: (o, i) => {
      sinyal('ajan', 'kod', 'izin bekliyor', 'Claude Code');
      ccBildir(`Claude Code izin bekliyor · ${o.proje}`, i.tip === 'soru' ? `Soru: ${i.ozet}` : `${i.adi ?? i.arac}: ${i.ozet}`, o, true);
    },
    turBitti: (o, b) => {
      const girdi = { proje: o.proje, degisenDosya: b.degisenDosyalar.length, sonMetin: b.sonMetin, sonuc: b.sonuc, arkaPlan: o.arkaPlan };
      // Düzeltme 3: sohbette saklı araç kartının yolu Claude Code kimliğiyle tamamlanır (yeniden açılışta geçmişe düşebilsin).
      if (typeof b.sohbetId === 'number' && o.kimlik) { try { ccKartYolunuGuncelle(b.sohbetId, o.id, o.kimlik); } catch { /* kart yolu kritik değil */ } }
      // Sohbetten verilen işin bitişi (bir kez); sonunda "Oturumu aç" bağlantısı (Görev 28 düzeltme 1).
      if (typeof b.sohbetId === 'number') sohbeteYaz(b.sohbetId, `${ccBitisOzeti(girdi)} ${ccOturumBaglantisi(o.id, o.kimlik)}`);
      // Sayfada izlenen oturum için uygulama öndeyken bildirim yok (kullanıcı zaten görüyor).
      if (!rahatsizEtmeMi() && (b.kaynak !== 'sayfa' || !adaAnaOndeMi())) { const n = ccBitisBildirimi(girdi); ccBildir(n.baslik, n.metin, o); }
    },
    hataOldu: (o, h, sohbetId) => {
      if (typeof sohbetId === 'number' && o.kimlik) { try { ccKartYolunuGuncelle(sohbetId, o.id, o.kimlik); } catch { /* */ } }
      if (typeof sohbetId === 'number') sohbeteYaz(sohbetId, `Claude Code hata verdi · ${o.proje}: ${kisalt(h, 300)} ${ccOturumBaglantisi(o.id, o.kimlik)}`);
      if (!rahatsizEtmeMi()) ccBildir(`Claude Code durdu · ${o.proje}`, h, o);
    },
    baskaYerdeMi: (kimlik, bizim) => baskaYerdeAcik(kimlik, bizim, etkinAjanMetni),
    istemci: `fuber-ai/${app.getVersion()}`,
    klasorGuveni: (cwd) => ccGuvenDeposu().kayit(cwd),
    modellerOku: () => { const r = jsonOku(modellerDosyasi()); return typeof r === 'object' ? r.veri.modeller : null; },
    modellerYaz: (liste) => jsonYaz(modellerDosyasi(), { modeller: liste }),
    // N2: telefondan/sohbetten açılamayan klasörler + düzenleme koruması (Fuber'in verisi, ~/.claude, Belgeler'deki PowerShell profili).
    klasorSinirlari: () => varsayilanKlasorSinirlari({ veri: yollar.veri(), claudeDizini: claudeDizini(), belgeler: app.getPath('documents') }),
  });
  let tamYetki = ayarlar().claudeCode.tamYetki;
  ayarDinle((a) => {
    if (a.claudeCode.tamYetki === tamYetki) return;
    tamYetki = a.claudeCode.tamYetki;
    if (!tamYetki) void y.tamYetkiKapandi();
  });
  ornek = y;
  return y;
}

/** Kapanışta beklenecek bir şey var mı (yaşayan Claude Code süreci). */
export const ccKapanisGerekli = () => Boolean(ornek && !kapandi && ornek.surecler().length);

/** Uygulama kapanırken: önce interrupt, en çok 5 sn, sonra kapat; kalan süreç ağacıyla öldürülür. */
export async function ccKapat(): Promise<void> {
  if (!ornek || kapandi) return;
  kapandi = true;
  try { await ornek.hepsiniKapat(); } catch (e) { console.warn('[claude-code] kapanış:', (e as Error).message); }
}
