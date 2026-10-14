/**
 * Everything that names this deployment, outside `wrangler.jsonc` (Cloudflare account and route).
 * Running your own copy means changing these values; see the README.
 */
export const siteConfig = {
	/** The public origin the daily job compares each new release against. */
	siteUrl: 'https://archivist.yusufparak.com',
	/** The GitHub repository whose `Deploy site` workflow the daily job dispatches. */
	githubRepository: 'ycparak/archivist',
	/** The Trigger.dev project that runs hosted maintenance. */
	triggerProject: 'proj_yepyanjcjevddergrczr',
	/** Maintainer-chosen daily ceiling; blocks beyond it are described the next morning. */
	dailyVision: { maxBlocks: 50, budgetUsd: 0.5 }
} as const;
