// ── Motor seçici ─────────────────────────────────────────────────────────────────────────────────────────────
// İki rol: "ana" (sohbet, araç kullanan ajan; varsayılan Claude Opus 5.5) ve "yardimci" (arka plan: hafıza
// yazımı, kokpit planı, e-posta önem sınıflaması, başlık; varsayılan Claude Haiku 5.5 — ucuz ve hızlı).
// Seçilen motor hazır değilse hazır olan ilk motora (kendi varsayılan modeliyle) geçilir. Yeniden denenebilir
// hatalarda (hız sınırı, 5xx, bağlantı) artan beklemeyle 2 kez daha denenir. Her çağrı kullanım tablosuna yazılır.
// 0.13 T15 (Spec H): kullanıcı API anahtarı yok — kimse anahtar girmez; yapay zekâ Fuber hesabından ya da bu bilgisayardaki modelden gelir.
// Bu modül kayıtlı 'api:*' sırlarını doğrudan OKUMAZ (eski kayıtlar diskte kalır, kullanılmaz); OpenAI/OpenRouter sağlayıcı kodları kalır ama
// anahtarsız (hazirMi hep false); testlerin sahte ağ geçidi motorTestAnahtari ile (ortam değişkeni) beslenir.
// 0.14 (ürün kararı): (5 Kas: Business ve Developer'da) kullanıcı kendi Anthropic anahtarını kaydedip "Claude (Anthropic)"yu seçebilir —
// o zaman iki rol (ana, yardimci) Anthropic'e, kullanıcının seçtiği model/eforla gider (shared/motor-secimi.ts claudeSecili). Anahtar
// ayarlar.ts kullaniciMotorAnahtari'ndan gelir (5 Kas: iki modda da). Gizli / "Yalnız bu bilgisayar" yol denetimi (tekMotorYolu) önce gelir.
import { motorCagrisi } from '../beyin.js';
import { ayarlar, ayarlariKaydet, motorTestAnahtari, kullaniciMotorAnahtari } from '../ayarlar.js';
import { claudeSecili, claudeRolSecimi, openaiUyumluSecili, openaiRolModeli, yerelTabanMi } from '../../shared/motor-secimi.js';
import { veritabani, simdi } from '../vt.js';
import { anthropicSaglayici } from './anthropic.js';
import { openaiSaglayici } from './openai.js';
import { tekMotorYolu, yerelSohbet, yerelModelEtiketi, yerelSicakMi, yalnizYerelSeciliMi } from './yerel.js';
import type { Saglayici, Istek, Yanit } from './tipler.js';
import { MotorHatasi } from './tipler.js';
import type { ModelRolu, SaglayiciAdi, ModelSecimi } from '../../shared/tipler.js';
import { VARSAYILAN_MODEL } from '../../shared/modeller.js';
import { motorHataMetni, YALNIZ_YEREL_SECILDI_DURDU } from '../../shared/abonelik.js';
import { cagriMaliyeti, modelFiyati } from '../../shared/model-bilgisi.js';
import { canliFiyat } from './fiyat-onbellegi.js';
import { sabitYol, yerelIsAtlanir, type SabitYol } from '../../shared/tek-motor.js';

/** Bağlı değil iletileri moda göre (İş: anahtar dili yok). */
const mod = () => ayarlar().mod;
const saglayicilar: Record<SaglayiciAdi, Saglayici> = {
  anthropic: anthropicSaglayici(() => kullaniciMotorAnahtari('anthropic') ?? motorTestAnahtari('anthropic'), mod),
  // Açık kaynak hazırlığı (11 Kas): kendi OpenAI uyumlu sağlayıcın — anahtar 'api:openai' sırrından, taban adresi openaiUyumlu'dan. Bu bilgisayardaki
  // sunucu (Ollama, LM Studio) anahtarsız çalışır: SDK boş anahtar kabul etmediği için yer tutucu gider (sunucu yok sayar).
  openai: openaiSaglayici('openai', () => kullaniciMotorAnahtari('openai') ?? motorTestAnahtari('openai') ?? (yerelTabanMi(openaiTabani()) ? 'yerel' : undefined), openaiTabani, mod),
  openrouter: openaiSaglayici('openrouter', () => motorTestAnahtari('openrouter'), () => ayarlar().saglayicilar.openrouter.tabanUrl, mod),
};

