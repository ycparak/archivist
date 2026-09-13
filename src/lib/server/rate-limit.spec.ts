import { describe, expect, it, vi } from 'vitest';
import { enforcePublicSearchRateLimit } from './rate-limit';

function limiter(success: boolean) {
	return { limit: vi.fn().mockResolvedValue({ success }) };
}

describe('enforcePublicSearchRateLimit', () => {
	it('uses one client key for both public search surfaces', async () => {
		const searchLimiter = limiter(true);
		const request = new Request('https://archivist.test/?q=felt', {
			headers: { 'cf-connecting-ip': '203.0.113.10' }
		});

		await enforcePublicSearchRateLimit(request, '/', searchLimiter);
		await enforcePublicSearchRateLimit(
			new Request('https://archivist.test/api/search?q=felt', {
				headers: { 'cf-connecting-ip': '203.0.113.10' }
			}),
			'/api/search',
			searchLimiter
		);

		expect(searchLimiter.limit).toHaveBeenNthCalledWith(1, { key: 'archive-search:203.0.113.10' });
		expect(searchLimiter.limit).toHaveBeenNthCalledWith(2, { key: 'archive-search:203.0.113.10' });
	});

	it('uses an anonymous key when Cloudflare does not supply a client address', async () => {
		const searchLimiter = limiter(true);

		await enforcePublicSearchRateLimit(new Request('https://archivist.test/'), '/', searchLimiter);

		expect(searchLimiter.limit).toHaveBeenCalledWith({ key: 'archive-search:unknown' });
	});

	it('skips non-search routes, non-GET requests, and local requests without a binding', async () => {
		const searchLimiter = limiter(true);

		await expect(
			enforcePublicSearchRateLimit(
				new Request('https://archivist.test/about'),
				'/about',
				searchLimiter
			)
		).resolves.toBeUndefined();
		await expect(
			enforcePublicSearchRateLimit(
				new Request('https://archivist.test/', { method: 'HEAD' }),
				'/',
				searchLimiter
			)
		).resolves.toBeUndefined();
		await expect(
			enforcePublicSearchRateLimit(new Request('https://archivist.test/'), '/', undefined)
		).resolves.toBeUndefined();
		expect(searchLimiter.limit).not.toHaveBeenCalled();
	});

	it('returns a cache-safe JSON response and reports an allowlisted event for a limited API search', async () => {
		const report = vi.fn();
		const response = await enforcePublicSearchRateLimit(
			new Request('https://archivist.test/api/search?q=private+felt'),
			'/api/search',
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
			route: '/api/search',
			status: 429
		});
	});

	it('returns a cache-safe HTML response for a limited gallery request', async () => {
		const response = await enforcePublicSearchRateLimit(
			new Request('https://archivist.test/?q=felt'),
			'/',
			limiter(false),
			() => {}
		);

		expect(response?.status).toBe(429);
		expect(response?.headers.get('content-type')).toContain('text/html');
		expect(response?.headers.get('cache-control')).toBe('no-store');
		expect(response?.headers.get('retry-after')).toBe('60');
		expect(await response?.text()).toContain('Try again soon');
	});

	it('fails open and reports no request detail when the limiter binding throws', async () => {
		const report = vi.fn();
		const searchLimiter = { limit: vi.fn().mockRejectedValue(new Error('binding failed')) };

		await expect(
			enforcePublicSearchRateLimit(
				new Request('https://archivist.test/?q=private+felt'),
				'/',
				searchLimiter,
				report
			)
		).resolves.toBeUndefined();
		expect(report).toHaveBeenCalledWith({ event: 'archive_search_rate_limit_error', route: '/' });
	});
});
