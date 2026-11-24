/**
 * Kaydedilmemiş değişiklik varken panonun altına oturan çubuk: tam genişlikte, opak, üstünde kıl payı çizgi. İçeriğin
 * üstüne binmez (akışta yer tutar; sayfanın sonu çubuğun üstünde biter) ve hiçbir sütunu açıkta bırakmaz. İçi sayfayla
 * aynı ölçüye (`PAGE_MAX`) oturur. Kayıt sonucu da burada görünür: çubuk "Masaüstüne gönderildi"ye dönüşür, kısa süre
 * kalır ve geldiği yönden çıkar.
 */
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CheckCircle, Info, WarningCircle } from '@phosphor-icons/react';
import { t } from '@fuber/shared';
import { Button, Input, KeyHint, enter, spring, useMotionPreset, useReducedMotion } from '@fuber/ui';
import { PAGE_MAX } from '../components/layout';
import { describeChanges, usePolicy } from './policy-store';

export function SaveBar() {
  const { paths, invalid, saving, save, discard, feedback } = usePolicy();
  const [note, setNote] = useState('');
  const reduced = useReducedMotion();
  const swap = useMotionPreset(enter.fade);
  const count = paths.length;
  const errors = Object.keys(invalid).length;
  const dirty = count > 0;
  const saved = !dirty && feedback?.kind === 'saved';
  const open = dirty || saved;

  useEffect(() => {
    if (!dirty) setNote('');
  }, [dirty]);

  let detail: { tone: 'danger' | 'accent' | 'muted'; text: string };
  if (errors > 0) detail = { tone: 'danger', text: t('admin.save.invalid', { count: errors }) };
  else if (feedback?.kind === 'error') detail = { tone: 'danger', text: `${t('admin.save.failed')}: ${feedback.message}` };
  else if (feedback?.kind === 'conflict') detail = { tone: 'accent', text: `${t('admin.save.conflict', { revision: feedback.revision })}. ${t('admin.save.conflictDetail')}` };
  else if (feedback?.kind === 'rebased') detail = { tone: 'accent', text: `${t('admin.save.rebased', { revision: feedback.revision })}. ${t('admin.save.rebasedDetail')}` };
  else detail = { tone: 'muted', text: describeChanges(paths) };

  return (
    <div className="sticky bottom-0 z-(--z-sticky)">
      <AnimatePresence>
        {open && (
          <motion.div
            key="savebar"
            initial={reduced ? { opacity: 0 } : { opacity: 0, transform: 'translateY(16px)' }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, transform: 'translateY(0px)' }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, transform: 'translateY(12px)', transition: { duration: 0.16 } }}
            transition={reduced ? { duration: 0.15 } : spring.smooth}
            className="border-t border-line-strong bg-surface-3 shadow-[0_-12px_32px_rgb(0_0_0/0.45)]"
            role="region"
            aria-label={t('admin.save.region')}
            aria-live="polite"
            data-testid="save-bar"
            data-state={saved ? 'saved' : 'dirty'}
          >
            <div className="mx-auto flex h-16 w-full items-center gap-3 px-8" style={{ maxWidth: PAGE_MAX }}>
            <AnimatePresence mode="popLayout" initial={false}>
              {saved ? (
                <motion.div key="saved" {...swap} className="flex min-w-0 flex-1 items-center gap-3" data-testid="save-done">
                  <CheckCircle aria-hidden weight="fill" className="size-5 shrink-0 text-success" />
                  <span className="text-sm font-semibold text-fg">{t('admin.save.sent')}</span>
                  <span className="truncate text-sm text-fg-muted">{t('admin.save.sentDetail', { revision: feedback?.kind === 'saved' ? feedback.revision : '' })}</span>
                </motion.div>
              ) : (
                <motion.div key="dirty" {...swap} className="flex min-w-0 flex-1 items-center gap-3">
                  <span aria-hidden className="size-2 shrink-0 rounded-full bg-accent-fg" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="text-sm font-semibold text-fg" data-testid="save-count">
                      {t('admin.save.count', { count })}
                    </span>
                    <span
                      className={
                        detail.tone === 'danger'
                          ? 'flex items-center gap-1 truncate text-xs text-danger'
                          : detail.tone === 'accent'
                            ? 'flex items-center gap-1 truncate text-xs text-accent-fg'
                            : 'truncate text-xs text-fg-muted'
                      }
                      title={detail.text}
                      data-testid="save-detail"
                    >
                      {detail.tone === 'danger' && <WarningCircle aria-hidden weight="fill" className="size-3.5 shrink-0" />}
                      {detail.tone === 'accent' && <Info aria-hidden weight="fill" className="size-3.5 shrink-0" />}
                      <span className="truncate">{detail.text}</span>
                    </span>
                  </div>
                  {/* `cn` sınıf çakışmasını çözmez: genişlik denetimin kendisine değil sarmalayana verilir. */}
                  <div className="w-56 min-w-28 shrink">
                    <Input
                      size="sm"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={t('admin.save.notePlaceholder')}
                      aria-label={t('admin.save.noteLabel')}
                      maxLength={120}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && errors === 0) void save(note);
                      }}
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={discard} disabled={saving} data-testid="save-discard">
                    {t('common.cancel')}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={saving}
                    disabled={errors > 0}
                    onClick={() => void save(note)}
                    trailing={errors === 0 && !saving ? <KeyHint keys={['Ctrl', 'S']} size="sm" tone="inverse" /> : undefined}
                    data-testid="save-submit"
                  >
                    {t('admin.save.button')}
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
