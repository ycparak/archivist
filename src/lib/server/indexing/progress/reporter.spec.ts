import { describe, expect, it } from 'vitest';
import { CURSOR_HIDE, CURSOR_SHOW, visibleLength } from './ansi';
import { createSyncReporter, plainProgressInterval, type OutputStream } from './reporter';

/** Any "move the cursor back up over the region" sequence. */
const CURSOR_UP = new RegExp(`${String.fromCharCode(27)}\\[\\d+A`);

function fakeStream(overrides: Partial<OutputStream> = {}) {
	const chunks: string[] = [];
	return {
		chunks,
		written: () => chunks.join(''),
		/** What the user would actually be left looking at, with escape codes stripped. */
		lines: () =>
			chunks
				.join('')
				// eslint-disable-next-line no-control-regex -- stripping escape codes is the point.
				.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '')
				.split('\n')
				.filter(Boolean),
		stream: {
			write: (chunk: string) => {
				chunks.push(chunk);
			},
			...overrides
		} as OutputStream
	};
}

const ticker = () => {
	let fire: (() => void) | null = null;
	let cancelled = false;
	return {
		cancelled: () => cancelled,
		tick: () => fire?.(),
		schedule: (callback: () => void) => {
			fire = callback;
			return {
				cancel: () => {
					cancelled = true;
				}
			};
		}
	};
};

describe('createSyncReporter — plain output', () => {
	function plain(overrides: Partial<OutputStream> = {}) {
		const fake = fakeStream({ isTTY: false, ...overrides });
		return { fake, reporter: createSyncReporter({ stream: fake.stream, env: {} }) };
	}

	it('writes log lines straight through when there is no terminal', () => {
		const { fake, reporter } = plain();
		reporter.log('Resolved account: someone');
		expect(fake.written()).toBe('Resolved account: someone\n');
	});

	it('never emits an escape code into a pipe', () => {
		const { fake, reporter } = plain();
		reporter.emit({ kind: 'phase', phase: 'describing' });
		reporter.emit({ kind: 'vision-planned', pending: 3, cached: 0 });
		for (const id of ['a', 'b', 'c']) {
			reporter.emit({ kind: 'vision-settled', blockId: id, outcome: 'generated' });
		}
		reporter.stop();

		// eslint-disable-next-line no-control-regex -- asserting the absence of escape codes.
		expect(fake.written()).not.toMatch(/\x1b/);
	});

	/** The behaviour a 12-block run needs: a fixed interval of 25 printed nothing at all. */
	it('reports progress on a short run', () => {
		const { fake, reporter } = plain();
		reporter.emit({ kind: 'vision-planned', pending: 12, cached: 0 });
		for (let index = 0; index < 12; index += 1) {
			reporter.emit({ kind: 'vision-settled', blockId: String(index), outcome: 'generated' });
		}

		const progress = fake.lines().filter((line) => line.includes('described'));
		expect(progress.length).toBeGreaterThan(1);
		expect(progress.at(-1)).toBe('  12/12 described');
	});

	it('keeps a long run to roughly ten updates rather than hundreds', () => {
		const { fake, reporter } = plain();
		reporter.emit({ kind: 'vision-planned', pending: 400, cached: 0 });
		for (let index = 0; index < 400; index += 1) {
			reporter.emit({ kind: 'vision-settled', blockId: String(index), outcome: 'generated' });
		}

		const progress = fake.lines().filter((line) => line.includes('described'));
		expect(progress.length).toBeLessThanOrEqual(17);
		expect(progress.at(-1)).toBe('  400/400 described');
	});

	it('always reports the final block, so the tail does not look like a hang', () => {
		const { fake, reporter } = plain();
		reporter.emit({ kind: 'vision-planned', pending: 27, cached: 0 });
		for (let index = 0; index < 27; index += 1) {
			reporter.emit({ kind: 'vision-settled', blockId: String(index), outcome: 'generated' });
		}

		expect(fake.lines()).toContain('  27/27 described');
	});

	it('treats NO_COLOR on a terminal as a request for plain output', () => {
		const fake = fakeStream({ isTTY: true });
		const reporter = createSyncReporter({ stream: fake.stream, env: { NO_COLOR: '1' } });
		reporter.log('a line');
		reporter.stop();

		expect(fake.written()).toBe('a line\n');
	});
});

