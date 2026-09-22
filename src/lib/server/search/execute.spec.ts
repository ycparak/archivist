import { describe, expect, it, vi } from 'vitest';
import { ARCHIVE_RESULT_LIMIT, type SearchResult } from '$lib/domain/search';
import type { SearchRepository } from './contracts';
import { executeArchiveSearch, reportSearchUnavailable } from './execute';
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
		videoUrl: null,
		videoContentType: null,
		sourceTitle: null,
		...overrides
	};
}

const timings = { totalMs: 12, queryMs: 8, rerankMs: 2 };

function repository(results: SearchResult[]): SearchRepository {
	return { search: vi.fn().mockResolvedValue({ results, timings }) };
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
			results: [result()],
			hasMore: false,
			timings
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

	it('caps deduplicated results at the server-owned limit', async () => {
		const results = Array.from({ length: ARCHIVE_RESULT_LIMIT + 1 }, (_, index) =>
			result({ id: `block:${index + 1}` })
		);

		const outcome = await executeArchiveSearch(
			new URLSearchParams('q=website+analytics'),
			() => repository(results),
			undefined,
			silent
		);

		expect(outcome.kind).toBe('ok');
		expect(outcome.kind === 'ok' && outcome.hasMore).toBe(true);
		expect(outcome.kind === 'ok' && outcome.results).toHaveLength(ARCHIVE_RESULT_LIMIT);
		expect(outcome.kind === 'ok' && outcome.results.at(-1)?.id).toBe(
			`block:${ARCHIVE_RESULT_LIMIT}`
		);
	});

	it('serves a later page from the ranked list and says whether more remain', async () => {
		const results = Array.from({ length: ARCHIVE_RESULT_LIMIT * 2 + 1 }, (_, index) =>
			result({ id: `block:${index + 1}` })
		);

		const outcome = await executeArchiveSearch(
			new URLSearchParams(`q=felt&offset=${ARCHIVE_RESULT_LIMIT}`),
			() => repository(results),
			undefined,
			silent
		);

		expect(outcome.kind === 'ok' && outcome.results).toHaveLength(ARCHIVE_RESULT_LIMIT);
		expect(outcome.kind === 'ok' && outcome.results[0].id).toBe(
			`block:${ARCHIVE_RESULT_LIMIT + 1}`
		);
		expect(outcome.kind === 'ok' && outcome.hasMore).toBe(true);
	});

	it('rejects an offset beyond the server-owned ceiling as an invalid request', async () => {
		const outcome = await executeArchiveSearch(
			new URLSearchParams('q=felt&offset=999999'),
			vi.fn(),
			undefined,
			silent
		);

		expect(outcome.kind).toBe('invalid');
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

	it('emits an allowlisted structured event for the default unavailable-search reporter', () => {
		const report = vi.spyOn(console, 'error').mockImplementation(() => {});

		reportSearchUnavailable({ correlationId: 'request-456', providerStatus: null });

		expect(report).toHaveBeenCalledWith({
			event: 'archive_search_unavailable',
			correlationId: 'request-456',
			providerStatus: null
		});
		report.mockRestore();
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
