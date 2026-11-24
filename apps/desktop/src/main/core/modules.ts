/**
 * Modül kaydı (KURGU §4.2): yerleşik modülleri ve kullanıcı yeteneklerini yükler/kapatır. Bir modül ancak
 * politika izin veriyorsa ve kullanıcı yerelde kapatmadıysa yüklüdür; politika değişince durum canlı güncellenir.
 * Yükleme sırası: göç → araç kaydı → IPC → pencere olayları → `setup`. Herhangi bir adımın hatası yalnız o
 * modülü düşürür ve `ModuleInfo.error` olarak görünür.
 */

import {
  t,
  UserError,
  type BusEvents,
  type ModuleContext,
  type ModuleDef,
  type ModuleInfo,
  type ModuleRegistry,
  type ServiceDeps,
  type Unsubscribe,
} from '@fuber/shared';
import { declareModule } from './tools';

type ChangeReason = BusEvents['module.changed']['reason'];

/** Kullanıcı yetenekleri politikada kendi kimlikleriyle yer almaz; izinleri Atölye modülünün iznidir. */
const SKILL_POLICY_ID = 'workshop';

interface Slot {
  def: ModuleDef;
  kind: ModuleInfo['kind'];
  /** Yüklüyse kapatırken geri alınacaklar (ters sırayla). */
  disposers: Unsubscribe[] | null;
  error: string | null;
  /** Son eşitlemede yüklü olması isteniyor muydu (hata veren modül her politika değişiminde yeniden denenmesin diye). */
  wanted: boolean;
}

