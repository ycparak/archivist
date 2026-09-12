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
