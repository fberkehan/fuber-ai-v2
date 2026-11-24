// ── Fuber AI ikon ailesi (0.12 · mini logo) ───────────────────────────────────────────────────────────────────────────────────────────
// Kaynak: resources/ikon/kaynak/fuber-ai-mini.svg — ürünün mini logosu (beyaz dolgu, 126,54 × 158,6, iki yol; geometri
// DEĞİŞTİRİLMEZ, yollar dosyadan okunur). Bu logo yalnız bu uygulama içindir: ters B'li logonun mini hâli —
// küçük ikonlar ve sol kenar çubuğundakiler için. Ters B'li FUƎER yazısı (src/shared/logo.ts) büyük yerlerde sürer.
// Fuber Yönetim kendi ikonunu korur (scripts/yonetim-ikon-uret.py; eski "F + iki nokta" kütüphanesi scripts/ikon-uret.py).
//
// Aile (hepsi bu betikten; elle düzenleme bir sonraki üretimde kaybolur):
//   build/icon.ico             Windows: exe (rcedit), kısayol, görev çubuğu, Alt+Tab, kaldırıcı — 16·20·24·32·40·48·64·96·128·256
//   build/kurulum.ico          kurulum başlatıcısı (native/fuber-kurulum) ve iç NSIS paketi: aynı karo + sağ altta küçük "indir" rozeti
//   build/icon.icns            macOS (Big Sur ızgarası: 824/1024 karo + gölge; 16…1024, PNG girdileri — iconutil gerekmez)
//   build/icon.png             macOS/Linux kaynağı (1024, aynı ızgara)
//   resources/ikon/fuber.ico   pencere ikonu (Windows; build/icon.ico ile BAYT BAYT aynı)
//   resources/ikon/fuber.png   pencere ikonu (diğer sistemler) ve Windows bildiriminin logosu (512)
//   resources/ikon/tepsi-koyu.ico / tepsi-acik.ico   tepsi: zeminsiz tek renk işaret — koyu görev çubuğunda beyaz, açıkta mürekkep (16–48)
//   resources/ikon/tepsiTemplate.png (+@2x)          macOS menü çubuğu şablonu (siyah + alfa; sistem boyar)
//   Telefon (mobil/fuber-cep; masaüstü ve telefon TEK ürün "Fuber AI" — cepDosyalari):
//     android/…/mipmap-*/ic_launcher.png              Android 7 ve öncesi başlatıcı (48 dp karo)
//     android/…/mipmap-*/ic_launcher_foreground.png   uyarlanır ikon ön planı (108 dp, zeminsiz logo; tek renkli tema ikonu da bunun alfası)
//     android/…/mipmap-*/ic_launcher_background.png   uyarlanır ikon arka planı (108 dp grafit zemin; maskeyi sistem uygular)
//     android/…/drawable-*/ic_bildirim.png            durum çubuğu bildirim simgesi (24 dp, beyaz siluet + alfa)
//     assets/img/f-gumus.png                          kilit ekranının gümüş işareti (lib/kilit.dart)
//     assets/img/ikon.png · ikon-512.png               uygulama ikonu 512 · Play Store yüksek çözünürlük (tam kare)
//     web/icons/Icon-*.png · web/favicon.png           PWA ikonları (any: karo; maskable: tam kare) ve favicon
//
// Tasarım (Apple havası; fintech belirteçleri src/renderer/ui/fintech/fintech.css): koyu grafit "squircle" karo (süper elips, köşeler
// şeffaf — Windows ikonları kendiliğinden yuvarlanmaz), üstten süzülen hafif ışık, çok ince titanyum kenar, beyaz mini logo. Küçük
// boylarda (16–32) ayrı ayar: kenar ve ışık yok/azaltılmış, logo daha büyük ve çizgileri optik olarak kalınlaştırılmış (kaynağın çizgisi
// yüksekliğin %4'ü: 16 px'te 0,6 px — kalınlaştırmasız soluk bir leke olurdu); yerleşim alt piksel kaydırmalarıyla piksel ızgarasına
// oturtulur (gri piksel en aza). Kalınlaştırma logonun boşluklarını (kapalı karşı biçimleri) KAPATAMAZ: üretim bozuk olursa durur.
//
// Bağımlılık yok: SVG yolu → çokgen → tarama çizgisi (sıfırdan farklı sarım) → alan örneklemeli kapsama; PNG (node:zlib), ICO ve ICNS
// kendi yazıcılarımızla.
//
// Çalıştır:  node scripts/ikon-uret.mjs                 bütün aileyi yazar
//            node scripts/ikon-uret.mjs --adaylar <klasör>   tasarım adaylarını (A/B/C) her boyda PNG olarak yazar (karar belgesi için)
//            node scripts/ikon-uret.mjs --temas <klasör>     seçilen ailenin temas PNG'leri (her boy; tepsi; macOS) — önizleme sayfaları için
//            node scripts/ikon-uret.mjs --temas <dosya.png>  tek temas sayfası (yazısız; scripts/dev/pencere-onizle.mjs kullanır)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const KOK = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const KAYNAK_SVG = path.join(KOK, 'resources', 'ikon', 'kaynak', 'fuber-ai-mini.svg');

// ── SVG ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Kaynak SVG: viewBox (en, boy) ve yolların `d` dizgeleri (dosyadaki sırayla). */
export function svgOku(dosya = KAYNAK_SVG) {
  const metin = fs.readFileSync(dosya, 'utf8');
  const vb = metin.match(/viewBox="([^"]+)"/)?.[1].trim().split(/[\s,]+/).map(Number);
  const yollar = [...metin.matchAll(/<path\b[^>]*\sd="([^"]+)"/g)].map((m) => m[1]);
  if (!vb || vb.length !== 4 || vb[0] !== 0 || vb[1] !== 0 || yollar.length === 0) throw new Error(`${dosya}: viewBox ya da yol okunamadı`);
  return { en: vb[2], boy: vb[3], yollar };
}

