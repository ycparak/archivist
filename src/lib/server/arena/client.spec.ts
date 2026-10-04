import { describe, expect, it, vi } from 'vitest';
import {
	ArenaClient,
	ArenaRateLimitError,
	ArenaRequestError,
	computeProactiveWaitMs,
	countBlockConnections,
	paginateChannelContents,
	paginateOwnedChannels,
	parseRateLimitInfo,
	resolveRateLimitRetryDelayMs
} from './client';

const connection = { connected_at: '2023-01-15T10:30:00Z' };

function textBlock(id: number) {
	return {
		id,
		type: 'Text' as const,
		title: null,
		description: null,
		created_at: '2023-01-15T10:30:00Z',
		connection,
		content: { markdown: 'hi', html: '<p>hi</p>', plain: 'hi' }
	};
}

function ownedChannel(id: number, slug: string, title: string) {
	return { id, type: 'Channel' as const, slug, title, visibility: 'public' as const };
}

function pageResponse(
	data: unknown[],
	meta: Partial<Record<string, unknown>> = {},
	headers: Record<string, string> = {}
) {
	return new Response(
		JSON.stringify({
			data,
			meta: {
				current_page: 1,
				next_page: null,
				per_page: 50,
				total_pages: 1,
				total_count: data.length,
				has_more_pages: false,
				...meta
			}
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json', ...headers } }
	);
}

describe('resolveRateLimitRetryDelayMs', () => {
	it('prefers Retry-After when present', () => {
		const headers = new Headers({ 'Retry-After': '2' });
		expect(resolveRateLimitRetryDelayMs(headers)).toBe(2000);
	});

	it('falls back to X-RateLimit-Reset when Retry-After is absent', () => {
		const now = 1_700_000_000_000;
		const resetEpochSeconds = now / 1000 + 5;
		const headers = new Headers({ 'X-RateLimit-Reset': String(resetEpochSeconds) });
		expect(resolveRateLimitRetryDelayMs(headers, () => now)).toBe(5000);
	});

	it('floors the delay so a stale or zero reset does not cause a retry storm', () => {
		const headers = new Headers({ 'Retry-After': '0' });
		expect(resolveRateLimitRetryDelayMs(headers)).toBe(1000);
	});

	it('floors when neither header is present or parseable', () => {
		expect(resolveRateLimitRetryDelayMs(new Headers())).toBe(1000);
	});
});

describe('parseRateLimitInfo', () => {
	it('reads every documented header', () => {
		const headers = new Headers({
			'X-RateLimit-Limit': '120',
			'X-RateLimit-Remaining': '3',
			'X-RateLimit-Reset': '1700000000',
			'X-RateLimit-Window': '60',
			'X-RateLimit-Tier': 'free'
		});
		expect(parseRateLimitInfo(headers)).toEqual({
			limit: 120,
			remaining: 3,
			reset: 1700000000,
			windowSeconds: 60,
			tier: 'free'
		});
	});

	it('nulls out fields for missing or unparseable headers', () => {
		expect(parseRateLimitInfo(new Headers())).toEqual({
			limit: null,
			remaining: null,
			reset: null,
			windowSeconds: null,
			tier: null
		});
	});
});

describe('computeProactiveWaitMs', () => {
	it('waits until reset once remaining drops to the safety margin', () => {
		const now = 1_700_000_000_000;
		const rateLimit = {
			limit: 120,
			remaining: 1,
			reset: now / 1000 + 4,
			windowSeconds: 60,
			tier: 'free'
		};
		expect(computeProactiveWaitMs(rateLimit, 1, () => now)).toBe(4000);
	});

	it('does nothing while comfortably above the safety margin', () => {
		const rateLimit = {
			limit: 120,
			remaining: 50,
			reset: 1700000000,
			windowSeconds: 60,
			tier: 'free'
		};
		expect(computeProactiveWaitMs(rateLimit, 1)).toBe(0);
	});

	it('does nothing when remaining is unknown', () => {
		const rateLimit = {
			limit: null,
			remaining: null,
			reset: null,
			windowSeconds: null,
			tier: null
		};
		expect(computeProactiveWaitMs(rateLimit, 1)).toBe(0);
	});
});

describe('ArenaClient.fetchChannelContentsPage', () => {
	it('requests the expected URL and auth header, and validates the body', async () => {
		const fetchFn = vi.fn().mockResolvedValue(pageResponse([textBlock(1)]));
		const client = new ArenaClient({ accessToken: 'secret-token', fetchFn });

		const result = await client.fetchChannelContentsPage('my-channel', {
			page: 2,
			per: 30,
			sort: 'created_at_desc'
		});

		expect(result.data).toHaveLength(1);
		const [request] = fetchFn.mock.calls[0] as [Request];
		expect(request.url).toBe(
			'https://api.are.na/v3/channels/my-channel/contents?page=2&per=30&sort=created_at_desc'
		);
		expect(request.headers.get('Authorization')).toBe('Bearer secret-token');
	});

	it('attaches parsed rate-limit info from the response headers', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue(pageResponse([], {}, { 'X-RateLimit-Remaining': '5' }));
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		const result = await client.fetchChannelContentsPage('c');
		expect(result.rateLimit.remaining).toBe(5);
	});

	it('rejects a per outside [1, 100] without making a request', async () => {
		const fetchFn = vi.fn();
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		await expect(client.fetchChannelContentsPage('c', { per: 101 })).rejects.toThrow(RangeError);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('throws ArenaRequestError on a non-429 error status', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('server exploded', { status: 500 }));
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		await expect(client.fetchChannelContentsPage('c')).rejects.toThrow(ArenaRequestError);
	});

	it('throws ArenaRateLimitError with a computed retry delay on 429', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '3' } }));
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		const error = await client.fetchChannelContentsPage('c').catch((e) => e);
		expect(error).toBeInstanceOf(ArenaRateLimitError);
		expect(error.retryAfterMs).toBe(3000);
	});

	it('fails explicitly when the response body does not match the schema', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ data: [{ id: 1, type: 'Text' }] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		await expect(client.fetchChannelContentsPage('c')).rejects.toThrow();
	});

	it('propagates a network failure instead of swallowing it', async () => {
		const fetchFn = vi.fn().mockRejectedValue(new TypeError('network unreachable'));
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		const error = await client.fetchChannelContentsPage('c').catch((e) => e);
		expect(error).toBeInstanceOf(Error);
		expect(error.cause).toBeInstanceOf(TypeError);
		expect(error.cause.message).toBe('network unreachable');
	});
});

