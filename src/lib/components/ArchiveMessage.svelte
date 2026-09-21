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
		gap: var(--space-4);
		max-inline-size: var(--reading-width);
		padding-block: var(--space-16);
		border-top: var(--border-width) solid var(--color-border-subtle);
	}

	h2 {
		margin: 0;
		font-size: var(--text-xl);
	}

	.detail {
		color: var(--color-text-secondary);
		font-size: var(--text-sm);
	}
</style>
