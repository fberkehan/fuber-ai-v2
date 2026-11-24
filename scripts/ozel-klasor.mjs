// Özel klasörler (açık kaynak hazırlığı): OZEL_YOLLAR'daki klasörler (ör. `yonetim/`, `sunucu/`) bu açık kaynak depoda yoktur. Onlara bağlı testler ve betikler TEK işaretle sessizce atlanır:
//   · Test dosyası tamamen özelse ilk satırlarında `// @ozel-bagimlilik: yonetim` (ya da `yonetim, sunucu`) taşır; scripts/testleri-kos.mjs
//     klasör yoksa dosyayı hiç çalıştırmaz ve "atlandı" diye yazar.
//   · Dosyanın yalnız bir kısmı özelse o testler tests/yardimci/ozel.ts `ozelGerekli('yonetim')` ile işaretlenir (node:test skip).
//   · Betikler `ozelYoksaCik('yonetim', 'Fuber Yönetim paketlemesi')` ile başlar: klasör yoksa açıklamayla 0 koduyla çıkar.
import fs from 'node:fs';
import path from 'node:path';

export const KOK = path.resolve(import.meta.dirname, '..');
/** İşaret adı → klasör (depo köküne göre). Hiçbiri bu depoda yoktur: `acik-kaynak` (dışa aktarma betiği), landing (tanıtım sitesi), mobil (telefon
 *  uygulaması), e2e (uçtan uca betikler) ve whatsapp (isteğe bağlı WhatsApp bağlantı modülü, ozel/whatsapp/). */
export const OZEL_YOLLAR = Object.freeze({ yonetim: 'yonetim', sunucu: 'sunucu', 'acik-kaynak': 'scripts/acik-kaynak', landing: 'landing', mobil: 'mobil', e2e: 'scripts/e2e', whatsapp: 'ozel/whatsapp' });
/** @type {readonly string[]} */
export const OZEL_KLASORLER = Object.freeze(Object.keys(OZEL_YOLLAR));
export const ISARET = '@ozel-bagimlilik:';

/** Klasör bu çalışma ağacında var mı (genel depoda yok). */
export function ozelVarMi(ad, kok = KOK) {
  if (!OZEL_KLASORLER.includes(ad)) throw new Error(`bilinmeyen özel klasör: ${ad}`);
  try { return fs.statSync(path.join(kok, OZEL_YOLLAR[ad])).isDirectory(); } catch { return false; }
}

/** Dosya metnindeki işaretin klasörleri (ilk 40 satırda; yoksa boş). Bilinmeyen ad hata verir (yazım yanlışı sessizce testi açık bırakmasın). */
export function dosyaninOzelBagimliliklari(metin) {
  const satirlar = metin.split(/\r?\n/).slice(0, 40);
  const bulunan = [];
  for (const s of satirlar) {
    const i = s.indexOf(ISARET);
    if (i < 0 || !/^\s*\/\//.test(s)) continue;
    // İşaretten sonra virgülle ayrılmış adlar; ardından gelen açıklama (parantez vb.) okunmaz.
    const liste = /^\s*([a-z][a-z-]*(?:\s*,\s*[a-z][a-z-]*)*)/.exec(s.slice(i + ISARET.length))?.[1] ?? '';
    if (!liste) throw new Error(`${ISARET} işaretinden sonra klasör adı yok`);
    for (const ad of liste.split(',').map((x) => x.trim()).filter(Boolean)) {
      if (!OZEL_KLASORLER.includes(ad)) throw new Error(`${ISARET} bilinmeyen klasör "${ad}" (geçerli: ${OZEL_KLASORLER.join(', ')})`);
      if (!bulunan.includes(ad)) bulunan.push(ad);
    }
  }
  return bulunan;
}

/** Eksik özel klasörler (dosyanın işaretine göre). */
export function eksikOzelKlasorler(metin, kok = KOK) {
  return dosyaninOzelBagimliliklari(metin).filter((ad) => !ozelVarMi(ad, kok));
}

/**
 * İsteğe bağlı modüllerin giriş dosyaları: `ozel/<modül>/kayit.ts` (depo köküne göre, sıralı). scripts/build-main.mjs bunları ana paketin girişine
 * main.ts'ten SONRA ekler: modül yüklenince kendini genel kodun kapısına kaydeder; genel kod `ozel/`i hiç içe aktarmaz. Bu depoda `ozel/` yoktur →
 * boş liste → modülsüz derleme.
 */
export function ozelModulGirisleri(kok = KOK) {
  const ozel = path.join(kok, 'ozel');
  let adlar;
  try { adlar = fs.readdirSync(ozel, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort(); } catch { return []; }
  return adlar.filter((ad) => fs.existsSync(path.join(ozel, ad, 'kayit.ts'))).map((ad) => `ozel/${ad}/kayit.ts`);
}

/** Betik başı: klasör yoksa açıklayıp 0 koduyla çıkar (genel depoda `npm run …` hata vermez, ne olmadığını söyler). */
export function ozelYoksaCik(ad, is, kok = KOK) {
  if (ozelVarMi(ad, kok)) return;
  console.log(`${is} atlandı: ${OZEL_YOLLAR[ad]}/ bu depoda yok.`);
  process.exit(0);
}
