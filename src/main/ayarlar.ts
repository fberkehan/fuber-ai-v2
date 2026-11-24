// ── Ayarlar ve sırlar ────────────────────────────────────────────────────────────────────────────────────────
// Ayarlar düz JSON (ayarlar.json; atomik yazım + .bak yedeği, bkz. json-dosya.ts). Sırlar (API anahtarları, e-posta parolaları) AYRI dosyada ve Electron safeStorage
// (Windows'ta DPAPI: yalnız bu Windows kullanıcısı çözebilir) ile şifreli. Sırlar arayüze ve günlüğe ASLA yazılmaz;
// arayüz yalnız "kayıtlı mı" bilgisini görür. safeStorage kullanılamazsa (çok nadir) sır saklanmaz, hata verilir.
import { safeStorage } from 'electron';
import { yollar } from './yollar.js';
import { jsonOku, jsonYaz } from './json-dosya.js';
import { baslangicModu } from '../shared/kullanim-bicimi.js';
import { sesGocu, type GocAyari } from '../shared/ses-kimligi.js';
import { PANO_VARSAYILAN } from '../shared/pano.js';
import { kurulumSurumuGocu } from '../shared/kurulum-adimlari.js';
import { CC_AYAR_VARSAYILAN, ccAyarGoc } from '../shared/cc-ayar.js';
import { cihazSonekiGecerli, hesapAyariDuzelt } from '../shared/masaustu-hesap.js';
import { motorCalistiGocu } from '../shared/motor-durumu.js';
import { temaGocu } from '../shared/tema-cozum.js';
import { KARAKTER_GORUNUMU_VARSAYILAN, karakterGorunumuGecerli } from '../shared/karakter-gorunum.js';
import { sayfaAyariDogrula } from '../shared/centik-sayfalar.js';
import { YALNIZ_YEREL_GOCU } from '../shared/nerede.js';
import { claudeSecili, openaiUyumluSecili, openaiUyumluSuz, MOTOR_SECIMLERI, type MotorSecimi } from '../shared/motor-secimi.js';
import type { Ayarlar, SaglayiciAdi } from '../shared/tipler.js';

