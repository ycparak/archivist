import type { ChannelManifestEntry, SearchResult } from '$lib/domain/search';
import { mediaRatio } from './format';

/** Every length here is a fraction of the shelf band's height, so the whole layout scales with the viewport. */
export const SHELF = {
	padding: 0.05,
	rowGap: 0.05,
	rowCount: 2,
	rowHeight: (1 - 0.05 * 2 - 0.05) / 2,
	/** Pages stand a fifth shorter than their row, top-aligned, close to the reference's typical book. */
	pageHeight: 0.34,
	itemGap: 1 / 60,
	groupGap: 1 / 3,
	coverRatio: 0.7,
	textRatio: 0.75,
	scaleSegments: 10,
	scaleWidth: (0.34 * 10) / 12,
	maxBlocksPerGroup: 12
} as const;

/** A channel as the shelf shows it: its title without the leading symbol, which the cover shows apart. */
export type ShelfChannel = ChannelManifestEntry & { symbol?: string | null };

export type ShelfItem =
	| { kind: 'cover'; id: string; ratio: number }
	| { kind: 'block'; id: string; ratio: number; result: SearchResult };

export type ShelfGroup = {
	id: string;
	channel: ShelfChannel | null;
	blocks: SearchResult[];
	items: ShelfItem[];
	width: number;
};

export type PlacedGroup = ShelfGroup & { row: number; x: number };

export type ShelfLayout = {
	groups: PlacedGroup[];
	rowWidths: number[];
};

export function blockRatio(result: SearchResult): number {
	return result.imageUrl ? mediaRatio(result) : SHELF.textRatio;
}

/**
 * The channel a block is shelved under: the first of its channels the reader filtered by, else the
 * first the manifest knows, else whatever it was synced with.
 */
export function shelfChannel(
	result: SearchResult,
	channels: ReadonlyMap<string, ShelfChannel>,
	activeSlugs: readonly string[]
): ShelfChannel | null {
	const slug =
		result.channelSlugs.find((candidate) => activeSlugs.includes(candidate)) ??
		result.channelSlugs.find((candidate) => channels.has(candidate)) ??
		result.channelSlugs[0];
	if (!slug) return null;
	return channels.get(slug) ?? { slug, title: slug };
}

function groupWidth(items: ShelfItem[]): number {
	const ratios = items.reduce((sum, item) => sum + item.ratio, 0);
	return ratios * SHELF.pageHeight + Math.max(0, items.length - 1) * SHELF.itemGap;
}

/**
 * Shelves one page of results by channel, in the order each channel first appears, keeping rank
 * order inside a channel. A channel with more than a shelf's worth of blocks is split, and every
 * shelf opens with its channel's cover.
 */
export function groupResults(
	results: readonly SearchResult[],
	channels: ReadonlyMap<string, ShelfChannel>,
	activeSlugs: readonly string[]
): ShelfGroup[] {
	const byChannel = new Map<string, { channel: ShelfChannel | null; blocks: SearchResult[] }>();
	for (const result of results) {
		const channel = shelfChannel(result, channels, activeSlugs);
		const key = channel?.slug ?? '';
		const entry = byChannel.get(key) ?? { channel, blocks: [] };
		entry.blocks.push(result);
		byChannel.set(key, entry);
	}

	const groups: ShelfGroup[] = [];
	for (const { channel, blocks } of byChannel.values()) {
		for (let start = 0; start < blocks.length; start += SHELF.maxBlocksPerGroup) {
			const shelved = blocks.slice(start, start + SHELF.maxBlocksPerGroup);
			const id = shelved[0].id;
			const items: ShelfItem[] = shelved.map((result) => ({
				kind: 'block',
				id: result.id,
				ratio: blockRatio(result),
				result
			}));
			if (channel) items.unshift({ kind: 'cover', id: `cover:${id}`, ratio: SHELF.coverRatio });
			groups.push({ id, channel, blocks: shelved, items, width: groupWidth(items) });
		}
	}
	return groups;
}

/**
 * Places each shelf on whichever row is currently shortest. Pages are grouped separately and
 * placed in order, so loading another page appends shelves without moving any already on screen.
 */
export function layoutShelves(
	pages: readonly (readonly SearchResult[])[],
	channels: ReadonlyMap<string, ShelfChannel>,
	activeSlugs: readonly string[]
): ShelfLayout {
	const rowWidths = Array.from({ length: SHELF.rowCount }, () => 0);
	const groups: PlacedGroup[] = [];
	for (const page of pages) {
		for (const group of groupResults(page, channels, activeSlugs)) {
			const row = rowWidths.indexOf(Math.min(...rowWidths));
			const x = rowWidths[row] === 0 ? 0 : rowWidths[row] + SHELF.groupGap;
			rowWidths[row] = x + group.width;
			groups.push({ ...group, row, x });
		}
	}
	return { groups, rowWidths };
}

export function rowTop(row: number): number {
	return SHELF.padding + row * (SHELF.rowHeight + SHELF.rowGap);
}
