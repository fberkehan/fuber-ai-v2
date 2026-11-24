// Okunurluk ölçümü — önizleme betiklerinin ortak yardımcısı (kurulum-onizle.mjs'teki ölçümün aynısı; ayarlar-onizle.mjs kullanır).
// `OLC` sayfada çalışır (page.evaluate(OLC, kökSeçici)): görünür öğeleri ölçer; `denetle` ölçümü denetimlere çevirir:
//   yazı ≥ 12 px; düğme ≥ 32 px (anahtarlar: görünen 22 px, tıklama alanı 32 px — ayrı sayılır); yatay taşma yok; metin kesilmiyor;
//   pencere düğmelerinin (kendi düğmelerimiz + köşe çentiği; Görev 22) altında yazı/düğme yok; yazı ≥ 4.5:1, simge ≥ 3:1 (camda
//   pencerenin altı saf BEYAZ sayılır).
// Saydamlaşan (opaklık < 0.98) ve görünmeyen (visibility: hidden — kapalı akordeon gövdesi) öğeler sayılmaz.
// 0.14 T35 (T29 M2, T33): atalarının overflow: hidden/clip kırpmasıyla TAMAMEN kesilen öğe görünmez sayılır; yatay taşma öğenin GÖRÜNEN kutusuyla
// ölçülür (kökün İÇİNDEKİ, overflow'u visible olmayan her kabın iç kutusuyla kesilmiş: kirpikKutu; kökün kendi kırpması sayılmaz — kökten taşan
// öğe eskisi gibi yakalanır). Kaydırılan kapta (auto/scroll) aşağıda kalan içerik yine ölçülür (kaydırınca görünür; yazı boyu ve kontrastı sayılır).
import { renkOku, kontrastOrani, ustune, BEYAZ } from './kontrast.mjs';

