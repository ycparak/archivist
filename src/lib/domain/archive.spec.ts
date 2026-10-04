import { describe, expect, it } from 'vitest';
import {
	archiveBlockSchema,
	clampOcr,
	blockKind,
	isDegenerateText,
	MAX_OCR_CHARS,
	toSearchDocument
} from './archive';
import { ARCHIVE_BLOCK_TYPES, ARCHIVE_COLOURS } from './search';

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

describe('toSearchDocument — connection counts', () => {
	const block = (channels: { slug: string; title: string }[]) =>
		archiveBlockSchema.parse({
			id: 9,
			type: 'Image',
			title: 'Brutalist window',
			arenaUrl: 'https://www.are.na/block/9',
			channels
		});
	const alpha = { slug: 'alpha', title: 'Alpha' };
	const beta = { slug: 'beta', title: 'Beta' };

	it('keeps the maintainer’s channel count apart from the total on Are.na', () => {
		const document = toSearchDocument(block([alpha, beta]), null, null, 14);
		expect(document.connection_count).toBe(2);
		expect(document.total_connection_count).toBe(14);
	});

	it('falls back to the channels it can see for a block that was never counted', () => {
		const document = toSearchDocument(block([alpha, beta]));
		expect(document.total_connection_count).toBe(2);
		expect(toSearchDocument(block([alpha]), null, null, null).total_connection_count).toBe(1);
	});

	it('never records a total below the maintainer’s own channels', () => {
		expect(toSearchDocument(block([alpha, beta]), null, null, 1).total_connection_count).toBe(2);
	});

	it('counts a channel once however many times it was merged in', () => {
		expect(toSearchDocument(block([alpha, alpha]), null, null, 0).total_connection_count).toBe(1);
	});

	it('keeps the count out of the searchable text', () => {
		expect(toSearchDocument(block([alpha]), null, null, 14).search_text).toBe(
			toSearchDocument(block([alpha])).search_text
		);
	});
});

