// ── Claude Code çalışma alanı: fark (diff) yardımcıları (Görev 28, K17) — saf; birim testli: tests/cc-arayuz.test.ts ──────────────
// Üç kaynak aynı satır modeline çevrilir (FarkGorunumu.tsx çizer: iki numara sütunu, +/− işareti, renkli satır):
//  • Edit/MultiEdit girdisi (old_string → new_string): satır farkı (Myers O(ND); ortak baş/son önce atılır). Dosyadaki gerçek satır
//    numarası araç sonucundaki `cat -n` parçasından bulunabiliyorsa numaralar oradan; bulunamazsa numara YOK (yanıltıcı göreli numara
//    yazılmaz).
//  • Write girdisi (content): bütün satırlar eklenen; yeni dosyada numaralar 1…n.
//  • `git diff` çıktısı (denetçi, claudecode:fark): birleşik fark ayrıştırılır; numaralar parça başlığından (@@ -a,b +c,d @@).
// Uzun farklar görünümde katlanır ("Tamamını göster"); burada yalnız veri.

export type FarkTuru = 'ayni' | 'ekle' | 'sil';
export interface FarkSatiri { tur: FarkTuru; metin: string; eski?: number; yeni?: number }
/** Birleşik farkın bir parçası (hunk). */
export interface FarkParcasi { baslik?: string; satirlar: FarkSatiri[] }
export interface FarkDosyasi {
  yol: string; eskiYol?: string; yeni: boolean; silindi: boolean; ikili: boolean;
  parcalar: FarkParcasi[]; eklenen: number; silinen: number;
}

/** Metni satırlara böler (CRLF → LF; sondaki tek boş satır sayılmaz). Boş metin → []. */
export function satirlaraBol(s: string): string[] {
  if (!s) return [];
  const l = s.replace(/\r\n?/g, '\n').split('\n');
  if (l.length && l[l.length - 1] === '') l.pop();
  return l;
}

type Islem = '=' | '-' | '+';

/**
 * Myers O(ND) satır farkı: `a` → `b` için işlem dizisi. `sinir` adımı aşan (çok farklı) girdilerde null döner (çağıran "hepsi silindi,
 * hepsi eklendi"ye düşer): bellek ~sinir² ile sınırlı kalır.
 */
export function myers(a: readonly string[], b: readonly string[], sinir = 1200): Islem[] | null {
  const n = a.length, m = b.length;
  if (!n) return Array<Islem>(m).fill('+');
  if (!m) return Array<Islem>(n).fill('-');
  const max = n + m;
  const ofs = max + 1;
  const v = new Int32Array(2 * max + 3);
  const iz: Int32Array[] = [];
  const ust = Math.min(max, sinir);
  for (let d = 0; d <= ust; d++) {
    // Adımın başındaki v (yalnız k ∈ [-d-1, d+1] gerekir): geri izleme için saklanır.
    iz.push(v.slice(ofs - d - 1, ofs + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[ofs + k - 1] < v[ofs + k + 1]) ? v[ofs + k + 1] : v[ofs + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) { x++; y++; }
      v[ofs + k] = x;
      if (x >= n && y >= m) return geriIzle(iz, n, m);
    }
  }
  return null;
}

function geriIzle(iz: Int32Array[], n: number, m: number): Islem[] {
  const out: Islem[] = [];
  let x = n, y = m;
  for (let d = iz.length - 1; d >= 0; d--) {
    const v = iz[d];
    const o = d + 1; // dilimin kaydırması: v[o + k] = k köşegeni
    const k = x - y;
    const oncekiK = k === -d || (k !== d && v[o + k - 1] < v[o + k + 1]) ? k + 1 : k - 1;
    const oncekiX = v[o + oncekiK];
    const oncekiY = oncekiX - oncekiK;
    while (x > oncekiX && y > oncekiY) { out.push('='); x--; y--; }
    if (d > 0) out.push(x === oncekiX ? '+' : '-');
    x = oncekiX; y = oncekiY;
  }
  return out.reverse();
}

/**
 * İki metnin satır farkı. `eskiBas`/`yeniBas` verilirse satırlar o numaralardan sayılır (dosyadaki gerçek yer); verilmezse numara yok.
 */
