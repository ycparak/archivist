import { describe, expect, it, vi } from 'vitest';
import { createArchiveSizeCache } from './archive-size';

describe('createArchiveSizeCache', () => {
	it('reuses a count until it expires, then asks again', async () => {
		let time = 0;
		const size = createArchiveSizeCache(1000, () => time);
		const load = vi.fn().mockResolvedValueOnce(10).mockResolvedValueOnce(12);

		expect(await size(load)).toBe(10);
		time = 999;
		expect(await size(load)).toBe(10);
		time = 1000;
		expect(await size(load)).toBe(12);
		expect(load).toHaveBeenCalledTimes(2);
	});

	it('shares one request between concurrent callers', async () => {
		const size = createArchiveSizeCache(1000, () => 0);
		const load = vi.fn().mockResolvedValue(7);

		expect(await Promise.all([size(load), size(load)])).toEqual([7, 7]);
		expect(load).toHaveBeenCalledTimes(1);
	});

	it('forgets a failed count so the next caller tries again', async () => {
		const size = createArchiveSizeCache(1000, () => 0);
		const load = vi.fn().mockRejectedValueOnce(new Error('down')).mockResolvedValueOnce(5);

		await expect(size(load)).rejects.toThrow('down');
		expect(await size(load)).toBe(5);
	});
});
