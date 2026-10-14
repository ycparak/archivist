import { mkdir, mkdtemp, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { memoryUsage } from 'node:process';
import { z } from 'zod';
import { EMBEDDING, embeddingVectorSchema } from '$lib/search/embedding';
import { releaseSchema } from '$lib/search/snapshot';
import { sha256 } from '$lib/server/search/release-builder';
import { loadValidatedRelease } from '$lib/server/maintenance/release';
import { candidateOriginSchema, validateCandidate } from '$lib/server/maintenance/candidate';
import { embedEvaluationQueries, evaluationCasesSchema } from '$lib/server/maintenance/evaluate';
import { createCloudflareEmbedder } from '$lib/server/search/export';
import { parseVisionCache } from '$lib/server/indexing/vision/cache';
import { parseColourCache } from '$lib/server/indexing/colour/cache';
import { withFileLock } from './file-lock';
import { parseConnectionCache } from '$lib/server/indexing/connections/cache';

export const searchOutput = new URL('../static/search/', import.meta.url);
export const fixtureFile = new URL('./fixtures/search-cases.json', import.meta.url);
export const workspace = new URL('../', import.meta.url);

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
export async function loadLocalRelease(output: URL) {
	const release = releaseSchema.parse(
		JSON.parse(await readFile(new URL('manifest.json', output), 'utf8'))
	);
	return loadValidatedRelease(release, (asset) =>
		readFile(new URL(`releases/${release.version}/${asset.file}`, output))
	);
}
export async function loadOptionalRelease(output: URL) {
	return (await optionalRead(new URL('manifest.json', output))) === undefined
		? undefined
		: loadLocalRelease(output);
}
export function configuredEmbedder() {
	return createCloudflareEmbedder({
		accountId: process.env.CLOUDFLARE_ACCOUNT_ID ?? '',
		apiToken: process.env.CLOUDFLARE_API_TOKEN ?? ''
	});
}
export async function loadArchiveCaches() {
	const root = new URL('../src/lib/server/indexing/', import.meta.url);
	return {
		visionCache: parseVisionCache(await readFile(new URL('vision-cache.jsonl', root), 'utf8')),
		colourCache: parseColourCache(await readFile(new URL('colour-cache.jsonl', root), 'utf8')),
		connectionCache: parseConnectionCache(
			await readFile(new URL('connections-cache.jsonl', root), 'utf8')
		)
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
export async function validateLocalCandidate(output: URL) {
	const origin = candidateOriginSchema.parse(
		JSON.parse(await readFile(new URL('origin.json', output), 'utf8'))
	);
	const candidate = await loadLocalRelease(output);
	const baseline = await loadOptionalRelease(searchOutput);
	const fixture = evaluationCasesSchema.parse(JSON.parse(await readFile(fixtureFile, 'utf8')));
	const queries = await embedEvaluationQueries(fixture, configuredEmbedder());
	return validateCandidate({
		candidate,
		origin,
		fixture,
		queryVectors: queries,
		baseline,
		gzipSize: async (bytes) => gzipSync(bytes).length,
		heapBytes: () => memoryUsage().heapUsed
	});
}
