import { describe, expect, it } from 'vitest';
import { emptyArchiveSearchState, type ArchiveSearchState } from '$lib/domain/search';
import {
	CONNECTED_AT_FIRST_MONTH,
	colourOptions,
	datesToMonthRange,
	formatMonth,
	monthAt,
	monthRangeToDates,
	monthsBetween,
	searchTypeOptions,
	sortOptions,
	toggled
} from './filters';

function state(overrides: Partial<ArchiveSearchState> = {}): ArchiveSearchState {
	return { ...emptyArchiveSearchState, ...overrides };
}

describe('toggled', () => {
	it('adds a value that is missing and removes one that is present, keeping order', () => {
		expect(toggled(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
		expect(toggled(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
	});
});

describe('searchTypeOptions', () => {
	it('lets a ranking be chosen before there is a query, with Best match in force by default', () => {
		const options = searchTypeOptions(state());

		expect(options.find((option) => option.active)?.label).toBe('Best match');
		expect(options.find((option) => option.key === 'semantic')?.href).toBe('/?mode=semantic');
	});

	it('marks the ranking in force and links to the others', () => {
		const options = searchTypeOptions(state({ query: 'felt', mode: 'lexical' }));

		expect(options.find((option) => option.active)?.label).toBe('Exact words');
		expect(options.find((option) => option.key === 'hybrid')?.href).toBe('/?q=felt');
	});
});

describe('sortOptions', () => {
	it('links each order while browsing and none once a query ranks', () => {
		expect(
			sortOptions(state({ sort: 'oldest-created' })).map((option) => [
				option.label,
				option.href,
				option.active
			])
		).toEqual([
			['Newest created', '/', false],
			['Newest connected', '/?sort=newest-connected', false],
			['Oldest created', '/?sort=oldest-created', true],
			['Oldest connected', '/?sort=oldest-connected', false],
			['Most connected', '/?sort=most-connected', false],
			['Least connected', '/?sort=least-connected', false]
		]);
		expect(
			sortOptions(state({ query: 'felt', mode: 'hybrid' })).some((option) => option.href)
		).toBe(false);
	});
});

describe('colourOptions', () => {
	it('never offers pink, black or white, even when the search uses one', () => {
		const keys = (search: ArchiveSearchState) => colourOptions(search).map((option) => option.key);

		expect(keys(state())).toEqual([
			'red',
			'orange',
			'yellow',
			'green',
			'blue',
			'purple',
			'brown',
			'grey',
			'mono'
		]);
		expect(keys(state({ colours: ['white', 'pink'] }))).not.toContain('white');
	});

	it('keeps chosen colours removable once the limit is reached, and offers no more', () => {
		const options = colourOptions(state({ colours: ['red', 'orange', 'yellow', 'green', 'blue'] }));

		expect(options.find((option) => option.key === 'red')?.href).toBe(
			'/?colour=orange&colour=yellow&colour=green&colour=blue'
		);
		expect(options.find((option) => option.key === 'brown')?.href).toBeUndefined();
	});
});

describe('connected-date months', () => {
	const first = { year: 2024, month: 6 };
	const count = monthsBetween(first, { year: 2026, month: 10 });

	it('counts months inclusively and walks across years', () => {
		expect(count).toBe(29);
		expect(monthAt(first, 7)).toEqual({ year: 2025, month: 1 });
		expect(formatMonth(monthAt(first, 0))).toBe('Jun 2024');
	});

	it('sets no bound for a thumb at its end of the range', () => {
		expect(monthRangeToDates(0, count - 1, first, count)).toEqual({ from: '', to: '' });
	});

	it('turns months into whole-month inclusive dates, whichever thumb is ahead', () => {
		expect(monthRangeToDates(9, 2, first, count)).toEqual({ from: '2024-08-01', to: '2025-03-31' });
		expect(monthRangeToDates(8, 8, first, count)).toEqual({ from: '2025-02-01', to: '2025-02-28' });
	});

	it('places thumbs for dates, clamping ones outside the range and treating a missing bound as open', () => {
		expect(datesToMonthRange('2024-08-15', '2025-03-31', first, count)).toEqual([2, 9]);
		expect(datesToMonthRange('', '', first, count)).toEqual([0, count - 1]);
		expect(datesToMonthRange('2020-01-01', '2030-01-01', first, count)).toEqual([0, count - 1]);
	});

	it('starts at the oldest connection in the archive', () => {
		expect(CONNECTED_AT_FIRST_MONTH).toEqual({ year: 2024, month: 6 });
	});
});
