import { z } from 'zod';

export const SITE_DEPLOY_WORKFLOW = 'deploy-site.yml';

const dispatchSchema = z.object({
	token: z.string().min(1),
	repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
	jobId: z.string().min(1),
	revision: z.string().regex(/^[a-f0-9]{40}$/)
});

/** Hands a passing job to the site deployment workflow, which repeats every deployment check. */
export async function dispatchSiteDeploy(
	options: z.input<typeof dispatchSchema>,
	fetchFn: typeof fetch = fetch
) {
	const { token, repository, jobId, revision } = dispatchSchema.parse(options);
	const response = await fetchFn(
		`https://api.github.com/repos/${repository}/actions/workflows/${SITE_DEPLOY_WORKFLOW}/dispatches`,
		{
			method: 'POST',
			headers: {
				authorization: `Bearer ${token}`,
				accept: 'application/vnd.github+json',
				'content-type': 'application/json',
				'user-agent': 'archivist-maintenance',
				'x-github-api-version': '2022-11-28'
			},
			body: JSON.stringify({ ref: 'main', inputs: { job_id: jobId, revision } }),
			signal: AbortSignal.timeout(30_000)
		}
	);
	if (response.status !== 204 && response.status !== 200)
		throw new Error(`Site deploy dispatch failed (${response.status})`);
}