const JETON = /[MmLlHhVvCcSsQqTtZz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g;

/** SVG yolu → kapalı çokgenler (M/L/H/V/C/S/Q/T/Z, büyük-küçük; eğriler `adim` parçaya bölünür). Yay (A) kaynakta yok: desteklenmez. */
export function yolAyristir(d, adim = 48) {
  const jet = d.match(JETON) ?? [];
  let i = 0, x = 0, y = 0, sx = 0, sy = 0, kom = '', kontrol = null, qkontrol = null;
  const altlar = [];
  let cizgi = [];
  const sayi = () => { const v = Number(jet[i++]); if (!Number.isFinite(v)) throw new Error(`yol: sayı bekleniyordu (${jet[i - 1]})`); return v; };
  const kubik = (p0, p1, p2, p3) => {
    for (let k = 1; k <= adim; k++) {
      const t = k / adim, u = 1 - t;
      cizgi.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
        u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]);
    }
  };
  const kapat = () => { if (cizgi.length > 2) altlar.push(cizgi); cizgi = []; };
  while (i < jet.length) {
    if (/^[A-Za-z]$/.test(jet[i])) {
      kom = jet[i++];
      if (kom === 'Z' || kom === 'z') { kapat(); x = sx; y = sy; kontrol = qkontrol = null; continue; }
    }
    const rel = kom === kom.toLowerCase();
    switch (kom.toUpperCase()) {
      case 'M': {
        let nx = sayi(), ny = sayi();
        if (rel) { nx += x; ny += y; }
        kapat();
        cizgi = [[nx, ny]];
        x = sx = nx; y = sy = ny;
        kom = rel ? 'l' : 'L';
        kontrol = qkontrol = null;
        break;
      }
      case 'L': { let nx = sayi(), ny = sayi(); if (rel) { nx += x; ny += y; } cizgi.push([nx, ny]); x = nx; y = ny; kontrol = qkontrol = null; break; }
      case 'H': { const nx = sayi(); x = rel ? x + nx : nx; cizgi.push([x, y]); kontrol = qkontrol = null; break; }
      case 'V': { const ny = sayi(); y = rel ? y + ny : ny; cizgi.push([x, y]); kontrol = qkontrol = null; break; }
      case 'C': {
        const a = [sayi(), sayi(), sayi(), sayi(), sayi(), sayi()];
        if (rel) for (let k = 0; k < 6; k++) a[k] += k % 2 ? y : x;
        kubik([x, y], [a[0], a[1]], [a[2], a[3]], [a[4], a[5]]);
        kontrol = [a[2], a[3]]; qkontrol = null; x = a[4]; y = a[5];
        break;
      }
      case 'S': {
        const a = [sayi(), sayi(), sayi(), sayi()];
        if (rel) for (let k = 0; k < 4; k++) a[k] += k % 2 ? y : x;
        const k1 = kontrol ? [2 * x - kontrol[0], 2 * y - kontrol[1]] : [x, y];
        kubik([x, y], k1, [a[0], a[1]], [a[2], a[3]]);
        kontrol = [a[0], a[1]]; qkontrol = null; x = a[2]; y = a[3];
        break;
      }
      case 'Q': case 'T': {
        let q, nx, ny;
        if (kom.toUpperCase() === 'Q') { q = [sayi(), sayi()]; if (rel) { q[0] += x; q[1] += y; } } else q = qkontrol ? [2 * x - qkontrol[0], 2 * y - qkontrol[1]] : [x, y];
        nx = sayi(); ny = sayi();
        if (rel) { nx += x; ny += y; }
        kubik([x, y], [x + 2 / 3 * (q[0] - x), y + 2 / 3 * (q[1] - y)], [nx + 2 / 3 * (q[0] - nx), ny + 2 / 3 * (q[1] - ny)], [nx, ny]);
        qkontrol = q; kontrol = null; x = nx; y = ny;
        break;
      }
      default: throw new Error(`desteklenmeyen yol komutu: ${kom}`);
    }
  }
  kapat();
  return altlar;
}

let _logo = null;
/** Mini logo: { en, boy, cokgenler } (kaynak SVG'den, bir kez). */
export function logo() {
  if (_logo) return _logo;
  const s = svgOku();
  _logo = { en: s.en, boy: s.boy, yollar: s.yollar, cokgenler: s.yollar.flatMap((d) => yolAyristir(d)) };
  return _logo;
}

// ── Taramalı çizim ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Çokgenlerin ikili maskesi (R×R örnek; örnek merkezleri; sıfırdan farklı sarım). `donustur(x, y)` → örnek birimi [x, y]. */
export function maske(cokgenler, R, donustur) {
  const kenarlar = [];
  for (const p of cokgenler) {
    const q = p.map(([x, y]) => donustur(x, y));
    for (let i = 0; i < q.length; i++) {
      const a = q[i], b = q[(i + 1) % q.length];
      if (a[1] === b[1]) continue;
      const asagi = b[1] > a[1];
      const [u, v] = asagi ? [a, b] : [b, a];
      kenarlar.push({ ymin: u[1], ymax: v[1], x0: u[0], y0: u[1], egim: (v[0] - u[0]) / (v[1] - u[1]), yon: asagi ? 1 : -1 });
    }
  }
  kenarlar.sort((a, b) => a.ymin - b.ymin);
  const m = new Uint8Array(R * R);
  let k = 0, aktif = [];
  const xs = [];
  for (let sy = 0; sy < R; sy++) {
    const yc = sy + 0.5;
    while (k < kenarlar.length && kenarlar[k].ymin <= yc) aktif.push(kenarlar[k++]);
    aktif = aktif.filter((e) => e.ymax > yc);
    xs.length = 0;
    for (const e of aktif) if (e.ymin <= yc) xs.push([e.x0 + (yc - e.y0) * e.egim, e.yon]);
    if (xs.length < 2) continue;
    xs.sort((a, b) => a[0] - b[0]);
    let w = 0, bas = 0;
    for (const [x, yon] of xs) {
      const once = w;
      w += yon;
      if (once === 0 && w !== 0) bas = x;
      else if (once !== 0 && w === 0) {
        const s0 = Math.max(0, Math.ceil(bas - 0.5)), s1 = Math.min(R, Math.ceil(x - 0.5));
        for (let sx = s0; sx < s1; sx++) m[sy * R + sx] = 1;
      }
    }
  }
  return m;
}

/** ss×ss blok ortalaması: ikili maske (R = N·ss) → N×N kapsama (0..1). */
export function kucult(m, R, ss) {
  const N = R / ss, c = new Float32Array(N * N), b = 1 / (ss * ss);
  for (let sy = 0; sy < R; sy++) {
    const sat = (sy / ss | 0) * N, o = sy * R;
    for (let sx = 0; sx < R; sx++) if (m[o + sx]) c[sat + (sx / ss | 0)] += b;
  }
  return c;
}

/** 1B kare uzaklık dönüşümü (Felzenszwalb–Huttenlocher). */
function edt1(f, n, d, v, z) {
  let k = 0;
  v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]); }
    k++; v[k] = q; z[k] = s; z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) * (q - v[k]) + f[v[k]]; }
}

/** Maskeyi `r` örnek yarıçaplı daireyle genişletir (Öklid uzaklık dönüşümü): çizgiler her yandan r kalınlaşır. */
export function genislet(m, R, r) {
  if (r <= 0) return m;
  const BUYUK = 1e12, f = new Float64Array(R * R);
  for (let i = 0; i < R * R; i++) f[i] = m[i] ? 0 : BUYUK;
  const g = new Float64Array(R), d = new Float64Array(R), v = new Int32Array(R), z = new Float64Array(R + 1);
  for (let x = 0; x < R; x++) { for (let y = 0; y < R; y++) g[y] = f[y * R + x]; edt1(g, R, d, v, z); for (let y = 0; y < R; y++) f[y * R + x] = d[y]; }
  for (let y = 0; y < R; y++) { const o = y * R; for (let x = 0; x < R; x++) g[x] = f[o + x]; edt1(g, R, d, v, z); for (let x = 0; x < R; x++) f[o + x] = d[x]; }
  const out = new Uint8Array(R * R), r2 = r * r;
  for (let i = 0; i < R * R; i++) out[i] = f[i] <= r2 ? 1 : 0;
  return out;
}

/** Arka planın kapalı bölgeleri (kenara değmeyen zemin parçaları, 4-komşuluk) — kalınlaştırma bir boşluğu kapatmasın diye sayılır. */
export function kapaliBolgeSayisi(m, R) {
  const goruldu = new Uint8Array(R * R), yigin = new Int32Array(R * R);
  let sayi = 0;
  for (let i = 0; i < R * R; i++) {
    if (m[i] || goruldu[i]) continue;
    let ust = 0, kenar = false, alan = 0;
    yigin[ust++] = i; goruldu[i] = 1;
    while (ust) {
      const j = yigin[--ust], x = j % R, y = (j / R) | 0;
      alan++;
      if (x === 0 || y === 0 || x === R - 1 || y === R - 1) kenar = true;
      if (x > 0 && !m[j - 1] && !goruldu[j - 1]) { goruldu[j - 1] = 1; yigin[ust++] = j - 1; }
      if (x < R - 1 && !m[j + 1] && !goruldu[j + 1]) { goruldu[j + 1] = 1; yigin[ust++] = j + 1; }
      if (y > 0 && !m[j - R] && !goruldu[j - R]) { goruldu[j - R] = 1; yigin[ust++] = j - R; }
      if (y < R - 1 && !m[j + R] && !goruldu[j + R]) { goruldu[j + R] = 1; yigin[ust++] = j + R; }
    }
    if (!kenar && alan > 2) sayi++;
  }
  return sayi;
}

