// ── Arayüz → ana süreç çağrıları ─────────────────────────────────────────────────────────────────────────────
// Preload yalnız buradaki kanalları açar (beyaz liste: KANALLAR). Sırlar arayüze DÖNMEZ; yalnız yazılır.
import { ccTara, ccBul } from './claudecode/indeks.js';
import { ccAra } from '../shared/cc-ara.js';
import { terminaldeAc, claudeYolu } from './claudecode/baslat.js';
import { chromeBilgisi } from './chrome-baglanti.js';
import { ccYonetici, ccProjeKlasoru, ccSecilenKlasorler, ccGuvenDeposu } from './claudecode/yonetim.js';
import { ccAuthDurumu, ccGirisBaslat, etkinAjanMetni, gitOzeti, gitFark, projeDosyalari } from './claudecode/yurutucu.js';
import { eklentiKurucu, eklentileriBaslat } from './claudecode/eklenti-yonetim.js';
import { dokumOku, oturumDosyasiBul, baskaYerdeAcik, projeleriTopla, claudeMdOku, claudeMdYaz, dosyaEslestir } from './claudecode/dokum.js';
import type { CcBaslatIstegi, CcIzinYaniti } from './claudecode/oturum-yoneticisi.js';
import { CC_KAPALI_OTURUM } from '../shared/cc-olay.js';
import { sinyal } from './beyin.js';
import { yerelDurumu, yerelDene } from './yerel/durum.js';
import { yerelKur, yerelKaldir, yerelIndirmeyiDurdur, modelKuruluMu, yerelInenModel, bekleyenYaz, bekleyenTamamla, bekleyenSil, bekleyenHata, bekleyenGizli, yarimlariTemizle, yerelKaldiriliyorMu, bekleyenSilYamasi, bekleyenHataYamasi } from './yerel/kurulum.js';
import { MODEL_SUNULMUYOR } from '../shared/yerel-bekleyen.js';
import { bekleyenleGizliyiDenetle, gizliDegisti, gizliKapat, gizliNotunuKapat, gizliyiGeriAlGerekirse } from './yerel/gizli-geri-al.js';
import { KURULUM_SURUMU, isProfiliMetni, isProfiliSuz, sessizSaatleri } from '../shared/kurulum-adimlari.js';
import { YENILIK_SURUMU } from '../shared/yenilik.js';
import { kuruluOrtamUyarilari } from '../shared/ortam-kapisi.js';
import { yerelKurUygunlugu } from './yerel/uygunluk.js';
import { BAGLANTI_DENENMEZ, neredeYerelMi } from '../shared/nerede.js';
import { katalogBul } from './yerel/katalog.js';
import { yerelTaban, yerelDurdurBekle, yerelYenidenBaslat } from './yerel/sunucu.js';
import { yerelTekMotorMu, yalnizYerelSeciliMi } from './motor/yerel.js';
import { sohbetGirdisi } from '../shared/sohbet-girdisi.js';
import { sohbetGorselleri, sohbetEkleri } from '../shared/ek-kural.js';
import { piperKapatBekle, eskiyiTasi } from './yerel/piper.js';
import { belgeListesi, belgeSil } from './belge-depo.js';
import { genelKisayolSorunu, type KisayolDurumu } from '../shared/genel-kisayol.js';
import { silmeKuyrugu, silmeIslemiOku, silmeKuyruguKaydet, type SilmeKuyrugu } from './silme-kuyrugu.js';
import { beyinDurumu } from './beyin.js';
import { ipcMain, shell, dialog, BrowserWindow, app } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ayarlar, ayarlariKaydet, sirYaz } from './ayarlar.js';
import { temaGocu } from '../shared/tema-cozum.js';
import { ayarKaydiniSuz } from './ayar-kaydi.js';
import { sirYazmaReddi } from './sir-izni.js';
import { claudeRolSecimi, openaiRolModeli } from '../shared/motor-secimi.js';
import { saglayici, hazirMotorlar, VARSAYILAN_MODEL, yardimciMetin, motorCalistiIsaretle } from './motor/secici.js';
import { kullanimOzeti, type KullanimPenceresi } from './motor/kullanim.js';
import { modelListesi, modelOnbelleginiSil, testModelKaynagi } from './motor/model-listesi.js';
import type { ModelKaynagi } from '../shared/model-bilgisi.js';
import { anaSohbet, sohbetListesi, gorunenMesajlar, sohbetOlustur, sohbetArsivle, okunduIsaretle, sohbetBaslikYaz } from './sohbet.js';
import { yanitla, durdur, mesgulMu } from './ajan/dongu.js';
import { onayYanitla, onayIste, yayinla, type OnayKarari } from './olaylar.js';
import { surecDinle, surecListesi, surecCiktisi, surecDurdur } from './ajan/surec-yoneticisi.js';
import { isIziListesi } from './is-izi.js';
import { toplantiAl, toplantiAyar, toplantiBaglam, toplantiBasladi, toplantiBaslat, toplantiDurdur, toplantiDurumu, toplantiGecmisi, toplantiHazirlik, toplantiOlay, toplantiParca, toplantiSesiYeniden, toplantiSil, toplantiVazgecildi, toplantiWhisperIndir, toplantiKaynakHatasi, toplantiTercihYaz, toplantiGemini, toplantiWindowsMikrofonAyari } from './toplanti.js';
import { sistemBilgisi } from './sistem-kontrol.js';
import { adaGonder, adaKontrol, adaGorevAdimi, adaPencere, adaTestDurumu, adaBos, adaOdaktaMi, adaAnaOndeYenile, adaHatirlatmaDurumu, adaOlcek } from './ada.js';
import { saatiKaydir } from './saat.js';
import { testBildirimKaydi, hatirlaticilariIsle, proaktifBildir, tanismaYap } from './zamanlayici.js';
import type { AdaKaynak } from '../shared/ada.js';
import { tamEkranTestAyarla } from './tam-ekran.js';
import { olayYardimcisiTestKomutu, centikMedyasi, sistemDurumu, medyaKomutu } from './olay-yardimcisi.js';
import { sozIstegi } from './soz.js';
import { kokpitDurumu, kokpitYenile } from './kokpit/duzen.js';
import { isListesi, isDurdur, isSurdur } from './isler/zamanlayici.js';
import { panoDurumu, panoYenile } from './pano/pano.js';
import { hafizaListesi, hafizaAra, hafizaEkle, hafizaGuncelle, hafizaSil, hafizaSayisi } from './hafiza/depo.js';
import { hafizaYaz } from './hafiza/yazici.js';
import { hatirlaticiGuncelle, gorevGuncelle, oneriKapat, hatirlaticiEkle, kokpitYapilacaklari, yapilacakEkle } from './planlama.js';
import { odakYoneticisi, odakKur } from './odak.js';
import { rafYoneticisi, rafSurukle, rafGonderenGecerliMi } from './raf.js';
import { odakAdimGirdisi, yapilacakGirdisi } from '../shared/odak.js';
import { HAZIR_AYARLAR, hesapKaydet, hesapSil, hesapSina, hesapDene, esitle, degisenBaglantilarinParolasiniSil } from './entegrasyon/eposta.js';
import { whatsappBaslat, whatsappCikis, whatsappDurumu, whatsappLisanslari } from './entegrasyon/whatsapp-kapisi.js';
import { mcpKaydet, mcpSil, mcpSina, claudeCodeMcpleri } from './entegrasyon/mcp.js';
import { mcpKatalogGorunumu, mcpBagla, mcpBaglantiyiKes } from './entegrasyon/mcp-katalog.js';
import { centikVerisi } from './centik-veri.js';
import { iceAktarmaDurumu, iceAktarKlasoru, dosyaEkle, dosyaBirak, ekMetniOku } from './iceaktar.js';
import { videoHazirla, videoIptal } from './video-isle.js';
import { tarayiciGoster, tarayiciDurumu, tarayiciGit, gezin, tarayiciAlani, tarayiciSekme, tarayiciOturumlari, tarayiciOturumKapat, tarayiciSayfasi, tarayiciCalismaTemizle, tarayiciTestCalisiyor, tarayiciTestArac, tarayiciTestNotlari, tarayiciTestAyril, type GezinmeEylemi } from './tarayici.js';
import { sorMetni } from '../shared/tarayici.js';
import { MESGUL_MESAJI } from '../shared/mesgul.js';
import { bilgisayarDene } from './bilgisayar.js';
import { dusunmeDurumu, kulakAyari, bolumAl, notTutucuCalistir, raporCalistir } from './gunkaydi/dusunme.js';
import type { UyandirmaDurumu } from '../shared/uyandirma-ayar.js';
import { gunDokumu, maddeler, raporlar, meseleler, meseleGuncelle, gunKaydiniSil } from './gunkaydi/depo.js';
import { whisperKur, whisperKaldir } from './gunkaydi/whisper.js';
import { sesBilgisi, yedekSesiKur, konusmaBaslat, konusmaEkle, konusmaBitir, sesKes, sesOlcum, dinlemeBaslat, dinlemeParca, dinlemeBitir, dinlemeIptal, dikteYokSatiri } from './ses.js';
import { yedekBildirici } from './yerel/piper.js';
import type { RaporTuru } from '../shared/tipler.js';
import { yollar } from './yollar.js';
import { veritabani } from './vt.js';
import { etkinTema, camVarMi, opakSahneKur } from './tema.js';
import { motorDurumu } from './abonelik.js';
import { spawn } from 'node:child_process';
import {
  INDIRILEN, YEDEKLER, klasorBoyutuSinirli, veriIslemiIste, veriOzeti, yedekSayisi, yedekleriSil, yenidenKurulumIsaretiniSil, yenidenKurulumVar,
} from './veri/temizlik.js';
import type { VeriDurumu, VeriIslemYaniti } from '../shared/veri-islemi.js';
import { motorHataMetni } from '../shared/abonelik.js';
import { hitapMetni } from '../shared/hitap.js';
import { acilisKapisi, acilisOlayiYaz, acilisOlaylari } from './acilis.js';
import type { Ayarlar, SaglayiciAdi, Durum, HafizaTuru } from '../shared/tipler.js';

export interface PencereKontrolu {
  /** `dinle`: sesle sor (yoksa soru kutusu); `odakla`: klavye odağı (varsayılan: dinlerken). */
  asistanGoster: (dinle?: boolean, odakla?: boolean) => void;
  /** `cekildi`: ada arayüzü şekli çoktan topladı (geri çekilmenin sonu); verilmezse (kısayol, tepsi) ada önce geri çekilir. */
  asistanGizle: (cekildi?: boolean) => void;
  anaGoster: (yol?: string) => void;
  kulakYenile: () => void;
  /** false: yeni asistan kısayolu alınamadı (eskisi çalışmaya devam ediyor). */
  kisayollariKaydet: () => boolean;
  /** Genel kısayollar gerçekten alındı mı (acil durdurma, asistan): alınamayan tuş arayüzde söz verilmez. */
  kisayolDurumu: () => KisayolDurumu;
  /** Kulak penceresinden gelen ses olayı ('uyandi' | 'seviye' | 'kismi' | 'metin' | 'bos' | 'hata') → asistana. */
  kulakOlay: (v: { tur: string; [k: string]: unknown }) => void;
  uyandirmaDurumu: () => UyandirmaDurumu;
  /** Kulağa komut ('dinle' | 'bekle'); kulak açık değilse false. */
  kulakKomut: (v: { tur: 'dinle' | 'bekle' | 'devam'; ms?: number }) => boolean;
  /** Ada: imleç adanın şeklinin üstünde (true) → tıklamayı yakala; değil (false) → alttaki uygulamaya geçir. */
  adaFare: (uzerinde: boolean, durdur?: boolean) => void;
  /** Asistan kısayolunun kendisi (ada açıksa kapatır, değilse açıp dinler); yalnız FUBER_DEMO test kancası çağırır. */
  asistanKisayolu: () => void;
  /** Acil durdurma (Alt+Shift+Q ile aynı yol): bütün turlar, bilgisayar kontrolü ve girdi yardımcısı; Fuber Tarayıcı'nın "Durdur"u. */
  acilDurdur: () => void;
  /** 0.11 G2: uygulama normal çıkış yoluyla kapanır ve yeniden açılır (bekleyen veri işlemi açılışta, dosyalar açılmadan uygulanır). */
  yenidenAc: () => void;
  /** 0.11 G2: uygulama normal çıkış yoluyla kapanır ("Fuber'i kaldır": kaldırıcı ayrık başladıktan sonra). */
  kapat: () => void;
}

// Görev 21: ses anahtarı yalnız ElevenLabs (Azure/Google Cloud sesleri kalktı; eski kayıtları silmek için adları hâlâ kabul edilir).
const SIR_ADLARI = /^(api:(anthropic|openai|openrouter|elevenlabs|azure-ses|google-ses))$/;

export function durum(): Durum {
  const a = ayarlar();
  return {
    surum: app.getVersion(),
    kurulumTamam: a.kurulumTamam,
    motorlar: (['anthropic', 'openai', 'openrouter'] as SaglayiciAdi[]).map((ad) => ({ ad, hazir: hazirMotorlar().includes(ad) })),
    whatsapp: whatsappDurumu().durum,
    bilgisayarKontrolu: a.yetki.bilgisayar,
    // 0.12 H6 (P12): kurulu uygulamanın yok saydığı ortam değişkenleri (yalnız adlar; Ayarlar → Genel → Hakkında). Paketsizde boş.
    ortamUyarilari: kuruluOrtamUyarilari().map((u) => u.split(' ')[0]),
    // İsteğe bağlı modüllerle pakete girenlerin bildirimleri (Hakkında); modülsüz derlemede alan yok.
    ...(whatsappLisanslari().length ? { ozelLisanslar: [...whatsappLisanslari()] } : {}),
  };
}

