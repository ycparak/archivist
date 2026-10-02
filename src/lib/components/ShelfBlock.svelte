<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import type { SearchResult } from '$lib/domain/search';
	import { blockDisplayTitle } from './format';

	let { result, eager = false }: { result: SearchResult; eager?: boolean } = $props();

	const title = $derived(blockDisplayTitle(result.title, result.blockType));
	const body = $derived(result.description ?? result.title ?? '');

	/**
	 * Playback is driven from the observer rather than the `autoplay` attribute. With `autoplay`
	 * every block off screen starts decoding the moment it mounts and is only paused afterwards,
	 * and the reduced-motion check has to win a race it does not reliably win.
	 */
	const playInView: Attachment<HTMLVideoElement> = (element) => {
		// Autoplay is a courtesy, not the content. A reader who asked for less motion keeps the
		// poster frame; the block still plays on Are.na, one click away.
		if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		// Belt and braces against the attribute not surviving hydration: an unmuted video is not
		// allowed to autoplay at all.
		element.muted = true;

		const observer = new IntersectionObserver(
			([entry]) => {
				// A rejected play() is the browser declining — low power mode, a background tab —
				// and there is nothing useful to do about it.
				if (entry.isIntersecting) void element.play().catch(() => {});
				else element.pause();
			},
			{ root: element.closest('[data-shelf-scroller]'), rootMargin: '0px 100px' }
		);

		observer.observe(element);
		return () => observer.disconnect();
	};
</script>

<a
	class="block size-full bg-white shadow-page outline-offset-4"
	href={result.arenaUrl}
	target="_blank"
	rel="external noopener noreferrer"
	aria-label={title}
>
	{#if result.videoUrl}
		<!-- The thumbnail is the poster, so the page looks identical before the first frame paints
		     and stays correct if the file never loads. No controls: the whole page is a link. -->
		<video
			class="block size-full object-cover"
			poster={result.imageUrl ?? undefined}
			width={result.imageWidth ?? undefined}
			height={result.imageHeight ?? undefined}
			preload="metadata"
			aria-hidden="true"
			muted
			loop
			playsinline
			{@attach playInView}
		>
			<source src={result.videoUrl} type={result.videoContentType ?? undefined} />
		</video>
	{:else if result.imageUrl}
		<img
			class="block size-full object-cover"
			src={result.imageUrl}
			alt={result.imageAlt ?? ''}
			width={result.imageWidth ?? undefined}
			height={result.imageHeight ?? undefined}
			loading={eager ? 'eager' : 'lazy'}
			decoding="async"
			referrerpolicy="no-referrer"
		/>
	{:else}
		<span
			class="block size-full overflow-hidden mask-[linear-gradient(to_bottom,black_80%,transparent)] p-[7cqw] font-serif text-[6.5cqw] leading-[1.35] wrap-anywhere text-black"
			>{body}</span
		>
	{/if}
</a>