/** Süper elips karo kapsaması (N×N, ss² örnek): sınırlar piksel biriminde; n = 5 Apple'ın sürekli eğrili köşesine yakındır. */
export function superelips(N, x0, y0, x1, y1, n = 5, ss = 8) {
  const c = new Float32Array(N * N), cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, a = (x1 - x0) / 2, b = (y1 - y0) / 2, w = 1 / (ss * ss);
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      // Merkez açıkça içerideyse ya da dışarıdaysa tek örnek yeter.
      const ux = Math.abs((px + 0.5 - cx) / a), uy = Math.abs((py + 0.5 - cy) / b);
      const kenarPay = 1.5 / Math.min(a, b);
      if (ux + kenarPay < 1 && uy + kenarPay < 1 && ux ** n + uy ** n < (1 - kenarPay) ** n) { c[py * N + px] = 1; continue; }
      if (ux - kenarPay > 1 || uy - kenarPay > 1) continue;
      let t = 0;
      for (let j = 0; j < ss; j++) {
        const vy = Math.abs((py + (j + 0.5) / ss - cy) / b) ** n;
        for (let i = 0; i < ss; i++) if (Math.abs((px + (i + 0.5) / ss - cx) / a) ** n + vy <= 1) t++;
      }
      c[py * N + px] = t * w;
    }
  }
  return c;
}

