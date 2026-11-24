// Gönderim kalkanı: AĞ düzeyi (sekme başına). Saf, saati dışarıdan alır, birim testli (`shield.test.ts`).
//
// İki kapı vardır:
//   1. Eylem kapısı (`tools.ts`): Jarvis bir öğeye tıklamadan / Enter'a basmadan ÖNCE öğe sayfadan okunur
//      (`classify.ts › isSubmission`); gönderim, ödeme, silme ya da hesap değişikliğiyse HER SEFERİNDE onay kartı.
//   2. Ağ kapısı (bu dosya): 1. kapının kaçırdığı her şey. Sayfa betikle form gönderebilir (form.submit, requestSubmit),
//      masum adlı bir düğmeye fetch/XHR bağlayabilir, gizli bir formu zamanlayıcıyla gönderebilir, sendBeacon kullanabilir.
//
// Ağ kapısının kuralı (v1'in K1–K7 kalkanından DAHA SIKI; v1 fetch/XHR'ı yalnız DOM submit olayından sonra durduruyordu,
// masum adlı düğmenin fetch POST'u geçiyordu):
//   - Kapsam: değiştirici yöntemler (POST, PUT, PATCH, DELETE), her kaynak türü (ana/alt çerçeve gezinimi, xhr/fetch, ping/
//     sendBeacon, diğer). Yalnız `cspReport` dışarıda.
//   - Sekme "kirli": bu belgede Jarvis etkileşimli bir eylem (tık, yazma, tuş, seçim) yaptı. Yeni belge (ana çerçeve
//     gezinimi) kiri siler: Jarvis'in yazdığı veri yeni belgede yoktur. Kullanıcının kendi girdisi de siler (kontrol onda).
//   - Kirli sekmede onaysız değiştirici istek: Jarvis'in aracı sürüyorsa BEKLETİLİR ve kart sorulur (sekme başına tek açık
//     kart; bekleyen bütün istekler ona bağlanır); araç bitmişse kartsız İPTAL edilir ve sayılır (bir sonraki araç sonucunda
//     modele söylenir; o sekmede sıradaki etkileşim onaya zorlanır).
//   - Onaylı eylem (eylem kapısının kartı ya da ağ kartı) sekmeye 10 sn izin verir; izin içinde istekler geçer.
//   - Ret sekmeyi 60 sn kilitler: sayfanın yinelediği gönderim de geçemez. Yeni etkileşimli eylem, kullanıcının kendi girdisi
//     ve yeni belge kilidi kaldırır.
//   - Kullanıcının kendi girdisi (Jarvis'in eylemi ve yankısı dışında) 3 sn pencere açar: kullanıcı kendi formunu gönderebilir.
//   - Kirli değilken sayfanın kendi istekleri geçer (sayfa yüklenirken GraphQL/POST ile içerik okuyan siteler bozulmasın):
//     bu belgede Jarvis hiçbir şey yazmadı, tıklamadı.
//   - Kirli sekmede aynı sitenin GraphQL OKUMA isteği (`query`, `mutation` yok) geçer: tek sayfalık uygulamalar tıklamadan
//     sonra içeriği POST ile çeker; bunun için kart çıkmasın. `mutation` ya da çözülemeyen gövde kapıdan geçer.
//   - Sekmesi bilinmeyen istek (service worker): herhangi bir sekme kirli ve izinsizse iptal.

/** Onaylı eylemin izni (onay anından; uzatılmaz). */
export const PERMIT_MS = 10_000;
/** Ret kilidi. */
export const LOCK_MS = 60_000;
/** Kullanıcının kendi girdisinden sonra sayfanın gönderimi serbest kalır. */
export const USER_WINDOW_MS = 3_000;
/** Jarvis'in `sendInputEvent` yankısını kullanıcı girdisinden ayırma payı. */
export const AGENT_ECHO_MS = 600;
/** Engellenen gönderimden sonra o sekmede sıradaki etkileşim onaya zorlanır. */
export const FORCE_MS = 60_000;

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface ShieldClock {
  now(): number;
}

/** Kalkanın değerlendirdiği istek. */
export interface ShieldRequest {
  method: string;
  /** Electron `resourceType`: mainFrame, subFrame, xhr, ping, cspReport, other … */
  resourceType: string;
  url: string;
  /** İstek gövdesi (yalnız ilk parça, en çok birkaç KB); GraphQL okuma isteğini tanımak için. */
  body?: string | null;
  /** Sekmenin şu anki sayfası (aynı site karşılaştırması). */
  pageUrl?: string;
}

