import { describe, expect, it } from 'vitest';
import { archiveBlockSchema, toSearchDocument } from './archive';
import { ARCHIVE_BLOCK_TYPES } from './search';

describe('toSearchDocument', () => {
	it('builds stable searchable text without inventing image content', () => {
		const document = toSearchDocument(
			archiveBlockSchema.parse({
				id: 42,
				type: 'Image',
				title: '  Brutalist  \n  window ',
				description: null,
				content: null,
				sourceTitle: 'Concrete studies',
				sourceUrl: 'https://example.com/source',
				arenaUrl: 'https://www.are.na/block/42',
				imageUrl: 'https://images.are.na/example.jpg',
				imageAlt: '  A brutalist window  ',
				imageWidth: 800,
				imageHeight: 600,
				connectedAt: new Date('2026-01-02T03:04:05.000Z'),
				channels: [
					{ slug: 'architecture', title: 'Architecture' },
					{ slug: 'architecture', title: 'Architecture' }
				]
			})
		);

		expect(document).toMatchObject({
			id: 'block:42',
			search_text: 'Brutalist window\nConcrete studies\nArchitecture',
			channel_slugs: ['architecture'],
			connected_at: '2026-01-02T03:04:05.000Z',
			image_alt: 'A brutalist window',
			image_width: 800,
			image_height: 600
		});
	});

	it('indexes null image metadata as null rather than a fallback value', () => {
		const document = toSearchDocument(
			archiveBlockSchema.parse({
				id: 1,
				type: 'Text',
				arenaUrl: 'https://www.are.na/block/1',
				channels: [{ slug: 'materials', title: 'Materials' }]
			})
		);

		expect(document.image_alt).toBeNull();
		expect(document.image_width).toBeNull();
		expect(document.image_height).toBeNull();
	});
});

describe('block type indexing', () => {
	it('indexes every filterable block type verbatim', () => {
		for (const blockType of ARCHIVE_BLOCK_TYPES) {
			const document = toSearchDocument(
				archiveBlockSchema.parse({
					id: 1,
					type: blockType,
					arenaUrl: 'https://www.are.na/block/1',
					channels: [{ slug: 'materials', title: 'Materials' }]
				})
			);
			expect(document.block_type).toBe(blockType);
		}
	});
});
