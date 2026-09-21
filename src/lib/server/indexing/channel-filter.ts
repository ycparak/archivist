import type { ArenaOwnedChannel } from '$lib/server/arena/schemas';

export interface ChannelFilter {
	ignore: ReadonlySet<string>;
	allowPrivate: ReadonlySet<string>;
}

export const EMPTY_CHANNEL_FILTER: ChannelFilter = { ignore: new Set(), allowPrivate: new Set() };

export function parseSlugList(value: string | undefined): Set<string> {
	return new Set(
		(value ?? '')
			.split(',')
			.map((slug) => slug.trim())
			.filter(Boolean)
	);
}

export type ChannelExclusion = 'ignored' | 'private';

export function exclusionReason(
	channel: Pick<ArenaOwnedChannel, 'slug' | 'visibility'>,
	filter: ChannelFilter
): ChannelExclusion | undefined {
	if (filter.ignore.has(channel.slug)) return 'ignored';
	if (channel.visibility === 'private' && !filter.allowPrivate.has(channel.slug)) return 'private';
	return undefined;
}
