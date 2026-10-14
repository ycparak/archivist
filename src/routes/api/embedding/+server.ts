import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';
import { EMBEDDING } from '$lib/search/embedding';
import { createCloudflareEmbedder } from '$lib/server/release/export';
import { handleEmbeddingRequest } from '$lib/server/search/embedding-handler';

export const POST: RequestHandler = ({ request, platform }) => {
	if (dev && env.CLOUDFLARE_ACCOUNT_ID && env.CLOUDFLARE_API_TOKEN) {
		const embed = createCloudflareEmbedder({
			accountId: env.CLOUDFLARE_ACCOUNT_ID,
			apiToken: env.CLOUDFLARE_API_TOKEN
		});
		return handleEmbeddingRequest(request, async (text) => ({ data: await embed([text]) }));
	}
	const ai = platform?.env.AI;
	return handleEmbeddingRequest(
		request,
		ai ? (text) => ai.run(EMBEDDING.model, { text: [text] }) : undefined
	);
};
