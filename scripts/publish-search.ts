import type { SearchDocument } from '$lib/domain/archive';
import type { ChannelManifestEntry } from '$lib/domain/search';
import { publishSearchRelease } from './search-files';
import { configuredEmbedder, localEmbeddingCache, searchOutput } from './maintenance-files';
import { buildChannelManifest } from '$lib/server/indexing/channel-manifest';
import { buildSearchRelease } from '$lib/server/search/release-builder';

export async function prepareArchiveSearch(
	documents: SearchDocument[],
	channels: ChannelManifestEntry[],
	signal: AbortSignal
) {
	const { entries, checkpoint } = await localEmbeddingCache();
	const embed = configuredEmbedder();
	return buildSearchRelease(
		documents,
		buildChannelManifest(channels),
		async (texts) => {
			signal.throwIfAborted();
			return embed(texts);
		},
		entries,
		checkpoint
	);
}

export async function publishArchiveSearch(
	documents: SearchDocument[],
	channels: ChannelManifestEntry[],
	signal: AbortSignal
) {
	console.log(`Embedding ${documents.length} public blocks; unchanged chunks use the local cache`);
	const { release, assets } = await prepareArchiveSearch(documents, channels, signal);
	signal.throwIfAborted();
	await publishSearchRelease(searchOutput, release, assets);
	console.log(
		`Exported ${release.blockCount} blocks, ${release.vectorCount} vectors in ${release.vectors.length} shards`
	);
	console.log(`Release: ${release.version}. Search assets and embedding cache are gitignored.`);
}
