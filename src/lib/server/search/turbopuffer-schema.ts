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
	/** Playable file for a video attachment; the thumbnail stays in `image_url` as its poster. */
	video_url: { type: 'string', filterable: false },
	video_content_type: { type: 'string', filterable: false },
	source_title: { type: 'string', filterable: false },
	vision_title: { type: 'string', filterable: false },
	vision_description: { type: 'string', filterable: false },
	vision_ocr: { type: 'string', filterable: false },
	/** Filterable for a future facet, but unreliable: a grainy photograph came back as `painting`. Measure before exposing it. */
	vision_medium: { type: 'string', filterable: true },
	/**
	 * Filterable for a future tag facet. Nothing reads it back yet: an attribute named in
	 * `include_attributes` before a sync has written it fails the whole query with a 400.
	 */
	vision_tags: { type: '[]string', filterable: true }
} satisfies Record<string, Turbopuffer.AttributeSchema>;
