/**
 * Kum havuzlu preload (CJS demeti). Pencereye yalnız `window.fuber = { invoke, on }` açar.
 * Node ya da Electron nesnesi sayfaya sızdırılmaz.
 */

import { contextBridge, ipcRenderer } from 'electron';
import {
  IPC_EVENT_CHANNEL,
  IPC_INVOKE_CHANNEL,
  PORT_CHANNEL,
  type FuberBridge,
  type IpcResult,
} from '@fuber/shared';

type Listener = (payload: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

ipcRenderer.on(IPC_EVENT_CHANNEL, (_event, name: string, payload: unknown) => {
  const set = listeners.get(name);
  if (!set) return;
  for (const listener of set) listener(payload);
});

// contextBridge MessagePort taşıyamaz; port sayfaya DOM iletisiyle aktarılır.
// Sayfa: window.addEventListener('message', (e) => e.data?.fuberPort === 'audio' && use(e.ports[0]))
ipcRenderer.on(PORT_CHANNEL, (event, name: string) => {
  window.postMessage({ fuberPort: name }, '*', event.ports);
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

contextBridge.exposeInMainWorld('fuber', bridge as unknown as FuberBridge);
