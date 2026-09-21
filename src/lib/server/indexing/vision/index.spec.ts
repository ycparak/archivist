import { describe, expect, it, vi } from 'vitest';
import type { ArchiveBlock } from '$lib/domain/archive';
import type { VisionCacheEntry } from './cache';
import type { DescribeInput, DescribeOutcome, VisionClient } from './client';
import { describeBlocks, planVisionWork } from './index';
import { imageSourceHash } from './rendition';

const IMAGE = 'https://d2w9rnfcy7mm78.cloudfront.net/1/original.gif';

function block(overrides: Partial<ArchiveBlock> = {}): ArchiveBlock {
	return {
		id: '1',
		type: 'Image',
		title: 'image.png',
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
		imageContentType: 'image/gif',
		channels: [{ slug: 'alpha', title: 'Alpha' }],
		...overrides
	} as ArchiveBlock;
}

const RESULT = {
	title: 'A title',
	description: 'A description',
	ocr: '',
	palette: ['#000000'],
	medium: 'screenshot' as const,
	tags: ['tag']
};

function entryFor(id: string, imageUrl = IMAGE): VisionCacheEntry {
	return {
		...RESULT,
		block_id: id,
		image_src_hash: imageSourceHash(imageUrl),
		prompt_version: 1,
		model: 'test-model',
		input_mode: 'image',
		provider: 'test',
		generated_at: '2026-09-21T00:00:00.000Z'
	};
}

function stubClient(
	describe: (input: DescribeInput) => Promise<DescribeOutcome> = async () => ({
		kind: 'described',
		result: RESULT,
		provider: 'test'
	})
): VisionClient & { describe: ReturnType<typeof vi.fn> } {
	return { model: 'test-model', promptVersion: 1, describe: vi.fn(describe) } as never;
}

const now = () => new Date('2026-09-21T12:00:00.000Z');

describe('planVisionWork', () => {
	it('ignores blocks with no image', () => {
		const plan = planVisionWork([block({ id: '1' }), block({ id: '2', imageUrl: null })], {
			client: stubClient(),
			cache: new Map()
		});
		expect(plan.withImage).toHaveLength(1);
		expect(plan.pending).toHaveLength(1);
	});

	it('counts a cached block as a hit and leaves it out of the work', () => {
		const plan = planVisionWork([block()], {
			client: stubClient(),
			cache: new Map([['1', entryFor('1')]])
		});
		expect(plan.cached).toBe(1);
		expect(plan.pending).toHaveLength(0);
	});

	it('caps pending work at the limit and reports the remainder', () => {
		const blocks = ['1', '2', '3', '4'].map((id) => block({ id }));
		const plan = planVisionWork(blocks, { client: stubClient(), cache: new Map(), limit: 2 });
		expect(plan.pending).toHaveLength(2);
		expect(plan.overLimit).toBe(2);
	});

	it('revises everything when asked', () => {
		const plan = planVisionWork([block()], {
			client: stubClient(),
			cache: new Map([['1', entryFor('1')]]),
			revise: true
		});
		expect(plan.pending).toHaveLength(1);
		expect(plan.cached).toBe(0);
	});

	it('revises only blocks in the named channels', () => {
		const blocks = [
			block({ id: '1', channels: [{ slug: 'alpha', title: 'Alpha' }] }),
			block({ id: '2', channels: [{ slug: 'beta', title: 'Beta' }] })
		];
		const cache = new Map([
			['1', entryFor('1')],
			['2', entryFor('2')]
		]);
		const plan = planVisionWork(blocks, {
			client: stubClient(),
			cache,
			revise: new Set(['beta'])
		});
		expect(plan.pending.map((item) => item.id)).toEqual(['2']);
		expect(plan.cached).toBe(1);
	});
});