describe('ArenaClient.me', () => {
	it('resolves and validates the current user', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ id: 558206, slug: 'yusuf-parak', email: 'y@example.com' }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		const me = await client.me();
		expect(me).toEqual({ id: 558206, slug: 'yusuf-parak' });
		const [request] = fetchFn.mock.calls[0] as [Request];
		expect(request.url).toBe('https://api.are.na/v3/me');
	});

	it('maps a non-429 error status to ArenaRequestError', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('nope', { status: 401 }));
		const client = new ArenaClient({ accessToken: 'bad-token', fetchFn });

		await expect(client.me()).rejects.toThrow(ArenaRequestError);
	});
});

describe('ArenaClient.fetchOwnedChannelsPage', () => {
	it('requests the user-contents endpoint filtered to Channel', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue(pageResponse([ownedChannel(1, 'a-channel', 'A Channel')]));
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		const result = await client.fetchOwnedChannelsPage(558206, { page: 1, per: 50 });

		expect(result.data).toEqual([
			{ id: 1, type: 'Channel', slug: 'a-channel', title: 'A Channel', visibility: 'public' }
		]);
		const [request] = fetchFn.mock.calls[0] as [Request];
		expect(request.url).toBe(
			'https://api.are.na/v3/users/558206/contents?page=1&per=50&type=Channel'
		);
	});

	it('rejects a per outside [1, 100] without making a request', async () => {
		const fetchFn = vi.fn();
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		await expect(client.fetchOwnedChannelsPage(1, { per: 0 })).rejects.toThrow(RangeError);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it('throws ArenaRateLimitError on 429, same as channel contents', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '2' } }));
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		const error = await client.fetchOwnedChannelsPage(1).catch((e) => e);
		expect(error).toBeInstanceOf(ArenaRateLimitError);
		expect(error.retryAfterMs).toBe(2000);
	});
});

