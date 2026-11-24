// ── Sohbet görünümünde ham mesajların yeri (saf; birim testli: tests/sohbet-gorunum.test.ts; main/sohbet.ts gorunume kullanır) ──────────
// Görev 26 (gerçek motorla uçtan uca):
//  • Fuber'in KENDİLİĞİNDEN başlattığı turun tetikleyicisi (ajan/dongu.ts `gizliTetik`: rol 'not', kaynak 'proaktif') modele giden İÇ
//    talimattır ("KURULUM BİTTİ: Kullanıcıyla ilk kez tanışıyorsun…", sabah özeti talimatı): görünümde GÖSTERİLMEZ (eskiden kurulumdan
//    hemen sonra ana sohbetin en üstünde gri bir hap olarak görünüyordu). Kayıt veritabanında kalır (geçmiş ve modelin bağlamı aynı).
//  • Fuber balonları YALNIZ aynı turun araç döngüsünde birleşir (asistan → araç sonucu → asistan). Eskiden ardışık HER asistan mesajı
//    birleşiyordu: Claude Code'un iş bitti özeti, eşlikçinin sözü, günlük rapor ve sabah özeti önceki yanıtın balonuna (onun saatiyle)
//    ekleniyor, ayrı bir mesaj olarak görünmüyordu.

export interface HamMesajIzi { rol: string; kaynak?: string | null; aracSonucu: boolean }
/** 'atla': görünmez (araç sonucu — kartına birleşti; kendiliğinden turun iç talimatı). 'devam': aynı turun araç döngüsü (önceki Fuber
 *  balonu varsa ona eklenir). 'yeni': kendi balonu. */
export type GorunumYeri = 'atla' | 'devam' | 'yeni';

/** G26 küçüğü (ajan/dongu.ts tur sonu balonu): yalnız bu turun kaydettiği mesajlar — tur sürerken aynı sohbete yazılan eşlikçi sözü,
 *  Claude Code özeti ya da sabah özeti turun "son Fuber mesajı" sayılmaz. */
export function turunMesajlari<T extends { id: number }>(liste: readonly T[], turIdleri: readonly number[]): T[] {
  const kendi = new Set(turIdleri);
  return liste.filter((m) => kendi.has(m.id));
}

export function gizliTetikMi(m: { rol: string; kaynak?: string | null }): boolean {
  return m.rol === 'not' && m.kaynak === 'proaktif';
}

/** 0.12 cila: "Yalnız bu bilgisayar" seçiliyken yerel yapay zekâ HAZIRLANIRKEN (iniyor / yarıda) yazılan iletinin ardından kayda düşen sakin
 *  bekleme notunun kaynağı (ajan/dongu.ts). Görünümde gri not olarak durur; bir durumdur, sohbet iletisi değil. */
export const HAZIRLIK_NOTU_KAYNAGI = 'hazirlik';

/** 0.14 T13 (R24): tur 100 adım sınırına geldi — kayda düşen dürüst notun kaynağı (ajan/zincir.ts tavanMetni). Bu not sohbetin son iletisiyken
 *  ve tur sürmüyorken sohbet "Devam et" düğmesini gösterir (renderer/bilesenler/Sohbet.tsx). */
export const TAVAN_NOTU_KAYNAGI = 'tavan';
/** "Devam et"in açtığı yeni turun görünen metni (R24). Son kullanıcı iletisinden sonra tavan notu varken bu cümle gelirse ajan döngüsü bağlama son 5
 *  adımın etiketini ekler (ajan/zincir.ts devamMi); telefondan elle yazılan aynı cümle de aynı yoldan sürer. */