const VARSAYILAN: Ayarlar = {
  kurulumTamam: false,
  kurulumSurumu: 0,
  tanitimSurumu: '',
  // 0.10 Görev 2 (P3): ilk başarılı bulut çağrısında true (motor/secici.ts); eski profilde göçle (aşağıda).
  motorCalisti: false,
  kullaniciAdi: '',
  hitap: '',
  asistanAdi: 'Fuber',
  dil: 'tr',
  modeller: {
    ana: { saglayici: 'anthropic', model: 'claude-opus-5-5', efor: 'medium' },
    yardimci: { saglayici: 'anthropic', model: 'claude-haiku-5-5', efor: 'low' },
  },
  saglayicilar: {
    anthropic: { etkin: true, anahtarVar: false, sunucuWebArama: true },
    openai: { etkin: false, anahtarVar: false, tabanUrl: 'https://api.openai.com/v1' },
    openrouter: { etkin: false, anahtarVar: false, tabanUrl: 'https://openrouter.ai/api/v1' },
  },
  proaktif: {
    etkin: true,
    sabahOzeti: '08:30',
    aksamOzeti: '',
    sessizBaslangic: '23:00',
    sessizBitis: '08:00',
    merakSorusuGunluk: 1,
    epostaTakip: true,
  },
  // Görev 21 (K9): tek ses — sağlayıcı seçimi yok (shared/ses-kimligi.ts sesSec); `surum` göçte yazılır (aşağıda).
  ses: { uyandirma: true, seslendirme: true, kisayol: 'CommandOrControl+Shift+Space', mikrofonKapali: false, acilisSesi: true, hiz: 1 },
  yetki: { tarayici: true, bilgisayar: false, dosyaOkuma: true, tamYetki: false },
  iceAktarKlasoru: '',
  baslangictaAc: true,
  eposta: [],
  whatsapp: { etkin: false, bagli: false },
  // 0.12 H3a: Görünüm sorusu kurulumdan kalktı — yeni kurulum "Otomatik" (Windows'un teması) başlar; Ayarlar → Görünüm: Koyu · Açık · Otomatik.
  // 0.14 T6b: karakterler varsayılan görünür; 'sade' = Sade mod (shared/karakter-gorunum.ts). Eski profile derin birleştirmeyle 'goster' gelir.
  // 0.14 T19: tam ekranda boştaki çentik çekilir (kapatılabilir); "Az hareket" kapalı (Windows'un animasyon tercihi ayrıca izlenir, R16).
  gorunum: { tema: 'sistem', adaSessiz: true, ada: 'goster', karakterler: 'goster', tamEkrandaGizle: true, azHareket: false },
  // Görev 21 (K10): yerel beyin yalnız Gizli modda (ya da hiç bulut yokken) tek motor; `gorevler` artık okunmaz (eski profiller için).
  yerel: { etkin: false, model: 'bonsai2-27b', gpu: 'otomatik', gizliMod: false, yalnizYerel: false, gorevler: { gundelik: true, eslikci: true, notTutucu: true, raporcu: true, kokpit: true, siniflandirma: true }, hitapAlgila: true },
  // Görev 27 (Ruling BV): yeni profil "Düzenlemelere izin ver", Tam yetki kapalı; yükselen profil kayıtlı tamYetki'yi korur (ccAyarGoc).
  claudeCode: { ...CC_AYAR_VARSAYILAN },
  gunKaydi: {
    etkin: false,
    calisma: { bas: '08:00', bit: '23:00', gunler: [0, 1, 2, 3, 4, 5, 6] },
    kilitteDuraklat: true,
    motor: 'otomatik',
    whisperModel: 'large-v3-turbo-q5_0',
    whisperGpu: 'otomatik',
    eslikci: 'hatirlatma_espri',
    eslikciSesli: true,
    eslikciSaatlik: 4,
    gunlukRaporSaati: '21:30',
    saklama: { ham: 3, onemsiz: 3, onemli: 7, haftalikOnemsiz: 7, haftalikOnemli: 30 },
    hafizayaIsle: true,
  },
  mcp: [],
  mod: 'is',
  // Görev 24: kokpit doldurucuları; 0.6–0.8 profillerine derin birleştirmeyle açık gelir (panoda boş kutu kalmamalı).
  pano: { ...PANO_VARSAYILAN },
};

let onbellek: Ayarlar | null = null;
/** 0.14: sirlar.json'da 'api:anthropic' kaydı var mı (yalnız varlık; tam yüklemede ve her sirYaz'da tazelenir). */
let claudeDiskte = false;
/** Açık kaynak hazırlığı: sirlar.json'da 'api:openai' kaydı var mı (kendi OpenAI uyumlu sağlayıcın; yalnız varlık). */
let openaiDiskte = false;
const dinleyiciler = new Set<(a: Ayarlar) => void>();

function derinBirlestir<T>(taban: T, ek: unknown): T {
  if (!ek || typeof ek !== 'object' || Array.isArray(ek)) return (ek === undefined ? taban : (ek as T));
  const sonuc: Record<string, unknown> = { ...(taban as Record<string, unknown>) };
  for (const [k, v] of Object.entries(ek as Record<string, unknown>)) {
    const t = (taban as Record<string, unknown>)?.[k];
    sonuc[k] = t && typeof t === 'object' && !Array.isArray(t) && v && typeof v === 'object' && !Array.isArray(v) ? derinBirlestir(t, v) : v;
  }
  return sonuc as T;
}

