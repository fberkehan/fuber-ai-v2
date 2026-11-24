/**
 * Konağın çekirdeği: taşımadan bağımsızdır (Electron `parentPort` ya da Node IPC). İstekleri karşılar,
 * yetenek bağlamlarını tutar, `ctx` isteklerini ana sürece köprüler.
 */
import {
  type BridgeMethod,
  type HostRequest,
  type HostResult,
  type HostTransport,
  type MainToHost,
} from './protocol';
import { createSkillContext, type SkillContext } from './sandbox';

export interface HostCore {
  /** Yüklü yetenek kimlikleri. */
  loaded(): string[];
}

export function createHostCore(transport: HostTransport): HostCore {
  const live = new Map<string, SkillContext>();
  let nextBridge = 1;
  const bridgeWaiting = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();

  const bridgeFor = (skillId: string, mode: 'live' | 'selftest') => (method: BridgeMethod, params: unknown) =>
    new Promise<unknown>((resolve, reject) => {
      const id = nextBridge++;
      bridgeWaiting.set(id, { resolve, reject });
      transport.send({ kind: 'bridge', id, skillId, mode, method, params });
    });

  const logFor = (skillId: string) => (level: 'info' | 'warn' | 'error', text: string) =>
    transport.send({ kind: 'log', skillId, level, text });

  const handle = async (request: HostRequest): Promise<HostResult> => {
    switch (request.op) {
      case 'ping':
        return { pong: true, loaded: [...live.keys()] };

      case 'load': {
        live.get(request.skillId)?.dispose();
        live.delete(request.skillId);
        const context = createSkillContext({
          skillId: request.skillId,
          mode: 'live',
          bridge: bridgeFor(request.skillId, 'live'),
          log: logFor(request.skillId),
        });
        try {
          const tools = await context.load(request.script);
          live.set(request.skillId, context);
          return { tools };
        } catch (error) {
          context.dispose();
          throw error;
        }
      }

      case 'unload': {
        const context = live.get(request.skillId);
        context?.dispose();
        return { unloaded: live.delete(request.skillId) };
      }

      case 'call': {
        const context = live.get(request.skillId);
        if (!context) throw new Error(`yetenek yüklü değil: ${request.skillId}`);
        return { result: await context.call(request.tool, request.input) };
      }

      case 'selftest': {
        const context = createSkillContext({
          skillId: request.skillId,
          mode: 'selftest',
          bridge: bridgeFor(request.skillId, 'selftest'),
          log: logFor(request.skillId),
        });
        try {
          const { called, effects } = await context.selftest(request.script, request.selftestScript, request.spec);
          return { ok: true, error: null, called, effects };
        } catch (error) {
          // Öz-sınamanın tutmaması bir protokol hatası değil, sonuçtur.
          return { ok: false, error: error instanceof Error ? error.message : String(error), called: [], effects: 0 };
        } finally {
          context.dispose();
        }
      }
    }
  };

  transport.onMessage((message: MainToHost) => {
    if (message.kind === 'bridge-reply') {
      const waiting = bridgeWaiting.get(message.id);
      if (!waiting) return;
      bridgeWaiting.delete(message.id);
      if (message.ok) waiting.resolve(message.value);
      else waiting.reject(new Error(message.error));
      return;
    }
    const { id } = message;
    if (message.request.op === 'call') transport.send({ kind: 'running', id });
    handle(message.request).then(
      (result) => transport.send({ kind: 'response', id, ok: true, result }),
      (error: unknown) =>
        transport.send({ kind: 'response', id, ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
  });

  transport.send({ kind: 'ready' });
  return { loaded: () => [...live.keys()] };
}
