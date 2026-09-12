import { describe, expect, it, vi } from 'vitest';
import type { SearchRepository } from './contracts';
import { handleSearchRequest } from './handler';
import { SearchUnavailableError } from './repository';

function repository(results: Awaited<ReturnType<SearchRepository['search']>>): SearchRepository {
	return { search: vi.fn().mockResolvedValue(results) };
}

describe('handleSearchRequest', () => {
	it('returns only the stable public result envelope', async () => {
		const searchRepository = repository([]);
		const response = await handleSearchRequest(
			new URL('https://archivist.test/api/search?q=felt'),
			() => searchRepository
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ results: [] });
		expect(searchRepository.search).toHaveBeenCalledWith(
			expect.objectContaining({ mode: 'hybrid', query: 'felt', limit: 24 })
		);
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
