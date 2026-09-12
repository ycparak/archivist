import type { ArchiveBlock } from '$lib/domain/archive';
import type { ArenaBlockItem } from '$lib/server/arena/schemas';

export interface ChannelContext {
	slug: string;
	title: string;
}

interface TypeSpecificFields {
	title: string | null;
	content: string | null;
	imageUrl: string | null;
}

/**
 * Fields that differ per Are.na block type. `title` falls back to the type's own title-shaped
 * field (Embed's oEmbed title, an Attachment's filename) when the block-level `title` is empty —
 * without it, an untitled upload/embed would carry no searchable title text at all even though
 * Are.na supplied one under a different key.
 */
function extractTypeSpecificFields(item: ArenaBlockItem): TypeSpecificFields {
	switch (item.type) {
		case 'Text':
			return { title: item.title ?? null, content: item.content.plain, imageUrl: null };
		case 'Image':
			return { title: item.title ?? null, content: null, imageUrl: item.image.large.src };
		case 'Link':
			return {
				title: item.title ?? null,
				content: item.content?.plain ?? null,
				imageUrl: item.image?.large.src ?? null
			};
		case 'Attachment':
			return {
				title: item.title ?? item.attachment.filename ?? null,
				content: null,
				imageUrl: item.image?.large.src ?? null
			};
		case 'Embed':
			return {
				title: item.title ?? item.embed.title ?? null,
				content: null,
				imageUrl: item.image?.large.src ?? null
			};
		default:
			return item satisfies never;
	}
}

/**
 * Converts one occurrence of an Are.na block, seen while syncing one channel, into the domain
 * `ArchiveBlock` shape `toSearchDocument` consumes. A block seen in multiple channels is
 * normalized once per occurrence; unioning its `channels` across those occurrences is
 * sync-orchestration's job, not this function's.
 */
export function toArchiveBlock(item: ArenaBlockItem, channel: ChannelContext): ArchiveBlock {
	const { title, content, imageUrl } = extractTypeSpecificFields(item);

	return {
		id: String(item.id),
		type: item.type,
		title,
		content,
		imageUrl,
		description: item.description?.plain ?? null,
		sourceTitle: item.source?.title ?? null,
		sourceUrl: item.source?.url ?? null,
		arenaUrl: `https://www.are.na/block/${item.id}`,
		createdAt: item.created_at,
		connectedAt: item.connection.connected_at,
		channels: [channel]
	};
}
