// ── Yerel beyin kurulumu: llama.cpp (PrismML) + Bonsai modeli + Piper (Türkçe ses) ───────────────────────────────
// Kullanıcı Ayarlar → Yerel beyin → "Kur"a basınca (ya da kokpitteki öneriden) eksik parçalar indirilir, SHA-256
// doğrulanır (bkz. paketler.ts), açılır. Yer: %APPDATA%\Fuber AI\yerel (testte FUBER_MODEL_DIZINI). Zaten inmiş ve
// doğrulanmış dosya yeniden indirilmez; model değişince yalnız yeni model iner.
// Başka bir model `yerelKur(model)` ile, çalışan yerel beyin DURMADAN indirilebilir (Ayarlar → Gizlilik: kurulu olmayan model kartı);
// ayara geçiş ancak doğrulanmış kurulumdan sonra yapılır (ipc.ts yerel:kur) — kurulu olmayan modele geçmek sunucuyu "kurulu değil"
// ile durdururdu (main.ts model değişince yeniden başlatır).
// İstenen kurulum (Görev 15 düzeltme 1): `yerel:kur(model, { ac: true })` (sihirbazın "Ekstra gizlilik"i, Ayarlar'da ilk kurulum)
// kaydı `yerel.bekleyenKurulum`'a yazar; doğrulanmış kurulumda yerel beyin açılır ve kayıt silinir, kullanıcı durdurursa silinir,
// hatada hatayla kalır. Uygulama indirme sürerken kapanırsa kayıt kalır: arayüz açılışta "yarıda kaldı — Sürdür / Vazgeç" gösterir
// (shared/yerel-bekleyen.ts). "Aç" kararı arayüzde değil burada: sihirbaz kapandıktan sonra biten indirme de yerel beyni açar.
// 0.13 G: model kaydı katalogdan gelir (yerel/katalog.ts), dosyanın yeri modelDosyaYolu. Kayıttaki boyut indirmenin üst sınırıdır (küçük boyut bildiren kayıt diski dolduramaz). Özet, tam boyut
// ve ilk 4 bayt (GGUF) dosya YERİNE KONMADAN denetlenir: reddedilen dosya silinir, kurulu model etkilenmez, kart düz cümleyle söyler. Doğrulanan modelin kaydı kurulu-modeller.json'a yazılır:
// liste değişse, önbellek bozulsa da model çalışır. Çalışan modelin yenisi inerse eskisi indirme boyunca çalışır, sunucu yalnız dosya yerine konacağı an kapanır: açık kalsa eski modelle yanıt vermeyi sürdürürdü (1 Kas ölçümü).
import fs from 'node:fs';
import path from 'node:path';
import { ayarlar, ayarlariKaydet } from '../ayarlar.js';
import { nvidiaVarMi } from '../gpu.js';
import { indir, hazirMi, zipAc, dosyaBul, ggufBasligi } from '../indirme.js';
import { siraylaKaldir, klasoruSil } from './kaldirma.js';
import { LLAMA, PIPER, type Varlik } from './paketler.js';
import { katalogBul, kuruluModeliKaydet, modelDosyaYolu, modelDosyasiKurulu, modelEskiMi, yerelKok } from './katalog.js';
import { kurulumDiskHesabi, bitinceAcilirMi, MODEL_SUNULMUYOR } from '../../shared/yerel-bekleyen.js';
import { yedekKlasoru, piperHazirMi, yedekSesKur, yedekIndirmeDurumu } from './piper.js';
import { whisperHazirMi, whisperIndirmeBoyutu, whisperKur, whisperDurumu as whisperDurumuOku } from '../gunkaydi/whisper.js';
import { yerelSesEksikleri } from '../../shared/yerel-ses.js';
import type { Ayarlar, YerelModelAdi } from '../../shared/tipler.js';

export interface YerelIndirme { yuzde: number; adim: string; hata?: string }

export { yerelKok };
const indirilen = () => path.join(yerelKok(), 'indirilen');

let indirme: YerelIndirme | undefined;
let bildir: () => void = () => undefined;
export const yerelKurulumBildirici = (f: () => void) => { bildir = f; };
export const yerelIndirmeDurumu = () => indirme;

