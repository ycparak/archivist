import { describe, expect, it } from 'vitest';
import { packIntoColumns, resolveLineHeight } from './index-layout';

describe('packIntoColumns', () => {
	it('fills each column before starting the next', () => {
		expect(packIntoColumns([1, 1, 1, 1, 1], 2, (height) => height)).toEqual([[1, 1], [1, 1], [1]]);
	});

	it('keeps an entry whole, moving it to the next column rather than splitting it', () => {
		expect(packIntoColumns([1, 2, 1], 3, (height) => height)).toEqual([[1, 2], [1]]);
		expect(packIntoColumns([2, 2], 3, (height) => height)).toEqual([[2], [2]]);
	});

	it('gives an entry taller than a column a column of its own', () => {
		expect(packIntoColumns([5, 1], 3, (height) => height)).toEqual([[5], [1]]);
	});

	it('returns one empty column for an empty list', () => {
		expect(packIntoColumns([], 3, () => 1)).toEqual([[]]);
	});
});

describe('resolveLineHeight', () => {
	it('reads pixels, multiplies a bare number, and approximates normal', () => {
		expect(resolveLineHeight('13.5px', 12)).toBe(13.5);
		expect(resolveLineHeight('1.5', 12)).toBe(18);
		expect(resolveLineHeight('normal', 10)).toBe(12);
	});
});
