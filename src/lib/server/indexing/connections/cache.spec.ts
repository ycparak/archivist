import { describe, expect, it } from 'vitest';
import {
	CONNECTION_COUNT_MAX_AGE_MS,
	isConnectionCacheHit,
	mergeConnectionCache,
	parseConnectionCache,
	serializeConnectionCache,
	type ConnectionCacheEntry
} from './cache';

const NOW = new Date('2026-10-05T12:00:00.000Z');

function entry(overrides: Partial<ConnectionCacheEntry> = {}): ConnectionCacheEntry {
	return { block_id: '17698965', total: 12, counted_at: '2026-10-04T12:00:00.000Z', ...overrides };
}

const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

describe('isConnectionCacheHit', () => {
	it('reuses a recent count', () => {
		expect(isConnectionCacheHit(entry(), NOW)).toBe(true);
	});

	it('recounts once the entry is as old as the window, and not before', () => {
		const justInside = entry({ counted_at: ago(CONNECTION_COUNT_MAX_AGE_MS - 1) });
		const exactly = entry({ counted_at: ago(CONNECTION_COUNT_MAX_AGE_MS) });
		expect(isConnectionCacheHit(justInside, NOW)).toBe(true);
		expect(isConnectionCacheHit(exactly, NOW)).toBe(false);
	});

	it('counts a block with no entry', () => {
		expect(isConnectionCacheHit(undefined, NOW)).toBe(false);
	});

	it('takes the window as an argument', () => {
		expect(isConnectionCacheHit(entry(), NOW, 1000)).toBe(false);
	});
});

describe('serializeConnectionCache', () => {
	it('round-trips through parse', () => {
		const entries = [entry(), entry({ block_id: '2', total: 0 })];
		const parsed = parseConnectionCache(serializeConnectionCache(entries));
		expect(parsed.get('17698965')).toEqual(entries[0]);
		expect(parsed.get('2')).toEqual(entries[1]);
	});

	it('writes the same bytes whatever order entries and keys arrive in', () => {
		const reordered = { counted_at: entry().counted_at, total: 12, block_id: '17698965' };
		const a = serializeConnectionCache([entry({ block_id: '2' }), entry()]);
		const b = serializeConnectionCache([reordered, entry({ block_id: '2' })]);
		expect(a).toBe(b);
		expect(a.split('\n')[0]).toBe(
			'{"block_id":"17698965","total":12,"counted_at":"2026-10-04T12:00:00.000Z"}'
		);
	});

	it('writes nothing for an empty cache', () => {
		expect(serializeConnectionCache([])).toBe('');
	});
});

describe('parseConnectionCache', () => {
	it('names the line that is not JSON', () => {
		expect(() => parseConnectionCache(`${serializeConnectionCache([entry()])}{oops\n`)).toThrow(
			/line 2 is not valid JSON/
		);
	});

	it.each([
		['a negative total', { total: -1 }],
		['a fractional total', { total: 1.5 }],
		['a missing date', { counted_at: undefined }],
		['a date that is not one', { counted_at: 'yesterday' }]
	])('rejects %s rather than ranking on it', (_reason, overrides) => {
		expect(() => parseConnectionCache(JSON.stringify({ ...entry(), ...overrides }))).toThrow(
			/line 1 is malformed/
		);
	});

	it('skips blank lines', () => {
		expect(parseConnectionCache(`\n${serializeConnectionCache([entry()])}\n\n`).size).toBe(1);
	});
});

describe('mergeConnectionCache', () => {
	const previous = new Map([
		['1', entry({ block_id: '1', total: 3 })],
		['2', entry({ block_id: '2', total: 4 })],
		['gone', entry({ block_id: 'gone' })]
	]);

	it('replaces a recounted block, keeps one that failed and drops one that left', () => {
		const merged = mergeConnectionCache(
			previous,
			[entry({ block_id: '1', total: 9 })],
			new Set(['1', '2'])
		);
		expect(merged.map((e) => [e.block_id, e.total])).toEqual([
			['1', 9],
			['2', 4]
		]);
	});

	it('does not add a count for a block that is not in the archive', () => {
		const merged = mergeConnectionCache(new Map(), [entry({ block_id: 'stray' })], new Set(['1']));
		expect(merged).toEqual([]);
	});
});
