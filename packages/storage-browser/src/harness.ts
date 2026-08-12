type WorkerResponse =
  | { readonly status: 'passed'; readonly persistent: true; readonly result: unknown }
  | { readonly status: 'failed'; readonly message: string };

const result = document.querySelector<HTMLOutputElement>('#result');
if (!result) throw new Error('Missing conformance result output');

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
  result.dataset.status = event.data.status;
  result.textContent = JSON.stringify(event.data);
  worker.terminate();
});
worker.addEventListener('error', (event) => {
  result.dataset.status = 'failed';
  result.textContent = event.message;
  worker.terminate();
});
