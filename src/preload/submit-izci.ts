// ── Fuber Tarayıcı submit izcisi (0.14 T15; düzeltme turu 4: K3) ────────────────────────────────────────────────────────────────────────
// Fuber Tarayıcı oturumuna önyükleme olarak kaydedilir (src/main/tarayici.ts: registerPreloadScript, type 'frame'): bütün çerçevelerde (başka kökenli
// iframe dahil), sayfa kodundan YALITILMIŞ dünyada çalışır (sayfa bu betiği ve `ipcRenderer`'ı göremez; hiçbir şey sayfaya açılmaz). DOM `submit` olayını
// `window` üzerinde yakalama aşamasında (sayfanın kendi dinleyicilerinden ÖNCE) dinler ve ana sürece EŞZAMANLI bildirir: ağ kalkanı, ajanın eyleminden sonra
// gerçek bir form gönderimi başladığını bilir ve o sırada sayfanın yollayacağı fetch/XHR isteklerini bekletir. Bildirim form İÇERİĞİ taşımaz; yalnız formun
// arama olup olmadığını söyler (açıkça `method=get` — düğmenin `formmethod`'u ezer —, `role=search`, içinde `type=search` alan): aramanın submit'i
// kalkanı kurmaz (src/shared/submit-bilgisi.ts). Ana süreç bildirimi yalnız ajanın dokunduğu sekmenin çerçevelerinden kabul eder.
// Bilinen boşluk (kabul edildi, deftere yazıldı): `submit` olayı `composed` değildir; GÖLGE DOM içindeki bir formun submit'i `window`'a ulaşmaz ve sayılmaz.
// Gezinim yapan gönderim (form.submit(), requestSubmit, text/plain) yine gezinim kalkanında durur.
import { ipcRenderer } from 'electron';
import { submitBilgisi, type SubmitBilgisi } from '../shared/submit-bilgisi.js';

// Sayfa forma "getAttribute", "method" ya da "elements" adlı bir alan koyarak (DOM clobbering: HTMLFormElement adlandırılmış alanları özelliklerin önüne
// koyar) okumayı şaşırtamasın: yöntemler yalıtılmış dünyanın kendi prototiplerinden alınır (sayfa bunları değiştiremez). Okunamazsa güvenli taraf: sayılır.
const nitelik = Element.prototype.getAttribute;
const elemanlar = Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'elements')?.get;
const oku = (e: Element, ad: string): string | null => nitelik.call(e, ad);

window.addEventListener('submit', (olay) => {
  let bilgi: SubmitBilgisi = { get: false, aramaRolu: false, aramaAlani: false };
  try {
    const form = olay.target;
    if (form instanceof HTMLFormElement) {
      const gonderen = (olay as SubmitEvent).submitter;
      const alanlar = elemanlar ? Array.from(elemanlar.call(form) as HTMLFormControlsCollection) : [];
      bilgi = submitBilgisi({
        formYontemi: oku(form, 'method'),
        gonderenYontemi: gonderen ? oku(gonderen, 'formmethod') : null,
        rol: oku(form, 'role'),
        alanTurleri: alanlar.filter((a) => a instanceof HTMLInputElement).map((a) => oku(a, 'type')),
      });
    }
  } catch { /* okunamadı: arama sayılmaz (submit sayılır) */ }
  try { ipcRenderer.sendSync('tarayici:submit-goruldu', bilgi); } catch { /* ana süreç yoksa bildirim yok */ }
}, true);
