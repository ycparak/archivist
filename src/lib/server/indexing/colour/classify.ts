import { ARCHIVE_COLOURS, type ArchiveColour } from '$lib/domain/search';

export type PixelColour = Exclude<ArchiveColour, 'mono'>;

/** Per-mille share of the measured pixels, one value per colour. */
export type ColourWeights = Record<ArchiveColour, number>;

const CHROMATIC: ReadonlySet<PixelColour> = new Set([
	'red',
	'orange',
	'yellow',
	'green',
	'blue',
	'purple',
	'pink',
	'brown'
]);

/** A pixel this transparent is not part of the picture. */
const MIN_OPAQUE_ALPHA = 128;

/** Below this chroma a pixel reads as black, grey or white rather than as a colour. */
const NEUTRAL_CHROMA = 0.045;
const BLACK_LIGHTNESS = 0.33;
const WHITE_LIGHTNESS = 0.93;

/** Upper bounds, in OKLCH hue degrees, of each hue band; pink wraps around zero. */
const HUE_BANDS: readonly [number, PixelColour][] = [
	[12, 'pink'],
	[45, 'red'],
	[75, 'orange'],
	[115, 'yellow'],
	[175, 'green'],
	[285, 'blue'],
	[340, 'purple'],
	[360, 'pink']
];

/** Warm hues this dark, or this muted, read as brown or tan rather than orange or yellow. */
const BROWN_HUES = { from: 30, to: 85 } as const;
const BROWN_MAX_LIGHTNESS = 0.6;
const TAN_MAX_CHROMA = 0.09;

const toLinear = (channel: number) => {
	const c = channel / 255;
	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

/** sRGB to OKLCH: lightness 0-1, chroma 0-~0.37, hue in degrees. */
export function toOklch(r: number, g: number, b: number): { l: number; c: number; h: number } {
	const lr = toLinear(r);
	const lg = toLinear(g);
	const lb = toLinear(b);
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	const hue = (Math.atan2(B, A) * 180) / Math.PI;
	return { l: L, c: Math.hypot(A, B), h: hue < 0 ? hue + 360 : hue };
}

export function classifyPixel(r: number, g: number, b: number): PixelColour {
	const { l, c, h } = toOklch(r, g, b);

	if (c < NEUTRAL_CHROMA) {
		if (l < BLACK_LIGHTNESS) return 'black';
		if (l > WHITE_LIGHTNESS) return 'white';
		return 'grey';
	}

	if (h >= BROWN_HUES.from && h < BROWN_HUES.to) {
		if (l < BROWN_MAX_LIGHTNESS || c < TAN_MAX_CHROMA) return 'brown';
	}

	for (const [upper, colour] of HUE_BANDS) {
		if (h < upper) return colour;
	}
	return 'pink';
}

/**
 * Weighs an RGBA raster: each colour's share of the opaque pixels, in per-mille. `mono` is the
 * share that is not chromatic, so a fully black-and-white image scores 1000. A raster with no
 * opaque pixel weighs nothing at all.
 */
export function weighColours(rgba: Uint8Array): ColourWeights {
	if (rgba.length % 4 !== 0) {
		throw new RangeError(`an RGBA raster has a multiple of 4 bytes, got ${rgba.length}`);
	}

	const counts = new Map<PixelColour, number>();
	let opaque = 0;
	let chromatic = 0;

	for (let i = 0; i < rgba.length; i += 4) {
		if (rgba[i + 3] < MIN_OPAQUE_ALPHA) continue;
		const colour = classifyPixel(rgba[i], rgba[i + 1], rgba[i + 2]);
		counts.set(colour, (counts.get(colour) ?? 0) + 1);
		opaque += 1;
		if (CHROMATIC.has(colour)) chromatic += 1;
	}

	const perMille = (count: number) => (opaque ? Math.round((count / opaque) * 1000) : 0);
	const weights = Object.fromEntries(
		ARCHIVE_COLOURS.map((colour) => [
			colour,
			colour === 'mono'
				? opaque
					? 1000 - perMille(chromatic)
					: 0
				: perMille(counts.get(colour) ?? 0)
		])
	) as ColourWeights;
	return weights;
}