// ayarlar.json var ama ne kendisi ne .bak'ı okunabiliyor: varsayılanlarla açılır, dosyanın ÜZERİNE YAZILMAZ
// (elle kurtarılabilsin; eskiden ilk kayıt bütün ayarları varsayılanla eziyordu).
let ayarYazmaKilitli = false;
const uyarilan = new Set<string>();
function birKezUyar(anahtar: string, mesaj: string): void {
  if (uyarilan.has(anahtar)) return;
  uyarilan.add(anahtar);
  console.error(mesaj);
}

export function ayarlar(): Ayarlar {
  if (onbellek) {
    return onbellek;
  }
  const o = jsonOku(yollar.ayarlar());
  // Kullanım biçimi kararı ham dosyadan (derin birleştirme eksik `mod`u varsayılan 'is' ile doldurur): shared/kullanim-bicimi.ts.
  const ham = typeof o === 'object' && o.veri && typeof o.veri === 'object' ? (o.veri as { mod?: unknown; claudeCode?: { etkin?: unknown; tamYetki?: unknown; varsayilanMod?: unknown }; kurulumTamam?: unknown; kurulumSurumu?: unknown }) : null;
  if (typeof o === 'object') {
    onbellek = derinBirlestir(VARSAYILAN, o.veri);
    // Tanıtım turu sürüm işaretine bakar (tanitimSurumu; src/shared/tanitim.ts — Ruling 20): 0.6.0'dan yükselen kurulu profilde
    // işaret yoktur → tur ilk açılışta BİR KEZ açılır. Geliştirme sürümlerinin eski bayrağı (tanitimGoruldu) artık okunmaz, atılır.
    delete (onbellek as Ayarlar & { tanitimGoruldu?: unknown }).tanitimGoruldu;
    if (o.yedektenMi) birKezUyar('ayar-yedek', '[ayarlar] ayarlar.json okunamadı; yedekten (ayarlar.json.bak) yüklendi.');
  } else {
    onbellek = structuredClone(VARSAYILAN);
    if (o === 'bozuk') { ayarYazmaKilitli = true; birKezUyar('ayar-bozuk', '[ayarlar] ayarlar.json ve yedeği okunamadı; varsayılanlarla açıldı, dosyanın üzerine YAZILMAYACAK.'); }
  }
  if (!onbellek.iceAktarKlasoru) onbellek.iceAktarKlasoru = yollar.varsayilanIceAktar();
  // "bağlı mı" bayrakları her açılışta tazelenir. 0.13 T15 (Spec H): kullanıcının kayıtlı API anahtarları (sirlar.json 'api:*') OKUNMAZ —
  // silinmez, yalnız kullanılmaz; motor yolu hesabın cihaz anahtarından (hesap.ts) gelir. Tek istisna test ortamı (motorTestAnahtari).
  // 0.14 istisnası: Developer'da seçilen Claude anahtarı — bayrak aşağıda (claudeAnahtariVar, anthropicBayragi) göçlerden SONRA eklenir.
  const saglayicilar = ['anthropic', 'openai', 'openrouter'] as SaglayiciAdi[];
  for (const s of saglayicilar) onbellek.saglayicilar[s].anahtarVar = motorAnahtariVarMi(s);
  // Mod (K2, karar G): kayıtlı değilse yükselen profil anahtar ya da açık Claude Code ile Geliştirici; bozuk/eksik → İş.
  onbellek.mod = baslangicModu(ham?.mod, {
    profilVar: Boolean(ham), anahtarVar: saglayicilar.some((s) => onbellek!.saglayicilar[s].anahtarVar), claudeCodeEtkin: ham?.claudeCode?.etkin === true,
  });
  // Claude Code ayarı (Görev 27, Ruling BV): ham dosyadan göç — 0.6–0.8 profili tamYetki'sini ve onun varsayılan modunu korur.
  onbellek.claudeCode = ccAyarGoc(ham?.claudeCode, Boolean(ham), onbellek.claudeCode);
  for (const e of onbellek.eposta) e.parolaVar = sirVar(`eposta:${e.id}`);
  // 0.11 G12a: abonelik alanı kalktı — eski profilde (0.10 ve öncesi) `abonelik` kaydı varsa bellekten atılır (bir sonraki kayıtta
  // dosyadan da gider); hiçbir şey okumaz, hiçbir yere göstermez.
  delete (onbellek as Ayarlar & { abonelik?: unknown }).abonelik;
  // Masaüstü Fuber hesabı (0.10 E3): yalnız bilinen alanlar (sır taşıyabilecek bilinmeyen alan düşer; e-postasız kayıt yok sayılır).
  const hesap = hesapAyariDuzelt(onbellek.hesap);
  if (hesap) onbellek.hesap = hesap; else delete onbellek.hesap;
  // F1 (K5): kurulumun cihaz adı son eki yalnız geçerliyse (4 onaltılık); elle bozulmuşsa düşer, bir sonraki girişte yenisi üretilir.
  if (onbellek.cihazSoneki !== undefined && !cihazSonekiGecerli(onbellek.cihazSoneki)) delete onbellek.cihazSoneki;
  // 0.9.0 ses ve hız göçü (Görev 21; bir kez): eski sağlayıcı seçimi ve "Hızlı yanıtın sesi" silinir, ElevenLabs sesi korunur, Gizli mod
  // kapalı başlar (yerel beyin kurulu ve açık kalır, yanıt yoluna girmez). Kural dosyadaki ses.surum'a bakar (varsayılanla birleşmeden
  // önce). Var olan profil hemen yazılır (bir sonraki açılışta yeniden göç yok); yeni kurulumda yalnız bellekte.
  const hamSes = (ham as { ses?: { surum?: unknown } } | null)?.ses;
  const sesGocuOldu = sesGocu(onbellek as unknown as GocAyari, hamSes?.surum);
  // Kurulum sürümü göçü (Görev 23, K11; bir kez): alan hiç yoksa bu sürümden önce kurulumu bitmiş profil 1 sayılır → sihirbaz bir kez
  // "yükseltme" kipinde açılır (renderer/main.tsx); taze profil 0. Kural dosyadaki HAM değere bakar (varsayılanla birleşmeden önce).
  const kurulumGocuOldu = typeof ham?.kurulumSurumu !== 'number';
  onbellek.kurulumSurumu = kurulumSurumuGocu(ham);
  // 0.10 Görev 2 (P3, Review Focus 1; bir kez): "motor çalıştı" alanı yoksa (0.6–0.9 profili) kayıtlı bir api:* anahtarı varsa true —
  // anahtarı olan kullanıcı motor yokken "bağlı değil" değil "bağlantı koptu" görür. Kural dosyadaki HAM değere bakar; yalnız var olan
  // profilde (dosya henüz yokken kaydedilen ilk anahtar "çalıştı" sayılmaz — ilk başarılı çağrıyı bekler).
  const hamMotorCalisti = (ham as { motorCalisti?: unknown } | null)?.motorCalisti;
  const motorGocuOldu = typeof hamMotorCalisti !== 'boolean';
  onbellek.motorCalisti = ham ? motorCalistiGocu(hamMotorCalisti, saglayicilar.some((s) => onbellek!.saglayicilar[s].anahtarVar)) : false;
  // Bozuk tema değeri 'koyu'ya göçer (0.13 T13: 'cam' = Şeffaf geçerlidir, korunur; bu bilgisayarda yoksa Koyu çizilir: main/tema.ts).
  const temaGocuOldu = onbellek.gorunum.tema !== temaGocu(onbellek.gorunum.tema);
  onbellek.gorunum.tema = temaGocu(onbellek.gorunum.tema);
  // 0.14 T6b: elle bozulmuş karakter görünümü varsayılana döner (yalnız bellekte; bir sonraki kayıtta dosyaya).
  if (!karakterGorunumuGecerli(onbellek.gorunum.karakterler)) onbellek.gorunum.karakterler = KARAKTER_GORUNUMU_VARSAYILAN;
  centikSayfalariniDuzelt(onbellek);
  // Son bütün dal incelemesi K-1: "Yalnız bu bilgisayar" göçünün işareti. Yeni profil (dosya yok) işaretli başlar — yalnız bellekte, ilk kayıtta
  // dosyaya; burada YAZILMAZ (yeni profilin dosyası erken oluşmasın). İşaretsiz var olan profil 0.12 öncesidir: eski yalnizYerel kararı açılışta
  // bir kez yerel/gizli-geri-al.ts acilistaYalnizYerelGocu'da (yerel hazır mı orada bilinir; bu modül yerel kuruluma bağlanmaz).
  if (!ham) onbellek.yalnizYerelGocu = YALNIZ_YEREL_GOCU;
  // 0.14 (ürün kararı): Developer'ın Claude anahtarı. Yalnız VARLIĞI okunur (çözülmez); mod ve göçler yukarıda YALNIZ test ortamı
  // anahtarına bakar — kayıtlı kullanıcı anahtarı profili Developer'a çevirmez, "motor çalıştı" göçünü açmaz. Bozuk seçim değeri 'fuber'e döner.
  const sirlar = sirlariOku();
  claudeDiskte = Boolean(sirlar['api:anthropic']);
  openaiDiskte = Boolean(sirlar['api:openai']);
  if (!MOTOR_SECIMLERI.includes(onbellek.motorSecimi as MotorSecimi)) delete onbellek.motorSecimi;
  secimBayraklariniTazele(onbellek);
  // Var olan profil hemen yazılır (bir sonraki açılışta yeniden göç yok); yeni kurulumda yalnız bellekte.
  if ((sesGocuOldu || kurulumGocuOldu || motorGocuOldu || temaGocuOldu) && ham && !ayarYazmaKilitli) {
    try { jsonYaz(yollar.ayarlar(), onbellek, 2); } catch (e) { console.error('[ayarlar] göç yazılamadı:', (e as Error).message); }
  }
  return onbellek;
}

