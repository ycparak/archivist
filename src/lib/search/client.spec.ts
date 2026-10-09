import { describe, expect, it, vi } from 'vitest';
import { BrowserSearchClient } from './client';
import { readArchiveSearchState } from '$lib/domain/search';
import { EMBEDDING } from './embedding';
import type { SearchRelease } from './snapshot';
import type { WorkerResponse } from './protocol';

const asset = { file: 'metadata.json', sha256: 'a'.repeat(64), bytes: 1 };
const release: SearchRelease = {
	version: 'b'.repeat(64),
	embeddingVersion: EMBEDDING.version,
	dimensions: 384,
	blockCount: 1,
	vectorCount: 1,
	metadata: asset,
	lexical: asset,
	vectors: [asset],
	bootstrap: asset
};
function setup() {
	const worker = { postMessage: vi.fn(), terminate: vi.fn(), addEventListener: vi.fn() };
	const client = new BrowserSearchClient(worker, release);
	const message = worker.addEventListener.mock.calls.find(([type]) => type === 'message')![1] as (
		event: MessageEvent<WorkerResponse>
	) => void;
	return { worker, client, message };
}
describe('browser search request ownership', () => {
	it('ignores cancelled replies and resolves only the current request', async () => {
		const { worker, client, message } = setup();
		const first = new AbortController(),
			second = new AbortController();
		const stale = client.search(new URLSearchParams('q=old'), first.signal);
		const rejected = expect(stale).rejects.toThrow('Aborted');
		first.abort();
		await rejected;
		const current = client.search(new URLSearchParams('q=new'), second.signal);
		const outcome = {
			kind: 'invalid' as const,
			state: readArchiveSearchState(new URLSearchParams('q=new'))
		};
		message(new MessageEvent('message', { data: { id: 1, outcome } }));
		message(new MessageEvent('message', { data: { id: 2, outcome } }));
		await expect(current).resolves.toEqual(outcome);
		expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cancel', id: 1 });
		client.destroy();
		expect(worker.terminate).toHaveBeenCalledOnce();
	});
	it('rejects pending work and future requests when the worker is destroyed', async () => {
		const { client } = setup();
		const pending = client.search(new URLSearchParams(), new AbortController().signal);
		const rejected = expect(pending).rejects.toThrow('unavailable');
		client.destroy();
		await rejected;
		await expect(
			client.search(new URLSearchParams(), new AbortController().signal)
		).rejects.toThrow('unavailable');
	});
});
