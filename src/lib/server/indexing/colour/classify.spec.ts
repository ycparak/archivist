import { describe, expect, it } from 'vitest';
import { classifyPixel, weighColours, type PixelColour } from './classify';

function rgb(hex: string): [number, number, number] {
	const n = parseInt(hex.slice(1), 16);
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** A raster of `count` copies of one opaque colour, or of one alpha value. */
function pixels(hex: string, count: number, alpha = 255): number[] {
	return Array.from({ length: count }, () => [...rgb(hex), alpha]).flat();
}

describe('classifyPixel', () => {
	it.each<[string, PixelColour]>([
		['#ff0000', 'red'],
		['#8b0000', 'red'],
		['#ff8000', 'orange'],
		['#ffd700', 'yellow'],
		['#808000', 'yellow'],
		['#008000', 'green'],
		['#00ffff', 'blue'],
		['#000080', 'blue'],
		['#312e81', 'blue'],
		['#4b0082', 'purple'],
		['#800080', 'purple'],
		['#ff00ff', 'purple'],
		['#ff69b4', 'pink'],
		['#ffc0cb', 'pink'],
		['#8b4513', 'brown'],
		['#d2b48c', 'brown'],
		['#6f4e37', 'brown'],
		['#000000', 'black'],
		['#333333', 'black'],
		['#808080', 'grey'],
		['#d1d5db', 'grey'],
		['#708090', 'grey'],
		['#ffffff', 'white'],
		['#f3f4f6', 'white']
	])('reads %s as %s', (hex, expected) => {
		expect(classifyPixel(...rgb(hex))).toBe(expected);
	});

	it('keeps a dark yellow out of brown, which is reserved for warmer hues', () => {
		expect(classifyPixel(...rgb('#a08000'))).not.toBe('brown');
	});
});

describe('weighColours', () => {
	it('gives each colour its share of the image in per-mille', () => {
		const raster = new Uint8Array([
			...pixels('#ff0000', 1),
			...pixels('#0000ff', 1),
			...pixels('#ffffff', 2)
		]);
		const weights = weighColours(raster);
		expect(weights.red).toBe(250);
		expect(weights.blue).toBe(250);
		expect(weights.white).toBe(500);
		expect(weights.green).toBe(0);
	});

	it('scores a black-and-white image as fully mono', () => {
		const raster = new Uint8Array([...pixels('#000000', 3), ...pixels('#ffffff', 1)]);
		expect(weighColours(raster).mono).toBe(1000);
	});

	it('takes the colourful share away from mono', () => {
		const raster = new Uint8Array([...pixels('#ff0000', 1), ...pixels('#ffffff', 3)]);
		expect(weighColours(raster).mono).toBe(750);
	});

	it('ignores transparent pixels, so a cut-out is judged by what is drawn', () => {
		const raster = new Uint8Array([...pixels('#00ff00', 1), ...pixels('#000000', 3, 0)]);
		const weights = weighColours(raster);
		expect(weights.green).toBe(1000);
		expect(weights.black).toBe(0);
	});

	it('weighs nothing at all when no pixel is opaque', () => {
		const weights = weighColours(new Uint8Array(pixels('#000000', 4, 0)));
		expect(Object.values(weights).every((weight) => weight === 0)).toBe(true);
	});

	it('rejects a buffer that is not whole RGBA pixels', () => {
		expect(() => weighColours(new Uint8Array(3))).toThrow(RangeError);
	});
});
