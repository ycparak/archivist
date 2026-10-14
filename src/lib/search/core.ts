import MiniSearch from 'minisearch';
import { ARCHIVE_DEFAULT_SORT, type SearchResult } from '$lib/domain/search';
import type { ArchiveSearchInput } from './contracts';
import { colourThreshold } from './colour-filter';
import { EMBEDDING, normalizeVector } from './embedding';
import type { PublicDocument } from './snapshot';

export const lexicalOptions = { fields: ['search_text'], idField: 'id' };

/** What a search experiment may vary. Production uses exactly these values. */
export interface RankingOptions {
	rrfK: number;
	prefix: boolean;
	fuzzy: number;
}
/**
 * Prefix matching lets "widget" find "widgets"; adopted after the 2026-10-14 experiment, which
 * moved the widget-grid case onto the first page at a cost of 2 in 200 held-out top-1 results.
 */
export const PRODUCTION_RANKING: RankingOptions = { rrfK: 60, prefix: true, fuzzy: 0 };
const compareIds = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function matchesFilters(document: PublicDocument, input: ArchiveSearchInput): boolean {
	const result = document.result;
	if (input.blockTypes.length && (!document.kind || !input.blockTypes.includes(document.kind)))
		return false;
	if (
		input.channelSlugs.length &&
		!input.channelSlugs.some((slug) => result.channelSlugs.includes(slug))
	)
		return false;
	const leading =
		input.mode === 'browse' && input.sort === ARCHIVE_DEFAULT_SORT ? input.colours[0] : undefined;
	if (
		input.colours.some(
			(colour) => document.colours[colour] < colourThreshold(colour, colour === leading)
		)
	)
		return false;
	for (const [value, from, to] of [
		[result.connectedAt, input.from, input.to],
		[document.createdAt, input.createdFrom, input.createdTo]
	] as const) {
		if (!from && !to) continue;
		if (!value) return false;
		const time = Date.parse(value);
		if ((from && time < from.getTime()) || (to && time > to.getTime())) return false;
	}
	return true;
}

export function compareBrowse(
	a: PublicDocument,
	b: PublicDocument,
	input: ArchiveSearchInput
): number {
	if (input.sort === ARCHIVE_DEFAULT_SORT) {
		for (const colour of input.colours) {
			const difference = b.colours[colour] - a.colours[colour];
			if (difference) return difference;
		}
	}
	const connected = (document: PublicDocument) =>
		document.result.connectedAt ? Date.parse(document.result.connectedAt) : 0;
	const created = (document: PublicDocument) =>
		document.createdAt ? Date.parse(document.createdAt) : 0;
	let difference: number;
	switch (input.sort) {
		case 'my-most-connected':
			difference = b.connectionCount - a.connectionCount || connected(b) - connected(a);
			break;
		case 'my-least-connected':
			difference = a.connectionCount - b.connectionCount || connected(b) - connected(a);
			break;
		case 'my-newest-connected':
			difference = connected(b) - connected(a);
			break;
		case 'my-oldest-connected':
			difference = connected(a) - connected(b);
			break;
		case 'most-connected':
			difference = b.totalConnectionCount - a.totalConnectionCount || created(b) - created(a);
			break;
		case 'newest-created':
			difference = created(b) - created(a);
			break;
		case 'oldest-created':
			difference = created(a) - created(b);
			break;
	}
	return difference || compareIds(a.result.id, b.result.id);
}

export function reciprocalRankFusion(
	lists: readonly string[][],
	k: number = PRODUCTION_RANKING.rrfK
): string[] {
	const scores = new Map<string, number>();
	for (const list of lists) {
		for (const [rank, id] of [...new Set(list)].entries()) {
			scores.set(id, (scores.get(id) ?? 0) + 1 / (k + rank + 1));
		}
	}
	return [...scores.keys()].sort((a, b) => scores.get(b)! - scores.get(a)! || compareIds(a, b));
}

export class ArchiveSearchEngine {
	constructor(
		readonly documents: readonly PublicDocument[],
		private lexical: MiniSearch,
		private readonly vectorBlocks: readonly number[],
		private readonly ranking: RankingOptions = PRODUCTION_RANKING
	) {}
	private vectors?: Float32Array;
	setLexical(lexical: MiniSearch): void {
		this.lexical = lexical;
	}

	setVectors(vectors: Float32Array): void {
		if (vectors.length !== this.vectorBlocks.length * EMBEDDING.dimensions)
			throw new Error('Vector matrix length mismatch');
		for (let row = 0; row < this.vectorBlocks.length; row++) {
			let squaredNorm = 0;
			for (let dimension = 0; dimension < EMBEDDING.dimensions; dimension++) {
				const value = vectors[row * EMBEDDING.dimensions + dimension];
				if (!Number.isFinite(value)) throw new Error('Non-finite corpus embedding');
				squaredNorm += value * value;
			}
			if (Math.abs(squaredNorm - 1) > 0.001) throw new Error('Corpus embedding is not normalized');
		}
		this.vectors = vectors;
	}

	search(input: ArchiveSearchInput, queryVector?: readonly number[]): SearchResult[] {
		const eligible = new Map(
			this.documents
				.filter((document) => matchesFilters(document, input))
				.map((document) => [document.result.id, document])
		);
		if (input.mode === 'browse')
			return [...eligible.values()]
				.sort((a, b) => compareBrowse(a, b, input))
				.map((document) => document.result);
		const lexical =
			input.mode === 'semantic'
				? []
				: this.lexical
						.search(input.query, {
							combineWith: 'OR',
							prefix: this.ranking.prefix,
							fuzzy: this.ranking.fuzzy,
							filter: (result) => eligible.has(String(result.id))
						})
						.sort((a, b) => b.score - a.score || compareIds(String(a.id), String(b.id)))
						.map((result) => String(result.id));
		if (input.mode === 'lexical') return lexical.map((id) => eligible.get(id)!.result);
		if (!this.vectors || !queryVector) throw new Error('Semantic search requires embeddings');
		const query = normalizeVector(queryVector);
		const scores = new Map<string, number>();
		for (const [row, block] of this.vectorBlocks.entries()) {
			const id = this.documents[block].result.id;
			if (!eligible.has(id)) continue;
			let score = 0;
			for (let dimension = 0; dimension < EMBEDDING.dimensions; dimension++)
				score += query[dimension] * this.vectors[row * EMBEDDING.dimensions + dimension];
			scores.set(id, Math.max(scores.get(id) ?? -Infinity, score));
		}
		const semantic = [...scores.keys()].sort(
			(a, b) => scores.get(b)! - scores.get(a)! || compareIds(a, b)
		);
		const ranked =
			input.mode === 'semantic'
				? semantic
				: reciprocalRankFusion([lexical, semantic], this.ranking.rrfK);
		return ranked.map((id) => eligible.get(id)!.result);
	}
}
