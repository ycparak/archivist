import { describe, expect, it } from 'vitest';
import {
	emptyArchiveSearchState,
	toArchiveSearchHref,
	type ArchiveSearchState
} from '$lib/domain/search';
import { SearchRequestValidationError, parseArchiveSearchRequest } from './request';

describe('every href the UI can build is a request the server accepts', () => {
	function state(overrides: Partial<ArchiveSearchState> = {}): ArchiveSearchState {
		return { ...emptyArchiveSearchState, ...overrides };
	}

	const cases: Array<
		[string, ArchiveSearchState, Partial<ReturnType<typeof parseArchiveSearchRequest>>]
	> = [
		['empty', state(), { mode: 'browse', query: '' }],
		[
			'query only',
			state({ query: 'industrial felt', mode: 'hybrid' }),
			{ mode: 'hybrid', query: 'industrial felt' }
		],
		[
			'explicit ranking',
			state({ query: 'felt', mode: 'lexical' }),
			{ mode: 'lexical', query: 'felt' }
		],
		[
			'explicit browse with a query',
			state({ query: 'felt', mode: 'browse' }),
			{ mode: 'browse', query: 'felt' }
		],
		['ranking dropped without a query', state({ mode: 'semantic' }), { mode: 'browse', query: '' }],
		[
			'a browse order',
			state({ sort: 'newest-connected' }),
			{ mode: 'browse', sort: 'newest-connected' }
		],
		[
			'a browse order dropped once a query ranks',
			state({ query: 'felt', mode: 'hybrid', sort: 'oldest-connected' }),
			{ mode: 'hybrid', sort: 'most-connected' }
		],
		[
			'a browse order kept for an explicit browse with a query',
			state({ query: 'felt', mode: 'browse', sort: 'oldest-connected' }),
			{ mode: 'browse', sort: 'oldest-connected' }
		],
		[
			'filters only',
			state({ channelSlugs: ['materials'], blockTypes: ['Image'] }),
			{ mode: 'browse', channelSlugs: ['materials'], blockTypes: ['Image'] }
		],
		[
			'everything at once',
			state({
				query: 'archival',
				mode: 'semantic',
				channelSlugs: ['materials', 'type'],
				blockTypes: ['Image', 'Web'],
				from: '2024-01-02',
				to: '2024-01-31'
			}),
			{
				mode: 'semantic',
				query: 'archival',
				channelSlugs: ['materials', 'type'],
				blockTypes: ['Image', 'Web'],
				from: new Date('2024-01-02T00:00:00.000Z'),
				to: new Date('2024-01-31T23:59:59.999Z')
			}
		]
	];

	it.each(cases)('accepts the href for %s', (_name, uiState, expected) => {
		const href = toArchiveSearchHref(uiState);
		const { searchParams } = new URL(href, 'https://archivist.test');

		expect(parseArchiveSearchRequest(searchParams)).toMatchObject(expected);
	});
});

