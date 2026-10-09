import { publishSearchRelease } from './search-files';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { syncArchive } from '$lib/server/indexing/sync';
import { parseSlugList } from '$lib/server/indexing/channel-filter';
import { buildChannelManifest } from '$lib/server/indexing/channel-manifest';
import { parseVisionCache } from '$lib/server/indexing/vision/cache';
import { parseColourCache } from '$lib/server/indexing/colour/cache';
import { parseConnectionCache } from '$lib/server/indexing/connections/cache';
import { createCloudflareEmbedder } from '$lib/server/search/export';
import { buildSearchRelease } from '$lib/server/search/release-builder';
import { EMBEDDING, embeddingVectorSchema } from '$lib/search/embedding';

async function main() {
	if (process.argv.length > 2)
		throw new Error(
			'export:search takes no arguments; it always exports public channels without vision or write-back'
		);
	const credentials = z
		.object({
			ARENA_ACCESS_TOKEN: z.string().min(1),
			CLOUDFLARE_ACCOUNT_ID: z.string().regex(/^[a-f0-9]{32}$/i),
			CLOUDFLARE_API_TOKEN: z.string().min(1)
		})
		.safeParse(process.env);
	if (!credentials.success)
		throw new Error(
			'Set ARENA_ACCESS_TOKEN, CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN in .env before exporting'
		);
	const indexing = new URL('../src/lib/server/indexing/', import.meta.url);
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
	const abort = new AbortController();
	for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => abort.abort());
	const { documents, channels } = await syncArchive({
		accessToken: credentials.data.ARENA_ACCESS_TOKEN,
		output: 'export',
		signal: abort.signal,
		visionCache: parseVisionCache(await readFile(new URL('vision-cache.jsonl', indexing), 'utf8')),
		colourCache: parseColourCache(await readFile(new URL('colour-cache.jsonl', indexing), 'utf8')),
		connectionCache: parseConnectionCache(
			await readFile(new URL('connections-cache.jsonl', indexing), 'utf8')
		),
		channelFilter: {
			ignore: parseSlugList(process.env.ARENA_IGNORE_CHANNELS),
			allowPrivate: new Set()
		},
		log: (message) => console.log(message)
	});
	console.log(`Embedding ${documents.length} public blocks; unchanged chunks use the local cache`);
	const embed = createCloudflareEmbedder({
		accountId: credentials.data.CLOUDFLARE_ACCOUNT_ID,
		apiToken: credentials.data.CLOUDFLARE_API_TOKEN
	});
	const { release, assets } = await buildSearchRelease(
		documents,
		buildChannelManifest(channels),
		async (texts) => {
			abort.signal.throwIfAborted();
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
	abort.signal.throwIfAborted();
	await publishSearchRelease(output, release, assets);
	console.log(
		`Exported ${release.blockCount} blocks, ${release.vectorCount} vectors in ${release.vectors.length} shards`
	);
	console.log(
		`Release: ${release.version}. No Are.na or Turbopuffer writes; search assets and embedding cache are gitignored.`
	);
}

await main().catch((error: unknown) => {
	console.error(
		`Public search export failed (${error instanceof Error ? error.name : 'unknown error'}). Existing release is unchanged; check network access and configuration.`
	);
	process.exitCode = 1;
});