/** Sayfa içi ölçüm: `kokSec` altındaki görünür öğeler. */
export const OLC = (kokSec) => {
  const koklar = [...document.querySelectorAll(kokSec)];
  // Yalnız ekran okuyucuya yazılan (görsel olarak gizli: 1×1 px, clip-path inset(50%)) öğe görünür metin değildir (B6 canlı duyuru).
  /** Görünen kutu: overflow'u visible olmayan atalarının iç kutusuyla kesilir (`yalnizGizli`: yalnız hidden/clip — kaydırılan kap kesmez). Konumlu
   *  (absolute) öğeyi yalnız kapsayan bloğu ve ataları kırpar; position: fixed zincirden kaçar (tasma.mjs kirpikKutu ile aynı kural). */
  const kirpikKutu = (el, dur, yalnizGizli = false) => {
    const r = el.getBoundingClientRect();
    let sol = r.left, ust = r.top, sag = r.right, alt = r.bottom;
    let konum = getComputedStyle(el).position;
    const kirpar = (v) => (yalnizGizli ? v === 'hidden' || v === 'clip' : v !== 'visible');
    for (let a = el.parentElement; a && a !== dur && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (konum === 'fixed') break;
      const c = getComputedStyle(a);
      if (konum === 'absolute' && c.position === 'static' && c.transform === 'none') continue;
      konum = c.position;
      const kx = kirpar(c.overflowX), ky = kirpar(c.overflowY);
      if (!kx && !ky) continue;
      const ar = a.getBoundingClientRect();
      const x0 = ar.left + a.clientLeft, y0 = ar.top + a.clientTop;
      if (kx) { sol = Math.max(sol, x0); sag = Math.min(sag, x0 + a.clientWidth); }
      if (ky) { ust = Math.max(ust, y0); alt = Math.min(alt, y0 + a.clientHeight); }
    }
    return { left: sol, top: ust, right: sag, bottom: alt, width: Math.max(0, sag - sol), height: Math.max(0, alt - ust) };
  };
  const gorunur = (el, kok) => {
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1 || (r.width <= 1 && r.height <= 1)) return false;
    const c = getComputedStyle(el); if (c.visibility === 'hidden' || c.display === 'none' || c.clipPath === 'inset(50%)') return false;
    const k = kirpikKutu(el, kok, true); return k.width >= 1 && k.height >= 1;
  };
  const opaklik = (el) => { let o = 1; for (let e = el; e; e = e.parentElement) o *= Number(getComputedStyle(e).opacity); return o; };
  const metinli = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const ad = (el) => `${el.tagName.toLowerCase()}.${String(el.className?.baseVal ?? el.className ?? '').split(' ')[0]}`;
  // 0.14 T29: göreli oklch vurgusu hesaplanınca oklch(…) / oklab(…) olarak gelir (kontrast.mjs okur; tanımadığını hata sayar).
  const renkler = (t) => String(t).match(/(rgba?|color|oklch|oklab|lab|lch)\([^)]*\)/g) ?? [];
  // Zemin katmanları (dıştan içe): her atanın zemin rengi; gradyanın ilk rengi en kötü durum diye üstüne eklenir. html/body dışarıda.
  const katmanlar = (el) => {
    const zincir = [];
    for (let e = el; e && e !== document.body && e !== document.documentElement; e = e.parentElement) zincir.unshift(e);
    const l = [];
    for (const e of zincir) {
      const c = getComputedStyle(e);
      if (e === el && /text/.test(c.webkitBackgroundClip || c.backgroundClip || '')) continue;
      l.push(c.backgroundColor);
      const g = renkler(c.backgroundImage);
      if (g.length) l.push(g[0]);
    }
    // Segment denetiminin seçili düğmesi: dolgu kardeş kaydıraktadır (altta durur, atası değil) — yazının asıl zemini o (0.13.1: koyuda beyaz dolgu).
    const dgm = el.closest?.('.ft-segment__dgm[aria-checked="true"]');
    const kay = dgm?.parentElement?.querySelector(':scope > .ft-segment__kaydirak');
    if (kay) l.push(getComputedStyle(kay).backgroundColor);
    return l;
  };
  // Pencere düğmeleri (Görev 22: kendi düğmelerimiz; Windows kaplaması yok): düğmelerin alanı + köşenin sürükleme dikdörtgeni
  // (.pd-surukle: çentik gövdesi + omzu + üstteki çerçeve; orada tıklama sayfaya gitmez, pencereyi sürükler). Fuber Tarayıcı'da
  // yalnız düğmeler. Düğmelerin kendisi (.pd) sayılmaz.
  const pdD = document.querySelector('.pd-dugmeler')?.getBoundingClientRect();
  const pdS = document.querySelector('.pd-surukle')?.getBoundingClientRect();
  const baslik = pdD ? { x: pdS ? Math.min(pdD.left, pdS.left) : pdD.left, y: 0, sag: innerWidth, alt: pdS ? Math.max(pdD.bottom, pdS.bottom) : pdD.bottom } : null;
  /** Öğenin görünen üst kenarı: overflow'u görünür olmayan atalarının üst kenarıyla kırpılmış (tamamen dışarıdaysa Infinity). */
  const kirpikUst = (el, r) => {
    let ust = r.top;
    // M1: sabit konumlu öğe (ipucu, levha, örtü) atalarının taşma kırpmasından kaçar: zincirde position: fixed varsa kırpılmaz sayılmaz.
    for (let a = el; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') return r.top;
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const oy = getComputedStyle(a).overflowY;
      if (oy === 'visible') continue;
      const ar = a.getBoundingClientRect();
      if (r.bottom <= ar.top + 1) return Infinity;
      ust = Math.max(ust, ar.top);
    }
    return ust;
  };
  const o = { kucuk: [], kesik: [], kisa: [], anahtar: [], tasan: [], baslikAltinda: [], yazilar: [], simgeler: [], metin: '' };
  for (const kokEl of koklar) {
    const kr = kokEl.getBoundingClientRect();
    o.metin += ` ${kokEl.innerText.replace(/\s+/g, ' ').trim()}`;
    for (const el of kokEl.querySelectorAll('*')) {
      if (!gorunur(el, kokEl) || opaklik(el) < 0.98) continue;
      const r = el.getBoundingClientRect();
      const c = getComputedStyle(el);
      if (metinli(el)) {
        const fs = parseFloat(c.fontSize);
        if (fs < 12) o.kucuk.push(`${ad(el)} ${fs}px «${el.textContent.trim().slice(0, 28)}»`);
        const kirpar = /hidden|clip/.test(c.overflowX) || c.textOverflow === 'ellipsis';
        if (kirpar && el.scrollWidth > el.clientWidth + 1) o.kesik.push(`${ad(el)} «${el.textContent.trim().slice(0, 30)}» ${el.scrollWidth}/${el.clientWidth}`);
        o.yazilar.push({ ad: ad(el), metin: el.textContent.trim().slice(0, 30), renk: c.color, katmanlar: katmanlar(el), boy: fs });
      }
      if (el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') {
        const h = Math.round(r.height * 10) / 10;
        const isim = el.textContent.trim() || el.title || el.getAttribute('aria-label') || '?';
        if (el.getAttribute('role') === 'switch') { const a = getComputedStyle(el, '::before'); o.anahtar.push({ isim, h, alan: h + Math.max(0, -parseFloat(a.top) || 0) + Math.max(0, -parseFloat(a.bottom) || 0) }); }
        else if (h < 31.5) o.kisa.push(`${isim.slice(0, 30)} ${h}px`);
      }
      if (el.tagName.toLowerCase() === 'svg' && !el.closest('[data-tema-kutu]')) o.simgeler.push({ ad: `${ad(el.parentElement)} svg`, renk: c.color, katmanlar: katmanlar(el) });
      // Yatay taşma: kökün dışına çıkan öğe. Kendi içinde kayan kutu, önizlemenin içi ve tostun bilerek "…" ile kırpılan tek satırı
      // (.tost__icerik overflow: hidden; Görev 20b düzeltme turu 2) sayılmaz.
      const g = kirpikKutu(el, kokEl);
      if (g.width >= 1 && (g.right > kr.right + 1 || g.left < kr.left - 1) && !el.closest('[data-tema-kutu], .ada-sahne, .tost__icerik')) o.tasan.push(`${ad(el)} ${Math.round(g.left)}–${Math.round(g.right)} / ${Math.round(kr.left)}–${Math.round(kr.right)}`);
      // 0.14 T30: kaydırılan listenin (sohbet) üstünden çıkıp kabının kırpmasıyla GÖRÜNMEYEN kısım sayılmaz — kutu, kaydırma kaplarının kutusuyla kesilir.
      if (baslik && !el.closest('.pd') && (metinli(el) || el.tagName === 'BUTTON') && r.right > baslik.x + 1 && kirpikUst(el, r) < baslik.alt - 1 && r.bottom > 0) o.baslikAltinda.push(`${ad(el)} «${el.textContent.trim().slice(0, 20)}»`);
    }
    if (kokEl.scrollWidth > kokEl.clientWidth + 1) o.tasan.push(`${ad(kokEl)} kendi içinde yatay taşıyor ${kokEl.scrollWidth}/${kokEl.clientWidth}`);
  }
  o.sayfaTasiyor = document.documentElement.scrollWidth > innerWidth + 1;
  o.zemin = getComputedStyle(document.body).backgroundColor;
  o.kokSayisi = koklar.length;
  return o;
};

