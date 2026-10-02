<script lang="ts">
	import type { Attachment } from 'svelte/attachments';
	import { firstKeywordIndex, highlight, leadInOffset } from './caption';
	import { createWidthMeasure, readTextStyle } from './index-layout';

	let { text, query }: { text: string; query: string } = $props();

	let offset = $state(0);

	const shown = $derived(offset > 0 ? text.slice(offset).trimStart() : text);
	const segments = $derived(highlight(shown, query));

	/** Starts the caption just before its first keyword, measured with pretext, so the line clamp cannot hide it. */
	const leadIn: Attachment<HTMLElement> = (element) => {
		const keywordIndex = firstKeywordIndex(text, query);
		if (keywordIndex <= 0) {
			offset = 0;
			return;
		}
		const measure = createWidthMeasure(readTextStyle(element));
		const fit = () => {
			offset = leadInOffset(text, keywordIndex, element.clientWidth, measure);
		};
		const observer = new ResizeObserver(fit);
		observer.observe(element);
		return () => observer.disconnect();
	};
</script>

<div class="clamp-3" {@attach leadIn}>
	{#if offset > 0}&hellip;&#32;{/if}{#each segments as segment, index (index)}{#if segment.mark}<mark
				>{segment.text}</mark
			>{:else}{segment.text}{/if}{/each}
</div>
