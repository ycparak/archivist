import { readFile } from 'node:fs/promises';
import MiniSearch from 'minisearch';
import { ArchiveSearchEngine, lexicalOptions } from '$lib/search/core';
import { checkedAsset, decodeVectors } from '$lib/search/assets';
import { metadataSchema, releaseSchema, validateMetadata } from '$lib/search/snapshot';
import { EMBEDDING } from '$lib/search/embedding';
import { createCloudflareEmbedder } from '$lib/server/search/export';
import type { SearchRepository } from '$lib/search/contracts';

export async function createBrowserEvaluationRepository(): Promise<SearchRepository> {
	const root = new URL('../static/', import.meta.url);
	const release = releaseSchema.parse(
		JSON.parse(await readFile(new URL('search/manifest.json', root), 'utf8'))
	);
	const localFetch: typeof fetch = async (input) => {
		const path =
			typeof input === 'string'
				? input
				: input instanceof URL
					? input.pathname
					: new URL(input.url).pathname;
		return new Response(new Uint8Array(await readFile(new URL(path.replace(/^\//, ''), root))));
	};
	const metadata = metadataSchema.parse(
		JSON.parse(new TextDecoder().decode(await checkedAsset(release, release.metadata, localFetch)))
	);
	validateMetadata(release, metadata);
	const lexical = MiniSearch.loadJSON(
		new TextDecoder().decode(await checkedAsset(release, release.lexical, localFetch)),
		lexicalOptions
	);
	const engine = new ArchiveSearchEngine(metadata.documents, lexical, metadata.vectorBlocks);
	const values = new Float32Array(release.vectorCount * EMBEDDING.dimensions);
	let offset = 0;
	for (const asset of release.vectors) {
		const shard = decodeVectors(await checkedAsset(release, asset, localFetch));
		values.set(shard, offset);
		offset += shard.length;
	}
	if (offset !== values.length) throw new Error('Incomplete vector matrix');
	engine.setVectors(values);
	const accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
		apiToken = process.env.CLOUDFLARE_API_TOKEN;
	if (!accountId || !apiToken)
		throw new Error(
			'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN to evaluate semantic search'
		);
	const embed = createCloudflareEmbedder({ accountId, apiToken });
	return {
		async search(input) {
			const start = performance.now();
			const vector =
				input.mode === 'hybrid' || input.mode === 'semantic'
					? (await embed([EMBEDDING.queryPrefix + input.query]))[0]
					: undefined;
			const queryStart = performance.now();
			return {
				results: engine.search(input, vector).slice(0, input.offset + input.limit + 1),
				timings: {
					totalMs: performance.now() - start,
					queryMs: performance.now() - queryStart,
					rerankMs: 0
				}
			};
		}
	};
}
