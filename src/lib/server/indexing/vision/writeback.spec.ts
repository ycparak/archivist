import { describe, expect, it, vi } from 'vitest';
import type { ArchiveBlock } from '$lib/domain/archive';
import type { VisionCacheEntry } from './cache';
import { ArenaRateLimitError } from '$lib/server/arena/client';
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
			blocksPlanned: 1,
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

	it('counts blocks planned, not field changes — one block can change two fields', async () => {
		const { plans } = planWriteBack([block()], cache, { ownerId: OWNER, now });
		const summary = await applyWriteBack(plans, skipped, {
			updateBlock: async () => {},
			delayFn: async () => {}
		});

		// This block changes both its title and its description; that is still one block.
		expect(summary.titlesReplaced + summary.descriptionsAdded).toBe(2);
		expect(summary.blocksPlanned).toBe(1);
	});

	it('honours a limit so a first push can be staged', async () => {
		const blocks = ['11', '12', '13'].map((id) => block({ id }));
		const manyCache = new Map(blocks.map((b) => [b.id, entry(b.id)]));
		const { plans } = planWriteBack(blocks, manyCache, { ownerId: OWNER, now });
		const updateBlock = vi.fn(async () => {});

		const summary = await applyWriteBack(plans, skipped, {
			updateBlock,
			delayFn: async () => {},
			limit: 2
		});

		expect(updateBlock).toHaveBeenCalledTimes(2);
		expect(summary.blocksPlanned).toBe(2);
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

		// Are.na allows 120 requests/minute for an authenticated free account.
		expect(delays).toEqual([500]);
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

describe('applyWriteBack — a credential that cannot write', () => {
	const skipped = { notOwned: 0, noVisionResult: 0, nothingToChange: 0 };

	function manyPlans(count: number) {
		const blocks = Array.from({ length: count }, (_, i) => block({ id: String(i + 1) }));
		const cacheFor = new Map(blocks.map((b) => [b.id, entry(b.id)]));
		return planWriteBack(blocks, cacheFor, { ownerId: OWNER, now }).plans;
	}

	it('stops after five leading failures instead of hammering every block', async () => {
		const updateBlock = vi.fn(async () => {
			throw new Error('Are.na request failed with status 401 updating block');
		});

		await expect(
			applyWriteBack(manyPlans(200), skipped, { updateBlock, delayFn: async () => {} })
		).rejects.toThrow(/Aborting Are.na write-back: the first 5 writes all failed/);

		expect(updateBlock).toHaveBeenCalledTimes(5);
	});

	it('names the likely cause rather than only the status code', async () => {
		const updateBlock = vi.fn(async () => {
			throw new Error('status 401');
		});

		await expect(
			applyWriteBack(manyPlans(10), skipped, { updateBlock, delayFn: async () => {} })
		).rejects.toThrow(/ARENA_ACCESS_TOKEN is read-only/);
	});

	it('does not abort once something has succeeded', async () => {
		let calls = 0;
		const updateBlock = vi.fn(async () => {
			calls += 1;
			if (calls > 1) throw new Error('transient');
		});

		const summary = await applyWriteBack(manyPlans(8), skipped, {
			updateBlock,
			delayFn: async () => {}
		});

		expect(summary.blocksUpdated).toBe(1);
		expect(summary.failed).toHaveLength(7);
	});
});

describe('applyWriteBack — rate limiting', () => {
	const skipped = { notOwned: 0, noVisionResult: 0, nothingToChange: 0 };

	function plansFor(count: number) {
		const blocks = Array.from({ length: count }, (_, i) => block({ id: String(i + 1) }));
		const cacheFor = new Map(blocks.map((b) => [b.id, entry(b.id)]));
		return planWriteBack(blocks, cacheFor, { ownerId: OWNER, now }).plans;
	}

	it('waits out a rate limit and writes the block rather than losing it', async () => {
		let calls = 0;
		const updateBlock = vi.fn(async () => {
			calls += 1;
			if (calls === 1) throw new ArenaRateLimitError('Rate limited updating block', 4000);
		});
		const waits: number[] = [];

		const summary = await applyWriteBack(plansFor(1), skipped, {
			updateBlock,
			delayFn: async (ms) => {
				waits.push(ms);
			}
		});

		expect(summary.blocksUpdated).toBe(1);
		expect(summary.failed).toEqual([]);
		expect(waits).toContain(4000);
	});

	it('honours the delay Are.na asked for rather than its own', async () => {
		const updateBlock = vi.fn(async () => {
			throw new ArenaRateLimitError('Rate limited', 9000);
		});
		const waits: number[] = [];

		await applyWriteBack(plansFor(1), skipped, {
			updateBlock,
			rateLimitRetries: 2,
			delayFn: async (ms) => {
				waits.push(ms);
			}
		});

		expect(waits).toEqual([9000, 9000]);
	});

	it('gives up on a block after its retries and keeps going', async () => {
		const updateBlock = vi.fn(async (id: number) => {
			if (id === 1) throw new ArenaRateLimitError('Rate limited', 10);
		});

		const summary = await applyWriteBack(plansFor(2), skipped, {
			updateBlock,
			rateLimitRetries: 1,
			delayFn: async () => {}
		});

		expect(summary.blocksUpdated).toBe(1);
		expect(summary.failed).toHaveLength(1);
	});

	it('does not retry an error Are.na did not ask us to wait on', async () => {
		const updateBlock = vi.fn(async () => {
			throw new Error('404 not found');
		});

		await applyWriteBack(plansFor(1), skipped, { updateBlock, delayFn: async () => {} });

		expect(updateBlock).toHaveBeenCalledOnce();
	});
});

describe('applyWriteBack — counts describe what happened', () => {
	const skipped = { notOwned: 0, noVisionResult: 0, nothingToChange: 0 };

	it('does not credit a title to a block whose write failed', async () => {
		const blocks = [block({ id: '1' }), block({ id: '2' })];
		const cacheFor = new Map(blocks.map((b) => [b.id, entry(b.id)]));
		const { plans } = planWriteBack(blocks, cacheFor, { ownerId: OWNER, now });
		const updateBlock = vi.fn(async (id: number) => {
			if (id === 2) throw new Error('boom');
		});

		const summary = await applyWriteBack(plans, skipped, { updateBlock, delayFn: async () => {} });

		expect(summary).toMatchObject({
			blocksPlanned: 2,
			blocksUpdated: 1,
			titlesReplaced: 1,
			descriptionsAdded: 1
		});
	});
});
