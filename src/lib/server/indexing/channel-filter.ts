import type { ArenaOwnedChannel } from '$lib/server/arena/schemas';

export function parseSlugList(value: string | undefined): Set<string> {
	return new Set(
		(value ?? '')
			.split(',')
			.map((slug) => slug.trim())
			.filter(Boolean)
	);
}

/** Private channels are never synced; any other channel is skipped only when listed in `ignore`. */
export function exclusionReason(
	channel: Pick<ArenaOwnedChannel, 'slug' | 'visibility'>,
	ignore: ReadonlySet<string>
): 'ignored' | 'private' | undefined {
	if (ignore.has(channel.slug)) return 'ignored';
	if (channel.visibility === 'private') return 'private';
	return undefined;
}
