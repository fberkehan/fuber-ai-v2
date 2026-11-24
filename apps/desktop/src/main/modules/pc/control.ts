/**
 * Bilgisayarı kullanma motoru: hedef pencereyi doğrular, girdiyi küçük adımlarla gönderir, her adımda keser.
 *
 * Değişmezler (birim sınamalı; gerçek girdiyle sınama `scripts/e2e/pc-control-real.mjs`):
 *  1. Hedef belli olmadan tek tuş basılmaz: her adımdan önce öndeki pencere hedef pencere mi diye bakılır.
 *  2. Kullanıcı fareyi oynatır ya da bir tuşa basarsa dizi O ADIMDA durur ve birkaç saniye yeni eylem başlamaz
 *     (v1'deki "kullanıcı devralırsa çekil" kuralı; burada imleç konumu ve basılı tuşlar da izlenir).
 *  3. Acil dur (`signal`) her adımda yoklanır; basılı kalan düğme bırakılır.
 *  4. Parola/kart alanına, parola yöneticisi ve banka pencerelerine yazılmaz, tıklanmaz.
 *  5. Geri dönüşsüz adım (kapatma, silme, gönderme, ödeme, komut çalıştırma) `approve` olmadan atılmaz.
 * Motor Electron'a ve gerçek sürücüye bağlı değildir: `InputDriver` ve `UiaProvider` dışarıdan gelir.
 */
import { searchTerms } from '@fuber/shared';
import { affirmativeLabel, commitRisk, irreversibleLabel, isBrowser, looksLikeLogin, sensitiveField, sensitiveWindow, type CommitRisk } from './guard';
import { chordEvents, classifyChord, MEDIA_KEYS, parseKeys, VK, type MediaAction } from './keys';
import { defaultTarget, matchWindow } from './read';
import type { ClipboardPort, FocusedInfo, FoundElement, InputDriver, MouseButton, PcAction, PcFx, Point, Rect, UiaProvider, WindowInfo } from './types';

export type FailReason =
  | 'aborted'
  | 'panic'
  | 'user_interrupt'
  | 'user_busy'
  | 'locked'
  | 'uia_down'
  | 'no_window'
  | 'no_target'
  | 'own_window'
  | 'sensitive'
  | 'focus_failed'
  | 'focus_lost'
  | 'password'
  | 'card'
  | 'unknown_field'
  | 'no_effect'
  | 'denied'
  | 'bad_keys'
  | 'blocked_keys'
  | 'focus_keys_last'
  | 'bad_input'
  | 'not_found'
  | 'offscreen'
  | 'covered'
  | 'outside_window'
  | 'no_screen'
  | 'same_window'
  | 'not_placed'
  | 'no_clipboard'
  | 'clipboard_busy'
  | 'bad_hold'
  | 'ambiguous'
  | 'timeout';

export interface Failure {
  ok: false;
  reason: FailReason;
  /** Nedene özgü ayrıntı (pencere adı, tuş, öğe adı). */
  detail?: string;
  /** Kesilmeden önce yazılan karakter sayısı. */
  partial?: number;
  window?: WindowInfo;
  /** Kullanıcı onayı için beklenen süre (ms): aracın süresinden ayrı raporlanır. */
  approvalMs?: number;
}

export type Result<T> = ({ ok: true } & T) | Failure;

export type ApprovalKind = CommitRisk | 'close' | 'keys' | 'click';

export interface ControlCall {
  signal: AbortSignal;
  /** Geri dönüşsüz adım için kullanıcı onayı. `true` = onaylandı. */
  approve(request: { kind: ApprovalKind; window: WindowInfo | null; detail: string }): Promise<boolean>;
}

export interface ControlActivity {
  /** `fx`: ekran katmanı için anlık görsel olay · `waiting`: kullanıcı onayı bekleniyor (`on`). */
  state: 'start' | 'end' | 'interrupted' | 'point' | 'fx' | 'waiting';
  action: PcAction;
  window: WindowInfo | null;
  reason?: 'user' | 'panic';
  /** `point`: imlecin gittiği hedef (fiziksel piksel); ekrandaki "Jarvis imleci" katmanı için. */
  point?: Point;
  /** Görsel olay (imleç yolculuğu, tıklama dalgası, hedef vurgusu, yazma ilerlemesi). */
  fx?: PcFx;
  /** Adım metni için ayrıntı: tıklanan öğenin adı, basılan kısayol, yazılan karakter sayısı. */
  detail?: string;
  /** `waiting`: bekleme başladı (`true`) / bitti (`false`). */
  on?: boolean;
}

export interface ControlDeps {
  input: InputDriver;
  uia: UiaProvider;
  sleep(ms: number): Promise<void>;
  onActivity?(event: ControlActivity): void;
  /** Uzun metni yapıştırarak yazmak için pano. Yoksa metin her zaman tuş tuş yazılır. */
  clipboard?: ClipboardPort;
}

/** Pencere yerleşimi: ekranın çalışma alanına göre. */
export type WindowLayout = 'left' | 'right' | 'top' | 'bottom' | 'top_left' | 'top_right' | 'bottom_left' | 'bottom_right' | 'center' | 'full';

const OPPOSITE: Partial<Record<WindowLayout, WindowLayout>> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };

/** Yerleşimin çalışma alanındaki dikdörtgeni (saf işlev). `center`: alanın %70'i, ortada. */
export function layoutRect(area: Rect, layout: WindowLayout): Rect {
  const width = area.right - area.left;
  const height = area.bottom - area.top;
  const midX = area.left + Math.round(width / 2);
  const midY = area.top + Math.round(height / 2);
  switch (layout) {
    case 'left':
      return { left: area.left, top: area.top, right: midX, bottom: area.bottom };
    case 'right':
      return { left: midX, top: area.top, right: area.right, bottom: area.bottom };
    case 'top':
      return { left: area.left, top: area.top, right: area.right, bottom: midY };
    case 'bottom':
      return { left: area.left, top: midY, right: area.right, bottom: area.bottom };
    case 'top_left':
      return { left: area.left, top: area.top, right: midX, bottom: midY };
    case 'top_right':
      return { left: midX, top: area.top, right: area.right, bottom: midY };
    case 'bottom_left':
      return { left: area.left, top: midY, right: midX, bottom: area.bottom };
    case 'bottom_right':
      return { left: midX, top: midY, right: area.right, bottom: area.bottom };
    case 'center': {
      const w = Math.round(width * 0.7);
      const h = Math.round(height * 0.7);
      const left = area.left + Math.round((width - w) / 2);
      const top = area.top + Math.round((height - h) / 2);
      return { left, top, right: left + w, bottom: top + h };
    }
    case 'full':
      return { ...area };
  }
}

/** İstenen dikdörtgeni çalışma alanına sığdırır: en az 240×160, alandan büyük olamaz, dışına taşamaz. */
export function fitRect(wanted: Rect, area: Rect): Rect {
  const maxW = area.right - area.left;
  const maxH = area.bottom - area.top;
  const width = Math.max(Math.min(240, maxW), Math.min(maxW, Math.round(wanted.right - wanted.left)));
  const height = Math.max(Math.min(160, maxH), Math.min(maxH, Math.round(wanted.bottom - wanted.top)));
  const left = Math.max(area.left, Math.min(area.right - width, Math.round(wanted.left)));
  const top = Math.max(area.top, Math.min(area.bottom - height, Math.round(wanted.top)));
  return { left, top, right: left + width, bottom: top + height };
}

