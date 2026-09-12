import { z } from 'zod';
import { type ChannelManifestEntry } from '$lib/domain/search';
import manifestData from './channel-manifest.json';

export type { ChannelManifestEntry };

const channelManifestSchema: z.ZodType<ChannelManifestEntry[]> = z.array(
	z.object({ slug: z.string().min(1), title: z.string() })
);

/**
 * The channel list as of the last `bun run sync`. Bundled at build time from
 * `channel-manifest.json` — never fetched from Are.na at request time.
 */
export const channelManifest: ChannelManifestEntry[] = channelManifestSchema.parse(manifestData);

export function buildChannelManifest(
	channels: { slug: string; title: string }[]
): ChannelManifestEntry[] {
	const bySlug = new Map<string, ChannelManifestEntry>();
	for (const { slug, title } of channels) bySlug.set(slug, { slug, title });
	return [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

export function serializeChannelManifest(manifest: ChannelManifestEntry[]): string {
	return `${JSON.stringify(manifest, null, '\t')}\n`;
}
