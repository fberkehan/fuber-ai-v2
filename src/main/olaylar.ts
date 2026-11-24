// ── Olay yolu ve onay köprüsü ────────────────────────────────────────────────────────────────────────────────
// Ana süreçteki modüller arayüze `yayinla(kanal, veri)` ile olay gönderir (bütün pencerelere). Riskli işlemler
// (e-posta/WhatsApp gönderimi, fare-klavye kontrolü, izinli klasör dışı dosya) `onayIste` ile kullanıcıya sorulur;
// karar gelene kadar (en çok 10 dk) ajan bekler. Karar yoksa İŞLEM YAPILMAZ.
import { BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import type { OnayIstegi, SohbetOlayi } from '../shared/tipler.js';
import { adaGonder, adaPencere, adaSohbetCalisiyor } from './ada.js';

const icDinleyiciler = new Map<string, Set<(veri: unknown) => void>>();

const herOlay = new Set<(kanal: string, veri: unknown) => void>();

/** `haric`: bu pencereye GİTMEZ (ör. ada, olayı başka yoldan alıyor: tam ekran kapısı; iki kez gelmesin). */
export function yayinla(kanal: string, veri: unknown, haric?: BrowserWindow | null): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && w !== haric) w.webContents.send(kanal, veri);
  }
  for (const f of icDinleyiciler.get(kanal) ?? []) { try { f(veri); } catch { /* dinleyici hatası yayını durdurmaz */ } }
  for (const f of herOlay) { try { f(kanal, veri); } catch { /* dinleyici hatası yayını durdurmaz */ } }
}

/** Bütün olaylar (Fuber Cep köprüsü: telefondaki arayüz de masaüstü pencereleri gibi her olayı alır). */
export function herOlayiDinle(f: (kanal: string, veri: unknown) => void): () => void {
  herOlay.add(f);
  return () => herOlay.delete(f);
}

/** Ana süreç içinden bir olayı dinle (ör. 'bildirim' → masaüstü bildirimi). */
export function anaDinle<T = unknown>(kanal: string, f: (veri: T) => void): () => void {
  const s = icDinleyiciler.get(kanal) ?? new Set();
  s.add(f as (v: unknown) => void);
  icDinleyiciler.set(kanal, s);
  return () => s.delete(f as (v: unknown) => void);
}

export function sohbetOlayi(o: SohbetOlayi): void { yayinla('sohbet:olay', o); }

/** 0.14 T13 (R13): "Çalışıyor" hâli (eşiği aşan sohbet turu ya da null). Yalnız adaya gider (main/ada.ts adaSohbetCalisiyor; öbür pencereler ve telefon
 *  almaz) ve ana süreç dinleyicilerine (anaDinle('ada:calisiyor')). */
export function sohbetCalisiyor(d: { sohbetId: number; adim: number; etiket: string } | null): void {
  adaSohbetCalisiyor(d);
  for (const f of icDinleyiciler.get('ada:calisiyor') ?? []) { try { f(d); } catch { /* dinleyici hatası yayını durdurmaz */ } }
}

export type OnayKarari = 'bir_kez' | 'bu_gorev' | 'reddet';
/** `masada` (0.11 G9 düzeltme turu 1): Görev başlatma onayı yalnız bilgisayarın başında yanıtlanır (telefon köprüsü reddeder: main/kopru.ts). */
const bekleyen = new Map<string, { coz: (k: OnayKarari) => void; sohbetId: number; masada: boolean }>();
/** Bu onay yalnız bilgisayarın başında mı yanıtlanır (görev başlatma)? Bilinmeyen kimlik: hayır. */
export const onayMasadaMi = (id: string): boolean => bekleyen.get(id)?.masada === true;

/** Kart arayüzlerden kalksın (karar verildi sayılmaz; geç gelen onay hiçbir şey yapmaz). */
const kartiKaldir = (sohbetId: number, id: string) => sohbetOlayi({ tur: 'onay_iptal', sohbetId, id });

/** `sinyal` kesilirse (ör. araç süresi doldu) bekleyen onay İPTAL edilir: 'reddet' döner, kart kalkar. 0.11 G9: Görev başlatma onayı
 *  (`tur: 'gorev'`, planın insan dili `gorev`te) yalnız "başlat / vazgeç"tir — "bu görev boyunca izin ver" seçeneği yok (izinler planın içinde). */
export function onayIste(sohbetId: number, istek: Omit<OnayIstegi, 'id' | 'secenekler'> & { secenekler?: OnayIstegi['secenekler'] }, sinyal?: AbortSignal): Promise<OnayKarari> {
  const id = randomUUID();
  const tam: OnayIstegi = { ...istek, id, secenekler: istek.tur === 'gorev' ? ['bir_kez', 'reddet'] : istek.secenekler ?? ['bir_kez', 'reddet'] };
  return new Promise<OnayKarari>((coz) => {
    if (sinyal?.aborted) return coz('reddet');
    const iptal = () => { if (bekleyen.delete(id)) { clearTimeout(zaman); kartiKaldir(sohbetId, id); coz('reddet'); } };
    const zaman = setTimeout(() => { sinyal?.removeEventListener('abort', iptal); iptal(); }, 10 * 60_000);
    bekleyen.set(id, { coz: (k) => { clearTimeout(zaman); sinyal?.removeEventListener('abort', iptal); coz(k); }, sohbetId, masada: istek.tur === 'gorev' });
    sinyal?.addEventListener('abort', iptal, { once: true });
    sohbetOlayi({ tur: 'onay', sohbetId, istek: tam });
    // Ada da gösterebilsin — ama yayından DEĞİL, tam ekran kapısından (adaGonder); yayın adaya gitmez, ada olayı bir kez alır.
    const onay = { sohbetId, istek: tam };
    yayinla('asistan:onay', onay, adaPencere());
    // Tam ekranda kuyrukta beklerken yanıtlanır/süresi dolarsa (onay_iptal arayüze çoktan gitti) ölü kart olarak GELMESİN.
    adaGonder('asistan:onay', onay, 'onay', { gecerli: () => bekleyen.has(id) });
  });
}

/** Son onay yanıtının zamanı: onay kartına basmak da bir fare/klavye girdisidir; bilgisayar kullanımı bunu
 *  "kullanıcı devraldı" saymasın diye okunur. */
export let sonOnayYanitZamani = 0;

export function onayYanitla(id: string, karar: OnayKarari): boolean {
  const b = bekleyen.get(id);
  if (!b) return false;
  bekleyen.delete(id);
  sonOnayYanitZamani = Date.now();
  b.coz(karar);
  // Kart, yanıtlanmadığı öteki arayüzlerden de kalksın (ör. ana pencerede onaylandı → adada ölü kart kalmasın; adada onay
  // en öncelikli haldir, kalan kart her şeyi örterdi).
  kartiKaldir(b.sohbetId, id);
  return true;
}

/** Bir sohbetin bekleyen bütün onaylarını reddet (kullanıcı "durdur" dediğinde). */
export function onaylariReddet(sohbetId: number): void {
  for (const [id, b] of bekleyen) if (b.sohbetId === sohbetId) { bekleyen.delete(id); b.coz('reddet'); kartiKaldir(sohbetId, id); }
}
