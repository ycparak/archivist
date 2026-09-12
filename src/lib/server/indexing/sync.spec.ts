import { describe, expect, it, vi } from 'vitest';
import { syncArchive } from './sync';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
		...init
	});
}

function meResponse(id: number, slug: string) {
	return jsonResponse({ id, slug });
}

function contentsResponse(data: unknown[], meta: Partial<Record<string, unknown>> = {}) {
	return jsonResponse({
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
	});
}

function textBlock(id: number, connectedAt = '2023-01-15T10:30:00Z') {
	return {
		id,
		type: 'Text',
		title: `Block ${id}`,
		description: null,
		created_at: '2023-01-15T10:30:00Z',
		connection: { connected_at: connectedAt },
		content: { markdown: 'hi', html: '<p>hi</p>', plain: 'hi' }
	};
}

function ownedChannel(id: number, slug: string, title: string) {
	return { id, type: 'Channel', slug, title };
}

function routedFetch(routes: Record<string, () => Response>) {
	return vi.fn().mockImplementation(async (request: Request) => {
		const { pathname } = new URL(request.url);
		const handler = routes[pathname];
		if (!handler) throw new Error(`unexpected request: ${pathname}`);
		return handler();
	});
}

function okTurbopufferFetch() {
	return vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
		const body = JSON.parse(init.body as string);
		return jsonResponse({
			status: 'OK',
			message: 'ok',
			rows_affected: body.upsert_rows?.length ?? 0,
			billing: {}
		});
	});
}

function turbopufferConfig(fetchFn = okTurbopufferFetch()) {
	return {
		apiKey: 'k',
		region: 'r',
		namespace: 'archivist-test',
		fetchFn: fetchFn as unknown as typeof fetch
	};
}