describe('describeBlocks', () => {
	it('never calls the model for a cached block', async () => {
		const client = stubClient();
		const { summary } = await describeBlocks([block()], {
			client,
			cache: new Map([['1', entryFor('1')]]),
			now
		});

		expect(client.describe).not.toHaveBeenCalled();
		expect(summary).toMatchObject({ cacheHits: 1, generated: 0 });
	});

	it('regenerates when the image behind the block changed', async () => {
		const client = stubClient();
		const stale = entryFor('1', 'https://d2w9rnfcy7mm78.cloudfront.net/1/replaced.gif');
		await describeBlocks([block()], { client, cache: new Map([['1', stale]]), now });
		expect(client.describe).toHaveBeenCalledOnce();
	});

	it('stamps each entry with the provenance that forms the next skip key', async () => {
		const { entries } = await describeBlocks([block()], {
			client: stubClient(),
			cache: new Map(),
			now
		});

		expect(entries[0]).toMatchObject({
			block_id: '1',
			prompt_version: 1,
			model: 'test-model',
			provider: 'test',
			generated_at: '2026-09-21T12:00:00.000Z',
			image_src_hash: imageSourceHash(IMAGE)
		});
	});

	it('passes the block text through as context for the title', async () => {
		const client = stubClient();
		await describeBlocks(
			[block({ title: 'Seth on X: "..."', description: 'Live search', sourceTitle: 'X' })],
			{ client, cache: new Map(), now }
		);

		expect(client.describe.mock.calls[0][0].block).toEqual({
			type: 'Image',
			title: 'Seth on X: "..."',
			description: 'Live search',
			sourceTitle: 'X'
		});
	});

	it('records a skipped oversized image without counting it as a failure', async () => {
		const client = stubClient(async () => ({ kind: 'skipped', reason: 'too big' }));
		const { entries, summary } = await describeBlocks([block()], {
			client,
			cache: new Map(),
			now
		});

		expect(entries).toHaveLength(0);
		expect(summary.skippedTooLarge).toBe(1);
		expect(summary.failed).toHaveLength(0);
	});

	it('keeps going after a failure and reports it per block', async () => {
		const client = stubClient(async (input) => {
			if (input.block.title === 'bad') throw new Error('boom');
			return { kind: 'described', result: RESULT, provider: 'test' };
		});
		const { entries, summary } = await describeBlocks(
			[block({ id: '1', title: 'bad' }), block({ id: '2', title: 'good' })],
			{ client, cache: new Map(), now, concurrency: 1 }
		);

		expect(entries.map((item) => item.block_id)).toEqual(['2']);
		expect(summary.failed).toEqual([{ blockId: '1', error: 'boom' }]);
		expect(summary.generated).toBe(1);
	});

	it('writes no entry for a failed block, so the next run retries it', async () => {
		const client = stubClient(async () => {
			throw new Error('boom');
		});
		const { entries } = await describeBlocks([block()], { client, cache: new Map(), now });
		expect(entries).toEqual([]);
	});

	it('honours the limit so a run cannot overspend', async () => {
		const client = stubClient();
		const blocks = ['1', '2', '3'].map((id) => block({ id }));
		const { summary } = await describeBlocks(blocks, {
			client,
			cache: new Map(),
			limit: 1,
			now
		});

		expect(client.describe).toHaveBeenCalledOnce();
		expect(summary).toMatchObject({ generated: 1, skippedOverLimit: 2 });
	});

	/** Asserting only an upper bound would pass even if the pool ran everything one at a time. */
	it('runs exactly the configured number of descriptions at once', async () => {
		let active = 0;
		let peak = 0;
		const client = stubClient(async () => {
			active += 1;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active -= 1;
			return { kind: 'described', result: RESULT, provider: 'test' };
		});

		await describeBlocks(
			Array.from({ length: 40 }, (_, index) => block({ id: String(index) })),
			{ client, cache: new Map(), concurrency: 8, now }
		);

		expect(peak).toBe(8);
	});

	it('never starts more workers than there is work', async () => {
		let peak = 0;
		let active = 0;
		const client = stubClient(async () => {
			active += 1;
			peak = Math.max(peak, active);
			await new Promise((resolve) => setTimeout(resolve, 5));
			active -= 1;
			return { kind: 'described', result: RESULT, provider: 'test' };
		});

		await describeBlocks([block({ id: '1' }), block({ id: '2' })], {
			client,
			cache: new Map(),
			concurrency: 32,
			now
		});

		expect(peak).toBe(2);
	});

	it('reports the final block, so the tail does not look like a hang', async () => {
		const lines: string[] = [];
		await describeBlocks(
			Array.from({ length: 27 }, (_, index) => block({ id: String(index) })),
			{ client: stubClient(), cache: new Map(), concurrency: 4, now, log: (m) => lines.push(m) }
		);

		expect(lines).toContain('  25/27 described');
		expect(lines).toContain('  27/27 described');
	});
});

describe('describeBlocks — animated blocks', () => {
	function gif(overrides: Partial<ArchiveBlock> = {}): ArchiveBlock {
		return block({ imageContentType: 'image/gif', ...overrides });
	}

	it('leaves animations on the image path unless video is asked for', async () => {
		const client = stubClient();
		await describeBlocks([gif()], { client, cache: new Map(), now });

		expect(client.describe.mock.calls[0][0].media.kind).toBe('image');
	});

	it('regenerates an animation previously described as a still', async () => {
		const client = stubClient();
		const asStill = entryFor('1'); // input_mode: 'image'
		const { summary } = await describeBlocks([gif()], {
			client,
			cache: new Map([['1', asStill]]),
			video: true,
			now,
			transcodeOptions: { fetchFn: async () => new Response('x') }
		});

		expect(summary.cacheHits).toBe(0);
	});

	it('leaves a still alone when video is enabled — only animations change mode', async () => {
		const client = stubClient();
		const { summary } = await describeBlocks([block({ imageContentType: 'image/png' })], {
			client,
			cache: new Map([['1', entryFor('1')]]),
			video: true,
			now
		});

		expect(summary.cacheHits).toBe(1);
		expect(client.describe).not.toHaveBeenCalled();
	});

	it('records the input mode on the entry, so the next run can tell them apart', async () => {
		const { entries } = await describeBlocks([block()], {
			client: stubClient(),
			cache: new Map(),
			now
		});

		expect(entries[0].input_mode).toBe('image');
	});

	it('counts an animation that could not be transcoded as skipped, not failed', async () => {
		const client = stubClient();
		const { summary } = await describeBlocks([gif()], {
			client,
			cache: new Map(),
			video: true,
			now,
			// A 404 makes the transcode return a skip rather than throwing.
			transcodeOptions: { fetchFn: async () => new Response('', { status: 404 }) }
		});

		expect(summary.skippedTooLarge).toBe(1);
		expect(summary.failed).toEqual([]);
		expect(client.describe).not.toHaveBeenCalled();
	});
});
