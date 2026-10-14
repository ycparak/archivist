import { expect, it, vi } from 'vitest';
import { prepareCandidate } from './prepare';
import { candidateOriginSchema } from './candidate';
import { toSearchDocument } from '$lib/domain/archive';
import { buildSearchRelease } from '$lib/server/search/release-builder';
import { EMBEDDING } from '$lib/search/embedding';

const channels = [{ slug: 'public', title: 'Public' }];
const documents = [
	toSearchDocument({
		id: '1',
		type: 'Text',
		title: 'Fox',
		arenaUrl: 'https://www.are.na/block/1',
		channels
	})
];
const origin = candidateOriginSchema.parse({
	format: 1,
	kind: 'public-export',
	complete: true,
	sourceRevision: 'test',
	sourceFingerprint: 'a'.repeat(64),
	baselineVersion: null,
	maxRankDrop: null,
	gate: 'strict',
	job: null
});
it('never builds or persists incomplete discovery', async () => {
	const build = vi.fn(),
		persist = vi.fn();
	await expect(
		prepareCandidate({
			origin,
			discover: async () => ({ documents, channels, summary: { channelsFailed: ['failed'] } }),
			build,
			persist,
			signal: new AbortController().signal
		})
	).rejects.toThrow('incomplete');
	expect(build).not.toHaveBeenCalled();
	expect(persist).not.toHaveBeenCalled();
});
it('never persists embedding failures or cancelled preparation', async () => {
	const persist = vi.fn();
	const discover = async () => ({ documents, channels, summary: { channelsFailed: [] } });
	await expect(
		prepareCandidate({
			origin,
			discover,
			build: () =>
				buildSearchRelease(documents, channels, async () => {
					throw new Error('Provider failed');
				}),
			persist,
			signal: new AbortController().signal
		})
	).rejects.toThrow('Provider failed');
	const abort = new AbortController();
	await expect(
		prepareCandidate({
			origin,
			discover,
			build: async () => {
				const built = await buildSearchRelease(documents, channels, async (texts) =>
					texts.map(() => Array.from({ length: EMBEDDING.dimensions }, (_, i) => Number(i === 0)))
				);
				abort.abort();
				return built;
			},
			persist,
			signal: abort.signal
		})
	).rejects.toThrow();
	expect(persist).not.toHaveBeenCalled();
});
