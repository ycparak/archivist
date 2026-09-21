<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		count = 0,
		children
	}: { label: string; count?: number; children: Snippet } = $props();

	let details = $state<HTMLDetailsElement>();

	function close(returnFocus = false) {
		if (!details?.open) return;
		details.open = false;
		if (returnFocus) details.querySelector('summary')?.focus();
	}
</script>

<svelte:window
	onclick={(event) => {
		if (event.target instanceof Node && !details?.contains(event.target)) close();
	}}
	onkeydown={(event) => {
		if (event.key === 'Escape') close(true);
	}}
/>

<details class="relative" bind:this={details}>
	<summary
		class="flex h-(--control-sm) cursor-pointer list-none items-center gap-2 rounded-field border border-border-subtle bg-surface-hover chevron pl-3 whitespace-nowrap text-text-tertiary hover:border-border [&::-webkit-details-marker]:hidden"
	>
		<span class="trim-text">{label}</span>{#if count}<span class="text-text trim-text">{count}</span
			>{/if}
	</summary>
	<div
		class="absolute top-[calc(100%+var(--spacing))] left-0 z-10 flex max-h-64 w-max max-w-[min(20rem,80vw)] flex-col gap-2 overflow-y-auto rounded-field border border-border-subtle bg-surface-hover p-3"
	>
		{@render children()}
	</div>
</details>
