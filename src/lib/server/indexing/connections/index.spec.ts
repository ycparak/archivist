import { describe, expect, it, vi } from 'vitest';
import type { ArchiveBlock } from '$lib/domain/archive';
import type { ConnectionCacheEntry } from './cache';
import { countConnections, planConnectionWork } from './index';

const NOW = new Date('2026-10-05T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

function block(id: string): ArchiveBlock {
	return {
		id,
		type: 'Image',
		arenaUrl: `https://www.are.na/block/${id}`,
		channels: [{ slug: 'alpha', title: 'Alpha' }]
	} as ArchiveBlock;
}

function cached(id: string, ageMs = DAY, total = 5): ConnectionCacheEntry {
	return {
		block_id: id,
		total,
		counted_at: new Date(NOW.getTime() - ageMs).toISOString()
	};
}

describe('planConnectionWork', () => {
	it('counts only blocks that are missing or whose count is old', () => {
		const cache = new Map([
			['1', cached('1')],
			['2', cached('2', 8 * DAY)]
		]);
		const plan = planConnectionWork([block('1'), block('2'), block('3')], cache, NOW);
		expect(plan.cached).toBe(1);
		expect(plan.pending.map((b) => b.id)).toEqual(['2', '3']);
	});
});

describe('countConnections', () => {
	it('records each total with the time it was counted, and reports it as it lands', async () => {
		const onEntry = vi.fn();
		const { entries, summary } = await countConnections([block('7')], {
			cache: new Map(),
			count: async () => 11,
			now: () => NOW,
			onEntry
		});
		expect(entries).toEqual([{ block_id: '7', total: 11, counted_at: NOW.toISOString() }]);
		expect(onEntry).toHaveBeenCalledWith(entries[0]);
		expect(summary).toMatchObject({ blocks: 1, cacheHits: 0, counted: 1, failed: [] });
	});

	it('asks Are.na about the numeric id and passes the abort signal on', async () => {
		const count = vi.fn().mockResolvedValue(1);
		const controller = new AbortController();
		await countConnections([block('4242')], {
			cache: new Map(),
			count,
			now: () => NOW,
			signal: controller.signal
		});
		expect(count).toHaveBeenCalledWith(4242, controller.signal);
	});

	it('makes no request when every count is fresh', async () => {
		const count = vi.fn();
		const log = vi.fn();
		const { entries, summary } = await countConnections([block('1')], {
			cache: new Map([['1', cached('1')]]),
			count,
			now: () => NOW,
			log
		});
		expect(count).not.toHaveBeenCalled();
		expect(entries).toEqual([]);
		expect(summary).toMatchObject({ cacheHits: 1, counted: 0 });
		expect(log).toHaveBeenCalledWith('Connections: 1 cached, nothing to count');
	});

	it('collects a failure and still counts the rest', async () => {
		const log = vi.fn();
		const { entries, summary } = await countConnections([block('1'), block('2'), block('3')], {
			cache: new Map(),
			count: async (id) => {
				if (id === 2) throw new Error('Are.na request failed with status 404');
				return id;
			},
			now: () => NOW,
			log
		});
		expect(entries.map((e) => e.block_id).sort()).toEqual(['1', '3']);
		expect(summary.counted).toBe(2);
		expect(summary.failed).toEqual([
			{ blockId: '2', error: 'Are.na request failed with status 404' }
		]);
		expect(log).toHaveBeenCalledWith(
			'  connections failed 2: Are.na request failed with status 404'
		);
	});

	it('stays within its concurrency', async () => {
		let inFlight = 0;
		let peak = 0;
		await countConnections(
			Array.from({ length: 12 }, (_, i) => block(String(i + 1))),
			{
				cache: new Map(),
				concurrency: 3,
				now: () => NOW,
				count: async () => {
					peak = Math.max(peak, ++inFlight);
					await new Promise((resolve) => setTimeout(resolve, 1));
					inFlight -= 1;
					return 1;
				}
			}
		);
		expect(peak).toBe(3);
	});

	it('stops starting work once aborted', async () => {
		const controller = new AbortController();
		const count = vi.fn().mockImplementation(async () => {
			controller.abort();
			return 1;
		});
		const { summary } = await countConnections([block('1'), block('2'), block('3')], {
			cache: new Map(),
			concurrency: 1,
			count,
			now: () => NOW,
			signal: controller.signal
		});
		expect(count).toHaveBeenCalledTimes(1);
		expect(summary.counted).toBe(1);
	});

	it('reports progress for every block it settles, failures included', async () => {
		const onProgress = vi.fn();
		await countConnections([block('1'), block('2')], {
			cache: new Map(),
			concurrency: 1,
			now: () => NOW,
			count: async (id) => {
				if (id === 1) throw new Error('boom');
				return 1;
			},
			onProgress
		});
		expect(onProgress.mock.calls).toEqual([
			[1, 2],
			[2, 2]
		]);
	});
});
