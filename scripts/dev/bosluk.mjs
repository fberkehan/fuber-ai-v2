// Boşluk kuralı — önizleme betiklerinin ortak ölçüsü (0.12 spec "Tasarım dili": en büyük boş yatay bant pencere yüksekliğinin %18'ini geçmez).
// Ölçü scripts/dev/kurulum2-onizle.mjs'teki BOSLUK_OLC ile AYNI kurala göre (H3a): görünür içerik = yazı satırları, simge/görsel/denetimler
// ve pencerenin %45'inden küçük dolgulu/çizgili kutular; pencere düğmeleri, çıkan geçiş katmanı ve inert öğeler sayılmaz. Bant pencerenin
// tamamı (innerHeight) üzerinden ölçülür; kök yalnız sayılan öğeleri seçer (ör. Fuber Yönetim'de kenar çubuğu DEĞİL, yalnız ekran alanı —
// kenar çubuğunun kendi zemini her satırı "dolu" saydırırdı).
export const BOSLUK_SINIRI = 0.18;

/** Sayfada çalışır (page.evaluate(BOSLUK_OLC, kökSeçici)) → { bant, oran, bas, H } ya da { yok: true }. */
export const BOSLUK_OLC = (kokSec) => {
  const H = innerHeight, W = innerWidth;
  const satir = new Uint8Array(H);
  const isle = (r) => { const a = Math.max(0, Math.floor(r.top)), b = Math.min(H, Math.ceil(r.bottom)); for (let y = a; y < b; y++) satir[y] = 1; };
  const kokEl = document.querySelector(kokSec);
  if (!kokEl) return { yok: true };
  const sahne = getComputedStyle(document.body).backgroundColor;
  const dislanan = (el) => Boolean(el.closest('.pd, .pd-centik, .pd-surukle, .acilis, [data-gecis="cik"], [inert]'));
  const gorunur = (el) => { for (let e = el; e && e !== document.documentElement; e = e.parentElement) { const c = getComputedStyle(e); if (c.display === 'none' || c.visibility === 'hidden' || Number(c.opacity) < 0.05) return false; } return true; };
  const tw = document.createTreeWalker(kokEl, NodeFilter.SHOW_TEXT);
  for (let n = tw.nextNode(); n; n = tw.nextNode()) {
    if (!n.textContent.trim() || !n.parentElement || dislanan(n.parentElement) || !gorunur(n.parentElement)) continue;
    const rg = document.createRange(); rg.selectNodeContents(n);
    for (const r of rg.getClientRects()) if (r.width > 0.5 && r.height > 0.5) isle(r);
  }
  for (const el of kokEl.querySelectorAll('*')) {
    if (dislanan(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2 || r.bottom <= 0 || r.top >= H) continue;
    const t = el.tagName.toLowerCase();
    const c = getComputedStyle(el);
    const yerine = ['svg', 'img', 'canvas', 'video', 'input', 'textarea', 'button'].includes(t);
    const dolgu = (c.backgroundColor !== 'rgba(0, 0, 0, 0)' && c.backgroundColor !== sahne) || c.backgroundImage !== 'none' || (c.boxShadow !== 'none' && c.boxShadow !== '') || parseFloat(c.borderTopWidth) > 0;
    const kucuk = (r.width * r.height) / (W * H) < 0.45;
    if ((yerine || (dolgu && kucuk)) && gorunur(el)) isle(r);
  }
  let enUzun = 0, bas = 0, simdi = 0, enBas = 0;
  for (let y = 0; y < H; y++) {
    if (satir[y]) { simdi = 0; continue; }
    if (!simdi) bas = y;
    simdi++;
    if (simdi > enUzun) { enUzun = simdi; enBas = bas; }
  }
  return { bant: enUzun, oran: enUzun / H, bas: enBas, H };
};