/** Ayrılabilir Gauss yaklaşımı (üç kutu geçişi). */
export function bulanik(a, N, sigma) {
  if (sigma <= 0.3) return a;
  const r = Math.max(1, Math.round(Math.sqrt((12 * sigma * sigma) / 3 + 1) / 2));
  let s = Float32Array.from(a), t = new Float32Array(N * N);
  for (let gecis = 0; gecis < 3; gecis++) {
    for (let y = 0; y < N; y++) {
      let top = 0;
      for (let x = -r; x <= r; x++) top += s[y * N + Math.min(N - 1, Math.max(0, x))];
      for (let x = 0; x < N; x++) {
        t[y * N + x] = top / (2 * r + 1);
        top += s[y * N + Math.min(N - 1, x + r + 1)] - s[y * N + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < N; x++) {
      let top = 0;
      for (let y = -r; y <= r; y++) top += t[Math.min(N - 1, Math.max(0, y)) * N + x];
      for (let y = 0; y < N; y++) {
        s[y * N + x] = top / (2 * r + 1);
        top += t[Math.min(N - 1, y + r + 1) * N + x] - t[Math.max(0, y - r) * N + x];
      }
    }
  }
  return s;
}

/** Kapsamayı (dx, dy) tam piksel kaydırır (gölge). */
export function kaydir(a, N, dx, dy) {
  const o = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const ky = y - dy;
    if (ky < 0 || ky >= N) continue;
    for (let x = 0; x < N; x++) { const kx = x - dx; if (kx >= 0 && kx < N) o[y * N + x] = a[ky * N + kx]; }
  }
  return o;
}

// ── Boyama (önçarpılmış RGBA, 0..1) ────────────────────────────────────────────────────────────────────────────────────────────────

export const hex = (h) => { const n = parseInt(h.replace('#', ''), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const karis = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** `alfa` kapsamasını `renk` ile tuvalin üstüne boyar. `renk`: [r,g,b] ya da (x, y) → [r,g,b] (piksel merkezi, 0..N). */
export function boya(t, N, alfa, renk, opaklik = 1) {
  const sabit = typeof renk !== 'function';
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = y * N + x, a = alfa[i] * (typeof opaklik === 'function' ? opaklik(x + 0.5, y + 0.5) : opaklik);
      if (a <= 0) continue;
      const c = sabit ? renk : renk(x + 0.5, y + 0.5), o = i * 4, k = 1 - a;
      t[o] = c[0] * a + t[o] * k; t[o + 1] = c[1] * a + t[o + 1] * k; t[o + 2] = c[2] * a + t[o + 2] * k; t[o + 3] = a + t[o + 3] * k;
    }
  }
  return t;
}

/** Önçarpılmış tuval → düz RGBA bayt (PNG/ICO). */
export function baytlar(t, N) {
  const b = new Uint8Array(N * N * 4);
  for (let i = 0; i < N * N; i++) {
    const a = t[i * 4 + 3];
    if (a <= 1e-6) continue;
    for (let c = 0; c < 3; c++) b[i * 4 + c] = Math.max(0, Math.min(255, Math.round((t[i * 4 + c] / a) * 255)));
    b[i * 4 + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
  }
  return { en: N, boy: N, veri: b };
}

// ── Logo yerleşimi ve küçük boy ayarı ──────────────────────────────────────────────────────────────────────────────────────────────

/** Logonun kapsaması: `kutu` = { sol, ust, boy } piksel; `kalin` = eklenen toplam çizgi kalınlığı (piksel; her yana yarısı). */
export function logoKapsama(N, kutu, { ss = N <= 48 ? 16 : N <= 256 ? 6 : 3, kalin = 0, ham = false } = {}) {
  const L = logo(), R = N * ss, k = (kutu.boy / L.boy) * ss;
  let m = maske(L.cokgenler, R, (x, y) => [kutu.sol * ss + x * k, kutu.ust * ss + y * k]);
  const once = kalin > 0 ? kapaliBolgeSayisi(m, R) : 0;
  if (kalin > 0) {
    m = genislet(m, R, (kalin / 2) * ss);
    const sonra = kapaliBolgeSayisi(m, R);
    if (sonra < once) throw new Error(`${N} px: kalınlaştırma (${kalin} px) logonun ${once - sonra} boşluğunu kapattı`);
  }
  return ham ? { m, R } : kucult(m, R, ss);
}

/** Gri piksel cezası: kapsama 0 ya da 1'e ne kadar yakınsa o kadar keskin (alt piksel yerleşim araması için). */
function griCeza(c) { let g = 0, top = 0; for (const v of c) { g += v * (1 - v); top += v; } return g / Math.max(top, 1e-6); }

/** Kontrast eğrisi (küçük boylar): kapsama 0,5 çevresinde dikleşir — yarı dolu pikseller ya beyaza ya zemine yaklaşır (soluk leke yerine
 *  keskin çizgi). k = 1 dokunmaz. */
const kontrastla = (c, k) => (k === 1 ? c : c.map((v) => Math.min(1, Math.max(0, (v - 0.5) * k + 0.5))));

/**
 * Küçük boy yerleşimi: logo kutusu `merkez` (cx, cy) ve `boy` ile verilir; ±yarım piksel içinde 1/8 piksellik alt kaydırmalar denenir,
 * en az gri pikselli olan seçilir (elle "hinting" yerine tekrar üretilebilir arama). Dönen: { kutu, c }.
 */
export function yerlestir(N, { cx, cy, boy, kalin = 0, kontrast = 1, ara = true, pay = 0 }) {
  const L = logo(), en = (boy * L.en) / L.boy;
  const taban = { sol: cx - en / 2, ust: cy - boy / 2, boy };
  if (!ara) return { kutu: taban, c: kontrastla(logoKapsama(N, taban, { kalin }), kontrast) };
  let iyi = null;
  for (let j = -4; j < 4; j++) {
    for (let i = -4; i < 4; i++) {
      const kutu = { sol: Math.round((taban.sol + i / 8) * 8) / 8, ust: Math.round((taban.ust + j / 8) * 8) / 8, boy };
      const c = kontrastla(logoKapsama(N, kutu, { kalin }), kontrast);
      if (pay > 0 && kenarMurekkebi(c, N, pay) > 0) continue;
      const ceza = griCeza(c) + 0.02 * (Math.abs(i) + Math.abs(j)) / 8;
      if (!iyi || ceza < iyi.ceza) iyi = { kutu, c, ceza };
    }
  }
  return iyi;
}

/** Tuvalin dış `pay` piksellik halkasındaki mürekkep (yuvarlanınca alfası ≥ 1 olacak piksel sayısı) — nefes payı denetimi. */
export function kenarMurekkebi(c, N, pay = 1) {
  let n = 0;
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if ((x < pay || y < pay || x >= N - pay || y >= N - pay) && c[y * N + x] >= 0.5 / 255) n++;
  return n;
}

// ── Tasarım adayları ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
// Ortak: karo süper elips (n = 5), logo beyaz. Farklar karonun malzemesinde, kenarında ve logonun ışığında.
//   A "Grafit"   : --ft-kart-zemin'den grafit geçiş (sol üst #2c2e34 → sağ alt #0a0a0c), üstten çok hafif ışık, ince titanyum kenar,
//                  logo beyazdan inci grisine çok hafif dikey geçiş. Uygulamanın kart malzemesiyle aynı aile.
//   B "Gece"     : saf siyah karo (#0b0b0c → #000), belirgin titanyum (gümüş) kenar halkası, düz beyaz logo, ışık yok — Apple Card siyahı.
//   C "Gümüş"    : grafit karo (#1c1c1e → #08080a), logo gümüş-titanyum geçişli (#b9bdcd → #eef0f5, --ft-gumus-1/2), kenar yok.
export const ADAYLAR = {
  A: { ad: 'Grafit', zemin: ['#2c2e34', '#141518', '#0a0a0c'], isik: 0.11, kenar: { ust: 0.30, alt: 0.07, renk: '#e6e9f0' }, logo: ['#ffffff', '#e3e5eb'] },
  B: { ad: 'Gece', zemin: ['#0d0d0e', '#050505', '#000000'], isik: 0, kenar: { ust: 0.46, alt: 0.18, renk: '#cfd3dc' }, logo: ['#ffffff', '#ffffff'] },
  C: { ad: 'Gümüş', zemin: ['#1f1f22', '#121214', '#08080a'], isik: 0.06, kenar: null, logo: ['#eef0f5', '#b9bdcd'] },
};
export const SECILEN = 'A';

/** Küçük boyların ayarı (Windows karosu; görev çubuğu %100'de 24, %125–150'de 32/40/48): karo kenar payı, logo yüksekliği (piksel),
 *  optik kalınlaştırma (eklenen toplam çizgi kalınlığı, piksel) ve kontrast. Küçük boyda logo karonun daha büyük bölümünü kaplar
 *  (16–24'te ~%75; büyük boylarda %57 — LOGO_ORANI). Değerler aday ızgarasında piksel piksel seçildi (karar belgesi). */
export const KUCUK_KARO = {
  16: { pay: 0, boy: 12, kalin: 0.7, kontrast: 1.5 },
  20: { pay: 0, boy: 15, kalin: 0.65, kontrast: 1.4 },
  24: { pay: 0, boy: 17.5, kalin: 0.6, kontrast: 1.3 },
  32: { pay: 1, boy: 21.5, kalin: 0.5, kontrast: 1.2 },
};
/** Orta boylar (40–96): logo/karo oranı büyükten küçüğe yumuşakça artar; çizgi hâlâ incedir → hafif kalınlaştırma ve kontrast. */
export const ORTA_KARO = {
  40: { oran: 0.67, kalin: 0.42, kontrast: 1.1 },
  48: { oran: 0.645, kalin: 0.36, kontrast: 1.05 },
  64: { oran: 0.615, kalin: 0.26, kontrast: 1 },
  96: { oran: 0.59, kalin: 0.15, kontrast: 1 },
};
/** Büyük boylarda (128 ve üstü, macOS ızgarası) logo yüksekliği / karo yüksekliği. */
export const LOGO_ORANI = 0.57;
/** Tepsi (zeminsiz): logo yüksekliği (üst sınır), kalınlaştırma, kontrast ve nefes payı. 16/20/24 px'te dış 1 piksellik halka BOŞ
 *  (inceleme Minor-4: logo tuvale tam oturup kenarda kırpılıyordu, komşu tepsi ikonlarına göre sıkışık duruyordu); sığmazsa logo 0,25 px
 *  adımlarla küçülür (siluetKapsama). */
export const KUCUK_TEPSI = {
  16: { boy: 14, kalin: 0.55, kontrast: 1.5, pay: 1 },
  20: { boy: 18, kalin: 0.55, kontrast: 1.4, pay: 1 },
  24: { boy: 22, kalin: 0.5, kontrast: 1.3, pay: 1 },
  32: { boy: 29, kalin: 0.5, kontrast: 1.2, pay: 1 },
  40: { boy: 36, kalin: 0.4, kontrast: 1.1, pay: 1 },
  48: { boy: 44, kalin: 0.3, kontrast: 1.05, pay: 1 },
};

/** Karo zemini: üç duraklı çapraz geçiş (152°: sol üst → sağ alt) + üstten süzülen ışık. */
function zeminRengi(t, N, k0, k1) {
  const [a, b, c] = t.zemin.map(hex);
  const h = k1.y - k0.y, w = k1.x - k0.x;
  const dx = Math.sin((152 * Math.PI) / 180), dy = -Math.cos((152 * Math.PI) / 180);
  const L = Math.abs(w * dx) + Math.abs(h * dy);
  return (x, y) => {
    const u = ((x - (k0.x + k1.x) / 2) * dx + (y - (k0.y + k1.y) / 2) * dy) / L + 0.5;
    let r = u < 0.46 ? karis(a, b, Math.max(0, u) / 0.46) : karis(b, c, Math.min(1, (u - 0.46) / 0.54));
    if (t.isik) {
      const d = Math.hypot((x - (k0.x + k1.x) / 2) / (w * 0.62), (y - (k0.y - h * 0.16)) / (h * 0.62));
      const s = Math.max(0, 1 - d) ** 1.6 * t.isik;
      r = [r[0] + 0.82 * s, r[1] + 0.86 * s, r[2] + 0.98 * s];
    }
    return r;
  };
}

/**
 * Uygulama ikonu (Windows: karo tuvali neredeyse doldurur; macOS: Big Sur ızgarası 824/1024 + gölge).
 * `tasarim`: ADAYLAR'dan biri. Küçük boylar (KUCUK_KARO) ayrı ayardır.
 */
export function uygulamaIkonu(N, { tasarim = ADAYLAR[SECILEN], izgara = 'win' } = {}) {
  const t = new Float32Array(N * N * 4);
  const kucuk = izgara === 'win' ? KUCUK_KARO[N] : null;
  let k0, k1;
  if (kucuk) { k0 = { x: kucuk.pay, y: kucuk.pay }; k1 = { x: N - kucuk.pay, y: N - kucuk.pay }; }
  else if (izgara === 'mac') { const p = (100 / 1024) * N; k0 = { x: p, y: p * 0.92 }; k1 = { x: N - p, y: N - p * 1.08 }; }
  else { const p = N <= 48 ? 1 : 0.045 * N; k0 = { x: p, y: p * 0.8 }; k1 = { x: N - p, y: N - p * 1.2 }; }
  const ss = N <= 64 ? 16 : N <= 256 ? 6 : 3;
  const karo = superelips(N, k0.x, k0.y, k1.x, k1.y, 5, ss);
  // Karonun yere bastığı yumuşak gölge (büyük boylar; tuval payının içinde).
  if (!kucuk && N >= 64) {
    boya(t, N, kaydir(bulanik(karo, N, N * 0.016), N, 0, Math.round(N * 0.012)), [0, 0, 0], 0.32);
    boya(t, N, kaydir(bulanik(karo, N, N * 0.004), N, 0, Math.round(N * 0.004)), [0, 0, 0], 0.22);
  }
  const kh = k1.y - k0.y;
  boya(t, N, karo, zeminRengi(kucuk ? { ...tasarim, isik: tasarim.isik * 0.5 } : tasarim, N, k0, k1));
  // Titanyum kenar: karonun içine ince halka; üstte parlak, aşağı söner. Küçük boylarda yalnız 16 hariç tek piksellik soluk üst ışık.
  if (tasarim.kenar && (!kucuk || N >= 20)) {
    const w = kucuk ? 1 : Math.max(1, N / 210);
    const ic = superelips(N, k0.x + w, k0.y + w, k1.x - w, k1.y - w, 5, ss);
    const halka = karo.map((v, i) => Math.max(0, v - ic[i]));
    const kr = hex(tasarim.kenar.renk), { ust, alt } = tasarim.kenar;
    boya(t, N, halka, kr, (x, y) => (kucuk ? 0.55 : 1) * (alt + (ust - alt) * Math.max(0, 1 - (y - k0.y) / kh) ** 1.4));
  }
  // Logo: optik merkez (kütle sol üstte ağır: hafifçe sağa ve aşağı).
  const L = logo();
  let c;
  if (kucuk) {
    ({ c } = yerlestir(N, { cx: N / 2 + 0.25, cy: N / 2 + 0.1, boy: kucuk.boy, kalin: kucuk.kalin, kontrast: kucuk.kontrast }));
  } else {
    const orta = izgara === 'win' ? ORTA_KARO[N] : null;
    const boy = kh * (orta?.oran ?? LOGO_ORANI), en = (boy * L.en) / L.boy;
    const kutu = { sol: (k0.x + k1.x) / 2 - en / 2 + kh * 0.012, ust: (k0.y + k1.y) / 2 - boy / 2 + kh * 0.006, boy };
    // 40–96 px: hâlâ küçük — hafif kalınlaştırma, aramalı yerleşim.
    if (orta) ({ c } = yerlestir(N, { cx: kutu.sol + en / 2, cy: kutu.ust + boy / 2, boy, kalin: orta.kalin, kontrast: orta.kontrast }));
    else c = logoKapsama(N, kutu);
    logoGolgesi(t, N, c);
  }
  logoBoya(t, N, c, tasarim.logo);
  return baytlar(t, N);
}

/** Logonun karoya bıraktığı çok ince gölge (derinlik; abartısız). */
function logoGolgesi(t, N, c) {
  boya(t, N, kaydir(bulanik(c, N, N * 0.008), N, 0, Math.max(1, Math.round(N * 0.008))), [0, 0, 0], 0.38);
}

/** Logoyu iki duraklı DİKEY geçişle boyar (üstte ilk renk): uygulama ikonunun beyaz → inci grisi logosu. */
function logoBoya(t, N, c, [ust, alt]) {
  const [l0, l1] = [hex(ust), hex(alt)];
  const ys = [];
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (c[y * N + x] > 0.02) { ys.push(y); break; }
  const ly0 = ys[0] ?? 0, ly1 = ys[ys.length - 1] ?? N;
  boya(t, N, c, (x, y) => karis(l0, l1, Math.min(1, Math.max(0, (y - ly0) / Math.max(1, ly1 - ly0)))));
}

/** Logo kutusu: merkezde, optik düzeltmeyle (kütle sol üstte ağır → hafifçe sağa ve aşağı; uygulama ikonuyla aynı oran). */
function ortaKutu(N, boy) {
  const en = (boy * logo().en) / logo().boy;
  return { sol: N / 2 - en / 2 + boy * 0.021, ust: N / 2 - boy / 2 + boy * 0.0105, boy };
}

/**
 * Tam kare (köşesiz, kenara dek) ikon: karonun grafit zemini (ışık dahil, titanyum kenar yok — maskeyi sistem uygular) ve/veya logo.
 * Android uyarlanır ikonun arka planı (`logoVar: false`) ve ön planı (`zeminVar: false`; zeminsiz logo, gölgesiz — tek renkli tema ikonu
 * da aynı dosyanın alfasını kullanır), PWA "maskable" ve Play Store 512 ikonu. `oran`: logo yüksekliği / kenar.
 */
export function tamKareIkon(N, { oran = 0.45, zeminVar = true, logoVar = true, tasarim = ADAYLAR[SECILEN] } = {}) {
  const t = new Float32Array(N * N * 4);
  if (zeminVar) boya(t, N, new Float32Array(N * N).fill(1), zeminRengi(tasarim, N, { x: 0, y: 0 }, { x: N, y: N }));
  if (logoVar) {
    const c = logoKapsama(N, ortaKutu(N, N * oran));
    if (zeminVar) logoGolgesi(t, N, c);
    logoBoya(t, N, c, tasarim.logo);
  }
  return baytlar(t, N);
}

/** Android durum çubuğu bildirim simgesi (24 dp; beyaz siluet + alfa — sistem boyar): logo 20 dp, 1 dp nefes payı. */
export const BILDIRIM_KALIN = { 24: { kalin: 0.55, kontrast: 1.4 }, 36: { kalin: 0.4, kontrast: 1.2 }, 48: { kalin: 0.3, kontrast: 1.1 }, 72: { kalin: 0.1, kontrast: 1 }, 96: { kalin: 0, kontrast: 1 } };
export function bildirimSimgesi(N) {
  const k = N / 24, a = BILDIRIM_KALIN[N] ?? { kalin: 0, kontrast: 1 };
  const { c } = siluetKapsama(N, { boy: 20 * k, kalin: a.kalin, kontrast: a.kontrast, pay: Math.max(1, Math.round(k)) });
  const t = new Float32Array(N * N * 4);
  boya(t, N, c, [1, 1, 1]);
  return baytlar(t, N);
}

/** Gümüş-titanyum işaret (kilit ekranı; zeminsiz, logonun kendi oranında W×H): sol alttan (#b9bdcd) sağ üste (#eef0f5) — arayüzün
 *  MiniLogo'suyla aynı geçiş (--ft-gumus-1/2). */
export function gumusIsaret(H = 200) {
  const L = logo(), W = Math.ceil((H * L.en) / L.boy), N = H;
  const kutu = { sol: (W - (H * L.en) / L.boy) / 2, ust: 0, boy: H };
  const c = logoKapsama(N, kutu);
  const [g1, g2] = [hex('#b9bdcd'), hex('#eef0f5')];
  const t = new Float32Array(N * N * 4);
  boya(t, N, c, (x, y) => karis(g1, g2, Math.min(1, Math.max(0, ((x / W) + (1 - y / H)) / 2))));
  const kare = baytlar(t, N), veri = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) veri.set(kare.veri.subarray(y * N * 4, y * N * 4 + W * 4), y * W * 4);
  return { en: W, boy: H, veri };
}

/** Zeminsiz tek renk logonun kapsaması: `boy` üst sınırdır; `pay` > 0 ise dış halka boş kalana dek logo 0,25 px adımlarla küçülür. */
export function siluetKapsama(N, { boy, kalin = 0, kontrast = 1, pay = 0 }) {
  for (let b = boy; b >= boy * 0.7; b -= 0.25) {
    const y = yerlestir(N, { cx: N / 2, cy: N / 2, boy: b, kalin, kontrast, ara: kalin > 0 || pay > 0, pay });
    if (y && (pay === 0 || kenarMurekkebi(y.c, N, pay) === 0)) return { ...y, boy: b };
  }
  throw new Error(`${N} px: logo ${pay} px nefes payına sığmadı`);
}

/** Tepsi ikonu: zeminsiz tek renk logo. */
export function tepsiIkonu(N, renk) {
  const { c } = siluetKapsama(N, KUCUK_TEPSI[N] ?? { boy: N * 0.92 });
  const t = new Float32Array(N * N * 4);
  boya(t, N, c, hex(renk));
  return baytlar(t, N);
}

/** Kurulum rozetinin en küçük boyu: daha küçük ikonlarda (16, 20 — pencere başlığı, ayrıntı görünümü) 6–7 piksellik bir ok okunmaz,
 *  leke olurdu; orada kurulum ikonu uygulama ikonunun kendisidir. */
export const ROZET_EN_KUCUK = 24;

/** Kurulum ikonu: uygulama ikonu + sağ altta "indir" rozeti (beyaz disk, koyu ok; mavi YOK — fintech dili). Rozet logoya değmez:
 *  logonun sağ altı boştur (alt yarıda yalnız sol halka); çap, logonun hiçbir parlak pikseline en az bir piksel yaklaşmayana dek küçülür. */
export function kurulumIkonu(N, opt = {}) {
  const taban = uygulamaIkonu(N, opt);
  if (N < ROZET_EN_KUCUK) return taban;
  const t = new Float32Array(N * N * 4);
  for (let i = 0; i < N * N; i++) { const a = taban.veri[i * 4 + 3] / 255; for (let c = 0; c < 3; c++) t[i * 4 + c] = (taban.veri[i * 4 + c] / 255) * a; t[i * 4 + 3] = a; }
  const parlak = [];
  for (let i = 0; i < N * N; i++) { const v = taban.veri; if (0.2126 * v[i * 4] + 0.7152 * v[i * 4 + 1] + 0.0722 * v[i * 4 + 2] > 150 && v[i * 4 + 3] > 200) parlak.push([i % N, (i / N) | 0]); }
  const kay = N <= 32 ? 0 : N * 0.02;
  let cap = { 24: 11, 32: 13, 40: 15, 48: 17 }[N] ?? Math.round(N * 0.3);
  for (; cap > 7; cap--) {
    const r = cap / 2, m = N - r - kay;
    if (parlak.every(([x, y]) => Math.hypot(x + 0.5 - m, y + 0.5 - m) > r + 1.0)) break;
  }
  const r = cap / 2, m = N - r - kay, ss = 16;
  const disk = new Float32Array(N * N), halka = new Float32Array(N * N), ok = new Float32Array(N * N);
  const kal = Math.max(1, cap * 0.11);
  for (let py = 0; py < N; py++) {
    for (let px = 0; px < N; px++) {
      let d = 0, h = 0, o = 0;
      for (let j = 0; j < ss; j++) {
        for (let i = 0; i < ss; i++) {
          const x = px + (i + 0.5) / ss, y = py + (j + 0.5) / ss, u = x - m, v = y - m, q = Math.hypot(u, v);
          if (q <= r) h++;
          if (q <= r - Math.max(0.75, cap * 0.07)) {
            d++;
            // Aşağı ok: dikey sap + iki kol.
            const sap = Math.abs(u) <= kal / 2 && v >= -cap * 0.25 && v <= cap * 0.17;
            const kol = Math.abs(v - cap * 0.2 + Math.abs(u)) <= kal * 0.62 && Math.abs(u) <= cap * 0.23 && v <= cap * 0.2 + kal * 0.3;
            if (sap || kol) o++;
          }
        }
      }
      halka[py * N + px] = h / (ss * ss); disk[py * N + px] = d / (ss * ss); ok[py * N + px] = o / (ss * ss);
    }
  }
  boya(t, N, halka, hex('#0a0a0c'));
  boya(t, N, disk, hex('#f5f5f7'));
  boya(t, N, ok, hex('#0a0a0c'));
  return baytlar(t, N);
}

// ── Dosya biçimleri ───────────────────────────────────────────────────────────────────────────────────────────────────────────────

const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };

