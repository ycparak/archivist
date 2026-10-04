import { describe, expect, it } from 'vitest';
import type { ChannelManifestEntry, SearchResult } from '$lib/domain/search';
import { SHELF, groupResults, layoutShelves, shelfChannel } from './shelf';

function result(id: string, overrides: Partial<SearchResult> = {}): SearchResult {
	return {
		id,
		title: id,
		description: null,
		blockType: 'Image',
		channelSlugs: ['materials'],
		connectedAt: null,
		sourceUrl: null,
		arenaUrl: `https://www.are.na/block/${id}`,
		imageUrl: `https://images.are.na/${id}.jpg`,
		imageAlt: null,
		imageWidth: 400,
		imageHeight: 400,
		videoUrl: null,
		videoContentType: null,
		sourceTitle: null,
		...overrides
	};
}

const manifest = new Map<string, ChannelManifestEntry>([
	['materials', { slug: 'materials', title: 'Materials' }],
	['type', { slug: 'type', title: 'Type' }]
]);

describe('shelfChannel', () => {
	it('prefers a channel the reader filtered by, then one the manifest knows', () => {
		const block = result('1', { channelSlugs: ['unknown', 'materials', 'type'] });

		expect(shelfChannel(block, manifest, ['type'])?.slug).toBe('type');
		expect(shelfChannel(block, manifest, [])?.slug).toBe('materials');
	});

	it('falls back to the slug itself for a channel the manifest has not caught up with', () => {
		expect(shelfChannel(result('1', { channelSlugs: ['new'] }), manifest, [])).toEqual({
			slug: 'new',
			title: 'new'
		});
		expect(shelfChannel(result('1', { channelSlugs: [] }), manifest, [])).toBeNull();
	});
});

describe('page shapes', () => {
	it('leaves an image page to its image, and gives a text page and a cover a fixed shape', () => {
		const [group] = groupResults(
			[result('a'), result('b', { imageUrl: null, blockType: 'Text' })],
			manifest,
			[]
		);

		expect(group.items.map((item) => item.ratio)).toEqual([
			SHELF.coverRatio,
			null,
			SHELF.textRatio
		]);
	});
});

describe('groupResults', () => {
	it('shelves blocks by channel in order of first appearance, keeping rank inside a channel', () => {
		const groups = groupResults(
			[
				result('a'),
				result('b', { channelSlugs: ['type'] }),
				result('c'),
				result('d', { channelSlugs: ['type'] })
			],
			manifest,
			[]
		);

		expect(groups.map((group) => group.channel?.slug)).toEqual(['materials', 'type']);
		expect(groups[0].blocks.map((block) => block.id)).toEqual(['a', 'c']);
		expect(groups[0].items.map((item) => item.kind)).toEqual(['cover', 'block', 'block']);
	});

	it('splits a channel with more than a shelf of blocks, each shelf with its own cover', () => {
		const many = Array.from({ length: SHELF.maxBlocksPerGroup + 2 }, (_, index) =>
			result(String(index))
		);
		const groups = groupResults(many, manifest, []);

		expect(groups.map((group) => group.blocks.length)).toEqual([SHELF.maxBlocksPerGroup, 2]);
		expect(groups.every((group) => group.items[0].kind === 'cover')).toBe(true);
		expect(new Set(groups.map((group) => group.id)).size).toBe(2);
	});
});

describe('layoutShelves', () => {
	const ids = (layout: ReturnType<typeof layoutShelves>) =>
		layout.rows.map((row) => row.map((group) => group.id));

	it('places each shelf on the shortest row', () => {
		const layout = layoutShelves(
			[
				[
					result('a'),
					result('b', { channelSlugs: ['type'] }),
					result('c', { channelSlugs: ['third'] }),
					result('d', { channelSlugs: ['fourth'] })
				]
			],
			manifest,
			[]
		);

		expect(ids(layout)).toEqual([
			['a', 'c'],
			['b', 'd']
		]);
	});

	it('puts a long shelf on one row and the next two on the other', () => {
		const long = Array.from({ length: 6 }, (_, index) => result(`long-${index}`));
		const layout = layoutShelves(
			[[...long, result('x', { channelSlugs: ['type'] }), result('y', { channelSlugs: [] })]],
			manifest,
			[]
		);

		expect(ids(layout)).toEqual([['long-0'], ['x', 'y']]);
	});

	it('balances rows without reading the size Are.na stored for an image', () => {
		const page = (width: number | null, height: number | null) => [
			result('a', { imageWidth: width, imageHeight: height }),
			result('b', { channelSlugs: ['type'], imageWidth: width, imageHeight: height }),
			result('c', { channelSlugs: [], imageWidth: width, imageHeight: height })
		];

		expect(ids(layoutShelves([page(10000, 100)], manifest, []))).toEqual(
			ids(layoutShelves([page(null, null)], manifest, []))
		);
	});

	it('appends a later page without moving any shelf already placed', () => {
		const firstPage = [result('a'), result('b', { channelSlugs: ['type'] })];
		const before = layoutShelves([firstPage], manifest, []);
		const after = layoutShelves([firstPage, [result('c')]], manifest, []);

		expect(after.rows.map((row) => row.slice(0, before.rows[0].length))[0]).toEqual(before.rows[0]);
		expect(after.rows[1].slice(0, before.rows[1].length)).toEqual(before.rows[1]);
		expect(after.rows.flat()).toHaveLength(3);
	});
});
