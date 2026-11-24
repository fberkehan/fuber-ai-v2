// ── Sistem uyarı hapları (0.14 T22) — saf; birim testli: tests/sistem-uyarilari.test.ts ───────────────────────────────────────────
// Olay yardımcısının (fuber-olay.exe; protokol shared/sistem-olay.ts) olaylarından çentikte kısa bir hap: kulaklık bağlandı/ayrıldı, şarj takıldı/çıkarıldı,
// ses ve parlaklık bindirmesi (hap + düzey çubuğu), Caps Lock, klavye dili, internet koptu/geri geldi. Kurallar:
//  · Ayar: Görünüm → "Sistem uyarıları", yedi anahtar (`gorunum.uyarilar`), hepsi varsayılan açık. 'odak-bitti' sistem olayından değil Odak sayfasından (T26)
//    gelir ve anahtar değildir.
//  · Yalnız değişim hap olur: aynı değerin tekrarı null. Şarj, ağ, Caps Lock ve dil aç/kapa olaylarıdır: tabanı bilinmiyorsa (yardımcı yeni açıldı, `durum`
//    gelmedi) hap yok. Ses, parlaklık ve ses aygıtı olayı kendisi değişimdir. Pilin yüzdesi her %1'de olay verir: yalnız takılıp çıkarılma hap olur.
//  · R25: ana pencere öndeyken, çentik kapalıyken ("Ada: kapalı" ya da "1 saat gizle") ve tam ekranda gösterilmez; kuyruğa da girmez (anlık olaydır).
//    Düzeltme turu 1 (Important 3): çentik görünmüyorsa (ör. "Ada sessizken görünsün" kapalı) hap için odak almadan iner, süre dolunca geri çekilir (`uyariYolu`).
//  · Klavye kancası (Caps Lock ve dil) yalnız bu iki anahtardan biri açıkken kurulur (`klavyeGerekli`).
//  · Dil: Alt+Shift iki kez A→B→A verir; son dil olayından 400 ms sonra tek hap, dil başa döndüyse hiç hap yok (`DilBirlestirici`, tek atımlık setTimeout).
// Electron/DOM yok: ana süreç (main/ada.ts) ve arayüz (renderer/ada) içe aktarır.
import type { SistemDurumu, SistemOlayi } from './sistem-olay.ts';

export type UyariTuru = 'kulaklik' | 'sarj' | 'ses' | 'parlaklik' | 'caps' | 'dil' | 'ag' | 'odak-bitti';
/** Görünüm'deki anahtarlar (yedi); 'odak-bitti' anahtar değildir. */
export type UyariAnahtari = Exclude<UyariTuru, 'odak-bitti'>;
export const UYARI_ANAHTARLARI: readonly UyariAnahtari[] = ['kulaklik', 'sarj', 'ses', 'parlaklik', 'caps', 'dil', 'ag'];

/** Çentikteki hap. `simge`: Ikon adı (renderer/bilesenler/Ikon.tsx). `duzey`: 0..1, yalnız ses ve parlaklık bindirmesinde (çubuk). */
export interface SistemUyarisi { tur: UyariTuru; metin: string; duzey?: number; simge: string }

/** Hapın çentikte kalma süresi; ses ve parlaklık bindirmesi daha kısa (art arda tuşlarda yerinde güncellenir). */
export const UYARI_SURESI_MS = 2200;
export const BINDIRME_SURESI_MS = 1500;
/** Dil patlamasının birleştirme süresi: son dil olayından bu kadar sonra karar verilir. */
export const DIL_BIRLESTIRME_MS = 400;

export const uyariSuresi = (u: SistemUyarisi): number => (u.tur === 'ses' || u.tur === 'parlaklik' ? BINDIRME_SURESI_MS : UYARI_SURESI_MS);

/** Ayardaki anahtarlar; alan yoksa (eski ayar) ya da değer mantık değilse açık. */
export function uyariAnahtarlari(g: { uyarilar?: Partial<Record<UyariAnahtari, boolean>> } | undefined): Record<UyariAnahtari, boolean> {
  const a = g?.uyarilar;
  return Object.fromEntries(UYARI_ANAHTARLARI.map((k) => [k, a?.[k] !== false])) as Record<UyariAnahtari, boolean>;
}

