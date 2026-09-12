import { describe, expect, it, vi } from 'vitest';
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
		limit: 24,
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

describe('buildSearchFilters', () => {
	it('omits filters when none are selected', () => {
		expect(buildSearchFilters(input())).toBeUndefined();
	});

	it('uses only V1 attributes and composes categories with AND', () => {
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

		await expect(repository(fetchFn).search(input())).resolves.toEqual([
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
				sourceTitle: 'Example'
			}
		]);
	});

	it('orders browse results by connected_at without a text rank', async () => {
		const fetchFn = vi.fn().mockResolvedValue(queryResponse([]));
		await repository(fetchFn).search(input());
		const body = requestedBody(fetchFn);
		expect(body.rank_by).toEqual(['connected_at', 'desc']);
		expect(body.rank_by).not.toContain('search_text');
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
