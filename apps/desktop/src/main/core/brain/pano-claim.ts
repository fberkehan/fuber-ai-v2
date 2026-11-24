// Pano (Kokpit) iddiası: yerel küçük model "hava durumunu en üste taşıdım" diyor ama `dashboard_card_move` çağırmıyordu
// (tasarım ölçümü: "dövizin yanına koy" 0/3). Beynin iddia kapısı (`core/brain.ts` › ACTION_CLAIM) turda HERHANGİ bir
// başarılı araç varsa cümleyi geçirir; pano cümlesi ise ancak o turda başarılı bir PANO aracı varsa geçer. Öteki
// kümelerin kuralları değişmez: bu yalnız ek bir koşuldur.

/** Yalnız panoda anlamlı fiiller: bağlamsız da iddiadır. */
const PANO_ONLY = /(?<!\p{L})(büyüttüm|büyütüyorum|büyüteceğim|büyütüldü|küçülttüm|küçültüyorum|küçülteceğim|küçültüldü)(?!\p{L})/iu;
/** Başka işlerde de geçen fiiller (dosya taşıma, bilgi alma, hatırlatıcı ekleme): yalnız pano/yer sözüyle iddiadır. */
const PLACE_VERB =
  /(?<!\p{L})(taşıdım|taşıyorum|taşıyacağım|taşındı|koydum|koyuyorum|koyacağım|kondu|aldım|alıyorum|alacağım|alındı|yerleştirdim|yerleştiriyorum|yerleştireceğim|kaldırdım|kaldırıyorum|kaldıracağım|ekledim|ekliyorum|ekleyeceğim|sıraladım|dizdim|sıfırladım)(?!\p{L})/iu;
const PANO_PLACE =
  /(?<!\p{L})(kart\p{L}*|pano\p{L}*|ana ekran\p{L}*|kokpit\p{L}*|kutu\p{L}*|en üst\p{L}*|üste|üstüne|yukarı\p{L}*|aşağı\p{L}*|en alta|alta|yanına|yanındaki|başa|başına|sona|sonuna)(?!\p{L})/iu;

/** Cümle panoda bir değişiklik yapıldığını (ya da yapılacağını) söylüyor mu. */
export function claimsPanoChange(sentence: string): boolean {
  return PANO_ONLY.test(sentence) || (PLACE_VERB.test(sentence) && PANO_PLACE.test(sentence));
}

const PANO_TOOL = /^(dashboard_|suggestion_)/;

/** Pano iddiası var ama bu turda başarılı bir pano aracı çağrılmadı: cümle söylenmez. */
export function unfoundedPanoClaim(sentence: string, calls: ReadonlyArray<{ name: string; ok: boolean }>): boolean {
  return claimsPanoChange(sentence) && !calls.some((call) => call.ok && PANO_TOOL.test(call.name));
}
