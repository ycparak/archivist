import { describe, expect, it } from 'vitest';
import { emptyArchiveSearchState, type ArchiveSearchState } from '$lib/domain/search';
import { blockDisplayTitle, formatSearchTimings, resultsStatus } from './format';

describe('blockDisplayTitle', () => {
	it('prefers the block’s own title', () => {
		expect(blockDisplayTitle('Industrial felt', 'Image')).toBe('Industrial felt');
	});

	it('labels an untitled block by its own type rather than inventing one', () => {
		expect(blockDisplayTitle(null, 'Image')).toBe('Untitled image');
		expect(blockDisplayTitle('', 'Attachment')).toBe('Untitled attachment');
		expect(blockDisplayTitle(null, 'Something new')).toBe('Untitled block');
	});
});

describe('formatSearchTimings', () => {
	it('shows total, query, and rerank time in seconds', () => {
		expect(formatSearchTimings({ totalMs: 963, queryMs: 412.6, rerankMs: 0 })).toBe(
			'time: 0.96s (query: 0.41s, rerank: 0.00s)'
		);
	});
});

describe('resultsStatus', () => {
	function state(overrides: Partial<ArchiveSearchState> = {}): ArchiveSearchState {
		return { ...emptyArchiveSearchState, ...overrides };
	}

	it('names the query and filter count so a repeated search still announces', () => {
		expect(
			resultsStatus({
				kind: 'ok',
				state: state({ query: 'felt', channelSlugs: ['materials'], blockTypes: ['Image'] }),
				resultCount: 3,
				searching: false
			})
		).toBe('3 blocks for \u201cfelt\u201d with 2 filters.');
	});

	it('counts a date range as one filter and says so in the singular', () => {
		expect(
			resultsStatus({
				kind: 'ok',
				state: state({ from: '2024-01-02', to: '2024-01-31' }),
				resultCount: 1,
				searching: false
			})
		).toBe('1 block in the archive with 1 filter.');
	});

	it('does not claim a total it cannot support once the server limit is reached', () => {
		expect(resultsStatus({ kind: 'ok', state: state(), resultCount: 24, searching: false })).toBe(
			'Showing the first 24 blocks in the archive.'
		);
		expect(resultsStatus({ kind: 'ok', state: state(), resultCount: 23, searching: false })).toBe(
			'23 blocks in the archive.'
		);
	});

	it('reports the search in flight ahead of the settled outcome', () => {
		expect(
			resultsStatus({
				kind: 'ok',
				state: state({ query: 'felt' }),
				resultCount: 0,
				searching: true
			})
		).toBe('Searching for \u201cfelt\u201d\u2026');
	});

	it('reports each failed outcome without echoing the query', () => {
		const searched = state({ query: 'private felt' });
		expect(
			resultsStatus({ kind: 'unavailable', state: searched, resultCount: 0, searching: false })
		).toBe('Search is unavailable right now.');
		expect(
			resultsStatus({ kind: 'invalid', state: searched, resultCount: 0, searching: false })
		).toBe('That search could not be read.');
	});

	it('says nothing matched rather than showing an empty gallery', () => {
		expect(
			resultsStatus({
				kind: 'ok',
				state: state({ query: 'nothing here' }),
				resultCount: 0,
				searching: false
			})
		).toBe('No blocks for \u201cnothing here\u201d.');
	});
});
