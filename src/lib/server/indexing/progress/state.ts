import { VISION_WORK_STAGES, type SyncEvent, type SyncPhase, type VisionWorkStage } from './events';

interface InFlightGroup {
	stage: VisionWorkStage;
	count: number;
}

export interface VisionSnapshot {
	/** How many blocks this run will describe, excluding cache hits. */
	total: number;
	cached: number;
	completed: number;
	generated: number;
	skipped: number;
	failed: number;
	inFlight: InFlightGroup[];
	/** How long the longest-running block has been in flight, which is the stall signal. */
	oldestWaitMs: number | null;
	ratePerMinute: number | null;
	etaMs: number | null;
}

export interface PositionSnapshot {
	done: number;
	total: number;
	label: string | null;
}

export interface SyncSnapshot {
	phase: SyncPhase;
	position: PositionSnapshot | null;
	vision: VisionSnapshot | null;
	elapsedMs: number;
}

/**
 * A rate from one or two samples is what produced the original 3.5-hour projection that was out by
 * a factor of five. Below this the run reports that it is measuring rather than guessing.
 */
const MIN_SAMPLES_FOR_RATE = 5;

/**
 * Folds the event stream into something a renderer can draw. Deliberately free of I/O and of any
 * notion of a terminal, so the arithmetic that decides what the screen claims is directly testable.
 */
export class SyncProgress {
	readonly #now: () => number;
	readonly #startedAt: number;
	readonly #inFlight = new Map<string, { stage: VisionWorkStage; startedAt: number }>();

	#phase: SyncPhase = 'starting';
	#position: PositionSnapshot | null = null;
	#vision: {
		total: number;
		cached: number;
		generated: number;
		skipped: number;
		failed: number;
		startedAt: number;
	} | null = null;

	constructor(options: { now?: () => number } = {}) {
		this.#now = options.now ?? Date.now;
		this.#startedAt = this.#now();
	}

	apply(event: SyncEvent): void {
		switch (event.kind) {
			case 'phase':
				this.#phase = event.phase;
				// Position belongs to the phase that set it; carrying it across reads as a stale count.
				this.#position = null;
				// Nothing is awaiting the model once the stage is over, and a display still claiming
				// "178 awaiting model" during the upsert is exactly the stale confidence this replaces.
				if (event.phase !== 'describing') this.#inFlight.clear();
				return;

			case 'position':
				this.#position = { done: event.done, total: event.total, label: event.label ?? null };
				return;

			case 'vision-planned':
				this.#vision = {
					total: event.pending,
					cached: event.cached,
					generated: 0,
					skipped: 0,
					failed: 0,
					startedAt: this.#now()
				};
				return;

			case 'vision-started':
				this.#inFlight.set(event.blockId, {
					stage: 'awaiting-model',
					startedAt: this.#now()
				});
				return;

			case 'vision-stage': {
				const existing = this.#inFlight.get(event.blockId);
				// The block's own clock keeps running: a stage change is progress, not a fresh start,
				// and resetting it would hide exactly the block that has been stuck longest.
				this.#inFlight.set(event.blockId, {
					stage: event.stage,
					startedAt: existing?.startedAt ?? this.#now()
				});
				return;
			}

			case 'vision-settled':
				this.#inFlight.delete(event.blockId);
				if (!this.#vision) return;
				if (event.outcome === 'generated') this.#vision.generated += 1;
				else if (event.outcome === 'skipped') this.#vision.skipped += 1;
				else this.#vision.failed += 1;
				return;
		}
	}

	snapshot(): SyncSnapshot {
		const now = this.#now();
		return {
			phase: this.#phase,
			position: this.#position,
			vision: this.#visionSnapshot(now),
			elapsedMs: now - this.#startedAt
		};
	}

	#visionSnapshot(now: number): VisionSnapshot | null {
		const vision = this.#vision;
		if (!vision) return null;

		const completed = vision.generated + vision.skipped + vision.failed;
		const elapsed = now - vision.startedAt;

		const counts = new Map<VisionWorkStage, number>();
		let oldestStartedAt: number | null = null;
		for (const entry of this.#inFlight.values()) {
			counts.set(entry.stage, (counts.get(entry.stage) ?? 0) + 1);
			if (oldestStartedAt === null || entry.startedAt < oldestStartedAt) {
				oldestStartedAt = entry.startedAt;
			}
		}

		const measurable = completed >= MIN_SAMPLES_FOR_RATE && elapsed > 0;
		const perMs = measurable ? completed / elapsed : null;
		const remaining = Math.max(0, vision.total - completed);

		return {
			total: vision.total,
			cached: vision.cached,
			completed,
			generated: vision.generated,
			skipped: vision.skipped,
			failed: vision.failed,
			// Fixed stage order, so the line does not reshuffle itself between redraws.
			inFlight: VISION_WORK_STAGES.filter((stage) => counts.has(stage)).map((stage) => ({
				stage,
				count: counts.get(stage) ?? 0
			})),
			oldestWaitMs: oldestStartedAt === null ? null : now - oldestStartedAt,
			ratePerMinute: perMs === null ? null : perMs * 60_000,
			etaMs: perMs === null || perMs === 0 ? null : remaining / perMs
		};
	}
}
