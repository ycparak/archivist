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
	imageAlt: string | null;
	imageWidth: number | null;
	imageHeight: number | null;
	imageBytes: number | null;
	imageContentType: string | null;
}

interface BlockImageLike {
	alt_text?: string | null;
	file_size?: number | null;
	content_type?: string | null;
	large: { width?: number | null; height?: number | null };
}

/** Dimensions of `large`, not the top-level `image`, since that's the version whose `src` is used. */
function imageFields(image: BlockImageLike | null | undefined) {
	return {
		imageAlt: image?.alt_text ?? null,
		imageWidth: image?.large.width ?? null,
		imageHeight: image?.large.height ?? null,
		imageBytes: image?.file_size ?? null,
		imageContentType: image?.content_type ?? null
	};
}

function extractTypeSpecificFields(item: ArenaBlockItem): TypeSpecificFields {
	switch (item.type) {
		case 'Text':
			return {
				title: item.title ?? null,
				content: item.content.plain,
				imageUrl: null,
				...imageFields(null)
			};
		case 'Image':
			return {
				title: item.title ?? null,
				content: null,
				imageUrl: item.image.large.src,
				...imageFields(item.image)
			};
		case 'Link':
			return {
				title: item.title ?? null,
				content: item.content?.plain ?? null,
				imageUrl: item.image?.large.src ?? null,
				...imageFields(item.image)
			};
		case 'Attachment':
			return {
				title: item.title ?? item.attachment.filename ?? null,
				content: null,
				imageUrl: item.image?.large.src ?? null,
				...imageFields(item.image)
			};
		case 'Embed':
			return {
				title: item.title ?? item.embed.title ?? null,
				content: null,
				imageUrl: item.image?.large.src ?? null,
				...imageFields(item.image)
			};
		default:
			return item satisfies never;
	}
}

export function toArchiveBlock(item: ArenaBlockItem, channel: ChannelContext): ArchiveBlock {
	const {
		title,
		content,
		imageUrl,
		imageAlt,
		imageWidth,
		imageHeight,
		imageBytes,
		imageContentType
	} = extractTypeSpecificFields(item);

	return {
		id: String(item.id),
		type: item.type,
		title,
		content,
		imageUrl,
		imageAlt,
		imageWidth,
		imageHeight,
		imageBytes,
		imageContentType,
		ownerId: item.user?.id ?? null,
		description: item.description?.plain ?? null,
		sourceTitle: item.source?.title ?? null,
		sourceUrl: item.source?.url ?? null,
		arenaUrl: `https://www.are.na/block/${item.id}`,
		createdAt: item.created_at,
		connectedAt: item.connection.connected_at,
		channels: [channel]
	};
}
