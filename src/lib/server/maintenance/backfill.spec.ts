import { describe, expect, it, vi } from 'vitest';
import type { ArchiveBlock } from '$lib/domain/archive';
import type { VisionCacheEntry } from '$lib/server/indexing/vision/cache';
import type { VisionClient } from '$lib/server/indexing/vision/client';
import { imageSourceHash } from '$lib/server/indexing/vision/rendition';
import {
	createSpendLimiter,
	estimateBackfillCost,
	planVisionBackfill,
	runVisionBackfill,
	visionBackfillPayloadSchema
} from './backfill';
import { bootstrapCaches, loadCanonicalCaches } from './caches';
import { buildCoverageReport, connectionState, visionState } from './coverage';
import { jobKeys } from './hosted-release';
import { acquireLease } from './lease';
import { memoryStore } from './store';

const target = { model: 'xiaomi/mimo-v2.5', promptVersion: 3 };
const channels = [{ slug: 'public', title: 'Public' }];
const block = (id: string, overrides: Partial<ArchiveBlock> = {}): ArchiveBlock => ({
	id,
	type: 'Image',
	arenaUrl: `https://www.are.na/block/${id}`,
	imageUrl: `https://cdn.test/${id}.png`,
	imageContentType: 'image/png',
	channels,
	...overrides
});
const entry = (id: string, overrides: Partial<VisionCacheEntry> = {}): VisionCacheEntry => ({
	block_id: id,
	image_src_hash: imageSourceHash(`https://cdn.test/${id}.png`),
	prompt_version: target.promptVersion,
	model: target.model,
	input_mode: 'image',
	provider: 'test',
	generated_at: '2026-10-01T00:00:00.000Z',
	title: `Title ${id}`,
	description: 'A description.',
	ocr: '',
	palette: [],
	medium: 'photograph',
	tags: [],
	...overrides
});
const pricing = { promptUsdPerToken: 0.00000014, completionUsdPerToken: 0.00000028 };

describe('coverage', () => {
	it('explains why each block is or is not usable', () => {
		const caches = {
			vision: new Map([
				['1', entry('1')],
				['2', entry('2', { image_src_hash: 'old' })],
				['3', entry('3', { prompt_version: 1 })],
				['4', entry('4', { model: 'other' })],
				['5', entry('5')]
			])
		};
		const states = [
			block('1'),
			block('2'),
			block('3'),
			block('4'),
			block('5', { imageContentType: 'image/gif' }),
			block('6'),
			block('7', { imageContentType: 'image/svg+xml' }),
			block('8', { imageUrl: null })
		].map((b) => visionState(b, caches, target));
		expect(states).toEqual([
			'valid',
			'stale-source',
			'stale-prompt',
			'stale-model',
			'stale-input-mode',
			'missing',
			'unsupported',
			'no-image'
		]);
	});

	it('bounds block lists and reports connection freshness separately', () => {
		const now = new Date('2026-10-14T00:00:00.000Z');
		const blocks = Array.from({ length: 5 }, (_, i) => block(String(i + 1)));
		const report = buildCoverageReport({
			jobId: 'daily-20261014',
			blocks,
			caches: {
				vision: new Map(),
				colour: new Map(),
				connections: new Map([
					['1', { block_id: '1', total: 1, counted_at: '2026-10-13T00:00:00.000Z' }],
					['2', { block_id: '2', total: 1, counted_at: '2026-09-01T00:00:00.000Z' }]
				])
			},
			outcomes: null,
			vision: target,
			now,
			listLimit: 2
		});
		expect(report.vision.states.missing).toEqual({ count: 5, blockIds: ['1', '2'] });
		expect(report.connections.states.fresh.count).toBe(1);
		expect(report.connections.states.stale.count).toBe(1);
		expect(report.connections.states.missing.count).toBe(3);
		expect(connectionState(blocks[0], { connections: new Map() }, now)).toBe('missing');
		expect(report.colour.recent.recorded).toBe(false);
		expect(report.byChannel.public).toEqual({
			blocks: 5,
			withImage: 5,
			visionValid: 0,
			colourValid: 0
		});
	});
});

