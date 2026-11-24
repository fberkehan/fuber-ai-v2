/**
 * Yetenek yaşam döngüsü: saf durum makinesi (KURGU §10.1).
 *
 *   building ──dosyalar hazır──► testing ──öz-sınama geçti──► pending_approval ──onay──► enabled ◄──► disabled
 *       │                          │                               │ ret → disabled
 *       └──────── hata ───────────►└──► failed ──yeniden sına──► testing
 *
 * İki değişmez burada kodlanır:
 *  1. Onaylanmamış içerik hiçbir yoldan `enabled` olamaz. Onay içeriğin özetine bağlıdır; dosya değişirse düşer.
 *  2. `enabled` yalnız öz-sınamadan geçmiş içerikle olur.
 */
import type { SkillStatus } from '@fuber/shared';

export interface SkillState {
  status: SkillStatus;
  /** Kullanıcının onayladığı içeriğin özeti; hiç onaylanmadıysa `null`. */
  approvedHash: string | null;
  /** Öz-sınamadan en son geçen içeriğin özeti. */
  testedHash: string | null;
  /** Kullanıcı yeteneği açık istiyor mu (onaylı ve sınanmışsa etkinleşir). */
  wanted: boolean;
}

export type SkillEvent =
  /** Atölye yazmaya başladı. */
  | { type: 'build_started' }
  /** Dosyalar hazır (yapım bitti, klasör bulundu ya da içerik değişti): doğrulama ve öz-sınama başlıyor. */
  | { type: 'test_started' }
  | { type: 'test_passed'; hash: string }
  | { type: 'test_failed' }
  /** Kullanıcı onay verdi (ada, ses ya da Yetenekler sayfası). */
  | { type: 'approved' }
  | { type: 'rejected' }
  | { type: 'enable' }
  | { type: 'disable' }
  /** Etkin yetenek konağa yüklenemedi ya da art arda zaman aşımına uğradı. */
  | { type: 'load_failed' }
  /** Açılışta: özeti değişmemiş, onaylı yetenek öz-sınama yinelenmeden yüklenecek. */
  | { type: 'restored'; hash: string };

export type Transition = { ok: true; state: SkillState } | { ok: false; reason: TransitionError };

export type TransitionError =
  | 'not_approved' // onaylanmamış içerik etkinleştirilemez
  | 'not_tested' // öz-sınamadan geçmemiş içerik etkinleştirilemez
  | 'busy' // yapım ya da sınama sürüyor
  | 'invalid'; // bu durumda bu olay anlamsız

export const INITIAL_STATE: SkillState = { status: 'building', approvedHash: null, testedHash: null, wanted: false };

/** Yetenek şu an yüklenip araçları kayda girebilir mi. */
export function canActivate(state: SkillState): boolean {
  return state.testedHash !== null && state.approvedHash === state.testedHash && state.wanted;
}

const ok = (state: SkillState): Transition => ({ ok: true, state });
const fail = (reason: TransitionError): Transition => ({ ok: false, reason });

export function transition(state: SkillState, event: SkillEvent): Transition {
  const busy = state.status === 'building' || state.status === 'testing';
  switch (event.type) {
    case 'build_started':
      return ok({ ...state, status: 'building' });

    case 'test_started':
      return ok({ ...state, status: 'testing' });

    case 'test_passed': {
      if (state.status !== 'testing') return fail('invalid');
      const next: SkillState = { ...state, testedHash: event.hash };
      // Daha önce onaylanan içerikle aynıysa (ör. öz-sınama yeniden koşuldu) kullanıcının son isteğine döner.
      if (next.approvedHash === event.hash) return ok({ ...next, status: next.wanted ? 'enabled' : 'disabled' });
      // İçerik değişmiş: eski onay bu içerik için geçerli değil.
      return ok({ ...next, approvedHash: null, wanted: false, status: 'pending_approval' });
    }

    case 'test_failed':
      if (state.status !== 'testing' && state.status !== 'building') return fail('invalid');
      return ok({ ...state, status: 'failed', testedHash: null, wanted: false });

    case 'approved':
      if (busy) return fail('busy');
      if (state.testedHash === null) return fail('not_tested');
      if (state.status !== 'pending_approval' && state.status !== 'disabled') return fail('invalid');
      return ok({ ...state, approvedHash: state.testedHash, wanted: true, status: 'enabled' });

    case 'rejected':
      if (state.status !== 'pending_approval') return fail('invalid');
      return ok({ ...state, wanted: false, status: 'disabled' });

    case 'enable':
      if (busy) return fail('busy');
      if (state.status === 'enabled') return ok(state);
      if (state.testedHash === null) return fail('not_tested');
      if (state.approvedHash !== state.testedHash) return fail('not_approved');
      if (state.status !== 'disabled') return fail('invalid');
      return ok({ ...state, wanted: true, status: 'enabled' });

    case 'disable':
      if (state.status === 'disabled') return ok({ ...state, wanted: false });
      if (state.status !== 'enabled') return fail('invalid');
      return ok({ ...state, wanted: false, status: 'disabled' });

    case 'load_failed':
      if (state.status !== 'enabled') return fail('invalid');
      // Kullanıcının isteği (`wanted`) korunur: sorun geçiciyse bir sonraki açılışta yeniden yüklenir.
      return ok({ ...state, status: 'failed' });

    case 'restored':
      if (state.approvedHash !== event.hash) return fail('not_approved');
      return ok({ ...state, testedHash: event.hash, status: state.wanted ? 'enabled' : 'disabled' });
  }
}
