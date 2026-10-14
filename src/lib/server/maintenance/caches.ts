import { z } from 'zod';
import {
	colourCacheEntrySchema,
	mergeColourCache,
	parseColourCache,
	serializeColourCache,
	type ColourCacheEntry
} from '$lib/server/indexing/colour/cache';
import {
	connectionCacheEntrySchema,
	mergeConnectionCache,
	parseConnectionCache,
	serializeConnectionCache,
	type ConnectionCacheEntry
} from '$lib/server/indexing/connections/cache';
import {
	mergeVisionCache,
	parseVisionCache,
	serializeVisionCache,
	visionCacheEntrySchema,
	type VisionCacheEntry
} from '$lib/server/indexing/vision/cache';
import { EMBEDDING, embeddingVectorSchema } from '$lib/search/embedding';
import { sha256 } from '$lib/server/search/release-builder';
import { fencedPut, type Lease } from './lease';
import { getJson, PreconditionFailedError, putImmutable, type ObjectStore } from './store';

export const CACHE_STAGES = ['colour', 'connections', 'vision'] as const;
export type CacheStage = (typeof CACHE_STAGES)[number];
export interface StageEntries {
	colour: ColourCacheEntry;
	connections: ConnectionCacheEntry;
	vision: VisionCacheEntry;
}
export type ArchiveCaches = { [S in CacheStage]: Map<string, StageEntries[S]> };

interface StageCodec<T extends { block_id: string }> {
	schema: z.ZodType<T>;
	parse(text: string): Map<string, T>;
	serialize(entries: Iterable<T>): string;
	merge(previous: ReadonlyMap<string, T>, next: Iterable<T>, live: ReadonlySet<string>): T[];
	/** Every input that decides whether the entry is still valid, so equal keys mean equal work. */
	key(entry: T): string;
	/** When the work was done; the newer of two entries for one block wins a local import. */
	timestamp(entry: T): string;
}

export const stageCodecs: { [S in CacheStage]: StageCodec<StageEntries[S]> } = {
	colour: {
		schema: colourCacheEntrySchema,
		parse: parseColourCache,
		serialize: serializeColourCache,
		merge: mergeColourCache,
		key: (e) => [e.block_id, e.image_src_hash, e.colour_version].join('\n'),
		timestamp: (e) => e.measured_at
	},
	connections: {
		schema: connectionCacheEntrySchema,
		parse: parseConnectionCache,
		serialize: serializeConnectionCache,
		merge: mergeConnectionCache,
		key: (e) => [e.block_id, e.counted_at].join('\n'),
		timestamp: (e) => e.counted_at
	},
	vision: {
		schema: visionCacheEntrySchema,
		parse: parseVisionCache,
		serialize: serializeVisionCache,
		merge: mergeVisionCache,
		key: (e) => [e.block_id, e.image_src_hash, e.prompt_version, e.model, e.input_mode].join('\n'),
		timestamp: (e) => e.generated_at
	}
};

export const CACHE_POINTER_KEY = 'caches/current.json';
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const snapshotSchema = z.object({ key: z.string(), sha256: hash, entries: z.number().int() });
const cachePointerSchema = z
	.object({
		format: z.literal(1),
		fence: z.number().int().positive(),
		jobId: z.string().nullable(),
		updatedAt: z.iso.datetime(),
		stages: z.object({
			colour: snapshotSchema,
			connections: snapshotSchema,
			vision: snapshotSchema
		})
	})
	.strict();
type CachePointer = z.infer<typeof cachePointerSchema>;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function loadCanonicalCaches(store: ObjectStore) {
	const pointer = await getJson(store, CACHE_POINTER_KEY, cachePointerSchema);
	if (!pointer) throw new Error('Hosted caches are not bootstrapped');
	const caches = {} as ArchiveCaches;
	for (const stage of CACHE_STAGES) {
		const descriptor = pointer.value.stages[stage];
		const object = await store.get(descriptor.key);
		if (!object || (await sha256(object.bytes)) !== descriptor.sha256)
			throw new Error(`Hosted ${stage} snapshot is missing or corrupt`);
		(caches as Record<CacheStage, unknown>)[stage] = stageCodecs[stage].parse(
			decoder.decode(object.bytes)
		);
	}
	return { caches, pointer: pointer.value, etag: pointer.etag };
}

async function writeSnapshot<S extends CacheStage>(
	store: ObjectStore,
	stage: S,
	entries: Iterable<StageEntries[S]>
) {
	const list = [...entries];
	const bytes = encoder.encode(stageCodecs[stage].serialize(list));
	const digest = await sha256(bytes);
	const key = `caches/${stage}/${digest}.jsonl`;
	await putImmutable(store, key, bytes);
	return { key, sha256: digest, entries: list.length };
}

export async function bootstrapCaches(store: ObjectStore, lease: Lease, caches: ArchiveCaches) {
	const stages = {} as CachePointer['stages'];
	for (const stage of CACHE_STAGES)
		stages[stage] = await writeSnapshot(store, stage, caches[stage].values());
	await fencedPut(
		store,
		lease,
		CACHE_POINTER_KEY,
		{ format: 1, jobId: null, updatedAt: new Date().toISOString(), stages },
		null
	);
}

