import { layout, measureNaturalWidth, prepare, prepareWithSegments } from '@chenglou/pretext';

/**
 * Fills each column top to bottom before starting the next, so a long list flows sideways into as
 * many columns as it needs. An entry taller than a whole column still gets one to itself.
 */
export function packIntoColumns<T>(
	entries: readonly T[],
	columnHeight: number,
	entryHeight: (entry: T) => number
): T[][] {
	const columns: T[][] = [[]];
	let used = 0;
	for (const entry of entries) {
		const height = entryHeight(entry);
		const current = columns[columns.length - 1];
		if (current.length && used + height > columnHeight) {
			columns.push([entry]);
			used = height;
		} else {
			current.push(entry);
			used += height;
		}
	}
	return columns;
}

export type TextStyle = { font: string; lineHeight: number; letterSpacing: number };

export function readTextStyle(element: Element): TextStyle {
	const style = getComputedStyle(element);
	const fontSize = Number.parseFloat(style.fontSize);
	const letterSpacing = Number.parseFloat(style.letterSpacing);
	return {
		font: `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`,
		lineHeight: resolveLineHeight(style.lineHeight, fontSize),
		letterSpacing: Number.isFinite(letterSpacing) ? letterSpacing : 0
	};
}

export function resolveLineHeight(value: string, fontSize: number): number {
	if (value === 'normal') return fontSize * 1.2;
	const number = Number.parseFloat(value);
	if (!Number.isFinite(number)) return fontSize;
	return value.endsWith('px') ? number : number * fontSize;
}

/**
 * Wrapped height of a label at a width, measured with pretext rather than the DOM so a whole list
 * can be fitted without laying any of it out. The pixel shaved off the width absorbs the rounding
 * between canvas measurement and the browser's own line breaking.
 */
export function createLabelMeasure(style: TextStyle, width: number): (label: string) => number {
	const heights = new Map<string, number>();
	return (label) => {
		let height = heights.get(label);
		if (height === undefined) {
			const prepared = prepare(label, style.font, { letterSpacing: style.letterSpacing });
			height = layout(prepared, Math.max(1, width - 1), style.lineHeight).height;
			heights.set(label, height);
		}
		return height;
	};
}

export function createWidthMeasure(style: TextStyle): (value: string) => number {
	return (value) =>
		measureNaturalWidth(
			prepareWithSegments(value, style.font, { letterSpacing: style.letterSpacing })
		);
}
