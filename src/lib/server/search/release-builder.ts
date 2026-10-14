import MiniSearch from 'minisearch';
import type { SearchDocument } from '$lib/domain/archive';
import { ARCHIVE_RESULT_LIMIT, type ChannelManifestEntry } from '$lib/domain/search';
import { lexicalOptions, compareBrowse } from '$lib/search/core';
import { parseArchiveSearchRequest } from '$lib/search/request';
import { EMBEDDING, normalizeVector } from '$lib/search/embedding';
import {
	metadataSchema,
	releaseSchema,
	validateMetadata,
	type SnapshotAsset
} from '$lib/search/snapshot';
import { assertPublicExport, embeddingChunks, toPublicDocument } from './export';

export async function sha256(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes));
	return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function buildSearchRelease(
	documents: SearchDocument[],
	channels: ChannelManifestEntry[],
	embed: (texts: string[]) => Promise<number[][]>,
	cache = new Map<string, number[]>(),
	checkpoint: (cache: Map<string, number[]>) => Promise<void> = async () => {},
	/** Experiments only; published releases use the default chunk size their version implies. */
	options: { chunkBytes?: number } = {}
) {
	assertPublicExport(documents, channels);
	const encoder = new TextEncoder();
	const sorted = [...documents].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	const publicDocuments = sorted.map(toPublicDocument);
	const vectorBlocks: number[] = [];
	const chunkKeys: string[] = [];
	const missing = new Map<string, string>();
	for (const [index, document] of sorted.entries()) {
		for (const chunk of embeddingChunks(document.search_text, options.chunkBytes)) {
			const key = await sha256(encoder.encode(`${EMBEDDING.version}\n${chunk}`));
			vectorBlocks.push(index);
			chunkKeys.push(key);
			if (!cache.has(key)) missing.set(key, chunk);
		}
	}
	const entries = [...missing];
	for (let offset = 0; offset < entries.length; offset += 32) {
		const batch = entries.slice(offset, offset + 32);
		const vectors = await embed(batch.map(([, text]) => text));
		if (vectors.length !== batch.length) throw new Error('Embedding batch count mismatch');
		for (const [index, [key]] of batch.entries()) cache.set(key, normalizeVector(vectors[index]));
		await checkpoint(cache);
	}
	const assets = new Map<string, Uint8Array>();
	async function asset(file: string, bytes: Uint8Array): Promise<SnapshotAsset> {
		const result = { file, bytes: bytes.byteLength, sha256: await sha256(bytes) };
		if (bytes.byteLength > 25 * 1024 * 1024) throw new Error(`Asset too large: ${file}`);
		assets.set(file, bytes);
		return result;
	}
	const metadata = metadataSchema.parse({ documents: publicDocuments, channels, vectorBlocks });
	const metadataAsset = await asset('metadata.json', encoder.encode(JSON.stringify(metadata)));
	const lexical = new MiniSearch(lexicalOptions);
	lexical.addAll(sorted.map(({ id, search_text }) => ({ id, search_text })));
	const lexicalAsset = await asset('lexical.json', encoder.encode(JSON.stringify(lexical)));
	const vectors: SnapshotAsset[] = [];
	const rowsPerShard = Math.floor((8 * 1024 * 1024) / (EMBEDDING.dimensions * 4));
	for (let row = 0; row < chunkKeys.length; row += rowsPerShard) {
		const keys = chunkKeys.slice(row, row + rowsPerShard);
		const bytes = new Uint8Array(keys.length * EMBEDDING.dimensions * 4);
		const view = new DataView(bytes.buffer);
		for (const [index, key] of keys.entries()) {
			const vector = normalizeVector(cache.get(key)!);
			for (let dimension = 0; dimension < EMBEDDING.dimensions; dimension++)
				view.setFloat32((index * EMBEDDING.dimensions + dimension) * 4, vector[dimension], true);
		}
		vectors.push(await asset(`vectors-${vectors.length}.f32`, bytes));
	}
	const browse = [...publicDocuments].sort((a, b) =>
		compareBrowse(a, b, parseArchiveSearchRequest(new URLSearchParams()))
	);
	const bootstrapAsset = await asset(
		'bootstrap.json',
		encoder.encode(
			JSON.stringify({
				results: browse.slice(0, ARCHIVE_RESULT_LIMIT).map((document) => document.result),
				hasMore: browse.length > ARCHIVE_RESULT_LIMIT,
				channels,
				blockCount: sorted.length
			})
		)
	);
	const descriptor = {
		embeddingVersion: EMBEDDING.version,
		dimensions: EMBEDDING.dimensions,
		blockCount: sorted.length,
		vectorCount: chunkKeys.length,
		metadata: metadataAsset,
		lexical: lexicalAsset,
		vectors,
		bootstrap: bootstrapAsset
	};
	const version = await sha256(encoder.encode(JSON.stringify(descriptor)));
	const release = releaseSchema.parse({ version, ...descriptor });
	validateMetadata(release, metadata);
	return { release, assets };
}
