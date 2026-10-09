import { describe, expect, it, vi } from 'vitest';
import { ARCHIVE_COLOURS, type ArchiveColour } from '$lib/domain/search';
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

function ownedChannel(
	id: number,
	slug: string,
	title: string,
	visibility: 'public' | 'closed' | 'private' = 'public'
) {
	return { id, type: 'Channel', slug, title, visibility };
}

function routedFetch(routes: Record<string, () => Response>) {
	return vi.fn().mockImplementation(async (request: Request) => {
		const { pathname } = new URL(request.url);
		const handler = routes[pathname];
		if (!handler) throw new Error(`unexpected request: ${pathname}`);
		return handler();
	});
}

describe('syncArchive', () => {
	it('skips ignored and all private channels', async () => {
		const fetchFn = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () =>
				contentsResponse([
					ownedChannel(10, 'public-a', 'Public A'),
					ownedChannel(11, 'ignored-b', 'Ignored B'),
					ownedChannel(12, 'private-c', 'Private C', 'private'),
					ownedChannel(13, 'private-allowed', 'Private Allowed', 'private'),
					ownedChannel(14, 'closed-e', 'Closed E', 'closed'),
					ownedChannel(15, 'private-ignored', 'Private Ignored', 'private')
				]),
			'/v3/channels/public-a/contents': () => contentsResponse([textBlock(100)]),
			'/v3/channels/private-allowed/contents': () => contentsResponse([textBlock(101)]),
			'/v3/channels/closed-e/contents': () => contentsResponse([textBlock(102)])
		});

		const { channels, summary } = await syncArchive({
			accessToken: 't',
			fetchFn,
			channelDelayMs: 0,

			channelFilter: {
				ignore: new Set(['ignored-b', 'private-ignored']),
				allowPrivate: new Set(['private-allowed', 'private-ignored'])
			}
		});

		expect(channels.map((c) => c.slug)).toEqual(['public-a', 'closed-e']);
		expect(summary).toMatchObject({
			channelsDiscovered: 6,
			channelsIgnored: 2,
			channelsPrivateSkipped: 2,
			channelsSynced: 2
		});
	});

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
			channelDelayMs: 0
		});

		expect(summary).toMatchObject({
			channelsDiscovered: 2,
			channelsSynced: 2,
			channelsFailed: [],
			blocksFetched: 2,
			itemsSkipped: 0,
			blocksNormalized: 2,
			uniqueBlocks: 2
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
			channelDelayMs: 0
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
			channelDelayMs: 0
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
			channelDelayMs: 0
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
			channelDelayMs: 0
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
			channelDelayMs: 0
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
			channelDelayMs: 0
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

		await expect(
			syncArchive({
				accessToken: 't',
				fetchFn,
				channelDelayMs: 0,
				maxLeadingChannelFailures: 3
			})
		).rejects.toThrow(/first 3 channels all failed/);

		expect(contentsCalls).toEqual([
			'/v3/channels/broken-1/contents',
			'/v3/channels/broken-2/contents',
			'/v3/channels/broken-3/contents'
		]);
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
			maxLeadingChannelFailures: 3
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

		await expect(
			syncArchive({
				accessToken: 't',
				fetchFn,
				channelDelayMs: 0
			})
		).rejects.toThrow();
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

		await syncArchive({ accessToken: 't', fetchFn, delayFn });

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
			channelDelayMs: 0
		});

		expect(log).toHaveBeenCalledWith(expect.stringContaining('Discovered 1'));
		expect(log).toHaveBeenCalledWith(expect.stringContaining('channel-a'));
	});
});

function imageBlock(id: number) {
	return {
		id,
		type: 'Image',
		title: `image-${id}.png`,
		description: null,
		created_at: '2023-01-15T10:30:00Z',
		connection: { connected_at: '2023-01-15T10:30:00Z' },
		image: {
			src: 'https://d2w9rnfcy7mm78.cloudfront.net/1/o.gif',
			file_size: 1000,
			content_type: 'image/png',
			small: { src: 'https://d2w9rnfcy7mm78.cloudfront.net/1/o.gif' },
			medium: { src: 'https://d2w9rnfcy7mm78.cloudfront.net/1/o.gif' },
			large: { src: 'https://d2w9rnfcy7mm78.cloudfront.net/1/o.gif', width: 10, height: 10 },
			square: { src: 'https://d2w9rnfcy7mm78.cloudfront.net/1/o.gif' }
		}
	};
}

const VISION_RESULT = {
	title: 'Generated title',
	description: 'Generated description',
	ocr: '',
	palette: ['#000000'],
	medium: 'screenshot' as const,
	tags: ['tag']
};

function visionClient(
	describe = vi.fn(async () => ({
		kind: 'described' as const,
		result: VISION_RESULT,
		provider: 'test'
	}))
) {
	return { model: 'test-model', promptVersion: 1, describe };
}

