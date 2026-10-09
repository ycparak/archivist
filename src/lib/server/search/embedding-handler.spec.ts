import { describe, expect, it, vi } from 'vitest';
import { EMBEDDING } from '$lib/search/embedding';
import { handleEmbeddingRequest } from './embedding-handler';
const request = (body: unknown) =>
	new Request('https://archive.test/api/embedding', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
const vector = Array.from({ length: EMBEDDING.dimensions }, (_, index) => (index === 0 ? 2 : 0));

describe('query embedding endpoint', () => {
	it('validates the configuration, prefixes queries and normalizes vectors', async () => {
		const embed = vi.fn(async () => ({ data: [vector] }));
		const response = await handleEmbeddingRequest(
			request({ query: ' fox ', version: EMBEDDING.version }),
			embed
		);
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(embed).toHaveBeenCalledWith(EMBEDDING.queryPrefix + 'fox');
		expect(await response.json()).toEqual({
			version: EMBEDDING.version,
			vector: vector.map((v) => v / 2)
		});
	});
	it('rejects unknown versions, long queries and oversized bodies before inference', async () => {
		const embed = vi.fn();
		for (const body of [
			{ query: 'fox', version: 'old' },
			{ query: 'x'.repeat(401), version: EMBEDDING.version }
		])
			expect((await handleEmbeddingRequest(request(body), embed)).status).toBe(400);
		expect(
			(
				await handleEmbeddingRequest(
					request({ query: 'x'.repeat(5000), version: EMBEDDING.version }),
					embed
				)
			).status
		).toBe(413);
		expect(embed).not.toHaveBeenCalled();
	});
	it('fails explicitly for missing configuration and invalid provider vectors', async () => {
		expect(
			(
				await handleEmbeddingRequest(
					request({ query: 'fox', version: EMBEDDING.version }),
					undefined
				)
			).status
		).toBe(503);
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const response = await handleEmbeddingRequest(
				request({ query: 'secret-query', version: EMBEDDING.version }),
				async () => ({ data: [[1]] })
			);
			expect(response.status).toBe(503);
			expect(JSON.stringify(log.mock.calls)).not.toContain('secret-query');
		} finally {
			log.mockRestore();
		}
	});
});
