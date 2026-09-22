import { describe, expect, it } from 'vitest';
import { clampWidth, cursorUp, supportsColour, visibleLength } from './ansi';

describe('supportsColour', () => {
	it('takes colour on a terminal', () => {
		expect(supportsColour({}, true)).toBe(true);
	});

	it('does not colour a pipe or a redirected file', () => {
		expect(supportsColour({}, false)).toBe(false);
		expect(supportsColour({}, undefined)).toBe(false);
	});

	it('honours NO_COLOR over everything, including FORCE_COLOR', () => {
		expect(supportsColour({ NO_COLOR: '1' }, true)).toBe(false);
		expect(supportsColour({ NO_COLOR: '1', FORCE_COLOR: '1' }, true)).toBe(false);
	});

	it('lets FORCE_COLOR override the absence of a terminal', () => {
		expect(supportsColour({ FORCE_COLOR: '1' }, false)).toBe(true);
	});

	it('leaves a dumb terminal alone', () => {
		expect(supportsColour({ TERM: 'dumb' }, true)).toBe(false);
	});
});

describe('cursorUp', () => {
	it('emits nothing when there is nothing to move over', () => {
		expect(cursorUp(0)).toBe('');
		expect(cursorUp(-1)).toBe('');
	});

	it('moves by the number of lines drawn', () => {
		expect(cursorUp(3)).toBe('\x1b[3A');
	});
});

describe('visibleLength', () => {
	it('ignores escape codes, which occupy no columns', () => {
		expect(visibleLength('\x1b[32mdone\x1b[0m')).toBe(4);
	});
});

describe('clampWidth', () => {
	/**
	 * A wrapped line breaks the redraw: the region occupies more rows than the renderer moves the
	 * cursor back over, so every repaint leaves a stripe of debris behind it.
	 */
	it('cuts a long line to the terminal width', () => {
		expect(clampWidth('abcdefghij', 4)).toBe('abcd\x1b[0m');
	});

	it('leaves a line that already fits untouched', () => {
		expect(clampWidth('abc', 10)).toBe('abc');
	});

	it('counts visible characters, not escape codes', () => {
		const clamped = clampWidth('\x1b[32mabcdefgh\x1b[0m', 4);
		expect(visibleLength(clamped)).toBe(4);
		expect(clamped).toContain('\x1b[32m');
	});

	it('closes the colour it cut through, so the rest of the screen is not tinted', () => {
		expect(clampWidth('\x1b[31mabcdefgh', 3).endsWith('\x1b[0m')).toBe(true);
	});

	it('returns nothing for a terminal with no room', () => {
		expect(clampWidth('abc', 0)).toBe('');
	});
});
