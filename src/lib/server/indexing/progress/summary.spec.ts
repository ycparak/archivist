import { describe, expect, it } from 'vitest';
import type { SyncSummary } from '$lib/server/indexing/sync';
import { formatSyncSummary } from './summary';

const summary = (overrides: Partial<SyncSummary> = {}): SyncSummary => ({
	channelsDiscovered: 12,
	channelsIgnored: 1,
	channelsPrivateSkipped: 2,
	channelsSynced: 9,
	channelsFailed: [],
	blocksFetched: 400,
	itemsSkipped: 7,
	blocksNormalized: 393,
	uniqueBlocks: 350,
	colour: null,
	connections: null,
	vision: null,
	writeBack: null,
	...overrides
});

describe('formatSyncSummary', () => {
	it('reports the discovery counts and leaves out stages that did not run', () => {
		const lines = formatSyncSummary(summary());

		expect(lines.slice(0, 3)).toEqual(['', 'Sync summary:', '  Channels discovered: 12']);
		expect(lines).toContain('  Unique blocks:       350 (after dedup across channels)');
		expect(lines.some((line) => /Colour|Vision|Are\.na/.test(line))).toBe(false);
	});

	it('lists each failed channel with its error', () => {
		const lines = formatSyncSummary(
			summary({ channelsFailed: [{ slug: 'felt', error: 'timeout' }] })
		);

		expect(lines).toContain('  Channels failed:     1');
		expect(lines).toContain('    - felt: timeout');
	});
});
