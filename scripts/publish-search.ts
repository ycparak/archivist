import type { SearchDocument } from '$lib/domain/archive';
import type { ChannelManifestEntry } from '$lib/domain/search';
import { publishSearchRelease } from './search-files';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { buildChannelManifest } from '$lib/server/indexing/channel-manifest';
import { createCloudflareEmbedder } from '$lib/server/search/export';
import { buildSearchRelease } from '$lib/server/search/release-builder';
import { EMBEDDING, embeddingVectorSchema } from '$lib/search/embedding';

export async function publishArchiveSearch(
	documents: SearchDocument[],
	channels: ChannelManifestEntry[],
	signal: AbortSignal
) {
	const credentials = z
		.object({
			CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/i),
			CLOUDFLARE_API_TOKEN: z.string().min(1)
		})
		.parse(process.env);
	const output = new URL('../static/search/', import.meta.url);
	const cacheDirectory = new URL('../.search-cache/', import.meta.url);
	await mkdir(cacheDirectory, { recursive: true });
	const cacheFile = new URL(`${EMBEDDING.version}.json`, cacheDirectory);
	const cacheSchema = z.record(z.string().regex(/^[a-f0-9]{64}$/), embeddingVectorSchema);
	async function optionalRead(url: URL): Promise<string | undefined> {
		try {
			return await readFile(url, 'utf8');
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
			throw error;
		}
	}
	const cached = await optionalRead(cacheFile);
	const cache = new Map(Object.entries(cached ? cacheSchema.parse(JSON.parse(cached)) : {}));
	console.log(`Embedding ${documents.length} public blocks; unchanged chunks use the local cache`);
	const embed = createCloudflareEmbedder({
		accountId: credentials.CLOUDFLARE_ACCOUNT_ID,
		apiToken: credentials.CLOUDFLARE_API_TOKEN
	});
	const { release, assets } = await buildSearchRelease(
		documents,
		buildChannelManifest(channels),
		async (texts) => {
			signal.throwIfAborted();
			return embed(texts);
		},
		cache,
		async (entries) => {
			await writeFile(
				new URL('checkpoint.tmp', cacheDirectory),
				JSON.stringify(Object.fromEntries(entries))
			);
			await rename(new URL('checkpoint.tmp', cacheDirectory), cacheFile);
		}
	);
	signal.throwIfAborted();
	await publishSearchRelease(output, release, assets);
	console.log(
		`Exported ${release.blockCount} blocks, ${release.vectorCount} vectors in ${release.vectors.length} shards`
	);
	console.log(`Release: ${release.version}. Search assets and embedding cache are gitignored.`);
}
