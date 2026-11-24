// ── Toplantı modu: arayüzün denetçisi (12 Kas 2026) ────────────────────────────────────────────────────────────────────────────────────────
// Sayfadan BAĞIMSIZ tek depo: toplantı sürerken başka sayfaya geçmek yakalamayı durdurmaz (sayfa yalnız izler). Ana süreçten 'toplanti:degisti' gelir
// (yalnız bu pencereye); durum 'dinliyor' değilse (iş izinden "Durdur", ana süreç bitirdi) yakalama kapanır. Yoklama yok; sayaç yalnız sayfa açıkken ve
// toplantı sürerken saniyede bir (Toplanti.tsx). Pencere kapanırken (beforeunload) izler kapanır; ana süreç kalan dökümü saklar.
// 0.17.2: kesilen kaynak (bilgisayarın sesi ya da mikrofon) önce kendiliğinden yeniden açılır (2 deneme); olmazsa tek cümle + "Yeniden aç" düğmesi. Bağlam
// (konu, katılımcılar, notlar, ton, belgeler) burada tutulur, ana sürece iletilir; yerel Whisper indirmesi yalnız düğmeyle başlar ve YALNIZ indirirken
// (en çok 1,5 sn'de bir) ilerleme sorulur — boştayken yoklama yok.
import { useSyncExternalStore } from 'react';
import { cagir, dinle } from '../api';
import { yakalamaBaslat, type KaynakHali, type Yakalama } from './yakalama';
import { UYARI, yamaUygula, type Konusan, type ToplantiDurumu, type UyariEylemi, type YaziYolu } from '../../shared/toplanti';
import { kaynakDurumu, kaynakHatasiCoz, type HamKaynakHatasi, type KaynakEylemi } from '../../shared/toplanti-kaynak';
import type { SecimSecenegi, ToplantiTercihi } from '../../shared/toplanti-model';
import { bosBaglam, type ToplantiBaglami } from '../../shared/toplanti-baglam';

export interface Hazirlik {
  yol: YaziYolu; bulutsuz: boolean; hedefDil: string; suren: ToplantiDurumu | null; sahteSes: boolean;
  hesapVar: boolean;
  geminiVar?: boolean;
  gelistirici?: boolean;
  whisper: { kurulu: boolean; indirme?: { yuzde: number; adim: string; hata?: string }; boyutMB?: number };
  motorlar: { yazi: string; yz: string };
  baglam: ToplantiBaglami | null;
  /** Kalıcı model / yazıya çevirme seçimi ve seçilebilir seçenekler (ana süreç hesaplar: Gizli'de bulut satırı yok, Business'ta sade ad). */
  tercih: ToplantiTercihi;
  secenekler: { yz: SecimSecenegi[]; yazi: SecimSecenegi[]; yzDeger: string; yaziDeger: 'bulut' | 'yerel' | 'gemini' };
  /** Yalnız önizleme: son yapay zekâ isteğini hangi yol karşıladı. */
  sonYz?: string;
}
/** Başlarken ya da yakalarken olan sorun: kaynak başına tek cümle + yanındaki eylem. */
export interface DenetciHata { anahtar: string; metin: string; eylem: UyariEylemi | null }
export interface DenetciDurumu {
  durum: ToplantiDurumu | null;
  hazirlik: Hazirlik | null;
  kaynaklar: Record<Konusan, KaynakHali> | null;
  basliyor: boolean;
  /** Başlarken ya da yakalarken olan sorunlar (kaynak başına bir çip; ikisi birden olabilir). Ham hata günlüğe gider, burada yalnız tek cümle. */
  hatalar: DenetciHata[];
  /** Son biten toplantının saklanan kaydı (ayrıntıda açılır). */
  sonKayit: string | null;
  /** Kullanıcının verdiği bağlam (toplantıdan önce ya da sırasında düzenlenir). */
  baglam: ToplantiBaglami;
  /** Yerel yazıya çevirme indirmesi (yalnız düğmeye basılınca). */
  indirme: { yuzde: number; adim: string; hata?: string } | null;
}

let durum: DenetciDurumu = { durum: null, hazirlik: null, kaynaklar: null, basliyor: false, hatalar: [], sonKayit: null, baglam: bosBaglam(), indirme: null };
const dinleyenler = new Set<() => void>();
let yakalama: Yakalama | null = null;
let bagli = false;
const yenileniyor: Partial<Record<Konusan, boolean>> = {};

function yaz(p: Partial<DenetciDurumu>): void {
  durum = { ...durum, ...p };
  for (const f of [...dinleyenler]) f();
}