const llamaKlasoru = (cuda: boolean) => path.join(yerelKok(), `llama-${LLAMA.surum}-${cuda ? 'cuda' : 'cpu'}`);
// Görev 21: Piper (yedek ses) artık yerel beyinden bağımsız klasörde (yerel/piper.ts): yerel beyni kaldırmak sesi götürmez.
const piperKlasoru = () => yedekKlasoru();

/** Bu modelin dosyası inmiş ve doğrulanmış mı? (Ayarlar'daki kartlar "Kurulu / İndirilmesi gerekir" gösterir.) */
export function modelKuruluMu(ad: YerelModelAdi): boolean {
  const k = katalogBul(ad);
  return Boolean(k) && modelDosyasiKurulu(k!);
}
let modelDegisiyor: (yol: string) => Promise<void> = async () => undefined;
/** Doğrulanmış yeni dosya yerine konmadan hemen önce çağrılır (sunucu.ts bağlar: o modeli çalıştıran süreç kapanır, sonraki açılış yeni dosyayı okur). */
export const modelDegisimKancasi = (f: (yol: string) => Promise<void>) => { modelDegisiyor = f; };
/** Başlatılamayacak dosyayı ve "doğrulandı" işaretini siler (GGUF başlığı yok; sunucu.ts). */
export function modelDosyasiniSil(yol: string): void {
  fs.rmSync(yol, { force: true });
  fs.rmSync(`${yol}.dogrulandi`, { force: true });
}

/** Kaldırma sürerken (yerelKaldir) yerel beyin "kurulu değil" sayılır: sunucu/ses yeniden açılmaz, silinen klasördeki .exe kilitlenmez. */
let kaldiriliyor = false;

/** Kurulu parçaların yolları (eksikse null); model verilmezse ayardaki model. Yedek ses (Piper) ayrı: yerel/piper.ts. */
export function yerelYollar(model: YerelModelAdi = ayarlar().yerel.model): { sunucu: string | null; model: string | null; cuda: boolean } {
  if (kaldiriliyor) return { sunucu: null, model: null, cuda: false };
  const cuda = fs.existsSync(path.join(llamaKlasoru(true), '.tamam'));
  const kl = cuda ? llamaKlasoru(true) : llamaKlasoru(false);
  const sunucu = fs.existsSync(path.join(kl, '.tamam')) ? dosyaBul(kl, /^llama-server\.exe$/i) : null;
  const k = katalogBul(model);
  return { sunucu, cuda, model: k && modelDosyasiKurulu(k) ? modelDosyaYolu(k) : null };
}

export function yerelKuruluMu(model?: YerelModelAdi): boolean {
  const y = yerelYollar(model);
  return Boolean(y.sunucu && y.model);
}

/** Eksik parçaları indirir ve kurar. `model` verilirse ayardaki model yerine o iner (ayar değişmez). Aynı model zaten iniyorsa o iş
 *  beklenir; BAŞKA bir model iniyorsa hemen reddedilir (eskiden çalışan işe katılıyor, ipc.ts de ardından henüz inmemiş modele
 *  geçiyordu). Durdurma: yerelIndirmeyiDurdur. */
let suren: { model: YerelModelAdi; is: Promise<void>; durdur: AbortController } | null = null;
export class BaskaIndirmeSuruyor extends Error {
  constructor(readonly suren: YerelModelAdi) { super(`Başka bir indirme sürüyor (${katalogBul(suren)?.ad ?? suren}); önce o bitsin ya da durdur.`); }
}
export function yerelKur(model?: YerelModelAdi): Promise<void> {
  if (kaldiriliyor) return Promise.reject(new Error('Bu bilgisayardaki yapay zekâ kaldırılıyor; bitince yeniden kurabilirsin.'));
  const hedef = model ?? ayarlar().yerel.model;
  if (!katalogBul(hedef)) return Promise.reject(new Error(MODEL_SUNULMUYOR));
  if (suren) return suren.model === hedef ? suren.is : Promise.reject(new BaskaIndirmeSuruyor(suren.model));
  const durdur = new AbortController();
  // İş bitince (başarı, hata, durdurma) durum yeniden yayınlanır: kur()'un son yayını "inen" alanını henüz taşıyordu.
  const is = kur(hedef, durdur.signal).finally(() => { if (suren?.is === is) suren = null; bildir(); });
  suren = { model: hedef, is, durdur };
  return is;
}
/** Süren indirmeyi durdurur: ağ okuması bırakılır, yarım dosya silinir, durum temizlenir (kurulmuş parçalar kalır). */
export function yerelIndirmeyiDurdur(): boolean {
  if (!suren) return false;
  suren.durdur.abort();
  return true;
}
/** Şu an inen model (yoksa null). */
export const yerelInenModel = (): YerelModelAdi | null => suren?.model ?? null;

