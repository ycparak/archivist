import type { ChannelManifestEntry } from '$lib/domain/search';

export function buildChannelManifest(
	channels: { slug: string; title: string }[]
): ChannelManifestEntry[] {
	const bySlug = new Map<string, ChannelManifestEntry>();
	for (const { slug, title } of channels) bySlug.set(slug, { slug, title });
	return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}
