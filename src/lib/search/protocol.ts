import type { SearchResult, ArchiveSearchState } from '$lib/domain/search';
import type { SearchRelease } from './snapshot';

export type BrowserSearchOutcome =
	| {
			kind: 'ok';
			state: ArchiveSearchState;
			results: SearchResult[];
			hasMore: boolean;
	  }
	| { kind: 'invalid'; state: ArchiveSearchState }
	| { kind: 'unavailable'; state: ArchiveSearchState; correlationId: string };
export type WorkerRequest =
	| { type: 'initialize'; release: SearchRelease }
	| { type: 'search'; id: number; params: string }
	| { type: 'cancel'; id: number };
export type WorkerResponse = { id: number; outcome: BrowserSearchOutcome };
