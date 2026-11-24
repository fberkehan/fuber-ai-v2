// ── Cümle bölücü (Görev 21, K9): model yanıtı akarken konuşulacak parçaları çıkarır (saf; birim testli: tests/cumle-bolucu.test.ts) ──
// Fuber'in sesi yanıtın TAMAMINI beklemez: model yazdıkça tamamlanan her cümle hemen seslendirilir. Türkçe kuralları:
//  - Cümle sonu: . ! ? … (ve ?!, ...) ardından boşluk/satır sonu; kapanan tırnak ve parantez cümleye dahil.
//  - Cümle sonu DEĞİL: kısaltmalar (Dr., Prof., vb., vs., örn., No., Ltd., A.Ş., T.C. …), baş harfler ("M. Kemal"), sayılar
//    ("3.5", "1.000", "12.30", "25.10.2026" — noktadan sonra boşluk yok), sıra sayıları ("3. kez", "25. yıl": noktadan sonra küçük
//    harf), alan adları ("fuber.ai"), devam eden üç nokta ("Hmm… bakalım").
//  - Satır sonu her zaman bir sınırdır (liste maddeleri, başlıklar tek tek okunur); kod blokları okunmaz.
//  - Karar için noktadan sonraki ilk görünür harf gerekir: tampon tam noktada ya da boşlukta biterse sonraki parça beklenir (akışta
//    bir belirteç, ~20–50 ms).
//  - İlk parça erken: konuşmanın ilk parçası virgül/iki nokta/noktalı virgülde de kesilebilir (en az `ilkEnAz` harf) — ilk ses gecikmesi
//    kısalır. Uzun cümle `enUzun` harfi aşarsa son yumuşak sınırda (, ; : –) ya da son boşlukta bölünür.
//  - `zorla()`: oturum ilk sesi geciktiren uzun ilk cümleyi süre dolunca yumuşak sınırdan ya da sözcük sınırından keser.

/** Ardından hep bir ad (ya da gönderme) gelen kısaltmalar: nokta asla cümle sonu değildir ("Dr. Ahmet", "Prof. Ayşe", "ABC Ltd. Şti.",
 *  "Bkz. Ek 2"). "gör" yalnız "Öğr. Gör." içinde unvandır ("Kendin gör." cümle sonu; noktaDegil). */
const UNVANLAR = new Set([
  'dr', 'prof', 'doç', 'doc', 'yrd', 'av', 'sn', 'sy', 'alb', 'gen', 'org', 'müh', 'muh', 'uzm', 'öğr', 'ogr', 'yard',
  'st', 'mr', 'mrs', 'ms', 'hz', 'dt', 'op', 'ecz', 'maj', 'bşk', 'bsk', 'ltd', 'şti', 'sti', 'inc', 'co', 'tic', 'san',
  'bkz', 'krş', 'krs',
]);
/** Cümle sonunda da sık görülen kısaltmalar ("…kalem, defter vb. Sonra"): ardından küçük harf ya da rakam gelirse sınır değil. */
const KISALTMALAR = new Set([
  'vb', 'vs', 'vd', 'örn', 'orn', 'ör', 'no', 'nr', 'tel', 'cad', 'sok', 'mah', 'apt', 'blv', 'bul',
  'km', 'kg', 'gr', 'cm', 'mm', 'dk', 'sa', 'yy', 'sf', 's', 'vol', 'fig', 'ca', 'etc', 'yb',
]);
/** Noktadan hemen önce gelen alan adı/uzantı sonları ("fuber.org.", "site.co."): unvan sayılmaz, cümle sonu olabilir. */
const ALAN_SONLARI = new Set(['org', 'co', 'com', 'net', 'io', 'ai', 'tr', 'edu', 'gov', 'dev', 'app', 'ltd', 'inc']);
const KUCUK = /\p{Ll}/u;
const HARF_RAKAM = /[\p{L}\p{N}]/u;
const KAPANIS = /["”’'»)\]]/;
const SON_ISARET = /[.!?…]/;

/** Konuşulacak metin: markdown, atıflar ([H-12]), bağlantı adresleri, kod blokları ve emoji düşer; satırlar korunur. */
export function seslendirmeMetni(m: string): string {
  return m
    .replace(/```[\s\S]*?(```|$)/g, ' ')                       // kod blokları okunmaz
    .replace(/\[(H|M|D|N|G|R)-\d+[^\]]*\]/g, '')               // hafıza/rapor atıfları
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')                      // görsel
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, '$1')               // [ad](adres) → ad
    .replace(/<?https?:\/\/[^\s>)]+>?/g, '')                   // çıplak adres
    .replace(/`([^`]*)`/g, '$1')                               // satır içi kod: içeriği okunur
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+[.)])\s+/gm, '')      // başlık, alıntı, liste işaretleri
    .replace(/\|/g, ' ')                                       // tablo çizgileri
    .replace(/(?<=[\p{L}\p{N}])_+(?=[\p{L}\p{N}])/gu, ' ')     // tanımlayıcıdaki alt çizgi: "dosya_adi" → "dosya adi"
    .replace(/(\*\*|__|~~|\*|_)(?=\S)([^\n]*?\S)\1/g, '$2')    // vurgu
    .replace(/[*_~#`]/g, '')
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .trim();
}

