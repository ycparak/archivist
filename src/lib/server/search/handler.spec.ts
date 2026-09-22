import { describe, expect, it, vi } from 'vitest';
import { searchSuccessResponseSchema, type SearchRepository, type SearchResult } from './contracts';
import { handleSearchRequest } from './handler';
import { SearchUnavailableError } from './repository';

function repository(results: SearchResult[]): SearchRepository {
	return {
		search: vi.fn().mockResolvedValue({ results, timings: { totalMs: 0, queryMs: 0, rerankMs: 0 } })
	};
}

describe('handleSearchRequest', () => {
	it('returns only the stable public result envelope', async () => {
		const searchRepository = repository([]);
		const response = await handleSearchRequest(
			new URL('https://archivist.test/api/search?q=felt'),
			() => searchRepository
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ results: [], hasMore: false });
		expect(searchRepository.search).toHaveBeenCalledWith(
			expect.objectContaining({ mode: 'hybrid', query: 'felt', limit: 24 })
		);
	});

	it('serializes a populated result through the published success envelope', async () => {
		const row: SearchResult = {
			id: 'block:1',
			title: 'Industrial felt',
			description: 'Swatches',
			blockType: 'Image',
			channelSlugs: ['materials'],
			connectedAt: '2024-01-02T00:00:00.000Z',
			sourceUrl: 'https://example.test/felt',
			arenaUrl: 'https://www.are.na/block/1',
			imageUrl: 'https://images.are.na/felt.jpg',
			imageAlt: 'A felt swatch',
			imageWidth: 800,
			imageHeight: 600,
			videoUrl: null,
			videoContentType: null,
			sourceTitle: 'Example'
		};

		const response = await handleSearchRequest(
			new URL('https://archivist.test/api/search?q=felt'),
			() => repository([row]),
			undefined,
			() => {}
		);

		const body = await response.json();
		expect(body).toEqual({ results: [row], hasMore: false });
		expect(searchSuccessResponseSchema.parse(body).results[0]).toEqual(row);
	});

	it('deduplicates results by block id before they reach the client', async () => {
		const row: SearchResult = {
			id: 'block:1',
			title: 'Industrial felt',
			description: null,
			blockType: 'Image',
			channelSlugs: [],
			connectedAt: null,
			sourceUrl: null,
			arenaUrl: 'https://www.are.na/block/1',
			imageUrl: null,
			imageAlt: null,
			imageWidth: null,
			imageHeight: null,
			videoUrl: null,
			videoContentType: null,
			sourceTitle: null
		};

		const response = await handleSearchRequest(
			new URL('https://archivist.test/api/search?q=felt'),
			() => repository([row, { ...row, title: 'Same block, other ranking' }]),
			undefined,
			() => {}
		);

		expect(await response.json()).toEqual({ results: [row], hasMore: false });
	});

	it('returns 400 before constructing a repository for invalid input', async () => {
		const createRepository = vi.fn();
		const response = await handleSearchRequest(
			new URL('https://archivist.test/api/search?mode=lexical&q=%20'),
			createRepository
		);

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({ error: 'Invalid search request' });
		expect(createRepository).not.toHaveBeenCalled();
	});

	it('redacts unavailable provider details while returning a correlation ID', async () => {
		const reportUnavailable = vi.fn();
		const response = await handleSearchRequest(
			new URL('https://archivist.test/api/search?q=private%20felt'),
			() => ({
				search: vi
					.fn()
					.mockRejectedValue(new SearchUnavailableError({ status: 503, detail: 'private felt' }))
			}),
			() => 'request-123',
			reportUnavailable
		);

		expect(response.status).toBe(503);
		expect(await response.json()).toEqual({
			error: 'Search unavailable',
			correlationId: 'request-123'
		});
		expect(reportUnavailable).toHaveBeenCalledWith({
			correlationId: 'request-123',
			providerStatus: 503
		});
	});
});
