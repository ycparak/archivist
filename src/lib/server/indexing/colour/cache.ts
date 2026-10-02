import { z } from 'zod';
import { ARCHIVE_COLOURS } from '$lib/domain/search';

/**
 * Bump on any change to the classifier's boundaries or the raster it reads. It is part of the cache
 * skip key, so bumping it re-measures every block: downloads, but no model and no cost.
 */
export const COLOUR_VERSION = 1;

const perMilleSchema = z.number().int().min(0).max(1000);

export const colourWeightsSchema = z.record(z.enum(ARCHIVE_COLOURS), perMilleSchema);

export const colourCacheEntrySchema = z.object({
	block_id: z.string().min(1),
	image_src_hash: z.string().min(1),
	colour_version: z.number().int().nonnegative(),
	/** 1 for a still; more for an animation sampled across its frames. */
	frames: z.number().int().positive(),
	measured_at: z.iso.datetime(),
	weights: colourWeightsSchema
});

export type ColourCacheEntry = z.infer<typeof colourCacheEntrySchema>;

export type ColourCache = ReadonlyMap<string, ColourCacheEntry>;

export interface ColourCacheKey {
	blockId: string;
	imageSourceHash: string;
	colourVersion: number;
}

const SERIALIZED_KEY_ORDER = [
	'block_id',
	'image_src_hash',
	'colour_version',
	'frames',
	'measured_at',
	'weights'
] as const satisfies readonly (keyof ColourCacheEntry)[];

export function parseColourCache(contents: string): Map<string, ColourCacheEntry> {
	const entries = new Map<string, ColourCacheEntry>();

	for (const [index, line] of contents.split('\n').entries()) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		let raw: unknown;
		try {
			raw = JSON.parse(trimmed);
		} catch (error) {
			throw new Error(`colour cache line ${index + 1} is not valid JSON`, { cause: error });
		}

		const parsed = colourCacheEntrySchema.safeParse(raw);
		if (!parsed.success) {
			throw new Error(`colour cache line ${index + 1} is malformed: ${parsed.error.message}`);
		}
		entries.set(parsed.data.block_id, parsed.data);
	}

	return entries;
}

/** Fixed key order, weights in `ARCHIVE_COLOURS` order, sorted by block: an unchanged run is no diff. */
export function serializeColourCache(entries: Iterable<ColourCacheEntry>): string {
	const lines = [...entries]
		.sort((a, b) => a.block_id.localeCompare(b.block_id))
		.map((entry) =>
			JSON.stringify(
				Object.fromEntries(
					SERIALIZED_KEY_ORDER.map((key) => [
						key,
						key === 'weights'
							? Object.fromEntries(ARCHIVE_COLOURS.map((colour) => [colour, entry.weights[colour]]))
							: entry[key]
					])
				)
			)
		);
	return lines.length ? `${lines.join('\n')}\n` : '';
}

export function isColourCacheHit(
	entry: ColourCacheEntry | undefined,
	key: ColourCacheKey
): boolean {
	return (
		entry !== undefined &&
		entry.block_id === key.blockId &&
		entry.image_src_hash === key.imageSourceHash &&
		entry.colour_version === key.colourVersion
	);
}

/**
 * Drops entries for blocks no longer in the archive. A block that failed this run keeps its previous
 * entry, so one unreachable image never strips colour a past run measured.
 */
export function mergeColourCache(
	previous: ColourCache,
	measured: Iterable<ColourCacheEntry>,
	liveBlockIds: ReadonlySet<string>
): ColourCacheEntry[] {
	const merged = new Map<string, ColourCacheEntry>();

	for (const [blockId, entry] of previous) {
		if (liveBlockIds.has(blockId)) merged.set(blockId, entry);
	}
	for (const entry of measured) {
		if (liveBlockIds.has(entry.block_id)) merged.set(entry.block_id, entry);
	}

	return [...merged.values()].sort((a, b) => a.block_id.localeCompare(b.block_id));
}