/** Basılı tutulan tuşun `GetAsyncKeyState`te görünen bütün kodları (ctrl → sol/sağ ctrl de basılı görünür). */
function heldCodes(vks: readonly number[]): Set<number> {
  const out = new Set<number>(vks);
  if (out.has(VK.CONTROL)) for (const vk of [VK.LCONTROL, VK.RCONTROL]) out.add(vk);
  if (out.has(VK.SHIFT)) for (const vk of [VK.LSHIFT, VK.RSHIFT]) out.add(vk);
  if (out.has(VK.MENU)) for (const vk of [VK.LMENU, VK.RMENU]) out.add(vk);
  return out;
}

/** Zamanlama ve eşikler. Değerler v1'de çalışan değerlere yakındır (karakter başına 6 ms, tıklamadan önce 40 ms). */
export const TUNING = {
  /** Eylem başlamadan önce kullanıcının bu kadar süredir fareye/klavyeye dokunmamış olması gerekir. */
  quietMs: 300,
  /** Kullanıcı meşgulse sakinleşmesi için en çok bu kadar beklenir; sonra eylem yapılmaz. */
  quietWaitMs: 1500,
  /**
   * Onay kartına fareyle basan kullanıcının eli birkaç saniye daha faredir: onaydan hemen sonra "kullanıcı meşgul"
   * diye vazgeçilmez, elin çekilmesi bu kadar beklenir (v1: onaydan sonraki 1,5 sn hiç sayılmıyordu).
   */
  quietAfterApprovalMs: 5000,
  /** Onayın "az önce" sayıldığı süre. */
  approvalGraceMs: 6000,
  /** Fare titremesi (Bluetooth fare, pürüzlü yüzey): imleç bu kadar piksel oynuyor ve tuş basılı değilse kullanıcı girdisi sayılmaz. */
  jitterPx: 3,
  /** Titreme sayılması için art arda bu kadar yoklamada (her biri 50 ms) yalnız titreme görülmeli. */
  jitterSamples: 5,
  /** Kullanıcı araya girdikten sonra yeni eylem bu kadar süre başlamaz. */
  haltUserMs: 4000,
  haltPanicMs: 10_000,
  /**
   * Yazı parçalar hâlinde gider: parça başına tek `SendInput`, aralarında kısa nefes. Eski değer (2 karakter / 8 ms)
   * 100 karakteri ~0,8 sn'de yazıyordu; şimdiki ~0,1 sn. Her parçadan önce kesme denetimi sürer: kullanıcı araya
   * girerse en çok bir parça (12 karakter) daha yazılmış olur.
   */
  typeChunk: 12,
  typePaceMs: 4,
  keyPaceMs: 40,
  settleMs: 120,
  /** Bizim girdimizden bu kadar sonra görülen yabancı girdi kullanıcınındır. */
  inputToleranceMs: 120,
  cursorTolerancePx: 3,
  glideStepMs: 8,
  maxText: 4000,
  maxRepeat: 20,
  maxNotches: 60,
  /** Bu uzunluğun üstündeki metin (pano varsa) yapıştırılarak yazılır: 2000 karakter tuş tuş ~8 sn sürer ve o sürede kullanıcı eline alamaz. */
  pasteOver: 300,
  maxPasteText: 20_000,
  /** Basılı tutma üst sınırı. */
  maxHoldMs: 5000,
  /** Yerleştirilen pencerenin kenarı istenenden en çok bu kadar sapabilir (en küçük boyut, kenar payı). */
  placeTolerancePx: 32,
  /** Öğe bekleme (`waitFor`): yoklama aralığı ve üst sınır. */
  waitPollMs: 150,
  waitDefaultMs: 5000,
  maxWaitMs: 20_000,
  /** Aranan öğe bulunamazsa bir kez yeniden bakmadan önceki bekleme. */
  relookMs: 220,
  /** Fare gerektirmeyen tıklamada (UIA) katmandaki imlecin hedefe varması için kısa bekleme. */
  ghostGlideMs: 140,
} as const;

const GENERIC_ROLES = new Set(['', 'Pane', 'Window', 'Document', 'Custom', 'Group']);
const NONE: ReadonlySet<number> = new Set<number>();

const fail = (reason: FailReason, detail?: string, extra: Partial<Failure> = {}): Failure => ({ ok: false, reason, ...(detail !== undefined ? { detail } : {}), ...extra });
const center = (rect: Rect): Point => ({ x: Math.round((rect.left + rect.right) / 2), y: Math.round((rect.top + rect.bottom) / 2) });
const inside = (rect: Rect, point: Point): boolean => point.x >= rect.left && point.x < rect.right && point.y >= rect.top && point.y < rect.bottom;
/** 32 bit milisaniye sayaçlarının farkı (49 günde bir taşmaya dayanıklı). */
const since = (later: number, earlier: number): number => (later - earlier) | 0;
const press = (vk: number): Array<{ vk: number; down: boolean }> => [
  { vk, down: true },
  { vk, down: false },
];
const squashSpaces = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** İmleç yolculuğunun süresi (ms): yakın hedefe kısa, uzak hedefe en çok 320 ms. */
export function glideDuration(distance: number): number {
  return Math.max(60, Math.min(320, distance * 0.35));
}

/**
 * Yolun `progress` (0–1) anındaki noktası: v1'deki eğri (orta noktası dik yönde %12 kaymış ikinci derece Bézier,
 * hızlanıp yavaşlayan geçiş). İmleç ışınlanmaz; kullanıcı nereye gittiğini görür.
 */
export function glidePoint(from: Point, to: Point, progress: number): Point {
  const time = Math.max(0, Math.min(1, progress));
  if (time >= 1) return { x: Math.round(to.x), y: Math.round(to.y) };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const bend = { x: from.x + dx * 0.5 - dy * 0.12, y: from.y + dy * 0.5 + dx * 0.12 };
  const eased = time < 0.5 ? 4 * time * time * time : 1 - Math.pow(-2 * time + 2, 3) / 2;
  return {
    x: Math.round((1 - eased) * (1 - eased) * from.x + 2 * (1 - eased) * eased * bend.x + eased * eased * to.x),
    y: Math.round((1 - eased) * (1 - eased) * from.y + 2 * (1 - eased) * eased * bend.y + eased * eased * to.y),
  };
}

export type PcControl = ReturnType<typeof createPcControl>;

