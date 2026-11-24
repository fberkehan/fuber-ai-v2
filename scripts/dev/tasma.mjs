// Taşma denetimi — önizleme betiklerinin ortak yardımcısı (0.11 G3; ui-onizle.mjs, sonra kokpit/sohbet/görev önizlemeleri).
// Metinler bazen kutusundan taşabiliyordu. `tasmaDenetle(page, kokSecici)` kökün altındaki her GÖRÜNÜR öğeyi ölçer ve okunur hata
// iletileri döndürür ({ hata: string[], olculen: sayı }); boş `hata` = taşma yok. Kurallar:
//   1. Metin kutusuna sığmıyor: doğrudan yazı taşıyan öğenin kaydırma boyu kutusunu TASMA_PAYI'ndan (1 px) çok aşıyor — yatay (kesilen
//      tek satır, kutudan çıkan sözcük) ya da dikey (satır sınırına takılan metin). İstisna: [data-kirp] — kütüphanenin BİLİNÇLİ kırpması
//      (MetinKirp, Satir, Isaret, Rozet, Dugme etiketi: değeri satır sınırıdır, "…" ile biter, tamamı title'da ve klavye odağında
//      okunur; sınıra uyulduğunu ui-onizle.mjs ayrıca ölçer) — yalnız DİKEY kırpma için: [data-kirp] öğe yatayda taşıyorsa kutusu
//      sıkışmıştır ve yine hatadır. Bilinçli kırpmanın
//      içindeki öğeler ölçülmez (gizli satırları kutunun dışındadır, görünmezler).
//   2. Kartın içinde içerik kesiliyor/kayıyor: .ui-kart içinde overflow'u visible olmayan bir kutunun (kartın kendisi dahil) içeriği
//      kutudan büyük — sessizce kesilir ya da kartta kaydırma çubuğu çıkar (spec §4: kart içinde kaydırma yok; fazlası "Tümü" ile).
//   3. Kartın dışına çıkıyor: öğenin dikdörtgeni en yakın .ui-kart'ın dikdörtgeninin dışına taşıyor.
//   4. Kabından taşıyor (yatay; G3 düzeltme turu 1, inceleme Ö1): öğenin dikdörtgeni onu içeren kutunun (en yakın satır içi olmayan
//      ata) dikdörtgeninden yatayda çıkıyor — satır içi sarmalayıcıdaki kırılmayan yazı ve esnemeyen Sayi (Satir'in sağ sütunundan
//      taşıp başlığın üstüne binen tutar) kartın içinde kalsa da yakalanır. Bilerek dışa açılan öğe (eksi yan pay: Satir/Isaret
//      satırları, kartın hayalet eylemi, Liste'nin "Tümü"sü) payı kadar muaftır; konumlu katmanlar (absolute/fixed) ve SVG'nin iç
//      çizimleri ölçülmez.
//   5. Komşusunun üstüne biniyor: aynı ebeveynin satır içi olmayan iki çocuğunun dikdörtgenleri kesişiyor (ızgara hücresinden taşan
//      içerik, sıkışan esnek satır). Satır içi öğeler (kırılan yazı parçaları) ve konumlu katmanlar sayılmaz.
// Görünmez sayılanlar (ölçülmez): boyutsuz/1×1 px, display: none, visibility: hidden, clip-path: inset(50%) (yalnız ekran okuyucu),
// opaklığı (ataları dahil) ~0, atalarının taşma kırpmasıyla (overflow: hidden/clip/auto/scroll) TAMAMEN kesilen.
// 0.14 T35 (T29 M2, T33): kural 3–5 öğenin GÖRÜNEN kutusunu ölçer — kutu, overflow'u visible olmayan atalarının iç kutusuyla kesilir (kirpikKutu;
// konumlu öğede yalnız kapsayan bloktan başlayarak, position: fixed'de hiç). Yalnız kartın (kart yoksa kökün) İÇİNDEKİ kaplar kırpar: kartın ya da
// sayfanın kendi kırpması içeriği sessizce kesiyorsa bu bir kusurdur ve eskisi gibi yakalanır (kural 2 ve 3). Yuvarlak kaptaki kaydırılan dolgu
// (ilerleme çubuğu) ya da kart içindeki kırpılan katman artık "taşıyor" sayılmaz. İleti biçimi: "[kartın adı] yol > öğe «metin…» neden (ölçüler)"; kartın adı data-galeri-ornek,
// data-kart, aria-label ya da başlığından. Satır içi (inline) öğenin kaydırma boyu yoktur: kural 4 onu kabıyla karşılaştırır.
// Kullanım: const { hata } = await tasmaDenetle(page, '[data-galeri-kok]'); kontrol('taşma yok', !hata.length, hata.join(' | '));
import { TASMA_PAYI } from '../../src/renderer/ui/bicim.ts';

