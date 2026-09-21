import { describe, expect, it } from 'vitest';
import {
	isCacheHit,
	lookupVisionResult,
	mergeVisionCache,
	parseVisionCache,
	serializeVisionCache,
	type VisionCacheEntry,
	type VisionCacheKey
} from './cache';

function entry(overrides: Partial<VisionCacheEntry> = {}): VisionCacheEntry {
	return {
		block_id: '17698965',
		image_src_hash: 'sha256:abc',
		prompt_version: 1,
		model: 'xiaomi/mimo-v2.5',
		input_mode: 'image',
		provider: 'deepinfra',
		generated_at: '2026-09-21T14:02:11.000Z',
		title: 'Dark-mode watch complications',
		description: 'A grid of twenty widget tiles on black.',
		ocr: 'AVG PACE',
		palette: ['#000000'],
		medium: 'screenshot',
		tags: ['dashboard'],
		...overrides
	};
}

const key: VisionCacheKey = {
	blockId: '17698965',
	imageSourceHash: 'sha256:abc',
	promptVersion: 1,
	model: 'xiaomi/mimo-v2.5',
	inputMode: 'image'
};

describe('isCacheHit', () => {
	it('reuses an entry when nothing that affects the output changed', () => {
		expect(isCacheHit(entry(), key)).toBe(true);
	});

	it('misses when there is no entry at all', () => {
		expect(isCacheHit(undefined, key)).toBe(false);
	});

	it.each([
		['the image was replaced', { image_src_hash: 'sha256:def' }],
		['the prompt was revised', { prompt_version: 2 }],
		['the model was swapped', { model: 'other/model' }]
	])('regenerates when %s', (_reason, overrides) => {
		expect(isCacheHit(entry(overrides), key)).toBe(false);
	});

	it('ignores fields that do not affect the output', () => {
		expect(isCacheHit(entry({ provider: 'venice' }), key)).toBe(true);
		expect(isCacheHit(entry({ generated_at: '2020-01-01T00:00:00.000Z' }), key)).toBe(true);
	});
});

describe('lookupVisionResult', () => {
	it('returns the entry on a hit and nothing on a stale entry', () => {
		const cache = new Map([['17698965', entry()]]);
		expect(lookupVisionResult(cache, key)?.title).toBe('Dark-mode watch complications');
		expect(lookupVisionResult(cache, { ...key, promptVersion: 2 })).toBeUndefined();
	});
});

describe('serializeVisionCache', () => {
	it('sorts by block id and ends with a newline, so diffs stay reviewable', () => {
		const output = serializeVisionCache([
			entry({ block_id: '30' }),
			entry({ block_id: '10' }),
			entry({ block_id: '20' })
		]);
		expect(
			output
				.trimEnd()
				.split('\n')
				.map((line) => JSON.parse(line).block_id)
		).toEqual(['10', '20', '30']);
		expect(output.endsWith('\n')).toBe(true);
	});

	it('is byte-identical regardless of the order keys were built in', () => {
		const reordered = Object.fromEntries(
			Object.entries(entry()).reverse()
		) as unknown as VisionCacheEntry;
		expect(serializeVisionCache([reordered])).toBe(serializeVisionCache([entry()]));
	});

	it('writes nothing for an empty cache rather than a blank line', () => {
		expect(serializeVisionCache([])).toBe('');
	});

	it('round-trips through parseVisionCache', () => {
		const entries = [entry({ block_id: '1' }), entry({ block_id: '2', ocr: '' })];
		expect([...parseVisionCache(serializeVisionCache(entries)).values()]).toEqual(entries);
	});
});

describe('parseVisionCache', () => {
	it('tolerates blank lines and a missing trailing newline', () => {
		const line = JSON.stringify(entry());
		expect(parseVisionCache(`\n${line}\n\n`).size).toBe(1);
		expect(parseVisionCache(line).size).toBe(1);
	});

	it('fails loudly on a corrupt line instead of silently dropping paid-for work', () => {
		expect(() => parseVisionCache('{ not json')).toThrow(/line 1 is not valid JSON/);
	});

	it('names the line when an entry is missing required fields', () => {
		const line = JSON.stringify({ ...entry(), block_id: undefined });
		expect(() => parseVisionCache(`${JSON.stringify(entry())}\n${line}`)).toThrow(
			/line 2 is malformed/
		);
	});

	it('rejects a medium outside the known set', () => {
		expect(() => parseVisionCache(JSON.stringify(entry({ medium: 'sculpture' as never })))).toThrow(
			/malformed/
		);
	});
});

describe('mergeVisionCache', () => {
	const live = new Set(['1', '2']);

	it('keeps prior entries for blocks that were skipped this run', () => {
		const merged = mergeVisionCache(new Map([['1', entry({ block_id: '1' })]]), [], live);
		expect(merged.map((item) => item.block_id)).toEqual(['1']);
	});

	it('overwrites a prior entry with a freshly generated one', () => {
		const merged = mergeVisionCache(
			new Map([['1', entry({ block_id: '1', title: 'old' })]]),
			[entry({ block_id: '1', title: 'new' })],
			live
		);
		expect(merged).toHaveLength(1);
		expect(merged[0].title).toBe('new');
	});

	it('drops entries for blocks that left the archive', () => {
		const previous = new Map([
			['1', entry({ block_id: '1' })],
			['99', entry({ block_id: '99' })]
		]);
		expect(mergeVisionCache(previous, [], live).map((item) => item.block_id)).toEqual(['1']);
	});

	it('ignores a generated entry for a block that is not live', () => {
		expect(mergeVisionCache(new Map(), [entry({ block_id: '99' })], live)).toEqual([]);
	});

	it('returns entries sorted by block id', () => {
		const merged = mergeVisionCache(
			new Map([['2', entry({ block_id: '2' })]]),
			[entry({ block_id: '1' })],
			live
		);
		expect(merged.map((item) => item.block_id)).toEqual(['1', '2']);
	});
});
