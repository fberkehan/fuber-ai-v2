import { useCallback, useEffect, useRef, useState } from 'react';
import type { ModuleInfo, SkillInfo } from '@fuber/shared';
import type { WorkshopStatus } from '../../../../main/modules/workshop/types';

export interface SkillsData {
  /** İlk yükleme sürüyor. */
  loading: boolean;
  /** Yüklenemediyse kullanıcıya gösterilecek ileti. */
  error: string | null;
  skills: SkillInfo[];
  status: WorkshopStatus | null;
  modules: ModuleInfo[];
  /** Bulut beyni yeniden yoklanıyor. */
  probing: boolean;
  refresh(): void;
  /** Bulutu gerçek bir istekle yeniden yoklar. */
  probeCloud(): void;
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Yetenekler sayfasının verisi: yetenek listesi, Atölye durumu (bulut, süren yapımlar) ve yerleşik modüller.
 * Değişiklik olaylarında yeniden çeker; art arda gelen olaylar tek çağrıda toplanır.
 */
export function useSkills(): SkillsData {
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [status, setStatus] = useState<WorkshopStatus | null>(null);
  const [modules, setModules] = useState<ModuleInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [probing, setProbing] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const load = useCallback(async (probe: boolean) => {
    try {
      const [list, next] = await Promise.all([window.fuber.invoke('skills.list'), window.fuber.invoke('workshop.status', { probe })]);
      if (!alive.current) return;
      setSkills(list);
      setStatus(next);
      setError(null);
    } catch (failure) {
      if (alive.current) setError(message(failure));
    } finally {
      if (alive.current) setLoading(false);
    }
  }, []);

  const loadModules = useCallback(() => {
    window.fuber.invoke('modules.list').then(
      (list) => alive.current && setModules(list),
      () => {
        // Yerleşik liste bilgilendirme içindir; alınamazsa bölüm boş kalır.
      },
    );
  }, []);

  const refresh = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(false), 60);
  }, [load]);

  const probeCloud = useCallback(() => {
    setProbing(true);
    void load(true).finally(() => alive.current && setProbing(false));
  }, [load]);

  useEffect(() => {
    alive.current = true;
    // Sayfa açılınca bulut gerçekten yoklanır (ana süreç sonucu birkaç dakika önbellekte tutar).
    void load(true);
    loadModules();
    const offSkills = window.fuber.on('skills.changed', refresh);
    const offJobs = window.fuber.on('job.progress', ({ job }) => {
      if (job.kind === 'workshop.skill_build') refresh();
    });
    const offModules = window.fuber.on('module.changed', loadModules);
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
      offSkills();
      offJobs();
      offModules();
    };
  }, [load, loadModules, refresh]);

  return { loading, error, skills, status, modules, probing, refresh, probeCloud };
}
