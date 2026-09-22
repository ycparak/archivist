import { z } from 'zod';

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

export type SearchDocument = {
	id: string;
	search_text: string;
	block_type: string;
	channel_slugs: string[];
	connection_count: number;
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
};

const normalizeText = (value: string | null | undefined) =>
	value?.replace(/\s+/g, ' ').trim() ?? '';

/**
 * Lowercased and deduplicated so a facet treats `UI` and `ui` as one value — 162 blocks carry the
 * lowercase form and the model capitalizes it intermittently. Sorted so an unchanged block
 * re-upserts identically.
 */
const normalizeTags = (tags: readonly string[] | null | undefined): string[] =>
	[...new Set((tags ?? []).map((tag) => normalizeText(tag).toLowerCase()).filter(Boolean))].sort();

/**
 * `vision` is the generated description for this block, when one exists. It is appended to
 * `search_text` after the block's own metadata so a block that already describes itself keeps
 * leading the corpus, and omitted entirely when absent.
 */
export function toSearchDocument(
	block: ArchiveBlock,
	vision?: BlockVisionText | null
): SearchDocument {
	const channels = [...new Map(block.channels.map((channel) => [channel.slug, channel])).values()];
	const searchText = [
		block.title,
		block.description,
		block.content,
		block.sourceTitle,
		...channels.map((channel) => channel.title),
		vision?.description,
		vision?.ocr,
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
		channel_slugs: channels.map((channel) => channel.slug).sort(),
		connection_count: channels.length,
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
		vision_ocr: normalizeText(vision?.ocr) || null,
		vision_medium: normalizeText(vision?.medium) || null,
		vision_tags: normalizeTags(vision?.tags)
	};
}
