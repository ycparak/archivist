<script lang="ts">
	import type { ArchiveSearchHref, ChannelManifestEntry } from '$lib/domain/search';
	import { resolve } from '$app/paths';

	let {
		channel,
		count,
		href,
		active
	}: { channel: ChannelManifestEntry; count: number; href: ArchiveSearchHref; active: boolean } =
		$props();
</script>

<a
	class="flex size-full flex-col justify-between bg-white p-[8cqw] text-black shadow-page outline-offset-4"
	href={resolve(href)}
	data-sveltekit-noscroll
	data-sveltekit-keepfocus
	aria-label={active ? `Stop filtering by ${channel.title}` : `Show only ${channel.title}`}
>
	<span class="clamp-6 font-serif text-[11cqw] leading-[1.1] text-balance">{channel.title}</span>
	<span class="flex items-end justify-between text-[6cqw] leading-none">
		<span>Are.na</span>
		<span>{count}</span>
	</span>
</a>
