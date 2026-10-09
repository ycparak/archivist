import { describe, expect, it } from 'vitest';
import { formatBar, formatDuration, formatSnapshot, PLAIN_PAINT, type Paint } from './format';
import type { SyncSnapshot } from './state';

const snapshot = (overrides: Partial<SyncSnapshot> = {}): SyncSnapshot => ({
	phase: 'describing',
	position: null,
	vision: null,
	elapsedMs: 0,
	...overrides
});

const vision = (overrides: Partial<NonNullable<SyncSnapshot['vision']>> = {}) => ({
	total: 100,
	cached: 2552,
	completed: 40,
	generated: 38,
	skipped: 1,
	failed: 1,
	inFlight: [],
	oldestWaitMs: null,
	ratePerMinute: null,
	etaMs: null,
	...overrides
});

describe('formatDuration', () => {
	it('stays in seconds below a minute', () => {
		expect(formatDuration(0)).toBe('0s');
		expect(formatDuration(38_400)).toBe('38s');
	});

	it('pads seconds so the number does not jitter in a redrawn region', () => {
		expect(formatDuration(4 * 60_000 + 3_000)).toBe('4m 03s');
	});

	it('drops to hours and minutes once a run is long', () => {
		expect(formatDuration(2 * 3_600_000 + 48 * 60_000)).toBe('2h 48m');
	});
});

describe('formatBar', () => {
	it('is empty when there is nothing to measure against', () => {
		expect(formatBar(3, 0)).toBe('');
	});

	it('fills in proportion to the work done', () => {
		expect(formatBar(0, 100)).toBe(`▕${'░'.repeat(18)}▏`);
		expect(formatBar(100, 100)).toBe(`▕${'█'.repeat(18)}▏`);
		expect(formatBar(50, 100)).toBe(`▕${'█'.repeat(9)}${'░'.repeat(9)}▏`);
	});
});

describe('formatSnapshot', () => {
	it('answers where the run is without needing the log above it', () => {
		const lines = formatSnapshot(
			snapshot({
				vision: vision({ ratePerMinute: 14.2, etaMs: 3_600_000, inFlight: [] }),
				elapsedMs: 271_000
			})
		);

		expect(lines[0]).toContain('describing');
		expect(lines[0]).toContain('40/100');
		expect(lines[0]).toContain('14.2/min');
		expect(lines[0]).toContain('eta 1h 00m');
		expect(lines[0]).toContain('4m 31s elapsed');
	});

	it('says it is measuring rather than inventing a rate', () => {
		const lines = formatSnapshot(snapshot({ vision: vision() }));
		expect(lines[0]).toContain('measuring rate');
		expect(lines[0]).not.toContain('eta');
	});

	it('names what is in flight and how long the oldest has waited', () => {
		const lines = formatSnapshot(
			snapshot({
				vision: vision({
					inFlight: [
						{ stage: 'transcoding', count: 1 },
						{ stage: 'awaiting-model', count: 31 }
					],
					oldestWaitMs: 84_000
				})
			})
		);

		expect(lines[1]).toContain('1 transcoding');
		expect(lines[1]).toContain('31 awaiting model');
		expect(lines[1]).toContain('oldest 1m 24s');
	});

	it('omits the in-flight line when nothing is running', () => {
		const lines = formatSnapshot(snapshot({ vision: vision() }));
		expect(lines.some((line) => line.includes('in flight'))).toBe(false);
	});

	it('breaks the totals out by outcome', () => {
		const totals = formatSnapshot(snapshot({ vision: vision() })).at(-1);
		expect(totals).toContain('2552 cached');
		expect(totals).toContain('38 generated');
		expect(totals).toContain('1 skipped');
		expect(totals).toContain('1 failed');
	});

	it('says so plainly before anything has settled', () => {
		const totals = formatSnapshot(
			snapshot({
				vision: vision({ cached: 0, completed: 0, generated: 0, skipped: 0, failed: 0 })
			})
		).at(-1);

		expect(totals).toContain('nothing settled yet');
	});

	it('keeps spinning through a phase with no vision work, so it still looks alive', () => {
		const lines = formatSnapshot(
			snapshot({ phase: 'building', position: { done: 3, total: 13, label: null } }),
			PLAIN_PAINT,
			{ frame: 0 }
		);

		expect(lines[0].startsWith('⠋ ')).toBe(true);
		expect(lines[0]).toContain('23%');
	});

	it('stops spinning once the run is done', () => {
		expect(formatSnapshot(snapshot({ phase: 'done' }))[0].startsWith('  ')).toBe(true);
	});

	it('shows the position for phases that are not the vision stage', () => {
		const lines = formatSnapshot(
			snapshot({ phase: 'fetching', position: { done: 42, total: 74, label: 'a-channel' } })
		);

		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('fetching');
		expect(lines[0]).toContain('42/74');
		expect(lines[0]).toContain('a-channel');
	});
});

describe('formatSnapshot — colour means something', () => {
	const tagged: Paint = {
		dim: (text) => `<dim>${text}</dim>`,
		head: (text) => `<head>${text}</head>`,
		ok: (text) => `<ok>${text}</ok>`,
		warn: (text) => `<warn>${text}</warn>`,
		bad: (text) => `<bad>${text}</bad>`
	};

	it('colours each outcome by what it means, never as decoration', () => {
		const totals = formatSnapshot(snapshot({ vision: vision() }), tagged).at(-1) ?? '';
		expect(totals).toContain('<ok>38 generated</ok>');
		expect(totals).toContain('<warn>1 skipped</warn>');
		expect(totals).toContain('<bad>1 failed</bad>');
	});

	it('warns on a block that has been in flight long enough to be stuck', () => {
		const stuck = formatSnapshot(
			snapshot({
				vision: vision({
					inFlight: [{ stage: 'awaiting-model', count: 1 }],
					oldestWaitMs: 200_000
				})
			}),
			tagged
		)[1];

		expect(stuck).toContain('<warn>3m 20s</warn>');
	});

	it('leaves a normal wait uncoloured, so the warning still reads as one', () => {
		const normal = formatSnapshot(
			snapshot({
				vision: vision({ inFlight: [{ stage: 'awaiting-model', count: 1 }], oldestWaitMs: 20_000 })
			}),
			tagged
		)[1];

		expect(normal).toContain('oldest </dim>20s');
		expect(normal).not.toContain('<warn>20s</warn>');
	});

	it('produces exactly the same text with no paint at all', () => {
		const painted = formatSnapshot(snapshot({ vision: vision() }), tagged).at(-1) ?? '';
		const plain = formatSnapshot(snapshot({ vision: vision() }), PLAIN_PAINT).at(-1) ?? '';
		expect(painted.replace(/<\/?[a-z]+>/g, '')).toBe(plain);
	});
});