describe('syncArchive', () => {
	it('discovers channels, syncs each one, and returns normalized, deduplicated blocks', async () => {
		const fetchFn = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () =>
				contentsResponse([
					ownedChannel(10, 'channel-a', 'Channel A'),
					ownedChannel(11, 'channel-b', 'Channel B')
				]),
			'/v3/channels/channel-a/contents': () => contentsResponse([textBlock(100)]),
			'/v3/channels/channel-b/contents': () => contentsResponse([textBlock(101)])
		});

		const { blocks, summary } = await syncArchive({
			accessToken: 't',
			fetchFn,
			channelDelayMs: 0,
			turbopuffer: turbopufferConfig()
		});

		expect(summary).toMatchObject({
			channelsDiscovered: 2,
			channelsSynced: 2,
			channelsFailed: [],
			blocksFetched: 2,
			itemsSkipped: 0,
			blocksNormalized: 2,
			uniqueBlocks: 2,
			documentsUpserted: 2,
			upsertBatches: 1
		});
		expect(blocks.map((b) => b.id).sort()).toEqual(['100', '101']);
	});

	it('returns every discovered channel, regardless of sync outcome', async () => {
		const fetchFn = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () =>
				contentsResponse([
					ownedChannel(10, 'good-channel', 'Good'),
					ownedChannel(11, 'broken-channel', 'Broken')
				]),
			'/v3/channels/good-channel/contents': () => contentsResponse([textBlock(100)]),
			'/v3/channels/broken-channel/contents': () => new Response('nope', { status: 404 })
		});

		const { channels } = await syncArchive({
			accessToken: 't',
			fetchFn,
			channelDelayMs: 0,
			turbopuffer: turbopufferConfig()
		});

		expect(channels).toEqual([
			{ slug: 'good-channel', title: 'Good' },
			{ slug: 'broken-channel', title: 'Broken' }
		]);
	});

	it('unions channel membership when the same block appears in more than one channel', async () => {
		const fetchFn = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () =>
				contentsResponse([
					ownedChannel(10, 'channel-a', 'Channel A'),
					ownedChannel(11, 'channel-b', 'Channel B')
				]),
			'/v3/channels/channel-a/contents': () => contentsResponse([textBlock(100)]),
			'/v3/channels/channel-b/contents': () => contentsResponse([textBlock(100)])
		});

		const { blocks, summary } = await syncArchive({
			accessToken: 't',
			fetchFn,
			channelDelayMs: 0,
			turbopuffer: turbopufferConfig()
		});

		expect(summary.uniqueBlocks).toBe(1);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].channels.map((c) => c.slug).sort()).toEqual(['channel-a', 'channel-b']);
	});

	it('keeps the most recent connectedAt when a block is merged across channels, regardless of processing order', async () => {
		const older = '2022-01-01T00:00:00Z';
		const newer = '2024-06-01T00:00:00Z';

		const olderFirst = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () =>
				contentsResponse([
					ownedChannel(10, 'channel-a', 'Channel A'),
					ownedChannel(11, 'channel-b', 'Channel B')
				]),
			'/v3/channels/channel-a/contents': () => contentsResponse([textBlock(100, older)]),
			'/v3/channels/channel-b/contents': () => contentsResponse([textBlock(100, newer)])
		});
		const { blocks: olderFirstBlocks } = await syncArchive({
			accessToken: 't',
			fetchFn: olderFirst,
			channelDelayMs: 0,
			turbopuffer: turbopufferConfig()
		});
		expect(olderFirstBlocks[0]?.connectedAt).toEqual(new Date(newer));

		const newerFirst = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () =>
				contentsResponse([
					ownedChannel(10, 'channel-a', 'Channel A'),
					ownedChannel(11, 'channel-b', 'Channel B')
				]),
			'/v3/channels/channel-a/contents': () => contentsResponse([textBlock(100, newer)]),
			'/v3/channels/channel-b/contents': () => contentsResponse([textBlock(100, older)])
		});
		const { blocks: newerFirstBlocks } = await syncArchive({
			accessToken: 't',
			fetchFn: newerFirst,
			channelDelayMs: 0,
			turbopuffer: turbopufferConfig()
		});
		expect(newerFirstBlocks[0]?.connectedAt).toEqual(new Date(newer));
	});

	it('counts a nested channel item as skipped, not a block', async () => {
		const fetchFn = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () => contentsResponse([ownedChannel(10, 'channel-a', 'Channel A')]),
			'/v3/channels/channel-a/contents': () =>
				contentsResponse([
					textBlock(100),
					{
						id: 999,
						type: 'Channel',
						slug: 'nested',
						title: 'Nested',
						connection: { connected_at: '2023-01-15T10:30:00Z' }
					}
				])
		});

		const { summary } = await syncArchive({
			accessToken: 't',
			fetchFn,
			channelDelayMs: 0,
			turbopuffer: turbopufferConfig()
		});

		expect(summary.itemsSkipped).toBe(1);
		expect(summary.blocksFetched).toBe(1);
		expect(summary.blocksNormalized).toBe(1);
	});

	it('records a failing channel without aborting the rest of the sync', async () => {
		const fetchFn = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () =>
				contentsResponse([
					ownedChannel(10, 'broken-channel', 'Broken'),
					ownedChannel(11, 'good-channel', 'Good')
				]),
			'/v3/channels/broken-channel/contents': () => new Response('nope', { status: 404 }),
			'/v3/channels/good-channel/contents': () => contentsResponse([textBlock(100)])
		});

		const { blocks, summary } = await syncArchive({
			accessToken: 't',
			fetchFn,
			channelDelayMs: 0,
			turbopuffer: turbopufferConfig()
		});

		expect(summary.channelsSynced).toBe(1);
		expect(summary.channelsFailed).toHaveLength(1);
		expect(summary.channelsFailed[0]?.slug).toBe('broken-channel');
		expect(summary.channelsFailed[0]?.error).toContain('404');
		expect(blocks.map((b) => b.id)).toEqual(['100']);
	});

	it('aborts the whole sync once too many channels in a row fail before any have succeeded', async () => {
		const contentsCalls: string[] = [];
		const fetchFn = vi.fn().mockImplementation(async (request: Request) => {
			const { pathname } = new URL(request.url);
			if (pathname === '/v3/me') return meResponse(1, 'me');
			if (pathname === '/v3/users/1/contents') {
				return contentsResponse([
					ownedChannel(10, 'broken-1', 'Broken 1'),
					ownedChannel(11, 'broken-2', 'Broken 2'),
					ownedChannel(12, 'broken-3', 'Broken 3'),
					ownedChannel(13, 'never-reached', 'Never reached')
				]);
			}
			contentsCalls.push(pathname);
			return new Response('nope', { status: 404 });
		});

		const turbopufferFetch = okTurbopufferFetch();

		await expect(
			syncArchive({
				accessToken: 't',
				fetchFn,
				channelDelayMs: 0,
				maxLeadingChannelFailures: 3,
				turbopuffer: turbopufferConfig(turbopufferFetch)
			})
		).rejects.toThrow(/first 3 channels all failed/);

		expect(contentsCalls).toEqual([
			'/v3/channels/broken-1/contents',
			'/v3/channels/broken-2/contents',
			'/v3/channels/broken-3/contents'
		]);
		expect(turbopufferFetch).not.toHaveBeenCalled();
	});

	it('does not trip the failure breaker once at least one channel has already succeeded', async () => {
		const fetchFn = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () =>
				contentsResponse([
					ownedChannel(10, 'good-channel', 'Good'),
					ownedChannel(11, 'broken-1', 'Broken 1'),
					ownedChannel(12, 'broken-2', 'Broken 2'),
					ownedChannel(13, 'broken-3', 'Broken 3')
				]),
			'/v3/channels/good-channel/contents': () => contentsResponse([textBlock(100)]),
			'/v3/channels/broken-1/contents': () => new Response('nope', { status: 404 }),
			'/v3/channels/broken-2/contents': () => new Response('nope', { status: 404 }),
			'/v3/channels/broken-3/contents': () => new Response('nope', { status: 404 })
		});

		const { summary } = await syncArchive({
			accessToken: 't',
			fetchFn,
			channelDelayMs: 0,
			maxLeadingChannelFailures: 3,
			turbopuffer: turbopufferConfig()
		});

		expect(summary.channelsSynced).toBe(1);
		expect(summary.channelsFailed).toHaveLength(3);
	});

	it('propagates a non-transport error (e.g. a schema validation failure) instead of isolating it as a channel failure', async () => {
		const fetchFn = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () => contentsResponse([ownedChannel(10, 'channel-a', 'Channel A')]),
			'/v3/channels/channel-a/contents': () => contentsResponse([{ id: 1, type: 'Text' }])
		});

		const turbopufferFetch = okTurbopufferFetch();

		await expect(
			syncArchive({
				accessToken: 't',
				fetchFn,
				channelDelayMs: 0,
				turbopuffer: turbopufferConfig(turbopufferFetch)
			})
		).rejects.toThrow();
		expect(turbopufferFetch).not.toHaveBeenCalled();
	});

	it('paces requests between channels using the injected delayFn, not just between pages', async () => {
		const fetchFn = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () =>
				contentsResponse([
					ownedChannel(10, 'channel-a', 'Channel A'),
					ownedChannel(11, 'channel-b', 'Channel B')
				]),
			'/v3/channels/channel-a/contents': () => contentsResponse([textBlock(100)]),
			'/v3/channels/channel-b/contents': () => contentsResponse([textBlock(101)])
		});
		const delayFn = vi.fn().mockResolvedValue(undefined);

		await syncArchive({ accessToken: 't', fetchFn, delayFn, turbopuffer: turbopufferConfig() });

		expect(delayFn).toHaveBeenCalledTimes(1);
		expect(delayFn).toHaveBeenCalledWith(300, undefined);
	});

	it('invokes the log callback with discovery and per-channel progress', async () => {
		const fetchFn = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () => contentsResponse([ownedChannel(10, 'channel-a', 'Channel A')]),
			'/v3/channels/channel-a/contents': () => contentsResponse([textBlock(100)])
		});
		const log = vi.fn();

		await syncArchive({
			accessToken: 't',
			fetchFn,
			log,
			channelDelayMs: 0,
			turbopuffer: turbopufferConfig()
		});

		expect(log).toHaveBeenCalledWith(expect.stringContaining('Discovered 1'));
		expect(log).toHaveBeenCalledWith(expect.stringContaining('channel-a'));
		expect(log).toHaveBeenCalledWith(expect.stringContaining('Upserted 1'));
	});

	it('upserts the deduplicated blocks into Turbopuffer with the right shape and reports the result', async () => {
		const fetchFn = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () => contentsResponse([ownedChannel(10, 'channel-a', 'Channel A')]),
			'/v3/channels/channel-a/contents': () => contentsResponse([textBlock(100)])
		});
		const turbopufferFetch = okTurbopufferFetch();

		const { summary } = await syncArchive({
			accessToken: 't',
			fetchFn,
			channelDelayMs: 0,
			turbopuffer: turbopufferConfig(turbopufferFetch)
		});

		expect(summary.documentsUpserted).toBe(1);
		expect(summary.upsertBatches).toBe(1);
		expect(turbopufferFetch).toHaveBeenCalledTimes(1);

		const [url, init] = turbopufferFetch.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('https://r.turbopuffer.com/v2/namespaces/archivist-test');
		const body = JSON.parse(init.body as string);
		expect(body.distance_metric).toBe('cosine_distance');
		expect(body.upsert_rows).toEqual([
			expect.objectContaining({ id: 'block:100', block_type: 'Text' })
		]);
	});

	it('does not attempt to upsert anything when no blocks were fetched', async () => {
		const fetchFn = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () => contentsResponse([])
		});
		const turbopufferFetch = okTurbopufferFetch();

		const { summary } = await syncArchive({
			accessToken: 't',
			fetchFn,
			turbopuffer: turbopufferConfig(turbopufferFetch)
		});

		expect(summary.documentsUpserted).toBe(0);
		expect(summary.upsertBatches).toBe(0);
		expect(turbopufferFetch).not.toHaveBeenCalled();
	});
});
