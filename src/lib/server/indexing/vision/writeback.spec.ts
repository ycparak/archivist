import { describe, expect, it, vi } from 'vitest';
import type { ArchiveBlock } from '$lib/domain/archive';
import type { VisionCacheEntry } from './cache';
import { applyWriteBack, planWriteBack } from './writeback';

const OWNER = 558206;
const OTHER = 999;

function block(overrides: Partial<ArchiveBlock> = {}): ArchiveBlock {
	return {
		id: '11',
		type: 'Image',
		title: 'cleanshot-2025.png',
		description: null,
		content: null,
		sourceTitle: null,
		sourceUrl: null,
		arenaUrl: 'https://www.are.na/block/11',
		imageUrl: 'https://images.are.na/abc',
		imageAlt: null,
		imageWidth: null,
		imageHeight: null,
		imageBytes: null,
		imageContentType: null,
		ownerId: OWNER,
		channels: [{ slug: 'a', title: 'A' }],
		...overrides
	} as ArchiveBlock;
}

function entry(id = '11'): VisionCacheEntry {
	return {
		block_id: id,
		image_src_hash: 'sha256:abc',
		prompt_version: 1,
		model: 'xiaomi/mimo-v2.5',
		provider: 'deepinfra',
		generated_at: '2026-09-21T00:00:00.000Z',
		title: 'Task planner over an orange gradient',
		description: 'A task planner interface with day columns on an orange gradient wallpaper.',
		ocr: '',
		palette: ['#ff6600'],
		medium: 'screenshot',
		tags: ['ui']
	};
}

const cache = new Map([['11', entry()]]);
const now = () => new Date('2026-09-21T12:00:00.000Z');

describe('planWriteBack — ownership', () => {
	it('never plans a write for a block someone else authored', () => {
		const { plans, skipped } = planWriteBack([block({ ownerId: OTHER })], cache, {
			ownerId: OWNER,
			now
		});
		expect(plans).toEqual([]);
		expect(skipped.notOwned).toBe(1);
	});

	it('skips a block with no generated text rather than blanking it', () => {
		const { plans, skipped } = planWriteBack([block({ id: '99' })], cache, { ownerId: OWNER, now });
		expect(plans).toEqual([]);
		expect(skipped.noVisionResult).toBe(1);
	});
});

describe('planWriteBack — titles', () => {
	it('replaces a filename title and records why', () => {
		const { plans } = planWriteBack([block()], cache, { ownerId: OWNER, now });
		expect(plans[0].title).toEqual({
			action: { kind: 'replace', reason: 'filename' },
			from: 'cleanshot-2025.png',
			to: 'Task planner over an orange gradient'
		});
	});

	it('adds a title when the block has none', () => {
		const { plans } = planWriteBack([block({ title: null })], cache, { ownerId: OWNER, now });
		expect(plans[0].title?.action).toEqual({ kind: 'add' });
		expect(plans[0].title?.from).toBeNull();
	});

	it('leaves a good title alone', () => {
		const { plans, skipped } = planWriteBack(
			[block({ title: 'Lightfield — AI-native CRM', description: 'An existing description.' })],
			cache,
			{ ownerId: OWNER, now }
		);
		expect(plans).toEqual([]);
		expect(skipped.nothingToChange).toBe(1);
	});

	it('replaces a verbose title that restates its own description', () => {
		const description =
			'Searching my library is now fast enough for live searches as I type, querying 100k paragraphs.';
		const { plans } = planWriteBack(
			[
				block({
					title: `Seth Thompson on X: "${description}" / X`,
					description
				})
			],
			cache,
			{ ownerId: OWNER, now }
		);
		expect(plans[0].title?.action).toMatchObject({ kind: 'replace' });
		expect(plans[0].update.title).toBe('Task planner over an orange gradient');
	});
});

