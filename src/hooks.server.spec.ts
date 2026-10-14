import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it, vi } from 'vitest';
import { handle } from './hooks.server';

function event(
	url: string,
	limiter?: { limit(options: { key: string }): Promise<{ success: boolean }> }
) {
	return {
		request: new Request(url, {
			method: 'POST',
			headers: { 'cf-connecting-ip': '203.0.113.10' }
		}),
		url: new URL(url),
		platform: limiter ? { env: { ARCHIVE_SEARCH_RATE_LIMITER: limiter } } : undefined
	} as RequestEvent;
}

describe('handle', () => {
	it('returns a rate-limit response before resolving an over-limit embedding request', async () => {
		const resolve = vi.fn().mockResolvedValue(new Response('resolved'));

		const response = await handle({
			event: event('https://archivist.test/api/embedding', {
				limit: vi.fn().mockResolvedValue({ success: false })
			}),
			resolve
		});

		expect(response.status).toBe(429);
		expect(resolve).not.toHaveBeenCalled();
	});

	it('resolves the prerendered gallery and non-embedding requests', async () => {
		const resolve = vi.fn().mockResolvedValue(new Response('resolved'));

		await expect(
			handle({
				event: event('https://archivist.test/', {
					limit: vi.fn().mockResolvedValue({ success: true })
				}),
				resolve
			})
		).resolves.toBeInstanceOf(Response);
		await expect(
			handle({ event: event('https://archivist.test/robots.txt'), resolve })
		).resolves.toBeInstanceOf(Response);
		expect(resolve).toHaveBeenCalledTimes(2);
	});
});
