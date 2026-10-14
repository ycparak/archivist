import { z } from 'zod';
import { ARCHIVE_BLOCK_TYPES, ARCHIVE_COLOURS } from '$lib/domain/search';
import { searchResultSchema } from './contracts';
import { EMBEDDING } from './embedding';

export const publicDocumentSchema = z.object({
	result: searchResultSchema,
	kind: z.enum(ARCHIVE_BLOCK_TYPES).nullable(),
	createdAt: z.iso.datetime().nullable(),
	connectionCount: z.number().int().nonnegative(),
	totalConnectionCount: z.number().int().nonnegative(),
	colours: z.record(z.enum(ARCHIVE_COLOURS), z.number().int().min(0).max(1000))
});
export type PublicDocument = z.infer<typeof publicDocumentSchema>;

const assetSchema = z.object({
	file: z.string().regex(/^[a-z0-9-]+\.(json|f32)$/),
	sha256: z.string().regex(/^[a-f0-9]{64}$/),
	bytes: z
		.number()
		.int()
		.positive()
		.max(25 * 1024 * 1024)
});
export type SnapshotAsset = z.infer<typeof assetSchema>;
export const releaseSchema = z.object({
	version: z.string().regex(/^[a-f0-9]{64}$/),
	embeddingVersion: z.literal(EMBEDDING.version),
	dimensions: z.literal(EMBEDDING.dimensions),
	blockCount: z.number().int().positive(),
	vectorCount: z.number().int().positive(),
	metadata: assetSchema,
	lexical: assetSchema,
	vectors: z.array(assetSchema).min(1),
	bootstrap: assetSchema
});
export type SearchRelease = z.infer<typeof releaseSchema>;
export const metadataSchema = z.object({
	documents: z.array(publicDocumentSchema),
	channels: z.array(z.object({ slug: z.string().min(1), title: z.string().min(1) })),
	vectorBlocks: z.array(z.number().int().nonnegative())
});
type SearchMetadata = z.infer<typeof metadataSchema>;
export const bootstrapSchema = z.object({
	results: z.array(searchResultSchema),
	hasMore: z.boolean(),
	channels: metadataSchema.shape.channels,
	blockCount: z.number().int().positive()
});

export function validateMetadata(release: SearchRelease, metadata: SearchMetadata): void {
	const ids = new Set(metadata.documents.map((document) => document.result.id));
	if (metadata.documents.length !== release.blockCount || ids.size !== release.blockCount) {
		throw new Error('Snapshot document count or IDs do not match');
	}
	if (metadata.vectorBlocks.length !== release.vectorCount)
		throw new Error('Vector count mismatch');
	if (metadata.vectorBlocks.some((index) => index >= release.blockCount)) {
		throw new Error('Vector refers to an unknown document');
	}
	if (new Set(metadata.vectorBlocks).size !== release.blockCount) {
		throw new Error('Some documents have no embedding');
	}
	const channels = new Set(metadata.channels.map((channel) => channel.slug));
	if (
		channels.size !== metadata.channels.length ||
		metadata.documents.some((document) =>
			document.result.channelSlugs.some((slug) => !channels.has(slug))
		)
	) {
		throw new Error('Snapshot channel membership does not match');
	}
}
