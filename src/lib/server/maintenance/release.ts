import MiniSearch from 'minisearch';
import { ARCHIVE_RESULT_LIMIT } from '$lib/domain/search';
import { ArchiveSearchEngine, compareBrowse, lexicalOptions } from '$lib/search/core';
import { decodeVectors } from '$lib/search/assets';
import { parseArchiveSearchRequest } from '$lib/search/request';
import {
	bootstrapSchema,
	metadataSchema,
	releaseSchema,
	validateMetadata,
	type SearchRelease,
	type SnapshotAsset
} from '$lib/search/snapshot';
import { validateLexical } from './lexical';
import { sha256 } from '$lib/server/search/release-builder';

export function releaseAssets(release: SearchRelease): SnapshotAsset[] {
	return [release.metadata, release.lexical, release.bootstrap, ...release.vectors];
}

export async function releaseVersion(release: SearchRelease): Promise<string> {
	const descriptor = ({ file, bytes, sha256 }: SnapshotAsset) => ({ file, bytes, sha256 });
	const {
		embeddingVersion,
		dimensions,
		blockCount,
		vectorCount,
		metadata,
		lexical,
		vectors,
		bootstrap
	} = release;
	return sha256(
		new TextEncoder().encode(
			JSON.stringify({
				embeddingVersion,
				dimensions,
				blockCount,
				vectorCount,
				metadata: descriptor(metadata),
				lexical: descriptor(lexical),
				vectors: vectors.map(descriptor),
				bootstrap: descriptor(bootstrap)
			})
		)
	);
}

export async function loadValidatedRelease(
	manifest: unknown,
	read: (asset: SnapshotAsset) => Promise<Uint8Array>
) {
	const release = releaseSchema.parse(manifest);
	if ((await releaseVersion(release)) !== release.version)
		throw new Error('Release descriptor hash mismatch');
	const descriptors = releaseAssets(release);
	if (new Set(descriptors.map(({ file }) => file)).size !== descriptors.length)
		throw new Error('Duplicate release asset names');
	const assets = new Map<string, Uint8Array>();
	for (const asset of descriptors) {
		const bytes = await read(asset);
		if (bytes.byteLength !== asset.bytes || (await sha256(bytes)) !== asset.sha256)
			throw new Error(`Release asset integrity failed: ${asset.file}`);
		assets.set(asset.file, bytes);
	}
	const json = (file: string): unknown => JSON.parse(new TextDecoder().decode(assets.get(file)!));
	const metadata = metadataSchema.parse(json(release.metadata.file));
	validateMetadata(release, metadata);
	if (metadata.documents.some(({ result }) => !result.channelSlugs.length))
		throw new Error('Document has no channel membership');
	const lexical = MiniSearch.loadJSON(
		JSON.stringify(validateLexical(json(release.lexical.file))),
		lexicalOptions
	);
	if (
		lexical.documentCount !== release.blockCount ||
		metadata.documents.some(({ result }) => !lexical.has(result.id))
	)
		throw new Error('Lexical IDs do not match metadata');
	const engine = new ArchiveSearchEngine(metadata.documents, lexical, metadata.vectorBlocks);
	const vectors = new Float32Array(release.vectorCount * release.dimensions);
	let offset = 0;
	for (const asset of release.vectors) {
		const shard = decodeVectors(new Uint8Array(assets.get(asset.file)!).buffer);
		if (offset + shard.length > vectors.length) throw new Error('Excess vector data');
		vectors.set(shard, offset);
		offset += shard.length;
	}
	if (offset !== vectors.length) throw new Error('Incomplete vector matrix');
	engine.setVectors(vectors);
	const bootstrap = bootstrapSchema.parse(json(release.bootstrap.file));
	const input = parseArchiveSearchRequest(new URLSearchParams());
	const expected = [...metadata.documents]
		.sort((a, b) => compareBrowse(a, b, input))
		.slice(0, ARCHIVE_RESULT_LIMIT)
		.map(({ result }) => result);
	if (
		bootstrap.blockCount !== release.blockCount ||
		bootstrap.hasMore !== release.blockCount > ARCHIVE_RESULT_LIMIT ||
		JSON.stringify(bootstrap.channels) !== JSON.stringify(metadata.channels) ||
		JSON.stringify(bootstrap.results) !== JSON.stringify(expected)
	)
		throw new Error('Bootstrap does not match default browse');
	return { release, assets, metadata, engine };
}

export type ValidatedRelease = Awaited<ReturnType<typeof loadValidatedRelease>>;
