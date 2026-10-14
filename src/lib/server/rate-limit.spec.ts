import { describe, expect, it, vi } from 'vitest';
import { enforceEmbeddingRateLimit } from './rate-limit';

function limiter(success: boolean) {
	return { limit: vi.fn().mockResolvedValue({ success }) };
}

function embeddingRequest(headers: Record<string, string> = {}) {
	return new Request('https://archivist.test/api/embedding', { method: 'POST', headers });
}

describe('enforceEmbeddingRateLimit', () => {
	it('keys the limit on the client address', async () => {
		const embeddingLimiter = limiter(true);

		await enforceEmbeddingRateLimit(
			embeddingRequest({ 'cf-connecting-ip': '203.0.113.10' }),
			'/api/embedding',
			embeddingLimiter
		);

		expect(embeddingLimiter.limit).toHaveBeenCalledWith({ key: 'archive-search:203.0.113.10' });
	});

	it('uses an anonymous key when Cloudflare does not supply a client address', async () => {
		const embeddingLimiter = limiter(true);

		await enforceEmbeddingRateLimit(embeddingRequest(), '/api/embedding', embeddingLimiter);

		expect(embeddingLimiter.limit).toHaveBeenCalledWith({ key: 'archive-search:unknown' });
	});

	it('skips other routes and non-POST requests', async () => {
		const embeddingLimiter = limiter(true);

		await expect(
			enforceEmbeddingRateLimit(new Request('https://archivist.test/'), '/', embeddingLimiter)
		).resolves.toBeUndefined();
		await expect(
			enforceEmbeddingRateLimit(
				new Request('https://archivist.test/api/embedding'),
				'/api/embedding',
				embeddingLimiter
			)
		).resolves.toBeUndefined();
		expect(embeddingLimiter.limit).not.toHaveBeenCalled();
	});

	it('returns a cache-safe JSON 429 and reports an allowlisted event when limited', async () => {
		const report = vi.fn();
		const response = await enforceEmbeddingRateLimit(
			embeddingRequest(),
			'/api/embedding',
			limiter(false),
			report
		);

		expect(response?.status).toBe(429);
		expect(response?.headers.get('content-type')).toContain('application/json');
		expect(response?.headers.get('cache-control')).toBe('no-store');
		expect(response?.headers.get('retry-after')).toBe('60');
		expect(await response?.json()).toEqual({
			error: 'Too many search requests. Please try again in a minute.'
		});
		expect(report).toHaveBeenCalledWith({
			event: 'archive_search_rate_limited',
			route: '/api/embedding',
			status: 429
		});
	});

	it('fails closed without a binding', async () => {
		const response = await enforceEmbeddingRateLimit(
			embeddingRequest(),
			'/api/embedding',
			undefined,
			() => {}
		);

		expect(response?.status).toBe(503);
	});

	it('fails closed and reports no request detail when the limiter throws', async () => {
		const report = vi.fn();
		const response = await enforceEmbeddingRateLimit(
			embeddingRequest(),
			'/api/embedding',
			{ limit: vi.fn().mockRejectedValue(new Error('binding failed')) },
			report
		);

		expect(response?.status).toBe(503);
		expect(report).toHaveBeenCalledWith({
			event: 'archive_search_rate_limit_error',
			route: '/api/embedding'
		});
	});
});
