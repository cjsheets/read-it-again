import type { WorkerEvent, WorkerRequestInput, WorkerResponse } from './protocol.js';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<
  string,
  { readonly resolve: (response: WorkerResponse) => void; readonly reject: (error: Error) => void }
>();

const eventListeners = new Set<(event: WorkerEvent) => void>();

worker.addEventListener('message', (event: MessageEvent<WorkerResponse | WorkerEvent>) => {
  if (!('id' in event.data)) {
    for (const listener of eventListeners) listener(event.data);
    return;
  }
  const handler = pending.get(event.data.id);
  if (!handler) return;
  pending.delete(event.data.id);
  handler.resolve(event.data);
});

export function onWorkerEvent(listener: (event: WorkerEvent) => void): () => void {
  eventListeners.add(listener);
  return () => eventListeners.delete(listener);
}

worker.addEventListener('error', (event) => {
  for (const handler of pending.values()) handler.reject(new Error(event.message));
  pending.clear();
});

export function requestWorker(request: WorkerRequestInput): Promise<WorkerResponse> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker.postMessage({ ...request, id });
  });
}
