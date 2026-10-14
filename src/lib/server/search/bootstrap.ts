import { checkedAsset } from '$lib/search/assets';
import { bootstrapSchema, releaseSchema } from '$lib/search/snapshot';
import { readArchiveSearchState } from '$lib/domain/search';

export async function loadSearchBootstrap(fetchFn: typeof fetch) {
	const response = await fetchFn('/search/manifest.json');
	if (!response.ok) throw new Error('Run bun run sync --export before building browser search');
	const release = releaseSchema.parse(await response.json());
	const bytes = await checkedAsset(release, release.bootstrap, fetchFn);
	const bootstrap = bootstrapSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
	if (bootstrap.blockCount !== release.blockCount) throw new Error('Bootstrap release mismatch');
	return {
		release,
		kind: 'ok' as const,
		state: readArchiveSearchState(new URLSearchParams()),
		...bootstrap
	};
}
