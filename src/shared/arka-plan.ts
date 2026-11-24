// Arka plan test kipi kararı (saf; birim testli: tests/arka-plan.test.ts; uygulaması main/arka-plan-test.ts).
// 28 Eki: testler koşarken arayüz öne gelmemeli; testler arka planda koşar. YALNIZ FUBER_DEMO (önizleme/test koşusu) ve FUBER_GORUNUR '1'
// değilken; üretimde (FUBER_DEMO yok) asla.
export function arkaPlanKipi(env: Record<string, string | undefined>): boolean {
  return Boolean(env.FUBER_DEMO) && env.FUBER_GORUNUR !== '1';
}

// ── Mantıksal genel kısayol defteri (0.11 G12a) ─────────────────────────────────────────────────────────────────────────────────
// Önizleme örnekleri (FUBER_DEMO, arka plan kipi) `globalShortcut.register` ile acil durdurma (Alt+Shift+Q) ve asistan kısayolunu İŞLETİM
// SİSTEMİ GENELİNDE kaydediyordu: kullanıcı bilgisayar başında çalışırken bu tuşlar görünmez önizleme örneğine gidebilir (asistan kısayolu
// mikrofonu açabilir, Alt+Shift+Q işi durdurur). Arka plan kipinde `globalShortcut`ın dört işlevi bu defterle değiştirilir (main/arka-plan-test.ts):
// işletim sistemine HİÇBİR kısayol kaydedilmez, kayıtlar bellekte tutulur. Sonuçlar uygulamanın kendi mantığına GERÇEK Electron gibi döner:
// geçerli ve boştaki tuş → true; zaten kayıtlı (bu uygulamada) ya da başka uygulamada → false (sessizce); geçersiz hızlandırıcı → TypeError
// (main.ts bunu yakalar). Böylece "kısayol alındı / alınamadı" denetimleri anlamlı kalır; "başka uygulamada" durumu bir test kancasıyla
// taklit edilir: `FUBER_TEST_KISAYOL_BASKA=Alt+Shift+Q;Ctrl+Shift+F9` (başlangıçta) ya da çalışırken `defter.baskaUygulamada('Alt+Shift+Q')`
// (ana süreçte `globalShortcut.mantiksal`). Gerçek tuş basışı yerine `defter.tetikle(tus)` kayıtlı geri çağrıyı çalıştırır.
// FUBER_GORUNUR=1 (görünür koşu) ya da üretim: defter hiç kurulmaz, gerçek kayıt sürer.

/** Değiştirici adı → kanonik ad (macOS dışında CommandOrControl = Control; Command/Super/Meta = Windows tuşu). */
function degistirici(ad: string, mac: boolean): string | null {
  switch (ad.toLowerCase()) {
    case 'commandorcontrol': case 'cmdorctrl': return mac ? 'meta' : 'control';
    case 'command': case 'cmd': case 'super': case 'meta': return 'meta';
    case 'control': case 'ctrl': return 'control';
    case 'alt': case 'option': return 'alt';
    case 'altgr': return 'altgr';
    case 'shift': return 'shift';
    default: return null;
  }
}
const ADLI_TUSLAR = new Set([
  'space', 'tab', 'capslock', 'numlock', 'scrolllock', 'backspace', 'delete', 'insert', 'return', 'enter', 'up', 'down', 'left', 'right', 'home', 'end',
  'pageup', 'pagedown', 'escape', 'esc', 'plus', 'volumeup', 'volumedown', 'volumemute', 'medianexttrack', 'mediaprevioustrack', 'mediastop',
  'mediaplaypause', 'printscreen', 'numdec', 'numadd', 'numsub', 'nummult', 'numdiv',
]);
function tusAdi(ad: string): string | null {
  const k = ad.toLowerCase();
  if (/^[\x21-\x7e]$/.test(ad) && ad !== '+') return k; // tek yazdırılabilir ASCII karakter (artı için 'Plus')
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(k) || /^num[0-9]$/.test(k) || ADLI_TUSLAR.has(k)) return k === 'esc' ? 'escape' : k === 'enter' ? 'return' : k;
  return null;
}