/** 0.14 T23: "Çentik sayfaları" (gorunum.centikSayfalari) bellekte de dosyada da doğrulanmış durur: bilinmeyen sayfa ve tekrar düşer, Asistan kapatılamaz,
 *  eksik sayfa sona eklenir (shared/centik-sayfalar.ts sayfaAyariDogrula). Alan yoksa dokunulmaz (varsayılan: dokuzu açık). */
function centikSayfalariniDuzelt(a: Ayarlar): void {
  if (a.gorunum?.centikSayfalari !== undefined) a.gorunum.centikSayfalari = sayfaAyariDogrula(a.gorunum.centikSayfalari);
}

export function ayarlariKaydet(degisiklik: Partial<Ayarlar> | ((a: Ayarlar) => void)): Ayarlar {
  const a = ayarlar();
  const secimOnce = `${a.mod}|${a.motorSecimi}|${JSON.stringify(a.openaiUyumlu ?? null)}`;
  // Bayrağın Claude DIŞI nedeni (test ortamı anahtarı vb.) korunur; yalnız Claude payı yeniden hesaplanır.
  const digerNeden = a.saglayicilar.anthropic.anahtarVar && !claudeSecili(a);
  if (typeof degisiklik === 'function') degisiklik(a);
  else onbellek = derinBirlestir(a, degisiklik);
  centikSayfalariniDuzelt(onbellek!);
  // 0.14: mod ya da sağlayıcı seçimi bu kayıtta değiştiyse Claude bayrağı hemen izler (Business'a geçiş → anında Fuber); dinleyicilere
  // giden nesnede de güncel. Seçim ayrıca motor/secici.ts hazirMi'de claudeSecili ile her çağrıda yeniden denetlenir.
  if (`${onbellek!.mod}|${onbellek!.motorSecimi}|${JSON.stringify(onbellek!.openaiUyumlu ?? null)}` !== secimOnce) secimBayraklariniTazele(onbellek!, digerNeden);
  if (ayarYazmaKilitli) console.error('[ayarlar] ayarlar.json bozuk; değişiklik yalnız bu oturumda geçerli (dosyaya yazılmadı).');
  else jsonYaz(yollar.ayarlar(), onbellek, 2);
  dinleyicilereBildir();
  return onbellek!;
}

