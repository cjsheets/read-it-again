import type { WorkerRequestInput, WorkerResponse } from './protocol.js';

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
const pending = new Map<
  string,
  { readonly resolve: (response: WorkerResponse) => void; readonly reject: (error: Error) => void }
>();

worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
  const handler = pending.get(event.data.id);
  if (!handler) return;
  pending.delete(event.data.id);
  handler.resolve(event.data);
});

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