export interface BolucuAyari {
  /** İlk parça bu kadar harfi geçince virgül/iki nokta/noktalı virgülde de kesilir. */
  ilkEnAz: number;
  /** Bundan uzun cümle yumuşak sınırda (ya da son boşlukta) bölünür. */
  enUzun: number;
}
const VARSAYILAN: BolucuAyari = { ilkEnAz: 24, enUzun: 220 };

/**
 * Akış bölücüsü: `ekle(parca)` tamamlanmış parçaları döndürür, `bitir()` kalanı. Döndürülen parçalar konuşulacak metindir
 * (seslendirmeMetni'nden geçmiş, boş olanlar atlanmış). Kod bloğu kapanmadan içinden parça çıkmaz.
 */
export class CumleBolucu {
  private tampon = '';
  private verilen = 0;
  private readonly a: BolucuAyari;
  constructor(a: Partial<BolucuAyari> = {}) { this.a = { ...VARSAYILAN, ...a }; }

  /** Henüz konuşulmamış (tamamlanmamış) metin var mı. */
  get bekleyen(): string { return this.tampon; }

  ekle(parca: string): string[] {
    this.tampon += parca;
    return this.cikar(false);
  }

  bitir(): string[] {
    const out = this.cikar(true);
    const kalan = this.tampon;
    this.tampon = '';
    return [...out, ...this.ver(kalan)];
  }

  /** Süre doldu: tampondaki ilk parçayı zorla keser. Tampon TAMAMLANMIŞ bir cümleyle bitiyorsa (yalnız ardından ne geleceği belli
   *  değildi — ör. araçtan önceki "Tamam, takvimine bakıyorum.") cümle bütün olarak verilir (düzeltme 4); değilse yumuşak sınırda, yoksa
   *  son sözcük sınırında. Kesilecek yer yoksa []. */
  zorla(enAz = 12): string[] {
    const t = this.kodsuzSinir();
    const metin = this.tampon.slice(0, t);
    if (seslendirmeMetni(metin).length < enAz) return [];
    const tam = this.tamCumleSonu(metin);
    if (tam >= 0) {
      const parca = this.tampon.slice(0, tam + 1);
      this.tampon = this.tampon.slice(tam + 1);
      return this.ver(parca);
    }
    let i = yumusakSinir(metin, enAz);
    if (i < 0) { const b = metin.lastIndexOf(' '); i = b >= enAz ? b : -1; }
    if (i < 0) return [];
    const parca = this.tampon.slice(0, i + 1);
    this.tampon = this.tampon.slice(i + 1);
    return this.ver(parca);
  }