/** Yerel klasörün sürücüsündeki boş yer (bayt; klasör yoksa en yakın var olan üst klasör). Okunamazsa NaN (denetim atlanır).
 *  Test: FUBER_DEMO'da FUBER_TEST_BOS_DISK_GB boş yeri taklit eder (gerçek disk okunmaz). */
function bosAlan(): number {
  if (process.env.FUBER_DEMO && process.env.FUBER_TEST_BOS_DISK_GB) return Number(process.env.FUBER_TEST_BOS_DISK_GB) * 1e9;
  let yol = yerelKok();
  while (!fs.existsSync(yol)) { const ust = path.dirname(yol); if (ust === yol) break; yol = ust; }
  try { const s = fs.statfsSync(yol); return s.bavail * s.bsize; } catch { return Number.NaN; }
}
const durdurmaHatasi = () => Object.assign(new Error('İndirme durduruldu.'), { name: 'AbortError' });

const boyutHatasi = (ad: string) => `${ad} doğrulanamadı ve silindi: dosya kayıtlı boyutta değil. Kurulu model etkilenmedi.`;
/** indir()'in model hatası → düz cümle. Yarım dosya silindi, kurulu dosya yerinde. Model katalogdan kapatılana dek başka cihazlar da aynı hatayı alır: kart ne olduğunu söyler. */
function modelIndirmeHatasi(ad: string, e: Error): Error {
  const kod = (e as { code?: unknown }).code;
  if (kod === 'SHA') return new Error(`${ad} doğrulanamadı ve silindi: inen dosya kayıtlı olanla aynı değil, bozulmuş ya da Hugging Face'te değişmiş olabilir. Kurulu model etkilenmedi.`);
  return kod === 'BUYUK' ? new Error(boyutHatasi(ad)) : e;
}
/** Özet tuttu, dosya henüz `.indiriliyor`: tam boyut ve GGUF başlığı burada; geçerse o dosyayı açık tutan sunucu kapanır. */
async function modelYerineKonabilir(m: { ad: string; boyut: number }, hedef: string, gecici: string, bayt: number): Promise<void> {
  if (bayt !== m.boyut) throw new Error(boyutHatasi(m.ad));
  if (ggufBasligi(gecici) === false) throw new Error(`${m.ad} doğrulanamadı: dosya model dosyası değil (GGUF başlığı yok), silindi. Kurulu model etkilenmedi.`);
  await modelDegisiyor(hedef);
}