/** Klavye kancası (yardımcıda Caps Lock ve dil) gerekli mi: yalnız bu iki uyarıdan biri açıkken. */
export const klavyeGerekli = (acik: Record<UyariAnahtari, boolean>): boolean => acik.caps || acik.dil;

const yuzde = (v: number): number => Math.round(Math.min(1, Math.max(0, v)) * 100);

/**
 * Bir sistem olayından hap (ya da null). `onceki`: olaydan ÖNCEKİ son bilinen hâl. Kapalı tür, tekrar ve tabanı bilinmeyen aç/kapa null; tam ekran, medya,
 * durum, hazır ve hata hap vermez. Dil olayı burada tek olay olarak değerlendirilir; patlamayı `DilBirlestirici` toplar.
 */
export function uyariUret(o: SistemOlayi, onceki: SistemDurumu, acik: Record<UyariAnahtari, boolean>): SistemUyarisi | null {
  switch (o.t) {
    case 'ses-aygiti': {
      if (!acik.kulaklik) return null;
      const a = onceki.sesAygiti;
      if (a && a.ad === o.ad && a.bagli === o.bagli) return null;
      const simge = o.tur === 'kulaklik' ? 'kulaklik' : 'hoparlor';
      if (!o.bagli) return { tur: 'kulaklik', metin: `${o.ad} ayrıldı`, simge };
      return { tur: 'kulaklik', metin: o.pil !== null ? `${o.ad} bağlandı · %${Math.round(o.pil)}` : `${o.ad} bağlandı`, simge };
    }
    case 'guc': {
      if (!acik.sarj || !onceki.guc || onceki.guc.sarj === o.sarj) return null;
      const ek = o.yuzde !== null ? ` · %${Math.round(o.yuzde)}` : '';
      return o.sarj ? { tur: 'sarj', metin: `Şarj takıldı${ek}`, simge: 'bolt' } : { tur: 'sarj', metin: `Şarj çıkarıldı${ek}`, simge: 'pil' };
    }
    case 'ses': {
      if (!acik.ses) return null;
      const s = onceki.ses;
      // Sessizken düzey değişse de "Sessiz" hapı yinelenmez (düzeltme turu 1, Minor 2).
      if (s && s.sessiz && o.sessiz) return null;
      if (s && s.sessiz === o.sessiz && yuzde(s.duzey) === yuzde(o.duzey)) return null;
      return o.sessiz ? { tur: 'ses', metin: 'Sessiz', duzey: 0, simge: 'sessiz' } : { tur: 'ses', metin: `Ses %${yuzde(o.duzey)}`, duzey: o.duzey, simge: 'hoparlor' };
    }
    case 'parlaklik':
      if (!acik.parlaklik || (onceki.parlaklik !== null && yuzde(onceki.parlaklik) === yuzde(o.duzey))) return null;
      return { tur: 'parlaklik', metin: `Parlaklık %${yuzde(o.duzey)}`, duzey: o.duzey, simge: 'gunes' };
    case 'caps':
      if (!acik.caps || onceki.caps === null || onceki.caps === o.acik) return null;
      return { tur: 'caps', metin: o.acik ? 'Büyük harf kilidi açık' : 'Büyük harf kilidi kapalı', simge: 'buyuk-harf' };
    case 'dil':
      if (!acik.dil || !onceki.dil || onceki.dil.kod === o.kod) return null;
      return { tur: 'dil', metin: `Klavye: ${o.ad}`, simge: 'kure' };
    case 'ag':
      if (!acik.ag || onceki.ag === null || onceki.ag === o.bagli) return null;
      return o.bagli ? { tur: 'ag', metin: 'İnternet bağlantısı geri geldi', simge: 'wifi' } : { tur: 'ag', metin: 'İnternet bağlantısı koptu', simge: 'wifi-yok' };
    default:
      return null;
  }
}

