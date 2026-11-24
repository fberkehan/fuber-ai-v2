// ── Fintech hareket dili: yay eğrisi (saf; birim testli: tests/kurulum-v2.test.ts) ──────────────────────────────────────────────────
// Apple'ın akışkan arayüz ilkesi: geçişler sabit süreli bir "ease" değil, YAY gibi davranır (Designing Fluid Interfaces, WWDC 2018).
// Apple iki parametreyle düşünür: `tepki` (response, sn — hedefe ne çabuk varır) ve `sonum` (damping ratio — 1 = aşmadan oturur, < 1 hafif
// sekme). CSS'te yay yok; burada yayın konum eğrisi örneklenip `linear()` zamanlama işlevine çevrilir. fintech.css bu dizgeleri AYNEN taşır
// (--ft-yay, --ft-yay-sek); test, CSS'teki dizgenin bu fonksiyonun çıktısıyla aynı olduğunu denetler (tek kaynak).
//   · Adım geçişi: sonum 1, tepki 0,42 sn (spec: ~420 ms yay; içerik 24 px kayar, önizleme 60 ms sonra).
//   · Seçim halkası / basma bırakılınca: sonum 0,82 (yalnız dokunuşun kendisi bir "itme" olduğunda hafif sekme; Apple'ın kuralı).
// Azaltılmış harekette yay kullanılmaz: yalnız opaklık (fintech.css @media prefers-reduced-motion).

/** Yayın t saniyedeki konumu (0 → 1). `tepki`: response (sn), `sonum`: damping ratio. */
export function yayKonumu(t: number, tepki: number, sonum: number): number {
  const w = (2 * Math.PI) / tepki;
  if (sonum >= 1) return 1 - (1 + w * t) * Math.exp(-w * t);
  const wd = w * Math.sqrt(1 - sonum * sonum);
  return 1 - Math.exp(-sonum * w * t) * (Math.cos(wd * t) + ((sonum * w) / wd) * Math.sin(wd * t));
}

/** Yayın CSS karşılığı: `linear()` eğrisi ve süresi (ms). Eğri `sure` boyunca `nokta` örnekle çizilir, son nokta tam 1'dir. */
export function yayEgrisi(o: { tepki?: number; sonum?: number; nokta?: number } = {}): { egri: string; sure: number } {
  const tepki = o.tepki ?? 0.42;
  const sonum = o.sonum ?? 1;
  const nokta = o.nokta ?? 18;
  // Kritik sönümlü yay ~1 tepkide %98,6'ya varır; sekmeli yay biraz daha uzun salınır.
  const sure = tepki * (sonum >= 1 ? 1 : 1.35);
  const l: string[] = [];
  for (let i = 0; i <= nokta; i++) {
    const v = i === nokta ? 1 : yayKonumu((i / nokta) * sure, tepki, sonum);
    l.push(String(Math.round(v * 1000) / 1000));
  }
  return { egri: `linear(${l.join(', ')})`, sure: Math.round(sure * 1000) };
}

/** fintech.css'teki belirteçler (adım geçişi ve sekmeli seçim). */
export const YAY = yayEgrisi();
export const YAY_SEK = yayEgrisi({ tepki: 0.36, sonum: 0.82 });
/** Önizleme sütunu içerikten bu kadar sonra değişir (spec: ayrı ritim). */
export const ONIZLEME_GECIKMESI_MS = 60;
/** İçeriğin adım geçişindeki kayma payı (px; spec). */
export const GECIS_KAYMASI_PX = 24;
