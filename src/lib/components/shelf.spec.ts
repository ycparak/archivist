import { describe, expect, it } from 'vitest';
import type { ChannelManifestEntry, SearchResult } from '$lib/domain/search';
import { SHELF, blockRatio, groupResults, layoutShelves, shelfChannel } from './shelf';

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

describe('blockRatio', () => {
	it('uses the image shape, and a portrait page for text', () => {
		expect(blockRatio(result('1', { imageWidth: 800, imageHeight: 400 }))).toBe(2);
		expect(blockRatio(result('1', { imageUrl: null }))).toBe(SHELF.textRatio);
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

	it('sizes a shelf from its pages and the gaps between them', () => {
		const [group] = groupResults([result('a'), result('b')], manifest, []);
		const ratios = SHELF.coverRatio + 1 + 1;

		expect(group.width).toBeCloseTo(ratios * SHELF.pageHeight + 2 * SHELF.itemGap);
	});
});

describe('layoutShelves', () => {
	it('places each shelf on the shortest row, gapped from the shelf before it', () => {
		const layout = layoutShelves(
			[[result('a'), result('b', { channelSlugs: ['type'] }), result('c', { channelSlugs: [] })]],
			manifest,
			[]
		);
		const [first, second, third] = layout.groups;

		expect([first.row, first.x]).toEqual([0, 0]);
		expect([second.row, second.x]).toEqual([1, 0]);
		expect(third.row).toBe(second.width < first.width ? 1 : 0);
		expect(third.x).toBeCloseTo((third.row === 0 ? first.width : second.width) + SHELF.groupGap);
	});

	it('appends a later page without moving any shelf already placed', () => {
		const firstPage = [result('a'), result('b', { channelSlugs: ['type'] })];
		const before = layoutShelves([firstPage], manifest, []);
		const after = layoutShelves([firstPage, [result('c')]], manifest, []);

		expect(after.groups.slice(0, 2)).toEqual(before.groups);
		expect(after.groups[2].channel?.slug).toBe('materials');
	});
});
