/**
 * Politika taslağı: ekranlar yürürlükteki politikanın bir kopyasını düzenler, kaydet çubuğu farkı
 * (`policy.update { baseRevision, patch, note }`) yayınlar. Başka yerden yeni sürüm gelirse (tepsiden acil
 * durdurma, ikinci pencere) taslaktaki değişiklikler yeni sürümün üstüne yeniden kurulur; kayıt sırasında
 * 409 gelirse aynısı yapılır ve kullanıcı uyarılır.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { t, type Policy } from '@fuber/shared';
import { errorMessage, useAdminEvent } from '../lib/ipc';
import { buildPatch, changedPaths, pathGroup, rebase, setIn } from '../lib/policy-diff';

/**
 * Kaydetmeyle ilgili geri bildirim kaydet çubuğunun içinde gösterilir (toast değil): çubuk sağ alttaki
 * toast yığınıyla çakışmasın ve kayıt hakkındaki her şey tek yerde okunsun diye.
 */
export type SaveFeedback =
  | { kind: 'saved'; revision: number }
  | { kind: 'rebased'; revision: number }
  | { kind: 'conflict'; revision: number }
  | { kind: 'error'; message: string };

export interface PolicyStore {
  feedback: SaveFeedback | null;
  base: Policy | null;
  draft: Policy | null;
  error: string | null;
  loading: boolean;
  /** Değişen yaprak alanlar. */
  paths: string[][];
  /** Yol ("persona.name") → hata metni. */
  invalid: Record<string, string>;
  saving: boolean;
  edit: (path: string[], value: unknown) => void;
  /** Birden çok alanı tek adımda değiştirir. */
  editMany: (changes: Array<[string[], unknown]>) => void;
  discard: () => void;
  save: (note?: string) => Promise<boolean>;
  reload: () => Promise<void>;
  /** Sunucudan dönen yeni politikayı uygular (acil durdurma, geri alma). */
  accept: (next: Policy) => void;
}

const PolicyContext = createContext<PolicyStore | null>(null);

export function usePolicy(): PolicyStore {
  const store = useContext(PolicyContext);
  if (!store) throw new Error('PolicyProvider eksik');
  return store;
}

/** Taslak alanının değeri ve değiştiricisi; ekranlarda tek satırla bağlanır. */
export function useField<T>(path: string[]): [T, (value: T) => void, string | undefined] {
  const { draft, edit, invalid } = usePolicy();
  let node: unknown = draft;
  for (const key of path) node = (node as Record<string, unknown> | null)?.[key];
  const key = path.join('.');
  const set = useCallback((value: T) => edit(key.split('.'), value), [edit, key]);
  return [node as T, set, invalid[key]];
}

function validate(draft: Policy | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!draft) return out;
  const required = (path: string, value: string | undefined) => {
    if (!value || value.trim() === '') out[path] = t('admin.validate.required');
  };
  const range = (path: string, value: number, min: number, max?: number, integer = false) => {
    if (!Number.isFinite(value) || value < min || (max !== undefined && value > max) || (integer && !Number.isInteger(value))) {
      out[path] =
        max === undefined
          ? t(integer ? 'admin.validate.minInt' : 'admin.validate.min', { min })
          : t('admin.validate.range', { min, max });
    }
  };
  required('persona.name', draft.persona.name);
  required('persona.systemPrompt', draft.persona.systemPrompt);
  if (draft.persona.wakePhrases.length === 0) out['persona.wakePhrases'] = t('admin.validate.wakeRequired');
  range('voice.followUpSeconds', draft.voice.followUpSeconds, 0, 120);
  range('brain.local.contextTokens', draft.brain.local.contextTokens, 2048, 131_072, true);
  required('brain.local.modelId', draft.brain.local.modelId);
  range('limits.dailyBudgetUsd', draft.limits.dailyBudgetUsd, 0);
  range('limits.maxAgentSteps', draft.limits.maxAgentSteps, 1, undefined, true);
  range('ambient.maxInterjectionsPerHour', draft.ambient.maxInterjectionsPerHour, 0, undefined, true);
  range('ambient.minGapSeconds', draft.ambient.minGapSeconds, 0, undefined, true);
  required('release.minVersion', draft.release.minVersion);
  required('release.latestVersion', draft.release.latestVersion);
  if (draft.release.downloadUrl && !/^https?:\/\/\S+$/i.test(draft.release.downloadUrl.trim())) {
    out['release.downloadUrl'] = t('admin.validate.url');
  }
  return out;
}

