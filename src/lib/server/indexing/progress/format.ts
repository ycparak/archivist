import type { SyncPhase, VisionWorkStage } from './events';
import type { SyncSnapshot } from './state';

/**
 * Turns a snapshot into the lines of the status region. Pure and paint-agnostic: the tests assert
 * on what the screen claims, not on escape codes.
 */

export interface Paint {
	/** Labels and separators — present, but not competing with the numbers. */
	dim(text: string): string;
	head(text: string): string;
	ok(text: string): string;
	warn(text: string): string;
	bad(text: string): string;
}

export const PLAIN_PAINT: Paint = {
	dim: (text) => text,
	head: (text) => text,
	ok: (text) => text,
	warn: (text) => text,
	bad: (text) => text
};

const PHASE_LABELS: Record<SyncPhase, string> = {
	starting: 'starting',
	discovering: 'discovering',
	fetching: 'fetching',
	describing: 'describing',
	'writing-back': 'writing back',
	upserting: 'upserting',
	pruning: 'pruning',
	done: 'done'
};

const STAGE_LABELS: Record<VisionWorkStage, string> = {
	downloading: 'downloading',
	transcoding: 'transcoding',
	'awaiting-model': 'awaiting model'
};

export const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'] as const;

const LABEL_WIDTH = 12;
const BAR_WIDTH = 18;

export function formatDuration(ms: number): string {
	const seconds = Math.max(0, Math.round(ms / 1000));
	if (seconds < 60) return `${seconds}s`;

	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`;

	const hours = Math.floor(minutes / 60);
	return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
}

export function formatBar(done: number, total: number): string {
	if (total <= 0) return '';
	const filled = Math.min(BAR_WIDTH, Math.round((done / total) * BAR_WIDTH));
	return `▕${'█'.repeat(filled)}${'░'.repeat(BAR_WIDTH - filled)}▏`;
}

function percent(done: number, total: number): string {
	if (total <= 0) return '';
	return `${Math.floor((done / total) * 100)}%`.padStart(4);
}

function label(text: string): string {
	return text.padEnd(LABEL_WIDTH);
}

function join(parts: (string | null | undefined)[], paint: Paint): string {
	return parts.filter((part): part is string => Boolean(part)).join(paint.dim(' · '));
}

/**
 * The status region, newest state only — never appended to. Returns bare lines; the renderer owns
 * cursor movement and the trailing newlines.
 */
export function formatSnapshot(
	snapshot: SyncSnapshot,
	paint: Paint = PLAIN_PAINT,
	options: { frame?: number } = {}
): string[] {
	// Liveness is a property of the run, not of the vision stage: an upsert that takes a minute
	// should still look like it is moving.
	const busy = snapshot.phase !== 'done';
	const spinner = busy ? `${SPINNER_FRAMES[(options.frame ?? 0) % SPINNER_FRAMES.length]} ` : '  ';

	const lines: string[] = [headline(snapshot, paint, spinner)];

	const vision = snapshot.vision;
	if (!vision) return lines;

	if (vision.inFlight.length > 0) {
		const stages = vision.inFlight
			.map((group) => `${group.count} ${STAGE_LABELS[group.stage]}`)
			.join(paint.dim(' · '));
		const oldest =
			vision.oldestWaitMs === null
				? null
				: paint.dim('oldest ') + stalled(vision.oldestWaitMs, paint);
		lines.push(`  ${paint.dim(label('in flight'))}${join([stages, oldest], paint)}`);
	}

	const totals = join(
		[
			vision.cached ? paint.dim(`${vision.cached} cached`) : null,
			vision.generated ? paint.ok(`${vision.generated} generated`) : null,
			vision.skipped ? paint.warn(`${vision.skipped} skipped`) : null,
			vision.failed ? paint.bad(`${vision.failed} failed`) : null
		],
		paint
	);
	lines.push(`  ${paint.dim(label('totals'))}${totals || paint.dim('nothing settled yet')}`);

	return lines;
}

/**
 * A block in flight for minutes is the signal that was missing when a stalled socket hung a
 * multi-hour run, so it is coloured as a warning rather than left as one more grey number.
 */
const STALL_WARNING_MS = 120_000;

function stalled(waitMs: number, paint: Paint): string {
	const text = formatDuration(waitMs);
	return waitMs >= STALL_WARNING_MS ? paint.warn(text) : text;
}

function headline(snapshot: SyncSnapshot, paint: Paint, spinner: string): string {
	const phase = paint.head(label(PHASE_LABELS[snapshot.phase]));
	const vision = snapshot.vision;
	const elapsed = paint.dim(`${formatDuration(snapshot.elapsedMs)} elapsed`);

	if (snapshot.phase === 'describing' && vision) {
		return `${spinner}${phase}${join(
			[
				`${vision.completed}/${vision.total}`,
				formatBar(vision.completed, vision.total),
				percent(vision.completed, vision.total),
				vision.ratePerMinute === null
					? paint.dim('measuring rate')
					: `${vision.ratePerMinute.toFixed(1)}/min`,
				vision.etaMs === null ? null : paint.dim(`eta ${formatDuration(vision.etaMs)}`),
				elapsed
			],
			paint
		)}`;
	}

	const position = snapshot.position;
	return `${spinner}${phase}${join(
		[
			position ? `${position.done}/${position.total}` : null,
			position ? formatBar(position.done, position.total) : null,
			position ? percent(position.done, position.total) : null,
			position?.label ?? null,
			elapsed
		],
		paint
	)}`;
}