async function kur(model: YerelModelAdi, sinyal: AbortSignal): Promise<void> {
  const a = ayarlar().yerel;
  try {
    indirme = { yuzde: 0, adim: 'Hazırlanıyor' }; bildir();
    const cuda = a.gpu !== 'cpu' && (await nvidiaVarMi());
    const m = katalogBul(model);
    if (!m) throw new Error(MODEL_SUNULMUYOR);
    // İş listesi: [varlık, hedef dosya, açılacak klasör?]
    const isler: [Varlik, string, string | null, string][] = [
      ...(cuda ? LLAMA.cuda : LLAMA.cpu).map((v) => [v, path.join(indirilen(), v.ad), llamaKlasoru(cuda), 'Çalıştırıcı (llama.cpp)'] as [Varlik, string, string, string]),
      [m, modelDosyaYolu(m), null, `Model (${m.ad})`],
      // Yedek ses zaten varsa (pakette, bağımsız kurulumda ya da taşınmış eski yerde) yeniden inmez.
      ...(piperHazirMi() ? [] : [
        [PIPER.calistirici, path.join(indirilen(), PIPER.calistirici.ad), piperKlasoru(), 'Ses (Piper)'],
        [PIPER.ses, path.join(piperKlasoru(), PIPER.ses.ad), null, 'Türkçe ses'],
        [PIPER.sesAyari, path.join(piperKlasoru(), PIPER.sesAyari.ad), null, 'Türkçe ses'],
      ] as [Varlik, string, string | null, string][]),
    ];
    // Açılmış klasörü tamam olan arşivi yeniden indirme.
    const gerekli = isler.filter(([, , acilacak]) => !(acilacak && fs.existsSync(path.join(acilacak, '.tamam'))));
    // Disk (düzeltme 2): HİÇBİR şey yazılmadan önce boş yer = inecek parçalar (tam boyutta olmayanlar) + açılacak arşivler + pay.
    // Arayüzün uygunluk denetimi atlanabilir ("Sürdür", telefondan eski istek): diski sıfıra dek doldurmasın, aynı iletiyle dursun.
    // B6: inmiş ama açılmamış arşivin açma payı da sayılır; inecek parçanın eski yarım dosyası (.indiriliyor; baştan yazılır) boş sayılır.
    const boyutu = (y: string) => { try { return fs.statSync(y).size; } catch { return -1; } };
    const { gereken, geriKazanilan } = kurulumDiskHesabi(gerekli.map(([v, hedef, acilacak]) => ({
      // Eski model dosyası boyutu tutsa da yeni dosya onun yanına iner.
      boyut: v.boyut, acilacak: Boolean(acilacak), indi: boyutu(hedef) === v.boyut && !(v === m && modelEskiMi(m)), yarim: Math.max(0, boyutu(`${hedef}.indiriliyor`)),
    })));
    // 0.14.1 (Gizli modda sürekli "indirmen lazım" deniyordu): yazıya çevirme (Whisper) de AYNI akışta iner — Gizli ve "Yalnız bu
    // bilgisayar" sesi yalnız bu bilgisayarda yazıya çevirir; eskiden ilk diktede ayrıca indiriliyordu. Zaten kuruluysa (gün kaydından) inmez.
    const sesBayt = whisperHazirMi() ? 0 : Math.round((await whisperIndirmeBoyutu().catch(() => 0)) * 1e6);
    const bos = bosAlan() + geriKazanilan;
    if (Number.isFinite(bos) && bos < gereken + sesBayt * 2) throw Object.assign(new Error('Diskte yer kalmadı.'), { code: 'ENOSPC' });
    fs.mkdirSync(indirilen(), { recursive: true });
    fs.mkdirSync(path.join(yerelKok(), 'modeller'), { recursive: true });
    const toplam = gerekli.reduce((n, [v]) => n + v.boyut, 0) + sesBayt || 1;
    let biten = 0;
    for (const [v, hedef, acilacak, etiket] of gerekli) {
      if (sinyal.aborted) throw durdurmaHatasi();
      fs.mkdirSync(path.dirname(hedef), { recursive: true });
      indirme = { yuzde: Math.round((biten / toplam) * 97), adim: `${etiket} · denetleniyor` }; bildir();
      if (!(await hazirMi(hedef, v.boyut, v.sha256))) {
        const modelMi = v === m;
        await indir(v.url, hedef, v.sha256, (g, t) => {
          indirme = { yuzde: Math.round(((biten + g) / toplam) * 97), adim: `${etiket} · ${(g / 1048576).toFixed(0)}/${((t || v.boyut) / 1048576).toFixed(0)} MB` };
          bildir();
        }, sinyal, undefined, modelMi ? m.boyut : undefined, modelMi ? (gecici, bayt) => modelYerineKonabilir(m, hedef, gecici, bayt) : undefined)
          .catch((e: Error) => { throw modelMi ? modelIndirmeHatasi(m.ad, e) : e; });
      }
      biten += v.boyut;
      if (acilacak) {
        indirme = { yuzde: Math.round((biten / toplam) * 97), adim: `${etiket} · açılıyor` }; bildir();
        await zipAc(hedef, acilacak);
        // Klasörün tamamı (çalıştırıcı + CUDA DLL'leri) inince işaretlenir.
        const kardesler = isler.filter(([, , k]) => k === acilacak);
        if (kardesler[kardesler.length - 1][1] === hedef) fs.writeFileSync(path.join(acilacak, '.tamam'), new Date().toISOString());
      }
    }
    // Kurulum sürerken model listeden kalkmış olabilir: kayıt önce yazılır, kurulu sayılır.
    if (modelDosyasiKurulu(m)) kuruluModeliKaydet(m);
    if (!yerelKuruluMu(model)) throw new Error('Kurulum tamamlanamadı (llama-server.exe ya da model bulunamadı).');
    if (sesBayt) {
      const bas = Math.round((biten / toplam) * 97);
      // Yazıya çevirmenin hatası yerel beyni KURULMAMIŞ yapmaz (sohbet açılır); hata Whisper'ın kendi durumunda kalır — dikte "kurulamadı,
      // Yeniden dene" der — ve sonraki açılışta / Gizli'ye geçişte kaldığı parçadan sürer (yerelSesiTamamla). Durdurma ise durdurmadır.
      await whisperKur({
        baslat: false, firlat: true, sinyal,
        izle: (d) => { indirme = { yuzde: bas + Math.round(((97 - bas) * Math.min(100, d.yuzde)) / 100), adim: `Yazıya çevirme · ${d.adim}` }; bildir(); },
      }).catch((e: Error) => { if (sinyal.aborted || e?.name === 'AbortError') throw e; });
    }
    indirme = { yuzde: 100, adim: 'Kuruldu' }; bildir();
    setTimeout(() => { if (indirme?.yuzde === 100) { indirme = undefined; bildir(); } }, 8000);
  } catch (e) {
    // Kullanıcı durdurduysa hata değildir: durum temizlenir (yarım dosyayı indir() sildi). "Durduruldu" kararı SİNYALDEN: özet ya da zip
    // açılırken gelen durdurma (ör. "Kaldır") başka bir hatayla bitse de durdurma sayılır ve AbortError olarak iletilir (kart "kurulamadı"
    // demez). Disk dolduysa ileti "Diskte yer kalmadı.".
    if (sinyal.aborted || (e as Error)?.name === 'AbortError') { indirme = undefined; bildir(); throw durdurmaHatasi(); }
    indirme = { yuzde: indirme?.yuzde ?? 0, adim: 'Kurulum durdu', hata: (e as Error).message }; bildir();
    throw e;
  }
}

