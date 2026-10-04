import { z } from 'zod';
import { ARCHIVE_COLOURS, type ArchiveBlockType, type ArchiveColour } from './search';

export const blockTypeSchema = z.string().trim().min(1);

export const archiveBlockSchema = z.object({
	id: z.union([z.string(), z.number()]).transform(String),
	type: blockTypeSchema,
	title: z.string().nullable().optional(),
	description: z.string().nullable().optional(),
	content: z.string().nullable().optional(),
	sourceTitle: z.string().nullable().optional(),
	sourceUrl: z.url().nullable().optional(),
	arenaUrl: z.url(),
	imageUrl: z.url().nullable().optional(),
	imageAlt: z.string().nullable().optional(),
	imageWidth: z.number().int().positive().nullable().optional(),
	imageHeight: z.number().int().positive().nullable().optional(),
	/** Sync-time only: lets the vision stage apply its size guard without a HEAD request. */
	imageBytes: z.number().int().nonnegative().nullable().optional(),
	imageContentType: z.string().nullable().optional(),
	/** Playable file for a video attachment. Null for every other block, including Embeds. */
	videoUrl: z.url().nullable().optional(),
	videoContentType: z.string().nullable().optional(),
	/** Are.na user id of the block's author; write-back is owner-only. */
	ownerId: z.number().int().nullable().optional(),
	createdAt: z.coerce.date().optional(),
	connectedAt: z.coerce.date().optional(),
	channels: z.array(
		z.object({
			slug: z.string().trim().min(1),
			title: z.string().trim().min(1)
		})
	)
});

export type ArchiveBlock = z.infer<typeof archiveBlockSchema>;

/**
 * Generated text for one block, structurally matching a vision cache entry. Declared here rather
 * than imported so the domain layer stays independent of the indexing pipeline.
 */
export type BlockVisionText = {
	title: string;
	description: string;
	ocr: string;
	medium: string;
	tags: string[];
};

/** Per-mille share of the image in each colour, structurally matching a colour cache entry's weights. */
export type BlockColourWeights = Record<ArchiveColour, number>;

export type ColourAttribute = `colour_${ArchiveColour}`;

export function colourAttribute(colour: ArchiveColour): ColourAttribute {
	return `colour_${colour}`;
}

export type SearchDocument = {
	id: string;
	search_text: string;
	block_type: string;
	/** What the block is to a reader (`ARCHIVE_BLOCK_TYPES`); the gallery's Block type filter reads this. */
	kind: ArchiveBlockType | null;
	channel_slugs: string[];
	/** How many of the maintainer's synced channels hold the block. */
	connection_count: number;
	/** Every connection to the block on Are.na, by the maintainer and anyone else. */
	total_connection_count: number;
	connected_at: string | null;
	created_at: string | null;
	title: string | null;
	description: string | null;
	source_url: string | null;
	arena_url: string;
	image_url: string | null;
	image_alt: string | null;
	image_width: number | null;
	image_height: number | null;
	video_url: string | null;
	video_content_type: string | null;
	source_title: string | null;
	vision_title: string | null;
	vision_description: string | null;
	vision_ocr: string | null;
	vision_medium: string | null;
	vision_tags: string[];
} & Record<ColourAttribute, number>;

/**
 * OCR had no bound while `description` has had one since the first live call, and the asymmetry
 * cost: one cached entry holds 270,500 characters of OCR, all of it a single phrase repeated some
 * 4,300 times, and it has been going into `search_text` — BM25 and the embedding both — ever since.
 * Only two of 2,561 entries exceed this, and both are that failure.
 */
export const MAX_OCR_CHARS = 6_000;

/**
 * A decode that has collapsed into repetition. The separation is unusually clean: the two known
 * runaways sit at 0.22% and 0.97% unique words, while the lowest legitimate entry of the 728 with
 * substantial OCR is 16.3% and the median is 74%. Anything under this threshold is not text.
 */
const MIN_UNIQUE_WORD_RATIO = 0.1;
const MIN_WORDS_TO_JUDGE = 100;

export function isDegenerateText(text: string): boolean {
	const words = text.split(/\s+/).filter(Boolean);
	if (words.length < MIN_WORDS_TO_JUDGE) return false;
	return new Set(words).size / words.length < MIN_UNIQUE_WORD_RATIO;
}

/**
 * Bounded first, then judged. When the judgement fires the whole field goes, including any genuine
 * text the run opened with: the signal is a property of the sample, so a phrase repeated 4,300
 * times only reads as degenerate across the whole of it, and a window small enough to isolate the
 * good opening is too small to tell repetition from dense prose. That costs about a thousand
 * characters of real OCR on the one block where it bites, which still keeps its description and
 * its tags — a cheaper price than leaving repeated phrases to skew BM25 term frequency.
 */
export function clampOcr(ocr: string): string {
	const clamped = ocr.length > MAX_OCR_CHARS ? ocr.slice(0, MAX_OCR_CHARS).trimEnd() : ocr;
	return isDegenerateText(clamped) ? '' : clamped;
}

const normalizeText = (value: string | null | undefined) =>
	value?.replace(/\s+/g, ' ').trim() ?? '';