export const DEVAM_METNI = 'Kaldığın yerden devam et.';
/** Tavanın kısa metni: düğmesi olmayan yüzeyler (eski telefon uygulaması, ada) için — sürdürmenin yolunu söyler. Kayıttaki not R24'ün tam metnidir. */
// 11 Kas (tasarımcı bulgu 7): çentikte ve telefonda iç sınır sayısı ("Adım sınırına geldim (100)") görünmez; insan diliyle tek cümle. `adim` imzada kalır.
export const tavanKisaMetni = (_adim: number): string => `Uzun bir işti, burada durdum. Sürdürmemi istersen sohbette Devam et'e bas ya da "${DEVAM_METNI}" yaz.`;

/**
 * İş izi işi (11 Kas, bulgu 7): kayıtlı sohbet notlarında iç sınır sayısı görünmez. Eski kayıtlarda "Adım sınırına geldim (100)." (sohbet turu) ve görev
 * sohbetinde "adım sınırına (30) geldi" yazıyordu; görünümde insan diline çevrilir (main/sohbet.ts gorunume). Yeni kayıtlar zaten bu dilde yazılır.
 */
export function sinirSayisiniGizle(metin: string): string {
  return metin
    .replace(/Adım sınırına geldim \(\d+\)\.?\s*/g, 'Uzun bir işti, burada durdum. ')
    .replace(/yarım kaldı: adım sınırına \(\d+\) geldi/g, 'uzun sürdü, burada durdum')
    .replace(/adım sınırına \(\d+\) geldi/g, 'uzun sürdü')
    .replace(/adım sınırında \(\d+\)/g, 'adım sınırında');
}

/** Sohbet listesinin önizlemesine ("Son sohbetler") girmeyen kayıt: kendiliğinden turun iç talimatı (G1) ve hazırlanma notu (0.12 cila;
 *  indirme durup bittikten sonra da "iniyor" diye önizlemeyi işgal ediyordu) — önizleme bir önceki gerçek iletidir. */
export function onizlemeDisiMi(m: { rol: string; kaynak?: string | null }): boolean {
  return gizliTetikMi(m) || (m.rol === 'not' && m.kaynak === HAZIRLIK_NOTU_KAYNAGI);
}

/** Turun dışından, tek başına yazılan Fuber mesajları (Claude Code özeti, eşlikçinin sözü, sabah özeti/rapor duyurusu): hiçbir balona
 *  eklenmez ve hiçbir şey onlara eklenmez (ör. eşlikçi araç döngüsünün ortasına düşerse döngünün devamı ona yapışmaz). */
const BAGIMSIZ = new Set(['claudecode', 'eslikci', 'proaktif']);

/**
 * Son inceleme (G26 küçüğü): bir turun `pause_turn` devamı (sunucu aracı uzun sürünce model duraklar, ajan/dongu.ts aynı turda yeniden
 * çağırır; arada araç sonucu YOK) ikinci bir asistan mesajı olarak kaydolur — eskiden ayrı balona bölünüyordu. Artık turun Fuber yanıtı
 * hemen ardından gelen turun Fuber mesajıyla (araç sonucu arada olsun olmasın) tek balondur. Turlar arasında her zaman bir kullanıcı
 * mesajı ya da iç talimat (atla) vardır; turun dışından yazılan Fuber mesajları (BAGIMSIZ) birleşmeyi keser.
 */
export function gorunumYerleri(liste: readonly HamMesajIzi[]): GorunumYeri[] {
  let oncekiTurYaniti = false; // son görünen mesaj bu turun Fuber yanıtı mı (birleşme hedefi olabilir mi)
  return liste.map((m) => {
    // Araç sonucu kartına birleşir; turun yanıtı birleşme hedefi olarak kalır (araç döngüsü).
    if (m.rol === 'user' && m.aracSonucu) return 'atla';
    if (gizliTetikMi(m)) { oncekiTurYaniti = false; return 'atla'; }
    const bagimsiz = BAGIMSIZ.has(m.kaynak ?? '');
    const yer: GorunumYeri = m.rol === 'assistant' && !bagimsiz && oncekiTurYaniti ? 'devam' : 'yeni';
    oncekiTurYaniti = m.rol === 'assistant' && !bagimsiz;
    return yer;
  });
}