/** PNG (8 bit RGBA; satır başına en küçük mutlak toplamlı süzgeç). */
export function png({ en, boy, veri }) {
  const sat = en * 4, ham = Buffer.alloc((sat + 1) * boy), onceki = new Uint8Array(sat), aday = new Uint8Array(sat);
  for (let y = 0; y < boy; y++) {
    const s = veri.subarray(y * sat, (y + 1) * sat);
    let iyi = 0, iyiTop = Infinity, iyiSat = null;
    for (let f = 0; f < 5; f++) {
      let top = 0;
      for (let x = 0; x < sat; x++) {
        const a = x >= 4 ? s[x - 4] : 0, b = onceki[x], c = x >= 4 ? onceki[x - 4] : 0;
        let p;
        if (f === 0) p = s[x];
        else if (f === 1) p = s[x] - a;
        else if (f === 2) p = s[x] - b;
        else if (f === 3) p = s[x] - ((a + b) >> 1);
        else { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = s[x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); }
        aday[x] = p & 255;
        top += aday[x] < 128 ? aday[x] : 256 - aday[x];
      }
      if (top < iyiTop) { iyiTop = top; iyi = f; iyiSat = Uint8Array.from(aday); }
    }
    ham[y * (sat + 1)] = iyi;
    ham.set(iyiSat, y * (sat + 1) + 1);
    onceki.set(s);
  }
  const parca = (tur, govde) => {
    const b = Buffer.alloc(12 + govde.length);
    b.writeUInt32BE(govde.length, 0); b.write(tur, 4, 'latin1'); govde.copy(b, 8);
    b.writeUInt32BE(crc32(b.subarray(4, 8 + govde.length)), 8 + govde.length);
    return b;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(en, 0); ihdr.writeUInt32BE(boy, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), parca('IHDR', ihdr), parca('IDAT', zlib.deflateSync(ham, { level: 9 })), parca('IEND', Buffer.alloc(0))]);
}