function visionFetch() {
	return routedFetch({
		'/v3/me': () => meResponse(7, 'maintainer'),
		'/v3/users/7/contents': () => contentsResponse([ownedChannel(1, 'alpha', 'Alpha')]),
		'/v3/channels/alpha/contents': () => contentsResponse([imageBlock(11), textBlock(12)])
	});
}

describe('syncArchive — vision stage', () => {
	it('leaves sync untouched when no vision options are passed', async () => {
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {}
		});

		expect(result.summary.vision).toBeNull();
		expect(result.visionCache).toBeNull();
	});

	it('describes only blocks that have an image', async () => {
		const client = visionClient();
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {},
			vision: { client }
		});

		expect(client.describe).toHaveBeenCalledOnce();
		expect(result.summary.vision).toMatchObject({ blocksWithImage: 1, generated: 1 });
		expect(result.visionCache).toHaveLength(1);
		expect(result.visionCache?.[0]).toMatchObject({ block_id: '11', title: 'Generated title' });
	});

	it('drops cache entries for blocks that have left the archive', async () => {
		const stale = {
			...VISION_RESULT,
			block_id: '999',
			image_src_hash: 'sha256:old',
			prompt_version: 1,
			model: 'test-model',
			input_mode: 'image' as const,
			provider: 'test',
			generated_at: '2026-01-01T00:00:00.000Z'
		};

		const result = await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {},
			visionCache: new Map([['999', stale]]),
			vision: { client: visionClient() }
		});

		expect(result.visionCache?.map((entry) => entry.block_id)).toEqual(['11']);
	});

	it('keeps cache entries for unfetched blocks when a channel failed', async () => {
		const unfetched = {
			...VISION_RESULT,
			block_id: '999',
			image_src_hash: 'sha256:old',
			prompt_version: 1,
			model: 'test-model',
			input_mode: 'image' as const,
			provider: 'test',
			generated_at: '2026-01-01T00:00:00.000Z'
		};

		const result = await syncArchive({
			accessToken: 't',

			fetchFn: routedFetch({
				'/v3/me': () => meResponse(7, 'maintainer'),
				'/v3/users/7/contents': () =>
					contentsResponse([ownedChannel(1, 'alpha', 'Alpha'), ownedChannel(2, 'beta', 'Beta')]),
				'/v3/channels/alpha/contents': () => contentsResponse([imageBlock(11)]),
				'/v3/channels/beta/contents': () => jsonResponse({ error: 'boom' }, { status: 500 })
			}) as unknown as typeof fetch,
			delayFn: async () => {},
			visionCache: new Map([['999', unfetched]]),
			vision: { client: visionClient() }
		});

		expect(result.summary.channelsFailed).toHaveLength(1);
		expect(result.visionCache?.map((entry) => entry.block_id)).toEqual(['11', '999']);
	});
});

function colourEntry(blockId: string, blue: number) {
	return {
		block_id: blockId,
		image_src_hash: 'sha256:old',
		colour_version: 1,
		frames: 1,
		measured_at: '2026-01-01T00:00:00.000Z',
		weights: { ...ZERO_WEIGHTS, blue }
	};
}

const ZERO_WEIGHTS = Object.fromEntries(ARCHIVE_COLOURS.map((colour) => [colour, 0])) as Record<
	ArchiveColour,
	number
>;

const measuredBlue = vi.fn(async () => ({
	kind: 'measured' as const,
	weights: { ...ZERO_WEIGHTS, blue: 700 },
	frames: 1
}));