/** Yarım kalmış indirme dosyalarını (*.indiriliyor) siler — yalnız hiçbir indirme sürmüyorken. Açılışta istek kaydı yoksa ve kartta
 *  "Vazgeç"te: işe yaramayan yarım dosya (yüzlerce MB) diskte kalmasın. */
export function yarimlariTemizle(): void {
  if (suren) return;
  const gez = (k: string) => {
    if (!fs.existsSync(k)) return;
    for (const x of fs.readdirSync(k, { withFileTypes: true })) {
      const y = path.join(k, x.name);
      if (x.isDirectory()) gez(y);
      else if (x.name.endsWith('.indiriliyor')) fs.rmSync(y, { force: true });
    }
  };
  try { gez(yerelKok()); } catch (e) { console.warn('[yerel] yarım dosyalar silinemedi:', (e as Error).message); }
}

// ── İstenen kurulumun kaydı (yerel.bekleyenKurulum) ──────────────────────────────────────────────────────────────
/** İstenen kurulum başlarken: kayıt (hata yok). `etkinBaslangic`: o an yerel beyin açık mıydı — indirme sürerken elle kapatılırsa
 *  bitince yeniden açılmaz. Yeniden denemede (Sürdür) ilk isteğin değeri korunur. */
export function bekleyenYaz(model: YerelModelAdi, gizliMod?: boolean, secim?: 'gizli' | 'yerel'): void {
  ayarlariKaydet((a) => {
    // H3c düzeltme turu 1 (Kü7): "Nerede çalışsın" seçimi (Gizli / Yalnız bu bilgisayar) kayıtla AYNI yazımda — arada kayıtsız bir
    // "Gizli açık ama hazır değil" anı (kırmızı motor:durum) olmaz (N-4 tek yazım ilkesi).
    if (secim === 'gizli') { a.yerel.gizliMod = true; a.yerel.yalnizYerel = false; }
    else if (secim === 'yerel') { a.yerel.yalnizYerel = true; a.yerel.gizliMod = false; }
    const once = a.yerel.bekleyenKurulum;
    const ayni = once?.model === model;
    // Görev 23: "bitince Gizli modu aç" seçimi — verilmezse (Sürdür, Ayarlar'dan kurulum) aynı modelin önceki seçimi korunur.
    const gizli = gizliMod ?? (ayni ? once?.gizliMod : undefined);
    a.yerel.bekleyenKurulum = { model, zaman: new Date().toISOString(), etkinBaslangic: ayni && once?.etkinBaslangic !== undefined ? once.etkinBaslangic : a.yerel.etkin, ...(gizli ? { gizliMod: true } : {}) };
  });
}
/** Doğrulanmış kurulumdan sonra: kayıt varsa model bu olur ve yerel beyin açılır — indirme başladığında açıkken kullanıcı sonradan elle
 *  kapattıysa açılmaz (kararına saygı). Sihirbazda Gizli mod seçildiyse (Görev 23) yerel beyinle birlikte Gizli mod da açılır. Kayıt yoksa
 *  (Vazgeç/Kaldır sonrası) false: istek geçersiz, hiçbir şey açılmaz. */