/** PNG okuyucu (yalnız bu betiğin yazdığı biçim: 8 bit RGBA, taramasız; testler alfayı denetlemek için kullanır) → { en, boy, veri }. */
export function pngOku(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('PNG değil');
  let o = 8, en = 0, boy = 0, tur = 0;
  const idat = [];
  while (o < buf.length) {
    const n = buf.readUInt32BE(o), ad = buf.toString('latin1', o + 4, o + 8), g = buf.subarray(o + 8, o + 8 + n);
    if (ad === 'IHDR') { en = g.readUInt32BE(0); boy = g.readUInt32BE(4); tur = g[9]; if (g[8] !== 8 || g[12] !== 0) throw new Error('desteklenmeyen PNG'); }
    else if (ad === 'IDAT') idat.push(g);
    else if (ad === 'IEND') break;
    o += 12 + n;
  }
  const kanal = { 6: 4, 2: 3 }[tur];
  if (!kanal) throw new Error(`desteklenmeyen PNG renk türü ${tur}`);
  const ham = zlib.inflateSync(Buffer.concat(idat)), sat = en * kanal, veri = new Uint8Array(en * boy * 4), s = new Uint8Array(sat), once = new Uint8Array(sat);
  for (let y = 0; y < boy; y++) {
    const f = ham[y * (sat + 1)], r = ham.subarray(y * (sat + 1) + 1, (y + 1) * (sat + 1));
    for (let x = 0; x < sat; x++) {
      const a = x >= kanal ? s[x - kanal] : 0, b = once[x], c = x >= kanal ? once[x - kanal] : 0;
      let p = 0;
      if (f === 1) p = a; else if (f === 2) p = b; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      s[x] = (r[x] + p) & 255;
    }
    for (let x = 0; x < en; x++) { for (let k = 0; k < 3; k++) veri[(y * en + x) * 4 + k] = s[x * kanal + k]; veri[(y * en + x) * 4 + 3] = kanal === 4 ? s[x * 4 + 3] : 255; }
    once.set(s);
  }
  return { en, boy, veri };
}

