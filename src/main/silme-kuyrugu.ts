// ── Geri alınabilir silmelerin kuyruğu (ana süreç) ─────────────────────────────────────────────────────────────────────
// Görev 20b (K2, düzeltme turu 1): kuyruk arayüzde dururken normal bir çıkış (tepsi "Çık") arayüz sayacını öldürüyor, "Unut" deyip
// 5 sn içinde kapatınca kayıt yerinde kalıyordu. Kuyruk artık burada: arayüz `silme:ertele` ile ister, `silme:degisti` olayıyla
// aynasını tutar; süre dolunca ya da ÇIKIŞTA (main.ts before-quit / oturum kapanışı → `hepsiniUygula`) silme uygulanır. Çökmede hiçbir
// şey uygulanmaz (yarım silme yok). Uygulayıcı, bildirim ve hata ipc.ts'ten gelir (Electron yok: birim testli).
import { ErtelenmisSilme, type ErtelenmisIs, type Saat } from '../shared/ertelenmis.ts';
import { TOPLANTI_KIMLIGI } from '../shared/toplanti.ts';

export type SilmeIslemi = { tur: 'hafiza'; id: number } | { tur: 'eposta'; id: string } | { tur: 'belge'; id: number } | { tur: 'toplanti'; id: string };
/** `duraklatilan`: süresi duran gruplar (tür adı: 'hafiza' | 'eposta' | 'belge' | 'toplanti'); `durakli`: en az biri duruyor. */
export interface SilmeDurumu { bekleyen: ErtelenmisIs[]; gizli: string[]; durakli: boolean; duraklatilan: string[] }

export const silmeAnahtari = (i: SilmeIslemi) => `${i.tur}:${i.id}`;

/** IPC'den gelen isteği doğrular (bilinmeyen tür ya da kimlik → null). */
export function silmeIslemiOku(x: unknown): SilmeIslemi | null {
  if (!x || typeof x !== 'object') return null;
  const { tur, id } = x as { tur?: unknown; id?: unknown };
  if ((tur === 'hafiza' || tur === 'belge') && Number.isInteger(id) && (id as number) > 0) return { tur, id: id as number };
  if (tur === 'eposta' && typeof id === 'string' && id.length > 0 && id.length <= 200) return { tur, id };
  // 12 Kas: geçmiş toplantı (main/toplanti/depo.ts; kimlik deseni yol gezintisine izin vermez).
  if (tur === 'toplanti' && typeof id === 'string' && TOPLANTI_KIMLIGI.test(id)) return { tur, id };
  return null;
}

export function silmeKuyrugu(o: {
  uygula: (i: SilmeIslemi) => unknown;
  degisti: (d: SilmeDurumu) => void;
  hata: (anahtar: string, etiket: string, mesaj: string) => void;
  saat?: Saat;
  sure?: number;
}) {
  const k = new ErtelenmisSilme(o.saat, o.sure);
  const durum = (): SilmeDurumu => ({ bekleyen: k.bekleyenler(), gizli: k.gizliAnahtarlar(), durakli: k.durakli, duraklatilan: k.duraklatilanlar() });
  k.dinle(() => o.degisti(durum()));
  return {
    /** `grup`: tostun grubu (varsayılan tür; Fuber'in kendi hafıza silmesi ayrı tostta: 'hafiza-fuber'). */
    ertele(islem: SilmeIslemi, etiket: string, grup: string = islem.tur): SilmeDurumu {
      const anahtar = silmeAnahtari(islem);
      const e = String(etiket ?? '').slice(0, 240);
      k.ertele({ anahtar, etiket: e, grup, uygula: () => o.uygula(islem), hata: (h) => o.hata(anahtar, e, h instanceof Error ? h.message : String(h)) });
      return durum();
    },
    geriAl: (anahtar: string) => k.geriAl(anahtar),
    /** Grup (tür) verilirse yalnız o tostun süresi; verilmezse bekleyen bütün gruplar (sürdürmede: duraklatılmış hepsi). */
    duraklat: (v: boolean, grup?: string) => (v ? k.duraklat(grup) : k.surdur(grup)),
    durum,
    /** Çıkışta: bekleyen silmeler şimdi uygulanır. */
    hepsiniUygula: () => k.hepsiniHemenUygula(),
  };
}

export type SilmeKuyrugu = ReturnType<typeof silmeKuyrugu>;

// ── I6 (son inceleme): Fuber'in (modelin) başlattığı hafıza silmesi de bu kuyruktan geçer — masaüstünde "Fuber bir hafızayı sildi · Geri
// al" tostu (bilesenler/TostAlani.tsx; Ctrl+Z da). ipc.ts kuyruğu kurunca kaydeder; kayıt yoksa (test, ipc kurulmadı) false döner ve
// araç doğrudan siler.
let etkinKuyruk: SilmeKuyrugu | null = null;
export function silmeKuyruguKaydet(k: SilmeKuyrugu | null): void { etkinKuyruk = k; }
export const FUBER_SILME_GRUBU = 'hafiza-fuber';
export const fuberSilmeEtiketi = (baslik: string) => `Fuber bir hafızayı sildi: “${baslik.length > 60 ? `${baslik.slice(0, 59)}…` : baslik}”`;
export function fuberHafizaSilmesi(id: number, baslik: string): boolean {
  if (!etkinKuyruk || !Number.isInteger(id) || id <= 0) return false;
  etkinKuyruk.ertele({ tur: 'hafiza', id }, fuberSilmeEtiketi(baslik), FUBER_SILME_GRUBU);
  return true;
}