export function bekleyenTamamla(model: YerelModelAdi): boolean {
  const b = ayarlar().yerel.bekleyenKurulum;
  if (!b) return false;
  const ac = bitinceAcilirMi(b, ayarlar().yerel.etkin); // kartın "bitince açılır" metniyle aynı kural (shared/yerel-bekleyen.ts)
  ayarlariKaydet((a) => { a.yerel.model = model; if (ac) { a.yerel.etkin = true; if (b.gizliMod) a.yerel.gizliMod = true; } delete a.yerel.bekleyenKurulum; });
  return true;
}
/** İstenmiş kurulum sürerken Gizli mod seçimi değişti (sihirbazın Ekstra gizlilik adımı). Kayıt yoksa bir şey yapmaz. */
export function bekleyenGizli(v: boolean): void {
  const b = ayarlar().yerel.bekleyenKurulum;
  if (!b || Boolean(b.gizliMod) === v) return;
  ayarlariKaydet((a) => {
    if (!a.yerel.bekleyenKurulum) return;
    if (v) a.yerel.bekleyenKurulum.gizliMod = true; else delete a.yerel.bekleyenKurulum.gizliMod;
  });
}
/** Takip turu: bu sürümün yeniden yazılacak yarım indirme dosyalarının toplamı (model + çalıştırıcı/ses parçaları; `.indiriliyor`) — ana süreç
 *  uygunluk kapısı (yerel/uygunluk.ts) bunları boş yer sayar. Okunamazsa 0. */
export function yerelYarimBayt(model: YerelModelAdi): number {
  const boyut = (y: string) => { try { return fs.statSync(y).size; } catch { return 0; } };
  const k = katalogBul(model);
  let n = k ? boyut(`${modelDosyaYolu(k)}.indiriliyor`) : 0;
  try {
    for (const x of fs.readdirSync(indirilen(), { withFileTypes: true })) if (x.isFile() && x.name.endsWith('.indiriliyor')) n += boyut(path.join(indirilen(), x.name));
  } catch { /* klasör yok */ }
  return n;
}
/** Kaydın silinmesi — yama olarak da (F1 düzeltme turu 1, N-4: yerel/gizli-geri-al.ts bekleyenleGizliyiDenetle ile Gizli'nin geri
 *  alınması tek yazımda). */