/** Ayar dinleyicileri birbirinden yalıtılır: biri fırlatırsa (günlüğe yazılır) ötekiler (pencerelere yayın, tepsi, ada) yine çalışır,
 *  kayıt da (ayarlar:kaydet) reddedilmez — ayar dosyaya çoktan yazıldı. */
function dinleyicilereBildir(): void {
  for (const d of dinleyiciler) {
    try { d(onbellek!); } catch (e) { console.error('[ayarlar] ayar dinleyicisi hata verdi:', e); }
  }
}

export function ayarDinle(f: (a: Ayarlar) => void): () => void {
  dinleyiciler.add(f);
  return () => dinleyiciler.delete(f);
}

// ── Sırlar ───────────────────────────────────────────────────────────────────────────────────────────────────
function sirlariOku(): Record<string, string> {
  const o = jsonOku(yollar.sirlar());
  if (o === 'bozuk') birKezUyar('sir-bozuk', '[sırlar] sirlar.json ve yedeği okunamadı; kayıtlı anahtarlar yok sayılıyor.');
  else if (typeof o === 'object' && o.yedektenMi) birKezUyar('sir-yedek', '[sırlar] sirlar.json okunamadı; yedekten (sirlar.json.bak) okunuyor.');
  return typeof o === 'object' ? (o.veri as Record<string, string>) : {};
}

