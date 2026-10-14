import { describe, expect, it } from 'vitest';
import { buildChannelManifest } from './channel-manifest';

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
