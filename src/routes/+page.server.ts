import { loadSearchBootstrap } from '$lib/server/search/bootstrap';
import type { PageServerLoad } from './$types';
export const load: PageServerLoad = ({ fetch }) => loadSearchBootstrap(fetch);
