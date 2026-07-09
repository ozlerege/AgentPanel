/**
 * Channel names shared with the preload. This module must stay free of
 * imports: the sandboxed preload cannot require() external packages, so
 * anything it pulls in (transitively) has to be dependency-free — see
 * src/preload/imports.test.ts.
 */
export const RESOURCES_CHANGED_CHANNEL = 'resources:changed'
