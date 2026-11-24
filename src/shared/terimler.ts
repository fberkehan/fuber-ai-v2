// ── Tek sözlük (0.10 Görev 3, P2; A-4 = C-5): aynı kavram her ekranda aynı adla (saf; birim testli: tests/terimler.test.ts) ─────────────
// Denetim: Bulut yapay zekâ dört adla anılıyordu (motor, beyin, bulut beyni, yerel beyin), gün kaydı "Düşünme motoru"ydu. 3B beyin
// kalkınca (D1) "beyin" mecazı da kalktı: masaüstü arayüzünde hiç yok; "motor" yalnız Geliştirici'de (İş dili: is-dili.ts IS_YASAK).
//   Kavram                  İş                              Geliştirici
//   bulut yapay zekâ        Fuber’in yapay zekâsı           motor (Claude, OpenAI, OpenRouter, Fuber hesabı)
//   yerel model             bu bilgisayardaki yapay zekâ    yerel model
//   Düşünme motoru          Gün kaydı                       Gün kaydı
//   Proaktif Fuber          Fuber kendiliğinden yazsın      (aynı)
//   Ajanlar                 Not tutma ve raporlar           (aynı)
//   döküm (gün kaydı)       yazıya dökülen konuşma          (aynı)
//   Meseleler               Takip edilecekler               (aynı)
//   Çekirdek (hafıza)       Sabit                           (aynı)
//   yapılacak (checklist)   Yapılacaklar                    (aynı)
//   süreli iş               Görevler                        (aynı)
// Cümle başında `buyukBasla` ("Bu bilgisayardaki yapay zekâ indiriliyor"); ekler okunuşa göre elle yazılır ("…zekâyla", "…zekâsıyla").
export const TERIM = {
  yzBulut: 'Fuber’in yapay zekâsı',
  yzYerel: 'bu bilgisayardaki yapay zekâ',
  yerelModel: 'yerel model',
  gunKaydi: 'Gün kaydı',
  kendiliginden: 'Fuber kendiliğinden yazsın',
  notlarRaporlar: 'Not tutma ve raporlar',
  dokum: 'yazıya dökülen konuşma',
  takip: 'Takip edilecekler',
  sabit: 'Sabit',
  // 0.11 G4: kokpit kartı "Yapılacaklar" (işaretle, üstü çizilir; ertesi gün hafızaya geçer). "Görevler" süreli/sürekli işlere gider
  // (G9–G10); kodda o işlerin adı `is`/`isler`, mevcut `gorev*` yapılacaklar kodudur ve adı değişmez.
  yapilacaklar: 'Yapılacaklar',
  gorevler: 'Görevler',
  gorev: 'Görev',
} as const;

/** İlk harf büyük (Türkçe: "i" → "İ"). */
export const buyukBasla = (s: string): string => s.charAt(0).toLocaleUpperCase('tr') + s.slice(1);

/** Yerel modelin moda göre adı: İş'te "bu bilgisayardaki yapay zekâ", Geliştirici'de "yerel model" (`sade`: İş modu). */
export const yerelAdi = (sade: boolean): string => (sade ? TERIM.yzYerel : TERIM.yerelModel);