/** OpenAI sağlayıcısının taban adresi: kendi sağlayıcın seçiliyse onun adresi, değilse (test ağ geçidi) saglayicilar.openai.tabanUrl. */
function openaiTabani(): string {
  const a = ayarlar();
  return a.motorSecimi === 'openai' && a.openaiUyumlu?.tabanUrl ? a.openaiUyumlu.tabanUrl : a.saglayicilar.openai.tabanUrl;
}

export { VARSAYILAN_MODEL };

export function saglayici(ad: SaglayiciAdi): Saglayici { return saglayicilar[ad]; }

export function hazirMi(ad: SaglayiciAdi): boolean {
  // 0.14: Anthropic YALNIZ "Claude (Anthropic)" seçili + anahtar kayıtlıyken hazır (5 Kas: Business'ta da).
  if (ad === 'anthropic') return claudeSecili(ayarlar());
  // Açık kaynak hazırlığı: kendi OpenAI uyumlu sağlayıcın yalnız seçili + hazırken (Fuber hesabı gerekmez; abonelik kapısı istemcide yok).
  if (ad === 'openai') return openaiUyumluSecili(ayarlar());
  // OpenRouter is used through the OpenAI-compatible provider; there is no separate built-in provider.
  return false;
}

export function hazirMotorlar(): SaglayiciAdi[] {
  return (['anthropic', 'openai', 'openrouter'] as SaglayiciAdi[]).filter(hazirMi);
}

export function secim(rol: ModelRolu): ModelSecimi {
  const a = ayarlar();
  // 0.14: Claude seçili (+ anahtar; iki modda da): iki rol de Anthropic'e, kullanıcının rol başına modeli ve eforuyla.
  if (claudeSecili(a)) return { saglayici: 'anthropic', ...claudeRolSecimi(a, rol) };
  if (openaiUyumluSecili(a)) return { saglayici: 'openai', model: openaiRolModeli(a, rol)!, efor: rol === 'ana' ? 'medium' : 'low' };
  const s = a.modeller[rol];
  if (hazirMi(s.saglayici)) return s;
  const ilk = hazirMotorlar()[0];
  if (!ilk) throw new MotorHatasi(motorHataMetni('yok', ayarlar().mod, ayarlar().hesap?.durum), 'anahtar'); // moda göre metin (İş: anahtar dili yok)
  return { saglayici: ilk, model: VARSAYILAN_MODEL[ilk][rol], efor: rol === 'ana' ? 'medium' : 'low' };
}

