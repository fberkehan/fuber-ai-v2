/**
 * Yetki düzeyleri: araç kapısının onay politikası (KURGU §13). Karar YALNIZ burada ve `tools.ts`'tedir; Claude Code
 * (MCP) ve yerel beyin aynı kapıdan geçtiği için her yolda aynıdır.
 *
 * Bir onay isteği iki yoldan doğar: kapının `danger` araç için kendi sorusu ve aracın çalışırken istediği onay
 * (`tools.requestApproval`: Enter'a basma, dosya kopyalama, form gönderme…). İkisi de bir TÜR taşır (`ApprovalKind`);
 * tür ya çağıranın verdiğidir ya da araç adından bulunur (`APPROVAL_KINDS`), yoksa `other` (kritik sayılır).
 *
 * Düzey türü şöyle yorumlar:
 * - `ask`  : her şey sorulur (demo.2 davranışı).
 * - `smart`: geri alınabilir türler sorulmaz; kritikler sorulur.
 * - `full` : kritikler de sorulmaz. İzin açma ve yetki yükseltme HER düzeyde sorulur.
 * Aracın ret denetimi (`refuse`: parola/kart alanı, banka penceresi, korunan yollar), acil durdurma ve "fareye/klavyeye
 * dokununca dur" onaydan ÖNCE ve ondan bağımsız çalışır: hiçbir düzey bunları gevşetmez.
 */

import { t, type ApprovalKind, type AuthorityLevel } from '@fuber/shared';

/** Türün sınıfı: `reversible` Akıllı'dan itibaren, `critical` yalnız Tam yetki'de sorulmaz, `always` her zaman sorulur. */
export type ApprovalClass = 'reversible' | 'critical' | 'always';

export const APPROVAL_CLASS: Readonly<Record<ApprovalKind, ApprovalClass>> = {
  input: 'reversible',
  window: 'reversible',
  file: 'reversible',
  read: 'reversible',
  watch: 'reversible',
  delete: 'critical',
  send: 'critical',
  pay: 'critical',
  run: 'critical',
  kill: 'critical',
  power: 'critical',
  overwrite: 'critical',
  download: 'critical',
  install: 'critical',
  commit: 'critical',
  other: 'critical',
  permission: 'always',
  authority: 'always',
  update: 'always',
};

/**
 * Araç adından tür. Aracın kendi içinden istediği onaylar da buradan bulunur (istek araç adını taşır); tek aracın
 * birden çok türde onay istediği yerlerde (bilgisayar kullanımı, dosya üzerine yazma, tarayıcı gönderimi) çağıran
 * türü kendisi verir. Burada olmayan araç `other`dır: Akıllı'da sorulur.
 */
export const APPROVAL_KINDS: Readonly<Record<string, ApprovalKind>> = {
  // silme
  file_delete: 'delete',
  skill_remove: 'delete',
  // gönderme
  mail_send: 'send',
  // komut, süreç, güç
  pc_run_command: 'run',
  code_session_start: 'run',
  process_kill: 'kill',
  system_power: 'power',
  // indirme / kurma
  jbrowser_download: 'download',
  skill_build: 'install',
  skill_approve: 'install',
  // dosya: geri alınabilir işler (üzerine yazma çağıranca `overwrite` verilir)
  file_find: 'read',
  file_list: 'read',
  document_read: 'read',
  document_search: 'read',
  file_copy: 'file',
  file_move: 'file',
  folder_create: 'file',
  file_open: 'file',
  file_write: 'file',
  file_edit: 'overwrite',
  // pencere / uygulama
  app_close: 'window',
  // takip işi
  watch_start: 'watch',
  // izin ve yetki
  // Claude Code oturumlarının kendi izin soruları: o oturumun yetki kipi Projeler'de ayrıca yönetilir, düzey gevşetmez.
  claude_permission: 'permission',
  settings_set: 'permission',
  authority_set: 'authority',
  // Çekirdek güncellemesi (selfdev): kurma ve geri alma Tam yetki'de BİLE sorulur (kayıt kapısı + aracın ikinci onayı).
  core_install: 'update',
  core_rollback: 'update',
};

const RANK: Readonly<Record<AuthorityLevel, number>> = { ask: 0, smart: 1, full: 2 };

/** İki düzeyin düşüğü (Yönetim sınırı uygulanırken). */
export function capLevel(level: AuthorityLevel, max: AuthorityLevel): AuthorityLevel {
  return RANK[level] <= RANK[max] ? level : max;
}

