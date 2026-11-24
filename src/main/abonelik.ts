// ── Motor sinyali (Ruling K): ana sürecin tek doğruluk kaynağı ──────────────────────────────────────────────────────────────────
// Dosya adı eskiden kalmadır: Fuber aboneliği GÖSTERİMİ (Görev 14; `abonelik:al` / `abonelik:islem`, ayarlar.json'daki `abonelik` alanı,
// aylık gösterim faturası) 0.11 G8'de arayüzden, G12a'da ana süreçten de TAMAMEN kalktı (satın alınamayan bir abonelik yüzeyi
// bozuk görünür; Ayarlar → Hesap ve kullanım: shared/hesap-kullanim.ts). Burada yalnız `motor:durum` sinyali kalır.
import { ayarlar } from './ayarlar.js';
import { simdi } from './saat.js';
import { hazirMotorlar } from './motor/secici.js';
import { tekMotorYolu, yalnizYerelTurMu } from './motor/yerel.js';
import { yerelIndirmeDurumu, yerelInenModel, yerelKaldiriliyorMu } from './yerel/kurulum.js';
import { yerelHazirlaniyor } from '../shared/kurulum-yerel.js';
import type { MotorSinyali } from '../shared/abonelik.js';

/**
 * Motor sinyali — TEK kaynak (Ruling K): hazır bulut motoru sayısı ve yerel beynin yanıt verebilmesi — sohbetin kullandığı yolun aynısı
 * (motor/yerel.ts tekMotorYolu: Gizli modda bulut motoru — Fuber hesabı dahil — sayılmaz; Fuber hesabı ana süreç onun anahtarını
 * kullanabiliyorsa sayılır), `gizli` Gizli mod (arayüz bildirimi buna göre; G2 düzeltme turu 1: arayüz bulutu ayarlardan yeniden
 * hesaplamaz) ve ana sürecin saat kayması (yalnız FUBER_DEMO test saati; arayüz süreli durumları ana sürecin saatiyle hesaplar).
 * 'motor:durum' olayıyla da yayınlanır (main.ts: ayar, yerel beyin, saat).
 */
/** Takip turu: "Yalnız bu bilgisayar" seçiliyken yerel hazırlanıyor mu — telefon/ada notunun cümlesi için (ajan/dongu.ts). */
export function yalnizHazirlik(): 'iniyor' | 'yarim' | null {
  const s = motorDurumu();
  return s.yalnizYerelIstendi && s.hazirlaniyor ? (s.yarim ? 'yarim' : 'iniyor') : null;
}

/** 0.12 cila düzeltme turu 1 (inceleme d): Gizli açıkken yerel hazırlanıyor mu — sohbet kaydına düşen notun sakin cümlesi için (ajan/dongu.ts). */
export function gizliHazirlik(): 'iniyor' | 'yarim' | null {
  const s = motorDurumu();
  return s.gizli && s.hazirlaniyor ? (s.yarim ? 'yarim' : 'iniyor') : null;
}

export function motorDurumu(): MotorSinyali & { gizli: boolean; hazirlaniyor: boolean; yarim: boolean; saatKaymasi: number } {
  const yol = tekMotorYolu();
  const y = ayarlar().yerel;
  const iniyor = Boolean(yerelInenModel());
  // F1 (Ö2): yerel yanıt vermiyorken hazırlanıyor mu (indirme sürüyor ya da istenmiş kurulumun kaydı hatasız; shared/kurulum-yerel.ts
  // yerelHazirlaniyor) — Gizli modda kırmızı "hazır değil" yerine nötr "hazırlanıyor" (shared/motor-durumu.ts motorGorunumu). Düzeltme turu 1
  // (K-1): `yarim` — hazırlanıyor ama hiçbir şey inmiyor (kayıt kaldı, indirme yarıda): satır "yarıda kaldı; sürdürünce" der.
  const hazirlaniyor = yol !== 'yerel' && yerelHazirlaniyor({ iniyor, bekleyen: y.bekleyenKurulum, kaldiriliyor: yerelKaldiriliyorMu() });
  // 0.11 G8 (K2): yol bilinçli "yalnız yerel" tercihiyle yerelse (Gizli değil) sinyal bunu söyler; yalnız true iken yazılır (eski biçim aynen).
  const yalnizYerel = yalnizYerelTurMu();
  // 0.12 H3c: "Yalnız bu bilgisayar" SEÇİLİ (Gizli kapalı) — yerel henüz hazır olmasa da; bulutsuzken görünüm nötr "hazırlanıyor" olur
  // (shared/motor-durumu.ts motorGorunumu). Yalnız true iken yazılır (eski biçim aynen).
  const yalnizYerelIstendi = y.yalnizYerel === true && y.gizliMod !== true;
  // Düzeltme turu 1 (P14 K1): seçiliyken inen yapay zekânın yüzdesi ("iniyor · %X"; ilerleme yerelBildir ile yayınlanır).
  const ind = yalnizYerelIstendi && iniyor ? yerelIndirmeDurumu() : undefined;
  const yerelYuzde = ind && !ind.hata && ind.yuzde < 100 ? ind.yuzde : undefined;
  return {
    bulut: yol === 'bulut' ? hazirMotorlar().length : 0, yerel: yol === 'yerel', gizli: y.gizliMod === true, hazirlaniyor, yarim: hazirlaniyor && !iniyor, saatKaymasi: simdi() - Date.now(),
    ...(yalnizYerel ? { yalnizYerel: true } : {}), ...(yalnizYerelIstendi ? { yalnizYerelIstendi: true } : {}),
    ...(yerelYuzde !== undefined ? { yerelYuzde } : {}),
  };
}