/** Çok boylu ICO: 256 PNG, altı 32 bit BMP + AND maskesi (eski kabuk/derleyici araçlarıyla en uyumlu biçim; csc /win32icon dahil). */
export function ico(resimler) {
  const girdiler = [...resimler].sort((a, b) => a.en - b.en).map((r) => {
    const n = r.en;
    if (n >= 256) return [n, png(r)];
    const bgra = Buffer.alloc(n * n * 4), satir = Math.ceil(n / 32) * 4, and = Buffer.alloc(satir * n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const k = ((n - 1 - y) * n + x) * 4, o = (y * n + x) * 4;
        bgra[o] = r.veri[k + 2]; bgra[o + 1] = r.veri[k + 1]; bgra[o + 2] = r.veri[k]; bgra[o + 3] = r.veri[k + 3];
        if (r.veri[k + 3] === 0) and[y * satir + (x >> 3)] |= 0x80 >> (x & 7);
      }
    }
    const baslik = Buffer.alloc(40);
    baslik.writeUInt32LE(40, 0); baslik.writeInt32LE(n, 4); baslik.writeInt32LE(n * 2, 8); baslik.writeUInt16LE(1, 12); baslik.writeUInt16LE(32, 14);
    baslik.writeUInt32LE(bgra.length + and.length, 20);
    return [n, Buffer.concat([baslik, bgra, and])];
  });
  const dizin = Buffer.alloc(16 * girdiler.length), bas = Buffer.alloc(6);
  bas.writeUInt16LE(1, 2); bas.writeUInt16LE(girdiler.length, 4);
  let ofs = 6 + dizin.length;
  girdiler.forEach(([n, v], i) => {
    const o = i * 16;
    dizin[o] = n >= 256 ? 0 : n; dizin[o + 1] = n >= 256 ? 0 : n;
    dizin.writeUInt16LE(1, o + 4); dizin.writeUInt16LE(32, o + 6); dizin.writeUInt32LE(v.length, o + 8); dizin.writeUInt32LE(ofs, o + 12);
    ofs += v.length;
  });
  return Buffer.concat([bas, dizin, ...girdiler.map(([, v]) => v)]);
}

/** macOS .icns (PNG girdileri; 10.7+). `boylar`: { 16, 32, 64, 128, 256, 512, 1024 } → resim. */
export function icns(boylar) {
  const turler = [['icp4', 16], ['icp5', 32], ['icp6', 64], ['ic07', 128], ['ic08', 256], ['ic09', 512], ['ic10', 1024], ['ic11', 32], ['ic12', 64], ['ic13', 256], ['ic14', 512]];
  const govde = turler.map(([tur, n]) => { const v = png(boylar[n]); const b = Buffer.alloc(8); b.write(tur, 0, 'latin1'); b.writeUInt32BE(v.length + 8, 4); return Buffer.concat([b, v]); });
  const b = Buffer.alloc(8);
  b.write('icns', 0, 'latin1'); b.writeUInt32BE(8 + govde.reduce((t, x) => t + x.length, 0), 4);
  return Buffer.concat([b, ...govde]);
}

// ── Ana ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export const WIN_BOYLAR = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
export const TEPSI_BOYLAR = [16, 20, 24, 32, 40, 48];
export const TEPSI_KOYU = '#ffffff';
export const TEPSI_ACIK = '#1d1d1f';

function yaz(dosya, veri) { fs.mkdirSync(path.dirname(dosya), { recursive: true }); fs.writeFileSync(dosya, veri); }

// ── Telefon (Fuber AI telefon uygulaması, mobil/fuber-cep) — masaüstü ve telefon TEK ürün "Fuber AI" ───────────────────────────
export const CEP = path.join(KOK, 'mobil', 'fuber-cep');
/** Android yoğunlukları → ölçek (mdpi = 1). */
export const YOGUNLUK = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
/** Uyarlanır ikonun ön planında logo yüksekliği / 108 dp tuval: 41 dp — başlatıcının gösterdiği iç 72 dp'nin %57'si (masaüstü karosuyla
 *  aynı oran, LOGO_ORANI); köşegeni (×1,28 ≈ 53 dp) 66 dp güvenli dairenin rahatça içinde. */
export const UYARLANIR_LOGO = 41 / 108;
/** PWA "maskable" ve Play Store tam kare ikonlarında logo yüksekliği / kenar (maskable güvenli alanı: merkezde %80 çaplı daire). */
export const TAM_KARE_LOGO = 0.46;

/** Telefonun bütün ikon dosyaları: { göreli yol: () => PNG }. Göreli yollar mobil/fuber-cep'e göre. */
export function cepDosyalari() {
  const d = {};
  const res = 'android/app/src/main/res';
  for (const [ad, k] of Object.entries(YOGUNLUK)) {
    d[`${res}/mipmap-${ad}/ic_launcher.png`] = () => png(uygulamaIkonu(48 * k));                                   // Android 7 ve öncesi
    d[`${res}/mipmap-${ad}/ic_launcher_foreground.png`] = () => png(tamKareIkon(108 * k, { oran: UYARLANIR_LOGO, zeminVar: false }));
    d[`${res}/mipmap-${ad}/ic_launcher_background.png`] = () => png(tamKareIkon(108 * k, { logoVar: false }));
    d[`${res}/drawable-${ad}/ic_bildirim.png`] = () => png(bildirimSimgesi(24 * k));
  }
  d['assets/img/f-gumus.png'] = () => png(gumusIsaret(200));                                                       // kilit ekranı (lib/kilit.dart)
  d['assets/img/ikon.png'] = () => png(uygulamaIkonu(512));                                                         // uygulama ikonu 512 (köşeler şeffaf)
  d['assets/img/ikon-512.png'] = () => png(tamKareIkon(512, { oran: TAM_KARE_LOGO }));                              // Play Store yüksek çözünürlük (tam kare)
  d['web/icons/Icon-192.png'] = () => png(uygulamaIkonu(192));
  d['web/icons/Icon-512.png'] = () => png(uygulamaIkonu(512));
  d['web/icons/Icon-maskable-192.png'] = () => png(tamKareIkon(192, { oran: TAM_KARE_LOGO }));
  d['web/icons/Icon-maskable-512.png'] = () => png(tamKareIkon(512, { oran: TAM_KARE_LOGO }));
  d['web/favicon.png'] = () => png(uygulamaIkonu(16));
  return d;
}