export function createModules(deps: ServiceDeps['modules']): ModuleRegistry {
  const log = deps.log.child('modules');
  const slots = new Map<string, Slot>();
  let watching = false;

  // Yükleme/kapatma işleri tek sıradan geçer: art arda gelen politika değişimleri birbirine girmez.
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => {
    const next = queue.then(work, work);
    queue = next.catch(() => {});
    return next;
  };

  const policyId = (slot: Slot) => (slot.kind === 'skill' ? SKILL_POLICY_ID : slot.def.id);
  const allowed = (slot: Slot) => deps.policy.moduleAllowed(policyId(slot));
  const wanted = (slot: Slot) => allowed(slot) && !deps.settings.get().disabledModules.includes(slot.def.id);

  const context = (id: string): ModuleContext => ({
    moduleId: id,
    bus: deps.bus,
    db: deps.store.scoped(id),
    memory: deps.memory,
    scheduler: deps.scheduler,
    attention: deps.attention,
    brain: deps.brain,
    policy: deps.policy,
    jobs: deps.jobs,
    voice: deps.voice,
    stage: deps.stage,
    presence: deps.presence,
    conversation: deps.conversation,
    settings: deps.settings,
    usage: deps.usage,
    tools: deps.tools,
    log: deps.log.child(id),
    paths: deps.paths,
  });

  const info = (slot: Slot): ModuleInfo => {
    const { def } = slot;
    const loaded = slot.disposers !== null;
    return {
      id: def.id,
      version: def.version,
      kind: slot.kind,
      nameKey: def.nameKey,
      descriptionKey: def.descriptionKey,
      permissions: def.permissions,
      allowed: allowed(slot),
      enabled: loaded,
      // Yüklü modülün çalışma anında eklediği araçlar da görünür; kapalıyken tanımdaki liste.
      tools: loaded
        ? deps.tools.list().filter((tool) => tool.moduleId === def.id)
        : (def.tools ?? []).map(({ name, description, risk }) => ({ name, description, risk, moduleId: def.id })),
      page: def.page ?? null,
      error: slot.error,
    };
  };

  const dispose = (disposers: Unsubscribe[], id: string) => {
    for (const off of [...disposers].reverse()) {
      try {
        off();
      } catch (error) {
        log.warn(`${id}: kapatma adımı hata verdi`, error);
      }
    }
    deps.tools.unregisterModule(id);
    declareModule(deps.tools, id, null);
  };

  const load = async (slot: Slot, reason: ChangeReason) => {
    const { def } = slot;
    const disposers: Unsubscribe[] = [];
    try {
      const ctx = context(def.id);
      if (def.migrations?.length) deps.store.migrate(def.id, def.migrations);
      declareModule(deps.tools, def.id, { permissions: def.permissions, policyId: policyId(slot) });
      if (def.tools?.length) disposers.push(deps.tools.register(ctx, def.tools));
      if (def.ipc) disposers.push(deps.ipc.register(def.ipc(ctx)));
      for (const event of def.windowEvents ?? []) {
        // Modül olayları `BusEvents` ve `WindowEvents`'e aynı adla, tip genişletmesiyle eklenir.
        disposers.push(deps.bus.on(event as keyof BusEvents, (payload) => deps.windows.broadcast(event, payload as never)));
      }
      await def.setup?.(ctx);
      slot.disposers = disposers;
      slot.error = null;
      log.info(`${def.id} yüklendi (${reason})`);
      deps.bus.emit('module.changed', { id: def.id, enabled: true, reason });
    } catch (error) {
      try {
        await def.teardown?.();
      } catch {
        // yarım kurulan modülün kapanışı da hata verebilir; asıl hata aşağıda bildirilir
      }
      dispose(disposers, def.id);
      slot.disposers = null;
      slot.error = t('module.error.load', { detail: (error as Error)?.message ?? String(error) });
      log.error(`${def.id} yüklenemedi`, error);
      deps.bus.emit('module.changed', { id: def.id, enabled: false, reason: 'error' });
    }
  };

  const unload = async (slot: Slot, reason: ChangeReason) => {
    const disposers = slot.disposers;
    if (!disposers) return;
    slot.disposers = null;
    try {
      await slot.def.teardown?.();
    } catch (error) {
      log.warn(`${slot.def.id}: teardown hata verdi`, error);
    }
    dispose(disposers, slot.def.id);
    log.info(`${slot.def.id} kapandı (${reason})`);
    deps.bus.emit('module.changed', { id: slot.def.id, enabled: false, reason });
  };

  /** Modülü olması gereken duruma getirir. `retry`: hata vermiş modül yeniden denensin mi. */
  const reconcile = async (slot: Slot, reason: ChangeReason, retry: boolean) => {
    const want = wanted(slot);
    const becameWanted = want && !slot.wanted;
    slot.wanted = want;
    if (!want) {
      slot.error = null;
      await unload(slot, reason);
    } else if (!slot.disposers && (slot.error === null || retry || becameWanted)) {
      await load(slot, reason);
    }
  };

  const syncAll = (reason: ChangeReason) =>
    serial(async () => {
      for (const slot of [...slots.values()]) await reconcile(slot, reason, false);
    });

  const need = (id: string): Slot => {
    const slot = slots.get(id);
    if (!slot) throw new UserError(t('module.error.unknown', { id }));
    return slot;
  };

  return {
    loadBuiltins(defs) {
      if (!watching) {
        watching = true;
        deps.bus.on('settings.changed', ({ changedKeys }) => {
          if (changedKeys.includes('disabledModules')) void syncAll('user');
        });
      }
      return serial(async () => {
        for (const def of defs) {
          if (slots.has(def.id)) {
            log.error(`modül kimliği yineleniyor, ikincisi atlandı: ${def.id}`);
            continue;
          }
          const slot: Slot = { def, kind: 'builtin', disposers: null, error: null, wanted: false };
          slots.set(def.id, slot);
          await reconcile(slot, 'policy', false);
        }
      });
    },

    add(def, kind) {
      return serial(async () => {
        if (slots.has(def.id)) throw new UserError(`“${def.id}” kimliğinde bir modül zaten var.`);
        const slot: Slot = { def, kind, disposers: null, error: null, wanted: false };
        slots.set(def.id, slot);
        await reconcile(slot, 'added', false);
        return info(slot);
      });
    },

    remove(id) {
      return serial(async () => {
        const slot = slots.get(id);
        if (!slot) return;
        const wasLoaded = slot.disposers !== null;
        await unload(slot, 'removed');
        slots.delete(id);
        if (!wasLoaded) deps.bus.emit('module.changed', { id, enabled: false, reason: 'removed' });
      });
    },

    list: () => [...slots.values()].map(info),
    get: (id) => {
      const slot = slots.get(id);
      return slot ? info(slot) : null;
    },

    setEnabled(id, enabled) {
      return serial(async () => {
        const slot = need(id);
        if (enabled && !allowed(slot)) throw new UserError(t('module.error.policy'));
        const disabled = new Set(deps.settings.get().disabledModules);
        if (enabled) disabled.delete(id);
        else disabled.add(id);
        deps.settings.update({ disabledModules: [...disabled].sort() });
        await reconcile(slot, 'user', true);
        return info(slot);
      });
    },

    purgeData(id) {
      return serial(async () => {
        const slot = need(id);
        const { def } = slot;
        if (!def.purge) throw new UserError(t('module.error.noPurge'));
        // Modül hiç yüklenmediyse tabloları yoktur; silme boş tabloda zararsızdır.
        if (def.migrations?.length) deps.store.migrate(def.id, def.migrations);
        await def.purge(context(def.id));
        log.info(`${def.id}: kullanıcı verisi silindi`);
      });
    },

    sync: () => syncAll('policy'),

    stopAll() {
      return serial(async () => {
        for (const slot of [...slots.values()].reverse()) await unload(slot, 'removed');
      });
    },
  };
}