export function satirFarki(eski: string, yeni: string, o: { eskiBas?: number; yeniBas?: number; sinir?: number } = {}): FarkSatiri[] {
  const a = satirlaraBol(eski), b = satirlaraBol(yeni);
  let bas = 0;
  while (bas < a.length && bas < b.length && a[bas] === b[bas]) bas++;
  let son = 0;
  while (son < a.length - bas && son < b.length - bas && a[a.length - 1 - son] === b[b.length - 1 - son]) son++;
  const ortaA = a.slice(bas, a.length - son), ortaB = b.slice(bas, b.length - son);
  const orta = myers(ortaA, ortaB, o.sinir) ?? [...Array<Islem>(ortaA.length).fill('-'), ...Array<Islem>(ortaB.length).fill('+')];
  const numarali = o.eskiBas !== undefined || o.yeniBas !== undefined;
  let en = o.eskiBas ?? o.yeniBas ?? 1, yn = o.yeniBas ?? o.eskiBas ?? 1;
  const out: FarkSatiri[] = [];
  const ekle = (tur: FarkTuru, metin: string) => {
    const s: FarkSatiri = { tur, metin };
    if (numarali) { if (tur !== 'ekle') s.eski = en; if (tur !== 'sil') s.yeni = yn; }
    if (tur !== 'ekle') en++;
    if (tur !== 'sil') yn++;
    out.push(s);
  };
  for (let i = 0; i < bas; i++) ekle('ayni', a[i]);
  let i = bas, j = bas;
  for (const op of orta) {
    if (op === '=') { ekle('ayni', ortaA[i - bas]); i++; j++; }
    else if (op === '-') { ekle('sil', ortaA[i - bas]); i++; }
    else { ekle('ekle', ortaB[j - bas]); j++; }
  }
  for (let k = a.length - son; k < a.length; k++) ekle('ayni', a[k]);
  return out;
}

/** Değişmeyen uzun bölümler katlanır: her değişikliğin çevresinde `baglam` satır kalır (CLAUDE.md kaydetme önizlemesi). */
export function parcalaraBol(satirlar: readonly FarkSatiri[], baglam = 3): FarkParcasi[] {
  const degisen = satirlar.map((s, i) => (s.tur === 'ayni' ? -1 : i)).filter((i) => i >= 0);
  if (!degisen.length) return [];
  const parcalar: FarkParcasi[] = [];
  let bas = Math.max(0, degisen[0] - baglam);
  let son = Math.min(satirlar.length, degisen[0] + baglam + 1);
  for (const i of degisen.slice(1)) {
    if (i - baglam <= son) { son = Math.min(satirlar.length, i + baglam + 1); continue; }
    parcalar.push({ satirlar: satirlar.slice(bas, son) });
    bas = Math.max(0, i - baglam);
    son = Math.min(satirlar.length, i + baglam + 1);
  }
  parcalar.push({ satirlar: satirlar.slice(bas, son) });
  return parcalar;
}

export const farkSayilari = (satirlar: readonly FarkSatiri[]) => ({
  eklenen: satirlar.filter((s) => s.tur === 'ekle').length,
  silinen: satirlar.filter((s) => s.tur === 'sil').length,
});

/** Write içeriği: hepsi eklenen satırlar (1…n). */
export function icerikFarki(icerik: string): FarkSatiri[] {
  return satirlaraBol(icerik).map((metin, i) => ({ tur: 'ekle', metin, yeni: i + 1 }));
}

/** `cat -n` biçimli satırlar ("    12→metin" ya da "    12\tmetin") → numara + metin. Biçime uymayan satır atlanır. */
export function numaraliSatirlar(cikti: string): { no: number; metin: string }[] {
  const out: { no: number; metin: string }[] = [];
  for (const s of cikti.replace(/\r\n?/g, '\n').split('\n')) {
    const m = /^\s*(\d+)(?:→|\t)(.*)$/.exec(s);
    if (m) out.push({ no: Number(m[1]), metin: m[2] });
  }
  return out;
}

/**
 * Edit sonucunun `cat -n` parçasından yeni metnin dosyadaki ilk satır numarası (bulunamazsa null). Yeni metnin ilk boş olmayan satırı
 * parçada TEK kez geçmeli (birden çok eşleşmede yanlış numara yazılmaz).
 */
export function duzenlemeBaslangici(cikti: string | undefined, yeniMetin: string): number | null {
  if (!cikti) return null;
  const parca = numaraliSatirlar(cikti);
  if (!parca.length) return null;
  const satirlar = satirlaraBol(yeniMetin);
  const i = satirlar.findIndex((s) => s.trim());
  if (i < 0) return null;
  const aranan = satirlar[i].trimEnd();
  const es = parca.filter((p) => p.metin.trimEnd() === aranan);
  if (es.length !== 1) return null;
  const bas = es[0].no - i;
  return bas >= 1 ? bas : null;
}

/** Edit/MultiEdit/Write girdisinden fark satırları (kart ve izin önizlemesi). Tanınmayan girdi → null. */
export function aracFarki(ad: string, girdi: Record<string, unknown>, cikti?: string): { satirlar: FarkSatiri[]; yeniDosya: boolean } | null {
  const metin = (k: string) => (typeof girdi[k] === 'string' ? (girdi[k] as string) : null);
  if (ad === 'Write') {
    const c = metin('content');
    return c === null ? null : { satirlar: icerikFarki(c), yeniDosya: true };
  }
  if (ad === 'Edit') {
    const e = metin('old_string'), y = metin('new_string');
    if (e === null || y === null) return null;
    const bas = duzenlemeBaslangici(cikti, y);
    return { satirlar: satirFarki(e, y, bas ? { eskiBas: bas, yeniBas: bas } : {}), yeniDosya: false };
  }
  if (ad === 'MultiEdit' && Array.isArray(girdi.edits)) {
    const satirlar: FarkSatiri[] = [];
    for (const d of girdi.edits.slice(0, 50)) {
      if (!d || typeof d !== 'object') continue;
      const e = (d as Record<string, unknown>).old_string, y = (d as Record<string, unknown>).new_string;
      if (typeof e !== 'string' || typeof y !== 'string') continue;
      if (satirlar.length) satirlar.push({ tur: 'ayni', metin: '⋯' });
      satirlar.push(...satirFarki(e, y));
    }
    return satirlar.length ? { satirlar, yeniDosya: false } : null;
  }
  return null;
}