/** Sürüm geçmişinde görünen kendiliğinden not: "Ad, Sistem istemi değişti". */
export function describeChanges(paths: string[][]): string {
  const groups = [...new Set(paths.map(pathGroup))];
  return groups.map((group) => t(`admin.field.${group}`)).join(', ');
}

export function PolicyProvider({ children }: { children: ReactNode }) {
  const [base, setBase] = useState<Policy | null>(null);
  const [draft, setDraft] = useState<Policy | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<SaveFeedback | null>(null);
  const savedTimer = useRef<number | undefined>(undefined);
  const baseRef = useRef<Policy | null>(null);
  const draftRef = useRef<Policy | null>(null);
  const savingRef = useRef(false);
  baseRef.current = base;
  draftRef.current = draft;

  /** Yeni sürümü uygular; taslaktaki değişiklikler korunur. Korunan değişiklik varsa `true`. */
  const accept = useCallback((next: Policy): boolean => {
    const prevBase = baseRef.current;
    const prevDraft = draftRef.current;
    const pending = prevBase && prevDraft ? changedPaths(prevBase, prevDraft) : [];
    const rebased = pending.length > 0 && prevDraft ? rebase(next, prevDraft, pending) : next;
    baseRef.current = next;
    draftRef.current = rebased;
    setBase(next);
    setDraft(rebased);
    setError(null);
    return pending.length > 0;
  }, []);

  const reload = useCallback(async () => {
    try {
      accept(await window.fuber.invoke('policy.get'));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  }, [accept]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useAdminEvent('policy.changed', ({ revision }) => {
    if (savingRef.current) return;
    if (baseRef.current && revision <= baseRef.current.revision) return;
    void window.fuber.invoke('policy.get').then(
      (next) => {
        if (accept(next)) setFeedback({ kind: 'rebased', revision: next.revision });
      },
      (reason: unknown) => setError(errorMessage(reason)),
    );
  });

  const edit = useCallback((path: string[], value: unknown) => {
    setDraft((prev) => {
      const next = prev ? setIn(prev, path, value) : prev;
      draftRef.current = next;
      return next;
    });
  }, []);

  const editMany = useCallback((changes: Array<[string[], unknown]>) => {
    setDraft((prev) => {
      let next = prev;
      for (const [path, value] of changes) next = next ? setIn(next, path, value) : next;
      draftRef.current = next;
      return next;
    });
  }, []);

  const discard = useCallback(() => {
    setFeedback(null);
    draftRef.current = baseRef.current;
    setDraft(baseRef.current);
  }, []);

  const paths = useMemo(() => (base && draft ? changedPaths(base, draft) : []), [base, draft]);
  const invalid = useMemo(() => validate(draft), [draft]);

  const save = useCallback(
    async (note?: string) => {
      const current = baseRef.current;
      const working = draftRef.current;
      if (!current || !working || savingRef.current) return false;
      const pending = changedPaths(current, working);
      if (pending.length === 0) return false;
      savingRef.current = true;
      setSaving(true);
      setFeedback(null);
      try {
        const next = await window.fuber.invoke('policy.update', {
          baseRevision: current.revision,
          patch: buildPatch(working, pending),
          note: note?.trim() || t('admin.save.autoNote', { fields: describeChanges(pending) }),
        });
        baseRef.current = next;
        draftRef.current = next;
        setBase(next);
        setDraft(next);
        setFeedback({ kind: 'saved', revision: next.revision });
        window.clearTimeout(savedTimer.current);
        savedTimer.current = window.setTimeout(() => setFeedback((f) => (f?.kind === 'saved' ? null : f)), 3200);
        return true;
      } catch (reason) {
        const message = errorMessage(reason);
        // Ana süreç hata kodunu iletmiyor (yalnız metin); 409'un Türkçe metni sabittir.
        if (/bu arada değişti/i.test(message)) {
          try {
            const fresh = await window.fuber.invoke('policy.get');
            accept(fresh);
            setFeedback({ kind: 'conflict', revision: fresh.revision });
          } catch (inner) {
            setFeedback({ kind: 'error', message: errorMessage(inner) });
          }
        } else {
          setFeedback({ kind: 'error', message });
        }
        return false;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [accept],
  );

  const value = useMemo<PolicyStore>(
    () => ({
      feedback,
      base,
      draft,
      error,
      loading,
      paths,
      invalid,
      saving,
      edit,
      editMany,
      discard,
      save,
      reload,
      accept: (next) => void accept(next),
    }),
    [feedback, base, draft, error, loading, paths, invalid, saving, edit, editMany, discard, save, reload, accept],
  );

  return <PolicyContext.Provider value={value}>{children}</PolicyContext.Provider>;
}