describe('plainProgressInterval', () => {
	it('adapts to the size of the run, and never reports less often than every 25', () => {
		expect(plainProgressInterval(12)).toBe(2);
		expect(plainProgressInterval(400)).toBe(25);
		expect(plainProgressInterval(1)).toBe(1);
		expect(plainProgressInterval(0)).toBe(1);
	});
});

describe('createSyncReporter — live region', () => {
	function live(columns = 200) {
		const fake = fakeStream({ isTTY: true, columns });
		const clock = ticker();
		const reporter = createSyncReporter({
			stream: fake.stream,
			env: { FORCE_COLOR: '1' },
			schedule: clock.schedule
		});
		return { fake, clock, reporter };
	}

	it('hides the cursor while it owns the screen and gives it back', () => {
		const { fake, reporter } = live();
		expect(fake.written()).toContain(CURSOR_HIDE);

		reporter.stop();
		expect(fake.written()).toContain(CURSOR_SHOW);
	});

	it('stops the redraw timer, so a finished run holds nothing open', () => {
		const { clock, reporter } = live();
		reporter.stop();
		expect(clock.cancelled()).toBe(true);
	});

	/** The status region is replaced in place; a log line has to scroll above it, not into it. */
	it('erases the region before writing a log line and repaints it after', () => {
		const { fake, reporter } = live();
		fake.chunks.length = 0;
		reporter.log('  skipped 34661308: image/svg+xml is not a describable image');

		const written = fake.written();
		expect(written).toMatch(CURSOR_UP);
		expect(written).toContain('skipped 34661308');
		expect(written.indexOf('skipped 34661308')).toBeLessThan(written.indexOf('starting'));
	});

	it('redraws on a tick even when no event has arrived', () => {
		const { fake, clock } = live();
		fake.chunks.length = 0;
		clock.tick();

		expect(fake.written()).toMatch(CURSOR_UP);
		expect(fake.lines().some((line) => line.includes('starting'))).toBe(true);
	});

	it('shows what is in flight as soon as the events say so', () => {
		const { fake, reporter } = live();
		reporter.emit({ kind: 'phase', phase: 'describing' });
		reporter.emit({ kind: 'vision-planned', pending: 40, cached: 2552 });
		for (const id of ['a', 'b']) reporter.emit({ kind: 'vision-started', blockId: id });
		reporter.emit({ kind: 'vision-stage', blockId: 'a', stage: 'transcoding' });

		const lines = fake.lines();
		expect(lines.at(-2)).toContain('1 transcoding');
		expect(lines.at(-2)).toContain('1 awaiting model');
		expect(lines.at(-1)).toContain('2552 cached');
	});

	it('leaves nothing on screen once it stops, so the summary starts clean', () => {
		const { fake, reporter } = live();
		reporter.emit({ kind: 'phase', phase: 'done' });
		fake.chunks.length = 0;
		reporter.stop();

		expect(fake.written()).toBe(`\x1b[1A\x1b[0J${CURSOR_SHOW}`);
	});

	it('is safe to stop twice, which a signal handler plus a normal exit will do', () => {
		const { fake, reporter } = live();
		reporter.stop();
		const after = fake.written();
		reporter.stop();
		expect(fake.written()).toBe(after);
	});

	it('never draws a line wide enough to wrap, which would break the redraw', () => {
		const { fake, reporter } = live(40);
		reporter.emit({ kind: 'phase', phase: 'fetching' });
		reporter.emit({ kind: 'position', done: 42, total: 74, label: 'a-channel-with-a-long-slug' });

		for (const line of fake.lines()) expect(visibleLength(line)).toBeLessThanOrEqual(39);
	});
});
