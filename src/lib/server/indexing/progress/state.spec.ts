import { describe, expect, it } from 'vitest';
import { SyncProgress } from './state';

function clock(start = 0) {
	let current = start;
	return {
		now: () => current,
		advance: (ms: number) => {
			current += ms;
		}
	};
}

describe('SyncProgress — phases', () => {
	it('starts before anything has been reported', () => {
		expect(new SyncProgress().snapshot().phase).toBe('starting');
	});

	it('drops the position when the phase changes, rather than carrying a stale count', () => {
		const progress = new SyncProgress();
		progress.apply({ kind: 'phase', phase: 'fetching' });
		progress.apply({ kind: 'position', done: 42, total: 74, label: 'a-channel' });
		expect(progress.snapshot().position).toEqual({ done: 42, total: 74, label: 'a-channel' });

		progress.apply({ kind: 'phase', phase: 'upserting' });
		expect(progress.snapshot().position).toBeNull();
	});
});

describe('SyncProgress — in flight', () => {
	it('counts what each worker is doing this second', () => {
		const progress = new SyncProgress();
		progress.apply({ kind: 'vision-planned', pending: 10, cached: 0 });
		for (const id of ['a', 'b', 'c']) progress.apply({ kind: 'vision-started', blockId: id });
		progress.apply({ kind: 'vision-stage', blockId: 'a', stage: 'transcoding' });

		expect(progress.snapshot().vision?.inFlight).toEqual([
			{ stage: 'transcoding', count: 1 },
			{ stage: 'awaiting-model', count: 2 }
		]);
	});

	/** A block stuck at 200s is the signal that was missing when a stalled socket hung a run. */
	it('measures the oldest wait from when the block started, not its latest stage', () => {
		const time = clock();
		const progress = new SyncProgress({ now: time.now });
		progress.apply({ kind: 'vision-planned', pending: 2, cached: 0 });
		progress.apply({ kind: 'vision-started', blockId: 'slow' });

		time.advance(90_000);
		progress.apply({ kind: 'vision-started', blockId: 'fresh' });
		// A stage change is progress, not a restart: resetting the clock here would hide the block
		// that has been stuck longest, which is the one worth seeing.
		progress.apply({ kind: 'vision-stage', blockId: 'slow', stage: 'awaiting-model' });

		expect(progress.snapshot().vision?.oldestWaitMs).toBe(90_000);
	});

	/** A display still claiming "178 awaiting model" during the upsert is worse than none. */
	it('clears what was in flight once the stage is over', () => {
		const progress = new SyncProgress();
		progress.apply({ kind: 'phase', phase: 'describing' });
		progress.apply({ kind: 'vision-planned', pending: 10, cached: 0 });
		progress.apply({ kind: 'vision-started', blockId: 'a' });
		progress.apply({ kind: 'vision-settled', blockId: 'a', outcome: 'generated' });
		progress.apply({ kind: 'vision-started', blockId: 'b' });

		progress.apply({ kind: 'phase', phase: 'upserting' });

		const vision = progress.snapshot().vision;
		expect(vision?.inFlight).toEqual([]);
		expect(vision?.oldestWaitMs).toBeNull();
		// The totals stay: they are still true, and still the thing worth reading.
		expect(vision?.generated).toBe(1);
	});

	it('forgets a block once it settles', () => {
		const progress = new SyncProgress();
		progress.apply({ kind: 'vision-planned', pending: 1, cached: 0 });
		progress.apply({ kind: 'vision-started', blockId: 'a' });
		progress.apply({ kind: 'vision-settled', blockId: 'a', outcome: 'generated' });

		const vision = progress.snapshot().vision;
		expect(vision?.inFlight).toEqual([]);
		expect(vision?.oldestWaitMs).toBeNull();
	});
});

describe('SyncProgress — totals', () => {
	it('separates generated, skipped and failed', () => {
		const progress = new SyncProgress();
		progress.apply({ kind: 'vision-planned', pending: 4, cached: 2552 });
		progress.apply({ kind: 'vision-settled', blockId: 'a', outcome: 'generated' });
		progress.apply({ kind: 'vision-settled', blockId: 'b', outcome: 'generated' });
		progress.apply({ kind: 'vision-settled', blockId: 'c', outcome: 'skipped' });
		progress.apply({ kind: 'vision-settled', blockId: 'd', outcome: 'failed' });

		expect(progress.snapshot().vision).toMatchObject({
			cached: 2552,
			completed: 4,
			generated: 2,
			skipped: 1,
			failed: 1
		});
	});
});

describe('SyncProgress — rate and projection', () => {
	function run(completions: number, msPerCompletion: number) {
		const time = clock();
		const progress = new SyncProgress({ now: time.now });
		progress.apply({ kind: 'vision-planned', pending: 100, cached: 0 });
		for (let index = 0; index < completions; index += 1) {
			time.advance(msPerCompletion);
			progress.apply({ kind: 'vision-settled', blockId: String(index), outcome: 'generated' });
		}
		return progress.snapshot().vision;
	}

	/**
	 * The original 3.5-hour projection extrapolated a single 39s sample and was out by a factor of
	 * five. Saying nothing is better than saying a number that confident.
	 */
	it('refuses to quote a rate from too few samples', () => {
		const vision = run(4, 1_000);
		expect(vision?.ratePerMinute).toBeNull();
		expect(vision?.etaMs).toBeNull();
	});

	it('quotes a measured rate once there is enough to measure', () => {
		const vision = run(10, 6_000);
		expect(vision?.ratePerMinute).toBeCloseTo(10, 5);
	});

	it('projects the remainder from that measured rate', () => {
		const vision = run(10, 6_000);
		// 90 left at 10/min.
		expect(vision?.etaMs).toBe(9 * 60_000);
	});

	it('reports no work left when everything has settled', () => {
		const time = clock();
		const progress = new SyncProgress({ now: time.now });
		progress.apply({ kind: 'vision-planned', pending: 6, cached: 0 });
		for (let index = 0; index < 6; index += 1) {
			time.advance(1_000);
			progress.apply({ kind: 'vision-settled', blockId: String(index), outcome: 'generated' });
		}

		expect(progress.snapshot().vision?.etaMs).toBe(0);
	});
});
