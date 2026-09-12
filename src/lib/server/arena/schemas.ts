import { z } from 'zod';

const markdownContentSchema = z.object({
	markdown: z.string(),
	html: z.string(),
	plain: z.string()
});

const blockImageVersionSchema = z.object({
	src: z.url(),
	src_2x: z.url().optional(),
	width: z.number().nullable().optional(),
	height: z.number().nullable().optional()
});

const blockImageSchema = z.object({
	src: z.url(),
	alt_text: z.string().nullable().optional(),
	blurhash: z.string().nullable().optional(),
	width: z.number().nullable().optional(),
	height: z.number().nullable().optional(),
	small: blockImageVersionSchema,
	medium: blockImageVersionSchema,
	large: blockImageVersionSchema,
	square: blockImageVersionSchema
});

const blockSourceSchema = z.object({
	url: z.url(),
	title: z.string().nullable().optional()
});

const blockAttachmentSchema = z.object({
	url: z.url(),
	filename: z.string().nullable().optional(),
	content_type: z.string().nullable().optional(),
	file_size: z.number().nullable().optional(),
	file_extension: z.string().nullable().optional()
});

const blockEmbedSchema = z.object({
	url: z.url().nullable().optional(),
	html: z.string().nullable().optional(),
	title: z.string().nullable().optional(),
	width: z.number().nullable().optional(),
	height: z.number().nullable().optional(),
	thumbnail_url: z.url().nullable().optional()
});

const embeddedConnectionSchema = z.object({
	connected_at: z.coerce.date()
});

const baseContentItemFieldsSchema = z.object({
	id: z.number(),
	title: z.string().nullable().optional(),
	description: markdownContentSchema.nullable().optional(),
	source: blockSourceSchema.nullable().optional(),
	created_at: z.coerce.date(),
	connection: embeddedConnectionSchema
});

export const arenaTextBlockSchema = baseContentItemFieldsSchema.extend({
	type: z.literal('Text'),
	content: markdownContentSchema
});

export const arenaImageBlockSchema = baseContentItemFieldsSchema.extend({
	type: z.literal('Image'),
	image: blockImageSchema
});

export const arenaLinkBlockSchema = baseContentItemFieldsSchema.extend({
	type: z.literal('Link'),
	image: blockImageSchema.nullable().optional(),
	content: markdownContentSchema.nullable().optional()
});

export const arenaAttachmentBlockSchema = baseContentItemFieldsSchema.extend({
	type: z.literal('Attachment'),
	attachment: blockAttachmentSchema,
	image: blockImageSchema.nullable().optional()
});

export const arenaEmbedBlockSchema = baseContentItemFieldsSchema.extend({
	type: z.literal('Embed'),
	embed: blockEmbedSchema,
	image: blockImageSchema.nullable().optional()
});

export const arenaChannelItemSchema = z.object({
	id: z.number(),
	type: z.literal('Channel'),
	slug: z.string(),
	title: z.string(),
	connection: embeddedConnectionSchema
});

export const arenaContentItemSchema = z.discriminatedUnion('type', [
	arenaTextBlockSchema,
	arenaImageBlockSchema,
	arenaLinkBlockSchema,
	arenaAttachmentBlockSchema,
	arenaEmbedBlockSchema,
	arenaChannelItemSchema
]);

export type ArenaContentItem = z.infer<typeof arenaContentItemSchema>;
export type ArenaBlockItem = Exclude<ArenaContentItem, { type: 'Channel' }>;

const paginationMetaSchema = z.object({
	current_page: z.number(),
	next_page: z.number().nullable(),
	per_page: z.number(),
	total_pages: z.number(),
	total_count: z.number(),
	has_more_pages: z.boolean()
});

export type ArenaPaginationMeta = z.infer<typeof paginationMetaSchema>;

export const arenaChannelContentsResponseSchema = z.object({
	data: z.array(arenaContentItemSchema),
	meta: paginationMetaSchema
});

export type ArenaChannelContentsResponse = z.infer<typeof arenaChannelContentsResponseSchema>;

export const arenaMeSchema = z.object({
	id: z.number(),
	slug: z.string()
});

export type ArenaMe = z.infer<typeof arenaMeSchema>;

export const arenaOwnedChannelSchema = z.object({
	id: z.number(),
	type: z.literal('Channel'),
	slug: z.string(),
	title: z.string()
});

export type ArenaOwnedChannel = z.infer<typeof arenaOwnedChannelSchema>;

export const arenaOwnedChannelsResponseSchema = z.object({
	data: z.array(arenaOwnedChannelSchema),
	meta: paginationMetaSchema
});

export type ArenaOwnedChannelsResponse = z.infer<typeof arenaOwnedChannelsResponseSchema>;
