import { describe, expect, it, vi } from 'vitest';
import type { SearchResult } from '$lib/domain/search';
import type { SearchRepository } from './contracts';
import { executeArchiveSearch } from './execute';
import { SearchUnavailableError } from './repository';

function result(overrides: Partial<SearchResult> = {}): SearchResult {
	return {
		id: 'block:1',
		title: 'Industrial felt',
		description: null,
		blockType: 'Image',
		channelSlugs: ['materials'],
		connectedAt: '2024-01-02T00:00:00.000Z',
		sourceUrl: null,
		arenaUrl: 'https://www.are.na/block/1',
		imageUrl: null,
		imageAlt: null,
		imageWidth: null,
		imageHeight: null,
		sourceTitle: null,
		...overrides
	};
}

function repository(results: SearchResult[]): SearchRepository {
	return { search: vi.fn().mockResolvedValue(results) };
}

const silent = () => {};

describe('executeArchiveSearch', () => {
	it('returns results with the state the URL asked for', async () => {
		const outcome = await executeArchiveSearch(
			new URLSearchParams('q=felt&mode=lexical&channel=materials'),
			() => repository([result()]),
			undefined,
			silent
		);

		expect(outcome).toEqual({
			kind: 'ok',
			state: {
				query: 'felt',
				mode: 'lexical',
				channelSlugs: ['materials'],
				blockTypes: [],
				from: '',
				to: ''
			},
			results: [result()]
		});
	});

	it('keeps the highest-ranked copy when both rankings return the same block', async () => {
		const outcome = await executeArchiveSearch(
			new URLSearchParams('q=felt'),
			() =>
				repository([
					result(),
					result({ title: 'The same block, ranked lower by the other query' }),
					result({ id: 'block:2' })
				]),
			undefined,
			silent
		);

		expect(outcome.kind).toBe('ok');
		expect(outcome.kind === 'ok' && outcome.results).toEqual([result(), result({ id: 'block:2' })]);
	});

	it('reports an invalid request without building a repository or a correlation ID', async () => {
		const createRepository = vi.fn();
		const createCorrelationId = vi.fn();

		const outcome = await executeArchiveSearch(
			new URLSearchParams('mode=lexical&q=%20&channel=materials'),
			createRepository,
			createCorrelationId,
			silent
		);

		expect(outcome).toEqual({
			kind: 'invalid',
			state: {
				query: '',
				mode: 'lexical',
				channelSlugs: ['materials'],
				blockTypes: [],
				from: '',
				to: ''
			}
		});
		expect(createRepository).not.toHaveBeenCalled();
		expect(createCorrelationId).not.toHaveBeenCalled();
	});

	it('treats a repeated single-value parameter as invalid rather than unavailable', async () => {
		const outcome = await executeArchiveSearch(
			new URLSearchParams('q=one&q=two'),
			() => repository([]),
			undefined,
			silent
		);

		expect(outcome.kind).toBe('invalid');
	});

	it('does not mint a correlation ID for a successful search', async () => {
		const createCorrelationId = vi.fn();
		await executeArchiveSearch(
			new URLSearchParams('q=felt'),
			() => repository([]),
			createCorrelationId,
			silent
		);

		expect(createCorrelationId).not.toHaveBeenCalled();
	});

	it('reports provider failure with a correlation ID and no provider or query detail', async () => {
		const reportUnavailable = vi.fn();

		const outcome = await executeArchiveSearch(
			new URLSearchParams('q=private%20felt'),
			() => ({
				search: vi
					.fn()
					.mockRejectedValue(new SearchUnavailableError({ status: 503, detail: 'private felt' }))
			}),
			() => 'request-123',
			reportUnavailable
		);

		expect(outcome).toMatchObject({ kind: 'unavailable', correlationId: 'request-123' });
		expect(reportUnavailable).toHaveBeenCalledTimes(1);
		expect(reportUnavailable).toHaveBeenCalledWith({
			correlationId: 'request-123',
			providerStatus: 503
		});
	});

	it('reports a misconfigured search service as unavailable with no provider status', async () => {
		const reportUnavailable = vi.fn();

		const outcome = await executeArchiveSearch(
			new URLSearchParams(),
			() => {
				throw new Error('Search service is not configured');
			},
			() => 'request-456',
			reportUnavailable
		);

		expect(outcome).toMatchObject({ kind: 'unavailable', correlationId: 'request-456' });
		expect(reportUnavailable).toHaveBeenCalledWith({
			correlationId: 'request-456',
			providerStatus: null
		});
	});

	it('keeps the submitted filters on an unavailable search so the form is not wiped', async () => {
		const outcome = await executeArchiveSearch(
			new URLSearchParams('q=felt&channel=materials&type=Image'),
			() => ({ search: vi.fn().mockRejectedValue(new SearchUnavailableError(new Error('down'))) }),
			() => 'request-789',
			silent
		);

		expect(outcome.state).toMatchObject({
			query: 'felt',
			channelSlugs: ['materials'],
			blockTypes: ['Image']
		});
	});
});
