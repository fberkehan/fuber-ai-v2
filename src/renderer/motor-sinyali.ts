// Motor sinyali — arayüzün TEK kaynağı (Ruling K): sohbet şeridi ve yazı alanı, kokpit hapı ve sohbet başlığı aynı kancayı okur, aynı
// hali ve aynı etiketi gösterir. Bulut, yerel beyin ve Gizli mod ANA SÜREÇTEN ('motor:durum' → main/abonelik.ts motorDurumu: sohbetin
// kullandığı tekMotorYolu — Gizli modda bulut 0; G2 düzeltme turu 1: bulut artık ayarlardan yeniden hesaplanmaz, Gizli modda arayüz ile
// ana süreç ayrışıyordu). Ana süreç sinyali her ayar değişikliğinde de yayınlar (main.ts motorBildir). Ayarlardan yalnız mod, P3
// (motorCalisti) ve Fuber hesabının hâli okunur.
// Ana süreç saat kaymasını da bildirir (yalnız FUBER_DEMO test saati): süreli durumlar ana süreçle aynı saatle hesaplanır.
// Son bilinen değerler modülde: sonradan takılan bileşen beklemeden doğru hal ile başlar; ikisi de gelene dek `hazir` false.
import { useEffect, useState } from 'react';
import { cagir, dinle } from './api';
import { motorHali, type MotorHali, type MotorSinyali } from '../shared/abonelik';
import { gonderimAcikMi, kopmaSayilirMi, motorGorunumu, type MotorEylemi, type MotorGorunumu } from '../shared/motor-durumu';
import { aracsizMi } from '../shared/kokpit-istemleri';
import type { HesapDurumu } from '../shared/masaustu-hesap';
import { anaSimdi, saatKaymasiYaz } from '../shared/saat-kaymasi';
import type { Ayarlar, Mod } from '../shared/tipler';

interface AnaSinyal { bulut: number; yerel: boolean; gizli: boolean; hazirlaniyor: boolean; yarim: boolean; yalnizYerel: boolean; yalnizYerelIstendi: boolean; yerelYuzde?: number; saatKaymasi: number }
let sonAyar: Ayarlar | null = null;
let sonSinyal: AnaSinyal | null = null;

// F1 (Ö2): `hazirlaniyor` — bu bilgisayardaki yapay zekâ hazırlanıyor (ana süreç: shared/kurulum-yerel.ts yerelHazirlaniyor); Gizli modda
// kırmızı "hazır değil" yerine nötr 'hazirlaniyor' (shared/motor-durumu.ts motorGorunumu). Arayüz bunu kendisi hesaplamaz.
const sinyalOku = (x: unknown): AnaSinyal => {
  const s = (x ?? {}) as { bulut?: unknown; yerel?: unknown; gizli?: unknown; hazirlaniyor?: unknown; yarim?: unknown; yalnizYerel?: unknown; yalnizYerelIstendi?: unknown; yerelYuzde?: unknown; saatKaymasi?: unknown };
  const yuzde = typeof s.yerelYuzde === 'number' && Number.isFinite(s.yerelYuzde) ? Math.max(0, Math.min(99, Math.round(s.yerelYuzde))) : undefined;
  return { bulut: Math.max(0, Number(s.bulut) || 0), yerel: Boolean(s.yerel), gizli: s.gizli === true, hazirlaniyor: s.hazirlaniyor === true, yarim: s.yarim === true, yalnizYerel: s.yalnizYerel === true, yalnizYerelIstendi: s.yalnizYerelIstendi === true, ...(yuzde !== undefined ? { yerelYuzde: yuzde } : {}), saatKaymasi: Number(s.saatKaymasi) || 0 };
};

