import { describe, expect, it } from 'vitest';
import { buildChannelManifest, serializeChannelManifest } from './channel-manifest';

describe('buildChannelManifest', () => {
	it('sorts entries by slug', () => {
		const manifest = buildChannelManifest([
			{ slug: 'channel-b', title: 'Channel B' },
			{ slug: 'channel-a', title: 'Channel A' }
		]);

		expect(manifest.map((entry) => entry.slug)).toEqual(['channel-a', 'channel-b']);
	});

	it('dedupes by slug, keeping the last title seen', () => {
		const manifest = buildChannelManifest([
			{ slug: 'channel-a', title: 'Old Title' },
			{ slug: 'channel-a', title: 'New Title' }
		]);

		expect(manifest).toEqual([{ slug: 'channel-a', title: 'New Title' }]);
	});

	it('returns an empty list for no channels', () => {
		expect(buildChannelManifest([])).toEqual([]);
	});
});

describe('serializeChannelManifest', () => {
	it('pretty-prints with a trailing newline', () => {
		const serialized = serializeChannelManifest([{ slug: 'channel-a', title: 'Channel A' }]);

		expect(serialized).toBe(
			['[', '\t{', '\t\t"slug": "channel-a",', '\t\t"title": "Channel A"', '\t}', ']\n'].join('\n')
		);
	});

	it('serializes an empty manifest as an empty array', () => {
		expect(serializeChannelManifest([])).toBe('[]\n');
	});
});
