<script lang="ts">
	import type { Snippet } from 'svelte';

	let { heading, children }: { heading: string; children?: Snippet } = $props();
</script>

<div class="flex flex-col gap-(--gap-paragraph)">
	<h2 class="text-foreground-strong">{heading}</h2>
	{#if children}
		<div class="text-balance text-foreground [&_code]:wrap-anywhere">{@render children()}</div>
	{/if}
</div>
