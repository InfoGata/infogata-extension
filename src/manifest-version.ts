/**
 * Whether this build is Manifest V3 (Chrome) rather than V2 (Firefox).
 *
 * Its own module so tests can choose the path: vitest's `import.meta.env` only
 * holds strings, so the build's numeric MANIFEST_VERSION cannot be stubbed.
 */
export const isMv3 = import.meta.env.MANIFEST_VERSION === 3;
