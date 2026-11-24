// ── sayfa_oku yardımcıları: metni parçalara bölme ve özel adres kapısı (0.14 T14, Ruling R6; saf → birim testli: tests/web-araclari.test.ts) ──
// `sayfa_oku` uzun sayfayı 12.000 karakterlik parçalarla verir (`parca` parametresi); parça paragraf sınırında biter, paragraf tek başına
// sınırı aşarsa cümle ya da boşluk sınırında, o da yoksa sınırda kesilir. `ozelAdresMi` yalnız ADRESİN KENDİSİNE bakar (sunucu adı
// çözümlemesi main/sayfa-okuyucu.ts'te): `file:`, `localhost`, yerel ağ ve özel/ayrılmış aralıklar okunmaz — sayfa okuyucu bu bilgisayarın ve yerel
// ağın içine bakamasın (SSRF). Yönlendirmeyle özel adrese kaçış da aynı işlevle her adımda denetlenir.

/** Bir parçanın karakter sayısı (Ruling R6). */
export const SAYFA_PARCA_BOYU = 12_000;

/** Metni en çok `boy` karakterlik parçalara böler; önce paragraf (boş satır) sınırında. Boş metin → []. Hiçbir parça `boy`'u aşmaz. */
export function metniBol(metin: string, boy = SAYFA_PARCA_BOYU): string[] {
  const n = Math.max(1, Math.floor(boy));
  const tum = metin.replace(/\r\n?/g, '\n').trim();
  if (!tum) return [];
  const parcalar: string[] = [];
  let simdiki = '';
  const bitir = () => { if (simdiki) { parcalar.push(simdiki); simdiki = ''; } };
  for (const p of tum.split(/\n{2,}/)) {
    const par = p.trim();
    if (!par) continue;
    if (par.length > n) {
      // Tek başına sığmayan paragraf: önceki birikim biter, paragraf cümle/boşluk sınırında dilimlenir.
      bitir();
      let kalan = par;
      while (kalan.length > n) {
        let kes = Math.max(kalan.lastIndexOf('. ', n - 1), kalan.lastIndexOf('\n', n - 1));
        if (kes < n / 2) kes = kalan.lastIndexOf(' ', n - 1);
        const son = kes >= n / 2 ? kes + 1 : n;
        parcalar.push(kalan.slice(0, son).trimEnd());
        kalan = kalan.slice(son).trimStart();
      }
      simdiki = kalan;
      continue;
    }
    if (!simdiki) simdiki = par;
    else if (simdiki.length + 2 + par.length <= n) simdiki += `\n\n${par}`;
    else { bitir(); simdiki = par; }
  }
  bitir();
  return parcalar;
}

const ipv4 = (s: string): number[] | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s);
  if (!m) return null;
  const o = m.slice(1).map(Number);
  return o.every((x) => x >= 0 && x <= 255) ? o : null;
};

function ipv4Ozel([a, b, c]: number[]): boolean {
  return a === 0 || a === 10 || a === 127 || a >= 224 // 0/8 bu ağ, 10/8, loopback, çok noktaya yayın + ayrılmış
    || (a === 100 && b >= 64 && b <= 127) // 100.64/10 paylaşımlı (CGNAT)
    || (a === 169 && b === 254) // bağlantı-yerel (bulut metaveri dahil)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 192 && b === 0 && c === 0) // 192.0.0.0/24
    || (a === 198 && (b === 18 || b === 19)); // 198.18/15 ölçüm
}

/** IPv6 (köşeli parantezsiz) → 8 onaltılık grup; geçersizse null. Sondaki gömülü IPv4 (::ffff:1.2.3.4) iki gruba çevrilir. */
function ipv6Gruplar(s: string): number[] | null {
  let h = s.toLowerCase();
  const z = h.indexOf('%');
  if (z >= 0) h = h.slice(0, z);
  const son = h.lastIndexOf(':');
  const v4 = son >= 0 ? ipv4(h.slice(son + 1)) : null;
  if (v4) h = `${h.slice(0, son + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`;
  const cift = h.split('::');
  if (cift.length > 2) return null;
  const oku = (x: string) => (x ? x.split(':') : []);
  const bas = oku(cift[0]);
  const son2 = cift.length === 2 ? oku(cift[1]) : [];
  const eksik = 8 - bas.length - son2.length;
  if (cift.length === 1 ? bas.length !== 8 : eksik < 1) return null;
  const hepsi = cift.length === 1 ? bas : [...bas, ...Array(eksik).fill('0'), ...son2];
  const g = hepsi.map((x) => (/^[0-9a-f]{1,4}$/.test(x) ? parseInt(x, 16) : NaN));
  return g.some(Number.isNaN) ? null : g;
}

function ipv6Ozel(g: number[]): boolean {
  const gomulu = (hi: number, lo: number) => ipv4Ozel([hi >> 8, hi & 255, lo >> 8, lo & 255]);
  if (g.slice(0, 7).every((x) => x === 0) && g[7] <= 1) return true; // :: ve ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 benzersiz yerel
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 bağlantı-yerel
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 eski site-local
  if ((g[0] & 0xff00) === 0xff00) return true; // çok noktaya yayın
  if (g.slice(0, 4).every((x) => x === 0) && g[4] === 0xffff && g[5] === 0) return true; // ::ffff:0:0:0/96 IPv4-translated (RFC 2765) (SIIT): gömülü adres ne olursa olsun
  if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true; // 64:ff9b:1::/48 yerel kullanımlı NAT64
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return gomulu(g[6], g[7]); // ::ffff:a.b.c.d eşlenmiş
  if (g.slice(0, 6).every((x) => x === 0)) return gomulu(g[6], g[7]); // ::a.b.c.d uyumlu (eski)
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return gomulu(g[6], g[7]); // 64:ff9b::/96 NAT64
  if (g[0] === 0x2002) return gomulu(g[1], g[2]); // 6to4: gömülü IPv4
  return false;
}

/** Adres okunamayacak kadar yerel/özel mi? http(s) olmayan her şey (file:, ftp:, data:…), bozuk adres, `localhost` ve `*.localhost/.local/.internal/.lan`,
 *  noktasız sunucu adları (yerel ağ), özel/ayrılmış IPv4 ve IPv6 aralıkları ve bunların tarayıcı biçimleri (onluk/onaltılık/sekizlik IPv4 yazımı
 *  `new URL` ile normalize edilir) true döner. Genel adresler false. */
export function ozelAdresMi(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return true; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return true;
  let h = u.hostname.toLowerCase();
  if (h.startsWith('[') && h.endsWith(']')) {
    const g = ipv6Gruplar(h.slice(1, -1));
    return g === null ? true : ipv6Ozel(g);
  }
  while (h.endsWith('.')) h = h.slice(0, -1);
  if (!h) return true;
  const d = ipv4(h);
  if (d) return ipv4Ozel(d);
  if (!h.includes('.')) return true; // noktasız ad (localhost, router, nas…) yerel ağdır
  return /\.(localhost|local|internal|lan|home|intranet|corp|private|home\.arpa)$/.test(h);
}