/** R25: hap şimdi gösterilebilir mi. Gösterilmeyen hap düşer (kuyruğa girmez). `tamEkran`: çentiğin İNECEĞİ ekranda. */
export function uyariGosterilsinMi(k: { anaOnde: boolean; kapali: boolean; tamEkran: boolean }): boolean {
  return !k.anaOnde && !k.kapali && !k.tamEkran;
}

/**
 * Hap nereye (düzeltme turu 1, Important 3): 'yok' — R25 kapısı (ana pencere önde, çentik kapalı/gizli, tam ekran); 'yaz' — çentik görünüyor, hap ona yazılır;
 * 'in' — çentik görünmüyor (ör. "Ada sessizken görünsün" kapalı): odak almadan iner, hapı gösterir, süre dolunca geri çekilir.
 */
export function uyariYolu(k: { anaOnde: boolean; kapali: boolean; tamEkran: boolean; gorunur: boolean }): 'yok' | 'yaz' | 'in' {
  if (!uyariGosterilsinMi(k)) return 'yok';
  return k.gorunur ? 'yaz' : 'in';
}

/**
 * 0.14 son inceleme I4: "Odak bitti" hapı sistem olayı DEĞİL, kullanıcının kendi kurduğu zamanlayıcıdır (hatırlatıcı gibi) — R25'in "düşer" kuralı ona
 * uygulanmaz. 'yok': çentik kapalı ya da 1 saat gizli (bugünkü davranış); 'tost': ana pencere önde — uygulama içi tost + zil; 'bekle': çentiğin ekranında tam
 * ekran — kuyrukta bekler, tam ekran bitince (olayla) yeniden karar verilir; 'yaz' / 'in': hap çentiğe (uyariYolu ile aynı).
 */
export type OdakBittiYolu = 'yok' | 'tost' | 'bekle' | 'yaz' | 'in';
export function odakBittiYolu(k: { anaOnde: boolean; kapali: boolean; tamEkran: boolean; gorunur: boolean }): OdakBittiYolu {
  if (k.kapali) return 'yok';
  if (k.anaOnde) return 'tost';
  if (k.tamEkran) return 'bekle';
  return k.gorunur ? 'yaz' : 'in';
}

type Zamanlayici = ReturnType<typeof setTimeout>;

/**
 * Dil patlamasını tek hapa indirir (T20 kararı): Alt+Shift iki kez A→B→A verir. İlk dil olayında patlamadan önceki dil saklanır; her olay süreyi yeniden
 * başlatır; son olaydan `DIL_BIRLESTIRME_MS` sonra son dil patlama öncesiyle karşılaştırılır — aynıysa hap yok, değilse tek hap (son anın anahtarlarıyla).
 */
export class DilBirlestirici {
  private zaman: Zamanlayici | null = null;
  private baslangic: SistemDurumu['dil'] = null;
  private son: Extract<SistemOlayi, { t: 'dil' }> | null = null;
  private acik: Record<UyariAnahtari, boolean> | null = null;
  private readonly bildir: (u: SistemUyarisi) => void;

  constructor(bildir: (u: SistemUyarisi) => void) { this.bildir = bildir; }

  olay(o: Extract<SistemOlayi, { t: 'dil' }>, onceki: SistemDurumu, acik: Record<UyariAnahtari, boolean>): void {
    if (!this.zaman) this.baslangic = onceki.dil && { ...onceki.dil };
    else clearTimeout(this.zaman);
    this.son = o;
    this.acik = acik;
    this.zaman = setTimeout(() => this.karar(), DIL_BIRLESTIRME_MS);
  }

  /** Bekleyen karar iptal (uygulama kapanıyor). */
  kapat(): void {
    if (this.zaman) clearTimeout(this.zaman);
    this.zaman = null;
  }

  private karar(): void {
    this.zaman = null;
    const son = this.son, acik = this.acik;
    if (!son || !acik) return;
    const u = uyariUret(son, { guc: null, ag: null, sesAygiti: null, ses: null, parlaklik: null, caps: null, dil: this.baslangic, tamEkran: null, medya: null }, acik);
    if (u) this.bildir(u);
  }
}