export function isRaise(from: AuthorityLevel, to: AuthorityLevel): boolean {
  return RANK[to] > RANK[from];
}

/** Onay isteğinin türü: çağıranın verdiği → araç adından → `other`. */
export function approvalKindOf(toolName: string, given?: ApprovalKind): ApprovalKind {
  return given ?? APPROVAL_KINDS[toolName] ?? 'other';
}

/** Bu düzeyde bu tür sorulmadan onaylanır mı. */
export function autoApproves(level: AuthorityLevel, kind: ApprovalKind): boolean {
  const cls = APPROVAL_CLASS[kind];
  if (cls === 'always') return false;
  if (level === 'full') return true;
  return level === 'smart' && cls === 'reversible';
}

/**
 * Sesli sorunun kısa biçimi: tek soru ("Göndereyim mi?"). Kart ayrıntıyı (`summary`) zaten gösterir; sesli soruda
 * uzun cümle hem yavaştır hem söz kesmeyi zorlaştırır. Kısa biçimi olmayan türde özet + "Yapayım mı?" okunur.
 */
export function shortAsk(kind: ApprovalKind, summary: string): string {
  switch (kind) {
    case 'send':
      return t('authority.ask.send');
    case 'delete':
      return t('authority.ask.delete');
    case 'pay':
      return t('authority.ask.pay');
    case 'run':
      return t('authority.ask.run');
    case 'kill':
      return t('authority.ask.kill');
    case 'window':
      return t('authority.ask.window');
    case 'download':
      return t('authority.ask.download');
    case 'overwrite':
      return t('authority.ask.overwrite');
    default: {
      const clean = summary.trim().replace(/[.!?…]+$/, '');
      return `${clean}. ${t('authority.ask.generic')}`;
    }
  }
}

/** Türün kullanıcıya gösterilen kısa adı (ayar ekranı, günlük). */
export function kindLabel(kind: ApprovalKind): string {
  return t(`authority.kind.${kind}`);
}

// ───────────────────────── düzeyi değiştirme (sesle ve araçla) ─────────────────────────

/** Yetki değişikliği isteği: kalıcı düzey, süreli ya da işe bağlı Tam yetki, geçici yükseltmeyi kaldırma, durum sorusu. */
export type AuthorityRequest =
  | { kind: 'level'; level: AuthorityLevel }
  | { kind: 'grant'; minutes: number }
  | { kind: 'grant'; task: true }
  | { kind: 'clear' }
  | { kind: 'status' };

export type AuthorityPlan =
  /** Hiçbir şey değişmez; `say` söylenir. */
  | { action: 'say'; say: string }
  /** Sormadan uygulanır (düşürme ya da kaldırma). */
  | { action: 'apply'; say: string; apply: AuthorityApply }
  /** Yükseltme: bir kez açık onay istenir (`summary` kartta, `ask` sesli soru); onaylanırsa `apply`, `say`. */
  | { action: 'confirm'; summary: string; ask: string; say: string; apply: AuthorityApply };

export interface AuthorityApply {
  level?: AuthorityLevel;
  grant?: { minutes: number } | { task: true } | null;
}

const durationText = (minutes: number): string =>
  minutes % 60 === 0 ? t('authority.duration.hours', { n: minutes / 60 }) : t('authority.duration.minutes', { n: minutes });

/**
 * İsteğin planı. Kural: düşürmek ve kaldırmak sorulmaz; YÜKSELTMEK tek seferlik açık onay ister; Yönetim'in üst
 * sınırı aşılamaz (neden söylenir). Saf işlev: sınaması `authority.test.ts`.
 */