describe('parseArchiveSearchRequest', () => {
	it('defaults an empty request to browse with the server-owned result limit', () => {
		expect(parseArchiveSearchRequest(new URLSearchParams())).toEqual({
			mode: 'browse',
			query: '',
			channelSlugs: [],
			blockTypes: [],
			colours: [],
			sort: 'most-connected',
			offset: 0,
			limit: 24
		});
	});

	it('defaults a supplied query to hybrid', () => {
		expect(parseArchiveSearchRequest(new URLSearchParams('q=industrial%20felt'))).toMatchObject({
			mode: 'hybrid',
			query: 'industrial felt'
		});
	});

	it('parses repeated filters and inclusive date-only bounds', () => {
		const input = parseArchiveSearchRequest(
			new URLSearchParams(
				'q=archival&mode=lexical&channel=materials&channel=type&type=Image&type=Web&from=2024-01-02&to=2024-01-31'
			)
		);

		expect(input).toMatchObject({
			mode: 'lexical',
			query: 'archival',
			channelSlugs: ['materials', 'type'],
			blockTypes: ['Image', 'Web'],
			from: new Date('2024-01-02T00:00:00.000Z'),
			to: new Date('2024-01-31T23:59:59.999Z')
		});
	});

	it('does not allow URL input to control the result limit', () => {
		expect(parseArchiveSearchRequest(new URLSearchParams('mode=browse&limit=1')).limit).toBe(24);
	});

	it.each(['lexical', 'semantic', 'hybrid'])(
		'browses an empty query even with %s ranking chosen, and keeps a browse order beside it',
		(mode) => {
			expect(
				parseArchiveSearchRequest(new URLSearchParams(`mode=${mode}&q=%20&sort=oldest-created`))
			).toMatchObject({ mode: 'browse', query: '', sort: 'oldest-created' });
		}
	);

	it('treats blank values as omitted so a plain form submission is valid', () => {
		expect(parseArchiveSearchRequest(new URLSearchParams('q=&mode=&from=&to='))).toEqual({
			mode: 'browse',
			query: '',
			channelSlugs: [],
			blockTypes: [],
			colours: [],
			sort: 'most-connected',
			offset: 0,
			limit: 24
		});
	});

	it('drops blank repeated filters without dropping the real ones', () => {
		expect(
			parseArchiveSearchRequest(
				new URLSearchParams('channel=&channel=materials&type=%20%20&type=Image')
			)
		).toMatchObject({ channelSlugs: ['materials'], blockTypes: ['Image'] });
	});

	it('still rejects malformed values that are not blank', () => {
		expect(() => parseArchiveSearchRequest(new URLSearchParams('q=felt&mode=fuzzy'))).toThrow(
			SearchRequestValidationError
		);
		expect(() => parseArchiveSearchRequest(new URLSearchParams('from=not-a-date'))).toThrow(
			SearchRequestValidationError
		);
		expect(() => parseArchiveSearchRequest(new URLSearchParams('from=2024-13-45'))).toThrow(
			SearchRequestValidationError
		);
		expect(() => parseArchiveSearchRequest(new URLSearchParams('from=2024-1-2'))).toThrow(
			SearchRequestValidationError
		);
		expect(() =>
			parseArchiveSearchRequest(new URLSearchParams('from=2024-01-02T00:00:00Z'))
		).toThrow(SearchRequestValidationError);
		expect(() => parseArchiveSearchRequest(new URLSearchParams('from=%202024-01-02'))).toThrow(
			SearchRequestValidationError
		);
		expect(() => parseArchiveSearchRequest(new URLSearchParams('type=Photo'))).toThrow(
			SearchRequestValidationError
		);
	});

	it('accepts colours, in the order chosen, without repeats', () => {
		expect(
			parseArchiveSearchRequest(new URLSearchParams('colour=blue&colour=mono&colour=blue')).colours
		).toEqual(['blue', 'mono']);
	});

	it('rejects a colour outside the vocabulary rather than ignoring it', () => {
		expect(() => parseArchiveSearchRequest(new URLSearchParams('colour=teal'))).toThrow(
			SearchRequestValidationError
		);
	});

	it('rejects more colours than browse can sort on', () => {
		const six = ['red', 'orange', 'yellow', 'green', 'blue', 'purple']
			.map((colour) => `colour=${colour}`)
			.join('&');
		expect(() => parseArchiveSearchRequest(new URLSearchParams(six))).toThrow(
			SearchRequestValidationError
		);
	});

	it('counts blank values when rejecting repeated single-value parameters', () => {
		expect(() => parseArchiveSearchRequest(new URLSearchParams('from=&from=2024-01-02'))).toThrow(
			SearchRequestValidationError
		);
	});

	it('parses an inclusive created-date range and rejects a reversed one', () => {
		expect(
			parseArchiveSearchRequest(
				new URLSearchParams('created_from=2019-01-01&created_to=2020-12-31')
			)
		).toMatchObject({
			createdFrom: new Date('2019-01-01T00:00:00.000Z'),
			createdTo: new Date('2020-12-31T23:59:59.999Z')
		});
		expect(() =>
			parseArchiveSearchRequest(
				new URLSearchParams('created_from=2021-01-01&created_to=2020-12-31')
			)
		).toThrow(SearchRequestValidationError);
	});

	it('rejects a browse order alongside a ranking it cannot apply to', () => {
		expect(() => parseArchiveSearchRequest(new URLSearchParams('q=felt&sort=newest'))).toThrow(
			SearchRequestValidationError
		);
		expect(() => parseArchiveSearchRequest(new URLSearchParams('sort=random'))).toThrow(
			SearchRequestValidationError
		);
	});

	it('keeps an explicit browse mode when a query is present', () => {
		expect(parseArchiveSearchRequest(new URLSearchParams('q=felt&mode=browse'))).toMatchObject({
			mode: 'browse',
			query: 'felt'
		});
	});

	it('rejects more filter values than the server accepts', () => {
		const channels = Array.from({ length: 21 }, (_, index) => `channel=c${index}`).join('&');
		expect(() => parseArchiveSearchRequest(new URLSearchParams(channels))).toThrow(
			SearchRequestValidationError
		);
		const blanks = Array.from({ length: 25 }, () => 'channel=').join('&');
		expect(parseArchiveSearchRequest(new URLSearchParams(blanks)).channelSlugs).toEqual([]);
	});

	it('rejects reversed date ranges and repeated single-value parameters', () => {
		expect(() =>
			parseArchiveSearchRequest(new URLSearchParams('mode=browse&from=2024-02-01&to=2024-01-31'))
		).toThrow(SearchRequestValidationError);
		expect(() => parseArchiveSearchRequest(new URLSearchParams('q=one&q=two'))).toThrow(
			SearchRequestValidationError
		);
	});
});
