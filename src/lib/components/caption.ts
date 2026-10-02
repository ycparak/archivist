import type { SearchResult } from '$lib/domain/search';
import { lowQualityTitleReason } from '$lib/domain/titles';
import { blockDisplayTitle } from './format';

export type CaptionSegment = { text: string; mark: boolean };

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Whole-word, case-insensitive matches for the phrase, or failing that for each word of it. */
export function keywordPattern(query: string): RegExp | null {
	const phrase = query.trim();
	if (!phrase) return null;
	const words = phrase.split(/\s+/).filter((word) => word.length > 1);
	const alternatives = [phrase, ...words.filter((word) => word !== phrase)].map(escapeRegExp);
	return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alternatives.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
}

export function firstKeywordIndex(text: string, query: string): number {
	const pattern = keywordPattern(query);
	if (!pattern) return -1;
	return pattern.exec(text)?.index ?? -1;
}

export function highlight(text: string, query: string): CaptionSegment[] {
	const pattern = keywordPattern(query);
	if (!pattern) return [{ text, mark: false }];
	const segments: CaptionSegment[] = [];
	let cursor = 0;
	for (const match of text.matchAll(pattern)) {
		if (match.index > cursor) segments.push({ text: text.slice(cursor, match.index), mark: false });
		segments.push({ text: match[0], mark: true });
		cursor = match.index + match[0].length;
	}
	if (cursor < text.length) segments.push({ text: text.slice(cursor), mark: false });
	return segments;
}

/**
 * The block's own words that best explain why it matched: the first field that names the query,
 * passing over a title that is only a filename or a hash.
 */
export function captionText(result: SearchResult, query: string): string {
	const title = lowQualityTitleReason(result.title, result.description) ? null : result.title;
	const fields = [title, result.description, result.sourceTitle].filter((field): field is string =>
		Boolean(field?.trim())
	);
	const matching = fields.find((field) => firstKeywordIndex(field, query) >= 0);
	return (matching ?? fields[0] ?? blockDisplayTitle(null, result.blockType)).trim();
}

/**
 * Where to start a caption so the first keyword is not clamped away: the latest word boundary that
 * still leaves most of a line of context before it. `measure` returns a string's rendered width.
 */
export function leadInOffset(
	text: string,
	keywordIndex: number,
	lineWidth: number,
	measure: (value: string) => number
): number {
	if (keywordIndex <= 0 || lineWidth <= 0) return 0;
	const boundaries = [...text.slice(0, keywordIndex).matchAll(/\s+/gu)].map(
		(match) => match.index + match[0].length
	);
	for (let index = boundaries.length - 1; index >= 0; index--) {
		const offset = boundaries[index];
		if (measure(`… ${text.slice(offset, keywordIndex)}`) >= lineWidth * 0.9) return offset;
	}
	return 0;
}

const connectedDate = new Intl.DateTimeFormat('en-GB', {
	day: 'numeric',
	month: 'short',
	year: 'numeric',
	timeZone: 'UTC'
});

export function formatConnectedDate(iso: string | null): string {
	if (!iso) return '';
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? '' : connectedDate.format(date);
}

export function connectedYears(blocks: readonly SearchResult[]): string {
	const years = blocks
		.map((block) => (block.connectedAt ? new Date(block.connectedAt).getUTCFullYear() : NaN))
		.filter((year) => Number.isFinite(year));
	if (!years.length) return '';
	const first = Math.min(...years);
	const last = Math.max(...years);
	return first === last ? String(first) : `${first}–${last}`;
}

export function blockCount(count: number): string {
	return `${count} ${count === 1 ? 'block' : 'blocks'}`;
}