describe('backfill planning', () => {
	const blocks = ['3', '10', '1', '2'].map((id) =>
		block(id, { channels: id === '2' ? [{ slug: 'other', title: 'Other' }] : channels })
	);
	const caches = { vision: new Map([['3', entry('3', { prompt_version: 1 })]]) };

	it('selects missing or stale blocks by channel and caps them in stable order', () => {
		const plan = planVisionBackfill({
			blocks,
			caches,
			client: target,
			selection: { channels: ['public'], include: ['missing', 'stale'] },
			maxBlocks: 2
		});
		expect(plan.selected.map(({ id }) => id)).toEqual(['1', '3']);
		expect(plan.overLimit).toBe(1);
		const missingOnly = planVisionBackfill({
			blocks,
			caches,
			client: target,
			selection: { blockIds: ['3', '2'], include: ['missing'] },
			maxBlocks: 10
		});
		expect(missingOnly.selected.map(({ id }) => id)).toEqual(['2']);
	});

	it('estimates from pricing and refuses to guess without it', () => {
		const estimate = estimateBackfillCost({ image: 100, video: 0 }, pricing);
		expect(estimate.known && estimate.expectedUsd).toBeCloseTo(
			100 * (3000 * 1.4e-7 + 700 * 2.8e-7)
		);
		expect(estimate.known && estimate.worstCaseUsd).toBeGreaterThan(
			estimate.known ? estimate.expectedUsd : 0
		);
		expect(estimateBackfillCost({ image: 1, video: 0 }, null).known).toBe(false);
	});

	it('rejects payloads above the hard block and budget ceilings', () => {
		const base = {
			jobId: 'backfill-one',
			discoveryJobId: 'daily-20261014',
			selection: { include: ['missing'] },
			maxBlocks: 10,
			budgetUsd: 1
		};
		expect(() => visionBackfillPayloadSchema.parse({ ...base, budgetUsd: 50 })).toThrow();
		expect(() => visionBackfillPayloadSchema.parse({ ...base, maxBlocks: 5000 })).toThrow();
	});
});

describe('spend limiter', () => {
	it('keeps spend plus in-flight reservations within the budget', () => {
		const limiter = createSpendLimiter({
			budgetUsd: 1,
			reservePerBlockUsd: 0.4,
			ceilingPerCallUsd: 0.1
		});
		const a = limiter.tryReserve()!;
		const b = limiter.tryReserve()!;
		expect(limiter.tryReserve()).toBeNull();
		a.onCost(0.01);
		a.settle();
		b.onCost(null);
		b.onCost(0.02);
		b.settle();
		expect(limiter.ledger()).toMatchObject({ requests: 3, unknownCostRequests: 1, inFlightUsd: 0 });
		expect(limiter.ledger().spentUsd).toBeCloseTo(0.13);
	});

	it('reserves at least the costliest block seen so far', () => {
		const limiter = createSpendLimiter({
			budgetUsd: 1,
			reservePerBlockUsd: 0.01,
			ceilingPerCallUsd: 0.01
		});
		const a = limiter.tryReserve()!;
		a.onCost(0.6);
		a.settle();
		expect(limiter.tryReserve()).toBeNull();
	});

	it('counts a crashed attempt’s in-flight exposure as spent', () => {
		const limiter = createSpendLimiter({
			budgetUsd: 1,
			reservePerBlockUsd: 0.4,
			ceilingPerCallUsd: 0.1,
			initial: { spentUsd: 0.1, blocks: 1, requests: 1, unknownCostRequests: 0, inFlightUsd: 0.4 }
		});
		expect(limiter.ledger().spentUsd).toBeCloseTo(0.5);
		expect(limiter.tryReserve()).not.toBeNull();
		expect(limiter.tryReserve()).toBeNull();
	});
});