// B5 (G14, son düzeltme): modül önbelleği eskiden yalnız TAKILI bir kancayla güncelleniyordu — hiçbir bileşen kancayı kullanmazken
// (ör. Hafıza sayfası) motor değişirse, sonradan takılan bileşen bir an eski hal ile (eski kırmızı/açık) başlıyordu. Önbellek artık
// modül yüklenince bir kez kurulan kalıcı dinleyicilerle her zaman güncel; kancalar yalnız yeniden çizim için dinler.
if (typeof window !== 'undefined' && window.fuber) {
  const ayarOnbellek = (y: Ayarlar) => { sonAyar = y; };
  const sinyalOnbellek = (x: unknown) => { sonSinyal = sinyalOku(x); saatKaymasiYaz(sonSinyal.saatKaymasi); };
  dinle('ayarlar:degisti', ayarOnbellek);
  dinle('motor:durum', sinyalOnbellek);
  void cagir<Ayarlar>('ayarlar:al').then((y) => { sonAyar ??= y; }).catch(() => undefined);
  void cagir('motor:durum').then((x) => { if (!sonSinyal) sinyalOnbellek(x); }).catch(() => undefined);
}

export interface MotorDurumu {
  a: Ayarlar | null;
  mod: Mod;
  /** Ana sürecin sinyali (bulut, yerel, gizli). */
  motor: MotorSinyali;
  hal: MotorHali;
  /** Gizli mod açık (sinyalden): bildirim, hap ve hata metinleri Gizli moda göre. */
  gizli: boolean;
  /** Bu turlarda araç YOK (Gizli mod ya da "Yalnız bu bilgisayardaki yapay zekâ"): boş sohbet önerileri ve kokpit istemleri araçsız listeye düşer
   *  (shared/kokpit-istemleri.ts aracsizMi). `gizli` yalnız Gizli'nin KENDİ sözleri içindir (ağa çıkmama, "Gizli mod" metinleri). */
  aracsiz: boolean;
  /** 0.10 Görev 2: yedi hâlden biri (shared/motor-durumu.ts motorGorunumu: hesap hâlleri ve P3 motorCalisti dahil) — bildirimin kaynağı. */
  gorunum: MotorGorunumu;
  /** Sohbetten gönderim açık mı (bulut ya da yerel model; hesap onay beklerken de yerel model yanıtlar). */
  gonderilebilir: boolean;
  /** Masaüstü Fuber hesabının hâli (yoksa null). */
  hesapDurumu: HesapDurumu | null;
  /** Ana sürecin saati (ms). */
  simdi: number;
  /** Ayarlar ve ana süreç sinyali geldi (öncesinde hal çizilmez: titreme yok). */
  hazir: boolean;
}

/** Canlı ayarlar + ana süreç motor sinyali; dakikada bir yeniden çizim (süreli durumlar). */
export function useMotorSinyali(): MotorDurumu {
  const [a, setA] = useState<Ayarlar | null>(sonAyar);
  const [s, setS] = useState<AnaSinyal | null>(sonSinyal);
  const [, setN] = useState(0);
  useEffect(() => {
    const ayarYaz = (y: Ayarlar) => { sonAyar = y; setA(y); };
    const sinyalYaz = (x: unknown) => { sonSinyal = sinyalOku(x); saatKaymasiYaz(sonSinyal.saatKaymasi); setS(sonSinyal); };
    void cagir<Ayarlar>('ayarlar:al').then(ayarYaz).catch(() => undefined);
    void cagir('motor:durum').then(sinyalYaz).catch(() => undefined);
    const k1 = dinle('ayarlar:degisti', ayarYaz);
    const k2 = dinle('motor:durum', sinyalYaz);
    const z = setInterval(() => setN((n) => n + 1), 60_000);
    return () => { k1(); k2(); clearInterval(z); };
  }, []);
  // Bulut/yerel/Gizli ana süreçten (Fuber hesabı ana süreç onun anahtarını kullanabiliyorsa sayılır; Gizli modda hiçbir bulut motoru).
  const motor: MotorSinyali = { bulut: s?.bulut ?? 0, yerel: Boolean(s?.yerel), gizli: Boolean(s?.gizli), hazirlaniyor: Boolean(s?.hazirlaniyor), yarim: Boolean(s?.yarim), ...(s?.yalnizYerel ? { yalnizYerel: true } : {}), ...(s?.yalnizYerelIstendi ? { yalnizYerelIstendi: true } : {}), ...(s?.yerelYuzde !== undefined ? { yerelYuzde: s.yerelYuzde } : {}) };
  const hesapDurumu = a?.hesap?.durum ?? null;
  return {
    a, mod: a?.mod === 'gelistirici' ? 'gelistirici' : 'is', motor, hal: motorHali(motor), gizli: Boolean(s?.gizli), aracsiz: aracsizMi(motor), simdi: anaSimdi(), hazir: Boolean(a && s),
    gorunum: motorGorunumu(motor, a ? kopmaSayilirMi(a) : false, hesapDurumu), gonderilebilir: gonderimAcikMi(motor), hesapDurumu,
  };
}

