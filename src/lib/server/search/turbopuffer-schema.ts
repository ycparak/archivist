import type Turbopuffer from '@turbopuffer/turbopuffer';

/**
 * The first write creates the namespace schema. Breaking type/model changes require a new namespace.
 * `search_text` is intentionally the only semantic and full-text field.
 */
export const archiveNamespaceSchema = {
	search_text: {
		type: 'string',
		filterable: false,
		full_text_search: { language: 'english', stemming: true, remove_stopwords: true },
		embed: { model: 'nvidia/nemotron-3-embed-8b', dims: 1024 }
	},
	block_type: { type: 'string', filterable: true },
	channel_slugs: { type: '[]string', filterable: true },
	connected_at: { type: 'datetime', filterable: true },
	created_at: { type: 'datetime', filterable: false },
	title: { type: 'string', filterable: false },
	description: { type: 'string', filterable: false },
	source_url: { type: 'string', filterable: false },
	arena_url: { type: 'string', filterable: false },
	image_url: { type: 'string', filterable: false },
	source_title: { type: 'string', filterable: false }
} satisfies Record<string, Turbopuffer.AttributeSchema>;
