import type { SearchRelease, SnapshotAsset } from './snapshot';

export function releaseAssetPath(release: SearchRelease, asset: SnapshotAsset): string {
	return `/search/releases/${release.version}/${asset.file}`;
}

export async function checkedAsset(
	release: SearchRelease,
	asset: SnapshotAsset,
	fetchFn: typeof fetch = fetch
): Promise<ArrayBuffer> {
	const response = await fetchFn(releaseAssetPath(release, asset));
	if (!response.ok) throw new Error('Search asset could not be loaded');
	if (!response.body) throw new Error('Search asset has no body');
	const reader = response.body.getReader();
	const bytes = new Uint8Array(asset.bytes);
	let position = 0;
	try {
		while (true) {
			const { value, done } = await reader.read();
			if (done) break;
			if (position + value.length > bytes.length)
				throw new Error('Search asset exceeds its declared size');
			bytes.set(value, position);
			position += value.length;
		}
	} catch (error) {
		await reader.cancel();
		throw error;
	} finally {
		reader.releaseLock();
	}
	if (position !== bytes.length) throw new Error('Search asset is incomplete');
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	const hash = [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
	if (hash !== asset.sha256) throw new Error('Search asset integrity check failed');
	return bytes.buffer;
}

export function decodeVectors(buffer: ArrayBuffer): Float32Array {
	if (buffer.byteLength % 4 !== 0) throw new Error('Invalid vector byte length');
	const view = new DataView(buffer);
	return Float32Array.from({ length: buffer.byteLength / 4 }, (_, index) =>
		view.getFloat32(index * 4, true)
	);
}
