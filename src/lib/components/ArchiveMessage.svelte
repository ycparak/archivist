<script lang="ts">
	import type { Snippet } from 'svelte';

	let { heading, children }: { heading: string; children?: Snippet } = $props();
</script>

<div class="message">
	<h2>{heading}</h2>
	{#if children}
		<div class="detail">{@render children()}</div>
	{/if}
</div>

<style>
	.message {
		display: flex;
		flex-direction: column;
		gap: calc(var(--spacing) * 3);
		max-inline-size: var(--reading-width);
		padding-block: calc(var(--spacing) * 8);
		border-top: var(--border-width) solid var(--color-border-subtle);
	}

	h2 {
		margin: 0;
	}

	.detail {
		color: var(--color-text-secondary);
	}

	.detail :global(p) {
		margin: 0;
	}

	.detail :global(code) {
		color: var(--color-text);
	}
</style>
