// ── Uygulama içi kısayollar (saf) ─────────────────────────────────────────────────────────────────────────────────────
// Görev 20b (K10): Ctrl+N yeni sohbet; Ctrl+1…7 sol raydaki sayfalar, ray SIRASIYLA ve yalnız GÖRÜNEN öğelere (İş modunda
// Claude Code yok: 7 boş). Mac'te Ctrl yerine ⌘. Yazı alanında yazarken sayfa kısayolları çalışmaz
// (yazılan rakam/kısayol çakışmasın); Ctrl+N çalışır (sohbet yazarken de yeni sohbet açılabilsin). Shift/Alt (Windows'ta AltGr =
// Ctrl+Alt: Türkçe klavyede @, € …) ve basılı tutmanın tekrarı yok sayılır.

// Düzeltme turu 1: Ctrl+Z son "Geri al"lı silmeyi geri alır (yazı alanında metnin kendi geri alması kalır); IME ile yazı oluştururken
// (isComposing) hiçbir kısayol çalışmaz.
// 0.10 Görev 1 (D1, P1): ray sırası tek kaynak RAY_SIRASI. Beyin sayfası kalktı; yerine gelen Etkinlik bir izleme sayfası olduğundan
// Bağlantılar'dan sonra, Ayarlar'dan önce durur → İş: 1 Kokpit, 2 Sohbetler, 3 Hafıza, 4 Bağlantılar, 5 Etkinlik, 6 Ayarlar; Geliştirici:
// 4 Claude Code, 5 Bağlantılar, 6 Etkinlik, 7 Ayarlar.
import type { Mod } from './tipler.ts';

// 12 Kas: Toplantı (canlı yazı + çeviri) Hafıza'dan sonra → İş: 1 Kokpit … 4 Toplantı, 5 Bağlantılar, 6 Etkinlik, 7 Ayarlar; Geliştirici 8 öğe.
export const RAY_SIRASI = ['kokpit', 'sohbetler', 'hafiza', 'toplanti', 'claude', 'baglantilar', 'etkinlik', 'ayarlar'] as const;
export type RaySayfasi = (typeof RAY_SIRASI)[number];
/** Moda göre görünen ray öğeleri, ray sırasıyla (İş modunda Claude Code yok). `ccAcik` (0.13): canlı oturum ya da bekleyen izin varken ya da sayfa açıkken İş'te de görünür. */
export const gorunenRay = (mod: Mod, ccAcik = false): RaySayfasi[] => RAY_SIRASI.filter((s) => s !== 'claude' || mod === 'gelistirici' || ccAcik);

export type UygulamaKisayolu = { tur: 'yeni-sohbet' } | { tur: 'sayfa'; sira: number } | { tur: 'geri-al' };
export interface TusBilgisi { key: string; code?: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean; repeat?: boolean; isComposing?: boolean }

export function kisayolCoz(e: TusBilgisi, o: { mac?: boolean; yaziyor?: boolean } = {}): UygulamaKisayolu | null {
  if (e.isComposing) return null;
  const ana = o.mac ? Boolean(e.metaKey) && !e.ctrlKey : Boolean(e.ctrlKey) && !e.metaKey;
  if (!ana || e.altKey || e.shiftKey || e.repeat) return null;
  if (e.code === 'KeyN' || e.key.toLocaleLowerCase('tr-TR') === 'n') return { tur: 'yeni-sohbet' };
  if (o.yaziyor) return null;
  if (e.code === 'KeyZ' || e.key.toLocaleLowerCase('tr-TR') === 'z') return { tur: 'geri-al' };
  const rakam = /^Digit([1-9])$/.exec(e.code ?? '')?.[1] ?? /^[1-9]$/.exec(e.key)?.[0];
  return rakam ? { tur: 'sayfa', sira: Number(rakam) } : null;
}

/** 1'den başlayan sıra → görünen ray öğesi (yoksa undefined). */
export function siradakiSayfa<T>(gorunen: readonly T[], sira: number): T | undefined {
  return sira >= 1 ? gorunen[sira - 1] : undefined;
}

export const sayfaKisayolMetni = (sira: number, mac = false) => (mac ? `⌘${sira}` : `Ctrl+${sira}`);
export const yeniSohbetKisayolu = (mac = false) => (mac ? '⌘N' : 'Ctrl+N');

const YAZI_GIRDISI = new Set(['', 'text', 'search', 'email', 'password', 'number', 'url', 'tel', 'date', 'time', 'datetime-local', 'month', 'week']);

/** Odak bir yazı alanında mı (metin girdisi, metin kutusu, düzenlenebilir içerik)? */
export function yaziAlaniMi(el: { tagName?: string; type?: string; isContentEditable?: boolean } | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const ad = (el.tagName ?? '').toUpperCase();
  if (ad === 'TEXTAREA' || ad === 'SELECT') return true;
  return ad === 'INPUT' && YAZI_GIRDISI.has((el.type ?? '').toLowerCase());
}
