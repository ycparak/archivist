import { z } from 'zod';

/**
 * A block's total changes without the block changing, so unlike colour and vision the cache cannot
 * be keyed on the content: an entry is reused until it is this old. A week keeps a routine sync to
 * the blocks added since, and the count is a popularity ranking that a day's drift does not move.
 */
export const CONNECTION_COUNT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const connectionCacheEntrySchema = z.object({
	block_id: z.string().min(1),
	/** Every connection to the block on Are.na, by the maintainer and by anyone else. */
	total: z.number().int().nonnegative(),
	counted_at: z.iso.datetime()
});

export type ConnectionCacheEntry = z.infer<typeof connectionCacheEntrySchema>;

export type ConnectionCache = ReadonlyMap<string, ConnectionCacheEntry>;

const SERIALIZED_KEY_ORDER = [
	'block_id',
	'total',
	'counted_at'
] as const satisfies readonly (keyof ConnectionCacheEntry)[];

export function parseConnectionCache(contents: string): Map<string, ConnectionCacheEntry> {
	const entries = new Map<string, ConnectionCacheEntry>();

	for (const [index, line] of contents.split('\n').entries()) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		let raw: unknown;
		try {
			raw = JSON.parse(trimmed);
		} catch (error) {
			throw new Error(`connections cache line ${index + 1} is not valid JSON`, { cause: error });
		}

		const parsed = connectionCacheEntrySchema.safeParse(raw);
		if (!parsed.success) {
			throw new Error(`connections cache line ${index + 1} is malformed: ${parsed.error.message}`);
		}
		entries.set(parsed.data.block_id, parsed.data);
	}

	return entries;
}

/** Fixed key order, sorted by block: an unchanged run is no diff. */
export function serializeConnectionCache(entries: Iterable<ConnectionCacheEntry>): string {
	const lines = [...entries]
		.sort((a, b) => a.block_id.localeCompare(b.block_id))
		.map((entry) =>
			JSON.stringify(Object.fromEntries(SERIALIZED_KEY_ORDER.map((key) => [key, entry[key]])))
		);
	return lines.length ? `${lines.join('\n')}\n` : '';
}

export function isConnectionCacheHit(
	entry: ConnectionCacheEntry | undefined,
	now: Date,
	maxAgeMs: number = CONNECTION_COUNT_MAX_AGE_MS
): boolean {
	return entry !== undefined && now.getTime() - Date.parse(entry.counted_at) < maxAgeMs;
}

/**
 * Drops entries for blocks no longer in the archive. A block that failed this run keeps its previous
 * entry, so one failed request never strips a count a past run made.
 */
export function mergeConnectionCache(
	previous: ConnectionCache,
	counted: Iterable<ConnectionCacheEntry>,
	liveBlockIds: ReadonlySet<string>
): ConnectionCacheEntry[] {
	const merged = new Map<string, ConnectionCacheEntry>();

	for (const [blockId, entry] of previous) {
		if (liveBlockIds.has(blockId)) merged.set(blockId, entry);
	}
	for (const entry of counted) {
		if (liveBlockIds.has(entry.block_id)) merged.set(entry.block_id, entry);
	}

	return [...merged.values()].sort((a, b) => a.block_id.localeCompare(b.block_id));
}
