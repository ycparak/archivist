<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Attachment } from 'svelte/attachments';
	import type { ArchiveSearchHref, ChannelManifestEntry } from '$lib/domain/search';
	import CaptionText from './CaptionText.svelte';
	import ShelfBlock from './ShelfBlock.svelte';
	import ShelfCover from './ShelfCover.svelte';
	import { blockCount, captionText, connectedYears, formatConnectedDate } from './caption';
	import { reveal } from './reveal';
	import { SHELF, rowTop, type ShelfLayout } from './shelf';

	let {
		layout,
		requestKey,
		query,
		busy = false,
		hasMore = false,
		loadingMore = false,
		loadFailed = false,
		coverHref,
		isActiveChannel,
		onloadmore,
		message
	}: {
		layout: ShelfLayout;
		requestKey: string;
		query: string;
		busy?: boolean;
		hasMore?: boolean;
		loadingMore?: boolean;
		loadFailed?: boolean;
		coverHref: (channel: ChannelManifestEntry) => ArchiveSearchHref;
		isActiveChannel: (channel: ChannelManifestEntry) => boolean;
		onloadmore: () => void;
		message?: Snippet;
	} = $props();

	const h = 'var(--shelf-h)';
	const width = $derived.by(() => {
		if (!layout.groups.length) return undefined;
		const [top, bottom] = layout.rowWidths;
		return `calc(max(${top} * ${h} + var(--top-row-inset), ${bottom} * ${h} + var(--bottom-row-inset)) + ${SHELF.padding * 2} * ${h})`;
	});

	function groupLeft(row: number, x: number): string {
		const inset = row === 0 ? 'var(--top-row-inset)' : 'var(--bottom-row-inset)';
		return `calc(${SHELF.padding + x} * ${h} + ${inset})`;
	}

	const watchEnd: Attachment<HTMLElement> = (node) => {
		void layout.groups.length;
		if (!hasMore || loadFailed) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) onloadmore();
			},
			{ root: node.closest('[data-shelf-scroller]'), rootMargin: '0px 1200px 0px 0px' }
		);
		observer.observe(node);
		return () => observer.disconnect();
	};
</script>

<section
	class="shelf grid h-full min-w-[calc(100cqi-var(--page-gutter))] flex-none grid-rows-[var(--annotation-area-height)_minmax(0,1fr)_var(--annotation-area-height)]"
	style:width
	aria-labelledby="shelf-heading"
>
	<h2 id="shelf-heading" class="sr-only">Results</h2>
	<div class="relative row-start-2 bg-band" aria-busy={busy}>
		<div
			class="absolute z-10 flex h-1.5 transition-[width] duration-(--duration-reveal) ease-out-expo"
			style:left="var(--shelf-padding)"
			style:top="var(--shelf-padding)"
			style:width="calc({SHELF.scaleWidth} * {h})"
			aria-hidden="true"
		>
			{#each { length: SHELF.scaleSegments }, index (index)}
				<span class={['flex-1', index % 2 === 0 ? 'bg-black' : 'bg-white']}></span>
			{/each}
		</div>

		{#if message}
			<div
				class="absolute max-w-64"
				style:left="calc(var(--shelf-padding) + var(--top-row-inset))"
				style:top="var(--shelf-padding)"
			>
				{@render message()}
			</div>
		{/if}

		<ul
			class={[
				'm-0 list-none p-0 transition-opacity duration-(--duration-fast)',
				busy && 'opacity-50'
			]}
		>
			{#each layout.groups as group, groupIndex (`${requestKey}:${group.id}`)}
				<li
					class="shelf-group absolute flex"
					data-reveal
					style:--row={group.row}
					style:left={groupLeft(group.row, group.x)}
					style:top="calc({rowTop(group.row)} * {h})"
					style:height="calc({SHELF.rowHeight} * {h})"
					style:gap="calc({SHELF.itemGap} * {h})"
					{@attach reveal}
				>
					{#each group.items as item, itemIndex (item.id)}
						<div
							class="relative h-full flex-none"
							style:width="calc({SHELF.pageHeight * item.ratio} * {h})"
						>
							<div
								class={[
									'shelf-caption absolute left-0 h-[calc(var(--annotation-area-height)-2*var(--annotation-padding))] w-full text-foreground',
									group.row === 0
										? 'bottom-[calc(100%+var(--shelf-padding)+var(--annotation-padding))]'
										: 'top-[calc(100%+var(--shelf-padding)+var(--annotation-padding))]'
								]}
								data-top-annotation={group.row === 0 ? '' : undefined}
							>
								{#if item.kind === 'cover' && group.channel}
									<div
										class={[
											'flex h-full flex-col border-l border-foreground-secondary-detail pl-2',
											group.row === 1 && 'justify-end'
										]}
									>
										<p class="clamp-7">
											<span class="text-foreground-strong">{group.channel.title}</span><br
											/>{blockCount(group.blocks.length)}<br />{connectedYears(group.blocks)}
										</p>
									</div>
								{:else if item.kind === 'block'}
									<div
										class={['flex h-full max-w-56 flex-col', group.row === 1 && 'flex-col-reverse']}
									>
										<div class="flex flex-col gap-(--gap-paragraph)">
											<p class="text-foreground-strong">
												{formatConnectedDate(item.result.connectedAt)}
											</p>
											<CaptionText text={captionText(item.result, query)} {query} />
										</div>
									</div>
								{/if}
							</div>

							<div class="@container-size w-full" style:height="calc({SHELF.pageHeight} * {h})">
								{#if item.kind === 'cover' && group.channel}
									<ShelfCover
										channel={group.channel}
										count={group.blocks.length}
										href={coverHref(group.channel)}
										active={isActiveChannel(group.channel)}
									/>
								{:else if item.kind === 'block'}
									<ShelfBlock result={item.result} eager={groupIndex < 2 && itemIndex < 6} />
								{/if}
							</div>
						</div>
					{/each}
				</li>
			{/each}
		</ul>

		{#if hasMore}
			<div class="absolute top-0 right-0 h-full w-px" {@attach watchEnd}></div>
			<div class="absolute right-(--shelf-padding) bottom-(--shelf-padding) text-foreground">
				{#if loadFailed}
					<button type="button" class="underline" onclick={onloadmore}
						>Couldn’t load more. Try again</button
					>
				{:else if loadingMore}
					<p>Loading more…</p>
				{/if}
			</div>
		{/if}
	</div>
</section>

<style>
	.shelf {
		--shelf-h: calc(100cqh - 2 * var(--annotation-area-height));
		--shelf-padding: calc(var(--shelf-h) * 0.05);
		--top-row-inset: calc(100cqi / var(--column-count));
		--bottom-row-inset: calc((100cqi / var(--column-count) - 4rem) / 2);
	}

	.shelf-group {
		transition:
			opacity var(--duration-reveal) var(--ease-out-expo),
			translate var(--duration-reveal) var(--ease-out-expo);
		transition-delay: calc(var(--row) * var(--delay-row));
	}

	.shelf-caption {
		transition: opacity var(--duration-caption) linear;
		transition-delay: calc(var(--delay-caption) + var(--row) * var(--delay-row));
	}

	:global([data-js]) .shelf-group:not([data-revealed]) {
		opacity: 0;
		translate: var(--shelf-padding) 0;
	}

	:global([data-js]) .shelf-group:not([data-revealed]) .shelf-caption {
		opacity: 0;
	}
</style>
