import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { withFileLock } from '../../../../scripts/file-lock';
import { localEmbeddingCache } from '../../../../scripts/maintenance-files';
import { publishSearchRelease } from '../../../../scripts/search-files';
import { buildSearchRelease } from '$lib/server/release/release-builder';
import { toSearchDocument } from '$lib/domain/archive';
import { EMBEDDING } from '$lib/search/embedding';
import { releaseSchema } from '$lib/search/snapshot';
import { loadValidatedRelease } from './release';

const directories: string[] = [];
afterEach(async () => {
	for (const dir of directories.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function loadActiveRelease(root: URL) {
	const release = releaseSchema.parse(
		JSON.parse(await readFile(new URL('manifest.json', root), 'utf8'))
	);
	return loadValidatedRelease(release, (asset) =>
		readFile(new URL(`releases/${release.version}/${asset.file}`, root))
	);
}

async function setup() {
	const dir = await mkdtemp(join(tmpdir(), 'archivist-publication-'));
	directories.push(dir);
	const root = pathToFileURL(dir + '/');
	const channels = [{ slug: 'public', title: 'Public' }];
	const build = (title: string) =>
		buildSearchRelease(
			[
				toSearchDocument({
					id: '1',
					type: 'Text',
					title,
					arenaUrl: 'https://www.are.na/block/1',
					channels
				})
			],
			channels,
			async (texts) =>
				texts.map(() => Array.from({ length: EMBEDDING.dimensions }, (_, i) => Number(i === 0)))
		);
	const previous = await build('Before'),
		candidate = await build('After');
	await publishSearchRelease(root, previous.release, previous.assets);
	return { root, previous, candidate };
}

describe('local publication', () => {
	it('preserves a readable previous release after validation or filesystem failure', async () => {
		const { root, previous, candidate } = await setup();
		const corrupt = new Map(candidate.assets);
		corrupt.set(candidate.release.metadata.file, new Uint8Array());
		await expect(publishSearchRelease(root, candidate.release, corrupt)).rejects.toThrow(
			'integrity'
		);
		const target = new URL(`releases/${candidate.release.version}/`, root);
		await mkdir(target);
		await mkdir(new URL(candidate.release.metadata.file + '/', target));
		await expect(publishSearchRelease(root, candidate.release, candidate.assets)).rejects.toThrow();
		expect((await loadActiveRelease(root)).release.version).toBe(previous.release.version);
	});
	it('excludes every manifest writer and releases the lock after failure', async () => {
		const { root, previous, candidate } = await setup();
		await expect(
			withFileLock(new URL('.publication-lock/', root), async () => {
				await expect(
					publishSearchRelease(root, candidate.release, candidate.assets)
				).rejects.toThrow('locked');
				expect((await loadActiveRelease(root)).release.version).toBe(previous.release.version);
				throw new Error('Writer failed');
			})
		).rejects.toThrow('Writer failed');
		await publishSearchRelease(root, candidate.release, candidate.assets);
		expect((await loadActiveRelease(root)).release.version).toBe(candidate.release.version);
		await publishSearchRelease(root, candidate.release, candidate.assets);
		expect(JSON.parse(await readFile(new URL('manifest.json', root), 'utf8')).version).toBe(
			candidate.release.version
		);
	});
});

it('merges interleaved embedding checkpoints without losing completed entries', async () => {
	const { root } = await setup();
	const first = await localEmbeddingCache(root),
		second = await localEmbeddingCache(root);
	const vector = Array.from({ length: EMBEDDING.dimensions }, (_, i) => Number(i === 0));
	first.entries.set('a'.repeat(64), vector);
	second.entries.set('b'.repeat(64), vector);
	await Promise.all([first.checkpoint(first.entries), second.checkpoint(second.entries)]);
	const merged = await localEmbeddingCache(root);
	expect([...merged.entries.keys()].sort()).toEqual(['a'.repeat(64), 'b'.repeat(64)]);
});
