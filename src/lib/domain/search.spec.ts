import { describe, expect, it } from 'vitest';
import {
	defaultSearchMode,
	emptyArchiveSearchState,
	hasActiveFilters,
	readArchiveSearchState,
	toArchiveSearchHref,
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

	it('remembers a chosen ranking without a query, so it applies to the next one', () => {
		expect(toArchiveSearchHref(state({ query: '', mode: 'semantic' }))).toBe('/?mode=semantic');
		expect(toArchiveSearchHref(state({ query: '', mode: 'hybrid' }))).toBe('/');
	});

	it('keeps a browse order other than the default, and drops it once a query ranks instead', () => {
		expect(toArchiveSearchHref(state({ sort: 'most-connected' }))).toBe('/?sort=most-connected');
		expect(toArchiveSearchHref(state({ sort: 'my-most-connected' }))).toBe('/');
		expect(toArchiveSearchHref(state({ mode: 'lexical', sort: 'my-least-connected' }))).toBe(
			'/?mode=lexical&sort=my-least-connected'
		);
		expect(
			toArchiveSearchHref(state({ query: 'felt', mode: 'hybrid', sort: 'my-oldest-connected' }))
		).toBe('/?q=felt');
	});

	it('repeats colours in the order they were chosen', () => {
		expect(toArchiveSearchHref(state({ colours: ['orange', 'blue'] }))).toBe(
			'/?colour=orange&colour=blue'
		);
	});

	it('repeats channel and type filters and keeps date bounds', () => {
		expect(
			toArchiveSearchHref(
				state({
					channelSlugs: ['materials', 'type'],
					blockTypes: ['Image', 'Web'],
					from: '2024-01-02',
					to: '2024-01-31'
				})
			)
		).toBe('/?channel=materials&channel=type&type=Image&type=Web&from=2024-01-02&to=2024-01-31');
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
			state({ colours: ['blue', 'mono'] }),
			state({ colours: ['blue'], sort: 'oldest-created' }),
			state({ mode: 'lexical', createdFrom: '2020-01-01', createdTo: '2021-12-31' }),
			state({ blockTypes: ['Video', 'GIF', 'Web'] }),
			state({
				query: 'archival',
				mode: 'lexical',
				channelSlugs: ['materials', 'type'],
				blockTypes: ['Image', 'Web'],
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

	it('falls back to the default browse order for an unknown sort', () => {
		expect(readArchiveSearchState(new URLSearchParams('sort=random')).sort).toBe(
			'my-most-connected'
		);
		expect(readArchiveSearchState(new URLSearchParams('sort=oldest-created')).sort).toBe(
			'oldest-created'
		);
	});

	it('collapses duplicate filter values so keyed rendering cannot break', () => {
		expect(
			readArchiveSearchState(
				new URLSearchParams('channel=materials&channel=materials&type=Image&type=Image')
			)
		).toMatchObject({ channelSlugs: ['materials'], blockTypes: ['Image'] });
	});

	it('drops unknown colours and keeps at most as many as a request may carry', () => {
		expect(
			readArchiveSearchState(
				new URLSearchParams(
					'colour=teal&colour=red&colour=orange&colour=yellow&colour=green&colour=blue&colour=purple'
				)
			).colours
		).toEqual(['red', 'orange', 'yellow', 'green', 'blue']);
	});

	it('drops a date that is not a real calendar day', () => {
		expect(readArchiveSearchState(new URLSearchParams('from=2024-13-45')).from).toBe('');
		expect(readArchiveSearchState(new URLSearchParams('from=2024-02-31')).from).toBe('');
		expect(readArchiveSearchState(new URLSearchParams('from=2024-1-2')).from).toBe('');
		expect(readArchiveSearchState(new URLSearchParams('from=not-a-date')).from).toBe('');
		expect(readArchiveSearchState(new URLSearchParams('from=2024-02-29')).from).toBe('2024-02-29');
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
		blockTypes: ['Image', 'Web'],
		from: '2024-01-02',
		to: '2024-01-31'
	});

	it('reports whether any filter is active', () => {
		expect(hasActiveFilters(state({ query: 'felt' }))).toBe(false);
		expect(hasActiveFilters(state({ to: '2024-01-31' }))).toBe(true);
		expect(hasActiveFilters(state({ colours: ['mono'] }))).toBe(true);
		expect(hasActiveFilters(state({ createdFrom: '2020-01-01' }))).toBe(true);
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
