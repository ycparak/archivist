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
			connection_count: 1,
			connected_at: '2026-01-02T03:04:05.000Z',
			image_alt: 'A brutalist window',
			image_width: 800,
			image_height: 600
		});
	});

	it('counts each distinct channel a block is connected to', () => {
		const document = toSearchDocument(
			archiveBlockSchema.parse({
				id: 7,
				type: 'Text',
				arenaUrl: 'https://www.are.na/block/7',
				channels: [
					{ slug: 'materials', title: 'Materials' },
					{ slug: 'felt', title: 'Felt' },
					{ slug: 'felt', title: 'Felt' }
				]
			})
		);

		expect(document.connection_count).toBe(2);
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

describe('toSearchDocument — generated tags', () => {
	const block = () =>
		archiveBlockSchema.parse({
			id: 9,
			type: 'Image',
			title: 'Brutalist window',
			arenaUrl: 'https://www.are.na/block/9',
			channels: [{ slug: 'architecture', title: 'Architecture' }]
		});

	const vision = (tags: string[]) => ({
		title: 'A concrete facade',
		description: 'A concrete facade in raking light.',
		ocr: '',
		medium: 'photograph',
		tags
	});

	/** 53% of tag wording appears nowhere else in a block's indexed text. */
	it('indexes tags so their wording is searchable', () => {
		const document = toSearchDocument(block(), vision(['brutalism', 'dark mode']));

		expect(document.search_text).toContain('brutalism, dark mode');
		expect(document.vision_tags).toEqual(['brutalism', 'dark mode']);
	});

	it('keeps tags last, so eight words cannot outweigh a block that describes itself', () => {
		const document = toSearchDocument(block(), vision(['brutalism']));
		const lines = document.search_text.split('\n');

		expect(lines.at(-1)).toBe('brutalism');
		expect(lines[0]).toBe('Brutalist window');
	});

	/** The model capitalizes intermittently; a facet should treat `UI` and `ui` as one value. */
	it('lowercases and deduplicates, so a facet does not split on capitalization', () => {
		const document = toSearchDocument(block(), vision(['UI', 'ui', 'macOS', ' UI ']));

		expect(document.vision_tags).toEqual(['macos', 'ui']);
	});

	it('sorts them, so an unchanged block re-upserts identically', () => {
		const first = toSearchDocument(block(), vision(['web design', 'a11y', 'typography']));
		const second = toSearchDocument(block(), vision(['typography', 'a11y', 'web design']));

		expect(first.vision_tags).toEqual(['a11y', 'typography', 'web design']);
		expect(first.search_text).toBe(second.search_text);
	});

	it('drops blanks rather than indexing an empty tag', () => {
		expect(toSearchDocument(block(), vision(['', '   ', 'felt'])).vision_tags).toEqual(['felt']);
	});

	it('indexes an empty list for a block the model never saw', () => {
		const document = toSearchDocument(block());

		expect(document.vision_tags).toEqual([]);
		expect(document.search_text).toBe('Brutalist window\nArchitecture');
	});

	it('leaves no trailing separator when a block has tags but no description', () => {
		const document = toSearchDocument(block(), {
			title: '',
			description: '',
			ocr: '',
			medium: '',
			tags: ['felt']
		});

		expect(document.search_text).toBe('Brutalist window\nArchitecture\nfelt');
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