describe('syncArchive — colour stage', () => {
	it('measures nothing, and reports nothing, when the stage is not requested', async () => {
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {}
		});

		expect(result.summary.colour).toBeNull();
		expect(result.colourCache).toBeNull();
	});

	it('measures blocks with an image and indexes their weights', async () => {
		const measure = vi.fn(measuredBlue);
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {},
			colour: { measure }
		});

		expect(measure).toHaveBeenCalledOnce();
		expect(result.summary.colour).toMatchObject({ blocksWithImage: 1, measured: 1 });
		expect(result.colourCache?.map((entry) => entry.block_id)).toEqual(['11']);

		const rows = result.documents;
		const image = rows.find((row: { id: string }) => row.id === 'block:11');
		const text = rows.find((row: { id: string }) => row.id === 'block:12');
		expect(image?.colour_blue).toBe(700);
		expect(text?.colour_blue).toBe(0);
		expect(text?.colour_mono).toBe(0);
	});

	it('indexes cached weights on a run that does not measure', async () => {
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {},
			colourCache: new Map([['11', colourEntry('11', 420)]])
		});

		const rows = result.documents;
		expect(rows.find((row: { id: string }) => row.id === 'block:11')?.colour_blue).toBe(420);
	});

	it('drops cache entries for blocks that have left the archive', async () => {
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {},
			colourCache: new Map([['999', colourEntry('999', 100)]]),
			colour: { measure: measuredBlue }
		});

		expect(result.colourCache?.map((entry) => entry.block_id)).toEqual(['11']);
	});

	it('keeps cache entries for unfetched blocks when a channel failed', async () => {
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: routedFetch({
				'/v3/me': () => meResponse(7, 'maintainer'),
				'/v3/users/7/contents': () =>
					contentsResponse([ownedChannel(1, 'alpha', 'Alpha'), ownedChannel(2, 'beta', 'Beta')]),
				'/v3/channels/alpha/contents': () => contentsResponse([imageBlock(11)]),
				'/v3/channels/beta/contents': () => jsonResponse({ error: 'boom' }, { status: 500 })
			}) as unknown as typeof fetch,
			delayFn: async () => {},
			colourCache: new Map([['999', colourEntry('999', 100)]]),
			colour: { measure: measuredBlue }
		});

		expect(result.colourCache?.map((entry) => entry.block_id)).toEqual(['11', '999']);
	});

	it('reports a measuring phase to the status display', async () => {
		const onEvent = vi.fn();
		await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {},
			onEvent,
			colour: { measure: measuredBlue }
		});

		expect(onEvent).toHaveBeenCalledWith({ kind: 'phase', phase: 'measuring' });
	});
});

function connectionEntry(blockId: string, total: number, countedAt = new Date().toISOString()) {
	return { block_id: blockId, total, counted_at: countedAt };
}

describe('syncArchive — connections stage', () => {
	it('counts nothing, and reports nothing, when the stage is not requested', async () => {
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {}
		});

		expect(result.summary.connections).toBeNull();
		expect(result.connectionCache).toBeNull();
	});

	it('counts every block once and indexes the total beside the maintainer’s own count', async () => {
		const count = vi.fn(async (blockId: number) => blockId * 10);
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {},
			connections: { count }
		});

		expect(count.mock.calls.map(([id]) => id).sort()).toEqual([11, 12]);
		expect(result.summary.connections).toMatchObject({ blocks: 2, counted: 2, failed: [] });
		expect(result.connectionCache?.map((entry) => [entry.block_id, entry.total])).toEqual([
			['11', 110],
			['12', 120]
		]);

		const rows = result.documents;
		expect(rows.find((row) => row.id === 'block:11')).toMatchObject({
			connection_count: 1,
			total_connection_count: 110
		});
		expect(rows.find((row) => row.id === 'block:12')?.total_connection_count).toBe(120);
	});

	it('asks Are.na for each block’s connections when no counter is injected', async () => {
		const arena = routedFetch({
			'/v3/me': () => meResponse(7, 'maintainer'),
			'/v3/users/7/contents': () => contentsResponse([ownedChannel(1, 'alpha', 'Alpha')]),
			'/v3/channels/alpha/contents': () => contentsResponse([imageBlock(11), textBlock(12)]),
			'/v3/blocks/11/connections': () => contentsResponse([{}], { total_count: 8 }),
			'/v3/blocks/12/connections': () => contentsResponse([{}], { total_count: 2 })
		});
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: arena as unknown as typeof fetch,
			delayFn: async () => {},
			connections: {}
		});

		const rows = result.documents;
		expect(rows.find((row) => row.id === 'block:11')?.total_connection_count).toBe(8);
		expect(rows.find((row) => row.id === 'block:12')?.total_connection_count).toBe(2);
	});

	it('indexes cached totals on a run that does not count, and counts nothing for fresh ones', async () => {
		const count = vi.fn(async () => 99);
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {},
			connectionCache: new Map([['11', connectionEntry('11', 42)]])
		});
		expect(result.documents.find((row) => row.id === 'block:11')?.total_connection_count).toBe(42);

		await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {},
			connectionCache: new Map([
				['11', connectionEntry('11', 42)],
				['12', connectionEntry('12', 7)]
			]),
			connections: { count }
		});
		expect(count).not.toHaveBeenCalled();
	});

	it('recounts a block whose cached total has gone stale', async () => {
		const count = vi.fn(async (blockId: number) => (blockId === 11 ? 50 : 0));
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {},
			connectionCache: new Map([
				['11', connectionEntry('11', 3, '2020-01-01T00:00:00.000Z')],
				['12', connectionEntry('12', 7)]
			]),
			connections: { count }
		});

		expect(count).toHaveBeenCalledOnce();
		expect(count.mock.calls[0][0]).toBe(11);
		expect(result.connectionCache?.map((entry) => [entry.block_id, entry.total])).toEqual([
			['11', 50],
			['12', 7]
		]);
	});

	it('never indexes a total below the channels it already knows hold the block', async () => {
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: routedFetch({
				'/v3/me': () => meResponse(7, 'maintainer'),
				'/v3/users/7/contents': () =>
					contentsResponse([ownedChannel(1, 'alpha', 'Alpha'), ownedChannel(2, 'beta', 'Beta')]),
				'/v3/channels/alpha/contents': () => contentsResponse([textBlock(12)]),
				'/v3/channels/beta/contents': () => contentsResponse([textBlock(12)])
			}) as unknown as typeof fetch,
			delayFn: async () => {},
			connectionCache: new Map([['12', connectionEntry('12', 1)]])
		});

		const [row] = result.documents;
		expect(row.connection_count).toBe(2);
		expect(row.total_connection_count).toBe(2);
	});

	it('indexes a block whose count failed, keeps the failure in the summary, and writes no entry for it', async () => {
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {},
			connections: {
				count: async (blockId) => {
					if (blockId === 11) throw new Error('Are.na request failed with status 404');
					return 5;
				}
			}
		});

		expect(result.summary.connections?.failed).toEqual([
			{ blockId: '11', error: 'Are.na request failed with status 404' }
		]);
		expect(result.connectionCache?.map((entry) => entry.block_id)).toEqual(['12']);
		const failed = result.documents.find((row) => row.id === 'block:11');
		expect(failed?.total_connection_count).toBe(1);
	});

	it('drops cache entries for blocks that have left the archive', async () => {
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {},
			connectionCache: new Map([['999', connectionEntry('999', 1)]]),
			connections: { count: async () => 2 }
		});

		expect(result.connectionCache?.map((entry) => entry.block_id)).toEqual(['11', '12']);
	});

	it('keeps cache entries for unfetched blocks when a channel failed', async () => {
		const result = await syncArchive({
			accessToken: 't',

			fetchFn: routedFetch({
				'/v3/me': () => meResponse(7, 'maintainer'),
				'/v3/users/7/contents': () =>
					contentsResponse([ownedChannel(1, 'alpha', 'Alpha'), ownedChannel(2, 'beta', 'Beta')]),
				'/v3/channels/alpha/contents': () => contentsResponse([imageBlock(11)]),
				'/v3/channels/beta/contents': () => jsonResponse({ error: 'boom' }, { status: 500 })
			}) as unknown as typeof fetch,
			delayFn: async () => {},
			connectionCache: new Map([['999', connectionEntry('999', 1)]]),
			connections: { count: async () => 2 }
		});

		expect(result.connectionCache?.map((entry) => entry.block_id)).toEqual(['11', '999']);
	});

	it('reports a counting phase to the status display', async () => {
		const onEvent = vi.fn();
		await syncArchive({
			accessToken: 't',

			fetchFn: visionFetch() as unknown as typeof fetch,
			delayFn: async () => {},
			onEvent,
			connections: { count: async () => 1 }
		});

		expect(onEvent).toHaveBeenCalledWith({ kind: 'phase', phase: 'counting' });
	});
});

