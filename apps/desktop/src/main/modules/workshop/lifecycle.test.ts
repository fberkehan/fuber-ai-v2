import { describe, expect, it } from 'vitest';
import { canActivate, INITIAL_STATE, transition, type SkillEvent, type SkillState } from './lifecycle';

const run = (state: SkillState, ...events: SkillEvent[]): SkillState =>
  events.reduce((current, event) => {
    const result = transition(current, event);
    if (!result.ok) throw new Error(`${event.type}: ${result.reason}`);
    return result.state;
  }, state);

const reason = (state: SkillState, event: SkillEvent) => {
  const result = transition(state, event);
  return result.ok ? null : result.reason;
};

const tested = run(INITIAL_STATE, { type: 'test_started' }, { type: 'test_passed', hash: 'h1' });

describe('yetenek yaşam döngüsü', () => {
  it('taslak → sınandı → onay bekliyor → etkin ↔ kapalı', () => {
    expect(INITIAL_STATE.status).toBe('building');
    expect(tested.status).toBe('pending_approval');
    expect(canActivate(tested)).toBe(false);

    const enabled = run(tested, { type: 'approved' });
    expect(enabled).toMatchObject({ status: 'enabled', approvedHash: 'h1', wanted: true });
    expect(canActivate(enabled)).toBe(true);

    const disabled = run(enabled, { type: 'disable' });
    expect(disabled).toMatchObject({ status: 'disabled', wanted: false });
    expect(canActivate(disabled)).toBe(false);
    expect(run(disabled, { type: 'enable' }).status).toBe('enabled');
  });

  it('onaydan önce hiçbir yoldan etkinleşmez', () => {
    expect(reason(tested, { type: 'enable' })).toBe('not_approved');
    const rejected = run(tested, { type: 'rejected' });
    expect(rejected.status).toBe('disabled');
    expect(reason(rejected, { type: 'enable' })).toBe('not_approved');
    expect(reason(rejected, { type: 'restored', hash: 'h1' })).toBe('not_approved');
    // Reddedilen yetenek sonradan açıkça onaylanabilir.
    expect(run(rejected, { type: 'approved' }).status).toBe('enabled');
  });

  it('öz-sınamadan geçmeyen onaya düşmez ve onaylanamaz', () => {
    const failed = run(INITIAL_STATE, { type: 'test_started' }, { type: 'test_failed' });
    expect(failed).toMatchObject({ status: 'failed', testedHash: null });
    expect(reason(failed, { type: 'approved' })).toBe('not_tested');
    expect(reason(failed, { type: 'enable' })).toBe('not_tested');
  });

  it('yapım ve sınama sürerken onay ve etkinleştirme reddedilir', () => {
    expect(reason(INITIAL_STATE, { type: 'approved' })).toBe('busy');
    expect(reason(run(INITIAL_STATE, { type: 'test_started' }), { type: 'enable' })).toBe('busy');
  });

  it('içerik değişince eski onay düşer', () => {
    const enabled = run(tested, { type: 'approved' });
    const changed = run(enabled, { type: 'test_started' }, { type: 'test_passed', hash: 'h2' });
    expect(changed).toMatchObject({ status: 'pending_approval', approvedHash: null, wanted: false });
    expect(canActivate(changed)).toBe(false);
  });

  it('aynı içerik yeniden sınanınca kullanıcının son isteğine döner', () => {
    const enabled = run(tested, { type: 'approved' });
    expect(run(enabled, { type: 'test_started' }, { type: 'test_passed', hash: 'h1' }).status).toBe('enabled');
    const disabled = run(enabled, { type: 'disable' });
    expect(run(disabled, { type: 'test_started' }, { type: 'test_passed', hash: 'h1' }).status).toBe('disabled');
  });

  it('yüklenemeyen etkin yetenek hatalı olur, isteği korunur ve açılışta yeniden denenir', () => {
    const enabled = run(tested, { type: 'approved' });
    const failed = run(enabled, { type: 'load_failed' });
    expect(failed).toMatchObject({ status: 'failed', wanted: true, approvedHash: 'h1' });
    expect(run(failed, { type: 'restored', hash: 'h1' }).status).toBe('enabled');
    expect(reason(failed, { type: 'restored', hash: 'h2' })).toBe('not_approved');
  });

  it('anlamsız geçişleri reddeder', () => {
    expect(reason(tested, { type: 'load_failed' })).toBe('invalid');
    expect(reason(tested, { type: 'disable' })).toBe('invalid');
    expect(reason(run(tested, { type: 'approved' }), { type: 'rejected' })).toBe('invalid');
    expect(reason(tested, { type: 'test_passed', hash: 'h3' })).toBe('invalid');
  });
});