export function createPcControl(deps: ControlDeps) {
  const { input, uia, sleep } = deps;
  let haltUntil: number | null = null;
  let haltReason: 'user' | 'panic' = 'user';
  /** Bizim son girdimizin anı. */
  let lastInject: number | null = null;
  /** Eylemin başladığı an: bundan önceki girdi eylemi kesmez. */
  let refTick = input.tick();
  let expectedCursor: Point | null = null;
  /** Basılı tuttuğumuz fare düğmesi (sürükleme); kesilince bırakılır. */
  let heldButton: MouseButton | null = null;
  /** Basılı tuttuğumuz tuşlar (basılış sırasıyla); kesilince ters sırayla bırakılır. */
  let heldKeys: number[] = [];
  /** İmlecin son görüldüğü yer: yabancı girdi imleç oynamasıyla birlikte geldiyse fare titremesidir (klavye değil). */
  let seenCursor: Point | null = null;
  /** Titreme sayılıp geçilen son yabancı girdinin anı (aynı girdi yeniden değerlendirilmesin). */
  let jitterTick: number | null = null;
  /** Kullanıcının son onay verdiği an (onaydan hemen sonra eli hâlâ farede olabilir). */
  let approvedAt: number | null = null;
  /** Sürmekte olan çağrıda onay için beklenen toplam süre. */
  let approvalMs = 0;

  const mark = () => {
    lastInject = input.tick();
  };
  const baseline = () => {
    expectedCursor = input.cursor();
    seenCursor = expectedCursor;
    jitterTick = null;
    refTick = input.tick();
  };
  const fx = (action: PcAction, window: WindowInfo | null, event: PcFx) => deps.onActivity?.({ state: 'fx', action, window, fx: event });

  /**
   * Kullanıcıya sorar. Bekleme süresi ayrı ölçülür (aracın "11 sn sürdü" görünen süresinin çoğu onay beklemesiydi) ve
   * adaya/katmana "onay bekleniyor" diye yansır; onaydan sonra kullanıcının elini fareden çekmesi için pay bırakılır.
   */
  const ask = async (call: ControlCall, action: PcAction, request: { kind: ApprovalKind; window: WindowInfo | null; detail: string }): Promise<boolean> => {
    deps.onActivity?.({ state: 'waiting', action, window: request.window, on: true });
    const started = input.tick();
    try {
      const granted = await call.approve(request);
      if (granted) approvedAt = input.tick();
      return granted;
    } finally {
      approvalMs += Math.max(0, since(input.tick(), started));
      deps.onActivity?.({ state: 'waiting', action, window: request.window, on: false });
    }
  };

  const halt = (reason: 'user' | 'panic') => {
    haltReason = reason;
    haltUntil = input.tick() + (reason === 'panic' ? TUNING.haltPanicMs : TUNING.haltUserMs);
    release();
  };

  const release = () => {
    if (heldKeys.length > 0) {
      const keys = heldKeys;
      heldKeys = [];
      try {
        input.sendKeys([...keys].reverse().map((vk) => ({ vk, down: false })));
        mark();
      } catch {
        // sürücü gitmiş olabilir; yapılacak başka bir şey yok
      }
    }
    if (!heldButton) return;
    const button = heldButton;
    heldButton = null;
    try {
      input.mouseButton(button, false);
      mark();
    } catch {
      // sürücü gitmiş olabilir; yapılacak başka bir şey yok
    }
  };

  const haltedReason = (): FailReason | null => {
    if (haltUntil === null) return null;
    if (since(input.tick(), haltUntil) >= 0) {
      haltUntil = null;
      return null;
    }
    return haltReason === 'panic' ? 'panic' : 'user_interrupt';
  };

  /** Kullanıcının kendi girdisi var mı: imleç beklenen yerde değil, bizim basmadığımız bir tuş basılı ya da bizden sonra yabancı girdi. */
  const interference = (own: ReadonlySet<number>): boolean => {
    const now = input.cursor();
    if (expectedCursor) {
      if (Math.abs(now.x - expectedCursor.x) > TUNING.cursorTolerancePx || Math.abs(now.y - expectedCursor.y) > TUNING.cursorTolerancePx) return true;
    }
    if (input.downKeys().some((vk) => !own.has(vk))) return true;
    let reference = lastInject !== null && since(lastInject, refTick) > 0 ? lastInject : refTick;
    if (jitterTick !== null && since(jitterTick, reference) > 0) reference = jitterTick;
    const last = input.lastInputTick();
    if (since(last, reference) <= TUNING.inputToleranceMs) return false;
    // Yabancı girdi var. İmleç o arada birkaç piksel OYNADIYSA (ve tuş basılı değilse) bu fare titremesidir: klavye ya
    // da düğme olsaydı imleç yerinde kalırdı. Beklenen yerden uzaklaşma yukarıda zaten "kullanıcı aldı" sayıldı.
    const moved = seenCursor !== null && (now.x !== seenCursor.x || now.y !== seenCursor.y);
    if (moved) {
      seenCursor = now;
      jitterTick = last;
      return false;
    }
    return true;
  };

  /** Her adımdan önce: iptal, kesme, kullanıcı girdisi, odak. `window` verilirse öndeki pencere o olmalıdır. */
  const checkpoint = (call: ControlCall, window: WindowInfo | null, own: ReadonlySet<number> = NONE): FailReason | null => {
    if (call.signal.aborted) return 'aborted';
    const halted = haltedReason();
    if (halted) return halted;
    if (interference(own)) {
      halt('user');
      return 'user_interrupt';
    }
    if (window && input.foregroundWindow() !== window.hwnd) return 'focus_lost';
    return null;
  };

  const precheck = (call: ControlCall): FailReason | null => (call.signal.aborted ? 'aborted' : haltedReason());

  /** Kullanıcı şu an fareyi/klavyeyi kullanıyorsa kısa süre bekler; bırakmazsa eylem yapılmaz. */
  const ensureQuiet = async (call: ControlCall): Promise<FailReason | null> => {
    // Az önce onay verildiyse kullanıcının eli hâlâ farede olabilir: çekilmesi daha uzun beklenir.
    const justApproved = approvedAt !== null && since(input.tick(), approvedAt) < TUNING.approvalGraceMs;
    const limit = justApproved ? TUNING.quietAfterApprovalMs : TUNING.quietWaitMs;
    const anchor = input.cursor();
    let previous = anchor;
    let previousTick = input.lastInputTick();
    let jitter = 0;
    for (let waited = 0; ; waited += 50) {
      const stop = precheck(call);
      if (stop) return stop;
      const last = input.lastInputTick();
      const ours = lastInject !== null && since(last, lastInject) <= TUNING.inputToleranceMs;
      const idle = since(input.tick(), last);
      const keys = input.downKeys().length;
      if (keys === 0 && (ours || idle >= TUNING.quietMs)) return null;
      // Fare titremesi: girdi saati ilerliyor ama imleç yalnız birkaç piksel oynuyor ve hiçbir tuş basılı değil.
      const here = input.cursor();
      const drift = Math.max(Math.abs(here.x - anchor.x), Math.abs(here.y - anchor.y));
      const stepped = here.x !== previous.x || here.y !== previous.y;
      if (keys === 0 && drift <= TUNING.jitterPx && (stepped || last === previousTick)) jitter += 1;
      else jitter = 0;
      // Hiç imleç oynaması olmadan ilerleyen girdi saati klavyedir: titreme sayılmaz.
      if (!stepped && last !== previousTick) jitter = 0;
      previous = here;
      previousTick = last;
      if (jitter >= TUNING.jitterSamples && drift > 0) return null;
      if (waited >= limit) return 'user_busy';
      await sleep(50);
    }
  };

  const resolveTarget = async (query: string | undefined): Promise<Result<{ window: WindowInfo }>> => {
    let list;
    try {
      list = await uia.windows();
    } catch (error) {
      return fail('uia_down', error instanceof Error ? error.message : String(error));
    }
    if (list.locked) return fail('locked');
    const window = query?.trim() ? matchWindow(query, list.windows) : defaultTarget(list);
    if (!window) return query?.trim() ? fail('no_window', query.trim()) : fail('no_target');
    if (window.own) return fail('own_window');
    const sensitive = sensitiveWindow(window);
    if (sensitive) return fail('sensitive', sensitive, { window });
    return { ok: true, window };
  };

  /**
   * Pencereyi öne getirir ve gerçekten öne geçtiğini doğrular. Windows ilk isteği ara sıra yutar (odak çalma
   * koruması): bir kez daha istenir; ikincisi de olmazsa `focus_failed` (demo.5).
   */
  const focusTarget = async (window: WindowInfo): Promise<FailReason | null> => {
    if (input.foregroundWindow() === window.hwnd) return null;
    for (let round = 0; round < 2; round++) {
      input.activateWindow(window.hwnd);
      for (let attempt = 0; attempt < 12; attempt++) {
        await sleep(40);
        if (input.foregroundWindow() === window.hwnd) {
          await sleep(TUNING.settleMs);
          return null;
        }
      }
    }
    return 'focus_failed';
  };

  /** Odaktaki alanın türü: parola/kart alanıysa ya da tür okunamıyor ve sayfa giriş sayfasına benziyorsa yazılmaz. */
  const inspectField = async (window: WindowInfo): Promise<Result<{ field: FocusedInfo }>> => {
    let field: FocusedInfo;
    try {
      field = await uia.focused();
      // Chromium, erişilebilirlik ağacını ilk sorudan sonra kurar; ilk yanıt "pencere" diyorsa bir kez daha sorulur.
      if ((!field.known || GENERIC_ROLES.has(field.role)) && window.className.startsWith('Chrome_')) {
        await sleep(200);
        field = await uia.focused();
      }
    } catch {
      return fail('unknown_field', undefined, { window });
    }
    if (field.hwnd !== window.hwnd) return fail('focus_lost', undefined, { window });
    if (field.password) return fail('password', undefined, { window });
    const named = sensitiveField(field.name);
    if (named) return fail(named, undefined, { window });
    if ((!field.known || GENERIC_ROLES.has(field.role)) && looksLikeLogin(window.title)) return fail('unknown_field', undefined, { window });
    return { ok: true, field };
  };

  /** İmleci hedefe kavisli ve yumuşak götürür (v1'deki eğri): ışınlanmaz, kullanıcı nereye gittiğini görür. */
  const glide = async (call: ControlCall, window: WindowInfo | null, target: Point, own: ReadonlySet<number> = NONE): Promise<FailReason | null> => {
    const from = input.cursor();
    const duration = glideDuration(Math.hypot(target.x - from.x, target.y - from.y));
    const steps = Math.max(1, Math.round(duration / TUNING.glideStepMs));
    deps.onActivity?.({ state: 'point', action: 'click', window, point: target, fx: { kind: 'move', to: target, ms: steps * TUNING.glideStepMs, from } });
    expectedCursor = from;
    for (let step = 1; step <= steps; step++) {
      const stop = checkpoint(call, window, own);
      if (stop) return stop;
      const next = glidePoint(from, target, step / steps);
      input.moveCursor(next);
      // İmleç taşıma da sistemin "son girdi" saatini ilerletebilir; kendi hareketimiz kullanıcı girdisi sayılmasın.
      mark();
      // Beklenen konum İSTEDİĞİMİZ noktadır (okunan değil): taşımanın hemen ardından kullanıcı fareyi oynatırsa fark görünür kalır.
      expectedCursor = next;
      seenCursor = next;
      await sleep(TUNING.glideStepMs);
    }
    return null;
  };

  const act = async <T>(action: PcAction, window: WindowInfo | null, body: () => Promise<Result<T>>, detail?: string): Promise<Result<T>> => {
    deps.onActivity?.({ state: 'start', action, window, ...(detail !== undefined ? { detail } : {}) });
    try {
      const result = await body();
      if (!result.ok && (result.reason === 'user_interrupt' || result.reason === 'panic')) {
        deps.onActivity?.({ state: 'interrupted', action, window, reason: result.reason === 'panic' ? 'panic' : 'user' });
      }
      return result.ok || result.window ? result : { ...result, ...(window ? { window } : {}) };
    } finally {
      release();
      deps.onActivity?.({ state: 'end', action, window });
    }
  };

  /** Fare gerektirmeyen yol (UIA deseni) bu öğe için gerçekten "tıklama" mı: seçmek/açmak her öğede tıklamak demek değildir. */
  const mouseFree = (element: FoundElement): boolean => {
    if (element.patterns.includes('invoke')) return true;
    // Liste satırını "seçmek" onu AÇMAZ (WhatsApp'ta sohbet satırı seçilir ama sohbet açılmaz): satırlar fareyle tıklanır.
    if (element.role === 'TabItem' || element.role === 'RadioButton') return element.patterns.includes('select');
    if (element.role === 'CheckBox') return element.patterns.includes('toggle');
    if (element.role === 'ComboBox' || element.role === 'MenuItem' || element.role === 'SplitButton') return element.patterns.includes('expand');
    return false;
  };

  /** Öğeyi ada (ve/veya türe) göre bulur. Tür tek başına verildiyse o türden görünen TEK öğe olmalıdır. */
  const locate = async (
    window: WindowInfo,
    query: { name?: string; role?: string },
    relook = true,
  ): Promise<Result<{ element: FoundElement; matches: number }>> => {
    const name = query.name?.trim() ?? '';
    const terms = name ? searchTerms(name) : [];
    if (name && terms.length === 0) return fail('not_found', name);
    if (!name && !query.role) return fail('bad_input');
    let usable: FoundElement[] = [];
    // Arayüz o an yeniden çiziliyor olabilir (yazıdan sonra süzülen liste, açılan bölme): öğe yoksa bir kez, kısa bir
    // nefesten sonra yeniden bakılır. Ölçüldü: Chromium sayfası güncellenirken ağaç bir an eksik okunabiliyor.
    for (let attempt = 0; attempt < (relook ? 2 : 1) && usable.length === 0; attempt++) {
      if (attempt > 0) await sleep(TUNING.relookMs);
      try {
        const found = await uia.find(window.hwnd, { terms, ...(query.role ? { role: query.role } : {}), max: 6 });
        usable = found.matches.filter((item) => item.enabled);
      } catch (error) {
        return fail('uia_down', error instanceof Error ? error.message : String(error));
      }
    }
    const best = usable[0];
    if (!best) return fail('not_found', name || query.role);
    const top = usable.filter((item) => item.score === best.score);
    if (!name) {
      const visible = usable.filter((item) => item.onscreen);
      // Tür tek başına verildi ve birden çok aday var: klavye odağındaki öne geçer, yoksa adlarıyla sorulur.
      if (visible.length > 1 && top.length > 1) {
        return fail('ambiguous', visible.slice(0, 6).map((item) => `“${item.name || item.role}”`).join(', '));
      }
      return { ok: true, element: visible[0] ?? best, matches: 1 };
    }
    return { ok: true, element: top.find((item) => item.onscreen) ?? best, matches: top.length };
  };

  /**
   * Bulunmuş öğeye (ya da noktaya) tıklar: önce fare gerektirmeyen yol (UIA deseni gerçekten "tıklama" ise), olmazsa
   * imleç hedefe kavisle gider ve basar. Katman için her durumda imleç yolculuğu ve tıklama dalgası yayınlanır.
   */
  const strike = async (
    call: ControlCall,
    window: WindowInfo,
    target: { element: FoundElement | null; point: Point | null; label: string },
    how: { button: MouseButton; double: boolean; hover: boolean },
  ): Promise<Result<{ method: 'uia' | 'mouse' | 'hover' }>> => {
    const { element, point, label } = target;
    if (element?.rect) fx('click', window, { kind: 'target', rect: element.rect, mode: 'click' });
    if (element && !how.hover && how.button === 'left' && !how.double && mouseFree(element)) {
      const halted = precheck(call);
      if (halted) return fail(halted);
      // Gerçek imleç oynamaz; katmandaki Jarvis imleci yine hedefe gider ki kullanıcı neye basıldığını görsün.
      if (point) {
        fx('click', window, { kind: 'move', to: point, ms: TUNING.ghostGlideMs });
        await sleep(TUNING.ghostGlideMs);
      }
      const invoked = await uia.invoke(element.ref);
      if (invoked.ok) {
        if (point) fx('click', window, { kind: 'click', at: point, button: 'left', double: false });
        return { ok: true, method: 'uia' };
      }
    }
    if (!point || (element && !element.onscreen)) return fail('offscreen', label);
    const failed = await focusTarget(window);
    if (failed) return fail(failed);
    // Noktada gerçekten hedef pencere mi var (üstünde başka pencere olabilir).
    if (input.windowAt(point) !== window.hwnd) return fail('covered', label);
    baseline();
    const moved = await glide(call, window, point);
    if (moved) return fail(moved);
    await sleep(40);
    if (how.hover) return { ok: true, method: 'hover' };
    for (let count = 0; count < (how.double ? 2 : 1); count++) {
      const halted = checkpoint(call, window);
      if (halted) return fail(halted);
      if (input.windowAt(point) !== window.hwnd) return fail('covered', label);
      if (count === 0) fx('click', window, { kind: 'click', at: point, button: how.button, double: how.double });
      heldButton = how.button;
      input.mouseButton(how.button, true);
      await sleep(25);
      heldButton = null;
      input.mouseButton(how.button, false);
      mark();
      await sleep(60);
    }
    return { ok: true, method: 'mouse' };
  };

  return {
    /** Acil dur ya da dışarıdan kesme: sürmekte olan dizi bir sonraki adımda durur, yenisi bir süre başlamaz. */
    halt,
    halted: (): boolean => haltedReason() !== null,
    /** Kilidin nedeni: kullanıcı araya girdi (`user`) ya da Durdur/acil dur (`panic`); kilit yoksa `null`. */
    haltedBy: (): 'user' | 'panic' | null => {
      const reason = haltedReason();
      return reason === null ? null : reason === 'panic' ? 'panic' : 'user';
    },

    async focus(request: { window: string }, call: ControlCall): Promise<Result<{ window: WindowInfo }>> {
      const stop = precheck(call);
      if (stop) return fail(stop);
      const target = await resolveTarget(request.window);
      if (!target.ok) return target;
      const quiet = await ensureQuiet(call);
      if (quiet) return fail(quiet, undefined, { window: target.window });
      return act('focus', target.window, async () => {
        const failed = await focusTarget(target.window);
        return failed ? fail(failed) : { ok: true, window: target.window };
      });
    },

    async windowAction(
      request: { window?: string; action: 'minimize' | 'maximize' | 'restore' | 'close' },
      call: ControlCall,
    ): Promise<Result<{ window: WindowInfo; verified: boolean }>> {
      const stop = precheck(call);
      if (stop) return fail(stop);
      const target = await resolveTarget(request.window);
      if (!target.ok) return target;
      const { window } = target;
      if (request.action === 'close' && !(await ask(call, 'window', { kind: 'close', window, detail: window.title }))) return fail('denied', undefined, { window });
      const quiet = await ensureQuiet(call);
      if (quiet) return fail(quiet, undefined, { window });
      return act('window', window, async () => {
        if (request.action === 'close') {
          input.closeWindow(window.hwnd);
          for (let attempt = 0; attempt < 15; attempt++) {
            await sleep(100);
            if (!input.windowState(window.hwnd).exists) return { ok: true, window, verified: true };
          }
          // Uygulama "kaydedilsin mi?" diye soruyor olabilir: istek gitti ama pencere duruyor.
          return { ok: true, window, verified: false };
        }
        input.showWindow(window.hwnd, request.action);
        await sleep(150);
        const state = input.windowState(window.hwnd);
        const verified = request.action === 'minimize' ? state.minimized : request.action === 'maximize' ? state.maximized : !state.minimized;
        return { ok: true, window, verified };
      });
    },

    /**
     * Pencereyi taşır, boyutlandırır ya da ekrana yerleştirir (sol/sağ yarı, köşe, orta, tam). `beside` verilirse o pencere
     * karşı yarıya oturur (yan yana). Fare kullanılmaz; pencerenin önde olması gerekmez. Sonuç pencerenin gerçek yeriyle doğrulanır.
     */
    async arrange(
      request: {
        window?: string;
        layout?: WindowLayout;
        /** Çalışma alanının sol üstüne göre piksel; verilmeyen değer pencerenin şimdiki değeridir. */
        box?: { x?: number; y?: number; width?: number; height?: number };
        /** Hedef ekranın çalışma alanı (başka ekrana taşımak için); verilmezse pencerenin bulunduğu ekran. */
        area?: Rect;
        beside?: string;
      },
      call: ControlCall,
    ): Promise<Result<{ window: WindowInfo; rect: Rect; verified: boolean; beside: { window: WindowInfo; rect: Rect; verified: boolean } | null }>> {
      const stop = precheck(call);
      if (stop) return fail(stop);
      if (!request.layout && !request.box && !request.area) return fail('bad_input');
      const target = await resolveTarget(request.window);
      if (!target.ok) return target;
      const { window } = target;
      let other: WindowInfo | null = null;
      if (request.beside?.trim()) {
        if (!request.layout || !OPPOSITE[request.layout]) return fail('bad_input', undefined, { window });
        const second = await resolveTarget(request.beside);
        if (!second.ok) return second;
        if (second.window.hwnd === window.hwnd) return fail('same_window', undefined, { window });
        other = second.window;
      }
      const quiet = await ensureQuiet(call);
      if (quiet) return fail(quiet, undefined, { window });
      return act('window', window, async () => {
        const near = (a: number, b: number) => Math.abs(a - b) <= TUNING.placeTolerancePx;
        const close = (a: Rect, b: Rect) => near(a.left, b.left) && near(a.top, b.top) && near(a.right, b.right) && near(a.bottom, b.bottom);
        const place = async (item: WindowInfo, wanted: (area: Rect, current: Rect) => Rect): Promise<Result<{ rect: Rect; verified: boolean }>> => {
          const halted = precheck(call);
          if (halted) return fail(halted);
          const before = input.windowState(item.hwnd);
          if (!before.exists) return fail('no_window', item.title);
          if (before.minimized || before.maximized) {
            input.showWindow(item.hwnd, 'restore');
            await sleep(150);
          }
          const area = request.area ?? input.monitorOf(item.hwnd)?.work ?? null;
          if (!area || area.right - area.left < 200 || area.bottom - area.top < 150) return fail('no_screen');
          const current = input.windowState(item.hwnd).rect ?? item.rect;
          const rect = fitRect(wanted(area, current), area);
          input.setWindowRect(item.hwnd, rect);
          await sleep(150);
          const now = input.windowState(item.hwnd).rect;
          const verified = !!now && close(now, rect);
          // Pencere hiç kıpırdamadıysa (yönetici yetkili pencere, sabit boyutlu iletişim kutusu) "yerleştirdim" denmez.
          const unmoved = !!now && now.left === current.left && now.top === current.top && now.right === current.right && now.bottom === current.bottom;
          if (!verified && unmoved) return fail('not_placed', item.title);
          return { ok: true, rect: now ?? rect, verified };
        };
        const first = await place(window, (area, current) => {
          if (request.layout) return layoutRect(area, request.layout);
          const box = request.box ?? {};
          // Başka ekrana taşıma: konum verilmediyse yeni alanın sol üstüne yakın konur.
          const origin = request.area ? { left: request.area.left + 40, top: request.area.top + 40 } : { left: current.left, top: current.top };
          const left = box.x !== undefined ? area.left + box.x : origin.left;
          const top = box.y !== undefined ? area.top + box.y : origin.top;
          const width = box.width ?? current.right - current.left;
          const height = box.height ?? current.bottom - current.top;
          return { left, top, right: left + width, bottom: top + height };
        });
        if (!first.ok) return first;
        let beside: { window: WindowInfo; rect: Rect; verified: boolean } | null = null;
        if (other && request.layout) {
          const opposite = OPPOSITE[request.layout]!;
          // Yan yana: ikinci pencere BİRİNCİNİN ekranına, karşı yarıya oturur.
          const shared = request.area ?? input.monitorOf(window.hwnd)?.work ?? null;
          const second = await place(other, (area) => layoutRect(shared ?? area, opposite));
          if (!second.ok) return { ...second, window: other };
          beside = { window: other, rect: second.rect, verified: second.verified };
        }
        return { ok: true, window, rect: first.rect, verified: first.verified, beside };
      });
    },

    async type(
      request: { text: string; window?: string; enter?: boolean; method?: 'keys' | 'paste'; into?: { name?: string; role?: string } },
      call: ControlCall,
    ): Promise<
      Result<{ window: WindowInfo; typed: number; verified: boolean | null; entered: boolean; method: 'keys' | 'paste'; field: string | null; approvalMs: number }>
    > {
      const stop = precheck(call);
      if (stop) return fail(stop);
      approvalMs = 0;
      const text = request.text.replace(/\r\n?/g, '\n');
      const clipboard = deps.clipboard;
      // Yöntem: açıkça istenmediyse uzun metin yapıştırılır (pano varsa ve içinde geri getirilemeyecek bir şey yoksa).
      let method: 'keys' | 'paste' = request.method ?? 'keys';
      if (request.method === 'paste') {
        if (!clipboard) return fail('no_clipboard');
        if (await clipboard.hasNonText?.()) return fail('clipboard_busy');
      } else if (!request.method && clipboard && text.length > TUNING.pasteOver && !(await clipboard.hasNonText?.())) {
        method = 'paste';
      }
      if (!text || text.length > (method === 'paste' ? TUNING.maxPasteText : TUNING.maxText)) return fail('bad_input');
      const target = await resolveTarget(request.window);
      if (!target.ok) return target;
      const { window } = target;
      // Enter bu pencerede "gönder / öde / çalıştır" demekse (ileti, ödeme, terminal, onay kutusu) onaysız basılmaz.
      const risk = commitRisk(window);
      if (risk && (request.enter === true || text.includes('\n'))) {
        if (!(await ask(call, 'type', { kind: risk, window, detail: window.title }))) return fail('denied', undefined, { window, approvalMs });
      }
      const quiet = await ensureQuiet(call);
      if (quiet) return fail(quiet, undefined, { window, approvalMs });
      return act(
        'type',
        window,
        async () => {
          const failed = await focusTarget(window);
          if (failed) return fail(failed);
          // "Şu alana yaz": alan önce bulunur ve tıklanır (ayrı bir tıklama turu gerekmez).
          let fieldName: string | null = null;
          if (request.into && (request.into.name?.trim() || request.into.role)) {
            const wanted = request.into;
            let located: Awaited<ReturnType<typeof locate>> | null = null;
            if (wanted.role || !wanted.name?.trim()) {
              located = await locate(window, { ...(wanted.name ? { name: wanted.name } : {}), role: wanted.role ?? 'Edit' });
            } else {
              // Ad bir düğmeyle de eşleşebilir ("Ara" düğmesi ve "Ara" kutusu): önce YAZILABİLİR türler denenir.
              for (const role of ['Edit', 'ComboBox', 'Document']) {
                const hit = await locate(window, { name: wanted.name, role }, false);
                if (hit.ok || hit.reason !== 'not_found') {
                  located = hit;
                  break;
                }
              }
              located ??= await locate(window, { name: wanted.name });
            }
            if (!located.ok) return located;
            const element = located.element;
            if (element.password) return fail('password', undefined, { window });
            const point = element.point ?? (element.rect ? center(element.rect) : null);
            const struck = await strike(call, window, { element, point, label: element.name }, { button: 'left', double: false, hover: false });
            if (!struck.ok) return struck;
            fieldName = element.name || null;
            // Tıklamanın odağı alana taşıması için kısa nefes (Chromium odağı bir kare sonra bildirir).
            await sleep(90);
          }
          baseline();
          const inspected = await inspectField(window);
          if (!inspected.ok) return inspected;
          const before = inspected.field.value;
          if (inspected.field.rect) fx('type', window, { kind: 'target', rect: inspected.field.rect, mode: 'type' });
          fieldName ??= inspected.field.known && inspected.field.name ? inspected.field.name : null;
          let typed = 0;
          if (method === 'paste' && clipboard) {
            // Yapıştırma: pano geçici olarak metni taşır, sonra eski metin geri konur (her durumda).
            let saved = '';
            try {
              saved = await clipboard.readText();
            } catch {
              saved = '';
            }
            try {
              await clipboard.writeText(text.replace(/\n/g, '\r\n'));
              await sleep(60);
              const halted = checkpoint(call, window);
              if (halted) return fail(halted, undefined, { partial: 0 });
              input.sendKeys([
                { vk: VK.CONTROL, down: true },
                { vk: 0x56, down: true },
                { vk: 0x56, down: false },
                { vk: VK.CONTROL, down: false },
              ]);
              mark();
              typed = text.length;
              fx('type', window, { kind: 'typing', chars: typed, total: text.length });
              // Hedef uygulama panoyu okuyana kadar beklenir; erken geri koymak yanlış metni yapıştırır.
              await sleep(Math.min(1200, 250 + Math.round(text.length / 20)));
            } finally {
              try {
                await clipboard.writeText(saved);
              } catch {
                // pano geri konamadı: yapılacak bir şey yok
              }
            }
          }
          let sinceFx = 0;
          for (const segment of method === 'paste' ? [] : text.split(/(\n)/)) {
            if (segment === '') continue;
            if (segment === '\n') {
              const halted = checkpoint(call, window);
              if (halted) return fail(halted, undefined, { partial: typed });
              input.sendKeys(press(VK.RETURN));
              mark();
              typed += 1;
              await sleep(TUNING.keyPaceMs);
              continue;
            }
            for (let index = 0; index < segment.length; ) {
              let end = Math.min(segment.length, index + TUNING.typeChunk);
              // Vekil çift (emoji gibi) ortadan bölünmez.
              const last = segment.charCodeAt(end - 1);
              if (last >= 0xd800 && last <= 0xdbff && end < segment.length) end += 1;
              const halted = checkpoint(call, window);
              if (halted) return fail(halted, undefined, { partial: typed });
              input.sendText(segment.slice(index, end));
              mark();
              typed += end - index;
              index = end;
              sinceFx += 1;
              // Katmandaki "yazıyor 24/80" sayacı: her parçada değil, birkaç parçada bir (olay seli olmasın).
              if (sinceFx >= 3 || index >= segment.length) {
                sinceFx = 0;
                fx('type', window, { kind: 'typing', chars: typed, total: text.length });
              }
              await sleep(TUNING.typePaceMs);
            }
          }

          // Doğrulama: alan okunabiliyorsa yazdığımız metin orada mı (tek okuma).
          let verified: boolean | null = null;
          await sleep(50);
          try {
            const after = await uia.focused();
            if (after.hwnd === window.hwnd && !after.password && after.value !== null && after.value.length < 1900) {
              if (before !== null && after.value === before) return fail('no_effect', undefined, { partial: typed });
              const wanted = squashSpaces(text);
              verified = squashSpaces(after.value).includes(wanted.length > 60 ? wanted.slice(-60) : wanted);
            }
          } catch {
            // okunamadı: doğrulanmamış sayılır
          }

          let entered = false;
          // Alan başka bir şey gösteriyorsa Enter basılmaz: yanlış metni göndermektense durmak iyidir.
          if (request.enter === true && verified !== false) {
            const halted = checkpoint(call, window);
            if (halted) return fail(halted, undefined, { partial: typed });
            input.sendKeys(press(VK.RETURN));
            mark();
            entered = true;
          }
          return { ok: true, window, typed, verified, entered, method, field: fieldName, approvalMs };
        },
        String(text.length),
      );
    },

    async keys(
      request: { keys: string; window?: string; repeat?: number; holdMs?: number },
      call: ControlCall,
    ): Promise<Result<{ window: WindowInfo | null; sent: string[]; focusMoved: boolean; heldMs: number }>> {
      const stop = precheck(call);
      if (stop) return fail(stop);
      const parsed = parseKeys(request.keys, (char) => input.keyForChar(char));
      if ('error' in parsed) return fail('bad_keys', parsed.error);
      const repeat = Math.max(1, Math.min(TUNING.maxRepeat, Math.floor(request.repeat ?? 1)));
      const chords = parsed.chords.map((chord) => ({ chord, kind: classifyChord(chord) }));
      const blocked = chords.find((item) => item.kind === 'blocked');
      if (blocked) return fail('blocked_keys', blocked.chord.canonical);
      // Basılı tutma: tek kısayol, tekrarsız; odak taşıyan kısayol (alt+tab) basılı tutulmaz.
      const holdMs = request.holdMs ? Math.max(0, Math.min(TUNING.maxHoldMs, Math.floor(request.holdMs))) : 0;
      if (holdMs > 0 && (chords.length !== 1 || repeat !== 1 || chords[0]!.kind === 'focus')) return fail('bad_hold');
      // Odağı başka pencereye taşıyan kısayoldan sonra neye basıldığı bilinemez: dizinin sonunda olmalı.
      if (chords.slice(0, -1).some((item) => item.kind === 'focus') || (repeat > 1 && chords.length > 1 && chords.some((item) => item.kind === 'focus'))) {
        return fail('focus_keys_last');
      }
      // Yalnız sistem geneli kısayol ("win+d", "alt+tab") hedef pencere istemez.
      const global = !request.window?.trim() && chords.every((item) => item.kind === 'focus');
      let window: WindowInfo | null = null;
      if (!global) {
        const target = await resolveTarget(request.window);
        if (!target.ok) return target;
        window = target.window;
      }
      for (const item of chords) {
        const risk = item.kind === 'commit' && window ? commitRisk(window) : null;
        if (item.kind === 'danger' && !(await ask(call, 'keys', { kind: 'keys', window, detail: item.chord.canonical }))) return fail('denied', item.chord.canonical);
        if (risk && !(await ask(call, 'keys', { kind: risk, window, detail: item.chord.canonical }))) return fail('denied', item.chord.canonical);
      }
      const quiet = await ensureQuiet(call);
      if (quiet) return fail(quiet);
      return act('keys', window, async () => {
        if (window) {
          const failed = await focusTarget(window);
          if (failed) return fail(failed);
        }
        baseline();
        if (window && chords.some((item) => item.kind === 'text')) {
          const inspected = await inspectField(window);
          if (!inspected.ok) return inspected;
        }
        const sent: string[] = [];
        let focusMoved = false;
        if (holdMs > 0) {
          const chord = chords[0]!.chord;
          const downs = [...chord.modifiers, ...(chord.key !== null ? [chord.key] : [])];
          const own = heldCodes(downs);
          const halted = checkpoint(call, window);
          if (halted) return fail(halted);
          heldKeys = downs;
          input.sendKeys(downs.map((vk) => ({ vk, down: true })));
          mark();
          let held = 0;
          while (held < holdMs) {
            const step = Math.min(50, holdMs - held);
            await sleep(step);
            held += step;
            // Kullanıcı araya girerse, odak kayarsa ya da durdurulursa tuşlar HEMEN bırakılır.
            const stopped = checkpoint(call, window, own);
            if (stopped) {
              release();
              return fail(stopped, chord.canonical);
            }
          }
          release();
          return { ok: true, window, sent: [chord.canonical], focusMoved: false, heldMs: held };
        }
        for (let round = 0; round < repeat; round++) {
          for (const item of chords) {
            const halted = checkpoint(call, focusMoved ? null : window);
            if (halted) return fail(halted, sent.join(' '));
            input.sendKeys(chordEvents(item.chord));
            mark();
            sent.push(item.chord.canonical);
            if (item.kind === 'focus') focusMoved = true;
            await sleep(TUNING.keyPaceMs);
          }
        }
        return { ok: true, window, sent, focusMoved, heldMs: 0 };
      }, chords.map((item) => item.chord.canonical).join(' '));
    },

    async click(
      request: { name?: string; role?: string; window?: string; button?: MouseButton; double?: boolean; point?: Point; hover?: boolean },
      call: ControlCall,
    ): Promise<Result<{ window: WindowInfo; label: string; role: string; method: 'uia' | 'mouse' | 'hover'; matches: number }>> {
      const stop = precheck(call);
      if (stop) return fail(stop);
      approvalMs = 0;
      const button = request.button ?? 'left';
      const name = request.name?.trim() ?? '';
      // Ad yoksa tür (rol) tek başına da hedef olabilir: "bu penceredeki metin alanı".
      if (!name && !request.point && !request.role) return fail('bad_input');
      const target = await resolveTarget(request.window);
      if (!target.ok) return target;
      const { window } = target;
      const quiet = await ensureQuiet(call);
      if (quiet) return fail(quiet, undefined, { window });

      return act(
        'click',
        window,
        async () => {
          // Simge durumundaki pencerenin öğeleri ekranda değildir: önce pencere açılır, sonra aranır.
          if (window.minimized || request.point) {
            const failed = await focusTarget(window);
            if (failed) return fail(failed);
          }
          let element: FoundElement | null = null;
          let point: Point | null = null;
          let label = '';
          let role = '';
          let matches = 1;
          let tabClose = false;
          if (!request.point) {
            const located = await locate(window, { ...(name ? { name } : {}), ...(request.role ? { role: request.role } : {}) });
            if (!located.ok) return located;
            element = located.element;
            matches = located.matches;
            label = element.name;
            role = element.role;
            point = element.point ?? (element.rect ? center(element.rect) : null);
          } else {
            point = { x: Math.round(request.point.x), y: Math.round(request.point.y) };
            const state = input.windowState(window.hwnd);
            if (!state.rect || !inside(state.rect, point)) return fail('outside_window');
            try {
              const under = await uia.at(point);
              label = under.name || under.parentName;
              role = under.role;
              tabClose = under.parentRole === 'TabItem' && under.role === 'Button';
              // Adı okunamayan nokta tarayıcının üst şeridindeyse sekme (ve kapatma düğmesi) olabilir: bilmeden tıklanmaz.
              if (!under.known || (!label && isBrowser(window) && point.y - state.rect.top < 110)) tabClose = true;
            } catch {
              tabClose = isBrowser(window);
            }
          }

          // Üzerine gelme (hover) tıklamaz: geri dönüşsüz bir şey olamaz, onay gerekmez.
          const hover = request.hover === true;
          const risky =
            !hover &&
            (irreversibleLabel(label) ||
              tabClose ||
              (window.className === '#32770' && affirmativeLabel(label)) ||
              // Tarayıcıda orta tık sekmeyi kapatır.
              (button === 'middle' && isBrowser(window)));
          if (risky && !(await ask(call, 'click', { kind: 'click', window, detail: label || role }))) return fail('denied', label);
          if (risky) {
            const again = await ensureQuiet(call);
            if (again) return fail(again);
          }

          const struck = await strike(call, window, { element, point, label }, { button, double: request.double === true, hover });
          if (!struck.ok) return struck;
          return { ok: true, window, label, role, method: struck.method, matches };
        },
        name || undefined,
      );
    },

    /**
     * Bir öğe görünene (ya da `gone` ise kaybolana) dek bekler: sohbet açılınca beliren mesaj kutusu, yüklenen sayfanın
     * düğmesi. Sabit bekleme yerine budur; girdi üretmez, pencerenin önde olması gerekmez. Süre dolarsa `timeout`.
     */
    async waitFor(
      request: { name?: string; role?: string; window?: string; gone?: boolean; timeoutMs?: number },
      call: ControlCall,
    ): Promise<Result<{ window: WindowInfo; label: string; role: string; waitedMs: number }>> {
      const stop = precheck(call);
      if (stop) return fail(stop);
      const name = request.name?.trim() ?? '';
      const terms = name ? searchTerms(name) : [];
      if ((name && terms.length === 0) || (!name && !request.role)) return fail('bad_input');
      const target = await resolveTarget(request.window);
      if (!target.ok) return target;
      const { window } = target;
      const limit = Math.max(200, Math.min(TUNING.maxWaitMs, Math.floor(request.timeoutMs ?? TUNING.waitDefaultMs)));
      const started = input.tick();
      for (;;) {
        const halted = precheck(call);
        if (halted) return fail(halted, undefined, { window });
        if (!input.windowState(window.hwnd).exists) return fail('no_window', window.title);
        try {
          const found = await uia.find(window.hwnd, { terms, ...(request.role ? { role: request.role } : {}), max: 3 });
          const hit = found.matches.find((item) => item.onscreen) ?? null;
          const waitedMs = Math.max(0, since(input.tick(), started));
          if (request.gone ? !hit : hit) {
            if (hit?.rect) fx('focus', window, { kind: 'target', rect: hit.rect, mode: 'read' });
            return { ok: true, window, label: hit?.name ?? name, role: hit?.role ?? request.role ?? '', waitedMs };
          }
        } catch (error) {
          return fail('uia_down', error instanceof Error ? error.message : String(error), { window });
        }
        if (since(input.tick(), started) >= limit) return fail('timeout', name || request.role, { window });
        await sleep(TUNING.waitPollMs);
      }
    },

    async drag(request: { from: Point; to: Point; window?: string }, call: ControlCall): Promise<Result<{ window: WindowInfo }>> {
      const stop = precheck(call);
      if (stop) return fail(stop);
      const target = await resolveTarget(request.window);
      if (!target.ok) return target;
      const { window } = target;
      const quiet = await ensureQuiet(call);
      if (quiet) return fail(quiet, undefined, { window });
      return act('click', window, async () => {
        const failed = await focusTarget(window);
        if (failed) return fail(failed);
        const state = input.windowState(window.hwnd);
        const from = { x: Math.round(request.from.x), y: Math.round(request.from.y) };
        const to = { x: Math.round(request.to.x), y: Math.round(request.to.y) };
        if (!state.rect || !inside(state.rect, from) || !inside(state.rect, to)) return fail('outside_window');
        if (input.windowAt(from) !== window.hwnd || input.windowAt(to) !== window.hwnd) return fail('covered');
        baseline();
        const reached = await glide(call, window, from);
        if (reached) return fail(reached);
        await sleep(60);
        const halted = checkpoint(call, window);
        if (halted) return fail(halted);
        heldButton = 'left';
        input.mouseButton('left', true);
        mark();
        await sleep(80);
        const own = new Set<number>([VK.LBUTTON]);
        const dragged = await glide(call, window, to, own);
        // Düğme her durumda bırakılır (kesilse de): basılı kalan fare kullanıcıyı kilitler.
        release();
        if (dragged) return fail(dragged);
        return { ok: true, window };
      });
    },

    async scroll(
      request: { direction: 'up' | 'down' | 'left' | 'right'; pages?: number; window?: string },
      call: ControlCall,
    ): Promise<Result<{ window: WindowInfo; notches: number }>> {
      const stop = precheck(call);
      if (stop) return fail(stop);
      const target = await resolveTarget(request.window);
      if (!target.ok) return target;
      const { window } = target;
      const quiet = await ensureQuiet(call);
      if (quiet) return fail(quiet, undefined, { window });
      return act('scroll', window, async () => {
        if (window.minimized) {
          const failed = await focusTarget(window);
          if (failed) return fail(failed);
        }
        let rect = input.windowState(window.hwnd).rect;
        if (!rect) return fail('no_window', window.title);
        // Tekerlek imlecin altındaki pencereye gider: imleç zaten hedefin üstündeyse yerinde kalır, değilse ortasına gider.
        const here = input.cursor();
        let point = inside(rect, here) && input.windowAt(here) === window.hwnd ? here : center(rect);
        if (input.windowAt(point) !== window.hwnd) {
          const failed = await focusTarget(window);
          if (failed) return fail(failed);
          rect = input.windowState(window.hwnd).rect ?? rect;
          point = center(rect);
          if (input.windowAt(point) !== window.hwnd) return fail('covered');
        }
        baseline();
        if (point.x !== here.x || point.y !== here.y) {
          const moved = await glide(call, null, point);
          if (moved) return fail(moved);
        }
        const perPage = Math.max(3, Math.min(12, Math.round(((rect.bottom - rect.top) * 0.8) / 120)));
        const total = Math.max(1, Math.min(TUNING.maxNotches, Math.round(perPage * Math.max(0.2, request.pages ?? 1))));
        const horizontal = request.direction === 'left' || request.direction === 'right';
        const sign = request.direction === 'up' || request.direction === 'right' ? 1 : -1;
        let sent = 0;
        while (sent < total) {
          const halted = checkpoint(call, null);
          if (halted) return fail(halted, undefined, { partial: sent });
          if (input.windowAt(point) !== window.hwnd) return fail('covered');
          input.wheel(sign, horizontal);
          mark();
          sent += 1;
          await sleep(12);
        }
        return { ok: true, window, notches: sent };
      });
    },

    /** Sistem geneli medya/ses tuşu: hedef pencere yok, hiçbir yere yazı gitmez. */
    async media(request: { action: MediaAction; steps?: number }, call: ControlCall): Promise<Result<{ steps: number }>> {
      const stop = precheck(call);
      if (stop) return fail(stop);
      const vk = MEDIA_KEYS[request.action];
      const volume = request.action === 'volume_up' || request.action === 'volume_down';
      const steps = volume ? Math.max(1, Math.min(TUNING.maxRepeat, Math.floor(request.steps ?? 2))) : 1;
      return act('keys', null, async () => {
        for (let step = 0; step < steps; step++) {
          if (call.signal.aborted) return fail('aborted');
          input.sendKeys(press(vk));
          mark();
          await sleep(30);
        }
        return { ok: true, steps };
      });
    },
  };
}
