// ── İş izi: ana sürecin tek iş listesi (11 Kas 2026; model ve eşlemeler saf: shared/is-izi.ts, shared/is-izi-cc.ts) ─────────────────────────────
// Kaynakların kendi olaylarını dinler — yoklama YOK: 'sohbet:olay' (tur başladı, araç, onay, bitti), 'isler:durum' (görevler), 'surec:degisti' (arka plan
// süreçleri), 'claudecode:olay' (oturum özeti, alt ajanlar, araçlar, izinler, arka plan işleri); 12 Kas: süren toplantı (toplantiIziYaz). Görünüm değişince tek liste 'is-izi:degisti' ile bütün
// pencerelere (ana pencere, çentik) gider; telefona köprü yalnız durumu iletir (shared/kopru-protokol.ts telefonaGiden → telefonIsOzeti). Zamanlayıcılar
// yalnız olaya bağlı tek atımlıktır: sohbet turunun 8 sn eşiği ve biten işin kısa ömrü (tik + uçuş). İş yokken hiçbir zamanlayıcı kurulu değildir.
// Sohbet turu kısa yanıtlarda iş sayılmaz (SOHBET_IS_ESIGI: 8 sn ya da 3 adım; çentiğin "Çalışıyor" eşiğiyle aynı); onay isteyen tur hemen görünür.
import { anaDinle, yayinla } from './olaylar.js';
import { sohbetBilgisi } from './sohbet.js';
import { ayarlar } from './ayarlar.js';
import { aracSatiri } from '../shared/arac-satiri.js';
import {
  SOHBET_IS_ESIGI, aktifMi, bitenleriTut, bitenSonu, gorevIsi, isleriSirala, sohbetTuruIsi, surecIsi, type IsKaydi,
} from '../shared/is-izi.js';
import { ccIzAdimi, ccIzIsleri, type CcIzDurumu } from '../shared/is-izi-cc.js';
import type { SohbetOlayi } from '../shared/tipler.js';
import type { IsOzet } from '../shared/isler.js';
import type { SurecOzeti } from '../shared/surec.js';
import type { CcOlayZarfi } from '../shared/cc-olay.js';

interface Tur { sohbetId: number; baslik: string; baslangic: number; araclar: Set<string>; ne: string; onaylar: Set<string>; esik: boolean; zaman: ReturnType<typeof setTimeout> | null }

const turlar = new Map<number, Tur>();
let gorevler: IsOzet[] = [];
let surecler: SurecOzeti[] = [];
const cc: CcIzDurumu = new Map();
const tutulan = new Map<string, IsKaydi>();
let onceki = new Map<string, IsKaydi>();
let son: IsKaydi[] = [];
let sonAnahtar = '[]';
let yayinSirada = false;
let omurZamani: ReturnType<typeof setTimeout> | null = null;
let kuruldu = false;
/** 12 Kas: süren toplantının tek kaydı (main/toplanti.ts yazar; olay değil doğrudan çağrı — döküm bu modülden geçmez). */
let toplanti: IsKaydi | null = null;

const mod = () => { try { return ayarlar().mod; } catch { return 'is' as const; } };

/** Şimdiki liste (açılışta 'is-izi:liste'). */
export const isIziListesi = (): IsKaydi[] => son;

function hesapla(simdi: number): IsKaydi[] {
  const l: IsKaydi[] = [];
  const m = mod();
  for (const t of turlar.values()) {
    if (!t.esik && !t.onaylar.size) continue;
    l.push(sohbetTuruIsi({ sohbetId: t.sohbetId, baslik: t.baslik, baslangic: t.baslangic, adim: t.araclar.size, ne: t.ne, onay: t.onaylar.size > 0 }));
  }
  const d = new Date(simdi);
  for (const g of gorevler) l.push(gorevIsi(g, d, m));
  for (const s of surecler) l.push(surecIsi(s));
  l.push(...ccIzIsleri(cc));
  if (toplanti) l.push(toplanti);
  return l;
}

/** Değişikliği bir sonraki mikro görevde toplar (aynı anda gelen olaylar tek yayın). */
function degisti(): void {
  if (yayinSirada) return;
  yayinSirada = true;
  queueMicrotask(yayinla_);
}

