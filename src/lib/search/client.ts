import type { SearchRelease } from './snapshot';
import type { BrowserSearchOutcome, WorkerRequest, WorkerResponse } from './protocol';

type SearchWorker = Pick<Worker, 'postMessage' | 'terminate' | 'addEventListener'>;

export class BrowserSearchClient {
	private nextId = 0;
	private closed = false;
	private pending = new Map<
		number,
		{
			resolve: (outcome: BrowserSearchOutcome) => void;
			reject: (error: Error) => void;
			cleanup: () => void;
		}
	>();
	constructor(
		private worker: SearchWorker,
		release: SearchRelease
	) {
		worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
			const request = this.pending.get(event.data.id);
			if (!request) return;
			this.pending.delete(event.data.id);
			request.cleanup();
			request.resolve(event.data.outcome);
		});
		worker.addEventListener('error', () => this.destroy());
		worker.addEventListener('messageerror', () => this.destroy());
		worker.postMessage({ type: 'initialize', release } satisfies WorkerRequest);
	}
	search(params: URLSearchParams, signal: AbortSignal): Promise<BrowserSearchOutcome> {
		if (this.closed) return Promise.reject(new Error('Search worker is unavailable'));
		if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
		const id = ++this.nextId;
		return new Promise((resolve, reject) => {
			const abort = () => {
				this.pending.delete(id);
				signal.removeEventListener('abort', abort);
				this.worker.postMessage({ type: 'cancel', id } satisfies WorkerRequest);
				reject(new DOMException('Aborted', 'AbortError'));
			};
			this.pending.set(id, {
				resolve,
				reject,
				cleanup: () => signal.removeEventListener('abort', abort)
			});
			signal.addEventListener('abort', abort, { once: true });
			this.worker.postMessage({
				type: 'search',
				id,
				params: params.toString()
			} satisfies WorkerRequest);
		});
	}
	destroy(): void {
		this.closed = true;
		this.worker.terminate();
		for (const request of this.pending.values()) {
			request.cleanup();
			request.reject(new Error('Search worker is unavailable'));
		}
		this.pending.clear();
	}
}
