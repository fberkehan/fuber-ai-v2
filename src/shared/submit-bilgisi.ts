// ── Submit izcisinin form bilgisi (0.14 T15, düzeltme turu 4: K3; saf → tests/submit-izci.test.ts, tests/form-gonderimi.test.ts) ─────────────
// İzci (src/preload/submit-izci.ts) DOM `submit` olayıyla birlikte formun ARAMA olup olmadığını bildirir: arama onaysızdır, onun submit'i ağ kalkanını
// kurmaz. Bu dosya içe aktarım almaz: izciyle birlikte her çerçevenin önyüklemesine paketlenir (küçük kalmalı).

/** K3: izcinin bildirdiği form özellikleri. */
export interface SubmitBilgisi {
  /** Yöntem açıkça `get` (düğmenin `formmethod`'u varsa o, yoksa formun `method`'u). */
  get: boolean;
  /** Formun rolü `search`. */
  aramaRolu: boolean;
  /** Formun içinde `type="search"` bir alan var. */
  aramaAlani: boolean;
}

const sade = (s: string | null | undefined): string => String(s ?? '').trim().toLowerCase();

/**
 * DOM'dan okunan ham değerlerden form bilgisi. `gonderenYontemi`: submit düğmesinin `formmethod` özniteliği (yoksa null; varsa formunkini ezer).
 * Yalnız AÇIKÇA "get" yazılmış yöntem GET sayılır: yöntemsiz (AJAX) form, boş ya da tanınmayan değer GET değildir (güvenli taraf: submit sayılır).
 */
export function submitBilgisi(o: { formYontemi: string | null; gonderenYontemi: string | null; rol: string | null; alanTurleri: readonly (string | null)[] }): SubmitBilgisi {
  const yontem = o.gonderenYontemi !== null ? o.gonderenYontemi : o.formYontemi;
  return {
    get: sade(yontem) === 'get',
    aramaRolu: sade(o.rol).split(/\s+/)[0] === 'search',
    aramaAlani: o.alanTurleri.some((t) => sade(t) === 'search'),
  };
}

/** Arama formu mu: açık GET, role=search ya da arama alanlı form (K3: submit'i kalkanı kurmaz). */
export const aramaFormuMu = (b: SubmitBilgisi): boolean => b.get || b.aramaRolu || b.aramaAlani;

/** Ana süreç: izciden gelen bildirim güvenilmez girdidir; alan yalnız tam `true` ise doğru. Bildirim yoksa ya da bozuksa submit sayılır (güvenli taraf). */
export function submitBilgisiAyikla(x: unknown): SubmitBilgisi {
  const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
  return { get: o.get === true, aramaRolu: o.aramaRolu === true, aramaAlani: o.aramaAlani === true };
}
