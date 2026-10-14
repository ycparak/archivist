import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { EMBEDDING, embeddingVectorSchema } from '$lib/search/embedding';
import { sha256 } from '$lib/server/release/release-builder';
import { createCloudflareEmbedder } from '$lib/server/release/export';
import { parseVisionCache } from '$lib/server/indexing/vision/cache';
import { parseColourCache } from '$lib/server/indexing/colour/cache';
import { withFileLock } from './file-lock';
import { parseConnectionCache } from '$lib/server/indexing/connections/cache';

export const searchOutput = new URL('../static/search/', import.meta.url);
export const fixtureFile = new URL('./fixtures/search-cases.json', import.meta.url);
export const workspace = new URL('../', import.meta.url);
/** The committed enrichment caches: a portable seed for hosted maintenance and a reviewable record. */
export const cacheFiles = {
	colour: new URL('../data/colour-cache.jsonl', import.meta.url),
	connections: new URL('../data/connections-cache.jsonl', import.meta.url),
	vision: new URL('../data/vision-cache.jsonl', import.meta.url)
} as const;

export async function optionalRead(url: URL): Promise<string | undefined> {
	try {
		return await readFile(url, 'utf8');
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
		throw error;
	}
}
export async function atomicWrite(file: URL, text: string) {
	const parent = new URL('./', file);
	await mkdir(parent, { recursive: true });
	const scratch = pathToFileURL((await mkdtemp(fileURLToPath(new URL('.write-', parent)))) + '/');
	try {
		await writeFile(new URL('value', scratch), text);
		await rename(new URL('value', scratch), file);
	} finally {
		await rm(scratch, { recursive: true, force: true });
	}
}
export function configuredEmbedder() {
	return createCloudflareEmbedder({
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
		apiToken: process.env.CLOUDFLARE_API_TOKEN ?? ''
	});
}
export async function loadArchiveCaches() {
	return {
		visionCache: parseVisionCache((await optionalRead(cacheFiles.vision)) ?? ''),
		colourCache: parseColourCache((await optionalRead(cacheFiles.colour)) ?? ''),
		connectionCache: parseConnectionCache((await optionalRead(cacheFiles.connections)) ?? '')
	};
}
export async function localEmbeddingCache(
	directory = new URL('../.search-cache/', import.meta.url)
) {
	const file = new URL(`${EMBEDDING.version}.json`, directory);
	const raw = await optionalRead(file);
	const schema = z.record(z.string().regex(/^[a-f0-9]{64}$/), embeddingVectorSchema);
	const entries = new Map(Object.entries(raw ? schema.parse(JSON.parse(raw)) : {}));
	return {
		entries,
		checkpoint: async (cache: Map<string, number[]>) => {
			await mkdir(directory, { recursive: true });
			await withFileLock(
				new URL('.embedding-lock/', directory),
				async () => {
					const latest = await optionalRead(file);
					const merged = new Map(Object.entries(latest ? schema.parse(JSON.parse(latest)) : {}));
					for (const [key, vector] of cache) merged.set(key, vector);
					await atomicWrite(file, JSON.stringify(Object.fromEntries(merged)));
				},
				80
			);
		}
	};
}
export async function sourceIdentity() {
	const names = [
		'package.json',
		'bun.lock',
		'trigger.config.ts',
		'tsconfig.json',
		'wrangler.jsonc',
		'vite.config.ts'
	];
	async function walk(directory: string) {
		for (const entry of await readdir(new URL(directory, workspace), { withFileTypes: true })) {
			const path = `${directory}${entry.name}`;
			if (entry.isDirectory()) await walk(path + '/');
			else if (!/\.(spec|test)\.ts$/.test(path) && /\.(ts|json)$/.test(path)) names.push(path);
		}
	}
	for (const directory of [
		'src/lib/domain/',
		'src/lib/search/',
		'src/lib/server/search/',
		'src/lib/server/release/',
		'src/lib/server/indexing/',
		'src/lib/server/arena/',
		'src/lib/server/maintenance/',
		'scripts/'
	])
		await walk(directory);
	const sources = [];
	for (const name of names.sort())
		sources.push([name, await sha256(await readFile(new URL(name, workspace)))]);
	return {
		sourceRevision: execFileSync('git', ['rev-parse', 'HEAD'], {
			cwd: fileURLToPath(workspace),
			encoding: 'utf8'
		}).trim(),
		sourceFingerprint: await sha256(new TextEncoder().encode(JSON.stringify(sources)))
	};
}
