import { describe, expect, it } from 'vitest';
import { emptyArchiveSearchState, type ArchiveSearchState } from '$lib/domain/search';
import { blockDisplayTitle, formatArchiveDate, resultsStatus } from './format';

describe('formatArchiveDate', () => {
	it('formats a connected timestamp in UTC', () => {
		expect(formatArchiveDate('2024-01-02T09:15:00.000Z')).toBe('2 Jan 2024');
		expect(formatArchiveDate('2024-12-31T00:00:00.000Z')).toBe('31 Dec 2024');
	});

	it('does not shift the day for a timestamp near midnight UTC', () => {
		expect(formatArchiveDate('2024-01-01T23:30:00.000Z')).toBe('1 Jan 2024');
		expect(formatArchiveDate('2024-01-01T00:30:00.000Z')).toBe('1 Jan 2024');
	});

	it('returns nothing for a missing or unreadable value', () => {
		expect(formatArchiveDate(null)).toBeNull();
		expect(formatArchiveDate('')).toBeNull();
		expect(formatArchiveDate('not-a-date')).toBeNull();
	});
});

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