export async function recordKey(jobId: string, stage: CacheStage, entry: StageEntries[CacheStage]) {
	const codec = stageCodecs[stage] as StageCodec<StageEntries[CacheStage]>;
	return `jobs/${jobId}/records/${stage}/${await sha256(encoder.encode(codec.key(entry)))}.json`;
}

export async function persistRecord<S extends CacheStage>(
	store: ObjectStore,
	jobId: string,
	stage: S,
	entry: StageEntries[S]
) {
	const codec = stageCodecs[stage] as StageCodec<StageEntries[S]>;
	try {
		await store.put(
			await recordKey(jobId, stage, entry),
			encoder.encode(JSON.stringify(codec.schema.parse(entry))),
			{ ifAbsent: true }
		);
	} catch (error) {
		// The same cache key settled twice (a duplicated attempt); the first record stands.
		if (!(error instanceof PreconditionFailedError)) throw error;
	}
}

export async function loadRecords<S extends CacheStage>(
	store: ObjectStore,
	jobId: string,
	stage: S
): Promise<StageEntries[S][]> {
	const codec = stageCodecs[stage] as StageCodec<StageEntries[S]>;
	const entries: StageEntries[S][] = [];
	for (const key of await store.list(`jobs/${jobId}/records/${stage}/`)) {
		const object = await store.get(key);
		if (!object) throw new Error(`Record disappeared: ${key}`);
		entries.push(codec.schema.parse(JSON.parse(decoder.decode(object.bytes))));
	}
	return entries;
}

/**
 * Merges a job's settled records into whichever canonical snapshot is current now, not the one
 * the job started from, so a newer merge is never rolled back. Stages the job did not run keep
 * their snapshot unchanged, and only a complete discovery prunes blocks that left the archive.
 */
export async function mergeJobRecords(
	store: ObjectStore,
	lease: Lease,
	options: {
		jobId: string;
		records: Partial<{ [S in CacheStage]: StageEntries[S][] }>;
		/** Null merges without pruning, as a retry or subset job must. */
		liveBlockIds: ReadonlySet<string> | null;
	}
) {
	const { caches, pointer, etag } = await loadCanonicalCaches(store);
	const stages = { ...pointer.stages };
	for (const stage of CACHE_STAGES) {
		const records = options.records[stage];
		if (!records) continue;
		const codec = stageCodecs[stage] as StageCodec<StageEntries[CacheStage]>;
		const live =
			options.liveBlockIds ??
			new Set([...caches[stage].keys(), ...records.map(({ block_id }) => block_id)]);
		const merged = codec.merge(caches[stage], records, live);
		stages[stage] = await writeSnapshot(store, stage, merged);
		caches[stage] = new Map(merged.map((entry) => [entry.block_id, entry])) as never;
	}
	await fencedPut(
		store,
		lease,
		CACHE_POINTER_KEY,
		{ format: 1, jobId: options.jobId, updatedAt: new Date().toISOString(), stages },
		etag
	);
	return caches;
}

const embeddingDeltaSchema = z.record(hash, embeddingVectorSchema);
const embeddingPrefix = `embeddings/${EMBEDDING.version}/`;

/** Embeddings are a pure function of version and text, so content-addressed deltas need no coordinator. */
export async function hostedEmbeddingCache(store: ObjectStore) {
	const entries = new Map<string, number[]>();
	for (const key of await store.list(embeddingPrefix)) {
		const object = await store.get(key);
		if (!object) throw new Error(`Embedding delta disappeared: ${key}`);
		for (const [chunk, vector] of Object.entries(
			embeddingDeltaSchema.parse(JSON.parse(decoder.decode(object.bytes)))
		))
			entries.set(chunk, vector);
	}
	const persisted = new Set(entries.keys());
	return {
		entries,
		async checkpoint(cache: ReadonlyMap<string, number[]>) {
			const delta = [...cache].filter(([key]) => !persisted.has(key));
			if (!delta.length) return;
			const bytes = encoder.encode(JSON.stringify(Object.fromEntries(delta)));
			await putImmutable(store, `${embeddingPrefix}${await sha256(bytes)}.json`, bytes);
			for (const [key] of delta) persisted.add(key);
		}
	};
}

interface LocalImportChange {
	added: number;
	updated: number;
	keptLocal: number;
	localOnly: number;
}

/** Imports hosted entries into a local cache without ever replacing a newer local entry. */
export function importIntoLocal<S extends CacheStage>(
	stage: S,
	local: ReadonlyMap<string, StageEntries[S]>,
	hosted: ReadonlyMap<string, StageEntries[S]>
) {
	const codec = stageCodecs[stage] as StageCodec<StageEntries[S]>;
	const merged = new Map(local);
	const change: LocalImportChange = { added: 0, updated: 0, keptLocal: 0, localOnly: 0 };
	for (const [id, entry] of hosted) {
		const existing = local.get(id);
		if (!existing) {
			merged.set(id, entry);
			change.added += 1;
		} else if (codec.key(existing) === codec.key(entry)) continue;
		else if (Date.parse(codec.timestamp(entry)) > Date.parse(codec.timestamp(existing))) {
			merged.set(id, entry);
			change.updated += 1;
		} else change.keptLocal += 1;
	}
	for (const id of local.keys()) if (!hosted.has(id)) change.localOnly += 1;
	return { text: codec.serialize(merged.values()), change };
}