function baglan(): void {
  if (bagli || typeof window === 'undefined' || !window.fuber) return;
  bagli = true;
  dinle('toplanti:degisti', (ham: ToplantiDurumu) => {
    const d = yamaUygula(durum.durum, ham);
    yaz({ durum: d });
    if (d.hal !== 'dinliyor' && yakalama) { const y = yakalama; yakalama = null; void y.durdur(); yaz({ kaynaklar: null }); }
  });
  addEventListener('beforeunload', () => { void yakalama?.durdur(); });
  // Gizli / "Yalnız bu bilgisayar" ya da model ayarı değişti: seçenekler (bulut satırı) ve etiketler tazelenir.
  dinle('ayarlar:degisti', () => { void hazirla(); });
  void hazirla();
  void cagir<ToplantiDurumu | null>('toplanti:durum').then((d) => { if (d && !durum.durum) yaz({ durum: d }); }).catch(() => undefined);
}

export async function hazirla(): Promise<Hazirlik | null> {
  const h = await cagir<Hazirlik>('toplanti:hazirlik').catch(() => null);
  yaz({ hazirlik: h, ...(h?.whisper.indirme && !h.whisper.indirme.hata && h.whisper.indirme.yuzde < 100 ? { indirme: h.whisper.indirme } : {}) });
  // Önizleme denemesi: kaynağı kesmek için kanca (yalnız sahte ses açıkken var; gerçek kullanıcıda tanımsız).
  if (h?.sahteSes) (window as unknown as { __toplantiKes?: (k: Konusan, engel?: number) => void }).__toplantiKes = (k, engel) => yakalama?.kaynagiKes(k, engel);
  return h;
}

const bekle = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Kesilen kaynağı yeniden açar: önce ana süreçten kısa izin penceresi (yalnız bilgisayarın sesi), sonra yakalamadan yeniden iste. */
async function kaynagiAc(k: Konusan): Promise<boolean> {
  const y = yakalama;
  if (!y) return false;
  if (k === 'karsi') await cagir('toplanti:ses-yeniden').catch(() => undefined);
  const tamam = await y.yenile(k).catch(() => false);
  if (tamam && yakalama === y) yaz({ kaynaklar: { ...y.kaynaklar }, hatalar: hatayiKaldir(k) });
  return tamam;
}

const KAYNAK_ANAHTARI: Record<Konusan, string> = { karsi: 'kaynak:karsi', siz: 'kaynak:siz' };
const hatayiKaldir = (k: Konusan): DenetciHata[] => durum.hatalar.filter((h) => h.anahtar !== KAYNAK_ANAHTARI[k]);
const hataEkle = (k: Konusan, h: DenetciHata): DenetciHata[] => [...hatayiKaldir(k), h];
const KAYNAK_EYLEMI: Record<KaynakEylemi, (k: Konusan) => UyariEylemi> = { yeniden: (k) => (k === 'karsi' ? 'karsi-yeniden' : 'siz-yeniden'), 'windows-mikrofon': () => 'windows-mikrofon', 'mikrofon-ac': () => 'mikrofon-ac' };
/** "Mikrofonu tamamen kapat" ayarı açık mı (neden eşlemesi için). Okunamazsa kapalı sayılmaz. */
const mikrofonKapaliMi = (): Promise<boolean> => cagir<{ ses?: { mikrofonKapali?: boolean } }>('ayarlar:al').then((a) => a?.ses?.mikrofonKapali === true).catch(() => false);
/** Ham hata → kaynak başına çip (tek cümle + eylem). */
function kaynakHatasi(k: Konusan, ham: HamKaynakHatasi | undefined, mikrofonKapali: boolean, hicbiri: boolean): DenetciHata {
  const g = kaynakHatasiCoz(k, ham, { mikrofonKapali, hicbiri });
  return { anahtar: KAYNAK_ANAHTARI[k], metin: g.metin, eylem: KAYNAK_EYLEMI[g.eylem](k) };
}

/** Kaynak kendiliğinden bitti: iki kez sessizce yenilenir (çıkış aygıtı değişimi, kısa kesinti); olmazsa uyarı + "Yeniden aç". */
async function kaynakBitti(k: Konusan): Promise<void> {
  if (yenileniyor[k]) return;
  yenileniyor[k] = true;
  try {
    for (let i = 0; i < 2; i++) {
      await bekle(i === 0 ? 400 : 1500);
      if (!yakalama || durum.durum?.hal !== 'dinliyor') return;
      if (await kaynagiAc(k)) return;
    }
    if (yakalama) yaz({ kaynaklar: { ...yakalama.kaynaklar }, hatalar: hataEkle(k, { anahtar: KAYNAK_ANAHTARI[k], metin: k === 'karsi' ? UYARI.karsiKesildi : UYARI.sizKesildi, eylem: k === 'karsi' ? 'karsi-yeniden' : 'siz-yeniden' }) });
  } finally { yenileniyor[k] = false; }
}

