import { describe, expect, it } from 'vitest';
import { exclusionReason, parseSlugList } from './channel-filter';

describe('parseSlugList', () => {
	it('splits on commas, trims, and drops empties', () => {
		expect(parseSlugList(' a, b ,,c ')).toEqual(new Set(['a', 'b', 'c']));
	});

	it('treats undefined as empty', () => {
		expect(parseSlugList(undefined)).toEqual(new Set());
	});
});

describe('exclusionReason', () => {
	const filter = new Set(['ignored']);

	it('excludes every private channel', () => {
		expect(exclusionReason({ slug: 'x', visibility: 'private' }, filter)).toBe('private');
		expect(exclusionReason({ slug: 'ignored', visibility: 'private' }, filter)).toBe('ignored');
	});

	it('ignores public and closed channels only when listed', () => {
		expect(exclusionReason({ slug: 'x', visibility: 'public' }, filter)).toBeUndefined();
		expect(exclusionReason({ slug: 'x', visibility: 'closed' }, filter)).toBeUndefined();
		expect(exclusionReason({ slug: 'ignored', visibility: 'public' }, filter)).toBe('ignored');
	});
});
