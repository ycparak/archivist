import { describe, expect, it } from 'vitest';
import { blockDisplayTitle, formatArchiveDate } from './format';

describe('formatArchiveDate', () => {
	it('formats a connected timestamp in UTC', () => {
		expect(formatArchiveDate('2024-01-02T09:15:00.000Z')).toBe('2 Jan 2024');
		expect(formatArchiveDate('2024-12-31T00:00:00.000Z')).toBe('31 Dec 2024');
	});

	it('does not shift the day for a timestamp near midnight UTC', () => {
		expect(formatArchiveDate('2024-01-01T23:30:00.000Z')).toBe('1 Jan 2024');
		expect(formatArchiveDate('2024-01-01T00:30:00.000Z')).toBe('1 Jan 2024');
	});

	it('returns nothing for a missing or unreadable value', () => {
		expect(formatArchiveDate(null)).toBeNull();
		expect(formatArchiveDate('')).toBeNull();
		expect(formatArchiveDate('not-a-date')).toBeNull();
	});
});

describe('blockDisplayTitle', () => {
	it('prefers the block’s own title', () => {
		expect(blockDisplayTitle('Industrial felt', 'Image')).toBe('Industrial felt');
	});

	it('labels an untitled block by its own type rather than inventing one', () => {
		expect(blockDisplayTitle(null, 'Image')).toBe('Untitled image');
		expect(blockDisplayTitle('', 'Attachment')).toBe('Untitled attachment');
		expect(blockDisplayTitle(null, 'Something new')).toBe('Untitled block');
	});
});
