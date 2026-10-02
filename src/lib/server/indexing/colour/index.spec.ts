import { describe, expect, it, vi } from 'vitest';
import type { ArchiveBlock } from '$lib/domain/archive';
import { ARCHIVE_COLOURS } from '$lib/domain/search';
import { imageSourceHash } from '../vision/rendition';
import { COLOUR_VERSION, type ColourCacheEntry } from './cache';
import type { ColourWeights } from './classify';
import type { MeasureResult } from './extract';
import { measureBlocks, planColourWork } from './index';

const IMAGE = 'https://d2w9rnfcy7mm78.cloudfront.net/1/original.png';
const WEIGHTS = Object.fromEntries(ARCHIVE_COLOURS.map((c) => [c, 0])) as ColourWeights;

function block(overrides: Partial<ArchiveBlock> = {}): ArchiveBlock {
	return {
		id: '1',
		type: 'Image',
		title: null,
		description: null,
		content: null,
		sourceTitle: null,
		sourceUrl: null,
		arenaUrl: 'https://www.are.na/block/1',
		imageUrl: IMAGE,
		imageAlt: null,
		imageWidth: null,
		imageHeight: null,
		imageBytes: 1000,
		imageContentType: 'image/png',
		channels: [{ slug: 'alpha', title: 'Alpha' }],
		...overrides
	} as ArchiveBlock;
}

function cached(id: string, imageUrl = IMAGE): ColourCacheEntry {
	return {
		block_id: id,
		image_src_hash: imageSourceHash(imageUrl),
		colour_version: COLOUR_VERSION,
		frames: 1,
		measured_at: '2026-10-01T00:00:00.000Z',
		weights: WEIGHTS
	};
}

const measured = (frames = 1): MeasureResult => ({
	kind: 'measured',
	weights: { ...WEIGHTS, red: 400 },
	frames
});

describe('planColourWork', () => {
	it('measures only blocks with an image that the cache does not already cover', () => {
		const blocks = [
			block({ id: '1' }),
			block({ id: '2' }),
			block({ id: '3', imageUrl: null, type: 'Text' }),
			block({ id: '4', imageUrl: 'https://d2w9rnfcy7mm78.cloudfront.net/4/new.png' })
		];
		const cache = new Map([
			['1', cached('1')],
			['4', cached('4')]
		]);
		const plan = planColourWork(blocks, cache);
		expect(plan.withImage).toHaveLength(3);
		expect(plan.cached).toBe(1);
		expect(plan.pending.map((b) => b.id)).toEqual(['2', '4']);
	});
});

describe('measureBlocks', () => {
	it('records a measurement with everything the cache needs to reuse it', async () => {
		const onEntry = vi.fn();
		const { entries, summary } = await measureBlocks([block({ id: '7' })], {
			cache: new Map(),
			measure: async () => measured(8),
			now: () => new Date('2026-10-02T00:00:00.000Z'),
			onEntry
		});
		expect(entries).toEqual([
			{
				block_id: '7',
				image_src_hash: imageSourceHash(IMAGE),
				colour_version: COLOUR_VERSION,
				frames: 8,
				measured_at: '2026-10-02T00:00:00.000Z',
				weights: { ...WEIGHTS, red: 400 }
			}
		]);
		expect(onEntry).toHaveBeenCalledWith(entries[0]);
		expect(summary.measured).toBe(1);
	});

	it('never downloads a cached block', async () => {
		const measure = vi.fn(async () => measured());
		const { summary } = await measureBlocks([block()], {
			cache: new Map([['1', cached('1')]]),
			measure
		});
		expect(measure).not.toHaveBeenCalled();
		expect(summary.cacheHits).toBe(1);
	});

	it('skips a format ffmpeg is not asked to read', async () => {
		const measure = vi.fn(async () => measured());
		const { entries, summary } = await measureBlocks(
			[block({ imageContentType: 'image/svg+xml' })],
			{ cache: new Map(), measure }
		);
		expect(measure).not.toHaveBeenCalled();
		expect(entries).toEqual([]);
		expect(summary.skippedUnsupported).toBe(1);
	});

	it('counts an unreachable and an oversized source apart', async () => {
		const results: MeasureResult[] = [
			{ kind: 'skipped', cause: 'unreachable', reason: 'source returned HTTP 404' },
			{ kind: 'skipped', cause: 'too-large', reason: 'over the limit' }
		];
		const { entries, summary } = await measureBlocks([block({ id: '1' }), block({ id: '2' })], {
			cache: new Map(),
			concurrency: 1,
			measure: async () => results.shift()!
		});
		expect(entries).toEqual([]);
		expect(summary.skippedUnreachable).toBe(1);
		expect(summary.skippedTooLarge).toBe(1);
	});

	it('collects a failure without losing the rest of the run', async () => {
		let calls = 0;
		const { entries, summary } = await measureBlocks([block({ id: '1' }), block({ id: '2' })], {
			cache: new Map(),
			concurrency: 1,
			measure: async () => {
				if (calls++ === 0) throw new Error('ffmpeg exited with code 1');
				return measured();
			}
		});
		expect(entries.map((e) => e.block_id)).toEqual(['2']);
		expect(summary.failed).toEqual([{ blockId: '1', error: 'ffmpeg exited with code 1' }]);
	});

	it('reports progress as each block settles, whatever the outcome', async () => {
		const onProgress = vi.fn();
		await measureBlocks(
			[block({ id: '1' }), block({ id: '2', imageContentType: 'image/svg+xml' })],
			{
				cache: new Map(),
				concurrency: 1,
				measure: async () => measured(),
				onProgress
			}
		);
		expect(onProgress.mock.calls).toEqual([
			[1, 2],
			[2, 2]
		]);
	});

	it('starts nothing once the run is aborted', async () => {
		const controller = new AbortController();
		controller.abort();
		const measure = vi.fn(async () => measured());
		await measureBlocks([block()], { cache: new Map(), measure, signal: controller.signal });
		expect(measure).not.toHaveBeenCalled();
	});
});
