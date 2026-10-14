import { toSearchDocument } from '$lib/domain/archive';
import { EMBEDDING } from '$lib/search/embedding';
import { buildSearchRelease } from '$lib/server/search/release-builder';
import { loadValidatedRelease } from './release';
import { validateCandidate } from './candidate';

export async function validateSyntheticRelease(options: {
	gzipSize: (bytes: Uint8Array) => Promise<number>;
	heapBytes: () => number;
}) {
	const channels = [{ slug: 'validation-smoke', title: 'Validation smoke' }];
	const document = toSearchDocument({
		id: '1',
		type: 'Text',
		title: 'Synthetic fox',
		arenaUrl: 'https://www.are.na/block/1',
		channels
	});
	const built = await buildSearchRelease([document], channels, async (texts) =>
		texts.map(() => Array.from({ length: EMBEDDING.dimensions }, (_, i) => Number(i === 0)))
	);
	const candidate = await loadValidatedRelease(built.release, async (asset) =>
		built.assets.get(asset.file)!
	);
	return validateCandidate({
		candidate,
		origin: {
			format: 1,
			kind: 'synthetic',
			complete: true,
			sourceRevision: 'smoke',
			sourceFingerprint: '0'.repeat(64),
			baselineVersion: null,
			maxRankDrop: null
		},
		fixture: [{ id: 'lexical-smoke', mode: 'lexical', q: 'fox', expectedBlockIds: ['block:1'] }],
		queryVectors: {},
		...options
	});
}
