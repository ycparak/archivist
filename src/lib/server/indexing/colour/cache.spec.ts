import { describe, expect, it } from 'vitest';
import { ARCHIVE_COLOURS } from '$lib/domain/search';
import type { ColourWeights } from './classify';
import {
	COLOUR_VERSION,
	isColourCacheHit,
	mergeColourCache,
	parseColourCache,
	serializeColourCache,
	type ColourCacheEntry
} from './cache';

const WEIGHTS = Object.fromEntries(
	ARCHIVE_COLOURS.map((colour) => [colour, colour === 'blue' ? 600 : 0])
) as ColourWeights;

function entry(overrides: Partial<ColourCacheEntry> = {}): ColourCacheEntry {
	return {
		block_id: '17698965',
		image_src_hash: 'sha256:abc',
		colour_version: COLOUR_VERSION,
		frames: 1,
		measured_at: '2026-10-02T10:00:00.000Z',
		weights: WEIGHTS,
		...overrides
	};
}

const key = { blockId: '17698965', imageSourceHash: 'sha256:abc', colourVersion: COLOUR_VERSION };

describe('isColourCacheHit', () => {
	it('reuses an entry for the same image and classifier', () => {
		expect(isColourCacheHit(entry(), key)).toBe(true);
	});

	it.each([
		['there is no entry', undefined],
		['the image was replaced', entry({ image_src_hash: 'sha256:def' })],
		['the classifier changed', entry({ colour_version: COLOUR_VERSION + 1 })]
	])('re-measures when %s', (_reason, cached) => {
		expect(isColourCacheHit(cached, key)).toBe(false);
	});
});

describe('serializeColourCache', () => {
	it('round-trips through parse', () => {
		const entries = [entry(), entry({ block_id: '2', frames: 8 })];
		const parsed = parseColourCache(serializeColourCache(entries));
		expect(parsed.get('17698965')).toEqual(entries[0]);
		expect(parsed.get('2')).toEqual(entries[1]);
	});

	it('writes the same bytes whatever order entries and weights arrive in', () => {
		const reordered = entry({
			weights: Object.fromEntries(Object.entries(WEIGHTS).reverse()) as ColourWeights
		});
		const a = serializeColourCache([entry({ block_id: '2' }), entry()]);
		const b = serializeColourCache([reordered, entry({ block_id: '2' })]);
		expect(a).toBe(b);
		expect(a.split('\n')[0].startsWith('{"block_id":"17698965","image_src_hash"')).toBe(true);
		expect(a.indexOf('"red"')).toBeLessThan(a.indexOf('"mono"'));
	});

	it('writes nothing for an empty cache', () => {
		expect(serializeColourCache([])).toBe('');
	});
});

describe('parseColourCache', () => {
	it('names the line that is not JSON', () => {
		expect(() => parseColourCache(`${serializeColourCache([entry()])}{oops\n`)).toThrow(
			/line 2 is not valid JSON/
		);
	});

	it('rejects an entry missing a colour, rather than indexing it as zero', () => {
		const partial = Object.fromEntries(Object.entries(WEIGHTS).filter(([c]) => c !== 'mono'));
		const line = JSON.stringify({ ...entry(), weights: partial });
		expect(() => parseColourCache(line)).toThrow(/line 1 is malformed/);
	});

	it('rejects a weight outside per-mille', () => {
		const line = JSON.stringify({ ...entry(), weights: { ...WEIGHTS, red: 1001 } });
		expect(() => parseColourCache(line)).toThrow(/malformed/);
	});
});

describe('mergeColourCache', () => {
	it('drops blocks that left the archive and keeps what failed this run', () => {
		const previous = new Map([
			['1', entry({ block_id: '1' })],
			['gone', entry({ block_id: 'gone' })]
		]);
		const measured = [entry({ block_id: '2' })];
		const merged = mergeColourCache(previous, measured, new Set(['1', '2']));
		expect(merged.map((e) => e.block_id)).toEqual(['1', '2']);
	});

	it('prefers a fresh measurement over the cached one', () => {
		const previous = new Map([['1', entry({ block_id: '1', frames: 1 })]]);
		const merged = mergeColourCache(
			previous,
			[entry({ block_id: '1', frames: 8 })],
			new Set(['1'])
		);
		expect(merged[0].frames).toBe(8);
	});
});
