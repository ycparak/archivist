import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { sha256 } from '$lib/server/search/release-builder';
import type { SearchRelease } from '$lib/search/snapshot';
import { loadValidatedRelease } from '$lib/server/maintenance/release';
import { withFileLock } from './file-lock';

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

export async function withSearchPublication<T>(
	output: URL,
	action: (
		publish: (release: SearchRelease, assets: ReadonlyMap<string, Uint8Array>) => Promise<void>
	) => Promise<T>
): Promise<T> {
	await mkdir(output, { recursive: true });
	const lock = new URL('.publication-lock/', output);
	return withFileLock(lock, () =>
		action(async (release, assets) => {
			await loadValidatedRelease(release, async (asset) => {
				const bytes = assets.get(asset.file);
				if (!bytes) throw new Error('Missing publication asset');
				return bytes;
			});
			await writeSearchRelease(output, release, assets);
		})
	);
}

export async function publishSearchRelease(
	output: URL,
	release: SearchRelease,
	assets: ReadonlyMap<string, Uint8Array>
) {
	await withSearchPublication(output, (publish) => publish(release, assets));
}
