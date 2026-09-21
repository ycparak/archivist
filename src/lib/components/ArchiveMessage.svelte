<script lang="ts">
	import type { Snippet } from 'svelte';

	let { heading, children }: { heading: string; children?: Snippet } = $props();
</script>

<div class="flex max-w-(--reading-width) flex-col gap-3 border-t border-border-subtle py-8">
	<h2>{heading}</h2>
	{#if children}
		<div class="text-text-secondary [&_code]:text-text">{@render children()}</div>
	{/if}
</div>
