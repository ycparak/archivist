import { z } from 'zod';

export const blockTypeSchema = z.string().trim().min(1);

export const ARCHIVE_BLOCK_TYPES = ['Image', 'Link', 'Text', 'Attachment', 'Embed'] as const;

export type ArchiveBlockType = (typeof ARCHIVE_BLOCK_TYPES)[number];

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

export type SearchDocument = {
	id: string;
	search_text: string;
	block_type: string;
	channel_slugs: string[];
	connected_at: string | null;
	created_at: string | null;
	title: string | null;
	description: string | null;
	source_url: string | null;
	arena_url: string;
	image_url: string | null;
	source_title: string | null;
};

const normalizeText = (value: string | null | undefined) =>
	value?.replace(/\s+/g, ' ').trim() ?? '';

export function toSearchDocument(block: ArchiveBlock): SearchDocument {
	const channels = [...new Map(block.channels.map((channel) => [channel.slug, channel])).values()];
	const searchText = [
		block.title,
		block.description,
		block.content,
		block.sourceTitle,
		...channels.map((channel) => channel.title)
	]
		.map(normalizeText)
		.filter(Boolean)
		.join('\n');

	return {
		id: `block:${block.id}`,
		search_text: searchText,
		block_type: block.type,
		channel_slugs: channels.map((channel) => channel.slug).sort(),
		connected_at: block.connectedAt?.toISOString() ?? null,
		created_at: block.createdAt?.toISOString() ?? null,
		title: normalizeText(block.title) || null,
		description: normalizeText(block.description) || null,
		source_url: block.sourceUrl ?? null,
		arena_url: block.arenaUrl,
		image_url: block.imageUrl ?? null,
		source_title: normalizeText(block.sourceTitle) || null
	};
}
