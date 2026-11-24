// ── Bulutsuz kipin ses parçaları (0.14.1; saf, birim testli: tests/yerel-ses-kurulum.test.ts) ─────────────────────────────────────────
// 5 Kas: uygulama ilk kurulurken yerel ses modellerini indirip kurmalı; Gizli modda sürekli "indirmen lazım" deniyordu.
// Gizli ve "Yalnız bu bilgisayar"da ses bu bilgisayardan çıkmaz: yazıya çevirme yerel Whisper, Fuber'in sesi yerel Piper. Yerel beyin kurulumu
// (main/yerel/kurulum.ts kur) ikisini de aynı akışta indirir. Bu karar, yerel beyin ZATEN kuruluyken (0.14.0'dan kalan kurulum, yarıda kalmış
// ses indirmesi) eksik parçanın ne zaman tamamlanacağını söyler: bulutsuz kip seçiliyken, yerel beyin hazırken ve başka indirme sürmüyorken.

export interface YerelSesGirdisi {
  /** Gizli ya da "Yalnız bu bilgisayar" seçili. */
  bulutsuz: boolean;
  /** Yerel beyin kurulu ve açık (yerel.etkin + dosyalar). */
  yerelHazir: boolean;
  /** Yerel beyin kurulumu sürüyor (o akış sesi zaten indirir) ya da kaldırılıyor. */
  yerelMesgul: boolean;
  whisperKurulu: boolean;
  whisperIniyor: boolean;
  piperKurulu: boolean;
  piperIniyor: boolean;
}

/** Hangi ses parçası şimdi (arka planda) indirilmeli. */
export function yerelSesEksikleri(g: YerelSesGirdisi): { whisper: boolean; piper: boolean } {
  if (!g.bulutsuz || !g.yerelHazir || g.yerelMesgul) return { whisper: false, piper: false };
  return { whisper: !g.whisperKurulu && !g.whisperIniyor, piper: !g.piperKurulu && !g.piperIniyor };
}