/** Sayfada çalışır (page.evaluate): [kökSeçici, pay] → { hata, olculen }. */
export const TASMA_OLC = ([kokSec, pay]) => {
  const koklar = [...document.querySelectorAll(kokSec)];
  if (!koklar.length) return { hata: [`kök bulunamadı: ${kokSec}`], olculen: 0 };
  const opak = (el) => { for (let e = el; e; e = e.parentElement) if (Number(getComputedStyle(e).opacity) < 0.05) return false; return true; };
  /** Öğenin görünen kutusu: overflow'u visible olmayan her atanın iç (dolgu) kutusuyla kesilir; `dur` (dahil değil) atasında durur. Konumlu (absolute)
   *  öğeyi yalnız kapsayan bloğu ve onun ataları kırpar; position: fixed zincirden kaçar. */
  const kirpikKutu = (el, dur = null) => {
    const r = el.getBoundingClientRect();
    let sol = r.left, ust = r.top, sag = r.right, alt = r.bottom;
    let konum = getComputedStyle(el).position;
    for (let a = el.parentElement; a && a !== dur && a !== document.body && a !== document.documentElement; a = a.parentElement) {
      if (konum === 'fixed') break;
      const c = getComputedStyle(a);
      if (konum === 'absolute' && c.position === 'static' && c.transform === 'none') continue; // kapsayan blok değil: kırpmaz
      konum = c.position;
      if (c.overflowX === 'visible' && c.overflowY === 'visible') continue;
      const ar = a.getBoundingClientRect();
      const x0 = ar.left + a.clientLeft, y0 = ar.top + a.clientTop;
      if (c.overflowX !== 'visible') { sol = Math.max(sol, x0); sag = Math.min(sag, x0 + a.clientWidth); }
      if (c.overflowY !== 'visible') { ust = Math.max(ust, y0); alt = Math.min(alt, y0 + a.clientHeight); }
    }
    return { left: sol, top: ust, right: sag, bottom: alt, width: Math.max(0, sag - sol), height: Math.max(0, alt - ust) };
  };
  /** Kırpmanın sayıldığı sınır (dahil değil): öğenin içinde durduğu kart, kart yoksa kök. */
  const sinirOf = (el, kok) => { const k = el.parentElement?.closest('.ui-kart'); return k && kok.contains(k) ? k : kok; };
  const gorunur = (el, kok) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1 || (r.width <= 1 && r.height <= 1)) return false;
    const c = getComputedStyle(el);
    if (c.display === 'none' || c.visibility === 'hidden' || c.clipPath === 'inset(50%)' || !opak(el)) return false;
    const k = kirpikKutu(el, sinirOf(el, kok));
    return k.width >= 1 && k.height >= 1;
  };
  const metinli = (el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
  const kisa = (s, n = 48) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
  const tanim = (el) => {
    const s = String(el.className?.baseVal ?? el.className ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 2).join('.');
    return `${el.tagName.toLowerCase()}${s ? `.${s}` : ''}`;
  };
  const yol = (el, sinir) => {
    const p = [];
    for (let e = el; e && p.length < 3 && e !== sinir && !koklar.includes(e); e = e.parentElement) p.unshift(tanim(e));
    return p.length ? p.join(' > ') : `${tanim(el)} (kartın kendisi)`;
  };
  const kartAdi = (k) => k.getAttribute('data-galeri-ornek') || k.closest('[data-galeri-ornek]')?.getAttribute('data-galeri-ornek') || k.getAttribute('data-kart') || k.getAttribute('aria-label')
    || kisa(k.querySelector('h1, h2, h3, h4')?.textContent, 30) || 'ui-kart';
  // Kural 4–5 yardımcıları: konumlu katman, SVG iç çizimi, satır içi öğe, içeren kutu (en yakın satır içi olmayan ata).
  const katman = (c) => c.position === 'absolute' || c.position === 'fixed';
  const svgIci = (el) => el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg';
  const satirIci = (c) => c.display === 'inline' || c.display === 'contents';
  const kap = (el) => {
    for (let e = el.parentElement; e && e !== document.body; e = e.parentElement) if (!satirIci(getComputedStyle(e))) return e;
    return null;
  };
  const hata = [];
  let olculen = 0;
  for (const kok of koklar) {
    for (const el of kok.querySelectorAll('*')) {
      if (el.parentElement?.closest('[data-kirp]') || !gorunur(el, kok)) continue;
      olculen++;
      const kirp = el.hasAttribute('data-kirp');
      const kart = el.closest('.ui-kart');
      const yer = kart ? `[${kartAdi(kart)}] ` : '';
      const ad = `${yer}${yol(el, kart)}`;
      const yatay = el.scrollWidth > el.clientWidth + pay;
      const dikey = el.scrollHeight > el.clientHeight + pay;
      const olcu = [yatay && `yatay ${el.scrollWidth}/${el.clientWidth} px`, dikey && `dikey ${el.scrollHeight}/${el.clientHeight} px`].filter(Boolean).join(', ');
      // Bilinçli kırpma DİKEYDİR (satır sınırı); yatay taşıyorsa kutu bir harften dar sıkışmıştır (etiket kesik görünür).
      if (kirp && yatay) hata.push(`${ad} «${kisa(el.textContent)}» bilinçli kırpması yatayda sıkışıyor (${olcu}) — kutusu metnin bir harfinden dar`);
      if (!kirp && (yatay || dikey)) {
        const c = getComputedStyle(el);
        if (metinli(el)) hata.push(`${ad} «${kisa(el.textContent)}» kutusuna sığmıyor (${olcu}) — bilinçli kırpma ise MetinKirp kullan`);
        else if (kart && (c.overflowX !== 'visible' || c.overflowY !== 'visible')) hata.push(`${ad} içeriğini kesiyor/kaydırıyor (${olcu}; overflow ${c.overflowX}/${c.overflowY}) «${kisa(el.textContent)}»`);
      }
      if (kart && kart !== el) {
        const r = kirpikKutu(el, kart);
        const k = kart.getBoundingClientRect();
        const d = [
          r.left < k.left - pay && `solda ${Math.round(k.left - r.left)} px`,
          r.right > k.right + pay && `sağda ${Math.round(r.right - k.right)} px`,
          r.top < k.top - pay && `üstte ${Math.round(k.top - r.top)} px`,
          r.bottom > k.bottom + pay && `altta ${Math.round(r.bottom - k.bottom)} px`,
        ].filter(Boolean);
        if (d.length) hata.push(`${ad} «${kisa(el.textContent)}» kartın dışına taşıyor (${d.join(', ')})`);
      }
      const c = getComputedStyle(el);
      if (katman(c) || svgIci(el)) continue;
      // 4. Kabından taşıyor (yatay). Eksi yan pay (bilerek dışa açılma) o yanda muaf. Görünen kutu: kap kırpıyorsa kabın kendisi de keser.
      const p = kap(el);
      if (p) {
        const sinir = sinirOf(el, kok);
        const r = kirpikKutu(el, sinir !== p && sinir.contains(p) ? p.parentElement : sinir);
        const pr = p.getBoundingClientRect();
        const sol = pr.left - r.left - Math.max(0, -parseFloat(c.marginLeft) || 0);
        const sag = r.right - pr.right - Math.max(0, -parseFloat(c.marginRight) || 0);
        if (sol > pay || sag > pay) {
          hata.push(`${ad} «${kisa(el.textContent)}» kabından taşıyor (${[sol > pay && `solda ${Math.round(sol)} px`, sag > pay && `sağda ${Math.round(sag)} px`].filter(Boolean).join(', ')}; kap ${tanim(p)})`);
        }
      }
      // 5. Komşusunun üstüne biniyor: sonraki kardeşlerle kesişim (iki eksende de paydan büyük). İki kutu da görünen (kırpılmış) kutu.
      if (satirIci(c)) continue;
      const r = kirpikKutu(el, sinirOf(el, kok));
      for (let s = el.nextElementSibling; s; s = s.nextElementSibling) {
        if (!gorunur(s, kok) || svgIci(s)) continue;
        const sc = getComputedStyle(s);
        if (satirIci(sc) || katman(sc)) continue;
        const q = kirpikKutu(s, sinirOf(s, kok));
        const ix = Math.min(r.right, q.right) - Math.max(r.left, q.left);
        const iy = Math.min(r.bottom, q.bottom) - Math.max(r.top, q.top);
        if (ix > pay && iy > pay) hata.push(`${ad} «${kisa(el.textContent)}» komşusunun (${tanim(s)} «${kisa(s.textContent, 24)}») üstüne biniyor (${Math.round(ix)}×${Math.round(iy)} px)`);
      }
    }
  }
  return { hata, olculen };
};

/** Kök altındaki taşmaları ölçer. Boş `hata` = taşma yok. `olculen`: ölçülen görünür öğe sayısı. */
export async function tasmaDenetle(page, kokSecici) {
  return page.evaluate(TASMA_OLC, [kokSecici, TASMA_PAYI]);
}
