// ── Ana pencerenin geri alınabilir silmeleri (Görev 20b, K2) ─────────────────────────────────────────────────────────────
// Kuyruk ANA SÜREÇTE (main/silme-kuyrugu.ts): burası onun aynası. Hafıza "Unut", e-posta "Kaldır" ve Hafıza → Belgeler "Sil"
// kaydı hemen gizler (iyimser), "Geri al" tostu (bilesenler/TostAlani.tsx) görünür; süre dolunca ya da uygulama NORMAL KAPANIRKEN
// silme ana süreçte uygulanır, çökmede uygulanmaz. Uygulanamayan silme tostla bildirilir (çağıranın verdiği hata etiketiyle).
// Düzeltme turu 2: aynı türden art arda silinenler tek tost + TEK süre (ana süreç eşitler); duraklatma tostun grubuna özgü ve her
// istek gider (süzülmez: ana süreç pencere odağı gidince kendisi sürdürebilir, ayna eskiyebilir). Geri alma ana süreçte
// gerçekleşmediyse (süre o arada doldu) kayıt gizli kalır ve "geri alınamadı" denir — eskiden kayıt geri gelmiş gibi görünüyordu.
import { useEffect, useState } from 'react';
import { cagir, dinle } from './api';
import { tostGoster } from './tostlar';
import type { ErtelenmisIs } from '../shared/ertelenmis';

export type SilmeIslemi = { tur: 'hafiza'; id: number } | { tur: 'eposta'; id: string } | { tur: 'belge'; id: number } | { tur: 'toplanti'; id: string };
interface Durum { bekleyen: ErtelenmisIs[]; gizli: string[]; durakli: boolean; duraklatilan?: string[] }

const anahtarOf = (i: SilmeIslemi) => `${i.tur}:${i.id}`;
let durum: Durum = { bekleyen: [], gizli: [], durakli: false, duraklatilan: [] };
const istenen = new Set<string>(); // ana süreç onaylayana dek iyimser gizli
const geriAlinan = new Set<string>(); // "Geri al" basıldı, onay bekleniyor: iyimser görünür
const hataEtiketi = new Map<string, string>();
const dinleyiciler = new Set<() => void>();
let bagli = false;

const bildir = () => { for (const f of [...dinleyiciler]) f(); };
function guncelle(d: Durum) {
  durum = d;
  for (const a of [...istenen]) if (d.gizli.includes(a)) istenen.delete(a);
  for (const a of [...geriAlinan]) if (!d.gizli.includes(a)) geriAlinan.delete(a);
  bildir();
}
function baglan() {
  if (bagli || typeof window === 'undefined' || !window.fuber) return;
  bagli = true;
  void cagir<Durum>('silme:durum').then(guncelle).catch(() => undefined);
  dinle('silme:degisti', guncelle);
  dinle('silme:hata', (v: { anahtar: string; etiket: string; mesaj: string }) => {
    tostGoster(`${hataEtiketi.get(v.anahtar) ?? v.etiket}: ${v.mesaj}`, 'hata');
  });
}

/** Ana süreçten geri almayı ister; gerçekleşmeyenler (süre dolmuş, uygulanıyor) gizli kalır ve bildirilir. */
async function geriAlIste(liste: readonly ErtelenmisIs[]): Promise<void> {
  for (const b of liste) { geriAlinan.add(b.anahtar); istenen.delete(b.anahtar); }
  bildir();
  const sonuc = await Promise.all(liste.map((b) => cagir<boolean>('silme:geri-al', b.anahtar).catch(() => false)));
  const olmayan = liste.filter((_, i) => !sonuc[i]);
  if (!olmayan.length) return;
  for (const b of olmayan) geriAlinan.delete(b.anahtar);
  bildir();
  tostGoster(olmayan.length === 1 ? `Geri alınamadı, süre dolmuştu: ${olmayan[0].etiket}` : `Geri alınamadı, süre dolmuştu (${olmayan.length} öğe)`, 'hata');
}

export const silmeler = {
  /** Silmeyi erteler; `hata`: uygulanamazsa tostun başı (ör. "“Kahve” unutulamadı"). */
  ertele(islem: SilmeIslemi, etiket: string, hata: string): void {
    baglan();
    const a = anahtarOf(islem);
    istenen.add(a); geriAlinan.delete(a); hataEtiketi.set(a, hata);
    bildir();
    void cagir<Durum>('silme:ertele', islem, etiket).then(guncelle).catch((e: Error) => {
      istenen.delete(a); bildir();
      tostGoster(`${hata}: ${e.message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '')}`, 'hata');
    });
  },
  /** Tostun "Geri al"ı: gruptakilerin hepsi. */
  geriAl(anahtarlar: readonly string[]): void {
    void geriAlIste(anahtarlar.map((a) => durum.bekleyen.find((b) => b.anahtar === a) ?? { anahtar: a, etiket: a, bitis: 0 }));
  },
  /** Ctrl+Z: en son ertelenen silmeyi geri alır; bekleyen yoksa false. Önce o grubun süresi durdurulur (istek sırası korunur:
   *  geri alma ana sürece varana dek süre dolmasın), sonra geri alınır; gerçekleşmediyse bildirilir. */
  sonuncuyuGeriAl(): boolean {
    const son = silmeler.bekleyenler().at(-1);
    if (!son) return false;
    const grup = son.grup ?? son.anahtar;
    const zatenDurakli = Boolean(son.durakli);
    if (!zatenDurakli) void cagir('silme:duraklat', true, grup).catch(() => undefined);
    void geriAlIste([son]).finally(() => { if (!zatenDurakli) void cagir('silme:duraklat', false, grup).catch(() => undefined); });
    return true;
  },
  /** Tostun üstüne gelindi/odaklandı: yalnız o grubun süresi durur (ana süreçte). */
  duraklat(grup: string, v: boolean): void {
    void cagir('silme:duraklat', v, grup).catch(() => undefined);
  },
  gizliMi(a: string): boolean { if (geriAlinan.has(a)) return false; return istenen.has(a) || durum.gizli.includes(a); },
  bekleyenler(): ErtelenmisIs[] { return durum.bekleyen.filter((b) => !geriAlinan.has(b.anahtar)); },
  dinle(f: () => void): () => void { baglan(); dinleyiciler.add(f); return () => { dinleyiciler.delete(f); }; },
};

/** Depo değişince yeniden çizer; `gizli(anahtar)` kaydın listede gösterilmeyeceğini söyler. */
export function useSilmeler(): { gizli: (anahtar: string) => boolean; surum: number } {
  const [surum, setSurum] = useState(0);
  useEffect(() => silmeler.dinle(() => setSurum((n) => n + 1)), []);
  return { gizli: (a) => silmeler.gizliMi(a), surum };
}