  /** Metin (sondaki boşluklar hariç) cümle sonu işaretiyle bitiyor ve bu bir kısaltma/unvan/baş harf değilse işaretin (kapanış dahil)
   *  son dizini; değilse -1. Karar için sonraki harf büyük varsayılır (yeni cümle). */
  private tamCumleSonu(metin: string): number {
    const m = /[.!?…]+["”’'»)\]]*\s*$/.exec(metin);
    if (!m) return -1;
    const i = m.index;
    const j = i + m[0].trimEnd().length - 1;
    if (/^\.["”’'»)\]]*$/.test(metin.slice(i, j + 1)) && this.noktaDegil(metin, i, 'A')) return -1;
    return j;
  }

  /** Açık (kapanmamış) kod bloğunun başı; yoksa tamponun sonu. */
  private kodsuzSinir(): number {
    const cit = [...this.tampon.matchAll(/```/g)];
    return cit.length % 2 === 1 ? cit[cit.length - 1].index! : this.tampon.length;
  }

  private ver(ham: string): string[] {
    const m = seslendirmeMetni(ham);
    if (!m || !HARF_RAKAM.test(m)) return [];
    this.verilen++;
    return [m];
  }

  private cikar(son: boolean): string[] {
    const out: string[] = [];
    for (;;) {
      const sinir = this.kodsuzSinir();
      const i = this.sinirBul(this.tampon.slice(0, sinir), son && sinir === this.tampon.length);
      if (i < 0) break;
      const parca = this.tampon.slice(0, i + 1);
      this.tampon = this.tampon.slice(i + 1);
      out.push(...this.ver(parca));
    }
    return out;
  }

  /** Metindeki ilk sınırın (dahil) dizini; yoksa -1. `son`: metnin sonu kesin (akış bitti). */
  private sinirBul(t: string, son: boolean): number {
    const ilk = this.verilen === 0;
    let kodda = false; // kapalı kod bloğunun içi (kodsuzSinir açık bloğu zaten dışarıda bırakır): içinde sınır aranmaz
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (t.startsWith('```', i)) { kodda = !kodda; i += 2; continue; }
      if (kodda) continue;
      if (c === '\n') {
        if (seslendirmeMetni(t.slice(0, i)).length) return i;
        continue;
      }
      if (SON_ISARET.test(c)) {
        let j = i;
        while (j + 1 < t.length && (SON_ISARET.test(t[j + 1]) || KAPANIS.test(t[j + 1]))) j++;
        if (j + 1 >= t.length) { if (son) return j; return -1; } // ardından ne geldiği belli değil
        const sonraki = t[j + 1];
        if (!/\s/.test(sonraki)) { i = j; continue; } // "fuber.ai", "3.5", "a.m." — boşluksuz nokta sınır değil
        const k = gorunurBas(t, j + 1);
        // Noktadan sonra satır sonu (paragraf, liste, araç adımı — düzeltme 4): kısaltma olsa da kesin sınır; sonraki harf beklenmez.
        if (t.slice(j + 1, k < 0 ? t.length : k).includes('\n')) return j;
        if (k < 0) { if (son) return j; return -1; } // boşlukta bitiyor: sonraki harf bekleniyor
        const isaret = t.slice(i, j + 1);
        if (/^\.["”’'»)\]]*$/.test(isaret) && this.noktaDegil(t, i, t[k])) { i = j; continue; }
        if ((isaret.startsWith('…') || isaret.startsWith('...')) && KUCUK.test(t[k])) { i = j; continue; } // devam eden üç nokta
        return j;
      }
      if (ilk && (c === ',' || c === ';' || c === ':') && i + 1 < t.length && /\s/.test(t[i + 1])) {
        if (seslendirmeMetni(t.slice(0, i)).length >= this.a.ilkEnAz) return i;
      }
    }
    // Uzun cümle: yumuşak sınırda ya da son boşlukta böl.
    if (seslendirmeMetni(t).length > this.a.enUzun) {
      const y = yumusakSinir(t, 60);
      if (y >= 0) return y;
      const b = t.lastIndexOf(' ');
      if (b > 0) return b;
    }
    return -1;
  }

  /** `i`'deki nokta cümle sonu DEĞİL mi (kısaltma, baş harf, sıra sayısı)? `sonraki`: noktadan sonraki ilk görünür harf. */
  private noktaDegil(t: string, i: number, sonraki: string): boolean {
    const once = t.slice(0, i);
    const kelime = (once.match(/[\p{L}\p{N}]+$/u) ?? [''])[0];
    if (!kelime) return false;
    const kucukMu = KUCUK.test(sonraki) || /\p{N}/u.test(sonraki);
    if (/^\p{N}+$/u.test(kelime)) {
      if (/(?:^|\n)[ \t]*\p{N}+$/u.test(once)) return true; // satır başındaki "1. Madde": liste işareti
      return KUCUK.test(sonraki); // "3. kez" sıra sayısı; "2025. Sonra" cümle sonu
    }
    const k = kelime.toLocaleLowerCase('tr');
    const onceki = once.slice(0, once.length - kelime.length);
    // "fuber.org." / "site.co.": alan adının sonu unvan değildir.
    if (onceki.endsWith('.') && kelime.length > 1 && ALAN_SONLARI.has(k)) return false;
    if (UNVANLAR.has(k)) return true;
    // "Öğr. Gör. Ayşe" unvandır; "Kendin gör." cümle sonu.
    if (k === 'gör' || k === 'gor') return /(?:^|[\s(])(?:öğr|ogr)\.\s*$/iu.test(onceki);
    if (KISALTMALAR.has(k)) return kucukMu;
    // Tek büyük harf yalnız tek başınaysa baş harftir ("M. Kemal", "A.Ş.", "T.C."); "18°C." ya da "3B." birimin/ölçünün sonudur.
    if (kelime.length === 1 && /\p{Lu}/u.test(kelime)) return onceki === '' || /[\s.(“"'‘-]$/u.test(onceki);
    if (kelime.length === 1 && /\p{L}\.$/u.test(once.slice(0, -1))) return kucukMu; // "a.m.", "p.m."
    return false;
  }
}

/** Metinde `enAz` harften sonraki son yumuşak sınır (, ; : – —) dizini; yoksa -1. */
function yumusakSinir(t: string, enAz: number): number {
  for (let i = t.length - 2; i >= enAz; i--) {
    const c = t[i];
    if ((c === ',' || c === ';' || c === ':') && /\s/.test(t[i + 1])) return i;
    if ((c === '–' || c === '—') && t[i - 1] === ' ' && t[i + 1] === ' ') return i;
  }
  return -1;
}

/** `bas`tan sonraki ilk boşluk olmayan karakterin dizini; yoksa -1. */
function gorunurBas(t: string, bas: number): number {
  for (let k = bas; k < t.length; k++) if (!/\s/.test(t[k])) return k;
  return -1;
}