/**
 * Lowercased, dehyphenated and deduplicated, so one concept is one tag. The model is inconsistent
 * about both: 162 blocks carry `ui` against an intermittent `UI`, and 153 pairs differ only by a
 * hyphen — `web-design` (26) against `web design` (549), `dark-mode` (20) against `dark mode`
 * (237). The split is not cosmetic. It cost `semantic-material` nine rank positions, because that
 * block's `design-engineer` occurs exactly once in the archive while every block above it was
 * tagged in the spacing the query used.
 *
 * Hyphens go in the attribute as well as in `search_text`, not just the text: a facet that filters
 * on a value the index never wrote is worse than one whose values read slightly oddly, and this
 * way the filter and the indexed wording cannot disagree. The cost is that genuine compounds are
 * respelled — `e-commerce` becomes `e commerce`, `sans-serif` becomes `sans serif` — which affects
 * 158 instances against the 332 the merge repairs.
 *
 * Sorted, so an unchanged block re-upserts identically.
 */
const normalizeTags = (tags: readonly string[] | null | undefined): string[] =>
	[
		...new Set(
			(tags ?? [])
				.map((tag) => normalizeText(tag.replace(/-+/g, ' ')).toLowerCase())
				.filter(Boolean)
		)
	].sort();

/**
 * `vision` is the generated description for this block, when one exists. It is appended to
 * `search_text` after the block's own metadata so a block that already describes itself keeps
 * leading the corpus, and omitted entirely when absent.
 *
 * `colours` are the block's measured colour weights. A block without them, including every block
 * without an image, weighs zero in every colour and so never matches a colour filter.
 *
 * `totalConnections` is Are.na's count of every connection to the block. It is never recorded
 * below the maintainer's own channels, which are a subset of it: that keeps a block whose count
 * failed, or went stale before it was connected again, ordered by what is known to be true.
 */
export function toSearchDocument(
	block: ArchiveBlock,
	vision?: BlockVisionText | null,
	colours?: BlockColourWeights | null,
	totalConnections?: number | null
): SearchDocument {
	const channels = [...new Map(block.channels.map((channel) => [channel.slug, channel])).values()];
	const searchText = [
		block.title,
		block.description,
		block.content,
		block.sourceTitle,
		...channels.map((channel) => channel.title),
		vision?.description,
		clampOcr(vision?.ocr ?? ''),
		// Last, and short. Measured over a 596-block sample: 53% of tag wording appears nowhere else
		// in the block's indexed text and 99% of blocks gain some, for 10% more text — but eight
		// words should still not outweigh a block that describes itself.
		normalizeTags(vision?.tags).join(', ')
	]
		.map(normalizeText)
		.filter(Boolean)
		.join('\n');

	return {
		id: `block:${block.id}`,
		search_text: searchText,
		block_type: block.type,
		kind: blockKind(block),
		channel_slugs: channels.map((channel) => channel.slug).sort(),
		connection_count: channels.length,
		total_connection_count: Math.max(totalConnections ?? 0, channels.length),
		connected_at: block.connectedAt?.toISOString() ?? null,
		created_at: block.createdAt?.toISOString() ?? null,
		title: normalizeText(block.title) || null,
		description: normalizeText(block.description) || null,
		source_url: block.sourceUrl ?? null,
		arena_url: block.arenaUrl,
		image_url: block.imageUrl ?? null,
		image_alt: normalizeText(block.imageAlt) || null,
		image_width: block.imageWidth ?? null,
		image_height: block.imageHeight ?? null,
		video_url: block.videoUrl ?? null,
		video_content_type: block.videoContentType ?? null,
		source_title: normalizeText(block.sourceTitle) || null,
		vision_title: normalizeText(vision?.title) || null,
		vision_description: normalizeText(vision?.description) || null,
		vision_ocr: normalizeText(clampOcr(vision?.ocr ?? '')) || null,
		vision_medium: normalizeText(vision?.medium) || null,
		vision_tags: normalizeTags(vision?.tags),
		...colourAttributes(colours)
	};
}

export function isAnimatedImage(contentType: string | null | undefined): boolean {
	return contentType?.toLowerCase().trim() === 'image/gif';
}

const ARENA_TYPE_KINDS: Record<string, ArchiveBlockType> = {
	Image: 'Image',
	Link: 'Web',
	Text: 'Text',
	Attachment: 'Attachment',
	Embed: 'Embed'
};

/**
 * A playable file makes a block a Video and a GIF image makes it a GIF, whichever Are.na block
 * holds them; otherwise Are.na's type decides, with a Link called Web. Null for a type the gallery
 * does not filter by.
 */
export function blockKind(
	block: Pick<ArchiveBlock, 'type' | 'videoUrl' | 'imageContentType'>
): ArchiveBlockType | null {
	if (block.videoUrl) return 'Video';
	if (isAnimatedImage(block.imageContentType) && block.type !== 'Link') return 'GIF';
	return ARENA_TYPE_KINDS[block.type] ?? null;
}

function colourAttributes(colours: BlockColourWeights | null | undefined) {
	return Object.fromEntries(
		ARCHIVE_COLOURS.map((colour) => [colourAttribute(colour), colours?.[colour] ?? 0])
	) as Record<ColourAttribute, number>;
}