/** "Yeniden aç" düğmesi (kullanıcı eylemi). */
export async function kaynagiYenile(k: Konusan): Promise<void> {
  if (await kaynagiAc(k)) return;
  yaz({ hatalar: hataEkle(k, kaynakHatasi(k, yakalama?.hatalar[k], k === 'siz' && await mikrofonKapaliMi(), false)) });
}

/** "Windows ayarlarını aç" (Gizlilik → Mikrofon). */
export const windowsMikrofonAyari = (): void => { void cagir('toplanti:windows-ayari').catch(() => undefined); };
/** "Mikrofonu aç": Fuber'in "Mikrofonu tamamen kapat" ayarını kapatır (kullanıcının açık eylemi) ve mikrofonu yeniden dener. Toplantı sürmüyorsa yalnız çip kalkar; kullanıcı Başlat'a basar. */
export async function mikrofonuAc(): Promise<void> {
  const a = await cagir<{ ses?: Record<string, unknown> }>('ayarlar:al').catch(() => null);
  if (a?.ses) await cagir('ayarlar:kaydet', { ses: { ...a.ses, mikrofonKapali: false } }).catch(() => undefined);
  if (yakalama) await kaynagiYenile('siz'); else yaz({ hatalar: hatayiKaldir('siz') });
}

// ── Model ve yazıya çevirme seçimi (kalıcı; oturum sürerken de değişir, sonraki istekte devreye girer) ─────────────────────────────────────
export async function tercihYaz(p: Partial<ToplantiTercihi>): Promise<void> {
  const h = await cagir<Hazirlik>('toplanti:tercih-yaz', p).catch(() => null);
  if (h) yaz({ hazirlik: h });
}

/** Gemini anahtarı: kaydet (string), sil (null) ya da yalnız sor (boş). Ham anahtar geri dönmez. */
export async function geminiAnahtari(anahtar?: string | null): Promise<{ var: boolean; hata?: string }> {
  const r = await cagir<{ var: boolean; hata?: string }>('toplanti:gemini', anahtar === undefined ? {} : { anahtar }).catch((e) => ({ var: false, hata: String((e as Error)?.message ?? e) }));
  void hazirla();
  return r;
}

export async function baslat(o: { hedefDil: string; robot: boolean }): Promise<void> {
  if (durum.basliyor || yakalama) return;
  yaz({ basliyor: true, hatalar: [], sonKayit: null });
  try {
    const h = await hazirla();
    if (!h || h.yol === 'yok') { yaz({ basliyor: false }); return; }
    const d = await cagir<ToplantiDurumu | { yok: true }>('toplanti:baslat', { ...o, baglam: durum.baglam });
    if ('yok' in d) { yaz({ basliyor: false }); await hazirla(); return; }
    yaz({ durum: d });
    const y = await yakalamaBaslat({
      sahteSes: h.sahteSes,
      // Akış kipi (14 Kas): bütün VAD olayları (başladı, ses blokları, bitti, vazgeçildi) tek kanaldan, sırayla ana sürece gider; cevap beklenmez.
      olay: (e) => { void cagir('toplanti:olay', e).catch(() => undefined); },
      kaynakBitti: (k) => { yaz({ kaynaklar: yakalama ? { ...yakalama.kaynaklar } : null }); void kaynakBitti(k); },
      kaynakHatasi: (k, e) => { void cagir('toplanti:kaynak-hatasi', { konusan: k, asama: 'baslangic', ...e }).catch(() => undefined); },
    });
    yakalama = y;
    const { eksik } = kaynakDurumu(y.kaynaklar);
    // Her eksik kaynak için GERÇEK neden (tek cümle + eylem). Biri açıksa toplantı onunla başlar; ikisi de yoksa başlamaz (iki çip, ikisi de nedenini söyler).
    const kapali = eksik.includes('siz') ? await mikrofonKapaliMi() : false;
    const hatalar = eksik.map((k) => kaynakHatasi(k, y.hatalar[k], k === 'siz' && kapali, eksik.length === 2));
    if (eksik.length === 2) {
      yakalama = null;
      await y.durdur();
      await cagir('toplanti:durdur').catch(() => undefined);
      yaz({ basliyor: false, kaynaklar: null, hatalar: [{ anahtar: 'baslamadi', metin: UYARI.ikisiYok, eylem: null }, ...hatalar] });
      return;
    }
    yaz({ basliyor: false, kaynaklar: { ...y.kaynaklar }, hatalar });
  } catch (e) {
    const y = yakalama;
    yakalama = null;
    await y?.durdur().catch(() => undefined);
    await cagir('toplanti:durdur').catch(() => undefined);
    yaz({ basliyor: false, kaynaklar: null, hatalar: [{ anahtar: 'baslamadi', metin: UYARI.baslamadi, eylem: null }] });
    console.warn('[toplantı] başlatılamadı:', (e as Error).name, (e as Error).message);
    void cagir('toplanti:kaynak-hatasi', { asama: 'baslatma', ad: (e as Error)?.name, ileti: (e as Error)?.message }).catch(() => undefined);
  }
}