/** Ağ kartı: kullanıcıya sorulan "sayfa bir şey göndermek istiyor". */
export interface NetworkCard {
  method: string;
  url: string;
  pageUrl: string;
  pageTitle: string;
  resourceType: string;
}

export type Decision = { verdict: 'pass' } | { verdict: 'hold'; answer: Promise<boolean> } | { verdict: 'cancel'; reason: 'lock' | 'unapproved' | 'unknown_tab' };

const PASS = Object.freeze({ verdict: 'pass' as const });

export function isMutating(method: string, resourceType: string): boolean {
  return MUTATING.has(String(method).toUpperCase()) && resourceType !== 'cspReport';
}

/** Ana makinenin "site"si: son iki etiket (ornek.com.tr gibi iki parçalı kamu uzantısında üç). IP olduğu gibi. */
export function siteOf(raw: string): string {
  let host = '';
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return '';
  }
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) return host;
  const parts = host.split('.');
  const twoPart = /^(com|net|org|gov|edu|av|bel|k12|gen|biz|info|web|tv|co|ac)\.[a-z]{2}$/;
  return parts.length >= 3 && twoPart.test(parts.slice(-2).join('.')) ? parts.slice(-3).join('.') : parts.slice(-2).join('.');
}

/**
 * Gövde bir GraphQL OKUMA isteği mi: JSON (tek ya da toplu), her işlemin `query` metni "query" ya da "{" ile başlıyor ve
 * hiçbirinde `mutation`/`subscription` yok. Yalnız metni olan sorgu sayılır (kalıcı sorgu kimliği çözülemez → kapıdan geçer).
 */