export const bekleyenSilYamasi = (a: Ayarlar): void => { delete a.yerel.bekleyenKurulum; };
/** Kullanıcı durdurdu, kartta "Vazgeç" dedi ya da yerel beyni kaldırdı: kayıt silinir (yerel beyin açılmaz). */
export function bekleyenSil(): void {
  if (ayarlar().yerel.bekleyenKurulum) ayarlariKaydet(bekleyenSilYamasi);
}
/** Kalıcı hata yaması (bekleyenHata'nın kaydı; N-4: Gizli'nin geri alınmasıyla tek yazımda kullanılır). */
export const bekleyenHataYamasi = (model: YerelModelAdi, hata: string) => (a: Ayarlar): void => {
  const once = a.yerel.bekleyenKurulum;
  a.yerel.bekleyenKurulum = { model, zaman: once?.zaman ?? new Date().toISOString(), ...(once?.etkinBaslangic !== undefined ? { etkinBaslangic: once.etkinBaslangic } : {}), ...(once?.gizliMod ? { gizliMod: true } : {}), hata };
};
/** Hata: kayıt hatayla kalır (kart "kurulamadı — Yeniden dene / Vazgeç"). */
export function bekleyenHata(model: YerelModelAdi, hata: string): void {
  ayarlariKaydet(bekleyenHataYamasi(model, hata));
}
/** Açılışta: kayıt kaldıysa ama model kurulmuş ve doğrulanmışsa (kayıt silinmeden kapanmış) tamamlanır; kayıt yoksa yarım dosyalar
 *  silinir (işe yaramazlar); kayıt varsa kart arayüzde ("Sürdür" yarım parçayı baştan indirir). */
export function bekleyenDenetle(): void {
  const b = ayarlar().yerel.bekleyenKurulum;
  if (!b) { yarimlariTemizle(); return; }
  if (yerelKuruluMu(b.model)) bekleyenTamamla(b.model);
}

/** Yerel beyni siler (indirilen her şey). Ayar dosyası kalır; istenmiş kurulumun kaydı (Görev 15) EN BAŞTA silinir — durdurulan
 *  indirme o arada bitse de yerel beyni açmaz. Görev 20b: süren indirme önce durdurulur ve İŞİ BİTENE dek beklenir (yarım dosyanın
 *  yazıcısı kapanır), `surecleriKapat` sunucu ve ses süreçlerinin çıkışını bekler, sonra klasör yeniden denemeli silinir
 *  (yerel/kaldirma.ts) — eskiden durdur + hemen rmSync Windows'ta EBUSY verebiliyordu. Kaldırma sürerken yeni kurulum ve sunucu
 *  açılışı reddedilir; aynı anda ikinci "Kaldır" ilkini bekler. */
let kaldirma: Promise<void> | null = null;
export function yerelKaldir(surecleriKapat: () => Promise<void>): Promise<void> {
  kaldirma ??= (async () => {
    const s = suren;
    kaldiriliyor = true;
    bekleyenSil();
    bildir();
    try {
      await siraylaKaldir({ suren: s ? { durdur: () => s.durdur.abort(), is: s.is } : null, surecleriKapat, sil: () => klasoruSil(yerelKok()) });
    } finally {
      kaldiriliyor = false;
      indirme = undefined;
      bildir();
    }
  })().finally(() => { kaldirma = null; });
  return kaldirma;
}
/** Kaldırma sürüyor mu? (Ayarlar "Kaldırılıyor…" der.) */
export const yerelKaldiriliyorMu = () => kaldiriliyor;

/** 0.14.1: bulutsuz kipte (Gizli / "Yalnız bu bilgisayar") yerel beyin kuruluyken eksik ses parçalarını (yazıya çevirme: Whisper; ses: Piper)
 *  arka planda tamamlar — 0.14.0'dan kalan kurulum ve yarıda kalmış ses indirmesi için (karar: shared/yerel-ses.ts). main.ts açılışta ve
 *  bulutsuz kipe GEÇİŞTE çağırır (her ayar değişiminde değil: düşen indirme döngüye girmesin). Ne başladıysa döner. */
export function yerelSesiTamamla(): { whisper: boolean; piper: boolean } {
  const a = ayarlar().yerel;
  const w = whisperDurumuOku();
  const p = yedekIndirmeDurumu();
  const e = yerelSesEksikleri({
    bulutsuz: a.gizliMod === true || a.yalnizYerel === true, yerelHazir: a.etkin === true && yerelKuruluMu(), yerelMesgul: Boolean(suren) || kaldiriliyor,
    whisperKurulu: whisperHazirMi(), whisperIniyor: Boolean(w.indirme && !w.indirme.hata && w.indirme.yuzde < 100),
    piperKurulu: piperHazirMi(), piperIniyor: Boolean(p && !p.hata && p.yuzde < 100),
  });
  if (e.whisper) void whisperKur({ baslat: false });
  if (e.piper) void yedekSesKur().catch(() => undefined);
  return e;
}