function claudeCodeHafizaDosyalari(): string[] {
  const kok = path.join(os.homedir(), '.claude', 'projects');
  const out: string[] = [];
  try {
    for (const p of fs.readdirSync(kok)) {
      const m = path.join(kok, p, 'memory');
      if (!fs.existsSync(m)) continue;
      for (const f of fs.readdirSync(m)) if (f.endsWith('.md')) out.push(path.join(m, f));
    }
  } catch { /* Claude Code yok */ }
  return out;
}


/** Çekirdek hafızadaki "Kullanıcının adı" kaydını ayarlardaki ad + hitapla yazar (yoksa ekler). */
function kimlikHafizasiniYaz(): void {
  const a = ayarlar();
  const icerik = `Adı ${a.kullaniciAdi}; ona HER ZAMAN "${hitapMetni(a.kullaniciAdi, a.hitap)}" diye hitap edilir.`;
  const var_ = veritabani().prepare("SELECT id FROM hafizalar WHERE tur = 'kullanici' AND baslik = 'Kullanıcının adı' AND silindi = 0 ORDER BY id LIMIT 1").get() as { id?: number } | undefined;
  if (var_?.id) hafizaGuncelle(Number(var_.id), { icerik, sabit: true, onem: 5 });
  else hafizaEkle({ tur: 'kullanici', baslik: 'Kullanıcının adı', icerik, sabit: true, onem: 5, kaynak: 'ayarlar' });
}

/** 0.10 E4 (K6): kurulumun "İşin" ve "Günün" seçimleri TEK sabit hafıza kaydında ("İşi ve günü"; yeniden açılan sihirbaz aynı kaydı
 *  günceller — ikinci kayıt açılmaz). Fuber kişiyi bununla tanır (rol, şirket, çalışma saatleri). */
function isHafizasiniYaz(): void {
  const icerik = isProfiliMetni(ayarlar().isProfili);
  if (!icerik) return;
  const var_ = veritabani().prepare("SELECT id FROM hafizalar WHERE tur = 'kullanici' AND baslik = 'İşi ve günü' AND silindi = 0 ORDER BY id LIMIT 1").get() as { id?: number } | undefined;
  if (var_?.id) hafizaGuncelle(Number(var_.id), { icerik, sabit: true, onem: 4 });
  else hafizaEkle({ tur: 'kullanici', baslik: 'İşi ve günü', icerik, sabit: true, onem: 4, kaynak: 'kurulum' });
}

let silme: SilmeKuyrugu | null = null;
/** Normal çıkışta (before-quit, oturum kapanışı): bekleyen "Geri al"lı silmeler şimdi uygulanır (main.ts). */
export function bekleyenSilmeleriUygula(): void {
  try { silme?.hepsiniUygula(); } catch (e) { console.warn('[silme] çıkışta uygulanamadı:', (e as Error).message); }
}
/** "Geri al" tostlarının duraklatması takılı kalmasın (düzeltme turu 2): ana pencere gizlenince, küçülünce, odağı kaybedince ya da
 *  arayüz yeniden yüklenince (fare ayrılma olayı hiç gelmeyebilir) bütün gruplar kalan sürelerinden sürer (main.ts). */
export function silmeleriSurdur(): void {
  try { silme?.duraklat(false); } catch { /* kuyruk yok */ }
}