/** Ölçümü denetimlere çevirir (`kontrol(ad, tamam, ayrıntı)`). `tema` 'cam' ise pencerenin altı saf beyaz sayılır. */
export const denetle = (kontrol, etiket, tema, o) => {
  if (!o.kokSayisi) { kontrol(`${etiket}: ölçülecek öğe var`, false, 'kök bulunamadı'); return; }
  kontrol(`${etiket}: yazılar ≥ 12 px`, o.kucuk.length === 0, o.kucuk.join(' | '));
  kontrol(`${etiket}: düğmeler ≥ 32 px`, o.kisa.length === 0, o.kisa.join(' | '));
  const anahtarKisa = o.anahtar.filter((a) => a.alan < 31.5);
  if (o.anahtar.length) kontrol(`${etiket}: anahtarların tıklama alanı ≥ 32 px (${o.anahtar.length})`, anahtarKisa.length === 0, anahtarKisa.map((a) => `${a.isim} ${a.alan}`).join(' | '));
  kontrol(`${etiket}: taşma yok`, o.tasan.length === 0 && !o.sayfaTasiyor, [...o.tasan, o.sayfaTasiyor ? 'sayfa yatay kayıyor' : ''].filter(Boolean).join(' | '));
  kontrol(`${etiket}: metin kesilmiyor`, o.kesik.length === 0, o.kesik.join(' | '));
  kontrol(`${etiket}: başlık düğmelerinin altında yazı/düğme yok`, o.baslikAltinda.length === 0, o.baslikAltinda.join(' | '));
  const taban = tema === 'cam' ? BEYAZ : renkOku(o.zemin);
  const dusuk = [];
  let enKotuYazi = Infinity, enKotuSimge = Infinity;
  for (const y of o.yazilar) {
    const zemin = y.katmanlar.reduce((z, k) => ustune(renkOku(k), z), taban);
    const oran = kontrastOrani(ustune(renkOku(y.renk), zemin), zemin);
    enKotuYazi = Math.min(enKotuYazi, oran);
    if (oran < 4.5) dusuk.push(`${y.ad} «${y.metin}» ${oran.toFixed(2)}:1`);
  }
  for (const s of o.simgeler) {
    const zemin = s.katmanlar.reduce((z, k) => ustune(renkOku(k), z), taban);
    const oran = kontrastOrani(ustune(renkOku(s.renk), zemin), zemin);
    enKotuSimge = Math.min(enKotuSimge, oran);
    if (oran < 3) dusuk.push(`${s.ad} (simge) ${oran.toFixed(2)}:1`);
  }
  kontrol(`${etiket}: kontrast yazı ≥ 4.5, simge ≥ 3${tema === 'cam' ? ' (altı beyaz sayılır)' : ''}`, dusuk.length === 0,
    dusuk.length ? [...new Set(dusuk)].join(' | ') : `yazı en düşük ${enKotuYazi.toFixed(2)}:1 · simge en düşük ${enKotuSimge === Infinity ? '—' : `${enKotuSimge.toFixed(2)}:1`}`);
};
