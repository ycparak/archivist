import { readFile } from 'node:fs/promises';
import { metadataSchema, releaseSchema } from '$lib/search/snapshot';
import { checkedAsset } from '$lib/search/assets';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ARCHIVE_COLOURS, type ArchiveColour } from '$lib/domain/search';
import type { ColourWeights } from '$lib/server/indexing/colour/classify';
import { measureImageColours } from '$lib/server/indexing/colour/extract';
import { pool } from '$lib/server/indexing/pool';
import { renditionUrl } from '$lib/server/indexing/vision/rendition';
import { COLOUR_THRESHOLDS } from '$lib/search/colour-filter';

/**
 * Read-only. Lists blocks from the checked public snapshot, measures a sample's colours the way the sync does, and
 * writes a contact sheet outside the repo: the strongest blocks per colour, and the blocks either
 * side of each threshold. Nothing is written to the index, the caches or Are.na.
 */

const { values } = parseArgs({
	options: {
		sample: { type: 'string', default: '300' },
		out: { type: 'string', default: join(tmpdir(), 'archivist-colour-sheet.html') }
	}
});
const sampleSize = Number(values.sample);
if (!Number.isInteger(sampleSize) || sampleSize <= 0) {
	console.error('--sample must be a positive whole number.');
	process.exit(1);
}

interface Candidate {
	id: string;
	title: string | null;
	imageUrl: string;
	arenaUrl: string;
}

interface Measured extends Candidate {
	weights: ColourWeights;
	frames: number;
}

const root = new URL('../static/', import.meta.url);
const release = releaseSchema.parse(
	JSON.parse(await readFile(new URL('search/manifest.json', root), 'utf8'))
);
const metadata = metadataSchema.parse(
	JSON.parse(
		new TextDecoder().decode(
			await checkedAsset(
				release,
				release.metadata,
				async (input) =>
					new Response(
						new Uint8Array(await readFile(new URL(String(input).replace(/^\//, ''), root)))
					)
			)
		)
	)
);
const candidates: Candidate[] = metadata.documents.flatMap(({ result }) =>
	result.imageUrl
		? [{ id: result.id, title: result.title, imageUrl: result.imageUrl, arenaUrl: result.arenaUrl }]
		: []
);

// Stable across runs, so a boundary change is judged against the same blocks.
const sortKey = (id: string) => createHash('sha256').update(id).digest('hex');
const sample = candidates
	.map((candidate) => ({ candidate, key: sortKey(candidate.id) }))
	.sort((a, b) => a.key.localeCompare(b.key))
	.slice(0, sampleSize)
	.map(({ candidate }) => candidate);

console.log(`Measuring ${sample.length} of ${candidates.length} blocks with an image`);

const measured: Measured[] = [];
let failed = 0;
await pool(sample, 4, async (candidate) => {
	try {
		const result = await measureImageColours(candidate.imageUrl);
		if (result.kind === 'measured') measured.push({ ...candidate, ...result });
		else failed += 1;
	} catch (error) {
		failed += 1;
		console.error(`  ${candidate.id}: ${error instanceof Error ? error.message : String(error)}`);
	}
});
console.log(`Measured ${measured.length}, ${failed} skipped or failed`);

const SWATCH: Record<ArchiveColour, string> = {
	red: '#e03131',
	orange: '#f76707',
	yellow: '#fcc419',
	green: '#2f9e44',
	blue: '#1c7ed6',
	purple: '#7048e8',
	pink: '#e64980',
	brown: '#8b5a2b',
	grey: '#909296',
	black: '#111111',
	white: '#f8f9fa',
	mono: 'repeating-linear-gradient(45deg,#111 0 4px,#eee 4px 8px)'
};

const escape = (text: string) =>
	text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

function tile(block: Measured, colour: ArchiveColour): string {
	const bar = ARCHIVE_COLOURS.filter((c) => c !== 'mono' && block.weights[c] > 0)
		.map((c) => `<span style="flex:${block.weights[c]};background:${SWATCH[c]}"></span>`)
		.join('');
	return `<a class="tile" href="${escape(block.arenaUrl)}" target="_blank" title="${escape(block.title ?? block.id)}">
<img loading="lazy" src="${escape(renditionUrl(block.imageUrl, 256))}" alt="">
<span class="bar">${bar}</span>
<span class="label">${colour} ${block.weights[colour]}‰${block.frames > 1 ? ` · ${block.frames}f` : ''}</span></a>`;
}

const sections = ARCHIVE_COLOURS.map((colour) => {
	const threshold = COLOUR_THRESHOLDS[colour];
	const byWeight = [...measured].sort((a, b) => b.weights[colour] - a.weights[colour]);
	const matching = byWeight.filter((block) => block.weights[colour] >= threshold);
	const below = byWeight.filter((block) => block.weights[colour] < threshold).slice(0, 8);
	return `<section><h2><span class="swatch" style="background:${SWATCH[colour]}"></span>${colour}
<small>threshold ${threshold}‰ · ${matching.length} of ${measured.length} match (${Math.round((matching.length / measured.length) * 100)}%)</small></h2>
<h3>Strongest</h3><div class="grid">${matching
		.slice(0, 20)
		.map((block) => tile(block, colour))
		.join('')}</div>
<h3>Just above the threshold</h3><div class="grid">${matching
		.slice(-8)
		.map((block) => tile(block, colour))
		.join('')}</div>
<h3>Just below</h3><div class="grid">${below.map((block) => tile(block, colour)).join('')}</div></section>`;
}).join('\n');

await writeFile(
	values.out,
	`<!doctype html><meta charset="utf-8"><title>Colour calibration</title>
<style>
body{font:13px system-ui,sans-serif;margin:16px;background:#fff;color:#111}
h2{display:flex;gap:8px;align-items:center;margin:32px 0 4px}h2 small{font-weight:normal;color:#666}
h3{font-size:12px;color:#666;margin:12px 0 4px;font-weight:normal}
.swatch{width:18px;height:18px;border-radius:4px;border:1px solid #ccc;display:inline-block}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px}
.tile{display:flex;flex-direction:column;gap:2px;color:inherit;text-decoration:none}
.tile img{width:100%;aspect-ratio:1;object-fit:cover;background:#eee}
.bar{display:flex;height:6px}.label{font-variant-numeric:tabular-nums}
</style>
<h1>Colour calibration</h1><p>${measured.length} blocks measured. Bars show each block's chromatic and neutral shares.</p>
${sections}`
);
console.log(`Wrote ${values.out}`);