/** Sır dosyası (ve yedeği) bütünüyle okunamıyor mu (0.14 T34c düzeltme 2, N4)? O zaman `sirOku` her şeyi "yok" görür; bunu "ilk kurulum"
 *  sanıp yeniden kayıt ya da üstüne yazma yapılmasın diye köprü sorar. */
export function sirDosyasiOkunamiyor(): boolean {
  return jsonOku(yollar.sirlar()) === 'bozuk';
}

export function sirVar(ad: string): boolean {
  return Boolean(sirlariOku()[ad]) || Boolean(ortamSirri(ad));
}

/** Testler ve geliştirme: FUBER_SIR_API_ANTHROPIC gibi ortam değişkenleri sır dosyasının önüne geçer. */
function ortamSirri(ad: string): string | undefined {
  return process.env[`FUBER_SIR_${ad.replace(/[^a-z0-9]/gi, '_').toUpperCase()}`];
}

/** Motor için TEK test kapısı (0.13 T15): kullanıcı API anahtarı yok — kayıtlı 'api:*' sırları diskte kalır, motor yolunda okunmaz. Sahte ağ
 *  geçitleri (testler, geliştirme) yalnız FUBER_SIR_API_<SAĞLAYICI> ortam değişkeniyle beslenir; kurulu uygulamada bu değişkenler yalnız
 *  yalıtılmış test profilinde geçerlidir (shared/ortam-kapisi.ts PROFIL_KANCASI_ONEKLERI), kullanıcının makinesinde hiç yoktur. */