export function planAuthorityChange(
  state: { level: AuthorityLevel; base: AuthorityLevel; max: AuthorityLevel; grant: { scope: 'time' | 'task' } | null },
  request: AuthorityRequest,
): AuthorityPlan {
  const name = (level: AuthorityLevel) => t(`authority.level.${level}`);
  if (request.kind === 'status') {
    return { action: 'say', say: t(state.grant ? 'authority.say.statusGrant' : 'authority.say.status', { level: name(state.grant ? state.base : state.level) }) };
  }
  if (request.kind === 'clear') {
    // "Tam yetkiyi kapat": geçici yükseltme kalkar; kalıcı düzey Tam yetki ise Akıllı'ya iner.
    const level = state.base === 'full' ? 'smart' : state.base;
    if (!state.grant && state.base !== 'full') return { action: 'say', say: t('authority.say.unchanged', { level: name(state.level) }) };
    return { action: 'apply', say: t(level === 'ask' ? 'authority.say.ask' : 'authority.say.smart'), apply: { level, grant: null } };
  }
  if (request.kind === 'grant') {
    if (state.max !== 'full') return { action: 'say', say: t('authority.say.capped', { level: name(state.max) }) };
    const timed = 'minutes' in request;
    const say = timed ? t('authority.say.fullTimed', { duration: durationText(request.minutes) }) : t('authority.say.fullTask');
    const apply: AuthorityApply = { grant: timed ? { minutes: request.minutes } : { task: true } };
    if (state.base === 'full') return { action: 'say', say: t('authority.say.unchanged', { level: name('full') }) };
    const ask = timed ? t('authority.ask.raiseFullTimed', { duration: durationText(request.minutes) }) : t('authority.ask.raiseFullTask');
    return { action: 'confirm', summary: ask, ask, say, apply };
  }
  const target = request.level;
  if (isRaise(state.max, target)) return { action: 'say', say: t('authority.say.capped', { level: name(state.max) }) };
  if (target === state.base && !state.grant) return { action: 'say', say: t('authority.say.unchanged', { level: name(target) }) };
  const say = t(`authority.say.${target}`);
  const apply: AuthorityApply = { level: target, grant: null };
  if (!isRaise(state.base, target)) return { action: 'apply', say, apply };
  const ask = t(target === 'full' ? 'authority.ask.raiseFull' : 'authority.ask.raiseSmart');
  return { action: 'confirm', summary: ask, ask, say, apply };
}

const NUMBER_WORDS: Readonly<Record<string, number>> = { bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, on: 10, yirmi: 20, otuz: 30, kirk: 40, elli: 50, yarim: 0.5 };

/**
 * Sesle yetki değiştirme: yalnız dar ve kesin kalıplar (model turu açılmaz; üç beyin yolunda da aynı). Emin değilse
 * `null`: söz olağan yoldan beyne gider (beynin `authority_set` aracı vardır). `folded`: küçük harf, Türkçe harfler
 * ASCII, noktalama ayıklanmış söz.
 */
export function routeAuthoritySpeech(folded: string): AuthorityRequest | null {
  const text = folded.replace(/\s+/g, ' ').trim();
  if (!text || text.split(' ').length > 9) return null;
  const full = /\btam yetki/.test(text);
  const question = /\b(mi|mu|mi|midir|nedir|ne|hangi|kac|neydi)\b|\bne durumda|\bacik mi/.test(text);
  if (/\byetki (duzey|seviye)\w*/.test(text) && question) return { kind: 'status' };
  if (full && question) return { kind: 'status' };
  if (full) {
    if (/\b(kapat|kaldir|geri al|iptal|bitir|son ver|alma|verme|istemiyorum|kalksin)\w*/.test(text)) return { kind: 'clear' };
    if (/\bbu is\b|\bis bitene|\bisi bitir|\bis boyunca|\bbu gorev/.test(text)) return { kind: 'grant', task: true };
    const timed = /\b(\d{1,3}|bir|iki|uc|dort|bes|alti|on|yirmi|otuz|kirk|elli|yarim) (saat|dakika)/.exec(text);
    if (timed) {
      const count = /^\d+$/.test(timed[1]!) ? Number(timed[1]) : (NUMBER_WORDS[timed[1]!] ?? 1);
      const minutes = Math.round(count * (timed[2] === 'saat' ? 60 : 1));
      if (minutes >= 1) return { kind: 'grant', minutes: Math.min(720, minutes) };
    }
    if (/\b(ver|veriyorum|verdim|gec|ac|al|kullan|calis|olsun|istiyorum)\w*/.test(text) || /^(sana )?tam yetki$/.test(text)) return { kind: 'level', level: 'full' };
    return null;
  }
  if (/^(artik )?(her seyi|hepsini|her adimi|her adimda) (bana )?sor\b/.test(text) || /\bher seyi sor (duzey|mod|kip)/.test(text)) return { kind: 'level', level: 'ask' };
  if (/\bakilli (yetki|duzey|mod|kip)\w*/.test(text) && /\b(gec|don|al|ac|kullan|olsun|ver|yap)\w*/.test(text)) return { kind: 'level', level: 'smart' };
  // Onay beklenmiyorken "sormadan devam et": bu iş boyunca Tam yetki istenir (tek seferlik onayla).
  if (/^(artik )?(bana )?(sormadan (devam et|yap|hallet)|sorma artik|izin isteme|sormana gerek yok)\b/.test(text)) return { kind: 'grant', task: true };
  return null;
}
