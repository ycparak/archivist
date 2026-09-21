import type Turbopuffer from '@turbopuffer/turbopuffer';

/** Turbopuffer requires this on every write once a namespace has a vector attribute. */
export const archiveDistanceMetric: Turbopuffer.DistanceMetric = 'cosine_distance';

export const archiveNamespaceSchema = {
	search_text: {
		type: 'string',
		filterable: false,
		full_text_search: { language: 'english', stemming: true, remove_stopwords: true },
		embed: { model: 'nvidia/nemotron-3-embed-8b', dims: 1024 }
	},
	block_type: { type: 'string', filterable: true },
	channel_slugs: { type: '[]string', filterable: true },
	connection_count: { type: 'uint', filterable: true },
	connected_at: { type: 'datetime', filterable: true },
	created_at: { type: 'datetime', filterable: false },
	title: { type: 'string', filterable: false },
	description: { type: 'string', filterable: false },
	source_url: { type: 'string', filterable: false },
	arena_url: { type: 'string', filterable: false },
	image_url: { type: 'string', filterable: false },
	image_alt: { type: 'string', filterable: false },
	image_width: { type: 'uint', filterable: false },
	image_height: { type: 'uint', filterable: false },
	source_title: { type: 'string', filterable: false }
} satisfies Record<string, Turbopuffer.AttributeSchema>;