describe('paginateChannelContents', () => {
	it('yields every page until has_more_pages is false, pacing between requests', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(pageResponse([textBlock(1)], { has_more_pages: true, next_page: 2 }))
			.mockResolvedValueOnce(pageResponse([textBlock(2)], { has_more_pages: false }));
		const client = new ArenaClient({ accessToken: 't', fetchFn });
		const delayFn = vi.fn().mockResolvedValue(undefined);

		const pages = [];
		for await (const page of paginateChannelContents(client, 'c', {
			delayFn,
			requestDelayMs: 250
		})) {
			pages.push(page);
		}

		expect(pages).toHaveLength(2);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(delayFn).toHaveBeenCalledTimes(1);
		expect(delayFn).toHaveBeenCalledWith(250, undefined);
	});

	it('waits longer than the base pacing delay when the rate-limit budget is nearly exhausted', async () => {
		const now = 1_700_000_000_000;
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const resetEpochSeconds = now / 1000 + 10;
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(
				pageResponse(
					[textBlock(1)],
					{ has_more_pages: true, next_page: 2 },
					{ 'X-RateLimit-Remaining': '0', 'X-RateLimit-Reset': String(resetEpochSeconds) }
				)
			)
			.mockResolvedValueOnce(pageResponse([textBlock(2)], { has_more_pages: false }));
		const client = new ArenaClient({ accessToken: 't', fetchFn });
		const delayFn = vi.fn().mockResolvedValue(undefined);

		const pages = [];
		for await (const page of paginateChannelContents(client, 'c', {
			delayFn,
			requestDelayMs: 250
		})) {
			pages.push(page);
		}

		expect(delayFn).toHaveBeenCalledWith(10_000, undefined);
		vi.restoreAllMocks();
	});

	it('retries a rate-limited page using the computed backoff, then continues', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } }))
			.mockResolvedValueOnce(pageResponse([textBlock(1)], { has_more_pages: false }));
		const client = new ArenaClient({ accessToken: 't', fetchFn });
		const delayFn = vi.fn().mockResolvedValue(undefined);

		const pages = [];
		for await (const page of paginateChannelContents(client, 'c', { delayFn })) {
			pages.push(page);
		}

		expect(pages).toHaveLength(1);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(delayFn).toHaveBeenCalledWith(1000, undefined);
	});

	it('gives up after maxRetriesPerPage consecutive rate limits', async () => {
		const fetchFn = vi
			.fn()
			.mockImplementation(
				async () => new Response('', { status: 429, headers: { 'Retry-After': '1' } })
			);
		const client = new ArenaClient({ accessToken: 't', fetchFn });
		const delayFn = vi.fn().mockResolvedValue(undefined);

		const pages = [];
		const iterate = async () => {
			for await (const page of paginateChannelContents(client, 'c', {
				delayFn,
				maxRetriesPerPage: 2
			})) {
				pages.push(page);
			}
		};

		await expect(iterate()).rejects.toThrow(ArenaRateLimitError);
		expect(fetchFn).toHaveBeenCalledTimes(3);
	});

	it('stops after the in-flight page once the caller aborts, without fetching further pages', async () => {
		const controller = new AbortController();
		const fetchFn = vi.fn().mockImplementation(async () => {
			controller.abort();
			return pageResponse([textBlock(1)], { has_more_pages: true, next_page: 2 });
		});
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		const pages = [];
		for await (const page of paginateChannelContents(client, 'c', { signal: controller.signal })) {
			pages.push(page);
		}

		expect(pages).toHaveLength(1);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('resolves the real delay immediately once the signal aborts mid-wait', async () => {
		vi.useFakeTimers();
		try {
			const controller = new AbortController();
			const fetchFn = vi
				.fn()
				.mockResolvedValue(pageResponse([textBlock(1)], { has_more_pages: true, next_page: 2 }));
			const client = new ArenaClient({ accessToken: 't', fetchFn });

			const pages: unknown[] = [];
			const iterate = (async () => {
				for await (const page of paginateChannelContents(client, 'c', {
					signal: controller.signal,
					requestDelayMs: 60_000
				})) {
					pages.push(page);
				}
			})();

			await vi.advanceTimersByTimeAsync(0);
			controller.abort();
			await vi.advanceTimersByTimeAsync(0);
			await iterate;

			expect(pages).toHaveLength(1);
			expect(fetchFn).toHaveBeenCalledTimes(1);
		} finally {
			vi.useRealTimers();
		}
	});
});

describe('paginateOwnedChannels', () => {
	it('walks every page of discovered channels, sharing the same pagination engine', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(
				pageResponse([ownedChannel(1, 'a', 'A')], { has_more_pages: true, next_page: 2 })
			)
			.mockResolvedValueOnce(pageResponse([ownedChannel(2, 'b', 'B')], { has_more_pages: false }));
		const client = new ArenaClient({ accessToken: 't', fetchFn });
		const delayFn = vi.fn().mockResolvedValue(undefined);

		const channels = [];
		for await (const page of paginateOwnedChannels(client, 558206, { delayFn })) {
			channels.push(...page.data);
		}

		expect(channels.map((c) => c.slug)).toEqual(['a', 'b']);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		const [firstRequest] = fetchFn.mock.calls[0] as [Request];
		expect(firstRequest.url).toBe(
			'https://api.are.na/v3/users/558206/contents?page=1&per=50&type=Channel'
		);
	});

	it('retries a rate-limited page using the same backoff as channel contents', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'Retry-After': '1' } }))
			.mockResolvedValueOnce(pageResponse([ownedChannel(1, 'a', 'A')], { has_more_pages: false }));
		const client = new ArenaClient({ accessToken: 't', fetchFn });
		const delayFn = vi.fn().mockResolvedValue(undefined);

		const channels = [];
		for await (const page of paginateOwnedChannels(client, 1, { delayFn })) {
			channels.push(...page.data);
		}

		expect(channels).toHaveLength(1);
		expect(delayFn).toHaveBeenCalledWith(1000, undefined);
	});
});