function yayinla_(): void {
  yayinSirada = false;
  const simdi = Date.now();
  const ham = hesapla(simdi);
  const aktif = ham.filter((x) => aktifMi(x.hal));
  const biten = bitenleriTut(onceki, ham, tutulan, simdi);
  onceki = new Map(aktif.map((x) => [x.id, x]));
  const liste = isleriSirala([...aktif, ...biten]);
  // Biten işin ömrü dolunca bir kez daha yayınla (yoklama değil: yalnız tutulan varken tek atımlık).
  if (omurZamani) { clearTimeout(omurZamani); omurZamani = null; }
  // Üstü süren yardımcının zamanlayıcısı yok (üst bitince bu yayın yeniden çalışır).
  const sonlar = [...tutulan.values()].map((x) => bitenSonu(x, tutulan, new Set(onceki.keys()))).filter((x): x is number => x !== null);
  if (sonlar.length) {
    omurZamani = setTimeout(() => { omurZamani = null; degisti(); }, Math.max(50, Math.min(...sonlar) - simdi + 20));
    omurZamani.unref?.();
  }
  const anahtar = JSON.stringify(liste);
  if (anahtar === sonAnahtar) return;
  sonAnahtar = anahtar;
  son = liste;
  yayinla('is-izi:degisti', liste);
}

function turBitti(sohbetId: number): void {
  const t = turlar.get(sohbetId);
  if (!t) return;
  if (t.zaman) clearTimeout(t.zaman);
  turlar.delete(sohbetId);
  degisti();
}

function sohbetOlayiIsle(o: SohbetOlayi): void {
  switch (o.tur) {
    case 'basladi': {
      const eski = turlar.get(o.sohbetId);
      if (eski?.zaman) clearTimeout(eski.zaman);
      let baslik = '';
      try { baslik = sohbetBilgisi(o.sohbetId)?.baslik ?? ''; } catch { /* başlık isteğe bağlı */ }
      const t: Tur = { sohbetId: o.sohbetId, baslik, baslangic: Date.now(), araclar: new Set(), ne: '', onaylar: new Set(), esik: false, zaman: null };
      t.zaman = setTimeout(() => { t.zaman = null; if (turlar.get(o.sohbetId) === t) { t.esik = true; degisti(); } }, SOHBET_IS_ESIGI.ms);
      t.zaman.unref?.();
      turlar.set(o.sohbetId, t);
      return; // eşik aşılana dek görünüm değişmez
    }
    case 'arac': {
      const t = turlar.get(o.sohbetId);
      if (!t) return;
      const b = o.blok;
      t.araclar.add(b.id);
      t.ne = b.durum === 'calisiyor' ? aracSatiri(b.ad, b.girdi, { durum: b.durum, ozet: b.ozet, etiket: b.etiket }, mod()).metin : '';
      if (t.araclar.size >= SOHBET_IS_ESIGI.adim) t.esik = true;
      if (t.esik) degisti();
      return;
    }
    case 'arac_oncesi': return;
    case 'onay': { const t = turlar.get(o.sohbetId); if (t) { t.onaylar.add(o.istek.id); degisti(); } return; }
    case 'onay_iptal': { const t = turlar.get(o.sohbetId); if (t?.onaylar.delete(o.id)) degisti(); return; }
    case 'bitti': turBitti(o.sohbetId); return;
    case 'hata': if (!o.mesgul) turBitti(o.sohbetId); return;
    default: return;
  }
}

/** Ana süreç açılışında bir kez (main.ts): kaynakları dinlemeye başlar. */
export function isIziBaslat(): void {
  if (kuruldu) return;
  kuruldu = true;
  anaDinle<SohbetOlayi>('sohbet:olay', (o) => { try { sohbetOlayiIsle(o); } catch (e) { console.warn('[iş izi] sohbet:', (e as Error).message); } });
  anaDinle<IsOzet[]>('isler:durum', (l) => { if (Array.isArray(l)) { gorevler = l; degisti(); } });
  anaDinle<SurecOzeti[]>('surec:degisti', (l) => { if (Array.isArray(l)) { surecler = l; degisti(); } });
  anaDinle<CcOlayZarfi>('claudecode:olay', (z) => { try { if (z?.olay && ccIzAdimi(cc, z, Date.now())) degisti(); } catch (e) { console.warn('[iş izi] claude code:', (e as Error).message); } });
}

/** Toplantı modu (12 Kas): süren toplantının kaydı ("Toplantı · dinliyor") ya da bitti (null). */
export function toplantiIziYaz(k: IsKaydi | null): void {
  if (JSON.stringify(k) === JSON.stringify(toplanti)) return;
  toplanti = k;
  degisti();
}

/** Açılışta görevler ve süreçler (olay gelmeden önceki hâl; main.ts verir). */
export function isIziTohumla(o: { gorevler?: IsOzet[]; surecler?: SurecOzeti[] }): void {
  if (o.gorevler) gorevler = o.gorevler;
  if (o.surecler) surecler = o.surecler;
  degisti();
}
