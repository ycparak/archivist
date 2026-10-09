/**
 * Structured progress, separate from the human-readable `log` stream. A renderer cannot say what is
 * happening right now by parsing log lines — by the time a line is printed the work it describes is
 * already over. These events report work as it starts, changes stage and settles, which is what
 * makes "31 awaiting the model, oldest 84s" possible to state at all.
 */

/** What a vision worker is doing this second. */
export const VISION_WORK_STAGES = ['downloading', 'transcoding', 'awaiting-model'] as const;
export type VisionWorkStage = (typeof VISION_WORK_STAGES)[number];

export type VisionOutcome = 'generated' | 'skipped' | 'failed';

export type SyncPhase =
	| 'starting'
	| 'discovering'
	| 'fetching'
	| 'measuring'
	| 'counting'
	| 'describing'
	| 'writing-back'
	| 'building'
	| 'publishing'
	| 'done';

export type SyncEvent =
	| { kind: 'phase'; phase: SyncPhase }
	/** Position within the current phase: channel 42 of 74, upsert batch 3 of 13. */
	| { kind: 'position'; done: number; total: number; label?: string | null }
	| { kind: 'vision-planned'; pending: number; cached: number }
	| { kind: 'vision-started'; blockId: string }
	| { kind: 'vision-stage'; blockId: string; stage: VisionWorkStage }
	| { kind: 'vision-settled'; blockId: string; outcome: VisionOutcome };

export type SyncEventSink = (event: SyncEvent) => void;