/**
 * Electron hızlandırıcısını kanonik biçime çevirir ("CommandOrControl+Shift+Space" ile "Shift+Ctrl+Space" aynı tuş sayılır). Gerçek Electron
 * gibi geçersizde (boş, bilinmeyen tuş, birden çok tuş) `TypeError` fırlatır.
 */
export function kisayolKanonik(hizlandirici: string, platform: string = typeof process !== 'undefined' ? process.platform : 'win32'): string {
  if (typeof hizlandirici !== 'string' || !hizlandirici.trim()) throw new TypeError(`Hızlandırıcı geçersiz: ${String(hizlandirici)}`);
  const mac = platform === 'darwin';
  const degistiriciler = new Set<string>();
  let tus: string | null = null;
  for (const parca of hizlandirici.split('+').map((p) => p.trim())) {
    const d = parca ? degistirici(parca, mac) : null;
    if (d) { degistiriciler.add(d); continue; }
    const t = parca ? tusAdi(parca) : null;
    if (!t || tus !== null) throw new TypeError(`Hızlandırıcı geçersiz: ${hizlandirici}`);
    tus = t;
  }
  if (tus === null) throw new TypeError(`Hızlandırıcı geçersiz: ${hizlandirici} (tuş yok)`);
  return [...[...degistiriciler].sort(), tus].join('+');
}

/** `FUBER_TEST_KISAYOL_BASKA` (noktalı virgülle ayrılmış hızlandırıcılar): "başka uygulamada" tutulan tuşlar (geçersizler atlanır). */
export function kisayolBaskaListesi(env: Record<string, string | undefined>): string[] {
  return (env.FUBER_TEST_KISAYOL_BASKA ?? '').split(';').map((s) => s.trim()).filter(Boolean);
}

export interface KisayolDefteri {
  /** Gerçek `globalShortcut.register` gibi: true = alındı; false = bu uygulamada zaten kayıtlı ya da başka uygulamada; geçersizse TypeError. */
  register(hizlandirici: string, geriCagri: () => void): boolean;
  /** Kayıtsız tuşu bırakmak sessiz geçer (gerçek Electron gibi). Geçersizse TypeError. */
  unregister(hizlandirici: string): void;
  isRegistered(hizlandirici: string): boolean;
  unregisterAll(): void;
  /** Test kancası: `tutuluyor` (varsayılan true) iken tuş "başka uygulamada" sayılır — sonraki `register` false döner; false ile bırakılır. */
  baskaUygulamada(hizlandirici: string, tutuluyor?: boolean): void;
  /** Test kancası: gerçek tuş basışı yerine kayıtlı geri çağrıyı çalıştırır; kayıtlıysa true. */
  tetikle(hizlandirici: string): boolean;
  /** Tanı: kayıtlı kanonik tuşlar. */
  kayitlilar(): string[];
}

export function kisayolDefteri(o: { platform?: string; baska?: Iterable<string> } = {}): KisayolDefteri {
  const platform = o.platform ?? (typeof process !== 'undefined' ? process.platform : 'win32');
  const kanonik = (h: string) => kisayolKanonik(h, platform);
  const kayit = new Map<string, () => void>();
  const baska = new Set<string>();
  for (const h of o.baska ?? []) { try { baska.add(kanonik(h)); } catch { /* geçersiz test girdisi atlanır */ } }
  return {
    register(h, f) {
      const k = kanonik(h);
      if (typeof f !== 'function') throw new TypeError('Geri çağrı bir işlev olmalı.');
      if (baska.has(k) || kayit.has(k)) return false;
      kayit.set(k, f);
      return true;
    },
    unregister(h) { kayit.delete(kanonik(h)); },
    isRegistered(h) { return kayit.has(kanonik(h)); },
    unregisterAll() { kayit.clear(); },
    baskaUygulamada(h, tutuluyor = true) { if (tutuluyor) baska.add(kanonik(h)); else baska.delete(kanonik(h)); },
    tetikle(h) { const f = kayit.get(kanonik(h)); if (!f) return false; f(); return true; },
    kayitlilar() { return [...kayit.keys()]; },
  };
}
