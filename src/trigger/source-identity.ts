/**
 * Replaced by CI (`bun run hosted identity`) before each production Trigger deploy, so scheduled
 * jobs record the exact source they ran. A local or hand-made bundle keeps `null` and therefore
 * can never hand a release to the site deployment.
 */
export const SOURCE_IDENTITY: { sourceRevision: string; sourceFingerprint: string } | null = null;
