<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import { resolve } from '$app/paths';
	import type {
		ArchiveColour,
		ArchiveSearchHref,
		ArchiveSearchState,
		ChannelManifestEntry
	} from '$lib/domain/search';
	import ConnectedAtSlider from './ConnectedAtSlider.svelte';
	import {
		blockTypeOptions,
		channelOption,
		colourOptions,
		searchTypeOptions,
		sortOptions,
		type FilterOption
	} from './filters';
	import { archiveCount } from './format';
	import { createLabelMeasure, packIntoColumns, readTextStyle } from './index-layout';

	let {
		search,
		channels,
		blockCount,
		onnavigate
	}: {
		search: ArchiveSearchState;
		channels: ChannelManifestEntry[];
		blockCount: number | null;
		onnavigate: (href: ArchiveSearchHref) => void;
	} = $props();

	const SWATCHES: Record<ArchiveColour, string> = {
		red: 'bg-red',
		orange: 'bg-paprika',
		yellow: 'bg-yellow',
		green: 'bg-green',
		blue: 'bg-blue',
		purple: 'bg-lilac',
		pink: 'bg-pink',
		brown: 'bg-brown',
		grey: 'bg-gray-500',
		black: 'bg-black',
		white: 'bg-white',
		mono: 'border border-foreground-detail bg-[linear-gradient(135deg,black_50%,white_50%)]'
	};

	let channelColumns = $state.raw<ChannelManifestEntry[][]>([]);
	const columns = $derived(channelColumns.length ? channelColumns : [channels]);

	/**
	 * Splits the channel list into as many columns as the viewport height needs. Every title's
	 * wrapped height comes from pretext, so the split is decided before any of it is laid out and
	 * the list never clips mid-entry.
	 */
	const fitChannels: Attachment<HTMLElement> = (root) => {
		const list = channels;
		let alive = true;

		const fit = () => {
			const entries = root.querySelector<HTMLElement>('[data-index-entries]');
			if (!alive || !entries || !entries.clientHeight || !entries.clientWidth) return;
			const measure = createLabelMeasure(readTextStyle(entries), entries.clientWidth);
			const next = packIntoColumns(list, entries.clientHeight, (channel) => measure(channel.title));
			const unchanged =
				next.length === channelColumns.length &&
				next.every((column, index) => column.length === channelColumns[index].length);
			if (!unchanged) channelColumns = next;
		};

		const observer = new ResizeObserver(fit);
		const first = root.querySelector('[data-index-entries]');
		if (first) observer.observe(first);
		void document.fonts.ready.then(fit);
		document.fonts.addEventListener('loadingdone', fit);
		return () => {
			alive = false;
			observer.disconnect();
			document.fonts.removeEventListener('loadingdone', fit);
		};
	};
</script>

{#snippet option(entry: FilterOption)}
	{#if entry.href}
		<a
			class={['block hover:text-foreground-strong', entry.active && 'text-foreground-strong']}
			href={resolve(entry.href)}
			aria-current={entry.active ? 'true' : undefined}
			data-sveltekit-noscroll
			data-sveltekit-keepfocus>{entry.label}</a
		>
	{:else}
		<span class="block text-foreground-secondary" aria-disabled="true">{entry.label}</span>
	{/if}
{/snippet}

{#snippet list(heading: string, entries: FilterOption[])}
	<div class="lines shrink-0">
		<h2 class="font-bold">{heading}</h2>
		{#each entries as entry (entry.key)}
			{@render option(entry)}
		{/each}
	</div>
{/snippet}

<div
	class="relative grid h-full flex-none grid-rows-[var(--annotation-area-height)_minmax(0,1fr)_var(--annotation-area-height)] pl-(--page-gutter)"
>
	<nav
		class="row-start-2 flex min-h-0 gap-(--column-gap)"
		aria-label="Filters"
		{@attach fitChannels}
	>
		<div
			class="rule flex min-h-0 w-(--column-width) flex-none flex-col gap-(--gap-paragraph) clip-trimmed spread:contents"
		>
			<section
				class="flex min-h-0 flex-col gap-(--gap-paragraph) spread:rule spread:w-(--column-width) spread:flex-none"
				aria-label="Ranking"
			>
				{@render list('Search type', searchTypeOptions(search))}
				{@render list('Sort by', sortOptions(search))}
				<ConnectedAtSlider {search} {onnavigate} />
			</section>
			<section
				class="flex min-h-0 flex-col gap-(--gap-paragraph) spread:rule spread:w-(--column-width) spread:flex-none"
				aria-label="Kind"
			>
				{@render list('Block type', blockTypeOptions(search))}
				<div class="@container flex shrink-0 flex-col gap-2.5">
					<h2 class="font-bold">Colours</h2>
					<ul class="m-0 grid list-none grid-cols-6 gap-1 p-0 @min-[13rem]:grid-cols-12">
						{#each colourOptions(search) as colour (colour.key)}
							<li>
								{#if colour.href}
									<a
										class={[
											'block aspect-square rounded-full',
											SWATCHES[colour.key as ArchiveColour],
											colour.active &&
												'ring-1 ring-foreground-strong ring-offset-2 ring-offset-background'
										]}
										href={resolve(colour.href)}
										aria-label={colour.label}
										aria-current={colour.active ? 'true' : undefined}
										title={colour.label}
										data-sveltekit-noscroll
										data-sveltekit-keepfocus
									></a>
								{:else}
									<span
										class={[
											'block aspect-square rounded-full opacity-30',
											SWATCHES[colour.key as ArchiveColour]
										]}
										role="img"
										aria-label="{colour.label} (at most five colours)"
									></span>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			</section>
		</div>

		{#if channels.length}
			{#each columns as column, index (index)}
				<section
					class="rule flex min-h-0 w-(--column-width) flex-none flex-col gap-(--gap-line)"
					aria-label={index === 0 ? 'Channels' : undefined}
				>
					<h2 class="shrink-0 font-bold">Channel</h2>
					<div class="lines min-h-0 flex-1 clip-trimmed" data-index-entries>
						{#each column as channel (channel.slug)}
							{@render option(channelOption(search, channel))}
						{/each}
					</div>
				</section>
			{/each}
		{/if}
	</nav>

	<footer
		class="row-start-3 flex items-end gap-(--column-gap) self-end pb-3 text-foreground-strong"
	>
		<p class="w-(--column-width) flex-none font-serif text-3xl">Archivist</p>
		<p class="lines">
			<span class="block">{archiveCount(channels.length, 'channel')}</span>
			{#if blockCount !== null}<span class="block">{archiveCount(blockCount, 'block')}</span>{/if}
		</p>
	</footer>
</div>
