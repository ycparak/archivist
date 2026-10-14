import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { SearchDocument } from '$lib/domain/archive';
import type { ChannelManifestEntry } from '$lib/domain/search';
import type { SearchRelease } from '$lib/search/snapshot';
import { buildChannelManifest } from '$lib/server/indexing/channel-manifest';
import { loadValidatedRelease } from '$lib/server/maintenance/release';
import { buildSearchRelease, sha256 } from '$lib/server/release/release-builder';
import { withFileLock } from './file-lock';
import { configuredEmbedder, localEmbeddingCache, searchOutput } from './maintenance-files';

async function writeSearchRelease(
	output: URL,
	release: SearchRelease,
	assets: ReadonlyMap<string, Uint8Array>
) {
	const releases = new URL('releases/', output);
	const target = new URL(`${release.version}/`, releases);
	await mkdir(releases, { recursive: true });
	async function verifyExisting(): Promise<boolean> {
		try {
			for (const asset of [
				release.metadata,
				release.lexical,
				release.bootstrap,
				...release.vectors
			]) {
				const bytes = await readFile(new URL(asset.file, target));
				if (bytes.byteLength !== asset.bytes || (await sha256(bytes)) !== asset.sha256)
					throw new Error('Existing immutable release is corrupt');
			}
			return true;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
			throw error;
		}
	}
	if (!(await verifyExisting())) {
		const temporary = pathToFileURL(
			(await mkdtemp(fileURLToPath(new URL('.staging-', releases)))) + '/'
		);
		try {
			for (const [name, bytes] of assets) await writeFile(new URL(name, temporary), bytes);
			await rename(temporary, target);
		} catch (error) {
			if (!(await verifyExisting())) throw error;
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	}
	const pointer = pathToFileURL((await mkdtemp(fileURLToPath(new URL('.pointer-', output)))) + '/');
	try {
		await writeFile(new URL('manifest.json', pointer), JSON.stringify(release));
		await rename(new URL('manifest.json', pointer), new URL('manifest.json', output));
	} finally {
		await rm(pointer, { recursive: true, force: true });
	}
}

/** Validates every asset, then stages the immutable release and swaps the manifest under one lock. */
export async function publishSearchRelease(
	output: URL,
	release: SearchRelease,
	assets: ReadonlyMap<string, Uint8Array>
) {
	await mkdir(output, { recursive: true });
	await withFileLock(new URL('.publication-lock/', output), async () => {
		await loadValidatedRelease(release, async (asset) => {
			const bytes = assets.get(asset.file);
			if (!bytes) throw new Error('Missing publication asset');
			return bytes;
		});
		await writeSearchRelease(output, release, assets);
	});
}

/** Builds a release from the documents, reusing cached chunk embeddings, and publishes it locally. */
export async function publishArchiveSearch(
	documents: SearchDocument[],
	channels: ChannelManifestEntry[],
	signal: AbortSignal
) {
	console.log(`Embedding ${documents.length} public blocks; unchanged chunks use the local cache`);
	const { entries, checkpoint } = await localEmbeddingCache();
	const embed = configuredEmbedder();
	const { release, assets } = await buildSearchRelease(
		documents,
		buildChannelManifest(channels),
		async (texts) => {
			signal.throwIfAborted();
			return embed(texts);
		},
		entries,
		checkpoint
	);
	signal.throwIfAborted();
	await publishSearchRelease(searchOutput, release, assets);
	console.log(
		`Exported ${release.blockCount} blocks, ${release.vectorCount} vectors in ${release.vectors.length} shards`
	);
	console.log(`Release: ${release.version}. Search assets and embedding cache are gitignored.`);
}