export function isGraphqlRead(body: string | null | undefined): boolean {
  if (!body || body.length > 64_000) return false;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return false;
  }
  const ops = Array.isArray(parsed) ? parsed : [parsed];
  if (ops.length === 0) return false;
  return ops.every((op) => {
    if (!op || typeof op !== 'object') return false;
    const query = (op as { query?: unknown }).query;
    if (typeof query !== 'string') return false;
    const text = query.replace(/#[^\n]*/g, '').trim();
    if (/\b(mutation|subscription)\b/i.test(text)) return false;
    return /^(query\b|\{)/i.test(text);
  });
}

/** Bir sekmenin gönderim kalkanı. Bütün kararlar yalnız bu sekmenin durumuna bakar. */
export class TabShield {
  private depth = 0;
  private echoUntil = 0;
  private userUntil = 0;
  private dirty = false;
  private permitUntil = 0;
  private lockUntil = 0;
  private forceUntil = 0;
  private card: { answer: Promise<boolean>; waiting: number } | null = null;
  private blocked = 0;
  /** Son okumadan beri yanıtlanan ağ kartının sonucu (
ull: kart yok). */
  private cardOutcome: boolean | null = null;
  private closed = false;
  /** Bu sekmede o an süren Jarvis aracının kart sorucusu (yoksa `null`: araç dönmüş, istek kartsız iptal edilir). */
  private asker: ((card: NetworkCard) => Promise<boolean>) | null = null;

  constructor(
    private readonly clock: ShieldClock,
    private readonly page: () => { url: string; title: string },
  ) {}

  private now(): number {
    return this.clock.now();
  }

  // ── Jarvis'in eylemi ──

  /** Bu sekmede bir Jarvis aracı başlıyor (her tür). `ask`: ağ kartını soran (aracın onay akışı). */
  agentBegin(ask: (card: NetworkCard) => Promise<boolean>): void {
    this.depth += 1;
    this.asker = ask;
    this.userUntil = 0;
  }

  /** Jarvis aracı bitti: yankı payı başlar; sorucu bırakılır (bundan sonraki onaysız istek kartsız iptal). */
  agentEnd(): void {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) this.asker = null;
    this.echoUntil = this.now() + AGENT_ECHO_MS;
  }

  /**
   * Etkileşimli eylem (tık, yazma, tuş, seçim) başlıyor: sekme kirlenir; eski kilit ve eski izin kalkar. Eylem kapısında
   * onaylandıysa sekmeye onay anından 10 sn izin verilir.
   */
  interaction(approved: boolean): void {
    this.dirty = true;
    this.lockUntil = 0;
    // Önceki onayın izni yeni (onaysız) etkileşime taşınmaz.
    this.permitUntil = approved ? this.now() + PERMIT_MS : 0;
  }

  /** Sıradaki etkileşim, öğe ne olursa olsun onay istemeli mi (bu sekmede yakın zamanda gönderim engellendi). */
  mustConfirm(): boolean {
    return this.now() < this.forceUntil;
  }

  /** Zorunlu onay kullanıldı. */
  consumeForce(): void {
    this.forceUntil = 0;
  }

  /** Bir kart açık mı (araç dönmeden önce yanıtı beklenir). */
  openCard(): Promise<boolean> | null {
    return this.card?.answer ?? null;
  }

  // ── Kullanıcı ve sayfa ──

  /** Sayfaya gerçek bir girdi (fare düğmesi, tuş) geldi. Jarvis'in eylemi ve yankısı dışındaysa kullanıcınındır. */
  userInput(): void {
    const now = this.now();
    if (this.depth > 0 || now < this.echoUntil) return;
    this.userUntil = now + USER_WINDOW_MS;
    this.dirty = false;
    this.lockUntil = 0;
    this.forceUntil = 0;
  }

  /** Ana çerçevede yeni belge açıldı: Jarvis'in yazdığı veri artık sayfada değil. */
  documentChanged(): void {
    this.dirty = false;
    this.lockUntil = 0;
    this.permitUntil = 0;
  }

  /** Sekme kapandı: açık kart onaylansa da istek gönderilemez. */
  close(): void {
    this.closed = true;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  /** Şu an onaysız gönderim yapılabilir mi (izin ya da kullanıcı penceresi açık değil, kirli). Sekmesiz istek kararı için. */
  guarded(): boolean {
    const now = this.now();
    if (now < this.userUntil || now < this.permitUntil) return false;
    return this.dirty || now < this.lockUntil;
  }

  /** Son okumadan beri yanıtlanan ağ kartlarının sonucu: hepsi onaylandıysa 	rue, biri reddedildiyse alse, kart yoksa 
ull. */
  takeCardOutcome(): boolean | null {
    const outcome = this.cardOutcome;
    this.cardOutcome = null;
    return outcome;
  }

  /** Son okumadan beri durdurulan istek sayısı (bir kez okunur). */
  takeBlocked(): number {
    const count = this.blocked;
    this.blocked = 0;
    return count;
  }

  // ── Karar ──

  decide(request: ShieldRequest): Decision {
    if (!isMutating(request.method, request.resourceType)) return PASS;
    const now = this.now();
    if (now < this.userUntil) return PASS;
    if (now < this.lockUntil) return this.cancel('lock');
    if (now < this.permitUntil) return PASS;
    if (!this.dirty) return PASS;
    if (request.resourceType === 'xhr' && request.pageUrl && siteOf(request.url) === siteOf(request.pageUrl) && isGraphqlRead(request.body)) return PASS;
    if (this.card) {
      this.card.waiting += 1;
      return { verdict: 'hold', answer: this.card.answer };
    }
    if (this.depth > 0 && this.asker) {
      const page = this.page();
      const ask = this.asker;
      const card = { answer: Promise.resolve(false), waiting: 1 };
      this.card = card;
      card.answer = this.awaitCard(ask, { method: String(request.method).toUpperCase(), url: request.url, pageUrl: page.url, pageTitle: page.title, resourceType: request.resourceType }, card);
      return { verdict: 'hold', answer: card.answer };
    }
    return this.cancel('unapproved');
  }

  private cancel(reason: 'lock' | 'unapproved'): Decision {
    this.blocked += 1;
    this.forceUntil = this.now() + FORCE_MS;
    return { verdict: 'cancel', reason };
  }

  private async awaitCard(ask: (card: NetworkCard) => Promise<boolean>, card: NetworkCard, self: { answer: Promise<boolean>; waiting: number }): Promise<boolean> {
    let approved = false;
    try {
      approved = await ask(card);
    } catch {
      approved = false;
    }
    // Yanıtlandı: açık kart yok (karar ile temizlik aynı adımda; araya istek giremez).
    if (this.card === self) this.card = null;
    this.cardOutcome = this.cardOutcome === false ? false : approved && !this.closed;
    if (!approved) {
      this.lockUntil = this.now() + LOCK_MS;
      this.blocked += Math.max(1, self.waiting);
      this.forceUntil = this.now() + FORCE_MS;
      return false;
    }
    if (this.closed) return false;
    this.permitUntil = this.now() + PERMIT_MS;
    return true;
  }
}
