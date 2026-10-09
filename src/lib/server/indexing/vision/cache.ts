import { z } from 'zod';

/**
 * Generated descriptions are expensive to recreate and cheap to store, so the JSONL file is the
 * system of record — committed, portable, and outliving any the search snapshot namespace migration. The
 * skip key below is what guarantees `bun run sync` never pays for the same block twice.
 */
export const VISION_MEDIUMS = [
	'photograph',
	'illustration',
	'screenshot',
	'diagram',
	'typography',
	'3d',
	'painting',
	'collage',
	'other'
] as const;

export const visionResultSchema = z.object({
	title: z.string().trim().min(1).max(200),
	description: z.string().trim().min(1),
	ocr: z.string(),
	palette: z.array(z.string()),
	medium: z.enum(VISION_MEDIUMS),
	tags: z.array(z.string())
});

export type VisionResult = z.infer<typeof visionResultSchema>;

/** How the block was shown to the model. An animation read as a still is a different description. */
export const VISION_INPUT_MODES = ['image', 'video'] as const;
export type VisionInputMode = (typeof VISION_INPUT_MODES)[number];

export const visionCacheEntrySchema = visionResultSchema.extend({
	block_id: z.string().min(1),
	image_src_hash: z.string().min(1),
	prompt_version: z.number().int().nonnegative(),
	model: z.string().min(1),
	/** Absent on entries written before video input existed; those were all stills. */
	input_mode: z.enum(VISION_INPUT_MODES).default('image'),
	provider: z.string().min(1).nullable(),
	generated_at: z.iso.datetime()
});

export type VisionCacheEntry = z.infer<typeof visionCacheEntrySchema>;

/** The inputs that, taken together, decide whether a cached entry is still valid. */
export interface VisionCacheKey {
	blockId: string;
	imageSourceHash: string;
	promptVersion: number;
	model: string;
	inputMode: VisionInputMode;
}

export type VisionCache = ReadonlyMap<string, VisionCacheEntry>;

/**
 * Key order is fixed here rather than left to object construction order, so a re-run that changes
 * nothing produces a byte-identical file and an empty diff.
 */
const SERIALIZED_KEY_ORDER = [
	'block_id',
	'image_src_hash',
	'prompt_version',
	'model',
	'input_mode',
	'provider',
	'generated_at',
	'title',
	'description',
	'ocr',
	'palette',
	'medium',
	'tags'
] as const satisfies readonly (keyof VisionCacheEntry)[];

export function parseVisionCache(contents: string): Map<string, VisionCacheEntry> {
	const entries = new Map<string, VisionCacheEntry>();

	for (const [index, line] of contents.split('\n').entries()) {
		const trimmed = line.trim();
		if (!trimmed) continue;

		let raw: unknown;
		try {
			raw = JSON.parse(trimmed);
		} catch (error) {
			throw new Error(`vision cache line ${index + 1} is not valid JSON`, { cause: error });
		}

		const parsed = visionCacheEntrySchema.safeParse(raw);
		if (!parsed.success) {
			throw new Error(`vision cache line ${index + 1} is malformed: ${parsed.error.message}`);
		}
		entries.set(parsed.data.block_id, parsed.data);
	}

	return entries;
}

export function serializeVisionCache(entries: Iterable<VisionCacheEntry>): string {
	const lines = [...entries]
		.sort((a, b) => a.block_id.localeCompare(b.block_id))
		.map((entry) =>
			JSON.stringify(Object.fromEntries(SERIALIZED_KEY_ORDER.map((key) => [key, entry[key]])))
		);
	return lines.length ? `${lines.join('\n')}\n` : '';
}

/**
 * The skip decision, made before any network call — a cache hit costs nothing rather than costing
 * little. Regeneration happens only when the image behind the block changed, the prompt was
 * revised, or the model was swapped.
 */
export function isCacheHit(entry: VisionCacheEntry | undefined, key: VisionCacheKey): boolean {
	return (
		entry !== undefined &&
		entry.block_id === key.blockId &&
		entry.image_src_hash === key.imageSourceHash &&
		entry.prompt_version === key.promptVersion &&
		entry.model === key.model &&
		entry.input_mode === key.inputMode
	);
}

/**
 * Entries for blocks that are no longer in the archive are dropped, so the committed file tracks
 * the archive rather than accumulating orphans. Blocks that failed this run keep their previous
 * entry — a transient model failure must not discard work already paid for.
 */
export function mergeVisionCache(
	previous: VisionCache,
	generated: Iterable<VisionCacheEntry>,
	liveBlockIds: ReadonlySet<string>
): VisionCacheEntry[] {
	const merged = new Map<string, VisionCacheEntry>();

	for (const [blockId, entry] of previous) {
		if (liveBlockIds.has(blockId)) merged.set(blockId, entry);
	}
	for (const entry of generated) {
		if (liveBlockIds.has(entry.block_id)) merged.set(entry.block_id, entry);
	}

	return [...merged.values()].sort((a, b) => a.block_id.localeCompare(b.block_id));
}
