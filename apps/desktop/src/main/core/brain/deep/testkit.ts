// Derin beyin sınamalarının ortak yardımcıları. Uygulama demetine girmez (yalnız sınamalar içe aktarır).
import type { BrainApi, BrainRequest, BrainResponse, BrainStatus, BrainTaskRequest } from '@fuber/shared';

export { fakeCli, tempDir } from '../../claude-cli/testkit';

export const brainOk = (text: string): BrainResponse => ({
  text,
  stopReason: 'end',
  error: null,
  toolCalls: [],
  usage: { inputTokens: 1, outputTokens: 1, costUsd: 0, durationMs: 1 },
});

export const brainFail = (stopReason: BrainResponse['stopReason'], error: string): BrainResponse => ({ ...brainOk(''), stopReason, error });

/** Çağrıları kaydeden sahte beyin. `answer` her çağrıda sorulur; `status` bulutun durumunu taklit eder. */
export function recordingBrain(options: { answer?: (request: BrainRequest | BrainTaskRequest) => BrainResponse | Promise<BrainResponse>; status?: () => Partial<BrainStatus> } = {}) {
  const calls: Array<{ kind: 'respond' | 'runTask'; request: BrainRequest | BrainTaskRequest }> = [];
  let statusCalls = 0;
  const brain: BrainApi = {
    async respond(request) {
      calls.push({ kind: 'respond', request });
      return (await options.answer?.(request)) ?? brainOk('API yanıtı');
    },
    async runTask(request) {
      calls.push({ kind: 'runTask', request });
      return (await options.answer?.(request)) ?? brainOk('API yanıtı');
    },
    async extract() {
      return null;
    },
    availability: () => ({ ok: true, reason: null }),
    status() {
      statusCalls++;
      return { provider: 'cloud', reason: 'ok', cause: null, localReady: false, localModel: '', message: null, ...options.status?.() };
    },
    prewarm: async () => {},
  };
  return { brain, calls, statusCalls: () => statusCalls };
}