export function ipcKur(p: PencereKontrolu): void {
  // Handler registry (kept for tests that call IPC handlers directly).
  const isleyiciler = new Map<string, (...a: any[]) => unknown>();
  const h = (kanal: string, f: (...a: any[]) => unknown) => { isleyiciler.set(kanal, f); ipcMain.handle(kanal, (_e, ...a) => f(...a)); };
  /** Pencereye bağlı işleyici (Görev 21: Fuber'in sesi ve dinleme olayları ÇAĞIRAN pencereye gider). Köprü haritasına girmez: telefondan
   *  çağrılamaz (kanal ayrıca UZAKTAN_KAPALI). */
  const hp = (kanal: string, f: (wc: Electron.WebContents, ...a: any[]) => unknown) => { ipcMain.handle(kanal, (e, ...a) => f(e.sender, ...a)); };
  /** 0.14 T27 (I1): Raf kanalları yalnız çentik penceresinden kabul edilir (`event.sender`); köprü haritasına reddeden bir kukla yazılır (telefon zaten UZAKTAN_KAPALI). */
  const hr = (kanal: string, f: (...a: any[]) => unknown) => {
    isleyiciler.set(kanal, () => { throw new Error('Raf yalnız çentikten kullanılır'); });
    ipcMain.handle(kanal, (e, ...a) => { if (!rafGonderenGecerliMi(e?.sender)) throw new Error('Raf yalnız çentikten kullanılır'); return f(...a); });
  };

  // ── Ayarlar, sırlar, durum ──
  h('ayarlar:al', () => ayarlar());
  h('kisayol:durum', () => p.kisayolDurumu());
  h('ayarlar:kaydet', (d: Partial<Ayarlar>) => {
    // Kurulum sürümü ve bekleyen yerel kurulum kaydı yalnız kendi akışlarıyla değişir: bayat bir arayüz kopyası onları geri
    // almasın (ayar-kaydi.ts; tests/ayar-kaydi.test.ts).
    d = ayarKaydiniSuz(d, ayarlar().mod);
    const once = ayarlar();
    const kisayol = once.ses.kisayol, uyandirma = once.ses.uyandirma, baslangic = once.baslangictaAc, gunKaydiAcik = once.gunKaydi.etkin, mikrofonKapali = once.ses.mikrofonKapali;
    const gizliOnce = once.yerel.gizliMod === true;
    const kimlik = `${once.kullaniciAdi}|${once.hitap}`;
    // 0.10 E4: iş profili (yeniden açılan sihirbazın "İşin"/"Günün"u) süzülür — bilinmeyen rol, geçersiz saat yazılmaz; şirket kırpılır.
    const isOnce = JSON.stringify(once.isProfili ?? null);
    if (d && 'isProfili' in d) { const p = isProfiliSuz(d.isProfili, once.isProfili); if (p) d.isProfili = p; else delete d.isProfili; }
    const oncekiEposta = structuredClone(once.eposta); // ayar nesnesi yerinde değişebilir: önceki bağlantılar kopyadan karşılaştırılır
    let yeni = ayarlariKaydet(d);
    // Düzeltme turu 2 (C1 kardeşi): bir e-posta hesabının sunucu/port/kullanıcı/güvenli alanı genel ayar kaydıyla değiştiyse kayıtlı
    // parolası silinir — parola yalnız kaydedildiği sunucuya gider.
    if (Array.isArray(d.eposta) && degisenBaglantilarinParolasiniSil(oncekiEposta, yeni.eposta).length) yeni = ayarlar();
    // Ad/hitap değişince çekirdek hafıza ve kokpit selamı da değişsin (eskiden ayarda kalıyor, Fuber eski hitabı kullanıyordu).
    if (`${yeni.kullaniciAdi}|${yeni.hitap}` !== kimlik && yeni.kurulumTamam) { kimlikHafizasiniYaz(); void kokpitYenile('hitap değişti', true); }
    if (JSON.stringify(yeni.isProfili ?? null) !== isOnce) {
      // Çalışma saatleri DEĞİŞTİYSE sessiz saat de (kurulum:tamamla ile aynı kural; yalnız rol/şirket değişince Ayarlar'daki elle
      // seçilmiş sessiz saate dokunulmaz); hafızadaki tek "İşi ve günü" kaydı güncellenir.
      const p = yeni.isProfili;
      const onceki = JSON.parse(isOnce) as { gunBas?: string; gunBit?: string } | null;
      const saatDegisti = Boolean(p?.gunBas && p.gunBit) && (p?.gunBas !== onceki?.gunBas || p?.gunBit !== onceki?.gunBit);
      const s = saatDegisti && p?.gunBas && p.gunBit ? sessizSaatleri(p.gunBas, p.gunBit, yeni.proaktif.sabahOzeti) : null;
      if (s) yeni = ayarlariKaydet((a) => { Object.assign(a.proaktif, s); });
      if (yeni.kurulumTamam) isHafizasiniYaz();
    }
    // Yeni kısayol alınamadıysa ayar eskisine döner (eskisi hâlâ kayıtlı; ayar çalışmayan kısayolu göstermesin). Yasak kümedeki
    // kısayol (Ctrl+Alt = AltGr karakter yazar; sistem/yaygın uygulama kısayolu; shared/genel-kisayol.ts) hiç alınmaz (Görev 20b).
    if (yeni.ses.kisayol !== kisayol && (genelKisayolSorunu(yeni.ses.kisayol) || !p.kisayollariKaydet())) yeni = ayarlariKaydet((a) => { a.ses.kisayol = kisayol; });
    // Mikrofon tamamen kapandı/açıldı: kulak penceresi kapanır/açılır (mikrofon gerçekten bırakılır).
    if (yeni.ses.uyandirma !== uyandirma || yeni.gunKaydi.etkin !== gunKaydiAcik || yeni.ses.mikrofonKapali !== mikrofonKapali) p.kulakYenile();
    if (yeni.baslangictaAc !== baslangic) app.setLoginItemSettings({ openAtLogin: yeni.baslangictaAc, args: ['--gizli'] });
    // F1 (Ö1): Gizli'den çıkmak serbest — kapatılınca bekleyen kurulumun "bitince Gizli modu aç" isteği düşer; açılınca eski not kalkar.
    if ((yeni.yerel.gizliMod === true) !== gizliOnce) { gizliDegisti(gizliOnce, yeni.yerel.gizliMod === true); yeni = ayarlar(); }
    return yeni;
  });
  // Ekranda geçerli tema ("Otomatik" ve Şeffaf desteği çözülmüş) + bu bilgisayarda Şeffaf var mı. Değişince 'tema:degisti' yayınlanır (main/tema.ts).
  h('tema:etkin', () => ({ tema: etkinTema(), cam: camVarMi() }));
  // Kurulum / Tekrar hoş geldin açıkken pencere opak olur (0.13 T13): sistem malzemesi kalkar, kapanınca tema geri gelir.
  h('tema:sahne', (opak: unknown) => { opakSahneKur(opak === true); return true; });
  h('sir:yaz', (ad: string, deger: string | null) => {
    if (!SIR_ADLARI.test(ad)) throw new Error('Geçersiz sır adı');
    // 0.13 T15 (Spec H): kimse yapay zekâ API anahtarı girmez — yeni motor anahtarı yazılmaz (silmek serbest; eski kayıtlar zaten okunmaz).
    // 0.14 (ürün kararı; 5 Kas: Business'ta da): Anthropic (Claude) anahtarı, biçimi geçerliyse (sir-izni.ts sirYazmaReddi).
    if (typeof deger === 'string') deger = deger.trim();
    const red = sirYazmaReddi(ad, deger, ayarlar().mod);
    if (red) throw new Error(red);
    sirYaz(ad, deger);
    const s = ad.split(':')[1] as SaglayiciAdi;
    // Ses anahtarları (elevenlabs, azure-ses, google-ses) motor değildir; yalnız motorlarda 'etkin' işaretlenir.
    if (deger && s in ayarlar().saglayicilar) ayarlariKaydet((a) => { a.saglayicilar[s].etkin = true; });
    // Yeni anahtar: model seçici listeyi yeniden alsın — ana süreç önbelleği silinir, arayüzler kendi önbelleğini olayla siler.
    if (s in ayarlar().saglayicilar) { modelOnbelleginiSil(s); yayinla('motor:anahtar-degisti', { saglayici: s }); }
    return ayarlar();
  });
  h('durum:al', () => durum());
  h('motor:sina', async (ad: SaglayiciAdi) => {
    // H3c düzeltme turu 2: Gizli / "Yalnız bu bilgisayar" seçiliyken "Bağlantıyı dene" buluta istek göndermez (telefondan da).
    if (neredeYerelMi(ayarlar().yerel)) return { tamam: false, hata: BAGLANTI_DENENMEZ };
    try {
      const modeller = await saglayici(ad).modeller().catch(() => [] as string[]);
      const y = await saglayici(ad).sohbet({
        // 0.14: Claude denemesi kullanıcının yardımcı rol için seçtiği Claude modeliyle (Ayarlar → Yapay zekâ sağlayıcısı).
        model: ad === 'anthropic' ? claudeRolSecimi(ayarlar(), 'yardimci').model
          // Açık kaynak hazırlığı: kendi OpenAI uyumlu sağlayıcın yardımcı rolünün modeliyle denenir.
          : ad === 'openai' && openaiRolModeli(ayarlar(), 'yardimci') ? openaiRolModeli(ayarlar(), 'yardimci')!
          : ayarlar().modeller.yardimci.saglayici === ad ? ayarlar().modeller.yardimci.model : VARSAYILAN_MODEL[ad].yardimci,
        sistemSabit: 'Kısa yanıt ver.', mesajlar: [{ rol: 'user', bloklar: [{ tur: 'metin', metin: 'Sadece "hazır" yaz.' }] }], araclar: [], maxToken: 400, arkaPlan: true,
      });
      motorCalistiIsaretle(); // 0.10 Görev 2 (P3): başarılı bağlantı denemesi motorun çalıştığını gösterir
      return { tamam: true, modeller, yanit: y.bloklar.map((b) => (b.tur === 'metin' ? b.metin : '')).join('').slice(0, 60), model: y.model };
    } catch (e) {
      return { tamam: false, hata: (e as Error).message };
    }
  });
  // Son bütün dal incelemesi Ö-2: Gizli / "Yalnız bu bilgisayar" seçiliyken liste isteği anahtarı buluta taşır — ağa çıkmadan boş liste (telefondan da).
  h('motor:modeller', (ad: SaglayiciAdi) => (neredeYerelMi(ayarlar().yerel) ? [] : saglayici(ad).modeller().catch(() => [])));
  // Model seçici: sağlayıcının ayrıntılı listesi (anahtarsızda ağa çıkmadan yerleşik tablo) ya da yerel modeller (main/motor/model-listesi.ts).
  h('motor:model-bilgileri', (s: ModelKaynagi) => modelListesi(s));
  if (process.env.FUBER_DEMO) {
    // Model listesi test kancası: YALNIZ FUBER_DEMO'da kayıtlı, üretimde hiç yok.
    // Sağlayıcının ham /models yanıtı (kayıtlı örnek JSON) verilir; liste gerçek dönüşümle ondan üretilir, ağa çıkılmaz. null: kaldır.
    h('motor:test-model-kaynagi', (s: SaglayiciAdi, ham: unknown) => testModelKaynagi(s, ham));
  }
  // Son N gün (sayı) ya da { baslangic: ISO } (İş modunda "bu ay"); maliyet okuma anında model bilgisinden (main/motor/kullanim.ts).
  h('kullanim:ozet', (p: KullanimPenceresi) => kullanimOzeti(p));

  // ── Kurulum ──
  // 0.10 E4 (K6): `isProfili` ("İşin": rol, şirket; "Günün": çalışma saatleri) ayara ve tek sabit hafıza kaydına; `sabahOzeti` '' = kapalı
  // (Günün sayfasında kapatıldı) — yalnız `sabahOzeti` hiç gönderilmediyse eski değer kalır. hakkinda/projeler eski sihirbazdan (isteğe bağlı).
  // 0.13 T5 (spec B): `tema` Görünüm adımının seçimi; kurulumu bitiren yazımla uygulanır, kurulum penceresi o ana dek opak ve eski temada kalır.
  // 0.13 T6: `mod` kurulumun son kip seçimi — kip kartının anlık kaydı (fire-and-forget) yarışta kalsa da son kip burada kesinleşir; geçersiz değer yazılmaz.
  h('kurulum:tamamla', async (v: { baslangictaAc?: unknown; kullaniciAdi: string; hitap: string; hakkinda?: string; projeler?: string; claudeHafiza: boolean; sabahOzeti?: string; isProfili?: unknown; tema?: unknown; mod?: unknown }) => {
    const baslangicOnce = ayarlar().baslangictaAc;
    ayarlariKaydet((a) => {
      a.kullaniciAdi = (v.kullaniciAdi ?? '').trim();
      a.hitap = (v.hitap ?? '').trim();
      // 0.13.1: "Windows açılınca başlat" (Günün; varsayılan açık) kurulum bitince uygulanır; sabah özeti Fuber kapalıyken gelmez.
      if (typeof v.baslangictaAc === 'boolean') a.baslangictaAc = v.baslangictaAc;
      if (typeof v.sabahOzeti === 'string') a.proaktif.sabahOzeti = v.sabahOzeti;
      const p = isProfiliSuz(v.isProfili, a.isProfili);
      if (p) a.isProfili = p;
      // Çalışma saatleri sessiz saate eşlenir (zamanlayici.ts sessizMi: mesai dışında yalnız hatırlatıcılar).
      const s = p?.gunBas && p.gunBit ? sessizSaatleri(p.gunBas, p.gunBit, a.proaktif.sabahOzeti) : null;
      if (s) Object.assign(a.proaktif, s);
      if (v.tema !== undefined) a.gorunum.tema = temaGocu(v.tema, a.gorunum.tema);
      if (v.mod === 'is' || v.mod === 'gelistirici') a.mod = v.mod;
      a.kurulumTamam = true;
      a.kurulumSurumu = KURULUM_SURUMU; // bu sürümün bütün adımlarını gördü: yükseltme sihirbazı açılmaz
      a.yenilikSurumu = YENILIK_SURUMU; // 0.11 G12b: yeni kurulum için "yeni" bir şey yok — sürümün "yeni" kartı (0.12’de yeni) hiç açılmaz (shared/yenilik.ts)
    });
    // Windows/Mac açılış öğesi YALNIZ paketli uygulamada yazılır (main.ts açılıştaki kuralla aynı); test ve önizleme kipinde ayrıca arka-plan-test.ts
    // setLoginItemSettings'i etkisizleştirir (tests/arka-plan.test.ts): bu bilgisayarın başlangıç kayıtlarına hiçbir koşu yazmaz.
    if (app.isPackaged && ayarlar().baslangictaAc !== baslangicOnce) app.setLoginItemSettings({ openAtLogin: ayarlar().baslangictaAc, args: ['--gizli'] });
    // 0.11 G2: kurulum bitmeden kaldırılıp yeniden kurulmuş profilin işareti — ilk kurulum bitti, bir sonraki açılış "Tekrar hoş geldin" değil.
    try { yenidenKurulumIsaretiniSil(yollar.veri()); } catch { /* yoktu */ }
    if (v.kullaniciAdi) kimlikHafizasiniYaz();
    isHafizasiniYaz();
    if (v.hakkinda?.trim()) {
      hafizaEkle({ tur: 'kullanici', baslik: 'Kendini anlatışı (kurulum)', icerik: v.hakkinda.trim().slice(0, 1500), sabit: true, onem: 5, kaynak: 'kurulum' });
      hafizaYaz({ kullanici: `Kendimi tanıtıyorum: ${v.hakkinda}`, asistan: 'Not aldım.', kaynak: 'kurulum' });
    }
    if (v.projeler?.trim()) hafizaYaz({ kullanici: `Yürüttüğüm projeler: ${v.projeler}`, asistan: 'Projelerini not aldım.', kaynak: 'kurulum' });
    if (v.claudeHafiza) { const d = claudeCodeHafizaDosyalari(); if (d.length) dosyaEkle(...d); }
    // Tanışma turu yalnız bir motor yolu varken (Görev 15 düzeltme 1: motor yokken çağrılsaydı ana sohbete yanlış bir "motor durdu" ⚠
    // notu ve Beyin'e hata düşerdi). G1 (F2): yol 'yerel'se (Gizli, "Yalnız bu bilgisayar" ya da bulutsuz kurulum) tanışma araçsız, kısa
    // talimatla yerel modele gider. 0.12 cila: kapı tek kuraldır (yol). Düzeltme turu 1 (I-3): yol yoksa (yapay zekâ iniyor, hesap onay
    // bekliyor) bekleme işareti yazılır; zamanlayıcı hazır olunca bir kez yapar (zamanlayici.ts tanismaYap / bekleyenTanisma).
    tanismaYap();
    void kokpitYenile('kurulum', true);
    p.kulakYenile();
    return ayarlar();
  });
  // Yükseltme sihirbazı bitti (Görev 23, K11): YALNIZ kurulum sürümü yazılır — hafızaya, sohbete, kokpite hiçbir şey yazılmaz, model
  // çağrılmaz (seçimler adımlarda ayarlar:kaydet ile zaten kaydedildi). Telefondan kapalı (kopru-protokol.ts).
  h('kurulum:yukseltme-bitti', () => ayarlariKaydet((a) => { a.kurulumSurumu = Math.max(a.kurulumSurumu ?? 0, KURULUM_SURUMU); }));
  h('kurulum:claude-hafiza-sayisi', () => claudeCodeHafizaDosyalari().length);
  // 0.11 G12b: kokpitteki sürüm yenilik kartının (0.12’de yeni) "Tamam"ı — YALNIZ işareti yazar (kart bir daha açılmaz); ikinci çağrı zararsız.
  // İşareti ayarlar:kaydet yazamaz (main/ayar-kaydi.ts). Telefondan kapalı (kopru-protokol.ts).
  h('yenilik:kapat', () => ayarlariKaydet((a) => { a.yenilikSurumu = YENILIK_SURUMU; }));
  // Sistem kontrolü (kurulumun ikinci adımı): salt okur; mikrofonu arayüz sayar. Telefondan kapalı (kopru-protokol.ts).
  h('sistem:kontrol', () => sistemBilgisi());
  if (process.env.FUBER_DEMO) {
    // Kurulum önizlemesi (scripts/dev/kurulum-onizle.mjs) için kanca: YALNIZ FUBER_DEMO'da kayıtlı, üretimde hiç yok. Anahtarsız
    // demoda motor adımı geçilsin diye pencerelere "Claude bağlı" görünen bir ayar kopyası yayınlanır; ana süreçte motor BAĞLANMAZ
    // (anahtar yazılmaz, hazirMi false kalır → model çağrısı ve ağ isteği olmaz). Sonraki gerçek ayar yayını bunu geri alır.
    h('kurulum:test-motor', () => {
      const a = structuredClone(ayarlar());
      a.saglayicilar.anthropic = { ...a.saglayicilar.anthropic, etkin: true, anahtarVar: true };
      yayinla('ayarlar:degisti', a);
      return a;
    });
  }

  // ── Sohbet ──
  h('sohbet:ana', () => anaSohbet());
  h('sohbet:liste', () => sohbetListesi());
  h('sohbet:mesajlar', (id: number) => gorunenMesajlar(id));
  h('sohbet:yeni', () => sohbetOlustur());
  h('sohbet:arsivle', (id: number) => sohbetArsivle(id));
  h('sohbet:baslik', (id: number, b: string) => sohbetBaslikYaz(id, b));
  h('sohbet:okundu', (id: number) => okunduIsaretle(id));
  h('sohbet:mesgul', (id: number) => mesgulMu(id));
  // false = sohbette başka yanıt sürüyor; mesaj ALINMADI (arayüz uyarır, "düşünüyor"da takılı kalmaz).
  // `uzak`: yalnız köprü verir (main/kopru.ts uzakCagir telefondan gelen her turda true yapar): telefondan gelen turda gizlilik araçları
  // yalnız daraltır (B3). Masaüstü arayüzü bunu göndermez.
  // `kaynak` (düzeltme 3; shared/sohbet-girdisi.ts): 'ses' = ada/telefonda sesle soruldu (kısa, konuşma diliyle, sesli tur); 'dikte' =
  // sohbet penceresinde sesle YAZDIRILDI — yanıtı sesle okunur ama tur kısıtlanmaz (tam araçlar, normal düşünme gücü).
  h('sohbet:gonder', (id: number, metin: string, gorseller?: { medya: string; veri: string }[], kaynak?: unknown, uzak?: unknown, ekler?: unknown) => {
    if (mesgulMu(id)) return false;
    // Analiz 11 Kas bulgu 8–12: görseller izinli türde ve sınırda (fazlası/yanlışı reddedilmez, burada süzülür: arayüz zaten denetledi); belge/video
    // ekleri metin olarak (ek:hazirla / ek:video'nun sonucu).
    const g = sohbetGorselleri(gorseller);
    const e = sohbetEkleri(ekler);
    void yanitla(id, { metin, ...(g.length ? { gorseller: g } : {}), ...(e.length ? { ekler: e } : {}), ...sohbetGirdisi(kaynak), uzak: uzak === true });
    return true;
  });
  h('sohbet:durdur', (id: number) => durdur(id));
  h('onay:yanitla', (id: string, karar: OnayKarari) => onayYanitla(id, karar));

  // ── Kokpit ──
  h('kokpit:al', () => kokpitDurumu());
  h('kokpit:yenile', () => kokpitYenile('kullanıcı yeniledi', true));
  h('plan:hatirlatici', (id: number, d: { durum?: string; zaman?: string }) => { const r = hatirlaticiGuncelle(id, d); void kokpitYenile('hatırlatıcı'); return r; });
  h('plan:gorev', (id: number, d: { durum?: string }) => { const r = gorevGuncelle(id, d); void kokpitYenile('görev'); return r; });
  h('plan:oneri-kapat', (id: number) => { oneriKapat(id); void kokpitYenile('öneri'); });
  // 0.11 G9: Görevler (main/isler/zamanlayici.ts; arayüzü G10). Telefondan kapalı (kopru-protokol.ts).
  h('isler:liste', () => isListesi());
  h('isler:durdur', (id: number) => isDurdur(Number(id), 'kullanici'));
  h('isler:surdur', (id: number) => isSurdur(Number(id)));
  // 0.14 T24: çentik panelinin Gündem, Görevler ve Gelenler sayfaları (main/centik-veri.ts; takvim en çok 15 dk'da bir, Gizli'de son kopyadan).
  h('centik:veri', () => centikVerisi());
  // 0.14 T25: Müzik ve Şarkı sözü — medya hâli (sonrası 'ada:medya' olayıyla), medya komutu yalnız olay yardımcısına (medya tuşu yok; oturum yoksa false),
  // çalan parçanın sözü (main/soz.ts: LRCLIB 6 sn, önbellek, Gizli'de istek yok; yeni istek süreni keser, en geç 8 sn).
  h('medya:al', () => centikMedyasi(sistemDurumu()));
  h('medya:komut', (k: unknown) => medyaKomutu(k));
  h('soz:getir', (m: unknown) => sozIstegi(m));
  // 0.14 T26: Odak (main/odak.ts; sayım ana süreçte, tek setTimeout; arayüz yalnız adım ister, 'bitti' diyemez) ve Yapılacaklar (kokpitin listesi: açıklar + bugünün
  // işaretlileri; ekleme `gorevler` tablosuna, saat verilirse hatırlatıcıyla; işaretleme mevcut plan:gorev). Hepsi yerel; telefondan kapalı.
  h('odak:al', () => odakYoneticisi().durum());
  h('odak:adim', (o: unknown) => { const a = odakAdimGirdisi(o); return a ? odakYoneticisi().adim(a) : odakYoneticisi().durum(); });
  h('yapilacak:liste', () => kokpitYapilacaklari(new Date(), 200));
  h('yapilacak:ekle', (g: unknown) => { const x = yapilacakGirdisi(g); if (!x) return null; const r = yapilacakEkle(x); void kokpitYenile('görev'); return r; });
  // 0.14 T27: Raf (main/raf.ts; dosya kopyalanmaz, yalnız yol; açma ve sürükleme yalnız öğe kimliğiyle, listede olmayan reddedilir; çalıştırılabilir türler açılmaz).
  hr('raf:liste', () => rafYoneticisi().liste());
  // Yeni öğe: preload'un `rafBirak` köprüsü (gerçek bırakılan File + webUtils.getPathForFile); genel kanal listesinde YOK, yol dizisini arayüz kendisi gönderemez.
  hr('raf:birak', (g: unknown) => rafYoneticisi().ekle(g && typeof g === 'object' ? (g as { yollar?: unknown; metin?: unknown }) : {}));
  hr('raf:ac', (id: unknown) => rafYoneticisi().ac(id));
  hr('raf:sil', (id: unknown) => rafYoneticisi().sil(id));
  hr('raf:surukle', (id: unknown) => rafSurukle(id));
  // Kayıtlı sayım yüklenir (kapalıyken bittiyse sayılır, sürüyorsa zamanlayıcı kurulur) ve uyku/ekran kilidi dönüşü dinlenir.
  try { odakKur(); } catch (e) { console.warn('[odak] kurulamadı:', (e as Error).message); }
  // Pano (Görev 24, K14): önbellekten anında; bayat kaynaklar arka planda tazelenir ('pano:degisti'). Yenile: açık kaynaklar şimdi.
  h('pano:al', () => panoDurumu());
  h('pano:yenile', () => panoYenile());

  // ── Hafıza ──
  h('hafiza:liste', (o: { tur?: string; sabit?: boolean; limit?: number; sayfa?: number }) => hafizaListesi(o ?? {}));
  h('hafiza:ara', (sorgu: string) => hafizaAra({ sorgu, limit: 40 }));
  h('hafiza:kaydet', (x: { tur: HafizaTuru; baslik: string; icerik: string; etiketler?: string[]; sabit?: boolean; onem?: number }) => hafizaEkle({ ...x, kaynak: 'kullanici' }));
  // Arayüz yalnız düzenlenebilir alanları değiştirir; kaynak/kimlik gibi alanlar süzülür.
  h('hafiza:guncelle', (id: number, d: Record<string, unknown>) => {
    const izinli = ['tur', 'baslik', 'icerik', 'etiketler', 'onem', 'sabit'] as const;
    const g: Record<string, unknown> = Object.fromEntries(Object.entries(d ?? {}).filter(([k, v]) => (izinli as readonly string[]).includes(k) && v !== undefined));
    // 0.15: Hafıza sayfasındaki iğne kullanıcının AÇIK eylemidir — kaynağa "kullanici" eklenir: çekirdek tavanı aşılınca önce kullanıcıdan gelmeyenler
    // iner (hafiza/depo.ts sabitTavaniniUygula) ve model kullanıcının kaydını ezmez; yoksa sohbetten gelmiş bir kaydın iğnesi sessizce geri alınırdı.
    if (g.sabit === true) g.kaynak = 'kullanici';
    return hafizaGuncelle(id, g);
  });
  h('hafiza:sil', (id: number) => hafizaSil(id));
  h('hafiza:sayisi', () => hafizaSayisi());
  // Hafıza → Belgeler (Görev 20b, K3). Arayüz silmeyi 5 sn "Geri al" penceresinden SONRA ister (shared/ertelenmis.ts).
  h('belge:liste', (o?: { sorgu?: string; limit?: number }) => belgeListesi(veritabani(), { sorgu: typeof o?.sorgu === 'string' ? o.sorgu.slice(0, 200) : undefined, limit: Number(o?.limit) || undefined }));
  const belgeyiSil = (id: number) => {
    const r = belgeSil(veritabani(), Number(id));
    if (r.silindi) { yayinla('hafiza:degisti', { adet: r.unutulan + r.guncellenen }); yayinla('kokpit:veri-degisti', { neden: 'belge silindi' }); }
    return r;
  };
  h('belge:sil', (id: number) => belgeyiSil(id));

  // ── Geri alınabilir silme kuyruğu (Görev 20b, K2; düzeltme turu 1): arayüz Hafıza "Unut", e-posta "Kaldır" ve belge "Sil"i burada
  // erteler; 5 sn sonra (tostun üstündeyken süre durur) ya da normal ÇIKIŞTA (main.ts before-quit → bekleyenSilmeleriUygula) uygulanır.
  // Çökmede uygulanmaz. Telefondan kapalı (telefon kendi onayıyla doğrudan siler).
  silme = silmeKuyrugu({
    uygula: (i) => {
      if (i.tur === 'hafiza') { hafizaSil(i.id); yayinla('hafiza:degisti', { adet: 1 }); yayinla('kokpit:veri-degisti', { neden: 'hafiza silindi' }); }
      else if (i.tur === 'eposta') hesapSil(i.id);
      else if (i.tur === 'toplanti') toplantiSil(i.id);
      else belgeyiSil(i.id);
    },
    degisti: (d) => yayinla('silme:degisti', d),
    hata: (anahtar, etiket, mesaj) => yayinla('silme:hata', { anahtar, etiket, mesaj }),
  });
  // I6: Fuber'in hafiza_sil aracı da bu kuyruktan geçer ("Fuber bir hafızayı sildi · Geri al").
  silmeKuyruguKaydet(silme);
  h('silme:ertele', (islem: unknown, etiket: unknown) => {
    const i = silmeIslemiOku(islem);
    if (!i) throw new Error('Geçersiz silme isteği');
    return silme!.ertele(i, String(etiket ?? ''));
  });
  h('silme:geri-al', (anahtar: unknown) => silme!.geriAl(String(anahtar ?? '')));
  // Düzeltme turu 2: duraklatma tostun grubuna (türüne) özgü; grup verilmezse bekleyen hepsi. Pencere gizlenince/odak gidince/arayüz
  // yeniden yüklenince main.ts `silmeleriSurdur` ile hepsi sürer (takılı kalmaz).
  h('silme:duraklat', (v: unknown, grup: unknown) => { silme!.duraklat(Boolean(v), typeof grup === 'string' && grup ? grup.slice(0, 40) : undefined); return silme!.durum(); });
  h('silme:durum', () => silme!.durum());

  // ── E-posta ──
  h('eposta:hazir', () => HAZIR_AYARLAR);
  // Önce sına, sonra kaydet: okuma (IMAP) geçmeyen hesap kaydedilmez (eskiden kaydedilip her eşitlemede hata veriyordu).
  // Yeniden denemede aynı hesap güncellenir (kimlik ya da aynı adres).
  h('eposta:kaydet', async (x: Parameters<typeof hesapKaydet>[0]) => {
    const sinama = await hesapDene(x);
    const hesap = sinama.imap ? hesapKaydet(x) : null;
    // "Kaldır"ın Geri al penceresinde aynı hesap yeniden eklendi: bekleyen silme iptal (yoksa 5 sn sonra yeni eklenen silinirdi).
    if (hesap) silme?.geriAl(`eposta:${hesap.id}`);
    return { hesap, sinama };
  });
  h('eposta:sil', (id: string) => hesapSil(id));
  h('eposta:sina', (id: string) => { const k = ayarlar().eposta.find((e) => e.id === id); return k ? hesapSina(k) : { imap: false, smtp: false, hata: 'yok' }; });
  h('eposta:esitle', () => esitle());

  // ── WhatsApp (11 Kas: özel modül + yetki kapısı — main/entegrasyon/whatsapp-kapisi.ts; yetki yoksa başlatmaz, ayarı da açmaz) ──
  h('whatsapp:baslat', () => whatsappBaslat());
  h('whatsapp:cikis', () => whatsappCikis());
  h('whatsapp:durum', () => whatsappDurumu());

  // ── MCP ──
  h('mcp:kaydet', (s: Parameters<typeof mcpKaydet>[0]) => mcpKaydet(s));
  h('mcp:sil', (id: string) => mcpSil(id));
  h('mcp:sina', (id: string) => { const s = ayarlar().mcp.find((x) => x.id === id); return s ? mcpSina(s) : { tamam: false, hata: 'yok' }; });
  h('mcp:claude-code', () => claudeCodeMcpleri());
  // 0.14 T16: katalog servisleri (her modda; stdio girdileri yalnız Developer). Bağla: http → tarayıcıda izin; stdio → önce komutun onay kartı, onay
  // `{ komutOzeti }` ile döner (ürün kararı). Gizli ve "Yalnız bu bilgisayar"da ağa çıkmadan reddedilir.
  h('mcp:katalog', () => mcpKatalogGorunumu());
  h('mcp:bagla', (id: string, o?: { komutOzeti?: unknown }) => mcpBagla(String(id), typeof o?.komutOzeti === 'string' ? { komutOzeti: o.komutOzeti } : {}));
  h('mcp:kes', (id: string) => mcpBaglantiyiKes(String(id)));

  // ── İçe aktarma ──
  h('iceaktar:durum', () => iceAktarmaDurumu());
  h('iceaktar:klasor-ac', () => shell.openPath(iceAktarKlasoru()));
  h('iceaktar:dosya-sec', async () => {
    const w = BrowserWindow.getFocusedWindow();
    const r = w ? await dialog.showOpenDialog(w, { properties: ['openFile', 'multiSelections'] }) : await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
    // Öğretilemeyen seçim nedeniyle bildirilir; açık seçim (A4): silinmiş belge yeniden öğrenilir, zaten öğrenilmişse söylenir.
    if (!r.canceled) for (const y of r.filePaths) dosyaBirak(y, true);
    return r.filePaths.length;
  });

  // ── Ses ve asistan (Görev 21, K9: Fuber'in TEK sesi; main/ses.ts) ──
  // Kurulum sihirbazının "Ses" adımı (G23), Ayarlar → Ses ve ada ve telefon bunları kullanır: şu anki ses + yedek ses durumu, seçilebilir
  // "Dinle" (masaüstü: ses:konus-baslat kaynak 'onizleme' + kip; telefon: ses:dene tam WAV). 0.13: ses seçilmez, ses listesi yok (ses:sesler hep boş).
  h('ses:bilgi', () => sesBilgisi());
  h('ses:yedek-kur', () => yedekSesiKur());
  yedekBildirici(() => yayinla('ses:durum', sesBilgisi()));
  // Konuşma (akışlı; olaylar çağıran pencereye 'ses:akis'): başlat → metin geldikçe ekle → bitir; Sustur/Durdur/kullanıcı konuştu → sustur.
  hp('ses:konus-baslat', (wc, o?: { kaynak?: unknown; kip?: unknown }) => konusmaBaslat(wc, o ?? {}));
  hp('ses:konus-ekle', (_wc, id: unknown, metin: unknown) => konusmaEkle(id, metin));
  hp('ses:konus-bitir', (_wc, id: unknown) => konusmaBitir(id));
  hp('ses:sustur', (wc, id?: unknown) => sesKes(wc, id));
  hp('ses:olcum', (_wc, v: { id?: unknown; ilkCalmaMs?: unknown; kaynak?: unknown }) => sesOlcum(v));
  // Konuşmadan yazıya (soru, dikte): bulutta Fuber hesabı (canlı Scribe, düşerse toplu); Gizli ve "Yalnız bu bilgisayar"da Whisper; yol yoksa 'yok' (tek satır: ses:dikte-yok; Vosk dikteye dönmez). Ara metin: 'ses:dinleme'.
  hp('ses:dinleme-baslat', (wc) => dinlemeBaslat(wc));
  hp('ses:dinleme-parca', (_wc, id: unknown, pcm: unknown) => dinlemeParca(id, pcm));
  hp('ses:dinleme-bitir', (_wc, id: unknown) => dinlemeBitir(id));
  hp('ses:dinleme-iptal', (_wc, id: unknown) => dinlemeIptal(id));
  // Dikte yolu yok ('yok') ve kullanıcı gerçekten istedi: söylenecek tek satır (yerel kipte Whisper kurulumu yalnız elle başlatılan diktede başlar; bulutta hiçbir şey inmez).
  h('ses:dikte-yok', (o?: { uyandirma?: unknown }) => dikteYokSatiri(false, o?.uyandirma === true));
  // "Yeniden dene" (İş kipi, düşmüş yerel kurulum): kurulum bir kez daha başlar; Geliştirici Ayarlar → Gün kaydı'ndaki düğmeyi kullanır.
  h('ses:dikte-yeniden', () => dikteYokSatiri(true));
  h('ses:vosk-adresi', () => 'fuber://app/kaynak/vosk/tr.tar.gz');
  // ── Toplantı modu (12 Kas; main/toplanti.ts): hazırlık (yazıya çevirme yolu), başlat (bilgisayarın sesi için kısa izin penceresi açılır), VAD olayları ve
  // 16 kHz parçalar (yalnız toplantıyı başlatan pencereden), hedef dil / Robot, durdur (özet + saklama), durum, geçmiş. Hepsi telefondan KAPALI.
  h('toplanti:hazirlik', () => toplantiHazirlik());
  hp('toplanti:baslat', (wc, o?: { hedefDil?: unknown; robot?: unknown; baglam?: unknown }) => toplantiBaslat(wc, o ?? {}));
  hp('toplanti:baglam', (wc, b?: unknown) => toplantiBaglam(wc, b));
  h('toplanti:whisper-indir', () => toplantiWhisperIndir());
  hp('toplanti:ses-yeniden', (wc) => toplantiSesiYeniden(wc));
  // 13 Kas 0.17.3: ham kaynak hatası günlüğe (kullanıcıya iz yok), Windows mikrofon ayarı, kalıcı model / yazıya çevirme seçimi.
  hp('toplanti:kaynak-hatasi', (_wc, v) => toplantiKaynakHatasi(v ?? {}));
  h('toplanti:windows-ayari', () => toplantiWindowsMikrofonAyari());
  h('toplanti:tercih-yaz', (v?: unknown) => toplantiTercihYaz(v));
  h('toplanti:gemini', (v?: unknown) => toplantiGemini(v));
  hp('toplanti:basladi', (wc, v) => toplantiBasladi(wc, v ?? {}));
  hp('toplanti:vazgecildi', (wc, v) => toplantiVazgecildi(wc, v ?? {}));
  hp('toplanti:parca', (wc, v) => toplantiParca(wc, v ?? {}));
  // 14 Kas: akış kipi — VAD olayları (basladi, ses blokları, bitti, vazgecildi) TEK kanaldan, sırayla gelir.
  hp('toplanti:olay', (wc, v) => toplantiOlay(wc, v ?? {}));
  h('toplanti:ayar', (o?: { hedefDil?: unknown; robot?: unknown }) => toplantiAyar(o ?? {}));
  h('toplanti:durdur', () => toplantiDurdur());
  h('toplanti:durum', () => toplantiDurumu());
  h('toplanti:gecmis', () => toplantiGecmisi());
  h('toplanti:al', (id: unknown) => toplantiAl(id));
  h('asistan:goster', (dinle?: boolean, odakla?: boolean) => p.asistanGoster(Boolean(dinle), odakla === undefined ? Boolean(dinle) : Boolean(odakla)));
  h('asistan:gizle', (cekildi?: boolean) => p.asistanGizle(Boolean(cekildi)));
  h('ada:fare', (uzerinde: boolean, durdur?: boolean) => p.adaFare(Boolean(uzerinde), Boolean(durdur)));
  // Ada dışarıdan gizlendi ama sırada görülmemiş bildirim var: yeniden insin — tam ekran kapısından (hatırlatma iner, Fuber'in
  // mesajı film/sunum bitene kadar bekler). `yeniden`: arayüz, bu arada içerik gittiyse boş inmez, geri çekilir.
  h('ada:goster', (kaynak: AdaKaynak) => adaGonder('ada:gorunur', { acik: true, yeniden: true }, kaynak === 'hatirlatma' || kaynak === 'onay' ? kaynak : 'fuber'));
  // Arayüz yeniden yüklenince pencerenin o anki görünürlüğünü sorar (ada:gorunur olayını kaçırmış olabilir).
  h('ada:gorunur-mu', () => adaPencere()?.isVisible() ?? false);
  // 0.14 T19 (R15): arayüz açılışta çentik ölçeğini sorar (ilk ada:olcek dinleyici kurulmadan gidebilir).
  h('ada:olcek-al', () => adaOlcek());
  // Arayüz: gösterecek bir şey kalmadı (görüldüğü an) → ana süreç adayı boşta sayar (ada.ts adaBos).
  h('ada:bos', (gorulen: number) => adaBos(Number(gorulen)));
  h('ada:hatirlatma', (v: boolean) => adaHatirlatmaDurumu(Boolean(v)));
  // Ada penceresi klavye odağında mı (odak almamış boş soru kutusu 30 sn sonra kapanır).
  h('ada:odakta-mi', () => adaOdaktaMi());
  if (process.env.FUBER_DEMO) {
    // Ada uçtan uca testi (scripts/dev/ada-testi.mjs) için kancalar: YALNIZ FUBER_DEMO'da kayıtlı, üretimde hiç yok.
    // Sabit tam ekran kancası (FUBER_TEST_TAM_EKRAN): değişiklik olay gibi yayılır (0.14 T22: kuyruk ve boştaki çentik yoklama beklemez).
    h('ada:test-tam-ekran', (acik: boolean | null) => tamEkranTestAyarla(acik === null ? null : Boolean(acik)));
    // 0.14 T22: sahte olay yardımcısına (FUBER_OLAY_KOMUT) komut — {"k":"sahte-olay","olay":{…}} olay yazdırır, {"k":"sahte-cik"} çökertir. true: yazıldı.
    h('ada:test-olay', (k: unknown) => olayYardimcisiTestKomutu(k));
    // yasMs: olayı bu kadar eskitir (30 dk'lık bayatlama kuralı saat beklemeden sınansın).
    h('ada:test-gonder', (kanal: string, veri: unknown, kaynak: AdaKaynak, yasMs?: number) => adaGonder(kanal, veri, kaynak, yasMs ? { zaman: Date.now() - yasMs } : {}));
    h('ada:test-kontrol', (acik: boolean) => adaKontrol(Boolean(acik)));
    // 0.11 G10: görev adımı çalışıyor / bitti (main/ada.ts adaGorevAdimi) — hapın gerçek ana süreç yolu (pencereyi açma, tıklama yakalama) sınansın.
    h('ada:test-gorev', (g: { id: number; baslik: string; ekran: boolean; sayi: number } | null) => { adaGorevAdimi(g); return adaTestDurumu(); });
    h('ada:test-onay', () => { void onayIste(anaSohbet(), { baslik: 'Test onayı', aciklama: 'ada-testi', tehlike: 'dusuk' }); });
    // Asistan kısayoluna basılmış gibi (gerçek klavye yok): "sessizken görünsün"de görünür ama boştaki ada açılmalı.
    h('ada:test-kisayol', () => p.asistanKisayolu());
    // Ana sürecin ada bayraklarını okur (etkin, odak, fare yakalama): yalnız okur, hiçbir şeyi değiştirmez.
    h('ada:test-durum', () => adaTestDurumu());
    // 0.14 T27: Raf'a gerçek yol ekler/temizler (önizleme betiği; yalnız FUBER_DEMO). Üretimde yoktur: arayüz yol gönderemez.
    // 0.14 T35: yalnız paketsiz kopyada (paketli test kopyasında da yok) ve göndereni denetleyen hr ile — yalnız çentik penceresinden.
    if (!app.isPackaged) hr('raf:test', (g: { yollar?: string[]; metin?: string; temizle?: boolean }) => { if (g?.temizle) rafYoneticisi().temizle(); return rafYoneticisi().ekle({ yollar: g?.yollar, metin: g?.metin }); });
    // Uygulama önde (K4): true/false gerçek odağın önüne geçer, null gerçeğe döner (Playwright altında odak işletim sistemine bağlı).
    h('ada:test-ana-onde', (v: boolean | null) => {
      if (v === null) delete process.env.FUBER_TEST_ANA_ONDE; else process.env.FUBER_TEST_ANA_ONDE = v ? '1' : '0';
      adaAnaOndeYenile();
      return adaTestDurumu();
    });
    // Süreli durumların saati ileri ("1 saat gizle" bitişi beklemeden); 0 gerçek saate döner.
    // `sessiz`: haber verilmeden (uyku gibi) — bitişi yoklama ya da powerMonitor 'resume' yakalamalı.
    h('ada:test-saat', (ms: number, sessiz?: boolean) => { saatiKaydir(Number(ms) || 0, Boolean(sessiz)); return adaTestDurumu(); });
    // Windows bildirimi kaydı (FUBER_DEMO'da gösterilmez, yazılır) ve gerçek hatırlatıcı yolu: şimdi zamanı gelen bir hatırlatıcı
    // eklenir ve zamanlayıcının kendi işleyicisi hemen çalışır (30 sn'lik tik beklenmez).
    h('ada:test-bildirimler', () => testBildirimKaydi());
    h('ada:test-hatirlat', async (baslik: string) => { hatirlaticiEkle({ baslik: String(baslik), zaman: new Date().toISOString(), kaynak: 'test' }); await hatirlaticilariIsle(); });
    // Fuber'in kendiliğinden mesajının duyuru yolu (sabah özeti, merak sorusu…; model çağrılmaz): rahatsız etmede duyurulmaz.
    h('ada:test-proaktif', (baslik: string, metin: string) => proaktifBildir(String(baslik), String(metin)));
  }
  h('kulak:olay', (v: { tur: string }) => p.kulakOlay(v));
  h('kulak:uyandirma-durum', () => p.uyandirmaDurumu());
  h('kulak:dinle', () => p.kulakKomut({ tur: 'dinle' }));
  h('kulak:bekle', (ms: number) => p.kulakKomut({ tur: 'bekle', ms: Number(ms) || 0 }));
  h('kulak:devam', () => p.kulakKomut({ tur: 'devam' })); // konuşma susturuldu: beklemeyi bitir
  h('ana:goster', (yol?: string) => p.anaGoster(yol));
  // 0.11 G11 (spec §9): açılış örtüsü ana sürecin "ilk gösterim" bayrağını sorar — süreç başına BİR kez true; `--gizli` başlangıçta ana pencere
  // gösterilene dek cevap bekler. FUBER_DEMO'da açılış olayları (acilis-basladi, acilis-sesi, …) bellekte günlüklenir; üretimde iki kanal yok.
  h('uygulama:ilk-gosterim', () => acilisKapisi.al());
  if (process.env.FUBER_DEMO) {
    h('uygulama:acilis-olayi', (ad: unknown) => acilisOlayiYaz(ad));
    h('uygulama:test-acilis-olaylari', () => acilisOlaylari());
  }

  // ── Sistem ──
  h('tarayici:goster', (adres?: string) => tarayiciGoster(adres));
  // Fuber Tarayıcı penceresinin arayüzü (src/renderer/tarayici): hepsi telefondan kapalı (UZAKTAN_KAPALI).
  h('tarayici:durum', () => tarayiciDurumu());
  h('tarayici:git', (girdi: string) => tarayiciGit(String(girdi ?? '')));
  h('tarayici:gezin', (eylem: GezinmeEylemi) => gezin((['geri', 'ileri', 'yenile', 'dur', 'baslangic'] as const).find((e) => e === eylem) ?? 'yenile'));
  h('tarayici:alan', (r: Parameters<typeof tarayiciAlani>[0]) => tarayiciAlani(r));
  // 0.14 T15: sekme şeridi (yeni sekme / sekmeye geç / sekmeyi kapat).
  h('tarayici:sekme', (eylem: 'ac' | 'gec' | 'kapat', no?: number) => tarayiciSekme((['ac', 'gec', 'kapat'] as const).find((e) => e === eylem) ?? 'gec', Number.isInteger(no) ? no : undefined));
  h('tarayici:oturumlar', () => tarayiciOturumlari());
  h('tarayici:oturum-kapat', (alan: string) => tarayiciOturumKapat(String(alan ?? '')));
  // "Fuber'e sor": istek açık sayfanın adresi ve başlığıyla ana sohbete gider; ana pencere öne gelir (sohbet kokpitte).
  // false değil açıklama döner: motor bağlı değilse ya da ana sohbet meşgulse istek ALINMADI (tarayıcı arayüzü söyler). Sayfa
  // okunacağı için yerel beynin araçsız "gündelik" yolu atlanır (aracGerekli): bulut motoru şart.
  h('tarayici:sor', (v: { istek?: string; ozetle?: boolean }) => {
    const metin = sorMetni({ istek: String(v?.istek ?? ''), ozetle: Boolean(v?.ozetle), ...tarayiciSayfasi() });
    if (!metin) return { tamam: false, mesaj: v?.ozetle ? 'Özetlenecek bir sayfa açık değil.' : 'Fuber\'in ne yapmasını istediğini yaz.' };
    // Sohbetle aynı metin (shared/abonelik.ts motorHataMetni; Ruling O / K1): İş'te önizleme gerçeği ve bugün çalışan yol.
    // G2 düzeltme turu 1: Gizli modda sayfa okumak (araç) yapılamaz — giriş yapmış kullanıcıya "giriş yap" denmez, Gizli modun cümlesi.
    if (ayarlar().yerel.gizliMod === true) return { tamam: false, mesaj: motorHataMetni('bulut-gerekli', ayarlar().mod, null, true) };
    // H3c düzeltme turu 1 (P14 K1): "Yalnız bu bilgisayar" seçiliyken sayfa okumak (araç) yapılamaz — buluta gidilmez.
    if (yalnizYerelSeciliMi()) return { tamam: false, mesaj: motorHataMetni('bulut-gerekli', ayarlar().mod, null, false, true, hazirMotorlar().length > 0) };
    if (!hazirMotorlar().length) return { tamam: false, mesaj: motorHataMetni('yok', ayarlar().mod, ayarlar().hesap?.durum) };
    const ana = anaSohbet();
    if (mesgulMu(ana)) return { tamam: false, mesaj: MESGUL_MESAJI };
    void yanitla(ana, { metin, kaynak: 'kullanici', aracGerekli: true });
    p.anaGoster('kokpit');
    return { tamam: true, metin };
  });
  h('tarayici:durdur', () => { p.acilDurdur(); tarayiciCalismaTemizle(); return tarayiciDurumu(); });
  if (process.env.FUBER_DEMO) {
    // Önizleme kancaları (scripts/dev/tarayici-onizle.mjs): YALNIZ FUBER_DEMO'da kayıtlı. Şerit sahte turla açılır; araçlar gerçek
    // yollarından (numaralama, sendInputEvent, parola engeli) çalışır, izin bu görev için verilmiş sayılır. Ağ yok: yerel sayfalar.
    h('tarayici:test-calisiyor', (acik: boolean, adim?: string) => tarayiciTestCalisiyor(Boolean(acik), adim ? String(adim) : undefined));
    // Kartın yanıt gecikmesi en çok 20 sn (0.14 T15 tur 5: kart submit'ten 10 sn'den uzun açık kalınca da istekler karta bağlanır).
    h('tarayici:test-arac', (ad: string, girdi: Record<string, unknown>, cevap?: 'bir_kez' | 'reddet', gecikmeMs?: number, durdurMs?: number) => tarayiciTestArac(String(ad), girdi && typeof girdi === 'object' ? girdi : {}, cevap === 'reddet' ? 'reddet' : 'bir_kez', Math.min(20_000, Math.max(0, Number(gecikmeMs) || 0)), Math.min(10_000, Math.max(0, Number(durdurMs) || 0))));
    h('tarayici:test-notlar', () => tarayiciTestNotlari());
    // A3: "Bu sayfadan ayrılınsın mı?" kutusu yerine sabit yanıt ('ayril' | 'kal' | null) + sorulma sayısı.
    h('tarayici:test-ayril', (cevap?: 'ayril' | 'kal' | null) => tarayiciTestAyril(cevap === 'ayril' || cevap === 'kal' || cevap === null ? cevap : undefined));
  }
  h('bilgisayar:dene', () => bilgisayarDene());

  h('sistem:ac', (url: string) => { if (/^https?:\/\//i.test(url)) return shell.openExternal(url); return undefined; });
  h('sistem:veri-klasoru', () => shell.openPath(yollar.veri()));
  // 13 Kas: kullanıcının kendi Chrome'u (Claude eklentisi) durumu — yalnız okur (main/chrome-baglanti.ts).
  h('chrome:durum', () => chromeBilgisi());

  // ── Düşünme motoru (gün kaydı) ──
  h('gunkaydi:durum', () => dusunmeDurumu());
  h('beyin:durum', () => beyinDurumu());
  h('yerel:durum', () => yerelDurumu());
  h('claudecode:durum', () => ({ claude: claudeYolu(), ayar: ayarlar().claudeCode, oturumSayisi: ccYonetici().oturumlar().length }));
  h('claudecode:liste', async (ara?: string) => {
    const l = await ccTara();
    const sonuc = ara?.trim() ? ccAra(l, ara).map((x) => ({ ...x.oturum, parca: x.parca })) : l;
    return sonuc.slice(0, 300).map(({ istemler: _i, ...o }) => o);
  });
  // Görev 27: varsayılan uygulama içi oturum (Agent SDK; telefondan her zaman — main/kopru.ts). `terminal: true` eski yol: görünür
  // terminalde `claude --resume` (Claude Code sayfasının "Terminalde sürdür"ü).
  // Ruling CA (düzeltme 1): telefondan (kaynak 'telefon' yalnız main/kopru.ts'te konur) YALNIZ var olan oturum (JSONL kimliği ya da
  // uygulama içi oturum) ya da BİLİNEN proje klasörü; mod en çok "Düzenlemelere izin ver"; açık oturuma mesaj gitmez (yalnız özet).
  h('claudecode:ac', async (o: { id?: string | null; cwd?: string | null; komut?: string | null; terminal?: boolean; kaynak?: string }) => {
    try {
      const telefon = o?.kaynak === 'telefon';
      const istenen = typeof o?.komut === 'string' && o.komut.trim() ? o.komut : undefined;
      if (o?.id) { // uygulama içi oturum kimliği
        const kayit = ccYonetici().ozetAl(String(o.id));
        if (kayit) {
          if (!istenen) return { tamam: true, oturum: kayit };
          if (!telefon) { // masadan: o oturuma gönderilir
            const g = await ccYonetici().gonder(kayit.id, { metin: istenen });
            return g.tamam ? { tamam: true, oturum: ccYonetici().ozetAl(kayit.id) } : { ...g, oturum: kayit };
          }
          // Telefondan: Claude Code kimliği olan kayıt (kapalı, hatalı ya da boştaki dahil) JSONL kimliğiyle aynı yoldan sürdürülür —
          // süreci yaşıyorsa yönetici 'masada-acik' döner; değilse "başka yerde" denetimi ve acceptEdits sınırıyla yeniden açar.
          if (kayit.kimlik) {
            const r = await ccYonetici().baslat({ cwd: kayit.cwd, surdur: kayit.kimlik, istem: istenen, kaynak: 'telefon' });
            return r.tamam ? { tamam: true, oturum: r.oturum } : { tamam: false, hata: r.hata, kod: r.kod, ...(r.oturum ? { oturum: r.oturum } : {}) };
          }
          // Kimliği hiç oluşmamış (ilk turdan önce kapanmış/çökmüş) kayıt: kapalı oturum (masada açık DEĞİL).
          return { tamam: false, kod: 'kapali-oturum', hata: CC_KAPALI_OTURUM, oturum: kayit };
        }
      }
      await ccTara();
      const s = o?.id ? ccBul(String(o.id)) : undefined;
      if (o?.id && !s) return { tamam: false, hata: 'Bu kimlikle oturum bulunamadı.' };
      let cwd = s?.cwd || (typeof o?.cwd === 'string' ? o.cwd : '');
      if (!cwd) return { tamam: false, hata: 'Klasör yok' };
      if (telefon && !s) {
        try { cwd = await ccProjeKlasoru(cwd); } catch { return { tamam: false, kod: 'bilinmeyen-klasor', hata: 'Telefondan yalnız bilinen bir proje klasöründe oturum açılır.' }; }
      }
      const komut = typeof o?.komut === 'string' && o.komut.trim() ? o.komut : undefined;
      sinyal('ajan', 'kod', komut ? 'kod işi verdi' : 'oturumu açtı', 'Claude Code'); // sade metin; araç adı yalnız Geliştirici'de
      if (o?.terminal === true && !telefon) return { tamam: true, ...terminaldeAc({ cwd, oturum: s?.id, komut, baslik: `Fuber → ${s?.proje ?? cwd.split(/[\\/]/).pop()}` }) };
      const r = await ccYonetici().baslat({ cwd, surdur: s?.id, istem: komut, baslik: s?.baslik, kaynak: telefon ? 'telefon' : 'sayfa' });
      return r.tamam ? { tamam: true, oturum: r.oturum } : { tamam: false, hata: r.hata, kod: r.kod, ...(r.oturum ? { oturum: r.oturum } : {}) };
    } catch (e) { return { tamam: false, hata: (e as Error).message }; }
  });
  // ── Claude Code yöneticisi (Görev 27, K17): uygulama içi oturumlar. Yalnız claudecode:oturumlar telefona açık (salt okur özet). ──
  h('claudecode:oturumlar', () => ccYonetici().oturumlar());
  h('claudecode:baslat', async (i: CcBaslatIstegi) => {
    if (!i || typeof i !== 'object') return { tamam: false, kod: 'gecersiz', hata: 'Geçersiz istek.' };
    sinyal('ajan', 'kod', i.istem ? 'kod işi verdi' : 'oturumu açtı', 'Claude Code');
    const r = await ccYonetici().baslat({ ...i, kaynak: 'sayfa', sohbetId: undefined, uzak: false });
    // Düzeltme 7: klasör yalnız oturum GERÇEKTEN başlayınca "bilinen proje" olur.
    if (r.tamam && r.oturum) ccSecilenKlasorler.add(r.oturum.cwd);
    return r;
  });
  // Klasör güveni (son dalga B, I1; main/claudecode/klasor-guveni.ts): `cwd` → durum (kendi Claude Code ayarları, kayıtlı karar); `cwd` +
  // `karar` ('guven' | 'guvenme' | null = kararı sil) → kaydeder ve o klasörün boştaki süreçlerini yeni kararla açılmak üzere kapatır;
  // `cwd` yok → kayıtlı kararların listesi. Yalnız bilgisayarın başında (kopru-protokol.ts UZAKTAN_KAPALI): telefon kartı yanıtlayamaz.
  // N3: karar, kartta gösterilen dosya kümesinin parmak iziyle saklanır (`parmakIzi`; yoksa şu anki); ayarlar sonra değişirse yeniden sorulur.
  h('claudecode:klasor-guveni', async (o?: { cwd?: unknown; karar?: unknown; parmakIzi?: unknown }) => {
    const depo = ccGuvenDeposu();
    if (!o || o.cwd === undefined || o.cwd === null) return { tamam: true, liste: depo.liste() };
    const cwd = typeof o.cwd === 'string' ? o.cwd.trim() : '';
    if (!cwd || !path.isAbsolute(cwd)) return { tamam: false, hata: 'Klasör verilmedi.' };
    const karar = !('karar' in o) ? undefined : o.karar === 'guven' || o.karar === 'guvenme' ? o.karar : o.karar === null ? null : 'gecersiz';
    if (karar === 'gecersiz') return { tamam: false, hata: 'Geçersiz karar.' };
    let klasor = false;
    try { klasor = fs.statSync(cwd).isDirectory(); } catch { /* yok */ }
    if (karar === null) { depo.ayarla(cwd, null); if (klasor) await ccYonetici().klasorGuveniDegisti(cwd); return { tamam: true, liste: depo.liste() }; }
    if (!klasor) return { tamam: false, hata: `Klasör bulunamadı: ${cwd}` };
    if (karar) {
      // Düzeltme turu 2: iz çıkarılamayan (bütçe aşan) klasöre "güven" saklanmaz — değişiklik izlenemez.
      if (karar === 'guven' && ccYonetici().guvenDurumu(cwd).sinirsiz) return { tamam: false, hata: 'Bu klasörün Claude Code ayar dosyaları çok büyük ya da çok sayıda; Fuber değişiklikleri izleyemez, güven kararı saklanamaz.' };
      const iz = typeof o.parmakIzi === 'string' && /^(|[0-9a-f]{64})$/.test(o.parmakIzi) ? o.parmakIzi : ccYonetici().guvenDurumu(cwd).parmakIzi;
      depo.ayarla(cwd, karar, iz);
      await ccYonetici().klasorGuveniDegisti(cwd);
    }
    return { tamam: true, durum: ccYonetici().guvenDurumu(cwd) };
  });
  h('claudecode:unut', (id: string) => ccYonetici().unut(String(id)));
  // "@" dosya önerisi (Görev 28): .gitignore'a uyar (git ls-files -co --exclude-standard; depo değilse eşzamansız, bütçeli gezinti);
  // en çok 50; tarama kısmi kaldıysa `kisaltildi`. cwd başına tek tarama (tuş vuruşları bekler), 10 sn önbellek.
  h('claudecode:dosya-oner', async (o: { id?: string; cwd?: string; sorgu?: string }) => {
    const ozet = o?.id ? ccYonetici().ozetAl(String(o.id)) : null;
    const cwd = ozet ? ozet.cwd : await ccProjeKlasoru(o?.cwd);
    const d = await projeDosyalari(cwd);
    return { yollar: dosyaEslestir(d.liste, typeof o?.sorgu === 'string' ? o.sorgu.slice(0, 200) : '', 50), kisaltildi: d.kisaltildi };
  });
  // İzin kartı (Görev 28 düzeltme 1): Write'ın hedefi oturumun klasöründe VAR mı (yeni dosya / üzerine yazma). Yalnız evet/hayır; klasör
  // dışına çıkan yol hep "yok" (içerik okunmaz).
  h('claudecode:dosya-var', (id: string, dosya: string) => {
    const o = ccYonetici().ozetAl(String(id));
    if (!o || typeof dosya !== 'string' || !dosya) return false;
    const kok = path.resolve(o.cwd);
    const tam = path.resolve(kok, dosya);
    const ayni = (a: string) => (process.platform === 'win32' ? a.toLowerCase() : a);
    if (ayni(tam) !== ayni(kok) && !ayni(tam).startsWith(ayni(kok + path.sep))) return false;
    try { return fs.statSync(tam).isFile(); } catch { return false; }
  });
  h('claudecode:gonder', (id: string, m: { metin: string; gorseller?: { medya: string; veri: string }[] }) => ccYonetici().gonder(String(id), m ?? { metin: '' }));
  h('claudecode:izin-yanitla', (id: string, istekId: string, y: CcIzinYaniti) => ccYonetici().izinYanitla(String(id), String(istekId), y));
  h('claudecode:kes', (id: string, o?: { kuyruk?: 'sil' | 'birak' }) => ccYonetici().kes(String(id), o ?? {}));
  h('claudecode:mod', (id: string, mod: unknown) => ccYonetici().modDegistir(String(id), mod));
  h('claudecode:model', (id: string, model: unknown) => ccYonetici().modelDegistir(String(id), model));
  // Analiz 11 Kas (bulgu 1, 5): canlı düşünme gücü (applyFlagSettings) ve işler (stopTask, backgroundTasks, çıktı dosyasının son satırları).
  h('claudecode:efor', (id: string, efor: unknown) => ccYonetici().eforDegistir(String(id), efor));
  // Analiz 11 Kas (bulgu 4): sohbetin arka plan süreçleri (ajan/surec-yoneticisi.ts): liste, son satırlar, Durdur; değişince 'surec:degisti'.
  surecDinle((l) => yayinla('surec:degisti', l));
  h('surec:liste', () => surecListesi());
  // İş izi (11 Kas): bütün işlerin tek listesi (açılışta; sonrası 'is-izi:degisti'). Telefondan kapalı: telefon yalnız olayın durum özetini alır.
  h('is-izi:liste', () => isIziListesi());
  // Analiz 11 Kas bulgu 8–9: sohbet ekleri. Kanallar genel listede DEĞİL (raf:birak gibi): yolu preload çözer (webUtils.getPathForFile; arayüz
  // yol uyduramaz), yalnız çağıran pencereye bağlı (köprü haritasına girmez → telefondan çağrılamaz). Belge dosya_oku'nun ayrıştırıcısıyla metne;
  // video bu bilgisayarda kare + yerel Whisper yazısı (main/video-isle.ts), ilerleme yalnız çağıran pencereye 'ek:ilerleme'.
  hp('ek:hazirla', (_wc, g: unknown) => ekMetniOku(g && typeof g === 'object' ? (g as { yol?: unknown }).yol : undefined));
  hp('ek:video', (wc, g: unknown) => {
    const o = g && typeof g === 'object' ? g as { yol?: unknown; kimlik?: unknown } : {};
    const kimlik = typeof o.kimlik === 'string' ? o.kimlik.slice(0, 80) : '';
    return videoHazirla(o.yol, (i) => { try { if (!wc.isDestroyed()) wc.send('ek:ilerleme', { kimlik, ...i }); } catch { /* pencere kapandı */ } }, kimlik ? { kimlik } : {});
  });
  // İnceleme I2: çip kaldırıldı → sıradaki video başlamaz, işlenen videonun gizli penceresi kapanır.
  hp('ek:video-iptal', (_wc, kimlik: unknown) => videoIptal(kimlik));
  h('surec:cikti', (kimlik: unknown, satir?: unknown) => surecCiktisi(kimlik, Number(satir) || 80));
  h('surec:durdur', (kimlik: unknown) => surecDurdur(kimlik));
  h('claudecode:is-durdur', (id: string, isId: unknown) => ccYonetici().isDurdur(String(id), isId));
  h('claudecode:is-arka-plan', (id: string, isId: unknown) => ccYonetici().arkaPlanaAl(String(id), isId));
  h('claudecode:is-cikti', (id: string, isId: unknown) => ccYonetici().isCiktisi(String(id), isId));
  h('claudecode:kapat', (id: string) => ccYonetici().kapat(String(id)));
  h('claudecode:oturum-al', (id: string) => ccYonetici().oturum(String(id)));
  h('claudecode:komutlar', (id: string) => ccYonetici().komutlar(String(id)));
  // 0.13 T12: taslakta model listesi (oturumdan gelen ya da saklı; yoksa opus/sonnet/haiku) ve hesap satırı (SDK accountInfo: yalnız e-posta + plan).
  h('claudecode:modeller', () => ccYonetici().modeller());
  h('claudecode:hesap', () => ccYonetici().hesap());
  // Geçmiş oturumun dökümü JSONL'nin sonundan (sayfalı; `once` = "Daha eskisi" imleci).
  h('claudecode:dokum', (kimlik: string, o?: { once?: number; adet?: number }) => {
    const d = oturumDosyasiBul(String(kimlik ?? ''));
    if (!d) return { olaylar: [], once: null, boyut: 0, hata: 'Oturum dökümü bulunamadı.' };
    try { return dokumOku(d, { once: Number.isFinite(o?.once) ? Number(o!.once) : undefined, adet: Number(o?.adet) || undefined }); } catch (e) { return { olaylar: [], once: null, boyut: 0, hata: (e as Error).message }; }
  });
  h('claudecode:baska-yerde', (kimlik: string) => baskaYerdeAcik(String(kimlik ?? ''), ccYonetici().bizimIzler(), etkinAjanMetni));
  h('claudecode:projeler', async () => projeleriTopla(await ccTara(), [...ccYonetici().cwdler(), ...ccSecilenKlasorler]));
  h('claudecode:claude-md-oku', async (cwd: string) => claudeMdOku(await ccProjeKlasoru(cwd)));
  h('claudecode:claude-md-yaz', async (cwd: string, icerik: string, beklenenOzet?: string) => {
    if (typeof icerik !== 'string') return { tamam: false, kod: 'gecersiz', hata: 'İçerik yok.' };
    try {
      const r = claudeMdYaz(await ccProjeKlasoru(cwd), icerik, typeof beklenenOzet === 'string' ? beklenenOzet : undefined);
      return r.tamam ? r : { ...r, hata: r.kod === 'degisti' ? 'CLAUDE.md sen düzenlerken değişti; yeniden açıp farkı gör.' : 'CLAUDE.md 1 MB\'ı aşamaz.' };
    } catch (e) { return { tamam: false, hata: (e as Error).message }; }
  });
  // Kimlik (Ruling BT): yalnız giriş durumu ve yöntem; giriş Anthropic'in kendi akışıyla görünür konsolda.
  h('claudecode:auth-durum', () => ccAuthDurumu().catch((e) => ({ kurulu: false, girisYapildi: false, hata: (e as Error).message })));
  h('claudecode:giris', () => { try { ccGirisBaslat(); return { tamam: true }; } catch (e) { return { tamam: false, hata: (e as Error).message }; } });
  h('claudecode:degisiklikler', async (id: string) => {
    const o = ccYonetici().oturum(String(id));
    if (!o) return null;
    return { ...(await gitOzeti(o.cwd)), oturumDosyalari: o.degisenDosyalar };
  });
  h('claudecode:fark', async (id: string, dosya: string) => {
    const o = ccYonetici().oturum(String(id));
    if (!o || typeof dosya !== 'string') return { fark: '', kisaltildi: false, hata: 'Oturum ya da dosya yok.' };
    try { return await gitFark(o.cwd, dosya); } catch (e) { return { fark: '', kisaltildi: false, hata: (e as Error).message }; }
  });
  h('claudecode:klasor-sec', async () => {
    const w = BrowserWindow.getFocusedWindow();
    const r = w ? await dialog.showOpenDialog(w, { properties: ['openDirectory'] }) : await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    ccSecilenKlasorler.add(r.filePaths[0]);
    return r.filePaths[0];
  });
  h('claudecode:klasor-ac', async (cwd: string) => { const k = await ccProjeKlasoru(cwd); return shell.openPath(k); });
  // ── Fuber Geliştirici Paketi ve Eklentiler sekmesi (Görev 29, K18; main/claudecode/eklenti-kurucu.ts). Hepsi telefondan KAPALI
  //    (UZAKTAN_KAPALI): eklenti kurmak/kaldırmak bilgisayarda komut çalıştırır; ilerleme olayı 'claudecode:eklenti' telefona gitmez. ──
  eklentileriBaslat();
  h('claudecode:eklenti-durum', (o?: { tazele?: boolean }) => { if (o?.tazele) eklentiKurucu().authSifirla(); return eklentiKurucu().durum(); });
  h('claudecode:eklenti-liste', (tur: unknown, o?: { tazele?: boolean }) => eklentiKurucu().liste(tur, o?.tazele === true));
  // Sihirbazın "Devam"ı ve sekmenin "Seçilenleri kur"u: ARKA PLANDA kurar (çağıran beklemez). Teklif kartının "Şimdi değil"i
  // ({ yalnizGoruldu: true }) yalnız adımı "görüldü" işaretler — kuyruk değişmez.
  h('claudecode:paket-baslat', (o?: { secim?: unknown; yalnizGoruldu?: boolean }) => (o?.yalnizGoruldu === true ? eklentiKurucu().adimGorulduIsaretle() : eklentiKurucu().paketBaslat(o?.secim)));
  h('claudecode:eklenti-kur', (o?: { id?: unknown }) => eklentiKurucu().ogeKur(o?.id));
  // Kurulum komutu onayı: gösterilen komutun sha256'sıyla (--accept-command); ret → kurulmaz. Asla körlemesine -y.
  h('claudecode:eklenti-onay', (o?: { id?: unknown; sha256?: unknown; kabul?: unknown }) => eklentiKurucu().onay(o?.id, o?.sha256, o?.kabul));
  h('claudecode:eklenti-islem', (o?: { tur?: unknown; id?: unknown; islem?: unknown; kapsam?: unknown }) => eklentiKurucu().islem(o ?? {}));
  // "Claude Code'u kur": resmi yükleyici GÖRÜNÜR PowerShell penceresinde, yalnız kullanıcı tıklayınca; kurulunca bekleyen paket sürer.
  h('claudecode:cc-kur', () => eklentiKurucu().ccKur());
  h('claudecode:eklenti-gunluk', () => { const y = eklentiKurucu().gunlukYolu; if (fs.existsSync(y)) shell.showItemInFolder(y); else void shell.openPath(path.dirname(y)); return { tamam: true }; });
  // `model` verilirse (Ayarlar → Gizlilik: kurulu olmayan model kartı) o model, çalışan yerel beyin DURMADAN iner; ayar ancak
  // doğrulanmış kurulumdan sonra o modele geçer (main.ts yeniden başlatır). Kurulu olmayan modele doğrudan geçmek sunucuyu
  // "Yerel beyin kurulu değil" ile durdururdu.
  // Telefondan kapalı (UZAKTAN_KAPALI): çok GB'lık indirme uzaktan başlatılamaz. Başka bir model iniyorsa hemen reddedilir; geçişten
  // önce modelin GERÇEKTEN inip doğrulandığı denetlenir (yalnız "iş bitti" yetmez).
  // `secenek.ac` (Görev 15 düzeltme 1: sihirbazın "Ekstra gizlilik"i, Ayarlar'da ilk kurulum): istenen kurulum kaydedilir
  // (yerel.bekleyenKurulum) ve doğrulanmış kurulumdan sonra yerel beyin BURADA açılır — arayüz kapansa da. Kullanıcı durdurursa kayıt
  // silinir; hata olursa hatayla kalır (arayüzde bildirim). Başka bir model inerken gelen istek kayda dokunmadan reddedilir.
  h('yerel:kur', async (model?: unknown, secenek?: unknown) => {
    // 0.13 G: kart çizildikten sonra model katalogdan kapatılmış olabilir: ayardaki modele sessizce düşülmez, hiçbir şey yazılmaz.
    const hedef = typeof model === 'string' ? model : undefined;
    if (hedef !== undefined && !katalogBul(hedef)) return { tamam: false, hata: MODEL_SUNULMUYOR };
    const istenen = hedef ?? ayarlar().yerel.model;
    const inen = yerelInenModel();
    const ac = Boolean(secenek && typeof secenek === 'object' && (secenek as { ac?: unknown }).ac === true) && (!inen || inen === istenen);
    // H3c düzeltme turu 1 (Ö2): uymayan sürüm ana süreçte de REDDEDİLİR — arayüzün kartıyla aynı karar (yerel/uygunluk.ts); kayıt yazılmaz,
    // seçim değişmez, hiçbir şey inmez.
    const u = await yerelKurUygunlugu(istenen);
    if (!u.uygun) return { tamam: false, hata: u.neden ?? 'Bu sürüm bu bilgisayara uymuyor.', uymuyor: true };
    // Görev 23: sihirbazın "Ekstra gizlilik"inde Gizli mod seçildi → kurulum bitip yerel beyin açılınca Gizli mod da açılır.
    const gizli = (secenek as { gizli?: unknown } | undefined)?.gizli;
    // Kü7 (düzeltme turu 1): "Nerede çalışsın" seçimi kayıtla tek yazımda (Gizli'nin açılması ya da "Yalnız bu bilgisayar"; N-4).
    const secimHam = (secenek as { secim?: unknown } | undefined)?.secim;
    const secim = ac && (secimHam === 'gizli' || secimHam === 'yerel') ? secimHam : undefined;
    const gizliOnce = ayarlar().yerel.gizliMod === true;
    if (ac) bekleyenYaz(istenen, typeof gizli === 'boolean' ? gizli : undefined, secim);
    if (secim && (ayarlar().yerel.gizliMod === true) !== gizliOnce) gizliDegisti(gizliOnce, ayarlar().yerel.gizliMod === true);
    try {
      await yerelKur(hedef);
      if (hedef && !modelKuruluMu(hedef)) {
        const hata = `${katalogBul(hedef)?.ad ?? hedef} kurulamadı; model değiştirilmedi.`;
        // F1 düzeltme turu 1 (N-4): kalıcı hata kaydı ve (gerekirse) Gizli'nin geri alınması tek yazımda.
        if (ac) bekleyenleGizliyiDenetle('hata', bekleyenHataYamasi(istenen, hata));
        return { tamam: false, hata };
      }
      // İstek kaydı hâlâ varsa yerel beyin açılır (indirme sürerken elle kapatıldıysa açılmaz); kayıt yoksa yalnız model geçişi.
      if (!(ac && bekleyenTamamla(istenen)) && hedef && hedef !== ayarlar().yerel.model) ayarlariKaydet((a) => { a.yerel.model = hedef; });
      // Yerel beyin yalnız tek motorken (Gizli mod / bulutsuz) sıcak tutulur; bulut yolunda kurulum sunucuyu açmaz (düzeltme 7).
      if (yerelTekMotorMu()) void yerelTaban();
      return { tamam: true };
    } catch (e) {
      const durdu = (e as Error)?.name === 'AbortError';
      // F1 (Ö1): yerel hazır değilken indirme durdu ya da kalıcı hatayla bitti → Gizli açıksa kapanır, kokpit tek sakin cümleyle söyler
      // (yerel/gizli-geri-al.ts). "Kaldır"ın kendi durdurması değil: onu yerel:kaldir yapar (not yok). Düzeltme turu 1 (N-4): kaydın
      // yazımı ve Gizli'nin geri alınması tek yazımda (arada kırmızı motor:durum yayınlanmaz).
      const neden = durdu ? 'vazgec' as const : 'hata' as const;
      const geriAl = !yerelKaldiriliyorMu();
      if (ac) {
        const yama = durdu ? bekleyenSilYamasi : bekleyenHataYamasi(istenen, (e as Error).message);
        if (geriAl) bekleyenleGizliyiDenetle(neden, yama);
        else if (durdu) bekleyenSil();
        else bekleyenHata(istenen, (e as Error).message);
      } else if (geriAl) gizliyiGeriAlGerekirse(neden);
      return { tamam: false, durduruldu: durdu || undefined, hata: durdu ? 'İndirme durduruldu.' : (e as Error).message };
    }
  });
  // Süren indirmeyi durdurur (yarım dosya silinir, kurulu parçalar kalır). Telefondan kapalı (UZAKTAN_KAPALI).
  h('yerel:durdur', () => { yerelIndirmeyiDurdur(); return yerelDurumu(); });
  // İstenmiş kurulum sürerken "bitince Gizli modu aç" seçimi (Görev 23; sihirbazın Ekstra gizlilik adımı). Kayıt yoksa bir şey yapmaz.
  // Telefondan kapalı (UZAKTAN_KAPALI).
  h('yerel:bekleyen-gizli', (v: unknown) => { bekleyenGizli(v === true); return ayarlar(); });
  // Yarıda kalan / hatalı istenmiş kurulumun kartında "Vazgeç": kayıt ve yarım indirme dosyaları silinir, hiçbir şey indirilmez
  // (telefondan kapalı).
  // F1 (Ö1): yerel hazır değilken vazgeçilirse Gizli açık kalamaz — kapanır, kokpit tek sakin cümleyle söyler (yerel/gizli-geri-al.ts).
  // Düzeltme turu 1 (N-4): kaydın silinmesi ve Gizli'nin geri alınması tek yazımda.
  h('yerel:bekleyen-vazgec', () => {
    if (ayarlar().yerel.bekleyenKurulum) bekleyenleGizliyiDenetle('vazgec', bekleyenSilYamasi);
    else gizliyiGeriAlGerekirse('vazgec');
    yarimlariTemizle();
    return yerelDurumu();
  });
  // F1 (Ö1): kokpitteki "Gizli modu kapattım" notunun "Tamam"ı (telefondan kapalı).
  h('yerel:gizli-notu-kapat', () => { gizliNotunuKapat(); return true; });
  // Görev 20b: arayüz önce boyutlu onay ister. Süren indirme durdurulup işi beklenir, sunucu ve ses süreçlerinin çıkışı beklenir,
  // sonra klasör silinir (EBUSY'siz; yerel/kurulum.ts yerelKaldir; istenmiş kurulumun kaydı da silinir). Telefondan kapalı (UZAKTAN_KAPALI).
  // F1 (Ö1): Gizli açıksa ÖNCE o kapanır (onay penceresi söyler; kaldırma sürerken kırmızı "hazır değil" görünmez; not yok).
  h('yerel:kaldir', async () => {
    if (ayarlar().yerel.gizliMod === true) gizliKapat();
    // Görev 21: süreçler kapandıktan sonra (eski yerdeki) yedek ses yerel beyinden bağımsız klasöre taşınır — kaldırma sesi götürmez.
    await yerelKaldir(async () => { await Promise.all([yerelDurdurBekle(), piperKapatBekle()]); eskiyiTasi(true); });
    return yerelDurumu();
  });
  // Bulut yolunda (Gizli mod kapalı, bulut var) yeniden başlatma sunucuyu AÇMAZ: yerel beyin o yolda hiçbir işte kullanılmaz (düzeltme 7).
  h('yerel:yeniden-baslat', () => { yerelYenidenBaslat(yerelTekMotorMu()); return yerelDurumu(); });
  h('yerel:dene', (metin: string) => yerelDene(String(metin || 'Fuber buralarda mısın?'), yerelTekMotorMu()));
  h('gunkaydi:kulak-ayar', () => kulakAyari());
  h('gunkaydi:dokum', (gun?: string) => gunDokumu(gun || new Date().toLocaleDateString('sv-SE')));
  h('gunkaydi:maddeler', (o?: { gun?: string; onem?: 'onemli' | 'onemsiz' }) => maddeler({ gun: o?.gun, onem: o?.onem }));
  h('gunkaydi:raporlar', (o?: { tur?: RaporTuru; limit?: number }) => raporlar({ tur: o?.tur, limit: o?.limit }));
  // Kullanıcı istedi: hata (ör. motor yok) arayüze iletilir ("not yok" diye gizlenmez).
  h('gunkaydi:rapor-hazirla', (tur: RaporTuru, donem?: string) => raporCalistir(tur, donem, false, true));
  h('gunkaydi:meseleler', (durum?: 'acik' | 'kapandi' | 'hepsi') => meseleler(durum ?? 'acik'));
  h('gunkaydi:mesele-guncelle', (id: number, d: { durum?: 'acik' | 'kapandi' | 'iptal'; hedef?: string; baslik?: string }) => {
    const m = meseleGuncelle(Number(id), { durum: d?.durum, hedef: d?.hedef, baslik: d?.baslik });
    void kokpitYenile('mesele');
    return m;
  });
  h('gunkaydi:sil', (kapsam: 'bugun-dokum' | 'tum-dokum' | 'hepsi') => { gunKaydiniSil(kapsam); void kokpitYenile('gün kaydı silindi'); return true; });
  h('gunkaydi:duraklat', (dakika: number) => {
    ayarlariKaydet((a) => { a.gunKaydi.duraklatBitis = Number(dakika) > 0 ? new Date(Date.now() + Number(dakika) * 60_000).toISOString() : undefined; });
    return dusunmeDurumu();
  });
  h('gunkaydi:not-tut', () => notTutucuCalistir(true));
  h('gunkaydi:whisper-indir', () => { void whisperKur(); return true; });
  h('gunkaydi:whisper-kaldir', () => { whisperKaldir(); return dusunmeDurumu(); });
  // Kulak penceresinden: bir konuşma bölümü (Vosk metni ve/veya bellekteki WAV).
  h('gunkaydi:satir', (v: { voskMetin?: string; sure?: number }) => bolumAl({ voskMetin: String(v?.voskMetin ?? '').slice(0, 2000), sure: Number(v?.sure) || undefined }));
  h('gunkaydi:ses', (v: { wav?: string; voskMetin?: string; sure?: number }) => {
    // 30 sn × 16 kHz × 2 bayt ≈ 1 MB; base64 ≈ 1,3 MB. Daha büyüğü reddedilir.
    if (typeof v?.wav !== 'string' || v.wav.length > 1_600_000) return bolumAl({ voskMetin: v?.voskMetin, sure: v?.sure });
    return bolumAl({ wav: v.wav, voskMetin: String(v.voskMetin ?? '').slice(0, 2000), sure: Number(v.sure) || undefined });
  });
  h('ozet:metin', (metin: string) => yardimciMetin('Kısa ve net Türkçe özetle.', metin, 'arayuz-ozet', 600));

  // Motor sinyali (Ruling K; tek kaynak): sohbet şeridi, kokpit hapı/başlığı ve ada aynı kuralla "motor durdu" der.
  h('motor:durum', () => motorDurumu());

  // ── Veri yaşam döngüsü (0.11 G2, spec §2; main/veri/temizlik.ts). Hepsi telefondan kapalı (kopru-protokol.ts). ──
  const veriKoku = () => yollar.veri();
  // G2 düzeltme turu 1 (K2): açılış yalnız işareti sorar (`yalnizIsaret`: tek lstat; ilk çizim beklemez); sayılar "Tekrar hoş geldin" ve
  // Ayarlar → Veri için; boyutlar (yedekler, indirilen yapay zekâ) YALNIZ `boyut: true` (Ayarlar → Veri) — eşzamansız ve sınırlı tarama.
  h('veri:ozet', async (o?: { yalnizIsaret?: unknown; boyut?: unknown }): Promise<VeriDurumu | Pick<VeriDurumu, 'yenidenKurulum'>> => {
    const kok = veriKoku();
    const yenidenKurulum = yenidenKurulumVar(kok);
    if (o?.yalnizIsaret === true) return { yenidenKurulum };
    const temel: VeriDurumu = {
      yenidenKurulum, ...veriOzeti(kok, veritabani()), yedekSayisi: yedekSayisi(kok), yedekBayt: null, yerelBayt: null, boyutTam: true,
      kaldirilabilir: app.isPackaged,
    };
    if (o?.boyut !== true) return temel;
    const [yedek, ...indirilen] = await Promise.all([YEDEKLER, ...INDIRILEN].map((ad) => klasorBoyutuSinirli(kok, ad)));
    return {
      ...temel, yedekBayt: yedek.bayt, yerelBayt: indirilen.reduce((t, x) => t + x.bayt, 0),
      boyutTam: yedek.tam && indirilen.every((x) => x.tam),
    };
  });
  // "Kaldığın yerden devam et": yeniden kurulum işareti kalkar (sonraki ekrana arayüz karar verir: shared/kurulum-adimlari.ts kurulumYolu).
  h('veri:devam', () => { yenidenKurulumIsaretiniSil(veriKoku()); return true; });
  let veriIslemi = false;
  /** "Yeni başla" / "Verilerimi sil": işaret yazılır, uygulama yeniden açılır; taşıma/silme bir sonraki açılışta dosyalar açılmadan. */
  const istekVeYenidenAc = async (islem: { tur: 'yeni-basla' | 'sil'; yerelDahil?: boolean }): Promise<VeriIslemYaniti> => {
    if (veriIslemi) return { tamam: false, hata: 'İşlem zaten sürüyor.' };
    veriIslemi = true;
    try {
      veriIslemiIste(veriKoku(), islem);
    } catch (e) {
      veriIslemi = false;
      console.error('[veri] işlem istenemedi:', (e as Error).message);
      return { tamam: false, hata: 'Olmadı; bir daha dene.' };
    }
    console.info(`[veri] ${islem.tur} istendi${islem.tur === 'sil' ? ` (indirilen yapay zekâ ${islem.yerelDahil ? 'dahil' : 'kalır'})` : ''}; yeniden açılıyor`);
    setTimeout(() => p.yenidenAc(), 150);
    return { tamam: true };
  };
  h('veri:yeni-basla', () => istekVeYenidenAc({ tur: 'yeni-basla' }));
  h('veri:sil', (o?: { yerelDahil?: unknown }) => istekVeYenidenAc({ tur: 'sil', yerelDahil: o?.yerelDahil === true }));
  // "Fuber'i bu bilgisayardan kaldır": hesap çıkışı, sonra kaldırıcı `/S --verileri-sil` ile AYRIK başlar (sormadan yalnız
  // %APPDATA%\Fuber AI'yi siler; build/kurulum.nsh) ve uygulama kapanır. Geliştirme kopyasında (paketsiz) yok.
  h('veri:kaldir', async (): Promise<VeriIslemYaniti> => {
    if (!app.isPackaged) return { tamam: false, hata: 'Bu bir geliştirme kopyası; kaldırma yalnız kurulu Fuber’de çalışır.' };
    // NSIS kaldırıcısının adı: electron-builder "Uninstall ${PRODUCT_FILENAME}.exe", uygulamanın yanında.
    const kaldirici = path.join(path.dirname(app.getPath('exe')), 'Uninstall Fuber AI.exe');
    if (!fs.existsSync(kaldirici)) return { tamam: false, hata: 'Kaldırıcı bulunamadı; Windows’un Uygulamalar ayarından kaldırabilirsin.' };
    if (veriIslemi) return { tamam: false, hata: 'İşlem zaten sürüyor.' };
    veriIslemi = true;
    try {
      await new Promise<void>((tamam, hata) => {
        const c = spawn(kaldirici, ['/S', '--verileri-sil'], { detached: true, stdio: 'ignore', windowsHide: true });
        c.once('spawn', () => { c.unref(); tamam(); });
        c.once('error', hata);
      });
    } catch (e) {
      veriIslemi = false;
      console.error('[veri] kaldırıcı başlatılamadı:', (e as Error).message);
      return { tamam: false, hata: 'Kaldırıcı başlatılamadı; Windows’un Uygulamalar ayarından kaldırabilirsin.' };
    }
    console.info('[veri] kaldırıcı başladı; uygulama kapanıyor');
    setTimeout(() => p.kapat(), 150);
    return { tamam: true };
  });
  h('veri:yedekleri-sil', () => yedekleriSil(veriKoku()));
}
