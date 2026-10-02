<script lang="ts">
	import type { ArchiveSearchHref, ArchiveSearchState } from '$lib/domain/search';
	import {
		CONNECTED_AT_FIRST_MONTH,
		datesToMonthRange,
		formatMonth,
		hrefWith,
		monthAt,
		monthRangeToDates,
		monthsBetween
	} from './filters';

	let {
		search,
		onnavigate
	}: { search: ArchiveSearchState; onnavigate: (href: ArchiveSearchHref) => void } = $props();

	const first = CONNECTED_AT_FIRST_MONTH;
	const today = new Date();
	const count = monthsBetween(first, {
		year: today.getUTCFullYear(),
		month: today.getUTCMonth() + 1
	});

	const committed = $derived(datesToMonthRange(search.from, search.to, first, count));
	/** Where the thumbs sit mid-drag; a new committed range from the URL resets it. */
	let dragging: [number, number] | undefined = $derived.by(() => {
		void committed;
		return undefined;
	});
	const range = $derived(dragging ?? committed);
	const active = $derived(Boolean(search.from || search.to));
	const label = $derived(
		`${formatMonth(monthAt(first, range[0]))} – ${formatMonth(monthAt(first, range[1]))}`
	);

	function move(thumb: 0 | 1, value: number) {
		const [start, end] = range;
		dragging = thumb === 0 ? [Math.min(value, end), end] : [start, Math.max(value, start)];
	}

	function commit() {
		if (!dragging) return;
		onnavigate(hrefWith(search, monthRangeToDates(dragging[0], dragging[1], first, count)));
	}

	const percent = (index: number) => (count > 1 ? (index / (count - 1)) * 100 : 0);
</script>

<div class="flex shrink-0 flex-col gap-2.5">
	<div class="lines">
		<h2 class="font-bold">Connected</h2>
		<p class={active ? 'text-foreground-strong' : undefined} aria-hidden="true">{label}</p>
	</div>
	<div class="relative h-4">
		<div
			class="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-foreground-secondary-detail"
		></div>
		<div
			class="absolute top-1/2 h-px -translate-y-1/2 bg-foreground-strong"
			style:left="{percent(range[0])}%"
			style:right="{100 - percent(range[1])}%"
		></div>
		<input
			class="range"
			type="range"
			min="0"
			max={count - 1}
			step="1"
			value={range[0]}
			style:z-index={range[0] === count - 1 ? 1 : undefined}
			aria-label="Connected from"
			aria-valuetext={formatMonth(monthAt(first, range[0]))}
			oninput={(event) => move(0, event.currentTarget.valueAsNumber)}
			onchange={commit}
		/>
		<input
			class="range"
			type="range"
			min="0"
			max={count - 1}
			step="1"
			value={range[1]}
			aria-label="Connected until"
			aria-valuetext={formatMonth(monthAt(first, range[1]))}
			oninput={(event) => move(1, event.currentTarget.valueAsNumber)}
			onchange={commit}
		/>
	</div>
</div>

<style>
	.range {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		margin: 0;
		appearance: none;
		background: transparent;
		pointer-events: none;
	}

	.range::-webkit-slider-runnable-track {
		height: 100%;
		background: transparent;
	}

	.range::-webkit-slider-thumb {
		appearance: none;
		width: 0.75rem;
		height: 0.75rem;
		margin-top: 0.125rem;
		border-radius: 9999px;
		background: var(--foreground-strong);
		border: 0;
		cursor: grab;
		pointer-events: auto;
	}

	.range::-moz-range-track {
		background: transparent;
	}

	.range::-moz-range-thumb {
		width: 0.75rem;
		height: 0.75rem;
		border-radius: 9999px;
		background: var(--foreground-strong);
		border: 0;
		cursor: grab;
		pointer-events: auto;
	}

	.range:active::-webkit-slider-thumb {
		cursor: grabbing;
	}

	.range:focus-visible {
		outline: none;
	}

	.range:focus-visible::-webkit-slider-thumb {
		outline: 2px solid var(--foreground-strong);
		outline-offset: 2px;
	}

	.range:focus-visible::-moz-range-thumb {
		outline: 2px solid var(--foreground-strong);
		outline-offset: 2px;
	}
</style>