/** Motor bildiriminin düğmesi (kokpit kartı, sohbet şeridi, ada, kokpit çipleri): 'hesap' Fuber hesabı penceresini ana pencerede açar
 *  (ana:goster → ana:git 'fuber-hesabi'; ada ayrı penceredir, aynı yol), 'yeniden-dene' hesabın hâlini sunucuya yeniden sordurur; çapa
 *  Ayarlar'ın o yerini açar ('yapay-zeka/motorlar' …). H3c düzeltme turu 1 (P14 K1): 'yerel-kur' bu bilgisayardaki yapay zekâyı yeniden
 *  indirir (kartlarda YerelYenidenIndir.tsx; burada Ayarlar → Nerede çalışsın), 'fuber-sec'
 *  Nerede'yi Fuber yapar (kullanıcının açık seçimi; kurulamamış isteğin kaydı da düşer). */
export function motorEylemiYap(d: { eylem?: MotorEylemi; cipa?: string }): void {
  if (d.eylem === 'hesap') void cagir('ana:goster', 'ayarlar#motor').catch(() => undefined);
  else if (d.eylem === 'yeniden-dene') void cagir('motor:durum').catch(() => undefined);
  // Düzeltme turu 2: kartlar "Yeniden indir"i kendileri çizer (bilesenler/YerelYenidenIndir.tsx: sürüm, boyut, boyutlu onay); başka bir yerden
  // gelirse kurulum tek yerde — Ayarlar → Gizlilik → Nerede çalışsın (onaylı).
  else if (d.eylem === 'yerel-kur') void cagir('ana:goster', 'ayarlar#gizli-mod').catch(() => undefined);
  else if (d.eylem === 'fuber-sec') void fuberleDevam();
  else if (d.cipa) void cagir('ana:goster', `ayarlar#${d.cipa}`).catch(() => undefined);
}

/** "Fuber’le devam et": Nerede = Fuber (yalnız bu açık tıklamayla; kendiliğinden geçilmez). */
async function fuberleDevam(): Promise<void> {
  const a = sonAyar ?? await cagir<Ayarlar>('ayarlar:al').catch(() => null);
  await cagir('ayarlar:kaydet', { yerel: { yalnizYerel: false } }).catch(() => undefined);
  if (a?.yerel.bekleyenKurulum?.hata) void cagir('yerel:bekleyen-vazgec').catch(() => undefined);
}

/** Ana sürecin saati (süreli abonelik durumları için); kaymayı 'motor:durum'dan alır, dakikada bir yeniden çizer. */
export function useAnaSaat(): number {
  const [, setN] = useState(0);
  useEffect(() => {
    const yaz = (x: unknown) => { sonSinyal = sinyalOku(x); saatKaymasiYaz(sonSinyal.saatKaymasi); setN((n) => n + 1); };
    void cagir('motor:durum').then(yaz).catch(() => undefined);
    const k = dinle('motor:durum', yaz);
    const z = setInterval(() => setN((n) => n + 1), 60_000);
    return () => { k(); clearInterval(z); };
  }, []);
  return anaSimdi();
}