function aileyiYaz() {
  const build = path.join(KOK, 'build'), ikon = path.join(KOK, 'resources', 'ikon');
  const uyg = WIN_BOYLAR.map((n) => uygulamaIkonu(n));
  const uygIco = ico(uyg);
  yaz(path.join(build, 'icon.ico'), uygIco);
  yaz(path.join(ikon, 'fuber.ico'), uygIco);
  yaz(path.join(build, 'kurulum.ico'), ico(WIN_BOYLAR.map((n) => kurulumIkonu(n))));
  yaz(path.join(ikon, 'fuber.png'), png(uygulamaIkonu(512)));
  const mac = Object.fromEntries([16, 32, 64, 128, 256, 512, 1024].map((n) => [n, uygulamaIkonu(n, { izgara: 'mac' })]));
  yaz(path.join(build, 'icon.icns'), icns(mac));
  yaz(path.join(build, 'icon.png'), png(mac[1024]));
  yaz(path.join(ikon, 'tepsi-koyu.ico'), ico(TEPSI_BOYLAR.map((n) => tepsiIkonu(n, TEPSI_KOYU))));
  yaz(path.join(ikon, 'tepsi-acik.ico'), ico(TEPSI_BOYLAR.map((n) => tepsiIkonu(n, TEPSI_ACIK))));
  yaz(path.join(ikon, 'tepsiTemplate.png'), png(tepsiIkonu(16, '#000000')));
  yaz(path.join(ikon, 'tepsiTemplate@2x.png'), png(tepsiIkonu(32, '#000000')));
  const cep = cepDosyalari();
  for (const [yol, uret] of Object.entries(cep)) yaz(path.join(CEP, ...yol.split('/')), uret());
  console.log(`ikon ailesi yazıldı (aday ${SECILEN} "${ADAYLAR[SECILEN].ad}"): build/icon.ico, build/kurulum.ico, build/icon.icns, build/icon.png, resources/ikon/{fuber.ico, fuber.png, tepsi-koyu.ico, tepsi-acik.ico, tepsiTemplate.png, tepsiTemplate@2x.png}; telefon: mobil/fuber-cep/ ${Object.keys(cep).length} dosya`);
}

function adaylariYaz(klasor) {
  for (const [harf, t] of Object.entries(ADAYLAR)) {
    for (const n of [...WIN_BOYLAR, 512]) yaz(path.join(klasor, `aday-${harf}-${n}.png`), png(uygulamaIkonu(n, { tasarim: t })));
    yaz(path.join(klasor, `aday-${harf}-mac-512.png`), png(uygulamaIkonu(512, { tasarim: t, izgara: 'mac' })));
  }
  console.log('adaylar yazıldı:', klasor);
}

/** Temas sayfası (tek PNG, yazısız): her satır koyu (#202020) ve açık (#f3f3f3) görev çubuğu şeridi — 1:1 ve küçük boylar ×6 (en yakın
 *  komşu). Satırlar: uygulama 16→256, kurulum 16→256, tepsi (beyaz koyu çubukta, mürekkep açıkta) 16→48, macOS 512 + Windows 512. */
export function temasSayfasi() {
  const W = 2280, KOYU = [32, 32, 32], ACIK = [243, 243, 243], ARKA = [14, 15, 18];
  const parcalar = [];
  let y = 24;
  const serit = (ims, zemin, x0, kat = 1) => {
    const h = Math.max(...ims.map((r) => r.boy * kat)) + 24;
    const w = ims.reduce((t, r) => t + r.en * kat + 20, 20);
    parcalar.push({ dikdortgen: [x0, y, w, h], renk: zemin });
    let x = x0 + 20;
    for (const r of ims) { parcalar.push({ resim: r, x, y: y + (h - r.boy * kat) / 2, kat }); x += r.en * kat + 20; }
    return { w, h };
  };
  const satir = (gruplar, kat) => { let x = 24, h = 0; for (const [ims, z] of gruplar) { const o = serit(ims, z, x, kat); x += o.w + 24; h = Math.max(h, o.h); } y += h + 14; };
  const uyg = WIN_BOYLAR.map((n) => uygulamaIkonu(n)), kur = WIN_BOYLAR.map((n) => kurulumIkonu(n));
  const tk = TEPSI_BOYLAR.map((n) => tepsiIkonu(n, TEPSI_KOYU)), ta = TEPSI_BOYLAR.map((n) => tepsiIkonu(n, TEPSI_ACIK));
  const kucuk = (l) => l.filter((r) => r.en <= 32);
  satir([[uyg, KOYU]], 1); satir([[uyg, ACIK]], 1);
  satir([[kucuk(uyg), KOYU], [kucuk(uyg), ACIK]], 6);
  y += 20;
  satir([[kur, KOYU]], 1); satir([[kucuk(kur), KOYU], [kucuk(kur), ACIK]], 6);
  y += 20;
  satir([[tk, KOYU], [ta, ACIK]], 1); satir([[kucuk(tk), KOYU], [kucuk(ta), ACIK]], 6);
  y += 20;
  satir([[[uygulamaIkonu(512, { izgara: 'mac' }), uygulamaIkonu(512)], [56, 64, 84]], [[uygulamaIkonu(512, { izgara: 'mac' })], [226, 232, 242]]], 1);
  const H = y + 10, b = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) { b.set(ARKA, i * 4); b[i * 4 + 3] = 255; }
  for (const p of parcalar) {
    if (p.dikdortgen) {
      const [x0, y0, w, h] = p.dikdortgen;
      for (let yy = y0; yy < y0 + h; yy++) for (let xx = x0; xx < x0 + w; xx++) b.set(p.renk, (yy * W + xx) * 4);
      continue;
    }
    const { resim: r, kat } = p, x0 = Math.round(p.x), y0 = Math.round(p.y);
    for (let yy = 0; yy < r.boy * kat; yy++) {
      for (let xx = 0; xx < r.en * kat; xx++) {
        const s = (((yy / kat) | 0) * r.en + ((xx / kat) | 0)) * 4, a = r.veri[s + 3] / 255, o = ((y0 + yy) * W + x0 + xx) * 4;
        for (let c = 0; c < 3; c++) b[o + c] = Math.round(r.veri[s + c] * a + b[o + c] * (1 - a));
      }
    }
  }
  return { en: W, boy: H, veri: b };
}

function temasYaz(klasor) {
  if (klasor.toLowerCase().endsWith('.png')) { yaz(klasor, png(temasSayfasi())); console.log('temas sayfası:', klasor); return; }
  for (const n of [...WIN_BOYLAR, 512]) yaz(path.join(klasor, `uygulama-${n}.png`), png(uygulamaIkonu(n)));
  for (const n of WIN_BOYLAR) yaz(path.join(klasor, `kurulum-${n}.png`), png(kurulumIkonu(n)));
  for (const n of TEPSI_BOYLAR) {
    yaz(path.join(klasor, `tepsi-koyu-${n}.png`), png(tepsiIkonu(n, TEPSI_KOYU)));
    yaz(path.join(klasor, `tepsi-acik-${n}.png`), png(tepsiIkonu(n, TEPSI_ACIK)));
  }
  yaz(path.join(klasor, 'mac-1024.png'), png(uygulamaIkonu(1024, { izgara: 'mac' })));
  console.log('temas PNGleri yazıldı:', klasor);
}

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  const [kip, hedef] = process.argv.slice(2);
  if (kip === '--adaylar') adaylariYaz(path.resolve(hedef ?? 'ikon-adaylari'));
  else if (kip === '--temas') temasYaz(path.resolve(hedef ?? 'ikon-temas'));
  else if (!kip) aileyiYaz();
  else { console.error('kullanım: node scripts/ikon-uret.mjs [--adaylar <klasör> | --temas <klasör>]'); process.exit(64); }
}
