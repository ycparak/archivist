import type { SearchDocument } from '$lib/domain/archive';
import type { ChannelManifestEntry } from '$lib/domain/search';
import type { SearchRelease } from '$lib/search/snapshot';
import { candidateOriginSchema, type CandidateOrigin } from './candidate';

export async function prepareCandidate(options: {
	origin: CandidateOrigin;
	discover: () => Promise<{
		documents: SearchDocument[];
		channels: ChannelManifestEntry[];
		summary: { channelsFailed: unknown[] };
	}>;
	build: (
		documents: SearchDocument[],
		channels: ChannelManifestEntry[]
	) => Promise<{ release: SearchRelease; assets: ReadonlyMap<string, Uint8Array> }>;
	persist: (candidate: {
		release: SearchRelease;
		assets: ReadonlyMap<string, Uint8Array>;
		origin: CandidateOrigin;
	}) => Promise<void>;
	signal: AbortSignal;
}) {
	const origin = candidateOriginSchema.parse(options.origin);
	const discovery = await options.discover();
	options.signal.throwIfAborted();
	if (
		discovery.summary.channelsFailed.length ||
		!discovery.documents.length ||
		!discovery.channels.length
	)
		throw new Error('Cannot prepare an incomplete or empty archive');
	const built = await options.build(discovery.documents, discovery.channels);
	options.signal.throwIfAborted();
	const candidate = { ...built, origin };
	await options.persist(candidate);
	return candidate;
}
