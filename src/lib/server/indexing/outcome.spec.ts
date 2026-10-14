import { describe, expect, it } from 'vitest';
import type { ArchiveBlock } from '$lib/domain/archive';
import { measureBlock, measureBlocks } from './colour';
import { countBlock } from './connections';
import { isRetryableStatus } from './outcome';

const block = (overrides: Partial<ArchiveBlock> = {}): ArchiveBlock => ({
	id: '7',
	type: 'Image',
	arenaUrl: 'https://www.are.na/block/7',
	imageUrl: 'https://cdn.example/7.png',
	imageContentType: 'image/png',
	channels: [{ slug: 'public', title: 'Public' }],
	...overrides
});

describe('one-block outcomes', () => {
	it('classifies an unsupported format as a terminal skip without measuring', async () => {
		const outcome = await measureBlock(block({ imageContentType: 'image/svg+xml' }), {
			measure: async () => {
				throw new Error('should not measure');
			}
		});
		expect(outcome).toMatchObject({ kind: 'skipped', cause: 'unsupported', retryable: false });
	});

	it('turns a thrown error into a retryable failure instead of throwing', async () => {
		const outcome = await measureBlock(block(), {
			measure: async () => {
				throw new Error('socket hang up');
			}
		});
		expect(outcome).toEqual({ kind: 'failed', error: 'socket hang up' });
		await expect(
			countBlock(block(), {
				count: async () => {
					throw new Error('Are.na 503');
				}
			})
		).resolves.toEqual({ kind: 'failed', error: 'Are.na 503' });
	});

	it('reports every block without an entry to the outcome sink', async () => {
		const seen: [string, string][] = [];
		const result = await measureBlocks(
			[block(), block({ id: '8', imageUrl: 'https://cdn.example/8.png' })],
			{
				cache: new Map(),
				measure: async (url) =>
					url.includes('7')
						? { kind: 'skipped', cause: 'unreachable', reason: 'HTTP 503', retryable: true }
						: { kind: 'measured', weights: {} as never, frames: 1 },
				onOutcome: (id, outcome) => seen.push([id, outcome.kind])
			}
		);
		expect(seen).toEqual([['7', 'skipped']]);
		expect(result.summary).toMatchObject({ measured: 1, skippedUnreachable: 1 });
	});

	it('retries rate limits and server errors only', () => {
		expect([404, 403, 429, 500, 503].map(isRetryableStatus)).toEqual([
			false,
			false,
			true,
			true,
			true
		]);
	});
});
