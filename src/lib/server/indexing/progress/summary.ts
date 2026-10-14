import type { SyncSummary } from '$lib/server/indexing/sync';

/** The end-of-run report, one line per entry; the caller decides where to print it. */
export function formatSyncSummary(summary: SyncSummary): string[] {
	const lines = ['', 'Sync summary:'];
	lines.push(`  Channels discovered: ${summary.channelsDiscovered}`);
	lines.push(`  Channels ignored:    ${summary.channelsIgnored}`);
	lines.push(`  Private skipped:     ${summary.channelsPrivateSkipped}`);
	lines.push(`  Channels synced:     ${summary.channelsSynced}`);
	if (summary.channelsFailed.length > 0) {
		lines.push(`  Channels failed:     ${summary.channelsFailed.length}`);
		for (const failure of summary.channelsFailed) {
			lines.push(`    - ${failure.slug}: ${failure.error}`);
		}
	}
	lines.push(`  Blocks fetched:      ${summary.blocksFetched}`);
	lines.push(`  Items skipped:       ${summary.itemsSkipped} (nested channels, not blocks)`);
	lines.push(`  Unique blocks:       ${summary.uniqueBlocks} (after dedup across channels)`);
	if (summary.colour) {
		const c = summary.colour;
		lines.push(`  Colour cache hits:   ${c.cacheHits} (no download)`);
		lines.push(`  Colour measured:     ${c.measured}`);
		if (c.skippedTooLarge) lines.push(`  Colour skipped:      ${c.skippedTooLarge} (too large)`);
		if (c.skippedUnreachable)
			lines.push(`  Colour skipped:      ${c.skippedUnreachable} (source could not be downloaded)`);
		if (c.skippedUnsupported)
			lines.push(`  Colour skipped:      ${c.skippedUnsupported} (format not readable)`);
		if (c.failed.length) {
			lines.push(`  Colour failed:       ${c.failed.length}`);
			for (const failure of c.failed.slice(0, 10)) {
				lines.push(`    - ${failure.blockId}: ${failure.error}`);
			}
			if (c.failed.length > 10) lines.push(`    ... and ${c.failed.length - 10} more`);
		}
	}
	if (summary.connections) {
		const n = summary.connections;
		lines.push(`  Connections cached:  ${n.cacheHits} (no request)`);
		lines.push(`  Connections counted: ${n.counted}`);
		if (n.failed.length) {
			lines.push(`  Connections failed:  ${n.failed.length}`);
			for (const failure of n.failed.slice(0, 10)) {
				lines.push(`    - ${failure.blockId}: ${failure.error}`);
			}
			if (n.failed.length > 10) lines.push(`    ... and ${n.failed.length - 10} more`);
		}
	}
	if (summary.vision) {
		const v = summary.vision;
		lines.push(`  Blocks with image:   ${v.blocksWithImage}`);
		lines.push(`  Vision cache hits:   ${v.cacheHits} (no model call, no cost)`);
		lines.push(`  Vision generated:    ${v.generated}`);
		if (v.generatedFromVideo) lines.push(`  Vision from video:   ${v.generatedFromVideo}`);
		if (v.skippedTooLarge)
			lines.push(`  Vision skipped:      ${v.skippedTooLarge} (media too large)`);
		if (v.skippedUnreachable)
			lines.push(`  Vision skipped:      ${v.skippedUnreachable} (source could not be downloaded)`);
		if (v.skippedUnsupported)
			lines.push(`  Vision skipped:      ${v.skippedUnsupported} (format not describable)`);
		if (v.failed.length) {
			lines.push(`  Vision failed:       ${v.failed.length}`);
			for (const failure of v.failed.slice(0, 10)) {
				lines.push(`    - ${failure.blockId}: ${failure.error}`);
			}
			if (v.failed.length > 10) lines.push(`    ... and ${v.failed.length - 10} more`);
		}
	}
	if (summary.writeBack) {
		const w = summary.writeBack;
		lines.push(`  Are.na written:      ${w.blocksUpdated} of ${w.blocksPlanned} planned block(s)`);
		lines.push(`    titles replaced:   ${w.titlesReplaced}`);
		lines.push(`    titles added:      ${w.titlesAdded}`);
		lines.push(`    descriptions:      ${w.descriptionsAdded}`);
		lines.push(
			`    skipped:           ${w.skipped.notOwned} not yours, ${w.skipped.noVisionResult} no description, ${w.skipped.nothingToChange} already fine`
		);
		if (w.failed.length) {
			lines.push(`    FAILED:            ${w.failed.length}`);
			for (const failure of w.failed.slice(0, 10)) {
				lines.push(`      - ${failure.blockId}: ${failure.error}`);
			}
			if (w.failed.length > 10) lines.push(`      ... and ${w.failed.length - 10} more`);
		}
	}
	return lines;
}