describe('toSearchDocument — colour weights', () => {
	const block = () =>
		archiveBlockSchema.parse({
			id: 9,
			type: 'Image',
			title: 'Brutalist window',
			arenaUrl: 'https://www.are.na/block/9',
			channels: [{ slug: 'architecture', title: 'Architecture' }]
		});

	const weights = Object.fromEntries(
		ARCHIVE_COLOURS.map((colour) => [colour, colour === 'grey' ? 640 : colour === 'mono' ? 980 : 0])
	) as Record<(typeof ARCHIVE_COLOURS)[number], number>;

	it('writes one attribute per colour from the measured weights', () => {
		const document = toSearchDocument(block(), null, weights);
		expect(document.colour_grey).toBe(640);
		expect(document.colour_mono).toBe(980);
		expect(document.colour_red).toBe(0);
	});

	it('weighs zero in every colour for a block that was never measured', () => {
		const document = toSearchDocument(block());
		for (const colour of ARCHIVE_COLOURS) expect(document[`colour_${colour}`]).toBe(0);
	});

	it('keeps colour out of the searchable text', () => {
		expect(toSearchDocument(block(), null, weights).search_text).toBe(
			toSearchDocument(block()).search_text
		);
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

	/**
	 * The model hyphenates the same concept intermittently: 153 pairs across the archive differ only
	 * by a hyphen. Leaving them split cost `semantic-material` nine rank positions — that block's
	 * `design-engineer` occurs exactly once, while everything above it used the spacing the query did.
	 */
	it('collapses hyphens, so one concept is one tag', () => {
		const document = toSearchDocument(block(), vision(['web-design', 'web design', 'dark-mode']));

		expect(document.vision_tags).toEqual(['dark mode', 'web design']);
	});

	it('collapses a hyphen in the embedded text too, not just the attribute', () => {
		expect(toSearchDocument(block(), vision(['design-engineer'])).search_text).toContain(
			'design engineer'
		);
	});

	it('handles a repeated or trailing hyphen without leaving ragged whitespace', () => {
		const document = toSearchDocument(block(), vision(['reel--to--reel', 'ui-', '-ux']));

		expect(document.vision_tags).toEqual(['reel to reel', 'ui', 'ux']);
	});

	it('drops a tag that was nothing but punctuation', () => {
		expect(toSearchDocument(block(), vision(['-', '--', 'felt'])).vision_tags).toEqual(['felt']);
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

describe('isDegenerateText', () => {
	/**
	 * The separation in real data is unusually clean: the two known runaways sit at 0.22% and 0.97%
	 * unique words, while the lowest legitimate entry of the 728 with substantial OCR is 16.3%.
	 */
	it('recognises a decode that collapsed into repetition', () => {
		expect(isDegenerateText('and critical architecture the notion of '.repeat(60))).toBe(true);
	});

	it('leaves dense but real text alone', () => {
		const page = Array.from({ length: 300 }, (_, index) => `word${index % 220}`).join(' ');
		expect(isDegenerateText(page)).toBe(false);
	});

	it('does not judge a short string, where the ratio means nothing', () => {
		expect(isDegenerateText('round round round round round')).toBe(false);
	});

	it('treats empty text as fine rather than degenerate', () => {
		expect(isDegenerateText('')).toBe(false);
	});
});

describe('clampOcr', () => {
	it('passes ordinary OCR through untouched', () => {
		expect(clampOcr('OPERATIONAL MANIFEST — profile summary')).toBe(
			'OPERATIONAL MANIFEST — profile summary'
		);
	});

	it('bounds text that runs past the ceiling', () => {
		const long = Array.from({ length: 4000 }, (_, index) => `w${index}`).join(' ');
		expect(clampOcr(long).length).toBeLessThanOrEqual(MAX_OCR_CHARS);
	});

	/**
	 * The real runaway opens as genuine text and only degenerates partway in, and that opening is
	 * lost with the rest. Detection is a property of the whole sample — a window small enough to
	 * isolate the good part cannot tell repetition from dense prose — so this documents the cost
	 * rather than pretending the opening survives.
	 */
	it('drops the genuine opening too, when the run degenerates behind it', () => {
		const real = 'ABSTRACT ARCHITECTING ARCHITECTURE CONSIDERS RESTITUTION AND SCARCITY. ';
		expect(clampOcr(real.repeat(4) + 'and critical practice that '.repeat(4000))).toBe('');
	});

	it('keeps a genuine run that merely happens to be long', () => {
		const real = Array.from({ length: 900 }, (_, index) => `term${index}`).join(' ');
		const clamped = clampOcr(real);

		expect(clamped.startsWith('term0 term1')).toBe(true);
		expect(clamped.length).toBeLessThanOrEqual(MAX_OCR_CHARS);
	});

	it('drops it entirely when what survives the clamp is still repetition', () => {
		expect(clampOcr('round '.repeat(4000))).toBe('');
	});

	it('is bounded above the largest legitimate OCR seen in the archive', () => {
		// The biggest real one is 5,624 characters; the next two up are the runaways.
		expect(MAX_OCR_CHARS).toBeGreaterThan(5_624);
	});
});

describe('toSearchDocument — a runaway already in the cache', () => {
	/**
	 * Two entries were cached before anything checked, one of them 270,500 characters of a single
	 * phrase repeated some 4,300 times. A cache hit never regenerates, so without a clamp here they
	 * would keep going into BM25 and the embedding forever.
	 */
	const block = () =>
		archiveBlockSchema.parse({
			id: 3,
			type: 'Image',
			title: 'Symposium poster',
			arenaUrl: 'https://www.are.na/block/3',
			channels: [{ slug: 'architecture', title: 'Architecture' }]
		});

	it('keeps a runaway out of the indexed text', () => {
		const document = toSearchDocument(block(), {
			title: 'A symposium poster',
			description: 'A poster for an architecture symposium.',
			ocr: 'AND CRITICAL ARCHITECTURE THE NOTION OF CRITICAL PRACTICE '.repeat(4000),
			medium: 'typography',
			tags: []
		});

		expect(document.vision_ocr).toBeNull();
		expect(document.search_text).not.toContain('AND CRITICAL ARCHITECTURE');
		// The description still carries the block.
		expect(document.search_text).toContain('architecture symposium');
	});

	it('bounds merely long OCR instead of discarding it', () => {
		const dense = Array.from({ length: 2000 }, (_, index) => `term${index}`).join(' ');
		const document = toSearchDocument(block(), {
			title: 'A dense page',
			description: 'A page of dense body copy.',
			ocr: dense,
			medium: 'typography',
			tags: []
		});

		expect(document.vision_ocr).not.toBeNull();
		expect((document.vision_ocr ?? '').length).toBeLessThanOrEqual(MAX_OCR_CHARS);
	});
});

describe('block type indexing', () => {
	it("indexes Are.na's block type verbatim beside the kind the gallery filters by", () => {
		for (const blockType of ['Image', 'Link', 'Text', 'Attachment', 'Embed']) {
			const document = toSearchDocument(
				archiveBlockSchema.parse({
					id: 1,
					type: blockType,
					arenaUrl: 'https://www.are.na/block/1',
					channels: [{ slug: 'materials', title: 'Materials' }]
				})
			);
			expect(document.block_type).toBe(blockType);
			expect(ARCHIVE_BLOCK_TYPES).toContain(document.kind);
		}
	});
});

describe('blockKind', () => {
	it('names a block by what it is to a reader', () => {
		expect(blockKind({ type: 'Image', imageContentType: 'image/jpeg' })).toBe('Image');
		expect(blockKind({ type: 'Link' })).toBe('Web');
		expect(blockKind({ type: 'Text' })).toBe('Text');
		expect(blockKind({ type: 'Embed' })).toBe('Embed');
		expect(blockKind({ type: 'Attachment' })).toBe('Attachment');
		expect(blockKind({ type: 'Channel' })).toBeNull();
	});

	it('pulls videos and animated GIFs out of whichever block holds them', () => {
		expect(blockKind({ type: 'Attachment', videoUrl: 'https://attachments.are.na/1/a.mp4' })).toBe(
			'Video'
		);
		expect(blockKind({ type: 'Image', imageContentType: 'image/GIF' })).toBe('GIF');
		expect(blockKind({ type: 'Attachment', imageContentType: 'image/gif' })).toBe('GIF');
	});

	it('keeps a link a web page even when its preview is a GIF', () => {
		expect(blockKind({ type: 'Link', imageContentType: 'image/gif' })).toBe('Web');
	});
});
