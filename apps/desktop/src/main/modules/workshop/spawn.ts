/**
 * Yetenek konağını Electron `utilityProcess` olarak başlatır. Electron'a dokunan tek Atölye dosyasıdır;
 * geri kalanı soyut `HostProcess` arayüzüyle çalışır (birim sınamaları Node çocuk süreci kullanır).
 */
import { app, utilityProcess } from 'electron';
import type { ModuleContext } from '@fuber/shared';
import type { HostToMain } from '../../../skill-host/protocol';
import { runtime } from '../../runtime';
import { defaultUserFolders, type UserFolders } from './bridge';
import type { HostProcess } from './host';

/** Eklentilerin `fs.roots` belirteçlerinin bu bilgisayardaki klasörleri (Belgeler taşınmış olabilir: Windows'a sorulur). */
export function userFolders(): UserFolders {
  const fallback = defaultUserFolders();
  const of = (name: 'documents' | 'desktop' | 'downloads', otherwise: string) => {
    try {
      return app.getPath(name);
    } catch {
      return otherwise;
    }
  };
  return { belgeler: of('documents', fallback.belgeler), masaustu: of('desktop', fallback.masaustu), indirilenler: of('downloads', fallback.indirilenler) };
}

const MAX_STDERR_CHARS = 2000;

export function spawnSkillHost(ctx: ModuleContext): HostProcess {
  const log = ctx.log.child('konak');
  const child = utilityProcess.fork(runtime.skillHostPath, [], {
    serviceName: 'Fuber AI 2 Skill Host',
    // Boş ortam: API anahtarları, kullanıcı yolları ve belirteçler konağa hiç geçmez.
    env: {},
    // Çalışma dizini yetenek kökü: konak uygulama klasöründe ya da kullanıcının ev dizininde durmaz.
    cwd: ctx.paths.skills,
    stdio: ['ignore', 'ignore', 'pipe'],
  });

  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => {
    stderr = (stderr + chunk.toString('utf8')).slice(-MAX_STDERR_CHARS);
  });

  return {
    postMessage: (message) => child.postMessage(message),
    onMessage: (listener) => void child.on('message', (message: unknown) => listener(message as HostToMain)),
    onExit(listener) {
      child.once('exit', (code) => {
        if (code !== 0 && stderr.trim()) log.warn(`konak çıktısı: ${stderr.trim()}`);
        listener(code);
      });
    },
    kill: () => void child.kill(),
  };
}
