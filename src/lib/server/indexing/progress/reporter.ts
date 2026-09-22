import {
	clampWidth,
	CLEAR_TO_END,
	COLOUR_PAINT,
	CURSOR_HIDE,
	CURSOR_SHOW,
	cursorUp,
	supportsColour
} from './ansi';
import type { SyncEvent } from './events';
import { formatSnapshot, PLAIN_PAINT, type Paint } from './format';
import { SyncProgress } from './state';

export interface OutputStream {
	write(chunk: string): void;
	isTTY?: boolean;
	columns?: number;
}

export interface SyncReporter {
	/** Detail worth keeping in the scroll-back. Scrolls above the status region, never into it. */
	log(message: string): void;
	emit(event: SyncEvent): void;
	/** Tears the region down so the final summary is plain, copyable text. */
	stop(): void;
}

export interface ReporterOptions {
	stream?: OutputStream;
	env?: Record<string, string | undefined>;
	now?: () => number;
	/** The region has to tick without events, or a slow phase looks frozen rather than slow. */
	intervalMs?: number;
	schedule?: (callback: () => void, ms: number) => { cancel: () => void };
}

const DEFAULT_INTERVAL_MS = 250;
const DEFAULT_COLUMNS = 80;

function defaultSchedule(callback: () => void, ms: number) {
	const timer = setInterval(callback, ms);
	// Nothing should be held alive by the display.
	timer.unref?.();
	return { cancel: () => clearInterval(timer) };
}

/**
 * A run's output in one place. On a terminal it keeps a status region pinned below the log; with a
 * pipe, a file or `NO_COLOR` it degrades to the line-based progress it always printed.
 */
export function createSyncReporter(options: ReporterOptions = {}): SyncReporter {
	const {
		stream = process.stdout as unknown as OutputStream,
		env = process.env as Record<string, string | undefined>,
		now,
		intervalMs = DEFAULT_INTERVAL_MS,
		schedule = defaultSchedule
	} = options;

	const progress = new SyncProgress({ now });
	const interactive = Boolean(stream.isTTY) && !env.NO_COLOR;
	const paint: Paint = supportsColour(env, stream.isTTY) ? COLOUR_PAINT : PLAIN_PAINT;

	return interactive
		? liveReporter({ stream, paint, progress, intervalMs, schedule })
		: plainReporter({ stream, progress });
}

function liveReporter(context: {
	stream: OutputStream;
	paint: Paint;
	progress: SyncProgress;
	intervalMs: number;
	schedule: NonNullable<ReporterOptions['schedule']>;
}): SyncReporter {
	const { stream, paint, progress, intervalMs, schedule } = context;

	let drawnLines = 0;
	let frame = 0;
	let stopped = false;

	const erase = () => {
		if (drawnLines === 0) return;
		stream.write(cursorUp(drawnLines) + CLEAR_TO_END);
		drawnLines = 0;
	};

	const draw = () => {
		if (stopped) return;
		const width = (stream.columns ?? DEFAULT_COLUMNS) - 1;
		const lines = formatSnapshot(progress.snapshot(), paint, { frame }).map((line) =>
			clampWidth(line, width)
		);
		stream.write(`${lines.join('\n')}\n`);
		drawnLines = lines.length;
	};

	stream.write(CURSOR_HIDE);
	draw();

	const ticker = schedule(() => {
		frame += 1;
		erase();
		draw();
	}, intervalMs);

	return {
		log(message) {
			erase();
			stream.write(`${message}\n`);
			draw();
		},
		emit(event) {
			progress.apply(event);
			erase();
			draw();
		},
		stop() {
			if (stopped) return;
			ticker.cancel();
			erase();
			stopped = true;
			stream.write(CURSOR_SHOW);
		}
	};
}

/**
 * Roughly ten updates per run whatever its size. A fixed interval of 25 meant a 12-block run
 * printed nothing at all until it finished, which reads as a hang.
 */
export function plainProgressInterval(total: number): number {
	return Math.max(1, Math.min(25, Math.ceil(total / 10)));
}

function plainReporter(context: { stream: OutputStream; progress: SyncProgress }): SyncReporter {
	const { stream, progress } = context;

	let total = 0;
	let completed = 0;
	let every = 1;

	return {
		log(message) {
			stream.write(`${message}\n`);
		},
		emit(event) {
			progress.apply(event);

			if (event.kind === 'vision-planned') {
				total = event.pending;
				completed = 0;
				every = plainProgressInterval(total);
				return;
			}

			if (event.kind !== 'vision-settled' || total === 0) return;

			completed += 1;
			// The final block always reports: without it the tail after the last interval runs
			// silently, which reads as a hang when each call can take minutes.
			if (completed % every === 0 || completed === total) {
				stream.write(`  ${completed}/${total} described\n`);
			}
		},
		stop() {}
	};
}
