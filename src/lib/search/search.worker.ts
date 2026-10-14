import MiniSearch from 'minisearch';
import { ARCHIVE_MAX_OFFSET, readArchiveSearchState } from '$lib/domain/search';
import { ArchiveSearchEngine, lexicalOptions } from './core';
import { checkedAsset, decodeVectors } from './assets';
import { EMBEDDING, queryEmbeddingSchema } from './embedding';
import { parseArchiveSearchRequest, SearchRequestValidationError } from './request';
import { metadataSchema, releaseSchema, validateMetadata, type SearchRelease } from './snapshot';
import type { WorkerRequest, WorkerResponse, BrowserSearchOutcome } from './protocol';

let release: SearchRelease | undefined;
let enginePromise: Promise<ArchiveSearchEngine> | undefined;
let lexicalPromise: Promise<void> | undefined;
let vectorsPromise: Promise<void> | undefined;
const requests = new Map<number, AbortController>();
const queries = new Map<string, number[]>();

async function engine(): Promise<ArchiveSearchEngine> {
	if (!release) throw new Error('Search worker has not been initialized');
	const pinned = release;
	enginePromise ??= (async () => {
		const bytes = await checkedAsset(pinned, pinned.metadata);
		const metadata = metadataSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
		validateMetadata(pinned, metadata);
		return new ArchiveSearchEngine(
			metadata.documents,
			new MiniSearch(lexicalOptions),
			metadata.vectorBlocks
		);
	})().catch((error) => {
		enginePromise = undefined;
		throw error;
	});
	return enginePromise;
}

async function loadLexical(search: ArchiveSearchEngine): Promise<void> {
	if (!release) throw new Error('Missing release');
	const pinned = release;
	lexicalPromise ??= (async () => {
		const bytes = await checkedAsset(pinned, pinned.lexical);
		search.setLexical(MiniSearch.loadJSON(new TextDecoder().decode(bytes), lexicalOptions));
	})().catch((error) => {
		lexicalPromise = undefined;
		throw error;
	});
	return lexicalPromise;
}
async function loadVectors(search: ArchiveSearchEngine): Promise<void> {
	if (!release) throw new Error('Missing release');
	const pinned = release;
	vectorsPromise ??= (async () => {
		const vectors = new Float32Array(pinned.vectorCount * EMBEDDING.dimensions);
		let offset = 0;
		for (const asset of pinned.vectors) {
			const shard = decodeVectors(await checkedAsset(pinned, asset));
			if (offset + shard.length > vectors.length)
				throw new Error('Vector shards exceed declared count');
			vectors.set(shard, offset);
			offset += shard.length;
		}
		if (offset !== vectors.length) throw new Error('Incomplete vector matrix');
		search.setVectors(vectors);
	})().catch((error) => {
		vectorsPromise = undefined;
		throw error;
	});
	return vectorsPromise;
}
async function queryEmbedding(query: string, signal: AbortSignal): Promise<number[]> {
	const cached = queries.get(query);
	if (cached) return cached;
	const response = await fetch('/api/embedding', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ query, version: EMBEDDING.version }),
		signal
	});
	if (!response.ok) throw new Error('Query embedding is unavailable');
	const { vector } = queryEmbeddingSchema.parse(await response.json());
	if (queries.size >= 32) queries.delete(queries.keys().next().value!);
	queries.set(query, vector);
	return vector;
}
async function search(params: URLSearchParams, signal: AbortSignal): Promise<BrowserSearchOutcome> {
	const state = readArchiveSearchState(params);
	try {
		const input = parseArchiveSearchRequest(params);
		const instance = await engine();
		signal.throwIfAborted();
		if (input.mode === 'lexical' || input.mode === 'hybrid') await loadLexical(instance);
		let vector: number[] | undefined;
		if (input.mode === 'semantic' || input.mode === 'hybrid') {
			[, vector] = await Promise.all([loadVectors(instance), queryEmbedding(input.query, signal)]);
		}
		signal.throwIfAborted();
		const results = instance.search(input, vector);
		const end = input.offset + input.limit;
		return {
			kind: 'ok',
			state,
			results: results.slice(input.offset, end),
			hasMore: results.length > end && end <= ARCHIVE_MAX_OFFSET
		};
	} catch (error) {
		if (signal.aborted) throw error;
		if (error instanceof SearchRequestValidationError) return { kind: 'invalid', state };
		return { kind: 'unavailable', state, correlationId: crypto.randomUUID() };
	}
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
	const message = event.data;
	if (message.type === 'initialize') {
		const parsed = releaseSchema.parse(message.release);
		if (release && release.version !== parsed.version)
			throw new Error('Cannot change a pinned search release');
		release = parsed;
		return;
	}
	if (message.type === 'cancel') {
		requests.get(message.id)?.abort();
		return;
	}
	const controller = new AbortController();
	requests.set(message.id, controller);
	void search(new URLSearchParams(message.params), controller.signal)
		.then((outcome) => {
			if (!controller.signal.aborted)
				self.postMessage({ id: message.id, outcome } satisfies WorkerResponse);
		})
		.catch(() => {
			if (!controller.signal.aborted)
				self.postMessage({
					id: message.id,
					outcome: {
						kind: 'unavailable',
						state: readArchiveSearchState(new URLSearchParams(message.params)),
						correlationId: crypto.randomUUID()
					}
				} satisfies WorkerResponse);
		})
		.finally(() => requests.delete(message.id));
};
