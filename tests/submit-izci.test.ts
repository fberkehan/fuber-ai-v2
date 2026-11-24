// Fuber Tarayıcı submit izcisi (0.14 T15; düzeltme turu 4, K3): ajan sekmelerinde BÜTÜN çerçevelerde DOM `submit` olayı `window` üzerinde yakalama
// aşamasında dinlenir ve formun arama mı olduğu (açık GET, role=search, type=search alanı) ile birlikte ana sürece bildirilir (src/preload/submit-izci.ts;
// oturum önyüklemesi). Ağ kalkanı içerik türüne değil bu olaya bakar. Formun okunuşu saf (src/shared/submit-bilgisi.ts) ve burada birim testli.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { submitBilgisi, aramaFormuMu, submitBilgisiAyikla } from '../src/shared/submit-bilgisi.ts';

const kok = path.resolve(import.meta.dirname, '..');

test('submit izcisi: window üzerinde yakalama aşamasında submit dinler, form bilgisini ana sürece eşzamanlı bildirir; sayfaya hiçbir şey açmaz', () => {
  const k = fs.readFileSync(path.join(kok, 'src', 'preload', 'submit-izci.ts'), 'utf8');
  assert.match(k, /window\.addEventListener\('submit'/);
  assert.match(k, /\}, true\);/); // yakalama aşaması: sayfa kendi dinleyicisiyle fetch yollamadan ÖNCE bildirim gider
  assert.match(k, /ipcRenderer\.sendSync\('tarayici:submit-goruldu', bilgi\)/); // eşzamanlı: sıralama garantisi
  assert.match(k, /submitBilgisi\(/);
  // Sayfa forma "getAttribute", "method" ya da "elements" adlı alan koyarak (DOM clobbering) okumayı şaşırtamaz: yöntemler yalıtılmış dünyanın prototiplerinden.
  assert.match(k, /Element\.prototype\.getAttribute/);
  assert.match(k, /HTMLFormElement\.prototype, 'elements'/);
  assert.match(k, /gölge DOM/i); // kabul edilen boşluk yorumda yazılı
  assert.doesNotMatch(k, /contextBridge|exposeInMainWorld/);
});

test('form okunuşu: açık GET (düğmenin formmethod\'u formunkini ezer), role=search ve type=search alanı; büyük/küçük harf ve boşluk önemsiz', () => {
  const b = (o: Partial<Parameters<typeof submitBilgisi>[0]>) => submitBilgisi({ formYontemi: null, gonderenYontemi: null, rol: null, alanTurleri: [], ...o });
  assert.deepEqual(b({}), { get: false, aramaRolu: false, aramaAlani: false });
  assert.equal(b({ formYontemi: 'get' }).get, true);
  assert.equal(b({ formYontemi: '  GeT ' }).get, true);
  assert.equal(b({ formYontemi: 'post' }).get, false);
  assert.equal(b({ formYontemi: 'gett' }).get, false, 'yalnız açıkça "get"');
  assert.equal(b({ formYontemi: 'post', gonderenYontemi: 'get' }).get, true);
  assert.equal(b({ formYontemi: 'get', gonderenYontemi: 'post' }).get, false);
  assert.equal(b({ formYontemi: 'get', gonderenYontemi: '' }).get, false, 'düğmede boş formmethod: açık GET değil');
  assert.equal(b({ rol: 'search' }).aramaRolu, true);
  assert.equal(b({ rol: ' SEARCH ' }).aramaRolu, true);
  assert.equal(b({ rol: 'searchbox' }).aramaRolu, false);
  assert.equal(b({ alanTurleri: ['text', null, ' Search'] }).aramaAlani, true);
  assert.equal(b({ alanTurleri: ['text', 'email'] }).aramaAlani, false);
  assert.equal(aramaFormuMu(b({ formYontemi: 'get' })), true);
  assert.equal(aramaFormuMu(b({ alanTurleri: ['search'] })), true);
  assert.equal(aramaFormuMu(b({ formYontemi: 'post' })), false);
  // Ana süreçte bildirim güvenilmez girdi: yalnız tam `true` doğrudur.
  assert.deepEqual(submitBilgisiAyikla(null), { get: false, aramaRolu: false, aramaAlani: false });
  assert.deepEqual(submitBilgisiAyikla({ get: true, aramaRolu: 'true' }), { get: true, aramaRolu: false, aramaAlani: false });
});

test('çerçeveler: önyükleme alt çerçevelerde de yüklenir (nodeIntegrationInSubFrames) ama sayfa görünümü sandbox\'lı, yalıtımlı ve nodeIntegration kapalı kalır', () => {
  const t = fs.readFileSync(path.join(kok, 'src', 'main', 'tarayici.ts'), 'utf8');
  const satir = t.split(/\r?\n/).find((s) => s.includes('new WebContentsView({ webPreferences:')) ?? '';
  assert.match(satir, /sandbox: true/);
  assert.match(satir, /contextIsolation: true/);
  assert.match(satir, /nodeIntegration: false/);
  assert.match(satir, /nodeIntegrationInSubFrames: true/); // yalnız önyüklemenin alt çerçevelere (iframe) yüklenmesi için; sandbox Node'u yine kapatır
  assert.doesNotMatch(satir, /preload:/); // sayfa görünümünün kendi önyüklemesi yok (window.fuber köprüsü sayfaya açılmaz)
  // K3: açılır pencere, ebeveyn güvenli değerde olmasa da alt çerçeve önyüklemesini açamaz (Electron çocuk pencerede zorlamayı ebeveyne bağlar).
  const acilir = t.split(/\r?\n/).find((s) => s.includes('const ACILIR_TERCIH')) ?? '';
  assert.match(acilir, /nodeIntegrationInSubFrames: false/);
  assert.match(acilir, /sandbox: true/);
});

test('derleme: submit izcisi ayrı bir ön yükleme olarak derlenir; yol yollar.ts\'te', () => {
  const b = fs.readFileSync(path.join(kok, 'scripts', 'build-main.mjs'), 'utf8');
  assert.match(b, /submit-izci/);
  const y = fs.readFileSync(path.join(kok, 'src', 'main', 'yollar.ts'), 'utf8');
  assert.match(y, /submitIzci/);
});