export function motorTestAnahtari(s: SaglayiciAdi = 'anthropic'): string | undefined {
  return ortamSirri(`api:${s}`) || undefined;
}
const motorAnahtariVarMi = (s: SaglayiciAdi): boolean => Boolean(motorTestAnahtari(s));
/** Anthropic "bağlı" bayrağı: test ortamı anahtarı ya da (0.14) Claude seçili + anahtar kayıtlı (5 Kas: iki modda da). */
const anthropicBayragi = (a: Ayarlar): boolean => motorAnahtariVarMi('anthropic') || claudeSecili(a);
/** OpenAI "bağlı" bayrağı: test ortamı anahtarı ya da kendi OpenAI uyumlu sağlayıcın seçili ve hazır (anahtar ya da bu bilgisayardaki sunucu). */
const openaiBayragi = (a: Ayarlar): boolean => motorAnahtariVarMi('openai') || openaiUyumluSecili(a);
/** Sağlayıcı seçimi ve iki bayrak birlikte tazelenir (açılışta, mod/seçim/ayar değişince, sır yazılınca). */
function secimBayraklariniTazele(a: Ayarlar, digerAnthropic = false): void {
  a.claudeAnahtariVar = claudeDiskte || Boolean(ortamSirri('api:anthropic'));
  a.openaiAnahtariVar = openaiDiskte || Boolean(ortamSirri('api:openai'));
  if (a.openaiUyumlu !== undefined) { const o = openaiUyumluSuz(a.openaiUyumlu); if (o) a.openaiUyumlu = o; else delete a.openaiUyumlu; }
  a.saglayicilar.anthropic.anahtarVar = digerAnthropic || anthropicBayragi(a);
  a.saglayicilar.openai.anahtarVar = openaiBayragi(a);
}

/**
 * 0.14 (ürün kararı): kullanıcının kendi motor anahtarı — YALNIZ Anthropic (5 Kas: Business ve Developer'da; Business kullanıcıları da
 * kendi API anahtarını kullanabilir). Başka sağlayıcıda sır dosyasına hiç bakılmaz, undefined döner. Gizli / "Yalnız bu bilgisayar" buluta
 * gitmez kuralı motor/secici.ts'in yol denetiminde (tekMotorYolu) ve motor:sina'da, bu çözümden önce gelir. Seçim (Fuber/Claude) burada aranmaz: "Bağlantıyı dene" Claude seçilmeden
 * önce de sınayabilsin; motorun Claude'a GİTMESİ ayrıca claudeSecili ister (motor/secici.ts hazirMi). Anahtar günlüğe/arayüze yazılmaz.
 */
export function kullaniciMotorAnahtari(s: SaglayiciAdi): string | undefined {
  // Açık kaynak hazırlığı: kendi OpenAI uyumlu sağlayıcının anahtarı da ('api:openai'). OpenRouter ve Fuber anahtarı hâlâ okunmaz
  // (OpenRouter, OpenAI uyumlu taban adresiyle 'openai' seçeneğinden kullanılır).
  if (s !== 'anthropic' && s !== 'openai') return undefined;
  try { return sirOku(`api:${s}`) || undefined; } catch (e) {
    birKezUyar(`${s}-anahtar`, `[sırlar] ${s === 'anthropic' ? 'Anthropic' : 'OpenAI uyumlu sağlayıcı'} anahtarı çözülemedi: ${(e as Error).message}`);
    return undefined;
  }
}

export function sirOku(ad: string): string | undefined {
  const ortam = ortamSirri(ad);
  if (ortam) return ortam;
  const kayit = sirlariOku()[ad];
  if (!kayit) return undefined;
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows şifreleme hizmeti (DPAPI) kullanılamıyor.');
  return safeStorage.decryptString(Buffer.from(kayit, 'base64'));
}

export function sirYaz(ad: string, deger: string | null): void {
  // Okunamayan sır dosyasına yazılmaz: boş nesne + yeni anahtar yazılınca öteki bütün anahtarlar siliniyordu.
  if (jsonOku(yollar.sirlar()) === 'bozuk') {
    console.error(`[sırlar] sirlar.json okunamadı; "${ad}" yazılmadı (öteki sırlar korunuyor).`);
    throw new Error('Sır dosyası okunamadı; değişiklik kaydedilmedi (öteki anahtarlar korunuyor).');
  }
  const s = { ...sirlariOku() };
  if (deger === null || deger === '') delete s[ad];
  else {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows şifreleme hizmeti (DPAPI) kullanılamıyor; sır saklanmadı.');
    s[ad] = safeStorage.encryptString(deger).toString('base64');
  }
  jsonYaz(yollar.sirlar(), s);
  onbellek = null; // bayraklar tazelensin
  ayarlar();
  dinleyicilereBildir();
}
