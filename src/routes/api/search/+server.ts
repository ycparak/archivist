import type { RequestHandler } from './$types';
export const GET: RequestHandler = () =>
	Response.json(
		{ error: 'Search runs in the browser using the versioned archive assets' },
		{ status: 410, headers: { 'cache-control': 'no-store' } }
	);
