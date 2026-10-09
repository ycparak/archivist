import { z } from 'zod';
import type { SearchDocument } from '$lib/domain/archive';
import {
	ARCHIVE_COLOURS,
	ARCHIVE_RESULT_LIMIT,
	type ChannelManifestEntry
} from '$lib/domain/search';
import { publicDocumentSchema, type PublicDocument } from '$lib/search/snapshot';
import { normalizeVector, embeddingResponseSchema, EMBEDDING } from '$lib/search/embedding';

export function toPublicDocument(document: SearchDocument): PublicDocument {
	return publicDocumentSchema.parse({
		result: {
			id: document.id,
			title: document.title,
			description: document.description,
			blockType: document.block_type,
			channelSlugs: document.channel_slugs,
			connectedAt: document.connected_at,
			sourceUrl: document.source_url,
			arenaUrl: document.arena_url,
			imageUrl: document.image_url,
			imageAlt: document.image_alt,
			imageWidth: document.image_width,
			imageHeight: document.image_height,
			videoUrl: document.video_url,
			videoContentType: document.video_content_type,
			sourceTitle: document.source_title
		},
		kind: document.kind,
		createdAt: document.created_at,
		connectionCount: document.connection_count,
		totalConnectionCount: document.total_connection_count,
		colours: Object.fromEntries(
			ARCHIVE_COLOURS.map((colour) => [colour, document[`colour_${colour}`]])
		)
	});
}

// BERT WordPiece cannot emit more tokens than input UTF-8 bytes; leave room for special tokens.
export const EMBEDDING_CHUNK_BYTES = 384;
export function embeddingChunks(text: string): string[] {
	const encoder = new TextEncoder();
	const chunks: string[] = [];
	let chunk = '';
	let bytes = 0;
	for (const word of text.split(/(?<=\s)/u)) {
		const wordBytes = encoder.encode(word).length;
		if (bytes && bytes + wordBytes > EMBEDDING_CHUNK_BYTES) {
			if (chunk.trim()) chunks.push(chunk.trim());
			chunk = '';
			bytes = 0;
		}
		for (const character of word) {
			const size = encoder.encode(character).length;
			if (bytes + size > EMBEDDING_CHUNK_BYTES) {
				if (chunk.trim()) chunks.push(chunk.trim());
				chunk = '';
				bytes = 0;
			}
			chunk += character;
			bytes += size;
		}
	}
	if (chunk.trim()) chunks.push(chunk.trim());
	return chunks.length ? chunks : ['Untitled block'];
}

export function assertPublicExport(
	documents: readonly SearchDocument[],
	channels: readonly ChannelManifestEntry[]
): void {
	if (!documents.length || !channels.length) throw new Error('Cannot export an empty archive');
	if (new Set(documents.map((document) => document.id)).size !== documents.length)
		throw new Error('Duplicate document IDs');
	const slugs = new Set(channels.map((channel) => channel.slug));
	if (
		slugs.size !== channels.length ||
		documents.some(
			(document) =>
				!document.channel_slugs.length || document.channel_slugs.some((slug) => !slugs.has(slug))
		)
	)
		throw new Error('Export channel membership mismatch');
}

const credentialsSchema = z.object({
	accountId: z.string().regex(/^[a-f0-9]{32}$/i),
	apiToken: z.string().trim().min(1)
});
export function createCloudflareEmbedder(
	credentials: { accountId: string; apiToken: string },
	fetchFn: typeof fetch = fetch
) {
	const { accountId, apiToken } = credentialsSchema.parse(credentials);
	return async (texts: string[]): Promise<number[][]> => {
		const response = await fetchFn(
			`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${EMBEDDING.model}`,
			{
				method: 'POST',
				headers: { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' },
				body: JSON.stringify({ text: texts }),
				signal: AbortSignal.timeout(60_000)
			}
		);
		if (!response.ok) throw new Error(`Embedding request failed (${response.status})`);
		const envelope = z
			.object({ success: z.literal(true), result: embeddingResponseSchema })
			.parse(await response.json());
		if (envelope.result.data.length !== texts.length)
			throw new Error('Embedding batch count mismatch');
		return envelope.result.data.map(normalizeVector);
	};
}

export { ARCHIVE_RESULT_LIMIT };
