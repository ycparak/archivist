import * as publicEnvironment from '$env/static/public';

const settings: Readonly<Record<string, string | undefined>> = publicEnvironment;
export const browserSearchEnabled = settings.PUBLIC_ARCHIVE_SEARCH === 'browser';