describe('planWriteBack — descriptions', () => {
	it('adds a description when the block has none', () => {
		const { plans } = planWriteBack([block()], cache, { ownerId: OWNER, now });
		expect(plans[0].update.description).toBe(entry().description);
	});

	it('never overwrites a description the maintainer already has', () => {
		const { plans } = planWriteBack([block({ description: 'My own words.' })], cache, {
			ownerId: OWNER,
			now
		});
		expect(plans[0].description).toBeNull();
		expect(plans[0].update.description).toBeUndefined();
		expect(plans[0].update.title).toBeDefined();
	});
});

describe('planWriteBack — provenance', () => {
	it('stamps every write with the prompt version, time and image hash', () => {
		const { plans } = planWriteBack([block()], cache, { ownerId: OWNER, now });
		expect(plans[0].update.metadata).toEqual({
			vision_v: 1,
			vision_at: '2026-09-21T12:00:00.000Z',
			vision_src: 'sha256:abc'
		});
	});
});

describe('applyWriteBack', () => {
	const skipped = { notOwned: 0, noVisionResult: 0, nothingToChange: 0 };

	it('writes each planned block once and counts what changed', async () => {
		const { plans } = planWriteBack([block()], cache, { ownerId: OWNER, now });
		const updateBlock = vi.fn(async () => {});

		const summary = await applyWriteBack(plans, skipped, { updateBlock, delayFn: async () => {} });

		expect(updateBlock).toHaveBeenCalledWith(11, plans[0].update);
		expect(summary).toMatchObject({
			blocksUpdated: 1,
			titlesReplaced: 1,
			descriptionsAdded: 1,
			failed: []
		});
	});

	it('keeps going after a failed write and reports it', async () => {
		const blocks = [block({ id: '11' }), block({ id: '12' })];
		const twoCache = new Map([
			['11', entry('11')],
			['12', entry('12')]
		]);
		const { plans } = planWriteBack(blocks, twoCache, { ownerId: OWNER, now });
		const updateBlock = vi.fn(async (id: number) => {
			if (id === 11) throw new Error('403 forbidden');
		});

		const summary = await applyWriteBack(plans, skipped, { updateBlock, delayFn: async () => {} });

		expect(summary.blocksUpdated).toBe(1);
		expect(summary.failed).toEqual([{ blockId: '11', error: '403 forbidden' }]);
	});

	it('honours a limit so a first push can be staged', async () => {
		const blocks = ['11', '12', '13'].map((id) => block({ id }));
		const manyCache = new Map(blocks.map((b) => [b.id, entry(b.id)]));
		const { plans } = planWriteBack(blocks, manyCache, { ownerId: OWNER, now });
		const updateBlock = vi.fn(async () => {});

		await applyWriteBack(plans, skipped, { updateBlock, delayFn: async () => {}, limit: 2 });

		expect(updateBlock).toHaveBeenCalledTimes(2);
	});

	it('paces writes rather than firing them in parallel', async () => {
		const blocks = ['11', '12'].map((id) => block({ id }));
		const manyCache = new Map(blocks.map((b) => [b.id, entry(b.id)]));
		const { plans } = planWriteBack(blocks, manyCache, { ownerId: OWNER, now });
		const delays: number[] = [];

		await applyWriteBack(plans, skipped, {
			updateBlock: async () => {},
			delayFn: async (ms) => {
				delays.push(ms);
			}
		});

		expect(delays).toEqual([300]);
	});

	it('stops when the run is aborted', async () => {
		const blocks = ['11', '12', '13'].map((id) => block({ id }));
		const manyCache = new Map(blocks.map((b) => [b.id, entry(b.id)]));
		const { plans } = planWriteBack(blocks, manyCache, { ownerId: OWNER, now });
		const controller = new AbortController();
		const updateBlock = vi.fn(async () => {
			controller.abort();
		});

		const summary = await applyWriteBack(plans, skipped, {
			updateBlock,
			delayFn: async () => {},
			signal: controller.signal
		});

		expect(updateBlock).toHaveBeenCalledOnce();
		expect(summary.blocksUpdated).toBe(1);
	});
});