/** `git diff` (birleşik fark) → dosyalar. Başlıksız ekleme listesi (izlenmeyen dosyanın yedeği: "--- /dev/null / +++ b/x / +…") de okunur. */
export function birlesikFarkCoz(metin: string): FarkDosyasi[] {
  const dosyalar: FarkDosyasi[] = [];
  let d: FarkDosyasi | null = null;
  let p: FarkParcasi | null = null;
  let en = 0, yn = 0;
  // Parçanın kalan satırları (başlıktaki sayılar): bitince parça kapanır, sonraki "--- " satırı yeni dosyanın başlığıdır.
  let eKalan = Infinity, yKalan = Infinity;
  const yeniDosya = (yol = ''): FarkDosyasi => {
    const x: FarkDosyasi = { yol, yeni: false, silindi: false, ikili: false, parcalar: [], eklenen: 0, silinen: 0 };
    dosyalar.push(x);
    p = null;
    return x;
  };
  const yolTemiz = (s: string) => s.replace(/\t.*$/, '').replace(/^"(.*)"$/, '$1').replace(/^[ab]\//, '');
  for (const satir of metin.replace(/\r\n?/g, '\n').split('\n')) {
    if (satir.startsWith('diff --git ')) {
      d = yeniDosya();
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(satir);
      if (m) { d.yol = m[2]; if (m[1] !== m[2]) d.eskiYol = m[1]; }
      continue;
    }
    if (satir.startsWith('--- ') && (!p || !d)) {
      if (!d || d.parcalar.length) d = yeniDosya();
      const y = satir.slice(4);
      if (y === '/dev/null') d.yeni = true; else if (!d.yol) d.yol = yolTemiz(y);
      continue;
    }
    if (satir.startsWith('+++ ') && d && !p) {
      const y = satir.slice(4);
      if (y === '/dev/null') d.silindi = true; else d.yol = yolTemiz(y);
      continue;
    }
    if (!d) continue;
    if (satir.startsWith('new file mode')) { d.yeni = true; continue; }
    if (satir.startsWith('deleted file mode')) { d.silindi = true; continue; }
    if (satir.startsWith('rename from ')) { d.eskiYol = satir.slice(12); continue; }
    if (satir.startsWith('Binary files ') || satir.startsWith('GIT binary patch')) { d.ikili = true; continue; }
    const h = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/.exec(satir);
    if (h) {
      en = Number(h[1]); yn = Number(h[3]);
      eKalan = h[2] === undefined ? 1 : Number(h[2]);
      yKalan = h[4] === undefined ? 1 : Number(h[4]);
      p = { ...(h[5] ? { baslik: h[5] } : {}), satirlar: [] };
      d.parcalar.push(p);
      continue;
    }
    if (satir.startsWith('\\')) continue; // "\ No newline at end of file"
    const ilk = satir[0];
    if (!p) {
      // Başlıksız ekleme listesi (gitFark yedeği): ilk '+' satırı 1'den başlayan parça açar.
      if (ilk !== '+') continue;
      en = 0; yn = 1; eKalan = Infinity; yKalan = Infinity;
      p = { satirlar: [] };
      d.parcalar.push(p);
    }
    if (ilk === '+') { p.satirlar.push({ tur: 'ekle', metin: satir.slice(1), yeni: yn++ }); d.eklenen++; yKalan--; }
    else if (ilk === '-') { p.satirlar.push({ tur: 'sil', metin: satir.slice(1), eski: en++ }); d.silinen++; eKalan--; }
    else if (ilk === ' ') { p.satirlar.push({ tur: 'ayni', metin: satir.slice(1), eski: en++, yeni: yn++ }); eKalan--; yKalan--; }
    else continue;
    if (eKalan <= 0 && yKalan <= 0) p = null;
  }
  return dosyalar.filter((x) => x.yol || x.parcalar.length);
}

/** Uzun listenin görünen başı: `n` öğeden fazlası katlanır (gizli sayısıyla). */
export function katla<T>(l: readonly T[], n: number, acik: boolean): { gorunen: readonly T[]; gizli: number } {
  if (acik || l.length <= n) return { gorunen: l, gizli: 0 };
  return { gorunen: l.slice(0, n), gizli: l.length - n };
}
