import { describe, expect, it } from 'vitest';
import {
	defaultSearchMode,
	emptyArchiveSearchState,
	hasActiveFilters,
	readArchiveSearchState,
	toArchiveSearchHref,
	withChannel,
	withoutBlockType,
	withoutChannel,
	withoutDateRange,
	withoutFilters,
	type ArchiveSearchState
} from './search';

function state(overrides: Partial<ArchiveSearchState> = {}): ArchiveSearchState {
	return { ...emptyArchiveSearchState, ...overrides };
}

describe('toArchiveSearchHref', () => {
	it('returns the bare path when nothing is set', () => {
		expect(toArchiveSearchHref(state())).toBe('/');
	});

	it('omits the mode that the query already implies', () => {
		expect(toArchiveSearchHref(state({ query: 'felt', mode: 'hybrid' }))).toBe('/?q=felt');
		expect(toArchiveSearchHref(state({ query: '', mode: 'browse' }))).toBe('/');
	});

	it('keeps a mode the query does not imply', () => {
		expect(toArchiveSearchHref(state({ query: 'felt', mode: 'lexical' }))).toBe(
			'/?q=felt&mode=lexical'
		);
	});

	it('drops a ranking mode that cannot apply without a query', () => {
		expect(toArchiveSearchHref(state({ query: '', mode: 'semantic' }))).toBe('/');
	});

	it('repeats channel and type filters and keeps date bounds', () => {
		expect(
			toArchiveSearchHref(
				state({
					channelSlugs: ['materials', 'type'],
					blockTypes: ['Image', 'Link'],
					from: '2024-01-02',
					to: '2024-01-31'
				})
			)
		).toBe('/?channel=materials&channel=type&type=Image&type=Link&from=2024-01-02&to=2024-01-31');
	});
});

describe('readArchiveSearchState', () => {
	it('round-trips every state through its own href', () => {
		const cases: ArchiveSearchState[] = [
			state(),
			state({ query: 'industrial felt', mode: 'hybrid' }),
			state({ query: 'felt', mode: 'lexical' }),
			state({ query: 'felt', mode: 'semantic', channelSlugs: ['materials'] }),
			state({ blockTypes: ['Image'], from: '2024-01-02', to: '2024-01-31' }),
			state({
				query: 'archival',
				mode: 'lexical',
				channelSlugs: ['materials', 'type'],
				blockTypes: ['Image', 'Link'],
				from: '2024-01-02',
				to: '2024-01-31'
			})
		];

		for (const original of cases) {
			const href = toArchiveSearchHref(original);
			const url = new URL(href, 'https://archivist.test');
			expect(readArchiveSearchState(url.searchParams)).toEqual(original);
		}
	});

	it('falls back to the implied mode for an unknown or blank one', () => {
		expect(readArchiveSearchState(new URLSearchParams('q=felt&mode=fuzzy')).mode).toBe('hybrid');
		expect(readArchiveSearchState(new URLSearchParams('mode=')).mode).toBe('browse');
	});

	it('drops blank and unknown values rather than echoing them back into the form', () => {
		expect(
			readArchiveSearchState(
				new URLSearchParams('channel=&channel=materials&type=Photo&type=Image')
			)
		).toMatchObject({ channelSlugs: ['materials'], blockTypes: ['Image'] });
	});
});

describe('search state transitions', () => {
	const active = state({
		query: 'felt',
		mode: 'lexical',
		channelSlugs: ['materials', 'type'],
		blockTypes: ['Image', 'Link'],
		from: '2024-01-02',
		to: '2024-01-31'
	});

	it('adds a channel at most once', () => {
		expect(withChannel(state(), 'materials').channelSlugs).toEqual(['materials']);
		expect(withChannel(active, 'materials')).toBe(active);
	});

	it('removes one filter while preserving the query, mode, and other filters', () => {
		expect(withoutChannel(active, 'materials')).toMatchObject({
			query: 'felt',
			mode: 'lexical',
			channelSlugs: ['type'],
			blockTypes: ['Image', 'Link']
		});
		expect(withoutBlockType(active, 'Image').blockTypes).toEqual(['Link']);
		expect(withoutDateRange(active)).toMatchObject({ from: '', to: '', query: 'felt' });
	});

	it('drops every filter but keeps the search itself', () => {
		expect(withoutFilters(active)).toEqual(state({ query: 'felt', mode: 'lexical' }));
	});

	it('leaves no filter params in the href once the last filter is removed', () => {
		const single = state({ query: 'felt', mode: 'lexical', channelSlugs: ['materials'] });
		expect(toArchiveSearchHref(withoutChannel(single, 'materials'))).toBe('/?q=felt&mode=lexical');
	});

	it('reports whether any filter is active', () => {
		expect(hasActiveFilters(state({ query: 'felt' }))).toBe(false);
		expect(hasActiveFilters(state({ to: '2024-01-31' }))).toBe(true);
		expect(hasActiveFilters(active)).toBe(true);
	});
});

describe('defaultSearchMode', () => {
	it('browses without a query and ranks with one', () => {
		expect(defaultSearchMode('')).toBe('browse');
		expect(defaultSearchMode('   ')).toBe('browse');
		expect(defaultSearchMode('felt')).toBe('hybrid');
	});
});