describe('vision backfill', () => {
	async function setup(ids: string[]) {
		const store = memoryStore();
		const lease = await acquireLease(store, { holder: 'seed', renew: false });
		await bootstrapCaches(store, lease, {
			colour: new Map(),
			connections: new Map(),
			vision: new Map([['99', entry('99')]])
		});
		await lease.release();
		await store.put(
			jobKeys('daily-20261014').discovery,
			new TextEncoder().encode(
				JSON.stringify({
					format: 1,
					complete: true,
					ownerId: 1,
					channels,
					blocks: ids.map((id) => block(id)),
					summary: {},
					discoveredAt: '2026-10-14T06:00:00.000Z'
				})
			)
		);
		return store;
	}
	const client = (cost: number | null = 0.0005) => {
		const describe = vi.fn<VisionClient['describe']>(async ({ onCost }) => {
			onCost?.(cost);
			return {
				kind: 'described',
				result: {
					title: 'Generated',
					description: 'Generated text.',
					ocr: '',
					palette: [],
					medium: 'photograph',
					tags: []
				},
				provider: 'test'
			};
		});
		return { describe, client: { ...target, describe } satisfies VisionClient };
	};
	const payload = (overrides: Record<string, unknown> = {}) => ({
		jobId: 'backfill-one',
		discoveryJobId: 'daily-20261014',
		selection: { include: ['missing'] },
		maxBlocks: 10,
		budgetUsd: 1,
		concurrency: 1,
		...overrides
	});
	const deps = (store: ReturnType<typeof memoryStore>, c: VisionClient) => ({
		store,
		client: c,
		signal: new AbortController().signal,
		pricing,
		sleep: async () => {}
	});

	it('stops scheduling at the budget and merges what it generated without pruning', async () => {
		const store = await setup(['1', '2', '3', '4']);
		const { client: c, describe } = client(0.3);
		const report = await runVisionBackfill(payload({ budgetUsd: 1 }), deps(store, c));
		expect(describe).toHaveBeenCalledTimes(3);
		expect(report).toMatchObject({ planned: 4, generated: 3, budgetStopped: 1, requests: 3 });
		expect(report.spentUsd).toBeCloseTo(0.9);
		const vision = (await loadCanonicalCaches(store)).caches.vision;
		expect([...vision.keys()].sort()).toEqual(['1', '2', '3', '99']);
	});

	it('resumes without re-describing settled blocks and waits out a held lease', async () => {
		const store = await setup(['1', '2']);
		const abort = new AbortController();
		const first = client();
		first.describe.mockImplementation(async ({ onCost }) => {
			onCost?.(0.0005);
			abort.abort();
			return {
				kind: 'described',
				result: {
					title: 'Generated',
					description: 'Generated text.',
					ocr: '',
					palette: [],
					medium: 'photograph',
					tags: []
				},
				provider: 'test'
			};
		});
		await expect(
			runVisionBackfill(payload(), { ...deps(store, first.client), signal: abort.signal })
		).rejects.toThrow();
		expect(first.describe).toHaveBeenCalledTimes(1);
		const held = await acquireLease(store, { holder: 'daily', renew: false, ttlMs: 60_000 });
		const sleep = vi.fn(async () => held.release());
		const second = client();
		const report = await runVisionBackfill(payload(), { ...deps(store, second.client), sleep });
		expect(second.describe).toHaveBeenCalledTimes(1);
		expect(sleep).toHaveBeenCalled();
		expect(report).toMatchObject({ generated: 2, requests: 2 });
		expect((await loadCanonicalCaches(store)).caches.vision.size).toBe(3);
	});

	it('refuses to spend without pricing', async () => {
		const store = await setup(['1']);
		const { client: c, describe } = client();
		await expect(
			runVisionBackfill(payload(), { ...deps(store, c), pricing: null })
		).rejects.toThrow('pricing');
		expect(describe).not.toHaveBeenCalled();
	});
});
