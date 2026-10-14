import { describe, expect, it, vi } from 'vitest';
import { downloadCapped } from './download';

function streaming(
	chunks: number[],
	{ declared, endless = false }: { declared?: number; endless?: boolean } = {}
) {
	const cancel = vi.fn();
	let sent = 0;
	const body = new ReadableStream<Uint8Array>({
		pull(controller) {
			if (sent < chunks.length) controller.enqueue(new Uint8Array(chunks[sent++]));
			else if (!endless) controller.close();
		},
		cancel
	});
	const headers = declared === undefined ? undefined : { 'content-length': String(declared) };
	return {
		cancel,
		fetchFn: (async () => new Response(body, { headers })) as unknown as typeof fetch
	};
}

describe('downloadCapped', () => {
	it('returns the whole body when it fits', async () => {
		const { fetchFn } = streaming([3, 4]);
		const result = await downloadCapped('https://cdn.test/a', { fetchFn, maxBytes: 10 });
		expect(result.kind === 'ok' && result.bytes.byteLength).toBe(7);
	});

	it('refuses a declared length over the cap without reading the body', async () => {
		const { fetchFn, cancel } = streaming([1024], { declared: 1024 });
		await expect(
			downloadCapped('https://cdn.test/a', { fetchFn, maxBytes: 512 })
		).resolves.toMatchObject({
			kind: 'too-large'
		});
		expect(cancel).toHaveBeenCalled();
	});

	it('cuts off an undeclared body as soon as it passes the cap', async () => {
		const { fetchFn, cancel } = streaming([300, 300, 300], { endless: true });
		await expect(
			downloadCapped('https://cdn.test/a', { fetchFn, maxBytes: 512 })
		).resolves.toMatchObject({
			kind: 'too-large'
		});
		expect(cancel).toHaveBeenCalled();
	});

	it('times out a body that stalls after the headers arrive', async () => {
		const { fetchFn } = streaming([10], { endless: true });
		const realFetch: typeof fetch = async (input, init) => {
			const response = await fetchFn(input, init);
			const reader = response.body!.getReader();
			const body = new ReadableStream<Uint8Array>({
				async pull(controller) {
					const { done, value } = await Promise.race([
						reader.read(),
						new Promise<never>((_, reject) =>
							init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason))
						)
					]);
					if (done) controller.close();
					else controller.enqueue(value);
				}
			});
			return new Response(body);
		};
		await expect(
			downloadCapped('https://cdn.test/a', { fetchFn: realFetch, maxBytes: 1024, timeoutMs: 50 })
		).rejects.toThrow();
	});

	it('reports an unreachable source without throwing', async () => {
		const fetchFn = (async () =>
			new Response('missing', { status: 404 })) as unknown as typeof fetch;
		await expect(downloadCapped('https://cdn.test/a', { fetchFn, maxBytes: 10 })).resolves.toEqual({
			kind: 'unreachable',
			reason: 'source returned HTTP 404',
			status: 404
		});
	});
});
