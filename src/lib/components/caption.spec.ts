import { describe, expect, it } from 'vitest';
import type { SearchResult } from '$lib/domain/search';
import {
	blockCount,
	captionText,
	connectedYears,
	firstKeywordIndex,
	formatConnectedDate,
	highlight,
	leadInOffset
} from './caption';

function result(overrides: Partial<SearchResult> = {}): SearchResult {
	return {
		id: '1',
		title: null,
		description: null,
		blockType: 'Image',
		channelSlugs: [],
		connectedAt: null,
		sourceUrl: null,
		arenaUrl: 'https://www.are.na/block/1',
		imageUrl: null,
		imageAlt: null,
		imageWidth: null,
		imageHeight: null,
		videoUrl: null,
		videoContentType: null,
		sourceTitle: null,
		...overrides
	};
}

describe('highlight', () => {
	it('marks whole-word matches of the phrase, ignoring case', () => {
		expect(highlight('Felt and felted felt', 'felt')).toEqual([
			{ text: 'Felt', mark: true },
			{ text: ' and felted ', mark: false },
			{ text: 'felt', mark: true }
		]);
	});

	it('falls back to the words of a phrase that does not appear whole', () => {
		const marked = highlight('Grey wool, pressed felt', 'felt wool')
			.filter((segment) => segment.mark)
			.map((segment) => segment.text);
		expect(marked).toEqual(['wool', 'felt']);
	});

	it('treats the query as text, not a pattern', () => {
		expect(highlight('C++ (2024)', 'C++')[0]).toEqual({ text: 'C++', mark: true });
		expect(highlight('anything', '')).toEqual([{ text: 'anything', mark: false }]);
	});
});

describe('captionText', () => {
	it('prefers the field that names the query, then the title', () => {
		const block = result({ title: 'Swatch', description: 'Pressed wool felt' });

		expect(captionText(block, 'felt')).toBe('Pressed wool felt');
		expect(captionText(block, 'cotton')).toBe('Swatch');
	});

	it('passes over a title that is only a filename', () => {
		expect(captionText(result({ title: 'IMG_2024.jpg', description: 'A felt swatch' }), '')).toBe(
			'A felt swatch'
		);
	});

	it('labels a block with no words of its own by its type', () => {
		expect(captionText(result({ blockType: 'Link' }), 'felt')).toBe('Untitled link');
	});
});

describe('leadInOffset', () => {
	const charWidth = (value: string) => value.length;

	it('keeps the start when the keyword already falls early', () => {
		const text = 'felt is here';
		expect(leadInOffset(text, firstKeywordIndex(text, 'felt'), 20, charWidth)).toBe(0);
	});

	it('starts at the latest word that still leaves most of a line before the keyword', () => {
		const text = 'one two three four five six seven felt';
		const offset = leadInOffset(text, firstKeywordIndex(text, 'felt'), 12, charWidth);

		expect(text.slice(offset)).toBe('six seven felt');
	});
});

describe('formatConnectedDate', () => {
	it('writes the day, short month and year in UTC, and nothing for a missing date', () => {
		expect(formatConnectedDate('2024-03-12T23:30:00.000Z')).toBe('12 Mar 2024');
		expect(formatConnectedDate(null)).toBe('');
		expect(formatConnectedDate('not a date')).toBe('');
	});
});

describe('connectedYears', () => {
	it('spans the years a shelf was connected in', () => {
		const at = (connectedAt: string | null) => result({ connectedAt });

		expect(connectedYears([at('2024-01-01T00:00:00Z'), at('2026-05-01T00:00:00Z')])).toBe(
			'2024–2026'
		);
		expect(connectedYears([at('2025-01-01T00:00:00Z'), at(null)])).toBe('2025');
		expect(connectedYears([at(null)])).toBe('');
	});
});

describe('blockCount', () => {
	it('counts in the singular and the plural', () => {
		expect(blockCount(1)).toBe('1 block');
		expect(blockCount(12)).toBe('12 blocks');
	});
});
