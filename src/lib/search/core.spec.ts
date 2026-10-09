import { describe, expect, it } from 'vitest';
import MiniSearch from 'minisearch';
import { ARCHIVE_COLOURS, ARCHIVE_SORTS } from '$lib/domain/search';
import {
	ArchiveSearchEngine,
	compareBrowse,
	lexicalOptions,
	matchesFilters,
	reciprocalRankFusion
} from './core';
import { parseArchiveSearchRequest } from './request';
import { EMBEDDING } from './embedding';
import type { PublicDocument } from './snapshot';

function document(id: string, overrides: Partial<PublicDocument> = {}): PublicDocument {
	return {
		result: {
			id,
			title: id,
			description: null,
			blockType: 'Image',
			channelSlugs: ['a'],
			connectedAt: '2026-09-12T00:00:00.000Z',
			sourceUrl: null,
			arenaUrl: 'https://www.are.na/block/1',
			imageUrl: null,
			imageAlt: null,
			imageWidth: null,
			imageHeight: null,
			videoUrl: null,
			videoContentType: null,
			sourceTitle: null
		},
		kind: 'Image',
		createdAt: '2026-09-01T00:00:00.000Z',
		connectionCount: 1,
		totalConnectionCount: 1,
		colours: Object.fromEntries(
			ARCHIVE_COLOURS.map((colour) => [colour, 0])
		) as PublicDocument['colours'],
		...overrides
	};
}
const input = (query = '') => parseArchiveSearchRequest(new URLSearchParams(query));
const vector = (dimension: number) =>
	Array.from({ length: EMBEDDING.dimensions }, (_, index) => Number(index === dimension));

describe('browser search filters and orders', () => {
	it('ORs channels and types, ANDs colours and dates, and includes full UTC days', () => {
		const block = document('a');
		block.colours.blue = 20;
		block.colours.orange = 11;
		expect(
			matchesFilters(
				block,
				input(
					'channel=other&channel=a&type=Web&type=Image&colour=blue&colour=orange&from=2026-09-12&to=2026-09-12&created_from=2026-09-01&created_to=2026-09-01'
				)
			)
		).toBe(true);
		block.colours.orange = 9;
		expect(matchesFilters(block, input('colour=blue&colour=orange'))).toBe(false);
		expect(matchesFilters(block, input('from=2026-09-13'))).toBe(false);
		block.result.connectedAt = null;
		expect(matchesFilters(block, input('to=2026-09-12'))).toBe(false);
	});
	it('relaxes only the leading browse colour at the default sort', () => {
		const block = document('a');
		block.colours.blue = 1;
		block.colours.orange = 1;
		block.colours.mono = 994;
		expect(matchesFilters(block, input('colour=blue'))).toBe(true);
		expect(matchesFilters(block, input('colour=blue&colour=orange'))).toBe(false);
		expect(matchesFilters(block, input('colour=blue&sort=newest-created'))).toBe(false);
		expect(matchesFilters(block, input('q=blue&colour=blue'))).toBe(false);
		expect(matchesFilters(block, input('colour=mono'))).toBe(false);
	});
	it('uses ID to make every browse order total', () => {
		for (const sort of ARCHIVE_SORTS)
			expect(
				[document('b'), document('a')]
					.sort((a, b) => compareBrowse(a, b, input(`sort=${sort}`)))
					.map((block) => block.result.id)
			).toEqual(['a', 'b']);
	});
	it('preserves connection and date sorts and colour precedence', () => {
		const a = document('a', { connectionCount: 5, totalConnectionCount: 6 });
		const b = document('b', {
			connectionCount: 2,
			totalConnectionCount: 20,
			createdAt: '2026-09-02T00:00:00.000Z'
		});
		b.result.connectedAt = '2026-09-13T00:00:00.000Z';
		a.colours.blue = 10;
		b.colours.blue = 20;
		const order = (params: string) =>
			[a, b].sort((x, y) => compareBrowse(x, y, input(params))).map((d) => d.result.id);
		expect(order('')).toEqual(['a', 'b']);
		for (const sort of [
			'my-least-connected',
			'most-connected',
			'newest-created',
			'my-newest-connected'
		])
			expect(order(`sort=${sort}`)).toEqual(['b', 'a']);
		for (const sort of ['oldest-created', 'my-oldest-connected'])
			expect(order(`sort=${sort}`)).toEqual(['a', 'b']);
		expect(order('colour=blue')).toEqual(['b', 'a']);
	});
});
describe('hybrid and semantic ranking', () => {
	it('fuses ranks with stable ties and deduplicates each list', () => {
		expect(
			reciprocalRankFusion([
				['b', 'a'],
				['a', 'b']
			])
		).toEqual(['a', 'b']);
		expect(
			reciprocalRankFusion([
				['b', 'b', 'a'],
				['a', 'b']
			])
		).toEqual(['a', 'b']);
	});
	it('filters before scoring and aggregates multiple chunks into one block', () => {
		const a = document('a'),
			b = document('b'),
			c = document('c');
		a.result.channelSlugs = ['excluded'];
		const lexical = new MiniSearch(lexicalOptions);
		lexical.addAll([
			{ id: 'a', search_text: 'red fox' },
			{ id: 'b', search_text: 'red fox' },
			{ id: 'c', search_text: 'blue sky' }
		]);
		const search = new ArchiveSearchEngine([a, b, c], lexical, [0, 1, 1, 2]);
		search.setVectors(new Float32Array([...vector(0), ...vector(1), ...vector(0), ...vector(2)]));
		expect(
			search.search(input('q=red&mode=semantic&channel=a'), vector(0)).map((result) => result.id)
		).toEqual(['b', 'c']);
		expect(
			search.search(input('q=red&mode=hybrid&channel=a'), vector(0)).map((result) => result.id)
		).toEqual(['b', 'c']);
		expect(search.search(input('q=red&mode=lexical&channel=a')).map((result) => result.id)).toEqual(
			['b']
		);
	});
	it('does not silently fall back to keywords when embeddings are missing', () => {
		const lexical = new MiniSearch(lexicalOptions);
		const search = new ArchiveSearchEngine([document('a')], lexical, [0]);
		expect(() => search.search(input('q=fox&mode=semantic'))).toThrow('requires embeddings');
		expect(() => search.setVectors(new Float32Array(384))).toThrow('not normalized');
	});
	it('keeps ranking independent of offsets, including beyond 100 semantic matches', () => {
		const documents = Array.from({ length: 150 }, (_, index) =>
			document(String(index).padStart(3, '0'))
		);
		const search = new ArchiveSearchEngine(
			documents,
			new MiniSearch(lexicalOptions),
			documents.map((_, index) => index)
		);
		search.setVectors(new Float32Array(documents.flatMap(() => vector(0))));
		const first = search.search(input('q=concept&mode=hybrid'), vector(0));
		const later = search.search(input('q=concept&mode=hybrid&offset=120'), vector(0));
		expect(first).toEqual(later);
		expect(later.slice(120, 144)).toHaveLength(24);
	});
});
