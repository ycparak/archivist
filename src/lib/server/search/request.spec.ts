import { describe, expect, it } from 'vitest';
import { SearchRequestValidationError, parseArchiveSearchRequest } from './request';

describe('parseArchiveSearchRequest', () => {
	it('defaults an empty request to browse with the server-owned result limit', () => {
		expect(parseArchiveSearchRequest(new URLSearchParams())).toEqual({
			mode: 'browse',
			query: '',
			channelSlugs: [],
			blockTypes: [],
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
				'q=archival&mode=lexical&channel=materials&channel=type&type=Image&type=Link&from=2024-01-02&to=2024-01-31'
			)
		);

		expect(input).toMatchObject({
			mode: 'lexical',
			query: 'archival',
			channelSlugs: ['materials', 'type'],
			blockTypes: ['Image', 'Link'],
			from: new Date('2024-01-02T00:00:00.000Z'),
			to: new Date('2024-01-31T23:59:59.999Z')
		});
	});

	it('does not allow URL input to control the result limit', () => {
		expect(parseArchiveSearchRequest(new URLSearchParams('mode=browse&limit=1')).limit).toBe(24);
	});

	it.each(['lexical', 'semantic', 'hybrid'])('rejects an empty %s query', (mode) => {
		expect(() => parseArchiveSearchRequest(new URLSearchParams(`mode=${mode}&q=%20`))).toThrow(
			SearchRequestValidationError
		);
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