describe('ArenaClient.fetchBlockConnectionCount', () => {
	it('asks for a single connection and reads the total from the meta', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			pageResponse([{ id: 1 }], {
				per_page: 1,
				total_pages: 7,
				total_count: 7,
				has_more_pages: true
			})
		);
		const client = new ArenaClient({ accessToken: 'secret-token', fetchFn });

		const result = await client.fetchBlockConnectionCount(4242);

		expect(result.total).toBe(7);
		const [request] = fetchFn.mock.calls[0] as [Request];
		expect(request.url).toBe('https://api.are.na/v3/blocks/4242/connections?per=1');
		expect(request.headers.get('Authorization')).toBe('Bearer secret-token');
	});

	it('reports a block with no connections as zero', async () => {
		const fetchFn = vi.fn().mockResolvedValue(pageResponse([]));
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		expect((await client.fetchBlockConnectionCount(1)).total).toBe(0);
	});

	it('maps a missing block to a request error with its status', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue(new Response(JSON.stringify({ error: 'not found' }), { status: 404 }));
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		await expect(client.fetchBlockConnectionCount(1)).rejects.toMatchObject({
			name: 'ArenaRequestError',
			status: 404
		});
	});

	it('rejects a body that carries no pagination meta', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ data: [] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		await expect(client.fetchBlockConnectionCount(1)).rejects.toThrow();
	});
});

describe('countBlockConnections', () => {
	const rateLimited = () => new Response('{}', { status: 429, headers: { 'Retry-After': '3' } });

	it('waits out a rate limit and tries the block again', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(rateLimited())
			.mockResolvedValueOnce(pageResponse([], { total_count: 5 }));
		const client = new ArenaClient({ accessToken: 't', fetchFn });
		const delayFn = vi.fn().mockResolvedValue(undefined);

		await expect(countBlockConnections(client, 9, { delayFn })).resolves.toBe(5);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(delayFn).toHaveBeenCalledWith(3000, undefined);
	});

	it('gives up once the retries are spent', async () => {
		const fetchFn = vi.fn().mockImplementation(async () => rateLimited());
		const client = new ArenaClient({ accessToken: 't', fetchFn });
		const delayFn = vi.fn().mockResolvedValue(undefined);

		await expect(
			countBlockConnections(client, 9, { delayFn, maxRetries: 2 })
		).rejects.toBeInstanceOf(ArenaRateLimitError);
		expect(fetchFn).toHaveBeenCalledTimes(3);
	});

	it('waits for the window to reset before the budget runs out, and not otherwise', async () => {
		const now = 1_700_000_000_000;
		vi.spyOn(Date, 'now').mockReturnValue(now);
		const nearlyOut = pageResponse(
			[],
			{},
			{
				'X-RateLimit-Remaining': '2',
				'X-RateLimit-Reset': String(now / 1000 + 10)
			}
		);
		const plenty = pageResponse([], {}, { 'X-RateLimit-Remaining': '200' });
		const client = (response: Response) =>
			new ArenaClient({ accessToken: 't', fetchFn: vi.fn().mockResolvedValue(response) });
		const delayFn = vi.fn().mockResolvedValue(undefined);

		await countBlockConnections(client(plenty), 1, { delayFn, rateLimitSafetyMargin: 4 });
		expect(delayFn).not.toHaveBeenCalled();

		await countBlockConnections(client(nearlyOut), 1, { delayFn, rateLimitSafetyMargin: 4 });
		expect(delayFn).toHaveBeenCalledWith(10_000, undefined);
		vi.restoreAllMocks();
	});

	it('does not retry a request that failed for any other reason', async () => {
		const fetchFn = vi.fn().mockResolvedValue(new Response('{}', { status: 500 }));
		const client = new ArenaClient({ accessToken: 't', fetchFn });

		await expect(
			countBlockConnections(client, 1, { delayFn: vi.fn().mockResolvedValue(undefined) })
		).rejects.toBeInstanceOf(ArenaRequestError);
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});