/** Durdur: önce yakalama süren konuşmaları son parçalarıyla bitirir (hepsi ana sürece gider), sonra ana süreç özetler ve saklar. */
export async function durdur(): Promise<void> {
  const y = yakalama;
  yakalama = null;
  yaz({ kaynaklar: null, hatalar: [] });
  await y?.durdur().catch(() => undefined);
  const r = await cagir<{ durum: ToplantiDurumu; kayit: string | null } | null>('toplanti:durdur').catch(() => null);
  if (r) yaz({ durum: r.durum, sonKayit: r.kayit });
}

export function ayarla(o: { hedefDil?: string; robot?: boolean }): void {
  if (durum.durum?.hal === 'dinliyor') void cagir<ToplantiDurumu | null>('toplanti:ayar', o).then((d) => { if (d) yaz({ durum: d }); }).catch(() => undefined);
}

// ── Bağlam ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
let baglamZamani: ReturnType<typeof setTimeout> | null = null;
/** Bağlam değişti: ekranda hemen, ana süreçte kısa bir bekleyişle (yazarken her tuşta IPC yok). Toplantı sürüyorsa sonraki istemlere girer. */
export function baglamAyarla(b: ToplantiBaglami): void {

  yaz({ baglam: b });
  if (baglamZamani) clearTimeout(baglamZamani);
  baglamZamani = setTimeout(() => { baglamZamani = null; void cagir('toplanti:baglam', durum.baglam).catch(() => undefined); }, 450);
}
/** Toplantı bitince/kapatılınca bağlam sıfırlanır (bir sonraki toplantıya eski belgeler taşınmaz). */
export function baglamiSifirla(): void { yaz({ baglam: bosBaglam() }); void cagir('toplanti:baglam', bosBaglam()).catch(() => undefined); }

// ── Yerel yazıya çevirme (Whisper) indirmesi: yalnız düğmeyle ───────────────────────────────────────────────────────────────────
let indirmeSaati: ReturnType<typeof setTimeout> | null = null;
async function indirmeyiIzle(): Promise<void> {
  indirmeSaati = null;
  const h = await hazirla();
  const i = h?.whisper.indirme;
  if (h?.whisper.kurulu || !i || i.hata) { yaz({ indirme: i && i.hata ? i : null }); return; }
  yaz({ indirme: i });
  indirmeSaati = setTimeout(() => { void indirmeyiIzle(); }, 1500);
}
export async function whisperIndir(): Promise<void> {
  yaz({ indirme: { yuzde: 0, adim: 'Hazırlanıyor' } });
  const r = await cagir<{ kurulu: boolean; indirme?: { yuzde: number; adim: string; hata?: string } }>('toplanti:whisper-indir').catch(() => null);
  if (!r) { yaz({ indirme: { yuzde: 0, adim: '', hata: 'Başlatılamadı' } }); return; }
  if (r.kurulu) { yaz({ indirme: null }); await hazirla(); return; }
  if (indirmeSaati) clearTimeout(indirmeSaati);
  indirmeSaati = setTimeout(() => { void indirmeyiIzle(); }, 800);
}

/** Biten toplantının ekranını kapat (geçmişe dön). */
export const temizle = (): void => { yaz({ durum: durum.durum?.hal === 'dinliyor' || durum.durum?.hal === 'ozetleniyor' ? durum.durum : null, sonKayit: null, hatalar: [] }); if (durum.durum === null) baglamiSifirla(); };

const abone = (f: () => void) => { baglan(); dinleyenler.add(f); return () => { dinleyenler.delete(f); }; };
const anlik = () => durum;
export function useToplanti(): DenetciDurumu { return useSyncExternalStore(abone, anlik, anlik); }
