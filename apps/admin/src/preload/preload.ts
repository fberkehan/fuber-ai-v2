/**
 * Kum havuzlu preload (CJS demeti). Pencereye yalnız `window.fuber = { invoke, on }` açar.
 */

import { contextBridge, ipcRenderer } from 'electron';
import { IPC_EVENT_CHANNEL, IPC_INVOKE_CHANNEL, type AdminBridge, type IpcResult } from '@fuber/shared';

type Listener = (payload: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

ipcRenderer.on(IPC_EVENT_CHANNEL, (_event, name: string, payload: unknown) => {
  const set = listeners.get(name);
  if (!set) return;
  for (const listener of set) listener(payload);
});

const bridge = {
  async invoke(channel: string, payload?: unknown): Promise<unknown> {
    const result = (await ipcRenderer.invoke(IPC_INVOKE_CHANNEL, channel, payload)) as IpcResult<unknown>;
    if (result.ok) return result.data;
    throw new Error(result.error.message);
  },
  on(event: string, listener: Listener): () => void {
    let set = listeners.get(event);
    if (!set) {
      set = new Set();
      listeners.set(event, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  },
};

contextBridge.exposeInMainWorld('fuber', bridge as unknown as AdminBridge);
