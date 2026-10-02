import { describe, expect, it, vi } from 'vitest';
import { ARCHIVE_COLOURS, ARCHIVE_MAX_COLOURS } from '$lib/domain/search';
import { COLOUR_THRESHOLDS } from './colour-filter';
import type { ArchiveSearchInput } from './contracts';
import {
	buildSearchFilters,
	SearchUnavailableError,
	TurbopufferSearchRepository
} from './repository';

function input(overrides: Partial<ArchiveSearchInput> = {}): ArchiveSearchInput {
	return {
		mode: 'browse',
		query: '',
		channelSlugs: [],
		blockTypes: [],
		colours: [],
		limit: 24,
		offset: 0,
		...overrides
	};
}

function queryResponse(rows: unknown[]) {
	return new Response(
		JSON.stringify({
			billing: { billable_logical_bytes_queried: 0, billable_logical_bytes_returned: 0 },
			performance: {},
			rows
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
}

function multiQueryResponse(rows: unknown[]) {
	return new Response(
		JSON.stringify({
			billing: { billable_logical_bytes_queried: 0, billable_logical_bytes_returned: 0 },
			performance: {},
			results: [{ rows }]
		}),
		{ status: 200, headers: { 'Content-Type': 'application/json' } }
	);
}

function resultRow() {
	return {
		id: 'block:12',
		title: 'Felt specimen',
		description: null,
		block_type: 'Image',
		channel_slugs: ['materials'],
		connected_at: '2024-01-02T03:04:05.000Z',
		source_url: 'https://example.com/felt',
		arena_url: 'https://www.are.na/block/12',
		image_url: 'https://example.com/felt.jpg',
		image_alt: 'A felt swatch',
		image_width: 800,
		image_height: 600,
		source_title: 'Example'
	};
}

function repository(fetchFn: typeof fetch) {
	return new TurbopufferSearchRepository({
		apiKey: 'secret',
		region: 'test-region',
		namespace: 'archive-test',
		fetchFn
	});
}

function requestedBody(fetchFn: ReturnType<typeof vi.fn>) {
	const [, init] = fetchFn.mock.calls[0] as [string, RequestInit];
	return JSON.parse(init.body as string);
}

function unknownAttributeResponse() {
	return new Response(
		JSON.stringify({
			error:
				'attribute "video_content_type" not found in schema, cannot be part of `include_attributes`',
			status: 'error'
		}),
		{ status: 400, headers: { 'Content-Type': 'application/json' } }
	);
}

/**
 * Turbopuffer rejects the whole query when `include_attributes` names an attribute the namespace
 * has never been written. Shipping a new presentation attribute before the maintainer re-syncs
 * would therefore take search down entirely, rather than cost one feature until the sync runs.
 */
describe('TurbopufferSearchRepository — attributes a namespace may not have yet', () => {
	it('asks for the video attributes when it has no reason not to', async () => {
		const fetchFn = vi.fn<typeof fetch>(async () => queryResponse([resultRow()]));
		await repository(fetchFn as unknown as typeof fetch).search(input());

		expect(requestedBody(fetchFn).include_attributes).toContain('video_url');
		expect(requestedBody(fetchFn).include_attributes).toContain('video_content_type');
	});

	it('retries without them rather than reporting search as unavailable', async () => {
		let calls = 0;
		const fetchFn = vi.fn<typeof fetch>(async () => {
			calls += 1;
			return calls === 1 ? unknownAttributeResponse() : queryResponse([resultRow()]);
		});

		const response = await repository(fetchFn as unknown as typeof fetch).search(input());

		expect(response.results).toHaveLength(1);
		expect(response.results[0].videoUrl).toBeNull();
		const [, retry] = fetchFn.mock.calls[1] as [string, RequestInit];
		expect(JSON.parse(retry.body as string).include_attributes).not.toContain('video_url');
	});

	it('remembers, so only the first request pays for finding out', async () => {
		let calls = 0;
		const fetchFn = vi.fn<typeof fetch>(async () => {
			calls += 1;
			return calls === 1 ? unknownAttributeResponse() : queryResponse([resultRow()]);
		});
		const subject = repository(fetchFn as unknown as typeof fetch);

		await subject.search(input());
		await subject.search(input());

		expect(fetchFn).toHaveBeenCalledTimes(3);
		const [, third] = fetchFn.mock.calls[2] as [string, RequestInit];
		expect(JSON.parse(third.body as string).include_attributes).not.toContain('video_url');
	});

	it('still reports a real failure as unavailable', async () => {
		const fetchFn = vi.fn<typeof fetch>(
			async () => new Response('nope', { status: 500, headers: { 'Content-Type': 'text/plain' } })
		);

		await expect(repository(fetchFn as unknown as typeof fetch).search(input())).rejects.toThrow(
			SearchUnavailableError
		);
	});

	it('does not mistake an unrelated 400 for a missing attribute', async () => {
		const fetchFn = vi.fn<typeof fetch>(
			async () =>
				new Response(JSON.stringify({ error: 'malformed rank_by', status: 'error' }), {
					status: 400,
					headers: { 'Content-Type': 'application/json' }
				})
		);

		await expect(repository(fetchFn as unknown as typeof fetch).search(input())).rejects.toThrow(
			SearchUnavailableError
		);
		expect(fetchFn).toHaveBeenCalledOnce();
	});
});

describe('buildSearchFilters', () => {
	it('omits filters when none are selected', () => {
		expect(buildSearchFilters(input())).toBeUndefined();
	});

	it('requires every chosen colour, each at its own threshold', () => {
		expect(buildSearchFilters(input({ colours: ['blue', 'mono'] }))).toEqual([
			'And',
			[
				['colour_blue', 'Gte', COLOUR_THRESHOLDS.blue],
				['colour_mono', 'Gte', COLOUR_THRESHOLDS.mono]
			]
		]);
	});

	it('uses only the three filterable attributes and composes categories with AND', () => {
		expect(
			buildSearchFilters(
				input({
					blockTypes: ['Image', 'Link'],
					channelSlugs: ['materials', 'photography'],
					from: new Date('2024-01-01T00:00:00.000Z'),
					to: new Date('2024-01-31T23:59:59.999Z')
				})
			)
		).toEqual([
			'And',
			[
				['block_type', 'In', ['Image', 'Link']],
				['channel_slugs', 'ContainsAny', ['materials', 'photography']],
				['connected_at', 'Gte', '2024-01-01T00:00:00.000Z'],
				['connected_at', 'Lte', '2024-01-31T23:59:59.999Z']
			]
		]);
	});

	it.each([
		[
			'repeated channels',
			input({ channelSlugs: ['materials', 'photography'] }),
			['And', [['channel_slugs', 'ContainsAny', ['materials', 'photography']]]]
		],
		[
			'from only',
			input({ from: new Date('2024-01-01T00:00:00.000Z') }),
			['And', [['connected_at', 'Gte', '2024-01-01T00:00:00.000Z']]]
		],
		[
			'to only',
			input({ to: new Date('2024-01-31T23:59:59.999Z') }),
			['And', [['connected_at', 'Lte', '2024-01-31T23:59:59.999Z']]]
		]
	])('builds %s filters', (_name, searchInput, expected) => {
		expect(buildSearchFilters(searchInput)).toEqual(expected);
	});
});

describe('TurbopufferSearchRepository', () => {
	it('maps selected Turbopuffer rows into public search results', async () => {
		const fetchFn = vi.fn().mockResolvedValue(queryResponse([resultRow()]));

		const { results } = await repository(fetchFn).search(input());
		expect(results).toEqual([
			{
				id: 'block:12',
				title: 'Felt specimen',
				description: null,
				blockType: 'Image',
				channelSlugs: ['materials'],
				connectedAt: '2024-01-02T03:04:05.000Z',
				sourceUrl: 'https://example.com/felt',
				arenaUrl: 'https://www.are.na/block/12',
				imageUrl: 'https://example.com/felt.jpg',
				imageAlt: 'A felt swatch',
				imageWidth: 800,
				imageHeight: 600,
				videoUrl: null,
				videoContentType: null,
				sourceTitle: 'Example'
			}
		]);
	});

	it('reports provider timings, with rerank only for hybrid search', async () => {
		const performanceBody = { query_execution_ms: 40, server_total_ms: 55 };
		const withPerformance = (body: object) =>
			new Response(JSON.stringify({ billing: {}, performance: performanceBody, ...body }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			});

		const single = await repository(
			vi.fn().mockResolvedValue(withPerformance({ rows: [] }))
		).search(input({ mode: 'lexical', query: 'felt' }));
		expect(single.timings).toMatchObject({ queryMs: 40, rerankMs: 0 });
		expect(single.timings.totalMs).toBeGreaterThanOrEqual(0);

		const hybrid = await repository(
			vi.fn().mockResolvedValue(withPerformance({ results: [{ rows: [] }] }))
		).search(input({ mode: 'hybrid', query: 'felt' }));
		expect(hybrid.timings).toMatchObject({ queryMs: 40, rerankMs: 15 });
	});

	it('over-fetches by one row past the requested page so the server can tell whether more exist', async () => {
		const fetchFn = vi.fn().mockResolvedValue(queryResponse([]));
		await repository(fetchFn).search(input({ offset: 48 }));
		expect(requestedBody(fetchFn).limit).toBe(73);
	});

	it('orders browse results by connection count, then recency, without a text rank', async () => {
		const fetchFn = vi.fn().mockResolvedValue(queryResponse([]));
		await repository(fetchFn).search(input());
		const body = requestedBody(fetchFn);
		expect(body.rank_by).toEqual([
			['connection_count', 'desc'],
			['connected_at', 'desc']
		]);
		expect(body.limit).toBe(25);
		expect(body.rank_by).not.toContain('search_text');
	});

	it('orders colour browse by the first colour, then the rest, then a total tiebreak', async () => {
		const fetchFn = vi.fn().mockResolvedValue(queryResponse([]));
		await repository(fetchFn).search(input({ colours: ['orange', 'blue'] }));
		expect(requestedBody(fetchFn).rank_by).toEqual([
			['colour_orange', 'desc'],
			['colour_blue', 'desc'],
			['connection_count', 'desc'],
			['connected_at', 'desc'],
			['id', 'asc']
		]);
	});

	it('stays within the sort keys Turbopuffer allows at the most colours a request may choose', async () => {
		const fetchFn = vi.fn().mockResolvedValue(queryResponse([]));
		const colours = ARCHIVE_COLOURS.slice(0, ARCHIVE_MAX_COLOURS);
		await repository(fetchFn).search(input({ colours: [...colours] }));
		expect(requestedBody(fetchFn).rank_by.length).toBeLessThanOrEqual(8);
	});

	it('keeps relevance order for a text query and lets colour only filter', async () => {
		const fetchFn = vi.fn().mockResolvedValue(queryResponse([]));
		await repository(fetchFn).search(input({ mode: 'lexical', query: 'felt', colours: ['red'] }));
		const body = requestedBody(fetchFn);
		expect(body.rank_by).toEqual(['search_text', 'BM25', 'felt']);
		expect(body.filters).toEqual(['And', [['colour_red', 'Gte', COLOUR_THRESHOLDS.red]]]);
	});

	it('never asks for colour weights back, so results do not depend on them existing', async () => {
		const fetchFn = vi.fn().mockResolvedValue(queryResponse([]));
		await repository(fetchFn).search(input({ colours: ['red'] }));
		expect(
			requestedBody(fetchFn).include_attributes.some((name: string) => name.startsWith('colour_'))
		).toBe(false);
	});

	it('uses BM25 for lexical search', async () => {
		const fetchFn = vi.fn().mockResolvedValue(queryResponse([]));
		await repository(fetchFn).search(input({ mode: 'lexical', query: 'felt' }));
		expect(requestedBody(fetchFn).rank_by).toEqual(['search_text', 'BM25', 'felt']);
	});

	it('uses native ANN embedding for semantic search', async () => {
		const fetchFn = vi.fn().mockResolvedValue(queryResponse([]));
		await repository(fetchFn).search(input({ mode: 'semantic', query: 'felt' }));
		expect(requestedBody(fetchFn).rank_by).toEqual(['search_text', 'ANN', ['Embed', 'felt']]);
	});

	it('uses one RRF multiQuery for hybrid search', async () => {
		const fetchFn = vi.fn().mockResolvedValue(multiQueryResponse([]));
		await repository(fetchFn).search(input({ mode: 'hybrid', query: 'felt' }));
		const [url] = fetchFn.mock.calls[0] as [string];
		expect(url).toContain('stainless_overload=multiQuery');
		expect(requestedBody(fetchFn)).toMatchObject({
			rerank_by: ['RRF'],
			queries: [
				{ rank_by: ['search_text', 'BM25', 'felt'] },
				{ rank_by: ['search_text', 'ANN', ['Embed', 'felt']] }
			]
		});
	});

	it.each(['browse', 'lexical', 'semantic', 'hybrid'] as const)(
		'applies the same selected filters to %s',
		async (mode) => {
			const fetchFn = vi
				.fn()
				.mockResolvedValue(mode === 'hybrid' ? multiQueryResponse([]) : queryResponse([]));
			await repository(fetchFn).search(
				input({ mode, query: mode === 'browse' ? '' : 'felt', blockTypes: ['Image'] })
			);
			const body = requestedBody(fetchFn);
			const filters =
				mode === 'hybrid'
					? body.queries.map((query: { filters: unknown }) => query.filters)
					: [body.filters];
			expect(filters).toEqual(
				[['And', [['block_type', 'In', ['Image']]]]].concat(
					mode === 'hybrid' ? [['And', [['block_type', 'In', ['Image']]]]] : []
				)
			);
		}
	);

	it('does not send an empty filters property', async () => {
		const fetchFn = vi.fn().mockResolvedValue(queryResponse([]));
		await repository(fetchFn).search(input());
		expect(requestedBody(fetchFn)).not.toHaveProperty('filters');
	});

	it('propagates channel and date filters to both hybrid subqueries', async () => {
		const fetchFn = vi.fn().mockResolvedValue(multiQueryResponse([]));
		await repository(fetchFn).search(
			input({
				mode: 'hybrid',
				query: 'felt',
				channelSlugs: ['materials', 'photography'],
				from: new Date('2024-01-01T00:00:00.000Z'),
				to: new Date('2024-01-31T23:59:59.999Z')
			})
		);
		const expected = [
			'And',
			[
				['channel_slugs', 'ContainsAny', ['materials', 'photography']],
				['connected_at', 'Gte', '2024-01-01T00:00:00.000Z'],
				['connected_at', 'Lte', '2024-01-31T23:59:59.999Z']
			]
		];
		expect(
			requestedBody(fetchFn).queries.map((query: { filters: unknown }) => query.filters)
		).toEqual([expected, expected]);
	});

	it('treats malformed provider rows and provider failures as unavailable', async () => {
		const malformedFetch = vi.fn().mockResolvedValue(queryResponse([{ id: 'block:12' }]));
		await expect(repository(malformedFetch).search(input())).rejects.toBeInstanceOf(
			SearchUnavailableError
		);

		const failedFetch = vi.fn().mockResolvedValue(new Response('nope', { status: 503 }));
		await expect(repository(failedFetch).search(input())).rejects.toBeInstanceOf(
			SearchUnavailableError
		);
	});
});
