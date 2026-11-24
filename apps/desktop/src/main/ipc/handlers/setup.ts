// Sahibi: T3. `setup.*` kanalları: kurulum sihirbazının adım durumu, yerel modeller ve ses sınamaları.
// Kalibrasyon ve yankı sınaması ses servisindedir (`voice/index.ts`); sonuçları cihazda kalıcıdır.
import { nowIso, type SetupState, type SetupStepId } from '@fuber/shared';
import type { RegisterHandlers } from '../router';

const STEPS: SetupStepId[] = ['welcome', 'connect', 'microphone', 'models', 'autostart', 'intro', 'done'];

export const register: RegisterHandlers = (ipc, services) => {
  const kv = services.store.kv('setup');

  const state = (): SetupState => {
    const completed = services.settings.get().setupCompletedAt !== null;
    const done = (kv.get<SetupStepId[]>('done') ?? []).filter((step) => STEPS.includes(step));
    const current = completed ? 'done' : (STEPS.find((step) => !done.includes(step)) ?? 'done');
    return { completed, done, current };
  };

  const publish = (): SetupState => {
    const next = state();
    services.bus.emit('setup.changed', next);
    return next;
  };

  ipc.handle('setup.state', () => state());
  ipc.handle('setup.completeStep', ({ step }) => {
    const done = new Set(kv.get<SetupStepId[]>('done') ?? []);
    done.add(step);
    kv.set('done', [...done]);
    return publish();
  });
  ipc.handle('setup.finish', () => {
    kv.set('done', STEPS);
    services.settings.update({ setupCompletedAt: nowIso() });
    services.windows.hide('setup');
    return publish();
  });

  ipc.handle('setup.models', () => services.models.status());
  ipc.handle('setup.downloadModels', ({ ids }) => services.models.download(ids));
  ipc.handle('setup.cancelDownloads', () => {
    services.models.cancel();
    return { ok: true as const };
  });

  ipc.handle('setup.testMic', ({ deviceId, seconds }) => services.voice.testMic(deviceId, seconds));
  ipc.handle('setup.testWake', ({ seconds }) => services.voice.testWake(seconds));
  ipc.handle('setup.calibrateWake', ({ samples }) => services.voice.calibrateWake(samples ?? 3));
  ipc.handle('setup.echoTest', () => services.voice.echoTest());
};