const bekle = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Gizli mod açık ama yerel model hazır değil: buluta gidilmez (iki modda aynı sade metin; 0.10 Görev 3 sözlüğü: "bu bilgisayardaki
 *  yapay zekâ" — shared/terimler.ts; tests/terimler.test.ts metni birebir sınar). */
export const GIZLI_MOD_HAZIR_DEGIL = 'Gizli mod açık: Fuber yalnız bu bilgisayardaki yapay zekâyla çalışır, ama o şu an hazır değil. Ayarlar → Gizlilik.';
/** Bulutta başlayan tur sürerken Gizli mod açıldı: kalan adımlar buluta gönderilmez (tur yarıda başka beyne de geçmez). */
export const GIZLI_MOD_ACILDI_DURDU = 'Gizli mod açıldı: süren yanıt buluta gönderilmeden durduruldu.';

/** Motor yok (Gizli modda yerel beyin hazır değil ya da hiç motor yok): moda uygun asıl neden — "yeni not yok" diye yutulmasın. */
export const motorYokHatasi = (): MotorHatasi => yolHatasi('yok');

/** Yol yoksa (ya da sabit yol artık geçerli değilse) çağırana giden hata. */
function yolHatasi(yol: 'yok' | 'degisti'): MotorHatasi {
  const gizli = ayarlar().yerel.gizliMod === true;
  // H3c düzeltme turu 1 (P14 K1): "Yalnız bu bilgisayar" seçiliyken yol bulut değildir — metin onun cümlesi ("giriş yap" denmez).
  const yalniz = !gizli && yalnizYerelSeciliMi();
  if (yol === 'degisti') return new MotorHatasi(gizli ? GIZLI_MOD_ACILDI_DURDU : yalniz ? YALNIZ_YEREL_SECILDI_DURDU : motorHataMetni('yok', ayarlar().mod, ayarlar().hesap?.durum), 'anahtar');
  return new MotorHatasi(gizli ? GIZLI_MOD_HAZIR_DEGIL : motorHataMetni('yok', ayarlar().mod, ayarlar().hesap?.durum, false, yalniz), 'anahtar');
}

/**
 * Model çağrısı (Görev 21, K10): yol TEK kuraldan (motor/yerel.ts tekMotorYolu): Gizli modda (ya da hiç bulut yokken) her iş yerel
 * beyinde ve hata olursa buluta DÜŞÜLMEZ; aksi hâlde her iş bulutta (yerel ön eleme yok). Arka plan işleri yardımcı modelde.
 * `sabit` (düzeltme 1): tur başında seçilen yol — turun her adımı ve ertelenen işleri bununla çağırır; Gizli bölümün işi ('yerel')
 * Gizli mod kapansa da buluta gitmez, bulutta başlayan tur arada Gizli mod açılırsa sürmez (shared/tek-motor.ts sabitYol).
 */
export async function cagir(rol: ModelRolu, istek: Omit<Istek, 'model' | 'efor'> & { efor?: Istek['efor'] }, amac: string, sabit?: SabitYol): Promise<Yanit> {
  const yol = sabitYol(sabit, tekMotorYolu());
  if (yol === 'yerel') { soguguAtla(sabit); return yerelCagir(istek, amac); }
  if (yol === 'yok' || yol === 'degisti') throw yolHatasi(yol);
  return cagirSecimle(secim(rol), { ...istek, arkaPlan: istek.arkaPlan ?? rol === 'yardimci' }, amac, 'bulut');
}

/** Gizli bölümün bekleyen işi (ertelenen başlık, çıkıştaki iş) Gizli mod kapandıktan sonra çalışıyorsa yerel beyin SOĞUKTAN açılmaz
 *  (bulut yolunda sunucu kapalıdır; düzeltme turu 2): sunucu zaten açıksa yerelde yapılır, değilse iş atlanır (hata → çağıran yutar). */
function soguguAtla(sabit: SabitYol | undefined): void {
  if (yerelIsAtlanir(sabit, tekMotorYolu(), yerelSicakMi())) throw new MotorHatasi('Bu bilgisayardaki yapay zekâ kapalı; Gizli bölümün bekleyen işi atlandı.', 'baglanti');
}

/** Yerel tek motor: araçlar ve sunucu tarafı web araması bu kipte yok (yerel beyin araç çağırmaz); hata çağırana gider. */
async function yerelCagir(istek: Omit<Istek, 'model' | 'efor'>, amac: string): Promise<Yanit> {
  const bitir = motorCagrisi('yerel', yerelModelEtiketi(), amac);
  try {
    const y = await yerelSohbet({ ...istek, araclar: [], webArama: false, model: yerelModelEtiketi() });
    kullanimYaz('yerel', y.model, amac, y.kullanim);
    bitir();
    return y;
  } catch (e) {
    bitir(true);
    throw e;
  }
}

/**
 * Belirli bir sağlayıcı + modelle çağır (düşünme motoru ajanları kendi modelini seçebilir; ör. OpenRouter ":free").
 * Sağlayıcı hazır değilse yardımcı role düşer. Yerel tek motorken (Gizli mod) bu çağrı da yerelde kalır.
 * `secilen` işlev de olabilir: YALNIZ bulut yolunda çözülür (0.12 cila — gün kaydı ajanları `secim('yardimci')`yi argümanda
 * okuyordu; bulut motoru yokken o "motor yok" diye atıyor, yol yerel olsa da iş düşüyordu).
 */
export async function cagirSecimle(secilen: ModelSecimi | (() => ModelSecimi), istek: Omit<Istek, 'model' | 'efor'> & { efor?: Istek['efor'] }, amac: string, sabit?: SabitYol): Promise<Yanit> {
  const yol = sabitYol(sabit, tekMotorYolu());
  if (yol === 'yerel') { soguguAtla(sabit); return yerelCagir(istek, amac); }
  if (yol === 'yok' || yol === 'degisti') throw yolHatasi(yol);
  const istenen = typeof secilen === 'function' ? secilen() : secilen;
  const s = hazirMi(istenen.saglayici) ? istenen : secim('yardimci');
  const tam: Istek = { ...istek, model: s.model, efor: istek.efor ?? s.efor };
  const beyinBitir = motorCagrisi(s.saglayici, s.model, amac); // Beyin sayfası: bölge → motor → bölge
  let son: unknown;
  try {
    for (let deneme = 0; deneme < 3; deneme++) {
      try {
        const y = await saglayicilar[s.saglayici].sohbet(tam);
        kullanimYaz(s.saglayici, y.model, amac, y.kullanim);
        motorCalistiIsaretle();
        beyinBitir();
        return y;
      } catch (e) {
        son = e;
        if (e instanceof MotorHatasi && e.yenidenDenenebilir && !istek.sinyal?.aborted && !istek.tekDeneme) {
          await bekle(1500 * (deneme + 1) ** 2);
          // F1 (son inceleme K2): bekleme sırasında Gizli mod açıldıysa ya da bulut yolu gittiyse yeniden deneme buluta GİTMEZ — yol bu
          // çağrının bulutta başladığı yola göre yeniden hesaplanır (shared/tek-motor.ts sabitYol: 'bulut' değilse 'degisti').
          if (sabitYol(sabit ?? 'bulut', tekMotorYolu()) !== 'bulut') throw yolHatasi('degisti');
          continue;
        }
        throw e;
      }
    }
    throw son;
  } finally {
    beyinBitir(true); // başarıda zaten kapandı (ikinci çağrı yok sayılır)
  }
}

/**
 * 0.10 Görev 2 (P3): bir bulut motoru ilk kez başarıyla yanıt verdi (Fuber hesabıyla da; "Bağlantıyı dene" — ipc.ts motor:sina — de
 * çağırır): Ayarlar.motorCalisti BİR KEZ true yazılır. Motor yokken arayüz "bağlı değil" (nötr) ile "bağlantı koptu"yu (kırmızı) buradan
 * ayırır (shared/motor-durumu.ts motorGorunumu). Zaten true ise hiçbir şey yazılmaz.
 */
export function motorCalistiIsaretle(): void {
  if (ayarlar().motorCalisti) return;
  try { ayarlariKaydet((a) => { a.motorCalisti = true; }); } catch (e) { console.error('[motor] motorCalisti yazılamadı:', (e as Error).message); }
}

/** Kullanım kaydı. Maliyet o anki fiyat bilgisiyle (model bilgisi: yerleşik tablo + OpenRouter canlı listesi; yerel ve ":free" 0);
 *  fiyatı bilinmeyen çağrıya NULL yazılır (0 değil). Özet maliyeti okuma anında yeniden hesaplar (main/motor/kullanim.ts). */
function kullanimYaz(saglayici: string, model: string, amac: string, k: Yanit['kullanim']): void {
  const f = modelFiyati(saglayici, model, canliFiyat(saglayici, model));
  const maliyet = f ? cagriMaliyeti(saglayici, f, k) : null;
  try {
    veritabani()
      .prepare('INSERT INTO kullanim(saglayici, model, amac, giris, cikis, onbellek_okuma, onbellek_yazma, maliyet, zaman) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(saglayici, model, amac, k.giris, k.cikis, k.onbellekOkuma, k.onbellekYazma, maliyet, simdi());
  } catch { /* kullanım kaydı en iyi çaba */ }
}

/** Kısa, araçsız yardımcı çağrısı; düz metin döner. `sabit`: turun yolu (ertelenen tur işleri; bkz. cagir). */
export async function yardimciMetin(sistem: string, kullanici: string, amac: string, maxToken = 2000, jsonCikti = false, sabit?: SabitYol, secenek: { tekDeneme?: boolean } = {}): Promise<string> {
  const y = await cagir('yardimci', { sistemSabit: sistem, mesajlar: [{ rol: 'user', bloklar: [{ tur: 'metin', metin: kullanici }] }], araclar: [], maxToken, jsonCikti, ...(secenek.tekDeneme ? { tekDeneme: true } : {}) }, amac, sabit);
  return y.bloklar.filter((b) => b.tur === 'metin').map((b) => (b as { metin: string }).metin).join('').trim();
}

/** Yardımcı modelden JSON al; ```json çitlerini ve baştaki/sondaki metni tolere eder. */
export async function yardimciJson<T>(sistem: string, kullanici: string, amac: string, maxToken = 3000, sabit?: SabitYol): Promise<T | null> {
  const metin = await yardimciMetin(`${sistem}\n\nYanıtın YALNIZ geçerli JSON olsun; açıklama, kod çiti ya da başka metin ekleme.`, kullanici, amac, maxToken, true, sabit);
  return jsonAyikla<T>(metin);
}

export function jsonAyikla<T>(metin: string): T | null {
  const temiz = metin.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  for (const aday of [temiz, temiz.slice(temiz.search(/[[{]/))]) {
    try { return JSON.parse(aday) as T; } catch { /* sonrakini dene */ }
  }
  const m = temiz.match(/[[{][\s\S]*[\]}]/);
  if (m) { try { return JSON.parse(m[0]) as T; } catch { /* yok */ } }
  return null;
}