describe('public-only export', () => {
	it('never writes to either provider and excludes allow-listed private membership', async () => {
		const fetchFn = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () =>
				contentsResponse([
					ownedChannel(1, 'public', 'Public'),
					ownedChannel(2, 'private', 'Private', 'private')
				]),
			'/v3/channels/public/contents': () => contentsResponse([textBlock(1)])
		});
		const result = await syncArchive({
			accessToken: 't',
			output: 'export',
			fetchFn,

			channelDelayMs: 0,
			channelFilter: { ignore: new Set(), allowPrivate: new Set(['private']) }
		});

		expect(result.channels).toEqual([{ slug: 'public', title: 'Public' }]);
		expect(result.documents[0].channel_slugs).toEqual(['public']);
		expect(result.documents[0].connection_count).toBe(1);
		expect(fetchFn.mock.calls.every(([request]) => request.method === 'GET')).toBe(true);
	});
	it('refuses a partial export when any channel fails', async () => {
		const fetchFn = routedFetch({
			'/v3/me': () => meResponse(1, 'me'),
			'/v3/users/1/contents': () =>
				contentsResponse([
					ownedChannel(1, 'public', 'Public'),
					ownedChannel(2, 'failed', 'Failed')
				]),
			'/v3/channels/public/contents': () => contentsResponse([textBlock(1)]),
			'/v3/channels/failed/contents': () => new Response('', { status: 403 })
		});
		await expect(
			syncArchive({ accessToken: 't', output: 'export', fetchFn, channelDelayMs: 0 })
		).rejects.toThrow('Export refused');
	});
	it('refuses write-back and vision generation before touching Are.na', async () => {
		const fetchFn = vi.fn();
		await expect(
			syncArchive({ accessToken: 't', output: 'export', pushArena: true, fetchFn })
		).rejects.toThrow('Export cannot');
		expect(fetchFn).not.toHaveBeenCalled();
	});
});
